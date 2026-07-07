import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Icon } from '@/components/ui/icon';

type WindowPlatform = 'macos' | 'windows' | 'linux';

const appWindow = getCurrentWindow();

export function AppTitleBar() {
  const platform = useMemo(detectWindowPlatform, []);
  const isMacOS = platform === 'macos';
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function syncMaximizedState() {
      try {
        const maximized = await appWindow.isMaximized();
        if (!cancelled) {
          setIsMaximized(maximized);
        }
      } catch {
        if (!cancelled) {
          setIsMaximized(false);
        }
      }
    }

    void syncMaximizedState();
    const unlistenResize = appWindow.onResized(syncMaximizedState);

    return () => {
      cancelled = true;
      void unlistenResize.then((unlisten) => unlisten());
    };
  }, []);

  function handleTitleBarMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }

    void appWindow.startDragging();
  }

  async function handleToggleMaximize() {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  }

  return (
    <header
      className="app-title-bar fixed inset-x-0 top-0 z-50 flex h-titlebar select-none items-center border-b border-card-border bg-surface/92 px-4 text-on-surface backdrop-blur-2xl"
      data-tauri-drag-region
      onMouseDown={handleTitleBarMouseDown}
    >
      {isMacOS ? (
        <div className="flex h-full w-28 items-center gap-2.5" aria-label="窗口控制">
          <TitleBarDotButton
            className="bg-[#ff5f57] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
            label="关闭窗口"
            onClick={() => appWindow.close()}
          />
          <TitleBarDotButton
            className="bg-[#ffbd2e] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
            label="最小化窗口"
            onClick={() => appWindow.minimize()}
          />
          <TitleBarDotButton
            className="bg-[#28c840] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
            label={isMaximized ? '还原窗口' : '最大化窗口'}
            onClick={handleToggleMaximize}
          />
        </div>
      ) : (
        <div className="w-28" />
      )}

      <div className="pointer-events-none flex min-w-0 flex-1 items-center justify-center px-4">
        <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-card-border bg-surface-container-lowest/70 px-3 py-1.5 shadow-[0_10px_28px_-24px_rgba(31,41,55,0.55)]">
        <img
          src="/icon.png"
          alt=""
          className="h-6 w-6 shrink-0 rounded-lg border border-card-border bg-white object-contain shadow-sm"
          aria-hidden="true"
        />
        <strong className="truncate text-[14px] font-semibold leading-none text-on-surface">
          GitHub Stars AI
        </strong>
        </div>
      </div>

      {isMacOS ? (
        <div className="w-28" />
      ) : (
        <div className="flex h-full w-28 items-center justify-end gap-1" aria-label="窗口控制">
          <TitleBarIconButton label="最小化窗口" icon="remove" onClick={() => appWindow.minimize()} />
          <TitleBarIconButton label={isMaximized ? '还原窗口' : '最大化窗口'} icon={isMaximized ? 'filter_none' : 'crop_square'} onClick={handleToggleMaximize} />
          <TitleBarIconButton label="关闭窗口" icon="close" danger onClick={() => appWindow.close()} />
        </div>
      )}
    </header>
  );
}

function TitleBarDotButton(props: {
  className: string;
  label: string;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className={`h-3.5 w-3.5 rounded-full transition-transform hover:scale-110 active:scale-95 ${props.className}`}
      onClick={(event) => {
        event.stopPropagation();
        void props.onClick();
      }}
    />
  );
}

function TitleBarIconButton(props: {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors ${
        props.danger
          ? 'hover:bg-error hover:text-on-error'
          : 'hover:bg-surface-container-high hover:text-on-surface'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        void props.onClick();
      }}
    >
      <Icon name={props.icon} size={18} />
    </button>
  );
}

function detectWindowPlatform(): WindowPlatform {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes('mac') || userAgent.includes('mac os')) {
    return 'macos';
  }

  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }

  return 'linux';
}
