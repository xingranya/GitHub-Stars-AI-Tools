export type RepositoryId = string;
export type GitHubAccountId = string;
export type ISODateString = string;

export type RepositorySyncStatus = 'active' | 'removed' | 'gone' | 'error';
export type ReadStatus = 'unread' | 'read' | 'later';

export type RepositoryFacts = {
  id: RepositoryId;
  accountId: GitHubAccountId;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  starsCount: number;
  forksCount: number;
  starredAt: ISODateString;
  pushedAt: ISODateString | null;
  syncStatus: RepositorySyncStatus;
};

export type RepositoryAnnotation = {
  repoId: RepositoryId;
  accountId: GitHubAccountId;
  noteMarkdown: string;
  tagIds: string[];
  readStatus: ReadStatus;
  updatedAt: ISODateString;
};

export type ReadmeDocument = {
  repoId: RepositoryId;
  rawMarkdown: string;
  contentHash: string;
  sourcePath: string;
  fetchedAt: ISODateString;
};

export type AiRepositoryDocument = {
  repoId: RepositoryId;
  summaryZh: string;
  readmeZh: string | null;
  keywords: string[];
  suggestedTags: string[];
  model: string;
  promptVersion: string;
  sourceHash: string;
  generatedAt: ISODateString;
};

export type EmbeddingSourceKind = 'repository_knowledge';

export type RepositoryEmbeddingRecord = {
  accountId: GitHubAccountId;
  repoId: RepositoryId;
  sourceKind: EmbeddingSourceKind;
  sourceHash: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  vector: number[];
  generatedAt: ISODateString;
};

export type RepoQuerySort = 'relevance' | 'starred_at' | 'updated_at' | 'name';
export type RepoQueryMode = 'keyword' | 'natural_language' | 'hybrid';

export type RepoQueryInput = {
  text?: string | null;
  naturalLanguage?: string | null;
  languages?: readonly (string | null | undefined)[] | null;
  tags?: readonly (string | null | undefined)[] | null;
  topics?: readonly (string | null | undefined)[] | null;
  readStatus?: ReadStatus | null;
  sort?: RepoQuerySort | null;
  mode?: RepoQueryMode | null;
  limit?: number | null;
  offset?: number | null;
};

export type RepoQuery = {
  text: string | null;
  naturalLanguage: string | null;
  languages: string[];
  tags: string[];
  topics: string[];
  readStatus: ReadStatus | null;
  sort: RepoQuerySort;
  mode: RepoQueryMode;
  limit: number;
  offset: number;
};

export const defaultRepoQuery: RepoQuery = {
  text: null,
  naturalLanguage: null,
  languages: [],
  tags: [],
  topics: [],
  readStatus: null,
  sort: 'relevance',
  mode: 'keyword',
  limit: 50,
  offset: 0,
};

export function createRepoQuery(input: RepoQueryInput = {}): RepoQuery {
  const text = normalizeQueryText(input.text);
  const naturalLanguage = normalizeQueryText(input.naturalLanguage);

  return {
    text,
    naturalLanguage,
    languages: normalizeQueryList(input.languages),
    tags: normalizeQueryList(input.tags),
    topics: normalizeQueryList(input.topics),
    readStatus: input.readStatus ?? null,
    sort: input.sort ?? defaultRepoQuery.sort,
    mode: input.mode ?? inferRepoQueryMode(text, naturalLanguage),
    limit: normalizeQueryLimit(input.limit),
    offset: normalizeQueryOffset(input.offset),
  };
}

function inferRepoQueryMode(text: string | null, naturalLanguage: string | null): RepoQueryMode {
  if (text && naturalLanguage) {
    return 'hybrid';
  }

  if (naturalLanguage) {
    return 'natural_language';
  }

  return 'keyword';
}

function normalizeQueryText(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function normalizeQueryList(value: readonly (string | null | undefined)[] | null | undefined) {
  return Array.from(new Set((value ?? []).map((item) => item?.trim()).filter((item): item is string => Boolean(item))));
}

function normalizeQueryLimit(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return defaultRepoQuery.limit;
  }

  return Math.trunc(value as number).toString() === '0' ? defaultRepoQuery.limit : Math.min(Math.max(Math.trunc(value as number), 1), 100);
}

function normalizeQueryOffset(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return defaultRepoQuery.offset;
  }

  return Math.max(Math.trunc(value as number), 0);
}

export type SearchMatchReason = {
  kind: 'keyword' | 'language' | 'tag' | 'topic' | 'semantic';
  label: string;
  detail: string;
};

export type SearchCitationKind = 'repository' | 'ai_summary' | 'readme' | 'user_note';

export type SearchCitation = {
  kind: SearchCitationKind;
  title: string;
  snippet: string;
  sourcePath: string | null;
};

export type SearchResult = {
  repository: RepositoryFacts;
  score: number;
  explanationZh: string;
  reasons: SearchMatchReason[];
  citations: SearchCitation[];
};

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type PipelineJob = {
  id: string;
  type: 'sync_stars' | 'fetch_readme' | 'summarize' | 'translate' | 'embed';
  status: JobStatus;
  idempotencyKey: string;
  retryCount: number;
  lastError: string | null;
};
