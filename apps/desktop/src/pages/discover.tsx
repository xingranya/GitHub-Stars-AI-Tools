import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RecommendationDetailPanel } from '@/features/discovery/recommendation-detail-panel';
import { RecommendationList, type DiscoveryCandidateAction } from '@/features/discovery/recommendation-list';
import { useAppSettings } from '@/providers/settings-provider';
import { useWorkspace } from '@/providers/workspace-provider';
import { getAiConfigMessage } from '@/lib/ai-config';
import type { GithubRecommendationPage, GithubRepositoryRecommendation } from '@/types';

type CandidateStatus = 'new' | 'marked' | 'ignored' | 'starred';
type StatusFilter = 'all' | CandidateStatus;
type CategoryFilter = 'all' | string;

const PAGE_SIZE = 20;
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '待处理' },
  { value: 'marked', label: '已标记' },
  { value: 'ignored', label: '已忽略' },
  { value: 'starred', label: '已收藏' },
];

type DiscoverPageProps = {
  onOpenRepositories: () => void;
  onOpenSettings: () => void;
};

export function DiscoverPage(props: DiscoverPageProps) {
  const workspace = useWorkspace();
  const settings = useAppSettings();
  const accountId = workspace.authState.user ? String(workspace.authState.user.id) : null;
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<GithubRecommendationPage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, DiscoveryCandidateAction>>({});
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [selectedCandidateFullName, setSelectedCandidateFullName] = useState<string | null>(null);
  const aiConfigMessage = getAiConfigMessage(settings.settings.ai);

  const loadCandidates = useCallback(async (): Promise<boolean> => {
    if (!accountId) {
      setPage(null);
      setLoadError(null);
      return false;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await invoke<GithubRecommendationPage>('list_github_recommendation_candidates', {
        request: {
          accountId,
          status: status === 'all' ? null : status,
          category: category === 'all' ? null : category,
          limit: PAGE_SIZE,
          offset,
        },
      });
      setPage(response);
      if (response.totalCount > 0 && response.results.length === 0 && offset > 0) {
        setOffset(Math.max(0, Math.floor((response.totalCount - 1) / PAGE_SIZE) * PAGE_SIZE));
      }
      return true;
    } catch (reason) {
      setLoadError(toErrorMessage(reason));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [accountId, category, offset, status]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil((page?.totalCount ?? 0) / PAGE_SIZE));
  const partialFailures = workspace.githubRecommendationResponse?.searchFailures ?? [];
  const rationale = page?.rationaleZh || workspace.githubRecommendationResponse?.rationaleZh || '';
  const queries = useMemo(
    () => page?.queries.length ? page.queries : workspace.githubRecommendationResponse?.queries ?? [],
    [page?.queries, workspace.githubRecommendationResponse?.queries],
  );
  const selectedCandidate = page?.results.find((repository) => repository.fullName === selectedCandidateFullName) ?? null;
  const categoryTotal = page?.categories.reduce((total, item) => total + item.count, 0) ?? 0;

  async function runCandidateAction(
    repository: GithubRepositoryRecommendation,
    action: DiscoveryCandidateAction,
    execute: () => Promise<void>,
  ) {
    setPendingActions((current) => ({ ...current, [repository.fullName]: action }));
    setCandidateErrors((current) => omitKey(current, repository.fullName));
    try {
      await execute();
      await loadCandidates();
    } catch (reason) {
      setCandidateErrors((current) => ({
        ...current,
        [repository.fullName]: toErrorMessage(reason),
      }));
    } finally {
      setPendingActions((current) => omitKey(current, repository.fullName));
    }
  }

  function updateStatus(repository: GithubRepositoryRecommendation, nextStatus: 'new' | 'marked' | 'ignored') {
    const action: DiscoveryCandidateAction = nextStatus === 'ignored' ? 'ignore' : nextStatus === 'marked' ? 'mark' : 'restore';
    return runCandidateAction(repository, action, () => workspace.handleUpdateRecommendationCandidate(repository.fullName, nextStatus));
  }

  function starCandidate(repository: GithubRepositoryRecommendation) {
    return runCandidateAction(repository, 'star', () => workspace.handleStarRecommendationCandidate(repository.fullName));
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    setRefreshFeedback(null);
    const succeeded = await loadCandidates();
    setRefreshFeedback(succeeded
      ? { tone: 'success', message: `已更新 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` }
      : { tone: 'error', message: '刷新失败，请查看错误提示' });
    setIsRefreshing(false);
  }

  if (!accountId) {
    return (
      <DiscoverEmptyState
        icon="link_off"
        title="尚未连接 GitHub"
        description="连接 GitHub 后，可以保存推荐候选并直接加入 Stars。"
        actionLabel="打开设置"
        onAction={props.onOpenSettings}
      />
    );
  }

  return (
    <section className="h-full min-w-0 overflow-y-auto bg-background p-4 sm:p-5 lg:p-6">
      <div className="mx-auto flex min-h-full w-full max-w-[min(1400px,100%)] flex-col gap-4">
      <header className="shrink-0">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon name="travel_explore" size={20} />
              </span>
              <div>
                <h1 className="text-lg font-semibold text-on-surface">发现</h1>
                <p className="mt-0.5 text-sm text-on-surface-variant">比较同类项目，安排稍后研究，或直接加入 GitHub Stars。</p>
              </div>
            </div>
            {rationale ? <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant">{rationale}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span
              className={`mr-1 text-xs ${refreshFeedback?.tone === 'error' ? 'text-error' : 'text-on-surface-variant'}`}
              aria-live="polite"
            >
              {isRefreshing ? '正在获取最新候选…' : refreshFeedback?.message ?? ''}
            </span>
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isLoading}>
              <Icon name="refresh" size={16} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? '刷新中' : '刷新'}
            </Button>
            <Button onClick={props.onOpenRepositories}>
              <Icon name="add" size={16} />
              选择参考仓库
            </Button>
          </div>
        </div>
      </header>

      {(aiConfigMessage || partialFailures.length > 0 || workspace.githubRecommendationError || loadError) && (
        <div className="shrink-0 space-y-2">
          {aiConfigMessage && (
            <InlineNotice tone="muted" message={`生成新推荐前需要完善 AI 设置：${aiConfigMessage}`} />
          )}
          {partialFailures.length > 0 && (
            <InlineNotice tone="warning" message={`${partialFailures.length} 个 GitHub 搜索式未完成，已保留其他成功候选。`} />
          )}
          {(workspace.githubRecommendationError || loadError) && (
            <InlineNotice tone="error" message={loadError ?? workspace.githubRecommendationError ?? ''} />
          )}
        </div>
      )}

      <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-xl border border-card-border bg-surface-container-lowest shadow-sm">
      <div className="shrink-0 border-b border-outline-variant/20 bg-surface/55 px-4 py-3 backdrop-blur-sm sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface-container p-1" aria-label="候选状态筛选">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setStatus(option.value);
                    setOffset(0);
                    setRefreshFeedback(null);
                    setSelectedCandidateFullName(null);
                  }}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    status === option.value
                      ? 'bg-surface text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  aria-pressed={status === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-outline-variant/35 bg-surface px-3 text-sm text-on-surface-variant focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
              <Icon name="category" size={16} />
              <span className="sr-only">项目类型</span>
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setOffset(0);
                  setRefreshFeedback(null);
                  setSelectedCandidateFullName(null);
                }}
                className="min-w-0 max-w-[220px] bg-transparent text-sm text-on-surface outline-none"
                aria-label="按项目类型筛选"
              >
                <option value="all">全部类型（{categoryTotal}）</option>
                {page?.categories.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}（{item.count}）</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm tabular-nums text-on-surface-variant">
            共 {page?.totalCount ?? 0} 个候选 · 第 {pageNumber} / {pageCount} 页
          </p>
        </div>
      </div>

      <div className={`grid min-h-0 flex-1 ${selectedCandidate ? 'xl:grid-cols-[minmax(0,1fr)_minmax(390px,46%)]' : 'grid-cols-1'}`} aria-busy={isLoading}>
        <div className={`min-h-0 overflow-auto ${selectedCandidate ? 'hidden xl:block' : ''}`}>
        {isLoading && !page ? <DiscoverListSkeleton /> : null}
        {!isLoading && page?.results.length === 0 ? (
          <DiscoverEmptyState
            icon="manage_search"
            title={status === 'all' && category === 'all' ? '还没有推荐候选' : '当前筛选没有候选'}
            description={status === 'all' && category === 'all' ? '从仓库页选择 1 到 8 个参考项目，生成第一批同类项目。' : '切换状态或项目类型查看其他候选，或返回仓库页生成新推荐。'}
            actionLabel="选择参考仓库"
            onAction={props.onOpenRepositories}
          />
        ) : null}
        {page && page.results.length > 0 ? (
          <RecommendationList
            repositories={page.results}
            pendingActions={pendingActions}
            candidateErrors={candidateErrors}
            selectedFullName={selectedCandidateFullName}
            onOpenDetails={(repository) => setSelectedCandidateFullName(repository.fullName)}
            onStar={starCandidate}
            onUpdateStatus={updateStatus}
          />
        ) : null}
        </div>
        {selectedCandidate ? (
          <RecommendationDetailPanel
            accountId={accountId}
            repository={selectedCandidate}
            onClose={() => setSelectedCandidateFullName(null)}
          />
        ) : null}
      </div>

      {page && page.totalCount > PAGE_SIZE ? (
        <footer className={`shrink-0 items-center justify-between border-t border-outline-variant/30 bg-surface px-4 py-3 sm:px-6 ${selectedCandidate ? 'hidden xl:flex' : 'flex'}`}>
          <Button variant="outline" disabled={offset === 0 || isLoading} onClick={() => {
            setSelectedCandidateFullName(null);
            setOffset(Math.max(0, offset - PAGE_SIZE));
          }}>
            <Icon name="chevron_left" size={16} />
            上一页
          </Button>
          <span className="text-sm tabular-nums text-on-surface-variant">{pageNumber} / {pageCount}</span>
          <Button variant="outline" disabled={offset + PAGE_SIZE >= page.totalCount || isLoading} onClick={() => {
            setSelectedCandidateFullName(null);
            setOffset(offset + PAGE_SIZE);
          }}>
            下一页
            <Icon name="chevron_right" size={16} />
          </Button>
        </footer>
      ) : null}

      {queries.length > 0 ? (
        <details className="shrink-0 border-t border-outline-variant/20 bg-surface/45 px-4 py-2 text-xs text-on-surface-variant sm:px-5">
          <summary className="cursor-pointer py-1 font-medium">查看最近使用的 GitHub 搜索式</summary>
          <div className="grid gap-1.5 pb-2 pt-1 lg:grid-cols-2">
            {queries.map((query) => <code key={query} className="overflow-x-auto rounded-md bg-surface-container px-2 py-1.5">{query}</code>)}
          </div>
        </details>
      ) : null}
      </div>
      </div>
    </section>
  );
}

function InlineNotice(props: { tone: 'muted' | 'warning' | 'error'; message: string }) {
  const classes = props.tone === 'error'
    ? 'border-error/20 bg-error/10 text-error'
    : props.tone === 'warning'
      ? 'border-warning/25 bg-warning/10 text-on-surface'
      : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant';
  return <p className={`rounded-md border px-3 py-2 text-sm leading-5 ${classes}`}>{props.message}</p>;
}

function DiscoverEmptyState(props: {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
        <Icon name={props.icon} size={26} />
      </span>
      <h2 className="mt-4 text-base font-semibold text-on-surface">{props.title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-on-surface-variant">{props.description}</p>
      <Button className="mt-4" onClick={props.onAction}>{props.actionLabel}</Button>
    </div>
  );
}

function DiscoverListSkeleton() {
  return (
    <div aria-label="正在加载推荐候选">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="border-b border-outline-variant/20 px-6 py-5">
          <div className="h-4 w-48 animate-pulse rounded bg-surface-container-high" />
          <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-surface-container" />
          <div className="mt-3 h-7 w-72 max-w-full animate-pulse rounded bg-surface-container" />
        </div>
      ))}
    </div>
  );
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
