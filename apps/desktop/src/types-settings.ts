export type AppSettings = {
  theme: ThemeSettings;
  sync: SyncSettings;
  ai: AISettings;
  general: GeneralSettings;
};

export type ThemeSettings = {
  brandColor: string;
  fontSize: 'small' | 'medium' | 'large';
  colorPreset: string;
};

export type SyncSettings = {
  autoSyncInterval: number; // 分钟
  enableAutoSync: boolean;
  defaultGistId: string;
};

export type AISettings = {
  provider: 'openai' | 'anthropic' | 'local' | 'none';
  apiKey: string;
  model: string;
  enableAutoSummary: boolean;
};

export type GeneralSettings = {
  language: 'zh-CN' | 'en-US';
  dataDirectory: string;
  showWelcomeOnStartup: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: {
    brandColor: '#3b82f6',
    fontSize: 'medium',
    colorPreset: 'blue',
  },
  sync: {
    autoSyncInterval: 30,
    enableAutoSync: false,
    defaultGistId: '',
  },
  ai: {
    provider: 'none',
    apiKey: '',
    model: '',
    enableAutoSummary: false,
  },
  general: {
    language: 'zh-CN',
    dataDirectory: '',
    showWelcomeOnStartup: true,
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
