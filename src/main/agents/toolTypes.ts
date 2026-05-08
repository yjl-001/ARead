import type { AgentLoopState } from './loopTypes';

/**
 * @function AgentToolResult
 * @description 约束自治 Agent 工具执行后的统一输出格式。
 * @returns {void} 类型声明无返回值
 */
export interface AgentToolResult<TOutput = unknown> {
  ok: boolean;
  summary: string;
  data?: TOutput;
  references?: string[];
}

/**
 * @function AgentToolContext
 * @description 向工具暴露当前目标与自治循环状态，避免工具直接感知 Runtime 实现。
 * @returns {void} 类型声明无返回值
 */
export interface AgentToolContext<TGoal = unknown> {
  goal: TGoal;
  state: AgentLoopState<TGoal>;
}

/**
 * @class AgentTool
 * @description 定义自治 Agent 可调用工具的名称、描述、参数约束与执行函数。
 * @returns {void} 类型声明无返回值
 */
export interface AgentTool<TGoal = unknown, TInput = Record<string, unknown>, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: string;
  execute: (input: TInput, context: AgentToolContext<TGoal>) => Promise<AgentToolResult<TOutput>>;
}
