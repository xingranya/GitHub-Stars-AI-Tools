import type { AISettings } from '@/types-settings';

export function getAiConfigMessage(ai: AISettings): string | null {
  if (ai.provider === 'none') {
    return 'AI 功能尚未配置，请在设置中选择 OpenAI、OpenAI 兼容接口或 Anthropic，并填写请求地址、API Key 和模型 ID。';
  }

  if (!ai.apiKey.trim()) {
    return '请先在设置中填写 AI API Key。';
  }

  const baseUrl = ai.baseUrl.trim();
  if (ai.provider === 'openai-compatible' && !baseUrl) {
    return '请填写 OpenAI 兼容接口的请求地址。';
  }

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return 'AI 请求地址必须以 http:// 或 https:// 开头。';
  }

  if (!ai.model.trim()) {
    return '请先在设置中填写 AI 模型 ID。';
  }

  return null;
}
