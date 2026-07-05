import { invoke } from '@tauri-apps/api/core';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { emptyRepositoryFilters, getRepositoryStats } from '@/lib/repository';
import { optionalRequestText } from '@/lib/format';
import type {
  BackendStatus,
  GistAnnotationExportSummary,
  GistAnnotationImportSummary,
  GitHubAuthState,
  GitHubUser,
  ReadmeFetchSummary,
  ReadingStatus,
  RepositoryAnnotationView,
  RepositoryDetailView,
  RepositoryFilters,
  RepositoryListItem,
  RepositoryListPage,
  StarSyncSummary,
  TagItem,
} from '@/types';

const initialAuthState: GitHubAuthState = {
  hasToken: false,
  user: null,
};

export function useStarsWorkspace() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [authState, setAuthState] = useState<GitHubAuthState>(initialAuthState);
  const [token, setToken] = useState('');
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [isClearingToken, setIsClearingToken] = useState(false);
  const [isSyncingStars, setIsSyncingStars] = useState(false);
  const [isFetchingReadmes, setIsFetchingReadmes] = useState(false);
  const [isExportingAnnotations, setIsExportingAnnotations] = useState(false);
  const [isImportingAnnotations, setIsImportingAnnotations] = useState(false);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isLoadingAnnotation, setIsLoadingAnnotation] = useState(false);
  const [isLoadingRepositoryDetail, setIsLoadingRepositoryDetail] = useState(false);
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [syncSummary, setSyncSummary] = useState<StarSyncSummary | null>(null);
  const [readmeSummary, setReadmeSummary] = useState<ReadmeFetchSummary | null>(null);
  const [repositoryPage, setRepositoryPage] = useState<RepositoryListPage | null>(null);
  const [repositoryLanguages, setRepositoryLanguages] = useState<string[]>([]);
  const [repositoryFilters, setRepositoryFilters] = useState<RepositoryFilters>(emptyRepositoryFilters);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [annotation, setAnnotation] = useState<RepositoryAnnotationView | null>(null);
  const [repositoryDetail, setRepositoryDetail] = useState<RepositoryDetailView | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [readingStatusDraft, setReadingStatusDraft] = useState<ReadingStatus>('unread');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#f5f5f5');
  const [gistIdDraft, setGistIdDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [annotationMessage, setAnnotationMessage] = useState<string | null>(null);

  const selectedRepository = useMemo(
    () => repositoryPage?.items.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositoryPage, selectedRepositoryId],
  );
  const repositoryStats = useMemo(() => getRepositoryStats(repositoryPage), [repositoryPage]);

  useEffect(() => {
    invoke<BackendStatus>('get_backend_status')
      .then(setStatus)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));

    invoke<GitHubAuthState>('get_github_auth_state')
      .then(setAuthState)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));

    loadRepositories(emptyRepositoryFilters);
    loadRepositoryLanguages();
  }, []);

  useEffect(() => {
    if (!repositoryPage || repositoryPage.items.length === 0) {
      setSelectedRepositoryId(null);
      return;
    }

    const selectedStillExists = repositoryPage.items.some((repository) => repository.id === selectedRepositoryId);

    if (!selectedStillExists) {
      setSelectedRepositoryId(repositoryPage.items[0].id);
    }
  }, [repositoryPage, selectedRepositoryId]);

  useEffect(() => {
    if (!selectedRepository) {
      setAnnotation(null);
      setRepositoryDetail(null);
      setNoteDraft('');
      setReadingStatusDraft('unread');
      return;
    }

    loadAnnotationWorkspace(selectedRepository);
  }, [selectedRepository?.id, selectedRepository?.accountId]);

  async function loadRepositories(nextFilters = repositoryFilters) {
    setIsLoadingRepositories(true);

    try {
      const page = await invoke<RepositoryListPage>('list_repositories', {
        request: {
          limit: 1000,
          offset: 0,
          keyword: optionalRequestText(nextFilters.keyword),
          language: optionalRequestText(nextFilters.language),
          tagId: optionalRequestText(nextFilters.tagId),
        },
      });
      setRepositoryPage(page);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsLoadingRepositories(false);
    }
  }

  async function loadRepositoryLanguages() {
    try {
      const languages = await invoke<string[]>('list_repository_languages');
      setRepositoryLanguages(languages);
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }

  async function applyRepositoryFilters(nextFilters: RepositoryFilters) {
    setRepositoryFilters(nextFilters);
    await loadRepositories(nextFilters);
  }

  async function resetRepositoryFilters() {
    setRepositoryFilters(emptyRepositoryFilters);
    await loadRepositories(emptyRepositoryFilters);
  }

  async function refreshRepositoryWorkspace() {
    await Promise.all([loadRepositories(repositoryFilters), loadRepositoryLanguages()]);
  }

  async function loadAnnotationWorkspace(repository: RepositoryListItem) {
    setIsLoadingAnnotation(true);
    setIsLoadingRepositoryDetail(true);
    setAnnotationMessage(null);

    try {
      const [nextTags, nextAnnotation, nextRepositoryDetail] = await Promise.all([
        invoke<TagItem[]>('list_tags', { request: { accountId: repository.accountId } }),
        invoke<RepositoryAnnotationView>('get_repository_annotation', {
          request: { repositoryId: repository.id, accountId: repository.accountId },
        }),
        invoke<RepositoryDetailView>('get_repository_detail', {
          request: { repositoryId: repository.id, accountId: repository.accountId },
        }),
      ]);
      setTags(nextTags);
      setAnnotation(nextAnnotation);
      setRepositoryDetail(nextRepositoryDetail);
      setNoteDraft(nextAnnotation.noteMarkdown);
      setReadingStatusDraft(nextAnnotation.readingStatus);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsLoadingAnnotation(false);
      setIsLoadingRepositoryDetail(false);
    }
  }

  async function handleSaveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingToken(true);
    setError(null);
    setAuthMessage(null);

    try {
      const user = await invoke<GitHubUser>('save_github_token', { token });
      setAuthState({ hasToken: true, user });
      setToken('');
      setAuthMessage('GitHub 账号已连接，可以同步 Stars。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingToken(false);
    }
  }

  async function handleClearToken() {
    setIsClearingToken(true);
    setError(null);
    setAuthMessage(null);

    try {
      await invoke('clear_github_token');
      setAuthState(initialAuthState);
      setSyncSummary(null);
      setReadmeSummary(null);
      setAuthMessage('GitHub 连接已移除，本地 Star 数据不会被删除。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsClearingToken(false);
    }
  }

  async function handleSyncStars() {
    setIsSyncingStars(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<StarSyncSummary>('sync_github_stars');
      setSyncSummary(summary);
      setReadmeSummary(null);
      await refreshRepositoryWorkspace();
      setAuthMessage(
        `同步完成：当前 ${summary.activeCount} 个，新增 ${summary.createdCount} 个，更新 ${summary.updatedCount} 个，移除 ${summary.removedCount} 个。`,
      );
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSyncingStars(false);
    }
  }

  async function handleFetchReadmes() {
    setIsFetchingReadmes(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<ReadmeFetchSummary>('fetch_repository_readmes');
      setReadmeSummary(summary);
      await refreshRepositoryWorkspace();
      setAuthMessage(`README 已处理 ${summary.totalCount} 个仓库。`);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsFetchingReadmes(false);
    }
  }

  async function handleExportAnnotations() {
    setIsExportingAnnotations(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<GistAnnotationExportSummary>('export_annotation_gist');
      setGistIdDraft(summary.gistId);
      setAuthMessage(`注解已导出：${summary.tagCount} 个标签，${summary.repositoryCount} 条仓库注解。`);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsExportingAnnotations(false);
    }
  }

  async function handleImportAnnotations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gistId = gistIdDraft.trim();

    if (!gistId) {
      return;
    }

    setIsImportingAnnotations(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<GistAnnotationImportSummary>('import_annotation_gist', {
        request: { gistId },
      });
      await refreshRepositoryWorkspace();
      if (selectedRepository) {
        await loadAnnotationWorkspace(selectedRepository);
      }
      setAuthMessage(
        `注解已导入：${summary.tagCount} 个标签，${summary.repositoryCount} 条仓库注解，跳过 ${summary.skippedRepositoryCount} 条本地不存在的仓库。`,
      );
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsImportingAnnotations(false);
    }
  }

  async function handleCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedRepository || newTagName.trim().length === 0) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      const createdTag = await invoke<TagItem>('create_tag', {
        request: {
          accountId: selectedRepository.accountId,
          name: newTagName,
          color: newTagColor,
        },
      });
      setTags((currentTags) => [...currentTags, createdTag].sort((left, right) => left.name.localeCompare(right.name)));
      setNewTagName('');
      setAnnotationMessage('标签已创建。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleRenameTag(tag: TagItem) {
    if (!selectedRepository) {
      return;
    }

    const nextName = window.prompt('输入新的标签名称', tag.name)?.trim();

    if (!nextName || nextName === tag.name) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      const nextTag = await invoke<TagItem>('update_tag', {
        request: {
          accountId: selectedRepository.accountId,
          tagId: tag.id,
          name: nextName,
          color: tag.color,
        },
      });
      setTags((currentTags) => currentTags.map((item) => (item.id === nextTag.id ? nextTag : item)));
      setAnnotation((currentAnnotation) =>
        currentAnnotation
          ? {
              ...currentAnnotation,
              tags: currentAnnotation.tags.map((item) => (item.id === nextTag.id ? nextTag : item)),
            }
          : currentAnnotation,
      );
      setAnnotationMessage('标签已重命名。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleDeleteTag(tag: TagItem) {
    if (!selectedRepository || !window.confirm(`删除标签“${tag.name}”？已打标的项目会自动移除此标签。`)) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      await invoke('delete_tag', {
        request: {
          accountId: selectedRepository.accountId,
          tagId: tag.id,
        },
      });
      setTags((currentTags) => currentTags.filter((item) => item.id !== tag.id));
      if (repositoryFilters.tagId === tag.id) {
        await resetRepositoryFilters();
      } else {
        await loadRepositories(repositoryFilters);
      }
      setAnnotation((currentAnnotation) =>
        currentAnnotation
          ? { ...currentAnnotation, tags: currentAnnotation.tags.filter((item) => item.id !== tag.id) }
          : currentAnnotation,
      );
      setAnnotationMessage('标签已删除。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleToggleRepositoryTag(tag: TagItem) {
    if (!selectedRepository || !annotation) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    const currentTagIds = new Set(annotation.tags.map((item) => item.id));

    if (currentTagIds.has(tag.id)) {
      currentTagIds.delete(tag.id);
    } else {
      currentTagIds.add(tag.id);
    }

    try {
      const nextAnnotation = await invoke<RepositoryAnnotationView>('set_repository_tags', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          tagIds: Array.from(currentTagIds),
        },
      });
      setAnnotation(nextAnnotation);
      if (repositoryFilters.tagId === tag.id) {
        await loadRepositories(repositoryFilters);
      }
      setAnnotationMessage('仓库标签已更新。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleSaveAnnotation() {
    if (!selectedRepository) {
      return;
    }

    setIsSavingAnnotation(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      const nextAnnotation = await invoke<RepositoryAnnotationView>('save_repository_annotation', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          noteMarkdown: noteDraft,
          readingStatus: readingStatusDraft,
        },
      });
      setAnnotation(nextAnnotation);
      setNoteDraft(nextAnnotation.noteMarkdown);
      setReadingStatusDraft(nextAnnotation.readingStatus);
      setAnnotationMessage('笔记和阅读状态已保存。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingAnnotation(false);
    }
  }

  return {
    annotation,
    annotationMessage,
    applyRepositoryFilters,
    authMessage,
    authState,
    error,
    gistIdDraft,
    handleClearToken,
    handleCreateTag,
    handleDeleteTag,
    handleExportAnnotations,
    handleFetchReadmes,
    handleImportAnnotations,
    handleRenameTag,
    handleSaveAnnotation,
    handleSaveToken,
    handleSyncStars,
    handleToggleRepositoryTag,
    isClearingToken,
    isExportingAnnotations,
    isFetchingReadmes,
    isImportingAnnotations,
    isLoadingAnnotation,
    isLoadingRepositories,
    isLoadingRepositoryDetail,
    isSavingAnnotation,
    isSavingTag,
    isSavingToken,
    isSyncingStars,
    newTagColor,
    newTagName,
    noteDraft,
    readingStatusDraft,
    readmeSummary,
    refreshRepositoryWorkspace,
    repositoryDetail,
    repositoryFilters,
    repositoryLanguages,
    repositoryPage,
    repositoryStats,
    resetRepositoryFilters,
    selectedRepository,
    setGistIdDraft,
    setNewTagColor,
    setNewTagName,
    setNoteDraft,
    setReadingStatusDraft,
    setSelectedRepositoryId,
    setToken,
    status,
    syncSummary,
    tags,
    token,
  };
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
