import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppLayout } from '@/components/app-layout';
import { AppUpdateDialog } from '@/components/app-update-panel';
import { Icon } from '@/components/ui/icon';
import { WelcomeFlow } from '@/components/welcome-flow';
import { WorkspaceProvider, useWorkspace } from '@/providers/workspace-provider';
import { SettingsProvider, useAppSettings } from '@/providers/settings-provider';
import { AppUpdateProvider, useAppUpdate } from '@/providers/app-update-provider';
import { shouldFlushAiApiKey } from '@/lib/ai-config';
import type { AppPage, RepositoryListItem } from '@/types';

const DashboardPage = lazy(() => import('@/pages/dashboard').then((module) => ({ default: module.DashboardPage })));
const RepositoriesPage = lazy(() => import('@/pages/repositories').then((module) => ({ default: module.RepositoriesPage })));
const DiscoverPage = lazy(() => import('@/pages/discover').then((module) => ({ default: module.DiscoverPage })));
const RankingsPage = lazy(() => import('@/pages/rankings').then((module) => ({ default: module.RankingsPage })));
const TagNetworkPage = lazy(() => import('@/pages/tag-network').then((module) => ({ default: module.TagNetworkPage })));
const AISearchPage = lazy(() => import('@/pages/ai-search').then((module) => ({ default: module.AISearchPage })));
const ProfilePage = lazy(() => import('@/pages/profile').then((module) => ({ default: module.ProfilePage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((module) => ({ default: module.SettingsPage })));

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
  const appUpdate = useAppUpdate();
  const [currentPage, setCurrentPage] = useState<AppPage>('dashboard');
  const [showWelcome, setShowWelcome] = useState(false);
  const [hasDismissedWelcome, setHasDismissedWelcome] = useState(false);
  const [hasDismissedUpdateNotice, setHasDismissedUpdateNotice] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [notificationOpenSignal, setNotificationOpenSignal] = useState(0);
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
    if (appUpdate.status === 'available') {
      setHasDismissedUpdateNotice(false);
    }
  }, [appUpdate.availableVersion, appUpdate.status]);

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

  async function flushAiApiKeyBeforeBatchTask() {
    if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
      await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
    }
  }

  async function handleQuickBatchGenerateAiDocuments() {
    await flushAiApiKeyBeforeBatchTask();
    await workspace.handleBatchGenerateAiDocuments(settingsHook.settings.ai, { onlyMissing: true });
  }

  async function handleQuickGenerateAiTagNetwork() {
    await flushAiApiKeyBeforeBatchTask();
    await workspace.handleGenerateAiTagNetwork(settingsHook.settings.ai);
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
            onOpenProfile={() => setCurrentPage('profile')}
            onOpenNotifications={() => setNotificationOpenSignal((current) => current + 1)}
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
            onOpenDiscover={() => setCurrentPage('discover')}
          />
        );
      case 'discover':
        return (
          <DiscoverPage
            onOpenRepositories={() => setCurrentPage('repositories')}
            onOpenSettings={() => setCurrentPage('settings')}
          />
        );
      case 'rankings':
        return <RankingsPage onOpenSettings={() => setCurrentPage('settings')} />;
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
            onOpenProfile={() => setCurrentPage('profile')}
            onOpenNotifications={() => setNotificationOpenSignal((current) => current + 1)}
          />
        );
    }
  }

  function handleOpenUpdateDialog() {
    setIsUpdateDialogOpen(true);
    setHasDismissedUpdateNotice(true);
  }

  function handleCheckForUpdate() {
    setIsUpdateDialogOpen(true);
    void appUpdate.checkForUpdate();
  }

  return (
    <>
      <AppLayout
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        user={workspace.authState.user}
        onSyncStars={workspace.handleSyncStars}
        isSyncing={workspace.isSyncingStars}
        onFetchReadmes={() => void workspace.handleFetchReadmes({ onlyMissing: true })}
        isFetchingReadmes={workspace.isFetchingReadmes}
        onBatchGenerateAiDocuments={() => void handleQuickBatchGenerateAiDocuments()}
        isBatchGeneratingAiDocuments={workspace.isBatchGeneratingAiDocuments}
        onGenerateAiTagNetwork={() => void handleQuickGenerateAiTagNetwork()}
        isGeneratingTagNetwork={workspace.isGeneratingTagNetwork}
        onCheckForUpdate={handleCheckForUpdate}
        isCheckingUpdate={appUpdate.status === 'checking'}
        syncSummary={workspace.syncSummary}
        onGlobalSearch={handleGlobalSearch}
        taskProgress={workspace.taskProgress}
        onRetryTask={failedTaskRetry?.onRetry ?? null}
        retryTaskLabel={failedTaskRetry?.label ?? null}
        isRetryingTask={failedTaskRetry?.isRetrying ?? false}
        statusMessage={workspace.authMessage}
        errorMessage={workspace.error ?? settingsHook.settingsError}
        notificationOpenSignal={notificationOpenSignal}
      >
        <Suspense fallback={<PageLoadingFallback />}>
          {renderPage()}
        </Suspense>
      </AppLayout>
      {appUpdate.status === 'available' && appUpdate.availableVersion && !hasDismissedUpdateNotice && (
        <StartupUpdateNotice
          version={appUpdate.availableVersion}
          onOpenUpdate={handleOpenUpdateDialog}
          onDismiss={() => setHasDismissedUpdateNotice(true)}
        />
      )}
      {isUpdateDialogOpen && (
        <AppUpdateDialog appUpdate={appUpdate} onClose={() => setIsUpdateDialogOpen(false)} />
      )}
    </>
  );
}

function StartupUpdateNotice(props: { version: string; onOpenUpdate: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-primary/20 bg-surface p-4 shadow-xl shadow-black/15 backdrop-blur-md">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name="system_update_alt" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-body-md text-sm font-semibold text-on-surface">发现新版本 {props.version}</p>
          <p className="mt-1 font-body-md text-xs leading-relaxed text-on-surface-variant">
            可直接查看更新说明并安装，当前操作不会被打断。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onOpenUpdate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-body-md text-xs font-medium text-white transition-colors hover:brightness-110"
            >
              <Icon name="system_update_alt" size={14} />
              查看更新
            </button>
            <button
              type="button"
              onClick={props.onDismiss}
              className="rounded-lg border border-card-border bg-surface-container-low px-3 py-1.5 font-body-md text-xs text-on-surface transition-colors hover:bg-surface-container-high"
            >
              稍后
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
          title="关闭更新提示"
          aria-label="关闭更新提示"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
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
    case 'export-repository-library-gist':
      return {
        label: '重试导出仓库清单',
        isRetrying: options.workspace.isExportingRepositoryLibrary,
        onRetry: () => void options.workspace.handleExportRepositoryLibrary(),
      };
    case 'import-repository-library-gist':
      return {
        label: '重试导入仓库清单',
        isRetrying: options.workspace.isImportingRepositoryLibrary,
        onRetry: () => void options.workspace.handleImportRepositoryLibrary(),
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
      <AppUpdateProvider>
        <WorkspaceProvider>
          <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background">
            <AppContent />
          </div>
        </WorkspaceProvider>
      </AppUpdateProvider>
    </SettingsProvider>
  );
}
