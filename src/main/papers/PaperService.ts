import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  PaperLibraryPayload,
  PaperMutationInput,
  PaperRecord,
  PaperSearchInput,
  PaperSearchResult,
  PaperSourceKey,
  WorkspaceDirectories,
} from '@shared/types';

import { PaperSearchService } from './search/PaperSearchService';

interface PaperServiceOptions {
  fetchImpl?: typeof fetch;
}

export class PaperService {
  private readonly fetchImpl: typeof fetch;

  private readonly searchService: PaperSearchService;

  private readonly files: {
    indexFile: string;
    recordDirectory: string;
    pdfDirectory: string;
  };

  public constructor(directories: WorkspaceDirectories, options: PaperServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.searchService = new PaperSearchService({
      fetchImpl: this.fetchImpl,
    });
    this.files = {
      indexFile: path.join(directories.metadata, 'papers.json'),
      recordDirectory: path.join(directories.metadata, 'papers'),
      pdfDirectory: directories.papers,
    };
  }

  public async getLibrary(): Promise<PaperLibraryPayload> {
    const records = await this.readPaperRecords();
    return this.createLibraryPayload(records);
  }

  /**
   * @function getPaperById
   * @description 按论文标识读取单篇论文记录，供阅读器和 AI 上下文复用。
   * @param {string} paperId 论文唯一标识
   * @returns {Promise<PaperRecord | null>} 论文记录或空值
   */
  public async getPaperById(paperId: string): Promise<PaperRecord | null> {
    const records = await this.readPaperRecords();
    return records.find((record) => record.id === paperId) ?? null;
  }

  public async search(input: PaperSearchInput): Promise<PaperSearchResult[]> {
    return this.searchService.search(input);
  }

  public async importPaper(candidate: PaperSearchResult): Promise<PaperLibraryPayload> {
    await this.ensureStorage();

    const records = await this.readPaperRecords();
    const existingRecord = records.find((record) => record.id === candidate.id);
    const now = new Date().toISOString();
    const safeId = this.createSafeId(candidate.source, candidate.sourceId);
    const metadataPath = path.join(this.files.recordDirectory, `${safeId}.json`);
    const localPdfPath = candidate.pdfUrl ? path.join(this.files.pdfDirectory, `${safeId}.pdf`) : existingRecord?.localPdfPath ?? null;

    if (candidate.pdfUrl && localPdfPath) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      let response: Response;
      try {
        response = await this.fetchImpl(candidate.pdfUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`下载 PDF 失败：${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      await writeFile(localPdfPath, Buffer.from(arrayBuffer));
    }

    const nextRecord: PaperRecord = {
      id: candidate.id,
      sourceId: candidate.sourceId,
      title: candidate.title,
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
      authors: candidate.authors,
      abstract: candidate.abstract,
      publishedAt: candidate.publishedAt,
      status: candidate.pdfUrl ? existingRecord?.status ?? 'downloaded' : 'metadata-only',
      addedAt: existingRecord?.addedAt ?? now,
      updatedAt: now,
      entryUrl: candidate.entryUrl,
      pdfUrl: candidate.pdfUrl,
      localPdfPath,
      metadataPath,
      readingStatus: existingRecord?.readingStatus ?? 'unread',
      analysisStatus: existingRecord?.analysisStatus ?? 'idle',
      isFavorite: existingRecord?.isFavorite ?? false,
      isArchived: existingRecord?.isArchived ?? false,
      tags: existingRecord?.tags ?? this.buildDefaultTags(candidate),
      lastAction: candidate.pdfUrl ? '已下载 PDF 并写入论文库' : '已写入元数据，待补充 PDF',
    };

    await writeFile(metadataPath, JSON.stringify(nextRecord, null, 2), 'utf-8');
    const nextRecords = records.filter((record) => record.id !== nextRecord.id);
    nextRecords.push(nextRecord);
    await this.writePaperRecords(nextRecords);

    return this.createLibraryPayload(nextRecords);
  }

  public async updatePaper(paperId: string, patch: PaperMutationInput): Promise<PaperLibraryPayload> {
    await this.ensureStorage();

    const records = await this.readPaperRecords();
    const record = records.find((item) => item.id === paperId);

    if (!record) {
      throw new Error('未找到对应论文');
    }

    const nextRecord: PaperRecord = {
      ...record,
      ...patch,
      tags: patch.tags ? this.normalizeTags(patch.tags) : record.tags,
      updatedAt: new Date().toISOString(),
      lastAction: this.describeMutation(record, patch),
    };

    await writeFile(nextRecord.metadataPath, JSON.stringify(nextRecord, null, 2), 'utf-8');
    const nextRecords = records.map((item) => (item.id === paperId ? nextRecord : item));
    await this.writePaperRecords(nextRecords);

    return this.createLibraryPayload(nextRecords);
  }

  public async removePaper(paperId: string): Promise<PaperLibraryPayload> {
    await this.ensureStorage();

    const records = await this.readPaperRecords();
    const record = records.find((item) => item.id === paperId);

    if (!record) {
      return this.createLibraryPayload(records);
    }

    const nextRecords = records.filter((item) => item.id !== paperId);
    await this.writePaperRecords(nextRecords);

    await Promise.all([
      record.localPdfPath ? rm(record.localPdfPath, { force: true }) : Promise.resolve(),
      rm(record.metadataPath, { force: true }),
    ]);

    return this.createLibraryPayload(nextRecords);
  }

  private async ensureStorage(): Promise<void> {
    await Promise.all([
      mkdir(this.files.recordDirectory, { recursive: true }),
      mkdir(this.files.pdfDirectory, { recursive: true }),
    ]);

    try {
      await readFile(this.files.indexFile, 'utf-8');
    } catch {
      await writeFile(this.files.indexFile, '[]', 'utf-8');
    }
  }

  private async readPaperRecords(): Promise<PaperRecord[]> {
    await this.ensureStorage();

    try {
      const content = await readFile(this.files.indexFile, 'utf-8');
      return (JSON.parse(content) as PaperRecord[]).map((record) => this.normalizePaperRecord(record));
    } catch {
      return [];
    }
  }

  private async writePaperRecords(records: PaperRecord[]): Promise<void> {
    await writeFile(this.files.indexFile, JSON.stringify(records, null, 2), 'utf-8');
  }

  private createLibraryPayload(records: PaperRecord[]): PaperLibraryPayload {
    const papers = [...records].sort((left, right) => {
      if (left.isFavorite !== right.isFavorite) {
        return left.isFavorite ? -1 : 1;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

    return {
      papers,
      summary: {
        total: papers.length,
        downloaded: papers.filter((paper) => Boolean(paper.localPdfPath)).length,
        indexed: papers.filter((paper) => paper.status === 'indexed').length,
        favorites: papers.filter((paper) => paper.isFavorite).length,
        archived: papers.filter((paper) => paper.isArchived).length,
      },
    };
  }

  private normalizePaperRecord(record: PaperRecord): PaperRecord {
    return {
      ...record,
      authors: Array.isArray(record.authors) ? record.authors : [],
      tags: Array.isArray(record.tags) ? record.tags : [],
    };
  }

  private buildDefaultTags(candidate: PaperSearchResult): string[] {
    return this.normalizeTags([
      candidate.sourceLabel,
      ...candidate.title.split(/[\s:/,-]+/).slice(0, 3),
    ]);
  }

  private normalizeTags(tags: string[]): string[] {
    return Array.from(
      new Set(
        tags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => tag.slice(0, 24)),
      ),
    );
  }

  private describeMutation(record: PaperRecord, patch: PaperMutationInput): string {
    if (typeof patch.isArchived === 'boolean' && patch.isArchived !== record.isArchived) {
      return patch.isArchived ? '已归档论文' : '已恢复到论文库';
    }

    if (typeof patch.isFavorite === 'boolean' && patch.isFavorite !== record.isFavorite) {
      return patch.isFavorite ? '已加入重点关注' : '已取消重点关注';
    }

    if (patch.status && patch.status !== record.status) {
      return `已更新入库状态为 ${patch.status}`;
    }

    if (patch.readingStatus && patch.readingStatus !== record.readingStatus) {
      return `已更新阅读状态为 ${patch.readingStatus}`;
    }

    if (patch.analysisStatus && patch.analysisStatus !== record.analysisStatus) {
      return `已更新分析状态为 ${patch.analysisStatus}`;
    }

    if (patch.tags) {
      return '已更新标签';
    }

    return '已更新论文记录';
  }

  private createSafeId(source: PaperSourceKey, sourceId: string): string {
    const normalizedSourceId = sourceId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return `${source}-${normalizedSourceId || 'paper'}`;
  }

}
