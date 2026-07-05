import { Search, SlidersHorizontal, Grid, List } from 'lucide-react';

export function RepositoriesPage() {
  return (
    <div className="repositories-page space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="headline-lg text-on-surface">全部仓库</h1>
          <p className="body-md text-on-surface-variant mt-2">
            管理你的 328 个 GitHub Stars
          </p>
        </div>
        <div className="flex gap-3">
          <button className="glass-card px-4 py-2 rounded-lg hover:bg-surface-container transition-colors">
            <Grid className="size-5 text-on-surface-variant" />
          </button>
          <button className="glass-card px-4 py-2 rounded-lg hover:bg-surface-container transition-colors">
            <List className="size-5 text-primary" />
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="glass-card p-4 flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-on-surface-variant" />
          <input
            type="text"
            placeholder="搜索仓库名称、描述..."
            className="w-full h-10 pl-10 pr-4 rounded-lg bg-surface-container text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button className="px-4 py-2 rounded-lg bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors flex items-center gap-2">
          <SlidersHorizontal className="size-5" />
          <span className="label-md">筛选</span>
        </button>
      </div>

      {/* 仓库列表 */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <RepoCard key={i} />
        ))}
      </div>
    </div>
  );
}

function RepoCard() {
  return (
    <div className="glass-card card-hover p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="headline-sm text-on-surface">facebook/react</h3>
            <span className="px-2 py-0.5 rounded bg-primary/10 text-primary label-sm">
              Public
            </span>
          </div>
          <p className="body-md text-on-surface-variant">
            The library for web and native user interfaces
          </p>
        </div>
        <button className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-container transition-colors">
          打开
        </button>
      </div>

      <div className="flex items-center gap-6 mb-4">
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded-full bg-warning" />
          <span className="body-sm text-on-surface-variant">JavaScript</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="body-sm text-on-surface-variant">⭐ 228k</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="body-sm text-on-surface-variant">🍴 46.8k</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="body-sm text-on-surface-variant">更新于 2 天前</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="px-3 py-1 rounded-full bg-primary/10 text-primary label-sm">
          前端
        </span>
        <span className="px-3 py-1 rounded-full bg-success/10 text-success label-sm">
          框架
        </span>
        <span className="px-3 py-1 rounded-full bg-tertiary/10 text-tertiary label-sm">
          React
        </span>
      </div>
    </div>
  );
}
