import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '@/providers/workspace-provider';
import { Icon } from '@/components/ui/icon';
import { compactNumber, formatDate } from '@/lib/format';
import type { DashboardStats, RepositoryListItem } from '@/types';

/* 语言 → 颜色映射 (GitHub Linguist 风格) */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178C6',
  JavaScript: '#F7DF1E',
  Python: '#3572A5',
  Rust: '#DEA584',
  Go: '#00ADD8',
  Java: '#b07219',
  C: '#555555',
  'C++': '#f34b7d',
  CSharp: '#178600',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Vue: '#41b883',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Dart: '#00B4AB',
  Lua: '#000080',
  PHP: '#4F5D95',
  Scala: '#c22d40',
};

function getLanguageColor(language: string | null): string {
  if (!language) return '#c3c6d7';
  return LANGUAGE_COLORS[language] ?? '#c3c6d7';
}

type DashboardPageProps = {
  onOpenRepository: (query: string) => void;
  onSelectLanguage: (language: string) => void;
};

const EMPTY_DASHBOARD_STATS: DashboardStats = {
  totalRepos: 0,
  totalStars: 0,
  totalReadmes: 0,
  totalAiSummaries: 0,
  totalTags: 0,
  totalNotes: 0,
  languageDistribution: [],
  recentRepos: [],
  lastSyncAt: null,
};

export function DashboardPage(props: DashboardPageProps) {
  const workspace = useWorkspace();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 从后端拉取聚合统计
  useEffect(() => {
    let cancelled = false;
    const accountId = workspace.authState.user ? String(workspace.authState.user.id) : undefined;
    if (!accountId) {
      setStats(EMPTY_DASHBOARD_STATS);
      setIsLoadingStats(false);
      setErrorMessage(null);
      return;
    }
    setIsLoadingStats(true);
    setErrorMessage(null);
    invoke<DashboardStats>('get_dashboard_stats', { request: { accountId } })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((reason) => {
        if (!cancelled) {
          setStats(EMPTY_DASHBOARD_STATS);
          setErrorMessage(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStats(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.authState.user?.id, workspace.repositoryPage, workspace.tags, workspace.syncSummary]);

  const displayStats = stats;

  if (!displayStats) {
    return (
      <div className="p-margin-page flex items-center justify-center h-full">
        <Icon name="progress_activity" size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  const recentRepos = displayStats.recentRepos.slice(0, 5);
  const syncStatus = workspace.authState.user
    ? workspace.isSyncingStars
      ? {
          dotClass: 'bg-primary animate-pulse',
          icon: 'sync',
          iconClass: 'text-primary',
          iconBgClass: 'bg-primary/10',
          title: '正在同步',
          detail: '正在从 GitHub 更新本地数据',
        }
      : workspace.syncSummary || displayStats.totalRepos > 0
        ? {
            dotClass: 'bg-success',
            icon: 'cloud_done',
            iconClass: 'text-success',
            iconBgClass: 'bg-success/10',
            title: '本地数据可用',
            detail: workspace.syncSummary
              ? `活跃 ${workspace.syncSummary.activeCount} 个仓库`
              : `本地已有 ${displayStats.totalRepos} 个仓库`,
          }
        : {
            dotClass: 'bg-warning',
            icon: 'cloud_sync',
            iconClass: 'text-warning',
            iconBgClass: 'bg-warning/10',
            title: '尚未同步',
            detail: '点击同步按钮开始',
          }
    : {
        dotClass: 'bg-outline',
        icon: 'cloud_off',
        iconClass: 'text-on-surface-variant',
        iconBgClass: 'bg-surface-container-highest',
        title: '未连接 GitHub',
        detail: '请先连接 GitHub 账号',
      };

  return (
    <div className="p-margin-page flex flex-col gap-6 w-full max-w-7xl mx-auto overflow-y-auto h-full">
      {/* Welcome Row */}
      <div className="flex justify-between items-end mb-2">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">概览</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            欢迎回来，这是您的数据仓库实时情报。
          </p>
        </div>
        <div className="text-right">
          <p className="font-label-sm text-label-sm text-on-surface-variant">最后同步</p>
          <p className="font-body-md text-body-md text-on-surface font-medium">
            {displayStats.lastSyncAt ? formatDate(displayStats.lastSyncAt) : workspace.syncSummary ? '刚刚' : '尚未同步'}
          </p>
        </div>
      </div>
      {errorMessage && (
        <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
          仪表盘统计读取失败：{errorMessage}
        </div>
      )}

      {/* Bento Grid: Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="star"
          iconBgClass="bg-primary/10"
          iconColorClass="text-primary"
          trend={<TrendBadge icon="trending_up" value={`${compactNumber(displayStats.totalStars)} stars`} />}
          label="收藏仓库"
          value={compactNumber(displayStats.totalRepos)}
          blobClass="bg-primary/5 group-hover:bg-primary/10"
        />
        <StatCard
          icon="auto_awesome"
          iconBgClass="bg-tertiary/10"
          iconColorClass="text-tertiary"
          trend={<TrendBadge value={`${Math.round((displayStats.totalAiSummaries / Math.max(displayStats.totalRepos, 1)) * 100)}% 覆盖`} />}
          label="AI 摘要数"
          value={compactNumber(displayStats.totalAiSummaries)}
          blobClass="bg-tertiary/5 group-hover:bg-tertiary/10"
        />
        <StatCard
          icon="description"
          iconBgClass="bg-surface-container-highest"
          iconColorClass="text-on-surface-variant"
          trend={<TrendBadge value={`${Math.round((displayStats.totalReadmes / Math.max(displayStats.totalRepos, 1)) * 100)}% 覆盖`} />}
          label="README 缓存"
          value={compactNumber(displayStats.totalReadmes)}
        />
        <StatCard
          icon="label"
          iconBgClass="bg-surface-container-highest"
          iconColorClass="text-on-surface-variant"
          label="标签与笔记"
          value={
            <span>
              {compactNumber(displayStats.totalTags)}
              <span className="text-lg text-on-surface-variant"> / {compactNumber(displayStats.totalNotes)}</span>
            </span>
          }
        />
      </div>

      {/* Middle Row: Distribution & Sync Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Language Distribution */}
        <div className="glass-card rounded-xl p-6 lg:col-span-2 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline-md text-headline-md text-on-surface text-lg">语言分布</h3>
          </div>
          <div className="flex-1 flex flex-col justify-center gap-6">
            {displayStats.languageDistribution.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant gap-2">
                <Icon name="inbox" size={48} className="opacity-30" />
                <p className="font-body-md text-sm">同步 Stars 后即可查看语言分布</p>
              </div>
            ) : (
              <>
                <div className="w-full h-3 rounded-full flex overflow-hidden shadow-sm">
                  {displayStats.languageDistribution.slice(0, 6).map((item) => (
                    <div
                      key={item.language}
                      className="h-full transition-all"
                      style={{ width: `${item.percentage}%`, backgroundColor: getLanguageColor(item.language) }}
                      title={item.language}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {displayStats.languageDistribution.slice(0, 5).map((item) => (
                    <div key={item.language} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: getLanguageColor(item.language) }}
                      />
                      <div>
                        <p className="font-label-sm text-label-sm text-on-surface font-semibold">{item.language}</p>
                        <p className="font-label-sm text-[11px] text-on-surface-variant">
                          {item.percentage}% ({item.count})
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sync Status Widget */}
        <div className="glass-card rounded-xl p-6 flex flex-col justify-between bg-gradient-to-br from-surface-bright to-surface-container-low">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-headline-md text-headline-md text-on-surface text-lg">同步状态</h3>
              <div className={`w-2 h-2 rounded-full ${syncStatus.dotClass}`} />
            </div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${syncStatus.iconBgClass} ${syncStatus.iconClass}`}>
                <Icon name={syncStatus.icon} size={24} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
              </div>
              <div>
                <p className="font-body-md text-body-md text-on-surface font-semibold">
                  {syncStatus.title}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  {syncStatus.detail}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => void workspace.handleSyncStars()}
            disabled={workspace.isSyncingStars || !workspace.authState.user}
            title={workspace.authState.user ? '同步 GitHub Stars' : '请先在设置中连接 GitHub 账号'}
            className="interactive-btn w-full py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Icon name="sync" size={16} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
            {workspace.isSyncingStars ? '同步中...' : workspace.authState.user ? '立即同步' : '先连接 GitHub'}
          </button>
        </div>
      </div>

      {/* Bottom Row: Recent Stars & Quick Access */}
        <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Stars */}
          <div className="glass-card flex min-h-[320px] flex-col rounded-xl p-5 sm:p-6 lg:col-span-2 xl:min-h-[380px]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface text-lg">最近收藏</h3>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 no-scrollbar">
            {recentRepos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-on-surface-variant gap-2">
                <Icon name="inbox" size={48} className="opacity-30" />
                <p className="font-body-md">暂无收藏，同步后即可查看</p>
              </div>
            ) : (
              recentRepos.map((repo) => (
                <RecentRepoItem
                  key={repo.id}
                  repo={repo}
                  onOpenRepository={props.onOpenRepository}
                />
              ))
            )}
          </div>
        </div>

        {/* Quick Access */}
        <div className="glass-card flex min-h-[320px] flex-col rounded-xl p-5 sm:p-6 xl:min-h-[380px]">
          <h3 className="font-headline-md text-headline-md text-on-surface text-lg mb-4">快捷访问</h3>
          <p className="font-body-md text-sm text-on-surface-variant mb-6">高频访问的主题和技术栈</p>
          <div className="grid grid-cols-2 gap-3 flex-1">
            {displayStats.languageDistribution.length === 0 ? (
              <div className="col-span-2 flex flex-col items-center justify-center text-on-surface-variant gap-2">
                <Icon name="inbox" size={42} className="opacity-30" />
                <p className="font-body-md text-sm">暂无快捷访问项</p>
              </div>
            ) : (
              displayStats.languageDistribution.slice(0, 4).map((item, idx) => {
                const icons = ['code_blocks', 'palette', 'terminal', 'psychology'];
                const colors = [getLanguageColor(item.language), '#38B2AC', '#DEA584', 'text-tertiary'];
                return (
                  <button
                    key={item.language}
                    type="button"
                    onClick={() => props.onSelectLanguage(item.language)}
                    className="interactive-btn flex flex-col items-center justify-center gap-2 p-3 rounded-lg border border-card-border bg-surface/50 hover:bg-surface-container-low transition-colors"
                  >
                    <Icon name={icons[idx] ?? 'code_blocks'} size={28} style={{ color: colors[idx] }} />
                    <span className="font-body-md text-sm font-medium text-on-surface">{item.language}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* === 子组件 === */

function StatCard(props: {
  icon: string;
  iconBgClass: string;
  iconColorClass: string;
  trend?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  blobClass?: string;
  progress?: React.ReactNode;
  progressLabel?: string;
}) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col justify-between relative overflow-hidden group">
      {props.blobClass && (
        <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full blur-xl transition-colors ${props.blobClass}`} />
      )}
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className={`p-2 rounded-lg ${props.iconBgClass} ${props.iconColorClass}`}>
          <Icon name={props.icon} size={20} />
        </div>
        {props.trend}
      </div>
      <div className="relative z-10 w-full">
        <h3 className="font-body-md text-body-md text-on-surface-variant mb-1">{props.label}</h3>
        <p className="font-headline-lg text-headline-lg text-on-surface mb-3">{props.value}</p>
        {props.progress}
        {props.progressLabel && (
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-2 text-right">{props.progressLabel}</p>
        )}
      </div>
    </div>
  );
}

function TrendBadge(props: { icon?: string; value: string }) {
  return (
    <span className="font-label-sm text-label-sm text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-full">
      {props.icon && <Icon name={props.icon} size={14} />}
      {props.value}
    </span>
  );
}

function RecentRepoItem({
  repo,
  onOpenRepository,
}: {
  repo: RepositoryListItem;
  onOpenRepository: (query: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenRepository(repo.fullName)}
      className="w-full p-4 rounded-lg border border-card-border bg-surface/40 hover:bg-surface/80 transition-colors flex justify-between items-start group text-left"
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon name="book" size={16} className="text-on-surface-variant" />
          <h4 className="font-body-md text-body-md text-on-surface font-medium group-hover:text-primary transition-colors">
            {repo.fullName}
          </h4>
        </div>
        <p className="font-body-md text-sm text-on-surface-variant line-clamp-1 mb-2">
          {repo.description ?? '暂无描述'}
        </p>
        <div className="flex gap-2">
          {repo.language && (
            <span className="px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-[11px] border border-card-border">
              {repo.language}
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-[11px] border border-card-border flex items-center gap-0.5">
            <Icon name="star" size={10} /> {compactNumber(repo.starsCount)}
          </span>
          {repo.aiSummary && (
            <span className="px-2 py-0.5 rounded bg-tertiary/10 text-tertiary font-label-sm text-[11px] border border-tertiary/20 flex items-center gap-1">
              <Icon name="auto_awesome" size={10} /> AI 摘要已生成
            </span>
          )}
        </div>
      </div>
      <p className="font-label-sm text-label-sm text-on-surface-variant text-[11px] whitespace-nowrap">
        {formatRelativeTime(repo.starredAt)}
      </p>
    </button>
  );
}

/* === 工具函数 === */

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return '刚刚';
  if (diffH < 24) return `${diffH} 小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return '昨天';
  if (diffD < 30) return `${diffD} 天前`;
  return formatDate(iso);
}
