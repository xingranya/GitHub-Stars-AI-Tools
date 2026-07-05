import { Archive, Check, Circle, ExternalLink, RefreshCw } from 'lucide-react';
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
      <div className="flex h-14 items-center justify-between border-b bg-muted/20 px-6">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">仓库索引</h1>
          <p className="text-xs text-muted-foreground">{buildRepositoryPanelSubtitle(props.page, props.isLoading)}</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 rounded-lg shadow-sm" disabled={props.isLoading} onClick={props.onRefresh}>
          <RefreshCw className={props.isLoading ? 'size-4 animate-spin' : 'size-4'} />
          刷新
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
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <TableRow>
                <TableHead className="w-[280px] pl-6 font-semibold">仓库</TableHead>
                <TableHead className="font-semibold">描述</TableHead>
                <TableHead className="font-semibold">语言</TableHead>
                <TableHead className="font-semibold">Stars</TableHead>
                <TableHead className="font-semibold">更新</TableHead>
                <TableHead className="font-semibold">Topics</TableHead>
                <TableHead className="pr-6 font-semibold">README</TableHead>
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
      className="cursor-pointer align-top transition-colors hover:bg-muted/50"
      onClick={() => props.onSelectRepository(props.repository.id)}
    >
      <TableCell className="pl-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-0.5 grid size-6 place-items-center rounded-lg text-muted-foreground"
            aria-hidden="true"
          >
            {props.isSelected ? <Check className="size-4 text-primary" /> : <Circle className="size-4" />}
          </span>
          <div className="min-w-0">
            <a
              className="inline-flex max-w-[230px] items-center gap-1.5 truncate text-sm font-medium text-foreground transition-colors hover:text-primary hover:underline"
              href={props.repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              {props.repository.fullName}
              <ExternalLink className="size-3.5" />
            </a>
            {explanation ? <p className="mt-1 truncate text-xs text-muted-foreground">{explanation.explanationZh}</p> : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="max-w-[360px] truncate text-sm text-muted-foreground">{props.repository.description ?? '暂无描述'}</TableCell>
      <TableCell className="text-sm">{props.repository.language ?? '—'}</TableCell>
      <TableCell className="text-sm font-medium">★ {compactNumber(props.repository.starsCount)}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDate(props.repository.pushedAt ?? props.repository.starredAt)}</TableCell>
      <TableCell>
        <div className="flex max-w-[220px] flex-wrap gap-1.5">
          {shownTopics.length > 0 ? shownTopics.map((topic) => <Badge key={topic} variant="secondary" className="rounded-lg font-normal shadow-sm">{topic}</Badge>) : <span className="text-sm text-muted-foreground">—</span>}
          {hiddenTopicCount > 0 ? <Badge variant="outline" className="rounded-lg font-normal shadow-sm">+{hiddenTopicCount}</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="pr-6">
        <Badge variant={props.repository.hasReadme ? 'default' : 'outline'} className="rounded-lg font-medium shadow-sm">
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
        <span key={index} className="h-11 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="m-6 grid min-h-80 place-items-center rounded-lg border border-dashed bg-muted/20 p-10 text-center shadow-sm">
      <div>
        <Archive className="mx-auto mb-4 size-8 text-muted-foreground" />
        <strong className="block text-sm font-semibold">{props.title}</strong>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">{props.body}</p>
      </div>
    </div>
  );
}
