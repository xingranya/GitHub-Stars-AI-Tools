import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { ReadmeRenderer } from '@/components/readme-renderer';
import { Icon } from '@/components/ui/icon';
import { getAiConfigMessage, shouldFlushAiApiKey } from '@/lib/ai-config';
import { compactNumber } from '@/lib/format';
import { computeVirtualWindow } from '@/lib/virtual-list';
import type {
  GithubRecommendationResponse,
  ReadingStatus,
  RepositoryAnnotationView,
  RepositoryDetailView,
  RepositoryListItem,
  TagItem,
} from '@/types';

type RecommendationCandidateStatus = 'new' | 'marked' | 'ignored' | 'starred';
type RecommendationCandidateAction = 'star' | 'mark' | 'ignore';

const README_SUMMARY_PROMPT_CHAR_LIMIT = 18_000;

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178C6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#DEA584',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  Vue: '#41b883',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  PHP: '#4F5D95',
};

function getLanguageColor(language: string | null): string {
  if (!language) return '#c3c6d7';
  return LANGUAGE_COLORS[language] ?? '#c3c6d7';
}

function removeRecommendationCandidateRecord<T>(record: Record<string, T>, fullName: string): Record<string, T> {
  const next = { ...record };
  delete next[fullName];
  return next;
}

function toPageErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function getBatchAiLimitValue(limit: BatchAiLimit) {
  if (limit === 'all') {
    return undefined;
  }

  return Number(limit);
}

function repositoryMatchesLocalFilters(repo: RepositoryListItem, filters: { keyword: string; language: string; tagId: string }) {
  if (filters.language && repo.language !== filters.language) {
    return false;
  }

  if (filters.tagId && !repo.tagIds.includes(filters.tagId)) {
    return false;
  }

  const keyword = filters.keyword.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  const searchableText = [
    repo.fullName,
    repo.owner,
    repo.name,
    repo.description ?? '',
    repo.language ?? '',
    ...repo.topics,
    repo.aiSummary ?? '',
    ...repo.aiKeywords,
    ...repo.suggestedTags,
    ...repo.tagNames,
  ]
    .join(' ')
    .toLowerCase();

  return searchableText.includes(keyword);
}

type SortBy = 'recent' | 'stars' | 'name';
type ViewMode = 'detail' | 'table';
type BatchAiLimit = 'all' | '50' | '100' | '300';
const REPOSITORY_CARD_HEIGHT = 92;
const REPOSITORY_CARD_GAP = 4;
const REPOSITORY_ROW_HEIGHT = REPOSITORY_CARD_HEIGHT + REPOSITORY_CARD_GAP;
const REPOSITORY_TABLE_ROW_HEIGHT = 54;
const REPOSITORY_TABLE_HEADER_HEIGHT = 30;
const LIST_OVERSCAN = 8;
const MAX_RECOMMENDATION_SELECTION = 8;

type RepositoriesPageProps = {
  navigationKey?: number;
  globalSearchQuery?: string;
  globalLanguageFilter?: string;
  globalTagFilter?: string;
  globalSelectedRepositoryId?: string | null;
};

export function RepositoriesPage(props: RepositoriesPageProps) {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [selectedTagId, setSelectedTagId] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>('detail');
  const [batchAiLimit, setBatchAiLimit] = useState<BatchAiLimit>('all');
  const [isBatchPanelOpen, setIsBatchPanelOpen] = useState(false);
  const [isRepositoryListCollapsed, setIsRepositoryListCollapsed] = useState(false);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(720);
  const [recommendationSelection, setRecommendationSelection] = useState<Set<string>>(() => new Set());
  const [recommendationCandidatePending, setRecommendationCandidatePending] = useState<Record<string, RecommendationCandidateAction>>({});
  const [recommendationCandidateErrors, setRecommendationCandidateErrors] = useState<Record<string, string>>({});
  const listViewportRef = useRef<HTMLDivElement | null>(null);

  const resetListScroll = useCallback(() => {
    setListScrollTop(0);
    if (listViewportRef.current) {
      listViewportRef.current.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    setSearchKeyword(props.globalSearchQuery?.trim() ?? '');
    setSelectedLanguage(props.globalLanguageFilter?.trim() ?? '');
    setSelectedTagId(props.globalTagFilter?.trim() ?? '');
    if (props.globalSelectedRepositoryId) {
      workspace.setSelectedRepositoryId(props.globalSelectedRepositoryId);
    }
    resetListScroll();
  }, [props.navigationKey, resetListScroll]);

  useEffect(() => {
    const viewport = listViewportRef.current;
    if (!viewport) return;

    const updateViewportHeight = () => {
      const fallbackHeight = viewMode === 'table' ? 760 : 720;
      setListViewportHeight(Math.max(1, Math.floor(viewport.clientHeight || fallbackHeight)));
    };

    updateViewportHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportHeight);
      return () => window.removeEventListener('resize', updateViewportHeight);
    }

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [viewMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void workspace.applyRepositoryFilters({
        keyword: searchKeyword,
        language: selectedLanguage,
        tagId: selectedTagId,
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [searchKeyword, selectedLanguage, selectedTagId]);

  useEffect(() => {
    resetListScroll();
  }, [searchKeyword, selectedLanguage, selectedTagId, sortBy, viewMode, resetListScroll]);

  const hasPendingRepositoryFilters = workspace.isLoadingRepositories || (
    searchKeyword.trim() !== workspace.repositoryFilters.keyword.trim()
    || selectedLanguage !== workspace.repositoryFilters.language
    || selectedTagId !== workspace.repositoryFilters.tagId
  );

  // 后端负责完整 SQLite 检索；请求返回前先用本地已加载数据做即时筛选。
  const filteredRepos = useMemo(() => {
    if (!workspace.repositoryPage) return [];

    let repos = [...workspace.repositoryPage.items];
    if (hasPendingRepositoryFilters) {
      repos = repos.filter((repo) => repositoryMatchesLocalFilters(repo, {
        keyword: searchKeyword,
        language: selectedLanguage,
        tagId: selectedTagId,
      }));
    }

    repos.sort((a, b) => {
      switch (sortBy) {
        case 'stars':
          return b.starsCount - a.starsCount;
        case 'name':
          return a.fullName.localeCompare(b.fullName);
        case 'recent':
        default:
          return b.starredAt.localeCompare(a.starredAt);
      }
    });

    return repos;
  }, [workspace.repositoryPage, hasPendingRepositoryFilters, searchKeyword, selectedLanguage, selectedTagId, sortBy]);

  const selectedRepo = workspace.selectedRepository;
  const aiConfigMessage = getAiConfigMessage(settingsHook.settings.ai);
  const autoSummaryConfigMessage = settingsHook.settings.ai.enableAutoSummary ? aiConfigMessage : null;
  const visibleWindow = useMemo(() => {
    const rowHeight = viewMode === 'table' ? REPOSITORY_TABLE_ROW_HEIGHT : REPOSITORY_ROW_HEIGHT;
    return computeVirtualWindow({
      items: filteredRepos,
      scrollTop: listScrollTop,
      viewportHeight: listViewportHeight,
      rowHeight,
      overscan: LIST_OVERSCAN,
      stickyHeaderHeight: viewMode === 'table' ? REPOSITORY_TABLE_HEADER_HEIGHT : 0,
    });
  }, [filteredRepos, listScrollTop, listViewportHeight, viewMode]);
  const hasActiveFilters = Boolean(searchKeyword.trim() || selectedLanguage || selectedTagId);
  const batchTargetRepositoryIds = hasActiveFilters ? filteredRepos.map((repository) => repository.id) : undefined;
  const batchTargetCount = batchTargetRepositoryIds?.length ?? workspace.repositoryStats.total;
  const hasBatchTargets = batchTargetCount > 0;
  const batchTargetScopeLabel = batchTargetRepositoryIds
    ? `当前列表 ${batchTargetCount} 个仓库`
    : '全部 Stars';
  const selectedRecommendationIds = Array.from(recommendationSelection);
  const hasReachedRecommendationSelectionLimit = selectedRecommendationIds.length >= MAX_RECOMMENDATION_SELECTION;
  const hasConnectedUser = Boolean(workspace.authState.user);
  const recommendationActionNotice = !hasConnectedUser
    ? '请先连接 GitHub 账号，随后可同步 Stars、缓存 README 并使用 AI 功能。'
    : selectedRecommendationIds.length === 0
      ? `勾选 1 到 ${MAX_RECOMMENDATION_SELECTION} 个仓库后，可以让 AI 在 GitHub 上寻找相似或更优项目。`
      : aiConfigMessage
        ? aiConfigMessage
        : hasReachedRecommendationSelectionLimit
          ? `已选择 ${MAX_RECOMMENDATION_SELECTION} 个参考仓库，取消一个后可以继续更换参考对象。`
          : null;
  const recommendationActionNoticeTone = !hasConnectedUser || Boolean(aiConfigMessage) ? 'error' : 'muted';
  const readmeActionTitle = !hasConnectedUser
    ? '请先连接 GitHub 账号'
    : !hasBatchTargets
      ? '当前列表没有可处理仓库'
    : settingsHook.settings.ai.enableAutoSummary
      ? autoSummaryConfigMessage ?? '抓取 README 后生成 AI 摘要'
      : '抓取 README';
  const batchAiActionTitle = !hasConnectedUser
    ? '请先连接 GitHub 账号'
    : !hasBatchTargets
      ? '当前列表没有可处理仓库'
      : aiConfigMessage ?? '批量生成 AI 摘要';
  const batchAiActionNotice = !hasConnectedUser
    ? '请先连接 GitHub 账号，随后可批量生成 AI 摘要。'
    : !hasBatchTargets
      ? '当前列表没有可处理仓库，请调整筛选条件后再批量解析。'
    : aiConfigMessage
      ? aiConfigMessage
      : `批量 AI 会自动补抓缺失 README，仅跳过已是最新摘要的仓库；本次处理${batchTargetScopeLabel}，失败项会保留在结果里，不影响已生成内容。`;
  const batchAiActionNoticeTone = !hasConnectedUser || !hasBatchTargets || Boolean(aiConfigMessage) ? 'error' : 'muted';
  const batchAiLimitValue = getBatchAiLimitValue(batchAiLimit);
  const batchAiLimitLabel = batchAiLimitValue
    ? `${batchTargetScopeLabel}，最多解析 ${batchAiLimitValue} 个`
    : `${batchTargetScopeLabel}，不限制数量`;
  const recommendationActionTitle = !hasConnectedUser
    ? '请先连接 GitHub 账号'
    : selectedRecommendationIds.length === 0
      ? `请先勾选 1 到 ${MAX_RECOMMENDATION_SELECTION} 个参考仓库`
      : aiConfigMessage ?? '根据勾选仓库在 GitHub 寻找相似或更优项目';

  function toggleRecommendationSelection(repositoryId: string) {
    setRecommendationSelection((current) => {
      const next = new Set(current);
      if (next.has(repositoryId)) {
        next.delete(repositoryId);
      } else if (next.size >= MAX_RECOMMENDATION_SELECTION) {
        return current;
      } else {
        next.add(repositoryId);
      }
      return next;
    });
  }

  async function handleFindSimilarOnGithub() {
    await runAiWorkspaceAction(() => workspace.handleFindSimilarRepositories(settingsHook.settings.ai, selectedRecommendationIds));
  }

  async function runAiWorkspaceAction(action: () => Promise<unknown>) {
    try {
      if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
        await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
      }
      await action();
    } catch {
      // workspace 和 settings hook 已负责展示可见错误
    }
  }

  async function handleUpdateRecommendationCandidate(fullName: string, status: Exclude<RecommendationCandidateStatus, 'starred'>) {
    const action: RecommendationCandidateAction = status === 'ignored' ? 'ignore' : 'mark';
    await runRecommendationCandidateAction(fullName, action, () => workspace.handleUpdateRecommendationCandidate(fullName, status));
  }

  async function handleStarRecommendationCandidate(fullName: string) {
    await runRecommendationCandidateAction(fullName, 'star', () => workspace.handleStarRecommendationCandidate(fullName));
  }

  async function runRecommendationCandidateAction(
    fullName: string,
    action: RecommendationCandidateAction,
    execute: () => Promise<void>,
  ) {
    setRecommendationCandidatePending((current) => ({ ...current, [fullName]: action }));
    setRecommendationCandidateErrors((current) => removeRecommendationCandidateRecord(current, fullName));
    try {
      await execute();
    } catch (reason) {
      setRecommendationCandidateErrors((current) => ({
        ...current,
        [fullName]: toPageErrorMessage(reason),
      }));
    } finally {
      setRecommendationCandidatePending((current) => removeRecommendationCandidateRecord(current, fullName));
    }
  }

  return (
    <div
      className={`repositories-page-compact grid h-full min-w-0 flex-1 content-start grid-cols-1 gap-2 overflow-y-auto p-2 text-[13px] md:min-h-0 md:content-stretch md:overflow-hidden xl:gap-3 ${
        isRepositoryListCollapsed
          ? 'md:grid-cols-[48px_minmax(0,1fr)]'
          : 'md:grid-cols-[clamp(230px,20vw,282px)_minmax(0,1fr)] xl:grid-cols-[clamp(244px,18vw,300px)_minmax(0,1fr)] 2xl:grid-cols-[304px_minmax(0,1fr)]'
      }`}
    >
      {/* 左侧仓库列表 */}
      <div
        className={`min-w-0 overflow-hidden rounded-lg border border-card-border bg-surface-container-low shadow-sm md:h-full ${
          isRepositoryListCollapsed ? 'hidden md:flex md:flex-col md:items-center md:justify-between md:p-1.5' : 'flex h-[min(42dvh,420px)] min-h-[280px] flex-col md:h-full'
        }`}
      >
        {isRepositoryListCollapsed ? (
          <>
            <button
              type="button"
              onClick={() => setIsRepositoryListCollapsed(false)}
              className="flex size-10 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
              title="展开 Star 列表"
              aria-label="展开 Star 列表"
            >
              <Icon name="left_panel_open" size={20} />
            </button>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-on-surface-variant">
              <Icon name="star" size={20} />
              <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-normal">
                Star 列表
              </span>
              <span className="rounded-full border border-outline-variant/30 px-1.5 py-1 text-[10px]">
                {compactNumber(filteredRepos.length)}
              </span>
            </div>
          </>
        ) : (
          <>
        {/* 列表标题与控制区 */}
        <div className="shrink-0 border-b border-outline-variant/20 bg-surface/50 p-2.5 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-on-surface">知识库列表</h1>
              <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                {compactNumber(filteredRepos.length)} / {compactNumber(workspace.repositoryStats.total)} 个仓库
              </p>
            </div>
            <div className="flex shrink-0 rounded-md border border-outline-variant/30 bg-surface p-0.5">
              <button
                type="button"
                onClick={() => {
                  setViewMode('detail');
                  resetListScroll();
                }}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  viewMode === 'detail' ? 'bg-primary text-white' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                卡片
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('table');
                  resetListScroll();
                }}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  viewMode === 'table' ? 'bg-primary text-white' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                表格
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsRepositoryListCollapsed(true)}
            className="mb-2 hidden w-full items-center justify-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary shadow-sm transition-colors hover:border-primary/45 hover:bg-primary/15 md:flex"
            title="收起 Star 列表"
            aria-label="收起 Star 列表"
          >
            <Icon name="left_panel_close" size={15} />
            收起 Star 列表
          </button>
          <div className="mb-2 overflow-hidden rounded-md border border-primary/25 bg-primary/5">
            <button
              type="button"
              onClick={() => setIsBatchPanelOpen((current) => !current)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
              aria-expanded={isBatchPanelOpen}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="bolt" size={15} />
                批量处理
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-normal text-primary/80">
                {isBatchPanelOpen ? '点击收起' : '点击展开'}
                <Icon name="expand_more" size={15} className={`transition-transform ${isBatchPanelOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {isBatchPanelOpen && (
            <div className="border-t border-primary/15 px-1 pb-1">
            <div className="mt-2 flex gap-2 px-2">
              <button
                onClick={() =>
                  void (async () => {
                    if (settingsHook.settings.ai.enableAutoSummary && shouldFlushAiApiKey(settingsHook.settings.ai)) {
                      await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
                    }
                    await workspace.handleFetchReadmes({
                      aiConfig: settingsHook.settings.ai,
                      autoGenerateAi: settingsHook.settings.ai.enableAutoSummary,
                      aiLimit: batchAiLimitValue,
                      onlyMissing: true,
                      repositoryIds: batchTargetRepositoryIds,
                    });
                  })().catch(() => undefined)
                }
                disabled={
                  workspace.isFetchingReadmes ||
                  workspace.isBatchGeneratingAiDocuments ||
                  !hasConnectedUser ||
                  !hasBatchTargets ||
                  Boolean(autoSummaryConfigMessage)
                }
                title={readmeActionTitle}
                className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-outline-variant/40 text-xs text-on-surface hover:bg-surface-container transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                <Icon
                  name="description"
                  size={15}
                  className={workspace.isFetchingReadmes || workspace.isBatchGeneratingAiDocuments ? 'animate-spin' : ''}
                />
                {workspace.isFetchingReadmes
                  ? '抓取中'
                  : workspace.isBatchGeneratingAiDocuments
                    ? '分析中'
                    : settingsHook.settings.ai.enableAutoSummary
                      ? '抓取并分析'
                      : '抓取 README'}
              </button>
              <button
                onClick={() =>
                  void runAiWorkspaceAction(() => workspace.handleBatchGenerateAiDocuments(settingsHook.settings.ai, {
                    limit: batchAiLimitValue,
                    onlyMissing: true,
                    repositoryIds: batchTargetRepositoryIds,
                  }))
                }
                disabled={workspace.isBatchGeneratingAiDocuments || !hasConnectedUser || !hasBatchTargets || Boolean(aiConfigMessage)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-white text-xs hover:brightness-110 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                title={batchAiActionTitle}
              >
                <Icon name={workspace.isBatchGeneratingAiDocuments ? 'progress_activity' : 'auto_awesome'} size={15} className={workspace.isBatchGeneratingAiDocuments ? 'animate-spin' : ''} />
                {workspace.isBatchGeneratingAiDocuments ? '分析中' : '批量 AI'}
              </button>
            </div>
            <div className="mx-2 mb-3 mt-2 flex flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Icon name="speed" size={15} className="shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="font-medium text-on-surface">AI 批量上限</p>
                  <p className="truncate">{batchAiLimitLabel}</p>
                </div>
              </div>
              <select
                value={batchAiLimit}
                onChange={(event) => setBatchAiLimit(event.target.value as BatchAiLimit)}
                disabled={workspace.isBatchGeneratingAiDocuments || workspace.isFetchingReadmes}
                className="h-8 rounded-lg border border-outline-variant/40 bg-surface px-2 text-xs text-on-surface outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
                title="选择本次批量 AI 解析的仓库上限"
              >
                <option value="all">全部 Stars</option>
                <option value="50">最多 50 个</option>
                <option value="100">最多 100 个</option>
                <option value="300">最多 300 个</option>
              </select>
            </div>
            <div className="mx-2 mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleFindSimilarOnGithub()}
                disabled={
                  workspace.isFindingSimilarRepositories ||
                  !hasConnectedUser ||
                  selectedRecommendationIds.length === 0 ||
                  Boolean(aiConfigMessage)
                }
                title={recommendationActionTitle}
                className="flex min-w-[180px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
              >
                <Icon
                  name={workspace.isFindingSimilarRepositories ? 'progress_activity' : 'travel_explore'}
                  size={15}
                  className={workspace.isFindingSimilarRepositories ? 'animate-spin' : ''}
                />
                {workspace.isFindingSimilarRepositories ? '发现中' : `GitHub 相似发现${selectedRecommendationIds.length ? ` (${selectedRecommendationIds.length})` : ''}`}
              </button>
              {selectedRecommendationIds.length > 0 && (
              <button
                type="button"
                onClick={() => setRecommendationSelection(new Set())}
                className="rounded-lg border border-outline-variant/30 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
              >
                清空
              </button>
              )}
            </div>
          {workspace.batchAiSummary && (
            <BatchAiSummaryPanel summary={workspace.batchAiSummary} />
          )}
          {batchAiActionNotice && (
            <div
              className={`mb-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                batchAiActionNoticeTone === 'error'
                  ? 'border-error/20 bg-error/10 text-error'
                  : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant'
              }`}
            >
              <span className="mr-1 font-medium">批量 AI：</span>
              {batchAiActionNotice}
            </div>
          )}
          {(workspace.githubRecommendationError || workspace.githubRecommendationResponse) && (
            <GithubRecommendationPanel
              errorMessage={workspace.githubRecommendationError}
              response={workspace.githubRecommendationResponse}
              pendingActions={recommendationCandidatePending}
              candidateErrors={recommendationCandidateErrors}
              onUpdateCandidate={handleUpdateRecommendationCandidate}
              onStarCandidate={handleStarRecommendationCandidate}
            />
          )}
          {recommendationActionNotice && (
            <div
              className={`mb-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                recommendationActionNoticeTone === 'error'
                  ? 'border-error/20 bg-error/10 text-error'
                  : 'border-outline-variant/30 bg-surface-container text-on-surface-variant'
              }`}
            >
              <span className="mr-1 font-medium">相似发现：</span>
              {recommendationActionNotice}
            </div>
          )}
            </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {/* 排序与搜索 */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Icon name="filter_list" size={16} className="absolute left-2 top-1.5 text-on-surface-variant" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="w-full rounded-md border border-outline-variant/40 bg-surface py-1 pl-8 pr-7 text-xs text-on-surface shadow-sm appearance-none transition-colors cursor-pointer hover:border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="recent">最近加星</option>
                  <option value="stars">最活跃</option>
                  <option value="name">按名称</option>
                </select>
                <Icon name="expand_more" size={16} className="pointer-events-none absolute right-2 top-1.5 text-on-surface-variant" />
              </div>
            </div>

            {/* 搜索 */}
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2 top-1.5 text-on-surface-variant" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索仓库..."
                className="w-full rounded-md border border-outline-variant/40 bg-surface py-1 pl-8 pr-2.5 text-xs text-on-surface shadow-sm placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* 语言筛选 */}
            <div className="flex gap-2 text-xs">
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="min-w-0 flex-1 cursor-pointer rounded border border-outline-variant/30 bg-surface px-2 py-1 text-on-surface-variant hover:border-outline-variant"
              >
                <option value="">全部语言</option>
                {workspace.repositoryLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
              <select
                value={selectedTagId}
                onChange={(e) => setSelectedTagId(e.target.value)}
                className="min-w-0 flex-1 cursor-pointer rounded border border-outline-variant/30 bg-surface px-2 py-1 text-on-surface-variant hover:border-outline-variant"
              >
                <option value="">全部标签</option>
                {workspace.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 快捷标签 */}
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            <button
              onClick={() => setSelectedTagId('')}
              className="whitespace-nowrap rounded-full bg-primary-container px-2 py-0.5 text-[11px] font-medium text-white transition-all cursor-pointer hover:brightness-110"
            >
              全部 ({workspace.repositoryStats.total})
            </button>
            {workspace.tags.slice(0, 5).map((tag) => (
              <button
                key={tag.id}
                onClick={() => setSelectedTagId(selectedTagId === tag.id ? '' : tag.id)}
                className={`whitespace-nowrap rounded-full border border-outline-variant/30 px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer hover:bg-surface-variant/50 ${
                  selectedTagId === tag.id ? 'bg-primary text-white' : 'text-on-surface'
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>

        {/* 可滚动列表 */}
        <div
          ref={listViewportRef}
          className="flex-1 overflow-y-auto p-1.5 custom-scrollbar"
          onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
        >
          {workspace.isLoadingRepositories && filteredRepos.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Icon name="progress_activity" size={32} className="text-primary animate-spin" />
            </div>
          ) : filteredRepos.length === 0 ? (
            <RepositoryEmptyState
              hasUser={Boolean(workspace.authState.user)}
              hasActiveFilters={hasActiveFilters}
              isSyncing={workspace.isSyncingStars}
              onSync={() => void workspace.handleSyncStars()}
              onClearFilters={() => {
                setSearchKeyword('');
                setSelectedLanguage('');
                setSelectedTagId('');
                void workspace.resetRepositoryFilters();
              }}
            />
          ) : (
            <>
              {viewMode === 'table' && <RepositoryTableHeader />}
              <div className="relative" style={{ height: visibleWindow.totalHeight }}>
                <div
                  className={`absolute left-0 right-0 ${viewMode === 'table' ? 'flex flex-col' : 'flex flex-col'}`}
                  style={{ transform: `translateY(${visibleWindow.offsetY}px)` }}
                >
                  {viewMode === 'table' ? (
                    visibleWindow.items.map((repo) => {
                      const isMarkedForRecommendation = recommendationSelection.has(repo.id);
                      return (
                        <RepositoryTableRow
                          key={repo.id}
                          repo={repo}
                          isSelected={selectedRepo?.id === repo.id}
                          isMarkedForRecommendation={isMarkedForRecommendation}
                          isRecommendationSelectionDisabled={!isMarkedForRecommendation && hasReachedRecommendationSelectionLimit}
                          onClick={() => workspace.setSelectedRepositoryId(repo.id)}
                          onToggleRecommendation={() => toggleRecommendationSelection(repo.id)}
                        />
                      );
                    })
                  ) : (
                    visibleWindow.items.map((repo) => {
                      const isMarkedForRecommendation = recommendationSelection.has(repo.id);
                      return (
                        <div
                          key={repo.id}
                          className="box-border"
                          style={{ height: REPOSITORY_ROW_HEIGHT, paddingBottom: REPOSITORY_CARD_GAP }}
                        >
                          <RepoListItem
                            repo={repo}
                            isSelected={selectedRepo?.id === repo.id}
                            isMarkedForRecommendation={isMarkedForRecommendation}
                            isRecommendationSelectionDisabled={!isMarkedForRecommendation && hasReachedRecommendationSelectionLimit}
                            onClick={() => workspace.setSelectedRepositoryId(repo.id)}
                            onToggleRecommendation={() => toggleRecommendationSelection(repo.id)}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
          </>
        )}
      </div>

      {/* 详情面板 */}
      {selectedRepo ? (
        <RepoDetailPanel
          repo={selectedRepo}
          detail={workspace.repositoryDetail}
          annotation={workspace.annotation}
          tags={workspace.tags}
          isLoadingDetail={workspace.isLoadingRepositoryDetail}
          noteDraft={workspace.noteDraft}
          onNoteChange={workspace.setNoteDraft}
          readingStatusDraft={workspace.readingStatusDraft}
          onReadingStatusChange={workspace.setReadingStatusDraft}
          onSaveAnnotation={workspace.handleSaveAnnotation}
          isSavingAnnotation={workspace.isSavingAnnotation}
          annotationMessage={workspace.annotationMessage}
          isSavingTag={workspace.isSavingTag}
          newTagName={workspace.newTagName}
          newTagColor={workspace.newTagColor}
          onNewTagNameChange={workspace.setNewTagName}
          onNewTagColorChange={workspace.setNewTagColor}
          onCreateTag={workspace.handleCreateTag}
          onToggleRepositoryTag={workspace.handleToggleRepositoryTag}
          onRenameTag={workspace.handleRenameTag}
          onDeleteTag={workspace.handleDeleteTag}
          onApplySuggestedTag={workspace.handleApplySuggestedTag}
          onFetchReadme={() => workspace.handleFetchRepositoryReadme().catch(() => undefined)}
          isFetchingReadme={workspace.isFetchingRepositoryReadme}
          readmeError={
            workspace.repositoryReadmeError?.repositoryId === selectedRepo.id
              ? workspace.repositoryReadmeError.message
              : null
          }
          isGeneratingAiDocument={workspace.isGeneratingAiDocument}
          aiStream={workspace.repositoryAiStream}
          onGenerateAiDocument={() => runAiWorkspaceAction(() => workspace.handleGenerateAiDocument(settingsHook.settings.ai))}
          aiConfigMessage={aiConfigMessage}
          aiError={
            workspace.repositoryAiError?.repositoryId === selectedRepo.id
              ? workspace.repositoryAiError.message
              : null
          }
        />
      ) : viewMode === 'detail' ? (
        <div className="flex-1 glass-card rounded-xl flex items-center justify-center">
          <div className="text-center">
            <Icon name="star" size={64} className="text-on-surface-variant/30 mx-auto mb-4" />
            <p className="text-on-surface-variant font-body-md">选择一个仓库查看详情</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* === 仓库列表项 === */
function RepoListItem(props: {
  repo: RepositoryListItem;
  isSelected: boolean;
  isMarkedForRecommendation: boolean;
  isRecommendationSelectionDisabled: boolean;
  onClick: () => void;
  onToggleRecommendation: () => void;
}) {
  const {
    repo,
    isSelected,
    isMarkedForRecommendation,
    isRecommendationSelectionDisabled,
    onClick,
    onToggleRecommendation,
  } = props;
  const localizedProjectPosition = buildLocalizedProjectPosition(repo, repo.aiKeywords, repo.suggestedTags);

  return (
    <div
      onClick={onClick}
      className={`group relative h-full cursor-pointer overflow-hidden rounded-md p-2 transition-all ${
        isSelected
          ? 'border border-primary/30 bg-primary-fixed/30 shadow-sm'
          : 'bg-surface hover:bg-surface-variant/40 border border-transparent hover:border-outline-variant/20'
      }`}
    >
      {isSelected && <div className="absolute bottom-0 left-0 top-0 w-0.5 rounded-l-md bg-primary" />}
      <div className={`mb-1 flex items-start justify-between gap-2 ${isSelected ? 'pl-1.5' : ''}`}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (isRecommendationSelectionDisabled) {
                return;
              }
              onToggleRecommendation();
            }}
            disabled={isRecommendationSelectionDisabled}
            className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
              isMarkedForRecommendation
                ? 'border-primary bg-primary text-white'
                : isRecommendationSelectionDisabled
                  ? 'cursor-not-allowed border-outline-variant/25 bg-surface-container-low text-transparent opacity-45'
                : 'border-outline-variant/40 bg-surface-container-low text-transparent hover:text-on-surface-variant'
            }`}
            title={
              isMarkedForRecommendation
                ? '取消作为相似发现参考'
                : isRecommendationSelectionDisabled
                  ? `最多选择 ${MAX_RECOMMENDATION_SELECTION} 个参考仓库`
                  : '作为相似发现参考'
            }
          >
            <Icon name="check" size={12} />
          </button>
          <Icon name="book" size={14} className={isSelected ? 'text-primary' : 'text-on-surface-variant'} />
          <h3 className="truncate text-[13px] font-semibold leading-5 text-on-surface">
            {repo.fullName}
          </h3>
        </div>
        <span className="flex shrink-0 items-center gap-0.5 rounded bg-surface-variant/30 px-1.5 py-0.5 text-[10px] text-on-surface-variant">
          <Icon name="star" size={11} /> {compactNumber(repo.starsCount)}
        </span>
      </div>
      <p className={`mb-1 line-clamp-1 text-[11px] leading-4 text-on-surface-variant ${isSelected ? 'pl-1.5' : ''}`}>
        {repo.description ?? '暂无描述'}
      </p>
      <p
        className={`mb-1 line-clamp-1 rounded px-1 py-0.5 text-[10px] leading-4 ${
          isSelected
            ? 'bg-primary/5 pl-1.5 text-primary/80'
            : 'bg-surface-container-low text-on-surface-variant'
        }`}
        title={`${localizedProjectPosition.isPending ? '待定位' : '中文定位'}：${localizedProjectPosition.text}`}
      >
        {localizedProjectPosition.isPending ? '待定位' : '中文定位'}：{localizedProjectPosition.text}
      </p>
      <div className={`flex items-center justify-between ${isSelected ? 'pl-1.5' : ''}`}>
        <div className="flex items-center gap-2">
          {repo.language && (
            <div className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
              <span className="text-[10px] text-on-surface font-label-sm">{repo.language}</span>
            </div>
          )}
        </div>
        <span className="text-[10px] text-on-surface-variant">{formatRelativeTime(repo.starredAt)}</span>
      </div>
    </div>
  );
}

function RepositoryEmptyState(props: {
  hasUser: boolean;
  hasActiveFilters: boolean;
  isSyncing: boolean;
  onSync: () => void;
  onClearFilters: () => void;
}) {
  if (!props.hasUser) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Icon name="account_circle" size={48} className="text-on-surface-variant/30" />
        <div>
          <p className="font-body-md text-on-surface">请先连接 GitHub 账号</p>
          <p className="mt-1 text-xs text-on-surface-variant">连接后即可同步 Stars 并建立本地知识库。</p>
        </div>
      </div>
    );
  }

  if (props.hasActiveFilters) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Icon name="filter_list_off" size={48} className="text-on-surface-variant/30" />
        <div>
          <p className="font-body-md text-on-surface">没有匹配的仓库</p>
          <p className="mt-1 text-xs text-on-surface-variant">清空关键词、语言或标签筛选后再查看。</p>
        </div>
        <button
          type="button"
          onClick={props.onClearFilters}
          className="rounded-lg border border-card-border bg-surface-container-high px-3 py-2 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
        >
          清空筛选
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon name="book" size={48} className="text-on-surface-variant/30" />
      <div>
        <p className="font-body-md text-on-surface">还没有同步仓库</p>
        <p className="mt-1 text-xs text-on-surface-variant">同步 GitHub Stars 后即可浏览、搜索、打标签和生成 AI 摘要。</p>
      </div>
      <button
        type="button"
        onClick={props.onSync}
        disabled={props.isSyncing}
        className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-all hover:brightness-110 disabled:opacity-60"
      >
        {props.isSyncing ? '同步中...' : '同步 Stars'}
      </button>
    </div>
  );
}

function RepositoryTableHeader() {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_80px] items-center gap-3 border-b border-outline-variant/30 bg-surface-container-low/95 px-3 py-2 text-[11px] font-semibold uppercase text-on-surface-variant backdrop-blur lg:grid-cols-[minmax(200px,1.8fr)_minmax(220px,2fr)_110px_90px_110px] xl:grid-cols-[minmax(220px,1.8fr)_minmax(240px,2fr)_120px_100px_120px_120px] xl:gap-4 xl:px-4">
      <span>仓库</span>
      <span>描述</span>
      <span className="hidden lg:block">语言</span>
      <span>Stars</span>
      <span className="hidden lg:block">状态</span>
      <span className="hidden xl:block">最近收藏</span>
    </div>
  );
}

function RepositoryTableRow(props: {
  repo: RepositoryListItem;
  isSelected: boolean;
  isMarkedForRecommendation: boolean;
  isRecommendationSelectionDisabled: boolean;
  onClick: () => void;
  onToggleRecommendation: () => void;
}) {
  const {
    repo,
    isSelected,
    isMarkedForRecommendation,
    isRecommendationSelectionDisabled,
    onClick,
    onToggleRecommendation,
  } = props;
  const localizedProjectPosition = buildLocalizedProjectPosition(repo, repo.aiKeywords, repo.suggestedTags);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_80px] items-center gap-3 border-b border-outline-variant/15 px-3 text-left transition-colors hover:bg-surface-variant/30 lg:grid-cols-[minmax(200px,1.8fr)_minmax(220px,2fr)_110px_90px_110px] xl:grid-cols-[minmax(220px,1.8fr)_minmax(240px,2fr)_120px_100px_120px_120px] xl:gap-4 xl:px-4 ${
        isSelected ? 'bg-primary/10 text-on-surface' : 'bg-surface/40 text-on-surface'
      }`}
      style={{ height: REPOSITORY_TABLE_ROW_HEIGHT }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          role="checkbox"
          aria-checked={isMarkedForRecommendation}
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            if (isRecommendationSelectionDisabled) {
              return;
            }
            onToggleRecommendation();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              if (isRecommendationSelectionDisabled) {
                return;
              }
              onToggleRecommendation();
            }
          }}
          className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
            isMarkedForRecommendation
              ? 'border-primary bg-primary text-white'
              : isRecommendationSelectionDisabled
                ? 'cursor-not-allowed border-outline-variant/25 bg-surface-container-low text-transparent opacity-45'
              : 'border-outline-variant/40 bg-surface-container-low text-transparent hover:text-on-surface-variant'
          }`}
          title={
            isMarkedForRecommendation
              ? '取消作为相似发现参考'
              : isRecommendationSelectionDisabled
                ? `最多选择 ${MAX_RECOMMENDATION_SELECTION} 个参考仓库`
                : '作为相似发现参考'
          }
        >
          <Icon name="check" size={14} />
        </span>
        <Icon name="book" size={16} className={isSelected ? 'text-primary' : 'text-on-surface-variant'} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{repo.fullName}</span>
          <span className="mt-0.5 block truncate text-[11px] text-on-surface-variant" title={`${localizedProjectPosition.isPending ? '待定位' : '中文定位'}：${localizedProjectPosition.text}`}>
            {localizedProjectPosition.isPending ? '待定位' : '中文定位'}：{localizedProjectPosition.text}
          </span>
        </span>
      </span>
      <span className="truncate text-sm text-on-surface-variant">{repo.description ?? '暂无描述'}</span>
      <span className="hidden items-center gap-1.5 text-sm lg:flex">
        <span className="size-2 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
        <span className="truncate">{repo.language ?? '其他'}</span>
      </span>
      <span className="flex items-center gap-1 text-sm font-medium">
        <Icon name="star" size={14} />
        {compactNumber(repo.starsCount)}
      </span>
      <span className="hidden flex-wrap gap-1 lg:flex">
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${repo.hasReadme ? 'bg-success/10 text-success' : 'bg-outline-variant/20 text-on-surface-variant'}`}>
          {repo.hasReadme ? 'README' : '待抓取'}
        </span>
        {repo.aiSummary && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">AI</span>
        )}
      </span>
      <span className="hidden text-xs text-on-surface-variant xl:block">{formatRelativeTime(repo.starredAt)}</span>
    </button>
  );
}

/* === 仓库详情面板 === */
function BatchAiSummaryPanel({ summary }: { summary: NonNullable<ReturnType<typeof useWorkspace>['batchAiSummary']> }) {
  const shownFailures = summary.failures.slice(0, 3);
  const hiddenFailureCount = Math.max(summary.failures.length - shownFailures.length, 0);

  return (
    <div
      className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${
        summary.failedCount > 0
          ? 'border-error/20 bg-error/10 text-error'
          : 'border-primary/20 bg-primary/5 text-on-surface-variant'
      }`}
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>已生成 {summary.generatedCount} 个</span>
        <span>跳过 {summary.skippedCount} 个</span>
        <span>缺少 README {summary.missingReadmeCount} 个</span>
        <span>失败 {summary.failedCount} 个</span>
      </div>
      {shownFailures.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-current/10 pt-2">
          <p className="font-medium">失败仓库已跳过，已生成的摘要和本地数据不会回滚。</p>
          {shownFailures.map((failure) => (
            <p key={`${failure.repositoryId}-${failure.fullName}`} className="line-clamp-2">
              {failure.fullName}：{failure.error}
            </p>
          ))}
          {hiddenFailureCount > 0 && <p>还有 {hiddenFailureCount} 个失败项，请稍后分批重试或检查 AI 配置。</p>}
          <p>如果是上下文超限或接口超时，可以换用更大上下文模型、降低批量数量，或稍后重试。</p>
        </div>
      )}
    </div>
  );
}

function AiErrorPlaceholder({
  message,
  onRetry,
  canRetry,
  isRetrying,
  retryTitle,
}: {
  message: string;
  onRetry: () => void;
  canRetry: boolean;
  isRetrying: boolean;
  retryTitle: string;
}) {
  return (
    <div className="mb-4 rounded-lg border border-error/20 bg-error/10 px-3 py-3 text-[12px] leading-relaxed text-error">
      <div className="flex items-start gap-2">
        <Icon name="error" size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">AI 摘要暂未生成，本地 README 和仓库数据已保留。</p>
          <p>{message}</p>
          <p className="text-error/80">可以检查 AI 配置、换用更大上下文模型，或稍后重新生成。</p>
          <button
            type="button"
            onClick={onRetry}
            disabled={!canRetry}
            title={retryTitle}
            className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-error/25 bg-surface px-3 py-1.5 text-[11px] font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name={isRetrying ? 'progress_activity' : 'refresh'} size={14} className={isRetrying ? 'animate-spin' : ''} />
            {isRetrying ? '重新生成中' : '重新生成 AI 解析'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AiStreamPreview({
  stream,
}: {
  stream: {
    stage: string;
    status: string;
    message: string | null;
    text: string;
  } | null;
}) {
  const stageLabel = stream ? getAiStreamStageLabel(stream.stage) : '准备解析';
  const statusLabel = stream?.status === 'fallback'
    ? '当前服务不支持流式，正在自动切换'
    : stream?.status === 'failed'
      ? '解析失败'
      : stream?.status === 'finished'
        ? '解析完成'
        : '实时生成中';
  const liveText = stream?.text.trim();

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-3 text-[12px] leading-relaxed text-primary">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Icon name="progress_activity" size={14} className={stream?.status === 'finished' ? '' : 'animate-spin'} />
          <span className="truncate">{stageLabel}</span>
        </div>
        <span className="shrink-0 rounded-md bg-surface/70 px-2 py-0.5 text-[10px] text-primary">
          {statusLabel}
        </span>
      </div>
      {stream?.message && (
        <p className="mb-2 text-[11px] text-on-surface-variant">{stream.message}</p>
      )}
      <div className="max-h-40 overflow-y-auto rounded-md border border-primary/15 bg-surface-container-lowest/80 px-2 py-2 text-[11px] text-on-surface custom-scrollbar">
        {liveText ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{liveText}</pre>
        ) : (
          <p className="text-on-surface-variant">正在等待 AI 返回内容...</p>
        )}
      </div>
    </div>
  );
}

function getAiStreamStageLabel(stage: string) {
  switch (stage) {
    case 'prepare':
      return '准备解析';
    case 'fetch-readme':
      return '补抓 README';
    case 'summarize':
      return '生成中文解析';
    case 'done':
      return '解析完成';
    case 'error':
      return '解析失败';
    default:
      return 'AI 解析';
  }
}

function AiMetaItem(props: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-outline-variant/20 bg-surface-container-low px-2.5 py-2">
      <p className="mb-1 text-[10px] text-on-surface-variant">{props.label}</p>
      <p className="font-medium text-on-surface [overflow-wrap:anywhere]" title={props.value}>{props.value}</p>
    </div>
  );
}

function GithubRecommendationPanel(props: {
  response: GithubRecommendationResponse | null;
  errorMessage: string | null;
  pendingActions: Record<string, RecommendationCandidateAction>;
  candidateErrors: Record<string, string>;
  onUpdateCandidate: (fullName: string, status: Exclude<RecommendationCandidateStatus, 'starred'>) => Promise<void>;
  onStarCandidate: (fullName: string) => Promise<void>;
}) {
  if (props.errorMessage && !props.response) {
    return (
      <div className="mb-3 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[11px] leading-relaxed text-error">
        {props.errorMessage}
      </div>
    );
  }

  if (!props.response) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex items-start gap-2">
        <Icon name="travel_explore" size={16} className="mt-0.5 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">GitHub 相似项目发现</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-on-surface-variant">
            {props.response.rationaleZh}
          </p>
          {props.response.results.length > 0 && (
            <p className="mt-1 text-[10px] text-on-surface-variant">
              本次返回 {props.response.results.length} 个候选项目，全部可标记、忽略或加入 Stars。
            </p>
          )}
        </div>
      </div>
      {props.errorMessage && (
        <div className="mb-2 rounded-md border border-error/20 bg-error/10 px-2 py-1.5 text-[11px] leading-relaxed text-error">
          {props.errorMessage}
        </div>
      )}
      {props.response.searchFailures.length > 0 && (
        <div className="mb-2 rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
          已保留成功找到的候选项目，{props.response.searchFailures.length} 个 GitHub 搜索式暂未完成，可稍后重试补全。
        </div>
      )}
      {props.response.results.length === 0 ? (
        <p className="rounded-md bg-surface-container-low px-2 py-1.5 text-[11px] text-on-surface-variant">
          暂未找到未收藏过的相似项目，可以换几个参考仓库再试。
        </p>
      ) : (
        <div className="space-y-2">
          {props.response.results.map((repository) => {
            const candidateStatus = repository.candidateStatus ?? 'new';
            const isStarred = candidateStatus === 'starred';
            const pendingAction = props.pendingActions[repository.fullName] ?? null;
            const candidateError = props.candidateErrors[repository.fullName] ?? null;
            const isPending = Boolean(pendingAction);
            const statusLabel = candidateStatus === 'marked'
              ? '已标记'
              : candidateStatus === 'ignored'
                ? '已忽略'
                : isStarred
                  ? '已加入 Stars'
                  : '候选';
            return (
            <div
              key={repository.fullName}
              className="rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2 transition-colors hover:border-primary/30 hover:bg-surface-container"
            >
              <div className="flex items-start justify-between gap-2">
                <a
                  href={repository.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-xs font-semibold text-primary hover:underline"
                >
                  {repository.fullName}
                </a>
                <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] text-on-surface-variant">
                  {statusLabel}
                </span>
              </div>
              <span className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-on-surface-variant">
                {repository.description ?? '暂无描述'}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-on-surface-variant">
                <span>★ {compactNumber(repository.starsCount)}</span>
                <span>{repository.language ?? '其他语言'}</span>
                {repository.topics.slice(0, 3).map((topic) => (
                  <span key={topic} className="rounded bg-surface-container-high px-1.5 py-0.5">
                    {topic}
                  </span>
                ))}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void props.onStarCandidate(repository.fullName)}
                  disabled={isStarred || isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/25 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-outline-variant/25 disabled:text-on-surface-variant disabled:hover:bg-transparent"
                >
                  <Icon
                    name={pendingAction === 'star' ? 'progress_activity' : isStarred ? 'done' : 'star'}
                    size={12}
                    className={pendingAction === 'star' ? 'animate-spin' : ''}
                  />
                  {pendingAction === 'star' ? '加入中' : isStarred ? '已加入 Stars' : '加入 Stars'}
                </button>
                <button
                  type="button"
                  disabled={isStarred || isPending}
                  onClick={() => void props.onUpdateCandidate(repository.fullName, candidateStatus === 'marked' ? 'new' : 'marked')}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/25 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-outline-variant/25 disabled:text-on-surface-variant disabled:hover:bg-transparent"
                >
                  {pendingAction === 'mark' && <Icon name="progress_activity" size={12} className="animate-spin" />}
                  {pendingAction === 'mark' ? '处理中' : candidateStatus === 'marked' ? '取消标记' : '标记'}
                </button>
                <button
                  type="button"
                  disabled={isStarred || isPending}
                  onClick={() => void props.onUpdateCandidate(repository.fullName, candidateStatus === 'ignored' ? 'new' : 'ignored')}
                  className="inline-flex items-center gap-1 rounded-md border border-outline-variant/30 px-2 py-1 text-[10px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  {pendingAction === 'ignore' && <Icon name="progress_activity" size={12} className="animate-spin" />}
                  {pendingAction === 'ignore' ? '处理中' : candidateStatus === 'ignored' ? '恢复候选' : '忽略'}
                </button>
              </div>
              {candidateError && (
                <p className="mt-2 rounded-md border border-error/20 bg-error/10 px-2 py-1 text-[10px] leading-relaxed text-error">
                  {candidateError}
                </p>
              )}
            </div>
          );
          })}
        </div>
      )}
      {props.response.queries.length > 0 && (
        <details className="mt-2 text-[11px] text-on-surface-variant">
          <summary className="cursor-pointer">查看 GitHub 搜索式</summary>
          <div className="mt-1 space-y-1">
            {props.response.queries.map((query) => (
              <code key={query} className="block rounded bg-surface-container-low px-2 py-1">
                {query}
              </code>
            ))}
          </div>
        </details>
      )}
      {props.response.searchFailures.length > 0 && (
        <details className="mt-2 text-[11px] text-warning">
          <summary className="cursor-pointer">查看未完成的搜索式</summary>
          <div className="mt-1 space-y-1">
            {props.response.searchFailures.map((failure) => (
              <div key={failure.query} className="rounded bg-warning/10 px-2 py-1">
                <code className="block text-warning">{failure.query}</code>
                <p className="mt-1 text-[10px] leading-relaxed text-warning/90">{failure.error}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RepoDetailPanel(props: {
  repo: RepositoryListItem;
  detail: RepositoryDetailView | null;
  annotation: RepositoryAnnotationView | null;
  tags: TagItem[];
  isLoadingDetail: boolean;
  noteDraft: string;
  onNoteChange: (value: string) => void;
  readingStatusDraft: ReadingStatus;
  onReadingStatusChange: (value: ReadingStatus) => void;
  onSaveAnnotation: () => Promise<void>;
  isSavingAnnotation: boolean;
  annotationMessage: string | null;
  isSavingTag: boolean;
  newTagName: string;
  newTagColor: string;
  onNewTagNameChange: (value: string) => void;
  onNewTagColorChange: (value: string) => void;
  onCreateTag: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onToggleRepositoryTag: (tag: TagItem) => Promise<void>;
  onRenameTag: (tag: TagItem, nextName: string) => Promise<void>;
  onDeleteTag: (tag: TagItem) => Promise<void>;
  onApplySuggestedTag: (tagName: string) => Promise<void>;
  onFetchReadme: () => Promise<void>;
  isFetchingReadme: boolean;
  readmeError: string | null;
  onGenerateAiDocument: () => Promise<void>;
  isGeneratingAiDocument: boolean;
  aiStream: {
    repositoryId: string;
    stage: string;
    status: string;
    message: string | null;
    text: string;
  } | null;
  aiConfigMessage: string | null;
  aiError: string | null;
}) {
  const {
    repo,
    detail,
    annotation,
    tags,
    isLoadingDetail,
    noteDraft,
    onNoteChange,
    readingStatusDraft,
    onReadingStatusChange,
    onSaveAnnotation,
    isSavingAnnotation,
    annotationMessage,
    isSavingTag,
    newTagName,
    newTagColor,
    onNewTagNameChange,
    onNewTagColorChange,
    onCreateTag,
    onToggleRepositoryTag,
    onRenameTag,
    onDeleteTag,
    onApplySuggestedTag,
    onFetchReadme,
    isFetchingReadme,
    readmeError,
    onGenerateAiDocument,
    isGeneratingAiDocument,
    aiStream,
    aiConfigMessage,
    aiError,
  } = props;
  const aiDoc = detail?.aiDocument;
  const selectedTagIds = new Set(annotation?.tags.map((tag) => tag.id) ?? []);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null);
  const canGenerateAiDocument = !isGeneratingAiDocument && !isFetchingReadme && !isLoadingDetail && !aiConfigMessage;
  const aiActionTitle = aiConfigMessage
    ?? (isFetchingReadme
      ? 'README 正在抓取中'
      : !detail?.readme
        ? '将自动抓取 README 后生成 AI 解析'
        : aiDoc
          ? '更新 AI 解析'
          : 'AI 解析');
  const readmeStatusLabel = detail?.readme ? 'README 已缓存' : repo.hasReadme ? '列表显示已缓存，正在载入详情' : 'README 待抓取';
  const aiStatusLabel = aiDoc ? 'AI 已解析' : repo.aiSummary ? '列表已有摘要，正在载入详情' : 'AI 待解析';
  const knowledgeTitle = buildKnowledgeTitle(repo, aiDoc?.keywords ?? repo.aiKeywords);
  const fallbackAiSummary = repo.aiSummary?.trim();
  const localizedProjectPosition = buildLocalizedProjectPosition(
    repo,
    aiDoc?.keywords ?? repo.aiKeywords,
    aiDoc?.suggestedTags ?? repo.suggestedTags,
    aiDoc?.summaryZh,
  );
  const visibleKnowledgeTags = uniqueStrings([
    ...(aiDoc?.suggestedTags ?? repo.suggestedTags),
    ...(aiDoc?.keywords ?? repo.aiKeywords),
    ...repo.topics,
  ]).slice(0, 10);
  const readmeHeadings = useMemo(
    () => extractReadmeHeadings(detail?.readme?.rawMarkdown ?? '').slice(0, 12),
    [detail?.readme?.rawMarkdown],
  );
  const readmeCharCount = useMemo(
    () => Array.from(detail?.readme?.rawMarkdown ?? '').length,
    [detail?.readme?.rawMarkdown],
  );
  const shouldShowReadmeTruncationWarning = Boolean(
    aiDoc
      && detail?.readme
      && aiDoc.sourceHash === detail.readme.contentHash
      && readmeCharCount > README_SUMMARY_PROMPT_CHAR_LIMIT,
  );
  const readmePromptCoverage = readmeCharCount > 0
    ? Math.round((README_SUMMARY_PROMPT_CHAR_LIMIT / readmeCharCount) * 100)
    : 100;
  const canApplySuggestedTags = Boolean(aiDoc?.suggestedTags.length);
  const visibleAiStream = aiStream?.repositoryId === repo.id ? aiStream : null;

  async function submitRenameTag(tag: TagItem) {
    await onRenameTag(tag, editingTagName);
    setEditingTagId(null);
    setEditingTagName('');
  }

  async function confirmDeleteTag(tag: TagItem) {
    await onDeleteTag(tag);
    if (deleteTagId === tag.id) {
      setDeleteTagId(null);
    }
  }

  async function applyAllSuggestedTags() {
    if (!aiDoc) {
      return;
    }

    for (const tag of aiDoc.suggestedTags) {
      await onApplySuggestedTag(tag);
    }
  }

  return (
    <div className="flex min-w-0 flex-col overflow-visible rounded-lg border border-card-border glass-panel shadow-sm md:min-h-0 md:flex-1 md:overflow-hidden">
      {/* 详情标题区 */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-card-border bg-surface/45 px-2.5 py-2 backdrop-blur-md md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-outline-variant/30 bg-surface-container-lowest p-1">
              <Icon name="book" size={14} className="text-on-surface-variant" />
            </div>
            <h2 className="min-w-0 flex-1 truncate text-lg font-bold leading-6 tracking-normal text-on-surface xl:text-xl">
              {repo.fullName}
            </h2>
          </div>
          <p className="line-clamp-1 max-w-4xl text-xs leading-5 text-on-surface-variant">{repo.description ?? '暂无描述'}</p>
          {/* 统计信息 */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
            <div className="flex items-center gap-1 text-xs text-on-surface-variant">
              <Icon name="star" size={14} />
              <span className="font-medium">{compactNumber(repo.starsCount)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-on-surface-variant">
              <Icon name="fork_right" size={14} />
              <span className="font-medium">{compactNumber(repo.forksCount)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-on-surface-variant">
              <span className="size-2 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
              <span className="font-medium">{repo.language ?? '其他'}</span>
            </div>
            <span className="min-w-0 truncate rounded border border-primary/15 bg-primary/5 px-1.5 py-0.5 text-[11px] text-on-surface-variant">
              {localizedProjectPosition.text}
            </span>
          </div>
        </div>
        <a
          href={repo.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-outline-variant/35 bg-surface-container-low px-2.5 py-1.5 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Icon name="open_in_new" size={15} /> 在浏览器打开
        </a>
      </div>

      {/* 可滚动详情内容 */}
      <div className="bg-surface-container-lowest/30 p-2 md:min-h-0 md:flex-1 md:overflow-hidden xl:p-2.5">
        <div className="grid min-w-0 grid-cols-1 gap-2 md:h-full md:min-h-0 md:grid-cols-[minmax(0,1fr)_clamp(252px,28vw,330px)] md:overflow-hidden xl:grid-cols-[minmax(0,1fr)_clamp(270px,27vw,360px)] 2xl:grid-cols-[112px_minmax(0,1fr)_360px]">
        {/* README 目录 */}
        <nav className="hidden min-h-0 min-w-0 overflow-y-auto border-r border-outline-variant/20 pr-2 custom-scrollbar 2xl:block">
          <p className="mb-2 text-xs font-semibold text-on-surface">目录</p>
          {readmeHeadings.length > 0 ? (
            <div className="space-y-1.5">
              {readmeHeadings.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  onClick={() => document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-surface-container-high hover:text-primary xl:px-2 xl:py-1 xl:text-xs ${
                    heading.depth <= 2 ? 'font-medium text-on-surface' : 'pl-4 text-on-surface-variant'
                  }`}
                  title={heading.text}
                >
                  {heading.text}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-on-surface-variant">抓取 README 后显示章节目录。</p>
          )}
        </nav>

        {/* README 正文 */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
          {/* README 内容 */}
          <div className="flex min-h-[380px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-card-border bg-surface/60 p-2 shadow-sm backdrop-blur-sm md:min-h-0">
            <div className="mb-2 flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon name="description" size={16} className="text-primary" />
                  <h3 className="text-base font-semibold leading-6 text-on-surface">README</h3>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-on-surface-variant">
                  原文用于核对项目安装、API、示例和限制；右侧 AI 解析会基于当前缓存生成。
                </p>
              </div>
              {detail?.readme && (
                <span className="shrink-0 rounded-md border border-outline-variant/25 bg-surface-container-low px-2 py-0.5 text-[10px] text-on-surface-variant">
                  {detail.readme.sourcePath} · {formatDateTime(detail.readme.fetchedAt)}
                </span>
              )}
            </div>
            {readmeError && (
              <div className="mb-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs leading-relaxed text-error">
                {readmeError}
              </div>
            )}
            {isLoadingDetail ? (
              <div className="flex min-h-0 flex-1 items-center justify-center py-8">
                <Icon name="progress_activity" size={24} className="text-primary animate-spin" />
              </div>
            ) : detail?.readme ? (
              <div className="min-h-0 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <ReadmeRenderer
                  markdown={detail.readme.rawMarkdown}
                  repositoryFullName={repo.fullName}
                  sourcePath={detail.readme.sourcePath}
                  className="readme-rendered readme-rendered-compact min-w-0 rounded-md border border-outline-variant/20 bg-surface-container-lowest/70 p-3 text-on-surface"
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-8 text-on-surface-variant">
                <Icon name="book" size={48} className="opacity-30" />
                <p className="font-body-md text-sm">该仓库暂无 README 缓存，可以先抓取 README，也可以直接点击 AI 解析自动补抓。</p>
                <button
                  type="button"
                  onClick={() => void onFetchReadme()}
                  disabled={isFetchingReadme}
                  className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-all hover:brightness-110 disabled:opacity-60"
                >
                  {isFetchingReadme ? '抓取中...' : '抓取当前 README'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右侧 AI 洞察栏 */}
        <div className="min-h-[460px] min-w-0 md:min-h-0">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-primary/20 bg-surface/80 p-2.5 shadow-sm backdrop-blur-sm">
            <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon name="auto_awesome" size={16} className="text-primary" />
                  <h3 className="text-base font-semibold leading-6 text-primary">AI 项目知识卡</h3>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-on-surface-variant">{knowledgeTitle}</p>
                <p className="mt-1 line-clamp-2 rounded-md border border-primary/15 bg-primary/5 px-2 py-1 text-[11px] leading-4 text-on-surface">
                  <span className="mr-1 font-semibold text-primary">中文名称/定位</span>
                  {localizedProjectPosition.text}
                </p>
              </div>
              <div className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                GSAT
              </div>
            </div>
            <div className="mb-2 flex shrink-0 flex-wrap gap-1.5 text-[11px]">
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                detail?.readme
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant'
              }`}
              >
                <Icon name="description" size={13} />
                {readmeStatusLabel}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                aiDoc
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant'
              }`}
              >
                <Icon name="psychology" size={13} />
                {aiStatusLabel}
              </span>
            </div>
            {visibleKnowledgeTags.length > 0 && (
              <div className="mb-2 rounded-md border border-outline-variant/20 bg-surface-container-low/60 px-2 py-1.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-on-surface">
                  <Icon name="hub" size={13} />
                  项目画像
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {visibleKnowledgeTags.slice(0, 8).map((tag) => (
                    <span key={tag} className="rounded-md bg-surface-container-high px-2 py-0.5 text-[10px] text-on-surface-variant">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {aiConfigMessage && (
              <div className="mb-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] leading-relaxed text-error">
                {aiConfigMessage}
              </div>
            )}
            {!detail?.readme && !isLoadingDetail && !readmeError && (
              <div className="mb-4 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-on-surface-variant">
                可以先抓取 README，也可以直接点击 AI 解析；系统会自动补抓 README 并生成中文解析、关键词和建议标签。
              </div>
            )}
            {aiError && (
              <AiErrorPlaceholder
                message={aiError}
                onRetry={() => void onGenerateAiDocument()}
                canRetry={canGenerateAiDocument}
                isRetrying={isGeneratingAiDocument}
                retryTitle={aiActionTitle}
              />
            )}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
              {isGeneratingAiDocument && (
                <AiStreamPreview stream={visibleAiStream} />
              )}
              {shouldShowReadmeTruncationWarning && (
                <div className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-on-surface-variant">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-on-surface">
                    <Icon name="warning" size={14} />
                    README 较长，摘要可能不完整
                  </div>
                  <p>
                    当前 README 约 {compactNumber(readmeCharCount)} 字符，AI 摘要基于前 {compactNumber(README_SUMMARY_PROMPT_CHAR_LIMIT)} 字符生成，覆盖约 {readmePromptCoverage}%。建议核对左侧原文的安装、用法和限制章节。
                  </p>
                </div>
              )}
              {/* AI 摘要 */}
              {aiDoc ? (
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-3">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-on-surface font-label-sm">
                    <Icon name="summarize" size={14} /> 中文摘要
                  </h4>
                  <p className="text-[12px] text-on-surface-variant leading-relaxed">{aiDoc.summaryZh}</p>
                </div>
              ) : fallbackAiSummary ? (
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-3">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-on-surface font-label-sm">
                    <Icon name="summarize" size={14} /> 当前摘要
                  </h4>
                  <p className="text-[12px] leading-relaxed text-on-surface-variant">{fallbackAiSummary}</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-on-surface-variant">
                    完整 AI 解析生成后，会补充 README 梳理、关键词和建议标签。
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-low/40 px-3 py-4 text-on-surface-variant">
                  <Icon name="psychology" size={32} className="opacity-30" />
                  <p className="text-[12px]">暂无 AI 解析</p>
                  <p className="max-w-[260px] text-center text-[11px] leading-relaxed">点击 AI 解析后，会生成中文摘要、README 梳理、关键词和建议标签。</p>
                </div>
              )}

              {/* README 结构拆解 */}
              {aiDoc ? (
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-3">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-on-surface font-label-sm">
                    <Icon name="article" size={14} /> README 梳理
                  </h4>
                  {aiDoc.readmeZh ? (
                    <p className="text-[12px] text-on-surface-variant leading-relaxed whitespace-pre-wrap">{aiDoc.readmeZh}</p>
                  ) : (
                    <p className="rounded-lg bg-surface-container-low px-3 py-2 text-[12px] text-on-surface-variant">
                      当前 AI 解析没有单独输出 README 梳理，可以点击更新 AI 解析重新生成。
                    </p>
                  )}
                </div>
              ) : null}

              {/* 关键词 */}
              {aiDoc && aiDoc.keywords.length > 0 && (
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-3">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-on-surface font-label-sm">
                    <Icon name="key" size={14} /> 关键词
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {aiDoc.keywords.map((kw, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-surface-variant/30 text-on-surface-variant text-[10px] font-label-sm"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 建议标签 */}
              {aiDoc && aiDoc.suggestedTags.length > 0 && (
                <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-1 text-xs font-semibold text-on-surface font-label-sm">
                      <Icon name="recommend" size={14} /> 建议标签
                    </h4>
                    <button
                      type="button"
                      onClick={() => void applyAllSuggestedTags().catch(() => undefined)}
                      disabled={isSavingTag || !canApplySuggestedTags}
                      className="rounded-md px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                    >
                      全部应用
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {aiDoc.suggestedTags.map((tag) => (
                      <button
                        type="button"
                        key={tag}
                        onClick={() => void onApplySuggestedTag(tag)}
                        disabled={isSavingTag}
                        className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-label-sm hover:bg-primary/20 disabled:opacity-60"
                        title="创建并应用此标签"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {aiDoc && (
                <details className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-2 text-[11px]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-on-surface marker:hidden">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="analytics" size={14} />
                      生成信息
                    </span>
                    <span className="text-[10px] font-normal text-on-surface-variant">
                      {compactNumber(aiDoc.inputTokens)} / {compactNumber(aiDoc.outputTokens)} tokens
                    </span>
                  </summary>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                    <AiMetaItem label="模型" value={aiDoc.model} />
                    <AiMetaItem label="生成时间" value={formatDateTime(aiDoc.generatedAt)} />
                    <AiMetaItem label="输入" value={`${compactNumber(aiDoc.inputTokens)} tokens`} />
                    <AiMetaItem label="输出" value={`${compactNumber(aiDoc.outputTokens)} tokens`} />
                    <AiMetaItem label="Prompt" value={aiDoc.promptVersion} />
                    <AiMetaItem label="来源哈希" value={shortHash(aiDoc.sourceHash)} />
                  </div>
                </details>
              )}

              {/* 仓库 Topics */}
              {repo.topics.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2 font-label-sm flex items-center gap-1">
                    <Icon name="topic" size={14} /> 仓库 Topics
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {repo.topics.map((topic) => (
                      <span
                        key={topic}
                        className="px-2 py-0.5 rounded bg-surface-variant/20 text-on-surface-variant text-[10px] font-label-sm"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low/70 px-3 py-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1 text-xs font-semibold text-on-surface font-label-sm">
                    <Icon name="edit_note" size={14} /> 笔记与标签
                  </h4>
                  <button
                    onClick={() => void onSaveAnnotation()}
                    disabled={isSavingAnnotation}
                    className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-white transition-colors hover:brightness-110 disabled:opacity-60"
                  >
                    {isSavingAnnotation ? '保存中' : '保存'}
                  </button>
                </div>
                {annotationMessage && (
                  <div className="mb-3 rounded-md border border-primary/20 bg-primary/10 px-2 py-1.5 text-[11px] text-primary">
                    {annotationMessage}
                  </div>
                )}
                <label className="mb-3 grid gap-1.5 text-[11px] font-label-sm text-on-surface-variant">
                  阅读状态
                  <select
                    value={readingStatusDraft}
                    onChange={(event) => onReadingStatusChange(event.target.value as ReadingStatus)}
                    className="rounded-md border border-outline-variant/30 bg-surface px-2 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="unread">未读</option>
                    <option value="later">稍后阅读</option>
                    <option value="read">已读</option>
                  </select>
                </label>
                <div className="mb-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-label-sm text-on-surface-variant">仓库标签</span>
                    {isSavingTag && <span className="text-[10px] text-primary">保存中</span>}
                  </div>
                  {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => {
                        const isSelected = selectedTagIds.has(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => void onToggleRepositoryTag(tag)}
                            disabled={isSavingTag}
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-label-sm transition-colors disabled:opacity-60 ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-outline-variant/30 bg-surface text-on-surface-variant hover:border-primary/40 hover:text-on-surface'
                            }`}
                            style={
                              tag.color && isSelected
                                ? { backgroundColor: `${tag.color}20`, borderColor: tag.color, color: tag.color }
                                : undefined
                            }
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-on-surface-variant">还没有标签。</p>
                  )}
                </div>
                <form
                  onSubmit={(event) => void onCreateTag(event)}
                  className="mb-3 grid grid-cols-[1fr_34px] gap-2"
                >
                  <input
                    value={newTagName}
                    onChange={(event) => onNewTagNameChange(event.target.value)}
                    placeholder="新标签"
                    className="min-w-0 rounded-md border border-outline-variant/30 bg-surface px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    aria-label="标签颜色"
                    type="color"
                    value={newTagColor}
                    onChange={(event) => onNewTagColorChange(event.target.value)}
                    className="h-8 w-full rounded-md border border-outline-variant/30 bg-surface p-1"
                  />
                  <button
                    type="submit"
                    disabled={isSavingTag || newTagName.trim().length === 0}
                    className="col-span-2 rounded-md border border-card-border bg-surface-container-high px-2 py-1.5 text-xs text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-60"
                  >
                    添加标签
                  </button>
                </form>
                {tags.length > 0 && (
                  <details className="mb-3 rounded-md border border-outline-variant/20 bg-surface/70 px-2 py-1.5 text-[11px] text-on-surface-variant">
                    <summary className="cursor-pointer font-label-sm text-on-surface">管理标签</summary>
                    <div className="mt-2 grid gap-1.5">
                      {tags.map((tag) => {
                        const isEditing = editingTagId === tag.id;
                        const isConfirmingDelete = deleteTagId === tag.id;

                        return (
                          <div key={tag.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
                            {isEditing ? (
                              <input
                                value={editingTagName}
                                onChange={(event) => setEditingTagName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    void submitRenameTag(tag);
                                  }
                                  if (event.key === 'Escape') {
                                    setEditingTagId(null);
                                    setEditingTagName('');
                                  }
                                }}
                                className="min-w-0 rounded-md border border-outline-variant/30 bg-surface px-2 py-1 text-[11px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                autoFocus
                              />
                            ) : (
                              <span className="truncate">{tag.name}</span>
                            )}
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void submitRenameTag(tag)}
                                  disabled={isSavingTag || editingTagName.trim().length === 0}
                                  className="rounded-md px-1.5 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
                                >
                                  保存
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTagId(null);
                                    setEditingTagName('');
                                  }}
                                  disabled={isSavingTag}
                                  className="rounded-md px-1.5 py-1 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
                                >
                                  取消
                                </button>
                              </>
                            ) : isConfirmingDelete ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void confirmDeleteTag(tag)}
                                  disabled={isSavingTag}
                                  className="rounded-md px-1.5 py-1 text-error hover:bg-error/10 disabled:opacity-60"
                                >
                                  删除
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteTagId(null)}
                                  disabled={isSavingTag}
                                  className="rounded-md px-1.5 py-1 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTagId(tag.id);
                                    setEditingTagName(tag.name);
                                    setDeleteTagId(null);
                                  }}
                                  disabled={isSavingTag}
                                  className="rounded-md px-1.5 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
                                >
                                  改名
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteTagId(tag.id);
                                    setEditingTagId(null);
                                    setEditingTagName('');
                                  }}
                                  disabled={isSavingTag}
                                  className="rounded-md px-1.5 py-1 text-error hover:bg-error/10 disabled:opacity-60"
                                >
                                  删除
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
                <textarea
                  value={noteDraft}
                  onChange={(e) => onNoteChange(e.target.value)}
                  placeholder="为这个仓库写下你的笔记..."
                  className="min-h-[88px] w-full resize-y rounded-md border border-outline-variant/30 bg-surface px-2 py-2 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="mt-3 grid shrink-0 gap-2 border-t border-outline-variant/20 pt-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
              <button
                type="button"
                onClick={() => void onFetchReadme()}
                disabled={isFetchingReadme || isLoadingDetail}
                className="flex items-center justify-center gap-2 rounded-lg border border-outline-variant/35 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
                title={detail?.readme ? '更新 README 缓存' : '抓取当前 README'}
              >
                <Icon name={isFetchingReadme ? 'progress_activity' : 'description'} size={16} className={isFetchingReadme ? 'animate-spin' : ''} />
                {isFetchingReadme ? '抓取中' : detail?.readme ? '更新 README' : '抓取 README'}
              </button>
              <button
                type="button"
                onClick={() => void onGenerateAiDocument()}
                disabled={!canGenerateAiDocument}
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-60"
                title={aiActionTitle}
              >
                <Icon name={isGeneratingAiDocument ? 'progress_activity' : 'auto_awesome'} size={16} className={isGeneratingAiDocument ? 'animate-spin' : ''} />
                {isGeneratingAiDocument ? '解析中...' : aiDoc ? '更新 AI 解析' : 'AI 解析'}
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

type ReadmeHeadingItem = {
  id: string;
  text: string;
  depth: number;
};

function extractReadmeHeadings(markdown: string): ReadmeHeadingItem[] {
  const slugCounts = new Map<string, number>();
  const headings: ReadmeHeadingItem[] = [];
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const text = match[2]
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim();
    if (!text) {
      continue;
    }

    const baseSlug = createReadmeHeadingSlug(text) || 'section';
    const currentCount = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, currentCount + 1);
    headings.push({
      id: currentCount === 0 ? baseSlug : `${baseSlug}-${currentCount}`,
      text: truncateText(text, 28),
      depth: match[1].length,
    });
  }

  return headings;
}

function createReadmeHeadingSlug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return '刚刚';
  if (diffH < 24) return `${diffH}小时前活跃`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return '1天前活跃';
  return `${diffD}天前活跃`;
}

function buildKnowledgeTitle(repo: RepositoryListItem, keywords: string[]) {
  const keywordText = keywords.slice(0, 3).join('、');
  const baseName = repo.name.replace(/[-_]/g, ' ');
  if (keywordText) {
    return `${baseName}：${keywordText} 相关项目`;
  }
  if (repo.language) {
    return `${baseName}：${repo.language} 项目`;
  }
  return `${baseName}：GitHub 项目知识卡`;
}

function buildLocalizedProjectPosition(
  repo: RepositoryListItem,
  keywords: string[],
  suggestedTags: string[],
  summaryZh?: string | null,
) {
  const summaryPosition = extractChinesePurpose(summaryZh ?? repo.aiSummary);
  if (summaryPosition) {
    return { text: summaryPosition, isPending: false };
  }

  const descriptors = buildChineseDescriptors(repo, keywords, suggestedTags);
  if (descriptors.length > 0) {
    return {
      text: `${descriptors.join('、')}相关项目`,
      isPending: false,
    };
  }

  if (repo.hasReadme) {
    return { text: 'README 已缓存，生成 AI 解析后显示中文用途与标签', isPending: true };
  }

  return { text: '抓取 README 并 AI 解析后生成中文用途与标签', isPending: true };
}

function extractChinesePurpose(summary: string | null | undefined) {
  const normalizedSummary = summary
    ?.replace(/[#*_`>\-[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedSummary) {
    return null;
  }

  const firstSentence = normalizedSummary.split(/[。！？!?]/)[0]?.trim();
  if (!firstSentence) {
    return null;
  }

  return truncateText(firstSentence, 54);
}

function buildChineseDescriptors(repo: RepositoryListItem, keywords: string[], suggestedTags: string[]) {
  const sourceValues = [
    ...repo.tagNames,
    ...suggestedTags,
    ...keywords,
    ...repo.topics,
    repo.description ?? '',
    repo.language ?? '',
  ];
  const descriptors: string[] = [];

  for (const value of sourceValues) {
    for (const nextDescriptor of toChineseDescriptors(value)) {
      if (descriptors.some((descriptor) => descriptor.toLowerCase() === nextDescriptor.toLowerCase())) {
        continue;
      }
      descriptors.push(nextDescriptor);
      if (descriptors.length >= 3) {
        return descriptors;
      }
    }
  }

  return descriptors;
}

function toChineseDescriptors(value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return [];
  }

  if (/[\u4e00-\u9fa5]/.test(normalizedValue)) {
    return [truncateText(normalizedValue, 16)];
  }

  const lowerValue = normalizedValue.toLowerCase();
  const descriptorRules: Array<[RegExp, string]> = [
    [/(^|[^a-z])cli([^a-z]|$)|command[ -]?line|terminal/, '命令行工具'],
    [/agent|copilot|assistant/, '智能体'],
    [/documentation|docs?|readme|wiki/, '文档知识库'],
    [/search|retrieval|rag|semantic/, '知识检索'],
    [/workflow|automation|bot/, '自动化工作流'],
    [/developer|devtool|sdk|api/, '开发者工具'],
    [/database|storage|sqlite|postgres|mysql/, '数据存储'],
    [/frontend|react|vue|ui|component/, '前端界面'],
    [/backend|server|gateway|service/, '后端服务'],
    [/typescript|javascript|node/, 'TypeScript 生态'],
    [/python/, 'Python 生态'],
    [/rust/, 'Rust 生态'],
    [/go(lang)?/, 'Go 生态'],
    [/java|kotlin/, 'Java 生态'],
    [/ai|llm|gpt|model|prompt/, 'AI 应用'],
    [/security|auth|permission/, '安全认证'],
    [/monitor|observability|log/, '监控观测'],
  ];

  const descriptors: string[] = [];
  for (const [pattern, descriptor] of descriptorRules) {
    if (pattern.test(lowerValue)) {
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

function uniqueStrings(values: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }
    const key = trimmedValue.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmedValue);
  }
  return result;
}

function truncateText(value: string, maxLength: number) {
  const normalizedValue = value.trim();
  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(hash: string) {
  return hash.length > 12 ? hash.slice(0, 12) : hash;
}
