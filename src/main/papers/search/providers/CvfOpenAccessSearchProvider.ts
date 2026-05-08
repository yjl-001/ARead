import type { PaperSearchResult } from '@shared/types';

import type { SearchProvider, SearchProviderContext, SearchProviderSearchInput } from '../types';

export class CvfOpenAccessSearchProvider implements SearchProvider {
  public readonly source = 'cvf' as const;

  public readonly label = 'CVF Open Access';

  public async search(input: SearchProviderSearchInput, context: SearchProviderContext): Promise<PaperSearchResult[]> {
    const url = new URL('https://openaccess.thecvf.com/search');
    url.searchParams.set('query', input.query);

    const response = await context.fetch(url, context.createRequestInit());

    if (!response.ok) {
      throw new Error(`CVF Open Access 搜索失败：${response.status}`);
    }

    const html = await response.text();
    const matches = Array.from(
      html.matchAll(/<dt class="ptitle">[\s\S]*?<a href="([^"]+\.html)">([\s\S]*?)<\/a>[\s\S]*?<\/dt>[\s\S]*?<dd>([\s\S]*?)<\/dd>/gi),
    );

    if (!matches.length) {
      throw new Error('CVF Open Access 解析搜索结果失败：页面结构可能已变更，请尝试其他来源');
    }

    return matches
      .slice(0, input.limit)
      .map((match) => {
        const relativePath = match[1];
        const entryUrl = new URL(relativePath, 'https://openaccess.thecvf.com/').toString();
        const title = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        const authorLine = decodeHtml(match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        const sourceId = (entryUrl.split('/').pop() ?? entryUrl).replace(/\.html$/i, '');
        const yearMatch = entryUrl.match(/(CVPR|ICCV|ECCV|WACV|ACCV|BMVC|FG)(\d{4})/i);
        const publishedAt = yearMatch?.[2] ? `${yearMatch[2]}-01-01T00:00:00.000Z` : '';
        const pdfUrl = derivePdfUrl(entryUrl);

        return {
          id: `cvf:${sourceId}`,
          sourceId,
          source: 'cvf' as const,
          sourceLabel: 'CVF Open Access',
          title,
          authors: authorLine.split(',').map((item) => item.trim()).filter(Boolean),
          abstract: '',
          publishedAt,
          entryUrl,
          pdfUrl,
          isOpenAccess: true,
        };
      })
      .filter((item) => item.title && item.pdfUrl);
  }
}

/**
 * 从 CVF 详情页 URL 推导 PDF 地址。
 * 标准模式：/html/CVPR2024/paper_123.html → /papers/CVPR2024/paper_123.pdf
 */
function derivePdfUrl(entryUrl: string): string {
  try {
    const parsed = new URL(entryUrl);
    parsed.pathname = parsed.pathname.replace('/html/', '/papers/').replace(/\.html$/i, '.pdf');
    return parsed.toString();
  } catch {
    return entryUrl.replace('/html/', '/papers/').replace(/\.html$/i, '.pdf');
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
