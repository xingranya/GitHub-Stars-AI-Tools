import { describe, expect, it } from 'vitest';
import { normalizeAiSearchResponse } from './ai-search-response';

describe('AI 搜索历史响应兼容', () => {
  it('为旧会话补齐向量字段并限制历史总数', () => {
    const legacyResults = Array.from({ length: 12 }, (_, index) => ({ repository: { id: String(index) } }));
    const response = normalizeAiSearchResponse({
      query: 'React 动画',
      mode: 'local_knowledge',
      results: legacyResults,
      totalCount: 320,
      aiEnhanced: false,
    });

    expect(response).not.toBeNull();
    expect(response?.totalCount).toBe(10);
    expect(response?.results).toHaveLength(10);
    expect(response?.answerZh).toBeNull();
    expect(response?.retrievalMode).toBe('keyword');
    expect(response?.vectorApplied).toBe(false);
    expect(response?.vectorError).toBeNull();
  });

  it('拒绝缺少结果数组的损坏历史数据', () => {
    expect(normalizeAiSearchResponse({ totalCount: 1 })).toBeNull();
  });
});
