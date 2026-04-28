import type { InternetSearchHit, PaperRecord } from '@shared/types';

interface InternetSearchServiceOptions {
  fetchImpl?: typeof fetch;
}

interface OpenAlexWork {
  id: string;
  display_name: string;
  publication_date?: string | null;
  authorships?: Array<{
    author?: {
      display_name?: string;
    };
  }>;
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: {
    landing_page_url?: string | null;
  } | null;
  doi?: string | null;
}

interface GithubRepositorySearchItem {
  html_url: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
}

export interface RepositoryCandidate {
  name: string;
  url: string;
  description: string;
  dependencyFiles: string[];
  detectedCommands: string[];
}

export interface InternetResearchContext {
  queries: string[];
  hits: InternetSearchHit[];
  repository: RepositoryCandidate | null;
}

/**
 * @class InternetSearchService
 * @description 基于开放互联网接口补充相关工作线索与候选代码仓库信息。
 * @param {InternetSearchServiceOptions} options 可选的 fetch 依赖注入配置
 * @returns {InternetSearchService} 联网检索服务实例
 */
export class InternetSearchService {
  private readonly fetchImpl: typeof fetch;

  public constructor(options: InternetSearchServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * @function collectResearchContext
   * @description 围绕单篇论文补充相关工作检索结果与候选代码仓库。
   * @param {PaperRecord} paper 目标论文记录
   * @returns {Promise<InternetResearchContext>} 联网增强上下文
   */
  public async collectResearchContext(paper: PaperRecord): Promise<InternetResearchContext> {
    const queries = this.buildQueries(paper);
    const [titleHits, keywordHits, repository] = await Promise.all([
      this.searchOpenAlex(queries[0] ?? paper.title, 3),
      queries[1] ? this.searchOpenAlex(queries[1], 3) : Promise.resolve([]),
      this.findRepositoryCandidate(paper, queries),
    ]);
    const hits = this.deduplicateHits([...titleHits, ...keywordHits]).slice(0, 6);

    return {
      queries,
      hits,
      repository,
    };
  }

  /**
   * @function searchOpenAlex
   * @description 使用 OpenAlex 检索与目标论文主题接近的外部工作。
   * @param {string} query 检索查询
   * @param {number} limit 返回结果条数
   * @returns {Promise<InternetSearchHit[]>} 标准化后的检索结果
   */
  private async searchOpenAlex(query: string, limit: number): Promise<InternetSearchHit[]> {
    if (!query.trim()) {
      return [];
    }

    try {
      const url = new URL('https://api.openalex.org/works');
      url.searchParams.set('search', query);
      url.searchParams.set('per-page', String(limit));
      url.searchParams.set('sort', 'publication_date:desc');
      const response = await this.fetchImpl(url);

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as { results?: OpenAlexWork[] };

      return (payload.results ?? []).map((work) => ({
        title: work.display_name,
        url: work.doi ?? work.primary_location?.landing_page_url ?? work.id,
        snippet: this.truncateText(this.restoreOpenAlexAbstract(work.abstract_inverted_index) || '外部检索结果未提供摘要。', 220),
        source: 'OpenAlex',
        publishedAt: work.publication_date ?? null,
        authors: (work.authorships ?? [])
          .map((item) => item.author?.display_name?.trim() ?? '')
          .filter(Boolean),
      }));
    } catch {
      return [];
    }
  }

  /**
   * @function findRepositoryCandidate
   * @description 优先解析显式 GitHub 链接，缺失时通过 GitHub 搜索候选代码仓库。
   * @param {PaperRecord} paper 目标论文记录
   * @param {string[]} queries 候选查询列表
   * @returns {Promise<RepositoryCandidate | null>} 候选仓库信息
   */
  private async findRepositoryCandidate(
    paper: PaperRecord,
    queries: string[],
  ): Promise<RepositoryCandidate | null> {
    const explicitRepositoryUrl = this.extractGithubUrl([paper.entryUrl, paper.abstract, paper.pdfUrl ?? ''].join('\n'));

    if (explicitRepositoryUrl) {
      return this.getRepositoryFromUrl(explicitRepositoryUrl);
    }

    for (const query of queries) {
      const candidate = await this.searchGithubRepository(query);

      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * @function searchGithubRepository
   * @description 从 GitHub 搜索结果中挑选最可能与论文相关的仓库。
   * @param {string} query 查询文本
   * @returns {Promise<RepositoryCandidate | null>} 解析后的仓库信息
   */
  private async searchGithubRepository(query: string): Promise<RepositoryCandidate | null> {
    if (!query.trim()) {
      return null;
    }

    try {
      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('q', query);
      url.searchParams.set('sort', 'stars');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', '5');
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vibe-reading-desktop',
        },
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { items?: GithubRepositorySearchItem[] };
      const repository = (payload.items ?? [])[0];

      if (!repository?.html_url) {
        return null;
      }

      return this.getRepositoryFromUrl(repository.html_url, repository);
    } catch {
      return null;
    }
  }

  /**
   * @function getRepositoryFromUrl
   * @description 根据仓库地址读取目录结构并推断依赖文件和候选运行命令。
   * @param {string} repositoryUrl 仓库地址
   * @param {GithubRepositorySearchItem | undefined} searchItem 可选的搜索结果基础信息
   * @returns {Promise<RepositoryCandidate | null>} 仓库候选信息
   */
  private async getRepositoryFromUrl(
    repositoryUrl: string,
    searchItem?: GithubRepositorySearchItem,
  ): Promise<RepositoryCandidate | null> {
    const parsed = this.parseGithubRepositoryUrl(repositoryUrl);

    if (!parsed) {
      return null;
    }

    try {
      const contentsUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents`;
      const response = await this.fetchImpl(contentsUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vibe-reading-desktop',
        },
      });

      if (!response.ok) {
        return {
          name: searchItem?.full_name ?? `${parsed.owner}/${parsed.repo}`,
          url: repositoryUrl,
          description: searchItem?.description ?? '已发现候选仓库，但暂未读取到目录详情。',
          dependencyFiles: [],
          detectedCommands: [],
        };
      }

      const contents = (await response.json()) as Array<{ name?: string; type?: string }>;
      const rootFiles = contents
        .map((item) => item.name?.trim() ?? '')
        .filter(Boolean);
      const dependencyFiles = rootFiles.filter((file) =>
        ['package.json', 'requirements.txt', 'pyproject.toml', 'environment.yml', 'Dockerfile'].includes(file),
      );

      return {
        name: searchItem?.full_name ?? `${parsed.owner}/${parsed.repo}`,
        url: repositoryUrl,
        description: searchItem?.description ?? '候选仓库已发现，可用于后续代码验证。',
        dependencyFiles,
        detectedCommands: this.detectCommands(rootFiles),
      };
    } catch {
      return null;
    }
  }

  /**
   * @function buildQueries
   * @description 从标题与摘要中提取联网检索查询，兼顾论文名和主题关键词。
   * @param {PaperRecord} paper 目标论文记录
   * @returns {string[]} 查询列表
   */
  private buildQueries(paper: PaperRecord): string[] {
    const titleQuery = paper.title.trim();
    const keywordQuery = this.extractKeywords(`${paper.title} ${paper.abstract}`).slice(0, 6).join(' ');
    return [titleQuery, keywordQuery].filter(Boolean);
  }

  /**
   * @function deduplicateHits
   * @description 按链接去重外部检索结果，避免同一工作重复展示。
   * @param {InternetSearchHit[]} hits 原始检索结果
   * @returns {InternetSearchHit[]} 去重后的结果
   */
  private deduplicateHits(hits: InternetSearchHit[]): InternetSearchHit[] {
    const seen = new Set<string>();

    return hits.filter((hit) => {
      if (seen.has(hit.url)) {
        return false;
      }

      seen.add(hit.url);
      return true;
    });
  }

  /**
   * @function extractGithubUrl
   * @description 从论文文本中提取显式 GitHub 仓库链接。
   * @param {string} value 待扫描文本
   * @returns {string | null} 仓库链接或空值
   */
  private extractGithubUrl(value: string): string | null {
    const match = value.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
    return match?.[0] ?? null;
  }

  /**
   * @function parseGithubRepositoryUrl
   * @description 解析 GitHub 仓库地址中的 owner 和 repo 标识。
   * @param {string} repositoryUrl 仓库地址
   * @returns {{ owner: string; repo: string } | null} 仓库标识
   */
  private parseGithubRepositoryUrl(repositoryUrl: string): { owner: string; repo: string } | null {
    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/);

    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2].replace(/\.git$/, ''),
    };
  }

  /**
   * @function detectCommands
   * @description 根据常见依赖文件推断后续可尝试的验证命令。
   * @param {string[]} rootFiles 仓库根目录文件列表
   * @returns {string[]} 候选命令列表
   */
  private detectCommands(rootFiles: string[]): string[] {
    const commands: string[] = [];

    // 关键逻辑：基于依赖清单文件推断最基础的安装与运行命令，为实验验证记录提供可解释线索。
    if (rootFiles.includes('requirements.txt') || rootFiles.includes('pyproject.toml')) {
      commands.push('python -m pip install -r requirements.txt');
      commands.push('python main.py');
    }

    if (rootFiles.includes('package.json')) {
      commands.push('npm install');
      commands.push('npm run start');
    }

    if (rootFiles.includes('environment.yml')) {
      commands.push('conda env create -f environment.yml');
    }

    return Array.from(new Set(commands));
  }

  /**
   * @function extractKeywords
   * @description 从标题和摘要中提取简化关键词，用于相关工作与仓库搜索。
   * @param {string} value 输入文本
   * @returns {string[]} 关键词列表
   */
  private extractKeywords(value: string): string[] {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'from',
      'that',
      'this',
      'into',
      'their',
      'using',
      'towards',
      'based',
      'study',
      'paper',
      'approach',
      'method',
      'analysis',
      'system',
      'research',
    ]);

    return Array.from(
      new Set(
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 4 && !stopWords.has(token)),
      ),
    );
  }

  /**
   * @function restoreOpenAlexAbstract
   * @description 将 OpenAlex 的倒排摘要索引还原为连续文本。
   * @param {Record<string, number[]> | undefined} index 倒排索引
   * @returns {string} 还原后的摘要
   */
  private restoreOpenAlexAbstract(index?: Record<string, number[]>): string {
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

  /**
   * @function truncateText
   * @description 将长文本裁剪到适合界面展示和结构化存档的长度。
   * @param {string} value 原始文本
   * @param {number} maxLength 最大长度
   * @returns {string} 裁剪后的文本
   */
  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength).trimEnd()}...`;
  }
}
