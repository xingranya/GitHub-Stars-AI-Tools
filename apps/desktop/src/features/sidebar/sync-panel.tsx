import { FormEvent } from 'react';
import { BookOpen, Download, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GitHubAuthState, ReadmeFetchSummary, StarSyncSummary } from '@/types';

type SyncPanelProps = {
  authState: GitHubAuthState;
  gistIdDraft: string;
  isExportingAnnotations: boolean;
  isFetchingReadmes: boolean;
  isImportingAnnotations: boolean;
  isSyncingStars: boolean;
  readmeSummary: ReadmeFetchSummary | null;
  syncSummary: StarSyncSummary | null;
  onExportAnnotations: () => void;
  onFetchReadmes: () => void;
  onImportAnnotations: (event: FormEvent<HTMLFormElement>) => void;
  onSetGistIdDraft: (value: string) => void;
  onSyncStars: () => void;
};

export function SyncPanel(props: SyncPanelProps) {
  const disabled = !props.authState.user;

  return (
    <section className="rail-section">
      <div className="rail-title">
        <RefreshCw className="size-4" />
        <strong>同步</strong>
      </div>
      <div className="grid gap-2.5">
        <Button className="h-10 justify-start rounded-lg shadow-sm" disabled={disabled || props.isSyncingStars} onClick={props.onSyncStars}>
          <RefreshCw className={props.isSyncingStars ? 'size-4 animate-spin' : 'size-4'} />
          {props.isSyncingStars ? '同步中…' : '同步 Stars'}
        </Button>
        <Button className="h-10 justify-start rounded-lg shadow-sm" disabled={disabled || props.isFetchingReadmes} variant="outline" onClick={props.onFetchReadmes}>
          <BookOpen className="size-4" />
          {props.isFetchingReadmes ? '抓取中…' : '抓取 README'}
        </Button>
        <Button className="h-10 justify-start rounded-lg shadow-sm" disabled={disabled || props.isExportingAnnotations} variant="outline" onClick={props.onExportAnnotations}>
          <Upload className="size-4" />
          {props.isExportingAnnotations ? '导出中…' : '导出注解'}
        </Button>
      </div>
      <form className="grid grid-cols-[1fr_auto] gap-2.5" onSubmit={props.onImportAnnotations}>
        <Input
          value={props.gistIdDraft}
          placeholder="Gist ID"
          className="rounded-lg shadow-sm"
          onChange={(event) => props.onSetGistIdDraft(event.target.value)}
        />
        <Button size="icon" variant="outline" className="size-10 rounded-lg shadow-sm" disabled={disabled || props.isImportingAnnotations || props.gistIdDraft.trim().length === 0} title="导入注解" type="submit">
          <Download className="size-4" />
        </Button>
      </form>
      {props.syncSummary ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Stars 同步：</strong>当前 {props.syncSummary.activeCount}，新增 {props.syncSummary.createdCount}，更新 {props.syncSummary.updatedCount}，移除 {props.syncSummary.removedCount}，扫描 {props.syncSummary.scannedCount}
        </p>
      ) : null}
      {props.readmeSummary ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">README 抓取：</strong>更新 {props.readmeSummary.fetchedCount}，跳过 {props.readmeSummary.skippedCount}，缺失 {props.readmeSummary.missingCount}，失败{' '}
          {props.readmeSummary.failedCount}
        </p>
      ) : null}
    </section>
  );
}
