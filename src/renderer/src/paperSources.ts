import type { PaperSourceKey } from '@shared/types';

export function getPaperSourceLabel(source: PaperSourceKey, fallback?: string): string {
  if (source === 'openalex') {
    return 'OpenAlex';
  }

  if (source === 'cvf') {
    return 'CVF Open Access';
  }

  if (source === 'arxiv') {
    return 'arXiv';
  }

  return fallback ?? source;
}
