import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RankingDetailPanel } from '@/features/rankings/ranking-detail-panel';
import { RankingList } from '@/features/rankings/ranking-list';
import type { RankingItem, RankingPage, RankingStarResult } from '@/types';

export type RankingKindOption = {
  value: string;
  label: string;
  description: string;
};

const PAGE_SIZE = 20;

export function RankingsWorkspace(props: {
  accountId: string;
  command: 'list_github_rankings' | 'list_personal_rankings';
  title: string;
  description: string;
  kindOptions: RankingKindOption[];
  languageOptions: string[];
  allowRefresh: boolean;
  allowStar: boolean;
}) {
  const [kind, setKind] = useState(props.kindOptions[0]?.value ?? '');
  const [language, setLanguage] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<RankingPage | null>(null);
  const [selectedFullName, setSelectedFullName] = useState<string | null>(null);
  const [pendingStarFullNames, setPendingStarFullNames] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starError, setStarError] = useState<string | null>(null);

  const loadRankings = useCallback(async (forceRefresh = false) => {
    if (!kind) return;
    forceRefresh ? setIsRefreshing(true) : setIsLoading(true);
    setError(null);
    try {
      const response = await invoke<RankingPage>(props.command, {
        request: {
          accountId: props.accountId,
          kind,
          language: language || null,
          page: pageNumber,
          limit: PAGE_SIZE,
          forceRefresh,
        },
      });
      setPage(response);
      setSelectedFullName((current) => response.items.some((item) => item.fullName === current) ? current : null);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [kind, language, pageNumber, props.accountId, props.command]);

  useEffect(() => {
    void loadRankings(false);
  }, [loadRankings]);

  const selectedRepository = useMemo(
    () => page?.items.find((repository) => repository.fullName === selectedFullName) ?? null,
    [page?.items, selectedFullName],
  );
  const pageCount = Math.max(1, Math.ceil((page?.totalCount ?? 0) / PAGE_SIZE));

  async function handleStar(repository: RankingItem) {
    setPendingStarFullNames((current) => new Set(current).add(repository.fullName));
    setStarError(null);
    try {
      const result = await invoke<RankingStarResult>('star_github_ranking_repository', {
        request: { accountId: props.accountId, fullName: repository.fullName },
      });
      setPage((current) => current ? {
        ...current,
        items: current.items.map((item) => item.fullName === result.fullName ? { ...item, isStarred: result.isStarred } : item),
      } : current);
    } catch (reason) {
      setStarError(toErrorMessage(reason));
    } finally {
      setPendingStarFullNames((current) => {
        const next = new Set(current);
        next.delete(repository.fullName);
        return next;
      });
    }
  }

  function changeKind(nextKind: string) {
    setKind(nextKind);
    setPageNumber(1);
    setSelectedFullName(null);
  }

  function changeLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    setPageNumber(1);
    setSelectedFullName(null);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header className="shrink-0 border-b border-outline-variant/25 bg-surface px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-on-surface">{props.title}</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-on-surface-variant">{props.description}</p>
          </div>
          {props.allowRefresh ? (
            <Button size="sm" variant="outline" disabled={isRefreshing || isLoading} onClick={() => void loadRankings(true)}>
              <Icon name={isRefreshing ? 'progress_activity' : 'refresh'} size={15} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? '刷新中' : '刷新榜单'}
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 overflow-x-auto border-b border-outline-variant/25" aria-label="榜单类型">
            {props.kindOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changeKind(option.value)}
                className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${kind === option.value ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
                aria-pressed={kind === option.value}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-on-surface-variant">
            <span>语言</span>
            <select
              value={language}
              onChange={(event) => changeLanguage(event.target.value)}
              className="h-8 min-w-36 rounded-md border border-outline-variant/40 bg-surface px-2 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">全部语言</option>
              {props.languageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className={`${selectedRepository ? 'hidden xl:flex xl:w-[58%]' : 'flex w-full'} min-h-0 min-w-0 flex-col`}>
          <div className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b border-outline-variant/20 px-4 text-[11px] text-on-surface-variant sm:px-5">
            <span>{page ? `共 ${page.totalCount.toLocaleString()} 个项目` : '正在读取榜单'}</span>
            {page ? (
              <span className={page.isStale ? 'text-warning' : ''}>
                {page.isStale
                  ? `网络不可用，显示 ${formatDateTime(page.generatedAt)} 的缓存`
                  : page.fromCache
                    ? `缓存更新于 ${formatDateTime(page.generatedAt)}`
                    : `更新于 ${formatDateTime(page.generatedAt)}`}
              </span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && !page ? (
              <RankingLoadingState />
            ) : error && !page ? (
              <RankingErrorState message={error} onRetry={() => void loadRankings(false)} />
            ) : page && page.items.length > 0 ? (
              <RankingList
                items={page.items}
                page={page.page}
                limit={page.limit}
                selectedFullName={selectedFullName}
                pendingStarFullNames={pendingStarFullNames}
                allowStar={props.allowStar}
                onOpenDetails={(repository) => setSelectedFullName(repository.fullName)}
                onStar={(repository) => void handleStar(repository)}
              />
            ) : page ? (
              <RankingEmptyState />
            ) : null}
          </div>

          {starError ? <p className="shrink-0 border-t border-error/20 bg-error/10 px-4 py-2 text-xs text-error" role="alert">{starError}</p> : null}
          {page && page.totalCount > 0 ? (
            <footer className="flex shrink-0 items-center justify-between border-t border-outline-variant/25 bg-surface px-4 py-2 sm:px-5">
              <span className="text-[11px] text-on-surface-variant">第 {page.page} / {pageCount} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page.page <= 1 || isLoading} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}>
                  <Icon name="chevron_left" size={15} />上一页
                </Button>
                <Button size="sm" variant="outline" disabled={!page.hasMore || isLoading} onClick={() => setPageNumber((value) => value + 1)}>
                  下一页<Icon name="chevron_right" size={15} />
                </Button>
              </div>
            </footer>
          ) : null}
        </div>

        {selectedRepository ? (
          <RankingDetailPanel accountId={props.accountId} repository={selectedRepository} onClose={() => setSelectedFullName(null)} />
        ) : null}
      </div>
    </div>
  );
}

function RankingLoadingState() {
  return (
    <div className="space-y-0" aria-label="正在加载排行榜">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid min-h-[112px] grid-cols-[44px_1fr] gap-3 border-b border-outline-variant/20 px-4 py-4 sm:grid-cols-[52px_1fr_180px] sm:px-5">
          <div className="size-8 animate-pulse rounded-md bg-surface-container-high" />
          <div className="space-y-3"><div className="h-4 w-2/5 animate-pulse rounded bg-surface-container-high" /><div className="h-3 w-4/5 animate-pulse rounded bg-surface-container" /><div className="h-3 w-1/2 animate-pulse rounded bg-surface-container" /></div>
          <div className="hidden h-8 animate-pulse rounded-md bg-surface-container sm:block" />
        </div>
      ))}
    </div>
  );
}

function RankingErrorState(props: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <Icon name="cloud_off" size={28} className="text-error" />
      <h2 className="mt-3 text-sm font-semibold text-on-surface">排行榜暂时无法加载</h2>
      <p className="mt-1 max-w-md text-xs leading-5 text-error">{props.message}</p>
      <Button className="mt-4" size="sm" variant="outline" onClick={props.onRetry}><Icon name="refresh" size={15} />重试</Button>
    </div>
  );
}

function RankingEmptyState() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <Icon name="leaderboard" size={30} className="text-on-surface-variant" />
      <h2 className="mt-3 text-sm font-semibold text-on-surface">当前条件下没有项目</h2>
      <p className="mt-1 text-xs text-on-surface-variant">切换榜单类型或语言后再查看。</p>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
