import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { GlobalRankings } from '@/features/rankings/global-rankings';
import { PersonalRankings } from '@/features/rankings/personal-rankings';
import { useWorkspace } from '@/providers/workspace-provider';
import type { RankingSection } from '@/types';

const RANKING_SECTIONS: { value: RankingSection; label: string; description: string; icon: string }[] = [
  { value: 'global', label: '开源榜单', description: 'GitHub 活跃项目', icon: 'public' },
  { value: 'personal', label: '我的 Stars', description: '个人收藏排名', icon: 'kid_star' },
];

type RankingsPageProps = {
  onOpenSettings: () => void;
};

export function RankingsPage(props: RankingsPageProps) {
  const workspace = useWorkspace();
  const [section, setSection] = useState<RankingSection>('global');
  const accountId = workspace.authState.user ? String(workspace.authState.user.id) : null;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background md:flex-row" aria-label="排行榜">
      <aside className="shrink-0 border-b border-outline-variant/25 bg-surface md:w-[176px] md:border-b-0 md:border-r" aria-label="排行榜分类">
        <div className="hidden border-b border-outline-variant/20 px-4 py-4 md:block">
          <div className="flex items-center gap-2 text-on-surface">
            <Icon name="leaderboard" size={19} className="text-primary" />
            <h1 className="text-sm font-semibold">排行榜</h1>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-on-surface-variant">公开项目与个人收藏分开查看</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:p-3">
          {RANKING_SECTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSection(item.value)}
              className={`flex min-w-[150px] items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors md:min-w-0 ${section === item.value ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'}`}
              aria-current={section === item.value ? 'page' : undefined}
            >
              <Icon name={item.icon} size={18} fill={section === item.value} />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="mt-0.5 hidden truncate text-[10px] font-normal opacity-80 md:block">{item.description}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!accountId ? (
          <RankingConnectionRequired onOpenSettings={props.onOpenSettings} />
        ) : section === 'global' ? (
          <GlobalRankings accountId={accountId} />
        ) : (
          <PersonalRankings accountId={accountId} languages={workspace.repositoryLanguages} />
        )}
      </main>
    </section>
  );
}

function RankingConnectionRequired(props: { onOpenSettings: () => void }) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon name="leaderboard" size={24} />
        </span>
        <h2 className="mt-4 text-base font-semibold text-on-surface">连接 GitHub 后查看排行榜</h2>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          开源榜单需要 GitHub Token 获取公开搜索结果；个人榜单读取同步到本地的 Stars。
        </p>
        <Button className="mt-5" onClick={props.onOpenSettings}>
          <Icon name="link" size={16} />
          连接 GitHub
        </Button>
      </div>
    </div>
  );
}
