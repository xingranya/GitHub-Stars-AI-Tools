import { DEFAULT_SETTINGS, type AISettings, type EmbeddingSettings } from '@/types-settings';

export const SAVED_AI_API_KEY_PLACEHOLDER = '__GSAT_SAVED_AI_API_KEY__';

export type BackendAiRequestConfig = Pick<AISettings, 'provider' | 'baseUrl' | 'model'> & {
  apiKey: '';
};

export type BackendEmbeddingRequestConfig = Pick<
  EmbeddingSettings,
  'enabled' | 'provider' | 'baseUrl' | 'model' | 'dimensions' | 'minScore' | 'maxResults'
> & {
  apiKey: '';
};

export function toBackendAiRequestConfig(ai: AISettings): BackendAiRequestConfig {
  return {
    provider: ai.provider,
    baseUrl: ai.baseUrl,
    apiKey: '',
    model: ai.model,
  };
}

export function toBackendEmbeddingRequestConfig(embedding: EmbeddingSettings): BackendEmbeddingRequestConfig {
  return {
    enabled: embedding.enabled,
    provider: embedding.provider,
    baseUrl: embedding.baseUrl,
    apiKey: '',
    model: embedding.model,
    dimensions: embedding.dimensions,
    minScore: embedding.minScore,
    maxResults: embedding.maxResults,
  };
}

export function normalizeEmbeddingSettings(embedding: EmbeddingSettings): EmbeddingSettings {
  const provider = embedding.provider === 'openai'
    || embedding.provider === 'openai-compatible'
    || embedding.provider === 'none'
    ? embedding.provider
    : DEFAULT_SETTINGS.embedding.provider;
  return {
    enabled: provider !== 'none' && Boolean(embedding.enabled),
    provider,
    baseUrl: typeof embedding.baseUrl === 'string' ? embedding.baseUrl.trim() : '',
    apiKey: typeof embedding.apiKey === 'string' ? embedding.apiKey : '',
    model: typeof embedding.model === 'string' ? embedding.model.trim() : '',
    dimensions: normalizeBoundedNumber(
      embedding.dimensions,
      DEFAULT_SETTINGS.embedding.dimensions,
      1,
      8192,
      true,
    ),
    minScore: normalizeBoundedNumber(
      embedding.minScore,
      DEFAULT_SETTINGS.embedding.minScore,
      0,
      1,
      false,
    ),
    maxResults: normalizeBoundedNumber(
      embedding.maxResults,
      DEFAULT_SETTINGS.embedding.maxResults,
      1,
      10,
      true,
    ),
  };
}

export function shouldFlushAiApiKey(ai: AISettings): boolean {
  const apiKey = ai.apiKey.trim();
  if (ai.provider === 'none' || isSavedAiApiKeyPlaceholder(apiKey)) {
    return false;
  }

  if (ai.provider === 'openai-compatible' && isLocalAiBaseUrl(ai.baseUrl) && !apiKey) {
    return false;
  }

  return true;
}

export function shouldFlushEmbeddingApiKey(embedding: EmbeddingSettings): boolean {
  const apiKey = embedding.apiKey.trim();
  if (embedding.provider === 'none' || isSavedAiApiKeyPlaceholder(apiKey)) {
    return false;
  }
  if (embedding.provider === 'openai-compatible' && isLocalAiBaseUrl(embedding.baseUrl) && !apiKey) {
    return false;
  }
  return true;
}

export function getEmbeddingConfigMessage(embedding: EmbeddingSettings): string | null {
  if (!embedding.enabled) {
    return '向量检索尚未启用。';
  }
  if (embedding.provider === 'none') {
    return '请选择 OpenAI 或 OpenAI 兼容的 Embedding 服务。';
  }
  const baseUrl = embedding.baseUrl.trim();
  if (embedding.provider === 'openai-compatible' && !baseUrl) {
    return '请填写 Embedding 服务的 OpenAI 兼容请求地址。';
  }
  if (baseUrl && !isAllowedAiBaseUrl(baseUrl)) {
    return 'Embedding 请求地址必须使用 https://；本机或局域网服务可以使用 http://。';
  }
  if (!embedding.model.trim()) {
    return '请填写 Embedding 模型 ID。';
  }
  if (!Number.isInteger(embedding.dimensions) || embedding.dimensions < 1 || embedding.dimensions > 8192) {
    return 'Embedding 维度必须是 1 到 8192 的整数。';
  }
  if (!hasUsableAiApiKey(embedding.apiKey)
    && !(embedding.provider === 'openai-compatible' && isLocalAiBaseUrl(baseUrl))) {
    return '请填写 Embedding API Key。';
  }
  return null;
}

export function getAiConfigMessage(ai: AISettings): string | null {
  if (ai.provider === 'none') {
    return 'AI 功能尚未配置，请在设置中选择 OpenAI、OpenAI 兼容接口或 Anthropic，并填写模型 ID。OpenAI 与 Anthropic 还需要 API Key，OpenAI 兼容接口需要请求地址。';
  }

  const baseUrl = ai.baseUrl.trim();
  if (ai.provider === 'openai-compatible' && !baseUrl) {
    return '请填写 OpenAI 兼容接口的请求地址。';
  }

  if (baseUrl && !isAllowedAiBaseUrl(baseUrl)) {
    return 'AI 请求地址必须使用 https://；OpenAI 兼容接口的本机或局域网服务可以使用 http://。';
  }

  if (!ai.model.trim()) {
    return '请先在设置中填写 AI 模型 ID。';
  }

  if (!hasUsableAiApiKey(ai.apiKey) && !canUseAiWithoutApiKey(ai, baseUrl)) {
    return '请先在设置中填写 AI API Key。';
  }

  return null;
}

export function isSavedAiApiKeyPlaceholder(apiKey: string) {
  return apiKey === SAVED_AI_API_KEY_PLACEHOLDER;
}

function hasUsableAiApiKey(apiKey: string) {
  return isSavedAiApiKeyPlaceholder(apiKey) || apiKey.trim().length > 0;
}

function canUseAiWithoutApiKey(ai: AISettings, baseUrl: string) {
  return ai.provider === 'openai-compatible' && isLocalAiBaseUrl(baseUrl);
}

function normalizeBoundedNumber(
  value: number,
  fallback: number,
  min: number,
  max: number,
  integer: boolean,
) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const bounded = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(bounded) : bounded;
}

function isAllowedAiBaseUrl(baseUrl: string) {
  if (/^https:\/\//i.test(baseUrl)) {
    return true;
  }

  if (!/^http:\/\//i.test(baseUrl)) {
    return false;
  }

  try {
    const url = new URL(baseUrl);
    return isLocalAiHost(url.hostname) || isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

function isLocalAiBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return isLocalAiHost(url.hostname);
  } catch {
    return false;
  }
}

function isLocalAiHost(hostname: string) {
  const host = normalizeHostname(hostname);
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
}

function isPrivateNetworkHost(hostname: string) {
  const host = normalizeHostname(hostname);
  if (host === 'host.docker.internal') {
    return true;
  }

  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '');
}
