export type BackendStatus = {
  backend: string;
  storage: string;
  worker: string;
  provider: string;
};

export type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
};

export type GitHubAuthState = {
  hasToken: boolean;
  user: GitHubUser | null;
};

export type StarSyncSummary = {
  accountLogin: string;
  activeCount: number;
  createdCount: number;
  updatedCount: number;
  removedCount: number;
};

export type ReadmeFetchSummary = {
  totalCount: number;
  fetchedCount: number;
  skippedCount: number;
  missingCount: number;
};

export type GistAnnotationExportSummary = {
  gistId: string;
  htmlUrl: string;
  tagCount: number;
  repositoryCount: number;
};

export type GistAnnotationImportSummary = {
  tagCount: number;
  repositoryCount: number;
  skippedRepositoryCount: number;
};

export type RepositoryListItem = {
  id: string;
  accountId: string;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  starsCount: number;
  forksCount: number;
  starredAt: string;
  pushedAt: string | null;
  hasReadme: boolean;
};

export type RepositoryListPage = {
  items: RepositoryListItem[];
  totalCount: number;
  limit: number;
  offset: number;
};

export type RepositoryFilters = {
  keyword: string;
  language: string;
  tagId: string;
};

export type TagItem = {
  id: string;
  accountId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReadingStatus = 'unread' | 'read' | 'later';

export type RepositoryAnnotationView = {
  repositoryId: string;
  accountId: string;
  noteMarkdown: string;
  readingStatus: ReadingStatus;
  tags: TagItem[];
  updatedAt: string;
};

export type RepositoryDetailView = {
  repositoryId: string;
  accountId: string;
  readme: RepositoryReadmeView | null;
  aiDocument: RepositoryAiDocumentView | null;
};

export type RepositoryReadmeView = {
  rawMarkdown: string;
  contentHash: string;
  sourcePath: string;
  fetchedAt: string;
};

export type RepositoryAiDocumentView = {
  summaryZh: string;
  readmeZh: string | null;
  keywords: string[];
  suggestedTags: string[];
  model: string;
  promptVersion: string;
  sourceHash: string;
  generatedAt: string;
};

export type RepositoryStats = {
  total: number;
  withReadme: number;
  languages: number;
  topics: number;
};

export type SearchMatchReasonView = {
  label: string;
  detail: string;
};

export type SearchCitationView = {
  title: string;
  snippet: string;
};

export type RepositorySearchExplanationView = {
  explanationZh: string;
  reasons: SearchMatchReasonView[];
  citations: SearchCitationView[];
};
