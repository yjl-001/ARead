import type { AgentAction, AgentLoopState } from '../loopTypes';

/**
 * @function hasReachedLoopLimit
 * @description 判断自治 Agent 是否已达到最大执行步数。
 * @param {number} stepIndex 当前即将执行的步数
 * @param {number} maxSteps 当前 Agent 允许的最大步数
 * @returns {boolean} 是否触发步数上限
 */
export function hasReachedLoopLimit(stepIndex: number, maxSteps: number): boolean {
  return stepIndex > maxSteps;
}

/**
 * @function isRepeatedAction
 * @description 检查当前动作是否与最近一次动作完全重复，避免陷入无意义循环。
 * @param {AgentLoopState} state 当前自治循环状态
 * @param {AgentAction} action 本轮 planner 决策出的动作
 * @returns {boolean} 是否判定为重复动作
 */
export function isRepeatedAction<TGoal>(state: AgentLoopState<TGoal>, action: AgentAction): boolean {
  const latestScratchpadEntry = state.scratchpad.at(-1) ?? '';
  const actionFingerprint = `${action.action}:${JSON.stringify(action.input)}`;
  return latestScratchpadEntry.includes(actionFingerprint);
}
