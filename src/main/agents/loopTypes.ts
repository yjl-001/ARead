import type { AgentTaskRecord, AgentTimelineEntry } from '@shared/types';

/**
 * @function AgentAction
 * @description 定义模型在自治循环中输出的下一步动作。
 * @returns {void} 类型声明无返回值
 */
export interface AgentAction {
  thought: string;
  action: string;
  input: Record<string, unknown>;
  finalAnswer?: string | null;
}

/**
 * @function AgentObservation
 * @description 定义工具执行后回灌给模型的观察结果。
 * @returns {void} 类型声明无返回值
 */
export interface AgentObservation {
  tool: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  references?: string[];
}

/**
 * @function AgentLoopState
 * @description 维护一次自治 Agent 运行中的中间状态与可回放痕迹。
 * @returns {void} 类型声明无返回值
 */
export interface AgentLoopState<TGoal = unknown> {
  goal: TGoal;
  stepIndex: number;
  observations: AgentObservation[];
  scratchpad: string[];
  references: string[];
  finalAnswer: string | null;
  finished: boolean;
}

/**
 * @function AgentLoopTaskData
 * @description 汇总自治 Agent 运行期间用于任务钩子和诊断的轻量数据。
 * @returns {void} 类型声明无返回值
 */
export interface AgentLoopTaskData<TGoal, TResult> {
  goal: TGoal;
  state: AgentLoopState<TGoal>;
  result: TResult | null;
}

/**
 * @function AgentLoopHooks
 * @description 定义自治 Agent 运行过程中的任务、时间线和错误回调。
 * @returns {void} 类型声明无返回值
 */
export interface AgentLoopHooks<TGoal, TResult = unknown | null> {
  onTaskChange?: (task: AgentTaskRecord, data: AgentLoopTaskData<TGoal, TResult>) => Promise<void> | void;
  onTimelineChange?: (timeline: AgentTimelineEntry[], data: AgentLoopTaskData<TGoal, TResult>) => Promise<void> | void;
  onError?: (task: AgentTaskRecord, error: unknown, data: AgentLoopTaskData<TGoal, TResult>) => Promise<void> | void;
}

/**
 * @function AgentLoopResult
 * @description 定义自治 Agent 单次运行的最终产物与可观测结果。
 * @returns {void} 类型声明无返回值
 */
export interface AgentLoopResult<TGoal, TResult> {
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
  state: AgentLoopState<TGoal>;
  result: TResult;
}
