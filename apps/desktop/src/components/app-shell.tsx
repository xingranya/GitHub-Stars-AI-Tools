import { Brain, Database, HardDrive } from 'lucide-react';
import { PropsWithChildren, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
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
};

export function AppShell(props: AppShellProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-foreground text-background">
              <Brain className="size-4" />
            </span>
            <div className="leading-tight">
              <strong className="block text-sm font-semibold">Stars Knowledge</strong>
              <span className="text-xs text-muted-foreground">GitHub Stars 语义知识库</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HeaderBadge icon={<Database className="size-3.5" />} label={props.status?.storage ?? 'SQLite'} />
            <HeaderBadge icon={<HardDrive className="size-3.5" />} label={`${props.repositoryStats.total} repos`} />
            <HeaderBadge label={props.authState.user ? `@${props.authState.user.login}` : '未连接'} />
          </div>
        </div>
        <div className="border-t px-5 py-3">{props.toolbar}</div>
      </header>

      {(props.error || props.message) ? (
        <div className="border-b px-5 py-2">
          {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
          {props.message ? <p className="text-sm text-foreground">{props.message}</p> : null}
        </div>
      ) : null}

      <div className="grid min-h-[calc(100vh-113px)] grid-cols-[280px_minmax(560px,1fr)_400px]">
        <aside className="border-r bg-muted/20 p-4">{props.sidebar}</aside>
        <section className="min-w-0 border-r">{props.content}</section>
        <section className="min-w-0 bg-muted/10">{props.detail}</section>
      </div>
    </main>
  );
}

function HeaderBadge(props: PropsWithChildren<{ icon?: ReactNode; label: string }>) {
  return (
    <Badge variant="outline" className="gap-1.5 rounded-md px-2 py-1 font-normal">
      {props.icon}
      {props.label}
    </Badge>
  );
}
