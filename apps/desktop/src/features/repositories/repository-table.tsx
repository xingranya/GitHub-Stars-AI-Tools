import { Check, Circle, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildRepositoryPanelSubtitle, buildRepositorySearchExplanation } from '@/lib/repository';
import { compactNumber, formatDate } from '@/lib/format';
import type { RepositoryFilters, RepositoryListItem, RepositoryListPage, TagItem } from '@/types';

type RepositoryTableProps = {
  filters: RepositoryFilters;
  isLoading: boolean;
  page: RepositoryListPage | null;
  selectedRepository: RepositoryListItem | null;
  tags: TagItem[];
  onRefresh: () => void;
  onSelectRepository: (repositoryId: string) => void;
};

export function RepositoryTable(props: RepositoryTableProps) {
  const hasActiveFilters = Boolean(props.filters.keyword || props.filters.language || props.filters.tagId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 items-center justify-between border-b px-5">
        <div>
          <h1 className="text-sm font-semibold">仓库索引</h1>
          <p className="text-xs text-muted-foreground">{buildRepositoryPanelSubtitle(props.page, props.isLoading)}</p>
        </div>
        <Button size="icon" variant="outline" className="size-8 rounded-md" disabled={props.isLoading} onClick={props.onRefresh}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {props.isLoading && !props.page ? <RepositorySkeleton /> : null}
      {!props.isLoading && !props.page ? <EmptyState title="等待本地索引" body="连接 GitHub 后同步 Stars，这里会展示仓库、语言、Star 数、更新时间和 README 状态。" /> : null}
      {props.page?.items.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? '没有匹配结果' : '还没有同步仓库'}
          body={hasActiveFilters ? '调整关键词、语言或标签后重新搜索。' : '先在左侧连接 GitHub，然后执行同步。'}
        />
      ) : null}
      {props.page && props.page.items.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[270px] pl-5">Repository</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Stars</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="pr-5">README</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.page.items.map((repository) => (
                <RepositoryRow
                  key={repository.id}
                  filters={props.filters}
                  isSelected={repository.id === props.selectedRepository?.id}
                  repository={repository}
                  tags={props.tags}
                  onSelectRepository={props.onSelectRepository}
                />
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      ) : null}
    </div>
  );
}

function RepositoryRow(props: {
  filters: RepositoryFilters;
  isSelected: boolean;
  repository: RepositoryListItem;
  tags: TagItem[];
  onSelectRepository: (repositoryId: string) => void;
}) {
  const explanation = buildRepositorySearchExplanation(props.repository, props.filters, props.tags);
  const shownTopics = props.repository.topics.slice(0, 2);
  const hiddenTopicCount = Math.max(props.repository.topics.length - shownTopics.length, 0);

  return (
    <TableRow
      data-state={props.isSelected ? 'selected' : undefined}
      className="cursor-pointer"
      onClick={() => props.onSelectRepository(props.repository.id)}
    >
      <TableCell className="pl-5">
        <div className="flex min-w-0 items-start gap-3">
          <button className="mt-0.5 text-muted-foreground" type="button" aria-label={`整理 ${props.repository.fullName}`}>
            {props.isSelected ? <Check className="size-4 text-foreground" /> : <Circle className="size-4" />}
          </button>
          <div className="min-w-0">
            <a
              className="inline-flex max-w-[230px] items-center gap-1 truncate text-sm font-medium text-foreground hover:underline"
              href={props.repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              {props.repository.fullName}
              <ExternalLink className="size-3" />
            </a>
            {explanation ? <p className="mt-1 truncate text-xs text-muted-foreground">{explanation.explanationZh}</p> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="max-w-[360px] truncate text-muted-foreground">{props.repository.description ?? '暂无描述'}</TableCell>
      <TableCell>{props.repository.language ?? '—'}</TableCell>
      <TableCell>★ {compactNumber(props.repository.starsCount)}</TableCell>
      <TableCell>{formatDate(props.repository.pushedAt ?? props.repository.starredAt)}</TableCell>
      <TableCell>
        <div className="flex max-w-[220px] flex-wrap gap-1.5">
          {shownTopics.length > 0 ? shownTopics.map((topic) => <Badge key={topic} variant="secondary" className="rounded-md font-normal">{topic}</Badge>) : <span className="text-muted-foreground">—</span>}
          {hiddenTopicCount > 0 ? <Badge variant="outline" className="rounded-md font-normal">+{hiddenTopicCount}</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="pr-5">
        <Badge variant={props.repository.hasReadme ? 'default' : 'outline'} className="rounded-md font-normal">
          {props.repository.hasReadme ? '已缓存' : '待抓取'}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function RepositorySkeleton() {
  return (
    <div className="grid gap-2 p-5">
      {Array.from({ length: 9 }).map((_, index) => (
        <span key={index} className="h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="m-5 grid place-items-center rounded-md border border-dashed p-10 text-center">
      <strong className="text-sm">{props.title}</strong>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{props.body}</p>
    </div>
  );
}
