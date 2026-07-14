export type AppSettings = {
  theme: ThemeSettings;
  sync: SyncSettings;
  ai: AISettings;
  embedding: EmbeddingSettings;
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
  providerPreset:
    | 'openai'
    | 'anthropic'
    | 'openrouter'
    | 'deepseek'
    | 'moonshot'
    | 'qwen'
    | 'zhipu'
    | 'siliconflow'
    | 'ollama'
    | 'lmstudio'
    | 'custom-openai-compatible'
    | 'none';
  baseUrl: string;
  apiKey: string;
  model: string;
  enableAutoSummary: boolean;
};

export type EmbeddingSettings = {
  enabled: boolean;
  provider: 'openai' | 'openai-compatible' | 'none';
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  minScore: number;
  maxResults: number;
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
    providerPreset: 'none',
    baseUrl: '',
    apiKey: '',
    model: '',
    enableAutoSummary: false,
  },
  embedding: {
    enabled: false,
    provider: 'none',
    baseUrl: '',
    apiKey: '',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    minScore: 0.72,
    maxResults: 8,
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
