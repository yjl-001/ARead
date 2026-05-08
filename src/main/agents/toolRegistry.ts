import type { AgentTool } from './toolTypes';

/**
 * @class AgentToolRegistry
 * @description 统一管理自治 Agent 工具注册与按白名单筛选。
 * @returns {AgentToolRegistry} 工具注册表实例
 */
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool<unknown>>();

  /**
   * @function register
   * @description 向注册表写入单个工具定义，重复名称会被后写入的工具覆盖。
   * @param {AgentTool} tool 需要注册的工具定义
   * @returns {void} 无返回值
   */
  public register<TGoal>(tool: AgentTool<TGoal>): void {
    this.tools.set(tool.name, tool as AgentTool<unknown>);
  }

  /**
   * @function registerAll
   * @description 批量注册一组工具，便于按业务域统一装配。
   * @param {AgentTool[]} tools 工具定义数组
   * @returns {void} 无返回值
   */
  public registerAll<TGoal>(tools: AgentTool<TGoal>[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * @function get
   * @description 按名称读取工具定义，未命中时返回 undefined。
   * @param {string} name 工具名称
   * @returns {AgentTool | undefined} 对应的工具定义
   */
  public get<TGoal>(name: string): AgentTool<TGoal> | undefined {
    return this.tools.get(name) as AgentTool<TGoal> | undefined;
  }

  /**
   * @function getAllowedTools
   * @description 按白名单返回可用工具，并自动忽略不存在的名称。
   * @param {string[]} names 允许暴露给当前 Agent 的工具名称
   * @returns {AgentTool[]} 按输入顺序过滤后的工具数组
   */
  public getAllowedTools<TGoal>(names: string[]): AgentTool<TGoal>[] {
    return names
      .map((name) => this.tools.get(name))
      .filter((tool): tool is AgentTool<unknown> => Boolean(tool)) as AgentTool<TGoal>[];
  }
}
