import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const migrationPath = join(root, 'migrations', '001_initial_schema.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');
const tempDir = mkdtempSync(join(tmpdir(), 'gsat-storage-'));
const databasePath = join(tempDir, 'verify.sqlite');

const runSql = (sql) => {
  execFileSync('sqlite3', [databasePath], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
};

try {
  runSql(migrationSql);
  runSql(migrationSql);

  const tables = execFileSync(
    'sqlite3',
    [databasePath, "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name;"],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  const expectedTables = [
    'annotations',
    'github_accounts',
    'github_recommendation_candidates',
    'jobs',
    'repo_ai_documents',
    'repo_embeddings',
    'repo_readmes',
    'repo_tags',
    'repositories',
    'schema_migrations',
    'tags',
  ];

  const missingTables = expectedTables.filter((table) => !tables.includes(table));
  if (missingTables.length > 0) {
    throw new Error(`schema 初始化后缺少数据表：${missingTables.join(', ')}`);
  }

  const migrationCount = execFileSync(
    'sqlite3',
    [databasePath, "SELECT COUNT(*) FROM schema_migrations WHERE version = '001';"],
    { encoding: 'utf8' },
  ).trim();

  if (migrationCount !== '1') {
    throw new Error(`schema 版本记录不符合预期，version=001 数量为 ${migrationCount}`);
  }

  const indexes = execFileSync(
    'sqlite3',
    [databasePath, "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name;"],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  const expectedIndexes = [
    'idx_github_accounts_connection_status_updated',
    'idx_annotations_account',
    'idx_annotations_account_repo',
    'idx_annotations_read_status',
    'idx_jobs_account_status',
    'idx_jobs_type_status',
    'idx_recommendation_candidates_account_full_name',
    'idx_recommendation_candidates_account_status',
    'idx_repo_ai_documents_source_hash',
    'idx_repo_embeddings_model',
    'idx_repo_embeddings_source_hash',
    'idx_repo_readmes_content_hash',
    'idx_repo_tags_tag_repo',
    'idx_repositories_account',
    'idx_repositories_account_language_status',
    'idx_repositories_account_status_starred',
    'idx_repositories_language',
    'idx_repositories_starred_at',
    'idx_repositories_sync_status',
    'idx_tags_account',
  ];

  const missingIndexes = expectedIndexes.filter((index) => !indexes.includes(index));
  if (missingIndexes.length > 0) {
    throw new Error(`schema 初始化后缺少关键索引：${missingIndexes.join(', ')}`);
  }

  const aiDocumentColumns = execFileSync('sqlite3', [databasePath, 'PRAGMA table_info(repo_ai_documents);'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map((row) => row.split('|')[1])
    .filter(Boolean);
  for (const column of ['input_tokens', 'output_tokens']) {
    if (!aiDocumentColumns.includes(column)) {
      throw new Error(`repo_ai_documents 缺少 AI 用量字段：${column}`);
    }
  }

  runSql(`
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, avatar_url, token_ref, connection_status, updated_at)
VALUES ('1001', 'alice', 'https://example.com/avatar.png', 'secure-ref', 'connected', '2026-07-06T00:00:00Z');

INSERT INTO repositories (
  id,
  account_id,
  owner,
  name,
  full_name,
  description,
  language,
  topics_json,
  html_url,
  stars_count,
  forks_count,
  starred_at,
  pushed_at
) VALUES (
  '1001:42',
  '1001',
  'octo',
  'hello',
  'octo/hello',
  'Demo repository',
  'TypeScript',
  '["ai","stars"]',
  'https://github.com/octo/hello',
  1200,
  34,
  '2026-07-05T12:00:00Z',
  '2026-07-04T00:00:00Z'
);

INSERT INTO repo_readmes (repo_id, raw_markdown, content_hash, source_path, fetched_at)
VALUES ('1001:42', '# Hello

README body', 'readme-hash', 'README.md', '2026-07-06T00:00:00Z');

INSERT INTO repo_ai_documents (
  repo_id,
  summary_zh,
  readme_zh,
  keywords_json,
  suggested_tags_json,
  model,
  prompt_version,
  source_hash,
  input_tokens,
  output_tokens,
  generated_at
) VALUES (
  '1001:42',
  '这是中文摘要',
  '这是 README 中文整理',
  '["关键词","工具"]',
  '["AI 工具","开发效率"]',
  'gpt-test',
  'v1',
  'readme-hash',
  321,
  45,
  '2026-07-06T00:00:00Z'
);

INSERT INTO tags (id, account_id, name, color)
VALUES ('tag-ai', '1001', 'AI 工具', '#4f46e5');

INSERT INTO repo_tags (repo_id, tag_id)
VALUES ('1001:42', 'tag-ai');

INSERT INTO annotations (repo_id, account_id, note_md, rating, read_status, updated_at)
VALUES ('1001:42', '1001', '值得继续阅读', 5, 'later', '2026-07-06T00:00:00Z');
`);

  const persistedDetail = execFileSync(
    'sqlite3',
    [
      databasePath,
      `
SELECT
  ga.login || '|' ||
  r.full_name || '|' ||
  r.language || '|' ||
  r.stars_count || '|' ||
  rr.content_hash || '|' ||
  ai.summary_zh || '|' ||
  ai.readme_zh || '|' ||
  ai.input_tokens || '|' ||
  ai.output_tokens || '|' ||
  t.name || '|' ||
  a.read_status || '|' ||
  a.note_md
FROM repositories r
JOIN github_accounts ga ON ga.id = r.account_id
JOIN repo_readmes rr ON rr.repo_id = r.id
JOIN repo_ai_documents ai ON ai.repo_id = r.id
JOIN repo_tags rt ON rt.repo_id = r.id
JOIN tags t ON t.id = rt.tag_id
JOIN annotations a ON a.repo_id = r.id
WHERE r.id = '1001:42';
`,
    ],
    { encoding: 'utf8' },
  ).trim();

  const expectedDetail = [
    'alice',
    'octo/hello',
    'TypeScript',
    '1200',
    'readme-hash',
    '这是中文摘要',
    '这是 README 中文整理',
    '321',
    '45',
    'AI 工具',
    'later',
    '值得继续阅读',
  ].join('|');

  if (persistedDetail !== expectedDetail) {
    throw new Error(`重开 SQLite 后读取到的数据不符合预期：${persistedDetail}`);
  }

  const cascadeCount = execFileSync(
    'sqlite3',
    [
      databasePath,
      `
PRAGMA foreign_keys = ON;
DELETE FROM github_accounts WHERE id = '1001';
SELECT
  (SELECT COUNT(*) FROM repositories WHERE account_id = '1001') || ',' ||
  (SELECT COUNT(*) FROM repo_readmes WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM repo_ai_documents WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM annotations WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM tags WHERE account_id = '1001');
`,
    ],
    { encoding: 'utf8' },
  ).trim();

  if (cascadeCount !== '0,0,0,0,0') {
    throw new Error(`账号删除后级联清理不符合预期：${cascadeCount}`);
  }

  console.log('SQLite schema initialization verification passed.');
  console.log('SQLite persistence verification passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
