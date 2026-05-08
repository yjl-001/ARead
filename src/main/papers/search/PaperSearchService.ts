import type { PaperSearchInput, PaperSearchResult, PaperSourceKey } from '@shared/types';

import { ArxivSearchProvider } from './providers/ArxivSearchProvider';
import { CvfOpenAccessSearchProvider } from './providers/CvfOpenAccessSearchProvider';
import { OpenAlexSearchProvider } from './providers/OpenAlexSearchProvider';
import type { SearchProvider, SearchProviderContext, SearchProviderCredentials } from './types';

const SEARCH_TIMEOUT_MS = 15_000;

interface PaperSearchServiceOptions {
  fetchImpl?: typeof fetch;
  searchProviders?: SearchProvider[];
  providerCredentials?: Partial<Record<PaperSourceKey, SearchProviderCredentials>>;
}

export class PaperSearchService {
  private readonly fetchImpl: typeof fetch;

  private readonly providerCredentials: Partial<Record<PaperSourceKey, SearchProviderCredentials>>;

  private readonly providers: Map<PaperSourceKey, SearchProvider>;

  public constructor(options: PaperSearchServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.providerCredentials = options.providerCredentials ?? {};
    this.providers = new Map(
      (options.searchProviders ?? [
        new ArxivSearchProvider(),
        new OpenAlexSearchProvider(),
        new CvfOpenAccessSearchProvider(),
      ]).map((provider) => [provider.source, provider]),
    );
  }

  /**
   * 统一搜索入口。
   *
   * - 空 query 直接返回空数组
   * - 单源模式：只执行对应 Provider
   * - all 模式：并行执行所有 Provider，去重后按时间排序
   * - 每个 Provider 有 15s 超时保护
   */
  public async search(input: PaperSearchInput): Promise<PaperSearchResult[]> {
    const query = input.query.trim();
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

    if (!query) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      if (input.source !== 'all') {
        const results = await this.runProvider(input.source, query, limit, controller.signal);
        return results;
      }

      const activeProviders = Array.from(this.providers.values());
      const settledResults = await Promise.allSettled(
        activeProviders.map((provider) =>
          provider.search({ query, limit }, this.createContext(provider.source, controller.signal)),
        ),
      );

      const fulfilledResults = settledResults
        .filter((result): result is PromiseFulfilledResult<PaperSearchResult[]> => result.status === 'fulfilled')
        .flatMap((result) => result.value);

      if (!fulfilledResults.length) {
        const reasons = settledResults
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => {
            if (result.reason instanceof Error) {
              const msg = result.reason.name === 'AbortError' ? '搜索超时' : result.reason.message;
              return msg;
            }
            return '搜索失败';
          });
        throw new Error(reasons.join('；'));
      }

      const deduped = this.deduplicateResults(fulfilledResults);
      return this.sortResults(deduped).slice(0, limit * activeProviders.length);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async runProvider(
    source: PaperSourceKey,
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<PaperSearchResult[]> {
    const provider = this.providers.get(source);

    if (!provider) {
      throw new Error(`未注册搜索来源：${source}`);
    }

    try {
      return await provider.search({ query, limit }, this.createContext(source, signal));
    } catch (error) {
      if (this.isRecoverableProviderError(error)) {
        return [];
      }

      throw error;
    }
  }

  private createContext(source: PaperSourceKey, signal?: AbortSignal): SearchProviderContext {
    const credentials = this.providerCredentials[source];

    return {
      fetch: this.fetchImpl,
      credentials,
      signal,
      createRequestInit: (init: RequestInit = {}) => {
        const headers = new Headers(init.headers ?? {});

        Object.entries(credentials?.headers ?? {}).forEach(([key, value]) => {
          headers.set(key, value);
        });

        if (credentials?.token) {
          headers.set('Authorization', `Bearer ${credentials.token}`);
        }

        if (credentials?.cookie) {
          headers.set('Cookie', credentials.cookie);
        }

        return {
          ...init,
          headers,
          signal: init.signal ?? signal,
        };
      },
    };
  }

  /**
   * 按发布时间倒序排序。
   * 缺少日期的结果排在最后。
   */
  private sortResults(results: PaperSearchResult[]): PaperSearchResult[] {
    return [...results].sort((left, right) => {
      const leftTime = new Date(left.publishedAt || '').getTime();
      const rightTime = new Date(right.publishedAt || '').getTime();

      if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
      if (Number.isNaN(leftTime)) return 1;
      if (Number.isNaN(rightTime)) return -1;

      return rightTime - leftTime;
    });
  }

  /**
   * 对跨来源的重复结果按标题去重。
   * 比较时忽略大小写和常见标点，保留摘要更长的版本。
   */
  private deduplicateResults(results: PaperSearchResult[]): PaperSearchResult[] {
    const seen = new Map<string, PaperSearchResult>();

    for (const result of results) {
      const normalized = normalizeTitleForDedup(result.title);

      if (!normalized) {
        seen.set(result.id, result);
        continue;
      }

      const existing = seen.get(normalized);
      if (!existing || (result.abstract?.length ?? 0) > (existing.abstract?.length ?? 0)) {
        seen.set(normalized, result);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 按照错误类型和状态码判断是否可以静默恢复。
   *
   * 可恢复：网络错误（fetch 失败、超时、DNS 不可达）和临时性 HTTP 状态码。
   * 不可恢复：编程错误、类型错误、认证失败（401/403）等。
   */
  private isRecoverableProviderError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }

    if (error instanceof TypeError) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    if (/\b(429|500|502|503|504)\b/.test(error.message)) {
      return true;
    }

    if (error.message.includes('fetch') || error.message.includes('network')) {
      return true;
    }

    return false;
  }
}

/**
 * 标准化标题用于去重比较：
 * 转小写、去除 HTML 标签和常见标点、合并空白。
 */
function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9一-鿿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
