import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import type { GitHubUser, StarSyncSummary, TaskProgressEvent } from '@/types';

type Page = 'dashboard' | 'repositories' | 'tag-network' | 'ai-search' | 'profile' | 'settings';

type AppLayoutProps = {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  user: GitHubUser | null;
  onSyncStars: () => void;
  isSyncing: boolean;
  syncSummary: StarSyncSummary | null;
  onGlobalSearch: (query: string) => void;
  taskProgress: TaskProgressEvent | null;
  onRetryTask: (() => void) | null;
  retryTaskLabel: string | null;
  isRetryingTask: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
};

const NAV_ITEMS: { key: Page; icon: string; label: string }[] = [
  { key: 'dashboard', icon: 'dashboard', label: '仪表盘' },
  { key: 'repositories', icon: 'folder_special', label: '全部仓库' },
  { key: 'tag-network', icon: 'hub', label: '标签网络' },
  { key: 'ai-search', icon: 'psychology', label: 'AI 搜索' },
];
export function AppLayout(props: AppLayoutProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
    props.onGlobalSearch(query);
  }

  return (
    <div className="app-layout flex h-full min-w-0 overflow-hidden">
      {/* 侧边导航栏 */}
      <aside
        className={`glass-sidebar fixed bottom-0 left-0 top-0 z-40 hidden flex-col gap-stack-gap p-4 transition-[width] duration-200 lg:flex ${
          isSidebarCollapsed ? 'w-[72px]' : 'w-[clamp(250px,21vw,300px)]'
        }`}
      >
        {/* 标题区 */}
        <div className={`mb-2 flex items-center gap-3 py-4 ${isSidebarCollapsed ? 'justify-center px-0' : 'px-2'}`}>
          <img
            src="/icon.png"
            alt="GitHub-Stars-AI-Tools"
            className={`${isSidebarCollapsed ? 'h-10 w-10' : 'h-11 w-11'} shrink-0 rounded-[14px] border border-card-border bg-surface-container-lowest object-contain shadow-sm`}
          />
          {!isSidebarCollapsed && (
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-[17px] font-semibold leading-5 text-on-surface" title="GitHub-Stars-AI-Tools">
              GitHub Stars AI
            </h1>
            <p className="truncate font-label-sm text-[11px] text-on-surface-variant opacity-85">
              GSAT 本地知识库
            </p>
          </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsSidebarCollapsed((current) => !current)}
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-outline-variant/30 bg-surface text-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
          title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <Icon name={isSidebarCollapsed ? 'left_panel_open' : 'left_panel_close'} size={20} />
          {!isSidebarCollapsed && <span>收起侧栏</span>}
        </button>

        {/* 导航标签 */}
        <nav className="flex-1 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => props.onNavigate(item.key)}
              title={item.label}
              className={`flex items-center rounded-lg py-2.5 transition-all duration-200 active:scale-[0.98] group ${
                isSidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'
              } ${
                props.currentPage === item.key
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low hover:scale-[1.02] hover:brightness-110'
              }`}
            >
              <Icon
                name={item.icon}
                size={24}
                fill={props.currentPage === item.key}
                className="group-hover:scale-110 transition-transform"
              />
              {!isSidebarCollapsed && <span className="font-body-md text-body-md">{item.label}</span>}
            </button>
          ))}
        </nav>

        {props.taskProgress && !isSidebarCollapsed && (
          <TaskProgressCard
            progress={props.taskProgress}
            onRetry={props.onRetryTask}
            retryLabel={props.retryTaskLabel}
            isRetrying={props.isRetryingTask}
          />
        )}

        {/* 同步数据入口 */}
        <button
          onClick={() => (props.user ? props.onSyncStars() : props.onNavigate('settings'))}
          disabled={props.isSyncing}
          title={props.user ? '同步 GitHub Stars' : '请先连接 GitHub 账号'}
          className={`interactive-btn mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563eb] font-body-md text-body-md font-semibold text-white shadow-[0_10px_22px_-14px_rgba(37,99,235,0.95)] hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 ${
            isSidebarCollapsed ? 'h-10 px-0' : 'py-2.5'
          }`}
        >
          <Icon name={props.isSyncing ? 'progress_activity' : 'sync'} size={18} className={`text-white ${props.isSyncing ? 'animate-spin' : ''}`} />
          {!isSidebarCollapsed && (props.isSyncing ? '同步中...' : props.user ? '同步数据' : '连接 GitHub')}
        </button>

        {/* 底部操作区 */}
        <div className="flex flex-col gap-1 pt-4 border-t border-card-border">
          <button
            onClick={() => props.onNavigate('settings')}
            title="设置"
            className={`flex items-center rounded-lg py-2 text-sm transition-colors ${
              isSidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'
            } ${
              props.currentPage === 'settings'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <Icon name="settings" size={20} />
            {!isSidebarCollapsed && <span className="font-body-md text-body-md">设置</span>}
          </button>
          <button
            onClick={() => props.onNavigate('profile')}
            title="个人主页"
            className={`flex items-center rounded-lg py-2 text-sm transition-colors ${
              isSidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'
            } ${
              props.currentPage === 'profile'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <Icon name="person" size={20} />
            {!isSidebarCollapsed && <span className="font-body-md text-body-md">个人主页</span>}
          </button>
        </div>
      </aside>

      {/* 主内容区域 */}
      <div
        className={`flex h-full min-w-0 flex-1 flex-col transition-[margin-left] duration-200 ${
          isSidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[clamp(250px,21vw,300px)]'
        }`}
      >
        {/* 顶部导航栏 */}
        <header className="glass-topbar sticky top-0 z-30 flex min-h-16 w-full flex-wrap items-center justify-between gap-3 px-3 py-2 sm:px-4 lg:flex-nowrap lg:px-gutter">
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <img
              src="/icon.png"
              alt="GitHub-Stars-AI-Tools"
              className="h-9 w-9 shrink-0 rounded-[12px] border border-card-border bg-surface-container-lowest object-contain shadow-sm"
            />
            <div className="min-w-0">
              <h1 className="truncate text-[16px] font-semibold leading-5 text-on-surface" title="GitHub-Stars-AI-Tools">
                GitHub Stars AI
              </h1>
              <p className="truncate font-label-sm text-[11px] text-on-surface-variant">
                Stars 知识库
              </p>
            </div>
          </div>

          {/* 搜索 */}
          <form className="group relative order-3 w-full min-w-0 sm:order-none sm:flex-1 lg:max-w-[420px]" onSubmit={handleSearchSubmit}>
            <Icon
              name="search"
              size={20}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索仓库、标签或内容..."
              className="w-full bg-surface-container-low/80 border border-card-border rounded-full pl-10 pr-12 py-2 font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all backdrop-blur-md"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <kbd className="font-label-sm text-[10px] text-outline bg-surface px-1.5 rounded border border-card-border">
                ⌘
              </kbd>
              <kbd className="font-label-sm text-[10px] text-outline bg-surface px-1.5 rounded border border-card-border">
                K
              </kbd>
            </div>
          </form>

          {/* 右侧操作区 */}
          <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => (props.user ? props.onSyncStars() : props.onNavigate('settings'))}
              disabled={props.isSyncing}
              className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
              title={props.user ? '同步 GitHub Stars' : '请先连接 GitHub 账号'}
              aria-label={props.user ? '同步 GitHub Stars' : '连接 GitHub 账号'}
            >
              <Icon name={props.isSyncing ? 'progress_activity' : 'sync'} size={20} className={props.isSyncing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => props.onNavigate('ai-search')}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors relative"
              title="查看 AI 搜索"
            >
              <Icon name="history" size={20} />
            </button>
            <button
              type="button"
              onClick={() => props.onNavigate('dashboard')}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors relative"
              title="查看同步状态"
            >
              <Icon name="notifications" size={20} />
              {props.syncSummary && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full border border-surface" />
              )}
            </button>
            <div className="h-6 w-px bg-card-border mx-1" />
            <button
              type="button"
              onClick={() => props.onNavigate('profile')}
              className="flex items-center gap-2 hover:bg-surface-container-low p-1 sm:pr-3 rounded-full transition-colors border border-transparent hover:border-card-border"
            >
              {props.user?.avatarUrl ? (
                <img
                  src={props.user.avatarUrl}
                  alt={props.user.login}
                  className="w-8 h-8 rounded-full object-cover border border-card-border"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center border border-primary/20">
                  <span className="font-headline-md text-sm text-primary">
                    {props.user?.login?.[0]?.toUpperCase() ?? 'U'}
                  </span>
                </div>
              )}
              <span className="hidden max-w-28 truncate font-body-md text-sm font-medium text-on-surface sm:block">
                {props.user?.login ?? '未连接'}
              </span>
            </button>
          </div>

          <nav className="order-4 flex w-full gap-2 overflow-x-auto pb-1 lg:hidden">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                onClick={() => props.onNavigate(item.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  props.currentPage === item.key
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <Icon name={item.icon} size={18} fill={props.currentPage === item.key} />
                {item.label}
              </button>
            ))}
            <button
              onClick={() => props.onNavigate('settings')}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                props.currentPage === 'settings'
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
              }`}
            >
              <Icon name="settings" size={18} />
              设置
            </button>
          </nav>
        </header>

        {(props.errorMessage || props.statusMessage) && (
          <GlobalStatusBanner
            type={props.errorMessage ? 'error' : 'success'}
            message={props.errorMessage ?? props.statusMessage ?? ''}
          />
        )}

        {props.taskProgress && (
          <div className="shrink-0 border-b border-card-border bg-surface/90 px-3 py-2 backdrop-blur-md sm:px-4 lg:hidden">
            <TaskProgressCard
              progress={props.taskProgress}
              onRetry={props.onRetryTask}
              retryLabel={props.retryTaskLabel}
              isRetrying={props.isRetryingTask}
            />
          </div>
        )}

        {/* 页面内容 */}
        <main className="flex-1 overflow-hidden">{props.children}</main>
      </div>
    </div>
  );
}

function GlobalStatusBanner(props: { type: 'success' | 'error'; message: string }) {
  const isError = props.type === 'error';

  return (
    <div className="shrink-0 border-b border-card-border bg-surface/90 px-3 py-2 backdrop-blur-md sm:px-4 lg:px-gutter">
      <div
        className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
          isError
            ? 'border-error/25 bg-error/10 text-error'
            : 'border-success/25 bg-success/10 text-success'
        }`}
        role={isError ? 'alert' : 'status'}
      >
        <Icon name={isError ? 'error' : 'check_circle'} size={18} className="mt-0.5 shrink-0" />
        <p className="min-w-0 flex-1 break-words font-body-md leading-relaxed">{props.message}</p>
      </div>
    </div>
  );
}

function TaskProgressCard(props: {
  progress: TaskProgressEvent;
  onRetry: (() => void) | null;
  retryLabel: string | null;
  isRetrying: boolean;
}) {
  const progress = props.progress;
  const hasKnownProgress = progress.total > 0;
  const safeCurrent = hasKnownProgress ? Math.min(progress.current, progress.total) : progress.current;
  const percentage = hasKnownProgress ? Math.min(100, Math.round((safeCurrent / progress.total) * 100)) : 0;
  const progressLabel = progress.taskId === 'generate-ai-tag-network'
    ? `已完成 ${safeCurrent}/${progress.total} 批 · ${percentage}%`
    : `${safeCurrent}/${progress.total} · ${percentage}%`;
  const isRunning = progress.status === 'running';
  const isFailed = progress.status === 'failed';
  const isPartial = progress.status === 'partial';
  const canRetry = (isFailed || isPartial) && Boolean(props.onRetry);
  const stageLabel = getTaskStageLabel(progress.stage);
  const iconName = progress.taskType === 'ai'
    ? 'auto_awesome'
    : progress.taskType === 'readme'
      ? 'description'
      : progress.taskType === 'backup'
        ? 'backup'
        : 'sync';

  return (
    <div className="rounded-lg border border-card-border bg-surface/70 p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 flex size-7 items-center justify-center rounded-lg ${
            isFailed
              ? 'bg-error/10 text-error'
              : isPartial
                ? 'bg-warning/10 text-warning'
                : isRunning
                  ? 'bg-primary/10 text-primary'
                  : 'bg-success/10 text-success'
          }`}
        >
          <Icon name={isRunning ? 'progress_activity' : isPartial ? 'warning' : iconName} size={16} className={isRunning ? 'animate-spin' : ''} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-on-surface">
            {isRunning ? '任务执行中' : isFailed ? '任务失败' : isPartial ? '任务部分完成' : '任务完成'}
          </p>
          <p className={`mt-0.5 text-[11px] leading-snug text-on-surface-variant ${isFailed || isPartial ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}`}>
            {progress.message}
          </p>
          {(stageLabel || progress.repositoryName) && (
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[10px] leading-none text-on-surface-variant/90">
              {stageLabel && (
                <span className="max-w-full rounded-full border border-outline-variant/35 bg-surface-container-low px-2 py-1">
                  阶段：{stageLabel}
                </span>
              )}
              {progress.repositoryName && (
                <span className="max-w-full truncate rounded-full border border-outline-variant/35 bg-surface-container-low px-2 py-1" title={progress.repositoryName}>
                  当前：{progress.repositoryName}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {(hasKnownProgress || isRunning) && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
            {hasKnownProgress ? (
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
            ) : (
              <div className="task-progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
            )}
          </div>
          <p className="mt-1 text-right text-[10px] text-on-surface-variant">
            {hasKnownProgress ? progressLabel : '正在处理...'}
          </p>
        </div>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={props.onRetry ?? undefined}
          disabled={props.isRetrying}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name={props.isRetrying ? 'progress_activity' : 'refresh'} size={14} className={props.isRetrying ? 'animate-spin' : ''} />
          {props.isRetrying ? '重试中' : props.retryLabel ?? '重试任务'}
        </button>
      )}
    </div>
  );
}

function getTaskStageLabel(stage: string) {
  switch (stage) {
    case 'auth':
      return '验证账号';
    case 'prepare':
      return '准备数据';
    case 'batch':
      return '批量处理';
    case 'check':
      return '检查仓库';
    case 'plan':
      return '生成计划';
    case 'fetch':
    case 'fetch-readme':
    case 'github-search':
      return '请求数据';
    case 'github-star':
      return '更新 Stars';
    case 'parse':
      return '解析数据';
    case 'save':
      return '写入本地';
    case 'summarize':
    case 'analyze':
      return 'AI 分析';
    case 'partial-failure':
      return '部分失败';
    case 'incremental-stop':
      return '增量完成';
    case 'done':
      return '已完成';
    case 'error':
      return '失败';
    case 'request':
      return '准备中';
    default:
      return stage ? stage : '';
  }
}
