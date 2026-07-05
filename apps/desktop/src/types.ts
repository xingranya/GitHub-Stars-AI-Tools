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
  scannedCount: number;
  mode: 'full' | 'incremental';
};

export type ReadmeFetchSummary = {
  totalCount: number;
  fetchedCount: number;
  skippedCount: number;
  missingCount: number;
  failedCount: number;
  failures: { repositoryId: string; fullName: string; error: string }[];
};

export type TaskProgressEvent = {
  taskId: string;
  taskType: 'sync' | 'readme' | 'ai' | string;
  status: 'running' | 'succeeded' | 'failed' | string;
  stage: string;
  current: number;
  total: number;
  message: string;
  repositoryName: string | null;
};

export type BatchAiDocumentSummary = {
  totalCount: number;
  generatedCount: number;
  skippedCount: number;
  missingReadmeCount: number;
  failedCount: number;
  failures: { repositoryId: string; fullName: string; error: string }[];
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
  aiSummary: string | null;
  aiKeywords: string[];
  suggestedTags: string[];
  aiGeneratedAt: string | null;
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

/* ===========================================================================
 * 仪表盘统计类型
 * =========================================================================*/
export type LanguageDistributionItem = {
  language: string;
  count: number;
  percentage: number;
};

export type DashboardStats = {
  totalRepos: number;
  totalStars: number;
  totalReadmes: number;
  totalAiSummaries: number;
  totalTags: number;
  totalNotes: number;
  languageDistribution: LanguageDistributionItem[];
  recentRepos: RepositoryListItem[];
  lastSyncAt: string | null;
};

/* ===========================================================================
 * 标签网络类型
 * =========================================================================*/
export type TagNetworkNode = {
  id: string;
  name: string;
  color: string | null;
  repoCount: number;
};

export type TagNetworkEdge = {
  source: string;
  target: string;
  weight: number;
};

export type TagNetworkData = {
  nodes: TagNetworkNode[];
  edges: TagNetworkEdge[];
  totalRepos: number;
  totalTags: number;
  totalLinks: number;
};

export type AiTagNetworkSummary = {
  tagCount: number;
  linkedCount: number;
  skippedRepositoryCount: number;
};

export type GithubRepositoryRecommendation = {
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  starsCount: number;
  forksCount: number;
  pushedAt: string | null;
};

export type GithubRecommendationResponse = {
  rationaleZh: string;
  queries: string[];
  results: GithubRepositoryRecommendation[];
};

export type TagGroup = {
  id: string;
  name: string;
  color: string;
  tags: { id: string; name: string; count: number }[];
  repoCount: number;
};

/* ===========================================================================
 * AI 搜索结果类型
 * =========================================================================*/
export type AiSearchResult = {
  repository: RepositoryListItem;
  score: number;
  explanationZh: string;
  reasons: SearchMatchReasonView[];
  keywords: string[];
  aiSummary: string | null;
};

export type AiSearchResponse = {
  query: string;
  mode: 'local_knowledge' | 'keyword' | 'natural_language' | 'hybrid';
  results: AiSearchResult[];
  totalCount: number;
};

/* ===========================================================================
 * 个人主页统计类型
 * =========================================================================*/
export type ProfileStats = {
  totalStars: number;
  totalNotes: number;
  totalAiWords: number;
  languageBreakdown: { language: string; count: number; percentage: number }[];
  monthlyTrend: { month: string; count: number }[];
  recentRepos: RepositoryListItem[];
};

export type { AppSettings, ThemeSettings, SyncSettings, AISettings, GeneralSettings } from './types-settings';
export { DEFAULT_SETTINGS, COLOR_PRESETS } from './types-settings';
