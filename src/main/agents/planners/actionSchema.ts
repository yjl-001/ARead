import type { AgentAction } from '../loopTypes';

/**
 * @function validateAgentAction
 * @description 校验 planner 输出动作的结构与允许的动作名称，避免 Runtime 执行非法操作。
 * @param {unknown} value 待校验的原始动作数据
 * @param {string[]} allowedActions 当前 Agent 允许的动作名称列表
 * @returns {{ ok: boolean; action?: AgentAction; error?: string }} 校验结果
 */
export function validateAgentAction(
  value: unknown,
  allowedActions: string[],
): { ok: boolean; action?: AgentAction; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: 'planner 输出必须是 JSON 对象。',
    };
  }

  const candidate = value as Record<string, unknown>;
  const thought = typeof candidate.thought === 'string' ? candidate.thought.trim() : '';
  const action = typeof candidate.action === 'string' ? candidate.action.trim() : '';
  const input = candidate.input;
  const finalAnswer = candidate.finalAnswer;

  if (!thought) {
    return {
      ok: false,
      error: 'planner 输出缺少有效 thought 字段。',
    };
  }

  if (!action) {
    return {
      ok: false,
      error: 'planner 输出缺少有效 action 字段。',
    };
  }

  if (!allowedActions.includes(action)) {
    return {
      ok: false,
      error: `planner 输出了未授权动作：${action}。`,
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'planner 输出缺少合法的 input 对象。',
    };
  }

  if (!(finalAnswer === undefined || finalAnswer === null || typeof finalAnswer === 'string')) {
    return {
      ok: false,
      error: 'planner 输出的 finalAnswer 字段必须是字符串、null 或省略。',
    };
  }

  return {
    ok: true,
    action: {
      thought,
      action,
      input: input as Record<string, unknown>,
      finalAnswer: typeof finalAnswer === 'string' ? finalAnswer.trim() : finalAnswer ?? undefined,
    },
  };
}
