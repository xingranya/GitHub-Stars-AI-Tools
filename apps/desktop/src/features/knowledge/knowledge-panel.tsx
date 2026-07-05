import { FormEvent, type CSSProperties } from 'react';
import { BookOpen, ExternalLink, Plus, Save, Sparkles } from 'lucide-react';
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
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10">
            <BookOpen className="size-8 text-primary" />
          </div>
          <strong className="mt-6 block text-sm font-semibold tracking-tight">选择仓库</strong>
          <p className="mt-2 max-w-[280px] text-sm text-muted-foreground leading-relaxed">在左侧表格选择任意仓库，查看 README、AI 摘要、标签和笔记。</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="border-b bg-muted/20 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-medium text-muted-foreground">当前项目</span>
            <strong className="mt-1.5 block truncate text-sm font-semibold tracking-tight">{props.repository.fullName}</strong>
          </div>
          <Button asChild size="icon" variant="outline" className="size-9 rounded-lg shadow-sm">
            <a href={props.repository.htmlUrl} target="_blank" rel="noreferrer" title="在 GitHub 中打开">
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
        {props.annotationMessage ? <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary-foreground">{props.annotationMessage}</p> : null}
        {props.isLoadingAnnotation || props.isLoadingRepositoryDetail ? (
          <p className="mt-3 text-xs text-muted-foreground">正在读取本地知识层…</p>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-6 p-5">
          <RepositoryKnowledgeSummary detail={props.repositoryDetail} />

          <div className="grid gap-2.5">
            <label className="text-xs font-semibold text-foreground">阅读状态</label>
            <Select value={props.readingStatusDraft} onValueChange={(value) => props.onSetReadingStatusDraft(value as ReadingStatus)}>
              <SelectTrigger className="h-10 w-full rounded-lg shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(readingStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2.5">
            <label className="text-xs font-semibold text-foreground">标签</label>
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
              <p className="text-sm text-muted-foreground leading-relaxed">还没有标签。先创建标签，再给项目打标。</p>
            )}
          </div>

          <form className="grid grid-cols-[1fr_2.5rem_auto] gap-2.5" onSubmit={props.onCreateTag}>
            <Input
              value={props.newTagName}
              placeholder="新标签名称"
              className="rounded-lg shadow-sm"
              onChange={(event) => props.onSetNewTagName(event.target.value)}
            />
            <Input
              aria-label="标签颜色"
              className="rounded-lg p-1 shadow-sm"
              type="color"
              value={props.newTagColor}
              onChange={(event) => props.onSetNewTagColor(event.target.value)}
            />
            <Button disabled={props.isSavingTag || props.newTagName.trim().length === 0} type="submit" variant="outline" className="rounded-lg shadow-sm">
              <Plus className="size-4" />
              添加
            </Button>
          </form>

          {props.tags.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground transition-colors">管理标签</summary>
              <div className="mt-3 grid gap-2">
                {props.tags.map((tag) => (
                  <span key={tag.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                    <span className="truncate text-sm">{tag.name}</span>
                    <Button size="sm" variant="ghost" className="h-8 rounded-lg" onClick={() => props.onRenameTag(tag)}>重命名</Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-lg text-destructive hover:text-destructive" onClick={() => props.onDeleteTag(tag)}>删除</Button>
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          <Separator />

          <label className="grid gap-2.5" htmlFor="note-markdown">
            <span className="text-xs font-semibold text-foreground">Markdown 笔记</span>
            <Textarea
              id="note-markdown"
              className="min-h-44 resize-y rounded-lg shadow-sm"
              value={props.noteDraft}
              placeholder="记录用途、关键 API、使用心得或后续阅读计划。"
              onChange={(event) => props.onSetNoteDraft(event.target.value)}
            />
          </label>

          <Button disabled={props.isSavingAnnotation || props.isLoadingAnnotation} type="button" className="rounded-lg shadow-sm" onClick={props.onSaveAnnotation}>
            <Save className="size-4" />
            {props.isSavingAnnotation ? '保存中…' : '保存笔记'}
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
    <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <strong className="inline-flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          AI 摘要
        </strong>
        {aiDocument ? <span className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{aiDocument.model}</span> : null}
      </div>
      {aiDocument ? (
        <>
          <p className="text-sm leading-relaxed text-foreground">{aiDocument.summaryZh}</p>
          {aiDocument.keywords.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {aiDocument.keywords.map((keyword) => (
                <Badge key={keyword} variant="secondary" className="rounded-lg font-normal shadow-sm">{keyword}</Badge>
              ))}
            </div>
          ) : null}
          {aiDocument.suggestedTags.length > 0 ? (
            <div className="grid gap-2">
              <span className="text-xs font-semibold">推荐标签</span>
              <div className="flex flex-wrap gap-1.5">
                {aiDocument.suggestedTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="rounded-lg font-normal shadow-sm">{tag}</Badge>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">生成于 {formatDate(aiDocument.generatedAt)}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">还没有中文摘要。生成后会显示用途说明、关键词和推荐标签。</p>
      )}

      <details className="border-t pt-4">
        <summary className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold transition-colors hover:text-primary">
          <BookOpen className="size-4" />
          README 原文
        </summary>
        {readme ? (
          <div className="mt-3 grid gap-3">
            <p className="text-xs text-muted-foreground">来源：{readme.sourcePath} · 抓取于 {formatDate(readme.fetchedAt)}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-4 text-xs leading-relaxed shadow-inner">{readme.rawMarkdown.slice(0, 8000)}</pre>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">还没有缓存 README。请在左侧面板执行"抓取 README"。</p>
        )}
      </details>
    </section>
  );
}
