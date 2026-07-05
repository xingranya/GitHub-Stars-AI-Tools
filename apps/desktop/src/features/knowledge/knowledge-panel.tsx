import { FormEvent, type CSSProperties } from 'react';
import { BookOpen, ExternalLink, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/format';
import type { ReadingStatus, RepositoryAnnotationView, RepositoryDetailView, RepositoryListItem, TagItem } from '@/types';

const readingStatusLabels: Record<ReadingStatus, string> = {
  unread: '未读',
  later: '稍后阅读',
  read: '已读',
};

type KnowledgePanelProps = {
  annotation: RepositoryAnnotationView | null;
  annotationMessage: string | null;
  isLoadingAnnotation: boolean;
  isLoadingRepositoryDetail: boolean;
  isSavingAnnotation: boolean;
  isSavingTag: boolean;
  newTagColor: string;
  newTagName: string;
  noteDraft: string;
  readingStatusDraft: ReadingStatus;
  repository: RepositoryListItem | null;
  repositoryDetail: RepositoryDetailView | null;
  tags: TagItem[];
  onCreateTag: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteTag: (tag: TagItem) => void;
  onRenameTag: (tag: TagItem) => void;
  onSaveAnnotation: () => void;
  onSetNewTagColor: (value: string) => void;
  onSetNewTagName: (value: string) => void;
  onSetNoteDraft: (value: string) => void;
  onSetReadingStatusDraft: (value: ReadingStatus) => void;
  onToggleRepositoryTag: (tag: TagItem) => void;
};

export function KnowledgePanel(props: KnowledgePanelProps) {
  const selectedTagIds = new Set(props.annotation?.tags.map((tag) => tag.id) ?? []);

  if (!props.repository) {
    return (
      <aside className="grid h-full place-items-center p-6 text-center">
        <div>
          <BookOpen className="mx-auto size-8 text-muted-foreground" />
          <strong className="mt-4 block text-sm">选择仓库</strong>
          <p className="mt-2 text-sm text-muted-foreground">查看 README、AI 摘要、标签和笔记。</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs text-muted-foreground">当前项目</span>
            <strong className="mt-1 block truncate text-sm">{props.repository.fullName}</strong>
          </div>
          <Button asChild size="icon" variant="outline" className="size-8 rounded-md">
            <a href={props.repository.htmlUrl} target="_blank" rel="noreferrer" title="打开 GitHub">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
        {props.annotationMessage ? <p className="mt-3 text-sm">{props.annotationMessage}</p> : null}
        {props.isLoadingAnnotation || props.isLoadingRepositoryDetail ? (
          <p className="mt-3 text-xs text-muted-foreground">正在读取本地知识层…</p>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-5 p-4">
          <RepositoryKnowledgeSummary detail={props.repositoryDetail} />

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">阅读状态</span>
            <Select value={props.readingStatusDraft} onValueChange={(value) => props.onSetReadingStatusDraft(value as ReadingStatus)}>
              <SelectTrigger className="h-9 w-full rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(readingStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">标签</span>
            {props.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {props.tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={selectedTagIds.has(tag.id) ? 'tag-chip selected' : 'tag-chip'}
                    disabled={props.isSavingTag}
                    style={tag.color ? { '--tag-color': tag.color } as CSSProperties : undefined}
                    type="button"
                    onClick={() => props.onToggleRepositoryTag(tag)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">还没有标签。先创建一个标签，再给项目打标。</p>
            )}
          </div>

          <form className="grid grid-cols-[1fr_2.25rem_auto] gap-2" onSubmit={props.onCreateTag}>
            <Input value={props.newTagName} placeholder="新标签" onChange={(event) => props.onSetNewTagName(event.target.value)} />
            <Input
              aria-label="标签颜色"
              className="p-1"
              type="color"
              value={props.newTagColor}
              onChange={(event) => props.onSetNewTagColor(event.target.value)}
            />
            <Button disabled={props.isSavingTag || props.newTagName.trim().length === 0} type="submit" variant="outline">
              添加
            </Button>
          </form>

          {props.tags.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">管理标签</summary>
              <div className="mt-3 grid gap-2">
                {props.tags.map((tag) => (
                  <span key={tag.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <span className="truncate">{tag.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => props.onRenameTag(tag)}>重命名</Button>
                    <Button size="sm" variant="ghost" onClick={() => props.onDeleteTag(tag)}>删除</Button>
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          <Separator />

          <label className="grid gap-2" htmlFor="note-markdown">
            <span className="text-xs font-medium text-muted-foreground">Markdown 笔记</span>
            <Textarea
              id="note-markdown"
              className="min-h-44 resize-y rounded-md"
              value={props.noteDraft}
              placeholder="记录用途、关键 API、坑点或后续阅读计划。"
              onChange={(event) => props.onSetNoteDraft(event.target.value)}
            />
          </label>

          <Button disabled={props.isSavingAnnotation || props.isLoadingAnnotation} type="button" onClick={props.onSaveAnnotation}>
            {props.isSavingAnnotation ? '保存中' : '保存笔记'}
          </Button>
        </div>
      </ScrollArea>
    </aside>
  );
}

function RepositoryKnowledgeSummary(props: { detail: RepositoryDetailView | null }) {
  const aiDocument = props.detail?.aiDocument ?? null;
  const readme = props.detail?.readme ?? null;

  return (
    <section className="grid gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <strong className="inline-flex items-center gap-2 text-sm">
          <Sparkles className="size-4" />
          AI 摘要
        </strong>
        {aiDocument ? <span className="text-xs text-muted-foreground">{aiDocument.model}</span> : null}
      </div>
      {aiDocument ? (
        <>
          <p className="text-sm leading-6 text-muted-foreground">{aiDocument.summaryZh}</p>
          {aiDocument.keywords.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {aiDocument.keywords.map((keyword) => (
                <Badge key={keyword} variant="secondary" className="rounded-md font-normal">{keyword}</Badge>
              ))}
            </div>
          ) : null}
          {aiDocument.suggestedTags.length > 0 ? (
            <div className="grid gap-2">
              <span className="text-xs font-medium">推荐标签</span>
              <div className="flex flex-wrap gap-1.5">
                {aiDocument.suggestedTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="rounded-md font-normal">{tag}</Badge>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">生成于 {formatDate(aiDocument.generatedAt)}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">还没有中文摘要。生成后会显示用途说明、关键词和推荐标签。</p>
      )}

      <details className="border-t pt-3">
        <summary className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <BookOpen className="size-4" />
          README
        </summary>
        {readme ? (
          <div className="mt-3 grid gap-2">
            <p className="text-xs text-muted-foreground">来源：{readme.sourcePath}，抓取于 {formatDate(readme.fetchedAt)}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5">{readme.rawMarkdown.slice(0, 8000)}</pre>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">还没有缓存 README。请先执行“抓取 README”。</p>
        )}
      </details>
    </section>
  );
}
