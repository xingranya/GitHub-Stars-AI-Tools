import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types-settings';
import {
  getEmbeddingConfigMessage,
  normalizeEmbeddingSettings,
  toBackendEmbeddingRequestConfig,
} from './ai-config';

describe('Embedding 配置', () => {
  it('归一化维度、阈值和结果上限', () => {
    const normalized = normalizeEmbeddingSettings({
      ...DEFAULT_SETTINGS.embedding,
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: '  http://127.0.0.1:11434/v1  ',
      model: '  embedding-model  ',
      dimensions: 9000,
      minScore: -1,
      maxResults: 20,
    });

    expect(normalized.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(normalized.model).toBe('embedding-model');
    expect(normalized.dimensions).toBe(8192);
    expect(normalized.minScore).toBe(0);
    expect(normalized.maxResults).toBe(10);
  });

  it('关闭 provider 时强制关闭向量检索', () => {
    const normalized = normalizeEmbeddingSettings({
      ...DEFAULT_SETTINGS.embedding,
      enabled: true,
      provider: 'none',
    });

    expect(normalized.enabled).toBe(false);
  });

  it('后端配置不携带明文 API Key', () => {
    const backend = toBackendEmbeddingRequestConfig({
      ...DEFAULT_SETTINGS.embedding,
      enabled: true,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-secret',
    });

    expect(backend.apiKey).toBe('');
    expect(backend.maxResults).toBe(8);
  });

  it('拒绝缺少远程 API Key 的启用配置', () => {
    const message = getEmbeddingConfigMessage({
      ...DEFAULT_SETTINGS.embedding,
      enabled: true,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
    });

    expect(message).toContain('Embedding API Key');
  });
});
