import type { AiProvider, EmbeddingResult } from '@gsat/ai';
import type { AiRepositoryDocument, GitHubAccountId, ISODateString, ReadmeDocument, RepositoryEmbeddingRecord, RepositoryFacts } from '@gsat/domain';
import type { GitHubProvider, StarSyncCursor } from '@gsat/github';
import type { IndexPort, SearchPort, VectorIndexPort } from '@gsat/search';
import type { StoragePort } from '@gsat/storage';

export type WorkerDependencies = {
  github: GitHubProvider;
  storage: StoragePort;
  ai: AiProvider;
  search: SearchPort;
  searchIndex?: IndexPort;
  vectorIndex?: VectorIndexPort;
};

export type WorkerResult = {
  succeeded: boolean;
  message: string;
};

export type SyncStarsInput = {
  tokenRef: string;
  cursor?: {
    page?: number;
    perPage?: number;
    since?: string;
  };
  maxPages?: number;
};

export type SyncStarsResult = WorkerResult & {
  accountId: GitHubAccountId;
  syncedCount: number;
};

export type FetchReadmesInput = {
  accountId: GitHubAccountId;
  limit?: number;
  concurrency?: number;
};

export type FetchReadmesResult = WorkerResult & {
  totalCount: number;
  fetchedCount: number;
  missingCount: number;
  failedCount: number;
  failures: Array<{
    repoId: string;
    message: string;
  }>;
};

export type RebuildSearchIndexInput = {
  accountId: GitHubAccountId;
  limit?: number;
};

export type RebuildSearchIndexResult = WorkerResult & {
  totalCount: number;
  indexedCount: number;
  failedCount: number;
  failures: Array<{
    repoId: string;
    message: string;
  }>;
};

export type ReadmeAiPipelineInput = {
  repository: RepositoryFacts;
  readme: ReadmeDocument;
  promptVersion: string;
  includeReadmeTranslation?: boolean;
  includeEmbedding?: boolean;
  embeddingModelVersion?: string;
};

export type ReadmeAiPipelineResult = {
  document: AiRepositoryDocument;
  embedding: EmbeddingResult | null;
};

export type SummarizeReadmesInput = {
  accountId: GitHubAccountId;
  promptVersion: string;
  limit?: number;
  includeEmbedding?: boolean;
  embeddingModelVersion?: string;
};

export type SummarizeReadmesResult = {
  totalCount: number;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: Array<{
    repoId: string;
    message: string;
  }>;
};

export type BuildRepositoryEmbeddingIndexInput = {
  accountId: GitHubAccountId;
  modelVersion: string;
  limit?: number;
};

export type BuildRepositoryEmbeddingIndexResult = {
  totalCount: number;
  indexedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: Array<{
    repoId: string;
    message: string;
  }>;
};

export type WorkerRuntime = {
  syncStars(input: SyncStarsInput): Promise<SyncStarsResult>;
  fetchReadmes(input: FetchReadmesInput): Promise<FetchReadmesResult>;
  summarizeReadmes(input: SummarizeReadmesInput): Promise<WorkerResult>;
  summarizeReadmeBatch(input: SummarizeReadmesInput): Promise<SummarizeReadmesResult>;
  buildRepositoryEmbeddingIndex(input: BuildRepositoryEmbeddingIndexInput): Promise<BuildRepositoryEmbeddingIndexResult>;
  rebuildSearchIndex(input: RebuildSearchIndexInput): Promise<RebuildSearchIndexResult>;
  runReadmeAiPipeline(input: ReadmeAiPipelineInput): Promise<ReadmeAiPipelineResult>;
};

/**
 * 将 README 的摘要、翻译、向量化编排在 worker 层，业务侧只依赖 Provider 合同。
 */
export async function runReadmeAiPipeline(
  dependencies: Pick<WorkerDependencies, 'ai' | 'storage' | 'vectorIndex'>,
  input: ReadmeAiPipelineInput,
): Promise<ReadmeAiPipelineResult> {
  const embed = input.includeEmbedding ? requireEmbeddingProvider(dependencies.ai) : null;
  const summarizedDocument = await dependencies.ai.summarizeReadme({
    repository: input.repository,
    readme: input.readme,
    promptVersion: input.promptVersion,
  });
  const translatedReadme = input.includeReadmeTranslation
    ? await dependencies.ai.translateReadme({
        repository: input.repository,
        readme: input.readme,
        promptVersion: input.promptVersion,
      })
    : null;
  const document: AiRepositoryDocument = {
    ...summarizedDocument,
    readmeZh: translatedReadme?.readmeZh ?? summarizedDocument.readmeZh,
    sourceHash: input.readme.contentHash,
  };
  const embedding = embed
    ? await embed({
        repoId: input.repository.id,
        text: buildReadmeEmbeddingText(input.repository, input.readme, document),
        sourceHash: input.readme.contentHash,
      })
    : null;

  await dependencies.storage.saveAiDocument(document);

  if (embedding) {
    const embeddingRecord = createRepositoryEmbeddingRecord({
      repository: input.repository,
      embedding,
      modelVersion: input.embeddingModelVersion ?? dependencies.ai.metadata.model,
      generatedAt: currentIsoTimestamp(),
    });
    await dependencies.storage.saveRepositoryEmbedding(embeddingRecord);
    await dependencies.vectorIndex?.upsertRepositoryEmbedding(embeddingRecord);
  }

  return { document, embedding };
}

/**
 * 批量生成 README 中文摘要；README hash 未变化时直接跳过，避免重复消耗模型调用。
 */
export async function summarizeReadmeBatch(
  dependencies: Pick<WorkerDependencies, 'ai' | 'storage' | 'vectorIndex'>,
  input: SummarizeReadmesInput,
): Promise<SummarizeReadmesResult> {
  const candidates = await dependencies.storage.listReadmeAiCandidates(input.accountId, input.limit ?? 50);
  const result: SummarizeReadmesResult = {
    totalCount: candidates.length,
    generatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  };

  for (const candidate of candidates) {
    if (candidate.aiDocument?.sourceHash === candidate.readme.contentHash) {
      result.skippedCount += 1;
      continue;
    }

    try {
      await runReadmeAiPipeline(dependencies, {
        repository: candidate.repository,
        readme: candidate.readme,
        promptVersion: input.promptVersion,
        includeEmbedding: input.includeEmbedding,
        embeddingModelVersion: input.embeddingModelVersion,
      });
      result.generatedCount += 1;
    } catch (error) {
      result.failedCount += 1;
      result.failures.push({
        repoId: candidate.repository.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function buildRepositoryEmbeddingIndex(
  dependencies: Pick<WorkerDependencies, 'ai' | 'storage' | 'vectorIndex'>,
  input: BuildRepositoryEmbeddingIndexInput,
): Promise<BuildRepositoryEmbeddingIndexResult> {
  const embed = requireEmbeddingProvider(dependencies.ai);
  const candidates = await dependencies.storage.listRepositoryEmbeddingCandidates(
    input.accountId,
    dependencies.ai.metadata.model,
    input.modelVersion,
    input.limit ?? 50,
  );
  const result: BuildRepositoryEmbeddingIndexResult = {
    totalCount: candidates.length,
    indexedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  };

  for (const candidate of candidates) {
    const unchangedEmbedding = candidate.embedding?.sourceHash === candidate.aiDocument.sourceHash;

    if (unchangedEmbedding) {
      result.skippedCount += 1;
      continue;
    }

    try {
      const embedding = await embed({
        repoId: candidate.repository.id,
        text: buildRepositoryKnowledgeText(candidate.repository, candidate.aiDocument),
        sourceHash: candidate.aiDocument.sourceHash,
      });
      const embeddingRecord = createRepositoryEmbeddingRecord({
        repository: candidate.repository,
        embedding,
        modelVersion: input.modelVersion,
        generatedAt: currentIsoTimestamp(),
      });

      await dependencies.storage.saveRepositoryEmbedding(embeddingRecord);
      await dependencies.vectorIndex?.upsertRepositoryEmbedding(embeddingRecord);
      result.indexedCount += 1;
    } catch (error) {
      result.failedCount += 1;
      result.failures.push({
        repoId: candidate.repository.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function syncStars(
  dependencies: Pick<WorkerDependencies, 'github' | 'storage'>,
  input: SyncStarsInput,
): Promise<SyncStarsResult> {
  const profile = await dependencies.github.verifyToken(input.tokenRef);
  let cursor: StarSyncCursor = {
    page: input.cursor?.page ?? 1,
    perPage: input.cursor?.perPage ?? 100,
    since: input.cursor?.since,
  };
  const maxPages = Math.max(1, input.maxPages ?? Number.MAX_SAFE_INTEGER);
  let syncedCount = 0;

  for (let pageCount = 0; pageCount < maxPages; pageCount += 1) {
    const page = await dependencies.github.listStarredRepositories(profile.accountId, cursor);

    for (const repository of page.repositories) {
      await dependencies.storage.upsertRepository(repository);
      syncedCount += 1;
    }

    if (!page.nextCursor) {
      break;
    }

    cursor = page.nextCursor;
  }

  return {
    succeeded: true,
    accountId: profile.accountId,
    syncedCount,
    message: `已同步 ${syncedCount} 个 Stars。`,
  };
}

export async function fetchReadmes(
  dependencies: Pick<WorkerDependencies, 'github' | 'storage'>,
  input: FetchReadmesInput,
): Promise<FetchReadmesResult> {
  const repositories = await dependencies.storage.listRepositories(input.accountId, input.limit ?? 100);
  const result: FetchReadmesResult = {
    succeeded: true,
    message: '',
    totalCount: repositories.length,
    fetchedCount: 0,
    missingCount: 0,
    failedCount: 0,
    failures: [],
  };

  await mapWithConcurrency(repositories, input.concurrency ?? 6, async (repository) => {
    try {
      const readme = await dependencies.github.fetchReadme(repository.id, repository.fullName);

      if (!readme) {
        result.missingCount += 1;
        return;
      }

      await dependencies.storage.saveReadme(readme);
      result.fetchedCount += 1;
    } catch (error) {
      result.failedCount += 1;
      result.failures.push({
        repoId: repository.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  result.succeeded = result.failedCount === 0;
  result.message = `README 处理完成：更新 ${result.fetchedCount} 个，缺失 ${result.missingCount} 个，失败 ${result.failedCount} 个。`;

  return result;
}

export async function rebuildSearchIndex(
  dependencies: Pick<WorkerDependencies, 'storage' | 'searchIndex'>,
  input: RebuildSearchIndexInput,
): Promise<RebuildSearchIndexResult> {
  if (!dependencies.searchIndex) {
    return {
      succeeded: false,
      message: '检索索引服务未配置，无法重建索引。',
      totalCount: 0,
      indexedCount: 0,
      failedCount: 0,
      failures: [],
    };
  }

  const repositories = await dependencies.storage.listRepositories(input.accountId, input.limit ?? 500);
  const result: RebuildSearchIndexResult = {
    succeeded: true,
    message: '',
    totalCount: repositories.length,
    indexedCount: 0,
    failedCount: 0,
    failures: [],
  };

  for (const repository of repositories) {
    try {
      await dependencies.searchIndex.rebuildRepositoryIndex(repository.id);
      result.indexedCount += 1;
    } catch (error) {
      result.failedCount += 1;
      result.failures.push({
        repoId: repository.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  result.succeeded = result.failedCount === 0;
  result.message = `检索索引处理完成：重建 ${result.indexedCount} 个，失败 ${result.failedCount} 个。`;

  return result;
}

export function createWorkerRuntime(dependencies: WorkerDependencies): WorkerRuntime {
  return {
    async syncStars(input) {
      return syncStars(dependencies, input);
    },
    async fetchReadmes(input) {
      return fetchReadmes(dependencies, input);
    },
    async summarizeReadmes(input) {
      const result = await summarizeReadmeBatch(dependencies, input);
      return {
        succeeded: result.failedCount === 0,
        message: `中文摘要处理完成：生成 ${result.generatedCount} 个，跳过 ${result.skippedCount} 个，失败 ${result.failedCount} 个。`,
      };
    },
    async summarizeReadmeBatch(input) {
      return summarizeReadmeBatch(dependencies, input);
    },
    async buildRepositoryEmbeddingIndex(input) {
      return buildRepositoryEmbeddingIndex(dependencies, input);
    },
    async rebuildSearchIndex(input) {
      return rebuildSearchIndex(dependencies, input);
    },
    async runReadmeAiPipeline(input) {
      return runReadmeAiPipeline(dependencies, input);
    },
  };
}

function createRepositoryEmbeddingRecord(input: {
  repository: RepositoryFacts;
  embedding: EmbeddingResult;
  modelVersion: string;
  generatedAt: ISODateString;
}): RepositoryEmbeddingRecord {
  return {
    accountId: input.repository.accountId,
    repoId: input.embedding.repoId,
    sourceKind: 'repository_knowledge',
    sourceHash: input.embedding.sourceHash,
    model: input.embedding.model,
    modelVersion: input.modelVersion,
    dimensions: input.embedding.vector.length,
    vector: input.embedding.vector,
    generatedAt: input.generatedAt,
  };
}

function requireEmbeddingProvider(ai: AiProvider) {
  if (!ai.embed) {
    throw new Error('当前 AI 服务未配置 Embedding 能力。普通知识库 AI 不需要向量模型；如需向量索引，请在高级设置中配置 OpenAI 兼容 Embedding 模型。');
  }

  return ai.embed;
}

function buildReadmeEmbeddingText(
  repository: RepositoryFacts,
  readme: ReadmeDocument,
  document: AiRepositoryDocument,
) {
  return [
    ...repositoryKnowledgeParts(repository, document),
    readme.rawMarkdown,
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n\n');
}

function buildRepositoryKnowledgeText(repository: RepositoryFacts, document: AiRepositoryDocument) {
  return repositoryKnowledgeParts(repository, document)
    .filter((item): item is string => Boolean(item))
    .join('\n\n');
}

function repositoryKnowledgeParts(repository: RepositoryFacts, document: AiRepositoryDocument) {
  return [
    repository.fullName,
    repository.description,
    repository.language,
    repository.topics.join(' '),
    document.summaryZh,
    document.readmeZh,
    document.keywords.join(' '),
    document.suggestedTags.join(' '),
  ];
}

function currentIsoTimestamp(): ISODateString {
  return new Date().toISOString();
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  const workerCount = Math.min(Math.max(Math.trunc(concurrency), 1), Math.max(items.length, 1));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await task(item);
      }
    }),
  );
}
