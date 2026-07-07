import {
  createRepoQuery,
  type AiRepositoryDocument,
  type GitHubAccountId,
  type ReadmeDocument,
  type RepoQuery,
  type RepoQueryInput,
  type RepositoryAnnotation,
  type RepositoryEmbeddingRecord,
  type RepositoryFacts,
  type RepositoryId,
  type SearchCitation,
  type SearchMatchReason,
  type SearchResult,
} from '@gsat/domain';

export type SearchPort = {
  search(query: RepoQuery): Promise<SearchResult[]>;
};

export type InMemorySearchRecord = SearchExplanationSource;

export type InMemorySearchOptions = {
  records: readonly InMemorySearchRecord[];
  explanationBuilder?: SearchExplanationBuilder;
};

export type IndexPort = {
  rebuildRepositoryIndex(repoId: RepositoryId): Promise<void>;
};

export type VectorSearchInput = {
  accountId?: GitHubAccountId | null;
  vector: number[];
  model: string;
  modelVersion: string;
  limit: number;
  minScore?: number | null;
};

export type VectorSearchHit = {
  repoId: RepositoryId;
  score: number;
};

export type VectorIndexPort = {
  upsertRepositoryEmbedding(record: RepositoryEmbeddingRecord): Promise<void>;
  searchRepositoryEmbeddings(input: VectorSearchInput): Promise<VectorSearchHit[]>;
};

export type InMemoryVectorIndexOptions = {
  records?: readonly RepositoryEmbeddingRecord[];
};

export type SearchExplanationSource = {
  repository: RepositoryFacts;
  aiDocument?: AiRepositoryDocument | null;
  readme?: ReadmeDocument | null;
  annotation?: RepositoryAnnotation | null;
  vectorScore?: number | null;
};

export type SearchExplanationBuilderInput = {
  query: RepoQuery;
  source: SearchExplanationSource;
  score: number;
};

export type SearchExplanationBuilder = {
  toSearchResult(input: SearchExplanationBuilderInput): SearchResult;
};

export const defaultSearchExplanationBuilder: SearchExplanationBuilder = {
  toSearchResult(input) {
    const reasons = buildMatchReasons(input.query, input.source);
    const citations = buildCitations(input.query, input.source);

    return {
      repository: input.source.repository,
      score: input.score,
      explanationZh: buildExplanationZh(input.query, input.source, reasons),
      reasons,
      citations,
    };
  },
};

export type KeywordFilterInput = {
  keyword?: string | null;
  language?: string | null;
  tagId?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type NaturalLanguageQueryInput = {
  query: string;
  limit?: number | null;
  offset?: number | null;
};

export type QueryInterpreter = {
  toRepoQuery(input: string, base?: RepoQueryInput): Promise<RepoQuery>;
  fromKeywordFilters(input: KeywordFilterInput): RepoQuery;
  fromNaturalLanguage(input: NaturalLanguageQueryInput): RepoQuery;
};

export const defaultQueryInterpreter: QueryInterpreter = {
  async toRepoQuery(input, base = {}) {
    return createRepoQuery({
      ...base,
      text: input,
    });
  },

  fromKeywordFilters(input) {
    return createRepoQuery({
      text: input.keyword,
      languages: input.language ? [input.language] : [],
      tags: input.tagId ? [input.tagId] : [],
      limit: input.limit,
      offset: input.offset,
      mode: 'keyword',
    });
  },

  fromNaturalLanguage(input) {
    return createRepoQuery({
      naturalLanguage: input.query,
      limit: input.limit,
      offset: input.offset,
      mode: 'natural_language',
    });
  },
};

export function createInMemorySearchPort(options: InMemorySearchOptions): SearchPort {
  const explanationBuilder = options.explanationBuilder ?? defaultSearchExplanationBuilder;

  return {
    async search(query) {
      const scoredResults = options.records
        .filter((record) => matchesStructuredFilters(query, record))
        .map((record) => ({
          record,
          score: scoreRecord(query, record),
        }))
        .filter((item) => item.score > 0 || hasOnlyStructuredFilters(query))
        .sort((left, right) => {
          const scoreOrder = right.score - left.score;
          if (scoreOrder !== 0) {
            return scoreOrder;
          }

          return compareBySort(query, left.record.repository, right.record.repository);
        });

      return scoredResults
        .slice(query.offset, query.offset + query.limit)
        .map((item) => explanationBuilder.toSearchResult({
          query,
          source: item.record,
          score: item.score,
        }));
    },
  };
}

export function createInMemoryVectorIndexPort(options: InMemoryVectorIndexOptions = {}): VectorIndexPort {
  const records = new Map<string, RepositoryEmbeddingRecord>();

  for (const record of options.records ?? []) {
    records.set(toVectorRecordKey(record), normalizeEmbeddingRecord(record));
  }

  return {
    async upsertRepositoryEmbedding(record) {
      records.set(toVectorRecordKey(record), normalizeEmbeddingRecord(record));
    },

    async searchRepositoryEmbeddings(input) {
      const queryVector = normalizeVector(input.vector);
      const limit = normalizeVectorLimit(input.limit);
      const minScore = input.minScore ?? Number.NEGATIVE_INFINITY;

      if (queryVector.length === 0 || limit === 0) {
        return [];
      }

      return Array.from(records.values())
        .filter((record) => matchesVectorSearchInput(input, queryVector.length, record))
        .map((record) => ({
          repoId: record.repoId,
          score: cosineSimilarity(queryVector, record.vector),
        }))
        .filter((hit) => Number.isFinite(hit.score) && hit.score >= minScore)
        .sort((left, right) => {
          const scoreOrder = right.score - left.score;
          return scoreOrder === 0 ? left.repoId.localeCompare(right.repoId) : scoreOrder;
        })
        .slice(0, limit);
    },
  };
}

function buildMatchReasons(query: RepoQuery, source: SearchExplanationSource): SearchMatchReason[] {
  return [
    ...buildKeywordReasons(query, source),
    ...query.languages
      .filter((language) => source.repository.language === language)
      .map((language): SearchMatchReason => ({
        kind: 'language',
        label: '语言匹配',
        detail: `项目主要语言是 ${language}。`,
      })),
    ...query.topics
      .filter((topic) => source.repository.topics.includes(topic))
      .map((topic): SearchMatchReason => ({
        kind: 'topic',
        label: 'Topic 匹配',
        detail: `GitHub Topic 包含 ${topic}。`,
      })),
    ...(source.vectorScore == null
      ? []
      : [
          {
            kind: 'semantic' as const,
            label: '语义匹配',
            detail: `向量召回相似度为 ${formatScore(source.vectorScore)}。`,
          },
        ]),
  ];
}

function buildKeywordReasons(query: RepoQuery, source: SearchExplanationSource): SearchMatchReason[] {
  const keyword = query.text ?? query.naturalLanguage;

  if (!keyword) {
    return [];
  }

  const normalizedKeyword = keyword.toLowerCase();
  const fields = [
    { label: '仓库名称', value: source.repository.fullName },
    { label: '项目描述', value: source.repository.description },
    { label: '主要语言', value: source.repository.language },
    { label: 'GitHub Topics', value: source.repository.topics.join(' ') },
    { label: 'README', value: source.readme?.rawMarkdown },
    { label: 'AI 摘要', value: source.aiDocument?.summaryZh },
    { label: 'AI 关键词', value: source.aiDocument?.keywords.join(' ') },
    { label: 'AI 建议标签', value: source.aiDocument?.suggestedTags.join(' ') },
    { label: '用户笔记', value: source.annotation?.noteMarkdown },
  ];

  return fields
    .filter((field) => field.value?.toLowerCase().includes(normalizedKeyword))
    .map((field): SearchMatchReason => ({
      kind: 'keyword',
      label: `${field.label}命中`,
      detail: `${field.label}包含“${keyword}”。`,
    }));
}

function buildCitations(query: RepoQuery, source: SearchExplanationSource): SearchCitation[] {
  const keyword = query.text ?? query.naturalLanguage ?? '';
  const citations = [
    createCitation('repository', '仓库描述', source.repository.description, null, keyword),
    createCitation('ai_summary', 'AI 中文摘要', source.aiDocument?.summaryZh, null, keyword),
    createCitation('readme', 'README 片段', source.readme?.rawMarkdown, source.readme?.sourcePath ?? null, keyword),
    createCitation('user_note', '用户笔记', source.annotation?.noteMarkdown, null, keyword),
  ];

  return citations.filter((citation): citation is SearchCitation => Boolean(citation));
}

function createCitation(
  kind: SearchCitation['kind'],
  title: string,
  content: string | null | undefined,
  sourcePath: string | null,
  keyword: string,
): SearchCitation | null {
  const snippet = createSnippet(content, keyword);

  if (!snippet) {
    return null;
  }

  return {
    kind,
    title,
    snippet,
    sourcePath,
  };
}

function createSnippet(content: string | null | undefined, keyword: string) {
  const normalizedContent = normalizeWhitespace(content ?? '');

  if (!normalizedContent) {
    return null;
  }

  if (!keyword) {
    return normalizedContent.slice(0, 180);
  }

  const matchIndex = normalizedContent.toLowerCase().indexOf(keyword.toLowerCase());

  if (matchIndex < 0) {
    return normalizedContent.slice(0, 180);
  }

  const start = Math.max(matchIndex - 72, 0);
  const end = Math.min(matchIndex + keyword.length + 108, normalizedContent.length);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalizedContent.length ? '…' : '';

  return `${prefix}${normalizedContent.slice(start, end)}${suffix}`;
}

function buildExplanationZh(query: RepoQuery, source: SearchExplanationSource, reasons: SearchMatchReason[]) {
  if (reasons.length === 0) {
    return `${source.repository.fullName} 与当前查询存在弱相关，可打开详情查看 README、摘要和用户笔记。`;
  }

  const modeLabel = query.mode === 'natural_language' ? '自然语言语义检索' : query.mode === 'hybrid' ? '混合检索' : '关键词检索';
  const reasonLabels = reasons.slice(0, 3).map((reason) => reason.label).join('、');

  return `${source.repository.fullName} 通过${modeLabel}命中，主要依据是${reasonLabels}。`;
}

function matchesStructuredFilters(query: RepoQuery, source: SearchExplanationSource) {
  if (query.languages.length > 0 && (!source.repository.language || !query.languages.includes(source.repository.language))) {
    return false;
  }

  if (query.topics.length > 0 && !query.topics.every((topic) => source.repository.topics.includes(topic))) {
    return false;
  }

  if (query.tags.length > 0 && !query.tags.every((tagId) => source.annotation?.tagIds.includes(tagId))) {
    return false;
  }

  if (query.readStatus && source.annotation?.readStatus !== query.readStatus) {
    return false;
  }

  return true;
}

function scoreRecord(query: RepoQuery, source: SearchExplanationSource) {
  const queryText = normalizeWhitespace([query.text, query.naturalLanguage].filter(Boolean).join(' '));
  const tokens = tokenizeQuery(queryText);
  const tokenScore = tokens.reduce((score, token) => score + scoreToken(token, source), 0);
  const structuredScore = (
    query.languages.length
    + query.topics.length
    + query.tags.length
    + (query.readStatus ? 1 : 0)
  ) * 4;
  const vectorScore = source.vectorScore == null ? 0 : source.vectorScore * 30;

  return tokenScore + structuredScore + vectorScore;
}

function scoreToken(token: string, source: SearchExplanationSource) {
  const normalizedToken = token.toLowerCase();
  let score = 0;

  score += scoreField(normalizedToken, source.repository.fullName, 16);
  score += scoreField(normalizedToken, source.repository.name, 14);
  score += scoreField(normalizedToken, source.repository.description, 8);
  score += scoreList(normalizedToken, source.repository.topics, 7);
  score += scoreField(normalizedToken, source.repository.language, 5);
  score += scoreField(normalizedToken, source.aiDocument?.summaryZh, 10);
  score += scoreField(normalizedToken, source.aiDocument?.readmeZh, 7);
  score += scoreList(normalizedToken, source.aiDocument?.keywords ?? [], 8);
  score += scoreList(normalizedToken, source.aiDocument?.suggestedTags ?? [], 6);
  score += scoreField(normalizedToken, source.annotation?.noteMarkdown, 7);
  score += scoreField(normalizedToken, source.readme?.rawMarkdown, 4);

  return score;
}

function scoreField(token: string, value: string | null | undefined, weight: number) {
  const normalizedValue = value?.toLowerCase();
  if (!normalizedValue) {
    return 0;
  }

  if (normalizedValue === token) {
    return weight * 2;
  }

  return normalizedValue.includes(token) ? weight : 0;
}

function scoreList(token: string, values: readonly string[], weight: number) {
  return values.some((value) => value.toLowerCase() === token)
    ? weight * 2
    : values.some((value) => value.toLowerCase().includes(token))
      ? weight
      : 0;
}

function tokenizeQuery(query: string) {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}#+.-]+/u)
      .map((token) => token.trim())
      .filter(Boolean),
  ));
}

function hasOnlyStructuredFilters(query: RepoQuery) {
  return !query.text
    && !query.naturalLanguage
    && (
      query.languages.length > 0
      || query.topics.length > 0
      || query.tags.length > 0
      || Boolean(query.readStatus)
    );
}

function compareBySort(query: RepoQuery, left: RepositoryFacts, right: RepositoryFacts) {
  switch (query.sort) {
    case 'starred_at':
      return right.starredAt.localeCompare(left.starredAt);
    case 'updated_at':
      return (right.pushedAt ?? '').localeCompare(left.pushedAt ?? '');
    case 'name':
      return left.fullName.localeCompare(right.fullName);
    case 'relevance':
    default:
      return right.starsCount - left.starsCount;
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function formatScore(score: number) {
  return Number(score.toFixed(3)).toString();
}

function normalizeEmbeddingRecord(record: RepositoryEmbeddingRecord): RepositoryEmbeddingRecord {
  return {
    ...record,
    vector: normalizeVector(record.vector),
    dimensions: normalizeVector(record.vector).length,
  };
}

function normalizeVector(value: readonly number[]) {
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function normalizeVectorLimit(value: number) {
  if (!Number.isFinite(value)) {
    return 10;
  }

  return Math.min(Math.max(Math.trunc(value), 0), 100);
}

function matchesVectorSearchInput(
  input: VectorSearchInput,
  dimensions: number,
  record: RepositoryEmbeddingRecord,
) {
  return record.model === input.model
    && record.modelVersion === input.modelVersion
    && record.dimensions === dimensions
    && (!input.accountId || record.accountId === input.accountId);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length || left.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function toVectorRecordKey(record: RepositoryEmbeddingRecord) {
  return [
    record.accountId,
    record.repoId,
    record.sourceKind,
    record.model,
    record.modelVersion,
  ].join('\u001f');
}
