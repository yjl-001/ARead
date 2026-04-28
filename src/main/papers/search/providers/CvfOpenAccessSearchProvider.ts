import type { PaperSearchResult } from '@shared/types';

import type { SearchProvider, SearchProviderContext, SearchProviderSearchInput } from '../types';

/**
 * CVF Open Access 搜索 Provider。
 *
 * 特点：
 * - 页面是 HTML 而非结构化 API
 * - 需要从搜索结果页中解析论文详情页链接与作者文本
 * - PDF 地址可以根据详情页 URL 规则推导
 *
 * 它代表了“没有官方 JSON API 的站点”接入方式，
 * 适合未来扩展更多需要 HTML 抓取的来源。
 */
export class CvfOpenAccessSearchProvider implements SearchProvider {
  public readonly source = 'cvf' as const;

  public readonly label = 'CVF Open Access';

  /**
   * 执行 CVF 搜索并解析 HTML 列表结果。
   */
  public async search(input: SearchProviderSearchInput, context: SearchProviderContext): Promise<PaperSearchResult[]> {
    const url = new URL('https://openaccess.thecvf.com/search');
    url.searchParams.set('query', input.query);

    const response = await context.fetch(url, context.createRequestInit());

    if (!response.ok) {
      throw new Error(`CVF Open Access 搜索失败：${response.status}`);
    }

    const html = await response.text();
    const matches = Array.from(html.matchAll(/<dt class="ptitle">[\s\S]*?<a href="([^"]+\.html)">([\s\S]*?)<\/a>[\s\S]*?<\/dt>[\s\S]*?<dd>([\s\S]*?)<\/dd>/gi));

    return matches
      .slice(0, input.limit)
      .map((match) => {
        const entryUrl = new URL(match[1], 'https://openaccess.thecvf.com/').toString();
        const title = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        const authorLine = decodeHtml(match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        const sourceId = (entryUrl.split('/').pop() ?? entryUrl).replace(/\.html$/i, '');
        const yearMatch = entryUrl.match(/(CVPR|ICCV|ECCV|WACV)(\d{4})/i);
        const publishedAt = yearMatch?.[2] ? `${yearMatch[2]}-01-01T00:00:00.000Z` : new Date().toISOString();
        const pdfUrl = entryUrl.replace('/html/', '/papers/').replace(/\.html$/i, '.pdf');

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
 * 对 HTML 实体做基础解码，避免标题与作者字符串保留转义符。
 */
function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
