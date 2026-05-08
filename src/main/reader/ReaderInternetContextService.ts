import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { InternetSearchHit, PaperRecord, WorkspaceDirectories } from '@shared/types';

import type { ReaderTextContext } from './PaperTextIndexService';

interface ReaderInternetContextServiceOptions {
  fetchImpl?: typeof fetch;
}

interface OpenAlexWork {
  id: string;
  display_name: string;
  publication_date?: string | null;
  authorships?: Array<{
    author?: {
      display_name?: string;
    };
  }>;
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: {
    landing_page_url?: string | null;
  } | null;
  doi?: string | null;
}

interface GithubRepositorySearchItem {
  html_url: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
}

export interface ReaderRepositoryCandidate {
  name: string;
  url: string;
  description: string;
  stars: number | null;
  language: string | null;
}

export type ReaderInternetIntent = 'none' | 'paper-context' | 'general-web';

export interface ReaderInternetContext {
  intent: ReaderInternetIntent;
  shouldSearch: boolean;
  isAvailable: boolean;
  queries: string[];
  hits: InternetSearchHit[];
  repository: ReaderRepositoryCandidate | null;
  failureReason: string | null;
  usedAt: string;
}

const INTERNET_CONTEXT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @class ReaderInternetContextService
 * @description 为阅读问答按需补充 OpenAlex 相关工作与 GitHub 候选仓库上下文。
 */
export class ReaderInternetContextService {
  private readonly fetchImpl: typeof fetch;

  private readonly cacheDirectory: string;

  public constructor(directories: WorkspaceDirectories, options: ReaderInternetContextServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheDirectory = path.join(directories.cache, 'reader-internet-context');
  }

  public async collect(
    paper: PaperRecord,
    question: string,
    textContext: ReaderTextContext,
  ): Promise<ReaderInternetContext> {
    const intent = this.classifyIntent(question);
    const shouldSearch = intent !== 'none';
    const usedAt = new Date().toISOString();

    if (!shouldSearch) {
      return {
        intent,
        shouldSearch: false,
        isAvailable: false,
        queries: [],
        hits: [],
        repository: null,
        failureReason: null,
        usedAt,
      };
    }

    try {
      await mkdir(this.cacheDirectory, { recursive: true });
      const queries = intent === 'general-web'
        ? this.buildGeneralWebQueries(question)
        : this.buildPaperContextQueries(paper, question, textContext);
      const cacheKey = this.createCacheKey(paper.id, `${intent}\n${queries.join('\n')}`);
      const cachedContext = await this.readCachedContext(cacheKey);

      if (cachedContext) {
        return cachedContext;
      }

      const [hits, repository] = intent === 'general-web'
        ? [
            await this.searchGeneralWeb(queries[0] ?? question, 5),
            null,
          ] as const
        : await this.collectPaperContextSearch(queries, paper, question);
      const context: ReaderInternetContext = {
        intent,
        shouldSearch: true,
        isAvailable: Boolean(hits.length || repository),
        queries,
        hits,
        repository,
        failureReason: hits.length || repository ? null : '联网检索没有返回可用补充资料。',
        usedAt,
      };

      await this.writeCachedContext(cacheKey, context);
      return context;
    } catch (error) {
      return {
        intent,
        shouldSearch: true,
        isAvailable: false,
        queries: [],
        hits: [],
        repository: null,
        failureReason: error instanceof Error ? error.message : '联网补充检索失败。',
        usedAt,
      };
    }
  }

  private classifyIntent(question: string): ReaderInternetIntent {
    const normalizedQuestion = question.toLowerCase();
    const paperContextTriggers = [
      '相关工作',
      '对比',
      '相比',
      '背景',
      '最新',
      '代码',
      '仓库',
      '复现',
      'benchmark',
      'dataset',
      'github',
      'related work',
      'compare',
      'comparison',
      'state of the art',
      'sota',
      'background',
      'repository',
      'code',
    ];
    const generalWebTriggers = [
      '网上',
      '网页',
      '搜索',
      '查一下',
      '查找',
      '查询',
      '新闻',
      '天气',
      '股价',
      '股票',
      '价格',
      '汇率',
      '政策',
      '法规',
      '总统',
      '首相',
      'ceo',
      '发布会',
      '官网',
      '今天',
      '昨天',
      '最近',
      '目前',
      '现在',
      'current',
      'today',
      'latest',
      'news',
      'weather',
      'price',
      'stock',
      'exchange rate',
      'official',
      'website',
      'web search',
    ];

    if (paperContextTriggers.some((trigger) => normalizedQuestion.includes(trigger))) {
      return 'paper-context';
    }

    if (generalWebTriggers.some((trigger) => normalizedQuestion.includes(trigger))) {
      return 'general-web';
    }

    return 'none';
  }

  private shouldSearchRepository(question: string): boolean {
    const normalizedQuestion = question.toLowerCase();
    return ['代码', '仓库', '复现', 'github', 'repository', 'code', 'implementation'].some((trigger) =>
      normalizedQuestion.includes(trigger),
    );
  }

  private buildPaperContextQueries(paper: PaperRecord, question: string, textContext: ReaderTextContext): string[] {
    const titleQuery = paper.title.trim();
    const questionQuery = [question, this.extractKeywords(textContext.currentPageText).slice(0, 4).join(' ')]
      .join(' ')
      .trim();

    return Array.from(new Set([titleQuery, questionQuery].filter(Boolean))).slice(0, 2);
  }

  private buildGeneralWebQueries(question: string): string[] {
    return [question.replace(/\s+/g, ' ').trim()].filter(Boolean);
  }

  private async collectPaperContextSearch(
    queries: string[],
    paper: PaperRecord,
    question: string,
  ): Promise<readonly [InternetSearchHit[], ReaderRepositoryCandidate | null]> {
    const [titleHits, questionHits, repository] = await Promise.all([
      this.searchOpenAlex(queries[0] ?? paper.title, 3),
      queries[1] ? this.searchOpenAlex(queries[1], 3) : Promise.resolve([]),
      this.shouldSearchRepository(question) ? this.searchGithubRepository(queries[0] ?? paper.title) : Promise.resolve(null),
    ]);
    const hits = this.deduplicateHits([...titleHits, ...questionHits]).slice(0, 5);

    return [hits, repository];
  }

  private async searchOpenAlex(query: string, limit: number): Promise<InternetSearchHit[]> {
    if (!query.trim()) {
      return [];
    }

    try {
      const url = new URL('https://api.openalex.org/works');
      url.searchParams.set('search', query);
      url.searchParams.set('per-page', String(limit));
      url.searchParams.set('sort', 'publication_date:desc');
      const response = await this.fetchImpl(url);

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as { results?: OpenAlexWork[] };

      return (payload.results ?? []).map((work) => ({
        title: work.display_name,
        url: work.doi ?? work.primary_location?.landing_page_url ?? work.id,
        snippet: this.truncateText(this.restoreOpenAlexAbstract(work.abstract_inverted_index) || '外部检索结果未提供摘要。', 240),
        source: 'OpenAlex',
        publishedAt: work.publication_date ?? null,
        authors: (work.authorships ?? [])
          .map((item) => item.author?.display_name?.trim() ?? '')
          .filter(Boolean),
      }));
    } catch {
      return [];
    }
  }

  private async searchGithubRepository(query: string): Promise<ReaderRepositoryCandidate | null> {
    if (!query.trim()) {
      return null;
    }

    try {
      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('q', query);
      url.searchParams.set('sort', 'stars');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', '3');
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vibe-reading-desktop',
        },
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { items?: GithubRepositorySearchItem[] };
      const repository = payload.items?.[0];

      if (!repository) {
        return null;
      }

      return {
        name: repository.full_name,
        url: repository.html_url,
        description: repository.description ?? 'GitHub 候选仓库未提供说明。',
        stars: repository.stargazers_count,
        language: repository.language,
      };
    } catch {
      return null;
    }
  }

  private async searchGeneralWeb(query: string, limit: number): Promise<InternetSearchHit[]> {
    if (!query.trim()) {
      return [];
    }

    try {
      const url = new URL('https://duckduckgo.com/html/');
      url.searchParams.set('q', query);
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'vibe-reading-desktop',
        },
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return this.parseDuckDuckGoResults(html).slice(0, limit);
    } catch {
      return [];
    }
  }

  private parseDuckDuckGoResults(html: string): InternetSearchHit[] {
    const results: InternetSearchHit[] = [];
    const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;

    while ((match = resultPattern.exec(html))) {
      const url = this.decodeDuckDuckGoUrl(this.decodeHtml(match[1]));
      const title = this.stripHtml(match[2]);
      const snippet = this.stripHtml(match[3]);

      if (!title || !url) {
        continue;
      }

      results.push({
        title,
        url,
        snippet: snippet || '网页搜索结果未提供摘要。',
        source: 'Web',
        publishedAt: null,
        authors: [],
      });
    }

    return this.deduplicateHits(results);
  }

  private async readCachedContext(cacheKey: string): Promise<ReaderInternetContext | null> {
    try {
      const filePath = path.join(this.cacheDirectory, `${cacheKey}.json`);
      const content = await readFile(filePath, 'utf-8');
      const context = JSON.parse(content) as ReaderInternetContext;

      if (Date.now() - new Date(context.usedAt).getTime() > INTERNET_CONTEXT_CACHE_TTL_MS) {
        return null;
      }

      return context;
    } catch {
      return null;
    }
  }

  private async writeCachedContext(cacheKey: string, context: ReaderInternetContext): Promise<void> {
    const filePath = path.join(this.cacheDirectory, `${cacheKey}.json`);
    await writeFile(filePath, JSON.stringify(context, null, 2), 'utf-8');
  }

  private deduplicateHits(hits: InternetSearchHit[]): InternetSearchHit[] {
    const seen = new Set<string>();

    return hits.filter((hit) => {
      if (seen.has(hit.url)) {
        return false;
      }

      seen.add(hit.url);
      return true;
    });
  }

  private extractKeywords(value: string): string[] {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'that',
      'this',
      'into',
      'their',
      'using',
      'paper',
      'method',
      'model',
      'approach',
    ]);

    return Array.from(
      new Set(
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 4 && !stopWords.has(token)),
      ),
    );
  }

  private restoreOpenAlexAbstract(index?: Record<string, number[]>): string {
    if (!index) {
      return '';
    }

    const tokens: string[] = [];
    for (const [word, positions] of Object.entries(index)) {
      for (const position of positions) {
        tokens[position] = word;
      }
    }

    return tokens.join(' ').trim();
  }

  private createCacheKey(paperId: string, query: string): string {
    const value = `${paperId}-${query}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);

    return value || `reader-internet-${Date.now()}`;
  }

  private decodeDuckDuckGoUrl(value: string): string {
    try {
      const parsedUrl = new URL(value, 'https://duckduckgo.com');
      const redirectedUrl = parsedUrl.searchParams.get('uddg');
      return redirectedUrl ? decodeURIComponent(redirectedUrl) : parsedUrl.toString();
    } catch {
      return value;
    }
  }

  private stripHtml(value: string): string {
    return this.decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength).trimEnd()}...`;
  }
}
