import { RunnableLambda } from '@langchain/core/runnables';

import type {
  AgentDefinition,
  AgentRunResult,
  AgentTaskRecord,
  AgentTaskStatus,
  AgentTimelineEntry,
  PaperRecord,
  ReaderSession,
} from '@shared/types';

import { agentCatalog } from './agentCatalog';
import type {
  AgentPipelineOptions,
  AgentPipelineResult,
  AgentTaskDraft,
} from './runtimeTypes';

interface ReaderQaAgentInput {
  paper: PaperRecord;
  session: ReaderSession;
  question: string;
  currentPage: number;
}

interface ReaderQaAgentData extends ReaderQaAgentInput {
  annotations: string[];
  noteSnippet: string;
  answer: string;
  references: string[];
}

interface ReaderQaAgentResult extends AgentRunResult {
  answer: string;
  references: string[];
}

export class AgentRuntimeService {
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
      completionSummary: '阅读问答已结合当前论文摘要、批注与笔记生成回复。',
      initialData: {
        ...input,
        annotations: [],
        noteSnippet: '',
        answer: '',
        references: [],
      },
      stages: [
        {
          stage: '收集阅读上下文',
          run: async (context) => {
            const annotations = context.data.session.annotations
              .slice(0, 3)
              .map((annotation) => `第 ${annotation.pageNumber} 页「${annotation.quote.slice(0, 40)}」`);
            const noteSnippet = context.data.session.note.trim().slice(0, 160);

            return {
              data: {
                ...context.data,
                annotations,
                noteSnippet,
              },
              message: `已载入论文摘要、当前第 ${context.data.currentPage} 页与 ${annotations.length} 条最近批注。`,
            };
          },
        },
        {
          stage: '组装回答',
          run: async (context) => {
            const answerSections = [
              `围绕你的问题“${context.data.question.trim()}”，我先结合当前论文《${context.data.paper.title}》进行回答。`,
              context.data.paper.abstract
                ? `摘要信息显示：${context.data.paper.abstract.trim().slice(0, 220)}${context.data.paper.abstract.length > 220 ? '...' : ''}`
                : '当前论文暂未提供摘要，因此我主要依据本地批注与阅读笔记组织回答。',
              context.data.annotations.length
                ? `最近批注重点包括：${context.data.annotations.join('；')}。`
                : '你还没有在当前论文中保存批注，后续可以先划线再继续追问，以便我结合更具体的段落回答。',
              context.data.noteSnippet
                ? `你的阅读笔记补充为：${context.data.noteSnippet}${context.data.session.note.length > context.data.noteSnippet.length ? '...' : ''}`
                : '当前尚无阅读笔记，我建议把方法贡献、实验设置或疑问点记在右侧笔记区。',
              '如果你希望更精确，我建议继续追问“作者的核心假设是什么”“这一页公式如何推导”或“和某篇基线方法相比差异在哪里”。',
            ];
            const answer = answerSections.join('\n\n');
            const references = [
              `第 ${context.data.currentPage} 页`,
              context.data.annotations[0] ?? '论文摘要',
            ];

            return {
              data: {
                ...context.data,
                answer,
                references,
              },
              message: '已将论文摘要、阅读笔记与历史对话压缩为回答草稿。',
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
