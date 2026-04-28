import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentTaskRecord,
  ExternalMediaSnapshot,
  ExternalMediaStatusCallback,
  ExternalMediaTaskReceipt,
  ExternalMediaTaskRequest,
  FeishuMessageInput,
  PaperAnalysisRecord,
  PaperRecord,
  PaperSearchResult,
  WorkspaceDirectories,
} from '@shared/types';

import { PaperAnalysisService } from '../analysis/PaperAnalysisService';
import { PaperService } from '../papers/PaperService';

interface ExternalMediaFiles {
  requestFile: string;
  callbackFile: string;
}

/**
 * @class ExternalMediaService
 * @description 负责规范化外部媒体消息、触发论文分析任务并持久化状态回传记录。
 * @param {WorkspaceDirectories} directories 工作区目录集合
 * @returns {ExternalMediaService} 外部媒体服务实例
 */
export class ExternalMediaService {
  private readonly files: ExternalMediaFiles;

  public constructor(
    directories: WorkspaceDirectories,
    private readonly paperService: PaperService,
    private readonly paperAnalysisService: PaperAnalysisService,
  ) {
    this.files = {
      requestFile: path.join(directories.tasks, 'external-media-requests.json'),
      callbackFile: path.join(directories.tasks, 'external-media-callbacks.json'),
    };
  }

  /**
   * @function getSnapshot
   * @description 返回最近的外部媒体请求与状态回传记录，供桌面端或调试入口查看。
   * @param {void} 无需参数
   * @returns {Promise<Omit<ExternalMediaSnapshot, 'protocols'>>} 最近请求与回调快照
   */
  public async getSnapshot(): Promise<Omit<ExternalMediaSnapshot, 'protocols'>> {
    await this.ensureStorage();

    const [recentRequests, recentCallbacks] = await Promise.all([
      this.readRequests(),
      this.readCallbacks(),
    ]);

    return {
      recentRequests: recentRequests.slice(0, 10),
      recentCallbacks: recentCallbacks.slice(0, 20),
    };
  }

  /**
   * @function handleFeishuMessage
   * @description 处理飞书消息指令，自动解析论文目标并执行单篇论文分析任务。
   * @param {FeishuMessageInput} input 飞书消息输入
   * @returns {Promise<ExternalMediaTaskReceipt>} 任务请求、分析结果与状态回传摘要
   */
  public async handleFeishuMessage(input: FeishuMessageInput): Promise<ExternalMediaTaskReceipt> {
    await this.ensureStorage();

    const request = this.createRequest(input);
    await this.upsertRequest(request);

    const acceptedCallback = this.createCallback(
      request,
      'accepted',
      '已受理飞书论文分析请求，正在解析论文标识并准备创建任务。',
      null,
      null,
      null,
    );
    await this.appendCallback(acceptedCallback);

    try {
      const paper = await this.resolvePaper(request);
      const runningCallback = this.createCallback(
        {
          ...request,
          paperId: paper.id,
        },
        'running',
        `已定位论文《${paper.title}》，正在执行单篇论文深度分析。`,
        null,
        paper.id,
        null,
      );
      await this.appendCallback(runningCallback);
      await this.upsertRequest({
        ...request,
        paperId: paper.id,
      });

      // 关键逻辑：外部媒体入口与桌面端复用同一分析服务，确保任务模型、状态与落盘行为保持一致。
      const result = await this.paperAnalysisService.runAnalysis(paper.id);
      const summary = this.buildResultSummary(result.report);
      const completedCallback = this.createCallback(
        {
          ...request,
          paperId: paper.id,
        },
        'completed',
        `论文分析已完成，可在桌面端查看《${paper.title}》的完整分析档案。`,
        result.task.id,
        paper.id,
        summary,
      );
      await this.appendCallback(completedCallback);

      return {
        request: {
          ...request,
          paperId: paper.id,
        },
        task: result.task,
        report: result.report,
        callbacks: [acceptedCallback, runningCallback, completedCallback],
        summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书任务执行失败';
      const failedTask = this.createFallbackTask(request, message);
      const failedCallback = this.createCallback(
        request,
        'failed',
        `论文分析任务执行失败：${message}`,
        failedTask.id,
        request.paperId,
        message,
      );
      await this.appendCallback(failedCallback);

      throw new Error(message);
    }
  }

  /**
   * @function listCallbacksByRequest
   * @description 按请求标识读取状态回传历史，便于 HTTP 接口查询任务进度。
   * @param {string} requestId 外部请求标识
   * @returns {Promise<ExternalMediaStatusCallback[]>} 请求对应的回调记录
   */
  public async listCallbacksByRequest(requestId: string): Promise<ExternalMediaStatusCallback[]> {
    await this.ensureStorage();
    const callbacks = await this.readCallbacks();
    return callbacks.filter((callback) => callback.requestId === requestId);
  }

  /**
   * @function getRequestById
   * @description 返回指定请求的原始协议对象，便于状态查询接口补充上下文。
   * @param {string} requestId 外部请求标识
   * @returns {Promise<ExternalMediaTaskRequest | null>} 请求对象或空值
   */
  public async getRequestById(requestId: string): Promise<ExternalMediaTaskRequest | null> {
    await this.ensureStorage();
    const requests = await this.readRequests();
    return requests.find((request) => request.requestId === requestId) ?? null;
  }

  /**
   * @function ensureStorage
   * @description 初始化外部媒体请求与状态回传文件。
   * @param {void} 无需参数
   * @returns {Promise<void>} 初始化结果
   */
  private async ensureStorage(): Promise<void> {
    await mkdir(path.dirname(this.files.requestFile), { recursive: true });

    await Promise.all([
      this.ensureJsonFile(this.files.requestFile, []),
      this.ensureJsonFile(this.files.callbackFile, []),
    ]);
  }

  /**
   * @function ensureJsonFile
   * @description 在 JSON 文件缺失时写入默认值，保证外部媒体链路稳定读取。
   * @param {string} filePath 文件路径
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
   * @function readRequests
   * @description 读取所有外部媒体请求，并按时间倒序返回。
   * @param {void} 无需参数
   * @returns {Promise<ExternalMediaTaskRequest[]>} 请求列表
   */
  private async readRequests(): Promise<ExternalMediaTaskRequest[]> {
    const content = await readFile(this.files.requestFile, 'utf-8');
    const requests = JSON.parse(content) as ExternalMediaTaskRequest[];

    return [...requests].sort(
      (left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
    );
  }

  /**
   * @function readCallbacks
   * @description 读取所有外部媒体状态回传记录，并按时间倒序返回。
   * @param {void} 无需参数
   * @returns {Promise<ExternalMediaStatusCallback[]>} 回调列表
   */
  private async readCallbacks(): Promise<ExternalMediaStatusCallback[]> {
    const content = await readFile(this.files.callbackFile, 'utf-8');
    const callbacks = JSON.parse(content) as ExternalMediaStatusCallback[];

    return [...callbacks].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }

  /**
   * @function upsertRequest
   * @description 写入或更新单条外部媒体请求记录。
   * @param {ExternalMediaTaskRequest} request 外部请求对象
   * @returns {Promise<void>} 写入结果
   */
  private async upsertRequest(request: ExternalMediaTaskRequest): Promise<void> {
    const requests = await this.readRequests();
    const nextRequests = requests.filter((item) => item.requestId !== request.requestId);
    nextRequests.push(request);
    await writeFile(this.files.requestFile, JSON.stringify(nextRequests, null, 2), 'utf-8');
  }

  /**
   * @function appendCallback
   * @description 追加状态回传记录，用于表达受理、执行中、完成或失败阶段。
   * @param {ExternalMediaStatusCallback} callback 回调记录
   * @returns {Promise<void>} 写入结果
   */
  private async appendCallback(callback: ExternalMediaStatusCallback): Promise<void> {
    const callbacks = await this.readCallbacks();
    callbacks.push(callback);
    await writeFile(this.files.callbackFile, JSON.stringify(callbacks, null, 2), 'utf-8');
  }

  /**
   * @function createRequest
   * @description 将飞书消息解析为统一的外部媒体任务请求协议。
   * @param {FeishuMessageInput} input 飞书消息输入
   * @returns {ExternalMediaTaskRequest} 规范化后的任务请求
   */
  private createRequest(input: FeishuMessageInput): ExternalMediaTaskRequest {
    const normalizedText = input.text.trim();
    const paperUrl = this.extractUrl(normalizedText);
    const paperQuery = this.extractPaperQuery(normalizedText, paperUrl);

    if (!paperQuery) {
      throw new Error('未识别到论文标题、关键词或链接，请使用“分析论文 标题/链接”格式重试');
    }

    return {
      requestId: `feishu-${Date.now()}`,
      channel: 'feishu',
      intent: 'paper-analysis',
      messageId: input.messageId,
      chatId: input.chatId,
      senderId: input.senderId,
      text: normalizedText,
      paperQuery,
      paperUrl,
      paperId: null,
      receivedAt: new Date().toISOString(),
    };
  }

  /**
   * @function resolvePaper
   * @description 基于链接、标题或关键词定位论文，必要时自动搜索并导入论文库。
   * @param {ExternalMediaTaskRequest} request 外部任务请求
   * @returns {Promise<PaperRecord>} 已定位的论文记录
   */
  private async resolvePaper(request: ExternalMediaTaskRequest): Promise<PaperRecord> {
    const library = await this.paperService.getLibrary();
    const normalizedQuery = this.normalizeValue(request.paperQuery);
    const normalizedUrl = request.paperUrl ? this.normalizeValue(request.paperUrl) : null;

    const existingPaper = library.papers.find((paper) => {
      return [
        paper.id,
        paper.sourceId,
        paper.title,
        paper.entryUrl,
        paper.pdfUrl ?? '',
      ].some((candidate) => this.normalizeValue(candidate) === normalizedQuery || (normalizedUrl && this.normalizeValue(candidate) === normalizedUrl));
    });

    if (existingPaper) {
      return existingPaper;
    }

    const results = await this.paperService.search({
      query: request.paperQuery,
      source: 'all',
      limit: 5,
    });

    if (!results.length) {
      throw new Error(`未搜索到与“${request.paperQuery}”匹配的论文结果`);
    }

    const candidate = this.pickBestCandidate(request, results);
    await this.paperService.importPaper(candidate);
    const importedPaper = await this.paperService.getPaperById(candidate.id);

    if (!importedPaper) {
      throw new Error('论文已导入但未能重新读取记录，请稍后重试');
    }

    return importedPaper;
  }

  /**
   * @function pickBestCandidate
   * @description 从搜索结果中挑选与飞书请求最匹配的论文候选。
   * @param {ExternalMediaTaskRequest} request 外部任务请求
   * @param {PaperSearchResult[]} results 搜索结果列表
   * @returns {PaperSearchResult} 最佳匹配论文
   */
  private pickBestCandidate(request: ExternalMediaTaskRequest, results: PaperSearchResult[]): PaperSearchResult {
    const normalizedQuery = this.normalizeValue(request.paperQuery);
    const normalizedUrl = request.paperUrl ? this.normalizeValue(request.paperUrl) : '';

    const sortedResults = [...results].sort((left, right) => {
      return this.computeCandidateScore(request, right, normalizedQuery, normalizedUrl)
        - this.computeCandidateScore(request, left, normalizedQuery, normalizedUrl);
    });

    return sortedResults[0];
  }

  /**
   * @function computeCandidateScore
   * @description 基于标题、链接和标识重叠度为搜索候选打分。
   * @param {ExternalMediaTaskRequest} request 外部任务请求
   * @param {PaperSearchResult} candidate 论文候选
   * @param {string} normalizedQuery 规范化查询词
   * @param {string} normalizedUrl 规范化链接
   * @returns {number} 匹配分数
   */
  private computeCandidateScore(
    request: ExternalMediaTaskRequest,
    candidate: PaperSearchResult,
    normalizedQuery: string,
    normalizedUrl: string,
  ): number {
    const title = this.normalizeValue(candidate.title);
    const entryUrl = this.normalizeValue(candidate.entryUrl);
    const pdfUrl = this.normalizeValue(candidate.pdfUrl ?? '');
    const sourceId = this.normalizeValue(candidate.sourceId);
    const requestTokens = normalizedQuery.split(/\s+/g).filter(Boolean);

    let score = 0;

    if (title === normalizedQuery || sourceId === normalizedQuery) {
      score += 10;
    }

    if (normalizedUrl && (entryUrl === normalizedUrl || pdfUrl === normalizedUrl)) {
      score += 10;
    }

    score += requestTokens.reduce((total, token) => {
      return title.includes(token) ? total + 1 : total;
    }, 0);

    // 关键逻辑：当消息中包含 URL 时优先根据来源链接命中，避免仅按标题检索导致误匹配。
    if (request.paperUrl && entryUrl.includes(this.normalizeValue(request.paperUrl))) {
      score += 4;
    }

    return score;
  }

  /**
   * @function buildResultSummary
   * @description 提炼结构化分析章节的摘要，用于回传到飞书消息侧。
   * @param {PaperAnalysisRecord} report 论文分析报告
   * @returns {string} 简要摘要文本
   */
  private buildResultSummary(report: PaperAnalysisRecord): string {
    const digest = report.sections
      .slice(0, 3)
      .map((section) => `${section.title}：${section.summary}`)
      .join('；');

    return `${report.paperTitle} 分析完成。${digest}`;
  }

  /**
   * @function createCallback
   * @description 构建统一的外部媒体状态回传对象。
   * @param {ExternalMediaTaskRequest} request 外部任务请求
   * @param {'accepted' | 'running' | 'completed' | 'failed'} state 回传状态
   * @param {string} message 状态说明
   * @param {string | null} relatedTaskId 关联任务标识
   * @param {string | null} paperId 关联论文标识
   * @param {string | null} summary 可选摘要
   * @returns {ExternalMediaStatusCallback} 状态回传对象
   */
  private createCallback(
    request: ExternalMediaTaskRequest,
    state: 'accepted' | 'running' | 'completed' | 'failed',
    message: string,
    relatedTaskId: string | null,
    paperId: string | null,
    summary: string | null,
  ): ExternalMediaStatusCallback {
    return {
      id: `${request.requestId}-${state}-${Date.now()}`,
      requestId: request.requestId,
      channel: request.channel,
      state,
      message,
      relatedTaskId,
      paperId,
      summary,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * @function createFallbackTask
   * @description 在解析失败时生成简化任务对象，便于失败回传携带统一任务标识。
   * @param {ExternalMediaTaskRequest} request 外部任务请求
   * @param {string} message 失败说明
   * @returns {AgentTaskRecord} 失败态任务记录
   */
  private createFallbackTask(request: ExternalMediaTaskRequest, message: string): AgentTaskRecord {
    return {
      id: `${request.requestId}-failed`,
      title: `飞书任务失败：${request.paperQuery}`,
      agentKey: 'paper-analysis',
      runtime: 'langchain',
      status: 'failed',
      stage: '外部入口执行失败',
      createdAt: request.receivedAt,
      updatedAt: new Date().toISOString(),
      summary: message,
    };
  }

  /**
   * @function extractUrl
   * @description 从飞书消息中提取首个论文链接，支持作为论文解析入口。
   * @param {string} text 原始消息文本
   * @returns {string | null} 提取到的链接或空值
   */
  private extractUrl(text: string): string | null {
    const match = text.match(/https?:\/\/\S+/i);
    return match?.[0] ?? null;
  }

  /**
   * @function extractPaperQuery
   * @description 去除命令前缀与链接后提取论文查询词。
   * @param {string} text 原始消息文本
   * @param {string | null} paperUrl 已提取到的论文链接
   * @returns {string} 论文标题、标识或关键词
   */
  private extractPaperQuery(text: string, paperUrl: string | null): string {
    const commandStripped = text
      .replace(/^(请)?\s*(帮我)?\s*(分析论文|论文分析|分析)\s*/i, '')
      .replace(/^(analyze|paper analysis)\s*/i, '')
      .replace(/[\n\r]+/g, ' ')
      .trim();
    const query = paperUrl ? commandStripped.replace(paperUrl, '').trim() : commandStripped;

    if (query) {
      return query;
    }

    return paperUrl ? this.extractQueryFromUrl(paperUrl) : '';
  }

  /**
   * @function extractQueryFromUrl
   * @description 从 arXiv、OpenAlex 等论文链接中提取可用于搜索的查询词。
   * @param {string} url 论文链接
   * @returns {string} 派生出的查询词
   */
  private extractQueryFromUrl(url: string): string {
    const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i);

    if (arxivMatch?.[1]) {
      return arxivMatch[1].replace(/\.pdf$/i, '');
    }

    const openAlexMatch = url.match(/openalex\.org\/([^/?#]+)/i);

    if (openAlexMatch?.[1]) {
      return openAlexMatch[1];
    }

    return url;
  }

  /**
   * @function normalizeValue
   * @description 统一清洗标题、链接与标识，便于做精确或近似匹配。
   * @param {string} value 原始字符串
   * @returns {string} 规范化结果
   */
  private normalizeValue(value: string): string {
    return value.trim().toLowerCase();
  }
}
