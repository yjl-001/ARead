export type NavigationKey = 'library' | 'search' | 'reader' | 'ai-workbench' | 'settings';

export type AgentTaskStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';
export type PaperSourceKey = 'arxiv' | 'openalex' | 'cvf';
export type PaperSearchSource = 'all' | PaperSourceKey;
export type PaperRecordStatus = 'metadata-only' | 'downloaded' | 'indexed';
export type ReadingStatus = 'unread' | 'reading' | 'completed';
export type AnalysisStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';
export type ReaderAnnotationColor = 'yellow' | 'blue' | 'pink' | 'mint';
export type ReaderChatRole = 'user' | 'assistant';
export type AnalysisConversationRole = 'user' | 'assistant';
export type PaperAnalysisSectionKey =
  | 'motivation'
  | 'challenges'
  | 'research-landscape'
  | 'method'
  | 'experiments'
  | 'results';
export type CodeVerificationStatus = 'verified' | 'blocked' | 'not-found';
export type CodeVerificationStepStatus = 'completed' | 'failed' | 'skipped';
export type TopicRunTrigger = 'manual' | 'scheduled';
export type ExternalMediaChannel = 'feishu';
export type ExternalMediaIntent = 'paper-analysis';
export type ExternalMediaTaskState = 'accepted' | 'running' | 'completed' | 'failed';

export interface WorkspaceDirectories {
  root: string;
  papers: string;
  metadata: string;
  notes: string;
  analyses: string;
  tasks: string;
  cache: string;
}

export interface ExternalMediaConfig {
  feishuTitle: string;
  feishuEntryUrl: string;
  feishuCommandExample: string;
}

export interface AiModelConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiModelConnectionTestResult {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  responsePreview: string;
  testedAt: string;
}

export interface WorkspaceConfig {
  version: string;
  createdAt: string;
  updatedAt: string;
  defaultTheme: 'system' | 'light' | 'dark';
  fontSize: number;
  defaultModel: string;
  workspaceDirectories: WorkspaceDirectories;
  externalMediaConfig: ExternalMediaConfig;
  aiModelConfig: AiModelConfig;
}

export interface WorkspaceConfigInput {
  defaultTheme: WorkspaceConfig['defaultTheme'];
  fontSize: number;
  defaultModel: string;
  workspaceDirectories: WorkspaceDirectories;
  externalMediaConfig: ExternalMediaConfig;
  aiModelConfig: AiModelConfig;
}

export interface PaperRecord {
  id: string;
  sourceId: string;
  title: string;
  source: PaperSourceKey;
  sourceLabel: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
  status: PaperRecordStatus;
  addedAt: string;
  updatedAt: string;
  entryUrl: string;
  pdfUrl: string | null;
  localPdfPath: string | null;
  metadataPath: string;
  readingStatus: ReadingStatus;
  analysisStatus: AnalysisStatus;
  isFavorite: boolean;
  isArchived: boolean;
  tags: string[];
  lastAction: string;
}

export interface PaperSearchResult {
  id: string;
  sourceId: string;
  source: PaperSourceKey;
  sourceLabel: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
  entryUrl: string;
  pdfUrl: string | null;
  isOpenAccess: boolean;
}

export interface PaperSearchInput {
  query: string;
  source: PaperSearchSource;
  limit?: number;
}

export interface PaperLibrarySummary {
  total: number;
  downloaded: number;
  indexed: number;
  favorites: number;
  archived: number;
}

export interface PaperLibraryPayload {
  papers: PaperRecord[];
  summary: PaperLibrarySummary;
}

export interface PaperMutationInput {
  status?: PaperRecordStatus;
  readingStatus?: ReadingStatus;
  analysisStatus?: AnalysisStatus;
  isFavorite?: boolean;
  isArchived?: boolean;
  tags?: string[];
}

export interface ReadingRecord {
  paperId: string;
  lastPosition: string;
  currentPage: number;
  totalPages: number;
  zoom: number;
  completion: number;
  updatedAt: string;
}

export interface ReaderAnnotation {
  id: string;
  paperId: string;
  pageNumber: number;
  quote: string;
  note: string;
  color: ReaderAnnotationColor;
  highlightAreas?: ReaderHighlightArea[];
  createdAt: string;
  updatedAt: string;
}

export interface ReaderHighlightArea {
  pageIndex: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ReaderChatMessage {
  id: string;
  role: ReaderChatRole;
  content: string;
  createdAt: string;
  references: string[];
}

export interface ReaderAssistantSession {
  id: string;
  title: string;
  conversation: ReaderChatMessage[];
  isSaved: boolean;
  createdAt: string;
  updatedAt: string;
  savedAt: string | null;
}

export interface ReaderSession {
  paperId: string;
  progress: ReadingRecord;
  annotations: ReaderAnnotation[];
  note: string;
  assistantSessions: ReaderAssistantSession[];
  currentAssistantSessionId: string | null;
  conversation?: ReaderChatMessage[];
  updatedAt: string;
}

export interface ReaderProgressInput {
  currentPage: number;
  totalPages: number;
  zoom: number;
}

export interface ReaderAnnotationInput {
  pageNumber: number;
  quote: string;
  note: string;
  color: ReaderAnnotationColor;
  highlightAreas?: ReaderHighlightArea[];
}

export interface ReaderAnnotationUpdateInput {
  note: string;
  color: ReaderAnnotationColor;
}

export interface ReaderAssistantInput {
  paperId: string;
  question: string;
  currentPage: number;
  assistantSessionId?: string | null;
}

export interface ReaderAssistantReply {
  session: ReaderSession;
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
}

export interface ReaderAssistantStreamEvent {
  type: 'delta';
  requestId: string;
  delta: string;
}

export interface AgentTaskRecord {
  id: string;
  title: string;
  agentKey: string;
  runtime: 'langchain';
  status: AgentTaskStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentDefinition {
  key: string;
  title: string;
  description: string;
  entrypoints: string[];
  status: 'placeholder' | 'ready';
  runtime: 'langchain';
  mode?: 'workflow' | 'loop-agent';
}

export interface AgentTimelineEntry {
  stage: string;
  message: string;
}

export interface AgentRunResult {
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
}

export interface InternetSearchHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt: string | null;
  authors: string[];
}

export interface PaperAnalysisSection {
  key: PaperAnalysisSectionKey;
  title: string;
  summary: string;
  bullets: string[];
  evidence: string[];
}

export interface CodeExperimentStep {
  stage: string;
  status: CodeVerificationStepStatus;
  detail: string;
  command: string | null;
  output: string | null;
}

export interface CodeExperimentVerification {
  repositoryUrl: string | null;
  repositoryName: string | null;
  status: CodeVerificationStatus;
  summary: string;
  failureReason: string | null;
  steps: CodeExperimentStep[];
}

export interface AnalysisConversationMessage {
  id: string;
  role: AnalysisConversationRole;
  content: string;
  createdAt: string;
  references: string[];
}

export interface PaperAnalysisRecord {
  paperId: string;
  paperTitle: string;
  generatedAt: string;
  updatedAt: string;
  searchQueries: string[];
  readerContext: {
    noteExcerpt: string;
    annotationQuotes: string[];
  };
  sections: PaperAnalysisSection[];
  internetHits: InternetSearchHit[];
  verification: CodeExperimentVerification;
  conversation: AnalysisConversationMessage[];
}

export interface PaperAnalysisRunResult {
  report: PaperAnalysisRecord;
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
}

export interface PaperAnalysisQuestionInput {
  paperId: string;
  question: string;
}

export interface PaperAnalysisQuestionReply {
  answer: string;
  references: string[];
  report: PaperAnalysisRecord;
}

export interface TopicSubscription {
  id: string;
  name: string;
  query: string;
  description: string;
  scheduleTime: string;
  enabled: boolean;
  maxResultsPerRun: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastResultSummary: string;
  latestReportPath: string | null;
  paperIds: string[];
}

export interface TopicSubscriptionInput {
  id?: string;
  name: string;
  query: string;
  description?: string;
  scheduleTime?: string;
  enabled?: boolean;
  maxResultsPerRun?: number;
}

export interface TopicPaperDigest {
  paperId: string;
  title: string;
  sourceLabel: string;
  publishedAt: string;
  summary: string;
  authors: string[];
}

export interface TopicAnalysisSection {
  title: string;
  summary: string;
  bullets: string[];
  evidence: string[];
}

export interface TopicAnalysisReport {
  id: string;
  topicId: string;
  topicName: string;
  query: string;
  trigger: TopicRunTrigger;
  generatedAt: string;
  updatedAt: string;
  filePath: string;
  overview: string;
  highlights: string[];
  includedPaperIds: string[];
  newPaperIds: string[];
  papers: TopicPaperDigest[];
  sections: TopicAnalysisSection[];
  recommendedPaperIds: string[];
}

export interface TopicExecutionHistory {
  id: string;
  topicId: string;
  topicName: string;
  trigger: TopicRunTrigger;
  status: Exclude<AgentTaskStatus, 'idle'>;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  newPaperCount: number;
  reportId: string | null;
}

export interface TopicTrackingSnapshot {
  subscriptions: TopicSubscription[];
  reports: TopicAnalysisReport[];
  history: TopicExecutionHistory[];
  tasks: AgentTaskRecord[];
  summary: {
    totalSubscriptions: number;
    enabledSubscriptions: number;
    reportsAvailable: number;
    historyCount: number;
  };
  scheduler: {
    isRunning: boolean;
    intervalMs: number;
    nextCheckAt: string | null;
  };
}

export interface TopicRunResult {
  subscription: TopicSubscription;
  report: TopicAnalysisReport;
  history: TopicExecutionHistory;
  task: AgentTaskRecord;
  timeline: AgentTimelineEntry[];
}

export interface FeishuMessageInput {
  messageId: string;
  chatId: string;
  senderId: string;
  text: string;
}

export interface ExternalMediaTaskRequest {
  requestId: string;
  channel: ExternalMediaChannel;
  intent: ExternalMediaIntent;
  messageId: string;
  chatId: string;
  senderId: string;
  text: string;
  paperQuery: string;
  paperUrl: string | null;
  paperId: string | null;
  receivedAt: string;
}

export interface ExternalMediaStatusCallback {
  id: string;
  requestId: string;
  channel: ExternalMediaChannel;
  state: ExternalMediaTaskState;
  message: string;
  relatedTaskId: string | null;
  paperId: string | null;
  summary: string | null;
  createdAt: string;
}

export interface ExternalMediaProtocol {
  channel: ExternalMediaChannel;
  title: string;
  description: string;
  method: 'POST';
  path: string;
  entryUrl: string;
  commandExample: string;
  status: 'ready';
}

export interface ExternalMediaSnapshot {
  protocols: ExternalMediaProtocol[];
  recentRequests: ExternalMediaTaskRequest[];
  recentCallbacks: ExternalMediaStatusCallback[];
}

export interface ExternalMediaTaskReceipt {
  request: ExternalMediaTaskRequest;
  task: AgentTaskRecord;
  report: PaperAnalysisRecord;
  callbacks: ExternalMediaStatusCallback[];
  summary: string;
}

export interface NavigationItem {
  key: NavigationKey;
  label: string;
  description: string;
  path: string;
}

export interface BootstrapPayload {
  workspace: {
    directories: WorkspaceDirectories;
    config: WorkspaceConfig;
    paperCount: number;
    readingCount: number;
    taskCount: number;
  };
  navigation: NavigationItem[];
  agents: AgentDefinition[];
  seededTasks: AgentTaskRecord[];
  library: PaperLibraryPayload;
  topicTracking: TopicTrackingSnapshot;
  externalMedia: ExternalMediaSnapshot;
}

export interface DesktopApi {
  getBootstrap(): Promise<BootstrapPayload>;
  saveWorkspaceConfig(input: WorkspaceConfigInput): Promise<BootstrapPayload['workspace']>;
  pickDirectory(currentPath?: string): Promise<string | null>;
  testAiModelConnection(input: AiModelConfig): Promise<AiModelConnectionTestResult>;
  getLibrary(): Promise<PaperLibraryPayload>;
  runDemoAgent(title: string): Promise<AgentRunResult>;
  readLocalPdf(filePath: string): Promise<string>;
  searchPapers(input: PaperSearchInput): Promise<PaperSearchResult[]>;
  importPaper(candidate: PaperSearchResult): Promise<PaperLibraryPayload>;
  updatePaper(paperId: string, patch: PaperMutationInput): Promise<PaperLibraryPayload>;
  removePaper(paperId: string): Promise<PaperLibraryPayload>;
  getPaperAnalysis(paperId: string): Promise<PaperAnalysisRecord | null>;
  runPaperAnalysis(paperId: string): Promise<PaperAnalysisRunResult>;
  askPaperAnalysisQuestion(input: PaperAnalysisQuestionInput): Promise<PaperAnalysisQuestionReply>;
  getTopicTracking(): Promise<TopicTrackingSnapshot>;
  saveTopicSubscription(input: TopicSubscriptionInput): Promise<TopicTrackingSnapshot>;
  deleteTopicSubscription(topicId: string): Promise<TopicTrackingSnapshot>;
  runTopicAnalysis(topicId: string): Promise<TopicRunResult>;
  runTopicScheduler(forceRun?: boolean): Promise<TopicTrackingSnapshot>;
  getReaderSession(paperId: string): Promise<ReaderSession>;
  saveReaderProgress(paperId: string, input: ReaderProgressInput): Promise<ReaderSession>;
  addReaderAnnotation(paperId: string, input: ReaderAnnotationInput): Promise<ReaderSession>;
  updateReaderAnnotation(paperId: string, annotationId: string, input: ReaderAnnotationUpdateInput): Promise<ReaderSession>;
  removeReaderAnnotation(paperId: string, annotationId: string): Promise<ReaderSession>;
  saveReaderNote(paperId: string, note: string): Promise<ReaderSession>;
  createReaderAssistantSession(paperId: string): Promise<ReaderSession>;
  selectReaderAssistantSession(paperId: string, assistantSessionId: string): Promise<ReaderSession>;
  saveReaderAssistantSession(paperId: string, assistantSessionId: string, title?: string): Promise<ReaderSession>;
  askReaderAssistant(input: ReaderAssistantInput): Promise<ReaderAssistantReply>;
  askReaderAssistantStream(
    input: ReaderAssistantInput,
    onEvent: (event: ReaderAssistantStreamEvent) => void,
  ): Promise<ReaderAssistantReply>;
  getExternalMediaSnapshot(): Promise<ExternalMediaSnapshot>;
  simulateFeishuMessage(input: FeishuMessageInput): Promise<ExternalMediaTaskReceipt>;
}
