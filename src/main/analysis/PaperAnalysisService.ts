import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentTaskRecord,
  AnalysisConversationMessage,
  CodeExperimentStep,
  CodeExperimentVerification,
  InternetSearchHit,
  PaperAnalysisQuestionInput,
  PaperAnalysisQuestionReply,
  PaperAnalysisRecord,
  PaperAnalysisRunResult,
  PaperAnalysisSection,
  PaperAnalysisSectionKey,
  PaperRecord,
  ReaderSession,
  WorkspaceDirectories,
} from '@shared/types';

import { AgentRuntimeService } from '../agents/AgentRuntimeService';
import { PaperService } from '../papers/PaperService';
import { ReaderService } from '../reader/ReaderService';
import { InternetSearchService } from './InternetSearchService';

interface PaperAnalysisServiceOptions {
  fetchImpl?: typeof fetch;
}

interface PaperAnalysisFiles {
  indexFile: string;
  taskFile: string;
  reportDirectory: string;
}

type InternetResearchContext = Awaited<ReturnType<InternetSearchService['collectResearchContext']>>;

interface PaperAnalysisRuntimeData {
  paperId: string;
  paper: PaperRecord;
  generatedAt: string;
  readerSession: ReaderSession | null;
  internetContext: InternetResearchContext | null;
  sections: PaperAnalysisSection[];
  verification: CodeExperimentVerification | null;
  report: PaperAnalysisRecord | null;
}

/**
 * @class PaperAnalysisService
 * @description 负责单篇论文深度分析、联网增强、结构化落盘与追问能力。
 * @param {WorkspaceDirectories} directories 工作区目录集合
 * @returns {PaperAnalysisService} 论文分析服务实例
 */
export class PaperAnalysisService {
  private readonly files: PaperAnalysisFiles;

  private readonly internetSearchService: InternetSearchService;

  public constructor(
    directories: WorkspaceDirectories,
    private readonly paperService: PaperService,
    private readonly readerService: ReaderService,
    private readonly agentRuntimeService: AgentRuntimeService,
    options: PaperAnalysisServiceOptions = {},
  ) {
    this.files = {
      indexFile: path.join(directories.analyses, 'analysis-index.json'),
      taskFile: path.join(directories.tasks, 'agent-tasks.json'),
      reportDirectory: path.join(directories.analyses, 'reports'),
    };
    this.internetSearchService = new InternetSearchService({
      fetchImpl: options.fetchImpl,
    });
  }

  /**
   * @function listTasks
   * @description 读取已持久化的论文分析任务列表，用于 AI 工作台展示。
   * @param {void} 无需参数
   * @returns {Promise<AgentTaskRecord[]>} 任务记录列表
   */
  public async listTasks(): Promise<AgentTaskRecord[]> {
    await this.ensureStorage();
    return this.readTasks();
  }

  /**
   * @function getAnalysis
   * @description 读取指定论文的历史分析结果，不存在时返回空值。
   * @param {string} paperId 论文唯一标识
   * @returns {Promise<PaperAnalysisRecord | null>} 分析记录或空值
   */
  public async getAnalysis(paperId: string): Promise<PaperAnalysisRecord | null> {
    await this.ensureStorage();
    const index = await this.readAnalysisIndex();
    const filePath = index[paperId];

    if (!filePath) {
      return null;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as PaperAnalysisRecord;
    } catch {
      return null;
    }
  }

  /**
   * @function runAnalysis
   * @description 执行单篇论文的结构化分析流程，并输出联网增强与实验验证记录。
   * @param {string} paperId 论文唯一标识
   * @returns {Promise<PaperAnalysisRunResult>} 分析结果、任务状态和阶段时间线
   */
  public async runAnalysis(paperId: string): Promise<PaperAnalysisRunResult> {
    await this.ensureStorage();
    const paper = await this.paperService.getPaperById(paperId);

    if (!paper) {
      throw new Error('未找到对应论文，无法执行深度分析');
    }

    const result = await this.agentRuntimeService.runPipeline<PaperAnalysisRuntimeData>({
      agentKey: 'paper-analysis',
      title: `单篇分析：${paper.title}`,
      initialStage: '任务排队',
      initialMessage: '已创建单篇论文分析任务，等待装配论文上下文。',
      completionStage: '分析完成',
      completionSummary: (data) =>
        data.verification?.status === 'verified'
          ? '结构化分析与代码验证均已完成。'
          : '结构化分析已完成，代码验证已输出阻塞原因。',
      initialData: {
        paperId,
        paper,
        generatedAt: new Date().toISOString(),
        readerSession: null,
        internetContext: null,
        sections: [],
        verification: null,
        report: null,
      },
      onTaskChange: async (task) => {
        await this.upsertTask(task);

        if (task.status === 'queued') {
          await this.paperService.updatePaper(paperId, {
            analysisStatus: 'queued',
          });
          return;
        }

        if (task.status === 'running') {
          await this.paperService.updatePaper(paperId, {
            analysisStatus: 'running',
          });
          return;
        }

        if (task.status === 'completed') {
          await this.paperService.updatePaper(paperId, {
            analysisStatus: 'completed',
          });
          return;
        }

        if (task.status === 'failed') {
          await this.paperService.updatePaper(paperId, {
            analysisStatus: 'failed',
          });
        }
      },
      stages: [
        {
          stage: '整理阅读上下文',
          run: async (context) => {
            const readerSession = await this.readerService.getSession(paperId);

            return {
              data: {
                ...context.data,
                readerSession,
              },
              message: '已开始提取论文摘要、阅读批注与侧边笔记。',
              summary: '已进入执行态，准备汇总摘要、批注和笔记。',
            };
          },
        },
        {
          stage: '联网检索增强',
          run: async (context) => {
            const internetContext = await this.internetSearchService.collectResearchContext(context.data.paper);

            return {
              data: {
                ...context.data,
                internetContext,
              },
              message: `已补充 ${internetContext.hits.length} 条相关工作线索，并${internetContext.repository ? '' : '未'}识别到候选代码仓库。`,
              summary: '已整理阅读上下文，正在补充联网线索。',
            };
          },
        },
        {
          stage: '结构化输出完成',
          run: async (context) => {
            if (!context.data.readerSession || !context.data.internetContext) {
              throw new Error('分析上下文尚未准备完成');
            }

            const sections = this.buildSections(context.data.paper, context.data.readerSession, context.data.internetContext.hits);
            const verification = this.buildVerification(context.data.paper, context.data.internetContext.repository);
            const report = await this.saveReport({
              paperId,
              paperTitle: context.data.paper.title,
              generatedAt: context.data.generatedAt,
              updatedAt: new Date().toISOString(),
              searchQueries: context.data.internetContext.queries,
              readerContext: {
                noteExcerpt: this.truncateText(context.data.readerSession.note.trim(), 220),
                annotationQuotes: context.data.readerSession.annotations.slice(0, 3).map((annotation) => annotation.quote),
              },
              sections,
              internetHits: context.data.internetContext.hits,
              verification,
              conversation: [],
            });

            return {
              data: {
                ...context.data,
                sections,
                verification,
                report,
              },
              message: '动机、难点、现状、方法、实验和结果章节已写入本地分析档案。',
              summary: '已完成联网检索，正在组织章节分析与实验验证结论。',
            };
          },
        },
        {
          stage: '代码实验验证',
          run: async (context) => {
            if (!context.data.verification) {
              throw new Error('代码实验验证结果缺失');
            }

            return {
              data: context.data,
              message: context.data.verification.summary,
            };
          },
        },
      ],
    });

    if (!result.data.report) {
      throw new Error('分析报告生成失败');
    }

    return {
      report: result.data.report,
      task: result.task,
      timeline: result.timeline,
    };
  }

  /**
   * @function askQuestion
   * @description 基于已保存的分析档案回答追问，并将问答记录回写到分析文件。
   * @param {PaperAnalysisQuestionInput} input 追问输入
   * @returns {Promise<PaperAnalysisQuestionReply>} 追问回复与更新后的分析记录
   */
  public async askQuestion(input: PaperAnalysisQuestionInput): Promise<PaperAnalysisQuestionReply> {
    await this.ensureStorage();
    const report = await this.getAnalysis(input.paperId);

    if (!report) {
      throw new Error('当前论文尚未生成分析结果，请先执行深度分析');
    }

    const now = new Date().toISOString();
    const userMessage: AnalysisConversationMessage = {
      id: `analysis-user-${Date.now()}`,
      role: 'user',
      content: input.question.trim(),
      createdAt: now,
      references: [],
    };
    const reply = this.buildQuestionReply(report, input.question.trim());
    const assistantMessage: AnalysisConversationMessage = {
      id: `analysis-assistant-${Date.now()}`,
      role: 'assistant',
      content: reply.answer,
      createdAt: new Date().toISOString(),
      references: reply.references,
    };
    const nextReport: PaperAnalysisRecord = {
      ...report,
      updatedAt: new Date().toISOString(),
      conversation: [...report.conversation, userMessage, assistantMessage],
    };

    await this.writeReport(nextReport);

    return {
      answer: reply.answer,
      references: reply.references,
      report: nextReport,
    };
  }

  /**
   * @function ensureStorage
   * @description 确保分析目录、索引文件和任务文件已初始化。
   * @param {void} 无需参数
   * @returns {Promise<void>} 初始化结果
   */
  private async ensureStorage(): Promise<void> {
    await Promise.all([mkdir(this.files.reportDirectory, { recursive: true }), mkdir(path.dirname(this.files.taskFile), { recursive: true })]);

    await Promise.all([
      this.ensureJsonFile(this.files.indexFile, {}),
      this.ensureJsonFile(this.files.taskFile, []),
    ]);
  }

  /**
   * @function ensureJsonFile
   * @description 在 JSON 文件缺失时写入默认值，保证后续读取稳定。
   * @param {string} filePath 目标文件路径
   * @param {T} fallback 默认值
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
   * @function readAnalysisIndex
   * @description 读取论文分析索引，建立 paperId 到报告文件路径的映射。
   * @param {void} 无需参数
   * @returns {Promise<Record<string, string>>} 分析索引映射
   */
  private async readAnalysisIndex(): Promise<Record<string, string>> {
    const content = await readFile(this.files.indexFile, 'utf-8');
    return JSON.parse(content) as Record<string, string>;
  }

  /**
   * @function readTasks
   * @description 读取分析任务文件中的所有任务状态。
   * @param {void} 无需参数
   * @returns {Promise<AgentTaskRecord[]>} 任务列表
   */
  private async readTasks(): Promise<AgentTaskRecord[]> {
    const content = await readFile(this.files.taskFile, 'utf-8');
    const tasks = JSON.parse(content) as Array<AgentTaskRecord & { workflowKey?: string }>;

    return tasks.map((task) => this.normalizeTaskRecord(task)).sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  }

  /**
   * @function upsertTask
   * @description 将最新任务状态写回任务文件，支撑执行状态管理与工作台展示。
   * @param {AgentTaskRecord} task 任务记录
   * @returns {Promise<void>} 写入结果
   */
  private async upsertTask(task: AgentTaskRecord): Promise<void> {
    const tasks = await this.readTasks();
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
      agentKey: task.agentKey ?? task.workflowKey ?? 'paper-analysis',
      runtime: 'langchain',
    };
  }

  /**
   * @function saveReport
   * @description 将分析结果写入报告文件并更新索引。
   * @param {PaperAnalysisRecord} report 待保存的分析报告
   * @returns {Promise<PaperAnalysisRecord>} 已保存的分析报告
   */
  private async saveReport(report: PaperAnalysisRecord): Promise<PaperAnalysisRecord> {
    const index = await this.readAnalysisIndex();
    const filePath = index[report.paperId] ?? path.join(this.files.reportDirectory, `${this.createSafeId(report.paperId)}.json`);
    const nextIndex = {
      ...index,
      [report.paperId]: filePath,
    };

    await writeFile(this.files.indexFile, JSON.stringify(nextIndex, null, 2), 'utf-8');
    await writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
    return report;
  }

  /**
   * @function writeReport
   * @description 覆盖写入已有分析报告文件，用于保存追问对话历史。
   * @param {PaperAnalysisRecord} report 更新后的分析报告
   * @returns {Promise<void>} 写入结果
   */
  private async writeReport(report: PaperAnalysisRecord): Promise<void> {
    const index = await this.readAnalysisIndex();
    const filePath = index[report.paperId];

    if (!filePath) {
      await this.saveReport(report);
      return;
    }

    await writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
  }

  /**
   * @function buildSections
   * @description 根据论文摘要、阅读上下文和联网结果生成固定章节的结构化分析。
   * @param {PaperRecord} paper 论文记录
   * @param {ReaderSession} session 阅读会话
   * @param {InternetSearchHit[]} internetHits 联网检索结果
   * @returns {PaperAnalysisSection[]} 六大结构化章节
   */
  private buildSections(
    paper: PaperRecord,
    session: ReaderSession,
    internetHits: InternetSearchHit[],
  ): PaperAnalysisSection[] {
    const sentences = this.extractSentences(paper.abstract);
    const noteSnippet = this.truncateText(session.note.trim(), 180);

    return [
      this.createSection(
        'motivation',
        '研究动机',
        this.pickSentences(
          sentences,
          ['motivation', 'problem', 'need', 'address', 'challenge', 'efficient', 'goal'],
          2,
        ),
        [
          `论文标题聚焦于“${paper.title}”，说明作者试图解决该主题下的关键任务瓶颈。`,
          noteSnippet ? `阅读笔记补充显示你关注的切入点是：${noteSnippet}` : '当前尚无阅读笔记补充，动机分析主要依据论文标题与摘要。',
        ],
      ),
      this.createSection(
        'challenges',
        '核心难点',
        this.pickSentences(
          sentences,
          ['challenge', 'difficult', 'cost', 'efficient', 'robust', 'limited', 'complex'],
          2,
        ),
        [
          '从摘要表达看，难点通常集中在数据规模、泛化能力、效率约束或现有方法局限。',
          session.annotations.length
            ? `最近批注提示需要重点关注的段落有：${session.annotations
                .slice(0, 2)
                .map((annotation) => `第 ${annotation.pageNumber} 页“${this.truncateText(annotation.quote, 30)}”`)
                .join('；')}。`
            : '当前尚未提供阅读批注，因此难点判断主要来自摘要中的问题定义。',
        ],
      ),
      this.createSection(
        'research-landscape',
        '研究现状',
        internetHits.length
          ? internetHits
              .slice(0, 3)
              .map(
                (hit) =>
                  `${hit.title}${hit.publishedAt ? `（${hit.publishedAt.slice(0, 4)}）` : ''} 提供了相邻方向的最新公开线索，可作为对比阅读入口。`,
              )
          : ['当前联网检索未返回稳定结果，研究现状分析主要基于论文自身问题设定。'],
        [
          internetHits.length
            ? `已从互联网补充 ${internetHits.length} 条相关工作线索，能够辅助判断该论文在近期研究中的相对位置。`
            : '暂未获取到外部工作摘要，后续可根据标题或关键词继续补充检索。',
          '首版会明确区分“论文内信息”和“联网补充信息”，避免将外部线索误当作作者原文结论。',
        ],
      ),
      this.createSection(
        'method',
        '方法介绍',
        this.pickSentences(
          sentences,
          ['propose', 'present', 'introduce', 'framework', 'architecture', 'method', 'approach', 'model'],
          3,
        ),
        [
          '如果摘要中未展开模块细节，建议在阅读器内结合方法图、伪代码和公式段落继续追问。',
        ],
      ),
      this.createSection(
        'experiments',
        '实验设置',
        this.pickSentences(
          sentences,
          ['experiment', 'evaluate', 'benchmark', 'dataset', 'ablation', 'compare'],
          2,
        ),
        [
          '实验设置部分重点关注数据集、对比基线、评价指标与是否包含消融实验。',
        ],
      ),
      this.createSection(
        'results',
        '实验结果',
        this.pickSentences(
          sentences,
          ['result', 'outperform', 'improve', 'state-of-the-art', 'superior', 'achieve'],
          2,
        ),
        [
          '结果解读需要与实验设置联动查看，尤其关注提升幅度、统计显著性和失败案例。',
        ],
      ),
    ];
  }

  /**
   * @function createSection
   * @description 将候选句子与补充要点整理成统一章节结构。
   * @param {PaperAnalysisSectionKey} key 章节标识
   * @param {string} title 章节标题
   * @param {string[]} evidenceCandidates 候选证据句
   * @param {string[]} fallbackBullets 兜底要点
   * @returns {PaperAnalysisSection} 结构化章节
   */
  private createSection(
    key: PaperAnalysisSectionKey,
    title: string,
    evidenceCandidates: string[],
    fallbackBullets: string[],
  ): PaperAnalysisSection {
    const bullets = (evidenceCandidates.length ? evidenceCandidates : fallbackBullets).slice(0, 3);

    return {
      key,
      title,
      summary: bullets[0] ?? `${title}信息不足，建议结合全文补充。`,
      bullets,
      evidence: bullets.map((item, index) => `${index === 0 ? '论文摘要' : '结构化推断'}：${item}`),
    };
  }

  /**
   * @function buildVerification
   * @description 生成代码实验验证记录，在无法自动执行时给出清晰阻塞原因。
   * @param {PaperRecord} paper 论文记录
   * @param {{ name: string; url: string; description: string; dependencyFiles: string[]; detectedCommands: string[]; } | null} repository 候选仓库
   * @returns {CodeExperimentVerification} 验证记录
   */
  private buildVerification(
    paper: PaperRecord,
    repository: {
      name: string;
      url: string;
      description: string;
      dependencyFiles: string[];
      detectedCommands: string[];
    } | null,
  ): CodeExperimentVerification {
    if (!repository) {
      return {
        repositoryUrl: null,
        repositoryName: null,
        status: 'not-found',
        summary: '未识别到可直接访问的代码仓库，实验验证已终止并记录为待人工补充。',
        failureReason: '论文元数据、摘要和联网搜索结果中均未定位到可信代码仓库链接。',
        steps: [
          this.createVerificationStep('代码获取', 'failed', '未发现可访问的代码仓库地址。'),
          this.createVerificationStep('依赖检查', 'skipped', '由于缺少仓库，无法检查依赖文件。'),
          this.createVerificationStep('执行尝试', 'skipped', '由于缺少仓库，未执行任何实验命令。'),
        ],
      };
    }

    const dependencyDescription = repository.dependencyFiles.length
      ? `检测到依赖文件：${repository.dependencyFiles.join('、')}。`
      : '仓库根目录未发现常见依赖文件。';
    const commandDescription = repository.detectedCommands.length
      ? `推断候选命令：${repository.detectedCommands.join('；')}。`
      : '未推断出稳定的候选运行命令。';

    return {
      repositoryUrl: repository.url,
      repositoryName: repository.name,
      status: 'blocked',
      summary: '已完成代码仓库定位与依赖检查，但自动实验执行被安全策略阻塞，已输出明确失败原因。',
      failureReason: '首版桌面端未启用隔离沙箱中的第三方仓库自动执行能力，避免直接运行未知代码带来安全风险。',
      steps: [
        this.createVerificationStep(
          '代码获取',
          'completed',
          `已定位候选仓库 ${repository.name}，仓库说明为：${repository.description}`,
        ),
        this.createVerificationStep('依赖检查', 'completed', `${dependencyDescription} ${commandDescription}`),
        this.createVerificationStep(
          '执行尝试',
          'failed',
          '已生成候选执行命令，但出于安全限制未自动运行第三方仓库。',
          repository.detectedCommands[0] ?? null,
          '执行被策略阻止：当前版本仅记录实验验证计划与失败反馈。',
        ),
        this.createVerificationStep(
          '验证结论',
          'completed',
          `当前分析已明确给出阻塞原因，建议人工在隔离环境中复现实验并回填结果。论文标题：${paper.title}`,
        ),
      ],
    };
  }

  /**
   * @function createVerificationStep
   * @description 构建单个实验验证步骤记录。
   * @param {string} stage 阶段名称
   * @param {'completed' | 'failed' | 'skipped'} status 步骤状态
   * @param {string} detail 阶段说明
   * @param {string | null} command 候选命令
   * @param {string | null} output 输出结果
   * @returns {CodeExperimentStep} 验证步骤记录
   */
  private createVerificationStep(
    stage: string,
    status: 'completed' | 'failed' | 'skipped',
    detail: string,
    command: string | null = null,
    output: string | null = null,
  ): CodeExperimentStep {
    return {
      stage,
      status,
      detail,
      command,
      output,
    };
  }

  /**
   * @function buildQuestionReply
   * @description 根据问题关键词匹配最相关章节，并给出追问答复与引用来源。
   * @param {PaperAnalysisRecord} report 已有分析记录
   * @param {string} question 用户追问
   * @returns {{ answer: string; references: string[] }} 追问答案和引用
   */
  private buildQuestionReply(
    report: PaperAnalysisRecord,
    question: string,
  ): { answer: string; references: string[] } {
    const normalizedQuestion = question.toLowerCase();
    const matchedSections = report.sections
      .map((section) => ({
        section,
        score: this.computeMatchScore(normalizedQuestion, [section.title, section.summary, ...section.bullets].join(' ')),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
      .map((item) => item.section);
    const shouldIncludeVerification = ['代码', '实验', '复现', '运行', '仓库'].some((keyword) => question.includes(keyword));
    const references = matchedSections.map((section) => section.title);
    const answerSections = [`围绕你的追问“${question}”，我优先基于已保存的单篇分析档案回答。`];

    if (matchedSections.length) {
      answerSections.push(
        matchedSections
          .map((section) => `${section.title}：${section.summary}\n- ${section.bullets.join('\n- ')}`)
          .join('\n\n'),
      );
    } else {
      answerSections.push('当前问题与已生成章节的关键词重叠较少，我先返回综合概览，建议继续追问更具体的模块、实验或结论。');
      answerSections.push(report.sections.slice(0, 2).map((section) => `${section.title}：${section.summary}`).join('\n'));
    }

    if (report.internetHits.length) {
      const hit = report.internetHits[0];
      answerSections.push(`联网补充：${hit.title} 提供了相邻工作线索，可与当前论文交叉对照。`);
      references.push(hit.title);
    }

    if (shouldIncludeVerification) {
      answerSections.push(`代码验证：${report.verification.summary}`);

      if (report.verification.failureReason) {
        answerSections.push(`失败反馈：${report.verification.failureReason}`);
      }

      references.push('代码实验验证');
    }

    return {
      answer: answerSections.join('\n\n'),
      references: Array.from(new Set(references)),
    };
  }

  /**
   * @function computeMatchScore
   * @description 通过简单关键词重叠分数判断问题与章节内容的相关度。
   * @param {string} query 已规范化的问题文本
   * @param {string} corpus 待匹配语料
   * @returns {number} 匹配分数
   */
  private computeMatchScore(query: string, corpus: string): number {
    const corpusValue = corpus.toLowerCase();

    return query
      .split(/[\s，。？！、,:;]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .reduce((score, token) => (corpusValue.includes(token) ? score + 1 : score), 0);
  }

  /**
   * @function extractSentences
   * @description 将摘要切分为句子，便于后续按主题关键词抽取证据。
   * @param {string} abstract 摘要文本
   * @returns {string[]} 句子列表
   */
  private extractSentences(abstract: string): string[] {
    return abstract
      .split(/(?<=[.!?。！？])\s+/g)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  /**
   * @function pickSentences
   * @description 从摘要中挑选包含目标关键词的句子，并在不足时补充前置句。
   * @param {string[]} sentences 摘要句子列表
   * @param {string[]} keywords 目标关键词
   * @param {number} limit 最多返回数量
   * @returns {string[]} 候选句子
   */
  private pickSentences(sentences: string[], keywords: string[], limit: number): string[] {
    const matches = sentences.filter((sentence) => {
      const normalizedSentence = sentence.toLowerCase();
      return keywords.some((keyword) => normalizedSentence.includes(keyword));
    });

    // 关键逻辑：关键词命中不足时回退到摘要前几句，保证结构化章节始终有可读输出。
    if (matches.length >= limit) {
      return matches.slice(0, limit);
    }

    return Array.from(new Set([...matches, ...sentences.slice(0, limit)])).slice(0, limit);
  }

  /**
   * @function createSafeId
   * @description 将论文标识转换为可安全落盘的文件名。
   * @param {string} value 原始标识
   * @returns {string} 文件安全标识
   */
  private createSafeId(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'paper-analysis';
  }

  /**
   * @function truncateText
   * @description 截断长文本以适配结构化展示和摘要存储。
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
