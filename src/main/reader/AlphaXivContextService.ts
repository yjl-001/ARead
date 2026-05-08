const ALPHAXIV_API_BASE = 'https://api.alphaxiv.org';
const REQUEST_TIMEOUT_MS = 8000;

interface AlphaXivOverviewResponse {
  title?: string;
  overview?: string;
  summary?: {
    summary?: string;
    originalProblem?: string[];
    solution?: string[];
    keyInsights?: string[];
    results?: string[];
  };
}

/**
 * alphaXiv 上下文服务。
 * 仅负责拉取论文的 AI 概述，作为阅读问答的补充上下文。
 */
export class AlphaXivContextService {
  private readonly fetchImpl: typeof fetch;

  public constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  /**
   * 获取论文的 alphaXiv 概述文本。
   * 如果论文不支持或请求失败，返回 null。
   */
  public async fetchOverview(arxivId: string): Promise<string | null> {
    try {
      const uuid = await this.resolvePaperUuid(arxivId);
      if (!uuid) return null;

      const overview = await this.fetchOverviewByUuid(uuid);
      return overview;
    } catch {
      return null;
    }
  }

  private async resolvePaperUuid(arxivId: string): Promise<string | null> {
    const url = `${ALPHAXIV_API_BASE}/papers/v3/legacy/${encodeURIComponent(arxivId)}`;
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) return null;

    const data = (await response.json()) as { paper?: { paper_version?: { id?: string } } };
    return data?.paper?.paper_version?.id ?? null;
  }

  private async fetchOverviewByUuid(uuid: string): Promise<string | null> {
    const url = `${ALPHAXIV_API_BASE}/papers/v3/${encodeURIComponent(uuid)}/overview/en`;
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) return null;

    const data = (await response.json()) as AlphaXivOverviewResponse;
    return this.formatOverview(data);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Origin: 'https://alphaxiv.org' },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private formatOverview(data: AlphaXivOverviewResponse): string {
    const parts: string[] = [];

    if (data.summary?.summary) {
      parts.push(`## 论文概述\n${data.summary.summary}`);
    }

    if (data.summary?.originalProblem?.length) {
      parts.push(`\n### 研究问题\n${data.summary.originalProblem.map((s) => `- ${s}`).join('\n')}`);
    }

    if (data.summary?.solution?.length) {
      parts.push(`\n### 解决方案\n${data.summary.solution.map((s) => `- ${s}`).join('\n')}`);
    }

    if (data.summary?.keyInsights?.length) {
      parts.push(`\n### 关键洞察\n${data.summary.keyInsights.map((s) => `- ${s}`).join('\n')}`);
    }

    if (data.summary?.results?.length) {
      parts.push(`\n### 实验结果\n${data.summary.results.map((s) => `- ${s}`).join('\n')}`);
    }

    return parts.length > 0 ? `以下来自 alphaXiv 社区对该论文的 AI 结构化分析，可作为回答的额外参考：\n\n${parts.join('\n\n')}` : '';
  }
}
