import { Component, type CSSProperties, type JSX, type ReactNode, useEffect, useMemo, useState } from 'react';
import { HashRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import type {
  AgentDefinition,
  AgentRunResult,
  AgentTaskRecord,
  AnalysisStatus,
  BootstrapPayload,
  NavigationItem,
  PaperLibraryPayload,
  PaperMutationInput,
  PaperRecord,
  PaperSearchResult,
  ReadingStatus,
  TopicTrackingSnapshot,
  WorkspaceConfigInput,
} from '@shared/types';

import { PaperAnalysisWorkbench } from './PaperAnalysisWorkbench';
import { getPaperSourceLabel } from './paperSources';
import { ReaderPage } from './ReaderPage';
import { SearchPage } from './SearchPage';
import { TopicTrackingWorkbench } from './TopicTrackingWorkbench';

interface ReaderRouteBoundaryProps {
  children: ReactNode;
}

interface ReaderRouteBoundaryState {
  errorMessage: string;
}

class ReaderRouteBoundary extends Component<ReaderRouteBoundaryProps, ReaderRouteBoundaryState> {
  public constructor(props: ReaderRouteBoundaryProps) {
    super(props);
    this.state = {
      errorMessage: '',
    };
  }

  public static getDerivedStateFromError(error: unknown): ReaderRouteBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : '阅读页渲染失败',
    };
  }

  public render(): ReactNode {
    if (this.state.errorMessage) {
      return <StateScreen title="阅读器异常" description={this.state.errorMessage} />;
    }

    return this.props.children;
  }
}

const DEFAULT_WORKSPACE_FONT_SIZE = 14;

const MIN_WORKSPACE_FONT_SIZE = 12;

const MAX_WORKSPACE_FONT_SIZE = 18;

/**
 * @function normalizeWorkspaceFontSize
 * @description 统一约束设置页与全局布局使用的界面字体大小，避免异常值影响整体缩放。
 * @param {number | undefined} value 当前配置或交互中的字体大小
 * @returns {number} 落在允许区间内的字体大小
 */
function normalizeWorkspaceFontSize(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_WORKSPACE_FONT_SIZE;
  }

  return Math.min(Math.max(Math.round(value), MIN_WORKSPACE_FONT_SIZE), MAX_WORKSPACE_FONT_SIZE);
}

/**
 * @function App
 * @description React 应用的根组件。
 * 负责在组件挂载时调用桌面端 API 初始化工作区、加载基础配置和论文库数据，
 * 并将这些全局状态通过 Props 向下传递给子组件。同时处理全局通知（Notice）的展示。
 */
export function App(): JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [library, setLibrary] = useState<PaperLibraryPayload | null>(null);
  const [topicTracking, setTopicTracking] = useState<TopicTrackingSnapshot | null>(null);
  const [agentResult, setAgentResult] = useState<AgentRunResult | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [workspaceFontSizePreview, setWorkspaceFontSizePreview] = useState<number | null>(null);

  useEffect(() => {
    async function loadBootstrap(): Promise<void> {
      try {
        const payload = await window.desktopApi.getBootstrap();
        setBootstrap(payload);
        setLibrary(payload.library);
        setTopicTracking(payload.topicTracking);
      } catch (error) {
        setBootstrapError(error instanceof Error ? error.message : '应用初始化失败');
      }
    }

    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (!notice || notice.tone !== 'success') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  async function handleRunAgent(): Promise<void> {
    setIsAgentRunning(true);
    setNotice(null);

    try {
      const result = await window.desktopApi.runDemoAgent('桌面骨架演示任务');
      setAgentResult(result);
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Agent Runtime 执行失败',
      });
    } finally {
      setIsAgentRunning(false);
    }
  }

  async function handleImportPaper(candidate: PaperSearchResult): Promise<void> {
    try {
      const nextLibrary = await window.desktopApi.importPaper(candidate);
      setLibrary(nextLibrary);
      setNotice({
        tone: 'success',
        message: `${candidate.title} 已下载并写入论文库`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '论文入库失败',
      });
    }
  }

  async function handleUpdatePaper(paperId: string, patch: PaperMutationInput): Promise<void> {
    try {
      const nextLibrary = await window.desktopApi.updatePaper(paperId, patch);
      setLibrary(nextLibrary);
      setNotice({
        tone: 'success',
        message: '论文库已更新',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '论文更新失败',
      });
    }
  }

  async function handleRemovePaper(paperId: string): Promise<void> {
    try {
      const nextLibrary = await window.desktopApi.removePaper(paperId);
      setLibrary(nextLibrary);
      setNotice({
        tone: 'success',
        message: '论文已从论文库移除',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '论文删除失败',
      });
    }
  }

  async function handleSaveWorkspaceConfig(input: WorkspaceConfigInput): Promise<void> {
    try {
      const nextWorkspace = await window.desktopApi.saveWorkspaceConfig(input);
      setBootstrap((current) => (current ? { ...current, workspace: nextWorkspace } : current));
      setWorkspaceFontSizePreview(null);
      setNotice({
        tone: 'success',
        message: '设置已保存，后续启动会沿用新的默认偏好。',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : '保存设置失败',
      });
    }
  }

  if (bootstrapError) {
    return <StateScreen title="初始化失败" description={bootstrapError} />;
  }

  if (!bootstrap || !library || !topicTracking) {
    return <StateScreen title="正在初始化桌面工作区" description="首次启动时将创建本地目录与基础数据文件。" />;
  }

  return (
    <HashRouter>
      <AppShell
        bootstrap={bootstrap}
        externalMedia={bootstrap.externalMedia}
        library={library}
        topicTracking={topicTracking}
        notice={notice}
        isAgentRunning={isAgentRunning}
        agentResult={agentResult}
        onRunAgent={handleRunAgent}
        onImportPaper={handleImportPaper}
        onUpdatePaper={handleUpdatePaper}
        onSyncPaper={async (paperId, patch) => {
          try {
            const nextLibrary = await window.desktopApi.updatePaper(paperId, patch);
            setLibrary(nextLibrary);
          } catch (error) {
            setNotice({
              tone: 'error',
              message: error instanceof Error ? error.message : '阅读器状态同步失败',
            });
          }
        }}
        onRemovePaper={handleRemovePaper}
        onRefreshLibrary={async () => {
          try {
            const nextLibrary = await window.desktopApi.getLibrary();
            setLibrary(nextLibrary);
          } catch (error) {
            setNotice({
              tone: 'error',
              message: error instanceof Error ? error.message : '论文库刷新失败',
            });
          }
        }}
        onSyncTopicTracking={setTopicTracking}
        onSaveWorkspaceConfig={handleSaveWorkspaceConfig}
        workspaceFontSizePreview={workspaceFontSizePreview}
        onPreviewWorkspaceFontSize={setWorkspaceFontSizePreview}
        onNotify={setNotice}
        onDismissNotice={() => {
          setNotice(null);
        }}
      />
    </HashRouter>
  );
}

interface AppShellProps {
  bootstrap: BootstrapPayload;
  externalMedia: BootstrapPayload['externalMedia'];
  library: PaperLibraryPayload;
  topicTracking: TopicTrackingSnapshot;
  notice: { tone: 'error' | 'success'; message: string } | null;
  agentResult: AgentRunResult | null;
  isAgentRunning: boolean;
  onRunAgent: () => Promise<void>;
  onImportPaper: (candidate: PaperSearchResult) => Promise<void>;
  onUpdatePaper: (paperId: string, patch: PaperMutationInput) => Promise<void>;
  onSyncPaper: (paperId: string, patch: PaperMutationInput) => Promise<void>;
  onRemovePaper: (paperId: string) => Promise<void>;
  onRefreshLibrary: () => Promise<void>;
  onSyncTopicTracking: (snapshot: TopicTrackingSnapshot) => void;
  onSaveWorkspaceConfig: (input: WorkspaceConfigInput) => Promise<void>;
  workspaceFontSizePreview: number | null;
  onPreviewWorkspaceFontSize: (fontSize: number | null) => void;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
  onDismissNotice: () => void;
}

/**
 * @function AppShell
 * @description 应用的骨架布局组件。
 * 包含左侧固定的导航侧边栏（Sidebar）、顶部的标题栏（Topbar），
 * 以及主体内容区的路由映射（Routes）。根据当前路径动态切换右侧展示的页面。
 */
function AppShell(props: AppShellProps): JSX.Element {
  const location = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const latestTask = props.agentResult?.task ?? props.bootstrap.seededTasks[0] ?? null;
  const workspaceFontSize = normalizeWorkspaceFontSize(props.workspaceFontSizePreview ?? props.bootstrap.workspace.config.fontSize);
  const appShellStyle = useMemo(
    () =>
      ({
        '--app-font-size-scale': String(workspaceFontSize / DEFAULT_WORKSPACE_FONT_SIZE),
      }) as CSSProperties,
    [workspaceFontSize],
  );
  const topbarMeta = useMemo(() => {
    if (location.pathname.startsWith('/reader')) {
      return {
        eyebrow: '',
        title: '阅读',
      };
    }

    if (location.pathname.startsWith('/search')) {
      return {
        eyebrow: 'SEARCH',
        title: '论文搜索',
      };
    }

    if (location.pathname.startsWith('/ai-workbench')) {
      return {
        eyebrow: 'AI WORKBENCH',
        title: 'AI 分析与主题追踪',
      };
    }

    if (location.pathname.startsWith('/settings')) {
      return {
        eyebrow: 'WORKSPACE',
        title: '偏好设置与工作区',
      };
    }

    return {
      eyebrow: 'LIBRARY',
      title: '论文库',
    };
  }, [location.pathname]);

  return (
    <div className={isSidebarCollapsed ? 'app-shell app-shell-collapsed' : 'app-shell'} style={appShellStyle}>
      <aside className={isSidebarCollapsed ? 'sidebar sidebar-collapsed' : 'sidebar'}>
        <div className="sidebar-head">
          <div>
            <p className="eyebrow">Vibe Reading</p>
            {!isSidebarCollapsed ? <h1>论文阅读桌面台</h1> : null}
            {!isSidebarCollapsed ? <p className="muted">把搜索、阅读、分析和跟踪收进一条顺手的研究流。</p> : null}
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            aria-label={isSidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          >
            {isSidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="nav-list">
          {props.bootstrap.navigation.map((item) => (
            <NavItem key={item.key} item={item} collapsed={isSidebarCollapsed} />
          ))}
        </nav>

        {!isSidebarCollapsed ? (
          <section className="sidebar-footer">
            <p className="sidebar-label">当前模式</p>
            <p className="muted">默认界面已隐藏元数据与路径细节，相关信息统一收纳在设置页。</p>
          </section>
        ) : null}
      </aside>

      <main className={location.pathname.startsWith('/reader') ? 'content content-reader' : 'content'}>
        {!location.pathname.startsWith('/reader') ? (
          <header className="topbar">
            <div className="topbar-title-wrap">
              {topbarMeta.eyebrow ? <p className="eyebrow">{topbarMeta.eyebrow}</p> : null}
              <div className="topbar-title-row">
                <h2>{topbarMeta.title}</h2>
              </div>
            </div>
            <div className="topbar-metrics">
              <MetricCard label="论文记录" value={String(props.library.summary.total)} />
              <MetricCard label="已下载" value={String(props.library.summary.downloaded)} />
              <MetricCard label="已索引" value={String(props.library.summary.indexed)} />
              <MetricCard label="阅读记录" value={String(props.bootstrap.workspace.readingCount)} />
            </div>
          </header>
        ) : null}

        {props.notice ? (
          <section className={`notice-banner notice-${props.notice.tone}`}>
            <p>{props.notice.message}</p>
            <button type="button" className="notice-dismiss" aria-label="关闭提示" onClick={props.onDismissNotice}>
              ×
            </button>
          </section>
        ) : null}

        <Routes>
          <Route
            path="/"
            element={<Navigate to="/library" replace />}
          />
          <Route
            path="/library"
            element={
              <LibraryPage
                library={props.library}
                onUpdatePaper={props.onUpdatePaper}
                onRemovePaper={props.onRemovePaper}
              />
            }
          />
          <Route
            path="/search"
            element={
              <SearchPage
                library={props.library}
                onImportPaper={props.onImportPaper}
              />
            }
          />
          <Route
            path="/reader"
            element={
              <ReaderRouteBoundary>
                <ReaderPage library={props.library} onSyncPaper={props.onSyncPaper} onNotify={props.onNotify} />
              </ReaderRouteBoundary>
            }
          />
          <Route
            path="/ai-workbench"
            element={
              <AiWorkbenchPage
                agents={props.bootstrap.agents}
                latestTask={latestTask}
                library={props.library}
                topicTracking={props.topicTracking}
                onSyncTopicTracking={props.onSyncTopicTracking}
                onNotify={props.onNotify}
                onRefreshLibrary={props.onRefreshLibrary}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                workspace={props.bootstrap.workspace}
                externalMedia={props.externalMedia}
                onSaveWorkspaceConfig={props.onSaveWorkspaceConfig}
                onPreviewWorkspaceFontSize={props.onPreviewWorkspaceFontSize}
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}

interface NavItemProps {
  item: NavigationItem;
  collapsed: boolean;
}

function NavItem(props: NavItemProps): JSX.Element {
  return (
    <NavLink
      to={props.item.path}
      className={({ isActive }) => (isActive ? 'nav-item nav-item-active' : 'nav-item')}
      title={props.collapsed ? props.item.label : undefined}
    >
      <span>{props.item.label}</span>
      {!props.collapsed ? <small>{props.item.description}</small> : null}
    </NavLink>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  valueClassName?: string;
}

function MetricCard(props: MetricCardProps): JSX.Element {
  return (
    <section className="metric-card">
      <span>{props.label}</span>
      <strong className={props.valueClassName}>{props.value}</strong>
    </section>
  );
}

interface LibraryPageProps {
  library: PaperLibraryPayload;
  onUpdatePaper: (paperId: string, patch: PaperMutationInput) => Promise<void>;
  onRemovePaper: (paperId: string) => Promise<void>;
}

/**
 * @function LibraryPage
 * @description 论文库页面。
 * 提供多维度的筛选条件（关键词、来源、标签、时间、状态），
 * 展示当前本地已下载和管理的论文列表，并展示论文库的全局统计数据。
 */
function LibraryPage(props: LibraryPageProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | PaperRecord['source']>('all');
  const [tag, setTag] = useState('all');
  const [readingStatus, setReadingStatus] = useState<'all' | ReadingStatus>('all');
  const [analysisStatus, setAnalysisStatus] = useState<'all' | AnalysisStatus>('all');
  const [timeRange, setTimeRange] = useState<'all' | '1' | '3' | '5'>('all');

  const availableTags = useMemo(
    () => Array.from(new Set(props.library.papers.flatMap((paper) => paper.tags))).sort((left, right) => left.localeCompare(right)),
    [props.library.papers],
  );

  const filteredPapers = useMemo(
    () =>
      props.library.papers.filter((paper) => {
        if (paper.isArchived) {
          return false;
        }

        if (source !== 'all' && paper.source !== source) {
          return false;
        }

        if (tag !== 'all' && !paper.tags.includes(tag)) {
          return false;
        }

        if (readingStatus !== 'all' && paper.readingStatus !== readingStatus) {
          return false;
        }

        if (analysisStatus !== 'all' && paper.analysisStatus !== analysisStatus) {
          return false;
        }

        if (!matchesTimeRange(paper.publishedAt, timeRange)) {
          return false;
        }

        if (!query.trim()) {
          return true;
        }

        const keyword = query.trim().toLowerCase();
        return [paper.title, paper.abstract, paper.authors.join(' '), paper.tags.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      }),
    [analysisStatus, props.library.papers, query, readingStatus, source, tag, timeRange],
  );

  return (
    <section className="page-grid library-page-stack">
      <SectionCard title="你的论文库" description="主界面只保留阅读和研究决策最相关的信息，路径与底层元数据已移到设置页。">
        <div className="metrics-grid">
          <MetricCard label="总数" value={String(props.library.summary.total)} />
          <MetricCard label="已下载" value={String(props.library.summary.downloaded)} />
          <MetricCard label="重点关注" value={String(props.library.summary.favorites)} />
          <MetricCard label="已归档" value={String(props.library.summary.archived)} />
        </div>
      </SectionCard>

      <SectionCard title="快速筛选" description="只保留真正影响阅读与分析决策的筛选条件。">
        <div className="filter-grid">
          <label className="field">
            <span>关键词</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、摘要、作者、标签" />
          </label>
          <label className="field">
            <span>来源</span>
            <select value={source} onChange={(event) => setSource(event.target.value as 'all' | PaperRecord['source'])}>
              <option value="all">全部</option>
              <option value="arxiv">arXiv</option>
              <option value="openalex">OpenAlex</option>
              <option value="cvf">CVF Open Access</option>
            </select>
          </label>
          <label className="field">
            <span>标签</span>
            <select value={tag} onChange={(event) => setTag(event.target.value)}>
              <option value="all">全部</option>
              {availableTags.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>时间</span>
            <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as 'all' | '1' | '3' | '5')}>
              <option value="all">全部时间</option>
              <option value="1">近 1 年</option>
              <option value="3">近 3 年</option>
              <option value="5">近 5 年</option>
            </select>
          </label>
          <label className="field">
            <span>阅读状态</span>
            <select value={readingStatus} onChange={(event) => setReadingStatus(event.target.value as 'all' | ReadingStatus)}>
              <option value="all">全部</option>
              {READING_STATUS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>分析状态</span>
            <select value={analysisStatus} onChange={(event) => setAnalysisStatus(event.target.value as 'all' | AnalysisStatus)}>
              <option value="all">全部</option>
              {ANALYSIS_STATUS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </SectionCard>

      <SectionCard title="论文列表" description={`当前命中 ${filteredPapers.length} 篇论文，可直接继续阅读或展开查看。`}>
        <div className="paper-list">
          {filteredPapers.length ? (
            filteredPapers.map((paper) => (
              <LibraryPaperCard
                key={paper.id}
                paper={paper}
                onRemovePaper={props.onRemovePaper}
              />
            ))
          ) : (
            <p className="muted">当前筛选条件下暂无论文，请先前往搜索页导入论文。</p>
          )}
        </div>
      </SectionCard>

    </section>
  );
}

interface LibraryPaperCardProps {
  paper: PaperRecord;
  onRemovePaper: (paperId: string) => Promise<void>;
}

/**
 * @function LibraryPaperCard
 * @description 论文库列表中的单篇论文卡片组件。
 * 展示论文的核心摘要和元数据，提供状态修改（阅读/分析）、标签编辑，
 * 以及快速跳转到阅读器、归档、删除等快捷操作。
 */
function LibraryPaperCard(props: LibraryPaperCardProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <article className={isExpanded ? 'paper-card library-paper-card library-paper-card-expanded' : 'paper-card library-paper-card'}>
      <div className="library-paper-row">
        <button
          type="button"
          className={isExpanded ? 'library-paper-toggle library-paper-toggle-expanded' : 'library-paper-toggle'}
          aria-label={isExpanded ? '收起论文信息' : '展开论文信息'}
          onClick={() => setIsExpanded((value) => !value)}
        >
          ›
        </button>
        <div className="library-paper-title-group">
          {props.paper.localPdfPath ? (
            <Link className="library-paper-title-link" to={`/reader?paper=${encodeURIComponent(props.paper.id)}`}>
              <h3>{props.paper.title}</h3>
            </Link>
          ) : (
            <h3 className="library-paper-title-static">{props.paper.title}</h3>
          )}
        </div>
        <button
          type="button"
          className="library-paper-delete"
          aria-label="删除论文"
          onClick={() => {
            void props.onRemovePaper(props.paper.id);
          }}
        >
          🗑
        </button>
      </div>

      {isExpanded ? (
        <div className="paper-card-main">
          <p>{props.paper.authors.join(' · ') || '作者信息缺失'}</p>
          <p className="paper-abstract">{truncateText(props.paper.abstract || '暂无摘要', 260)}</p>
          <div className="library-paper-meta-line">
            <span>发布时间：{formatDate(props.paper.publishedAt)}</span>
            <strong className="library-paper-source-pill">{getPaperSourceLabel(props.paper.source, props.paper.sourceLabel)}</strong>
          </div>
        </div>
      ) : null}
    </article>
  );
}

interface AiWorkbenchPageProps {
  agents: AgentDefinition[];
  latestTask: AgentTaskRecord | null;
  library: PaperLibraryPayload;
  topicTracking: TopicTrackingSnapshot;
  onSyncTopicTracking: (snapshot: TopicTrackingSnapshot) => void;
  onNotify: (notice: { tone: 'error' | 'success'; message: string }) => void;
  onRefreshLibrary: () => Promise<void>;
}

/**
 * @function AiWorkbenchPage
 * @description AI 工作台页面。
 * 整合了“单篇论文深度分析”和“主题追踪聚合分析”两个子面板，
 * 集中展示 AI 任务执行状态和产出报告。
 */
function AiWorkbenchPage(props: AiWorkbenchPageProps): JSX.Element {
  return (
    <section className="page-grid ai-page-stack">
      <SectionCard title="AI 能力总览" description="把复杂的 Agent 编排收在后台，前台只保留你真正会用到的三个入口。">
        <div className="metrics-grid">
          <MetricCard label="可用 Agent" value={String(props.agents.length)} />
          <MetricCard label="最近任务" value={props.latestTask ? '1' : '0'} />
          <MetricCard label="主题订阅" value={String(props.topicTracking.summary.totalSubscriptions)} />
        </div>
        <div className="detail-list">
          <div className="detail-row workbench-task-row">
            <div className="workbench-task-cell">
              <span>当前任务</span>
              <strong className="ellipsis-text">{props.latestTask?.title ?? '暂无执行中的任务'}</strong>
            </div>
            <div className="workbench-task-cell workbench-task-cell-right">
              <span>状态</span>
              <strong className="ellipsis-text">{props.latestTask ? `${props.latestTask.status} · ${props.latestTask.stage}` : '等待新的分析请求'}</strong>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="单篇论文深度分析" description="执行结构化分析、联网增强、代码验证记录与失败反馈。">
        <PaperAnalysisWorkbench
          library={props.library}
          onNotify={props.onNotify}
          onRefreshLibrary={props.onRefreshLibrary}
        />
      </SectionCard>

      <SectionCard title="主题订阅与聚合分析" description="维护研究主题、生成多论文报告，并支持每日定时抓取与执行历史查看。">
        <TopicTrackingWorkbench
          topicTracking={props.topicTracking}
          onSnapshotChange={props.onSyncTopicTracking}
          onNotify={props.onNotify}
        />
      </SectionCard>
    </section>
  );
}

interface SettingsPageProps {
  workspace: BootstrapPayload['workspace'];
  externalMedia: BootstrapPayload['externalMedia'];
  onSaveWorkspaceConfig: (input: WorkspaceConfigInput) => Promise<void>;
  onPreviewWorkspaceFontSize: (fontSize: number | null) => void;
}

/**
 * @function SettingsPage
 * @description 应用设置页面。
 * 将主流程中不需要的高级配置（如本地工作区目录路径、默认主题/模型、飞书等外部媒体接入点）
 * 集中在此处展示和管理，保持主界面清爽。
 */
function SettingsPage(props: SettingsPageProps): JSX.Element {
  const [defaultTheme, setDefaultTheme] = useState(props.workspace.config.defaultTheme);
  const [fontSize, setFontSize] = useState(normalizeWorkspaceFontSize(props.workspace.config.fontSize));
  const [defaultModel, setDefaultModel] = useState(props.workspace.config.defaultModel);
  const [workspaceDirectories, setWorkspaceDirectories] = useState(props.workspace.config.workspaceDirectories);
  const [externalMediaConfig, setExternalMediaConfig] = useState(props.workspace.config.externalMediaConfig);
  const [aiModelConfig, setAiModelConfig] = useState(props.workspace.config.aiModelConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const fontSizeProgress = useMemo(
    () => ((fontSize - MIN_WORKSPACE_FONT_SIZE) / (MAX_WORKSPACE_FONT_SIZE - MIN_WORKSPACE_FONT_SIZE)) * 100,
    [fontSize],
  );

  useEffect(() => {
    setDefaultTheme(props.workspace.config.defaultTheme);
    setFontSize(normalizeWorkspaceFontSize(props.workspace.config.fontSize));
    setDefaultModel(props.workspace.config.defaultModel);
    setWorkspaceDirectories(props.workspace.config.workspaceDirectories);
    setExternalMediaConfig(props.workspace.config.externalMediaConfig);
    setAiModelConfig(props.workspace.config.aiModelConfig);
  }, [props.workspace.config]);

  useEffect(() => {
    props.onPreviewWorkspaceFontSize(fontSize);
  }, [fontSize, props.onPreviewWorkspaceFontSize]);

  useEffect(() => {
    return () => {
      props.onPreviewWorkspaceFontSize(null);
    };
  }, [props.onPreviewWorkspaceFontSize]);

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    await props.onSaveWorkspaceConfig({
      defaultTheme,
      fontSize,
      defaultModel,
      workspaceDirectories,
      externalMediaConfig,
      aiModelConfig,
    });
    setIsSaving(false);
  }

  async function handlePickDirectory(key: keyof typeof workspaceDirectories): Promise<void> {
    const selectedPath = await window.desktopApi.pickDirectory(workspaceDirectories[key]);

    if (!selectedPath) {
      return;
    }

    setWorkspaceDirectories((current) => ({
      ...current,
      [key]: selectedPath,
    }));
  }

  return (
    <section className="page-grid settings-page-stack">
      <SectionCard
        title="界面偏好"
        description="保留日常体验最相关的界面偏好，点击标题旁的保存图标即可写入设置。"
        titleAction={
          <button type="button" className="settings-save-button" aria-label="保存界面偏好" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? '…' : <SaveIcon />}
          </button>
        }
      >
        <div className="filter-grid">
          <label className="field">
            <span>默认主题</span>
            <select value={defaultTheme} onChange={(event) => setDefaultTheme(event.target.value as WorkspaceConfigInput['defaultTheme'])}>
              <option value="system">跟随系统</option>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label className="field">
            <span>默认模型标识</span>
            <input value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder="例如：langchain-runtime-placeholder" />
          </label>
          <label className="field field-wide settings-font-slider-field">
            <span>字体大小</span>
            <div
              className="settings-font-slider-card"
              style={
                {
                  '--font-size-progress': `${fontSizeProgress}%`,
                } as CSSProperties
              }
            >
              <div className="settings-font-slider-header">
                <div>
                  <strong>{fontSize}px</strong>
                  <small>默认 14px，拖动时会即时预览整个界面的文字密度。</small>
                </div>
                <span className="settings-font-slider-badge">{fontSize === DEFAULT_WORKSPACE_FONT_SIZE ? '推荐' : '自定义'}</span>
              </div>
              <input
                className="settings-font-slider"
                type="range"
                min={MIN_WORKSPACE_FONT_SIZE}
                max={MAX_WORKSPACE_FONT_SIZE}
                step={1}
                value={fontSize}
                aria-label="调整界面字体大小"
                onChange={(event) => {
                  setFontSize(normalizeWorkspaceFontSize(Number(event.target.value)));
                }}
              />
              <div className="settings-font-slider-scale" aria-hidden="true">
                <span>紧凑</span>
                <span>标准</span>
                <span>舒展</span>
              </div>
            </div>
          </label>
        </div>
      </SectionCard>

      <SectionCard
        title="工作区路径"
        description="在这里修改工作区路径。保存后会持久化配置，新的路径会在后续启动和数据落盘时使用。"
        titleAction={
          <button type="button" className="settings-save-button" aria-label="保存工作区路径" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? '…' : <SaveIcon />}
          </button>
        }
      >
        <div className="path-list">
          {Object.entries(workspaceDirectories).map(([key, value]) => (
            <div key={key} className="path-item">
              <span>{getDirectoryLabel(key)}</span>
              <div className="settings-path-control">
                <input
                  value={value}
                  onChange={(event) =>
                    setWorkspaceDirectories((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
                <button type="button" className="ghost-button settings-path-picker" onClick={() => void handlePickDirectory(key as keyof typeof workspaceDirectories)}>
                  <FolderIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="外部接入"
        description="可在此自定义外部任务入口标题和接入地址，便于对接飞书等外部渠道。"
        titleAction={
          <button type="button" className="settings-save-button" aria-label="保存外部接入" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? '…' : <SaveIcon />}
          </button>
        }
      >
        <div className="filter-grid">
          <label className="field">
            <span>入口标题</span>
            <input
              value={externalMediaConfig.feishuTitle}
              onChange={(event) =>
                setExternalMediaConfig((current) => ({
                  ...current,
                  feishuTitle: event.target.value,
                }))
              }
              placeholder="例如：飞书论文分析入口"
            />
          </label>
          <label className="field">
            <span>入口地址</span>
            <input
              value={externalMediaConfig.feishuEntryUrl}
              onChange={(event) =>
                setExternalMediaConfig((current) => ({
                  ...current,
                  feishuEntryUrl: event.target.value,
                }))
              }
              placeholder="例如：http://127.0.0.1:17860/external-media/feishu/message"
            />
          </label>
        </div>
        <div className="detail-list">
          {props.externalMedia.protocols.length ? (
            props.externalMedia.protocols.map((protocol) => (
              <div key={protocol.entryUrl} className="path-item">
                <span>{protocol.title}</span>
                <code>{protocol.entryUrl}</code>
              </div>
            ))
          ) : (
            <p className="muted">当前没有可展示的外部接入协议。</p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="AI 大模型配置"
        description="允许你自行配置模型提供方、兼容接口地址、模型名与密钥，方便后续接入真实大模型。"
        titleAction={
          <button type="button" className="settings-save-button" aria-label="保存 AI 大模型配置" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? '…' : <SaveIcon />}
          </button>
        }
      >
        <div className="filter-grid">
          <label className="field">
            <span>提供方</span>
            <input
              value={aiModelConfig.provider}
              onChange={(event) =>
                setAiModelConfig((current) => ({
                  ...current,
                  provider: event.target.value,
                }))
              }
              placeholder="例如：OpenAI Compatible"
            />
          </label>
          <label className="field">
            <span>模型名</span>
            <input
              value={aiModelConfig.model}
              onChange={(event) =>
                setAiModelConfig((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder="例如：gpt-4.1-mini"
            />
          </label>
          <label className="field">
            <span>接口地址</span>
            <input
              value={aiModelConfig.baseUrl}
              onChange={(event) =>
                setAiModelConfig((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
              }
              placeholder="例如：https://api.openai.com/v1"
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <div className="settings-secret-field">
              <input
                value={aiModelConfig.apiKey}
                onChange={(event) =>
                  setAiModelConfig((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder="输入你的 API Key"
                type={isApiKeyVisible ? 'text' : 'password'}
              />
              <button
                type="button"
                className="settings-visibility-toggle"
                aria-label={isApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                onClick={() => setIsApiKeyVisible((value) => !value)}
              >
                {isApiKeyVisible ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
        </div>
      </SectionCard>
    </section>
  );
}

interface SectionCardProps {
  title: string;
  description: string;
  children: ReactNode;
  headerInline?: boolean;
  headerAction?: ReactNode;
  titleAction?: ReactNode;
}

function SectionCard(props: SectionCardProps): JSX.Element {
  return (
    <section className="section-card">
      <header className={props.headerInline ? 'section-header section-header-inline' : 'section-header'}>
        <div>
          <div className="section-title-row">
            <h3>{props.title}</h3>
            {props.titleAction}
          </div>
          <p>{props.description}</p>
        </div>
        {props.headerAction}
      </header>
      {props.children}
    </section>
  );
}

function SaveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.75h10.94l3.31 3.31V19.25H5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 4.75h7v4.5H8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 19.25V14h8v5.25" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.75 7.75A2.25 2.25 0 0 1 6 5.5h3.2l1.7 2H18A2.25 2.25 0 0 1 20.25 9.75v6.5A2.25 2.25 0 0 1 18 18.5H6a2.25 2.25 0 0 1-2.25-2.25z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2.75 12s3.4-5.25 9.25-5.25S21.25 12 21.25 12s-3.4 5.25-9.25 5.25S2.75 12 2.75 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.5 4.5 19.5 19.5M10.2 6.98A9.74 9.74 0 0 1 12 6.75c5.85 0 9.25 5.25 9.25 5.25a16.7 16.7 0 0 1-3.24 3.63M6.74 9.24A16.13 16.13 0 0 0 2.75 12s3.4 5.25 9.25 5.25c1.37 0 2.59-.29 3.68-.74"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.94 13.94A2.75 2.75 0 0 1 10.06 10.06" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

interface StateScreenProps {
  title: string;
  description: string;
}

function StateScreen(props: StateScreenProps): JSX.Element {
  return (
    <div className="state-screen">
      <div className="state-card">
        <p className="eyebrow">Vibe Reading</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}

function matchesTimeRange(value: string, range: 'all' | '1' | '3' | '5'): boolean {
  if (range === 'all') {
    return true;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - Number(range));

  return date >= limit;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

const READING_STATUS_OPTIONS: Array<{ value: ReadingStatus; label: string }> = [
  { value: 'unread', label: '未开始' },
  { value: 'reading', label: '阅读中' },
  { value: 'completed', label: '已读完' },
];

const ANALYSIS_STATUS_OPTIONS: Array<{ value: AnalysisStatus; label: string }> = [
  { value: 'idle', label: '未分析' },
  { value: 'queued', label: '待分析' },
  { value: 'running', label: '分析中' },
  { value: 'completed', label: '已分析' },
  { value: 'failed', label: '分析失败' },
];

function getDirectoryLabel(key: string): string {
  const labelMap: Record<string, string> = {
    root: '工作区根目录',
    papers: '论文 PDF',
    metadata: '索引与元数据',
    notes: '阅读笔记',
    analyses: 'AI 分析',
    tasks: '任务记录',
    cache: '缓存目录',
  };

  return labelMap[key] ?? key;
}
