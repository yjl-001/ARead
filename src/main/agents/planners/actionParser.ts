import type { AgentAction } from '../loopTypes';
import { validateAgentAction } from './actionSchema';

/**
 * @function extractJsonPayload
 * @description 从模型文本输出中提取 JSON 片段，兼容纯 JSON 和 Markdown 代码块包装。
 * @param {string} rawContent 模型原始输出
 * @returns {string} 可能的 JSON 文本
 */
function extractJsonPayload(rawContent: string): string {
  const trimmedContent = rawContent.trim();

  if (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) {
    return trimmedContent;
  }

  const fencedMatch = trimmedContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = trimmedContent.indexOf('{');
  const lastBraceIndex = trimmedContent.lastIndexOf('}');

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return trimmedContent.slice(firstBraceIndex, lastBraceIndex + 1).trim();
  }

  return trimmedContent;
}

/**
 * @function parsePlannerAction
 * @description 解析并校验 planner 输出的动作对象，失败时抛出可读错误。
 * @param {string} rawContent 模型原始输出
 * @param {string[]} allowedActions 当前 Agent 允许执行的动作
 * @returns {AgentAction} 通过校验的动作对象
 */
export function parsePlannerAction(rawContent: string, allowedActions: string[]): AgentAction {
  const payload = extractJsonPayload(rawContent);
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(payload) as unknown;
  } catch {
    throw new Error('planner 输出无法解析为合法 JSON。');
  }

  const validationResult = validateAgentAction(parsedValue, allowedActions);
  if (!validationResult.ok || !validationResult.action) {
    throw new Error(validationResult.error ?? 'planner 输出未通过校验。');
  }

  return validationResult.action;
}
