import type { ReaderInternetContextService } from '../../reader/ReaderInternetContextService';
import type { PaperTextIndexService } from '../../reader/PaperTextIndexService';
import type { AgentTool } from '../toolTypes';
import type { ReaderQaGoal } from '../specs/readerQaAgent';

interface InternetToolDependencies {
  paperTextIndexService: PaperTextIndexService;
  readerInternetContextService: ReaderInternetContextService;
}

/**
 * @function createInternetTools
 * @description 为阅读问答自治 Agent 创建联网补充工具，并自动复用本地正文上下文作为检索线索。
 * @param {InternetToolDependencies} deps 联网工具依赖
 * @returns {AgentTool<ReaderQaGoal>[]} 联网工具数组
 */
export function createInternetTools(deps: InternetToolDependencies): AgentTool<ReaderQaGoal>[] {
  return [
    {
      name: 'search_web_context',
      description: '按需检索论文外部背景、相关工作、代码仓库或通用网页资料。',
      inputSchema: '{"query":"string","pageHint":"number?"}',
      async execute(input, context) {
        const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : context.goal.question;
        const pageHint = typeof input.pageHint === 'number' ? input.pageHint : context.goal.currentPage;
        const textContext = await deps.paperTextIndexService.getReaderTextContext(context.goal.paper, pageHint, query);
        const internetContext = await deps.readerInternetContextService.collect(context.goal.paper, query, textContext);

        return {
          ok: internetContext.isAvailable,
          summary: internetContext.isAvailable
            ? `已获取 ${internetContext.hits.length} 条联网资料${internetContext.repository ? '，并找到候选代码仓库' : ''}。`
            : `联网补充暂不可用：${internetContext.failureReason ?? '未返回可用资料'}`,
          data: internetContext,
          references: [
            ...internetContext.hits.slice(0, 3).map((hit) => `${hit.source}：${hit.title}`),
            internetContext.repository ? `代码仓库：${internetContext.repository.name}` : '',
          ].filter(Boolean),
        };
      },
    },
  ];
}
