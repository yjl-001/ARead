import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentRuntimeService } from '../src/main/agents/AgentRuntimeService';
import { PaperAnalysisService } from '../src/main/analysis/PaperAnalysisService';
import { ExternalMediaServer } from '../src/main/integrations/ExternalMediaServer';
import { ExternalMediaService } from '../src/main/integrations/ExternalMediaService';
import { PaperService } from '../src/main/papers/PaperService';
import { ReaderService } from '../src/main/reader/ReaderService';
import { TopicTrackingService } from '../src/main/topics/TopicTrackingService';
import { WorkspaceService } from '../src/main/workspace/WorkspaceService';

/**
 * @function main
 * @description 验证工作区初始化与示例 Agent Runtime 链路是否可在无界面环境执行。
 * @returns {Promise<void>} 冒烟验证结果
 */
async function main(): Promise<void> {
  const tempWorkspace = await mkdtemp(path.join(os.tmpdir(), 'vibe-reading-'));
  let externalMediaServer: ExternalMediaServer | null = null;

  try {
    const workspaceService = new WorkspaceService(tempWorkspace);
    const agentRuntimeService = new AgentRuntimeService();
    const paperService = new PaperService(workspaceService.getDirectories(), {
      fetchImpl: mockFetch,
    });
    const readerService = new ReaderService(workspaceService.getDirectories(), paperService, agentRuntimeService);
    const paperAnalysisService = new PaperAnalysisService(
      workspaceService.getDirectories(),
      paperService,
      readerService,
      agentRuntimeService,
      {
        fetchImpl: mockFetch,
      },
    );
    const topicTrackingService = new TopicTrackingService(
      workspaceService.getDirectories(),
      paperService,
      paperAnalysisService,
      agentRuntimeService,
      {
        schedulerIntervalMs: 30_000,
      },
    );
    const externalMediaService = new ExternalMediaService(
      workspaceService.getDirectories(),
      paperService,
      paperAnalysisService,
    );
    externalMediaServer = new ExternalMediaServer(externalMediaService, {
      port: 0,
    });

    const workspace = await workspaceService.ensureWorkspace();
    await externalMediaServer.start();
    const agentRun = await agentRuntimeService.runDemoAgent('Smoke 测试 Agent');
    const searchResults = await paperService.search({
      query: 'graph rag',
      source: 'all',
      limit: 2,
    });
    const importedLibrary = await paperService.importPaper(searchResults[0]);
    const updatedLibrary = await paperService.updatePaper(searchResults[0].id, {
      status: 'indexed',
      readingStatus: 'reading',
      analysisStatus: 'queued',
      tags: ['图学习', 'RAG'],
      isFavorite: true,
    });
    const readerSession = await readerService.saveProgress(searchResults[0].id, {
      currentPage: 2,
      totalPages: 8,
      zoom: 1.2,
    });
    const annotatedSession = await readerService.addAnnotation(searchResults[0].id, {
      pageNumber: 2,
      quote: 'Graph retrieval augmented generation system',
      note: '这一段说明了系统整体结构。',
      color: 'yellow',
    });
    const notedSession = await readerService.saveNote(searchResults[0].id, '需要重点理解图构建策略与检索路径。');
    const assistantReply = await readerService.askAssistant({
      paperId: searchResults[0].id,
      question: '这篇论文的核心贡献是什么？',
      currentPage: 2,
    });
    const analysisResult = await paperAnalysisService.runAnalysis(searchResults[0].id);
    const analysisFollowup = await paperAnalysisService.askQuestion({
      paperId: searchResults[0].id,
      question: '代码实验为什么没有自动执行？',
    });
    const topicSnapshotAfterSave = await topicTrackingService.saveSubscription({
      name: 'Graph RAG',
      query: 'graph rag',
      description: '跟踪图检索增强生成方向的新论文。',
      scheduleTime: '08:30',
      enabled: true,
      maxResultsPerRun: 4,
    });
    const topicResult = await topicTrackingService.runTopicAnalysis(topicSnapshotAfterSave.subscriptions[0].id);
    const topicSnapshotAfterScheduler = await topicTrackingService.runTopicScheduler(true);
    const externalMediaResponse = await fetch(`${externalMediaServer.getBaseUrl()}/external-media/feishu/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messageId: 'feishu-message-001',
        chatId: 'chat-001',
        senderId: 'user-001',
        text: '分析论文 Graph RAG Pipeline',
      }),
    });
    const externalMediaPayload = (await externalMediaResponse.json()) as {
      requestId: string;
      taskId: string;
      status: string;
      summary: string;
      callbacks: Array<{ state: string }>;
    };
    const externalMediaStatusResponse = await fetch(
      `${externalMediaServer.getBaseUrl()}/external-media/status?requestId=${externalMediaPayload.requestId}`,
    );
    const externalMediaStatusPayload = (await externalMediaStatusResponse.json()) as {
      request: { requestId: string } | null;
      callbacks: Array<{ state: string }>;
    };
    const externalMediaSnapshot = await externalMediaServer.getSnapshot();
    const finalLibrary = await paperService.removePaper(searchResults[0].id);
    const activeAssistantSession =
      assistantReply.session.assistantSessions.find(
        (assistantSession) => assistantSession.id === assistantReply.session.currentAssistantSessionId,
      )
      ?? assistantReply.session.assistantSessions[0]
      ?? null;

    console.log(
      JSON.stringify(
        {
          workspaceRoot: workspace.directories.root,
          agentStatus: agentRun.task.status,
          agentStage: agentRun.task.stage,
          timelineSize: agentRun.timeline.length,
          searchCount: searchResults.length,
          importedPaperCount: importedLibrary.summary.total,
          updatedPaperStatus: updatedLibrary.papers[0]?.status ?? 'missing',
          readerCurrentPage: readerSession.progress.currentPage,
          annotationCount: annotatedSession.annotations.length,
          noteLength: notedSession.note.length,
          assistantMessages: activeAssistantSession?.conversation.length ?? 0,
          assistantTaskStatus: assistantReply.task.status,
          analysisSectionCount: analysisResult.report.sections.length,
          analysisHitCount: analysisResult.report.internetHits.length,
          verificationStatus: analysisResult.report.verification.status,
          followupMessages: analysisFollowup.report.conversation.length,
          followupReferences: analysisFollowup.references.length,
          topicSubscriptionCount: topicSnapshotAfterSave.summary.totalSubscriptions,
          topicReportCount: topicSnapshotAfterScheduler.summary.reportsAvailable,
          topicHistoryCount: topicSnapshotAfterScheduler.summary.historyCount,
          topicLatestSummary: topicResult.subscription.lastResultSummary,
          topicIncludedPaperCount: topicResult.report.includedPaperIds.length,
          topicTaskStatus: topicResult.task.status,
          externalMediaProtocolCount: externalMediaSnapshot.protocols.length,
          externalMediaRequestCount: externalMediaSnapshot.recentRequests.length,
          externalMediaCallbackCount: externalMediaStatusPayload.callbacks.length,
          externalMediaTaskStatus: externalMediaPayload.status,
          externalMediaSummaryLength: externalMediaPayload.summary.length,
          finalPaperCount: finalLibrary.summary.total,
        },
        null,
        2,
      ),
    );
  } finally {
    await externalMediaServer?.stop();
    await rm(tempWorkspace, { recursive: true, force: true });
  }
}

async function mockFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.includes('export.arxiv.org')) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2401.00001v1</id>
          <updated>2026-01-01T00:00:00Z</updated>
          <published>2026-01-01T00:00:00Z</published>
          <title>Graph RAG Pipeline</title>
          <summary>Graph retrieval augmented generation system.</summary>
          <author><name>Alice</name></author>
          <author><name>Bob</name></author>
          <link href="https://arxiv.org/pdf/2401.00001v1.pdf" rel="related" type="application/pdf" title="pdf"/>
        </entry>
      </feed>`,
      { status: 200 },
    );
  }

  if (url.includes('api.openalex.org')) {
    return Response.json({
      results: [
        {
          id: 'https://openalex.org/W1234567890',
          display_name: 'Open Access Research Agent',
          publication_date: '2025-06-01',
          authorships: [
            {
              author: {
                display_name: 'Carol',
              },
            },
          ],
          abstract_inverted_index: {
            Open: [0],
            Access: [1],
            Research: [2],
            Agent: [3],
          },
          best_oa_location: {
            pdf_url: 'https://example.org/open-access-agent.pdf',
            landing_page_url: 'https://example.org/open-access-agent',
          },
        },
      ],
    });
  }

  if (url.includes('openaccess.thecvf.com/search')) {
    return new Response(
      `<html><body>
        <dt class="ptitle"><a href="content/CVPR2024/html/Demo_CVF_Paper.html">Demo CVF Paper</a></dt>
        <dd>Alice, Bob</dd>
      </body></html>`,
      { status: 200 },
    );
  }

  if (url.includes('api.github.com/search/repositories')) {
    return Response.json({
      items: [
        {
          html_url: 'https://github.com/demo/graph-rag-pipeline',
          full_name: 'demo/graph-rag-pipeline',
          description: 'Graph RAG reference implementation',
          stargazers_count: 128,
          language: 'Python',
        },
      ],
    });
  }

  if (url.includes('api.github.com/repos/demo/graph-rag-pipeline/contents')) {
    return Response.json([
      { name: 'requirements.txt', type: 'file' },
      { name: 'main.py', type: 'file' },
      { name: 'README.md', type: 'file' },
    ]);
  }

  if (url.endsWith('.pdf')) {
    return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
  }

  throw new Error(`unexpected url: ${url}`);
}

void main();
