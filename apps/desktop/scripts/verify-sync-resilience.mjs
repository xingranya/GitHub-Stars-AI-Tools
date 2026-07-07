import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = new URL('..', import.meta.url).pathname;
const libSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const storageSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'storage.rs'), 'utf8');
const workspaceHook = readFileSync(join(projectRoot, 'src', 'hooks', 'use-stars-workspace.ts'), 'utf8');
const syncPanel = readFileSync(join(projectRoot, 'src', 'features', 'sidebar', 'sync-panel.tsx'), 'utf8');
const settingsPage = readFileSync(join(projectRoot, 'src', 'pages', 'settings.tsx'), 'utf8');

function getFunctionSource(source, functionName) {
  const start = source.indexOf(`async function ${functionName}`);
  assert.notEqual(start, -1, `必须存在 ${functionName}`);
  const nextFunction = source.indexOf('\n  async function ', start + 1);
  const returnObject = source.indexOf('\n  return {', start + 1);
  const endCandidates = [nextFunction, returnObject].filter((index) => index !== -1);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : source.length;
  return source.slice(start, end);
}

function assertHandlesGitHubCredentialFailure(functionName) {
  const source = getFunctionSource(workspaceHook, functionName);
  assert.match(
    source,
    /catch \(reason\) \{[\s\S]*?const message = toErrorMessage\(reason\);[\s\S]*?handleGitHubCredentialFailure\(message\)/,
    `${functionName} 失败时必须识别 GitHub Token 失效并断开前端账号状态`,
  );
}

assert.match(
  libSource,
  /loop \{[\s\S]*?github::fetch_starred_repositories_page[\s\S]*?storage\.upsert_repositories\(&page_items\)\?/,
  'Stars 同步必须分页拉取后立即写入 SQLite，弱网中断时保留已拉取数据',
);
assert.match(
  libSource,
  /storage\.upsert_repositories\(&page_items\)\?;[\s\S]*?repositories\.extend\(page_items\)/,
  '分页数据必须先持久化再进入汇总统计',
);
assert.match(
  libSource,
  /let removed_ids =[\s\S]*?compute_removed_repository_ids\(completed_full_scan,[\s\S]*?if completed_full_scan \{[\s\S]*?storage\.mark_repositories_removed/,
  '只有完整全量扫描结束后才能标记取消 Star 的仓库',
);
assert.match(
  libSource,
  /fn removed_repositories_are_computed_only_after_full_scan/,
  'removed 仓库清理必须有单元测试防止弱网中断误删',
);
assert.match(
  libSource,
  /fn first_sync_does_not_stop_incrementally_without_existing_active_repositories/,
  '首次同步不得错误触发增量提前停止',
);
assert.match(
  libSource,
  /fn incremental_sync_continues_when_page_contains_new_or_removed_repository/,
  '增量同步遇到新增或 removed 仓库时必须继续扫描',
);
assert.match(
  libSource,
  /run_background_task_with_failure_progress\([\s\S]*?"sync-stars"[\s\S]*?"sync"/,
  'Stars 同步失败必须发出 failed 任务进度',
);
assert.match(
  libSource,
  /fn verify_github_token_for_required_action[\s\S]*?auth::can_restore_cached_user_after_auth_error[\s\S]*?auth::clear_github_token\(\)[\s\S]*?storage\.mark_github_accounts_disconnected\(\)/,
  '同步时 GitHub Token 确认失效后必须清理系统凭据并标记账号断开',
);
assert.match(
  libSource,
  /let storage = AppStorage::from_app_handle\(&app_handle\)\?;[\s\S]*?auth::require_github_token\(\)[\s\S]*?storage\.mark_github_accounts_disconnected\(\)\?;[\s\S]*?return Err\(error\)/,
  '同步时本机 Token 缺失必须同步标记账号断开，避免前端继续展示已连接态',
);
assert.match(
  storageSource,
  /ON CONFLICT\(id\) DO UPDATE SET[\s\S]*?full_name = excluded\.full_name/,
  '仓库同步遇到 GitHub rename 时必须更新 full_name，避免 README、详情和备份恢复继续使用旧仓库名',
);
assert.match(
  storageSource,
  /pub fn list_active_repositories[\s\S]*?\.mode json[\s\S]*?parse_json_rows::<StoredRepository>/,
  '批量 README 和批量 AI 使用的活跃仓库列表必须走当前 SQLite 执行器支持的 JSON 模式',
);
assert.doesNotMatch(
  storageSource,
  /pub fn list_active_repositories[\s\S]*?\.mode tabs/,
  '活跃仓库列表不能使用未支持的 .mode tabs，否则批量 README 和批量 AI 会直接失败',
);
assert.match(
  storageSource,
  /fn list_active_repositories_uses_supported_mode_and_tracks_renamed_full_name/,
  '活跃仓库列表和仓库 rename 更新必须有 Rust 单元测试覆盖',
);
assert.match(
  storageSource,
  /fn reset_incompatible_database[\s\S]*?remove_sqlite_database_files\(&self\.database_path\)/,
  '本机测试期旧 SQLite 不做迁移，发现不兼容结构时必须直接清理旧库文件',
);
assert.match(
  storageSource,
  /fn initialization_resets_incompatible_local_test_database[\s\S]*?旧测试数据[\s\S]*?assert_eq!\(legacy_row_count\.trim\(\), "0"\)/,
  '不兼容旧测试库自动清理必须有单元测试确认旧数据不保留',
);

assert.match(
  workspaceHook,
  /const displayMessage = `同步未完成：\$\{message\}。本地已有数据不会被删除，可检查网络或 Token 后重试。`/,
  '同步中断必须清晰提示本地已有数据不会被删除',
);
assert.match(
  workspaceHook,
  /同步完成：当前 \$\{summary\.activeCount\} 个，新增 \$\{summary\.createdCount\} 个，更新 \$\{summary\.updatedCount\} 个，移除 \$\{summary\.removedCount\} 个，扫描 \$\{summary\.scannedCount\} 个/,
  '同步完成提示必须展示新增、更新、移除和扫描数量',
);
assert.match(
  syncPanel,
  /Stars 同步：[\s\S]*?新增 \{props\.syncSummary\.createdCount\}[\s\S]*?更新 \{props\.syncSummary\.updatedCount\}[\s\S]*?移除 \{props\.syncSummary\.removedCount\}[\s\S]*?扫描 \{props\.syncSummary\.scannedCount\}/,
  '侧栏同步摘要必须展示新增、更新、移除和扫描数量',
);
assert.match(
  settingsPage,
  /同步完成：活跃 \{workspace\.syncSummary\.activeCount\} 个，新增[\s\S]*?\{workspace\.syncSummary\.createdCount\} 个，更新 \{workspace\.syncSummary\.updatedCount\} 个，移除[\s\S]*?\{workspace\.syncSummary\.removedCount\} 个，扫描 \{workspace\.syncSummary\.scannedCount\} 个/,
  '设置页同步状态必须展示新增、更新、移除和扫描数量',
);
assert.match(
  workspaceHook,
  /catch \(reason\)[\s\S]*?setError\(displayMessage\)[\s\S]*?await refreshRepositoryWorkspace\(\)/,
  '同步失败后必须刷新本地仓库数据，显示已保留内容',
);
assert.match(
  workspaceHook,
  /setTaskProgress\(buildFailedTaskProgress\('sync-stars', 'sync', displayMessage\)\)/,
  '同步失败后前端必须更新失败任务状态',
);
assert.match(
  workspaceHook,
  /function isGitHubConnectionUnavailableError[\s\S]*?Token 无效或权限不足[\s\S]*?HTTP 401/,
  '前端必须识别 GitHub Token 缺失或失效错误',
);
assert.match(
  workspaceHook,
  /if \(isGitHubConnectionUnavailableError\(message\)\) \{[\s\S]*?resetWorkspaceAfterGitHubDisconnect\(\);[\s\S]*?GitHub Token 已失效/,
  '同步发现 Token 失效后前端必须回到未连接状态并提示重新连接',
);
assert.match(
  workspaceHook,
  /function resetWorkspaceAfterGitHubDisconnect\(\)[\s\S]*?setAuthState\(initialAuthState\)[\s\S]*?setRepositoryPage\(emptyRepositoryPage\)[\s\S]*?setRepositoryFilters\(emptyRepositoryFilters\)/,
  'GitHub 断开后必须清空当前工作区展示，避免旧数据被误认为仍可操作',
);
assert.match(
  workspaceHook,
  /function handleGitHubCredentialFailure\(message: string\)[\s\S]*?isGitHubConnectionUnavailableError\(message\)[\s\S]*?resetWorkspaceAfterGitHubDisconnect\(\)[\s\S]*?GitHub Token 已失效，已断开连接/,
  '非同步 GitHub 操作也必须共用 Token 失效断开逻辑',
);

for (const functionName of [
  'handleFetchReadmes',
  'handleExportAnnotations',
  'runImportAnnotations',
  'handleFetchRepositoryReadme',
  'handleGenerateAiDocument',
  'handleBatchGenerateAiDocuments',
  'handleGenerateAiTagNetwork',
  'handleFindSimilarRepositories',
  'handleStarRecommendationCandidate',
]) {
  assertHandlesGitHubCredentialFailure(functionName);
}

console.log('Sync resilience verification passed.');
