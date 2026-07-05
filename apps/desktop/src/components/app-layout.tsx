import { ReactNode } from 'react';
import { LayoutDashboard, Database, Network, Sparkles, User, Settings, Search } from 'lucide-react';

type AppLayoutProps = {
  children: ReactNode;
  currentPage: 'dashboard' | 'repositories' | 'tag-network' | 'ai-search' | 'profile' | 'settings';
  onNavigate: (page: AppLayoutProps['currentPage']) => void;
  user: {
    login: string;
    avatarUrl: string | null;
  } | null;
};

export function AppLayout(props: AppLayoutProps) {
  return (
    <div className="app-layout">
      {/* 左侧边栏 */}
      <aside className="glass-sidebar fixed left-0 top-0 h-screen w-[260px] flex flex-col">
        {/* Logo 区域 */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-white shadow-lg">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="headline-sm text-on-surface">Stars AI</h1>
            <p className="body-sm text-on-surface-variant">知识管理工具</p>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 px-4 py-6 space-y-1">
          <NavItem
            icon={<LayoutDashboard className="size-5" />}
            label="仪表盘"
            isActive={props.currentPage === 'dashboard'}
            onClick={() => props.onNavigate('dashboard')}
          />
          <NavItem
            icon={<Database className="size-5" />}
            label="全部仓库"
            isActive={props.currentPage === 'repositories'}
            onClick={() => props.onNavigate('repositories')}
          />
          <NavItem
            icon={<Network className="size-5" />}
            label="标签网络"
            isActive={props.currentPage === 'tag-network'}
            onClick={() => props.onNavigate('tag-network')}
          />
          <NavItem
            icon={<Sparkles className="size-5" />}
            label="AI 搜索"
            isActive={props.currentPage === 'ai-search'}
            onClick={() => props.onNavigate('ai-search')}
          />
          <div className="my-4 h-px bg-outline-variant/30" />
          <NavItem
            icon={<User className="size-5" />}
            label="个人主页"
            isActive={props.currentPage === 'profile'}
            onClick={() => props.onNavigate('profile')}
          />
          <NavItem
            icon={<Settings className="size-5" />}
            label="设置"
            isActive={props.currentPage === 'settings'}
            onClick={() => props.onNavigate('settings')}
          />
        </nav>

        {/* 用户信息卡片 */}
        {props.user && (
          <div className="px-4 py-4 border-t border-white/10">
            <div className="glass-card p-3 flex items-center gap-3">
              {props.user.avatarUrl ? (
                <img
                  src={props.user.avatarUrl}
                  alt={props.user.login}
                  className="size-10 rounded-full"
                />
              ) : (
                <div className="size-10 rounded-full bg-primary/10 grid place-items-center">
                  <User className="size-5 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="label-md text-on-surface truncate">@{props.user.login}</p>
                <p className="body-sm text-on-surface-variant">已连接</p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* 主内容区 */}
      <div className="main-container ml-[260px] min-h-screen flex flex-col">
        {/* 顶部搜索栏 */}
        <header className="glass-topbar sticky top-0 z-40 h-16 flex items-center justify-center px-6">
          <div className="relative w-full max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-on-surface-variant" />
            <input
              type="text"
              placeholder="搜索仓库、标签、笔记..."
              className="w-full h-12 pl-12 pr-20 rounded-xl glass-card text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <kbd className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-surface-container-high text-on-surface-variant label-sm">
              ⌘K
            </kbd>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="content-area flex-1 p-8">
          {props.children}
        </main>
      </div>
    </div>
  );
}

function NavItem(props: {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
        props.isActive
          ? 'bg-primary text-white shadow-md'
          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
      }`}
      onClick={props.onClick}
    >
      {props.icon}
      <span className="label-md">{props.label}</span>
    </button>
  );
}
