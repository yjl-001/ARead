import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

import type { PaperRecord, WorkspaceDirectories } from '@shared/types';

export interface PaperTextPage {
  pageNumber: number;
  text: string;
}

export interface PaperTextChunk {
  id: string;
  pageStart: number;
  pageEnd: number;
  text: string;
}

export interface PaperTextIndex {
  paperId: string;
  sourcePdfPath: string;
  sourcePdfMtimeMs: number;
  sourcePdfSize: number;
  generatedAt: string;
  pages: PaperTextPage[];
  chunks: PaperTextChunk[];
}

export interface ReaderTextContext {
  currentPageText: string;
  nearbyPageText: string;
  relevantChunks: PaperTextChunk[];
  totalPages: number;
  isAvailable: boolean;
  failureReason: string | null;
}

const MAX_PAGE_TEXT_LENGTH = 4_000;
const MAX_NEARBY_TEXT_LENGTH = 5_000;
const CHUNK_SIZE = 1_600;
const CHUNK_OVERLAP = 240;

/**
 * @class PaperTextIndexService
 * @description 从本地 PDF 抽取按页文本并缓存，为阅读问答提供当前页、附近页和相关段落上下文。
 */
export class PaperTextIndexService {
  private readonly indexDirectory: string;

  public constructor(directories: WorkspaceDirectories) {
    this.indexDirectory = path.join(directories.cache, 'paper-text-indexes');
  }

  public async getReaderTextContext(paper: PaperRecord, currentPage: number, question: string): Promise<ReaderTextContext> {
    if (!paper.localPdfPath) {
      return this.createUnavailableContext('当前论文没有本地 PDF，无法抽取正文。');
    }

    try {
      const index = await this.getOrCreateIndex(paper);
      const normalizedCurrentPage = Math.min(Math.max(Math.trunc(currentPage), 1), Math.max(index.pages.length, 1));
      const currentPageText = this.truncateText(
        index.pages.find((page) => page.pageNumber === normalizedCurrentPage)?.text ?? '',
        MAX_PAGE_TEXT_LENGTH,
      );
      const nearbyPageText = this.truncateText(
        index.pages
          .filter((page) => Math.abs(page.pageNumber - normalizedCurrentPage) <= 1)
          .map((page) => `第 ${page.pageNumber} 页：${page.text}`)
          .join('\n\n'),
        MAX_NEARBY_TEXT_LENGTH,
      );
      const relevantChunks = this.pickRelevantChunks(index, question, normalizedCurrentPage);

      return {
        currentPageText,
        nearbyPageText,
        relevantChunks,
        totalPages: index.pages.length,
        isAvailable: Boolean(currentPageText || nearbyPageText || relevantChunks.length),
        failureReason: null,
      };
    } catch (error) {
      return this.createUnavailableContext(error instanceof Error ? error.message : 'PDF 正文抽取失败');
    }
  }

  private async getOrCreateIndex(paper: PaperRecord): Promise<PaperTextIndex> {
    await mkdir(this.indexDirectory, { recursive: true });

    const filePath = this.getIndexFilePath(paper.id);
    const pdfPath = paper.localPdfPath;

    if (!pdfPath) {
      throw new Error('当前论文没有本地 PDF，无法抽取正文。');
    }

    const pdfStat = await stat(pdfPath);
    const existingIndex = await this.readCachedIndex(filePath);

    if (
      existingIndex
      && existingIndex.sourcePdfPath === pdfPath
      && existingIndex.sourcePdfMtimeMs === pdfStat.mtimeMs
      && existingIndex.sourcePdfSize === pdfStat.size
    ) {
      return existingIndex;
    }

    const pages = await this.extractPages(pdfPath);
    const index: PaperTextIndex = {
      paperId: paper.id,
      sourcePdfPath: pdfPath,
      sourcePdfMtimeMs: pdfStat.mtimeMs,
      sourcePdfSize: pdfStat.size,
      generatedAt: new Date().toISOString(),
      pages,
      chunks: this.buildChunks(pages),
    };

    await writeFile(filePath, JSON.stringify(index, null, 2), 'utf-8');
    return index;
  }

  private async readCachedIndex(filePath: string): Promise<PaperTextIndex | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as PaperTextIndex;
    } catch {
      return null;
    }
  }

  private async extractPages(pdfPath: string): Promise<PaperTextPage[]> {
    const pdfBuffer = await readFile(pdfPath);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      disableFontFace: true,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const pages: PaperTextPage[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .filter(this.isTextItem)
        .map((item) => item.str)
        .join(' ');

      pages.push({
        pageNumber,
        text: this.normalizeWhitespace(text),
      });
    }

    await document.destroy();
    return pages;
  }

  private buildChunks(pages: PaperTextPage[]): PaperTextChunk[] {
    return pages.flatMap((page) => {
      if (!page.text) {
        return [];
      }

      const chunks: PaperTextChunk[] = [];
      let start = 0;
      let index = 1;

      while (start < page.text.length) {
        const end = Math.min(start + CHUNK_SIZE, page.text.length);
        chunks.push({
          id: `page-${page.pageNumber}-chunk-${index}`,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          text: page.text.slice(start, end).trim(),
        });

        if (end >= page.text.length) {
          break;
        }

        start = Math.max(end - CHUNK_OVERLAP, start + 1);
        index += 1;
      }

      return chunks;
    });
  }

  private pickRelevantChunks(index: PaperTextIndex, question: string, currentPage: number): PaperTextChunk[] {
    const queryTokens = this.extractQueryTokens(question);

    return index.chunks
      .map((chunk) => ({
        chunk,
        score: this.scoreChunk(chunk, queryTokens, currentPage),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((item) => ({
        ...item.chunk,
        text: this.truncateText(item.chunk.text, 1_200),
      }));
  }

  private scoreChunk(chunk: PaperTextChunk, queryTokens: string[], currentPage: number): number {
    const text = chunk.text.toLowerCase();
    const tokenScore = queryTokens.reduce((score, token) => (text.includes(token) ? score + 3 : score), 0);
    const pageDistance = Math.abs(chunk.pageStart - currentPage);
    const pageScore = Math.max(0, 4 - pageDistance);

    return tokenScore + pageScore;
  }

  private extractQueryTokens(question: string): string[] {
    const stopWords = new Set([
      'what',
      'why',
      'how',
      'the',
      'and',
      'for',
      'with',
      'this',
      'that',
      '请问',
      '这个',
      '什么',
      '如何',
      '为什么',
      '论文',
    ]);

    return Array.from(
      new Set(
        question
          .toLowerCase()
          .split(/[^a-z0-9\u4e00-\u9fa5]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2 && !stopWords.has(token)),
      ),
    ).slice(0, 12);
  }

  private createUnavailableContext(failureReason: string): ReaderTextContext {
    return {
      currentPageText: '',
      nearbyPageText: '',
      relevantChunks: [],
      totalPages: 0,
      isAvailable: false,
      failureReason,
    };
  }

  private getIndexFilePath(paperId: string): string {
    const safeId = paperId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return path.join(this.indexDirectory, `${safeId || 'paper'}.json`);
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength).trimEnd()}...`;
  }

  private isTextItem(item: unknown): item is TextItem {
    return Boolean(item && typeof item === 'object' && 'str' in item && typeof (item as { str?: unknown }).str === 'string');
  }
}
