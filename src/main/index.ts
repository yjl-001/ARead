import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { AgentRuntimeService } from './agents/AgentRuntimeService';
import { PaperAnalysisService } from './analysis/PaperAnalysisService';
import { ExternalMediaServer } from './integrations/ExternalMediaServer';
import { ExternalMediaService } from './integrations/ExternalMediaService';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { PaperService } from './papers/PaperService';
import { ReaderService } from './reader/ReaderService';
import { TopicTrackingService } from './topics/TopicTrackingService';
import { WorkspaceService } from './workspace/WorkspaceService';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let externalMediaServerRef: ExternalMediaServer | null = null;

function resolvePreloadPath(): string {
  const preloadMjsPath = path.join(currentDirectory, '../preload/index.mjs');

  if (fs.existsSync(preloadMjsPath)) {
    return preloadMjsPath;
  }

  return path.join(currentDirectory, '../preload/index.js');
}

/**
 * @function createMainWindow
 * @description 创建桌面主窗口并加载渲染层入口。
 * @param {void} 无需参数
 * @returns {BrowserWindow} 主窗口实例
 */
function createMainWindow(): BrowserWindow {
  const windowInstance = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: 'Vibe Reading',
    backgroundColor: '#09111f',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      sandbox: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  // 关键逻辑：开发环境加载 Vite 服务，生产构建回退到本地静态文件。
  if (rendererUrl) {
    void windowInstance.loadURL(rendererUrl);
  } else {
    void windowInstance.loadFile(path.join(currentDirectory, '../renderer/index.html'));
  }

  return windowInstance;
}

/**
 * @function bootstrapDesktopApp
 * @description 初始化工作区、注册 IPC 并启动主窗口。
 * @param {void} 无需参数
 * @returns {Promise<void>} 启动结果
 */
async function bootstrapDesktopApp(): Promise<void> {
  const workspaceService = new WorkspaceService(path.join(app.getPath('userData'), 'workspace'));
  await workspaceService.ensureWorkspace();
  const agentRuntimeService = new AgentRuntimeService({
    getAiModelConfig: () => workspaceService.getConfig().aiModelConfig,
  });
  const paperService = new PaperService(workspaceService.getDirectories());
  const readerService = new ReaderService(workspaceService.getDirectories(), paperService, agentRuntimeService);
  const paperAnalysisService = new PaperAnalysisService(
    workspaceService.getDirectories(),
    paperService,
    readerService,
    agentRuntimeService,
  );
  const topicTrackingService = new TopicTrackingService(
    workspaceService.getDirectories(),
    paperService,
    paperAnalysisService,
    agentRuntimeService,
  );
  const externalMediaService = new ExternalMediaService(
    workspaceService.getDirectories(),
    paperService,
    paperAnalysisService,
  );
  const externalMediaServer = new ExternalMediaServer(externalMediaService, () => workspaceService.getConfig());
  topicTrackingService.startScheduler();
  try {
    await externalMediaServer.start();
  } catch (error) {
    console.error('[external-media] 服务启动失败，已降级为仅本地模式：', error);
  }
  externalMediaServerRef = externalMediaServer;
  registerIpcHandlers({
    workspaceService,
    agentRuntimeService,
    paperService,
    readerService,
    paperAnalysisService,
    topicTrackingService,
    externalMediaServer,
    externalMediaService,
  });

  createMainWindow();
}

app.whenReady().then(async () => {
  await bootstrapDesktopApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void externalMediaServerRef?.stop();
});
