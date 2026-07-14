import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '@/components/ui/icon';
import { CopyLinkButton } from '@/components/copy-link-button';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import {
  getAiConfigMessage,
  getEmbeddingConfigMessage,
  shouldFlushAiApiKey,
  shouldFlushEmbeddingApiKey,
  toBackendAiRequestConfig,
  toBackendEmbeddingRequestConfig,
} from '@/lib/ai-config';
import { compactNumber } from '@/lib/format';
import { normalizeAiSearchResponse } from '@/lib/ai-search-response';
import type { AiSearchResponse, AiSearchResult, AiStreamEvent, GitHubUser } from '@/types';

const FALLBACK_SUGGESTIONS = [
  '有没有适合离线缓存的网络请求库？',
  '想找 Rust 文本处理工具',
  '微前端主应用怎么选？',
  '推荐几个 React 动画库',
  'Python 机器学习框架怎么挑？',
  '找 Go 并发任务队列方案',
];

/* 搜索历史 localStorage key */
const HISTORY_KEY = 'gsat-search-history';
const CONVERSATION_KEY_PREFIX = 'gsat-ai-search-conversation';
const SESSIONS_KEY_PREFIX = 'gsat-ai-search-sessions';
const MAX_CONTEXT_QUERIES = 4;
const MAX_CONTEXT_REPOSITORIES = 30;
const MAX_SEARCH_TURNS = 8;
const MAX_STORED_SEARCH_SESSIONS = 6;
const SEARCH_RESULTS_PAGE_SIZE = 10;

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

type SearchMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  stage: string | null;
  createdAt: string;
};

type StoredSearchConversation = {
  submittedQuery: string;
  response: AiSearchResponse | null;
  turns: SearchTurn[];
  messages: SearchMessage[];
};

type StoredSearchSession = StoredSearchConversation & {
  id: string;
  title: string;
  updatedAt: string;
};

type SearchPageRequest = {
  query: string;
  contextQueries: string[];
  contextRepositoryIds: string[];
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
  const [messages, setMessages] = useState<SearchMessage[]>([]);
  const [isWorkspaceMode, setIsWorkspaceMode] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [isLoadingResultsPage, setIsLoadingResultsPage] = useState(false);
  const [searchSessions, setSearchSessions] = useState<StoredSearchSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [searchPageRequest, setSearchPageRequest] = useState<SearchPageRequest | null>(null);
  const activeSearchRequestIdRef = useRef<string | null>(null);
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
  const embeddingConfigMessage = getEmbeddingConfigMessage(settingsHook.settings.embedding);
  const aiEnhancementNotice = aiConfigMessage
    ? `AI 问题理解未启用：${aiConfigMessage}`
    : 'AI 会先理解你的问题，再基于本地检索结果给出回答。';
  const embeddingNotice = embeddingConfigMessage
    ? `向量检索未启用：${embeddingConfigMessage} 当前会使用严格关键词检索。`
    : `向量检索已启用：默认返回 ${settingsHook.settings.embedding.maxResults} 个结果，最多不超过 10 个。`;
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

  // 按账号保留完整搜索会话，切换页面或重启应用后仍能恢复结果。
  useEffect(() => {
    if (!accountId) {
      setSearchTurns([]);
      setMessages([]);
      setSubmittedQuery('');
      setResponse(null);
      setSearchSessions([]);
      setCurrentSessionId(null);
      setSearchPage(1);
      setSearchPageRequest(null);
      return;
    }
    try {
      const stored = localStorage.getItem(getConversationKey(accountId));
      const conversation = stored ? normalizeStoredSearchConversation(JSON.parse(stored)) : null;
      const storedSessions = localStorage.getItem(getSessionsKey(accountId));
      const sessions = storedSessions ? normalizeStoredSearchSessions(JSON.parse(storedSessions)) : [];
      const seededSessions = sessions.length > 0
        ? sessions
        : conversation && (conversation.messages.length > 0 || conversation.response)
          ? [buildStoredSearchSession(createSearchSessionId(), conversation)]
          : [];
      setSearchTurns(conversation?.turns ?? []);
      setMessages(conversation?.messages ?? []);
      setSubmittedQuery(conversation?.submittedQuery ?? '');
      setResponse(conversation?.response ?? null);
      setSearchSessions(seededSessions);
      setCurrentSessionId(seededSessions[0]?.id ?? null);
      setSearchPage(1);
      setSearchPageRequest(conversation?.response
        ? {
            query: conversation.response.aiQuery?.trim() || conversation.response.query.trim() || conversation.submittedQuery.trim(),
            contextQueries: [],
            contextRepositoryIds: [],
          }
        : null);
      setIsWorkspaceMode(Boolean(conversation?.messages.length || conversation?.response));
    } catch {
      setSearchTurns([]);
      setMessages([]);
      setSubmittedQuery('');
      setResponse(null);
      setSearchSessions([]);
      setCurrentSessionId(null);
      setSearchPage(1);
      setSearchPageRequest(null);
      setIsWorkspaceMode(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    try {
      localStorage.setItem(getConversationKey(accountId), JSON.stringify({
        submittedQuery,
        response,
        turns: searchTurns,
        messages,
      } satisfies StoredSearchConversation));
    } catch {
      // 忽略非关键异常
    }
  }, [accountId, submittedQuery, response, searchTurns, messages]);

  useEffect(() => {
    if (!accountId || !currentSessionId || (!submittedQuery && !response && messages.length === 0)) {
      return;
    }
    const conversation = {
      submittedQuery,
      response,
      turns: searchTurns,
      messages,
    } satisfies StoredSearchConversation;
    setSearchSessions((current) => upsertSearchSession(current, buildStoredSearchSession(currentSessionId, conversation)));
  }, [accountId, currentSessionId, submittedQuery, response, searchTurns, messages]);

  useEffect(() => {
    if (!accountId) return;
    try {
      localStorage.setItem(getSessionsKey(accountId), JSON.stringify(searchSessions));
    } catch {
      // 忽略非关键异常
    }
  }, [accountId, searchSessions]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<AiStreamEvent>('ai-stream', (event) => {
      const payload = event.payload;
      if (payload.taskType !== 'ai-search' || payload.requestId !== activeSearchRequestIdRef.current) {
        return;
      }
      setMessages((current) => updateAssistantStreamMessage(current, payload));
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      workspace.setAiSearchRetryAction(null);
    };
  }, [accountId]);

  async function executeSearch(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q) return;
    const shouldStartNewSession = !isWorkspaceMode;
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
    const nextSessionId = shouldStartNewSession || !currentSessionId ? createSearchSessionId() : currentSessionId;
    setCurrentSessionId(nextSessionId);
    setIsWorkspaceMode(true);
    setIsSearching(true);
    setSearchPage(1);
    setSearchPageRequest(null);
    setErrorMessage(null);
    setSubmittedQuery(q);
    setQuery('');
    saveHistory(q);
    const requestId = `ai-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeSearchRequestIdRef.current = requestId;
    const now = new Date().toISOString();
    const userMessage: SearchMessage = {
      id: `${requestId}-user`,
      role: 'user',
      content: q,
      status: 'done',
      stage: null,
      createdAt: now,
    };
    const assistantMessage: SearchMessage = {
      id: `${requestId}-assistant`,
      role: 'assistant',
      content: '正在理解你的问题...',
      status: 'streaming',
      stage: 'plan',
      createdAt: now,
    };
    setMessages((current) => (
      shouldStartNewSession
        ? [userMessage, assistantMessage]
        : [...current, userMessage, assistantMessage].slice(-MAX_SEARCH_TURNS * 2)
    ));
    try {
      let aiKeyFlushError: string | null = null;
      if (!aiConfigMessage && shouldFlushAiApiKey(settingsHook.settings.ai)) {
        try {
          await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
        } catch (reason) {
          aiKeyFlushError = toErrorMessage(reason);
        }
      }
      let embeddingKeyFlushError: string | null = null;
      if (!embeddingConfigMessage && shouldFlushEmbeddingApiKey(settingsHook.settings.embedding)) {
        try {
          await settingsHook.flushEmbeddingKey(settingsHook.settings.embedding.apiKey);
        } catch (reason) {
          embeddingKeyFlushError = toErrorMessage(reason);
        }
      }
      const recentTurns = shouldStartNewSession ? [] : searchTurns.slice(-MAX_CONTEXT_QUERIES);
      const contextQueries = recentTurns
        .flatMap((turn) => [turn.query, turn.aiQuery].filter(isNonEmptyString))
        .slice(-MAX_CONTEXT_QUERIES * 2);
      const contextRepositoryIds = uniqueValues(
        recentTurns.flatMap((turn) => turn.repositoryIds),
      ).slice(-MAX_CONTEXT_REPOSITORIES);
      const data = await invoke<AiSearchResponse>('search_repositories', {
        request: {
          query: q,
          limit: SEARCH_RESULTS_PAGE_SIZE,
          offset: 0,
          accountId,
          contextQueries,
          contextRepositoryIds,
          requestId,
          ...(aiConfigMessage || aiKeyFlushError ? {} : { aiConfig: toBackendAiRequestConfig(settingsHook.settings.ai) }),
          ...(embeddingConfigMessage || embeddingKeyFlushError
            ? {}
            : { embeddingConfig: toBackendEmbeddingRequestConfig(settingsHook.settings.embedding) }),
        },
      });
      let visibleData = aiKeyFlushError
        ? {
            ...data,
            mode: 'local_knowledge' as const,
            aiEnhanced: false,
            aiQuery: null,
            aiRationaleZh: null,
            aiError: `AI Key 保存失败，已改用本地知识搜索：${aiKeyFlushError}`,
          }
        : data;
      if (embeddingKeyFlushError) {
        visibleData = {
          ...visibleData,
          retrievalMode: 'keyword',
          vectorApplied: false,
          vectorError: `Embedding Key 保存失败，已改用严格关键词检索：${embeddingKeyFlushError}`,
        };
      }
      setResponse(visibleData);
      setSearchPageRequest({
        query: visibleData.aiQuery?.trim() || visibleData.query.trim() || q,
        contextQueries,
        contextRepositoryIds,
      });
      setMessages((current) => finalizeAssistantMessage(current, requestId, buildSearchAssistantSummary(visibleData)));
      setSearchTurns((turns) => [
        ...(shouldStartNewSession ? [] : turns),
        {
          id: `${Date.now()}-${q}`,
          query: q,
          resultCount: visibleData.totalCount,
          aiQuery: visibleData.aiQuery,
          repositoryIds: visibleData.results.map((result) => result.repository.id).slice(0, MAX_CONTEXT_REPOSITORIES),
        },
      ].slice(-MAX_SEARCH_TURNS));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setErrorMessage(message);
      setMessages((current) => failAssistantMessage(current, requestId, message));
      setResponse(null);
    } finally {
      if (activeSearchRequestIdRef.current === requestId) {
        activeSearchRequestIdRef.current = null;
      }
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
    void executeSearch(suggestion);
  }

  function handleHistoryClick(item: string) {
    if (isSearching) return;
    void executeSearch(item);
  }

  function handleFollowUp(nextQuery: string) {
    if (isSearching) return;
    void executeSearch(nextQuery);
  }

  async function loadSearchResultsPage(nextPage: number) {
    if (!accountId || !response || isSearching || isLoadingResultsPage) return;
    const totalPages = Math.max(1, Math.ceil(response.totalCount / SEARCH_RESULTS_PAGE_SIZE));
    const page = Math.min(Math.max(1, nextPage), totalPages);
    if (page === searchPage) return;
    const paging = searchPageRequest ?? {
      query: response.aiQuery?.trim() || response.query.trim() || submittedQuery.trim(),
      contextQueries: [],
      contextRepositoryIds: [],
    };
    if (!paging.query.trim()) return;
    setIsLoadingResultsPage(true);
    setErrorMessage(null);
    try {
      const pageData = await invoke<AiSearchResponse>('search_repositories', {
        request: {
          query: paging.query,
          limit: SEARCH_RESULTS_PAGE_SIZE,
          offset: (page - 1) * SEARCH_RESULTS_PAGE_SIZE,
          accountId,
          contextQueries: paging.contextQueries,
          contextRepositoryIds: paging.contextRepositoryIds,
          ...(embeddingConfigMessage
            ? {}
            : { embeddingConfig: toBackendEmbeddingRequestConfig(settingsHook.settings.embedding) }),
        },
      });
      setResponse((current) => current
        ? {
            ...current,
            results: pageData.results,
            totalCount: pageData.totalCount,
            contextApplied: current.contextApplied || pageData.contextApplied,
          }
        : pageData);
      setSearchPage(page);
    } catch (reason) {
      setErrorMessage(toErrorMessage(reason));
    } finally {
      setIsLoadingResultsPage(false);
    }
  }

  async function handleExplainTopic(topic: string, visibleQuestion = topic) {
    const normalizedTopic = topic.trim();
    const normalizedVisibleQuestion = visibleQuestion.trim() || normalizedTopic;
    if (!normalizedTopic || isSearching) return;
    if (aiConfigMessage) {
      setErrorMessage(`请先完成 AI 配置后再让 AI 解释：${aiConfigMessage}`);
      return;
    }
    workspace.setAiSearchRetryAction(() => handleExplainTopic(normalizedTopic, normalizedVisibleQuestion));
    if (!currentSessionId) {
      setCurrentSessionId(createSearchSessionId());
    }
    setIsWorkspaceMode(true);
    setIsSearching(true);
    setErrorMessage(null);
    if (!response) {
      setSubmittedQuery(normalizedVisibleQuestion);
    }
    setQuery('');
    const requestId = `ai-explain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeSearchRequestIdRef.current = requestId;
    const now = new Date().toISOString();
    const userMessage: SearchMessage = {
      id: `${requestId}-user`,
      role: 'user',
      content: normalizedVisibleQuestion,
      status: 'done',
      stage: null,
      createdAt: now,
    };
    const assistantMessage: SearchMessage = {
      id: `${requestId}-assistant`,
      role: 'assistant',
      content: '正在解释这个问题...',
      status: 'streaming',
      stage: 'explain',
      createdAt: now,
    };
    setMessages((current) => [...current, userMessage, assistantMessage].slice(-MAX_SEARCH_TURNS * 2));

    try {
      if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
        await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
      }
      const content = await invoke<string>('explain_ai_search_topic', {
        request: {
          topic: normalizedTopic,
          aiConfig: toBackendAiRequestConfig(settingsHook.settings.ai),
          requestId,
        },
      });
      setMessages((current) => finalizeAssistantMessage(current, requestId, content));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setErrorMessage(message);
      setMessages((current) => failAssistantMessage(current, requestId, message));
    } finally {
      if (activeSearchRequestIdRef.current === requestId) {
        activeSearchRequestIdRef.current = null;
      }
      setIsSearching(false);
    }
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
    const sessionId = currentSessionId;
    setSearchTurns([]);
    setMessages([]);
    setSubmittedQuery('');
    setResponse(null);
    setErrorMessage(null);
    setCurrentSessionId(null);
    setSearchPage(1);
    setSearchPageRequest(null);
    setIsWorkspaceMode(false);
    if (sessionId) {
      setSearchSessions((current) => current.filter((session) => session.id !== sessionId));
    }
    if (accountId) {
      try {
        localStorage.removeItem(getConversationKey(accountId));
      } catch {
        // 忽略非关键异常
      }
    }
  }

  function handleRestoreSession(session: StoredSearchSession) {
    setCurrentSessionId(session.id);
    setSubmittedQuery(session.submittedQuery);
    setResponse(session.response);
    setSearchTurns(session.turns);
    setMessages(session.messages);
    setQuery('');
    setErrorMessage(null);
    setSearchPage(1);
    setSearchPageRequest(session.response
      ? {
          query: session.response.aiQuery?.trim() || session.response.query.trim() || session.submittedQuery.trim(),
          contextQueries: [],
          contextRepositoryIds: [],
        }
      : null);
    setIsWorkspaceMode(true);
  }

  const results = response?.results ?? [];
  const contextQueriesUsed = response?.contextQueriesUsed ?? [];
  const aiError = response?.aiError ?? null;
  const similarDiscoveryDisabledReason = !accountId
    ? '请先连接 GitHub 账号'
    : aiConfigMessage;
  const pageStart = response && results.length > 0
    ? (searchPage - 1) * SEARCH_RESULTS_PAGE_SIZE + 1
    : 0;
  const pageEnd = response && results.length > 0
    ? pageStart + results.length - 1
    : 0;
  const totalPages = response
    ? Math.max(1, Math.ceil(response.totalCount / SEARCH_RESULTS_PAGE_SIZE))
    : 1;
  const canGoPreviousPage = Boolean(response && searchPage > 1 && !isLoadingResultsPage);
  const canGoNextPage = Boolean(response && searchPage < totalPages && !isLoadingResultsPage);
  const suggestions = useMemo(() => buildSearchSuggestions({
    repositories: workspace.repositoryPage?.items ?? [],
    languages: workspace.repositoryLanguages,
    tags: workspace.tags,
  }), [workspace.repositoryLanguages, workspace.repositoryPage, workspace.tags]);
  const suggestionLabel = accountId && workspace.repositoryStats.total > 0 ? '可以接着问' : '可以这样搜';
  const hasActiveSession = Boolean(submittedQuery || response || messages.length > 0);

  function handleBackToSearchHome() {
    setIsWorkspaceMode(false);
    setErrorMessage(null);
  }

  return (
    <div className="ai-search-page h-full overflow-hidden">
      {isWorkspaceMode && hasActiveSession ? (
        <div className="flex h-full flex-col gap-4 p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-3 border-b border-outline-variant/30 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <button
                type="button"
                onClick={handleBackToSearchHome}
                className="mb-2 inline-flex items-center gap-1.5 rounded-md px-1 text-xs font-medium text-on-surface-variant transition-colors hover:text-primary"
              >
                <Icon name="arrow_back" size={16} />
                返回搜索主页
              </button>
              <h2 className="truncate text-2xl font-bold tracking-tight text-on-surface">
                {submittedQuery || '智能知识搜索'}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-medium text-primary">
                {response ? `${response.totalCount} 个结果` : isSearching ? '正在搜索' : '等待搜索'}
              </span>
              {response?.aiEnhanced && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                  AI 已理解问题
                </span>
              )}
              {response?.vectorApplied && (
                <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-success">
                  向量检索
                </span>
              )}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
            <SearchConversation
              messages={messages}
              user={workspace.authState.user}
              isSearching={isSearching}
              onClear={handleClearConversation}
              query={query}
              onQueryChange={setQuery}
              onSubmit={handleSearch}
              isSearchUnavailable={isSearchUnavailable}
              className="min-h-[520px] lg:min-h-0"
            />

            <aside className="min-h-0 overflow-hidden rounded-lg border border-card-border bg-surface-container-lowest shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-outline-variant/25 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
                    <Icon name="temp_preferences_custom" size={18} className="text-primary" />
                    搜索结果
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                    {isSearching ? '正在更新匹配结果' : response ? `已找到 ${response.totalCount} 个匹配仓库` : '搜索后会在这里保留结果'}
                  </p>
                </div>
                {response && (
                  <span className="shrink-0 rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                    {results.length > 0 ? `${pageStart}-${pageEnd}` : '0'}/{response.totalCount}
                  </span>
                )}
              </div>

              <div className="h-full min-h-0 overflow-y-auto px-4 py-4">
                <div className="flex flex-col gap-4 pb-8">
                  {response?.contextApplied && contextQueriesUsed.length > 0 && (
                    <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-on-surface-variant">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-on-surface">已结合上下文</span>
                        {contextQueriesUsed.map((item) => (
                          <span key={item} className="rounded-full bg-surface-container-high px-2 py-0.5">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {response && aiError && (
                    <div className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-on-surface-variant">
                      <div className="flex items-start gap-2">
                        <Icon name="info" size={16} className="text-warning" />
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium text-on-surface">已切换为本地知识搜索</p>
                          <p>{aiError}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {response?.vectorError && (
                    <div className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-on-surface-variant">
                      <div className="flex items-start gap-2">
                        <Icon name="info" size={16} className="text-warning" />
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium text-on-surface">向量检索已降级</p>
                          <p>{response.vectorError}</p>
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

                  {errorMessage && (
                    <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
                      {errorMessage}
                    </div>
                  )}

                  {!errorMessage && !response && isSearching && (
                    <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-outline-variant/25 bg-surface-container-low px-4 py-10 text-sm text-on-surface-variant">
                      <div className="inline-flex items-center justify-center gap-3">
                        <Icon name="progress_activity" size={28} className="shrink-0 animate-spin text-primary" />
                        <span className="leading-none">正在搜索你的 Stars 知识库</span>
                      </div>
                    </div>
                  )}

                  {!errorMessage && response && results.length === 0 && !isSearching && (
                    <EmptySearchResults
                      query={submittedQuery}
                      onAskFollowUp={handleFollowUp}
                      isSearching={isSearching}
                    />
                  )}

                  {results.length > 0 && (
                    <div className="space-y-3">
                      <div className={`grid grid-cols-1 gap-4 transition-opacity ${isLoadingResultsPage ? 'opacity-55' : 'opacity-100'}`}>
                        {results.map((result) => (
                          <SearchResultCard
                            key={result.repository.id}
                            result={result}
                            onOpenRepository={props.onOpenRepository}
                            onExplainTopic={handleExplainTopic}
                            onFindSimilarRepository={handleFindSimilarRepository}
                            isSearching={isSearching}
                            isFindingSimilar={workspace.isFindingSimilarRepositories}
                            similarDiscoveryDisabledReason={similarDiscoveryDisabledReason}
                            compact
                          />
                        ))}
                      </div>
                      {response && response.totalCount > SEARCH_RESULTS_PAGE_SIZE && (
                        <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/25 bg-surface-container-low px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs text-on-surface-variant">
                            第 {pageStart}-{pageEnd} 个，共 {response.totalCount} 个匹配仓库
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void loadSearchResultsPage(searchPage - 1)}
                              disabled={!canGoPreviousPage}
                              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Icon name="chevron_left" size={15} />
                              上一页
                            </button>
                            <span className="min-w-14 text-center text-xs font-medium text-on-surface-variant">
                              {isLoadingResultsPage ? '加载中' : `${searchPage}/${totalPages}`}
                            </span>
                            <button
                              type="button"
                              onClick={() => void loadSearchResultsPage(searchPage + 1)}
                              disabled={!canGoNextPage}
                              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              下一页
                              <Icon name="chevron_right" size={15} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      ) : (
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
                <div className="space-y-1">
                  <p>{aiEnhancementNotice}</p>
                  <p>{embeddingNotice}</p>
                </div>
              </div>
            )}
          </div>

          {/* 建议词按钮 */}
          <div className="mt-5 flex max-w-4xl flex-wrap justify-center gap-2">
            <span className="mr-1 flex items-center rounded-full bg-surface-container-low px-3 py-1.5 font-label-sm text-label-sm font-medium text-on-surface-variant">
              <Icon name="lightbulb" size={16} className="mr-1 text-warning" /> {suggestionLabel}
            </span>
            {suggestions.map((s) => (
              <button
                key={s.query}
                onClick={() => handleSuggestionClick(s.query)}
                disabled={isSearchUnavailable}
                className="glass-panel flex items-center gap-2 rounded-full bg-surface-container-lowest px-3 py-1.5 font-body-md text-sm text-on-surface transition-colors hover:bg-primary/5 hover:text-primary"
              >
                {s.label}
              </button>
            ))}
          </div>

        </div>

        {searchSessions.length > 0 && (
          <section className="rounded-lg border border-card-border bg-surface-container-lowest p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
                  <Icon name="forum" size={18} className="text-primary" />
                  最近会话
                </h3>
                <p className="mt-0.5 text-xs text-on-surface-variant">点击查看上次聊天</p>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {searchSessions.slice(0, 4).map((session, index) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => handleRestoreSession(session)}
                  className={`group rounded-lg border px-3 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 ${
                    index === 0
                      ? 'border-primary/20 bg-primary/10'
                      : 'border-outline-variant/25 bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">
                        {index === 0 ? '继续上次会话' : session.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-on-surface-variant">
                        {index === 0 ? session.title : getSessionPreview(session)}
                      </p>
                    </div>
                    <Icon name="arrow_forward" size={16} className="mt-0.5 shrink-0 text-on-surface-variant transition-colors group-hover:text-primary" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5">
                      {session.response ? `${session.response.totalCount} 个结果` : '仅对话'}
                    </span>
                    <span>{formatSessionTime(session.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 搜索历史 */}
        {history.length > 0 && (
          <div className="mt-2 pt-6 border-t border-outline-variant/30">
            <h4 className="font-headline-md text-[18px] text-on-surface mb-4 flex items-center gap-2 font-bold">
              <Icon name="history" size={20} className="text-on-surface-variant" />
              搜索历史
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
                  再次搜索：{item}
                </button>
              ))}
            </div>
          </div>
        )}
          </div>
        </div>
      )}
      </div>
  );
}

function SearchConversation({
  messages,
  user,
  isSearching,
  onClear,
  query,
  onQueryChange,
  onSubmit,
  isSearchUnavailable,
  className,
}: {
  messages: SearchMessage[];
  user: GitHubUser | null;
  isSearching: boolean;
  onClear: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  isSearchUnavailable: boolean;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg border border-card-border bg-surface-container-lowest shadow-sm ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/25 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-on-surface">
            <Icon name="forum" size={18} className="text-primary" />
            搜索对话
          </h3>
          <p className="mt-0.5 text-xs text-on-surface-variant">这里会保留最近搜索和 AI 实时输出。</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={isSearching}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-outline-variant/35 bg-surface-container-low px-2.5 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="delete_sweep" size={14} />
          清空
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[min(760px,100%)] rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                message.role === 'user'
                  ? 'border-primary/20 bg-primary text-white'
                  : message.status === 'error'
                    ? 'border-error/20 bg-error/10 text-error'
                    : 'border-outline-variant/25 bg-surface-container-low text-on-surface'
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium opacity-80">
                {message.role === 'user' ? (
                  <UserMessageAvatar user={user} />
                ) : (
                  <Icon
                    name={message.status === 'streaming' ? 'progress_activity' : 'auto_awesome'}
                    size={13}
                    className={message.status === 'streaming' ? 'animate-spin' : ''}
                  />
                )}
                {message.role === 'user' ? '你' : getStreamStageLabel(message.stage)}
              </div>
              <MessageContent message={message} />
            </div>
          </div>
        ))}
      </div>
      <form
        className="border-t border-outline-variant/25 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low px-2 py-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <textarea
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            rows={1}
            placeholder="继续追问，或重新描述想找的项目..."
            className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border-0 bg-surface-container-lowest/60 px-3 py-2 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/70 focus:ring-0"
          />
          <button
            type="submit"
            disabled={!query.trim() || isSearching || isSearchUnavailable}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            title={isSearching ? '正在生成' : '发送'}
          >
            <Icon name={isSearching ? 'progress_activity' : 'arrow_upward'} size={17} className={isSearching ? 'animate-spin' : ''} />
          </button>
        </div>
      </form>
    </section>
  );
}

function MessageContent({ message }: { message: SearchMessage }) {
  if (message.role === 'user') {
    return (
      <p className="whitespace-pre-wrap break-words">
        {getPublicUserMessageContent(message.content)}
      </p>
    );
  }

  const parsed = parseAssistantMessageContent(message.content);
  return (
    <div className="space-y-2">
      {parsed.thinking.map((thought, index) => (
        <details
          key={`${message.id}-think-${index}`}
          className="rounded-md border border-outline-variant/25 bg-surface-container-lowest/70"
          open={message.status === 'streaming' && index === parsed.thinking.length - 1}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-on-surface-variant hover:text-on-surface">
            <Icon name="psychology" size={14} className="text-primary" />
            深度思考
          </summary>
          <div className="border-t border-outline-variant/20 px-3 py-2 text-xs leading-relaxed text-on-surface-variant">
            <p className="whitespace-pre-wrap break-words">{thought}</p>
          </div>
        </details>
      ))}
      {parsed.answer ? (
        <MarkdownMessage markdown={parsed.answer} />
      ) : (
        <p className="text-sm text-on-surface-variant">
          {message.status === 'streaming' ? '正在整理最终回答...' : 'AI 没有返回可展示的最终回答。'}
        </p>
      )}
    </div>
  );
}

function MarkdownMessage({ markdown }: { markdown: string }) {
  return (
    <div className="ai-message-markdown text-sm leading-relaxed text-inherit">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer" className="font-medium underline decoration-current/40 underline-offset-2">
                {children}
              </a>
            );
          },
          p({ children }) {
            return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
          },
          code({ children }) {
            return <code className="rounded bg-black/5 px-1 py-0.5 text-[0.92em]">{children}</code>;
          },
          pre({ children }) {
            return <pre className="my-2 overflow-x-auto rounded-md bg-black/5 p-3 text-xs">{children}</pre>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function UserMessageAvatar({ user }: { user: GitHubUser | null }) {
  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.login}
        className="h-4 w-4 rounded-full border border-white/35 object-cover"
      />
    );
  }

  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold text-white">
      {user?.login?.[0]?.toUpperCase() ?? '你'}
    </span>
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
      <div className="mb-3 flex items-center gap-2">
        <Icon name="summarize" size={20} className="text-primary" />
        <h4 className="font-headline-md text-base font-semibold text-on-surface">结果总结</h4>
      </div>
      <p className="text-sm leading-relaxed text-on-surface-variant">
        找到 {response.totalCount} 个匹配仓库
        {topResult ? `，当前页最相关的是 ${topResult.repository.fullName}，匹配度 ${topResult.score}%。` : '。'}
        {analyzedCount > 0
          ? ` 当前页有 ${analyzedCount} 个已有中文解析，可直接查看项目知识卡。`
          : ' 当前页还没有中文解析，可以进入详情后生成 README 解析。'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-on-surface-variant">
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
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
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
    </section>
  );
}

/* === 搜索结果卡片 === */
function SearchResultCard({
  result,
  onOpenRepository,
  onExplainTopic,
  onFindSimilarRepository,
  isSearching,
  isFindingSimilar,
  similarDiscoveryDisabledReason,
  compact = false,
}: {
  result: AiSearchResult;
  onOpenRepository: (repository: AiSearchResult['repository']) => void;
  onExplainTopic: (topic: string, visibleQuestion?: string) => void;
  onFindSimilarRepository: (repository: AiSearchResult['repository']) => void;
  isSearching: boolean;
  isFindingSimilar: boolean;
  similarDiscoveryDisabledReason: string | null;
  compact?: boolean;
}) {
  const { repository: repo, score, explanationZh, reasons, citations, keywords } = result;
  const readableSummary = result.aiSummary ?? repo.aiSummary ?? repo.description ?? '这个仓库还没有可用的中文解析，可以先进入详情生成 AI 摘要。';
  const visibleKeywords = uniqueValues([...keywords, ...repo.aiKeywords, ...repo.suggestedTags, ...repo.topics]).slice(0, 10);
  const followUpActions = [
    {
      label: '怎么使用',
      icon: 'terminal',
      visibleQuestion: `${repo.fullName} 怎么使用？`,
      topic: `请解释 ${repo.fullName} 怎么使用。已知信息：${buildRepositoryExplanationContext(repo, readableSummary)}`,
    },
    {
      label: '如何部署',
      icon: 'cloud_upload',
      visibleQuestion: `${repo.fullName} 怎么部署或本地运行？`,
      topic: `请解释 ${repo.fullName} 如何部署或本地运行。已知信息：${buildRepositoryExplanationContext(repo, readableSummary)}`,
    },
    {
      label: '比较场景',
      icon: 'compare_arrows',
      visibleQuestion: `${repo.fullName} 适合哪些场景？`,
      topic: `请解释 ${repo.fullName} 适合什么场景，并说明不适合什么场景。已知信息：${buildRepositoryExplanationContext(repo, readableSummary)}`,
    },
  ];
  const canFindSimilarOnGithub = !similarDiscoveryDisabledReason && !isSearching && !isFindingSimilar;

  return (
    <article className={`group rounded-lg border border-card-border bg-surface-container-lowest shadow-sm transition-colors duration-200 hover:border-primary/25 ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
      <div className={`flex flex-col gap-4 ${compact ? '' : 'xl:flex-row xl:items-start xl:justify-between'}`}>
        <div className="flex-1 min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-3">
            <div className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm shrink-0`}>
              <Icon name="book" size={compact ? 19 : 24} />
            </div>
            <button
              type="button"
              onClick={() => onOpenRepository(repo)}
              className={`min-w-0 flex-1 truncate text-left font-headline-md font-bold text-primary cursor-pointer group-hover:underline ${compact ? 'text-[15px]' : 'text-[18px] sm:text-[20px]'}`}
            >
              {repo.fullName}
            </button>
            <span className="bg-success/10 px-2.5 py-1 rounded-md text-xs font-label-sm text-success border border-success/20 flex items-center gap-1 font-bold shadow-sm shrink-0">
              <Icon name="check_circle" size={14} />
              匹配度 {score}%
            </span>
          </div>
          <div className={`mb-4 grid gap-3 ${compact ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]'}`}>
            <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 p-3">
              <p className="mb-1 text-[11px] font-semibold text-primary">中文说明</p>
              <p className={`font-body-md leading-relaxed text-on-surface ${compact ? 'line-clamp-3 text-xs' : 'text-sm'}`}>
                {readableSummary}
              </p>
              {repo.description && repo.description !== readableSummary && (
                <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                  原始描述：{repo.description}
                </p>
              )}
            </div>
            <div className={`grid grid-cols-2 gap-2 text-xs text-on-surface-variant ${compact ? '' : 'sm:grid-cols-4 lg:grid-cols-2'}`}>
              <SearchMetric icon="star" label="Stars" value={compactNumber(repo.starsCount)} />
              <SearchMetric icon="fork_right" label="Forks" value={compactNumber(repo.forksCount)} />
              <SearchMetric icon="code_blocks" label="语言" value={repo.language ?? '未标注'} />
              <SearchMetric icon={repo.aiSummary ? 'auto_awesome' : 'description'} label="知识状态" value={repo.aiSummary ? '已解析' : repo.hasReadme ? '可解析' : '待抓取'} />
            </div>
          </div>

          {/* 知识匹配理由 */}
          <div className={`mb-4 rounded-lg border border-primary/20 bg-primary/5 shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
            <p className="font-body-md text-body-md text-on-surface flex items-start gap-2">
              <Icon name="psychology_alt" size={20} className="text-primary mt-0.5" />
              <span className="leading-relaxed">
                <strong className="text-primary">知识匹配理由：</strong> {explanationZh}
              </span>
            </p>
            {/* 匹配理由 */}
            {!compact && reasons.length > 0 && (
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

          {!compact && citations.length > 0 && (
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
          {!compact && visibleKeywords.length > 0 && (
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
                onClick={() => onExplainTopic(action.topic, action.visibleQuestion)}
                disabled={isSearching}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                title="让 AI 直接解释，不重新搜索仓库"
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
            <CopyLinkButton url={repo.htmlUrl} compact />
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
        <div className={`${compact ? 'hidden' : 'hidden xl:flex'} flex-col items-end gap-2 shrink-0`}>
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

function getSessionsKey(accountId: string) {
  return `${SESSIONS_KEY_PREFIX}:${accountId}`;
}

function createSearchSessionId() {
  return `search-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildStoredSearchSession(id: string, conversation: StoredSearchConversation): StoredSearchSession {
  return {
    ...conversation,
    id,
    title: getConversationTitle(conversation),
    updatedAt: new Date().toISOString(),
  };
}

function upsertSearchSession(current: StoredSearchSession[], next: StoredSearchSession) {
  return [next, ...current.filter((session) => session.id !== next.id)]
    .slice(0, MAX_STORED_SEARCH_SESSIONS);
}

function getConversationTitle(conversation: StoredSearchConversation) {
  const title = conversation.submittedQuery.trim()
    || conversation.messages.find((message) => message.role === 'user')?.content.trim()
    || '未命名搜索会话';
  return getPublicUserMessageContent(title).slice(0, 80);
}

function getSessionPreview(session: StoredSearchSession) {
  const assistantMessage = [...session.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim());
  if (assistantMessage) {
    return parseAssistantMessageContent(assistantMessage.content).answer.replace(/\s+/g, ' ').slice(0, 110);
  }
  return session.submittedQuery || '打开会话查看搜索结果';
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function updateAssistantStreamMessage(messages: SearchMessage[], payload: AiStreamEvent): SearchMessage[] {
  const assistantId = `${payload.requestId}-assistant`;
  return messages.map((message) => {
    if (message.id !== assistantId) {
      return message;
    }
    const content = payload.text
      ?? payload.message
      ?? message.content;
    return {
      ...message,
      content,
      stage: payload.stage,
      status: payload.status === 'failed'
        ? 'error'
        : payload.status === 'finished'
          ? 'done'
          : 'streaming',
    };
  });
}

function finalizeAssistantMessage(messages: SearchMessage[], requestId: string, content: string): SearchMessage[] {
  const assistantId = `${requestId}-assistant`;
  return messages.map((message) => message.id === assistantId
    ? { ...message, content, status: 'done', stage: 'done' }
    : message);
}

function failAssistantMessage(messages: SearchMessage[], requestId: string, content: string): SearchMessage[] {
  const assistantId = `${requestId}-assistant`;
  return messages.map((message) => message.id === assistantId
    ? { ...message, content, status: 'error', stage: 'error' }
    : message);
}

function buildSearchAssistantSummary(response: AiSearchResponse) {
  if (response.answerZh?.trim()) {
    const vectorNote = response.vectorError ? `\n\n${response.vectorError}` : '';
    const aiNote = response.aiError ? `\n\n${response.aiError}` : '';
    return `${response.answerZh.trim()}${vectorNote}${aiNote}`;
  }
  const topResult = response.results[0]?.repository.fullName;
  const mode = response.aiEnhanced ? '我已结合你的问题重新理解，并在本地知识库中完成匹配。' : '我已使用本地知识库完成匹配。';
  const top = topResult ? `最佳匹配是 ${topResult}。` : '';
  const aiNote = response.aiRationaleZh ? `\n\n理解依据：${response.aiRationaleZh}` : '';
  const fallback = response.aiError ? `\n\n${response.aiError}` : '';
  return `${mode}找到 ${response.totalCount} 个匹配仓库。${top}${aiNote}${fallback}`;
}

function buildRepositoryExplanationContext(
  repo: AiSearchResult['repository'],
  readableSummary: string,
) {
  const parts = [
    `仓库：${repo.fullName}`,
    repo.description ? `描述：${repo.description}` : null,
    repo.language ? `主要语言：${repo.language}` : null,
    repo.topics.length > 0 ? `Topics：${repo.topics.slice(0, 8).join('、')}` : null,
    repo.suggestedTags.length > 0 ? `推荐标签：${repo.suggestedTags.slice(0, 8).join('、')}` : null,
    readableSummary ? `摘要：${readableSummary.slice(0, 600)}` : null,
  ];
  return parts.filter(isNonEmptyString).join('；');
}

function getPublicUserMessageContent(content: string) {
  const visibleContent = content.split('已知信息：')[0]?.trim() ?? content.trim();
  return visibleContent.replace(/[。；;，,：:]+$/, '') || content;
}

function parseAssistantMessageContent(content: string) {
  const thinking: string[] = [];
  let answer = content;
  const completeThinkPattern = /<think>([\s\S]*?)<\/think>/gi;
  answer = answer.replace(completeThinkPattern, (_match, thought: string) => {
    const normalizedThought = thought.trim();
    if (normalizedThought) {
      thinking.push(normalizedThought);
    }
    return '';
  });

  const openThinkIndex = answer.toLowerCase().lastIndexOf('<think>');
  if (openThinkIndex >= 0) {
    const thought = answer.slice(openThinkIndex + '<think>'.length).trim();
    if (thought) {
      thinking.push(thought);
    }
    answer = answer.slice(0, openThinkIndex);
  }

  return {
    thinking,
    answer: normalizeAssistantAnswer(answer),
  };
}

function normalizeAssistantAnswer(content: string) {
  const trimmed = content
    .replace(/<\/think>/gi, '')
    .replace(/^```(?:json|markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!trimmed) {
    return '';
  }

  const jsonText = extractJsonLikeText(trimmed);
  if (!jsonText) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      title?: unknown;
      content?: unknown;
      answer?: unknown;
      summary?: unknown;
      points?: unknown;
    };
    const parts: string[] = [];
    if (typeof parsed.title === 'string' && parsed.title.trim()) {
      parts.push(`### ${parsed.title.trim()}`);
    }
    const mainContent = [parsed.content, parsed.answer, parsed.summary]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (mainContent) {
      parts.push(mainContent.trim());
    }
    if (Array.isArray(parsed.points)) {
      const points = parsed.points
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => `- ${value.trim()}`);
      parts.push(...points);
    }
    return parts.length > 0 ? parts.join('\n\n') : trimmed;
  } catch {
    return trimmed;
  }
}

function extractJsonLikeText(content: string) {
  const fenced = content.match(/^```json\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  if (content.startsWith('{') && content.endsWith('}')) {
    return content;
  }
  return null;
}

function getStreamStageLabel(stage: string | null) {
  switch (stage) {
    case 'plan':
      return '理解问题';
    case 'analyze':
      return '匹配仓库';
    case 'vector':
      return '向量召回';
    case 'answer':
      return '生成回答';
    case 'explain':
      return '解释问题';
    case 'done':
      return '搜索完成';
    case 'error':
      return '搜索失败';
    default:
      return 'AI';
  }
}

function normalizeStoredSearchConversation(value: unknown): StoredSearchConversation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const stored = value as Partial<StoredSearchConversation>;
  return {
    submittedQuery: typeof stored.submittedQuery === 'string' ? stored.submittedQuery : '',
    response: normalizeAiSearchResponse(stored.response),
    turns: normalizeSearchTurns(stored.turns),
    messages: normalizeSearchMessages(stored.messages),
  };
}

function normalizeStoredSearchSessions(value: unknown): StoredSearchSession[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const stored = item as Partial<StoredSearchSession>;
      const conversation = normalizeStoredSearchConversation(stored);
      if (!conversation) {
        return null;
      }
      const id = typeof stored.id === 'string' && stored.id.trim()
        ? stored.id.trim()
        : createSearchSessionId();
      const fallbackSession = buildStoredSearchSession(id, conversation);
      return {
        ...fallbackSession,
        title: typeof stored.title === 'string' && stored.title.trim()
          ? stored.title.trim()
          : fallbackSession.title,
        updatedAt: typeof stored.updatedAt === 'string' && stored.updatedAt.trim()
          ? stored.updatedAt.trim()
          : fallbackSession.updatedAt,
      };
    })
    .filter((session): session is StoredSearchSession => Boolean(session))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, MAX_STORED_SEARCH_SESSIONS);
}

function normalizeSearchMessages(value: unknown): SearchMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const messages: SearchMessage[] = [];
  for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const message = item as Partial<SearchMessage>;
      const role = message.role === 'user' || message.role === 'assistant' ? message.role : null;
      const content = typeof message.content === 'string' ? message.content : '';
      if (!role || !content.trim()) {
        continue;
      }
      messages.push({
        id: typeof message.id === 'string' && message.id ? message.id : `${Date.now()}-${role}`,
        role,
        content,
        status: message.status === 'streaming' || message.status === 'error' || message.status === 'done' ? message.status : 'done',
        stage: typeof message.stage === 'string' ? message.stage : null,
        createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
      });
  }
  return messages.slice(-MAX_SEARCH_TURNS * 2);
}

function buildSearchSuggestions(input: {
  repositories: Array<{ fullName: string; language: string | null; description: string | null }>;
  languages: string[];
  tags: Array<{ name: string }>;
}) {
  const suggestions: Array<{ label: string; query: string }> = [];
  const addSuggestion = (label: string, query = label) => {
    const normalizedLabel = label.trim();
    const normalizedQuery = query.trim();
    if (
      normalizedLabel
      && normalizedQuery
      && !suggestions.some((item) => item.label === normalizedLabel || item.query === normalizedQuery)
    ) {
      suggestions.push({ label: normalizedLabel, query: normalizedQuery });
    }
  };

  input.languages.slice(0, 2).forEach((language) => {
    addSuggestion(`${language} 里有哪些值得深挖？`, `${language} 值得深入阅读的项目`);
  });
  input.tags.slice(0, 2).forEach((tag) => {
    addSuggestion(`${tag.name} 方向怎么选？`, `${tag.name} 相关项目怎么选`);
  });
  input.repositories.slice(0, 2).forEach((repository) => {
    const projectName = repository.fullName.split('/').at(-1) ?? repository.fullName;
    addSuggestion(`有没有 ${projectName} 的替代品？`, `和 ${projectName} 类似的项目`);
  });

  FALLBACK_SUGGESTIONS.forEach((suggestion) => addSuggestion(suggestion));
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
