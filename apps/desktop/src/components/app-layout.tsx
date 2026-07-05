import { ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import type { GitHubUser, StarSyncSummary } from '@/types';

type Page = 'dashboard' | 'repositories' | 'tag-network' | 'ai-search' | 'profile' | 'settings';

type AppLayoutProps = {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  user: GitHubUser | null;
  onSyncStars: () => void;
  isSyncing: boolean;
  syncSummary: StarSyncSummary | null;
};

const NAV_ITEMS: { key: Page; icon: string; label: string }[] = [
  { key: 'dashboard', icon: 'dashboard', label: '仪表盘' },
  { key: 'repositories', icon: 'folder_special', label: '全部仓库' },
  { key: 'tag-network', icon: 'hub', label: '标签网络' },
  { key: 'ai-search', icon: 'psychology', label: 'AI 搜索' },
];

export function AppLayout(props: AppLayoutProps) {
  return (
    <div className="app-layout flex h-screen overflow-hidden">
      {/* SideNavBar */}
      <aside className="glass-sidebar fixed left-0 top-0 h-full w-[260px] flex flex-col p-4 gap-stack-gap z-40">
        {/* Header */}
        <div className="flex items-center gap-3 px-2 py-4 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
            <Icon name="star" size={22} fill />
          </div>
          <div>
            <h1 className="font-headline-md text-[18px] font-bold text-on-surface tracking-tight leading-tight">
              StarGraph AI
            </h1>
            <p className="font-label-sm text-label-sm text-on-surface-variant opacity-80">
              Modular Repository Intelligence
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

        {/* CTA - 同步数据 */}
        <button
          onClick={props.onSyncStars}
          disabled={props.isSyncing}
          className="interactive-btn w-full py-2.5 bg-primary text-on-primary rounded-lg font-body-md text-body-md font-semibold flex items-center justify-center gap-2 mb-2 shadow-md shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Icon name={props.isSyncing ? 'progress_activity' : 'sync'} size={18} className={props.isSyncing ? 'animate-spin' : ''} />
          {props.isSyncing ? '同步中...' : '同步数据'}
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
      <div className="flex-1 ml-[260px] flex flex-col h-screen">
        {/* TopNavBar */}
        <header className="glass-topbar sticky top-0 z-30 h-16 flex justify-between items-center px-gutter w-full">
          {/* Search */}
          <div className="relative w-96 group">
            <Icon
              name="search"
              size={20}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors"
            />
            <input
              type="text"
              placeholder="搜索仓库、标签或内容..."
              className="w-full bg-surface-container-low border border-card-border rounded-full pl-10 pr-12 py-2 font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all bg-white/50 backdrop-blur-md"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <kbd className="font-label-sm text-[10px] text-outline bg-surface px-1.5 rounded border border-card-border">
                ⌘
              </kbd>
              <kbd className="font-label-sm text-[10px] text-outline bg-surface px-1.5 rounded border border-card-border">
                K
              </kbd>
            </div>
          </div>

          {/* Trailing Actions */}
          <div className="flex items-center gap-2">
            <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors relative">
              <Icon name="history" size={20} />
            </button>
            <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface transition-colors relative">
              <Icon name="notifications" size={20} />
              {props.syncSummary && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full border border-surface" />
              )}
            </button>
            <div className="h-6 w-px bg-card-border mx-1" />
            <button className="flex items-center gap-2 hover:bg-surface-container-low p-1 pr-3 rounded-full transition-colors border border-transparent hover:border-card-border">
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
              <span className="font-body-md text-sm font-medium text-on-surface">
                {props.user?.login ?? '未连接'}
              </span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-hidden">{props.children}</main>
      </div>
    </div>
  );
}
