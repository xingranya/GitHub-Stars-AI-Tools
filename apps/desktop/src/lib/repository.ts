import type {
  RepositoryFilters,
  RepositoryListItem,
  RepositoryListPage,
  RepositorySearchExplanationView,
  RepositoryStats,
  SearchCitationView,
  SearchMatchReasonView,
  TagItem,
} from '@/types';

export const emptyRepositoryFilters: RepositoryFilters = {
  keyword: '',
  language: '',
  tagId: '',
};

export function getRepositoryStats(page: RepositoryListPage | null): RepositoryStats {
  if (!page) {
    return { total: 0, withReadme: 0, languages: 0, topics: 0 };
  }

  return {
    total: page.totalCount,
    withReadme: page.items.filter((repository) => repository.hasReadme).length,
    languages: new Set(page.items.map((repository) => repository.language).filter(Boolean)).size,
    topics: new Set(page.items.flatMap((repository) => repository.topics)).size,
  };
}

export function buildRepositoryPanelSubtitle(page: RepositoryListPage | null, isLoading: boolean) {
  if (isLoading && !page) {
    return '正在读取本地 SQLite 索引';
  }

  if (!page) {
    return '同步后开始浏览和整理';
  }

  return `显示 ${page.items.length} 个 / 共 ${page.totalCount} 个`;
}

export function buildRepositorySearchExplanation(
  repository: RepositoryListItem,
  filters: RepositoryFilters,
  tags: TagItem[],
): RepositorySearchExplanationView | null {
  const reasons: SearchMatchReasonView[] = [];
  const citations: SearchCitationView[] = [];
  const keyword = filters.keyword.trim();

  if (keyword) {
    const matchedText = findKeywordSnippet(
      [repository.fullName, repository.description, repository.language, repository.topics.join(' ')].filter(Boolean).join(' '),
      keyword,
    );

    reasons.push({
      label: '关键词命中',
      detail: `当前结果与"${keyword}"相关。`,
    });

    if (matchedText) {
      citations.push({
        title: '仓库信息片段',
        snippet: matchedText,
      });
    }
  }

  if (filters.language && repository.language === filters.language) {
    reasons.push({
      label: '语言命中',
      detail: `项目主要语言是 ${filters.language}。`,
    });
  }

  if (filters.tagId) {
    const tagName = tags.find((tag) => tag.id === filters.tagId)?.name ?? '当前标签';
    reasons.push({
      label: '标签命中',
      detail: `项目已归入"${tagName}"。`,
    });
  }

  if (reasons.length === 0) {
    return null;
  }

  return {
    explanationZh: reasons.map((reason) => reason.label).join(' / '),
    reasons,
    citations,
  };
}

function findKeywordSnippet(content: string, keyword: string) {
  const normalizedContent = content.replace(/\s+/gu, ' ').trim();
  const matchIndex = normalizedContent.toLowerCase().indexOf(keyword.toLowerCase());

  if (matchIndex < 0) {
    return normalizedContent.slice(0, 180);
  }

  const start = Math.max(matchIndex - 56, 0);
  const end = Math.min(matchIndex + keyword.length + 96, normalizedContent.length);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedContent.length ? '...' : '';

  return `${prefix}${normalizedContent.slice(start, end)}${suffix}`;
}
