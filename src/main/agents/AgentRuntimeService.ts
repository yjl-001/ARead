import { RunnableLambda } from '@langchain/core/runnables';

import type {
  AgentDefinition,
  AgentRunResult,
  AgentTaskRecord,
  AgentTaskStatus,
  AgentTimelineEntry,
  AiModelConfig,
  PaperRecord,
  ReaderSession,
} from '@shared/types';

import { AiModelClient, type AiChatMessage } from '../ai/AiModelClient';
import type { ReaderInternetContext } from '../reader/ReaderInternetContextService';
import type { ReaderTextContext } from '../reader/PaperTextIndexService';
import { agentCatalog } from './agentCatalog';
import { hasReachedLoopLimit, isRepeatedAction } from './guards/loopGuards';
import type {
  AgentAction,
  AgentLoopHooks,
  AgentLoopResult,
  AgentLoopState,
  AgentLoopTaskData,
} from './loopTypes';
import { parsePlannerAction } from './planners/actionParser';
import type {
  AgentPipelineOptions,
  AgentPipelineResult,
  AgentTaskDraft,
} from './runtimeTypes';
import type { LoopAgentSpec, LoopAgentToolDescriptor } from './specTypes';
import { FINISH_ANSWER_TOOL_NAME, getFinishAnswerToolDescriptor } from './tools/commonTools';
import type { AgentTool } from './toolTypes';

interface ReaderQaAgentInput {
  paper: PaperRecord;
  session: ReaderSession;
  question: string;
  currentPage: number;
  textContext?: ReaderTextContext;
  internetContext?: ReaderInternetContext;
  alphaxivOverview?: string;
  onDelta?: (delta: string) => void;
}

interface ReaderQaAgentData extends ReaderQaAgentInput {
  annotations: string[];
  noteSnippet: string;
  promptMessages: AiChatMessage[];
  answer: string;
  references: string[];
  usedModel: boolean;
  modelName: string | null;
}

interface ReaderQaAgentResult extends AgentRunResult {
  answer: string;
  references: string[];
}

interface AgentRuntimeServiceOptions {
  getAiModelConfig?: () => AiModelConfig;
  fetchImpl?: typeof fetch;
}

interface LoopAgentRunOptions<TGoal, TResult> extends AgentLoopHooks<TGoal, TResult | null> {
  agentKey: string;
  title: string;
  initialStage: string;
  initialMessage: string;
  completionStage: string;
  completionSummary: string | ((state: AgentLoopState<TGoal>, result: TResult) => string);
  goal: TGoal;
  spec: LoopAgentSpec<TGoal, TResult>;
  tools: AgentTool<TGoal>[];
  onDelta?: (delta: string) => void;
}

export class AgentRuntimeService {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: AgentRuntimeServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * @function isModelConfigured
   * @description 判断当前工作区是否已经配置可用于自治 Agent 的模型连接。
   * @returns {boolean} 当前模型是否可用
   */
  public isModelConfigured(): boolean {
    const modelConfig = this.options.getAiModelConfig?.();
    if (!modelConfig) {
      return false;
    }

    const client = new AiModelClient(modelConfig, { fetchImpl: this.fetchImpl });
    return client.isConfigured();
  }

  public getDefinitions(): AgentDefinition[] {
    return agentCatalog;
  }

  public getSeededTasks(): AgentTaskRecord[] {
    const now = new Date().toISOString();

    return [
      this.createTask({
        agentKey: 'reader-qa',
        title: '阅读问答占位任务',
        status: 'idle',
        stage: '等待阅读器接入',
        timestamp: now,
      }),
      this.createTask({
        agentKey: 'paper-analysis',
        title: '单篇分析演示任务',
        status: 'queued',
        stage: '等待执行',
        timestamp: now,
      }),
      this.createTask({
        agentKey: 'topic-tracking',
        title: '主题追踪占位任务',
        status: 'idle',
        stage: '等待主题配置',
        timestamp: now,
      }),
    ];
  }

  public async runDemoAgent(title: string): Promise<AgentRunResult> {
    const result = await this.runPipeline({
      agentKey: 'demo-runtime',
      title,
      initialStage: '等待编排',
      initialMessage: '已创建 Runtime 演示任务，等待进入执行链。',
      completionStage: '流程完成',
      completionSummary: 'LangChain Agent Runtime 基础流程已联通，可继续扩展节点与工具。',
      initialData: {
        title,
      },
      stages: [
        {
          stage: '任务初始化',
          run: async (context) => ({
            data: context.data,
            message: '已创建基础任务状态，准备收集论文上下文。',
          }),
        },
        {
          stage: '上下文装配',
          run: async (context) => ({
            data: context.data,
            message: '已预留论文元数据、阅读上下文与联网工具的注入位置。',
          }),
        },
        {
          stage: '结果收敛',
          run: async (context) => ({
            data: context.data,
            message: '示例工作流执行完成，适合作为后续多任务编排模板。',
          }),
        },
      ],
    });

    return {
      task: result.task,
      timeline: result.timeline,
    };
  }

  public async runReaderQaAgent(input: ReaderQaAgentInput): Promise<ReaderQaAgentResult> {
    const result = await this.runPipeline<ReaderQaAgentData>({
      agentKey: 'reader-qa',
      title: `阅读问答：${input.paper.title}`,
      initialStage: '收集阅读上下文',
      initialMessage: `已接收阅读器问题，准备整理第 ${input.currentPage} 页附近的阅读上下文。`,
      completionStage: '生成完成',
      completionSummary: (data) =>
        data.internetContext?.isAvailable
          ? '阅读问答已结合 PDF 正文、阅读上下文与联网补充资料生成回复。'
          : data.textContext?.isAvailable
            ? '阅读问答已结合 PDF 正文、当前页、批注与笔记生成回复。'
            : '阅读问答已结合当前论文摘要、批注与笔记生成回复。',
      initialData: {
        ...input,
        annotations: [],
        noteSnippet: '',
        promptMessages: [],
        answer: '',
        references: [],
        usedModel: false,
        modelName: null,
      },
      stages: [
        {
          stage: '收集阅读上下文',
          run: async (context) => {
            const annotations = context.data.session.annotations
              .slice(0, 3)
              .map((annotation) => `第 ${annotation.pageNumber} 页「${annotation.quote.slice(0, 40)}」`);
            const noteSnippet = context.data.session.note.trim().slice(0, 160);
            const textContextSummary = context.data.textContext?.isAvailable
              ? `已载入当前页正文、附近页正文与 ${context.data.textContext.relevantChunks.length} 段相关正文。`
              : `PDF 正文暂不可用：${context.data.textContext?.failureReason ?? '尚未建立正文索引。'}`;
            const internetContextSummary = context.data.internetContext?.isAvailable
              ? `已补充 ${context.data.internetContext.hits.length} 条联网资料${context.data.internetContext.repository ? '和 1 个候选代码仓库' : ''}。`
              : context.data.internetContext?.shouldSearch
                ? `联网补充暂不可用：${context.data.internetContext.failureReason ?? '未找到可用资料。'}`
                : '本问题未触发联网补充。';
            const alphaxivContextSummary = context.data.alphaxivOverview
              ? '已载入 alphaXiv 社区 AI 概述。'
              : '';

            return {
              data: {
                ...context.data,
                annotations,
                noteSnippet,
              },
              message: `已载入论文摘要、当前第 ${context.data.currentPage} 页与 ${annotations.length} 条最近批注。${textContextSummary}${internetContextSummary}${alphaxivContextSummary}`,
            };
          },
        },
        {
          stage: '构造模型提示',
          run: async (context) => {
            const promptMessages = this.buildReaderQaPrompt(context.data);

            return {
              data: {
                ...context.data,
                promptMessages,
              },
              message: '已将论文摘要、PDF 正文、联网补充、阅读笔记、最近批注与历史对话整理为模型提示。',
            };
          },
        },
        {
          stage: '调用模型生成回答',
          run: async (context) => {
            const modelConfig = this.options.getAiModelConfig?.();
            const client = modelConfig ? new AiModelClient(modelConfig, { fetchImpl: this.fetchImpl }) : null;
            const references = this.buildReaderQaReferences(context.data);

            if (client?.isConfigured()) {
              try {
                const result = await client.chatStream({
                  messages: context.data.promptMessages,
                  temperature: 0.2,
                  maxTokens: 900,
                }, context.data.onDelta);

                return {
                  data: {
                    ...context.data,
                    answer: result.content,
                    references,
                    usedModel: true,
                    modelName: result.model,
                  },
                  message: `已通过 ${result.model} 生成阅读回答。`,
                  summary: `阅读问答已调用模型 ${result.model}。`,
                  metadata: {
                    model: result.model,
                    usedModel: true,
                  },
                };
              } catch (error) {
                const answer = this.buildReaderQaFallbackAnswer(context.data, error);

                return {
                  data: {
                    ...context.data,
                    answer,
                    references,
                    usedModel: false,
                    modelName: modelConfig?.model ?? null,
                  },
                  message: `模型调用失败，已使用本地阅读上下文兜底生成回答：${error instanceof Error ? error.message : '未知错误'}`,
                  summary: '模型调用失败，已使用本地兜底回答。',
                  metadata: {
                    model: modelConfig?.model ?? '',
                    usedModel: false,
                  },
                };
              }
            }

            return {
              data: {
                ...context.data,
                answer: this.buildReaderQaFallbackAnswer(context.data),
                references,
                usedModel: false,
                modelName: null,
              },
              message: '设置页尚未配置可用模型，已使用本地阅读上下文兜底生成回答。',
              summary: '阅读问答已使用本地兜底回答。',
              metadata: {
                usedModel: false,
              },
            };
          },
        },
        {
          stage: '生成完成',
          run: async (context) => ({
            data: context.data,
            message: '阅读问答回复已生成并返回到阅读器面板。',
          }),
        },
      ],
    });

    return {
      answer: result.data.answer,
      references: result.data.references,
      task: result.task,
      timeline: result.timeline,
    };
  }

  public createTask(draft: AgentTaskDraft): AgentTaskRecord {
    return {
      id: `${draft.agentKey}-${draft.timestamp}`,
      title: draft.title,
      agentKey: draft.agentKey,
      runtime: 'langchain',
      status: draft.status,
      stage: draft.stage,
      createdAt: draft.timestamp,
      updatedAt: draft.timestamp,
      summary: draft.summary,
      metadata: draft.metadata,
    };
  }

  public updateTask(
    task: AgentTaskRecord,
    status: AgentTaskStatus,
    stage: string,
    summary?: string,
    metadata?: Record<string, string | number | boolean | null>,
  ): AgentTaskRecord {
    return {
      ...task,
      agentKey: task.agentKey,
      runtime: 'langchain',
      status,
      stage,
      updatedAt: new Date().toISOString(),
      summary: summary ?? task.summary,
      metadata: metadata ? { ...(task.metadata ?? {}), ...metadata } : task.metadata,
    };
  }

  private buildReaderQaPrompt(input: ReaderQaAgentData): AiChatMessage[] {
    const activeAssistantSession =
      input.session.assistantSessions.find((assistantSession) => assistantSession.id === input.session.currentAssistantSessionId)
      ?? input.session.assistantSessions[0]
      ?? null;
    const recentConversation = activeAssistantSession?.conversation.slice(-6) ?? [];
    const conversationContext = recentConversation.length
      ? recentConversation
          .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${this.truncateText(message.content, 220)}`)
          .join('\n')
      : '暂无历史对话。';

    return [
      {
        role: 'system',
        content: [
          '你是一个严谨的论文阅读助手，帮助用户在阅读 PDF 时理解论文。',
          '回答必须基于给定上下文，区分论文内容、用户笔记和你的推断。',
          '如果使用联网补充资料，必须明确说明它是外部背景、相关工作或通用网页资料，不能把它误写成当前论文原文结论。',
          '如果上下文不足，请明确说明缺口，并给出下一步应该查看的页码、段落或实验信息。',
          '回答使用中文，结构清晰，避免编造论文中没有出现的细节。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `论文标题：${input.paper.title}`,
          `作者：${input.paper.authors.join('、') || '未知'}`,
          `来源：${input.paper.sourceLabel}`,
          `发布时间：${input.paper.publishedAt}`,
          `当前页：第 ${input.currentPage} 页`,
          '',
          `论文摘要：${this.truncateText(input.paper.abstract || '暂无摘要。', 1200)}`,
          '',
          `PDF 当前页正文：${input.textContext?.currentPageText || '当前页正文暂不可用。'}`,
          '',
          `PDF 附近页正文：${input.textContext?.nearbyPageText || '附近页正文暂不可用。'}`,
          '',
          `相关正文段落：${this.formatRelevantChunks(input.textContext)}`,
          '',
          `联网补充资料：${this.formatInternetContext(input.internetContext)}`,
          '',
          input.alphaxivOverview ? `${input.alphaxivOverview}\n` : '',
          `最近批注：${input.annotations.length ? input.annotations.join('\n') : '暂无批注。'}`,
          '',
          `阅读笔记：${input.noteSnippet || '暂无阅读笔记。'}`,
          '',
          `最近对话：\n${conversationContext}`,
          '',
          `用户问题：${input.question.trim()}`,
          '',
          '请回答用户问题，并在最后给出 2-3 个适合继续追问的问题。',
        ].join('\n'),
      },
    ];
  }

  private buildReaderQaReferences(input: ReaderQaAgentData): string[] {
    const textReferences = input.textContext?.isAvailable
      ? [
          input.textContext.currentPageText ? `第 ${input.currentPage} 页正文` : '',
          ...input.textContext.relevantChunks.map((chunk) => `相关段落：第 ${chunk.pageStart} 页`),
        ]
      : [];
    const internetReferences = input.internetContext?.isAvailable
      ? [
          ...input.internetContext.hits.slice(0, 3).map((hit) =>
            `${input.internetContext?.intent === 'general-web' ? '网页' : '联网'}：${hit.source} · ${hit.title}`,
          ),
          input.internetContext.repository ? `代码仓库：${input.internetContext.repository.name}` : '',
        ]
      : [];

    return Array.from(
      new Set([
        `第 ${input.currentPage} 页`,
        ...textReferences,
        ...internetReferences,
        input.annotations[0] ?? '论文摘要',
        input.noteSnippet ? '阅读笔记' : '',
      ].filter(Boolean)),
    );
  }

  private buildReaderQaFallbackAnswer(input: ReaderQaAgentData, error?: unknown): string {
    const answerSections = [
      `围绕你的问题“${input.question.trim()}”，我先结合当前论文《${input.paper.title}》进行回答。`,
      input.paper.abstract
        ? `摘要信息显示：${this.truncateText(input.paper.abstract.trim(), 220)}`
        : '当前论文暂未提供摘要，因此我主要依据本地批注与阅读笔记组织回答。',
      input.textContext?.currentPageText
        ? `当前页正文线索：${this.truncateText(input.textContext.currentPageText, 320)}`
        : `当前页正文暂不可用${input.textContext?.failureReason ? `：${input.textContext.failureReason}` : '。'}`,
      input.internetContext?.isAvailable
        ? `联网补充线索：${this.formatInternetContext(input.internetContext)}`
        : input.internetContext?.shouldSearch
          ? `本问题尝试过联网补充，但暂未获取可用资料：${input.internetContext.failureReason ?? '无结果'}`
          : '本问题未触发联网补充，回答主要基于本地论文上下文。',
      input.annotations.length
        ? `最近批注重点包括：${input.annotations.join('；')}。`
        : '你还没有在当前论文中保存批注，后续可以先划线再继续追问，以便我结合更具体的段落回答。',
      input.noteSnippet
        ? `你的阅读笔记补充为：${input.noteSnippet}${input.session.note.length > input.noteSnippet.length ? '...' : ''}`
        : '当前尚无阅读笔记，我建议把方法贡献、实验设置或疑问点记在右侧笔记区。',
      '如果你希望更精确，我建议继续追问“作者的核心假设是什么”“这一页公式如何推导”或“和某篇基线方法相比差异在哪里”。',
    ];

    if (error) {
      answerSections.unshift(
        `模型调用暂时不可用（${error instanceof Error ? error.message : '未知错误'}），下面是基于本地阅读上下文生成的兜底回答。`,
      );
    }

    return answerSections.join('\n\n');
  }

  private formatRelevantChunks(textContext: ReaderTextContext | undefined): string {
    if (!textContext?.relevantChunks.length) {
      return textContext?.failureReason ? `暂无相关正文段落，原因：${textContext.failureReason}` : '暂无相关正文段落。';
    }

    return textContext.relevantChunks
      .map((chunk, index) => {
        const pageLabel = chunk.pageStart === chunk.pageEnd ? `第 ${chunk.pageStart} 页` : `第 ${chunk.pageStart}-${chunk.pageEnd} 页`;
        return `${index + 1}. ${pageLabel}：${this.truncateText(chunk.text, 900)}`;
      })
      .join('\n');
  }

  private formatInternetContext(internetContext: ReaderInternetContext | undefined): string {
    if (!internetContext?.shouldSearch) {
      return '本问题未触发联网补充。';
    }

    if (!internetContext.isAvailable) {
      return internetContext.failureReason ? `联网补充暂不可用：${internetContext.failureReason}` : '联网补充没有返回可用资料。';
    }

    const intentLabel = internetContext.intent === 'general-web' ? '通用网页搜索' : '论文相关外部资料';
    const hitLines = internetContext.hits.slice(0, 5).map((hit, index) => {
      const publishedAt = hit.publishedAt ? `，发布时间 ${hit.publishedAt}` : '';
      return `${index + 1}. [${hit.source}] ${hit.title}${publishedAt}：${this.truncateText(hit.snippet, 220)} URL: ${hit.url}`;
    });
    const repositoryLine = internetContext.repository
      ? `候选代码仓库：${internetContext.repository.name}（${internetContext.repository.language ?? '未知语言'}，stars: ${internetContext.repository.stars ?? '未知'}）- ${internetContext.repository.description} URL: ${internetContext.repository.url}`
      : '';

    return [`检索意图：${intentLabel}`, ...hitLines, repositoryLine].filter(Boolean).join('\n');
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength).trimEnd()}...`;
  }

  /**
   * @function createLoopTaskData
   * @description 将自治 Agent 当前状态与结果打包为统一的任务钩子载荷。
   * @param {TGoal} goal 当前运行目标
   * @param {AgentLoopState<TGoal>} state 当前自治循环状态
   * @param {TResult | null} result 当前已生成的结果
   * @returns {AgentLoopTaskData<TGoal, TResult>} 供任务钩子消费的数据
   */
  private createLoopTaskData<TGoal, TResult>(
    goal: TGoal,
    state: AgentLoopState<TGoal>,
    result: TResult | null,
  ): AgentLoopTaskData<TGoal, TResult> {
    return {
      goal,
      state,
      result,
    };
  }

  /**
   * @function buildLoopToolDescriptors
   * @description 将工具定义转换为 planner 可见的元信息，并追加结束动作描述。
   * @param {AgentTool[]} tools 当前 Agent 可用工具数组
   * @returns {LoopAgentToolDescriptor[]} 工具描述数组
   */
  private buildLoopToolDescriptors<TGoal>(tools: AgentTool<TGoal>[]): LoopAgentToolDescriptor[] {
    return [
      ...tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      getFinishAnswerToolDescriptor(),
    ];
  }

  /**
   * @function emitAnswerDelta
   * @description 在最终回答生成后按小块回放增量文本，兼容现有阅读器流式渲染链路。
   * @param {string} answer 最终回答文本
   * @param {(delta: string) => void | undefined} onDelta 渲染层增量回调
   * @returns {void} 无返回值
   */
  private emitAnswerDelta(answer: string, onDelta?: (delta: string) => void): void {
    if (!onDelta || !answer.trim()) {
      return;
    }

    // 关键逻辑：自治 Agent 当前的最终回答以非流式生成，因此这里按片段回放以复用原有 UI 更新机制。
    const chunkSize = 96;
    for (let offset = 0; offset < answer.length; offset += chunkSize) {
      onDelta(answer.slice(offset, offset + chunkSize));
    }
  }

  /**
   * @function callPlannerActionWithRetry
   * @description 调用 planner 并在空响应或 JSON 非法时自动追加一次修复提示进行重试。
   * @param {AiModelClient} plannerClient 当前 planner 使用的模型客户端
   * @param {AiChatMessage[]} plannerMessages 本轮 planner 的消息数组
   * @param {string[]} allowedActions 当前 Agent 允许的动作列表
   * @returns {Promise<AgentAction>} 通过校验的 planner 动作
   */
  private async callPlannerActionWithRetry(
    plannerClient: AiModelClient,
    plannerMessages: AiChatMessage[],
    allowedActions: string[],
  ): Promise<AgentAction> {
    let lastError: unknown = null;
    let repairMessages = plannerMessages;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const plannerReply = await plannerClient.chat({
          messages: repairMessages,
          temperature: 0.1,
          maxTokens: 900,
        });

        return parsePlannerAction(plannerReply.content, allowedActions);
      } catch (error) {
        lastError = error;
        if (attempt >= 2) {
          break;
        }

        // 关键逻辑：planner 首次输出为空或 JSON 非法时，补一轮强约束提示，避免自治链路直接中断。
        repairMessages = [
          ...plannerMessages,
          {
            role: 'user',
            content: [
              '你上一轮没有返回合法动作。',
              `错误原因：${error instanceof Error ? error.message : '未知错误'}`,
              '请严格只返回一个 JSON 对象，不要输出解释、Markdown、代码块或空字符串。',
              '合法格式示例：{"thought":"...","action":"search_paper_text","input":{"query":"..."}}',
            ].join('\n'),
          },
        ];
      }
    }

    throw lastError instanceof Error ? lastError : new Error('planner 修复重试后仍未返回合法动作。');
  }

  /**
   * @function runLoopAgent
   * @description 运行一条由模型自主选择工具的自治 Agent 循环。
   * @param {LoopAgentRunOptions<TGoal, TResult>} options 自治 Agent 运行配置
   * @returns {Promise<AgentLoopResult<TGoal, TResult>>} 任务、时间线与最终结果
   */
  public async runLoopAgent<TGoal, TResult>(options: LoopAgentRunOptions<TGoal, TResult>): Promise<AgentLoopResult<TGoal, TResult>> {
    const modelConfig = this.options.getAiModelConfig?.();
    const plannerClient = modelConfig ? new AiModelClient(modelConfig, { fetchImpl: this.fetchImpl }) : null;

    if (!plannerClient?.isConfigured()) {
      throw new Error('自治 Agent 需要先在设置页配置可用 AI 模型。');
    }

    let task = this.createTask({
      agentKey: options.agentKey,
      title: options.title,
      status: 'queued',
      stage: options.initialStage,
      timestamp: new Date().toISOString(),
    });
    let timeline: AgentTimelineEntry[] = [
      {
        stage: options.initialStage,
        message: options.initialMessage,
      },
    ];
    let state = options.spec.buildInitialState(options.goal);
    let result: TResult | null = null;
    const toolMap = new Map(options.tools.map((tool) => [tool.name, tool]));
    const toolDescriptors = this.buildLoopToolDescriptors(options.tools);

    await options.onTaskChange?.(task, this.createLoopTaskData(options.goal, state, result));
    await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));

    try {
      while (!state.finished) {
        const nextStepIndex = state.stepIndex + 1;
        if (hasReachedLoopLimit(nextStepIndex, options.spec.maxSteps)) {
          throw new Error(`自治 Agent 已达到最大步数 ${options.spec.maxSteps}。`);
        }

        task = this.updateTask(task, 'running', `Step ${nextStepIndex}`, `自治 Agent 正在规划第 ${nextStepIndex} 步动作。`);
        await options.onTaskChange?.(task, this.createLoopTaskData(options.goal, state, result));

        const plannerMessages = options.spec.buildPlannerMessages(state, toolDescriptors);
        const plannerAction = await this.callPlannerActionWithRetry(
          plannerClient,
          plannerMessages,
          options.spec.allowedTools,
        );

        if (isRepeatedAction(state, plannerAction)) {
          throw new Error('planner 连续输出重复动作，已中止本轮自治循环。');
        }

        timeline = [
          ...timeline,
          {
            stage: `Step ${nextStepIndex} · 规划`,
            message: `模型选择动作 ${plannerAction.action}。`,
          },
        ];
        await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));

        if (plannerAction.action === FINISH_ANSWER_TOOL_NAME) {
          const finalAnswer = typeof plannerAction.input.answer === 'string' && plannerAction.input.answer.trim()
            ? plannerAction.input.answer.trim()
            : plannerAction.finalAnswer?.trim() ?? '';

          if (!finalAnswer) {
            throw new Error('finish_answer 动作缺少有效回答内容。');
          }

          const actionReferences = Array.isArray(plannerAction.input.references)
            ? plannerAction.input.references.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [];

          state = {
            ...state,
            stepIndex: nextStepIndex,
            scratchpad: [
              ...state.scratchpad,
              `step ${nextStepIndex} finish_answer:${JSON.stringify(plannerAction.input)}`,
            ],
            references: Array.from(new Set([...state.references, ...actionReferences])),
            finalAnswer,
            finished: true,
          };
          this.emitAnswerDelta(finalAnswer, options.onDelta);

          timeline = [
            ...timeline,
            {
              stage: `Step ${nextStepIndex} · 完成`,
              message: '模型已生成最终回答并结束自治循环。',
            },
          ];
          await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));
          break;
        }

        const tool = toolMap.get(plannerAction.action);
        if (!tool) {
          throw new Error(`未找到自治 Agent 工具：${plannerAction.action}。`);
        }

        timeline = [
          ...timeline,
          {
            stage: `Step ${nextStepIndex} · 执行`,
            message: `开始执行工具 ${tool.name}。`,
          },
        ];
        await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));

        const toolResult = await tool.execute(plannerAction.input, {
          goal: options.goal,
          state,
        });
        state = {
          ...state,
          stepIndex: nextStepIndex,
          observations: [
            ...state.observations,
            {
              tool: tool.name,
              ok: toolResult.ok,
              summary: toolResult.summary,
              data: toolResult.data,
              references: toolResult.references,
            },
          ],
          scratchpad: [
            ...state.scratchpad,
            `step ${nextStepIndex} ${plannerAction.action}:${JSON.stringify(plannerAction.input)} => ${toolResult.summary}`,
          ],
          references: Array.from(new Set([...state.references, ...(toolResult.references ?? [])])),
        };

        timeline = [
          ...timeline,
          {
            stage: `Step ${nextStepIndex} · 观察`,
            message: toolResult.summary,
          },
        ];
        task = this.updateTask(task, 'running', `Step ${nextStepIndex}`, toolResult.summary);
        await options.onTaskChange?.(task, this.createLoopTaskData(options.goal, state, result));
        await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));
      }

      result = options.spec.buildResult(state);
      const completionSummary = typeof options.completionSummary === 'function'
        ? options.completionSummary(state, result)
        : options.completionSummary;
      task = this.updateTask(task, 'completed', options.completionStage, completionSummary);

      await options.onTaskChange?.(task, this.createLoopTaskData(options.goal, state, result));
      await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));

      return {
        task,
        timeline,
        state,
        result,
      };
    } catch (error) {
      result = options.spec.buildFallbackResult(state, error);
      if (result && typeof result === 'object' && 'answer' in (result as Record<string, unknown>)) {
        const maybeAnswer = (result as Record<string, unknown>).answer;
        if (typeof maybeAnswer === 'string') {
          state = {
            ...state,
            finalAnswer: maybeAnswer,
          };
          this.emitAnswerDelta(maybeAnswer, options.onDelta);
        }
      }

      timeline = [
        ...timeline,
        {
          stage: '降级完成',
          message: error instanceof Error ? error.message : '自治 Agent 已降级为兜底回答。',
        },
      ];
      task = this.updateTask(
        task,
        'completed',
        options.completionStage,
        error instanceof Error ? `自治 Agent 已降级完成：${error.message}` : '自治 Agent 已降级完成。',
      );

      await options.onError?.(task, error, this.createLoopTaskData(options.goal, state, result));
      await options.onTaskChange?.(task, this.createLoopTaskData(options.goal, state, result));
      await options.onTimelineChange?.(timeline, this.createLoopTaskData(options.goal, state, result));

      return {
        task,
        timeline,
        state,
        result,
      };
    }
  }

  public async runPipeline<TData>(options: AgentPipelineOptions<TData>): Promise<AgentPipelineResult<TData>> {
    let task = this.createTask({
      agentKey: options.agentKey,
      title: options.title,
      status: 'queued',
      stage: options.initialStage,
      timestamp: new Date().toISOString(),
    });
    let timeline: AgentTimelineEntry[] = [
      {
        stage: options.initialStage,
        message: options.initialMessage,
      },
    ];

    await options.onTaskChange?.(task, options.initialData);
    await options.onTimelineChange?.(timeline, options.initialData);

    const sequence = new RunnableLambda<AgentPipelineResult<TData>, AgentPipelineResult<TData>>({
      func: async (context: AgentPipelineResult<TData>) => {
        let currentContext = context;

        for (const stage of options.stages) {
          task = this.updateTask(task, 'running', stage.stage);
          await options.onTaskChange?.(task, currentContext.data);

          const stageResult = await stage.run({
            task,
            timeline,
            data: currentContext.data,
          });

          const nextData = stageResult.data ?? currentContext.data;
          const nextTimeline = [
            ...currentContext.timeline,
            {
              stage: stage.stage,
              message: stageResult.message,
            },
          ];
          const nextTask = stageResult.summary || stageResult.metadata
            ? this.updateTask(task, 'running', stage.stage, stageResult.summary, stageResult.metadata)
            : task;

          task = nextTask;
          timeline = nextTimeline;

          await options.onTaskChange?.(task, nextData);
          await options.onTimelineChange?.(timeline, nextData);

          currentContext = {
            task,
            timeline,
            data: nextData,
          };
        }

        return currentContext;
      },
    });

    try {
      const result = await sequence.invoke({
        task,
        timeline,
        data: options.initialData,
      });
      const summary = typeof options.completionSummary === 'function'
        ? options.completionSummary(result.data)
        : options.completionSummary;

      task = this.updateTask(result.task, 'completed', options.completionStage, summary);
      timeline = result.timeline;

      await options.onTaskChange?.(task, result.data);
      await options.onTimelineChange?.(timeline, result.data);

      return {
        task,
        timeline,
        data: result.data,
      };
    } catch (error) {
      const failedTask = this.updateTask(
        task,
        'failed',
        '执行失败',
        error instanceof Error ? error.message : 'Agent Runtime 执行失败',
      );

      await options.onError?.(failedTask, error, options.initialData);
      await options.onTaskChange?.(failedTask, options.initialData);

      throw error;
    }
  }
}
