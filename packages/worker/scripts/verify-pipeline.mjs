import assert from 'node:assert/strict';
import {
  buildRepositoryEmbeddingIndex,
  createWorkerRuntime,
  fetchReadmes,
  rebuildSearchIndex,
  runReadmeAiPipeline,
  summarizeReadmeBatch,
  syncStars,
} from '../dist/index.js';

const accountId = '1001';
const repository = createRepository('1001:1', 'octo/hello');
const skippedRepository = createRepository('1001:2', 'octo/skipped');
const failingRepository = createRepository('1001:3', 'octo/failing');
const missingRepository = createRepository('1001:4', 'octo/missing');
const failedReadmeRepository = createRepository('1001:5', 'octo/readme-error');

const readme = createReadme(repository.id, 'hash-readme');
const skippedReadme = createReadme(skippedRepository.id, 'hash-skipped');
const failingReadme = createReadme(failingRepository.id, 'hash-failing');

const savedAiDocuments = [];
const savedEmbeddings = [];
const vectorUpserts = [];
const storage = {
  repositories: [repository, missingRepository, failedReadmeRepository],
  async upsertRepository(repo) {
    this.repositories.push(repo);
  },
  async getRepository(repoId) {
    return this.repositories.find((repo) => repo.id === repoId) ?? null;
  },
  async listRepositories(_accountId, limit) {
    return this.repositories.slice(0, limit);
  },
  async saveReadme(document) {
    this.savedReadmes.push(document);
  },
  savedReadmes: [],
  async getAiDocument() {
    return null;
  },
  async listReadmeAiCandidates(_accountId, limit) {
    return [
      {
        repository: skippedRepository,
        readme: skippedReadme,
        aiDocument: createAiDocument(skippedRepository.id, 'hash-skipped'),
      },
      {
        repository,
        readme,
        aiDocument: null,
      },
      {
        repository: failingRepository,
        readme: failingReadme,
        aiDocument: null,
      },
    ].slice(0, limit);
  },
  async saveAiDocument(document) {
    savedAiDocuments.push(document);
  },
  async getRepositoryEmbedding() {
    return null;
  },
  async listRepositoryEmbeddingCandidates(_accountId, _model, _modelVersion, limit) {
    return [
      {
        repository: skippedRepository,
        aiDocument: createAiDocument(skippedRepository.id, 'hash-skipped'),
        embedding: {
          accountId,
          repoId: skippedRepository.id,
          sourceKind: 'repository_knowledge',
          sourceHash: 'hash-skipped',
          model: 'embedding-test',
          modelVersion: 'v1',
          dimensions: 2,
          vector: [0.1, 0.2],
          generatedAt: '2026-01-04T00:00:00Z',
        },
      },
      {
        repository,
        aiDocument: createAiDocument(repository.id, 'hash-readme'),
        embedding: null,
      },
      {
        repository: failingRepository,
        aiDocument: createAiDocument(failingRepository.id, 'hash-failing'),
        embedding: null,
      },
    ].slice(0, limit);
  },
  async saveRepositoryEmbedding(record) {
    savedEmbeddings.push(record);
  },
  async saveAnnotation() {},
  async listPendingJobs() {
    return [];
  },
};

const ai = {
  metadata: {
    id: 'test-ai',
    displayName: 'Test AI',
    model: 'summary-test',
    capabilities: ['summarize_readme', 'translate_readme', 'embed_text', 'understand_query'],
  },
  async summarizeReadme(input) {
    if (input.repository.id === failingRepository.id) {
      throw new Error('模型调用失败');
    }

    return createAiDocument(input.repository.id, input.readme.contentHash);
  },
  async translateReadme(input) {
    return {
      repoId: input.repository.id,
      readmeZh: `中文整理：${input.repository.fullName}`,
      model: 'summary-test',
      promptVersion: input.promptVersion,
      sourceHash: input.readme.contentHash,
      generatedAt: '2026-01-04T00:00:00Z',
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
  async embed(input) {
    if (input.repoId === failingRepository.id) {
      throw new Error('向量生成失败');
    }

    return {
      repoId: input.repoId,
      vector: [0.25, 0.75],
      model: 'embedding-test',
      sourceHash: input.sourceHash,
    };
  },
  async understandQuery(query) {
    return { normalizedQuery: query.trim(), inferredLanguages: [], inferredTopics: [] };
  },
};

const aiWithoutEmbedding = {
  metadata: {
    id: 'chat-only-ai',
    displayName: 'Chat Only AI',
    model: 'summary-test',
    capabilities: ['summarize_readme', 'translate_readme', 'understand_query'],
  },
  summarizeReadme: ai.summarizeReadme,
  translateReadme: ai.translateReadme,
  understandQuery: ai.understandQuery,
};

const vectorIndex = {
  async upsertRepositoryEmbedding(record) {
    vectorUpserts.push(record);
  },
  async searchRepositoryEmbeddings() {
    return [];
  },
};

const chatOnlySavedDocuments = [];
const chatOnlyPipelineResult = await runReadmeAiPipeline(
  {
    ai: aiWithoutEmbedding,
    storage: {
      async saveAiDocument(document) {
        chatOnlySavedDocuments.push(document);
      },
    },
  },
  {
    repository,
    readme,
    promptVersion: 'v1',
    includeEmbedding: false,
  },
);
assert.equal(chatOnlyPipelineResult.document.repoId, repository.id);
assert.equal(chatOnlyPipelineResult.embedding, null);
assert.equal(chatOnlySavedDocuments.length, 1);

await assert.rejects(
  () => runReadmeAiPipeline(
    {
      ai: aiWithoutEmbedding,
      storage: {
        async saveAiDocument(document) {
          chatOnlySavedDocuments.push(document);
        },
      },
    },
    {
      repository,
      readme,
      promptVersion: 'v1',
      includeEmbedding: true,
    },
  ),
  /未配置 Embedding 能力/,
);
assert.equal(chatOnlySavedDocuments.length, 1);

const pipelineResult = await runReadmeAiPipeline(
  { ai, storage, vectorIndex },
  {
    repository,
    readme,
    promptVersion: 'v1',
    includeReadmeTranslation: true,
    includeEmbedding: true,
    embeddingModelVersion: 'embedding-v1',
  },
);
assert.equal(pipelineResult.document.readmeZh, '中文整理：octo/hello');
assert.deepEqual(pipelineResult.embedding.vector, [0.25, 0.75]);
assert.equal(savedAiDocuments.length, 1);
assert.equal(savedEmbeddings.length, 1);
assert.equal(savedEmbeddings[0].accountId, accountId);
assert.equal(vectorUpserts.length, 1);
assert.equal(savedEmbeddings[0].modelVersion, 'embedding-v1');

const batchResult = await summarizeReadmeBatch(
  { ai, storage, vectorIndex },
  { accountId, promptVersion: 'v1', includeEmbedding: true, embeddingModelVersion: 'embedding-v1' },
);
assert.equal(batchResult.totalCount, 3);
assert.equal(batchResult.skippedCount, 1);
assert.equal(batchResult.generatedCount, 1);
assert.equal(batchResult.failedCount, 1);
assert.equal(batchResult.failures[0].repoId, failingRepository.id);
assert.match(batchResult.failures[0].message, /模型调用失败/);
assert.equal(savedAiDocuments.length, 2);
assert.equal(savedAiDocuments[1].repoId, repository.id);
assert.equal(savedEmbeddings.length, 2);
assert.equal(vectorUpserts.length, 2);

const github = {
  async verifyToken() {
    return { accountId, login: 'alice', avatarUrl: null };
  },
  async listStarredRepositories(_accountId, cursor) {
    if (cursor.page === 1) {
      return {
        repositories: [createRepository('1001:10', 'octo/page-one')],
        nextCursor: { page: 2, perPage: cursor.perPage },
      };
    }

    return {
      repositories: [createRepository('1001:11', 'octo/page-two')],
      nextCursor: null,
    };
  },
  async fetchReadme(_repoId, fullName) {
    if (fullName === missingRepository.fullName) {
      return null;
    }

    if (fullName === failedReadmeRepository.fullName) {
      throw new Error('README 下载失败');
    }

    return createReadme(_repoId, `hash-${fullName}`);
  },
};

const syncResult = await syncStars({ github, storage }, { tokenRef: 'token-ref', maxPages: 2 });
assert.equal(syncResult.succeeded, true);
assert.equal(syncResult.syncedCount, 2);
assert.equal(storage.repositories.some((repo) => repo.fullName === 'octo/page-two'), true);

const readmeResult = await fetchReadmes({ github, storage }, { accountId, limit: 3, concurrency: 2 });
assert.equal(readmeResult.fetchedCount, 1);
assert.equal(readmeResult.missingCount, 1);
assert.equal(readmeResult.failedCount, 1);
assert.equal(readmeResult.succeeded, false);
assert.equal(readmeResult.failures[0].repoId, failedReadmeRepository.id);
assert.match(readmeResult.failures[0].message, /README 下载失败/);
assert.equal(storage.savedReadmes.length, 1);
assert.equal(storage.savedReadmes[0].repoId, repository.id);

const embeddingIndexResult = await buildRepositoryEmbeddingIndex(
  { ai, storage, vectorIndex },
  { accountId, modelVersion: 'embedding-v1' },
);
assert.equal(embeddingIndexResult.totalCount, 3);
assert.equal(embeddingIndexResult.skippedCount, 1);
assert.equal(embeddingIndexResult.indexedCount, 1);
assert.equal(embeddingIndexResult.failedCount, 1);
assert.equal(embeddingIndexResult.failures[0].repoId, failingRepository.id);
assert.match(embeddingIndexResult.failures[0].message, /向量生成失败/);

await assert.rejects(
  () => buildRepositoryEmbeddingIndex(
    { ai: aiWithoutEmbedding, storage, vectorIndex },
    { accountId, modelVersion: 'embedding-v1' },
  ),
  /未配置 Embedding 能力/,
);

const missingSearchIndexResult = await rebuildSearchIndex({ storage }, { accountId });
assert.equal(missingSearchIndexResult.succeeded, false);
assert.match(missingSearchIndexResult.message, /未配置/);

const indexedRepoIds = [];
const searchIndexResult = await rebuildSearchIndex(
  {
    storage,
    searchIndex: {
      async rebuildRepositoryIndex(repoId) {
        if (repoId === failedReadmeRepository.id) {
          throw new Error('索引失败');
        }
        indexedRepoIds.push(repoId);
      },
    },
  },
  { accountId, limit: 3 },
);
assert.equal(searchIndexResult.totalCount, 3);
assert.equal(searchIndexResult.indexedCount, 2);
assert.equal(searchIndexResult.failedCount, 1);
assert.equal(searchIndexResult.failures[0].repoId, failedReadmeRepository.id);
assert.match(searchIndexResult.failures[0].message, /索引失败/);
assert.deepEqual(indexedRepoIds, [repository.id, missingRepository.id]);

const runtime = createWorkerRuntime({
  github,
  storage: {
    ...storage,
    async listReadmeAiCandidates() {
      return [
        {
          repository: failingRepository,
          readme: failingReadme,
          aiDocument: null,
        },
      ];
    },
  },
  ai,
  search: {
    async search() {
      return [];
    },
  },
  vectorIndex,
});
const runtimeSummary = await runtime.summarizeReadmes({ accountId, promptVersion: 'v1' });
assert.equal(runtimeSummary.succeeded, false);
assert.match(runtimeSummary.message, /失败 1 个/);

console.log('Worker pipeline verification passed.');

function createRepository(id, fullName) {
  const [owner, name] = fullName.split('/');

  return {
    id,
    accountId,
    owner,
    name,
    fullName,
    description: `Repository ${fullName}`,
    language: 'TypeScript',
    topics: ['ai', 'stars'],
    htmlUrl: `https://github.com/${fullName}`,
    starsCount: 100,
    forksCount: 10,
    starredAt: '2026-01-02T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    syncStatus: 'active',
  };
}

function createReadme(repoId, contentHash) {
  return {
    repoId,
    rawMarkdown: `# ${repoId}\n\nREADME content`,
    contentHash,
    sourcePath: 'README.md',
    fetchedAt: '2026-01-03T00:00:00Z',
  };
}

function createAiDocument(repoId, sourceHash) {
  return {
    repoId,
    summaryZh: `摘要 ${repoId}`,
    readmeZh: null,
    keywords: ['AI', 'Stars'],
    suggestedTags: ['知识库'],
    model: 'summary-test',
    promptVersion: 'v1',
    sourceHash,
    generatedAt: '2026-01-04T00:00:00Z',
  };
}
