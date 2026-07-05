import {
  createRepoQuery,
  type AiRepositoryDocument,
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
} from '@stars-ai/domain';

export type SearchPort = {
  search(query: RepoQuery): Promise<SearchResult[]>;
};

export type IndexPort = {
  rebuildRepositoryIndex(repoId: RepositoryId): Promise<void>;
};

export type VectorSearchInput = {
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
    { label: 'AI 摘要', value: source.aiDocument?.summaryZh },
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

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function formatScore(score: number) {
  return Number(score.toFixed(3)).toString();
}
