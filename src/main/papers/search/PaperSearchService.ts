import type { PaperSearchInput, PaperSearchResult, PaperSourceKey } from '@shared/types';

import { ArxivSearchProvider } from './providers/ArxivSearchProvider';
import { CvfOpenAccessSearchProvider } from './providers/CvfOpenAccessSearchProvider';
import { OpenAlexSearchProvider } from './providers/OpenAlexSearchProvider';
import type { SearchProvider, SearchProviderContext, SearchProviderCredentials } from './types';

/**
 * PaperSearchService 的可选构造参数。
 * - fetchImpl: 便于测试时注入 mock fetch
 * - searchProviders: 允许替换默认 Provider 集合
 * - providerCredentials: 为不同来源注入 Cookie / Token / Header
 */
interface PaperSearchServiceOptions {
  fetchImpl?: typeof fetch;
  searchProviders?: SearchProvider[];
  providerCredentials?: Partial<Record<PaperSourceKey, SearchProviderCredentials>>;
}

/**
 * 搜索模块的统一服务入口。
 *
 * 设计目标：
 * 1. 把“聚合调度”和“单站解析”彻底拆开；
 * 2. 让 Provider 可插拔，便于持续增加来源；
 * 3. 为后续 Cookie / Token / 自定义 Header / 重试策略预留统一扩展点。
 *
 * 当前它负责：
 * - 规范化 query 与 limit
 * - 根据来源路由到单个 Provider
 * - 在 all 模式下聚合多个 Provider
 * - 合并 credentials 并生成每个 Provider 的请求上下文
 * - 对搜索结果统一排序
 */
export class PaperSearchService {
  private readonly fetchImpl: typeof fetch;

  private readonly providerCredentials: Partial<Record<PaperSourceKey, SearchProviderCredentials>>;

  private readonly providers: Map<PaperSourceKey, SearchProvider>;

  /**
   * 默认注册 arXiv、OpenAlex 和 CVF Open Access。
   * 如果未来需要把某些来源迁移到配置文件或动态装配，
   * 只需在这里替换注册来源的方式，而无需改动上层业务代码。
   */
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
   * 对外暴露的统一搜索入口。
   *
   * 处理逻辑：
   * - 空 query 直接返回空数组
   * - 单源模式：只执行对应 Provider
   * - all 模式：并行执行所有 Provider，并尽可能保留成功结果
   *
   * 注意：
   * all 模式下只要至少一个 Provider 成功，就不会整体失败；
   * 只有全部来源都失败时，才会把错误合并后抛出。
   */
  public async search(input: PaperSearchInput): Promise<PaperSearchResult[]> {
    const query = input.query.trim();
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

    if (!query) {
      return [];
    }

    if (input.source !== 'all') {
      return this.runProvider(input.source, query, limit);
    }

    const activeProviders = Array.from(this.providers.values());
    const settledResults = await Promise.allSettled(
      activeProviders.map((provider) => provider.search({ query, limit }, this.createContext(provider.source))),
    );
    const fulfilledResults = settledResults
      .filter((result): result is PromiseFulfilledResult<PaperSearchResult[]> => result.status === 'fulfilled')
      .flatMap((result) => result.value);

    if (!fulfilledResults.length) {
      const reasons = settledResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => (result.reason instanceof Error ? result.reason.message : '搜索失败'));
      throw new Error(reasons.join('；'));
    }

    return this.sortResults(fulfilledResults).slice(0, limit * activeProviders.length);
  }

  /**
   * 执行指定来源的搜索。
   * 这里把 Provider 查找与错误提示收口，
   * 可以避免上层到处判断“某个 source 是否已注册”。
   */
  private async runProvider(source: PaperSourceKey, query: string, limit: number): Promise<PaperSearchResult[]> {
    const provider = this.providers.get(source);

    if (!provider) {
      throw new Error(`未注册搜索来源：${source}`);
    }

    try {
      return await provider.search({ query, limit }, this.createContext(source));
    } catch (error) {
      if (this.isRecoverableProviderError(error)) {
        return [];
      }

      throw error;
    }
  }

  /**
   * 为指定来源创建运行时上下文。
   *
   * createRequestInit 是关键扩展点：
   * Provider 只要传入自己需要的 RequestInit，
   * 这里就会把平台级 credentials 合并进去。
   *
   * 后续如果要加入：
   * - Referer
   * - CSRF Token
   * - 动态签名
   * - 代理配置
   * 也可以继续在这里集中演进。
   */
  private createContext(source: PaperSourceKey): SearchProviderContext {
    const credentials = this.providerCredentials[source];

    return {
      fetch: this.fetchImpl,
      credentials,
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
        };
      },
    };
  }

  /**
   * 当前统一按发布时间倒序排序。
   * 如果未来需要加入站点权重、相关性排序或混合排序，
   * 这里就是唯一的收口位置。
   */
  private sortResults(results: PaperSearchResult[]): PaperSearchResult[] {
    return [...results].sort(
      (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
    );
  }

  private isRecoverableProviderError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /\b(429|500|502|503|504)\b/.test(error.message);
  }
}
