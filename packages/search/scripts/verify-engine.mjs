import assert from 'node:assert/strict';
import { createInMemorySearchPort, createInMemoryVectorIndexPort } from '../dist/index.js';
import { createRepoQuery } from '../../domain/dist/index.js';

const records = [
  {
    repository: {
      id: '1001:1',
      accountId: '1001',
      owner: 'pmndrs',
      name: 'react-spring',
      fullName: 'pmndrs/react-spring',
      description: 'Spring-physics based animation library for React',
      language: 'TypeScript',
      topics: ['react', 'animation'],
      htmlUrl: 'https://github.com/pmndrs/react-spring',
      starsCount: 28000,
      forksCount: 1200,
      starredAt: '2026-01-03T00:00:00Z',
      pushedAt: '2026-01-02T00:00:00Z',
      syncStatus: 'active',
    },
    readme: {
      repoId: '1001:1',
      rawMarkdown: 'A library for spring animation and gesture driven interfaces.',
      contentHash: 'hash-1',
      sourcePath: 'README.md',
      fetchedAt: '2026-01-03T00:00:00Z',
    },
    aiDocument: {
      repoId: '1001:1',
      summaryZh: '适合构建 React 弹簧动画和交互动效。',
      readmeZh: null,
      keywords: ['React', '动画', '弹簧'],
      suggestedTags: ['React 动画'],
      model: 'gpt-test',
      promptVersion: 'v1',
      sourceHash: 'hash-1',
      generatedAt: '2026-01-03T00:00:00Z',
    },
    annotation: {
      repoId: '1001:1',
      accountId: '1001',
      noteMarkdown: '可用于产品动效。',
      tagIds: ['tag-animation'],
      readStatus: 'later',
      updatedAt: '2026-01-03T00:00:00Z',
    },
  },
  {
    repository: {
      id: '1001:2',
      accountId: '1001',
      owner: 'sqlite',
      name: 'sqlite',
      fullName: 'sqlite/sqlite',
      description: 'SQLite mirror',
      language: 'C',
      topics: ['database'],
      htmlUrl: 'https://github.com/sqlite/sqlite',
      starsCount: 8000,
      forksCount: 900,
      starredAt: '2026-01-01T00:00:00Z',
      pushedAt: '2026-01-01T00:00:00Z',
      syncStatus: 'active',
    },
    readme: {
      repoId: '1001:2',
      rawMarkdown: 'Embedded SQL database engine.',
      contentHash: 'hash-2',
      sourcePath: 'README.md',
      fetchedAt: '2026-01-03T00:00:00Z',
    },
    aiDocument: null,
    annotation: {
      repoId: '1001:2',
      accountId: '1001',
      noteMarkdown: '本地存储基础组件。',
      tagIds: ['tag-database'],
      readStatus: 'read',
      updatedAt: '2026-01-03T00:00:00Z',
    },
  },
  {
    repository: {
      id: '1001:3',
      accountId: '1001',
      owner: 'vercel',
      name: 'next.js',
      fullName: 'vercel/next.js',
      description: 'The React Framework for the Web',
      language: 'TypeScript',
      topics: ['react', 'framework', 'web'],
      htmlUrl: 'https://github.com/vercel/next.js',
      starsCount: 135000,
      forksCount: 28000,
      starredAt: '2026-01-02T00:00:00Z',
      pushedAt: '2026-01-04T00:00:00Z',
      syncStatus: 'active',
    },
    readme: {
      repoId: '1001:3',
      rawMarkdown: 'Production React framework with file based routing.',
      contentHash: 'hash-3',
      sourcePath: 'README.md',
      fetchedAt: '2026-01-03T00:00:00Z',
    },
    aiDocument: {
      repoId: '1001:3',
      summaryZh: '适合构建生产级 React Web 应用。',
      readmeZh: null,
      keywords: ['React', 'Web', '框架'],
      suggestedTags: ['React 框架'],
      model: 'gpt-test',
      promptVersion: 'v1',
      sourceHash: 'hash-3',
      generatedAt: '2026-01-03T00:00:00Z',
    },
    annotation: {
      repoId: '1001:3',
      accountId: '1001',
      noteMarkdown: '适合全栈 Web 项目。',
      tagIds: ['tag-web'],
      readStatus: 'unread',
      updatedAt: '2026-01-03T00:00:00Z',
    },
  },
];

const search = createInMemorySearchPort({ records });

const readmeResults = await search.search(createRepoQuery({ text: 'gesture', limit: 10 }));
assert.equal(readmeResults[0].repository.fullName, 'pmndrs/react-spring');
assert.ok(readmeResults[0].citations.some((citation) => citation.kind === 'readme'));

const partialNameResults = await search.search(createRepoQuery({ text: 'spring', limit: 10 }));
assert.equal(partialNameResults[0].repository.fullName, 'pmndrs/react-spring');
assert.ok(partialNameResults[0].reasons.some((reason) => reason.label === '仓库名称命中'));

const partialLanguageResults = await search.search(createRepoQuery({ text: 'type', limit: 10 }));
assert.deepEqual(
  partialLanguageResults.map((result) => result.repository.fullName),
  ['vercel/next.js', 'pmndrs/react-spring'],
);
assert.ok(partialLanguageResults.every((result) => result.reasons.some((reason) => reason.label === '主要语言命中')));

const aiResults = await search.search(createRepoQuery({ naturalLanguage: '弹簧动画', limit: 10 }));
assert.equal(aiResults[0].repository.fullName, 'pmndrs/react-spring');
assert.ok(aiResults[0].reasons.some((reason) => reason.label.includes('AI')));

const suggestedTagResults = await search.search(createRepoQuery({ text: 'React 动画', limit: 10 }));
assert.equal(suggestedTagResults[0].repository.fullName, 'pmndrs/react-spring');
assert.ok(suggestedTagResults[0].reasons.some((reason) => reason.label === 'AI 建议标签命中'));

const userNoteResults = await search.search(createRepoQuery({ text: '产品动效', limit: 10 }));
assert.equal(userNoteResults[0].repository.fullName, 'pmndrs/react-spring');
assert.ok(userNoteResults[0].citations.some((citation) => citation.kind === 'user_note' && citation.snippet.includes('产品动效')));

const intersectionResults = await search.search(createRepoQuery({
  text: 'React',
  languages: ['TypeScript'],
  tags: ['tag-animation'],
  limit: 10,
}));
assert.equal(intersectionResults.length, 1);
assert.equal(intersectionResults[0].repository.fullName, 'pmndrs/react-spring');

const multiResultIntersection = await search.search(createRepoQuery({
  text: 'React',
  languages: ['TypeScript'],
  limit: 10,
}));
assert.deepEqual(
  multiResultIntersection.map((result) => result.repository.fullName).sort(),
  ['pmndrs/react-spring', 'vercel/next.js'],
);

const noIntersectionResults = await search.search(createRepoQuery({
  text: 'React',
  languages: ['C'],
  tags: ['tag-animation'],
  limit: 10,
}));
assert.equal(noIntersectionResults.length, 0);

const structuredOnlyResults = await search.search(createRepoQuery({
  tags: ['tag-database'],
  readStatus: 'read',
  limit: 10,
}));
assert.equal(structuredOnlyResults.length, 1);
assert.equal(structuredOnlyResults[0].repository.fullName, 'sqlite/sqlite');

const pagedStructuredResults = await search.search(createRepoQuery({
  languages: ['TypeScript'],
  sort: 'name',
  limit: 1,
  offset: 1,
}));
assert.equal(pagedStructuredResults.length, 1);
assert.equal(pagedStructuredResults[0].repository.fullName, 'vercel/next.js');

const vectorIndex = createInMemoryVectorIndexPort({
  records: [
    createEmbeddingRecord({ accountId: '1001', repoId: '1001:1', vector: [0.9, 0.1] }),
    createEmbeddingRecord({ accountId: '1001', repoId: '1001:2', vector: [0.1, 0.9] }),
    createEmbeddingRecord({ accountId: '2002', repoId: '2002:1', vector: [1, 0] }),
    createEmbeddingRecord({
      accountId: '1001',
      repoId: '1001:3',
      vector: [1, 0],
      modelVersion: 'embedding-v2',
    }),
  ],
});

const vectorResults = await vectorIndex.searchRepositoryEmbeddings({
  accountId: '1001',
  vector: [1, 0],
  model: 'embedding-test',
  modelVersion: 'embedding-v1',
  limit: 10,
});
assert.deepEqual(vectorResults.map((result) => result.repoId), ['1001:1', '1001:2']);
assert.ok(vectorResults[0].score > vectorResults[1].score);

await vectorIndex.upsertRepositoryEmbedding(createEmbeddingRecord({
  accountId: '1001',
  repoId: '1001:2',
  vector: [1, 0],
}));
const upsertedVectorResults = await vectorIndex.searchRepositoryEmbeddings({
  accountId: '1001',
  vector: [1, 0],
  model: 'embedding-test',
  modelVersion: 'embedding-v1',
  limit: 1,
  minScore: 0.95,
});
assert.deepEqual(upsertedVectorResults.map((result) => result.repoId), ['1001:2']);

console.log('Search engine verification passed.');

function createEmbeddingRecord({
  accountId,
  repoId,
  vector,
  modelVersion = 'embedding-v1',
}) {
  return {
    accountId,
    repoId,
    sourceKind: 'repository_knowledge',
    sourceHash: `hash-${repoId}`,
    model: 'embedding-test',
    modelVersion,
    dimensions: vector.length,
    vector,
    generatedAt: '2026-01-04T00:00:00Z',
  };
}
