import fs from 'node:fs/promises';

import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type {
  BootstrapPayload,
  FeishuMessageInput,
  PaperAnalysisQuestionInput,
  PaperMutationInput,
  PaperSearchInput,
  PaperSearchResult,
  ReaderAnnotationInput,
  ReaderAnnotationUpdateInput,
  ReaderAssistantInput,
  ReaderProgressInput,
  TopicSubscriptionInput,
  WorkspaceConfigInput,
} from '@shared/types';

import { AgentRuntimeService } from '../agents/AgentRuntimeService';
import { PaperAnalysisService } from '../analysis/PaperAnalysisService';
import { ExternalMediaServer } from '../integrations/ExternalMediaServer';
import { ExternalMediaService } from '../integrations/ExternalMediaService';
import { PaperService } from '../papers/PaperService';
import { ReaderService } from '../reader/ReaderService';
import { TopicTrackingService } from '../topics/TopicTrackingService';
import { WorkspaceService } from '../workspace/WorkspaceService';

interface RegisterIpcHandlerOptions {
  workspaceService: WorkspaceService;
  agentRuntimeService: AgentRuntimeService;
  paperService: PaperService;
  readerService: ReaderService;
  paperAnalysisService: PaperAnalysisService;
  topicTrackingService: TopicTrackingService;
  externalMediaServer: ExternalMediaServer;
  externalMediaService: ExternalMediaService;
}

/**
 * @function registerIpcHandlers
 * @description 注册渲染进程所需的初始化与 Agent IPC 处理器。
 * @param {RegisterIpcHandlerOptions} options 服务依赖集合
 * @returns {void} 无返回值
 */
export function registerIpcHandlers(options: RegisterIpcHandlerOptions): void {
  ipcMain.removeHandler('app:get-bootstrap');
  ipcMain.removeHandler('workspace:save-config');
  ipcMain.removeHandler('workspace:pick-directory');
  ipcMain.removeHandler('agent:run-demo');
  ipcMain.removeHandler('library:get');
  ipcMain.removeHandler('paper:search');
  ipcMain.removeHandler('paper:import');
  ipcMain.removeHandler('paper:update');
  ipcMain.removeHandler('paper:remove');
  ipcMain.removeHandler('analysis:get');
  ipcMain.removeHandler('analysis:run');
  ipcMain.removeHandler('analysis:ask');
  ipcMain.removeHandler('topic:get-snapshot');
  ipcMain.removeHandler('topic:save-subscription');
  ipcMain.removeHandler('topic:delete-subscription');
  ipcMain.removeHandler('topic:run-analysis');
  ipcMain.removeHandler('topic:run-scheduler');
  ipcMain.removeHandler('reader:get-session');
  ipcMain.removeHandler('reader:read-local-pdf');
  ipcMain.removeHandler('reader:save-progress');
  ipcMain.removeHandler('reader:add-annotation');
  ipcMain.removeHandler('reader:update-annotation');
  ipcMain.removeHandler('reader:remove-annotation');
  ipcMain.removeHandler('reader:save-note');
  ipcMain.removeHandler('reader:create-assistant-session');
  ipcMain.removeHandler('reader:select-assistant-session');
  ipcMain.removeHandler('reader:save-assistant-session');
  ipcMain.removeHandler('reader:ask-assistant');
  ipcMain.removeHandler('external-media:get-snapshot');
  ipcMain.removeHandler('external-media:simulate-feishu-message');

  ipcMain.handle('app:get-bootstrap', async (): Promise<BootstrapPayload> => {
    const workspace = await options.workspaceService.ensureWorkspace();

    const analysisTasks = await options.paperAnalysisService.listTasks();

    return {
      workspace,
      navigation: [
        {
          key: 'library',
          label: '论文库',
          description: '管理已入库论文与最近更新。',
          path: '/library',
        },
        {
          key: 'search',
          label: '搜索',
          description: '预留 arXiv 与 OpenAlex 搜索搜索入口。',
          path: '/search',
        },
        {
          key: 'reader',
          label: '阅读',
          description: '承接 PDF 阅读、批注与上下文问答。',
          path: '/reader',
        },
        {
          key: 'ai-workbench',
          label: '工作台',
          description: '统一查看 Agent 能力与分析任务状态。',
          path: '/ai-workbench',
        },
        {
          key: 'settings',
          label: '设置',
          description: '管理工作区路径与默认偏好。',
          path: '/settings',
        },
      ],
      agents: options.agentRuntimeService.getDefinitions(),
      seededTasks: [
        ...analysisTasks,
        ...(await options.topicTrackingService.listTasks()),
        ...options.agentRuntimeService.getSeededTasks(),
      ].slice(0, 12),
      library: await options.paperService.getLibrary(),
      topicTracking: await options.topicTrackingService.getSnapshot(),
      externalMedia: await options.externalMediaServer.getSnapshot(),
    };
  });

  ipcMain.handle('workspace:save-config', async (_event: IpcMainInvokeEvent, input: WorkspaceConfigInput) => {
    const config = await options.workspaceService.saveConfig(input);
    const workspace = await options.workspaceService.ensureWorkspace();

    return {
      ...workspace,
      config,
    };
  });

  ipcMain.handle('workspace:pick-directory', async (_event: IpcMainInvokeEvent, currentPath?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: currentPath,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('agent:run-demo', async (_event: IpcMainInvokeEvent, title: string) => {
    return options.agentRuntimeService.runDemoAgent(title);
  });

  ipcMain.handle('library:get', async () => {
    return options.paperService.getLibrary();
  });

  ipcMain.handle('paper:search', async (_event: IpcMainInvokeEvent, input: PaperSearchInput) => {
    return options.paperService.search(input);
  });

  ipcMain.handle('paper:import', async (_event: IpcMainInvokeEvent, candidate: PaperSearchResult) => {
    return options.paperService.importPaper(candidate);
  });

  ipcMain.handle('paper:update', async (_event: IpcMainInvokeEvent, paperId: string, patch: PaperMutationInput) => {
    return options.paperService.updatePaper(paperId, patch);
  });

  ipcMain.handle('paper:remove', async (_event: IpcMainInvokeEvent, paperId: string) => {
    return options.paperService.removePaper(paperId);
  });

  ipcMain.handle('analysis:get', async (_event: IpcMainInvokeEvent, paperId: string) => {
    return options.paperAnalysisService.getAnalysis(paperId);
  });

  ipcMain.handle('analysis:run', async (_event: IpcMainInvokeEvent, paperId: string) => {
    return options.paperAnalysisService.runAnalysis(paperId);
  });

  ipcMain.handle('analysis:ask', async (_event: IpcMainInvokeEvent, input: PaperAnalysisQuestionInput) => {
    return options.paperAnalysisService.askQuestion(input);
  });

  ipcMain.handle('topic:get-snapshot', async () => {
    return options.topicTrackingService.getSnapshot();
  });

  ipcMain.handle('topic:save-subscription', async (_event: IpcMainInvokeEvent, input: TopicSubscriptionInput) => {
    return options.topicTrackingService.saveSubscription(input);
  });

  ipcMain.handle('topic:delete-subscription', async (_event: IpcMainInvokeEvent, topicId: string) => {
    return options.topicTrackingService.deleteSubscription(topicId);
  });

  ipcMain.handle('topic:run-analysis', async (_event: IpcMainInvokeEvent, topicId: string) => {
    return options.topicTrackingService.runTopicAnalysis(topicId);
  });

  ipcMain.handle('topic:run-scheduler', async (_event: IpcMainInvokeEvent, forceRun = false) => {
    return options.topicTrackingService.runTopicScheduler(forceRun);
  });

  ipcMain.handle('reader:get-session', async (_event: IpcMainInvokeEvent, paperId: string) => {
    return options.readerService.getSession(paperId);
  });

  ipcMain.handle('reader:read-local-pdf', async (_event: IpcMainInvokeEvent, filePath: string) => {
    const binary = await fs.readFile(filePath);

    return binary.toString('base64');
  });

  ipcMain.handle('reader:save-progress', async (_event: IpcMainInvokeEvent, paperId: string, input: ReaderProgressInput) => {
    return options.readerService.saveProgress(paperId, input);
  });

  ipcMain.handle('reader:add-annotation', async (_event: IpcMainInvokeEvent, paperId: string, input: ReaderAnnotationInput) => {
    return options.readerService.addAnnotation(paperId, input);
  });

  ipcMain.handle(
    'reader:update-annotation',
    async (_event: IpcMainInvokeEvent, paperId: string, annotationId: string, input: ReaderAnnotationUpdateInput) => {
      return options.readerService.updateAnnotation(paperId, annotationId, input);
    },
  );

  ipcMain.handle('reader:remove-annotation', async (_event: IpcMainInvokeEvent, paperId: string, annotationId: string) => {
    return options.readerService.removeAnnotation(paperId, annotationId);
  });

  ipcMain.handle('reader:save-note', async (_event: IpcMainInvokeEvent, paperId: string, note: string) => {
    return options.readerService.saveNote(paperId, note);
  });

  ipcMain.handle('reader:create-assistant-session', async (_event: IpcMainInvokeEvent, paperId: string) => {
    return options.readerService.createAssistantSession(paperId);
  });

  ipcMain.handle(
    'reader:select-assistant-session',
    async (_event: IpcMainInvokeEvent, paperId: string, assistantSessionId: string) => {
      return options.readerService.selectAssistantSession(paperId, assistantSessionId);
    },
  );

  ipcMain.handle(
    'reader:save-assistant-session',
    async (_event: IpcMainInvokeEvent, paperId: string, assistantSessionId: string, title?: string) => {
      return options.readerService.saveAssistantSession(paperId, assistantSessionId, title);
    },
  );

  ipcMain.handle('reader:ask-assistant', async (_event: IpcMainInvokeEvent, input: ReaderAssistantInput) => {
    return options.readerService.askAssistant(input);
  });

  ipcMain.handle('external-media:get-snapshot', async () => {
    return options.externalMediaServer.getSnapshot();
  });

  ipcMain.handle('external-media:simulate-feishu-message', async (_event: IpcMainInvokeEvent, input: FeishuMessageInput) => {
    return options.externalMediaService.handleFeishuMessage(input);
  });
}
