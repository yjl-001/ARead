import type { PaperSearchResult } from '@shared/types';

import type { SearchProvider, SearchProviderContext, SearchProviderSearchInput } from '../types';

export class ArxivSearchProvider implements SearchProvider {
  public readonly source = 'arxiv' as const;

  public readonly label = 'arXiv';

  public async search(input: SearchProviderSearchInput, context: SearchProviderContext): Promise<PaperSearchResult[]> {
    const url = new URL('https://export.arxiv.org/api/query');
    url.searchParams.set('search_query', `all:${input.query}`);
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', String(input.limit));
    url.searchParams.set('sortBy', 'lastUpdatedDate');
    url.searchParams.set('sortOrder', 'descending');

    const requestInit = context.createRequestInit({
      headers: {
        Accept: 'application/atom+xml,application/xml;q=0.9,text/xml;q=0.8',
        'User-Agent': 'vibe-reading/1.0 (desktop paper search)',
      },
    });
    const response = await this.fetchWithRetry(url, requestInit, context);

    if (!response.ok) {
      throw new Error(`arXiv 搜索失败：${response.status}`);
    }

    const xml = await response.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];

    return entries.map((entry) => {
      const entryUrl = readXmlValue(entry, 'id');
      const sourceId = entryUrl.split('/abs/').pop() ?? entryUrl;
      const rawPdfUrl = readXmlAttribute(entry, 'title="pdf"', 'href');
      const pdfUrl = rawPdfUrl || (sourceId ? `https://arxiv.org/pdf/${sourceId}.pdf` : null);
      const publishedRaw = readXmlValue(entry, 'published');

      return {
        id: `arxiv:${sourceId}`,
        sourceId,
        source: 'arxiv' as const,
        sourceLabel: 'arXiv',
        title: readXmlValue(entry, 'title'),
        authors: Array.from(entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)).map((match) => decodeXml(match[1])),
        abstract: readXmlValue(entry, 'summary'),
        publishedAt: validateDateString(publishedRaw),
        entryUrl,
        pdfUrl,
        isOpenAccess: true,
      };
    });
  }

  private async fetchWithRetry(url: URL, requestInit: RequestInit, context: SearchProviderContext): Promise<Response> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await context.fetch(url, requestInit);

        if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
          return response;
        }
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }

    throw lastError ?? new Error('arXiv 搜索重试失败');
  }
}

function readXmlValue(entry: string, tagName: string): string {
  const match = entry.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return decodeXml(match?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

function readXmlAttribute(entry: string, marker: string, attribute: string): string | null {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = entry.match(new RegExp(`<link[^>]*${escapedMarker}[^>]*${attribute}="([^"]+)"[^>]*\\/>`));
  return match?.[1] ?? null;
}

/**
 * 解码 XML 实体，包括命名实体和数字字符引用。
 */
function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * 验证日期字符串是否可解析。
 * 不可解析时返回空字符串，避免用当前时间污染排序。
 */
function validateDateString(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : value;
}
