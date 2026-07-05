import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { Icon } from '@/components/ui/icon';
import { getAiConfigMessage } from '@/lib/ai-config';
import { compactNumber } from '@/lib/format';
import type {
  GithubRecommendationResponse,
  ReadingStatus,
  RepositoryAnnotationView,
  RepositoryDetailView,
  RepositoryListItem,
  TagItem,
} from '@/types';

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

type SortBy = 'recent' | 'stars' | 'name';
type ViewMode = 'detail' | 'table';
const REPOSITORY_CARD_HEIGHT = 92;
const REPOSITORY_CARD_GAP = 6;
const REPOSITORY_ROW_HEIGHT = REPOSITORY_CARD_HEIGHT + REPOSITORY_CARD_GAP;
const REPOSITORY_TABLE_ROW_HEIGHT = 64;
const REPOSITORY_TABLE_HEADER_HEIGHT = 33;
const LIST_OVERSCAN = 8;

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
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(720);
  const [recommendationSelection, setRecommendationSelection] = useState<Set<string>>(() => new Set());
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [recommendationResponse, setRecommendationResponse] = useState<GithubRecommendationResponse | null>(null);
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

  // 应用筛选和排序
  const filteredRepos = useMemo(() => {
    if (!workspace.repositoryPage) return [];

    let repos = [...workspace.repositoryPage.items];

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
  }, [workspace.repositoryPage, sortBy]);

  const selectedRepo = workspace.selectedRepository;
  const aiConfigMessage = getAiConfigMessage(settingsHook.settings.ai);
  const autoSummaryConfigMessage = settingsHook.settings.ai.enableAutoSummary ? aiConfigMessage : null;
  const visibleWindow = useMemo(() => {
    const rowHeight = viewMode === 'table' ? REPOSITORY_TABLE_ROW_HEIGHT : REPOSITORY_ROW_HEIGHT;
    const contentScrollTop = Math.max(
      0,
      listScrollTop - (viewMode === 'table' ? REPOSITORY_TABLE_HEADER_HEIGHT : 0),
    );
    const startIndex = Math.max(0, Math.floor(contentScrollTop / rowHeight) - LIST_OVERSCAN);
    const visibleCount = Math.ceil(listViewportHeight / rowHeight) + LIST_OVERSCAN * 2;
    const endIndex = Math.min(filteredRepos.length, startIndex + visibleCount);
    return {
      startIndex,
      endIndex,
      items: filteredRepos.slice(startIndex, endIndex),
      totalHeight: filteredRepos.length * rowHeight,
      offsetY: startIndex * rowHeight,
    };
  }, [filteredRepos, listScrollTop, listViewportHeight, viewMode]);
  const hasActiveFilters = Boolean(searchKeyword.trim() || selectedLanguage || selectedTagId);
  const selectedRecommendationIds = Array.from(recommendationSelection);

  function toggleRecommendationSelection(repositoryId: string) {
    setRecommendationSelection((current) => {
      const next = new Set(current);
      if (next.has(repositoryId)) {
        next.delete(repositoryId);
      } else {
        next.add(repositoryId);
      }
      return next;
    });
  }

  async function handleFindSimilarOnGithub() {
    if (!workspace.authState.user) {
      setRecommendationError('请先连接 GitHub 账号。');
      return;
    }
    if (selectedRecommendationIds.length === 0) {
      setRecommendationError('请先勾选 1 到 8 个仓库作为参考。');
      return;
    }
    const aiMessage = getAiConfigMessage(settingsHook.settings.ai);
    if (aiMessage) {
      setRecommendationError(aiMessage);
      return;
    }

    setIsFindingSimilar(true);
    setRecommendationError(null);
    try {
      const response = await invoke<GithubRecommendationResponse>('recommend_github_repositories', {
        request: {
          accountId: String(workspace.authState.user.id),
          repositoryIds: selectedRecommendationIds.slice(0, 8),
          aiConfig: {
            provider: settingsHook.settings.ai.provider,
            baseUrl: settingsHook.settings.ai.baseUrl,
            apiKey: settingsHook.settings.ai.apiKey,
            model: settingsHook.settings.ai.model,
          },
          limit: 12,
        },
      });
      setRecommendationResponse(response);
    } catch (reason) {
      setRecommendationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsFindingSimilar(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-hidden p-3 sm:p-4 lg:gap-5 lg:p-5 xl:flex-row xl:gap-6 xl:p-6">
      {/* Left Pane: Repo List */}
      <div
        className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-card-border bg-surface-container-low shadow-sm ${
          viewMode === 'table'
            ? 'min-h-0 flex-1'
            : 'h-[min(42dvh,460px)] shrink-0 xl:h-full xl:w-[clamp(300px,32vw,440px)]'
        }`}
      >
        {/* List Header & Controls */}
        <div className="p-4 border-b border-outline-variant/20 bg-surface/50 backdrop-blur-md shrink-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h1 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight">
              知识库列表
            </h1>
            <div className="flex shrink-0 rounded-lg border border-outline-variant/30 bg-surface p-0.5">
              <button
                type="button"
                onClick={() => {
                  setViewMode('detail');
                  resetListScroll();
                }}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  viewMode === 'detail' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
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
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  viewMode === 'table' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                表格
              </button>
            </div>
          </div>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() =>
                void workspace
                  .handleFetchReadmes({
                    aiConfig: settingsHook.settings.ai,
                    autoGenerateAi: settingsHook.settings.ai.enableAutoSummary,
                    aiLimit: 50,
                    onlyMissing: true,
                  })
                  .catch(() => undefined)
              }
              disabled={
                workspace.isFetchingReadmes ||
                workspace.isBatchGeneratingAiDocuments ||
                !workspace.authState.user ||
                Boolean(autoSummaryConfigMessage)
              }
              title={settingsHook.settings.ai.enableAutoSummary ? autoSummaryConfigMessage ?? '抓取 README 后生成 AI 摘要' : '抓取 README'}
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
                void workspace
                  .handleBatchGenerateAiDocuments(settingsHook.settings.ai, { limit: 50, onlyMissing: true })
                  .catch(() => undefined)
              }
              disabled={workspace.isBatchGeneratingAiDocuments || !workspace.authState.user || Boolean(aiConfigMessage)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs hover:brightness-110 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
              title={aiConfigMessage ?? '批量生成 AI 摘要'}
            >
              <Icon name={workspace.isBatchGeneratingAiDocuments ? 'progress_activity' : 'auto_awesome'} size={15} className={workspace.isBatchGeneratingAiDocuments ? 'animate-spin' : ''} />
              {workspace.isBatchGeneratingAiDocuments ? '分析中' : '批量 AI'}
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleFindSimilarOnGithub()}
              disabled={isFindingSimilar || selectedRecommendationIds.length === 0 || Boolean(aiConfigMessage)}
              title={aiConfigMessage ?? '根据勾选仓库在 GitHub 寻找相似或更优项目'}
              className="flex min-w-[180px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
            >
              <Icon name={isFindingSimilar ? 'progress_activity' : 'travel_explore'} size={15} className={isFindingSimilar ? 'animate-spin' : ''} />
              {isFindingSimilar ? '发现中' : `GitHub 相似发现${selectedRecommendationIds.length ? ` (${selectedRecommendationIds.length})` : ''}`}
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
          {(recommendationError || recommendationResponse) && (
            <GithubRecommendationPanel
              errorMessage={recommendationError}
              response={recommendationResponse}
            />
          )}
          {autoSummaryConfigMessage && (
            <div className="mb-3 rounded-lg bg-error/10 border border-error/20 px-3 py-2 text-[11px] text-error">
              {autoSummaryConfigMessage}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {/* Sort + Search */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Icon name="filter_list" size={18} className="absolute left-2.5 top-2 text-on-surface-variant" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="w-full pl-9 pr-8 py-1.5 text-sm bg-surface rounded-lg border border-outline-variant/40 focus:ring-1 focus:ring-primary focus:border-primary appearance-none text-on-surface shadow-sm cursor-pointer hover:border-outline-variant transition-colors"
                >
                  <option value="recent">最近加星</option>
                  <option value="stars">最活跃</option>
                  <option value="name">按名称</option>
                </select>
                <Icon name="expand_more" size={18} className="absolute right-2.5 top-2 text-on-surface-variant pointer-events-none" />
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Icon name="search" size={18} className="absolute left-2.5 top-2 text-on-surface-variant" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索仓库..."
                className="w-full pl-9 pr-3 py-1.5 text-sm bg-surface rounded-lg border border-outline-variant/40 focus:ring-1 focus:ring-primary focus:border-primary text-on-surface placeholder:text-on-surface-variant shadow-sm"
              />
            </div>

            {/* Language filter */}
            <div className="flex gap-2 text-xs">
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="flex-1 py-1 px-2 bg-surface rounded border border-outline-variant/30 text-on-surface-variant hover:border-outline-variant cursor-pointer"
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
                className="flex-1 py-1 px-2 bg-surface rounded border border-outline-variant/30 text-on-surface-variant hover:border-outline-variant cursor-pointer"
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

          {/* Quick Tags */}
          <div className="flex gap-2 mt-3 overflow-x-auto custom-scrollbar pb-1">
            <button
              onClick={() => setSelectedTagId('')}
              className="px-2.5 py-1 rounded-full bg-primary-container text-on-primary-container text-[11px] font-label-sm font-medium whitespace-nowrap cursor-pointer hover:brightness-110 transition-all"
            >
              全部 ({workspace.repositoryStats.total})
            </button>
            {workspace.tags.slice(0, 5).map((tag) => (
              <button
                key={tag.id}
                onClick={() => setSelectedTagId(selectedTagId === tag.id ? '' : tag.id)}
                className={`px-2.5 py-1 rounded-full glass-panel text-[11px] font-label-sm font-medium whitespace-nowrap cursor-pointer hover:bg-surface-variant/50 transition-all border border-outline-variant/30 ${
                  selectedTagId === tag.id ? 'bg-primary text-on-primary' : 'text-on-surface'
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable List */}
        <div
          ref={listViewportRef}
          className="flex-1 overflow-y-auto custom-scrollbar p-2"
          onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
        >
          {workspace.isLoadingRepositories ? (
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
                    visibleWindow.items.map((repo) => (
	                      <RepositoryTableRow
	                        key={repo.id}
	                        repo={repo}
	                        isSelected={selectedRepo?.id === repo.id}
	                        isMarkedForRecommendation={recommendationSelection.has(repo.id)}
	                        onClick={() => workspace.setSelectedRepositoryId(repo.id)}
	                        onToggleRecommendation={() => toggleRecommendationSelection(repo.id)}
	                      />
                    ))
                  ) : (
                    visibleWindow.items.map((repo) => (
                      <div
                        key={repo.id}
                        className="box-border"
                        style={{ height: REPOSITORY_ROW_HEIGHT, paddingBottom: REPOSITORY_CARD_GAP }}
                      >
	                        <RepoListItem
	                          repo={repo}
	                          isSelected={selectedRepo?.id === repo.id}
	                          isMarkedForRecommendation={recommendationSelection.has(repo.id)}
	                          onClick={() => workspace.setSelectedRepositoryId(repo.id)}
	                          onToggleRecommendation={() => toggleRecommendationSelection(repo.id)}
	                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Pane: Detail View */}
      {viewMode === 'detail' && selectedRepo ? (
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
          onGenerateAiDocument={() => workspace.handleGenerateAiDocument(settingsHook.settings.ai).catch(() => undefined)}
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
  onClick: () => void;
  onToggleRecommendation: () => void;
}) {
  const { repo, isSelected, isMarkedForRecommendation, onClick, onToggleRecommendation } = props;

  return (
    <div
      onClick={onClick}
      className={`h-full p-3 rounded-lg cursor-pointer transition-all relative overflow-hidden group ${
        isSelected
          ? 'bg-primary-fixed/30 border border-primary/30 shadow-sm'
          : 'bg-surface hover:bg-surface-variant/40 border border-transparent hover:border-outline-variant/20'
      }`}
    >
      {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg" />}
      <div className={`flex justify-between items-start mb-1 ${isSelected ? 'pl-2' : ''}`}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleRecommendation();
            }}
            className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
              isMarkedForRecommendation
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant/40 bg-surface-container-low text-transparent hover:text-on-surface-variant'
            }`}
            title={isMarkedForRecommendation ? '取消作为相似发现参考' : '作为相似发现参考'}
          >
            <Icon name="check" size={14} />
          </button>
          <Icon name="book" size={16} className={isSelected ? 'text-primary' : 'text-on-surface-variant'} />
          <h3 className="font-medium text-sm text-on-surface truncate font-headline-lg" style={{ fontSize: '14px', lineHeight: '20px' }}>
            {repo.fullName}
          </h3>
        </div>
        <span className="text-[10px] text-on-surface-variant flex items-center gap-0.5 bg-surface-variant/30 px-1.5 py-0.5 rounded shrink-0">
          <Icon name="star" size={12} /> {compactNumber(repo.starsCount)}
        </span>
      </div>
      <p className={`text-xs text-on-surface-variant line-clamp-1 mb-1 ${isSelected ? 'pl-2' : ''} leading-relaxed`}>
        {repo.description ?? '暂无描述'}
      </p>
      {isSelected && (
        <p className="text-[11px] text-primary/80 line-clamp-1 mb-2 pl-2 bg-primary/5 rounded px-1 py-0.5 inline-block">
          {repo.aiSummary ? `AI: ${repo.aiSummary}` : repo.hasReadme ? 'README 已缓存，可生成 AI 摘要' : '等待抓取 README'}
        </p>
      )}
      <div className={`flex items-center justify-between ${isSelected ? 'pl-2' : ''}`}>
        <div className="flex items-center gap-3">
          {repo.language && (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
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
        className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary transition-all hover:brightness-110 disabled:opacity-60"
      >
        {props.isSyncing ? '同步中...' : '同步 Stars'}
      </button>
    </div>
  );
}

function RepositoryTableHeader() {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_80px] items-center gap-3 border-b border-outline-variant/30 bg-surface-container-low/95 px-3 py-2 text-[11px] font-semibold uppercase text-on-surface-variant backdrop-blur md:grid-cols-[minmax(200px,1.8fr)_minmax(220px,2fr)_110px_90px_110px] xl:grid-cols-[minmax(220px,1.8fr)_minmax(240px,2fr)_120px_100px_120px_120px] xl:gap-4 xl:px-4">
      <span>仓库</span>
      <span>描述</span>
      <span className="hidden md:block">语言</span>
      <span>Stars</span>
      <span className="hidden md:block">状态</span>
      <span className="hidden xl:block">最近收藏</span>
    </div>
  );
}

function RepositoryTableRow(props: {
  repo: RepositoryListItem;
  isSelected: boolean;
  isMarkedForRecommendation: boolean;
  onClick: () => void;
  onToggleRecommendation: () => void;
}) {
  const { repo, isSelected, isMarkedForRecommendation, onClick, onToggleRecommendation } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_80px] items-center gap-3 border-b border-outline-variant/15 px-3 text-left transition-colors hover:bg-surface-variant/30 md:grid-cols-[minmax(200px,1.8fr)_minmax(220px,2fr)_110px_90px_110px] xl:grid-cols-[minmax(220px,1.8fr)_minmax(240px,2fr)_120px_100px_120px_120px] xl:gap-4 xl:px-4 ${
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
            onToggleRecommendation();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onToggleRecommendation();
            }
          }}
          className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
            isMarkedForRecommendation
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant/40 bg-surface-container-low text-transparent hover:text-on-surface-variant'
          }`}
          title={isMarkedForRecommendation ? '取消作为相似发现参考' : '作为相似发现参考'}
        >
          <Icon name="check" size={14} />
        </span>
        <Icon name="book" size={16} className={isSelected ? 'text-primary' : 'text-on-surface-variant'} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{repo.fullName}</span>
          {repo.topics.length > 0 && (
            <span className="mt-0.5 block truncate text-[11px] text-on-surface-variant">
              {repo.topics.slice(0, 4).join(' · ')}
            </span>
          )}
        </span>
      </span>
      <span className="truncate text-sm text-on-surface-variant">{repo.description ?? '暂无描述'}</span>
      <span className="hidden items-center gap-1.5 text-sm md:flex">
        <span className="size-2 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
        <span className="truncate">{repo.language ?? '其他'}</span>
      </span>
      <span className="flex items-center gap-1 text-sm font-medium">
        <Icon name="star" size={14} />
        {compactNumber(repo.starsCount)}
      </span>
      <span className="hidden flex-wrap gap-1 md:flex">
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
          {shownFailures.map((failure) => (
            <p key={`${failure.repositoryId}-${failure.fullName}`} className="line-clamp-2">
              {failure.fullName}：{failure.error}
            </p>
          ))}
          {hiddenFailureCount > 0 && <p>还有 {hiddenFailureCount} 个失败项，请稍后分批重试或检查 AI 配置。</p>}
        </div>
      )}
    </div>
  );
}

function GithubRecommendationPanel(props: {
  response: GithubRecommendationResponse | null;
  errorMessage: string | null;
}) {
  if (props.errorMessage) {
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
        </div>
      </div>
      {props.response.results.length === 0 ? (
        <p className="rounded-md bg-surface-container-low px-2 py-1.5 text-[11px] text-on-surface-variant">
          暂未找到未收藏过的相似项目，可以换几个参考仓库再试。
        </p>
      ) : (
        <div className="space-y-2">
          {props.response.results.slice(0, 6).map((repository) => (
            <a
              key={repository.fullName}
              href={repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-outline-variant/20 bg-surface-container-low px-3 py-2 transition-colors hover:border-primary/30 hover:bg-surface-container"
            >
              <span className="block truncate text-xs font-semibold text-primary">{repository.fullName}</span>
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
            </a>
          ))}
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
    aiConfigMessage,
    aiError,
  } = props;
  const aiDoc = detail?.aiDocument;
  const selectedTagIds = new Set(annotation?.tags.map((tag) => tag.id) ?? []);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-card-border glass-panel shadow-sm">
      {/* Detail Header */}
      <div className="flex shrink-0 flex-col gap-4 border-b border-card-border bg-surface/40 p-4 backdrop-blur-md sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-surface-container-lowest p-1 border border-outline-variant/30 flex items-center justify-center shrink-0">
              <Icon name="book" size={18} className="text-on-surface-variant" />
            </div>
            <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight truncate">
              {repo.fullName}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-outline-variant/20 text-on-surface text-[10px] font-label-sm border border-outline-variant/30 shrink-0">
              公开
            </span>
          </div>
          <p className="text-on-surface-variant text-sm max-w-2xl">{repo.description ?? '暂无描述'}</p>
          {/* Stats */}
          <div className="mt-4 flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
              <Icon name="star" size={18} />
              <span className="font-medium">{compactNumber(repo.starsCount)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
              <Icon name="fork_right" size={18} />
              <span className="font-medium">{compactNumber(repo.forksCount)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
              <span className="font-medium">{repo.language ?? '其他'}</span>
            </div>
            <div className="h-4 w-px bg-outline-variant/40 mx-2" />
            <a
              href={repo.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1 text-sm text-primary hover:underline"
            >
              <Icon name="link" size={16} />
              <span className="truncate">{repo.htmlUrl.replace('https://', '')}</span>
            </a>
          </div>
        </div>
        {/* Action Buttons */}
        <div className="flex shrink-0 gap-2">
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-md transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]"
          >
            <Icon name="open_in_new" size={18} /> 在浏览器打开
          </a>
        </div>
      </div>

      {/* Scrollable Detail Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-container-lowest/30 p-4 lg:p-5 xl:p-6">
        <div className="flex min-w-0 flex-col gap-5 2xl:flex-row 2xl:gap-6">
        {/* Main Content (README + Notes) */}
        <div className="min-w-0 flex-1 space-y-5">
          {/* README */}
          <div className="rounded-xl border border-card-border bg-surface/60 p-4 shadow-sm backdrop-blur-sm sm:p-5 xl:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="description" size={20} className="text-primary" />
              <h3 className="font-headline-md text-lg font-semibold text-on-surface">README</h3>
            </div>
            {readmeError && (
              <div className="mb-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs leading-relaxed text-error">
                {readmeError}
              </div>
            )}
            {isLoadingDetail ? (
              <div className="flex items-center justify-center py-8">
                <Icon name="progress_activity" size={24} className="text-primary animate-spin" />
              </div>
            ) : detail?.readme ? (
              <ReadmeRenderer
                markdown={detail.readme.rawMarkdown}
                repositoryFullName={repo.fullName}
                sourcePath={detail.readme.sourcePath}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant gap-2">
                <Icon name="book" size={48} className="opacity-30" />
                <p className="font-body-md text-sm">该仓库暂无 README 缓存，请先抓取 README</p>
                <button
                  type="button"
                  onClick={() => void onFetchReadme()}
                  disabled={isFetchingReadme}
                  className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary transition-all hover:brightness-110 disabled:opacity-60"
                >
                  {isFetchingReadme ? '抓取中...' : '抓取当前 README'}
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-card-border bg-surface/60 p-4 shadow-sm backdrop-blur-sm sm:p-5 xl:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Icon name="edit_note" size={20} className="text-primary" />
                <h3 className="font-headline-md text-lg font-semibold text-on-surface">个人笔记</h3>
              </div>
              <button
                onClick={() => void onSaveAnnotation()}
                disabled={isSavingAnnotation}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-medium hover:brightness-110 transition-all flex items-center gap-2 shadow-sm disabled:opacity-60"
              >
                <Icon name="save" size={16} /> 保存笔记和状态
              </button>
            </div>
            {annotationMessage && (
              <div className="mb-4 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                {annotationMessage}
              </div>
            )}
            <div className="mb-4 grid gap-4 md:grid-cols-[180px_1fr]">
              <label className="grid gap-2 text-xs font-label-sm text-on-surface-variant">
                阅读状态
                <select
                  value={readingStatusDraft}
                  onChange={(event) => onReadingStatusChange(event.target.value as ReadingStatus)}
                  className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="unread">未读</option>
                  <option value="later">稍后阅读</option>
                  <option value="read">已读</option>
                </select>
              </label>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-label-sm text-on-surface-variant">仓库标签</span>
                  {isSavingTag && <span className="text-[11px] text-primary">保存标签中...</span>}
                </div>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const isSelected = selectedTagIds.has(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => void onToggleRepositoryTag(tag)}
                          disabled={isSavingTag}
                          className={`rounded-full border px-2.5 py-1 text-xs font-label-sm transition-all disabled:opacity-60 ${
                            isSelected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:border-primary/40 hover:text-on-surface'
                          }`}
                          style={
                            tag.color && isSelected
                              ? { backgroundColor: `${tag.color}20`, borderColor: tag.color, color: tag.color }
                              : undefined
                          }
                        >
                          <Icon name="label" size={12} className="mr-1 inline-block align-[-2px]" />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-on-surface-variant">还没有标签，可以先创建一个用于分类。</p>
                )}
              </div>
            </div>
            <form
              onSubmit={(event) => void onCreateTag(event)}
              className="mb-4 grid gap-2 sm:grid-cols-[1fr_44px_auto]"
            >
              <input
                value={newTagName}
                onChange={(event) => onNewTagNameChange(event.target.value)}
                placeholder="新标签名称"
                className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                aria-label="标签颜色"
                type="color"
                value={newTagColor}
                onChange={(event) => onNewTagColorChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low p-1"
              />
              <button
                type="submit"
                disabled={isSavingTag || newTagName.trim().length === 0}
                className="rounded-lg border border-card-border bg-surface-container-high px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-60"
              >
                添加标签
              </button>
            </form>
            {tags.length > 0 && (
              <details className="mb-4 rounded-lg border border-outline-variant/20 bg-surface-container-low/50 px-3 py-2 text-xs text-on-surface-variant">
                <summary className="cursor-pointer font-label-sm text-on-surface">管理标签</summary>
                <div className="mt-3 grid gap-2">
                  {tags.map((tag) => {
                    const isEditing = editingTagId === tag.id;
                    const isConfirmingDelete = deleteTagId === tag.id;

                    return (
                      <div key={tag.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
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
                            className="min-w-0 rounded-md border border-outline-variant/30 bg-surface px-2 py-1 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
                              className="rounded-md px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
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
                              className="rounded-md px-2 py-1 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
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
                              className="rounded-md px-2 py-1 text-error hover:bg-error/10 disabled:opacity-60"
                            >
                              确认删除
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTagId(null)}
                              disabled={isSavingTag}
                              className="rounded-md px-2 py-1 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
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
                              className="rounded-md px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
                            >
                              重命名
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTagId(tag.id);
                                setEditingTagId(null);
                                setEditingTagName('');
                              }}
                              disabled={isSavingTag}
                              className="rounded-md px-2 py-1 text-error hover:bg-error/10 disabled:opacity-60"
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
              className="w-full min-h-[120px] bg-surface-container-low rounded-lg border border-outline-variant/30 p-3 text-sm text-on-surface font-body-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-y"
            />
          </div>
        </div>

        {/* Right Sidebar: AI Insights */}
        <div className="min-w-0 space-y-5 2xl:w-[clamp(280px,26vw,360px)] 2xl:shrink-0">
          <div className="rounded-xl bg-gradient-to-br from-primary-container/10 to-transparent border border-primary/20 p-5 shadow-sm relative overflow-hidden group flex-1 flex flex-col">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all duration-700" />
            <div className="flex items-center gap-2 mb-4">
              <Icon name="auto_awesome" size={20} className="text-primary" />
              <h3 className="font-headline-md text-base font-semibold text-primary">AI 洞察</h3>
            </div>
            <button
              onClick={() => void onGenerateAiDocument()}
              disabled={isGeneratingAiDocument || isLoadingDetail || Boolean(aiConfigMessage)}
              className="mb-4 w-full px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-medium hover:brightness-110 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
              title={aiConfigMessage ?? (aiDoc ? '更新 AI 摘要' : '生成 AI 摘要')}
            >
              <Icon name={isGeneratingAiDocument ? 'progress_activity' : 'auto_awesome'} size={16} className={isGeneratingAiDocument ? 'animate-spin' : ''} />
              {isGeneratingAiDocument ? '生成中...' : aiDoc ? '更新 AI 摘要' : '生成 AI 摘要'}
            </button>
            {aiConfigMessage && (
              <div className="mb-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] leading-relaxed text-error">
                {aiConfigMessage}
              </div>
            )}
            {aiError && (
              <div className="mb-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] leading-relaxed text-error">
                {aiError}
              </div>
            )}
            <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-1">
              {/* AI Summary */}
              {aiDoc ? (
                <div>
                  <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2 font-label-sm flex items-center gap-1">
                    <Icon name="summarize" size={14} /> 中文摘要
                  </h4>
                  <p className="text-[12px] text-on-surface-variant leading-relaxed">{aiDoc.summaryZh}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 text-on-surface-variant gap-2">
                  <Icon name="psychology" size={32} className="opacity-30" />
                  <p className="text-[11px]">暂无 AI 摘要</p>
                </div>
              )}

              {/* README Breakdown */}
              {aiDoc?.readmeZh && (
                <div>
                  <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2 font-label-sm flex items-center gap-1">
                    <Icon name="article" size={14} /> README 梳理
                  </h4>
                  <p className="text-[12px] text-on-surface-variant leading-relaxed whitespace-pre-wrap">{aiDoc.readmeZh}</p>
                </div>
              )}

              {/* Keywords */}
              {aiDoc && aiDoc.keywords.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2 font-label-sm flex items-center gap-1">
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

              {/* Suggested Tags */}
              {aiDoc && aiDoc.suggestedTags.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2 font-label-sm flex items-center gap-1">
                    <Icon name="recommend" size={14} /> 建议标签
                  </h4>
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

              {/* Topics from repo */}
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
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function ReadmeRenderer(props: { markdown: string; repositoryFullName: string; sourcePath: string }) {
  const sourceDirectory = props.sourcePath.includes('/')
    ? props.sourcePath.split('/').slice(0, -1).join('/')
    : '';
  const components: Components = {
    a({ href, children, node: _node, ...anchorProps }) {
      const resolvedHref = resolveReadmeAssetUrl(
        href,
        props.repositoryFullName,
        sourceDirectory,
        'blob',
      );
      return (
        <a href={resolvedHref} target="_blank" rel="noreferrer" {...anchorProps}>
          {children}
        </a>
      );
    },
    img({ src, alt, node: _node, ...imageProps }) {
      const resolvedSrc = resolveReadmeAssetUrl(
        src,
        props.repositoryFullName,
        sourceDirectory,
        'raw',
      );
      return <img src={resolvedSrc} alt={alt ?? ''} loading="lazy" {...imageProps} />;
    },
  };

  return (
    <div className="readme-rendered max-h-[min(72vh,860px)] overflow-auto rounded-lg border border-outline-variant/20 bg-surface-container-lowest/70 p-4 text-on-surface custom-scrollbar">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {props.markdown}
      </ReactMarkdown>
    </div>
  );
}

function resolveReadmeAssetUrl(
  url: string | undefined,
  repositoryFullName: string,
  sourceDirectory: string,
  mode: 'blob' | 'raw',
) {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) {
    return url;
  }

  const normalizedPath = normalizeReadmePath(url, sourceDirectory);
  if (mode === 'raw') {
    return `https://raw.githubusercontent.com/${repositoryFullName}/HEAD/${normalizedPath}`;
  }

  return `https://github.com/${repositoryFullName}/blob/HEAD/${normalizedPath}`;
}

function normalizeReadmePath(path: string, sourceDirectory: string) {
  const cleanPath = safeDecodeUri(path).replace(/^.\//, '');
  if (cleanPath.startsWith('/')) {
    return cleanPath.slice(1);
  }

  if (!sourceDirectory) {
    return cleanPath;
  }

  return `${sourceDirectory}/${cleanPath}`;
}

function safeDecodeUri(path: string) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
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
