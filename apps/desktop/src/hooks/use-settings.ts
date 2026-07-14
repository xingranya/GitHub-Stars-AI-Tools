import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  isSavedAiApiKeyPlaceholder,
  normalizeEmbeddingSettings,
  SAVED_AI_API_KEY_PLACEHOLDER,
  shouldFlushAiApiKey,
  shouldFlushEmbeddingApiKey,
} from '@/lib/ai-config';
import type { AppSettings } from '@/types-settings';
import { DEFAULT_SETTINGS } from '@/types-settings';

const STALE_SETTINGS_CACHE_KEY = 'gsat-settings';
type AiKeySaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type AppSettingsPatch = {
  theme?: Partial<AppSettings['theme']>;
  sync?: Partial<AppSettings['sync']>;
  ai?: Partial<AppSettings['ai']>;
  embedding?: Partial<AppSettings['embedding']>;
  general?: Partial<AppSettings['general']>;
  runtime?: Partial<AppSettings['runtime']>;
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [aiKeySaveStatus, setAiKeySaveStatus] = useState<AiKeySaveStatus>('idle');
  const [embeddingKeySaveStatus, setEmbeddingKeySaveStatus] = useState<AiKeySaveStatus>('idle');
  const aiKeySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAiKeyRef = useRef<string | null>(null);
  const pendingAiKeyProviderRef = useRef<AppSettings['ai']['provider']>(DEFAULT_SETTINGS.ai.provider);

  useEffect(() => {
    loadSettings();
    return () => {
      clearAiKeySaveTimer();
      const pendingAiKey = pendingAiKeyRef.current;
      if (pendingAiKey !== null) {
        pendingAiKeyRef.current = null;
        void persistAiApiKey(pendingAiKey, pendingAiKeyProviderRef.current).catch(() => undefined);
      }
    };
  }, []);

  async function loadSettings() {
    let nextSettings = DEFAULT_SETTINGS;
    let nextError: string | null = null;

    try {
      const stored = await loadPersistedSettingsSnapshot();
      if (stored) {
        const parsed = stored;
        nextSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          theme: normalizeThemeSettings({ ...DEFAULT_SETTINGS.theme, ...parsed.theme }),
          sync: normalizeSyncSettings({ ...DEFAULT_SETTINGS.sync, ...parsed.sync }),
          ai: normalizeAiSettings({ ...DEFAULT_SETTINGS.ai, ...parsed.ai, apiKey: '' }),
          embedding: normalizeEmbeddingSettings({ ...DEFAULT_SETTINGS.embedding, ...parsed.embedding, apiKey: '' }),
          general: {
            showWelcomeOnStartup:
              parsed.general?.showWelcomeOnStartup ?? DEFAULT_SETTINGS.general.showWelcomeOnStartup,
          },
          runtime: normalizeRuntimeSettings({ ...DEFAULT_SETTINGS.runtime, ...parsed.runtime }),
        };
      }
    } catch (error) {
      nextError = `设置读取失败，已使用默认配置：${toErrorMessage(error)}`;
      nextSettings = DEFAULT_SETTINGS;
    }

    let apiKey = '';
    if (shouldReadSavedAiApiKey(nextSettings.ai)) {
      try {
        apiKey = await readSavedAiApiKeyPlaceholder(nextSettings.ai);
      } catch (error) {
        apiKey = '';
        nextError = `AI Key 状态读取失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`;
      }
    }

    let embeddingApiKey = '';
    if (shouldReadSavedEmbeddingApiKey(nextSettings.embedding)) {
      try {
        embeddingApiKey = await readSavedEmbeddingApiKeyPlaceholder();
      } catch (error) {
        embeddingApiKey = '';
        nextError = mergeSettingsError(
          nextError,
          `Embedding Key 状态读取失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`,
        );
      }
    }

    const hydratedSettings = {
      ...nextSettings,
      ai: { ...nextSettings.ai, apiKey },
      embedding: { ...nextSettings.embedding, apiKey: embeddingApiKey },
    };
    setSettings(hydratedSettings);
    try {
      await persistSettingsSnapshot(hydratedSettings);
    } catch (error) {
      nextError = mergeSettingsError(nextError, `设置写入失败，请检查本机存储权限：${toErrorMessage(error)}`);
    }
    setSettingsError(nextError);
    setIsLoading(false);
  }

  async function updateSettings(partial: AppSettingsPatch) {
    const partialAiIncludesApiKey = Boolean(
      partial.ai && Object.prototype.hasOwnProperty.call(partial.ai, 'apiKey'),
    );
    const partialEmbeddingIncludesApiKey = Boolean(
      partial.embedding && Object.prototype.hasOwnProperty.call(partial.embedding, 'apiKey'),
    );
    const partialAiChangesProvider = Boolean(
      partial.ai?.provider && partial.ai.provider !== settings.ai.provider,
    );
    const partialEmbeddingChangesProvider = Boolean(
      partial.embedding?.provider && partial.embedding.provider !== settings.embedding.provider,
    );
    let nextAi = normalizeAiSettings(partial.ai ? { ...settings.ai, ...partial.ai } : settings.ai);
    let nextEmbedding = normalizeEmbeddingSettings(
      partial.embedding ? { ...settings.embedding, ...partial.embedding } : settings.embedding,
    );
    let nextError: string | null = null;

    if (partial.ai && partialAiChangesProvider && !partialAiIncludesApiKey) {
      try {
        const nextAiForKeyLookup = { ...nextAi, apiKey: '' };
        nextAi = {
          ...nextAi,
          apiKey: await readSavedAiApiKeyPlaceholder(nextAiForKeyLookup),
        };
      } catch (error) {
        nextAi = { ...nextAi, apiKey: '' };
        nextError = `AI Key 状态读取失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`;
      }
    }

    if (partial.embedding && partialEmbeddingChangesProvider && !partialEmbeddingIncludesApiKey) {
      try {
        nextEmbedding = {
          ...nextEmbedding,
          apiKey: nextEmbedding.provider === 'none'
            ? nextEmbedding.apiKey
            : shouldReadSavedEmbeddingApiKey(nextEmbedding)
              ? await readSavedEmbeddingApiKeyPlaceholder()
              : '',
        };
      } catch (error) {
        nextEmbedding = { ...nextEmbedding, apiKey: '' };
        nextError = mergeSettingsError(
          nextError,
          `Embedding Key 状态读取失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`,
        );
      }
    }

    const updated = {
      ...settings,
      ...partial,
      theme: normalizeThemeSettings(partial.theme ? { ...settings.theme, ...partial.theme } : settings.theme),
      sync: normalizeSyncSettings(partial.sync ? { ...settings.sync, ...partial.sync } : settings.sync),
      ai: nextAi,
      embedding: nextEmbedding,
      general: normalizeGeneralSettings(partial.general ? { ...settings.general, ...partial.general } : settings.general),
      runtime: normalizeRuntimeSettings(partial.runtime ? { ...settings.runtime, ...partial.runtime } : settings.runtime),
    };
    setSettings(updated);
    try {
      if (partialAiIncludesApiKey) {
        clearAiKeySaveTimer();
        try {
          setAiKeySaveStatus('saving');
          await persistAiApiKey(partial.ai?.apiKey ?? '', updated.ai.provider);
          pendingAiKeyRef.current = null;
          setAiKeySaveStatus((partial.ai?.apiKey ?? '').trim() ? 'saved' : 'idle');
        } catch (error) {
          setAiKeySaveStatus('error');
          nextError = `AI Key 保存失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`;
        }
      }
      if (partialEmbeddingIncludesApiKey) {
        try {
          setEmbeddingKeySaveStatus('saving');
          await persistEmbeddingApiKey(partial.embedding?.apiKey ?? '');
          setEmbeddingKeySaveStatus((partial.embedding?.apiKey ?? '').trim() ? 'saved' : 'idle');
        } catch (error) {
          setEmbeddingKeySaveStatus('error');
          nextError = mergeSettingsError(
            nextError,
            `Embedding Key 保存失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`,
          );
        }
      }
      await persistSettingsSnapshot(updated);
    } catch (error) {
      nextError = mergeSettingsError(nextError, `设置保存失败，请检查本机存储权限：${toErrorMessage(error)}`);
    }
    setSettingsError(nextError);
  }

  async function updateTheme(theme: Partial<AppSettings['theme']>) {
    await updateSettings({ theme: { ...settings.theme, ...theme } });
  }

  async function updateSync(sync: Partial<AppSettings['sync']>) {
    await updateSettings({ sync: { ...settings.sync, ...sync } });
  }

  async function updateAI(ai: Partial<AppSettings['ai']>) {
    await updateSettings({ ai });
  }

  async function updateEmbedding(embedding: Partial<AppSettings['embedding']>) {
    await updateSettings({ embedding });
  }

  async function flushEmbeddingKey(apiKey = settings.embedding.apiKey) {
    try {
      setEmbeddingKeySaveStatus('saving');
      await persistEmbeddingApiKey(apiKey);
      const normalizedApiKey = apiKey.trim();
      const updated = {
        ...settings,
        embedding: {
          ...settings.embedding,
          apiKey: normalizedApiKey ? SAVED_AI_API_KEY_PLACEHOLDER : '',
        },
      };
      setSettings(updated);
      await persistSettingsSnapshot(updated);
      setEmbeddingKeySaveStatus(normalizedApiKey ? 'saved' : 'idle');
      setSettingsError(null);
    } catch (error) {
      setEmbeddingKeySaveStatus('error');
      setSettingsError(`Embedding Key 保存失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`);
      throw error;
    }
  }

  async function updateAIKeyDraft(apiKey: string) {
    const updated = {
      ...settings,
      ai: normalizeAiSettings({ ...settings.ai, apiKey }),
    };
    setSettings(updated);
    try {
      await persistSettingsSnapshot(updated);
      setSettingsError(null);
    } catch (error) {
      setSettingsError(`设置保存失败，请检查本机存储权限：${toErrorMessage(error)}`);
    }
    scheduleAiKeySave(apiKey, updated.ai.provider);
  }

  async function flushAIKey(apiKey = settings.ai.apiKey) {
    clearAiKeySaveTimer();
    try {
      setAiKeySaveStatus('saving');
      await persistAiApiKey(apiKey, settings.ai.provider);
      pendingAiKeyRef.current = null;
      setAiKeySaveStatus(apiKey.trim() ? 'saved' : 'idle');
      setSettingsError(null);
    } catch (error) {
      setAiKeySaveStatus('error');
      setSettingsError(`AI Key 保存失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`);
      throw error;
    }
  }

  async function updateGeneral(general: Partial<AppSettings['general']>) {
    await updateSettings({ general: { ...settings.general, ...general } });
  }

  async function updateRuntime(runtime: Partial<AppSettings['runtime']>) {
    await updateSettings({ runtime: { ...settings.runtime, ...runtime } });
  }

  async function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    clearAiKeySaveTimer();
    const failures: string[] = [];

    try {
      await invoke('clear_ai_api_key', { provider: null });
    } catch (error) {
      failures.push(`AI Key 清理失败：${toErrorMessage(error)}`);
    }

    try {
      await invoke('clear_embedding_api_key');
    } catch (error) {
      failures.push(`Embedding Key 清理失败：${toErrorMessage(error)}`);
    }

    try {
      await invoke('clear_app_settings');
    } catch (error) {
      failures.push(`设置文件清理失败：${toErrorMessage(error)}`);
    }

    try {
      localStorage.removeItem(STALE_SETTINGS_CACHE_KEY);
    } catch (error) {
      failures.push(`本地设置镜像清理失败：${toErrorMessage(error)}`);
    }

    pendingAiKeyRef.current = null;
    pendingAiKeyProviderRef.current = DEFAULT_SETTINGS.ai.provider;
    setAiKeySaveStatus('idle');
    setEmbeddingKeySaveStatus('idle');

    if (failures.length > 0) {
      const message = `设置重置失败，请检查本机存储权限：${failures.join('；')}`;
      setSettingsError(message);
      throw new Error(message);
    }

    setSettingsError(null);
  }

  function clearAiKeySaveTimer() {
    if (aiKeySaveTimerRef.current) {
      clearTimeout(aiKeySaveTimerRef.current);
      aiKeySaveTimerRef.current = null;
    }
  }

  function scheduleAiKeySave(apiKey: string, provider: AppSettings['ai']['provider']) {
    clearAiKeySaveTimer();
    pendingAiKeyRef.current = apiKey;
    pendingAiKeyProviderRef.current = provider;
    setAiKeySaveStatus(apiKey.trim() ? 'saving' : 'idle');
    aiKeySaveTimerRef.current = setTimeout(() => {
      aiKeySaveTimerRef.current = null;
      void persistAiApiKey(apiKey, provider)
        .then(() => {
          if (pendingAiKeyRef.current === apiKey) {
            pendingAiKeyRef.current = null;
            setAiKeySaveStatus(apiKey.trim() ? 'saved' : 'idle');
          }
        })
        .catch((error) => {
          setAiKeySaveStatus('error');
          setSettingsError(`AI Key 保存失败，请检查系统凭据管理器权限：${toErrorMessage(error)}`);
        });
    }, 500);
  }

  async function persistAiApiKey(apiKey: string, provider: AppSettings['ai']['provider']) {
    if (provider === 'none') {
      return;
    }
    const normalizedApiKey = apiKey.trim();
    if (isSavedAiApiKeyPlaceholder(normalizedApiKey)) {
      return;
    }
    if (normalizedApiKey) {
      await invoke('save_ai_api_key', { provider, apiKey: normalizedApiKey });
    } else {
      await invoke('clear_ai_api_key', { provider });
    }
  }

  async function persistEmbeddingApiKey(apiKey: string) {
    const normalizedApiKey = apiKey.trim();
    if (isSavedAiApiKeyPlaceholder(normalizedApiKey)) {
      return;
    }
    if (normalizedApiKey) {
      await invoke('save_embedding_api_key', { apiKey: normalizedApiKey });
    } else {
      await invoke('clear_embedding_api_key');
    }
  }

  async function persistSettingsSnapshot(nextSettings: AppSettings) {
    const sanitizedSettings = sanitizeSettingsForStorage(nextSettings);
    await invoke('save_app_settings', { settings: sanitizedSettings });
  }

  return {
    settings,
    isLoading,
    settingsError,
    aiKeySaveStatus,
    embeddingKeySaveStatus,
    updateSettings,
    updateTheme,
    updateSync,
    updateAI,
    updateEmbedding,
    updateAIKeyDraft,
    flushAIKey,
    flushEmbeddingKey,
    updateGeneral,
    updateRuntime,
    resetSettings,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeSettingsError(current: string | null, next: string): string {
  return current ? `${current}；${next}` : next;
}

function shouldReadSavedAiApiKey(ai: AppSettings['ai']) {
  return ai.provider !== 'none' && shouldFlushAiApiKey(ai);
}

async function readSavedAiApiKeyPlaceholder(ai: AppSettings['ai']) {
  if (!shouldReadSavedAiApiKey(ai)) {
    return '';
  }

  const hasSavedApiKey = await invoke<boolean>('has_ai_api_key', { provider: ai.provider });
  return hasSavedApiKey ? SAVED_AI_API_KEY_PLACEHOLDER : '';
}

function shouldReadSavedEmbeddingApiKey(embedding: AppSettings['embedding']) {
  return embedding.provider !== 'none' && shouldFlushEmbeddingApiKey(embedding);
}

async function readSavedEmbeddingApiKeyPlaceholder() {
  const hasSavedApiKey = await invoke<boolean>('has_embedding_api_key');
  return hasSavedApiKey ? SAVED_AI_API_KEY_PLACEHOLDER : '';
}

async function loadPersistedSettingsSnapshot(): Promise<Partial<AppSettings> | null> {
  return invoke<Partial<AppSettings> | null>('get_app_settings');
}

function sanitizeSettingsForStorage(settings: AppSettings): AppSettings {
  return {
    ...settings,
    theme: normalizeThemeSettings(settings.theme),
    sync: normalizeSyncSettings(settings.sync),
    general: normalizeGeneralSettings(settings.general),
    runtime: normalizeRuntimeSettings(settings.runtime),
    ai: {
      ...settings.ai,
      apiKey: '',
    },
    embedding: {
      ...normalizeEmbeddingSettings(settings.embedding),
      apiKey: '',
    },
  };
}

function normalizeRuntimeSettings(runtime: AppSettings['runtime']): AppSettings['runtime'] {
  const record = runtime.lastSelfCheckRecord;
  if (!record || typeof record !== 'object') {
    return { lastSelfCheckRecord: null };
  }

  const completedAt = typeof record.completedAt === 'string' ? record.completedAt : '';
  if (!completedAt) {
    return { lastSelfCheckRecord: null };
  }

  return {
    lastSelfCheckRecord: {
      completedAt,
      passed: normalizeRuntimeCount(record.passed),
      failed: normalizeRuntimeCount(record.failed),
      skipped: normalizeRuntimeCount(record.skipped),
    },
  };
}

function normalizeRuntimeCount(value: number): number {
  const normalizedValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalizedValue) ? Math.max(0, Math.round(normalizedValue)) : 0;
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
  const model = typeof ai.model === 'string' ? ai.model.trim() : '';
  const providerPreset = normalizeAiProviderPreset(ai.providerPreset, provider);

  return {
    provider,
    providerPreset,
    baseUrl: isRemoteProvider ? baseUrl : DEFAULT_SETTINGS.ai.baseUrl,
    apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
    model: isRemoteProvider ? model : DEFAULT_SETTINGS.ai.model,
    enableAutoSummary: isRemoteProvider ? Boolean(ai.enableAutoSummary) : false,
  };
}

function normalizeAiProviderPreset(
  value: AppSettings['ai']['providerPreset'] | undefined,
  provider: AppSettings['ai']['provider'],
): AppSettings['ai']['providerPreset'] {
  const knownPresets: AppSettings['ai']['providerPreset'][] = [
    'openai',
    'anthropic',
    'openrouter',
    'deepseek',
    'moonshot',
    'qwen',
    'zhipu',
    'siliconflow',
    'ollama',
    'lmstudio',
    'custom-openai-compatible',
    'none',
  ];
  if (value && knownPresets.includes(value)) {
    return value;
  }
  if (provider === 'openai') return 'openai';
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai-compatible') return 'custom-openai-compatible';
  return 'none';
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
