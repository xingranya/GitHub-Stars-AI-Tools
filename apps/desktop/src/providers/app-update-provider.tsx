/**
 * 应用更新上下文 Provider
 * 统一管理 Tauri updater 检查、下载、安装和重启状态。
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'installed'
  | 'relaunching'
  | 'error';

export type AppUpdateDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number;
};

export type AppUpdateState = {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseDate: string | null;
  releaseBody: string | null;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  downloadProgress: AppUpdateDownloadProgress | null;
};

type CheckForUpdateOptions = {
  silent?: boolean;
};

export type AppUpdateContextValue = AppUpdateState & {
  checkForUpdate: (options?: CheckForUpdateOptions) => Promise<void>;
  installUpdate: () => Promise<void>;
  relaunchApp: () => Promise<void>;
};

const DEFAULT_UPDATE_STATE: AppUpdateState = {
  status: 'idle',
  currentVersion: '',
  availableVersion: null,
  releaseDate: null,
  releaseBody: null,
  lastCheckedAt: null,
  errorMessage: null,
  downloadProgress: null,
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState>(DEFAULT_UPDATE_STATE);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);
  const checkInFlightRef = useRef<Promise<void> | null>(null);
  const installInFlightRef = useRef(false);
  const relaunchInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((currentVersion) => {
        if (!cancelled) {
          setState((current) => ({ ...current, currentVersion }));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  async function checkForUpdate({ silent = false }: CheckForUpdateOptions = {}) {
    if (installInFlightRef.current || relaunchInFlightRef.current) {
      return;
    }

    if (checkInFlightRef.current) {
      if (!silent) {
        setState((current) => ({ ...current, status: 'checking', errorMessage: null }));
      }
      await checkInFlightRef.current;
      return;
    }

    const checkTask = runUpdateCheck(silent);
    checkInFlightRef.current = checkTask;
    try {
      await checkTask;
    } finally {
      checkInFlightRef.current = null;
    }
  }

  useEffect(() => {
    void checkForUpdate({ silent: true });
  }, []);

  async function installUpdate() {
    if (installInFlightRef.current || relaunchInFlightRef.current) {
      return;
    }

    const updateToInstall = pendingUpdateRef.current ?? pendingUpdate;
    if (!updateToInstall) {
      setState((current) => ({
        ...current,
        status: 'error',
        errorMessage: '当前没有可安装的更新，请先检查新版本。',
      }));
      return;
    }

    installInFlightRef.current = true;
    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    setState((current) => ({
      ...current,
      status: 'downloading',
      errorMessage: null,
      downloadProgress: { downloadedBytes: 0, totalBytes: null, percent: 0 },
    }));

    try {
      await updateToInstall.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloadedBytes = 0;
          totalBytes = typeof event.data.contentLength === 'number' ? event.data.contentLength : null;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
        } else if (event.event === 'Finished') {
          downloadedBytes = totalBytes ?? downloadedBytes;
        }

        setState((current) => ({
          ...current,
          downloadProgress: buildDownloadProgress(downloadedBytes, totalBytes),
        }));
      });

      setPendingUpdateValue(null);
      setState((current) => ({
        ...current,
        status: 'installed',
        errorMessage: null,
        downloadProgress: buildDownloadProgress(downloadedBytes, totalBytes),
      }));
      await requestRelaunch('automatic');
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        errorMessage: toUpdaterErrorMessage(error),
      }));
    } finally {
      installInFlightRef.current = false;
    }
  }

  async function relaunchApp() {
    await requestRelaunch('manual');
  }

  const contextValue = useMemo<AppUpdateContextValue>(() => ({
    ...state,
    checkForUpdate,
    installUpdate,
    relaunchApp,
  }), [state, checkForUpdate, installUpdate, relaunchApp]);

  async function runUpdateCheck(silent: boolean) {
    setState((current) => ({
      ...current,
      status: silent ? current.status : 'checking',
      errorMessage: null,
    }));

    try {
      const update = await check();
      const checkedAt = new Date().toISOString();
      if (!update) {
        setPendingUpdateValue(null);
        setState((current) => ({
          ...current,
          status: 'not-available',
          availableVersion: null,
          releaseDate: null,
          releaseBody: null,
          lastCheckedAt: checkedAt,
          errorMessage: null,
          downloadProgress: null,
        }));
        return;
      }

      setPendingUpdateValue(update);
      setState((current) => ({
        ...current,
        status: 'available',
        currentVersion: update.currentVersion || current.currentVersion,
        availableVersion: update.version,
        releaseDate: update.date ?? null,
        releaseBody: update.body ?? null,
        lastCheckedAt: checkedAt,
        errorMessage: null,
        downloadProgress: null,
      }));
    } catch (error) {
      const checkedAt = new Date().toISOString();
      if (silent) {
        setState((current) => ({ ...current, status: current.status === 'checking' ? 'idle' : current.status }));
        return;
      }

      setPendingUpdateValue(null);
      setState((current) => ({
        ...current,
        status: 'error',
        lastCheckedAt: checkedAt,
        errorMessage: toUpdaterErrorMessage(error),
      }));
    }
  }

  function setPendingUpdateValue(update: Update | null) {
    pendingUpdateRef.current = update;
    setPendingUpdate(update);
  }

  async function requestRelaunch(mode: 'automatic' | 'manual') {
    if (relaunchInFlightRef.current) {
      return;
    }

    relaunchInFlightRef.current = true;
    setState((current) => ({
      ...current,
      status: 'relaunching',
      errorMessage: null,
    }));

    try {
      await delay(mode === 'automatic' ? 800 : 150);
      await relaunch();
      await delay(1600);
      setState((current) => ({
        ...current,
        status: 'installed',
        errorMessage: '更新已安装，但当前窗口仍未关闭。请再次点击重启应用，或手动退出后重新打开。',
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'installed',
        errorMessage: `更新已安装，但${mode === 'automatic' ? '自动' : '手动'}重启失败：${toUpdaterErrorMessage(error)}。请再次点击重启应用，或手动退出后重新打开。`,
      }));
    } finally {
      relaunchInFlightRef.current = false;
    }
  }

  return <AppUpdateContext.Provider value={contextValue}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate(): AppUpdateContextValue {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error('useAppUpdate 必须在 <AppUpdateProvider> 内部使用');
  }
  return context;
}

function buildDownloadProgress(downloadedBytes: number, totalBytes: number | null): AppUpdateDownloadProgress {
  const normalizedDownloadedBytes = Math.max(0, downloadedBytes);
  const percent = totalBytes && totalBytes > 0
    ? Math.min(100, Math.round((normalizedDownloadedBytes / totalBytes) * 100))
    : 0;

  return {
    downloadedBytes: normalizedDownloadedBytes,
    totalBytes,
    percent,
  };
}

function toUpdaterErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const normalizedMessage = rawMessage.toLowerCase();

  if (normalizedMessage.includes('valid release json') || normalizedMessage.includes('latest.json')) {
    return '没有找到可用于应用内更新的发布文件。请确认 GitHub Release 已上传 latest.json 后再试。';
  }

  if (normalizedMessage.includes('signature') || normalizedMessage.includes('pubkey')) {
    return '更新包签名校验失败，请确认发布时使用的签名私钥和应用内公钥一致。';
  }

  if (
    normalizedMessage.includes('network') ||
    normalizedMessage.includes('dns') ||
    normalizedMessage.includes('timed out') ||
    normalizedMessage.includes('timeout') ||
    normalizedMessage.includes('failed to fetch')
  ) {
    return '连接更新服务器失败，请检查网络后重试。';
  }

  if (
    normalizedMessage.includes('permission') ||
    normalizedMessage.includes('operation not permitted') ||
    normalizedMessage.includes('access denied')
  ) {
    return '更新包写入失败，请确认应用目录权限正常后重试。';
  }

  return rawMessage || '检查更新失败，请稍后重试。';
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
