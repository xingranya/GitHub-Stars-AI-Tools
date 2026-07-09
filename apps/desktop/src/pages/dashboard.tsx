import { useEffect, useMemo, useState } from 'react';
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

/* 语言 → 短代码（用于快捷访问色块，近似品牌 logo） */
const LANGUAGE_SHORT: Record<string, string> = {
  TypeScript: 'TS',
  JavaScript: 'JS',
  Python: 'PY',
  Rust: 'RS',
  Go: 'GO',
  Java: 'JV',
  'C++': 'C++',
  C: 'C',
  CSharp: 'C#',
  Ruby: 'RB',
  Swift: 'SW',
  Kotlin: 'KT',
  Vue: 'VUE',
  HTML: 'HT',
  CSS: 'CSS',
  Shell: 'SH',
  Dart: 'DT',
  PHP: 'PHP',
};

function getLanguageColor(language: string | null): string {
  if (!language) return '#c3c6d7';
  return LANGUAGE_COLORS[language] ?? '#c3c6d7';
}

function getLanguageShort(language: string | null): string {
  if (!language) return '其他';
  return LANGUAGE_SHORT[language] ?? language.slice(0, 2).toUpperCase();
}

/* 按月聚合仓库数量，生成迷你走势线的数据序列 */
function buildMonthlySeries(
  items: readonly RepositoryListItem[],
  field: 'starredAt' | 'aiGeneratedAt',
  months = 9,
): number[] {
  const buckets = new Array(months).fill(0);
  const now = new Date();
  for (const item of items) {
    const raw = item[field];
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    const monthsAgo = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    if (monthsAgo >= 0 && monthsAgo < months) {
      buckets[months - 1 - monthsAgo] += 1;
    }
  }
  return buckets;
}

type DashboardPageProps = {
  onOpenRepository: (query: string) => void;
  onSelectLanguage: (language: string) => void;
  onOpenSettings: () => void;
};

const EMPTY_DASHBOARD_STATS: DashboardStats = {
  totalRepos: 0,
  totalStars: 0,
  totalReadmes: 0,
  totalAiSummaries: 0,
  totalAiInputTokens: 0,
  totalAiOutputTokens: 0,
  totalTags: 0,
  totalNotes: 0,
  languageDistribution: [],
  recentRepos: [],
  lastSyncAt: null,
};

const RECENT_ALL_TAB = '全部';
const RECENT_OTHER_TAB = '其他';

export function DashboardPage(props: DashboardPageProps) {
  const workspace = useWorkspace();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [, setIsLoadingStats] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentTab, setRecentTab] = useState<string>(RECENT_ALL_TAB);

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

  // 全量仓库（用于走势线与最近收藏的语言筛选）
  const allRepos = useMemo(
    () => workspace.repositoryPage?.items ?? [],
    [workspace.repositoryPage],
  );

  // 迷你走势线序列
  const starSeries = useMemo(() => buildMonthlySeries(allRepos, 'starredAt'), [allRepos]);
  const aiSeries = useMemo(() => buildMonthlySeries(allRepos, 'aiGeneratedAt'), [allRepos]);

  // 最近收藏来源：优先全量仓库按收藏时间倒序，回退后端聚合结果
  const recentSource = useMemo<RepositoryListItem[]>(() => {
    if (allRepos.length > 0) {
      return [...allRepos].sort((a, b) => b.starredAt.localeCompare(a.starredAt));
    }
    return displayStats?.recentRepos ?? [];
  }, [allRepos, displayStats?.recentRepos]);

  // 最近收藏的语言筛选 Tab
  const recentTabs = useMemo(() => {
    const langs = (displayStats?.languageDistribution ?? [])
      .slice(0, 4)
      .map((item) => item.language)
      .filter((lang): lang is string => Boolean(lang));
    return [RECENT_ALL_TAB, ...langs, RECENT_OTHER_TAB];
  }, [displayStats?.languageDistribution]);

  const topLanguageSet = useMemo(
    () => new Set(recentTabs.filter((tab) => tab !== RECENT_ALL_TAB && tab !== RECENT_OTHER_TAB)),
    [recentTabs],
  );

  const recentRepos = useMemo(() => {
    const filtered = recentSource.filter((repo) => {
      if (recentTab === RECENT_ALL_TAB) return true;
      if (recentTab === RECENT_OTHER_TAB) return !repo.language || !topLanguageSet.has(repo.language);
      return repo.language === recentTab;
    });
    return filtered.slice(0, 6);
  }, [recentSource, recentTab, topLanguageSet]);

  if (!displayStats) {
    return (
      <div className="flex h-full items-center justify-center p-4 sm:p-5 lg:p-margin-page">
        <Icon name="progress_activity" size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  const readmeCoverage = displayStats.totalRepos > 0
    ? Math.round((displayStats.totalReadmes / displayStats.totalRepos) * 100)
    : 0;
  const noteCoverage = displayStats.totalRepos > 0
    ? Math.round((displayStats.totalNotes / displayStats.totalRepos) * 100)
    : 0;
  const newStarBadge = workspace.syncSummary
    ? `新增 ${workspace.syncSummary.createdCount}`
    : `${compactNumber(displayStats.totalStars)} stars`;

  const syncStatus = workspace.authState.user
    ? workspace.isSyncingStars
      ? {
          badgeText: '同步中',
          badgeClass: 'bg-primary/10 text-primary',
          icon: 'sync',
          iconClass: 'text-primary',
          iconBgClass: 'bg-primary/10',
          title: '正在同步',
          detail: '正在从 GitHub 更新本地数据',
        }
      : workspace.syncSummary || displayStats.totalRepos > 0
        ? {
            badgeText: '同步正常',
            badgeClass: 'bg-success/10 text-success',
            icon: 'cloud_done',
            iconClass: 'text-success',
            iconBgClass: 'bg-success/10',
            title: '本地数据可用',
            detail: displayStats.lastSyncAt
              ? `最近同步：${formatDate(displayStats.lastSyncAt)}`
              : workspace.syncSummary
                ? `活跃 ${workspace.syncSummary.activeCount} 个仓库`
                : `本地已有 ${displayStats.totalRepos} 个仓库`,
          }
        : {
            badgeText: '尚未同步',
            badgeClass: 'bg-warning/10 text-warning',
            icon: 'cloud_sync',
            iconClass: 'text-warning',
            iconBgClass: 'bg-warning/10',
            title: '尚未同步',
            detail: '点击同步按钮开始',
          }
    : {
        badgeText: '未连接',
        badgeClass: 'bg-surface-container-highest text-on-surface-variant',
        icon: 'cloud_off',
        iconClass: 'text-on-surface-variant',
        iconBgClass: 'bg-surface-container-highest',
        title: '未连接 GitHub',
        detail: '请先连接 GitHub 账号',
      };

  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-y-auto p-4 sm:gap-6 sm:p-5 lg:p-margin-page">
      {/* 欢迎行 */}
      <div className="mb-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:mb-2">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">概览</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            欢迎回来，这是您的数据仓库实时看板。
          </p>
        </div>
        <div className="text-left sm:text-right">
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

      {/* Bento 网格：统计概览 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="star"
          iconBgClass="bg-primary/10"
          iconColorClass="text-primary"
          badge={<TrendBadge icon="trending_up" value={newStarBadge} />}
          label="收藏仓库"
          value={compactNumber(displayStats.totalRepos)}
          chart={<Sparkline id="spark-star" data={starSeries} color="var(--color-primary)" />}
        />
        <StatCard
          icon="auto_awesome"
          iconBgClass="bg-tertiary/10"
          iconColorClass="text-tertiary"
          badge={<TrendBadge value={`${compactNumber(displayStats.totalAiSummaries)} 生成 / ${compactNumber(displayStats.totalAiOutputTokens)} 输出`} />}
          label="AI 摘要与用量"
          value={compactNumber(displayStats.totalAiSummaries)}
          chart={<Sparkline id="spark-ai" data={aiSeries} color="#F59E0B" />}
        />
        <StatCard
          icon="description"
          iconBgClass="bg-surface-container-highest"
          iconColorClass="text-on-surface-variant"
          label="README 缓存"
          value={`${readmeCoverage}%`}
          progress={<ProgressBar value={readmeCoverage} color="var(--color-primary)" showBounds />}
        />
        <StatCard
          icon="label"
          iconBgClass="bg-success/10"
          iconColorClass="text-success"
          label="标签与笔记"
          value={
            <span>
              {compactNumber(displayStats.totalTags)}
              <span className="text-lg text-on-surface-variant"> / {compactNumber(displayStats.totalNotes)}</span>
            </span>
          }
          progress={<ProgressBar value={noteCoverage} color="var(--color-success)" />}
        />
      </div>

      {/* 中部区域：语言分布 · 同步状态 · 快捷访问 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* 语言分布 */}
        <div className="glass-card flex flex-col rounded-xl p-6 lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="font-headline-md text-lg text-on-surface">语言分布</h3>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-6">
            {displayStats.languageDistribution.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-on-surface-variant">
                <Icon name="inbox" size={48} className="opacity-30" />
                <p className="font-body-md text-sm">同步 Stars 后即可查看语言分布</p>
              </div>
            ) : (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full shadow-sm">
                  {displayStats.languageDistribution.slice(0, 6).map((item) => (
                    <div
                      key={item.language}
                      className="h-full transition-all"
                      style={{ width: `${item.percentage}%`, backgroundColor: getLanguageColor(item.language) }}
                      title={item.language}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  {displayStats.languageDistribution.slice(0, 5).map((item) => (
                    <div key={item.language} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: getLanguageColor(item.language) }}
                      />
                      <div>
                        <p className="font-label-sm text-label-sm font-semibold text-on-surface">{item.language}</p>
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

        {/* 同步状态 */}
        <div className="glass-card flex flex-col justify-between rounded-xl bg-gradient-to-br from-surface-bright to-surface-container-low p-6">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-headline-md text-lg text-on-surface">同步状态</h3>
              <span className={`rounded-full px-2 py-0.5 font-label-sm text-[11px] font-medium ${syncStatus.badgeClass}`}>
                {syncStatus.badgeText}
              </span>
            </div>
            <div className="mb-6 flex items-center gap-3">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full ${syncStatus.iconBgClass} ${syncStatus.iconClass}`}>
                <Icon name={syncStatus.icon} size={24} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
              </div>
              <div className="min-w-0">
                <p className="font-body-md text-body-md font-semibold text-on-surface">{syncStatus.title}</p>
                <p className="truncate font-label-sm text-label-sm text-on-surface-variant">{syncStatus.detail}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (workspace.authState.user ? void workspace.handleSyncStars() : props.onOpenSettings())}
              disabled={workspace.isSyncingStars}
              title={workspace.authState.user ? '同步 GitHub Stars' : '前往设置连接 GitHub 账号'}
              className="interactive-btn flex flex-1 items-center justify-center gap-2 rounded-lg border border-card-border bg-surface-container-high py-2 font-body-md text-sm font-medium text-on-surface hover:bg-surface-container-highest disabled:opacity-60"
            >
              <Icon name="sync" size={16} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
              {workspace.isSyncingStars ? '同步中...' : workspace.authState.user ? '立即同步' : '先连接 GitHub'}
            </button>
            <button
              type="button"
              onClick={props.onOpenSettings}
              title="同步记录（在设置中查看）"
              className="flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-2 font-label-sm text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              同步记录
              <Icon name="chevron_right" size={16} />
            </button>
          </div>
        </div>

        {/* 快捷访问 */}
        <div className="glass-card flex flex-col rounded-xl p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h3 className="font-headline-md text-lg text-on-surface">快捷访问</h3>
            <Icon name="bolt" size={20} className="mt-0.5 shrink-0 text-primary" />
          </div>
          {displayStats.languageDistribution.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-on-surface-variant">
              <Icon name="inbox" size={42} className="opacity-30" />
              <p className="font-body-md text-sm">暂无快捷访问项</p>
            </div>
          ) : (
            <>
              <div className="grid flex-1 grid-cols-2 content-start gap-3">
                {displayStats.languageDistribution.slice(0, 4).map((item) => (
                  <button
                    key={item.language}
                    type="button"
                    onClick={() => props.onSelectLanguage(item.language)}
                    className="interactive-btn group flex flex-col items-start gap-3 rounded-lg border border-card-border bg-surface/60 p-3 text-left transition-colors hover:border-primary/25 hover:bg-surface-container-low"
                  >
                    <span className="flex w-full items-start justify-between gap-2">
                      <span
                        className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 font-label-sm text-[11px] font-bold text-white"
                        style={{ backgroundColor: getLanguageColor(item.language) }}
                      >
                        {getLanguageShort(item.language)}
                      </span>
                      <span className="rounded-md bg-surface-container-high px-1.5 py-0.5 font-label-sm text-[10px] text-on-surface-variant">
                        {item.percentage}%
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-body-md text-sm font-semibold text-on-surface">{item.language}</span>
                      <span className="mt-0.5 block font-label-sm text-[11px] text-on-surface-variant">
                        {item.count} 个仓库
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => props.onSelectLanguage('')}
                className="mt-4 flex items-center justify-center gap-0.5 rounded-lg py-2 font-label-sm text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                查看全部语言分布
                <Icon name="chevron_right" size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 底部区域：最近收藏（整行） */}
      <div className="glass-card flex min-h-[320px] flex-col rounded-xl p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="font-headline-md text-lg text-on-surface">最近收藏</h3>
            <div className="flex flex-wrap gap-1">
              {recentTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setRecentTab(tab)}
                  className={`rounded-full px-2.5 py-1 font-label-sm text-xs transition-colors ${
                    recentTab === tab
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => props.onSelectLanguage('')}
            className="flex shrink-0 items-center gap-0.5 font-label-sm text-xs font-medium text-primary transition-colors hover:opacity-80"
          >
            查看全部
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-2">
          {recentRepos.length === 0 ? (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-on-surface-variant">
              <Icon name="inbox" size={48} className="opacity-30" />
              <p className="font-body-md">{recentTab === RECENT_ALL_TAB ? '暂无收藏，同步后即可查看' : '该分类下暂无收藏'}</p>
            </div>
          ) : (
            recentRepos.map((repo) => (
              <RecentRepoRow
                key={repo.id}
                repo={repo}
                onOpenRepository={props.onOpenRepository}
              />
            ))
          )}
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
  badge?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  chart?: React.ReactNode;
  progress?: React.ReactNode;
}) {
  return (
    <div className="glass-card group relative flex flex-col overflow-hidden rounded-xl p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={`grid size-11 shrink-0 place-items-center rounded-lg ${props.iconBgClass} ${props.iconColorClass}`}>
          <Icon name={props.icon} size={22} className="block leading-none" />
        </div>
        {props.badge}
      </div>
      <h3 className="mb-1 font-body-md text-body-md text-on-surface-variant">{props.label}</h3>
      <div className="flex items-end justify-between gap-3">
        <p className="font-headline-lg text-headline-lg leading-none text-on-surface">{props.value}</p>
        {props.chart && <div className="min-w-0 flex-1 pb-0.5">{props.chart}</div>}
      </div>
      {props.progress && <div className="mt-4">{props.progress}</div>}
    </div>
  );
}

function TrendBadge(props: { icon?: string; value: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-label-sm text-label-sm text-success">
      {props.icon && <Icon name={props.icon} size={14} />}
      {props.value}
    </span>
  );
}

/* 迷你走势线（SVG sparkline） */
function Sparkline(props: { id: string; data: number[]; color: string }) {
  const width = 120;
  const height = 40;
  const data = props.data.length > 0 ? props.data : [0, 0];
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((value, index) => {
    const x = index * step;
    // 顶部留 6px、底部留 4px 边距，避免线贴边
    const y = height - 4 - ((value - min) / range) * (height - 10);
    return { x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const gradientId = `${props.id}-gradient`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-10 w-full" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={props.color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={props.color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={props.color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* 进度条 */
function ProgressBar(props: { value: number; color: string; showBounds?: boolean }) {
  const clamped = Math.max(0, Math.min(100, props.value));
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: props.color }}
        />
      </div>
      {props.showBounds && (
        <div className="mt-1 flex items-center justify-between font-label-sm text-[10px] text-on-surface-variant">
          <span>{clamped}%</span>
          <span>100%</span>
        </div>
      )}
    </div>
  );
}

/* GitHub 官方 mark（octocat） */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function RecentRepoRow({
  repo,
  onOpenRepository,
}: {
  repo: RepositoryListItem;
  onOpenRepository: (query: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-card-border hover:bg-surface/60">
      <button
        type="button"
        onClick={() => onOpenRepository(repo.fullName)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <GitHubMark className="h-5 w-5 shrink-0 text-on-surface-variant" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-body-md text-body-md font-medium text-on-surface transition-colors group-hover:text-primary" title={repo.fullName}>
            {repo.fullName}
          </p>
          <p className="truncate font-body-md text-sm text-on-surface-variant">
            {repo.description ?? '暂无描述'}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span
          className="hidden rounded px-2 py-0.5 font-label-sm text-[11px] sm:inline-block"
          style={{
            backgroundColor: `${getLanguageColor(repo.language)}1f`,
            color: getLanguageColor(repo.language),
          }}
        >
          {repo.language ?? '其他'}
        </span>
        <span className="flex items-center gap-0.5 whitespace-nowrap font-label-sm text-[11px] text-on-surface-variant">
          <Icon name="star" size={12} /> {compactNumber(repo.starsCount)}
        </span>
        <span className="hidden whitespace-nowrap font-label-sm text-[11px] text-on-surface-variant md:inline">
          {formatRelativeTime(repo.starredAt)}
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            title="更多操作"
            aria-label="更多操作"
            aria-expanded={menuOpen}
          >
            <Icon name="more_vert" size={18} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-40 overflow-hidden rounded-lg border border-card-border bg-surface p-1 shadow-xl shadow-black/15">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenRepository(repo.fullName);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-body-md text-sm text-on-surface transition-colors hover:bg-surface-container-low"
                >
                  <Icon name="open_in_new" size={16} />
                  查看详情
                </button>
                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-body-md text-sm text-on-surface transition-colors hover:bg-surface-container-low"
                >
                  <GitHubMark className="h-4 w-4" />
                  在 GitHub 打开
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
