import type { AiSearchResponse } from '@/types';

const SEARCH_MODES: AiSearchResponse['mode'][] = [
  'conversation',
  'local_knowledge',
  'keyword',
  'natural_language',
  'vector',
  'hybrid',
  'ai_enhanced',
];
const RETRIEVAL_MODES: AiSearchResponse['retrievalMode'][] = [
  'none',
  'keyword',
  'vector',
  'vector+keyword',
];

export function normalizeAiSearchResponse(value: unknown): AiSearchResponse | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const response = value as Partial<AiSearchResponse>;
  if (!Array.isArray(response.results) || typeof response.totalCount !== 'number') {
    return null;
  }
  return {
    query: typeof response.query === 'string' ? response.query : '',
    mode: SEARCH_MODES.includes(response.mode as AiSearchResponse['mode'])
      ? response.mode as AiSearchResponse['mode']
      : 'local_knowledge',
    results: response.results.slice(0, 10),
    totalCount: Math.max(0, Math.min(10, Math.round(response.totalCount))),
    contextQueriesUsed: Array.isArray(response.contextQueriesUsed)
      ? response.contextQueriesUsed.filter((item): item is string => typeof item === 'string')
      : [],
    contextApplied: Boolean(response.contextApplied),
    aiEnhanced: Boolean(response.aiEnhanced),
    aiQuery: typeof response.aiQuery === 'string' ? response.aiQuery : null,
    aiRationaleZh: typeof response.aiRationaleZh === 'string' ? response.aiRationaleZh : null,
    aiError: typeof response.aiError === 'string' ? response.aiError : null,
    answerZh: typeof response.answerZh === 'string' ? response.answerZh : null,
    retrievalMode: RETRIEVAL_MODES.includes(response.retrievalMode as AiSearchResponse['retrievalMode'])
      ? response.retrievalMode as AiSearchResponse['retrievalMode']
      : 'keyword',
    vectorApplied: Boolean(response.vectorApplied),
    vectorError: typeof response.vectorError === 'string' ? response.vectorError : null,
  };
}
