import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getAiConfigMessage, toBackendAiRequestConfig } from '@/lib/ai-config';
import { emptyRepositoryFilters, getRepositoryStats } from '@/lib/repository';
import { optionalRequestText } from '@/lib/format';
import type {
  AISettings,
  AiStreamEvent,
  AiTagNetworkSummary,
  BatchAiDocumentSummary,
  BackendStatus,
  GistAnnotationExportSummary,
  GistAnnotationImportSummary,
  GistRepositoryLibraryExportSummary,
  GistRepositoryLibraryImportSummary,
  GitHubAuthState,
  GitHubUser,
  GithubRecommendationPage,
  GithubRecommendationResponse,
  ReadmeFetchSummary,
  ReadingStatus,
  RepositoryAnnotationView,
  RepositoryDetailView,
  RepositoryFilters,
  RepositoryListItem,
  RepositoryListPage,
  StarSyncSummary,
  TagItem,
  TaskProgressEvent,
} from '@/types';

const initialAuthState: GitHubAuthState = {
  hasToken: false,
  user: null,
};

const REPOSITORY_PAGE_SIZE = 5000;

const emptyRepositoryPage: RepositoryListPage = {
  items: [],
  totalCount: 0,
  limit: REPOSITORY_PAGE_SIZE,
  offset: 0,
};

class ReadmePostProcessWarning extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadmePostProcessWarning';
  }
}

type RepositoryAiStreamState = {
  requestId: string;
  repositoryId: string;
  stage: string;
  status: string;
  message: string | null;
  text: string;
  startedAt: string;
  updatedAt: string;
};

export function useStarsWorkspace() {
  const repositoryLoadSequence = useRef(0);
  const annotationLoadSequence = useRef(0);
  const selectedRepositoryIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [authState, setAuthState] = useState<GitHubAuthState>(initialAuthState);
  const [token, setToken] = useState('');
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [isClearingToken, setIsClearingToken] = useState(false);
  const [isClearingLocalData, setIsClearingLocalData] = useState(false);
  const [isSyncingStars, setIsSyncingStars] = useState(false);
  const [isFetchingReadmes, setIsFetchingReadmes] = useState(false);
  const [isExportingAnnotations, setIsExportingAnnotations] = useState(false);
  const [isImportingAnnotations, setIsImportingAnnotations] = useState(false);
  const [isExportingRepositoryLibrary, setIsExportingRepositoryLibrary] = useState(false);
  const [isImportingRepositoryLibrary, setIsImportingRepositoryLibrary] = useState(false);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isLoadingAnnotation, setIsLoadingAnnotation] = useState(false);
  const [isLoadingRepositoryDetail, setIsLoadingRepositoryDetail] = useState(false);
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [isFetchingRepositoryReadme, setIsFetchingRepositoryReadme] = useState(false);
  const [isGeneratingAiDocument, setIsGeneratingAiDocument] = useState(false);
  const [isBatchGeneratingAiDocuments, setIsBatchGeneratingAiDocuments] = useState(false);
  const [isGeneratingTagNetwork, setIsGeneratingTagNetwork] = useState(false);
  const [isFindingSimilarRepositories, setIsFindingSimilarRepositories] = useState(false);
  const [isStarringRecommendationCandidate, setIsStarringRecommendationCandidate] = useState(false);
  const [batchAiSummary, setBatchAiSummary] = useState<BatchAiDocumentSummary | null>(null);
  const [githubRecommendationResponse, setGithubRecommendationResponse] = useState<GithubRecommendationResponse | null>(null);
  const [githubRecommendationError, setGithubRecommendationError] = useState<string | null>(null);
  const [lastGithubRecommendationRepositoryIds, setLastGithubRecommendationRepositoryIds] = useState<string[]>([]);
  const [lastStarRecommendationCandidateFullName, setLastStarRecommendationCandidateFullName] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<StarSyncSummary | null>(null);
  const [readmeSummary, setReadmeSummary] = useState<ReadmeFetchSummary | null>(null);
  const [repositoryPage, setRepositoryPage] = useState<RepositoryListPage | null>(null);
  const [repositoryLanguages, setRepositoryLanguages] = useState<string[]>([]);
  const [repositoryFilters, setRepositoryFilters] = useState<RepositoryFilters>(emptyRepositoryFilters);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [annotation, setAnnotation] = useState<RepositoryAnnotationView | null>(null);
  const [repositoryDetail, setRepositoryDetail] = useState<RepositoryDetailView | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [readingStatusDraft, setReadingStatusDraft] = useState<ReadingStatus>('unread');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#f5f5f5');
  const [gistIdDraft, setGistIdDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [annotationMessage, setAnnotationMessage] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressEvent | null>(null);
  const [repositoryAiStream, setRepositoryAiStream] = useState<RepositoryAiStreamState | null>(null);
  const [repositoryReadmeError, setRepositoryReadmeError] = useState<{ repositoryId: string; message: string } | null>(null);
  const [repositoryAiError, setRepositoryAiError] = useState<{ repositoryId: string; message: string } | null>(null);
  const [isRetryingAiSearch, setIsRetryingAiSearch] = useState(false);
  const lastAiSearchRetryRef = useRef<(() => Promise<void>) | null>(null);

  const selectedRepository = useMemo(
    () => repositoryPage?.items.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositoryPage, selectedRepositoryId],
  );
  const repositoryStats = useMemo(() => getRepositoryStats(repositoryPage), [repositoryPage]);

  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenAiStream: (() => void) | null = null;
    void listen<TaskProgressEvent>('task-progress', (event) => {
      setTaskProgress(event.payload);
    }).then((nextUnlisten) => {
      unlistenProgress = nextUnlisten;
    });
    void listen<AiStreamEvent>('ai-stream', (event) => {
      const payload = event.payload;
      if (payload.taskType !== 'repository-ai-document' || !payload.repositoryId) {
        return;
      }
      const repositoryId = payload.repositoryId;
      setRepositoryAiStream((current) => {
        if (current && current.requestId !== payload.requestId) {
          return current;
        }
        if (!current && selectedRepositoryIdRef.current !== repositoryId) {
          return current;
        }
        const startedAt = current?.startedAt ?? payload.createdAt;
        return {
          requestId: payload.requestId,
          repositoryId,
          stage: payload.stage,
          status: payload.status,
          message: payload.message ?? current?.message ?? null,
          text: payload.text ?? current?.text ?? '',
          startedAt,
          updatedAt: payload.createdAt,
        };
      });
    }).then((nextUnlisten) => {
      unlistenAiStream = nextUnlisten;
    });

    invoke<BackendStatus>('get_backend_status')
      .then(setStatus)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));

    invoke<GitHubAuthState>('get_github_auth_state')
      .then(setAuthState)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
      .finally(() => setIsLoadingAuth(false));

    loadRepositories(emptyRepositoryFilters);
    loadRepositoryLanguages();

    return () => {
      unlistenProgress?.();
      unlistenAiStream?.();
    };
  }, []);

  useEffect(() => {
    if (taskProgress?.status !== 'succeeded') {
      return undefined;
    }

    const completedProgress = taskProgress;
    const timeoutId = window.setTimeout(() => {
      setTaskProgress((current) => current === completedProgress ? null : current);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
  }, [taskProgress]);

  useEffect(() => {
    selectedRepositoryIdRef.current = selectedRepositoryId;
  }, [selectedRepositoryId]);

  useEffect(() => {
    if (!repositoryPage || repositoryPage.items.length === 0) {
      setSelectedRepositoryId(null);
      return;
    }

    const selectedStillExists = repositoryPage.items.some((repository) => repository.id === selectedRepositoryId);

    if (!selectedStillExists) {
      setSelectedRepositoryId(repositoryPage.items[0].id);
    }
  }, [repositoryPage, selectedRepositoryId]);

  useEffect(() => {
    if (!selectedRepository) {
      annotationLoadSequence.current += 1;
      setAnnotation(null);
      setRepositoryDetail(null);
      setRepositoryAiStream(null);
      setNoteDraft('');
      setReadingStatusDraft('unread');
      return;
    }

    loadAnnotationWorkspace(selectedRepository);
  }, [selectedRepository?.id, selectedRepository?.accountId]);

  useEffect(() => {
    void refreshRepositoryWorkspace();
  }, [authState.user?.id]);

  async function loadRepositories(nextFilters = repositoryFilters, accountIdOverride?: string) {
    const requestId = ++repositoryLoadSequence.current;
    setIsLoadingRepositories(true);
    const accountId = accountIdOverride ?? (authState.user ? String(authState.user.id) : undefined);

    if (!accountId) {
      if (requestId === repositoryLoadSequence.current) {
        setRepositoryPage(emptyRepositoryPage);
        setIsLoadingRepositories(false);
      }
      return;
    }

    try {
      let page = await loadRepositoryPage(accountId, nextFilters, 0);
      if (requestId === repositoryLoadSequence.current) {
        setRepositoryPage(page);
      }

      let nextOffset = page.offset + page.items.length;
      while (
        requestId === repositoryLoadSequence.current &&
        page.items.length > 0 &&
        nextOffset < page.totalCount
      ) {
        const nextPage = await loadRepositoryPage(accountId, nextFilters, nextOffset);
        if (requestId !== repositoryLoadSequence.current) {
          return;
        }
        if (nextPage.items.length === 0) {
          break;
        }
        page = {
          ...nextPage,
          items: [...page.items, ...nextPage.items],
          limit: REPOSITORY_PAGE_SIZE,
          offset: 0,
        };
        setRepositoryPage(page);
        nextOffset += nextPage.items.length;
      }
    } catch (reason) {
      if (requestId === repositoryLoadSequence.current) {
        setError(toErrorMessage(reason));
      }
    } finally {
      if (requestId === repositoryLoadSequence.current) {
        setIsLoadingRepositories(false);
      }
    }
  }

  async function loadRepositoryPage(accountId: string, filters: RepositoryFilters, offset: number) {
    return invoke<RepositoryListPage>('list_repositories', {
      request: {
        limit: REPOSITORY_PAGE_SIZE,
        offset,
        accountId,
        keyword: optionalRequestText(filters.keyword),
        language: optionalRequestText(filters.language),
        tagId: optionalRequestText(filters.tagId),
      },
    });
  }

  async function loadRepositoryLanguages(accountIdOverride?: string) {
    try {
      const accountId = accountIdOverride ?? (authState.user ? String(authState.user.id) : undefined);
      if (!accountId) {
        setRepositoryLanguages([]);
        return;
      }
      const languages = await invoke<string[]>(
        'list_repository_languages',
        { request: { accountId } },
      );
      setRepositoryLanguages(languages);
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }

  async function loadTags(accountId = authState.user ? String(authState.user.id) : undefined) {
    try {
      if (!accountId) {
        setTags([]);
        return;
      }

      const nextTags = await invoke<TagItem[]>('list_tags', { request: { accountId } });
      setTags(nextTags);
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }

  async function applyRepositoryFilters(nextFilters: RepositoryFilters) {
    setRepositoryFilters(nextFilters);
    await loadRepositories(nextFilters);
  }

  async function resetRepositoryFilters() {
    setRepositoryFilters(emptyRepositoryFilters);
    await loadRepositories(emptyRepositoryFilters);
  }

  async function refreshRepositoryWorkspace(accountIdOverride?: string) {
    await Promise.all([
      loadRepositories(repositoryFilters, accountIdOverride),
      loadRepositoryLanguages(accountIdOverride),
      loadTags(accountIdOverride),
      loadGithubRecommendationCandidates(accountIdOverride),
    ]);
  }

  async function loadGithubRecommendationCandidates(accountId = authState.user ? String(authState.user.id) : undefined) {
    if (!accountId) {
      setGithubRecommendationResponse(null);
      setGithubRecommendationError(null);
      return;
    }

    try {
      const page = await invoke<GithubRecommendationPage>('list_github_recommendation_candidates', {
        request: {
          accountId,
          limit: 12,
          offset: 0,
        },
      });
      setGithubRecommendationResponse(page.results.length > 0 ? {
        rationaleZh: page.rationaleZh,
        queries: page.queries,
        searchFailures: [],
        results: page.results,
      } : null);
      setGithubRecommendationError(null);
    } catch (reason) {
      setGithubRecommendationError(`推荐候选恢复失败：${toErrorMessage(reason)}`);
    }
  }

  function refreshRepositoryWorkspaceInBackground(accountId: string) {
    void refreshRepositoryWorkspace(accountId).catch((reason) => {
      setError(`GitHub 已连接，但本地数据刷新失败：${toErrorMessage(reason)}`);
    });
  }

  function setAiSearchRetryAction(action: (() => Promise<void>) | null) {
    lastAiSearchRetryRef.current = action;
  }

  async function retryLastAiSearch() {
    const action = lastAiSearchRetryRef.current;
    if (!action) {
      throw new Error('没有可重试的 AI 搜索。');
    }

    setIsRetryingAiSearch(true);
    try {
      await action();
    } finally {
      setIsRetryingAiSearch(false);
    }
  }

  async function loadAnnotationWorkspace(repository: RepositoryListItem) {
    const requestId = ++annotationLoadSequence.current;
    setIsLoadingAnnotation(true);
    setIsLoadingRepositoryDetail(true);
    setAnnotationMessage(null);

    try {
      const [nextTags, nextAnnotation, nextRepositoryDetail] = await Promise.all([
        invoke<TagItem[]>('list_tags', { request: { accountId: repository.accountId } }),
        invoke<RepositoryAnnotationView>('get_repository_annotation', {
          request: { repositoryId: repository.id, accountId: repository.accountId },
        }),
        invoke<RepositoryDetailView>('get_repository_detail', {
          request: { repositoryId: repository.id, accountId: repository.accountId },
        }),
      ]);
      if (requestId === annotationLoadSequence.current) {
        setTags(nextTags);
        setAnnotation(nextAnnotation);
        setRepositoryDetail(nextRepositoryDetail);
        setNoteDraft(nextAnnotation.noteMarkdown);
        setReadingStatusDraft(nextAnnotation.readingStatus);
      }
    } catch (reason) {
      if (requestId === annotationLoadSequence.current) {
        setError(toErrorMessage(reason));
      }
    } finally {
      if (requestId === annotationLoadSequence.current) {
        setIsLoadingAnnotation(false);
        setIsLoadingRepositoryDetail(false);
      }
    }
  }

  async function handleSaveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingToken(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'connect-github',
      'auth',
      '正在验证 GitHub Token',
      null,
      'auth',
    ));

    try {
      const user = await invoke<GitHubUser>('save_github_token', { token });
      setAuthState({ hasToken: true, user });
      setToken('');
      refreshRepositoryWorkspaceInBackground(String(user.id));
      setAuthMessage('GitHub 账号已连接，可以同步 Stars。');
      setTaskProgress(buildSucceededTaskProgress('connect-github', 'auth', `GitHub 账号 @${user.login} 已连接。`));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('connect-github', 'auth', message));
    } finally {
      setIsSavingToken(false);
    }
  }

  /**
   * 直接用传入的 token 连接 GitHub，绕过 React state 异步更新问题。
   * 用于 WelcomeFlow 等需要立即用 token 调 invoke 的场景。
   */
  async function connectWithToken(rawToken: string) {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      const message = '请输入 GitHub Personal Access Token';
      setError(message);
      throw new Error(message);
    }
    setIsSavingToken(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'connect-github',
      'auth',
      '正在验证 GitHub Token',
      null,
      'auth',
    ));
    try {
      const user = await invoke<GitHubUser>('save_github_token', { token: trimmed });
      setAuthState({ hasToken: true, user });
      setToken('');
      refreshRepositoryWorkspaceInBackground(String(user.id));
      setAuthMessage('GitHub 账号已连接，可以同步 Stars。');
      setTaskProgress(buildSucceededTaskProgress('connect-github', 'auth', `GitHub 账号 @${user.login} 已连接。`));
      return user;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('connect-github', 'auth', message));
      throw reason;
    } finally {
      setIsSavingToken(false);
    }
  }

  async function handleClearToken() {
    setIsClearingToken(true);
    setError(null);
    setAuthMessage(null);

    try {
      await invoke('clear_github_token');
      resetWorkspaceAfterGitHubDisconnect();
      setAuthMessage('GitHub 连接已移除，本地 Star 数据不会被删除。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsClearingToken(false);
    }
  }

  async function handleClearLocalData() {
    setIsClearingLocalData(true);
    setError(null);
    setAuthMessage(null);

    try {
      const failures: string[] = [];
      let didClearToken = false;
      let didClearDatabase = false;

      try {
        await invoke('clear_github_token');
        didClearToken = true;
      } catch (reason) {
        failures.push(`GitHub Token 清理失败：${toErrorMessage(reason)}`);
      }

      try {
        await invoke('clear_local_database');
        didClearDatabase = true;
      } catch (reason) {
        failures.push(`本地数据库清理失败：${toErrorMessage(reason)}`);
      }

      if (didClearToken) {
        setAuthState(initialAuthState);
      }
      setToken('');
      setSyncSummary(null);
      setReadmeSummary(null);
      setBatchAiSummary(null);
      setGithubRecommendationResponse(null);
      setGithubRecommendationError(null);
      setLastGithubRecommendationRepositoryIds([]);

      if (didClearDatabase) {
        setRepositoryPage(emptyRepositoryPage);
        setRepositoryLanguages([]);
        setRepositoryFilters(emptyRepositoryFilters);
        setSelectedRepositoryId(null);
        setTags([]);
        setAnnotation(null);
        setRepositoryDetail(null);
        setNoteDraft('');
        setReadingStatusDraft('unread');
        setGistIdDraft('');
        setRepositoryReadmeError(null);
        setRepositoryAiError(null);
      }

      if (failures.length > 0) {
        throw new Error(failures.join('；'));
      }

      setAuthMessage('本机数据已清空，应用已回到新安装状态。');
      setTaskProgress(buildSucceededTaskProgress('clear-local-data', 'storage', '本机数据已清空。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(`本机数据清空失败：${message}`);
      setTaskProgress(buildFailedTaskProgress('clear-local-data', 'storage', message));
      throw reason;
    } finally {
      setIsClearingLocalData(false);
    }
  }

  async function handleSyncStars(options?: { throwOnError?: boolean }) {
    setIsSyncingStars(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress('sync-stars', 'sync', '正在准备同步 GitHub Stars'));

    try {
      const summary = await invoke<StarSyncSummary>('sync_github_stars');
      setSyncSummary(summary);
      setReadmeSummary(null);
      await refreshRepositoryWorkspace();
      setAuthMessage(
        `同步完成：当前 ${summary.activeCount} 个，新增 ${summary.createdCount} 个，更新 ${summary.updatedCount} 个，移除 ${summary.removedCount} 个，扫描 ${summary.scannedCount} 个。`,
      );
    } catch (reason) {
      const message = toErrorMessage(reason);
      const displayMessage = `同步未完成：${message}。本地已有数据不会被删除，可检查网络或 Token 后重试。`;
      setError(displayMessage);
      setTaskProgress(buildFailedTaskProgress('sync-stars', 'sync', displayMessage));
      if (isGitHubConnectionUnavailableError(message)) {
        resetWorkspaceAfterGitHubDisconnect();
        setAuthMessage('GitHub Token 已失效，已断开连接。请重新连接账号后再同步。');
      } else {
        await refreshRepositoryWorkspace();
      }
      if (options?.throwOnError) {
        throw new Error(displayMessage);
      }
    } finally {
      setIsSyncingStars(false);
    }
  }

  function resetWorkspaceAfterGitHubDisconnect() {
    setAuthState(initialAuthState);
    setToken('');
    setSyncSummary(null);
    setReadmeSummary(null);
    setBatchAiSummary(null);
    setGithubRecommendationResponse(null);
    setGithubRecommendationError(null);
    setLastGithubRecommendationRepositoryIds([]);
    setRepositoryPage(emptyRepositoryPage);
    setRepositoryLanguages([]);
    setRepositoryFilters(emptyRepositoryFilters);
    setSelectedRepositoryId(null);
    setTags([]);
    setAnnotation(null);
    setRepositoryDetail(null);
    setNoteDraft('');
    setReadingStatusDraft('unread');
    setGistIdDraft('');
    setRepositoryReadmeError(null);
    setRepositoryAiError(null);
  }

  function handleGitHubCredentialFailure(message: string) {
    if (!isGitHubConnectionUnavailableError(message)) {
      return false;
    }

    resetWorkspaceAfterGitHubDisconnect();
    setAuthMessage('GitHub Token 已失效，已断开连接。请重新连接账号后再继续。');
    return true;
  }

  async function handleFetchReadmes(options?: {
    aiConfig?: AISettings;
    autoGenerateAi?: boolean;
    aiLimit?: number;
    onlyMissing?: boolean;
    repositoryIds?: string[];
    throwOnFailure?: boolean;
  }) {
    setIsFetchingReadmes(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress('fetch-readmes', 'readme', '正在准备抓取并解析 README'));

    try {
      const summary = await invoke<ReadmeFetchSummary>('fetch_repository_readmes', {
        request: {
          onlyMissing: options?.onlyMissing ?? true,
          repositoryIds: options?.repositoryIds,
        },
      });
      setReadmeSummary(summary);
      await refreshRepositoryWorkspace();
      const readmeMessage = `README 已处理 ${summary.totalCount} 个仓库：更新 ${summary.fetchedCount}，跳过 ${summary.skippedCount}，缺失 ${summary.missingCount}，失败 ${summary.failedCount}。`;
      setAuthMessage(readmeMessage);
      const readmeFailureMessage = buildReadmeFailureMessage(summary);
      if (readmeFailureMessage) {
        setError(readmeFailureMessage);
        setTaskProgress(buildPartialTaskProgress(
          'fetch-readmes',
          'readme',
          readmeFailureMessage,
          summary.totalCount,
        ));
        if (options?.throwOnFailure) {
          throw new ReadmePostProcessWarning(readmeFailureMessage);
        }
      }

      if (options?.autoGenerateAi) {
        const aiConfig = options.aiConfig;
        if (!aiConfig) {
          const message = '请先在设置中配置 AI 服务。';
          const warningMessage = `README 已缓存，但 AI 分析未启动：${message}`;
          setError(message);
          setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', message));
          setAuthMessage(`${readmeMessage} AI 分析未启动：${message}`);
          if (options.throwOnFailure) {
            throw new ReadmePostProcessWarning(warningMessage);
          }
          return summary;
        }

        const aiConfigMessage = getAiConfigMessage(aiConfig);
        if (aiConfigMessage) {
          const warningMessage = `README 已缓存，但 AI 分析未启动：${aiConfigMessage}`;
          setError(aiConfigMessage);
          setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', aiConfigMessage));
          setAuthMessage(`${readmeMessage} AI 分析未启动：${aiConfigMessage}`);
          if (options.throwOnFailure) {
            throw new ReadmePostProcessWarning(warningMessage);
          }
          return summary;
        }

        try {
          await handleBatchGenerateAiDocuments(aiConfig, {
            limit: options.aiLimit,
            onlyMissing: options.onlyMissing ?? true,
            repositoryIds: options.repositoryIds,
          });
        } catch (reason) {
          const message = toErrorMessage(reason);
          const warningMessage = `README 已缓存，但 AI 分析失败：${message}`;
          setError(warningMessage);
          setAuthMessage(`${readmeMessage} AI 分析失败：${message}`);
          if (options.throwOnFailure) {
            throw new ReadmePostProcessWarning(warningMessage);
          }
        }
      }

      return summary;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      if (!(reason instanceof ReadmePostProcessWarning)) {
        setTaskProgress(buildFailedTaskProgress('fetch-readmes', 'readme', message));
      }
      handleGitHubCredentialFailure(message);
      if (options?.throwOnFailure) {
        throw new Error(message);
      }
      return null;
    } finally {
      setIsFetchingReadmes(false);
    }
  }

  async function handleExportAnnotations() {
    setIsExportingAnnotations(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'export-annotation-gist',
      'backup',
      '正在导出注解到 GitHub Gist',
      'GitHub Gist',
      'save',
    ));

    try {
      const summary = await invoke<GistAnnotationExportSummary>('export_annotation_gist');
      setGistIdDraft(summary.gistId);
      setAuthMessage(`注解已导出到 Gist ${summary.gistId}：${summary.tagCount} 个标签，${summary.repositoryCount} 条仓库注解。`);
      setTaskProgress(buildSucceededTaskProgress('export-annotation-gist', 'backup', '注解已导出到 GitHub Gist。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('export-annotation-gist', 'backup', message, 'GitHub Gist'));
      handleGitHubCredentialFailure(message);
    } finally {
      setIsExportingAnnotations(false);
    }
  }

  async function handleExportRepositoryLibrary() {
    setIsExportingRepositoryLibrary(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'export-repository-library-gist',
      'backup',
      '正在导出所有仓库到 GitHub Gist',
      'GitHub Gist',
      'save',
    ));

    try {
      const summary = await invoke<GistRepositoryLibraryExportSummary>('export_repository_library_gist');
      setGistIdDraft(summary.gistId);
      setAuthMessage(`仓库清单已导出到 Gist ${summary.gistId}：${summary.repositoryCount} 个仓库，${summary.tagCount} 个标签。`);
      setTaskProgress(buildSucceededTaskProgress('export-repository-library-gist', 'backup', '所有仓库已导出到 GitHub Gist。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('export-repository-library-gist', 'backup', message, 'GitHub Gist'));
      handleGitHubCredentialFailure(message);
    } finally {
      setIsExportingRepositoryLibrary(false);
    }
  }

  async function handleImportAnnotations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runImportAnnotations();
  }

  async function runImportAnnotations() {
    const gistId = gistIdDraft.trim();

    if (!gistId) {
      const message = '请输入 Gist ID 后再导入。';
      setError(message);
      setAuthMessage(null);
      setTaskProgress(buildFailedTaskProgress('import-annotation-gist', 'backup', message, 'GitHub Gist'));
      return;
    }

    setIsImportingAnnotations(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'import-annotation-gist',
      'backup',
      '正在从 GitHub Gist 导入注解',
      `Gist ${gistId}`,
      'fetch',
    ));

    try {
      const summary = await invoke<GistAnnotationImportSummary>('import_annotation_gist', {
        request: { gistId },
      });
      await refreshRepositoryWorkspace();
      if (selectedRepository) {
        await loadAnnotationWorkspace(selectedRepository);
      }
      setAuthMessage(
        `注解已导入：${summary.tagCount} 个标签，${summary.repositoryCount} 条仓库注解，跳过 ${summary.skippedRepositoryCount} 条本地不存在或已取消 Star 的仓库。`,
      );
      setTaskProgress(buildSucceededTaskProgress('import-annotation-gist', 'backup', '注解已从 GitHub Gist 导入。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('import-annotation-gist', 'backup', message, `Gist ${gistId}`));
      handleGitHubCredentialFailure(message);
    } finally {
      setIsImportingAnnotations(false);
    }
  }

  async function handleImportRepositoryLibrary(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const gistId = gistIdDraft.trim();

    if (!gistId) {
      const message = '请输入 Gist ID 后再导入。';
      setError(message);
      setAuthMessage(null);
      setTaskProgress(buildFailedTaskProgress('import-repository-library-gist', 'backup', message, 'GitHub Gist'));
      return;
    }

    setIsImportingRepositoryLibrary(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'import-repository-library-gist',
      'backup',
      '正在从 GitHub Gist 导入所有仓库',
      `Gist ${gistId}`,
      'fetch',
    ));

    try {
      const summary = await invoke<GistRepositoryLibraryImportSummary>('import_repository_library_gist', {
        request: { gistId },
      });
      await refreshRepositoryWorkspace();
      if (selectedRepository) {
        await loadAnnotationWorkspace(selectedRepository);
      }
      setAuthMessage(
        `仓库清单已导入：新增 ${summary.createdRepositoryCount} 个仓库，更新 ${summary.updatedRepositoryCount} 个仓库，恢复 ${summary.tagCount} 个标签。`,
      );
      setTaskProgress(buildSucceededTaskProgress('import-repository-library-gist', 'backup', '所有仓库已从 GitHub Gist 导入。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('import-repository-library-gist', 'backup', message, `Gist ${gistId}`));
      handleGitHubCredentialFailure(message);
    } finally {
      setIsImportingRepositoryLibrary(false);
    }
  }

  async function handleCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedRepository || newTagName.trim().length === 0) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      const createdTag = await invoke<TagItem>('create_tag', {
        request: {
          accountId: selectedRepository.accountId,
          name: newTagName,
          color: newTagColor,
        },
      });
      const currentTagIds = new Set(annotation?.tags.map((item) => item.id) ?? []);
      currentTagIds.add(createdTag.id);
      const nextAnnotation = await invoke<RepositoryAnnotationView>('set_repository_tags', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          tagIds: Array.from(currentTagIds),
        },
      });
      setTags((currentTags) => {
        const withoutDuplicate = currentTags.filter((tag) => tag.id !== createdTag.id);
        return [...withoutDuplicate, createdTag].sort((left, right) => left.name.localeCompare(right.name));
      });
      setAnnotation(nextAnnotation);
      await loadRepositories(repositoryFilters);
      setNewTagName('');
      setAnnotationMessage(`标签"${createdTag.name}"已创建并应用到当前仓库。`);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleRenameTag(tag: TagItem, nextName: string) {
    if (!selectedRepository) {
      return;
    }

    const normalizedName = nextName.trim();

    if (!normalizedName || normalizedName === tag.name) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      const nextTag = await invoke<TagItem>('update_tag', {
        request: {
          accountId: selectedRepository.accountId,
          tagId: tag.id,
          name: normalizedName,
          color: tag.color,
        },
      });
      setTags((currentTags) => currentTags.map((item) => (item.id === nextTag.id ? nextTag : item)));
      setAnnotation((currentAnnotation) =>
        currentAnnotation
          ? {
              ...currentAnnotation,
              tags: currentAnnotation.tags.map((item) => (item.id === nextTag.id ? nextTag : item)),
            }
          : currentAnnotation,
      );
      await loadRepositories(repositoryFilters);
      setAnnotationMessage('标签已重命名。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleDeleteTag(tag: TagItem) {
    if (!selectedRepository) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      await invoke('delete_tag', {
        request: {
          accountId: selectedRepository.accountId,
          tagId: tag.id,
        },
      });
      setTags((currentTags) => currentTags.filter((item) => item.id !== tag.id));
      if (repositoryFilters.tagId === tag.id) {
        await resetRepositoryFilters();
      } else {
        await loadRepositories(repositoryFilters);
      }
      setAnnotation((currentAnnotation) =>
        currentAnnotation
          ? { ...currentAnnotation, tags: currentAnnotation.tags.filter((item) => item.id !== tag.id) }
          : currentAnnotation,
      );
      setAnnotationMessage('标签已删除。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleToggleRepositoryTag(tag: TagItem) {
    if (!selectedRepository || !annotation) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    const currentTagIds = new Set(annotation.tags.map((item) => item.id));

    if (currentTagIds.has(tag.id)) {
      currentTagIds.delete(tag.id);
    } else {
      currentTagIds.add(tag.id);
    }

    try {
      const nextAnnotation = await invoke<RepositoryAnnotationView>('set_repository_tags', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          tagIds: Array.from(currentTagIds),
        },
      });
      setAnnotation(nextAnnotation);
      await loadRepositories(repositoryFilters);
      setAnnotationMessage('仓库标签已更新。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleApplySuggestedTag(tagName: string) {
    if (!selectedRepository || !annotation) {
      return;
    }

    const normalizedTagName = tagName.trim();
    if (!normalizedTagName) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      let targetTag = tags.find((tag) => tag.name.toLowerCase() === normalizedTagName.toLowerCase()) ?? null;

      if (!targetTag) {
        const createdTag = await invoke<TagItem>('create_tag', {
          request: {
            accountId: selectedRepository.accountId,
            name: normalizedTagName,
            color: getSuggestedTagColor(normalizedTagName),
          },
        });
        targetTag = createdTag;
        setTags((currentTags) => [...currentTags, createdTag].sort((left, right) => left.name.localeCompare(right.name)));
      }

      const currentTagIds = new Set(annotation.tags.map((item) => item.id));
      if (currentTagIds.has(targetTag.id)) {
        setAnnotationMessage(`标签"${targetTag.name}"已应用到当前仓库。`);
        return;
      }

      currentTagIds.add(targetTag.id);
      const nextAnnotation = await invoke<RepositoryAnnotationView>('set_repository_tags', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          tagIds: Array.from(currentTagIds),
        },
      });
      setAnnotation(nextAnnotation);
      await loadRepositories(repositoryFilters);
      setAnnotationMessage(`标签"${targetTag.name}"已应用到当前仓库。`);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleSaveAnnotation() {
    if (!selectedRepository) {
      return;
    }

    setIsSavingAnnotation(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      const nextAnnotation = await invoke<RepositoryAnnotationView>('save_repository_annotation', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          noteMarkdown: noteDraft,
          readingStatus: readingStatusDraft,
        },
      });
      setAnnotation(nextAnnotation);
      setNoteDraft(nextAnnotation.noteMarkdown);
      setReadingStatusDraft(nextAnnotation.readingStatus);
      await loadRepositories(repositoryFilters);
      setAnnotationMessage('笔记和阅读状态已保存。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingAnnotation(false);
    }
  }

  async function handleFetchRepositoryReadme() {
    if (!selectedRepository) {
      return;
    }

    setIsFetchingRepositoryReadme(true);
    setError(null);
    setRepositoryReadmeError(null);
    setAnnotationMessage(null);
    setTaskProgress(buildRunningTaskProgress(
      'fetch-repository-readme',
      'readme',
      `正在准备抓取 ${selectedRepository.fullName} 的 README`,
      selectedRepository.fullName,
    ));

    try {
      const nextRepositoryDetail = await invoke<RepositoryDetailView>('fetch_repository_readme', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
        },
      });
      setRepositoryDetail(nextRepositoryDetail);
      await refreshRepositoryWorkspace();
      setRepositoryReadmeError(null);
      setAnnotationMessage('README 已缓存。');
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setRepositoryReadmeError({ repositoryId: selectedRepository.id, message });
      setTaskProgress(buildFailedTaskProgress('fetch-repository-readme', 'readme', message, selectedRepository.fullName));
      handleGitHubCredentialFailure(message);
      throw reason;
    } finally {
      setIsFetchingRepositoryReadme(false);
    }
  }

  async function handleGenerateAiDocument(aiConfig: AISettings) {
    if (!selectedRepository) {
      return;
    }

    const aiConfigMessage = getAiConfigMessage(aiConfig);
    if (aiConfigMessage) {
      setError(aiConfigMessage);
      setRepositoryAiError({ repositoryId: selectedRepository.id, message: aiConfigMessage });
      setTaskProgress(buildFailedTaskProgress('generate-ai-document', 'ai', aiConfigMessage, selectedRepository.fullName));
      throw new Error(aiConfigMessage);
    }

    setIsGeneratingAiDocument(true);
    setError(null);
    setRepositoryAiError(null);
    setAnnotationMessage(null);
    const requestId = `repository-ai-${selectedRepository.id}-${Date.now()}`;
    const now = new Date().toISOString();
    setRepositoryAiStream({
      requestId,
      repositoryId: selectedRepository.id,
      stage: 'prepare',
      status: 'started',
      message: `正在准备解析 ${selectedRepository.fullName}`,
      text: '',
      startedAt: now,
      updatedAt: now,
    });
    setTaskProgress(buildRunningTaskProgress(
      'generate-ai-document',
      'ai',
      `正在准备解析 ${selectedRepository.fullName}`,
      selectedRepository.fullName,
    ));

    try {
      const nextRepositoryDetail = await invoke<RepositoryDetailView>('generate_repository_ai_document', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          aiConfig: toBackendAiRequestConfig(aiConfig),
          requestId,
        },
      });
      setRepositoryDetail(nextRepositoryDetail);
      await refreshRepositoryWorkspace();
      setRepositoryAiError(null);
      setRepositoryAiStream((current) => current?.requestId === requestId
        ? { ...current, status: 'finished', stage: 'done', message: 'AI 解析已生成。', updatedAt: new Date().toISOString() }
        : current);
      setAnnotationMessage('AI 摘要已生成。');
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setRepositoryAiError({ repositoryId: selectedRepository.id, message });
      setRepositoryAiStream((current) => current?.requestId === requestId
        ? { ...current, status: 'failed', stage: 'error', message, updatedAt: new Date().toISOString() }
        : current);
      setTaskProgress(buildFailedTaskProgress('generate-ai-document', 'ai', message, selectedRepository.fullName));
      handleGitHubCredentialFailure(message);
      throw reason;
    } finally {
      setIsGeneratingAiDocument(false);
    }
  }

  async function handleBatchGenerateAiDocuments(aiConfig: AISettings, options?: { limit?: number; onlyMissing?: boolean; repositoryIds?: string[] }) {
    const aiConfigMessage = getAiConfigMessage(aiConfig);
    if (aiConfigMessage) {
      setError(aiConfigMessage);
      setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', aiConfigMessage));
      throw new Error(aiConfigMessage);
    }

    setIsBatchGeneratingAiDocuments(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress('batch-generate-ai-documents', 'ai', '正在准备批量解析 README'));

    try {
      const summary = await invoke<BatchAiDocumentSummary>('batch_generate_repository_ai_documents', {
        request: {
          aiConfig: toBackendAiRequestConfig(aiConfig),
          limit: options?.limit,
          onlyMissing: options?.onlyMissing ?? true,
          repositoryIds: options?.repositoryIds,
        },
      });
      setBatchAiSummary(summary);
      await refreshRepositoryWorkspace();
      if (selectedRepository) {
        await loadAnnotationWorkspace(selectedRepository);
      }
      setAuthMessage(
        `AI 批量处理完成：生成 ${summary.generatedCount} 个，跳过 ${summary.skippedCount} 个，缺少 README ${summary.missingReadmeCount} 个，失败 ${summary.failedCount} 个。`,
      );
      const batchAiFailureMessage = buildBatchAiFailureMessage(summary);
      if (batchAiFailureMessage) {
        setError(batchAiFailureMessage);
        setTaskProgress(buildPartialTaskProgress(
          'batch-generate-ai-documents',
          'ai',
          batchAiFailureMessage,
          summary.totalCount,
        ));
      }
      return summary;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', message));
      handleGitHubCredentialFailure(message);
      throw reason;
    } finally {
      setIsBatchGeneratingAiDocuments(false);
    }
  }

  async function handleGenerateAiTagNetwork(aiConfig: AISettings) {
    const accountId = authState.user ? String(authState.user.id) : null;
    if (!accountId) {
      const message = '请先在设置中连接 GitHub 账号。';
      setError(message);
      setTaskProgress(buildFailedTaskProgress('generate-ai-tag-network', 'ai', message));
      throw new Error(message);
    }

    const aiConfigMessage = getAiConfigMessage(aiConfig);
    if (aiConfigMessage) {
      setError(aiConfigMessage);
      setTaskProgress(buildFailedTaskProgress('generate-ai-tag-network', 'ai', aiConfigMessage));
      throw new Error(aiConfigMessage);
    }

    setIsGeneratingTagNetwork(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress('generate-ai-tag-network', 'ai', '正在准备 AI 标签网络生成任务'));

    try {
      const summary = await invoke<AiTagNetworkSummary>('generate_ai_tag_network', {
        request: {
          accountId,
          aiConfig: toBackendAiRequestConfig(aiConfig),
        },
      });
      await refreshRepositoryWorkspace();
      const partialFailureMessage = summary.failedBatchCount > 0
        ? `其中 ${summary.failedBatchCount} 个批次失败，已保留成功生成的标签关联，可稍后重试补全。`
        : '';
      setAuthMessage(`AI 标签网络已生成：${summary.tagCount} 个标签，${summary.linkedCount} 条仓库关联。${partialFailureMessage}`);
      return summary;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('generate-ai-tag-network', 'ai', message));
      handleGitHubCredentialFailure(message);
      throw reason;
    } finally {
      setIsGeneratingTagNetwork(false);
    }
  }

  async function handleFindSimilarRepositories(aiConfig: AISettings, repositoryIds: string[], options?: { limit?: number }) {
    const accountId = authState.user ? String(authState.user.id) : null;
    const selectedRepositoryIds = repositoryIds.slice(0, 8);
    if (!accountId) {
      const message = '请先连接 GitHub 账号。';
      setGithubRecommendationError(message);
      setTaskProgress(buildFailedTaskProgress('recommend-github-repositories', 'ai', message));
      throw new Error(message);
    }
    if (selectedRepositoryIds.length === 0) {
      const message = '请先勾选 1 到 8 个仓库作为参考。';
      setGithubRecommendationError(message);
      setTaskProgress(buildFailedTaskProgress('recommend-github-repositories', 'ai', message));
      throw new Error(message);
    }
    setLastGithubRecommendationRepositoryIds(selectedRepositoryIds);

    const aiConfigMessage = getAiConfigMessage(aiConfig);
    if (aiConfigMessage) {
      setGithubRecommendationError(aiConfigMessage);
      setTaskProgress(buildFailedTaskProgress('recommend-github-repositories', 'ai', aiConfigMessage));
      throw new Error(aiConfigMessage);
    }

    setIsFindingSimilarRepositories(true);
    setGithubRecommendationError(null);
    setTaskProgress(buildRunningTaskProgress(
      'recommend-github-repositories',
      'ai',
      `正在根据 ${selectedRepositoryIds.length} 个仓库准备 GitHub 相似发现`,
    ));

    try {
      const response = await invoke<GithubRecommendationResponse>('recommend_github_repositories', {
        request: {
          accountId,
          repositoryIds: selectedRepositoryIds,
          aiConfig: toBackendAiRequestConfig(aiConfig),
          limit: options?.limit ?? 12,
        },
      });
      setGithubRecommendationResponse(response);
      setGithubRecommendationError(null);
      return response;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setGithubRecommendationError(message);
      setTaskProgress(buildFailedTaskProgress('recommend-github-repositories', 'ai', message));
      handleGitHubCredentialFailure(message);
      throw reason;
    } finally {
      setIsFindingSimilarRepositories(false);
    }
  }

  async function handleUpdateRecommendationCandidate(fullName: string, status: 'marked' | 'ignored' | 'new') {
    const accountId = authState.user ? String(authState.user.id) : null;
    if (!accountId) {
      const message = '请先连接 GitHub 账号。';
      setGithubRecommendationError(message);
      throw new Error(message);
    }

    try {
      const candidate = await invoke<{ id: string; fullName: string; status: 'new' | 'marked' | 'ignored' | 'starred' }>(
        'update_github_recommendation_candidate_status',
        {
          request: {
            accountId,
            fullName,
            status,
          },
        },
      );
      setGithubRecommendationResponse((current) => updateRecommendationCandidateState(current, candidate));
      setGithubRecommendationError(null);
    } catch (reason) {
      setGithubRecommendationError(toErrorMessage(reason));
      throw reason;
    }
  }

  async function handleStarRecommendationCandidate(fullName: string) {
    const accountId = authState.user ? String(authState.user.id) : null;
    setLastStarRecommendationCandidateFullName(fullName);
    if (!accountId) {
      const message = '请先连接 GitHub 账号。';
      setGithubRecommendationError(message);
      setTaskProgress(buildFailedTaskProgress('star-github-recommendation-candidate', 'sync', message, fullName));
      throw new Error(message);
    }

    setTaskProgress(buildRunningTaskProgress(
      'star-github-recommendation-candidate',
      'sync',
      `正在加入 ${fullName} 到 GitHub Stars`,
      fullName,
      'github-star',
    ));
    setIsStarringRecommendationCandidate(true);
    let candidate: { id: string; fullName: string; status: 'new' | 'marked' | 'ignored' | 'starred' };
    try {
      candidate = await invoke<{ id: string; fullName: string; status: 'new' | 'marked' | 'ignored' | 'starred' }>(
        'star_github_recommendation_candidate',
        {
          request: {
            accountId,
            fullName,
          },
        },
      );
    } catch (reason) {
      const message = toErrorMessage(reason);
      setGithubRecommendationError(message);
      setTaskProgress(buildFailedTaskProgress('star-github-recommendation-candidate', 'sync', message, fullName));
      handleGitHubCredentialFailure(message);
      throw reason;
    } finally {
      setIsStarringRecommendationCandidate(false);
    }

    setGithubRecommendationResponse((current) => updateRecommendationCandidateState(current, candidate));
    setGithubRecommendationError(null);
    setTaskProgress(buildSucceededTaskProgress(
      'star-github-recommendation-candidate',
      'sync',
      `${candidate.fullName} 已加入 GitHub Stars，正在同步本地数据。`,
    ));
    await handleSyncStars().catch((reason) => {
      const message = `已加入 GitHub Stars，但本地同步暂未完成：${toErrorMessage(reason)}`;
      setError(message);
    });
  }

  return {
    annotation,
    annotationMessage,
    applyRepositoryFilters,
    authMessage,
    authState,
    batchAiSummary,
    connectWithToken,
    error,
    gistIdDraft,
    githubRecommendationError,
    githubRecommendationResponse,
    handleClearToken,
    handleClearLocalData,
    handleCreateTag,
    handleDeleteTag,
    handleExportAnnotations,
    handleExportRepositoryLibrary,
    handleFetchReadmes,
    handleFetchRepositoryReadme,
    handleBatchGenerateAiDocuments,
    handleFindSimilarRepositories,
    handleGenerateAiTagNetwork,
    handleGenerateAiDocument,
    handleApplySuggestedTag,
    handleImportAnnotations,
    handleImportRepositoryLibrary,
    runImportAnnotations,
    handleRenameTag,
    handleSaveAnnotation,
    handleSaveToken,
    handleSyncStars,
    handleStarRecommendationCandidate,
    handleToggleRepositoryTag,
    handleUpdateRecommendationCandidate,
    isClearingToken,
    isClearingLocalData,
    isExportingAnnotations,
    isExportingRepositoryLibrary,
    isFetchingReadmes,
    isFetchingRepositoryReadme,
    isBatchGeneratingAiDocuments,
    isFindingSimilarRepositories,
    isGeneratingAiDocument,
    isGeneratingTagNetwork,
    isImportingAnnotations,
    isImportingRepositoryLibrary,
    isLoadingAuth,
    isLoadingAnnotation,
    isLoadingRepositories,
    isLoadingRepositoryDetail,
    isSavingAnnotation,
    isSavingTag,
    isSavingToken,
    isRetryingAiSearch,
    isStarringRecommendationCandidate,
    isSyncingStars,
    lastGithubRecommendationRepositoryIds,
    lastStarRecommendationCandidateFullName,
    newTagColor,
    newTagName,
    noteDraft,
    readingStatusDraft,
    readmeSummary,
    refreshRepositoryWorkspace,
    repositoryDetail,
    repositoryFilters,
    repositoryAiError,
    repositoryAiStream,
    repositoryReadmeError,
    repositoryLanguages,
    repositoryPage,
    repositoryStats,
    resetRepositoryFilters,
    selectedRepository,
    setGistIdDraft,
    setNewTagColor,
    setNewTagName,
    setNoteDraft,
    setReadingStatusDraft,
    setAiSearchRetryAction,
    setSelectedRepositoryId,
    setToken,
    showTaskProgress: setTaskProgress,
    status,
    syncSummary,
    tags,
    taskProgress,
    token,
    retryLastAiSearch,
  };
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isGitHubConnectionUnavailableError(message: string) {
  return (
    message.includes('请先连接 GitHub 账号')
    || message.includes('Token 无效或权限不足')
    || message.includes('HTTP 401')
  );
}

function updateRecommendationCandidateState(
  current: GithubRecommendationResponse | null,
  candidate: { id: string; fullName: string; status: 'new' | 'marked' | 'ignored' | 'starred' },
) {
  if (!current) {
    return current;
  }

  return {
    ...current,
    results: current.results.map((repository) => repository.fullName === candidate.fullName
      ? {
          ...repository,
          candidateId: candidate.id,
          candidateStatus: candidate.status,
        }
      : repository),
  };
}

function buildReadmeFailureMessage(summary: ReadmeFetchSummary) {
  if (summary.failedCount <= 0) {
    return null;
  }

  const firstFailure = summary.failures[0];
  const firstFailureDetail = firstFailure
    ? `首个失败仓库：${firstFailure.fullName}，原因：${firstFailure.error}`
    : '未返回具体失败仓库。';
  return `README 缓存有 ${summary.failedCount} 个仓库失败，已成功缓存的数据不会回滚。${firstFailureDetail} 请检查网络或 GitHub Token 后重试。`;
}

function buildBatchAiFailureMessage(summary: BatchAiDocumentSummary) {
  if (summary.failedCount <= 0) {
    return null;
  }

  const firstFailure = summary.failures[0];
  const firstFailureDetail = firstFailure
    ? `首个失败仓库：${firstFailure.fullName}，原因：${firstFailure.error}`
    : '未返回具体失败仓库。';
  return `批量 AI 有 ${summary.failedCount} 个仓库失败，已生成的摘要和本地数据不会回滚。${firstFailureDetail} 可稍后重试、降低批量数量，或换用更大上下文模型。`;
}

function buildFailedTaskProgress(
  taskId: string,
  taskType: string,
  message: string,
  repositoryName: string | null = null,
): TaskProgressEvent {
  return {
    taskId,
    taskType,
    status: 'failed',
    stage: 'error',
    current: 0,
    total: 0,
    message,
    repositoryName,
  };
}

function buildPartialTaskProgress(
  taskId: string,
  taskType: string,
  message: string,
  totalCount: number,
): TaskProgressEvent {
  const safeTotal = Math.max(1, totalCount);
  return {
    taskId,
    taskType,
    status: 'partial',
    stage: 'partial-failure',
    current: safeTotal,
    total: safeTotal,
    message,
    repositoryName: null,
  };
}

function buildRunningTaskProgress(
  taskId: string,
  taskType: string,
  message: string,
  repositoryName: string | null = null,
  stage = 'request',
): TaskProgressEvent {
  return {
    taskId,
    taskType,
    status: 'running',
    stage,
    current: 0,
    total: 0,
    message,
    repositoryName,
  };
}

function buildSucceededTaskProgress(taskId: string, taskType: string, message: string): TaskProgressEvent {
  return {
    taskId,
    taskType,
    status: 'succeeded',
    stage: 'done',
    current: 1,
    total: 1,
    message,
    repositoryName: null,
  };
}

function getSuggestedTagColor(tagName: string) {
  const palette = ['#2563eb', '#0f766e', '#9333ea', '#c2410c', '#16a34a', '#be123c', '#0891b2', '#7c3aed'];
  const index = Array.from(tagName).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return palette[index];
}
