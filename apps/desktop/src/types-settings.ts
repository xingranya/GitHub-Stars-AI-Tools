export type AppSettings = {
  theme: ThemeSettings;
  sync: SyncSettings;
  ai: AISettings;
  general: GeneralSettings;
  runtime: RuntimeSettings;
};

export type ThemeSettings = {
  mode: 'system' | 'light' | 'dark';
  brandColor: string;
  fontSize: 'small' | 'medium' | 'large';
  colorPreset: string;
};

export type SyncSettings = {
  autoSyncInterval: number; // 分钟
  enableAutoSync: boolean;
};

export type AISettings = {
  provider: 'openai' | 'openai-compatible' | 'anthropic' | 'none';
  baseUrl: string;
  apiKey: string;
  model: string;
  enableAutoSummary: boolean;
};

export type GeneralSettings = {
  showWelcomeOnStartup: boolean;
};

export type RuntimeSelfCheckRecord = {
  completedAt: string;
  passed: number;
  failed: number;
  skipped: number;
};

export type RuntimeSettings = {
  lastSelfCheckRecord: RuntimeSelfCheckRecord | null;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: {
    mode: 'system',
    brandColor: '#3b82f6',
    fontSize: 'medium',
    colorPreset: 'blue',
  },
  sync: {
    autoSyncInterval: 30,
    enableAutoSync: false,
  },
  ai: {
    provider: 'none',
    baseUrl: '',
    apiKey: '',
    model: 'gpt-5.5',
    enableAutoSummary: false,
  },
  general: {
    showWelcomeOnStartup: true,
  },
  runtime: {
    lastSelfCheckRecord: null,
  },
};

export const COLOR_PRESETS = [
  { name: 'blue', label: '知识蓝', color: '#3b82f6' },
  { name: 'purple', label: '紫罗兰', color: '#8b5cf6' },
  { name: 'green', label: '自然绿', color: '#10b981' },
  { name: 'orange', label: '活力橙', color: '#f97316' },
  { name: 'pink', label: '樱花粉', color: '#ec4899' },
  { name: 'teal', label: '青碧色', color: '#14b8a6' },
] as const;
