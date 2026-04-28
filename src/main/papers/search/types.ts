import type { PaperSearchResult, PaperSourceKey } from '@shared/types';

/**
 * 每个搜索来源可能拥有自己的鉴权材料。
 * 当前先支持 Cookie、Token 与自定义 Header，
 * 后续如果某个站点还需要 Session、签名参数或动态 Referer，
 * 可以继续在这里扩展，不必修改 Provider 接口本身。
 */
export interface SearchProviderCredentials {
  cookie?: string;
  token?: string;
  headers?: Record<string, string>;
}

/**
 * Provider 执行搜索时所需的运行时上下文。
 * 这里把 fetch、鉴权数据和请求构造能力集中封装，
 * 让每个 Provider 只关心“如何搜索该站点”，
 * 而不用重复关心 Header 合并、Cookie 注入等横切逻辑。
 */
export interface SearchProviderContext {
  fetch: typeof fetch;
  credentials?: SearchProviderCredentials;
  createRequestInit: (init?: RequestInit) => RequestInit;
}

/**
 * Provider 统一接收的搜索输入。
 * 统一约束 query 和 limit 的含义后，
 * 各 Provider 就可以独立实现自己的网站解析细节。
 */
export interface SearchProviderSearchInput {
  query: string;
  limit: number;
}

/**
 * 搜索来源插件的统一契约。
 * 新增来源时只需要实现这个接口并注册到 PaperSearchService，
 * 即可参与单源搜索或 all 聚合搜索。
 */
export interface SearchProvider {
  source: PaperSourceKey;
  label: string;
  search(input: SearchProviderSearchInput, context: SearchProviderContext): Promise<PaperSearchResult[]>;
}
