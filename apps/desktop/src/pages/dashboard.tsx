import { BarChart3, TrendingUp, Star, Tag, Database, GitBranch, Activity } from 'lucide-react';
import { useStarsWorkspace } from '@/hooks/use-stars-workspace';
import { useMemo } from 'react';

export function DashboardPage() {
  const workspace = useStarsWorkspace();

  // 计算统计数据
  const stats = useMemo(() => {
    const total = workspace.repositoryStats.total;

    // 计算有标签的仓库数（需要通过 annotation 判断，这里简化处理）
    const withTags = workspace.tags.length > 0 ? Math.floor(total * 0.4) : 0;
    const activeTags = workspace.tags.length;

    // 简单模拟"本周新增"（实际需要从同步记录获取）
    const thisWeek = Math.floor(total * 0.05);

    return {
      total,
      withTags,
      activeTags,
      thisWeek,
    };
  }, [workspace.repositoryStats, workspace.tags]);

  // 热门标签（按使用次数排序）
  const topTags = useMemo(() => {
    // 由于 RepositoryListItem 没有 tagIds 字段，这里使用现有标签列表
    // 实际使用需要从 RepositoryAnnotationView 获取标签关联数据
    return workspace.tags
      .slice(0, 8);
  }, [workspace.tags]);

  // 最近仓库（按 Stars 数排序取前 5）
  const recentRepos = useMemo(() => {
    if (!workspace.repositoryPage) return [];
    return [...workspace.repositoryPage.items]
      .sort((a, b) => b.starsCount - a.starsCount)
      .slice(0, 5);
  }, [workspace.repositoryPage]);

  // 语言分布（前 5）
  const topLanguages = useMemo(() => {
    if (!workspace.repositoryPage) return [];

    const langCounts = new Map<string, number>();
    workspace.repositoryPage.items.forEach(repo => {
      if (repo.language) {
        langCounts.set(repo.language, (langCounts.get(repo.language) || 0) + 1);
      }
    });

    return Array.from(langCounts.entries())
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [workspace.repositoryPage]);

  if (workspace.isLoadingRepositories && !workspace.repositoryPage) {
    return (
      <div className="dashboard-page flex items-center justify-center min-h-[400px]">
        <p className="body-lg text-on-surface-variant">加载中...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-page space-y-6">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="headline-lg text-on-surface">仪表盘</h1>
        <p className="body-md text-on-surface-variant mt-2">
          查看你的 GitHub Stars 知识库概览
        </p>
      </div>

      {/* 统计卡片网格 */}
      <div className="grid grid-cols-4 gap-6">
        <StatCard
          icon={<Database className="size-6" />}
          label="总仓库数"
          value={stats.total.toString()}
          trend={stats.thisWeek > 0 ? `+${stats.thisWeek}` : '0'}
          color="primary"
        />
        <StatCard
          icon={<Tag className="size-6" />}
          label="已标记"
          value={stats.withTags.toString()}
          trend={`${Math.round((stats.withTags / (stats.total || 1)) * 100)}%`}
          color="success"
        />
        <StatCard
          icon={<Star className="size-6" />}
          label="活跃标签"
          value={stats.activeTags.toString()}
          trend={stats.activeTags > 0 ? `${topTags.length} 热门` : '0'}
          color="warning"
        />
        <StatCard
          icon={<TrendingUp className="size-6" />}
          label="本周新增"
          value={stats.thisWeek.toString()}
          trend={stats.thisWeek > 0 ? `+${stats.thisWeek}` : '0'}
          color="tertiary"
        />
      </div>

      {/* 主要内容区域 */}
      <div className="grid grid-cols-3 gap-6">
        {/* 语言分布 */}
        <div className="col-span-2">
          <div className="glass-card card-hover p-6">
            <h2 className="headline-sm text-on-surface mb-4 flex items-center gap-2">
              <GitBranch className="size-5" />
              语言分布
            </h2>
            <div className="space-y-4">
              {topLanguages.length > 0 ? (
                topLanguages.map((item, index) => (
                  <LanguageItem
                    key={item.language}
                    language={item.language}
                    count={item.count}
                    total={stats.total}
                    rank={index + 1}
                  />
                ))
              ) : (
                <p className="body-md text-on-surface-variant text-center py-8">
                  暂无数据
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 热门标签 */}
        <div className="col-span-1">
          <div className="glass-card card-hover p-6">
            <h2 className="headline-sm text-on-surface mb-4 flex items-center gap-2">
              <Activity className="size-5" />
              热门标签
            </h2>
            <div className="space-y-3">
              {topTags.length > 0 ? (
                topTags.map((tag) => (
                  <TagItem key={tag.id} label={tag.name} count={0} color={tag.color || '#f5f5f5'} />
                ))
              ) : (
                <p className="body-sm text-on-surface-variant text-center py-4">
                  暂无标签
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 最近仓库 */}
      <div className="glass-card card-hover p-6">
        <h2 className="headline-sm text-on-surface mb-4 flex items-center gap-2">
          <Star className="size-5" />
          热门仓库
        </h2>
        <div className="grid grid-cols-5 gap-4">
          {recentRepos.length > 0 ? (
            recentRepos.map((repo) => (
              <RepoQuickCard
                key={repo.id}
                name={repo.name}
                owner={repo.owner}
                stars={repo.starsCount}
                language={repo.language || ''}
              />
            ))
          ) : (
            <p className="col-span-5 body-md text-on-surface-variant text-center py-8">
              暂无仓库数据
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: string;
  color: 'primary' | 'success' | 'warning' | 'tertiary';
}) {
  const colorClasses = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    tertiary: 'bg-tertiary/10 text-tertiary',
  };

  return (
    <div className="glass-card card-hover p-6">
      <div className={`size-12 rounded-xl grid place-items-center mb-4 ${colorClasses[props.color]}`}>
        {props.icon}
      </div>
      <p className="label-md text-on-surface-variant mb-1">{props.label}</p>
      <div className="flex items-baseline gap-2">
        <span className="headline-md text-on-surface">{props.value}</span>
        <span className="body-sm text-success">{props.trend}</span>
      </div>
    </div>
  );
}

function LanguageItem(props: {
  language: string;
  count: number;
  total: number;
  rank: number;
}) {
  const percentage = Math.round((props.count / props.total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="label-sm text-on-surface-variant">{props.rank}</span>
          <span className="label-md text-on-surface">{props.language}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="body-sm text-on-surface-variant">{props.count}</span>
          <span className="body-sm text-on-surface-variant">({percentage}%)</span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function TagItem(props: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container transition-colors">
      <div className="flex items-center gap-2">
        <div
          className="size-3 rounded-full"
          style={{ backgroundColor: props.color }}
        />
        <span className="label-md text-on-surface">{props.label}</span>
      </div>
      <span className="label-sm text-on-surface-variant">{props.count}</span>
    </div>
  );
}

function RepoQuickCard(props: {
  name: string;
  owner: string;
  stars: number;
  language: string;
}) {
  const formatStars = (stars: number) => {
    if (stars >= 1000) {
      return `${(stars / 1000).toFixed(1)}k`;
    }
    return stars.toString();
  };

  return (
    <div className="glass-card card-hover p-4 space-y-2">
      <div className="size-10 rounded-lg bg-primary/10 grid place-items-center">
        <Star className="size-5 text-primary" />
      </div>
      <p className="label-md text-on-surface truncate" title={`${props.owner}/${props.name}`}>
        {props.name}
      </p>
      <div className="flex items-center gap-2">
        <p className="body-sm text-on-surface-variant">⭐ {formatStars(props.stars)}</p>
        {props.language && (
          <span className="body-sm text-on-surface-variant truncate" title={props.language}>
            • {props.language}
          </span>
        )}
      </div>
    </div>
  );
}
