import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopApi, ReaderAssistantStreamEvent } from '@shared/types';

const desktopApi: DesktopApi = {
  getBootstrap() {
    return ipcRenderer.invoke('app:get-bootstrap');
  },
  saveWorkspaceConfig(input) {
    return ipcRenderer.invoke('workspace:save-config', input);
  },
  pickDirectory(currentPath) {
    return ipcRenderer.invoke('workspace:pick-directory', currentPath);
  },
  testAiModelConnection(input) {
    return ipcRenderer.invoke('ai:test-model-connection', input);
  },
  getLibrary() {
    return ipcRenderer.invoke('library:get');
  },
  runDemoAgent(title: string) {
    return ipcRenderer.invoke('agent:run-demo', title);
  },
  readLocalPdf(filePath: string) {
    return ipcRenderer.invoke('reader:read-local-pdf', filePath);
  },
  searchPapers(input) {
    return ipcRenderer.invoke('paper:search', input);
  },
  importPaper(candidate) {
    return ipcRenderer.invoke('paper:import', candidate);
  },
  updatePaper(paperId, patch) {
    return ipcRenderer.invoke('paper:update', paperId, patch);
  },
  removePaper(paperId) {
    return ipcRenderer.invoke('paper:remove', paperId);
  },
  getPaperAnalysis(paperId) {
    return ipcRenderer.invoke('analysis:get', paperId);
  },
  runPaperAnalysis(paperId) {
    return ipcRenderer.invoke('analysis:run', paperId);
  },
  askPaperAnalysisQuestion(input) {
    return ipcRenderer.invoke('analysis:ask', input);
  },
  getTopicTracking() {
    return ipcRenderer.invoke('topic:get-snapshot');
  },
  saveTopicSubscription(input) {
    return ipcRenderer.invoke('topic:save-subscription', input);
  },
  deleteTopicSubscription(topicId) {
    return ipcRenderer.invoke('topic:delete-subscription', topicId);
  },
  runTopicAnalysis(topicId) {
    return ipcRenderer.invoke('topic:run-analysis', topicId);
  },
  runTopicScheduler(forceRun) {
    return ipcRenderer.invoke('topic:run-scheduler', forceRun);
  },
  getReaderSession(paperId) {
    return ipcRenderer.invoke('reader:get-session', paperId);
  },
  saveReaderProgress(paperId, input) {
    return ipcRenderer.invoke('reader:save-progress', paperId, input);
  },
  addReaderAnnotation(paperId, input) {
    return ipcRenderer.invoke('reader:add-annotation', paperId, input);
  },
  updateReaderAnnotation(paperId, annotationId, input) {
    return ipcRenderer.invoke('reader:update-annotation', paperId, annotationId, input);
  },
  removeReaderAnnotation(paperId, annotationId) {
    return ipcRenderer.invoke('reader:remove-annotation', paperId, annotationId);
  },
  saveReaderNote(paperId, note) {
    return ipcRenderer.invoke('reader:save-note', paperId, note);
  },
  createReaderAssistantSession(paperId) {
    return ipcRenderer.invoke('reader:create-assistant-session', paperId);
  },
  selectReaderAssistantSession(paperId, assistantSessionId) {
    return ipcRenderer.invoke('reader:select-assistant-session', paperId, assistantSessionId);
  },
  saveReaderAssistantSession(paperId, assistantSessionId, title) {
    return ipcRenderer.invoke('reader:save-assistant-session', paperId, assistantSessionId, title);
  },
  askReaderAssistant(input) {
    return ipcRenderer.invoke('reader:ask-assistant', input);
  },
  askReaderAssistantStream(input, onEvent) {
    const requestId = `reader-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: ReaderAssistantStreamEvent) => {
      if (payload.requestId === requestId) {
        onEvent(payload);
      }
    };

    ipcRenderer.on('reader:assistant-stream-event', listener);

    return ipcRenderer
      .invoke('reader:ask-assistant-stream', {
        ...input,
        requestId,
      })
      .finally(() => {
        ipcRenderer.removeListener('reader:assistant-stream-event', listener);
      });
  },
  getExternalMediaSnapshot() {
    return ipcRenderer.invoke('external-media:get-snapshot');
  },
  simulateFeishuMessage(input) {
    return ipcRenderer.invoke('external-media:simulate-feishu-message', input);
  },
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
