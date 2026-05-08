import type { PaperSearchResult } from '@shared/types';

import type { SearchProvider, SearchProviderContext, SearchProviderSearchInput } from '../types';

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

export class OpenAlexSearchProvider implements SearchProvider {
  public readonly source = 'openalex' as const;

  public readonly label = 'OpenAlex';

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
        const publishedAt = work.publication_date && !Number.isNaN(new Date(work.publication_date).getTime())
          ? work.publication_date
          : '';

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
          publishedAt,
          entryUrl,
          pdfUrl,
          isOpenAccess: Boolean(pdfUrl),
        };
      })
      .filter((work) => work.pdfUrl);
  }
}

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
