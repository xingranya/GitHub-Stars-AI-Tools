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
};

const NAV_ITEMS: { key: Page; icon: string; label: string }[] = [
  { key: 'dashboard', icon: 'dashboard', label: '仪表盘' },
  { key: 'repositories', icon: 'folder_special', label: '全部仓库' },
  { key: 'tag-network', icon: 'hub', label: '标签网络' },
  { key: 'ai-search', icon: 'psychology', label: 'AI 搜索' },
];

export function AppLayout(props: AppLayoutProps) {
  const [searchQuery, setSearchQuery] = useState('');
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
    <div className="app-layout flex h-dvh min-w-0 overflow-hidden">
      {/* SideNavBar */}
      <aside className="glass-sidebar fixed left-0 top-0 z-40 hidden h-full w-[clamp(220px,20vw,260px)] flex-col gap-stack-gap p-4 lg:flex">
        {/* Header */}
        <div className="flex items-center gap-3 px-2 py-4 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
            <Icon name="star" size={22} fill />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-headline-md text-[14px] font-bold leading-tight text-on-surface" title="GitHub-Stars-AI-Tools">
              GitHub-Stars-AI-Tools
            </h1>
            <p className="font-label-sm text-label-sm text-on-surface-variant opacity-80">
              GSAT
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => props.onNavigate(item.key)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 active:scale-[0.98] group ${
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
              <span className="font-body-md text-body-md">{item.label}</span>
            </button>
          ))}
        </nav>

        {props.taskProgress && <TaskProgressCard progress={props.taskProgress} />}

        {/* CTA - 同步数据 */}
        <button
          onClick={() => (props.user ? props.onSyncStars() : props.onNavigate('settings'))}
          disabled={props.isSyncing}
          title={props.user ? '同步 GitHub Stars' : '请先连接 GitHub 账号'}
          className="interactive-btn w-full py-2.5 bg-primary text-on-primary rounded-lg font-body-md text-body-md font-semibold flex items-center justify-center gap-2 mb-2 shadow-md shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Icon name={props.isSyncing ? 'progress_activity' : 'sync'} size={18} className={props.isSyncing ? 'animate-spin' : ''} />
          {props.isSyncing ? '同步中...' : props.user ? '同步数据' : '连接 GitHub'}
        </button>

        {/* Footer Actions */}
        <div className="flex flex-col gap-1 pt-4 border-t border-card-border">
          <button
            onClick={() => props.onNavigate('settings')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
              props.currentPage === 'settings'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <Icon name="settings" size={20} />
            <span className="font-body-md text-body-md">设置</span>
          </button>
          <button
            onClick={() => props.onNavigate('profile')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
              props.currentPage === 'profile'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <Icon name="person" size={20} />
            <span className="font-body-md text-body-md">个人主页</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col lg:ml-[clamp(220px,20vw,260px)]">
        {/* TopNavBar */}
        <header className="glass-topbar sticky top-0 z-30 flex min-h-16 w-full flex-wrap items-center justify-between gap-3 px-3 py-2 sm:px-4 lg:flex-nowrap lg:px-gutter">
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container shadow-sm">
              <Icon name="star" size={20} fill />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-headline-md text-[15px] font-bold leading-tight text-on-surface" title="GitHub-Stars-AI-Tools">
                GitHub-Stars-AI-Tools
              </h1>
              <p className="truncate font-label-sm text-[11px] text-on-surface-variant">
                Stars 知识库
              </p>
            </div>
          </div>

          {/* Search */}
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

          {/* Trailing Actions */}
          <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
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

        {/* Page Content */}
        <main className="flex-1 overflow-hidden">{props.children}</main>
      </div>
    </div>
  );
}

function TaskProgressCard(props: { progress: TaskProgressEvent }) {
  const progress = props.progress;
  const percentage = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;
  const isRunning = progress.status === 'running';
  const isFailed = progress.status === 'failed';
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
            isFailed ? 'bg-error/10 text-error' : isRunning ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'
          }`}
        >
          <Icon name={isRunning ? 'progress_activity' : iconName} size={16} className={isRunning ? 'animate-spin' : ''} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-on-surface">
            {isRunning ? '任务执行中' : isFailed ? '任务失败' : '任务完成'}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-on-surface-variant">{progress.message}</p>
        </div>
      </div>
      {progress.total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
          </div>
          <p className="mt-1 text-right text-[10px] text-on-surface-variant">
            {progress.current}/{progress.total}
          </p>
        </div>
      )}
    </div>
  );
}
