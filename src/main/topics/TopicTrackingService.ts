import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentTaskRecord,
  PaperAnalysisRecord,
  PaperRecord,
  PaperSearchResult,
  TopicAnalysisReport,
  TopicAnalysisSection,
  TopicExecutionHistory,
  TopicPaperDigest,
  TopicRunResult,
  TopicRunTrigger,
  TopicSubscription,
  TopicSubscriptionInput,
  TopicTrackingSnapshot,
  WorkspaceDirectories,
} from '@shared/types';

import { AgentRuntimeService } from '../agents/AgentRuntimeService';
import { PaperAnalysisService } from '../analysis/PaperAnalysisService';
import { PaperService } from '../papers/PaperService';

interface TopicTrackingFiles {
  subscriptionFile: string;
  historyFile: string;
  taskFile: string;
  reportDirectory: string;
}

interface TopicTrackingServiceOptions {
  schedulerIntervalMs?: number;
}

interface TopicTrackingRuntimeData {
  subscription: TopicSubscription;
  subscriptions: TopicSubscription[];
  trigger: TopicRunTrigger;
  searchResults: PaperSearchResult[];
  importedPaperIds: string[];
  selectedPapers: PaperRecord[];
  paperAnalyses: Array<PaperAnalysisRecord | null>;
  report: TopicAnalysisReport | null;
  nextSubscription: TopicSubscription | null;
}

/**
 * @class TopicTrackingService
 * @description 管理主题订阅、多论文聚合分析、每日定时抓取与执行历史记录。
 * @param {WorkspaceDirectories} directories 工作区目录集合
 * @returns {TopicTrackingService} 主题追踪服务实例
 */
export class TopicTrackingService {
  private readonly files: TopicTrackingFiles;

  private readonly schedulerIntervalMs: number;

  private schedulerTimer: NodeJS.Timeout | null = null;

  private nextCheckAt: string | null = null;

  public constructor(
    directories: WorkspaceDirectories,
    private readonly paperService: PaperService,
    private readonly paperAnalysisService: PaperAnalysisService,
    private readonly agentRuntimeService: AgentRuntimeService,
    options: TopicTrackingServiceOptions = {},
  ) {
    this.files = {
      subscriptionFile: path.join(directories.metadata, 'topic-subscriptions.json'),
      historyFile: path.join(directories.tasks, 'topic-history.json'),
      taskFile: path.join(directories.tasks, 'agent-tasks.json'),
      reportDirectory: path.join(directories.analyses, 'topic-reports'),
    };
    this.schedulerIntervalMs = Math.max(30_000, options.schedulerIntervalMs ?? 60_000);
  }

  /**
   * @function startScheduler
   * @description 启动主题定时轮询器，并在应用启动后立即检查一次到期任务。
   * @param {void} 无需参数
   * @returns {void} 无返回值
   */
  public startScheduler(): void {
    if (this.schedulerTimer) {
      return;
    }

    this.updateNextCheckAt();
    this.schedulerTimer = setInterval(() => {
      // 关键逻辑：使用固定轮询替代复杂 cron 依赖，保证桌面端在运行期间可自动补跑当日任务。
      void this.runTopicScheduler(false);
    }, this.schedulerIntervalMs);

    void this.runTopicScheduler(false);
  }

  /**
   * @function stopScheduler
   * @description 停止主题定时轮询器，避免应用退出时残留后台定时器。
   * @param {void} 无需参数
   * @returns {void} 无返回值
   */
  public stopScheduler(): void {
    if (!this.schedulerTimer) {
      return;
    }

    clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    this.nextCheckAt = null;
  }

  /**
   * @function getSnapshot
   * @description 读取主题订阅、最新报告、执行历史与任务列表，供渲染层统一展示。
   * @param {void} 无需参数
   * @returns {Promise<TopicTrackingSnapshot>} 主题追踪全量快照
   */
  public async getSnapshot(): Promise<TopicTrackingSnapshot> {
    await this.ensureStorage();
    const [subscriptions, history, tasks] = await Promise.all([
      this.readSubscriptions(),
      this.readHistory(),
      this.listTasks(),
    ]);
    const reports = (
      await Promise.all(
        subscriptions.map(async (subscription) => {
          if (!subscription.latestReportPath) {
            return null;
          }

          return this.readReportByPath(subscription.latestReportPath);
        }),
      )
    ).filter((report): report is TopicAnalysisReport => Boolean(report));

    return {
      subscriptions,
      reports: reports.sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
      history,
      tasks,
      summary: {
        totalSubscriptions: subscriptions.length,
        enabledSubscriptions: subscriptions.filter((subscription) => subscription.enabled).length,
        reportsAvailable: reports.length,
        historyCount: history.length,
      },
      scheduler: {
        isRunning: Boolean(this.schedulerTimer),
        intervalMs: this.schedulerIntervalMs,
        nextCheckAt: this.nextCheckAt,
      },
    };
  }

  /**
   * @function listTasks
   * @description 返回主题追踪 Agent 对应的任务记录，供工作台展示执行状态。
   * @param {void} 无需参数
   * @returns {Promise<AgentTaskRecord[]>} 主题任务列表
   */
  public async listTasks(): Promise<AgentTaskRecord[]> {
    await this.ensureStorage();
    const content = await readFile(this.files.taskFile, 'utf-8');
    const tasks = (JSON.parse(content) as Array<AgentTaskRecord & { workflowKey?: string }>).map((task) =>
      this.normalizeTaskRecord(task),
    );

    return tasks
      .filter((task) => task.agentKey === 'topic-tracking')
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }

  /**
   * @function saveSubscription
   * @description 创建或更新主题订阅配置，包括检索查询、每日执行时间和启用状态。
   * @param {TopicSubscriptionInput} input 主题订阅输入
   * @returns {Promise<TopicTrackingSnapshot>} 更新后的主题追踪快照
   */
  public async saveSubscription(input: TopicSubscriptionInput): Promise<TopicTrackingSnapshot> {
    await this.ensureStorage();
    const subscriptions = await this.readSubscriptions();
    const existing = input.id ? subscriptions.find((subscription) => subscription.id === input.id) ?? null : null;
    const now = new Date().toISOString();
    const name = input.name.trim();
    const query = input.query.trim();

    if (!name) {
      throw new Error('主题名称不能为空');
    }

    if (!query) {
      throw new Error('主题检索词不能为空');
    }

    const nextSubscription: TopicSubscription = {
      id: existing?.id ?? `topic-${this.createSafeId(name)}-${Date.now()}`,
      name,
      query,
      description: input.description?.trim() ?? existing?.description ?? '',
      scheduleTime: this.normalizeScheduleTime(input.scheduleTime ?? existing?.scheduleTime ?? '09:00'),
      enabled: input.enabled ?? existing?.enabled ?? true,
      maxResultsPerRun: this.normalizeMaxResults(input.maxResultsPerRun ?? existing?.maxResultsPerRun ?? 5),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt ?? null,
      lastResultSummary: existing?.lastResultSummary ?? '尚未执行主题聚合分析。',
      latestReportPath: existing?.latestReportPath ?? null,
      paperIds: existing?.paperIds ?? [],
    };

    const nextSubscriptions = subscriptions.filter((subscription) => subscription.id !== nextSubscription.id);
    nextSubscriptions.push(nextSubscription);
    await this.writeSubscriptions(nextSubscriptions);
    return this.getSnapshot();
  }

  /**
   * @function deleteSubscription
   * @description 删除指定主题订阅，并清理其最近一次聚合报告文件。
   * @param {string} topicId 主题订阅标识
   * @returns {Promise<TopicTrackingSnapshot>} 删除后的主题追踪快照
   */
  public async deleteSubscription(topicId: string): Promise<TopicTrackingSnapshot> {
    await this.ensureStorage();
    const subscriptions = await this.readSubscriptions();
    const target = subscriptions.find((subscription) => subscription.id === topicId);

    if (!target) {
      return this.getSnapshot();
    }

    const nextSubscriptions = subscriptions.filter((subscription) => subscription.id !== topicId);
    await this.writeSubscriptions(nextSubscriptions);

    if (target.latestReportPath) {
      await rm(target.latestReportPath, { force: true });
    }

    return this.getSnapshot();
  }

  /**
   * @function runTopicAnalysis
   * @description 对指定主题执行一次抓取、聚合分析和报告落盘，并记录执行历史。
   * @param {string} topicId 主题订阅标识
   * @param {TopicRunTrigger} trigger 触发来源
   * @returns {Promise<TopicRunResult>} 主题执行结果
   */
  public async runTopicAnalysis(topicId: string, trigger: TopicRunTrigger = 'manual'): Promise<TopicRunResult> {
    await this.ensureStorage();
    const subscriptions = await this.readSubscriptions();
    const subscription = subscriptions.find((item) => item.id === topicId);

    if (!subscription) {
      throw new Error('未找到对应主题订阅');
    }

    let history = this.createHistory(
      subscription,
      trigger,
      'queued',
      new Date().toISOString(),
      '已创建主题任务，等待抓取最新论文。',
    );

    const result = await this.agentRuntimeService.runPipeline<TopicTrackingRuntimeData>({
      agentKey: 'topic-tracking',
      title: `主题追踪：${subscription.name}`,
      initialStage: '等待抓取',
      initialMessage: `已为主题“${subscription.name}”创建执行任务。`,
      completionStage: '主题报告完成',
      completionSummary: (data) =>
        data.nextSubscription?.lastResultSummary
        ?? `本次聚合 ${data.selectedPapers.length} 篇论文，新增 ${data.importedPaperIds.length} 篇，并已生成主题报告。`,
      initialData: {
        subscription,
        subscriptions,
        trigger,
        searchResults: [],
        importedPaperIds: [],
        selectedPapers: [],
        paperAnalyses: [],
        report: null,
        nextSubscription: null,
      },
      onTaskChange: async (task, data) => {
        if (task.status === 'queued') {
          history = this.createHistory(subscription, trigger, 'queued', task.createdAt, '已创建主题任务，等待抓取最新论文。');
        } else if (task.status === 'running') {
          history = this.updateHistory(
            history,
            'running',
            task.summary ?? history.summary,
            data.importedPaperIds.length,
            data.report?.id ?? history.reportId,
          );
        } else if (task.status === 'completed') {
          history = this.updateHistory(
            history,
            'completed',
            task.summary ?? history.summary,
            data.importedPaperIds.length,
            data.report?.id ?? history.reportId,
          );
        } else if (task.status === 'failed') {
          history = this.updateHistory(history, 'failed', task.summary ?? history.summary, data.importedPaperIds.length);
        }

        await Promise.all([this.upsertTask(task), this.upsertHistory(history)]);
      },
      stages: [
        {
          stage: '检索最新论文',
          run: async (context) => {
            const searchResults = await this.paperService.search({
              query: context.data.subscription.query,
              source: 'all',
              limit: context.data.subscription.maxResultsPerRun,
            });

            return {
              data: {
                ...context.data,
                searchResults,
              },
              message: `围绕主题“${context.data.subscription.query}”检索到 ${searchResults.length} 篇候选论文。`,
              summary: '正在检索最新论文并比对本地论文库。',
            };
          },
        },
        {
          stage: '同步主题论文库',
          run: async (context) => {
            const libraryBefore = await this.paperService.getLibrary();
            const existingPaperIds = new Set(libraryBefore.papers.map((paper) => paper.id));
            const importedPaperIds: string[] = [];

            for (const searchResult of context.data.searchResults) {
              if (existingPaperIds.has(searchResult.id)) {
                continue;
              }

              await this.paperService.importPaper(searchResult);
              importedPaperIds.push(searchResult.id);
              existingPaperIds.add(searchResult.id);
            }

            return {
              data: {
                ...context.data,
                importedPaperIds,
              },
              message: `已导入 ${importedPaperIds.length} 篇新论文，并完成本地论文库去重。`,
              summary: `已导入 ${importedPaperIds.length} 篇新论文，正在生成聚合报告。`,
            };
          },
        },
        {
          stage: '聚合多篇论文',
          run: async (context) => {
            const library = await this.paperService.getLibrary();
            const selectedPapers = this.selectTopicPapers(context.data.subscription, library.papers, context.data.searchResults);

            if (!selectedPapers.length) {
              throw new Error('未找到可用于聚合分析的主题论文，请调整检索词后重试');
            }

            const paperAnalyses = await Promise.all(
              selectedPapers.map(async (paper) => this.paperAnalysisService.getAnalysis(paper.id)),
            );
            const report = await this.saveReport(
              await this.buildTopicReport(
                context.data.subscription,
                selectedPapers,
                context.data.importedPaperIds,
                context.data.trigger,
                paperAnalyses,
              ),
            );
            const summary = `本次聚合 ${selectedPapers.length} 篇论文，新增 ${context.data.importedPaperIds.length} 篇，并已生成主题报告。`;
            const nextSubscription: TopicSubscription = {
              ...context.data.subscription,
              updatedAt: new Date().toISOString(),
              lastRunAt: new Date().toISOString(),
              lastResultSummary: summary,
              latestReportPath: report.filePath,
              paperIds: Array.from(new Set([...context.data.subscription.paperIds, ...selectedPapers.map((paper) => paper.id)])),
            };

            await this.writeSubscriptions(
              context.data.subscriptions.map((item) => (item.id === nextSubscription.id ? nextSubscription : item)),
            );

            return {
              data: {
                ...context.data,
                selectedPapers,
                paperAnalyses,
                report,
                nextSubscription,
              },
              message: `已汇总 ${selectedPapers.length} 篇主题论文，并组织方法脉络、研究难点和趋势变化。`,
              summary,
            };
          },
        },
        {
          stage: '主题报告完成',
          run: async (context) => {
            if (!context.data.report) {
              throw new Error('主题报告生成失败');
            }

            return {
              data: context.data,
              message: `主题报告已落盘到 ${context.data.report.filePath}。`,
            };
          },
        },
      ],
    });

    if (!result.data.report || !result.data.nextSubscription) {
      throw new Error('主题追踪结果不完整');
    }

    return {
      subscription: result.data.nextSubscription,
      report: result.data.report,
      history,
      task: result.task,
      timeline: result.timeline,
    };
  }

  /**
   * @function runTopicScheduler
   * @description 运行一次定时检查，可只执行到期主题，也可强制执行所有启用主题。
   * @param {boolean} forceRun 是否忽略时间判断并立即执行全部启用主题
   * @returns {Promise<TopicTrackingSnapshot>} 执行后的主题追踪快照
   */
  public async runTopicScheduler(forceRun = false): Promise<TopicTrackingSnapshot> {
    await this.ensureStorage();
    const subscriptions = await this.readSubscriptions();
    const now = new Date();
    const runnableSubscriptions = subscriptions.filter(
      (subscription) => subscription.enabled && (forceRun || this.shouldRunToday(subscription, now)),
    );

    for (const subscription of runnableSubscriptions) {
      try {
        await this.runTopicAnalysis(subscription.id, 'scheduled');
      } catch {
        // 关键逻辑：调度任务逐个容错执行，单个主题失败不会阻塞其他订阅的当日抓取。
      }
    }

    this.updateNextCheckAt();
    return this.getSnapshot();
  }

  /**
   * @function ensureStorage
   * @description 初始化主题订阅、执行历史、任务文件与报告目录。
   * @param {void} 无需参数
   * @returns {Promise<void>} 初始化结果
   */
  private async ensureStorage(): Promise<void> {
    await mkdir(this.files.reportDirectory, { recursive: true });
    await Promise.all([
      this.ensureJsonFile(this.files.subscriptionFile, []),
      this.ensureJsonFile(this.files.historyFile, []),
      this.ensureJsonFile(this.files.taskFile, []),
    ]);
  }

  /**
   * @function ensureJsonFile
   * @description 确保指定 JSON 文件存在，不存在时写入默认结构。
   * @param {string} filePath 文件路径
   * @param {T} fallback 默认内容
   * @returns {Promise<void>} 初始化结果
   */
  private async ensureJsonFile<T>(filePath: string, fallback: T): Promise<void> {
    try {
      await readFile(filePath, 'utf-8');
    } catch {
      await writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf-8');
    }
  }

  /**
   * @function readSubscriptions
   * @description 读取并按更新时间倒序返回主题订阅列表。
   * @param {void} 无需参数
   * @returns {Promise<TopicSubscription[]>} 主题订阅列表
   */
  private async readSubscriptions(): Promise<TopicSubscription[]> {
    const content = await readFile(this.files.subscriptionFile, 'utf-8');
    const subscriptions = JSON.parse(content) as TopicSubscription[];

    return subscriptions.sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  }

  /**
   * @function writeSubscriptions
   * @description 覆盖写入主题订阅列表，持久化最新配置。
   * @param {TopicSubscription[]} subscriptions 主题订阅列表
   * @returns {Promise<void>} 写入结果
   */
  private async writeSubscriptions(subscriptions: TopicSubscription[]): Promise<void> {
    await writeFile(this.files.subscriptionFile, JSON.stringify(subscriptions, null, 2), 'utf-8');
  }

  /**
   * @function readHistory
   * @description 读取主题执行历史，并按开始时间倒序返回。
   * @param {void} 无需参数
   * @returns {Promise<TopicExecutionHistory[]>} 历史记录列表
   */
  private async readHistory(): Promise<TopicExecutionHistory[]> {
    const content = await readFile(this.files.historyFile, 'utf-8');
    const history = JSON.parse(content) as TopicExecutionHistory[];

    return history.sort(
      (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
    );
  }

  /**
   * @function upsertHistory
   * @description 将单次主题执行结果写回历史文件，保留最近的执行状态和摘要。
   * @param {TopicExecutionHistory} entry 历史记录
   * @returns {Promise<void>} 写入结果
   */
  private async upsertHistory(entry: TopicExecutionHistory): Promise<void> {
    const history = await this.readHistory();
    const nextHistory = history.filter((item) => item.id !== entry.id);
    nextHistory.push(entry);
    await writeFile(this.files.historyFile, JSON.stringify(nextHistory, null, 2), 'utf-8');
  }

  /**
   * @function upsertTask
   * @description 将主题任务状态写回统一任务文件，便于 AI 工作台展示。
   * @param {AgentTaskRecord} task 任务记录
   * @returns {Promise<void>} 写入结果
   */
  private async upsertTask(task: AgentTaskRecord): Promise<void> {
    const content = await readFile(this.files.taskFile, 'utf-8');
    const tasks = (JSON.parse(content) as Array<AgentTaskRecord & { workflowKey?: string }>).map((item) =>
      this.normalizeTaskRecord(item),
    );
    const nextTasks = tasks.filter((item) => item.id !== task.id);
    nextTasks.push(task);
    await writeFile(this.files.taskFile, JSON.stringify(nextTasks, null, 2), 'utf-8');
  }

  /**
   * @function normalizeTaskRecord
   * @description 将历史任务字段归一化为当前 agent 任务结构。
   * @param {AgentTaskRecord & { workflowKey?: string }} task 原始任务记录
   * @returns {AgentTaskRecord} 归一化后的任务记录
   */
  private normalizeTaskRecord(task: AgentTaskRecord & { workflowKey?: string }): AgentTaskRecord {
    return {
      ...task,
      agentKey: task.agentKey ?? task.workflowKey ?? 'topic-tracking',
      runtime: 'langchain',
    };
  }

  /**
   * @function saveReport
   * @description 将主题聚合报告写入文件系统，供后续持续查看和覆盖更新。
   * @param {TopicAnalysisReport} report 主题聚合报告
   * @returns {Promise<TopicAnalysisReport>} 已保存报告
   */
  private async saveReport(report: TopicAnalysisReport): Promise<TopicAnalysisReport> {
    await writeFile(report.filePath, JSON.stringify(report, null, 2), 'utf-8');
    return report;
  }

  /**
   * @function readReportByPath
   * @description 根据报告路径读取历史主题报告，文件损坏时返回空值。
   * @param {string} filePath 报告文件路径
   * @returns {Promise<TopicAnalysisReport | null>} 主题报告或空值
   */
  private async readReportByPath(filePath: string): Promise<TopicAnalysisReport | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as TopicAnalysisReport;
    } catch {
      return null;
    }
  }

  /**
   * @function buildTopicReport
   * @description 汇总多篇论文和已有单篇分析记录，生成主题级报告与每日摘要。
   * @param {TopicSubscription} subscription 主题订阅
   * @param {PaperRecord[]} papers 纳入分析的论文列表
   * @param {string[]} newPaperIds 本次新增论文标识
   * @param {TopicRunTrigger} trigger 触发来源
   * @param {(PaperAnalysisRecord | null)[]} paperAnalyses 单篇分析结果列表
   * @returns {Promise<TopicAnalysisReport>} 主题报告对象
   */
  private async buildTopicReport(
    subscription: TopicSubscription,
    papers: PaperRecord[],
    newPaperIds: string[],
    trigger: TopicRunTrigger,
    paperAnalyses: Array<PaperAnalysisRecord | null>,
  ): Promise<TopicAnalysisReport> {
    const sortedPapers = [...papers].sort(
      (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
    );
    const keywordList = this.extractKeywords(
      sortedPapers.map((paper) => `${paper.title} ${paper.abstract} ${paper.tags.join(' ')}`).join(' '),
    );
    const highlights = this.buildHighlights(sortedPapers, newPaperIds, paperAnalyses, keywordList);
    const overview = `围绕“${subscription.name}”共汇总 ${sortedPapers.length} 篇论文，其中新增 ${newPaperIds.length} 篇。高频关注点包括 ${keywordList.slice(0, 4).join('、') || '主题关键词'}。`;
    const reportId = `topic-report-${subscription.id}-${Date.now()}`;
    const reportPath = path.join(this.files.reportDirectory, `${reportId}.json`);

    return {
      id: reportId,
      topicId: subscription.id,
      topicName: subscription.name,
      query: subscription.query,
      trigger,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filePath: reportPath,
      overview,
      highlights,
      includedPaperIds: sortedPapers.map((paper) => paper.id),
      newPaperIds,
      papers: this.buildPaperDigests(sortedPapers, paperAnalyses),
      sections: [
        this.createSection(
          '主题综述',
          overview,
          [
            `主题查询词为“${subscription.query}”，本次纳入 ${sortedPapers.length} 篇代表论文。`,
            sortedPapers[0]
              ? `最新论文为《${sortedPapers[0].title}》，发布时间 ${this.formatDateOnly(sortedPapers[0].publishedAt)}。`
              : '当前尚未获得足够论文，建议放宽检索词并重新抓取。',
            subscription.lastRunAt
              ? `距离上次执行时间 ${this.formatDateOnly(subscription.lastRunAt)} 已完成一次增量更新。`
              : '这是该主题的首次聚合分析。',
          ],
          sortedPapers.map((paper) => this.formatPaperLabel(paper)),
        ),
        this.createSection(
          '方法脉络',
          `高频关键词显示该主题近期围绕 ${keywordList.slice(0, 3).join('、') || '核心方法'} 持续演进。`,
          keywordList.slice(0, 5).map((keyword, index) => `方法线索 ${index + 1}：${keyword}`),
          sortedPapers.slice(0, 5).map((paper) => this.formatPaperLabel(paper)),
        ),
        this.createSection(
          '共性难点',
          this.pickChallengeSummary(sortedPapers, paperAnalyses),
          this.pickChallengeBullets(sortedPapers, paperAnalyses),
          sortedPapers.slice(0, 5).map((paper) => this.formatPaperLabel(paper)),
        ),
        this.createSection(
          '近期趋势',
          `最近新增 ${newPaperIds.length} 篇论文，趋势判断优先关注近两年的研究增量。`,
          this.buildTrendBullets(sortedPapers, newPaperIds),
          sortedPapers.slice(0, 5).map((paper) => `${this.formatPaperLabel(paper)} · ${paper.sourceLabel}`),
        ),
        this.createSection(
          '推荐阅读',
          '推荐优先阅读最新代表作、已完成单篇分析的论文，以及与你现有标签最接近的论文。',
          this.buildRecommendationBullets(sortedPapers, paperAnalyses),
          this.buildRecommendationIds(sortedPapers, paperAnalyses).map((paperId) => paperId),
        ),
      ],
      recommendedPaperIds: this.buildRecommendationIds(sortedPapers, paperAnalyses),
    };
  }

  /**
   * @function buildPaperDigests
   * @description 为主题报告生成论文摘要卡片，优先复用已保存的单篇分析摘要。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {(PaperAnalysisRecord | null)[]} analyses 单篇分析结果列表
   * @returns {TopicPaperDigest[]} 论文摘要卡片列表
   */
  private buildPaperDigests(
    papers: PaperRecord[],
    analyses: Array<PaperAnalysisRecord | null>,
  ): TopicPaperDigest[] {
    return papers.map((paper, index) => {
      const analysis = analyses[index];
      const summary = analysis?.sections[0]?.summary ?? this.truncateText(paper.abstract || '暂无摘要', 180);

      return {
        paperId: paper.id,
        title: paper.title,
        sourceLabel: paper.sourceLabel,
        publishedAt: paper.publishedAt,
        summary,
        authors: paper.authors,
      };
    });
  }

  /**
   * @function buildHighlights
   * @description 从论文时间分布、增量和单篇分析结果中提取主题高亮要点。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {string[]} newPaperIds 本次新增论文标识
   * @param {(PaperAnalysisRecord | null)[]} analyses 单篇分析结果列表
   * @param {string[]} keywordList 高频关键词列表
   * @returns {string[]} 高亮摘要列表
   */
  private buildHighlights(
    papers: PaperRecord[],
    newPaperIds: string[],
    analyses: Array<PaperAnalysisRecord | null>,
    keywordList: string[],
  ): string[] {
    const verifiedAnalyses = analyses.filter((analysis) => Boolean(analysis)).length;
    const latestPaper = papers[0];

    return [
      latestPaper ? `最新论文：${latestPaper.title}` : '最新论文：暂无',
      `本次新增论文：${newPaperIds.length} 篇`,
      `已具备单篇分析支撑：${verifiedAnalyses} 篇`,
      `高频主题词：${keywordList.slice(0, 3).join('、') || '待补充'}`,
    ];
  }

  /**
   * @function pickChallengeSummary
   * @description 汇总多篇论文中关于挑战和限制的共性描述。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {(PaperAnalysisRecord | null)[]} analyses 单篇分析结果列表
   * @returns {string} 难点摘要
   */
  private pickChallengeSummary(
    papers: PaperRecord[],
    analyses: Array<PaperAnalysisRecord | null>,
  ): string {
    const challengeFromAnalysis = analyses
      .flatMap((analysis) => analysis?.sections.filter((section) => section.key === 'challenges') ?? [])
      .map((section) => section.summary)
      .filter(Boolean)[0];

    if (challengeFromAnalysis) {
      return challengeFromAnalysis;
    }

    const sentence = this.pickAbstractSentence(
      papers,
      ['challenge', 'difficult', 'robust', 'efficient', 'limit', 'complex', 'cost'],
    );
    return sentence ?? '当前多篇论文的共性难点主要集中在泛化能力、计算效率与数据质量约束。';
  }

  /**
   * @function pickChallengeBullets
   * @description 生成主题层面的难点条目，优先使用单篇分析结论补强可读性。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {(PaperAnalysisRecord | null)[]} analyses 单篇分析结果列表
   * @returns {string[]} 难点要点列表
   */
  private pickChallengeBullets(
    papers: PaperRecord[],
    analyses: Array<PaperAnalysisRecord | null>,
  ): string[] {
    const bullets = analyses
      .flatMap((analysis) => analysis?.sections.filter((section) => section.key === 'challenges') ?? [])
      .flatMap((section) => section.bullets)
      .slice(0, 3);

    if (bullets.length) {
      return bullets;
    }

    const fallback = papers
      .map((paper) => this.pickAbstractSentence([paper], ['challenge', 'efficient', 'robust', 'cost']) ?? '')
      .filter(Boolean)
      .slice(0, 3);

    return fallback.length
      ? fallback
      : ['研究难点主要围绕效率、鲁棒性和跨场景泛化能力展开。'];
  }

  /**
   * @function buildTrendBullets
   * @description 结合时间与增量信息描述主题的近期研究趋势。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {string[]} newPaperIds 本次新增论文标识
   * @returns {string[]} 趋势要点列表
   */
  private buildTrendBullets(papers: PaperRecord[], newPaperIds: string[]): string[] {
    const newestPapers = papers.slice(0, 3);
    const newPaperSet = new Set(newPaperIds);
    const bullets = newestPapers.map((paper) => {
      const prefix = newPaperSet.has(paper.id) ? '新增关注' : '持续关注';
      return `${prefix}：${paper.title}（${this.formatDateOnly(paper.publishedAt)}）`;
    });

    if (!bullets.length) {
      return ['当前尚未形成稳定趋势，建议继续积累该主题的代表论文。'];
    }

    if (!newPaperIds.length) {
      bullets.push('今日没有新增论文，趋势判断延续最近一次报告结论。');
    }

    return bullets;
  }

  /**
   * @function buildRecommendationBullets
   * @description 生成推荐阅读条目，优先选择已分析和最新论文。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {(PaperAnalysisRecord | null)[]} analyses 单篇分析结果列表
   * @returns {string[]} 推荐阅读要点列表
   */
  private buildRecommendationBullets(
    papers: PaperRecord[],
    analyses: Array<PaperAnalysisRecord | null>,
  ): string[] {
    return this.buildRecommendationIds(papers, analyses)
      .map((paperId) => papers.find((paper) => paper.id === paperId))
      .filter((paper): paper is PaperRecord => Boolean(paper))
      .map((paper) => `优先阅读《${paper.title}》：${this.truncateText(paper.abstract || '暂无摘要', 120)}`);
  }

  /**
   * @function buildRecommendationIds
   * @description 根据新近性、收藏状态和单篇分析可用性挑选推荐阅读论文。
   * @param {PaperRecord[]} papers 主题论文列表
   * @param {(PaperAnalysisRecord | null)[]} analyses 单篇分析结果列表
   * @returns {string[]} 推荐论文标识列表
   */
  private buildRecommendationIds(
    papers: PaperRecord[],
    analyses: Array<PaperAnalysisRecord | null>,
  ): string[] {
    const analyzedPaperIds = new Set(
      analyses
        .filter((analysis): analysis is PaperAnalysisRecord => Boolean(analysis))
        .map((analysis) => analysis.paperId),
    );

    return papers
      .map((paper) => ({
        paper,
        score:
          (paper.isFavorite ? 4 : 0) +
          (analyzedPaperIds.has(paper.id) ? 3 : 0) +
          Math.max(0, 2 - Math.floor((Date.now() - new Date(paper.publishedAt).getTime()) / 31_536_000_000)),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.paper.id);
  }

  /**
   * @function createSection
   * @description 构建主题报告中的标准章节结构。
   * @param {string} title 章节标题
   * @param {string} summary 章节摘要
   * @param {string[]} bullets 章节要点
   * @param {string[]} evidence 章节证据
   * @returns {TopicAnalysisSection} 主题章节对象
   */
  private createSection(
    title: string,
    summary: string,
    bullets: string[],
    evidence: string[],
  ): TopicAnalysisSection {
    return {
      title,
      summary,
      bullets: bullets.length ? bullets : ['当前章节暂未积累足够证据，建议继续抓取主题论文。'],
      evidence: evidence.length ? evidence : ['暂无外部证据'],
    };
  }

  /**
   * @function selectTopicPapers
   * @description 按主题命中度、已追踪论文和检索结果合并选择聚合分析样本。
   * @param {TopicSubscription} subscription 主题订阅
   * @param {PaperRecord[]} libraryPapers 论文库记录
   * @param {PaperSearchResult[]} searchResults 检索结果
   * @returns {PaperRecord[]} 主题代表论文列表
   */
  private selectTopicPapers(
    subscription: TopicSubscription,
    libraryPapers: PaperRecord[],
    searchResults: PaperSearchResult[],
  ): PaperRecord[] {
    const trackedIds = new Set(subscription.paperIds);
    const searchResultIds = new Set(searchResults.map((result) => result.id));
    const queryTokens = this.extractKeywords(`${subscription.name} ${subscription.query}`);

    return libraryPapers
      .map((paper) => ({
        paper,
        score: this.computeTopicMatchScore(paper, queryTokens, trackedIds, searchResultIds),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return new Date(right.paper.publishedAt).getTime() - new Date(left.paper.publishedAt).getTime();
      })
      .slice(0, 6)
      .map((item) => item.paper);
  }

  /**
   * @function computeTopicMatchScore
   * @description 计算论文与主题的匹配分数，用于筛选聚合分析样本。
   * @param {PaperRecord} paper 论文记录
   * @param {string[]} queryTokens 主题关键词
   * @param {Set<string>} trackedIds 已追踪论文集合
   * @param {Set<string>} searchResultIds 本次搜索结果集合
   * @returns {number} 匹配分数
   */
  private computeTopicMatchScore(
    paper: PaperRecord,
    queryTokens: string[],
    trackedIds: Set<string>,
    searchResultIds: Set<string>,
  ): number {
    const corpus = `${paper.title} ${paper.abstract} ${paper.tags.join(' ')}`.toLowerCase();
    const keywordScore = queryTokens.reduce((score, token) => (corpus.includes(token) ? score + 2 : score), 0);
    const trackedScore = trackedIds.has(paper.id) ? 3 : 0;
    const searchScore = searchResultIds.has(paper.id) ? 4 : 0;
    const favoriteScore = paper.isFavorite ? 1 : 0;

    return keywordScore + trackedScore + searchScore + favoriteScore;
  }

  /**
   * @function shouldRunToday
   * @description 判断主题订阅是否在当前时间点满足当日执行条件。
   * @param {TopicSubscription} subscription 主题订阅
   * @param {Date} currentDate 当前时间
   * @returns {boolean} 是否应当执行
   */
  private shouldRunToday(subscription: TopicSubscription, currentDate: Date): boolean {
    const [hour, minute] = this.normalizeScheduleTime(subscription.scheduleTime).split(':').map(Number);
    const scheduledAt = new Date(currentDate);
    scheduledAt.setHours(hour, minute, 0, 0);

    if (currentDate < scheduledAt) {
      return false;
    }

    if (!subscription.lastRunAt) {
      return true;
    }

    return this.formatDateOnly(subscription.lastRunAt) !== this.formatDateOnly(currentDate.toISOString());
  }

  /**
   * @function createHistory
   * @description 创建主题执行历史记录的初始状态。
   * @param {TopicSubscription} subscription 主题订阅
   * @param {TopicRunTrigger} trigger 触发来源
   * @param {'queued' | 'running' | 'completed' | 'failed'} status 执行状态
   * @param {string} timestamp 起始时间
   * @param {string} summary 摘要说明
   * @returns {TopicExecutionHistory} 历史记录
   */
  private createHistory(
    subscription: TopicSubscription,
    trigger: TopicRunTrigger,
    status: 'queued' | 'running' | 'completed' | 'failed',
    timestamp: string,
    summary: string,
  ): TopicExecutionHistory {
    return {
      id: `topic-history-${Date.now()}`,
      topicId: subscription.id,
      topicName: subscription.name,
      trigger,
      status,
      startedAt: timestamp,
      finishedAt: null,
      summary,
      newPaperCount: 0,
      reportId: null,
    };
  }

  /**
   * @function updateHistory
   * @description 更新执行历史的状态、摘要和新增论文数量。
   * @param {TopicExecutionHistory} history 原始历史记录
   * @param {'queued' | 'running' | 'completed' | 'failed'} status 新状态
   * @param {string} summary 摘要说明
   * @param {number} newPaperCount 新增论文数量
   * @param {string | null} reportId 关联报告标识
   * @returns {TopicExecutionHistory} 更新后的历史记录
   */
  private updateHistory(
    history: TopicExecutionHistory,
    status: 'queued' | 'running' | 'completed' | 'failed',
    summary: string,
    newPaperCount = history.newPaperCount,
    reportId: string | null = history.reportId,
  ): TopicExecutionHistory {
    return {
      ...history,
      status,
      summary,
      newPaperCount,
      reportId,
      finishedAt: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
    };
  }

  /**
   * @function updateNextCheckAt
   * @description 记录下一次调度检查时间，便于界面展示调度器状态。
   * @param {void} 无需参数
   * @returns {void} 无返回值
   */
  private updateNextCheckAt(): void {
    this.nextCheckAt = new Date(Date.now() + this.schedulerIntervalMs).toISOString();
  }

  /**
   * @function pickAbstractSentence
   * @description 从多篇论文摘要中挑选包含目标关键词的句子。
   * @param {PaperRecord[]} papers 论文列表
   * @param {string[]} keywords 关键词列表
   * @returns {string | null} 命中的摘要句或空值
   */
  private pickAbstractSentence(papers: PaperRecord[], keywords: string[]): string | null {
    for (const paper of papers) {
      const sentences = paper.abstract.split(/(?<=[.!?。！？])\s+/g).map((sentence) => sentence.trim());
      const matched = sentences.find((sentence) => keywords.some((keyword) => sentence.toLowerCase().includes(keyword)));

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  /**
   * @function extractKeywords
   * @description 从主题与论文文本中提取高频关键词，用于多论文聚合分析。
   * @param {string} value 输入文本
   * @returns {string[]} 去重后的关键词列表
   */
  private extractKeywords(value: string): string[] {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'that',
      'this',
      'into',
      'their',
      'using',
      'study',
      'paper',
      'method',
      'analysis',
      'system',
      'towards',
      'based',
    ]);

    return Array.from(
      new Set(
        value
          .toLowerCase()
          .split(/[^a-z0-9\u4e00-\u9fa5]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2 && !stopWords.has(token)),
      ),
    ).slice(0, 12);
  }

  /**
   * @function normalizeScheduleTime
   * @description 将用户输入的执行时间规范为 HH:mm 格式。
   * @param {string} value 原始时间字符串
   * @returns {string} 规范化后的时间
   */
  private normalizeScheduleTime(value: string): string {
    const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);

    if (!match) {
      return '09:00';
    }

    const hour = Math.min(23, Math.max(0, Number(match[1])));
    const minute = Math.min(59, Math.max(0, Number(match[2])));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  /**
   * @function normalizeMaxResults
   * @description 限制单次主题抓取的论文数量，避免过量网络请求。
   * @param {number} value 用户设置的结果数量
   * @returns {number} 规范化后的抓取上限
   */
  private normalizeMaxResults(value: number): number {
    return Math.min(8, Math.max(3, Math.trunc(value)));
  }

  /**
   * @function createSafeId
   * @description 将主题名称转成适合文件名和标识拼接的安全片段。
   * @param {string} value 原始主题名称
   * @returns {string} 安全标识片段
   */
  private createSafeId(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'topic';
  }

  /**
   * @function formatPaperLabel
   * @description 将论文标题和发布时间拼接成适合报告证据列表的标签。
   * @param {PaperRecord} paper 论文记录
   * @returns {string} 展示标签
   */
  private formatPaperLabel(paper: PaperRecord): string {
    return `${paper.title}（${this.formatDateOnly(paper.publishedAt)}）`;
  }

  /**
   * @function formatDateOnly
   * @description 将 ISO 时间转换为简洁日期字符串。
   * @param {string} value 时间字符串
   * @returns {string} 日期文本
   */
  private formatDateOnly(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toISOString().slice(0, 10);
  }

  /**
   * @function truncateText
   * @description 截断长文本，保证报告和界面展示长度可控。
   * @param {string} value 原始文本
   * @param {number} maxLength 最大长度
   * @returns {string} 截断后的文本
   */
  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength).trimEnd()}...`;
  }
}
