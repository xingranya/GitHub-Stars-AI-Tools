import { Brain, Database, HardDrive, UserRound, Settings } from 'lucide-react';
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
    <main className="min-h-screen min-w-[1180px] bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Brain className="size-4" />
            </span>
            <div className="leading-tight">
              <strong className="block text-sm font-semibold tracking-tight">Stars Knowledge</strong>
              <span className="text-xs text-muted-foreground">GitHub Stars 语义知识库</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HeaderBadge icon={<Database className="size-3.5" />} label={props.status?.storage ?? 'SQLite'} />
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
        <div className="border-t bg-muted/30 px-6 py-3">{props.toolbar}</div>
      </header>

      {(props.error || props.message) ? (
        <div className="border-b bg-muted/20 px-6 py-2.5">
          {props.error ? <p className="text-sm font-medium text-destructive">{props.error}</p> : null}
          {props.message ? <p className="text-sm text-foreground">{props.message}</p> : null}
        </div>
      ) : null}

      <div className="grid min-h-[calc(100vh-113px)] grid-cols-[280px_minmax(620px,1fr)_400px]">
        <aside className="min-w-0 border-r bg-card p-4">{props.sidebar}</aside>
        <section className="min-w-0 border-r bg-background">{props.content}</section>
        <section className="min-w-0 bg-muted/20 p-4">{props.detail}</section>
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
