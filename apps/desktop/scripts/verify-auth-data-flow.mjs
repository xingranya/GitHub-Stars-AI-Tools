import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = new URL('..', import.meta.url).pathname;
const authSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'auth.rs'), 'utf8');
const storageSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'storage.rs'), 'utf8');
const libSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const mainSource = readFileSync(join(projectRoot, 'src', 'main.tsx'), 'utf8');
const workspaceHook = readFileSync(join(projectRoot, 'src', 'hooks', 'use-stars-workspace.ts'), 'utf8');
const welcomeFlow = readFileSync(join(projectRoot, 'src', 'components', 'welcome-flow.tsx'), 'utf8');
const migrationSource = readFileSync(join(projectRoot, '..', '..', 'packages', 'storage', 'migrations', '001_initial_schema.sql'), 'utf8');

assert.match(authSource, /Some\(401\) => "Token 无效或权限不足/, '401 必须提示 Token 无效或权限不足');
assert.match(authSource, /Some\(403\)[\s\S]*?Token 无效或权限不足/, '403 必须提示 Token 无效或权限不足');
assert.match(authSource, /同步私有 Stars 需要仓库读取权限，Gist 备份需要 gist 权限/, '403 权限错误必须提示私有 Stars 和 Gist 所需权限');
assert.match(authSource, /fn format_github_http_error_reports_gist_scope_hint/, 'Gist 权限缺失提示必须有后端测试');
assert.match(authSource, /fn format_github_http_error_reads_errors_array/, 'GitHub errors 数组解析必须有后端测试');
assert.match(authSource, /fn invalid_token_error_cannot_restore_cached_user/, '无效 Token 必须有禁止恢复缓存账号的测试');
assert.match(
  authSource,
  /!\(error\.contains\("Token 无效或权限不足"\) \|\| error\.contains\("HTTP 401"\)\)/,
  '无效 Token 或 401 不应恢复缓存账号',
);
assert.match(welcomeFlow, /setErrorMessage\(toErrorMessage\(error\)\)/, '初始化页必须显示后端 Token 错误');
assert.match(workspaceHook, /catch \(reason\)[\s\S]*?setError\(toErrorMessage\(reason\)\)/, '保存 Token 失败必须进入全局错误状态');

assert.match(storageSource, /data_dir\.join\("gsat\.sqlite3"\)/, '新数据库文件名必须是 gsat.sqlite3');
assert.match(storageSource, /LEGACY_SQLITE_DATABASE_FILE_NAMES:[\s\S]*?"stars-ai-tools\.sqlite3"/, '旧命名测试库只能作为清理目标保留');
assert.match(storageSource, /remove_legacy_sqlite_database_files\(&data_dir\)/, '启动初始化时必须清理旧命名测试库文件');
assert.match(storageSource, /fn startup_removes_legacy_local_test_database_without_migrating/, '旧命名测试库必须有只删除不迁移的单元测试');
assert.doesNotMatch(storageSource, /std::fs::copy|fs::copy/, '当前版本不应复制或迁移本机测试期旧数据库');
assert.doesNotMatch(storageSource, /legacy_database_path[\s\S]*?(?:std::fs::copy|fs::copy)/, '当前版本不做旧测试库自动迁移');
assert.doesNotMatch(
  storageSource,
  /migrate_github_account_connection_status|migrate_ai_usage_columns|migrate_repository_ids_to_account_scope|repository_id_migration/,
  '当前版本不应保留预发布测试库的旧 schema 兼容迁移',
);
assert.match(storageSource, /pub fn get_recent_github_account/, '必须支持从 SQLite 读取最近 GitHub 账号');
assert.match(storageSource, /fn recent_github_account_restores_cached_user/, '最近账号恢复必须有后端测试');
assert.match(migrationSource, /connection_status TEXT NOT NULL DEFAULT 'connected'/, 'GitHub 账号缓存必须记录连接状态，避免清除 Token 后误恢复');
assert.match(storageSource, /fn migrate\(&self\) -> Result<\(\), String> \{[\s\S]*?self\.execute_sql\(INITIAL_SCHEMA_SQL\)/, '初始化当前数据库时必须执行最新完整 schema');
assert.match(storageSource, /pub fn mark_github_accounts_disconnected/, '清除 Token 时必须能把本地账号标记为已断开');
assert.match(storageSource, /WHERE connection_status = 'connected'[\s\S]*?ORDER BY updated_at DESC/, '启动恢复只能读取 connected 账号');
assert.match(storageSource, /fn disconnected_github_account_is_not_restored_as_connected_user/, '已断开账号不能恢复为已连接状态，必须有后端测试');
assert.match(storageSource, /fn repository_detail_reads_persisted_readme_and_ai_document/, '重启后详情必须能读回 README 和 AI 文档');
assert.match(
  libSource,
  /async fn get_github_auth_state\([\s\S]*?tokio::time::timeout\([\s\S]*?Duration::from_secs\(GITHUB_AUTH_STATE_TOTAL_TIMEOUT_SECONDS\)[\s\S]*?auth_state_task[\s\S]*?\)[\s\S]*?\.await/,
  '启动认证状态必须异步检查并设置整体超时，避免系统凭据或 GitHub 网络卡住启动页',
);
assert.match(
  libSource,
  /Err\(_\) => \{[\s\S]*?timeout_guard\.store\(true, Ordering::SeqCst\)[\s\S]*?restore_cached_github_auth_state\(&storage\)/,
  '启动认证检查超时时必须快速恢复 SQLite 缓存账号，不能一直停留在正在检查 GitHub 连接',
);
assert.match(
  libSource,
  /fn get_github_auth_state_worker\([\s\S]*?let auth_check = auth::get_auth_state_check\(\)\?;[\s\S]*?if timeout_guard\.load\(Ordering::SeqCst\) \{[\s\S]*?return restore_cached_github_auth_state\(&storage\);[\s\S]*?\}[\s\S]*?storage\.upsert_github_account\(user\)\?/,
  '启动认证状态必须先确认系统凭据中的 GitHub Token，再恢复或更新 SQLite 账号缓存；超时后后台晚到结果不能继续写连接状态',
);
assert.match(
  libSource,
  /if !auth_check\.state\.has_token \{[\s\S]*?storage\.mark_github_accounts_disconnected\(\)\?;[\s\S]*?return Ok\(auth_check\.state\);[\s\S]*?\}/,
  '系统凭据没有 GitHub Token 时必须断开 SQLite 账号缓存，避免重启后误显示已连接',
);
assert.match(
  libSource,
  /if !auth_check[\s\S]*?is_some_and\(auth::can_restore_cached_user_after_auth_error\)[\s\S]*?auth::clear_github_token\(\)\?;[\s\S]*?storage\.mark_github_accounts_disconnected\(\)\?;[\s\S]*?has_token: false,[\s\S]*?user: None/,
  '启动发现 GitHub Token 无效或权限不足时必须清理无效凭据并断开 SQLite 账号缓存',
);
assert.match(
  libSource,
  /fn clear_github_token\(app_handle: tauri::AppHandle\)[\s\S]*?auth::clear_github_token\(\)\?[\s\S]*?storage\.mark_github_accounts_disconnected\(\)/,
  '清除 GitHub Token 时必须同步断开 SQLite 缓存账号',
);
assert.match(
  libSource,
  /auth_check\.state\.user\.as_ref\(\)[\s\S]*?storage\.upsert_github_account\(user\)/,
  '系统凭据中的 Token 校验成功后必须写入 SQLite 账号缓存，供下次启动快速恢复',
);
assert.match(
  libSource,
  /fn restore_cached_github_auth_state\([\s\S]*?storage\.get_recent_github_account\(\)\?[\s\S]*?has_token: user\.is_some\(\),[\s\S]*?user,/,
  '启动认证超时或离线恢复必须从 SQLite connected 账号恢复，且没有缓存账号时回到未连接状态',
);
assert.match(workspaceHook, /invoke<GitHubAuthState>\('get_github_auth_state'\)/, '启动时必须读取后端认证状态');
assert.match(workspaceHook, /useEffect\(\(\) => \{[\s\S]*?refreshRepositoryWorkspace\(\);[\s\S]*?\}, \[authState\.user\?\.id\]\)/, '认证账号恢复后必须加载本地仓库数据');
assert.match(
  workspaceHook,
  /invoke<RepositoryListPage>\('list_repositories'[\s\S]*?limit: REPOSITORY_PAGE_SIZE/,
  '仓库列表必须从本地 SQLite 分页读取，避免重启后重新拉取 GitHub',
);
assert.doesNotMatch(mainSource, /StrictMode/, '桌面入口不能使用 React StrictMode 包裹应用，避免开发态启动认证和凭据读取副作用重复执行');
assert.match(mainSource, /ReactDOM\.createRoot\(document\.getElementById\('root'\) as HTMLElement\)\.render\(<App \/>\)/, '桌面入口必须只挂载一个 App 实例，避免启动时重复初始化');

console.log('Auth and data flow verification passed.');
