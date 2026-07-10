import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ReadmeRenderer } from '@/components/readme-renderer';
import { compactNumber, formatDate } from '@/lib/format';
import type { GithubRecommendationReadme, RankingItem } from '@/types';

export function RankingDetailPanel(props: {
  accountId: string;
  repository: RankingItem;
  onClose: () => void;
}) {
  const [readme, setReadme] = useState<GithubRecommendationReadme | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const cacheRef = useRef(new Map<string, GithubRecommendationReadme>());

  useEffect(() => {
    let cancelled = false;
    const fullName = props.repository.fullName;
    const cached = cacheRef.current.get(fullName);
    setReadme(cached ?? null);
    setError(null);
    if (cached) return () => { cancelled = true; };

    setIsLoading(true);
    void invoke<GithubRecommendationReadme>('fetch_github_ranking_readme', {
      request: { accountId: props.accountId, fullName },
    })
      .then((response) => {
        if (cancelled) return;
        cacheRef.current.set(fullName, response);
        setReadme(response);
      })
      .catch((reason) => {
        if (!cancelled) setError(toErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [props.accountId, props.repository.fullName, reloadKey]);

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface xl:border-l xl:border-outline-variant/25" aria-label={`${props.repository.fullName} 项目介绍`}>
      <header className="shrink-0 border-b border-outline-variant/25 px-4 py-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={props.onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="返回排行榜"
            title="返回排行榜"
          >
            <Icon name="arrow_back" size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-on-surface">{props.repository.fullName}</h2>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-on-surface-variant">
              {props.repository.description ?? '该仓库暂未提供项目描述。'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-on-surface-variant">
              <span>{props.repository.language ?? '其他语言'}</span>
              <span className="inline-flex items-center gap-1"><Icon name="star" size={14} />{compactNumber(props.repository.starsCount)}</span>
              <span className="inline-flex items-center gap-1"><Icon name="fork_right" size={14} />{compactNumber(props.repository.forksCount)}</span>
            </div>
          </div>
          <a
            href={props.repository.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-outline-variant/30 text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="在 GitHub 打开"
            title="在 GitHub 打开"
          >
            <Icon name="open_in_new" size={16} />
          </a>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-lowest/45">
        {isLoading ? (
          <div className="space-y-4 px-5 py-6" aria-label="正在加载 README">
            <div className="h-5 w-2/5 animate-pulse rounded bg-surface-container-high" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-container" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-surface-container" />
            <div className="h-32 w-full animate-pulse rounded-md bg-surface-container" />
          </div>
        ) : error ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-md bg-error/10 text-error">
              <Icon name="error" size={21} />
            </span>
            <p className="mt-3 max-w-md text-sm leading-6 text-error">{error}</p>
            <Button className="mt-4" size="sm" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
              <Icon name="refresh" size={15} />
              重新加载
            </Button>
          </div>
        ) : readme ? (
          <div>
            <div className="border-b border-outline-variant/20 px-4 py-2 text-[11px] text-on-surface-variant">
              {readme.sourcePath} · {formatDate(readme.fetchedAt)}{readme.fromCache ? ' · 本地缓存' : ''}
            </div>
            <ReadmeRenderer
              markdown={readme.rawMarkdown}
              repositoryFullName={props.repository.fullName}
              sourcePath={readme.sourcePath}
              className="readme-rendered readme-rendered-compact min-w-0 px-4 py-4 text-on-surface"
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
