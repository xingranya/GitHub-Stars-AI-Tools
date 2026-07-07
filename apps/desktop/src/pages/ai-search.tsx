import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { getAiConfigMessage, shouldFlushAiApiKey, toBackendAiRequestConfig } from '@/lib/ai-config';
import { compactNumber } from '@/lib/format';
import type { AiSearchResponse, AiSearchResult } from '@/types';

const FALLBACK_SUGGESTIONS = [
  '支持离线缓存的网络请求模块',
  '基于 Rust 的高性能文本处理',
  '微前端架构的主应用入口配置',
  'React 动画库',
  'Python 机器学习框架',
  'Go 语言并发任务队列',
];

/* 搜索历史 localStorage key */
const HISTORY_KEY = 'gsat-search-history';
const CONVERSATION_KEY_PREFIX = 'gsat-ai-search-conversation';
const MAX_CONTEXT_QUERIES = 4;
const MAX_CONTEXT_REPOSITORIES = 30;
const MAX_SEARCH_TURNS = 8;

type AISearchPageProps = {
  onOpenRepository: (repository: AiSearchResult['repository']) => void;
};

type SearchTurn = {
  id: string;
  query: string;
  resultCount: number;
  aiQuery: string | null;
  repositoryIds: string[];
};

export function AISearchPage(props: AISearchPageProps) {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [response, setResponse] = useState<AiSearchResponse | null>(null);
  const [searchTurns, setSearchTurns] = useState<SearchTurn[]>([]);
  const accountId = workspace.authState.user ? String(workspace.authState.user.id) : null;
  const hasWorkspaceFilters = Boolean(
    workspace.repositoryFilters.keyword.trim()
      || workspace.repositoryFilters.language
      || workspace.repositoryFilters.tagId,
  );
  const hasNoLocalStars = Boolean(
    accountId
      && !workspace.isLoadingRepositories
      && !hasWorkspaceFilters
      && workspace.repositoryStats.total === 0,
  );
  const aiConfigMessage = getAiConfigMessage(settingsHook.settings.ai);
  const aiEnhancementNotice = aiConfigMessage
    ? `AI 增强未启用：${aiConfigMessage} 当前仍可使用本地知识搜索。`
    : 'AI 增强已启用：搜索时会先用当前 AI 设置优化搜索问题，再在本地知识库中查找匹配仓库。';
  const searchPreconditionNotice = accountId
    ? hasNoLocalStars
      ? '当前账号还没有本地 Stars 数据，请先同步 Stars 后再搜索。智能知识搜索会在本地知识库中检索仓库元数据、README、AI 摘要、标签和笔记。'
      : null
    : '请先连接 GitHub 账号并同步 Stars。智能知识搜索会在本地索引中检索仓库元数据、README、AI 摘要、标签和笔记。';
  const isSearchUnavailable = Boolean(searchPreconditionNotice);

  // 加载搜索历史
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // 忽略非关键异常
    }
  }, []);

  // 按账号保留当前会话上下文，切换页面后仍能持续追问。
  useEffect(() => {
    if (!accountId) {
      setSearchTurns([]);
      return;
    }
    try {
      const stored = sessionStorage.getItem(getConversationKey(accountId));
      setSearchTurns(stored ? normalizeSearchTurns(JSON.parse(stored)) : []);
    } catch {
      setSearchTurns([]);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    try {
      sessionStorage.setItem(getConversationKey(accountId), JSON.stringify(searchTurns));
    } catch {
      // 忽略非关键异常
    }
  }, [accountId, searchTurns]);

  useEffect(() => {
    return () => {
      workspace.setAiSearchRetryAction(null);
    };
  }, [accountId]);

  async function executeSearch(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q) return;
    if (!accountId) {
      setSubmittedQuery(q);
      setErrorMessage('请先在设置中连接 GitHub 账号，再搜索你的 Stars 知识库。');
      setResponse(null);
      return;
    }
    if (isSearchUnavailable) {
      setSubmittedQuery(q);
      setErrorMessage(searchPreconditionNotice);
      setResponse(null);
      return;
    }
    workspace.setAiSearchRetryAction(() => executeSearch(q));
    setIsSearching(true);
    setErrorMessage(null);
    setSubmittedQuery(q);
    saveHistory(q);
    try {
      let aiKeyFlushError: string | null = null;
      if (!aiConfigMessage && shouldFlushAiApiKey(settingsHook.settings.ai)) {
        try {
          await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
        } catch (reason) {
          aiKeyFlushError = toErrorMessage(reason);
        }
      }
      const recentTurns = searchTurns.slice(-MAX_CONTEXT_QUERIES);
      const contextQueries = recentTurns
        .flatMap((turn) => [turn.query, turn.aiQuery].filter(isNonEmptyString))
        .slice(-MAX_CONTEXT_QUERIES * 2);
      const contextRepositoryIds = uniqueValues(
        recentTurns.flatMap((turn) => turn.repositoryIds),
      ).slice(-MAX_CONTEXT_REPOSITORIES);
      const data = await invoke<AiSearchResponse>('search_repositories', {
        request: {
          query: q,
          limit: 20,
          accountId,
          contextQueries,
          contextRepositoryIds,
          ...(aiConfigMessage || aiKeyFlushError ? {} : { aiConfig: toBackendAiRequestConfig(settingsHook.settings.ai) }),
        },
      });
      const visibleData = aiKeyFlushError
        ? {
            ...data,
            mode: 'local_knowledge' as const,
            aiEnhanced: false,
            aiQuery: null,
            aiRationaleZh: null,
            aiError: `AI Key 保存失败，已改用本地知识搜索：${aiKeyFlushError}`,
          }
        : data;
      setResponse(visibleData);
      setSearchTurns((turns) => [
        ...turns,
        {
          id: `${Date.now()}-${q}`,
          query: q,
          resultCount: visibleData.totalCount,
          aiQuery: visibleData.aiQuery,
          repositoryIds: visibleData.results.map((result) => result.repository.id).slice(0, MAX_CONTEXT_REPOSITORIES),
        },
      ].slice(-MAX_SEARCH_TURNS));
    } catch (reason) {
      setErrorMessage(toErrorMessage(reason));
      setResponse(null);
    } finally {
      setIsSearching(false);
    }
  }

  function saveHistory(q: string) {
    const newHistory = [q, ...history.filter((h) => h !== q)].slice(0, 10);
    setHistory(newHistory);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch {
      // 忽略非关键异常
    }
  }

  function handleSearch() {
    if (isSearching) return;
    const q = query.trim();
    if (!q) return;
    void executeSearch(q);
  }

  function handleSuggestionClick(suggestion: string) {
    if (isSearching) return;
    setQuery(suggestion);
    void executeSearch(suggestion);
  }

  function handleHistoryClick(item: string) {
    if (isSearching) return;
    setQuery(item);
    void executeSearch(item);
  }

  function handleFollowUp(nextQuery: string) {
    if (isSearching) return;
    setQuery(nextQuery);
    void executeSearch(nextQuery);
  }

  async function handleFindSimilarRepository(repository: AiSearchResult['repository']) {
    if (isSearching || workspace.isFindingSimilarRepositories) return;
    setErrorMessage(null);
    if (!accountId) {
      setErrorMessage('请先在设置中连接 GitHub 账号，再使用 GitHub 相似发现。');
      return;
    }
    if (aiConfigMessage) {
      setErrorMessage(`请先完成 AI 配置后再使用 GitHub 相似发现：${aiConfigMessage}`);
      return;
    }
    try {
      if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
        await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
      }
      await workspace.handleFindSimilarRepositories(settingsHook.settings.ai, [repository.id]);
      props.onOpenRepository(repository);
    } catch (reason) {
      setErrorMessage(toErrorMessage(reason));
    }
  }

  function handleClearConversation() {
    setSearchTurns([]);
    setSubmittedQuery('');
    setResponse(null);
    setErrorMessage(null);
    if (accountId) {
      try {
        sessionStorage.removeItem(getConversationKey(accountId));
      } catch {
        // 忽略非关键异常
      }
    }
  }

  const results = response?.results ?? [];
  const contextQueriesUsed = response?.contextQueriesUsed ?? [];
  const aiEnhanced = response?.aiEnhanced ?? false;
  const aiQuery = response?.aiQuery ?? null;
  const aiRationale = response?.aiRationaleZh ?? null;
  const aiError = response?.aiError ?? null;
  const similarDiscoveryDisabledReason = !accountId
    ? '请先连接 GitHub 账号'
    : aiConfigMessage;
  const suggestions = useMemo(() => buildSearchSuggestions({
    repositories: workspace.repositoryPage?.items ?? [],
    languages: workspace.repositoryLanguages,
    tags: workspace.tags,
  }), [workspace.repositoryLanguages, workspace.repositoryPage, workspace.tags]);
  const suggestionLabel = accountId && workspace.repositoryStats.total > 0 ? '基于你的 Stars' : '示例搜索';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[min(1180px,100%)] flex-col gap-6 p-4 sm:p-5 lg:p-6">
        {/* 搜索主区域 */}
        <div className="flex flex-col items-center justify-center py-6 lg:py-8">
          <div className="mb-6 text-center">
            <h1 className="font-headline-lg mb-3 flex items-center justify-center gap-3 text-[clamp(24px,3vw,32px)] text-on-surface">
              <Icon name="psychology" size={32} className="text-primary" />
              智能知识搜索
            </h1>
            <p className="font-body-md mx-auto max-w-2xl text-on-surface-variant">
              描述你需要的功能、问题或概念，系统会结合本轮上下文、仓库元数据、README、AI 摘要、标签和笔记查找匹配项目。
            </p>
          </div>

          {/* 主搜索框 */}
          <div className="group relative w-full max-w-3xl">
            <div className="relative flex flex-col gap-2 rounded-2xl border border-card-border bg-surface-container-lowest p-2 shadow-sm transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25 sm:flex-row sm:items-center sm:pl-4">
              <Icon name="search" size={22} className="hidden shrink-0 text-primary sm:block" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="帮我找几个好用的 React 动画库..."
                className="h-11 min-w-0 flex-1 rounded-xl border-0 bg-transparent px-3 font-body-md text-[15px] font-medium text-on-surface outline-none ring-0 placeholder:text-on-surface-variant/70 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 sm:h-12 sm:px-0"
              />
              <div className="flex shrink-0 items-center gap-2 sm:pr-1">
                <button
                  onClick={handleSearch}
                  disabled={!query.trim() || isSearching || isSearchUnavailable}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 font-body-md text-sm font-bold text-white shadow-md transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  <span>{isSearching ? '搜索中' : '搜索'}</span>
                  <Icon name={isSearching ? 'progress_activity' : 'arrow_forward'} size={16} className={isSearching ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
            {searchPreconditionNotice && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-sm text-error sm:flex-row sm:items-center sm:justify-between">
                <p>{searchPreconditionNotice}</p>
                {accountId && !workspace.isLoadingRepositories && workspace.repositoryStats.total === 0 && (
                  <button
                    type="button"
                    onClick={() => void workspace.handleSyncStars()}
                    disabled={workspace.isSyncingStars}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Icon name={workspace.isSyncingStars ? 'progress_activity' : 'sync'} size={16} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
                    {workspace.isSyncingStars ? '同步中' : '同步 Stars'}
                  </button>
                )}
              </div>
            )}
            {!searchPreconditionNotice && (
              <div
                className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                  aiConfigMessage
                    ? 'border-warning/20 bg-warning/10 text-on-surface-variant'
                    : 'border-primary/15 bg-primary/5 text-on-surface-variant'
                }`}
              >
                <Icon
                  name={aiConfigMessage ? 'info' : 'auto_awesome'}
                  size={18}
                  className={`mt-0.5 shrink-0 ${aiConfigMessage ? 'text-warning' : 'text-primary'}`}
                />
                <p>{aiEnhancementNotice}</p>
              </div>
            )}
          </div>

          {/* 建议词按钮 */}
          <div className="mt-5 flex max-w-4xl flex-wrap justify-center gap-2">
            <span className="mr-1 flex items-center font-label-sm text-label-sm font-medium text-on-surface-variant">
              <Icon name="lightbulb" size={16} className="mr-1 text-warning" /> {suggestionLabel}:
            </span>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestionClick(s)}
                disabled={isSearchUnavailable}
                className="glass-panel flex items-center gap-2 rounded-full bg-surface-container-lowest px-3 py-1.5 font-body-md text-sm text-on-surface transition-colors hover:bg-primary/5 hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>

          {searchTurns.length > 0 && (
            <div className="mt-4 flex w-full max-w-3xl flex-wrap items-center justify-center gap-2">
              {searchTurns.map((turn) => (
                <button
                  key={turn.id}
                  type="button"
                  onClick={() => handleHistoryClick(turn.query)}
                  disabled={isSearchUnavailable}
                  className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1 text-xs text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  title={`再次搜索：${turn.query}`}
                >
                  {turn.query} · {turn.resultCount}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClearConversation}
                className="rounded-full border border-outline-variant/30 px-3 py-1 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
              >
                清空上下文
              </button>
            </div>
          )}
        </div>

        {/* 结果区域 */}
        {submittedQuery && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            <div className="flex flex-col gap-2 border-b border-outline-variant/30 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-headline-md flex items-center gap-2 text-[20px] font-bold text-on-surface">
                <Icon name="temp_preferences_custom" size={24} className="text-primary" />
                你的 Stars 搜索结果
              </h3>
              <span className="font-body-md text-body-md text-on-surface-variant font-medium">
                {isSearching ? '搜索中...' : `找到 ${response?.totalCount ?? results.length} 个匹配仓库`}
              </span>
            </div>
            {response?.contextApplied && contextQueriesUsed.length > 0 && (
              <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-on-surface-variant">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-on-surface">本次已结合上下文</span>
                  {contextQueriesUsed.map((item) => (
                    <span key={item} className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {response && (aiEnhanced || aiError) && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${
                aiEnhanced
                  ? 'border-primary/15 bg-primary/5 text-on-surface-variant'
                  : 'border-warning/20 bg-warning/10 text-on-surface-variant'
              }`}>
                <div className="flex items-start gap-2">
                  <Icon name={aiEnhanced ? 'auto_awesome' : 'info'} size={18} className={aiEnhanced ? 'text-primary' : 'text-warning'} />
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-on-surface">
                      {aiEnhanced ? 'AI 已优化本次搜索问题' : '已使用本地知识搜索'}
                    </p>
                    {aiEnhanced && aiQuery && (
                      <p>AI 搜索词：{aiQuery}</p>
                    )}
                    {aiEnhanced && aiRationale && (
                      <p>{aiRationale}</p>
                    )}
                    {aiError && (
                      <p>{aiError}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            {response && results.length > 0 && (
              <SearchResultOverview
                query={submittedQuery}
                response={response}
                onAskFollowUp={handleFollowUp}
                isSearching={isSearching}
              />
            )}

            {errorMessage ? (
              <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-error font-body-md">
                {errorMessage}
              </div>
            ) : results.length === 0 && !isSearching ? (
              <EmptySearchResults
                query={submittedQuery}
                onAskFollowUp={handleFollowUp}
                isSearching={isSearching}
              />
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {results.map((result, idx) => (
                  <SearchResultCard
                    key={idx}
                    result={result}
                    onOpenRepository={props.onOpenRepository}
                    onAskFollowUp={handleFollowUp}
                    onFindSimilarRepository={handleFindSimilarRepository}
                    isSearching={isSearching}
                    isFindingSimilar={workspace.isFindingSimilarRepositories}
                    similarDiscoveryDisabledReason={similarDiscoveryDisabledReason}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 搜索历史 */}
        {history.length > 0 && (
          <div className="mt-8 pt-8 border-t border-outline-variant/30">
            <h4 className="font-headline-md text-[18px] text-on-surface mb-4 flex items-center gap-2 font-bold">
              <Icon name="history" size={20} className="text-on-surface-variant" />
              最近搜索历史
            </h4>
            <div className="flex flex-wrap gap-3">
              {history.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleHistoryClick(item)}
                  disabled={isSearchUnavailable}
                  className="glass-panel bg-surface-container-lowest px-4 py-2 rounded-lg font-body-md text-body-md text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-colors flex items-center gap-2 font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon name="manage_search" size={18} />
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultOverview({
  query,
  response,
  onAskFollowUp,
  isSearching,
}: {
  query: string;
  response: AiSearchResponse;
  onAskFollowUp: (query: string) => void;
  isSearching: boolean;
}) {
  const results = response.results;
  const topResult = results[0];
  const analyzedCount = results.filter((result) => result.repository.aiSummary || result.aiSummary).length;
  const languages = summarizeTopLanguages(results);
  const followUps = [
    {
      label: '优先看已解析',
      icon: 'auto_awesome',
      query: `${query} 优先 已有 AI 摘要 中文解析`,
    },
    {
      label: '更适合部署',
      icon: 'rocket_launch',
      query: `${query} 部署简单 文档完善 配置少`,
    },
    {
      label: '继续找替代',
      icon: 'compare_arrows',
      query: topResult
        ? `推荐一些可以替代 ${topResult.repository.fullName} 的 GitHub 项目，并比较适用场景`
        : `${query} 相似替代项目`,
    },
  ];

  return (
    <section className="rounded-lg border border-primary/15 bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="summarize" size={20} className="text-primary" />
            <h4 className="font-headline-md text-base font-semibold text-on-surface">结果总结</h4>
          </div>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            本次从本地知识库找到 {response.totalCount} 个匹配仓库
            {topResult ? `，最佳匹配是 ${topResult.repository.fullName}，匹配度 ${topResult.score}%。` : '。'}
            {analyzedCount > 0
              ? ` 其中 ${analyzedCount} 个已有 AI 中文解析，可直接查看项目知识卡。`
              : ' 当前结果尚未生成 AI 中文解析，可以进入详情后抓取 README 并解析。'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-on-surface-variant">
            <span className="rounded-full border border-outline-variant/30 bg-surface px-2.5 py-1">
              {response.aiEnhanced ? 'AI 已优化搜索问题' : '本地知识搜索'}
            </span>
            {languages.length > 0 && (
              <span className="rounded-full border border-outline-variant/30 bg-surface px-2.5 py-1">
                主要语言：{languages.join('、')}
              </span>
            )}
            {response.contextApplied && (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                已结合上下文
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-xs lg:justify-end">
          {followUps.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onAskFollowUp(action.query)}
              disabled={isSearching}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name={action.icon} size={15} />
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* === 搜索结果卡片 === */
function SearchResultCard({
  result,
  onOpenRepository,
  onAskFollowUp,
  onFindSimilarRepository,
  isSearching,
  isFindingSimilar,
  similarDiscoveryDisabledReason,
}: {
  result: AiSearchResult;
  onOpenRepository: (repository: AiSearchResult['repository']) => void;
  onAskFollowUp: (query: string) => void;
  onFindSimilarRepository: (repository: AiSearchResult['repository']) => void;
  isSearching: boolean;
  isFindingSimilar: boolean;
  similarDiscoveryDisabledReason: string | null;
}) {
  const { repository: repo, score, explanationZh, reasons, citations, keywords } = result;
  const readableSummary = result.aiSummary ?? repo.aiSummary ?? repo.description ?? '这个仓库还没有可用的中文解析，可以先进入详情生成 AI 摘要。';
  const visibleKeywords = uniqueValues([...keywords, ...repo.aiKeywords, ...repo.suggestedTags, ...repo.topics]).slice(0, 10);
  const followUpActions = [
    {
      label: '怎么使用',
      icon: 'terminal',
      query: `${repo.fullName} 怎么安装 使用 示例`,
    },
    {
      label: '如何部署',
      icon: 'cloud_upload',
      query: `${repo.fullName} 如何部署 配置 运行`,
    },
    {
      label: '比较场景',
      icon: 'compare_arrows',
      query: `${repo.fullName} 适合场景 优缺点 替代方案`,
    },
  ];
  const canFindSimilarOnGithub = !similarDiscoveryDisabledReason && !isSearching && !isFindingSimilar;

  return (
    <article className="group rounded-lg border border-card-border bg-surface-container-lowest p-4 shadow-sm transition-colors duration-200 hover:border-primary/25 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex-1 min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm shrink-0">
              <Icon name="book" size={24} />
            </div>
            <button
              type="button"
              onClick={() => onOpenRepository(repo)}
              className="min-w-0 flex-1 truncate text-left font-headline-md text-[18px] font-bold text-primary cursor-pointer group-hover:underline sm:text-[20px]"
            >
              {repo.fullName}
            </button>
            <span className="bg-success/10 px-2.5 py-1 rounded-md text-xs font-label-sm text-success border border-success/20 flex items-center gap-1 font-bold shadow-sm shrink-0">
              <Icon name="check_circle" size={14} />
              匹配度 {score}%
            </span>
          </div>
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 p-3">
              <p className="mb-1 text-[11px] font-semibold text-primary">中文说明</p>
              <p className="font-body-md text-sm leading-relaxed text-on-surface">
                {readableSummary}
              </p>
              {repo.description && repo.description !== readableSummary && (
                <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                  原始描述：{repo.description}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant sm:grid-cols-4 lg:grid-cols-2">
              <SearchMetric icon="star" label="Stars" value={compactNumber(repo.starsCount)} />
              <SearchMetric icon="fork_right" label="Forks" value={compactNumber(repo.forksCount)} />
              <SearchMetric icon="code_blocks" label="语言" value={repo.language ?? '未标注'} />
              <SearchMetric icon={repo.aiSummary ? 'auto_awesome' : 'description'} label="知识状态" value={repo.aiSummary ? '已解析' : repo.hasReadme ? '可解析' : '待抓取'} />
            </div>
          </div>

          {/* 知识匹配理由 */}
          <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-4 shadow-sm">
            <p className="font-body-md text-body-md text-on-surface flex items-start gap-2">
              <Icon name="psychology_alt" size={20} className="text-primary mt-0.5" />
              <span className="leading-relaxed">
                <strong className="text-primary">知识匹配理由：</strong> {explanationZh}
              </span>
            </p>
            {/* 匹配理由 */}
            {reasons.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 ml-7">
                {reasons.map((reason, i) => (
                  <span
                    key={i}
                    title={reason.detail}
                    className="max-w-full rounded bg-surface-container-high px-2.5 py-1 text-left text-[11px] text-on-surface-variant sm:max-w-[260px]"
                  >
                    <span className="block font-semibold text-on-surface">{reason.label}</span>
                    <span className="mt-0.5 block truncate">{reason.detail}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {citations.length > 0 && (
            <div className="mb-4 rounded-lg border border-outline-variant/25 bg-surface-container-low/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-on-surface">
                <Icon name="format_quote" size={16} className="text-primary" />
                命中片段
              </div>
              <div className="grid gap-2">
                {citations.map((citation, index) => (
                  <figure
                    key={`${citation.title}-${index}`}
                    className="rounded-lg border border-outline-variant/20 bg-surface px-3 py-2"
                  >
                    <figcaption className="mb-1 text-[11px] font-medium text-on-surface-variant">
                      {citation.title}
                    </figcaption>
                    <blockquote className="text-xs leading-relaxed text-on-surface">
                      {citation.snippet}
                    </blockquote>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {/* 关键词 */}
          {visibleKeywords.length > 0 && (
            <div className="flex gap-2 mt-4 flex-wrap">
              {visibleKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="bg-surface-container px-3 py-1 rounded-full font-label-sm text-label-sm text-on-surface-variant border border-outline-variant/30 font-medium"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-outline-variant/20 pt-4">
            <button
              type="button"
              onClick={() => onOpenRepository(repo)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <Icon name="visibility" size={15} />
              查看详情
            </button>
            {followUpActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => onAskFollowUp(action.query)}
                disabled={isSearching}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name={action.icon} size={15} />
                {action.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onFindSimilarRepository(repo)}
              disabled={!canFindSimilarOnGithub}
              title={similarDiscoveryDisabledReason ?? '根据这个仓库在 GitHub 上寻找相似或更优项目'}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:border-outline-variant/30 disabled:bg-surface-container-low disabled:text-on-surface-variant disabled:opacity-60"
            >
              <Icon name={isFindingSimilar ? 'progress_activity' : 'travel_explore'} size={15} className={isFindingSimilar ? 'animate-spin' : ''} />
              {isFindingSimilar ? '发现中' : 'GitHub 相似发现'}
            </button>
            {similarDiscoveryDisabledReason && (
              <p className="basis-full text-[11px] leading-relaxed text-on-surface-variant">
                GitHub 相似发现需要先完成：{similarDiscoveryDisabledReason}
              </p>
            )}
            <a
              href={repo.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Icon name="open_in_new" size={15} />
              GitHub
            </a>
          </div>
        </div>

        {/* 右侧统计 */}
        <div className="hidden xl:flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1 text-on-surface-variant font-label-sm font-medium">
            <Icon name="star" size={18} className="text-warning" /> {compactNumber(repo.starsCount)}
          </div>
          {repo.language && (
            <div className="flex items-center gap-1 text-on-surface-variant font-label-sm font-medium">
              <Icon name="code_blocks" size={18} /> {repo.language}
            </div>
          )}
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 p-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors border border-outline-variant/30 shadow-sm"
          >
            <Icon name="open_in_new" size={20} />
          </a>
          <button
            type="button"
            onClick={() => onOpenRepository(repo)}
            className="p-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors border border-primary/20 shadow-sm"
            title="在知识库中查看"
          >
            <Icon name="visibility" size={20} />
          </button>
        </div>
      </div>
    </article>
  );
}

function EmptySearchResults({
  query,
  onAskFollowUp,
  isSearching,
}: {
  query: string;
  onAskFollowUp: (query: string) => void;
  isSearching: boolean;
}) {
  const actions = [
    {
      label: '放宽条件再搜',
      icon: 'manage_search',
      query: `${query} 相关 可替代 通用方案`,
    },
    {
      label: '优先看已解析',
      icon: 'auto_awesome',
      query: `${query} 已有 AI 摘要 中文解析`,
    },
    {
      label: '查部署方案',
      icon: 'rocket_launch',
      query: `${query} 部署简单 文档完善 快速上手`,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-outline-variant/25 bg-surface-container-lowest px-4 py-14 text-center text-on-surface-variant">
      <Icon name="search_off" size={56} className="opacity-35" />
      <div className="space-y-1">
        <p className="font-body-md text-on-surface">未找到匹配仓库</p>
        <p className="max-w-xl text-sm leading-relaxed">
          可以放宽问题描述，或优先检索已有中文解析的项目。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onAskFollowUp(action.query)}
            disabled={isSearching}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name={action.icon} size={15} />
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchMetric(props: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-on-surface-variant">
        <Icon name={props.icon} size={14} />
        {props.label}
      </div>
      <p className="truncate text-sm font-semibold text-on-surface">{props.value}</p>
    </div>
  );
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function getConversationKey(accountId: string) {
  return `${CONVERSATION_KEY_PREFIX}:${accountId}`;
}

function buildSearchSuggestions(input: {
  repositories: Array<{ fullName: string; language: string | null; description: string | null }>;
  languages: string[];
  tags: Array<{ name: string }>;
}) {
  const suggestions: string[] = [];
  const addSuggestion = (value: string) => {
    const normalized = value.trim();
    if (normalized && !suggestions.includes(normalized)) {
      suggestions.push(normalized);
    }
  };

  input.languages.slice(0, 2).forEach((language) => {
    addSuggestion(`${language} 方向值得深入阅读的项目`);
  });
  input.tags.slice(0, 2).forEach((tag) => {
    addSuggestion(`${tag.name} 相关项目怎么选`);
  });
  input.repositories.slice(0, 2).forEach((repository) => {
    const projectName = repository.fullName.split('/').at(-1) ?? repository.fullName;
    addSuggestion(`和 ${projectName} 类似的项目`);
  });

  FALLBACK_SUGGESTIONS.forEach(addSuggestion);
  return suggestions.slice(0, 6);
}

function normalizeSearchTurns(value: unknown): SearchTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const turn = item as Partial<SearchTurn>;
      const query = typeof turn.query === 'string' ? turn.query.trim() : '';
      if (!query) {
        return null;
      }
      return {
        id: typeof turn.id === 'string' && turn.id.trim() ? turn.id : `${Date.now()}-${query}`,
        query,
        resultCount: typeof turn.resultCount === 'number' && Number.isFinite(turn.resultCount) ? Math.max(0, Math.trunc(turn.resultCount)) : 0,
        aiQuery: typeof turn.aiQuery === 'string' && turn.aiQuery.trim() ? turn.aiQuery.trim() : null,
        repositoryIds: Array.isArray(turn.repositoryIds)
          ? uniqueValues(turn.repositoryIds.filter(isNonEmptyString)).slice(0, MAX_CONTEXT_REPOSITORIES)
          : [],
      };
    })
    .filter((turn): turn is SearchTurn => Boolean(turn))
    .slice(-MAX_SEARCH_TURNS);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueValues(values: string[]) {
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function summarizeTopLanguages(results: AiSearchResult[]) {
  const counts = new Map<string, number>();
  for (const result of results) {
    const language = result.repository.language?.trim();
    if (!language) {
      continue;
    }
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([language]) => language);
}
