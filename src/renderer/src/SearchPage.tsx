import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  PaperLibraryPayload,
  PaperSearchResult,
  PaperSearchSource,
} from '@shared/types';

import { getPaperSourceLabel } from './paperSources';

/**
 * 搜索页的最小依赖输入。
 * 页面自身只负责搜索与渲染，不直接操作全局状态容器，
 * 由上层把论文库快照和导入行为注入进来。
 */
interface SearchPageProps {
  library: PaperLibraryPayload;
  onImportPaper: (paper: PaperSearchResult) => Promise<void>;
}

/**
 * 搜索页面组件。
 *
 * 主要职责：
 * - 管理 query / source / results / searching 等本地交互状态
 * - 调用 desktopApi 发起聚合搜索
 * - 渲染搜索表单与结果列表
 * - 复用论文库状态，提示论文是否已导入
 *
 * 这里被单独拆出后，App.tsx 只保留路由与全局壳层职责，
 * 便于后续继续把搜索表单、结果卡片拆成更细粒度组件。
 */
export function SearchPage(props: SearchPageProps): JSX.Element {
  const [query, setQuery] = useState('graph neural network');
  const [source, setSource] = useState<PaperSearchSource>('all');
  const [results, setResults] = useState<PaperSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [importingId, setImportingId] = useState('');

  /**
   * 预先把已入库论文转成 Set，避免每个结果卡片都在线性查找。
   */
  const existingIds = useMemo(() => new Set(props.library.papers.map((paper) => paper.id)), [props.library.papers]);

  /**
   * 触发一次新的搜索。
   * 每次搜索前会清空旧错误，并记录用户已经执行过搜索动作，
   * 这样首屏占位与“搜索无结果”的文案就能区分开。
   */
  async function handleSearch(): Promise<void> {
    if (!query.trim()) {
      return;
    }

    setIsSearching(true);
    setSearchError('');
    setHasSearched(true);

    try {
      const nextResults = await window.desktopApi.searchPapers({
        query,
        source,
        limit: 8,
      });
      setResults(nextResults);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '搜索失败');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  /**
   * 导入论文并在按钮上显示局部 loading 状态。
   */
  async function handleImport(candidate: PaperSearchResult): Promise<void> {
    setImportingId(candidate.id);
    await props.onImportPaper(candidate);
    setImportingId('');
  }

  return (
    <section className="page-grid search-page-stack">
      <SearchSectionCard title="论文搜索" description="支持统一检索 arXiv、OpenAlex 与 CVF Open Access 论文，并直接下载入库。" headerInline>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSearch();
          }}
        >
          <label className="field field-wide">
            <span>主题词或论文名</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入主题、方法名或论文标题" />
          </label>
          <label className="field">
            <span>来源</span>
            <select value={source} onChange={(event) => setSource(event.target.value as PaperSearchSource)}>
              <option value="all">全部来源</option>
              <option value="arxiv">仅 arXiv</option>
              <option value="openalex">仅 OpenAlex</option>
              <option value="cvf">仅 CVF Open Access</option>
            </select>
          </label>
          <button type="submit" className="primary-button search-submit-button" disabled={isSearching || !query.trim()}>
            {isSearching ? '搜索中...' : '开始搜索'}
          </button>
        </form>
      </SearchSectionCard>

      <SearchSectionCard title="搜索结果" description="结果展示标题、作者、摘要、来源、发布时间与下载状态。" headerInline>
        {searchError ? <p className="error-text">{searchError}</p> : null}
        <div className="paper-list">
          {results.length ? (
            results.map((result) => (
              <article key={result.id} className="paper-card result-card">
                <div className="paper-card-main">
                  <div className="paper-card-header">
                    <div>
                      <h3>{result.title}</h3>
                      <p>{result.authors.join(' · ') || '作者信息缺失'}</p>
                    </div>
                    <div className="badge-row search-result-source-badge">
                      <SearchStatusBadge value={result.source} label={getPaperSourceLabel(result.source, result.sourceLabel)} />
                    </div>
                  </div>
                  <p className="paper-abstract">{truncateText(result.abstract || '暂无摘要', 240)}</p>
                  <div className="search-result-meta-line">
                    <span>{`发布时间：${formatDate(result.publishedAt)}`}</span>
                    <strong className={result.isOpenAccess ? 'search-result-status search-result-status-open' : 'search-result-status search-result-status-restricted'}>
                      {`可获取状态：${result.isOpenAccess ? '支持直接下载 PDF' : '当前仅提供详情页入口'}`}
                    </strong>
                  </div>
                </div>
                <div className="action-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={importingId === result.id}
                    onClick={() => {
                      void handleImport(result);
                    }}
                  >
                    {existingIds.has(result.id) ? '重新下载并同步' : importingId === result.id ? '下载中...' : '下载并入库'}
                  </button>
                  <a className="link-button" href={result.entryUrl} target="_blank" rel="noreferrer">
                    查看原文
                  </a>
                </div>
              </article>
            ))
          ) : hasSearched && !isSearching ? (
            <p className="muted">未检索到结果，请尝试更换关键词或来源。</p>
          ) : (
            <p className="muted">输入主题词后开始搜索，结果会按时间倒序汇总展示。</p>
          )}
        </div>
      </SearchSectionCard>

    </section>
  );
}

interface SearchSectionCardProps {
  title: string;
  description: string;
  children: ReactNode;
  headerInline?: boolean;
}

/**
 * 搜索页面内部使用的轻量卡片容器。
 * 保留和全局 SectionCard 一致的视觉风格，
 * 同时支持标题与说明在同一行展示。
 */
function SearchSectionCard(props: SearchSectionCardProps): JSX.Element {
  return (
    <section className="section-card">
      <header className={props.headerInline ? 'section-header section-header-inline' : 'section-header'}>
        <div>
          <h3>{props.title}</h3>
          <p>{props.description}</p>
        </div>
      </header>
      {props.children}
    </section>
  );
}

/**
 * 搜索结果中的来源徽章。
 * 这里做了局部封装，后续如果不同来源要显示图标或固定宽度，
 * 可以只改这一个组件。
 */
function SearchStatusBadge(props: { value: string; label?: string }): JSX.Element {
  const className = `status-badge status-${props.value.replace(/\s+/g, '-').toLowerCase()}`;

  return <span className={className}>{props.label ?? props.value}</span>;
}

/**
 * 统一格式化搜索结果中的日期。
 */
function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

/**
 * 控制摘要预览长度，避免结果卡片被长摘要撑高。
 */
function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}
