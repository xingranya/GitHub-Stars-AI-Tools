import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppLayout } from '@/components/app-layout';
import { WelcomeFlow } from '@/components/welcome-flow';
import { WorkspaceProvider, useWorkspace } from '@/providers/workspace-provider';
import { SettingsProvider, useAppSettings } from '@/providers/settings-provider';
import { shouldFlushAiApiKey } from '@/lib/ai-config';
import type { RepositoryListItem } from '@/types';

const DashboardPage = lazy(() => import('@/pages/dashboard').then((module) => ({ default: module.DashboardPage })));
const RepositoriesPage = lazy(() => import('@/pages/repositories').then((module) => ({ default: module.RepositoriesPage })));
const TagNetworkPage = lazy(() => import('@/pages/tag-network').then((module) => ({ default: module.TagNetworkPage })));
const AISearchPage = lazy(() => import('@/pages/ai-search').then((module) => ({ default: module.AISearchPage })));
const ProfilePage = lazy(() => import('@/pages/profile').then((module) => ({ default: module.ProfilePage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((module) => ({ default: module.SettingsPage })));

type Page = 'dashboard' | 'repositories' | 'tag-network' | 'ai-search' | 'profile' | 'settings';

type RepositoryNavigationState = {
  query: string;
  language: string;
  tagId: string;
  selectedRepositoryId: string | null;
  key: number;
};

function AppContent() {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [showWelcome, setShowWelcome] = useState(false);
  const [hasDismissedWelcome, setHasDismissedWelcome] = useState(false);
  const [repositoryNavigation, setRepositoryNavigation] = useState<RepositoryNavigationState>({
    query: '',
    language: '',
    tagId: '',
    selectedRepositoryId: null,
    key: 0,
  });
  const isWelcomeDecisionPending = settingsHook.isLoading || workspace.isLoadingAuth;
  const shouldShowWelcome = showWelcome || (
    !isWelcomeDecisionPending &&
    !hasDismissedWelcome &&
    !workspace.authState.user &&
    settingsHook.settings.general.showWelcomeOnStartup
  );
  const hasTriggeredAutoSyncRef = useRef(false);
  const autoSyncAccountIdRef = useRef<string | null>(null);
  const isSyncingStarsRef = useRef(false);

  useEffect(() => {
    isSyncingStarsRef.current = workspace.isSyncingStars;
  }, [workspace.isSyncingStars]);

  useEffect(() => {
    function handleExternalLinkClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download')) {
        return;
      }

      const rawHref = anchor.getAttribute('href')?.trim() ?? '';
      const url = anchor.href;
      if (rawHref.startsWith('#') || isSameDocumentHashLink(url)) {
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        return;
      }

      event.preventDefault();
      void invoke('open_external_url', { url }).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    }

    document.addEventListener('click', handleExternalLinkClick);
    return () => document.removeEventListener('click', handleExternalLinkClick);
  }, []);

  // 检查是否需要显示欢迎流程
  useEffect(() => {
    if (isWelcomeDecisionPending || showWelcome || hasDismissedWelcome) {
      return;
    }

    if (!workspace.authState.user && settingsHook.settings.general.showWelcomeOnStartup) {
      setShowWelcome(true);
    }
  }, [isWelcomeDecisionPending, showWelcome, hasDismissedWelcome, workspace.authState.user, settingsHook.settings.general.showWelcomeOnStartup]);

  useEffect(() => {
    const accountId = workspace.authState.user ? String(workspace.authState.user.id) : null;
    if (autoSyncAccountIdRef.current !== accountId) {
      autoSyncAccountIdRef.current = accountId;
      hasTriggeredAutoSyncRef.current = false;
    }

    if (
      settingsHook.isLoading ||
      workspace.isLoadingAuth ||
      shouldShowWelcome ||
      !settingsHook.settings.sync.enableAutoSync ||
      !accountId
    ) {
      return;
    }

    const runAutoSync = () => {
      if (isSyncingStarsRef.current) {
        return;
      }

      void workspace.handleSyncStars();
    };

    if (!hasTriggeredAutoSyncRef.current) {
      hasTriggeredAutoSyncRef.current = true;
      runAutoSync();
    }

    const intervalMinutes = normalizeAutoSyncInterval(settingsHook.settings.sync.autoSyncInterval);
    const timer = window.setInterval(runAutoSync, intervalMinutes * 60_000);

    return () => window.clearInterval(timer);
  }, [
    settingsHook.isLoading,
    settingsHook.settings.sync.enableAutoSync,
    settingsHook.settings.sync.autoSyncInterval,
    workspace.isLoadingAuth,
    workspace.authState.user?.id,
    shouldShowWelcome,
  ]);

  async function handleWelcomeComplete() {
    await settingsHook.updateGeneral({ showWelcomeOnStartup: false });
    setHasDismissedWelcome(true);
    setShowWelcome(false);
  }

  async function handleWelcomeConnect(token: string) {
    return workspace.connectWithToken(token);
  }

  function handleGlobalSearch(query: string) {
    setRepositoryNavigation((current) => ({
      query,
      language: '',
      tagId: '',
      selectedRepositoryId: null,
      key: current.key + 1,
    }));
    setCurrentPage('repositories');
  }

  function handleRepositoryLanguageSelect(language: string) {
    setRepositoryNavigation((current) => ({
      query: '',
      language,
      tagId: '',
      selectedRepositoryId: null,
      key: current.key + 1,
    }));
    setCurrentPage('repositories');
  }

  function handleRepositoryTagSelect(tagId: string) {
    setRepositoryNavigation((current) => ({
      query: '',
      language: '',
      tagId,
      selectedRepositoryId: null,
      key: current.key + 1,
    }));
    setCurrentPage('repositories');
  }

  function handleRepositoryOpen(repository: RepositoryListItem) {
    setRepositoryNavigation((current) => ({
      query: repository.fullName,
      language: '',
      tagId: '',
      selectedRepositoryId: repository.id,
      key: current.key + 1,
    }));
    setCurrentPage('repositories');
  }

  const failedTaskRetry = getFailedTaskRetry({
    taskId: workspace.taskProgress?.status === 'failed' || workspace.taskProgress?.status === 'partial'
      ? workspace.taskProgress.taskId
      : null,
    workspace,
    aiSettings: settingsHook.settings.ai,
    flushAIKey: settingsHook.flushAIKey,
    resetSettings: settingsHook.resetSettings,
    openSettings: () => setCurrentPage('settings'),
  });

  if (settingsHook.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载本地配置...
      </div>
    );
  }

  if (workspace.isLoadingAuth) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        正在检查 GitHub 连接...
      </div>
    );
  }

  if (shouldShowWelcome) {
    return (
      <WelcomeFlow
        onComplete={handleWelcomeComplete}
        onConnectGitHub={handleWelcomeConnect}
        onSyncStars={() => workspace.handleSyncStars({ throwOnError: true })}
        onFetchReadmes={async () => {
          if (settingsHook.settings.ai.enableAutoSummary && shouldFlushAiApiKey(settingsHook.settings.ai)) {
            await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
          }
          const summary = await workspace.handleFetchReadmes({
            aiConfig: settingsHook.settings.ai,
            autoGenerateAi: settingsHook.settings.ai.enableAutoSummary,
            onlyMissing: true,
            throwOnFailure: true,
          });
          if (!summary) {
            throw new Error('README 缓存失败，请检查网络连接后重试。');
          }
        }}
        taskProgress={workspace.taskProgress}
      />
    );
  }

  // 渲染当前页面
  function renderPage() {
    switch (currentPage) {
      case 'dashboard':
        return (
          <DashboardPage
            onOpenRepository={(query) => handleGlobalSearch(query)}
            onSelectLanguage={handleRepositoryLanguageSelect}
            onOpenSettings={() => setCurrentPage('settings')}
          />
        );
      case 'repositories':
        return (
          <RepositoriesPage
            navigationKey={repositoryNavigation.key}
            globalSearchQuery={repositoryNavigation.query}
            globalLanguageFilter={repositoryNavigation.language}
            globalTagFilter={repositoryNavigation.tagId}
            globalSelectedRepositoryId={repositoryNavigation.selectedRepositoryId}
          />
        );
      case 'tag-network':
        return <TagNetworkPage onSelectTag={handleRepositoryTagSelect} />;
      case 'ai-search':
        return <AISearchPage onOpenRepository={handleRepositoryOpen} />;
      case 'profile':
        return <ProfilePage onOpenRepository={handleRepositoryOpen} onOpenSettings={() => setCurrentPage('settings')} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return (
          <DashboardPage
            onOpenRepository={handleGlobalSearch}
            onSelectLanguage={handleRepositoryLanguageSelect}
            onOpenSettings={() => setCurrentPage('settings')}
          />
        );
    }
  }

  return (
    <AppLayout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      user={workspace.authState.user}
      onSyncStars={workspace.handleSyncStars}
      isSyncing={workspace.isSyncingStars}
      syncSummary={workspace.syncSummary}
      onGlobalSearch={handleGlobalSearch}
      taskProgress={workspace.taskProgress}
      onRetryTask={failedTaskRetry?.onRetry ?? null}
      retryTaskLabel={failedTaskRetry?.label ?? null}
      isRetryingTask={failedTaskRetry?.isRetrying ?? false}
      statusMessage={workspace.authMessage}
      errorMessage={workspace.error ?? settingsHook.settingsError}
    >
      <Suspense fallback={<PageLoadingFallback />}>
        {renderPage()}
      </Suspense>
    </AppLayout>
  );
}

function PageLoadingFallback() {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center bg-background text-sm text-muted-foreground">
      正在加载页面...
    </div>
  );
}

function normalizeAutoSyncInterval(value: number) {
  if (!Number.isFinite(value)) {
    return 30;
  }

  return Math.min(Math.max(Math.trunc(value), 5), 1440);
}

function isSameDocumentHashLink(url: string) {
  try {
    const targetUrl = new URL(url);
    const currentUrl = new URL(window.location.href);
    return (
      targetUrl.origin === currentUrl.origin &&
      targetUrl.pathname === currentUrl.pathname &&
      targetUrl.search === currentUrl.search &&
      targetUrl.hash.length > 0
    );
  } catch {
    return false;
  }
}

type WorkspaceController = ReturnType<typeof useWorkspace>;
type AiSettings = ReturnType<typeof useAppSettings>['settings']['ai'];

function getFailedTaskRetry(options: {
  taskId: string | null;
  workspace: WorkspaceController;
  aiSettings: AiSettings;
  flushAIKey: (apiKey?: string) => Promise<void>;
  resetSettings: () => Promise<void>;
  openSettings: () => void;
}): { label: string; isRetrying: boolean; onRetry: () => void } | null {
  switch (options.taskId) {
    case 'connect-github':
      return {
        label: '重新输入 Token',
        isRetrying: options.workspace.isSavingToken,
        onRetry: options.openSettings,
      };
    case 'clear-local-data':
      return {
        label: '重试清空本机数据',
        isRetrying: options.workspace.isClearingLocalData,
        onRetry: () => {
          void (async () => {
            await options.resetSettings();
            await options.workspace.handleClearLocalData();
          })().catch(() => undefined);
        },
      };
    case 'sync-stars':
      return {
        label: '重试同步',
        isRetrying: options.workspace.isSyncingStars,
        onRetry: () => void options.workspace.handleSyncStars(),
      };
    case 'fetch-readmes': {
      const failedReadmeRepositoryIds = getFailureRepositoryIds(options.workspace.readmeSummary?.failures);
      return {
        label: failedReadmeRepositoryIds.length > 0 ? '重试失败 README' : '重试 README 缓存',
        isRetrying: options.workspace.isFetchingReadmes || options.workspace.isBatchGeneratingAiDocuments,
        onRetry: () => {
          void (async () => {
            if (options.aiSettings.enableAutoSummary && shouldFlushAiApiKey(options.aiSettings)) {
              await options.flushAIKey(options.aiSettings.apiKey);
            }
            await options.workspace.handleFetchReadmes({
              aiConfig: options.aiSettings,
              autoGenerateAi: options.aiSettings.enableAutoSummary,
              onlyMissing: true,
              repositoryIds: failedReadmeRepositoryIds.length > 0 ? failedReadmeRepositoryIds : undefined,
            });
          })().catch(() => undefined);
        },
      };
    }
    case 'fetch-repository-readme':
      if (!options.workspace.selectedRepository) {
        return null;
      }
      return {
        label: '重试当前 README',
        isRetrying: options.workspace.isFetchingRepositoryReadme,
        onRetry: () => void options.workspace.handleFetchRepositoryReadme().catch(() => undefined),
      };
    case 'generate-ai-document':
      if (!options.workspace.selectedRepository) {
        return null;
      }
      return {
        label: '重试当前 AI 摘要',
        isRetrying: options.workspace.isGeneratingAiDocument,
        onRetry: () => {
          void (async () => {
            if (shouldFlushAiApiKey(options.aiSettings)) {
              await options.flushAIKey(options.aiSettings.apiKey);
            }
            await options.workspace.handleGenerateAiDocument(options.aiSettings);
          })().catch(() => undefined);
        },
      };
    case 'batch-generate-ai-documents': {
      const failedAiRepositoryIds = getFailureRepositoryIds(options.workspace.batchAiSummary?.failures);
      return {
        label: failedAiRepositoryIds.length > 0 ? '重试失败 AI' : '重试批量 AI',
        isRetrying: options.workspace.isBatchGeneratingAiDocuments,
        onRetry: () => {
          void (async () => {
            if (shouldFlushAiApiKey(options.aiSettings)) {
              await options.flushAIKey(options.aiSettings.apiKey);
            }
            await options.workspace.handleBatchGenerateAiDocuments(options.aiSettings, {
              onlyMissing: true,
              repositoryIds: failedAiRepositoryIds.length > 0 ? failedAiRepositoryIds : undefined,
            });
          })().catch(() => undefined);
        },
      };
    }
    case 'generate-ai-tag-network':
      return {
        label: '重试 AI 标签网络',
        isRetrying: options.workspace.isGeneratingTagNetwork,
        onRetry: () => {
          void (async () => {
            if (shouldFlushAiApiKey(options.aiSettings)) {
              await options.flushAIKey(options.aiSettings.apiKey);
            }
            await options.workspace.handleGenerateAiTagNetwork(options.aiSettings);
          })().catch(() => undefined);
        },
      };
    case 'ai-search':
      return {
        label: '重试 AI 搜索',
        isRetrying: options.workspace.isRetryingAiSearch,
        onRetry: () => void options.workspace.retryLastAiSearch().catch(() => undefined),
      };
    case 'recommend-github-repositories':
      if (options.workspace.lastGithubRecommendationRepositoryIds.length === 0) {
        return null;
      }
      return {
        label: '重试相似发现',
        isRetrying: options.workspace.isFindingSimilarRepositories,
        onRetry: () => {
          void (async () => {
            if (shouldFlushAiApiKey(options.aiSettings)) {
              await options.flushAIKey(options.aiSettings.apiKey);
            }
            await options.workspace.handleFindSimilarRepositories(options.aiSettings, options.workspace.lastGithubRecommendationRepositoryIds);
          })().catch(() => undefined);
        },
      };
    case 'star-github-recommendation-candidate':
      if (!options.workspace.lastStarRecommendationCandidateFullName) {
        return null;
      }
      return {
        label: '重试加入 Stars',
        isRetrying: options.workspace.isStarringRecommendationCandidate,
        onRetry: () => {
          void options.workspace
            .handleStarRecommendationCandidate(options.workspace.lastStarRecommendationCandidateFullName!)
            .catch(() => undefined);
        },
      };
    case 'export-annotation-gist':
      return {
        label: '重试导出 Gist',
        isRetrying: options.workspace.isExportingAnnotations,
        onRetry: () => void options.workspace.handleExportAnnotations(),
      };
    case 'import-annotation-gist':
      return {
        label: '重试导入 Gist',
        isRetrying: options.workspace.isImportingAnnotations,
        onRetry: () => void options.workspace.runImportAnnotations(),
      };
    default:
      return null;
  }
}

function getFailureRepositoryIds(failures: { repositoryId: string }[] | undefined) {
  const ids = new Set<string>();
  for (const failure of failures ?? []) {
    const repositoryId = failure.repositoryId.trim();
    if (repositoryId) {
      ids.add(repositoryId);
    }
  }
  return Array.from(ids);
}

export function App() {
  return (
    <SettingsProvider>
      <WorkspaceProvider>
        <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background">
          <AppContent />
        </div>
      </WorkspaceProvider>
    </SettingsProvider>
  );
}
