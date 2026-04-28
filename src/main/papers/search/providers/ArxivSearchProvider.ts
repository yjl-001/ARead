import type { PaperSearchResult } from '@shared/types';

import type { SearchProvider, SearchProviderContext, SearchProviderSearchInput } from '../types';

/**
 * arXiv 搜索 Provider。
 *
 * 特点：
 * - 直接请求官方 Atom API
 * - 响应格式是 XML，需要手动解析 entry / link / author
 * - PDF 地址有时会显式给出，有时需要根据 abs 链接推导
 *
 * 这里保留了较轻量的正则解析方式，
 * 因为当前只需要抽取稳定字段，避免额外引入 XML 解析依赖。
 */
export class ArxivSearchProvider implements SearchProvider {
  public readonly source = 'arxiv' as const;

  public readonly label = 'arXiv';

  /**
   * 执行 arXiv 搜索并把 Atom 条目转换成统一的 PaperSearchResult。
   */
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

      return {
        id: `arxiv:${sourceId}`,
        sourceId,
        source: 'arxiv' as const,
        sourceLabel: 'arXiv',
        title: readXmlValue(entry, 'title'),
        authors: Array.from(entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)).map((match) => decodeXml(match[1])),
        abstract: readXmlValue(entry, 'summary'),
        publishedAt: readXmlValue(entry, 'published'),
        entryUrl,
        pdfUrl,
        isOpenAccess: true,
      };
    });
  }

  private async fetchWithRetry(url: URL, requestInit: RequestInit, context: SearchProviderContext): Promise<Response> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await context.fetch(url, requestInit);

      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
        return response;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }

    throw new Error('arXiv 搜索重试失败');
  }
}

/**
 * 提取单个 XML 标签内容并做基础解码。
 */
function readXmlValue(entry: string, tagName: string): string {
  const match = entry.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return decodeXml(match?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 在 entry 内查找带特定标记的 link 属性。
 * 这里主要用于抽取 title="pdf" 对应的 href。
 */
function readXmlAttribute(entry: string, marker: string, attribute: string): string | null {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = entry.match(new RegExp(`<link[^>]*${escapedMarker}[^>]*${attribute}="([^"]+)"[^>]*\\/>`));
  return match?.[1] ?? null;
}

/**
 * 处理常见 XML 实体，避免标题、摘要与作者信息乱码。
 */
function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
