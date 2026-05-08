import type { ReaderChatMessage, ReaderSession } from '@shared/types';

import type { PaperTextIndexService } from '../../reader/PaperTextIndexService';
import type { AgentTool } from '../toolTypes';
import type { ReaderQaGoal } from '../specs/readerQaAgent';

interface ReaderToolDependencies {
  paperTextIndexService: PaperTextIndexService;
}

/**
 * @function formatConversationMessages
 * @description 将最近对话裁剪成适合 planner 消费的精简结构。
 * @param {ReaderChatMessage[]} messages 最近会话消息
 * @returns {Array<{ role: string; content: string }>} 精简后的对话数组
 */
function formatConversationMessages(messages: ReaderChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.trim().slice(0, 220),
  }));
}

/**
 * @function getActiveAssistantConversation
 * @description 从阅读会话中解析当前活跃 AI 会话的最近消息。
 * @param {ReaderSession} session 当前阅读会话
 * @returns {ReaderChatMessage[]} 当前 AI 会话的最近消息
 */
function getActiveAssistantConversation(session: ReaderSession): ReaderChatMessage[] {
  const activeAssistantSession =
    session.assistantSessions.find((assistantSession) => assistantSession.id === session.currentAssistantSessionId)
    ?? session.assistantSessions[0]
    ?? null;

  return activeAssistantSession?.conversation.slice(-6) ?? [];
}

/**
 * @function createReaderTools
 * @description 为阅读问答自治 Agent 创建本地上下文与正文检索工具。
 * @param {ReaderToolDependencies} deps 阅读器工具依赖
 * @returns {AgentTool<ReaderQaGoal>[]} 阅读器工具数组
 */
export function createReaderTools(deps: ReaderToolDependencies): AgentTool<ReaderQaGoal>[] {
  return [
    {
      name: 'get_paper_metadata',
      description: '读取当前论文的标题、作者、摘要与来源信息。',
      inputSchema: '{}',
      async execute(_input, context) {
        const paper = context.goal.paper;
        return {
          ok: true,
          summary: `已读取论文《${paper.title}》的基础元数据。`,
          data: {
            title: paper.title,
            authors: paper.authors,
            abstract: paper.abstract.slice(0, 1200),
            sourceLabel: paper.sourceLabel,
            publishedAt: paper.publishedAt,
          },
          references: ['论文摘要'],
        };
      },
    },
    {
      name: 'get_recent_conversation',
      description: '读取当前阅读内 AI 会话最近几轮对话，帮助保持上下文连续性。',
      inputSchema: '{}',
      async execute(_input, context) {
        const conversation = formatConversationMessages(getActiveAssistantConversation(context.goal.session));
        return {
          ok: true,
          summary: `已读取 ${conversation.length} 条最近对话消息。`,
          data: conversation,
          references: conversation.length ? ['最近对话'] : [],
        };
      },
    },
    {
      name: 'get_recent_annotations',
      description: '读取当前论文最近批注，帮助定位用户关注的正文片段。',
      inputSchema: '{}',
      async execute(_input, context) {
        const annotations = context.goal.session.annotations.slice(0, 5).map((annotation) => ({
          pageNumber: annotation.pageNumber,
          quote: annotation.quote.trim().slice(0, 180),
          note: annotation.note.trim().slice(0, 180),
        }));
        return {
          ok: true,
          summary: `已读取 ${annotations.length} 条最近批注。`,
          data: annotations,
          references: annotations.map((annotation) => `第 ${annotation.pageNumber} 页批注`),
        };
      },
    },
    {
      name: 'get_reader_note_excerpt',
      description: '读取当前阅读笔记摘要，帮助理解用户已有想法和研究线索。',
      inputSchema: '{}',
      async execute(_input, context) {
        const note = context.goal.session.note.trim();
        return {
          ok: true,
          summary: note ? '已读取当前阅读笔记摘要。' : '当前阅读笔记为空。',
          data: {
            note: note.slice(0, 800),
          },
          references: note ? ['阅读笔记'] : [],
        };
      },
    },
    {
      name: 'search_paper_text',
      description: '围绕当前问题和页码读取 PDF 当前页、附近页与相关正文段落。',
      inputSchema: '{"query":"string","pageHint":"number?","paper":"当前论文自动注入"}',
      async execute(input, context) {
        const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : context.goal.question;
        const pageHint = typeof input.pageHint === 'number' ? input.pageHint : context.goal.currentPage;
        const textContext = await deps.paperTextIndexService.getReaderTextContext(context.goal.paper, pageHint, query);

        return {
          ok: textContext.isAvailable,
          summary: textContext.isAvailable
            ? `已读取第 ${pageHint} 页附近正文，并命中 ${textContext.relevantChunks.length} 段相关正文。`
            : `正文检索暂不可用：${textContext.failureReason ?? '未知原因'}`,
          data: textContext,
          references: textContext.isAvailable
            ? [
                textContext.currentPageText ? `第 ${pageHint} 页正文` : '',
                ...textContext.relevantChunks.map((chunk) => `相关段落：第 ${chunk.pageStart} 页`),
              ].filter(Boolean)
            : [],
        };
      },
    },
  ];
}
