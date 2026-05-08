import type { LoopAgentToolDescriptor } from '../specTypes';

export const FINISH_ANSWER_TOOL_NAME = 'finish_answer';

/**
 * @function getFinishAnswerToolDescriptor
 * @description 返回自治 Agent 用于结束循环并输出最终回答的虚拟工具描述。
 * @returns {LoopAgentToolDescriptor} finish_answer 的工具元信息
 */
export function getFinishAnswerToolDescriptor(): LoopAgentToolDescriptor {
  return {
    name: FINISH_ANSWER_TOOL_NAME,
    description: '在证据已经充分时结束自治循环，并在 finalAnswer 中返回最终中文回答与引用。',
    inputSchema: '{"answer":"string","references":["string"]}',
  };
}
