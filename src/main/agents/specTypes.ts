import type { AiChatMessage } from '../ai/AiModelClient';
import type { AgentLoopState } from './loopTypes';

/**
 * @function LoopAgentToolDescriptor
 * @description 提供给 planner 的工具元信息，帮助模型理解当前可调用动作。
 * @returns {void} 类型声明无返回值
 */
export interface LoopAgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: string;
}

/**
 * @class LoopAgentSpec
 * @description 定义自治 Agent 的目标、循环状态、planner 提示与结果收敛策略。
 * @returns {void} 类型声明无返回值
 */
export interface LoopAgentSpec<TGoal, TResult> {
  key: string;
  title: string;
  maxSteps: number;
  allowedTools: string[];
  buildInitialState: (goal: TGoal) => AgentLoopState<TGoal>;
  buildPlannerMessages: (state: AgentLoopState<TGoal>, tools: LoopAgentToolDescriptor[]) => AiChatMessage[];
  buildResult: (state: AgentLoopState<TGoal>) => TResult;
  buildFallbackResult: (state: AgentLoopState<TGoal>, error?: unknown) => TResult;
}
