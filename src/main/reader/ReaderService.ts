import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ReaderAnnotation,
  ReaderAnnotationInput,
  ReaderAnnotationUpdateInput,
  ReaderAssistantInput,
  ReaderAssistantReply,
  ReaderAssistantSession,
  ReaderChatMessage,
  ReaderProgressInput,
  ReaderSession,
  ReadingRecord,
  WorkspaceDirectories,
} from '@shared/types';

import { AgentRuntimeService } from '../agents/AgentRuntimeService';
import { createReaderQaLoopSpec } from '../agents/specs/readerQaAgent';
import { AgentToolRegistry } from '../agents/toolRegistry';
import { createInternetTools } from '../agents/tools/internetTools';
import { createReaderTools } from '../agents/tools/readerTools';
import { PaperService } from '../papers/PaperService';
import { ReaderInternetContextService } from './ReaderInternetContextService';
import { PaperTextIndexService } from './PaperTextIndexService';

interface ReaderServiceFiles {
  readingIndexFile: string;
  sessionDirectory: string;
}

interface ReaderAssistantOptions {
  onDelta?: (delta: string) => void;
}

/**
 * @class ReaderService
 * @description 管理论文阅读会话、划线批注、笔记持久化与阅读内 AI 对话记录。
 * @param {WorkspaceDirectories} directories 工作区目录集合
 * @returns {ReaderService} 阅读器服务实例
 */
export class ReaderService {
  private readonly files: ReaderServiceFiles;

  private readonly paperTextIndexService: PaperTextIndexService;

  private readonly readerInternetContextService: ReaderInternetContextService;

  public constructor(
    directories: WorkspaceDirectories,
    private readonly paperService: PaperService,
    private readonly agentRuntimeService: AgentRuntimeService,
  ) {
    this.paperTextIndexService = new PaperTextIndexService(directories);
    this.readerInternetContextService = new ReaderInternetContextService(directories);
    this.files = {
      readingIndexFile: path.join(directories.metadata, 'reading.json'),
      sessionDirectory: path.join(directories.notes, 'reader-sessions'),
    };
  }

  /**
   * @function getSession
   * @description 读取单篇论文的阅读会话，缺失时自动创建默认结构。
   * @param {string} paperId 论文唯一标识
   * @returns {Promise<ReaderSession>} 阅读会话对象
   */
  public async getSession(paperId: string): Promise<ReaderSession> {
    await this.ensureStorage();
    return this.readSession(paperId);
  }

  /**
   * @function saveProgress
   * @description 持久化当前页码、总页数、缩放比例与阅读完成度。
   * @param {string} paperId 论文唯一标识
   * @param {ReaderProgressInput} input 阅读进度输入
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async saveProgress(paperId: string, input: ReaderProgressInput): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const currentPage = Math.max(1, Math.trunc(input.currentPage));
    const totalPages = Math.max(currentPage, Math.trunc(input.totalPages));
    const zoom = Number(input.zoom.toFixed(2));
    const completion = totalPages > 0 ? Number((currentPage / totalPages).toFixed(4)) : 0;
    const updatedAt = new Date().toISOString();
    const progress: ReadingRecord = {
      paperId,
      lastPosition: `page=${currentPage}&zoom=${zoom}`,
      currentPage,
      totalPages,
      zoom,
      completion,
      updatedAt,
    };

    const nextSession: ReaderSession = {
      ...session,
      progress,
      updatedAt,
    };

    // 关键逻辑：每次更新阅读进度时同时回写会话详情与阅读索引，保证下次打开能够恢复位置。
    await this.writeSession(nextSession);
    await this.upsertReadingRecord(progress);
    return nextSession;
  }

  /**
   * @function addAnnotation
   * @description 为指定论文追加划线批注记录，并写入本地会话文件。
   * @param {string} paperId 论文唯一标识
   * @param {ReaderAnnotationInput} input 批注输入内容
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async addAnnotation(paperId: string, input: ReaderAnnotationInput): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const now = new Date().toISOString();
    const annotation: ReaderAnnotation = {
      id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paperId,
      pageNumber: Math.max(1, Math.trunc(input.pageNumber)),
      quote: input.quote.trim(),
      note: input.note.trim(),
      color: input.color,
      highlightAreas: input.highlightAreas ?? [],
      createdAt: now,
      updatedAt: now,
    };

    const nextSession: ReaderSession = {
      ...session,
      annotations: [annotation, ...session.annotations],
      updatedAt: now,
    };

    // 关键逻辑：新建批注后立即落盘，确保阅读器刷新或重启后仍可恢复高亮与批注清单。
    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function updateAnnotation
   * @description 更新指定批注的颜色与备注，并返回最新阅读会话。
   * @param {string} paperId 论文唯一标识
   * @param {string} annotationId 批注唯一标识
   * @param {ReaderAnnotationUpdateInput} input 批注更新内容
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async updateAnnotation(
    paperId: string,
    annotationId: string,
    input: ReaderAnnotationUpdateInput,
  ): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const updatedAt = new Date().toISOString();
    const nextSession: ReaderSession = {
      ...session,
      annotations: session.annotations.map((annotation) =>
        annotation.id === annotationId
          ? {
              ...annotation,
              note: input.note.trim(),
              color: input.color,
              updatedAt,
            }
          : annotation,
      ),
      updatedAt,
    };

    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function removeAnnotation
   * @description 删除指定批注并返回最新阅读会话。
   * @param {string} paperId 论文唯一标识
   * @param {string} annotationId 批注唯一标识
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async removeAnnotation(paperId: string, annotationId: string): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const nextSession: ReaderSession = {
      ...session,
      annotations: session.annotations.filter((annotation) => annotation.id !== annotationId),
      updatedAt: new Date().toISOString(),
    };

    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function saveNote
   * @description 持久化阅读侧边笔记内容，供后续继续编辑与 AI 问答引用。
   * @param {string} paperId 论文唯一标识
   * @param {string} note 阅读笔记内容
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async saveNote(paperId: string, note: string): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const nextSession: ReaderSession = {
      ...session,
      note,
      updatedAt: new Date().toISOString(),
    };

    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function createAssistantSession
   * @description 为当前论文创建一个新的 AI 对话会话，并切换为当前活跃会话。
   * @param {string} paperId 论文唯一标识
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async createAssistantSession(paperId: string): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const createdAt = new Date().toISOString();
    const nextAssistantSession = this.createDefaultAssistantSession(createdAt);
    const nextSession: ReaderSession = {
      ...session,
      assistantSessions: [nextAssistantSession, ...session.assistantSessions],
      currentAssistantSessionId: nextAssistantSession.id,
      updatedAt: createdAt,
    };

    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function selectAssistantSession
   * @description 切换当前论文的活跃 AI 会话，便于继续追问或查看历史记录。
   * @param {string} paperId 论文唯一标识
   * @param {string} assistantSessionId 目标 AI 会话标识
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async selectAssistantSession(paperId: string, assistantSessionId: string): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const targetSession = session.assistantSessions.find((item) => item.id === assistantSessionId);

    if (!targetSession) {
      throw new Error('目标 AI 会话不存在，无法切换');
    }

    const nextSession: ReaderSession = {
      ...session,
      currentAssistantSessionId: assistantSessionId,
      updatedAt: new Date().toISOString(),
    };

    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function saveAssistantSession
   * @description 将当前 AI 会话标记为已保存，并生成便于回看的会话标题。
   * @param {string} paperId 论文唯一标识
   * @param {string} assistantSessionId 目标 AI 会话标识
   * @param {string | undefined} title 用户可选提供的会话标题
   * @returns {Promise<ReaderSession>} 更新后的阅读会话
   */
  public async saveAssistantSession(
    paperId: string,
    assistantSessionId: string,
    title?: string,
  ): Promise<ReaderSession> {
    await this.ensureStorage();
    const session = await this.readSession(paperId);
    const targetSession = session.assistantSessions.find((item) => item.id === assistantSessionId);

    if (!targetSession) {
      throw new Error('目标 AI 会话不存在，无法保存');
    }

    const savedAt = new Date().toISOString();
    const nextTitle = title?.trim() || this.deriveAssistantSessionTitle(targetSession);
    const nextSession: ReaderSession = {
      ...session,
      assistantSessions: session.assistantSessions.map((item) =>
        item.id === assistantSessionId
          ? {
              ...item,
              title: nextTitle,
              isSaved: true,
              savedAt: item.savedAt ?? savedAt,
              updatedAt: savedAt,
            }
          : item,
      ),
      currentAssistantSessionId: assistantSessionId,
      updatedAt: savedAt,
    };

    await this.writeSession(nextSession);
    return nextSession;
  }

  /**
   * @function askAssistant
   * @description 结合论文元数据、批注与笔记生成阅读内 AI 连续问答回复，并持久化对话。
   * @param {ReaderAssistantInput} input AI 问答输入
   * @returns {Promise<ReaderAssistantReply>} 包含会话、任务轨迹与回复的结果
   */
  public async askAssistant(input: ReaderAssistantInput, options: ReaderAssistantOptions = {}): Promise<ReaderAssistantReply> {
    await this.ensureStorage();
    const paper = await this.paperService.getPaperById(input.paperId);

    if (!paper) {
      throw new Error('当前论文不存在，无法发起阅读问答');
    }

    const session = await this.readSession(input.paperId);
    const now = new Date().toISOString();
    const ensuredAssistantSession = this.resolveAssistantSession(session, input.assistantSessionId, now);
    const agentSessionContext: ReaderSession = {
      ...session,
      assistantSessions: ensuredAssistantSession.assistantSessions,
      currentAssistantSessionId: ensuredAssistantSession.targetSession.id,
    };
    const userMessage: ReaderChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.question.trim(),
      createdAt: now,
      references: [`第 ${input.currentPage} 页`],
    };
    const agentResult = await this.runReaderQaAgentWithFallback(
      paper,
      agentSessionContext,
      input.question.trim(),
      input.currentPage,
      options.onDelta,
    );
    const assistantMessage: ReaderChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: agentResult.answer,
      createdAt: new Date().toISOString(),
      references: agentResult.references,
    };
    const nextAssistantSession: ReaderAssistantSession = {
      ...ensuredAssistantSession.targetSession,
      title:
        ensuredAssistantSession.targetSession.title.trim() && ensuredAssistantSession.targetSession.title !== '未命名会话'
          ? ensuredAssistantSession.targetSession.title
          : this.deriveAssistantSessionTitleFromQuestion(input.question),
      conversation: [...ensuredAssistantSession.targetSession.conversation, userMessage, assistantMessage],
      updatedAt: new Date().toISOString(),
    };
    const nextSession: ReaderSession = {
      ...session,
      assistantSessions: ensuredAssistantSession.assistantSessions.map((item) =>
        item.id === nextAssistantSession.id ? nextAssistantSession : item,
      ),
      currentAssistantSessionId: nextAssistantSession.id,
      updatedAt: new Date().toISOString(),
    };

    // 关键逻辑：问答结果与会话历史一起持久化，使阅读内 AI 面板支持连续追问与上下文回看。
    await this.writeSession(nextSession);
    return {
      session: nextSession,
      task: agentResult.task,
      timeline: agentResult.timeline,
    };
  }

  /**
   * @function runReaderQaAgentWithFallback
   * @description 优先执行自治阅读问答 Agent，失败或模型未配置时回退到现有固定流程。
   * @param {PaperRecord} paper 当前论文记录
   * @param {ReaderSession} session 当前阅读会话
   * @param {string} question 用户问题
   * @param {number} currentPage 当前页码
   * @param {(delta: string) => void | undefined} onDelta 增量回调
   * @returns {Promise<{ answer: string; references: string[]; task: import('@shared/types').AgentTaskRecord; timeline: import('@shared/types').AgentTimelineEntry[] }>} 统一问答结果
   */
  private async runReaderQaAgentWithFallback(
    paper: import('@shared/types').PaperRecord,
    session: ReaderSession,
    question: string,
    currentPage: number,
    onDelta?: (delta: string) => void,
  ): Promise<{
    answer: string;
    references: string[];
    task: import('@shared/types').AgentTaskRecord;
    timeline: import('@shared/types').AgentTimelineEntry[];
  }> {
    if (this.agentRuntimeService.isModelConfigured()) {
      try {
        const toolRegistry = new AgentToolRegistry();
        toolRegistry.registerAll<import('../agents/specs/readerQaAgent').ReaderQaGoal>(createReaderTools({
          paperTextIndexService: this.paperTextIndexService,
        }));
        toolRegistry.registerAll<import('../agents/specs/readerQaAgent').ReaderQaGoal>(createInternetTools({
          paperTextIndexService: this.paperTextIndexService,
          readerInternetContextService: this.readerInternetContextService,
        }));
        const readerQaLoopSpec = createReaderQaLoopSpec();
        const loopResult = await this.agentRuntimeService.runLoopAgent({
          agentKey: 'reader-qa',
          title: `阅读问答：${paper.title}`,
          initialStage: '自治规划',
          initialMessage: `已接收阅读器问题，自治 Agent 正围绕第 ${currentPage} 页规划检索路径。`,
          completionStage: '生成完成',
          completionSummary: (_state, result) => `自治阅读问答已完成，并返回 ${result.references.length} 条引用线索。`,
          goal: {
            paper,
            session,
            question,
            currentPage,
          },
          spec: readerQaLoopSpec,
          tools: toolRegistry.getAllowedTools(readerQaLoopSpec.allowedTools),
          onDelta,
        });

        return {
          answer: loopResult.result.answer,
          references: loopResult.result.references,
          task: loopResult.task,
          timeline: loopResult.timeline,
        };
      } catch {
        // 关键逻辑：自治 Agent 首版仍在演进中，因此运行失败时回退到原有固定流程以保证阅读器可用性。
      }
    }

    const textContext = await this.paperTextIndexService.getReaderTextContext(paper, currentPage, question);
    const internetContext = await this.readerInternetContextService.collect(paper, question, textContext);
    return this.agentRuntimeService.runReaderQaAgent({
      paper,
      session,
      question,
      currentPage,
      textContext,
      internetContext,
      onDelta,
    });
  }

  /**
   * @function ensureStorage
   * @description 确保阅读索引与会话目录存在，便于后续读写本地 JSON。
   * @returns {Promise<void>} 初始化结果
   */
  private async ensureStorage(): Promise<void> {
    await mkdir(this.files.sessionDirectory, { recursive: true });

    try {
      await readFile(this.files.readingIndexFile, 'utf-8');
    } catch {
      await writeFile(this.files.readingIndexFile, '[]', 'utf-8');
    }
  }

  /**
   * @function readSession
   * @description 从磁盘读取会话文件，缺失时按默认数据创建。
   * @param {string} paperId 论文唯一标识
   * @returns {Promise<ReaderSession>} 阅读会话对象
   */
  private async readSession(paperId: string): Promise<ReaderSession> {
    const filePath = this.getSessionFilePath(paperId);

    try {
      const content = await readFile(filePath, 'utf-8');
      return this.normalizeSession(JSON.parse(content) as ReaderSession);
    } catch {
      const readingRecords = await this.readReadingRecords();
      const existingProgress = readingRecords.find((record) => record.paperId === paperId) ?? this.createDefaultProgress(paperId);
      const initialAssistantSession = this.createDefaultAssistantSession(existingProgress.updatedAt);
      const session: ReaderSession = {
        paperId,
        progress: existingProgress,
        annotations: [],
        note: '',
        assistantSessions: [initialAssistantSession],
        currentAssistantSessionId: initialAssistantSession.id,
        updatedAt: existingProgress.updatedAt,
      };

      await this.writeSession(session);
      return session;
    }
  }

  /**
   * @function writeSession
   * @description 将完整阅读会话写入论文专属 JSON 文件。
   * @param {ReaderSession} session 需要持久化的会话
   * @returns {Promise<void>} 写入结果
   */
  private async writeSession(session: ReaderSession): Promise<void> {
    const persistedSession = { ...session } as ReaderSession & { conversation?: ReaderChatMessage[] };
    delete persistedSession.conversation;
    await writeFile(this.getSessionFilePath(session.paperId), JSON.stringify(persistedSession, null, 2), 'utf-8');
  }

  private normalizeSession(session: ReaderSession): ReaderSession {
    const baseProgress = this.createDefaultProgress(session.paperId);
    const updatedAt = typeof session.updatedAt === 'string' ? session.updatedAt : baseProgress.updatedAt;
    const legacyConversation = this.normalizeConversation((session as ReaderSession & { conversation?: ReaderChatMessage[] }).conversation);
    const progress = session.progress
      ? {
          ...baseProgress,
          ...session.progress,
          paperId: session.paperId,
          currentPage: Math.max(1, Math.trunc(session.progress.currentPage ?? baseProgress.currentPage)),
          totalPages: Math.max(1, Math.trunc(session.progress.totalPages ?? baseProgress.totalPages)),
          zoom: Number((session.progress.zoom ?? baseProgress.zoom).toFixed(2)),
          completion: Number((session.progress.completion ?? baseProgress.completion).toFixed(4)),
          lastPosition: typeof session.progress.lastPosition === 'string' ? session.progress.lastPosition : baseProgress.lastPosition,
          updatedAt: typeof session.progress.updatedAt === 'string' ? session.progress.updatedAt : updatedAt,
        }
      : baseProgress;
    const normalizedAssistantSessions = Array.isArray(session.assistantSessions) && session.assistantSessions.length
      ? session.assistantSessions.map((assistantSession) => {
          const normalizedConversation = this.normalizeConversation(assistantSession.conversation);
          return {
            ...assistantSession,
            title: typeof assistantSession.title === 'string' && assistantSession.title.trim()
              ? assistantSession.title.trim()
              : this.deriveAssistantSessionTitleFromConversation(normalizedConversation),
            conversation: normalizedConversation,
            isSaved: Boolean(assistantSession.isSaved),
            createdAt: typeof assistantSession.createdAt === 'string' ? assistantSession.createdAt : updatedAt,
            updatedAt: typeof assistantSession.updatedAt === 'string' ? assistantSession.updatedAt : updatedAt,
            savedAt: typeof assistantSession.savedAt === 'string' ? assistantSession.savedAt : null,
          };
        })
      : [
          {
            ...this.createDefaultAssistantSession(updatedAt),
            title: legacyConversation.length ? this.deriveAssistantSessionTitleFromConversation(legacyConversation) : '未命名会话',
            conversation: legacyConversation,
            isSaved: legacyConversation.length > 0,
            savedAt: legacyConversation.length ? updatedAt : null,
          },
        ];
    const currentAssistantSessionId = normalizedAssistantSessions.some(
      (assistantSession) => assistantSession.id === session.currentAssistantSessionId,
    )
      ? session.currentAssistantSessionId
      : normalizedAssistantSessions[0]?.id ?? null;

    return {
      ...session,
      progress,
      annotations: Array.isArray(session.annotations) ? session.annotations.map((annotation) => ({
        ...annotation,
        highlightAreas: annotation.highlightAreas ?? [],
      })) : [],
      note: typeof session.note === 'string' ? session.note : '',
      assistantSessions: normalizedAssistantSessions,
      currentAssistantSessionId,
      conversation: legacyConversation,
      updatedAt,
    };
  }

  /**
   * @function resolveAssistantSession
   * @description 获取当前问答应写入的 AI 会话，必要时自动创建默认会话。
   * @param {ReaderSession} session 当前阅读会话
   * @param {string | null | undefined} assistantSessionId 指定的 AI 会话标识
   * @param {string} now 当前时间戳
   * @returns {{ assistantSessions: ReaderAssistantSession[]; currentAssistantSessionId: string; targetSession: ReaderAssistantSession }} 会话解析结果
   */
  private resolveAssistantSession(
    session: ReaderSession,
    assistantSessionId: string | null | undefined,
    now: string,
  ): {
    assistantSessions: ReaderAssistantSession[];
    currentAssistantSessionId: string;
    targetSession: ReaderAssistantSession;
  } {
    const existingSession =
      session.assistantSessions.find((item) => item.id === assistantSessionId)
      ?? session.assistantSessions.find((item) => item.id === session.currentAssistantSessionId)
      ?? session.assistantSessions[0];

    if (existingSession) {
      return {
        assistantSessions: session.assistantSessions,
        currentAssistantSessionId: existingSession.id,
        targetSession: existingSession,
      };
    }

    const createdAssistantSession = this.createDefaultAssistantSession(now);
    return {
      assistantSessions: [createdAssistantSession],
      currentAssistantSessionId: createdAssistantSession.id,
      targetSession: createdAssistantSession,
    };
  }

  /**
   * @function normalizeConversation
   * @description 统一清洗消息列表结构，确保引用字段始终为数组。
   * @param {ReaderChatMessage[] | undefined} conversation 原始消息列表
   * @returns {ReaderChatMessage[]} 标准化后的消息列表
   */
  private normalizeConversation(conversation: ReaderChatMessage[] | undefined): ReaderChatMessage[] {
    return Array.isArray(conversation)
      ? conversation.map((message) => ({
          ...message,
          references: Array.isArray(message.references) ? message.references : [],
        }))
      : [];
  }

  /**
   * @function createDefaultAssistantSession
   * @description 构建新的 AI 会话骨架，用于首次打开或用户主动新建会话。
   * @param {string} createdAt 会话创建时间
   * @returns {ReaderAssistantSession} 默认 AI 会话对象
   */
  private createDefaultAssistantSession(createdAt: string): ReaderAssistantSession {
    return {
      id: `assistant-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: '未命名会话',
      conversation: [],
      isSaved: false,
      createdAt,
      updatedAt: createdAt,
      savedAt: null,
    };
  }

  /**
   * @function deriveAssistantSessionTitle
   * @description 基于当前 AI 会话内容生成更易识别的会话标题。
   * @param {ReaderAssistantSession} assistantSession AI 会话对象
   * @returns {string} 适合展示的会话标题
   */
  private deriveAssistantSessionTitle(assistantSession: ReaderAssistantSession): string {
    const derivedTitle = this.deriveAssistantSessionTitleFromConversation(assistantSession.conversation);
    return derivedTitle || '未命名会话';
  }

  /**
   * @function deriveAssistantSessionTitleFromConversation
   * @description 从会话中的首条用户问题提炼标题，便于在会话列表中快速识别。
   * @param {ReaderChatMessage[]} conversation AI 对话消息列表
   * @returns {string} 派生得到的会话标题
   */
  private deriveAssistantSessionTitleFromConversation(conversation: ReaderChatMessage[]): string {
    const firstUserMessage = conversation.find((message) => message.role === 'user')?.content ?? '';
    return this.deriveAssistantSessionTitleFromQuestion(firstUserMessage);
  }

  /**
   * @function deriveAssistantSessionTitleFromQuestion
   * @description 从用户问题中裁剪出短标题，用作 AI 会话名称。
   * @param {string} question 用户问题文本
   * @returns {string} 会话标题
   */
  private deriveAssistantSessionTitleFromQuestion(question: string): string {
    const compactQuestion = question.replace(/\s+/g, ' ').trim();

    if (!compactQuestion) {
      return '未命名会话';
    }

    return compactQuestion.length > 20 ? `${compactQuestion.slice(0, 20)}…` : compactQuestion;
  }

  /**
   * @function readReadingRecords
   * @description 读取阅读索引文件中的所有进度记录。
   * @returns {Promise<ReadingRecord[]>} 阅读进度记录列表
   */
  private async readReadingRecords(): Promise<ReadingRecord[]> {
    try {
      const content = await readFile(this.files.readingIndexFile, 'utf-8');
      return JSON.parse(content) as ReadingRecord[];
    } catch {
      return [];
    }
  }

  /**
   * @function upsertReadingRecord
   * @description 将最新阅读进度写入阅读索引，用于统计阅读记录数量与恢复位置。
   * @param {ReadingRecord} progress 阅读进度对象
   * @returns {Promise<void>} 写入结果
   */
  private async upsertReadingRecord(progress: ReadingRecord): Promise<void> {
    const records = await this.readReadingRecords();
    const nextRecords = records.filter((record) => record.paperId !== progress.paperId);
    nextRecords.push(progress);
    await writeFile(this.files.readingIndexFile, JSON.stringify(nextRecords, null, 2), 'utf-8');
  }

  /**
   * @function createDefaultProgress
   * @description 构建首次阅读时使用的默认进度对象。
   * @param {string} paperId 论文唯一标识
   * @returns {ReadingRecord} 默认阅读进度
   */
  private createDefaultProgress(paperId: string): ReadingRecord {
    const updatedAt = new Date().toISOString();

    return {
      paperId,
      lastPosition: 'page=1&zoom=1',
      currentPage: 1,
      totalPages: 1,
      zoom: 1,
      completion: 0,
      updatedAt,
    };
  }

  /**
   * @function getSessionFilePath
   * @description 根据论文标识生成可安全落盘的阅读会话文件路径。
   * @param {string} paperId 论文唯一标识
   * @returns {string} 会话文件绝对路径
   */
  private getSessionFilePath(paperId: string): string {
    const safeId = paperId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return path.join(this.files.sessionDirectory, `${safeId || 'paper'}.json`);
  }
}
