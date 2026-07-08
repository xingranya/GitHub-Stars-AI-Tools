/**
 * 应用更新上下文 Provider
 * 统一管理 Tauri updater 检查、下载、安装和重启状态。
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';

export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'installed' | 'error';

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
    setState((current) => ({
      ...current,
      status: silent ? current.status : 'checking',
      errorMessage: null,
    }));

    try {
      const update = await check();
      const checkedAt = new Date().toISOString();
      if (!update) {
        setPendingUpdate(null);
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

      setPendingUpdate(update);
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
      if (silent) {
        setState((current) => ({ ...current, status: current.status === 'checking' ? 'idle' : current.status }));
        return;
      }

      setPendingUpdate(null);
      setState((current) => ({
        ...current,
        status: 'error',
        errorMessage: toErrorMessage(error),
      }));
    }
  }

  useEffect(() => {
    void checkForUpdate({ silent: true });
  }, []);

  async function installUpdate() {
    if (!pendingUpdate) {
      setState((current) => ({
        ...current,
        status: 'error',
        errorMessage: '当前没有可安装的更新，请先检查新版本。',
      }));
      return;
    }

    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    setState((current) => ({
      ...current,
      status: 'downloading',
      errorMessage: null,
      downloadProgress: { downloadedBytes: 0, totalBytes: null, percent: 0 },
    }));

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
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

      setState((current) => ({
        ...current,
        status: 'installed',
        errorMessage: null,
        downloadProgress: buildDownloadProgress(downloadedBytes, totalBytes),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        errorMessage: toErrorMessage(error),
      }));
    }
  }

  async function relaunchApp() {
    await relaunch();
  }

  const contextValue = useMemo<AppUpdateContextValue>(() => ({
    ...state,
    checkForUpdate,
    installUpdate,
    relaunchApp,
  }), [state, checkForUpdate, installUpdate, relaunchApp]);

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

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
