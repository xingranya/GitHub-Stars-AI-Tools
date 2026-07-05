import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/providers/workspace-provider';
import { compactNumber } from '@/lib/format';
import type { AiSearchResponse, AiSearchResult } from '@/types';

/* 建议词 */
const SUGGESTIONS = [
  '支持离线缓存的网络请求模块',
  '基于 Rust 的高性能文本处理',
  '微前端架构的主应用入口配置',
  'React 动画库',
  'Python 机器学习框架',
  'Go 语言并发任务队列',
];

/* 搜索历史 localStorage key */
const HISTORY_KEY = 'gsat-search-history';

type AISearchPageProps = {
  onOpenRepository: (repository: AiSearchResult['repository']) => void;
};

type SearchTurn = {
  id: string;
  query: string;
  resultCount: number;
};

export function AISearchPage(props: AISearchPageProps) {
  const workspace = useWorkspace();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [response, setResponse] = useState<AiSearchResponse | null>(null);
  const [searchTurns, setSearchTurns] = useState<SearchTurn[]>([]);

  // 加载搜索历史
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  async function executeSearch(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q) return;
    if (!workspace.authState.user) {
      setSubmittedQuery(q);
      setErrorMessage('请先在设置中连接 GitHub 账号，再搜索你的 Stars 知识库。');
      setResponse(null);
      return;
    }
    setIsSearching(true);
    setErrorMessage(null);
    setSubmittedQuery(q);
    saveHistory(q);
    try {
      const accountId = String(workspace.authState.user.id);
      const contextQueries = searchTurns.map((turn) => turn.query).slice(-4);
      const data = await invoke<AiSearchResponse>('search_repositories', {
        request: { query: q, limit: 20, accountId, contextQueries },
      });
      setResponse(data);
      setSearchTurns((turns) => [
        ...turns,
        { id: `${Date.now()}-${q}`, query: q, resultCount: data.totalCount },
      ].slice(-8));
    } catch (reason) {
      setErrorMessage(toErrorMessage(reason));
      setResponse(null);
    } finally {
      setIsSearching(false);
    }
  }

  function saveHistory(q: string) {
    const newHistory = [q, ...history.filter((h) => h !== q)].slice(0, 10);
    setHistory(newHistory);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch {
      // ignore
    }
  }

  function handleSearch() {
    const q = query.trim();
    if (!q) return;
    void executeSearch(q);
  }

  function handleSuggestionClick(suggestion: string) {
    setQuery(suggestion);
    void executeSearch(suggestion);
  }

  function handleHistoryClick(item: string) {
    setQuery(item);
    void executeSearch(item);
  }

  function handleClearConversation() {
    setSearchTurns([]);
    setSubmittedQuery('');
    setResponse(null);
    setErrorMessage(null);
  }

  const results = response?.results ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[min(1180px,100%)] flex-col gap-6 p-4 sm:p-5 lg:p-6">
        {/* Hero Search Area */}
        <div className="flex flex-col items-center justify-center py-6 lg:py-8">
          <div className="mb-6 text-center">
            <h1 className="font-headline-lg mb-3 flex items-center justify-center gap-3 text-[clamp(24px,3vw,32px)] text-on-surface">
              <Icon name="psychology" size={32} className="text-primary" />
              智能知识搜索
            </h1>
            <p className="font-body-md mx-auto max-w-2xl text-on-surface-variant">
              描述你需要的功能、问题或概念，系统会结合本轮上下文、仓库元数据、README、AI 摘要、标签和笔记召回匹配项目。
            </p>
          </div>

          {/* Giant Search Bar */}
          <div className="group relative w-full max-w-3xl">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 to-tertiary/30 rounded-2xl blur opacity-30 group-hover:opacity-40 transition duration-500" />
            <div className="glass-panel relative flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary sm:flex-row sm:items-center sm:pl-4">
              <Icon name="search" size={22} className="hidden shrink-0 text-primary sm:block" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="帮我找几个好用的 React 动画库..."
                className="h-11 min-w-0 flex-1 border-none bg-transparent px-3 font-body-md text-[15px] font-medium text-on-surface outline-none placeholder:text-on-surface-variant/70 sm:h-12 sm:px-0"
              />
              <div className="flex shrink-0 items-center gap-2 sm:pr-1">
                <kbd className="hidden sm:flex items-center justify-center bg-surface-container px-2 py-1 rounded font-label-sm text-label-sm text-on-surface-variant border border-outline-variant/30 shadow-sm">
                  ⌘ K
                </kbd>
                <button
                  onClick={handleSearch}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 font-body-md text-sm font-bold text-on-primary shadow-md transition-all hover:brightness-110 active:scale-95 sm:w-auto"
                >
                  <span>搜索</span>
                  <Icon name="arrow_forward" size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Suggestions Chips */}
          <div className="mt-5 flex max-w-4xl flex-wrap justify-center gap-2">
            <span className="mr-1 flex items-center font-label-sm text-label-sm font-medium text-on-surface-variant">
              <Icon name="lightbulb" size={16} className="mr-1 text-warning" /> 建议:
            </span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestionClick(s)}
                className="glass-panel flex items-center gap-2 rounded-full bg-surface-container-lowest px-3 py-1.5 font-body-md text-sm text-on-surface transition-colors hover:bg-primary/5 hover:text-primary"
              >
                {s}
              </button>
            ))}
          </div>

          {searchTurns.length > 0 && (
            <div className="mt-4 flex w-full max-w-3xl flex-wrap items-center justify-center gap-2">
              {searchTurns.map((turn) => (
                <button
                  key={turn.id}
                  type="button"
                  onClick={() => handleHistoryClick(turn.query)}
                  className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1 text-xs text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
                  title={`再次搜索：${turn.query}`}
                >
                  {turn.query} · {turn.resultCount}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClearConversation}
                className="rounded-full border border-outline-variant/30 px-3 py-1 text-xs text-on-surface-variant transition-colors hover:text-on-surface"
              >
                清空上下文
              </button>
            </div>
          )}
        </div>

        {/* Results Area */}
        {submittedQuery && (
          <div className="flex flex-col gap-6 animate-fade-in-up">
            <div className="flex flex-col gap-2 border-b border-outline-variant/30 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-headline-md flex items-center gap-2 text-[20px] font-bold text-on-surface">
                <Icon name="temp_preferences_custom" size={24} className="text-primary" />
                本地知识召回结果
              </h3>
              <span className="font-body-md text-body-md text-on-surface-variant font-medium">
                {isSearching ? '搜索中...' : `找到 ${response?.totalCount ?? results.length} 个匹配仓库`}
              </span>
            </div>

            {errorMessage ? (
              <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-error font-body-md">
                {errorMessage}
              </div>
            ) : results.length === 0 && !isSearching ? (
              <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant gap-2">
                <Icon name="search_off" size={64} className="opacity-30" />
                <p className="font-body-md">未找到匹配的仓库，试试换个关键词</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {results.map((result, idx) => (
                  <SearchResultCard
                    key={idx}
                    result={result}
                    onOpenRepository={props.onOpenRepository}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search History */}
        {history.length > 0 && (
          <div className="mt-8 pt-8 border-t border-outline-variant/30">
            <h4 className="font-headline-md text-[18px] text-on-surface mb-4 flex items-center gap-2 font-bold">
              <Icon name="history" size={20} className="text-on-surface-variant" />
              最近搜索历史
            </h4>
            <div className="flex flex-wrap gap-3">
              {history.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleHistoryClick(item)}
                  className="glass-panel bg-surface-container-lowest px-4 py-2 rounded-lg font-body-md text-body-md text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-colors flex items-center gap-2 font-medium"
                >
                  <Icon name="manage_search" size={18} />
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* === 搜索结果卡片 === */
function SearchResultCard({
  result,
  onOpenRepository,
}: {
  result: AiSearchResult;
  onOpenRepository: (repository: AiSearchResult['repository']) => void;
}) {
  const { repository: repo, score, explanationZh, reasons, keywords } = result;

  return (
    <div className="glass-panel group rounded-xl bg-surface-container-lowest p-4 transition-transform duration-300 hover:-translate-y-1 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="mb-3 flex min-w-0 flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shadow-sm shrink-0">
              <Icon name="book" size={24} />
            </div>
            <button
              type="button"
              onClick={() => onOpenRepository(repo)}
              className="min-w-0 flex-1 truncate text-left font-headline-md text-[18px] font-bold text-primary cursor-pointer group-hover:underline sm:text-[20px]"
            >
              {repo.fullName}
            </button>
            <span className="bg-success/10 px-2.5 py-1 rounded-md text-xs font-label-sm text-success border border-success/20 flex items-center gap-1 font-bold shadow-sm shrink-0">
              <Icon name="check_circle" size={14} />
              匹配度 {score}%
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant mb-4 leading-relaxed">
            {repo.description ?? '暂无描述'}
          </p>

          {/* AI Reasoning Box */}
          <div className="bg-primary/5 rounded-lg p-4 border border-primary/20 mb-4 relative overflow-hidden shadow-sm">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-primary rounded-l-lg" />
            <p className="font-body-md text-body-md text-on-surface flex items-start gap-2">
              <Icon name="psychology_alt" size={20} className="text-primary mt-0.5" />
              <span className="leading-relaxed">
                <strong className="text-primary">AI 分析理由：</strong> {explanationZh}
              </span>
            </p>
            {/* Match reasons */}
            {reasons.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 ml-7">
                {reasons.map((reason, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant text-[11px] font-label-sm"
                  >
                    {reason.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Keywords */}
          {keywords.length > 0 && (
            <div className="flex gap-2 mt-4 flex-wrap">
              {keywords.map((kw, i) => (
                <span
                  key={i}
                  className="bg-surface-container px-3 py-1 rounded-full font-label-sm text-label-sm text-on-surface-variant border border-outline-variant/30 font-medium"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right side stats */}
        <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1 text-on-surface-variant font-label-sm font-medium">
            <Icon name="star" size={18} className="text-warning" /> {compactNumber(repo.starsCount)}
          </div>
          {repo.language && (
            <div className="flex items-center gap-1 text-on-surface-variant font-label-sm font-medium">
              <Icon name="code_blocks" size={18} /> {repo.language}
            </div>
          )}
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 p-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface transition-colors border border-outline-variant/30 shadow-sm"
          >
            <Icon name="open_in_new" size={20} />
          </a>
          <button
            type="button"
            onClick={() => onOpenRepository(repo)}
            className="p-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors border border-primary/20 shadow-sm"
            title="在知识库中查看"
          >
            <Icon name="visibility" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
