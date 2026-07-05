import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '@/types-settings';
import { DEFAULT_SETTINGS } from '@/types-settings';

const SETTINGS_KEY = 'stars-knowledge-settings';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      let nextSettings = DEFAULT_SETTINGS;
      let legacyApiKey = '';
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        legacyApiKey = parsed.ai?.apiKey?.trim() ?? '';
        nextSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          theme: normalizeThemeSettings({ ...DEFAULT_SETTINGS.theme, ...parsed.theme }),
          sync: normalizeSyncSettings({ ...DEFAULT_SETTINGS.sync, ...parsed.sync }),
          ai: normalizeAiSettings({ ...DEFAULT_SETTINGS.ai, ...parsed.ai, apiKey: '' }),
          general: {
            showWelcomeOnStartup:
              parsed.general?.showWelcomeOnStartup ?? DEFAULT_SETTINGS.general.showWelcomeOnStartup,
          },
        };
      }
      const shouldLoadAiKey = nextSettings.ai.provider !== 'none' || Boolean(legacyApiKey);
      const savedApiKey = shouldLoadAiKey ? await invoke<string | null>('get_ai_api_key') : null;
      const apiKey = savedApiKey?.trim() || legacyApiKey;

      if (!savedApiKey && legacyApiKey) {
        await invoke('save_ai_api_key', { apiKey: legacyApiKey });
      }

      const hydratedSettings = {
        ...nextSettings,
        ai: { ...nextSettings.ai, apiKey },
      };
      setSettings(hydratedSettings);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettingsForStorage(hydratedSettings)));
      setSettingsError(null);
    } catch (error) {
      setSettingsError(`设置读取失败，已使用默认配置：${toErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateSettings(partial: Partial<AppSettings>) {
    const updated = {
      ...settings,
      ...partial,
      theme: normalizeThemeSettings(partial.theme ? { ...settings.theme, ...partial.theme } : settings.theme),
      sync: normalizeSyncSettings(partial.sync ? { ...settings.sync, ...partial.sync } : settings.sync),
      ai: normalizeAiSettings(partial.ai ? { ...settings.ai, ...partial.ai } : settings.ai),
      general: normalizeGeneralSettings(partial.general ? { ...settings.general, ...partial.general } : settings.general),
    };
    setSettings(updated);
    try {
      if (partial.ai && Object.prototype.hasOwnProperty.call(partial.ai, 'apiKey')) {
        const apiKey = partial.ai.apiKey?.trim() ?? '';
        if (apiKey) {
          await invoke('save_ai_api_key', { apiKey });
        } else {
          await invoke('clear_ai_api_key');
        }
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettingsForStorage(updated)));
      setSettingsError(null);
    } catch (error) {
      setSettingsError(`设置保存失败，请检查本机存储权限：${toErrorMessage(error)}`);
    }
  }

  async function updateTheme(theme: Partial<AppSettings['theme']>) {
    await updateSettings({ theme: { ...settings.theme, ...theme } });
  }

  async function updateSync(sync: Partial<AppSettings['sync']>) {
    await updateSettings({ sync: { ...settings.sync, ...sync } });
  }

  async function updateAI(ai: Partial<AppSettings['ai']>) {
    await updateSettings({ ai: { ...settings.ai, ...ai } });
  }

  async function updateGeneral(general: Partial<AppSettings['general']>) {
    await updateSettings({ general: { ...settings.general, ...general } });
  }

  async function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    try {
      await invoke('clear_ai_api_key');
      localStorage.removeItem(SETTINGS_KEY);
      setSettingsError(null);
    } catch (error) {
      setSettingsError(`设置重置失败，请检查本机存储权限：${toErrorMessage(error)}`);
    }
  }

  return {
    settings,
    isLoading,
    settingsError,
    updateSettings,
    updateTheme,
    updateSync,
    updateAI,
    updateGeneral,
    resetSettings,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeSettingsForStorage(settings: AppSettings): AppSettings {
  return {
    ...settings,
    theme: normalizeThemeSettings(settings.theme),
    sync: normalizeSyncSettings(settings.sync),
    general: normalizeGeneralSettings(settings.general),
    ai: {
      ...settings.ai,
      apiKey: '',
    },
  };
}

function normalizeGeneralSettings(general: AppSettings['general']): AppSettings['general'] {
  return {
    showWelcomeOnStartup: Boolean(general.showWelcomeOnStartup),
  };
}

function normalizeSyncSettings(sync: AppSettings['sync']): AppSettings['sync'] {
  return {
    enableAutoSync: Boolean(sync.enableAutoSync),
    autoSyncInterval: normalizeSyncInterval(sync.autoSyncInterval),
  };
}

function normalizeSyncInterval(value: number): number {
  const normalizedValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalizedValue)) {
    return DEFAULT_SETTINGS.sync.autoSyncInterval;
  }

  return Math.min(Math.max(Math.round(normalizedValue), 5), 1440);
}

function normalizeAiSettings(ai: AppSettings['ai']): AppSettings['ai'] {
  const provider = ai.provider === 'openai'
    || ai.provider === 'openai-compatible'
    || ai.provider === 'anthropic'
    || ai.provider === 'none'
    ? ai.provider
    : DEFAULT_SETTINGS.ai.provider;
  const isRemoteProvider = provider !== 'none';
  const baseUrl = typeof ai.baseUrl === 'string' ? ai.baseUrl.trim() : '';
  const model = typeof ai.model === 'string' && ai.model.trim() ? ai.model.trim() : DEFAULT_SETTINGS.ai.model;

  return {
    provider,
    baseUrl: isRemoteProvider ? baseUrl : DEFAULT_SETTINGS.ai.baseUrl,
    apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
    model: isRemoteProvider ? model : DEFAULT_SETTINGS.ai.model,
    enableAutoSummary: isRemoteProvider ? Boolean(ai.enableAutoSummary) : false,
  };
}

function normalizeThemeSettings(theme: AppSettings['theme']): AppSettings['theme'] {
  const mode = theme.mode === 'system' || theme.mode === 'light' || theme.mode === 'dark'
    ? theme.mode
    : DEFAULT_SETTINGS.theme.mode;
  const fontSize = theme.fontSize === 'small' || theme.fontSize === 'medium' || theme.fontSize === 'large'
    ? theme.fontSize
    : DEFAULT_SETTINGS.theme.fontSize;
  const brandColor = typeof theme.brandColor === 'string' && /^#[0-9a-f]{6}$/i.test(theme.brandColor)
    ? theme.brandColor
    : DEFAULT_SETTINGS.theme.brandColor;
  const colorPreset = typeof theme.colorPreset === 'string' && theme.colorPreset.trim()
    ? theme.colorPreset
    : DEFAULT_SETTINGS.theme.colorPreset;

  return {
    mode,
    brandColor,
    fontSize,
    colorPreset,
  };
}
