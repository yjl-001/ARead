import type { PaperRecord, ReaderSession } from '@shared/types';

import type { LoopAgentSpec, LoopAgentToolDescriptor } from '../specTypes';
import type { AgentLoopState } from '../loopTypes';
import { READER_QA_SYSTEM_PROMPT } from '../prompts/readerQaSystemPrompt';

export interface ReaderQaGoal {
  paper: PaperRecord;
  session: ReaderSession;
  question: string;
  currentPage: number;
  alphaxivOverview?: string;
}

export interface ReaderQaLoopResult {
  answer: string;
  references: string[];
}

/**
 * @function formatReaderQaObservations
 * @description 将自治 Agent 已获得的观察结果整理为 planner 易消费的文本摘要。
 * @param {AgentLoopState<ReaderQaGoal>} state 当前自治循环状态
 * @returns {string} 已格式化的观察结果文本
 */
function formatReaderQaObservations(state: AgentLoopState<ReaderQaGoal>): string {
  if (!state.observations.length) {
    return '暂无工具观察结果。';
  }

  return state.observations
    .map((observation, index) => `${index + 1}. 工具 ${observation.tool}：${observation.summary}`)
    .join('\n');
}

/**
 * @function buildReaderQaFallbackEvidence
 * @description 将自治 Agent 已获得的观察结果整理为更适合直接回答用户的证据摘要。
 * @param {AgentLoopState<ReaderQaGoal>} state 当前自治循环状态
 * @returns {string[]} 面向用户的证据摘要数组
 */
function buildReaderQaFallbackEvidence(state: AgentLoopState<ReaderQaGoal>): string[] {
  return state.observations.map((observation) => {
    const data = observation.data as {
      currentPageText?: string;
      nearbyPageText?: string;
      relevantChunks?: Array<{ pageStart: number; text: string }>;
      note?: string;
    } | undefined;

    if (observation.tool === 'search_paper_text' && data) {
      const pageText = typeof data.currentPageText === 'string' && data.currentPageText.trim()
        ? `当前页正文提到：${data.currentPageText.trim().slice(0, 180)}`
        : '';
      const relevantChunk = Array.isArray(data.relevantChunks) && data.relevantChunks.length
        ? `相关段落线索：第 ${data.relevantChunks[0]?.pageStart} 页 ${data.relevantChunks[0]?.text.trim().slice(0, 180)}`
        : '';
      return [pageText, relevantChunk].filter(Boolean).join('；') || observation.summary;
    }

    if (observation.tool === 'get_reader_note_excerpt' && data?.note) {
      return `你的阅读笔记中记录了：${data.note.trim().slice(0, 180)}`;
    }

    return observation.summary;
  }).filter(Boolean);
}

/**
 * @function formatReaderQaTools
 * @description 将可用工具列表整理为 planner 提示中的结构化描述。
 * @param {LoopAgentToolDescriptor[]} tools 当前 Agent 可调用的工具描述
 * @returns {string} 工具说明文本
 */
function formatReaderQaTools(tools: LoopAgentToolDescriptor[]): string {
  return tools.map((tool) => `- ${tool.name}: ${tool.description} | 输入: ${tool.inputSchema}`).join('\n');
}

/**
 * @function createReaderQaLoopSpec
 * @description 创建阅读问答自治 Agent 的规格定义。
 * @returns {LoopAgentSpec<ReaderQaGoal, ReaderQaLoopResult>} 阅读问答自治 Agent 规格
 */
export function createReaderQaLoopSpec(): LoopAgentSpec<ReaderQaGoal, ReaderQaLoopResult> {
  return {
    key: 'reader-qa',
    title: '阅读问答自治 Agent',
    maxSteps: 6,
    allowedTools: [
      'get_paper_metadata',
      'get_recent_conversation',
      'get_recent_annotations',
      'get_reader_note_excerpt',
      'search_paper_text',
      'search_web_context',
      'finish_answer',
    ],
    buildInitialState(goal) {
      return {
        goal,
        stepIndex: 0,
        observations: [],
        scratchpad: [],
        references: [],
        finalAnswer: null,
        finished: false,
      };
    },
    buildPlannerMessages(state, tools) {
      const contextParts = [
        `论文标题：${state.goal.paper.title}`,
        `作者：${state.goal.paper.authors.join('、') || '未知'}`,
        `来源：${state.goal.paper.sourceLabel}`,
        `当前页：第 ${state.goal.currentPage} 页`,
      ];

      if (state.goal.alphaxivOverview) {
        contextParts.push('', state.goal.alphaxivOverview);
      }

      return [
        {
          role: 'system',
          content: READER_QA_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            ...contextParts,
            '',
            `用户问题：${state.goal.question.trim()}`,
            '',
            `已获得观察：\n${formatReaderQaObservations(state)}`,
            '',
            `已执行痕迹：\n${state.scratchpad.length ? state.scratchpad.join('\n') : '暂无执行痕迹。'}`,
            '',
            `可用工具：\n${formatReaderQaTools(tools)}`,
            '',
            '如果证据已经足够，请调用 finish_answer，并在 input.references 中给出引用列表。',
          ].join('\n'),
        },
      ];
    },
    buildResult(state) {
      return {
        answer: state.finalAnswer?.trim() || '未生成有效回答。',
        references: Array.from(new Set(state.references)),
      };
    },
    buildFallbackResult(state, error) {
      const evidenceLines = buildReaderQaFallbackEvidence(state);
      const fallbackSections = [
        `围绕你的问题“${state.goal.question.trim()}”，我先基于已经拿到的论文线索给你一个阶段性回答。`,
        evidenceLines.length
          ? `当前可确认的证据包括：${evidenceLines.join('；')}`
          : `目前还没有拿到足够的论文证据${error instanceof Error ? `，本次中断原因为：${error.message}` : '。'}`,
        '从现有线索看，这个问题的精确定义仍需要结合更多正文上下文才能下结论。如果你愿意，可以继续追问具体页码、段落、公式或实验现象，我会沿着这条线继续检索。',
      ];

      return {
        answer: fallbackSections.join('\n\n'),
        references: Array.from(new Set(state.references)),
      };
    },
  };
}
