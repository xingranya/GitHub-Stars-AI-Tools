import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getAiConfigMessage } from '@/lib/ai-config';
import { emptyRepositoryFilters, getRepositoryStats } from '@/lib/repository';
import { optionalRequestText } from '@/lib/format';
import type {
  AISettings,
  BatchAiDocumentSummary,
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
  TaskProgressEvent,
} from '@/types';

const initialAuthState: GitHubAuthState = {
  hasToken: false,
  user: null,
};

const emptyRepositoryPage: RepositoryListPage = {
  items: [],
  totalCount: 0,
  limit: 5000,
  offset: 0,
};

export function useStarsWorkspace() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [authState, setAuthState] = useState<GitHubAuthState>(initialAuthState);
  const [token, setToken] = useState('');
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
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
  const [isFetchingRepositoryReadme, setIsFetchingRepositoryReadme] = useState(false);
  const [isGeneratingAiDocument, setIsGeneratingAiDocument] = useState(false);
  const [isBatchGeneratingAiDocuments, setIsBatchGeneratingAiDocuments] = useState(false);
  const [batchAiSummary, setBatchAiSummary] = useState<BatchAiDocumentSummary | null>(null);
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
  const [taskProgress, setTaskProgress] = useState<TaskProgressEvent | null>(null);
  const [repositoryReadmeError, setRepositoryReadmeError] = useState<{ repositoryId: string; message: string } | null>(null);
  const [repositoryAiError, setRepositoryAiError] = useState<{ repositoryId: string; message: string } | null>(null);

  const selectedRepository = useMemo(
    () => repositoryPage?.items.find((repository) => repository.id === selectedRepositoryId) ?? null,
    [repositoryPage, selectedRepositoryId],
  );
  const repositoryStats = useMemo(() => getRepositoryStats(repositoryPage), [repositoryPage]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<TaskProgressEvent>('task-progress', (event) => {
      setTaskProgress(event.payload);
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    invoke<BackendStatus>('get_backend_status')
      .then(setStatus)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));

    invoke<GitHubAuthState>('get_github_auth_state')
      .then(setAuthState)
      .catch((reason: unknown) => setError(toErrorMessage(reason)))
      .finally(() => setIsLoadingAuth(false));

    loadRepositories(emptyRepositoryFilters);
    loadRepositoryLanguages();

    return () => {
      unlisten?.();
    };
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

  useEffect(() => {
    void refreshRepositoryWorkspace();
  }, [authState.user?.id]);

  async function loadRepositories(nextFilters = repositoryFilters, accountIdOverride?: string) {
    setIsLoadingRepositories(true);
    const accountId = accountIdOverride ?? (authState.user ? String(authState.user.id) : undefined);

    if (!accountId) {
      setRepositoryPage(emptyRepositoryPage);
      setIsLoadingRepositories(false);
      return;
    }

    try {
      const page = await invoke<RepositoryListPage>('list_repositories', {
        request: {
          limit: 5000,
          offset: 0,
          accountId,
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

  async function loadRepositoryLanguages(accountIdOverride?: string) {
    try {
      const accountId = accountIdOverride ?? (authState.user ? String(authState.user.id) : undefined);
      if (!accountId) {
        setRepositoryLanguages([]);
        return;
      }
      const languages = await invoke<string[]>(
        'list_repository_languages',
        { request: { accountId } },
      );
      setRepositoryLanguages(languages);
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }

  async function loadTags(accountId = authState.user ? String(authState.user.id) : undefined) {
    try {
      if (!accountId) {
        setTags([]);
        return;
      }

      const nextTags = await invoke<TagItem[]>('list_tags', { request: { accountId } });
      setTags(nextTags);
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

  async function refreshRepositoryWorkspace(accountIdOverride?: string) {
    await Promise.all([
      loadRepositories(repositoryFilters, accountIdOverride),
      loadRepositoryLanguages(accountIdOverride),
      loadTags(accountIdOverride),
    ]);
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
      await refreshRepositoryWorkspace(String(user.id));
      setAuthMessage('GitHub 账号已连接，可以同步 Stars。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingToken(false);
    }
  }

  /**
   * 直接用传入的 token 连接 GitHub，绕过 React state 异步更新问题。
   * 用于 WelcomeFlow 等需要立即用 token 调 invoke 的场景。
   */
  async function connectWithToken(rawToken: string) {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      setError('请输入 GitHub Personal Access Token');
      return;
    }
    setIsSavingToken(true);
    setError(null);
    setAuthMessage(null);
    try {
      const user = await invoke<GitHubUser>('save_github_token', { token: trimmed });
      setAuthState({ hasToken: true, user });
      setToken('');
      await refreshRepositoryWorkspace(String(user.id));
      setAuthMessage('GitHub 账号已连接，可以同步 Stars。');
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
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

  async function handleSyncStars(options?: { forceFull?: boolean; throwOnError?: boolean }) {
    setIsSyncingStars(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<StarSyncSummary>('sync_github_stars', {
        request: { forceFull: options?.forceFull ?? false },
      });
      setSyncSummary(summary);
      setReadmeSummary(null);
      await refreshRepositoryWorkspace();
      setAuthMessage(
        `同步完成：当前 ${summary.activeCount} 个，新增 ${summary.createdCount} 个，扫描 ${summary.scannedCount} 个，模式 ${summary.mode === 'incremental' ? '增量' : '全量'}。`,
      );
    } catch (reason) {
      const message = toErrorMessage(reason);
      const displayMessage = `同步未完成：${message}。本地已有数据不会被删除，可检查网络或 Token 后重试。`;
      setError(displayMessage);
      setTaskProgress(buildFailedTaskProgress('sync-stars', 'sync', displayMessage));
      await refreshRepositoryWorkspace();
      if (options?.throwOnError) {
        throw new Error(displayMessage);
      }
    } finally {
      setIsSyncingStars(false);
    }
  }

  async function handleFetchReadmes(options?: {
    aiConfig?: AISettings;
    autoGenerateAi?: boolean;
    aiLimit?: number;
    onlyMissing?: boolean;
  }) {
    setIsFetchingReadmes(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<ReadmeFetchSummary>('fetch_repository_readmes');
      setReadmeSummary(summary);
      await refreshRepositoryWorkspace();
      const readmeMessage = `README 已处理 ${summary.totalCount} 个仓库：更新 ${summary.fetchedCount}，跳过 ${summary.skippedCount}，缺失 ${summary.missingCount}，失败 ${summary.failedCount}。`;
      setAuthMessage(readmeMessage);

      if (options?.autoGenerateAi) {
        const aiConfig = options.aiConfig;
        if (!aiConfig) {
          const message = '请先在设置中配置 AI Provider。';
          setError(message);
          setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', message));
          setAuthMessage(`${readmeMessage} AI 分析未启动：${message}`);
          return summary;
        }

        const aiConfigMessage = getAiConfigMessage(aiConfig);
        if (aiConfigMessage) {
          setError(aiConfigMessage);
          setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', aiConfigMessage));
          setAuthMessage(`${readmeMessage} AI 分析未启动：${aiConfigMessage}`);
          return summary;
        }

        try {
          await handleBatchGenerateAiDocuments(aiConfig, {
            limit: options.aiLimit ?? 50,
            onlyMissing: options.onlyMissing ?? true,
          });
        } catch (reason) {
          const message = toErrorMessage(reason);
          setAuthMessage(`${readmeMessage} AI 分析失败：${message}`);
        }
      }

      return summary;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('fetch-readmes', 'readme', message));
      return null;
    } finally {
      setIsFetchingReadmes(false);
    }
  }

  async function handleExportAnnotations() {
    setIsExportingAnnotations(true);
    setError(null);
    setAuthMessage(null);
    setTaskProgress(buildRunningTaskProgress('export-annotation-gist', 'backup', '正在导出注解到 GitHub Gist'));

    try {
      const summary = await invoke<GistAnnotationExportSummary>('export_annotation_gist');
      setGistIdDraft(summary.gistId);
      setAuthMessage(`注解已导出到 Gist ${summary.gistId}：${summary.tagCount} 个标签，${summary.repositoryCount} 条仓库注解。`);
      setTaskProgress(buildSucceededTaskProgress('export-annotation-gist', 'backup', '注解已导出到 GitHub Gist。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('export-annotation-gist', 'backup', message));
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
    setTaskProgress(buildRunningTaskProgress('import-annotation-gist', 'backup', '正在从 GitHub Gist 导入注解'));

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
      setTaskProgress(buildSucceededTaskProgress('import-annotation-gist', 'backup', '注解已从 GitHub Gist 导入。'));
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('import-annotation-gist', 'backup', message));
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
      const currentTagIds = new Set(annotation?.tags.map((item) => item.id) ?? []);
      currentTagIds.add(createdTag.id);
      const nextAnnotation = await invoke<RepositoryAnnotationView>('set_repository_tags', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          tagIds: Array.from(currentTagIds),
        },
      });
      setTags((currentTags) => {
        const withoutDuplicate = currentTags.filter((tag) => tag.id !== createdTag.id);
        return [...withoutDuplicate, createdTag].sort((left, right) => left.name.localeCompare(right.name));
      });
      setAnnotation(nextAnnotation);
      await loadRepositories(repositoryFilters);
      setNewTagName('');
      setAnnotationMessage(`标签"${createdTag.name}"已创建并应用到当前仓库。`);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleRenameTag(tag: TagItem, nextName: string) {
    if (!selectedRepository) {
      return;
    }

    const normalizedName = nextName.trim();

    if (!normalizedName || normalizedName === tag.name) {
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
          name: normalizedName,
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
    if (!selectedRepository) {
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
      await loadRepositories(repositoryFilters);
      setAnnotationMessage('仓库标签已更新。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleApplySuggestedTag(tagName: string) {
    if (!selectedRepository || !annotation) {
      return;
    }

    const normalizedTagName = tagName.trim();
    if (!normalizedTagName) {
      return;
    }

    setIsSavingTag(true);
    setError(null);
    setAnnotationMessage(null);

    try {
      let targetTag = tags.find((tag) => tag.name.toLowerCase() === normalizedTagName.toLowerCase()) ?? null;

      if (!targetTag) {
        const createdTag = await invoke<TagItem>('create_tag', {
          request: {
            accountId: selectedRepository.accountId,
            name: normalizedTagName,
            color: getSuggestedTagColor(normalizedTagName),
          },
        });
        targetTag = createdTag;
        setTags((currentTags) => [...currentTags, createdTag].sort((left, right) => left.name.localeCompare(right.name)));
      }

      const currentTagIds = new Set(annotation.tags.map((item) => item.id));
      if (currentTagIds.has(targetTag.id)) {
        setAnnotationMessage(`标签"${targetTag.name}"已应用到当前仓库。`);
        return;
      }

      currentTagIds.add(targetTag.id);
      const nextAnnotation = await invoke<RepositoryAnnotationView>('set_repository_tags', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          tagIds: Array.from(currentTagIds),
        },
      });
      setAnnotation(nextAnnotation);
      await loadRepositories(repositoryFilters);
      setAnnotationMessage(`标签"${targetTag.name}"已应用到当前仓库。`);
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
      await loadRepositories(repositoryFilters);
      setAnnotationMessage('笔记和阅读状态已保存。');
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsSavingAnnotation(false);
    }
  }

  async function handleFetchRepositoryReadme() {
    if (!selectedRepository) {
      return;
    }

    setIsFetchingRepositoryReadme(true);
    setError(null);
    setRepositoryReadmeError(null);
    setAnnotationMessage(null);

    try {
      const nextRepositoryDetail = await invoke<RepositoryDetailView>('fetch_repository_readme', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
        },
      });
      setRepositoryDetail(nextRepositoryDetail);
      await refreshRepositoryWorkspace();
      setRepositoryReadmeError(null);
      setAnnotationMessage('README 已缓存。');
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setRepositoryReadmeError({ repositoryId: selectedRepository.id, message });
      setTaskProgress(buildFailedTaskProgress('fetch-repository-readme', 'readme', message));
      throw reason;
    } finally {
      setIsFetchingRepositoryReadme(false);
    }
  }

  async function handleGenerateAiDocument(aiConfig: AISettings) {
    if (!selectedRepository) {
      return;
    }

    const aiConfigMessage = getAiConfigMessage(aiConfig);
    if (aiConfigMessage) {
      setError(aiConfigMessage);
      setRepositoryAiError({ repositoryId: selectedRepository.id, message: aiConfigMessage });
      setTaskProgress(buildFailedTaskProgress('generate-ai-document', 'ai', aiConfigMessage));
      throw new Error(aiConfigMessage);
    }

    setIsGeneratingAiDocument(true);
    setError(null);
    setRepositoryAiError(null);
    setAnnotationMessage(null);

    try {
      const nextRepositoryDetail = await invoke<RepositoryDetailView>('generate_repository_ai_document', {
        request: {
          repositoryId: selectedRepository.id,
          accountId: selectedRepository.accountId,
          aiConfig: {
            provider: aiConfig.provider,
            baseUrl: aiConfig.baseUrl,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
          },
        },
      });
      setRepositoryDetail(nextRepositoryDetail);
      await refreshRepositoryWorkspace();
      setRepositoryAiError(null);
      setAnnotationMessage('AI 摘要已生成。');
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setRepositoryAiError({ repositoryId: selectedRepository.id, message });
      setTaskProgress(buildFailedTaskProgress('generate-ai-document', 'ai', message));
      throw reason;
    } finally {
      setIsGeneratingAiDocument(false);
    }
  }

  async function handleBatchGenerateAiDocuments(aiConfig: AISettings, options?: { limit?: number; onlyMissing?: boolean }) {
    const aiConfigMessage = getAiConfigMessage(aiConfig);
    if (aiConfigMessage) {
      setError(aiConfigMessage);
      setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', aiConfigMessage));
      throw new Error(aiConfigMessage);
    }

    setIsBatchGeneratingAiDocuments(true);
    setError(null);
    setAuthMessage(null);

    try {
      const summary = await invoke<BatchAiDocumentSummary>('batch_generate_repository_ai_documents', {
        request: {
          aiConfig: {
            provider: aiConfig.provider,
            baseUrl: aiConfig.baseUrl,
            apiKey: aiConfig.apiKey,
            model: aiConfig.model,
          },
          limit: options?.limit ?? 50,
          onlyMissing: options?.onlyMissing ?? true,
        },
      });
      setBatchAiSummary(summary);
      await refreshRepositoryWorkspace();
      if (selectedRepository) {
        await loadAnnotationWorkspace(selectedRepository);
      }
      setAuthMessage(
        `AI 批量处理完成：生成 ${summary.generatedCount} 个，跳过 ${summary.skippedCount} 个，缺少 README ${summary.missingReadmeCount} 个，失败 ${summary.failedCount} 个。`,
      );
      return summary;
    } catch (reason) {
      const message = toErrorMessage(reason);
      setError(message);
      setTaskProgress(buildFailedTaskProgress('batch-generate-ai-documents', 'ai', message));
      throw reason;
    } finally {
      setIsBatchGeneratingAiDocuments(false);
    }
  }

  return {
    annotation,
    annotationMessage,
    applyRepositoryFilters,
    authMessage,
    authState,
    batchAiSummary,
    connectWithToken,
    error,
    gistIdDraft,
    handleClearToken,
    handleCreateTag,
    handleDeleteTag,
    handleExportAnnotations,
    handleFetchReadmes,
    handleFetchRepositoryReadme,
    handleBatchGenerateAiDocuments,
    handleGenerateAiDocument,
    handleApplySuggestedTag,
    handleImportAnnotations,
    handleRenameTag,
    handleSaveAnnotation,
    handleSaveToken,
    handleSyncStars,
    handleToggleRepositoryTag,
    isClearingToken,
    isExportingAnnotations,
    isFetchingReadmes,
    isFetchingRepositoryReadme,
    isBatchGeneratingAiDocuments,
    isGeneratingAiDocument,
    isImportingAnnotations,
    isLoadingAuth,
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
    repositoryAiError,
    repositoryReadmeError,
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
    taskProgress,
    token,
  };
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function buildFailedTaskProgress(taskId: string, taskType: string, message: string): TaskProgressEvent {
  return {
    taskId,
    taskType,
    status: 'failed',
    stage: 'error',
    current: 0,
    total: 0,
    message,
    repositoryName: null,
  };
}

function buildRunningTaskProgress(taskId: string, taskType: string, message: string): TaskProgressEvent {
  return {
    taskId,
    taskType,
    status: 'running',
    stage: 'request',
    current: 0,
    total: 1,
    message,
    repositoryName: null,
  };
}

function buildSucceededTaskProgress(taskId: string, taskType: string, message: string): TaskProgressEvent {
  return {
    taskId,
    taskType,
    status: 'succeeded',
    stage: 'done',
    current: 1,
    total: 1,
    message,
    repositoryName: null,
  };
}

function getSuggestedTagColor(tagName: string) {
  const palette = ['#2563eb', '#0f766e', '#9333ea', '#c2410c', '#16a34a', '#be123c', '#0891b2', '#7c3aed'];
  const index = Array.from(tagName).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
  return palette[index];
}
