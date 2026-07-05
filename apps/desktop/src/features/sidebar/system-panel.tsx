import { Database } from 'lucide-react';
import type { BackendStatus, RepositoryStats } from '@/types';

type SystemPanelProps = {
  status: BackendStatus | null;
  stats: RepositoryStats;
};

export function SystemPanel(props: SystemPanelProps) {
  return (
    <section className="rail-section">
      <div className="rail-title">
        <Database className="size-4" />
        <strong>索引状态</strong>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="仓库" value={props.stats.total.toLocaleString()} />
        <Metric label="README" value={props.stats.withReadme.toLocaleString()} />
        <Metric label="语言" value={props.stats.languages.toLocaleString()} />
        <Metric label="Topics" value={props.stats.topics.toLocaleString()} />
      </div>
      <div className="grid gap-2 text-xs leading-5 text-muted-foreground">
        <span>{props.status?.backend ?? 'Rust 后端等待连接'}</span>
        <span>{props.status?.worker ?? 'Worker 等待连接'}</span>
        <span>{props.status?.provider ?? 'AI Provider 待配置'}</span>
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <span className="rounded-md border bg-background p-3">
      <strong className="block text-sm">{props.value}</strong>
      <small className="text-xs text-muted-foreground">{props.label}</small>
    </span>
  );
}
