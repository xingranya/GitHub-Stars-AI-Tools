import { Database, HardDrive, UserRound, Settings } from 'lucide-react';
import { PropsWithChildren, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BackendStatus, GitHubAuthState, RepositoryStats } from '@/types';

type AppShellProps = {
  authState: GitHubAuthState;
  content: ReactNode;
  detail: ReactNode;
  error: string | null;
  message: string | null;
  repositoryStats: RepositoryStats;
  sidebar: ReactNode;
  status: BackendStatus | null;
  toolbar: ReactNode;
  onOpenSettings: () => void;
};

export function AppShell(props: AppShellProps) {
  return (
    <main className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/icon.png"
              alt="GitHub-Stars-AI-Tools"
              className="size-8 rounded-[10px] border bg-surface-container-lowest object-contain shadow-sm"
            />
            <div className="min-w-0 leading-tight">
              <strong className="block truncate text-sm font-semibold tracking-tight" title="GitHub-Stars-AI-Tools">GitHub Stars AI</strong>
              <span className="text-xs text-muted-foreground">GSAT 本地知识库</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <HeaderBadge icon={<Database className="size-3.5" />} label={props.status?.storage ?? '本地数据库'} />
            <HeaderBadge icon={<HardDrive className="size-3.5" />} label={`${props.repositoryStats.total} 个仓库`} />
            <HeaderBadge
              icon={<UserRound className="size-3.5" />}
              label={props.authState.user ? `@${props.authState.user.login}` : '未连接'}
              variant={props.authState.user ? 'default' : 'outline'}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              onClick={props.onOpenSettings}
              title="设置"
            >
              <Settings className="size-4" />
            </Button>
          </div>
        </div>
        <div className="border-t bg-muted/30 px-4 py-3 sm:px-6">{props.toolbar}</div>
      </header>

      {(props.error || props.message) ? (
        <div className="shrink-0 border-b bg-muted/20 px-4 py-2.5 sm:px-6">
          {props.error ? <p className="text-sm font-medium text-destructive">{props.error}</p> : null}
          {props.message ? <p className="text-sm text-foreground">{props.message}</p> : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(320px,400px)]">
        <aside className="min-h-0 min-w-0 border-r bg-card p-4">{props.sidebar}</aside>
        <section className="min-h-0 min-w-0 border-r bg-background">{props.content}</section>
        <section className="min-h-0 min-w-0 bg-muted/20 p-4 lg:col-span-2 2xl:col-span-1">{props.detail}</section>
      </div>
    </main>
  );
}

function HeaderBadge(props: PropsWithChildren<{ icon?: ReactNode; label: string; variant?: 'default' | 'outline' }>) {
  return (
    <Badge
      variant={props.variant ?? 'outline'}
      className="gap-1.5 rounded-lg px-2.5 py-1 font-medium shadow-sm transition-colors"
    >
      {props.icon}
      {props.label}
    </Badge>
  );
}
