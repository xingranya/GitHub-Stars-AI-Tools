import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = new URL('..', import.meta.url).pathname;
const workspaceHook = readFileSync(join(projectRoot, 'src', 'hooks', 'use-stars-workspace.ts'), 'utf8');
const settingsPage = readFileSync(join(projectRoot, 'src', 'pages', 'settings.tsx'), 'utf8');
const tauriLibSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const githubSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'github.rs'), 'utf8');
const storageSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'storage.rs'), 'utf8');

assert.match(settingsPage, /activeTab === 'backup' && <BackupSettings workspace=\{workspace\} \/>/, '设置页必须提供数据备份与恢复入口');
assert.match(settingsPage, /onClick=\{\(\) => void workspace\.handleExportAnnotations\(\)\}/, '备份页导出按钮必须调用 workspace 导出动作');
assert.match(settingsPage, /onSubmit=\{\(event\) => void workspace\.handleImportAnnotations\(event\)\}/, '备份页导入表单必须调用 workspace 导入动作');
assert.match(settingsPage, /disabled=\{workspace\.isExportingAnnotations \|\| !isConnected\}/, '未连接 GitHub 或导出中时必须禁用导出按钮');
assert.match(settingsPage, /disabled=\{workspace\.isImportingAnnotations \|\| !workspace\.gistIdDraft\.trim\(\) \|\| !isConnected\}/, '未连接 GitHub、Gist ID 为空或导入中时必须禁用导入按钮');
assert.match(settingsPage, /const importHint = !isConnected[\s\S]*?请先连接 GitHub 账号后再导入 Gist 备份[\s\S]*?workspace\.gistIdDraft\.trim\(\)[\s\S]*?导入会覆盖匹配仓库的本地注解[\s\S]*?输入 Gist ID 后即可从备份恢复/, '备份页必须为未连接、空 Gist ID 和可导入状态展示明确导入提示');
assert.match(settingsPage, /className="flex flex-col gap-2 sm:flex-row sm:gap-3"/, '备份页导入表单必须在窄窗口下自适应换行，避免输入框和按钮挤压');

assert.match(workspaceHook, /async function handleExportAnnotations\(\)[\s\S]*?invoke<GistAnnotationExportSummary>\('export_annotation_gist'\)/, '前端导出注解必须调用真实 Tauri 导出命令');
assert.match(workspaceHook, /setGistIdDraft\(summary\.gistId\)/, '导出成功后必须把 Gist ID 回填到恢复输入框');
assert.match(workspaceHook, /setAuthMessage\(`注解已导出到 Gist \$\{summary\.gistId\}/, '导出成功后必须展示包含 Gist ID 的可见反馈');
assert.match(workspaceHook, /setTaskProgress\(buildRunningTaskProgress\([\s\S]*?'export-annotation-gist'[\s\S]*?'backup'/, '导出开始时必须展示后台任务进度');
assert.match(workspaceHook, /buildRunningTaskProgress\([\s\S]*?'export-annotation-gist'[\s\S]*?'GitHub Gist'[\s\S]*?'save'[\s\S]*?\)/, '导出 Gist 任务卡必须展示写入阶段和当前 Gist 对象');
assert.match(workspaceHook, /setTaskProgress\(buildSucceededTaskProgress\('export-annotation-gist', 'backup'/, '导出成功时必须展示任务成功状态');
assert.match(workspaceHook, /setTaskProgress\(buildFailedTaskProgress\('export-annotation-gist', 'backup', message, 'GitHub Gist'\)\)/, '导出失败时必须展示任务失败状态和当前 Gist 对象');

assert.match(workspaceHook, /async function handleImportAnnotations\(event: FormEvent<HTMLFormElement>\)[\s\S]*?event\.preventDefault\(\)/, '导入注解表单必须阻止默认提交刷新页面');
assert.match(workspaceHook, /const gistId = gistIdDraft\.trim\(\);[\s\S]*?if \(!gistId\) \{[\s\S]*?const message = '请输入 Gist ID 后再导入。';[\s\S]*?setError\(message\);[\s\S]*?setTaskProgress\(buildFailedTaskProgress\('import-annotation-gist', 'backup', message, 'GitHub Gist'\)\);[\s\S]*?return;[\s\S]*?\}/, '导入注解必须拒绝空 Gist ID，并显示可见错误和失败任务卡');
assert.match(workspaceHook, /invoke<GistAnnotationImportSummary>\('import_annotation_gist'[\s\S]*?request: \{ gistId \}/, '前端导入注解必须调用真实 Tauri 导入命令并传递 Gist ID');
assert.match(workspaceHook, /await refreshRepositoryWorkspace\(\);[\s\S]*?if \(selectedRepository\) \{[\s\S]*?await loadAnnotationWorkspace\(selectedRepository\);[\s\S]*?\}/, '导入成功后必须刷新仓库列表、标签和当前详情');
assert.match(workspaceHook, /setAuthMessage\([\s\S]*?注解已导入：\$\{summary\.tagCount\} 个标签，\$\{summary\.repositoryCount\} 条仓库注解，跳过 \$\{summary\.skippedRepositoryCount\} 条本地不存在或已取消 Star 的仓库。[\s\S]*?\)/, '导入成功后必须展示恢复数量和非活跃仓库跳过数量');
assert.match(workspaceHook, /setTaskProgress\(buildRunningTaskProgress\([\s\S]*?'import-annotation-gist'[\s\S]*?'backup'/, '导入开始时必须展示后台任务进度');
assert.match(workspaceHook, /buildRunningTaskProgress\([\s\S]*?'import-annotation-gist'[\s\S]*?`Gist \$\{gistId\}`[\s\S]*?'fetch'[\s\S]*?\)/, '导入 Gist 任务卡必须展示请求阶段和当前 Gist ID');
assert.match(workspaceHook, /setTaskProgress\(buildSucceededTaskProgress\('import-annotation-gist', 'backup'/, '导入成功时必须展示任务成功状态');
assert.match(workspaceHook, /setTaskProgress\(buildFailedTaskProgress\('import-annotation-gist', 'backup', message, `Gist \$\{gistId\}`\)\)/, '导入失败时必须展示任务失败状态和当前 Gist ID');

assert.match(tauriLibSource, /async fn export_annotation_gist\([\s\S]*?run_background_task_with_failure_progress\([\s\S]*?"Gist 注解导出"[\s\S]*?"export-annotation-gist"[\s\S]*?"backup"[\s\S]*?export_annotation_gist_worker/, '后端导出 Gist 必须放入后台任务执行并接入失败进度事件');
assert.match(tauriLibSource, /fn export_annotation_gist_worker\([\s\S]*?auth::require_github_token\(\)\?[\s\S]*?auth::verify_github_token\(&token\)\?[\s\S]*?storage\.export_annotation_snapshot\(&account_id\)\?[\s\S]*?github::create_annotation_gist\(&token, &snapshot_json\)\?/, '后端导出必须校验 Token、导出当前账号快照并调用真实 GitHub Gist API');
assert.match(tauriLibSource, /fn export_annotation_gist_worker\([\s\S]*?TaskProgressEvent::running\([\s\S]*?"export-annotation-gist"[\s\S]*?"auth"[\s\S]*?TaskProgressEvent::running\([\s\S]*?"export-annotation-gist"[\s\S]*?"prepare"[\s\S]*?TaskProgressEvent::running\([\s\S]*?"export-annotation-gist"[\s\S]*?"save"[\s\S]*?TaskProgressEvent::succeeded\([\s\S]*?"export-annotation-gist"/, '后端导出 Gist 必须展示校验、快照读取、创建 Gist 和完成阶段');
assert.match(tauriLibSource, /async fn import_annotation_gist\([\s\S]*?run_background_task_with_failure_progress\([\s\S]*?"Gist 注解导入"[\s\S]*?"import-annotation-gist"[\s\S]*?"backup"[\s\S]*?import_annotation_gist_worker/, '后端导入 Gist 必须放入后台任务执行并接入失败进度事件');
assert.match(tauriLibSource, /fn import_annotation_gist_worker\([\s\S]*?let gist_id = request\.gist_id\.trim\(\)\.to_owned\(\)[\s\S]*?auth::require_github_token\(\)\?[\s\S]*?auth::verify_github_token\(&token\)\?[\s\S]*?github::fetch_annotation_gist\(&token, &gist_id\)\?[\s\S]*?storage\.import_annotation_snapshot\(&account_id, &snapshot\)\?/, '后端导入必须校验 Token、读取真实 Gist 并写入当前账号本地数据库');
assert.match(tauriLibSource, /fn import_annotation_gist_worker\([\s\S]*?TaskProgressEvent::running\([\s\S]*?"import-annotation-gist"[\s\S]*?"auth"[\s\S]*?TaskProgressEvent::running\([\s\S]*?"import-annotation-gist"[\s\S]*?"fetch"[\s\S]*?TaskProgressEvent::running\([\s\S]*?"import-annotation-gist"[\s\S]*?"parse"[\s\S]*?TaskProgressEvent::running\([\s\S]*?"import-annotation-gist"[\s\S]*?"save"[\s\S]*?TaskProgressEvent::succeeded\([\s\S]*?"import-annotation-gist"/, '后端导入 Gist 必须展示校验、读取、解析、写库和完成阶段');

assert.match(githubSource, /const GIST_API: &str = "https:\/\/api\.github\.com\/gists"/, 'Gist 备份必须使用 GitHub 官方 Gist API');
assert.match(githubSource, /const ANNOTATION_GIST_FILE: &str = "github-stars-ai-tools-annotations\.json"/, 'Gist 备份文件名必须固定，便于恢复识别');
assert.match(githubSource, /pub fn create_annotation_gist[\s\S]*?"public": false[\s\S]*?github_api_post\(token, GIST_API, README_ACCEPT, &body\)/, '导出注解必须创建私密 Gist，不能公开用户数据');
assert.match(githubSource, /pub fn fetch_annotation_gist[\s\S]*?files[\s\S]*?get\(ANNOTATION_GIST_FILE\)[\s\S]*?github_api_get\(token, raw_url, README_ACCEPT\)/, '导入注解必须读取固定快照文件，并支持 raw_url 回退');

assert.match(storageSource, /pub fn export_annotation_snapshot\([\s\S]*?&self,[\s\S]*?account_id: &str,[\s\S]*?\) -> Result<AnnotationSnapshot, String>/, '本地存储必须支持按账号导出注解快照');
assert.match(storageSource, /pub fn import_annotation_snapshot\([\s\S]*?&self,[\s\S]*?account_id: &str,[\s\S]*?snapshot: &AnnotationSnapshot,[\s\S]*?\) -> Result<AnnotationImportSummary, String>/, '本地存储必须支持按账号导入注解快照');
assert.match(storageSource, /skipped_repository_count/, '导入快照必须统计本地不存在的仓库，避免静默丢弃');
assert.match(storageSource, /pub fn export_annotation_snapshot[\s\S]*?r\.sync_status = 'active'/, '导出注解快照必须只包含当前仍在 Star 的 active 仓库');
assert.match(storageSource, /fn list_repository_ids[\s\S]*?status == "active"/, '导入注解按 repository_id 匹配时必须跳过 removed/gone/error 仓库');
assert.match(storageSource, /fn list_repository_ids_by_full_name[\s\S]*?sync_status = 'active'/, '导入注解按 full_name 匹配时必须跳过 removed/gone/error 仓库');
assert.match(storageSource, /fn import_annotation_snapshot_matches_repository_by_full_name/, '导入快照按 full_name 匹配仓库的行为必须有后端测试');
assert.match(storageSource, /fn export_annotation_snapshot_ignores_removed_repositories/, '导出快照忽略 removed 仓库的行为必须有后端测试');
assert.match(storageSource, /fn import_annotation_snapshot_skips_removed_repositories/, '导入快照跳过 removed 仓库的行为必须有后端测试');

console.log('Backup flow verification passed.');
