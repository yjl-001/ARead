import type { PaperSearchResult } from '@shared/types';

import type { SearchProvider, SearchProviderContext, SearchProviderSearchInput } from '../types';

/**
 * OpenAlex works 接口的最小字段模型。
 * 这里只保留当前搜索模块真正需要的字段，
 * 保证 Provider 对外部 API 结构变化有最小耦合面。
 */
interface OpenAlexWork {
  id: string;
  display_name: string;
  publication_date: string | null;
  authorships?: Array<{
    author?: {
      display_name?: string;
    };
  }>;
  abstract_inverted_index?: Record<string, number[]>;
  doi?: string | null;
  best_oa_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
  } | null;
  primary_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
  } | null;
}

/**
 * OpenAlex 搜索 Provider。
 *
 * 特点：
 * - 通过 works 接口直接拿结构化 JSON
 * - 可从 best_oa_location / primary_location 中提取 PDF 与落地页
 * - abstract 需要从 inverted index 还原成普通文本
 *
 * 相比 arXiv 和 CVF，它的结构最规整，
 * 也是后续扩展“更多元数据字段”的最好切入点。
 */
export class OpenAlexSearchProvider implements SearchProvider {
  public readonly source = 'openalex' as const;

  public readonly label = 'OpenAlex';

  /**
   * 把 OpenAlex works 结果转换为统一搜索结果。
   */
  public async search(input: SearchProviderSearchInput, context: SearchProviderContext): Promise<PaperSearchResult[]> {
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', input.query);
    url.searchParams.set('per-page', String(input.limit));
    url.searchParams.set('filter', 'is_oa:true,has_fulltext:true');
    url.searchParams.set('sort', 'publication_date:desc');

    const response = await context.fetch(url, context.createRequestInit());

    if (!response.ok) {
      throw new Error(`OpenAlex 搜索失败：${response.status}`);
    }

    const payload = (await response.json()) as { results?: OpenAlexWork[] };

    return (payload.results ?? [])
      .map((work) => {
        const pdfUrl = work.best_oa_location?.pdf_url ?? work.primary_location?.pdf_url ?? null;
        const entryUrl = work.doi ?? work.best_oa_location?.landing_page_url ?? work.primary_location?.landing_page_url ?? work.id;
        const sourceId = work.id.split('/').pop() ?? work.id;

        return {
          id: `openalex:${sourceId}`,
          sourceId,
          source: 'openalex' as const,
          sourceLabel: 'OpenAlex',
          title: work.display_name,
          authors: (work.authorships ?? [])
            .map((authorship) => authorship.author?.display_name?.trim() ?? '')
            .filter(Boolean),
          abstract: restoreOpenAlexAbstract(work.abstract_inverted_index),
          publishedAt: work.publication_date ?? new Date().toISOString(),
          entryUrl,
          pdfUrl,
          isOpenAccess: Boolean(pdfUrl),
        };
      })
      .filter((work) => work.pdfUrl);
  }
}

/**
 * OpenAlex 用倒排索引存储摘要。
 * 这里按位置回填 token，重新拼出正常摘要文本。
 */
function restoreOpenAlexAbstract(index?: Record<string, number[]>): string {
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
