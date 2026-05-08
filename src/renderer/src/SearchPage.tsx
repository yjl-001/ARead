import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  PaperLibraryPayload,
  PaperSearchResult,
  PaperSearchSource,
} from '@shared/types';

import { getPaperSourceLabel } from './paperSources';

interface SearchPageProps {
  library: PaperLibraryPayload;
  onImportPaper: (paper: PaperSearchResult) => Promise<void>;
}

export function SearchPage(props: SearchPageProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<PaperSearchSource>('all');
  const [results, setResults] = useState<PaperSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [importingId, setImportingId] = useState('');

  /** 请求版本号：每次新搜索递增，结果返回时只有版本号匹配才写入 state。 */
  const requestVersion = useRef(0);

  const existingIds = useMemo(() => new Set(props.library.papers.map((paper) => paper.id)), [props.library.papers]);

  const handleSearch = useCallback(async function handleSearch(): Promise<void> {
    if (!query.trim()) {
      return;
    }

    requestVersion.current += 1;
    const currentVersion = requestVersion.current;

    setIsSearching(true);
    setSearchError('');
    setHasSearched(true);

    try {
      const nextResults = await window.desktopApi.searchPapers({
        query,
        source,
        limit: 8,
      });

      if (currentVersion !== requestVersion.current) {
        return;
      }

      setResults(nextResults);
    } catch (error) {
      if (currentVersion !== requestVersion.current) {
        return;
      }

      setSearchError(error instanceof Error ? error.message : '搜索失败');
      setResults([]);
    } finally {
      if (currentVersion === requestVersion.current) {
        setIsSearching(false);
      }
    }
  }, [query, source]);

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
                    <span>{result.publishedAt ? `发布时间：${formatDate(result.publishedAt)}` : '发布时间：未知'}</span>
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

function SearchStatusBadge(props: { value: string; label?: string }): JSX.Element {
  const className = `status-badge status-${props.value.replace(/\s+/g, '-').toLowerCase()}`;

  return <span className={className}>{props.label ?? props.value}</span>;
}

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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}
