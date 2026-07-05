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
    throw new Error(`迁移后缺少数据表：${missingTables.join(', ')}`);
  }

  const migrationCount = execFileSync(
    'sqlite3',
    [databasePath, "SELECT COUNT(*) FROM schema_migrations WHERE version = '001';"],
    { encoding: 'utf8' },
  ).trim();

  if (migrationCount !== '1') {
    throw new Error(`迁移记录不符合预期，version=001 数量为 ${migrationCount}`);
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
    'idx_annotations_account',
    'idx_annotations_account_repo',
    'idx_jobs_account_status',
    'idx_repo_embeddings_model',
    'idx_repo_embeddings_source_hash',
    'idx_repo_tags_tag_repo',
    'idx_repositories_account',
    'idx_repositories_account_language_status',
    'idx_repositories_account_status_starred',
    'idx_tags_account',
  ];

  const missingIndexes = expectedIndexes.filter((index) => !indexes.includes(index));
  if (missingIndexes.length > 0) {
    throw new Error(`迁移后缺少关键索引：${missingIndexes.join(', ')}`);
  }

  console.log('SQLite migration verification passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
