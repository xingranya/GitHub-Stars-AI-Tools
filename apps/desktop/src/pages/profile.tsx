import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
} from 'chart.js';
import { Radar, Line } from 'react-chartjs-2';
import { useWorkspace } from '@/providers/workspace-provider';
import { Icon } from '@/components/ui/icon';
import { compactNumber } from '@/lib/format';
import type { ProfileStats, RepositoryListItem } from '@/types';

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
);

const CHART_COLORS = {
  primary: '#2563eb',
  primaryContainer: '#eeefff',
  onSurfaceVariant: '#434655',
  gridColor: 'rgba(67, 70, 85, 0.1)',
};

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178C6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#DEA584',
  Go: '#00ADD8',
  'C++': '#f34b7d',
};

type ProfilePageProps = {
  onOpenRepository: (repository: RepositoryListItem) => void;
};

const EMPTY_PROFILE_STATS: ProfileStats = {
  totalStars: 0,
  totalNotes: 0,
  totalAiWords: 0,
  languageBreakdown: [],
  monthlyTrend: [],
  recentRepos: [],
};

export function ProfilePage(props: ProfilePageProps) {
  const workspace = useWorkspace();
  const user = workspace.authState.user;
  const [stats, setStats] = useState<ProfileStats>(EMPTY_PROFILE_STATS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setStats(EMPTY_PROFILE_STATS);
      setErrorMessage(null);
      return;
    }
    const request = { accountId: String(user.id) };
    invoke<ProfileStats>('get_profile_stats', { request })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((reason) => {
        if (!cancelled) setErrorMessage(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, workspace.repositoryPage, workspace.repositoryDetail, workspace.annotation, workspace.syncSummary]);

  // 雷达图数据
  const radarData = useMemo(() => {
    const topLangs = stats.languageBreakdown;
    return {
      labels: topLangs.map((l) => l.language),
      datasets: [
        {
          label: 'Stars 占比',
          data: topLangs.map((l) => l.percentage),
          backgroundColor: 'rgba(37, 99, 235, 0.2)',
          borderColor: CHART_COLORS.primary,
          pointBackgroundColor: CHART_COLORS.primary,
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: CHART_COLORS.primary,
          borderWidth: 2,
        },
      ],
    };
  }, [stats.languageBreakdown]);

  const radarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        angleLines: { color: CHART_COLORS.gridColor },
        grid: { color: CHART_COLORS.gridColor },
        pointLabels: {
          font: { family: 'Inter', size: 12 },
          color: CHART_COLORS.onSurfaceVariant,
        },
        ticks: { display: false },
        suggestedMin: 0,
        suggestedMax: 100,
      },
    },
    plugins: {
      legend: { display: false },
    },
  };

  // 折线图数据
  const lineData = useMemo(() => {
    const months = stats.monthlyTrend;
    return {
      labels: months.map((m) => {
        const [year, month] = m.month.split('-');
        return `${parseInt(month)}月`;
      }),
      datasets: [
        {
          label: '新增收藏仓库',
          data: months.map((m) => m.count),
          borderColor: CHART_COLORS.primary,
          backgroundColor: (ctx: any) => {
            const chart = ctx.chart;
            const { ctx: canvasCtx, chartArea } = chart;
            if (!chartArea) return 'rgba(37, 99, 235, 0.1)';
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(37, 99, 235, 0.4)');
            gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');
            return gradient;
          },
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: CHART_COLORS.primaryContainer,
          pointBorderColor: CHART_COLORS.primary,
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    };
  }, [stats.monthlyTrend]);
  const hasLanguageBreakdown = stats.languageBreakdown.length > 0;
  const hasMonthlyTrend = stats.monthlyTrend.length > 0;

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: 'Inter', size: 12 },
          color: CHART_COLORS.onSurfaceVariant,
        },
      },
      y: {
        grid: { color: CHART_COLORS.gridColor },
        ticks: {
          font: { family: 'Inter', size: 12 },
          color: CHART_COLORS.onSurfaceVariant,
        },
        beginAtZero: true,
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(25, 27, 35, 0.9)',
        titleFont: { family: 'Inter', size: 13 },
        bodyFont: { family: 'Inter', size: 13 },
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
      },
    },
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="p-margin-page pb-24">
        {/* Header Profile Section */}
        <div className="glass-card rounded-xl p-8 mb-8 flex flex-col md:flex-row items-center md:items-start gap-8 relative overflow-hidden">
          <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          {/* Avatar */}
          <div className="relative w-32 h-32 rounded-full overflow-hidden border-4 border-surface shadow-sm shrink-0">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.login} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-primary-container/20 flex items-center justify-center">
                <Icon name="person" size={64} className="text-primary" />
              </div>
            )}
          </div>
          {/* Info */}
          <div className="flex-1 text-center md:text-left z-10">
            <div className="flex flex-col md:flex-row items-center gap-3 mb-2">
              <h2 className="font-headline-lg text-on-surface">{user?.login ?? '未连接'}</h2>
            </div>
            <p className="font-body-lg text-on-surface-variant mb-4 max-w-2xl">
              {user ? '基于你的 GitHub Stars、笔记和 AI 摘要生成的本地知识库画像。' : '连接 GitHub 后即可查看个人知识库统计。'}
            </p>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4">
              {user?.htmlUrl && (
                <div className="flex items-center gap-1.5 text-on-surface-variant font-body-md">
                  <Icon name="link" size={18} />
                  <a href={user.htmlUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                    {user.htmlUrl.replace('https://', '')}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
        {errorMessage && <div className="mb-6 rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-error">{errorMessage}</div>}

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Radar Chart (Skills) */}
          <div className="glass-card flex min-h-[320px] flex-col rounded-xl p-5 sm:p-6 lg:col-span-1 xl:min-h-[380px]">
            <div className="flex items-center gap-2 mb-6">
              <Icon name="radar" size={20} className="text-primary" />
              <h3 className="font-headline-md text-on-surface text-lg">开发者技能偏好</h3>
            </div>
            <div className="flex-1 relative w-full h-full">
              {hasLanguageBreakdown ? (
                <Radar data={radarData} options={radarOptions} />
              ) : (
                <ChartEmptyState icon="radar" text="同步 Stars 后生成语言偏好画像" />
              )}
            </div>
            <p className="font-label-sm text-on-surface-variant text-center mt-4">基于 Stars 仓库主要语言分析</p>
          </div>

          {/* Stats & Recent Activity (2 cols) */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Stat Card 1: Notes */}
            <div className="glass-card rounded-xl p-6 flex flex-col justify-center relative overflow-hidden group">
              <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors duration-500" />
              <div className="flex items-center gap-3 mb-4 text-on-surface-variant z-10">
                <Icon name="description" size={20} className="p-2 bg-surface-container rounded-lg" />
                <span className="font-body-md font-medium">笔记数</span>
              </div>
              <div className="flex items-baseline gap-2 z-10">
                <span className="font-headline-lg text-4xl">{compactNumber(stats.totalNotes)}</span>
                <span className="font-body-md text-on-surface-variant">条</span>
              </div>
            </div>
            {/* Stat Card 2: AI Words */}
            <div className="glass-card rounded-xl p-6 flex flex-col justify-center relative overflow-hidden group">
              <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-tertiary-container/5 rounded-full blur-2xl group-hover:bg-tertiary-container/10 transition-colors duration-500" />
              <div className="flex items-center gap-3 mb-4 text-on-surface-variant z-10">
                <Icon name="psychology" size={20} className="p-2 bg-surface-container rounded-lg" />
                <span className="font-body-md font-medium">AI 总结总字数</span>
              </div>
              <div className="flex items-baseline gap-2 z-10">
                <span className="font-headline-lg text-4xl">{compactNumber(stats.totalAiWords)}</span>
                <span className="font-body-md text-on-surface-variant">字</span>
              </div>
            </div>
            {/* Recent Collections List */}
            <div className="glass-card rounded-xl p-6 sm:col-span-2 flex flex-col h-full">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Icon name="bookmark" size={20} className="text-primary" />
                  <h3 className="font-headline-md text-on-surface text-lg">最近深度解析仓库</h3>
                </div>
              </div>
              <div className="flex flex-col gap-3 flex-1 justify-center">
                {stats.recentRepos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant gap-2">
                    <Icon name="inbox" size={48} className="opacity-30" />
                    <p className="font-body-md text-sm">暂无收藏，同步后即可查看</p>
                  </div>
                ) : (
                  stats.recentRepos.map((repo) => (
                    <button
                      type="button"
                      key={repo.id}
                      onClick={() => props.onOpenRepository(repo)}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-container-low transition-colors border border-transparent hover:border-card-border cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded flex items-center justify-center font-bold text-sm"
                          style={{
                            backgroundColor: `${LANGUAGE_COLORS[repo.language ?? ''] ?? '#c3c6d7'}20`,
                            color: LANGUAGE_COLORS[repo.language ?? ''] ?? '#434655',
                          }}
                        >
                          {repo.language?.slice(0, 2).toUpperCase() ?? '??'}
                        </div>
                        <div>
                          <div className="font-body-md font-medium text-on-surface">{repo.fullName}</div>
                          <div className="font-label-sm text-on-surface-variant">
                            {repo.description?.slice(0, 40) ?? '暂无描述'}
                          </div>
                        </div>
                      </div>
                      <span className="font-label-sm text-on-surface-variant">
                        {formatRelativeTime(repo.starredAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Annual Trend Chart */}
        <div className="glass-card flex min-h-[300px] w-full flex-col rounded-xl p-5 sm:p-6 xl:min-h-[350px]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Icon name="monitoring" size={20} className="text-primary" />
              <h3 className="font-headline-md text-on-surface text-lg">年度收藏趋势</h3>
            </div>
          </div>
          <div className="flex-1 w-full relative">
            {hasMonthlyTrend ? (
              <Line data={lineData} options={lineOptions} />
            ) : (
              <ChartEmptyState icon="monitoring" text="同步 Stars 后生成年度收藏趋势" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartEmptyState(props: { icon: string; text: string }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center text-on-surface-variant">
      <Icon name={props.icon} size={42} className="opacity-30" />
      <p className="font-body-md text-sm">{props.text}</p>
    </div>
  );
}

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
  return new Date(iso).toLocaleDateString('zh-CN');
}
