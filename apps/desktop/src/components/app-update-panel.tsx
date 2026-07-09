import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { AppUpdateContextValue } from '@/providers/app-update-provider';
import { Icon } from '@/components/ui/icon';

type AppUpdatePanelProps = {
  appUpdate: AppUpdateContextValue;
};

type AppUpdateDialogProps = AppUpdatePanelProps & {
  onClose: () => void;
};

export function AppUpdateDialog({ appUpdate, onClose }: AppUpdateDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/45 px-3 py-5 backdrop-blur-sm sm:px-4 sm:py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-dialog-title"
        className="w-full max-w-2xl min-w-0 rounded-xl border border-card-border bg-surface p-4 shadow-2xl shadow-black/20 sm:p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="app-update-dialog-title" className="font-headline-md text-[20px] font-semibold text-on-surface">
              应用更新
            </h3>
            <p className="mt-1 font-body-md text-sm text-on-surface-variant">
              查看新版本说明并完成安装。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-card-border bg-surface-container-high text-on-surface transition-colors hover:bg-surface-container-highest"
            title="关闭"
            aria-label="关闭应用更新"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <AppUpdatePanel appUpdate={appUpdate} />
      </div>
    </div>
  );
}

export function AppUpdatePanel({ appUpdate }: AppUpdatePanelProps) {
  const isChecking = appUpdate.status === 'checking';
  const isDownloading = appUpdate.status === 'downloading';
  const isRelaunching = appUpdate.status === 'relaunching';
  const isBusy = isChecking || isDownloading || isRelaunching;
  const canInstall = appUpdate.status === 'available' && Boolean(appUpdate.availableVersion);
  const statusMessage = getAppUpdateStatusMessage(appUpdate);
  const statusToneClass = getAppUpdateStatusToneClass(appUpdate);

  return (
    <div className="min-w-0 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="system_update_alt" size={20} className="shrink-0 text-primary" />
            <h4 className="min-w-0 font-body-lg font-semibold text-on-surface">应用更新</h4>
          </div>
          <div className="mt-3 grid min-w-0 gap-2 text-sm text-on-surface-variant sm:grid-cols-2">
            <p className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium text-on-surface">当前版本：</span>
              {appUpdate.currentVersion || '读取中'}
            </p>
            <p className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium text-on-surface">最近检查：</span>
              {formatUpdateCheckedAt(appUpdate.lastCheckedAt)}
            </p>
            {appUpdate.availableVersion && (
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-on-surface">可用版本：</span>
                {appUpdate.availableVersion}
              </p>
            )}
            {appUpdate.releaseDate && (
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-on-surface">发布时间：</span>
                {formatUpdateCheckedAt(appUpdate.releaseDate)}
              </p>
            )}
          </div>
          {statusMessage && (
            <p className={`mt-3 rounded-lg border px-3 py-2 font-body-md text-sm ${statusToneClass}`}>
              {statusMessage}
            </p>
          )}
          {appUpdate.releaseBody && (
            <div className="mt-3 min-w-0 rounded-lg border border-outline-variant/25 bg-surface p-3">
              <p className="font-body-md text-xs font-medium text-on-surface">更新说明</p>
              <div className="mt-2 max-h-[min(42vh,28rem)] min-w-0 overflow-y-auto pr-1">
                <ReleaseMarkdown markdown={appUpdate.releaseBody} />
              </div>
            </div>
          )}
          {appUpdate.status === 'downloading' && appUpdate.downloadProgress && (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
                <span className="font-medium text-on-surface">下载进度</span>
                <span>{appUpdate.downloadProgress.percent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${appUpdate.downloadProgress.percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                已下载 {formatBytes(appUpdate.downloadProgress.downloadedBytes)}
                {appUpdate.downloadProgress.totalBytes ? ` / ${formatBytes(appUpdate.downloadProgress.totalBytes)}` : ''}
              </p>
            </div>
          )}
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:min-w-36">
          <button
            type="button"
            onClick={() => void appUpdate.checkForUpdate()}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-outline-variant/35 bg-surface px-3 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="refresh" size={17} className={isChecking ? 'animate-spin' : ''} />
            {isChecking ? '检查中' : '检查更新'}
          </button>
          {canInstall && (
            <button
              type="button"
              onClick={() => void appUpdate.installUpdate()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110"
            >
              <Icon name="download" size={17} />
              立即安装
            </button>
          )}
          {(appUpdate.status === 'installed' || appUpdate.status === 'relaunching') && (
            <button
              type="button"
              onClick={() => void appUpdate.relaunchApp()}
              disabled={isRelaunching}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name={isRelaunching ? 'progress_activity' : 'restart_alt'} size={17} className={isRelaunching ? 'animate-spin' : ''} />
              {isRelaunching ? '正在重启' : '重启应用'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReleaseMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="release-markdown min-w-0 font-body-md text-sm leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={releaseMarkdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const releaseMarkdownComponents: Components = {
  h1({ children }) {
    return <h1 className="mb-2 mt-3 border-b border-outline-variant/40 pb-2 font-headline-md text-lg font-semibold leading-snug text-on-surface first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-4 border-b border-outline-variant/30 pb-1.5 font-headline-md text-base font-semibold leading-snug text-on-surface first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-1.5 mt-3 font-body-md text-sm font-semibold leading-snug text-on-surface first:mt-0">{children}</h3>;
  },
  p({ children }) {
    return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>;
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline decoration-current/35 underline-offset-2">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return <blockquote className="my-2 border-l-2 border-primary/55 pl-3 text-on-surface-variant">{children}</blockquote>;
  },
  code({ children, className }) {
    return <code className={`rounded bg-surface-container-high px-1 py-0.5 font-label-sm text-[0.92em] text-on-surface ${className ?? ''}`}>{children}</code>;
  },
  pre({ children }) {
    return <pre className="my-2 max-w-full overflow-x-auto rounded-md border border-outline-variant/30 bg-surface-container-low p-3 text-xs text-on-surface">{children}</pre>;
  },
  table({ children }) {
    return (
      <div className="my-2 max-w-full overflow-x-auto rounded-md border border-outline-variant/30">
        <table className="min-w-full border-collapse text-left text-xs">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border-b border-outline-variant/30 bg-surface-container px-2 py-1.5 font-semibold text-on-surface">{children}</th>;
  },
  td({ children }) {
    return <td className="border-t border-outline-variant/20 px-2 py-1.5 align-top">{children}</td>;
  },
};

function getAppUpdateStatusMessage(appUpdate: AppUpdateContextValue) {
  switch (appUpdate.status) {
    case 'checking':
      return '正在检查更新...';
    case 'available':
      return `发现新版本 ${appUpdate.availableVersion ?? ''}，可查看说明后立即安装。`;
    case 'not-available':
      return '已是最新版本。';
    case 'downloading':
      return '正在下载并安装更新，请保持应用打开。';
    case 'installed':
      return appUpdate.errorMessage ?? '更新已安装，正在准备重启应用。';
    case 'relaunching':
      return '更新已安装，正在重启应用。';
    case 'error':
      return appUpdate.errorMessage ? `更新失败：${appUpdate.errorMessage}` : '更新失败，请稍后重试。';
    case 'idle':
    default:
      return '应用会在启动时静默检查更新，也可以在这里手动检查。';
  }
}

function getAppUpdateStatusToneClass(appUpdate: AppUpdateContextValue) {
  if (appUpdate.status === 'error') {
    return 'border-error/20 bg-error/10 text-error';
  }
  if (appUpdate.status === 'installed' && appUpdate.errorMessage) {
    return 'border-warning/25 bg-warning/10 text-warning';
  }
  if (appUpdate.status === 'available' || appUpdate.status === 'installed') {
    return 'border-success/20 bg-success/10 text-success';
  }
  if (appUpdate.status === 'relaunching') {
    return 'border-primary/20 bg-primary/10 text-primary';
  }
  return 'border-outline-variant/30 bg-surface text-on-surface-variant';
}

function formatUpdateCheckedAt(value: string | null) {
  if (!value) {
    return '尚未检查';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
