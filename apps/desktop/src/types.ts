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

export type AppPage = 'dashboard' | 'repositories' | 'discover' | 'rankings' | 'tag-network' | 'ai-search' | 'profile' | 'settings';

export type RankingSection = 'global' | 'personal';
export type GithubRankingKind = 'trending' | 'rising' | 'popular';
export type PersonalRankingKind = 'stars' | 'updated' | 'starred';

export type RankingItem = {
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  starsCount: number;
  forksCount: number;
  pushedAt: string | null;
  starredAt: string | null;
  isStarred: boolean;
};

export type RankingPage = {
  kind: GithubRankingKind | PersonalRankingKind;
  items: RankingItem[];
  totalCount: number;
  page: number;
  limit: number;
  hasMore: boolean;
  generatedAt: string;
  isStale: boolean;
  fromCache: boolean;
};

export type RankingStarResult = {
  fullName: string;
  isStarred: boolean;
};

export type StarSyncSummary = {
  accountLogin: string;
  activeCount: number;
  createdCount: number;
  updatedCount: number;
  removedCount: number;
  scannedCount: number;
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
  status: 'running' | 'succeeded' | 'failed' | 'partial' | string;
  stage: string;
  current: number;
  total: number;
  message: string;
  repositoryName: string | null;
};

export type AiStreamEvent = {
  requestId: string;
  taskType: 'ai-search' | 'repository-ai-document' | string;
  stage: string;
  status: 'started' | 'delta' | 'finished' | 'failed' | 'fallback' | string;
  delta: string | null;
  text: string | null;
  message: string | null;
  repositoryId: string | null;
  createdAt: string;
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

export type GistRepositoryLibraryExportSummary = {
  gistId: string;
  htmlUrl: string;
  tagCount: number;
  repositoryCount: number;
};

export type GistRepositoryLibraryImportSummary = {
  tagCount: number;
  repositoryCount: number;
  createdRepositoryCount: number;
  updatedRepositoryCount: number;
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
  tagIds: string[];
  tagNames: string[];
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
  inputTokens: number;
  outputTokens: number;
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
  totalAiInputTokens: number;
  totalAiOutputTokens: number;
  totalTags: number;
  totalNotes: number;
  languageDistribution: LanguageDistributionItem[];
  recentRepos: RepositoryListItem[];
  lastSyncAt: string | null;
};

export type RuntimeReadinessCheckStatus = 'passed' | 'failed' | 'skipped';

export type RuntimeReadinessCheckItem = {
  status: RuntimeReadinessCheckStatus;
  message: string;
  detail: string | null;
  action: string | null;
};

export type RuntimeReadinessCheckResult = {
  storage: RuntimeReadinessCheckItem;
  settings: RuntimeReadinessCheckItem;
  github: RuntimeReadinessCheckItem;
  stars: RuntimeReadinessCheckItem;
  readme: RuntimeReadinessCheckItem;
  ai: RuntimeReadinessCheckItem;
  tagNetwork: RuntimeReadinessCheckItem;
  recommendation: RuntimeReadinessCheckItem;
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
  failedBatchCount: number;
  failures: string[];
};

export type GithubRepositoryRecommendation = {
  candidateId: string | null;
  candidateStatus: 'new' | 'marked' | 'ignored' | 'starred' | null;
  candidateUpdatedAt: string | null;
  candidateCategory: string | null;
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
  searchFailures: { query: string; error: string }[];
  results: GithubRepositoryRecommendation[];
};

export type GithubRecommendationPage = {
  rationaleZh: string;
  queries: string[];
  results: GithubRepositoryRecommendation[];
  totalCount: number;
  limit: number;
  offset: number;
  categories: GithubRecommendationCategoryCount[];
};

export type GithubRecommendationCategoryCount = {
  value: string;
  label: string;
  count: number;
};

export type GithubRecommendationReadme = {
  fullName: string;
  rawMarkdown: string;
  sourcePath: string;
  fetchedAt: string;
  fromCache: boolean;
  translation: GithubReadmeTranslation | null;
};

export type GithubReadmeTranslation = {
  markdownZh: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  sourceCharCount: number;
  translatedCharCount: number;
  isTruncated: boolean;
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
  citations: SearchCitationView[];
  keywords: string[];
  aiSummary: string | null;
};

export type AiSearchResponse = {
  query: string;
  mode: 'conversation' | 'local_knowledge' | 'keyword' | 'natural_language' | 'vector' | 'hybrid' | 'ai_enhanced';
  results: AiSearchResult[];
  totalCount: number;
  contextQueriesUsed: string[];
  contextApplied: boolean;
  aiEnhanced: boolean;
  aiQuery: string | null;
  aiRationaleZh: string | null;
  aiError: string | null;
  answerZh: string | null;
  retrievalMode: 'none' | 'keyword' | 'vector' | 'vector+keyword';
  vectorApplied: boolean;
  vectorError: string | null;
};

/* ===========================================================================
 * 个人主页统计类型
 * =========================================================================*/
export type ProfileStats = {
  totalStars: number;
  totalNotes: number;
  totalAiWords: number;
  totalAiInputTokens: number;
  totalAiOutputTokens: number;
  languageBreakdown: { language: string; count: number; percentage: number }[];
  monthlyTrend: { month: string; count: number }[];
  recentRepos: RepositoryListItem[];
};

export type { AppSettings, ThemeSettings, SyncSettings, AISettings, EmbeddingSettings, GeneralSettings } from './types-settings';
export { DEFAULT_SETTINGS, COLOR_PRESETS } from './types-settings';
