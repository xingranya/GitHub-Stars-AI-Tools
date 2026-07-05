import { FormEvent, useEffect, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { emptyRepositoryFilters } from '@/lib/repository';
import type { RepositoryFilters, TagItem } from '@/types';

type RepositoryFilterBarProps = {
  filters: RepositoryFilters;
  isLoading: boolean;
  languages: string[];
  tags: TagItem[];
  onApplyFilters: (filters: RepositoryFilters) => void;
  onResetFilters: () => void;
};

export function RepositoryFilterBar(props: RepositoryFilterBarProps) {
  const [draftFilters, setDraftFilters] = useState<RepositoryFilters>(props.filters);
  const hasActiveFilters = Boolean(props.filters.keyword || props.filters.language || props.filters.tagId);

  useEffect(() => {
    setDraftFilters(props.filters);
  }, [props.filters]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onApplyFilters(draftFilters);
  }

  function handleReset() {
    setDraftFilters(emptyRepositoryFilters);
    props.onResetFilters();
  }

  return (
    <form className="grid grid-cols-[minmax(260px,1fr)_190px_190px_auto_auto] items-center gap-3" onSubmit={handleSubmit}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 rounded-md pl-9"
          value={draftFilters.keyword}
          placeholder="Search name / description / topics / notes"
          onChange={(event) => setDraftFilters((current) => ({ ...current, keyword: event.target.value }))}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          ⌘K
        </kbd>
      </div>

      <Select value={draftFilters.language || 'all'} onValueChange={(value) => setDraftFilters((current) => ({ ...current, language: value === 'all' ? '' : value }))}>
        <SelectTrigger className="h-10 w-full rounded-md">
          <SelectValue placeholder="全部语言" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部语言</SelectItem>
          {props.languages.map((language) => (
            <SelectItem key={language} value={language}>{language}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={draftFilters.tagId || 'all'} onValueChange={(value) => setDraftFilters((current) => ({ ...current, tagId: value === 'all' ? '' : value }))}>
        <SelectTrigger className="h-10 w-full rounded-md">
          <SelectValue placeholder="全部标签" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部标签</SelectItem>
          {props.tags.map((tag) => (
            <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button className="h-10 rounded-md" disabled={props.isLoading} type="submit">
        <Search className="size-4" />
        {props.isLoading ? '搜索中' : '搜索'}
      </Button>
      <Button className="h-10 rounded-md" disabled={props.isLoading || !hasActiveFilters} type="button" variant="outline" onClick={handleReset}>
        <Filter className="size-4" />
        重置
      </Button>
    </form>
  );
}
