import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = new URL('..', import.meta.url).pathname;
const tauriLib = readFileSync(join(projectRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const authSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'auth.rs'), 'utf8');
const aiSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'ai.rs'), 'utf8');
const storageSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'storage.rs'), 'utf8');
const workspaceHook = readFileSync(join(projectRoot, 'src', 'hooks', 'use-stars-workspace.ts'), 'utf8');
const appSource = readFileSync(join(projectRoot, 'src', 'App.tsx'), 'utf8');
const appLayout = readFileSync(join(projectRoot, 'src', 'components', 'app-layout.tsx'), 'utf8');
const aiSearchPage = readFileSync(join(projectRoot, 'src', 'pages', 'ai-search.tsx'), 'utf8');
const welcomeSource = readFileSync(join(projectRoot, 'src', 'components', 'welcome-flow.tsx'), 'utf8');
const repositoriesPage = readFileSync(join(projectRoot, 'src', 'pages', 'repositories.tsx'), 'utf8');
const tagNetworkPage = readFileSync(join(projectRoot, 'src', 'pages', 'tag-network.tsx'), 'utf8');
const settingsPage = readFileSync(join(projectRoot, 'src', 'pages', 'settings.tsx'), 'utf8');
const batchAiWorkerSource = tauriLib.match(/fn batch_generate_repository_ai_documents_worker[\s\S]*?enum BatchItemOutcome/)?.[0] ?? '';

const progressTasks = [
  ['sync_github_stars', 'sync-stars'],
  ['fetch_repository_readmes', 'fetch-readmes'],
  ['fetch_repository_readme', 'fetch-repository-readme'],
  ['generate_ai_tag_network', 'generate-ai-tag-network'],
  ['generate_repository_ai_document', 'generate-ai-document'],
  ['batch_generate_repository_ai_documents', 'batch-generate-ai-documents'],
  ['recommend_github_repositories', 'recommend-github-repositories'],
  ['export_annotation_gist', 'export-annotation-gist'],
  ['import_annotation_gist', 'import-annotation-gist'],
];

assert.match(tauriLib, /fn failed\([\s\S]*?status: "failed"/, 'TaskProgressEvent 必须支持 failed 状态');
assert.match(tauriLib, /static BACKGROUND_TASK_QUEUE: OnceLock<\(Mutex<BackgroundTaskQueueState>, Condvar\)>/, '耗时任务必须使用后台队列协调，避免并发任务直接失败或阻塞主线程');
assert.match(tauriLib, /while state\.serving_ticket != ticket \|\| state\.running_task_label\.is_some\(\)/, '后台任务必须按 ticket 顺序等待执行');
assert.match(tauriLib, /fn background_tasks_wait_in_fifo_queue/, '后台任务 FIFO 等待行为必须有 Rust 单元测试覆盖');
assert.match(
  tauriLib,
  /async fn run_background_task_with_failure_progress[\s\S]*?TaskProgressEvent::failed/,
  '后台任务包装器必须在失败时发出 failed 进度事件',
);
assert.match(
  tauriLib,
  /async fn run_background_task_with_failure_progress[\s\S]*?TaskProgressEvent::running\([\s\S]*?"queue"[\s\S]*?\{task_label\}已加入后台任务队列，正在等待执行/,
  '后台任务进入 FIFO 队列等待时必须先发出 queue 进度事件，避免用户在长任务排队时误以为卡住',
);
assert.match(
  tauriLib,
  /async fn run_immediate_blocking_task_with_failure_progress[\s\S]*?TaskProgressEvent::failed/,
  '即时阻塞任务包装器必须在失败时发出 failed 进度事件',
);
assert.match(
  tauriLib,
  /async fn save_github_token\([\s\S]*?TaskProgressEvent::running\([\s\S]*?"connect-github"[\s\S]*?"auth"[\s\S]*?"正在验证 GitHub Token"[\s\S]*?run_immediate_blocking_task_with_failure_progress\([\s\S]*?"connect-github"/,
  'save_github_token 必须立即显示验证进度并接入失败进度事件 connect-github',
);
assert.doesNotMatch(
  tauriLib,
  /async fn save_github_token\([\s\S]*?run_background_task_with_failure_progress\([\s\S]*?"connect-github"/,
  'save_github_token 不能进入批量后台队列，避免首启 Token 连接被长任务挡住',
);
assert.match(
  tauriLib,
  /TaskProgressEvent::partial\(\s*"batch-generate-ai-documents",\s*"ai",\s*progress_current\(scanned_count, progress_total\),\s*progress_total,/,
  '批量 AI 部分失败进度必须使用受上限保护的真实进度，不能在 limit 提前停止时显示已处理全部仓库',
);
assert.match(
  tauriLib,
  /let progress_total = processing_limit[\s\S]*?\.map\(\|limit\| limit\.min\(repositories\.len\(\)\)\)[\s\S]*?\.unwrap_or\(repositories\.len\(\)\)/,
  '批量 AI 进度总数必须按显式 limit 缩小，默认才使用全部 Stars 数量',
);
assert.match(
  tauriLib,
  /let BatchGenerateAiDocumentsRequest[\s\S]*?limit,[\s\S]*?\} = request;[\s\S]*?let processing_limit = limit\.map\(\|value\| value\.clamp\(1, 1000\)\)/,
  '批量 AI 摘要后端必须仅在显式传入 limit 时限制处理数量，默认应扫描全部 Stars',
);
assert.match(
  batchAiWorkerSource,
  /for repository in repositories\.into_iter\(\)\.take\(progress_total\)/,
  '批量 AI 显式 limit 必须限制本次扫描仓库数量，避免大量已解析仓库让进度条先满格但任务仍继续跑',
);
assert.match(
  batchAiWorkerSource,
  /for repository in repositories\.into_iter\(\)\.take\(progress_total\) \{[\s\S]*?TaskProgressEvent::running\([\s\S]*?"check",\s*progress_current\(scanned_count, progress_total\)[\s\S]*?let result = \(\|\| -> Result<BatchItemOutcome, String> \{[\s\S]*?let mut source = storage\.get_repository_ai_source\(&repository\.id, Some\(&account_id\)\)\?;[\s\S]*?\}\)\(\);[\s\S]*?match result \{[\s\S]*?Err\(error\) => failures\.push\(BatchAiDocumentFailure[\s\S]*?scanned_count \+= 1;/,
  '批量 AI 单仓读取、README 补抓、AI 调用或保存失败必须只记录该仓库失败，并在处理完成后推进进度',
);
assert.match(
  batchAiWorkerSource,
  /"save",\s*progress_current\(scanned_count, progress_total\),\s*progress_total,\s*format!\("已处理 \{\}", repository_name\)/,
  '批量 AI 每处理完一个仓库后必须发送已处理进度，避免长任务结束前进度停留在上一项',
);
assert.doesNotMatch(
  batchAiWorkerSource,
  /processed_count\s*>?=\s*limit/,
  '批量 AI 不能用实际生成数量控制 limit，否则 onlyMissing 跳过大量仓库时会继续扫描超出用户预期',
);
assert.doesNotMatch(
  batchAiWorkerSource,
  /request\.limit\.unwrap_or\(20\)|request\.limit\.unwrap_or\(50\)/,
  '批量 AI 摘要后端不能默认截断为 20 或 50 个仓库',
);
assert.match(
  tauriLib,
  /批量 AI 完成：生成 \{generated_count\} 个，跳过 \{skipped_count\} 个，缺少 README \{missing_readme_count\} 个，失败 \{\} 个/,
  '批量 AI 完成进度必须展示缺少 README 数量，避免用户误以为所有未生成项都是失败',
);
assert.match(
  tauriLib,
  /let completion_progress = if failures\.is_empty\(\) \{[\s\S]*?TaskProgressEvent::succeeded\(\s*"fetch-readmes"[\s\S]*?\} else \{[\s\S]*?TaskProgressEvent::partial\(\s*"fetch-readmes"/,
  'README 批量抓取有失败项时后端必须发 partial 进度，避免最终成功事件覆盖前端重试入口',
);
assert.match(
  tauriLib,
  /let completion_progress = if failures\.is_empty\(\) \{[\s\S]*?TaskProgressEvent::succeeded\(\s*"batch-generate-ai-documents"[\s\S]*?\} else \{[\s\S]*?TaskProgressEvent::partial\(\s*"batch-generate-ai-documents"/,
  '批量 AI 有失败项时后端必须发 partial 进度，避免最终成功事件覆盖前端重试入口',
);
assert.match(
  tauriLib,
  /README 处理完成：更新 \{fetched_count\} 个，跳过 \{skipped_count\} 个，缺失 \{missing_count\} 个，失败 \{\} 个/,
  'README 抓取完成进度必须展示缺失 README 数量，避免无 README 仓库被误认为失败或静默忽略',
);
assert.match(authSource, /const GITHUB_API_MAX_ATTEMPTS: usize = 3/, 'GitHub API 请求必须有有限重试，提升 README 批量抓取和同步的弱网可靠性');
assert.match(authSource, /parse_u64_header\(&headers, "retry-after"\)/, 'GitHub API 请求必须读取 Retry-After，遇到限流时按服务端建议重试');
assert.match(authSource, /parse_u32_header\(&headers, "x-ratelimit-remaining"\)/, 'GitHub API 请求必须读取 X-RateLimit-Remaining，用于区分限流和权限错误');
assert.match(authSource, /parse_u64_header\(&headers, "x-ratelimit-reset"\)/, 'GitHub API 请求必须读取 X-RateLimit-Reset，用于给用户明确恢复时间');
assert.match(authSource, /fn github_api_get_retries_short_rate_limit_response/, 'GitHub API 短限流重试必须有 Rust 单元测试覆盖');
assert.match(authSource, /fn format_github_http_error_reports_rate_limit_reset_hint/, 'GitHub API 限流恢复时间提示必须有 Rust 单元测试覆盖');
assert.match(aiSource, /const AI_API_MAX_ATTEMPTS: usize = 3/, 'AI 接口请求必须有有限重试，提升 OpenAI 和 Anthropic 网关弱网可靠性');
assert.match(aiSource, /fn should_retry_ai_transport_error\(error: &reqwest::Error, attempt: usize\)/, 'AI 接口请求必须识别可重试的网络或超时错误');
assert.match(aiSource, /matches!\(response\.http_code, Some\(429 \| 500 \| 502 \| 503 \| 504\)\)/, 'AI 接口请求必须重试限流和临时网关错误');
assert.match(aiSource, /fn execute_json_post_retries_transient_server_errors/, 'AI 接口 5xx 临时错误重试必须有 Rust 单元测试覆盖');
assert.match(
  tauriLib,
  /let estimated_total\s*=\s*if page_contains_only_known_active \|\| page_len < github::starred_page_size\(\)[\s\S]*?repositories\.len\(\) \+ github::starred_page_size\(\)/,
  'Stars 全量同步每页保存后必须提供动态估算 total，避免长时间只显示文字没有进度条',
);
assert.match(
  tauriLib,
  /format!\([\s\S]*?"正在同步第 \{page\} 页，已写入 \{\} 个 Stars"[\s\S]*?repositories\.len\(\)[\s\S]*?\)/,
  'Stars 同步进度必须展示页码和已写入数量，便于用户判断长任务仍在推进',
);
assert.match(
  tauriLib,
  /README 解析准备完成：已跳过 \{skipped_count\} 个缓存项，待处理 \{\} 个/,
  'README 解析预筛选后必须立刻更新进度，避免用户在缓存检查阶段误以为卡住',
);
assert.match(
  tauriLib,
  /let batch_label = format_repository_batch_label\(&batch\);[\s\S]*?正在抓取 README：\{batch_label\}/,
  'README 并发批次开始时必须先展示正在抓取的仓库，不能等整批请求结束才刷新进度',
);
assert.match(
  tauriLib,
  /"fetch-readme"[\s\S]*?format!\(\s*"正在抓取 \{\} 的 README",\s*source\.full_name/,
  '批量 AI 在缺少 README 时必须先发抓取 README 阶段进度',
);
assert.match(
  tauriLib,
  /"summarize"[\s\S]*?format!\(\s*"正在让 AI 解析 \{\}",\s*source\.full_name/,
  '批量 AI 调用模型前必须发出解析阶段进度，避免长时间等待无反馈',
);
assert.match(
  tauriLib,
  /"generate-ai-tag-network"[\s\S]*?"analyze"[\s\S]*?batch_index,\s*[\s\S]*?batch_total/,
  'AI 标签网络分批生成必须按已完成批次数显示真实进度，不能在批次开始时提前增加百分比',
);
assert.match(
  tauriLib,
  /match ai::generate_tag_network\(&ai_config, batch\)[\s\S]*?Ok\(suggestions\)[\s\S]*?Err\(error\)[\s\S]*?partial-failure[\s\S]*?已记录失败并继续处理后续批次/,
  'AI 标签网络单批失败必须记录失败并继续处理后续批次，不能让一个超时批次导致整个图谱无法生成',
);
assert.match(
  tauriLib,
  /if assignments\.is_empty\(\) \{[\s\S]*?return Err\(format!\("AI 标签网络生成失败：\{failure_summary\}"\)\)/,
  'AI 标签网络全部批次失败时必须返回明确错误，不能伪装成成功',
);
assert.match(
  tauriLib,
  /fn ai_tag_network_success_message_reports_partial_failures/,
  'AI 标签网络部分批次失败提示必须有 Rust 单元测试覆盖',
);
assert.match(
  tauriLib,
  /"recommend-github-repositories"[\s\S]*?"github-search"[\s\S]*?index \+ 1[\s\S]*?plan\.queries\.len\(\)/,
  'GitHub 相似项目搜索必须从当前查询 1/N 开始显示进度',
);
assert.match(
  tauriLib,
  /build_github_recommendation_completion_progress\([\s\S]*?search_failures\.len\(\)[\s\S]*?\);[\s\S]*?fn build_github_recommendation_completion_progress[\s\S]*?if search_failure_count > 0 \{[\s\S]*?TaskProgressEvent::partial\(\s*"recommend-github-repositories"[\s\S]*?\} else \{[\s\S]*?TaskProgressEvent::succeeded\(\s*"recommend-github-repositories"/,
  'GitHub 相似发现部分搜索失败时必须发 partial 进度，避免成功态隐藏重试入口',
);

for (const [commandName, taskId] of progressTasks) {
  const commandPattern = new RegExp(
    `async fn ${commandName}[\\s\\S]*?run_background_task_with_failure_progress\\([\\s\\S]*?"${escapeRegExp(taskId)}"`,
  );
  assert.match(tauriLib, commandPattern, `${commandName} 必须接入失败进度事件 ${taskId}`);
}

assert.match(workspaceHook, /listen<TaskProgressEvent>\('task-progress'/, '前端必须监听 task-progress 事件');
assert.match(
  workspaceHook,
  /async function handleSyncStars[\s\S]*?setTaskProgress\(buildRunningTaskProgress\('sync-stars', 'sync', '正在准备同步 GitHub Stars'\)\)[\s\S]*?invoke<StarSyncSummary>\('sync_github_stars'[\s\S]*?forceFull: options\?\.forceFull \?\? false/,
  'Stars 同步前端动作必须立即显示同步进度，并把全量或增量参数传给真实后端命令',
);
assert.match(
  workspaceHook,
  /const displayMessage = `同步未完成：\$\{message\}。本地已有数据不会被删除，可检查网络或 Token 后重试。`;[\s\S]*?setTaskProgress\(buildFailedTaskProgress\('sync-stars', 'sync', displayMessage\)\);[\s\S]*?await refreshRepositoryWorkspace\(\)/,
  'Stars 同步失败必须明确说明本地已有数据不会删除，并重新读取本地库保留已拉取数据',
);
assert.match(
  workspaceHook,
  /if \(options\?\.throwOnError\) \{[\s\S]*?throw new Error\(displayMessage\)/,
  'Stars 同步严格模式必须把完整错误抛给欢迎页，避免初始化流程误报成功',
);
assert.match(
  workspaceHook,
  /async function handleFetchReadmes[\s\S]*?setTaskProgress\(buildRunningTaskProgress\('fetch-readmes', 'readme', '正在准备抓取并解析 README'\)\)[\s\S]*?invoke<ReadmeFetchSummary>\('fetch_repository_readmes'/,
  'README 批量抓取前端动作必须立即显示进度，并调用真实后端抓取命令',
);
assert.match(
  workspaceHook,
  /const readmeFailureMessage = buildReadmeFailureMessage\(summary\);[\s\S]*?setError\(readmeFailureMessage\);[\s\S]*?setTaskProgress\(buildPartialTaskProgress\(\s*'fetch-readmes',\s*'readme',\s*readmeFailureMessage,\s*summary\.totalCount,\s*\)\)/,
  'README 批量抓取部分失败必须提升为全局提示和可重试的部分完成任务卡',
);
assert.match(
  workspaceHook,
  /async function handleGenerateAiDocument[\s\S]*?setRepositoryAiError\(null\)[\s\S]*?setTaskProgress\(buildRunningTaskProgress\(\s*'generate-ai-document'[\s\S]*?invoke<RepositoryDetailView>\('generate_repository_ai_document'[\s\S]*?setRepositoryDetail\(nextRepositoryDetail\)[\s\S]*?await refreshRepositoryWorkspace\(\)/,
  '单仓 AI 解析必须清理旧错误、显示运行进度、调用真实后端命令，并在成功后刷新本地知识库',
);
assert.match(
  workspaceHook,
  /catch \(reason\) \{[\s\S]*?const message = toErrorMessage\(reason\);[\s\S]*?setRepositoryAiError\(\{ repositoryId: selectedRepository\.id, message \}\);[\s\S]*?setTaskProgress\(buildFailedTaskProgress\('generate-ai-document', 'ai', message, selectedRepository\.fullName\)\);[\s\S]*?throw reason;/,
  '单仓 AI 解析失败必须写入当前仓库错误位、显示失败任务卡并继续抛出，便于详情页和全局重试同时可见',
);
assert.match(
  workspaceHook,
  /setTaskProgress\(buildFailedTaskProgress\('fetch-repository-readme', 'readme', message, selectedRepository\.fullName\)\)/,
  '单仓 README 抓取失败任务卡必须带当前仓库名',
);
assert.match(
  workspaceHook,
  /setTaskProgress\(buildFailedTaskProgress\('generate-ai-document', 'ai', aiConfigMessage, selectedRepository\.fullName\)\)/,
  '单仓 AI 摘要配置错误任务卡必须带当前仓库名',
);
assert.match(
  workspaceHook,
  /async function handleBatchGenerateAiDocuments[\s\S]*?invoke<BatchAiDocumentSummary>\('batch_generate_repository_ai_documents'[\s\S]*?limit: options\?\.limit,[\s\S]*?onlyMissing: options\?\.onlyMissing \?\? true/,
  '批量 AI 解析必须调用真实后端命令，并且只有用户显式传入时才带 limit',
);
assert.match(
  workspaceHook,
  /async function handleBatchGenerateAiDocuments\(aiConfig: AISettings, options\?: \{[\s\S]*?repositoryIds\?: string\[\][\s\S]*?invoke<BatchAiDocumentSummary>\('batch_generate_repository_ai_documents'[\s\S]*?repositoryIds: options\?\.repositoryIds/,
  '批量 AI 解析必须允许传入具体仓库 ID，用于失败清单精准重试',
);
assert.match(
  repositoriesPage,
  /const batchTargetRepositoryIds = hasActiveFilters \? filteredRepos\.map\(\(repository\) => repository\.id\) : undefined/,
  '仓库页有筛选条件时，批量 README 和 AI 解析必须以当前列表为目标，不能默认扫全部 Stars',
);
assert.match(
  repositoriesPage,
  /handleFetchReadmes\(\{[\s\S]*?repositoryIds: batchTargetRepositoryIds/,
  '仓库页抓取 README 或抓取并分析时必须把当前列表仓库 ID 传给后端',
);
assert.match(
  repositoriesPage,
  /handleBatchGenerateAiDocuments\(settingsHook\.settings\.ai, \{[\s\S]*?repositoryIds: batchTargetRepositoryIds/,
  '仓库页批量 AI 解析必须把当前列表仓库 ID 传给后端，支持用户筛选一组仓库后再解析',
);
assert.match(appLayout, /props\.taskProgress && \([\s\S]*?<TaskProgressCard[\s\S]*?progress=\{props\.taskProgress\}/, '主布局必须显示任务进度卡片');
assert.match(appLayout, /lg:hidden[\s\S]*?<TaskProgressCard[\s\S]*?progress=\{props\.taskProgress\}/, '窄窗口和移动布局必须显示任务进度，不能只依赖桌面侧边栏');
assert.match(appLayout, /progress\.status === 'failed'/, '任务进度卡片必须识别失败状态');
assert.match(appLayout, /progress\.status === 'partial'/, '任务进度卡片必须识别部分完成状态');
assert.match(appLayout, /任务部分完成/, '任务进度卡片必须把部分失败批处理展示为部分完成，不能误报为整体失败');
assert.match(appLayout, /isFailed \|\| isPartial \? 'whitespace-pre-wrap break-words' : 'line-clamp-2'/, '失败和部分完成任务的详情必须完整换行显示，不能用两行截断隐藏关键原因');
assert.match(appLayout, /const canRetry = \(isFailed \|\| isPartial\) && Boolean\(props\.onRetry\)/, '失败和部分完成任务卡片必须只在可重试时显示重试入口');
assert.match(appLayout, /props\.isRetrying \? '重试中' : props\.retryLabel \?\? '重试任务'/, '失败任务卡片必须展示明确的重试状态和按钮文案');
assert.match(appLayout, /const stageLabel = getTaskStageLabel\(progress\.stage\)/, '任务进度卡片必须把后端 stage 转成用户可读阶段');
assert.match(appLayout, /阶段：\{stageLabel\}/, '任务进度卡片必须展示当前阶段');
assert.match(appLayout, /case 'github-star':[\s\S]*?return '更新 Stars';/, '推荐候选加入 Stars 的任务阶段必须展示为用户可理解的更新 Stars');
assert.match(appLayout, /case 'batch':[\s\S]*?return '批量处理';[\s\S]*?case 'check':[\s\S]*?return '检查仓库';[\s\S]*?case 'plan':[\s\S]*?return '生成计划';/, '任务进度卡片必须映射 batch、check、plan 阶段，不能暴露内部英文');
assert.match(welcomeSource, /case 'batch':[\s\S]*?return '批量处理';[\s\S]*?case 'check':[\s\S]*?return '检查仓库';[\s\S]*?case 'plan':[\s\S]*?return '生成计划';/, '欢迎页任务进度卡必须映射 batch、check、plan 阶段，不能暴露内部英文');
assert.match(appLayout, /当前：\{progress\.repositoryName\}/, '任务进度卡片必须展示当前处理的仓库名');
assert.match(appLayout, /function GlobalStatusBanner/, '主布局必须提供全局状态横幅，避免非设置页操作失败时无反馈');
assert.match(appLayout, /role=\{isError \? 'alert' : 'status'\}/, '全局状态横幅必须区分错误与成功消息的可访问语义');
assert.match(appSource, /statusMessage=\{workspace\.authMessage\}/, '应用壳必须把全局成功消息传给主布局');
assert.match(appSource, /errorMessage=\{workspace\.error \?\? settingsHook\.settingsError\}/, '应用壳必须把业务错误和设置凭据错误都传给主布局，避免非设置页操作失败时无反馈');
assert.match(appSource, /onRetryTask=\{failedTaskRetry\?\.onRetry \?\? null\}/, '应用壳必须把失败任务重试动作传给主布局');
assert.match(appSource, /function getFailedTaskRetry/, '应用壳必须按失败 taskId 映射可重试动作');
assert.match(appSource, /workspace\.taskProgress\?\.status === 'failed' \|\| workspace\.taskProgress\?\.status === 'partial'/, '应用壳必须把部分完成任务映射到可重试动作');
for (const taskId of ['connect-github', 'clear-local-data', 'sync-stars', 'fetch-readmes', 'fetch-repository-readme', 'generate-ai-document', 'batch-generate-ai-documents', 'generate-ai-tag-network', 'ai-search', 'recommend-github-repositories', 'star-github-recommendation-candidate', 'export-annotation-gist', 'import-annotation-gist']) {
  assert.match(appSource, new RegExp(`case '${escapeRegExp(taskId)}'`), `失败任务 ${taskId} 必须有重试入口`);
}
assert.match(appSource, /openSettings: \(\) => setCurrentPage\('settings'\)/, 'GitHub 连接失败后重试入口必须带用户回到设置页重新输入 Token');
assert.match(appSource, /case 'connect-github':[\s\S]*?label: '重新输入 Token'[\s\S]*?isRetrying: options\.workspace\.isSavingToken[\s\S]*?onRetry: options\.openSettings/, 'GitHub 连接失败后应用壳必须提供重新输入 Token 的入口');
assert.match(appSource, /case 'clear-local-data':[\s\S]*?label: '重试清空本机数据'[\s\S]*?isRetrying: options\.workspace\.isClearingLocalData[\s\S]*?await options\.resetSettings\(\)[\s\S]*?await options\.workspace\.handleClearLocalData\(\)/, '清空本机数据失败后应用壳必须先清设置和 AI Key，再清工作区本机数据');
assert.match(appSource, /case 'fetch-readmes': \{[\s\S]*?getFailureRepositoryIds\(options\.workspace\.readmeSummary\?\.failures\)[\s\S]*?label: failedReadmeRepositoryIds\.length > 0 \? '重试失败 README'[\s\S]*?repositoryIds: failedReadmeRepositoryIds\.length > 0 \? failedReadmeRepositoryIds : undefined/, 'README 失败任务重试必须优先复用上次失败仓库 ID，避免重新扫描全部 Stars');
assert.match(appSource, /case 'batch-generate-ai-documents': \{[\s\S]*?getFailureRepositoryIds\(options\.workspace\.batchAiSummary\?\.failures\)[\s\S]*?label: failedAiRepositoryIds\.length > 0 \? '重试失败 AI'[\s\S]*?repositoryIds: failedAiRepositoryIds\.length > 0 \? failedAiRepositoryIds : undefined/, '批量 AI 失败任务重试必须优先复用上次失败仓库 ID，避免重新解析全部 Stars');
assert.match(appSource, /case 'generate-ai-tag-network':[\s\S]*?label: '重试 AI 标签网络'[\s\S]*?isRetrying: options\.workspace\.isGeneratingTagNetwork[\s\S]*?await options\.flushAIKey\(options\.aiSettings\.apiKey\)[\s\S]*?handleGenerateAiTagNetwork\(options\.aiSettings\)/, 'AI 标签网络失败后应用壳必须先落盘 AI Key，再映射到真实生成重试动作');
assert.match(appSource, /case 'ai-search':[\s\S]*?label: '重试 AI 搜索'[\s\S]*?isRetrying: options\.workspace\.isRetryingAiSearch[\s\S]*?options\.workspace\.retryLastAiSearch\(\)/, 'AI 搜索失败后应用壳必须映射到真实的上一次搜索重试动作');
assert.match(aiSearchPage, /workspace\.setAiSearchRetryAction\(\(\) => executeSearch\(q\)\)/, 'AI 搜索页必须在调用后端前登记当前搜索重试动作');
assert.match(aiSearchPage, /workspace\.setAiSearchRetryAction\(null\)/, 'AI 搜索页卸载或切换账号时必须清理旧重试动作');
assert.match(workspaceHook, /async function retryLastAiSearch\(\)[\s\S]*?setIsRetryingAiSearch\(true\)[\s\S]*?await action\(\)[\s\S]*?setIsRetryingAiSearch\(false\)/, 'workspace 必须执行 AI 搜索重试动作并暴露运行态');
assert.match(workspaceHook, /isRetryingAiSearch,[\s\S]*?setAiSearchRetryAction,[\s\S]*?retryLastAiSearch,/, 'workspace 必须把 AI 搜索失败卡所需状态和动作暴露给应用壳');
assert.match(appSource, /case 'recommend-github-repositories':[\s\S]*?label: '重试相似发现'[\s\S]*?isRetrying: options\.workspace\.isFindingSimilarRepositories[\s\S]*?await options\.flushAIKey\(options\.aiSettings\.apiKey\)[\s\S]*?handleFindSimilarRepositories\(options\.aiSettings, options\.workspace\.lastGithubRecommendationRepositoryIds\)/, 'GitHub 相似发现失败后应用壳必须先落盘 AI Key，再映射到带上次选择上下文的真实重试动作');
assert.match(appSource, /case 'star-github-recommendation-candidate':[\s\S]*?label: '重试加入 Stars'[\s\S]*?isRetrying: options\.workspace\.isStarringRecommendationCandidate[\s\S]*?handleStarRecommendationCandidate\(options\.workspace\.lastStarRecommendationCandidateFullName!\)/, '候选加入 Stars 失败后应用壳必须映射到真实加入 Stars 重试动作');
assert.match(appSource, /case 'import-annotation-gist':[\s\S]*?label: '重试导入 Gist'[\s\S]*?isRetrying: options\.workspace\.isImportingAnnotations[\s\S]*?onRetry: \(\) => void options\.workspace\.runImportAnnotations\(\)/, '导入 Gist 失败后应用壳必须映射到真实导入重试动作');
assert.match(workspaceHook, /async function runImportAnnotations\(\)[\s\S]*?invoke<GistAnnotationImportSummary>\('import_annotation_gist'/, '导入 Gist 重试动作必须复用真实后端导入命令');
assert.match(workspaceHook, /if \(!gistId\) \{[\s\S]*?setTaskProgress\(buildFailedTaskProgress\('import-annotation-gist', 'backup', message, 'GitHub Gist'\)\);[\s\S]*?return;[\s\S]*?\}/, '导入 Gist 重试时如果 Gist ID 为空，必须显示可见失败任务卡，不能静默无反应');
assert.match(workspaceHook, /handleImportAnnotations,[\s\S]*?runImportAnnotations,/, 'workspace 必须同时暴露表单提交入口和失败卡重试入口');
assert.match(appSource, /throwOnFailure: true/, '初始化流程抓取 README 时必须启用失败冒泡，避免首次缓存失败却显示完成');
assert.match(workspaceHook, /function buildReadmeFailureMessage\(summary: ReadmeFetchSummary\)/, 'README 批量抓取失败必须生成统一可见错误提示');
assert.match(workspaceHook, /README 缓存有 \$\{summary\.failedCount\} 个仓库失败，已成功缓存的数据不会回滚/, 'README 失败提示必须说明已缓存数据不会回滚');
assert.match(workspaceHook, /首个失败仓库：\$\{firstFailure\.fullName\}，原因：\$\{firstFailure\.error\}/, 'README 失败提示必须包含首个失败仓库和原因，便于用户定位网络或权限问题');
assert.match(workspaceHook, /function buildBatchAiFailureMessage\(summary: BatchAiDocumentSummary\)/, '批量 AI 部分失败必须生成统一可见错误提示');
assert.match(workspaceHook, /批量 AI 有 \$\{summary\.failedCount\} 个仓库失败，已生成的摘要和本地数据不会回滚/, '批量 AI 失败提示必须说明已生成摘要和本地数据不会回滚');
assert.match(workspaceHook, /可稍后重试、降低批量数量，或换用更大上下文模型/, '批量 AI 失败提示必须给出可恢复建议');
assert.match(workspaceHook, /function buildPartialTaskProgress\([\s\S]*?status: 'partial'[\s\S]*?stage: 'partial-failure'/, '批量 AI 部分失败必须使用 partial 任务状态，避免误报整体失败');
assert.match(workspaceHook, /const batchAiFailureMessage = buildBatchAiFailureMessage\(summary\);[\s\S]*?setError\(batchAiFailureMessage\);[\s\S]*?setTaskProgress\(buildPartialTaskProgress\(\s*'batch-generate-ai-documents',\s*'ai',\s*batchAiFailureMessage,\s*summary\.totalCount,\s*\)\)/, '批量 AI 部分失败必须提升到全局提示和可重试的部分完成任务卡');
assert.match(workspaceHook, /invoke<ReadmeFetchSummary>\('fetch_repository_readmes', \{[\s\S]*?onlyMissing: options\?\.onlyMissing \?\? true/, 'README 批量抓取必须把 onlyMissing 传给后端，避免重复请求已缓存仓库');
assert.match(workspaceHook, /async function handleFetchReadmes\(options\?: \{[\s\S]*?repositoryIds\?: string\[\][\s\S]*?invoke<ReadmeFetchSummary>\('fetch_repository_readmes'[\s\S]*?repositoryIds: options\?\.repositoryIds/, 'README 批量抓取必须允许传入具体仓库 ID，用于失败清单精准重试');
assert.match(tauriLib, /struct FetchReadmesRequest[\s\S]*?only_missing: Option<bool>/, 'README 批量抓取后端必须接收 onlyMissing 请求参数');
assert.match(tauriLib, /struct FetchReadmesRequest[\s\S]*?repository_ids: Option<Vec<String>>/, 'README 批量抓取后端必须接收失败仓库 ID 列表');
assert.match(tauriLib, /let only_missing = request\.only_missing\.unwrap_or\(true\)/, 'README 批量抓取后端默认应只抓缺失 README');
assert.match(tauriLib, /fetch_repository_readmes_worker[\s\S]*?filter_repositories_by_ids\([\s\S]*?storage\.list_active_repositories\(Some\(&account_id\)\)\?[\s\S]*?request\.repository_ids/, 'README 失败重试后端必须先按仓库 ID 缩小处理范围');
assert.match(tauriLib, /struct BatchGenerateAiDocumentsRequest[\s\S]*?repository_ids: Option<Vec<String>>/, '批量 AI 后端必须接收失败仓库 ID 列表');
assert.match(tauriLib, /batch_generate_repository_ai_documents_worker[\s\S]*?filter_repositories_by_ids\([\s\S]*?storage\.list_active_repositories\(Some\(&account_id\)\)\?[\s\S]*?repository_ids/, '批量 AI 失败重试后端必须先按仓库 ID 缩小处理范围');
assert.match(tauriLib, /fn repository_retry_filter_keeps_only_requested_active_repositories/, '失败清单仓库过滤必须有 Rust 单元测试覆盖');
assert.match(tauriLib, /partition_readme_fetch_targets\(repositories, only_missing,[\s\S]*?storage\.get_readme_hash\(repository_id\)/, 'README 批量抓取必须在请求 GitHub 前读取缓存状态');
assert.match(tauriLib, /fn partition_readme_fetch_targets[\s\S]*?if !only_missing[\s\S]*?return \(repositories, 0, Vec::new\(\)\)[\s\S]*?Ok\(Some\(_\)\) => skipped_count \+= 1[\s\S]*?Ok\(None\) => fetch_targets\.push\(repository\)/, 'README 批量抓取必须在 onlyMissing 时跳过已缓存 README，只抓缺失项');
assert.match(tauriLib, /fn readme_fetch_targets_skip_cached_repositories_when_only_missing/, 'README onlyMissing 预筛选必须有 Rust 单元测试覆盖');
assert.match(workspaceHook, /if \(options\?\.throwOnFailure\) \{[\s\S]*?throw new ReadmePostProcessWarning\(readmeFailureMessage\)/, 'README 抓取严格模式必须向欢迎页抛出失败，并保留已显示的部分完成任务卡');
assert.match(workspaceHook, /catch \(reason\) \{[\s\S]*?const message = toErrorMessage\(reason\);[\s\S]*?if \(options\?\.throwOnFailure\) \{[\s\S]*?throw new Error\(message\)/, 'README 抓取命令级失败在严格模式下也必须保留具体原因并抛给欢迎页');
assert.match(repositoriesPage, /isBatchGeneratingAiDocuments[\s\S]*?分析中/, '批量 AI 按钮必须有运行态反馈');
assert.match(repositoriesPage, /批量 AI 会自动补抓缺失 README，仅跳过已是最新摘要的仓库/, '批量 AI 入口必须说明会自动补抓缺失 README，避免用户误以为需要先手动缓存');
assert.match(repositoriesPage, /type BatchAiLimit = 'all' \| '50' \| '100' \| '300'/, '仓库页必须提供用户可控的批量 AI 上限，避免失败恢复建议无法操作');
assert.match(repositoriesPage, /const \[batchAiLimit, setBatchAiLimit\] = useState<BatchAiLimit>\('all'\)/, '批量 AI 默认必须解析全部 Stars，不能隐式限制为小批量');
assert.match(repositoriesPage, /function getBatchAiLimitValue\(limit: BatchAiLimit\)[\s\S]*?if \(limit === 'all'\)[\s\S]*?return undefined[\s\S]*?return Number\(limit\)/, '批量 AI 上限必须只在用户选择具体数量时传给后端');
assert.match(repositoriesPage, /AI 批量上限[\s\S]*?value=\{batchAiLimit\}[\s\S]*?setBatchAiLimit\(event\.target\.value as BatchAiLimit\)[\s\S]*?<option value="all">全部 Stars<\/option>[\s\S]*?<option value="50">最多 50 个<\/option>/, '仓库页必须渲染批量 AI 上限选择控件');
assert.match(repositoriesPage, /handleBatchGenerateAiDocuments\(settingsHook\.settings\.ai, \{[\s\S]*?limit: batchAiLimitValue,[\s\S]*?onlyMissing: true/, '批量 AI 入口必须使用用户选择的上限传给后端');
assert.match(repositoriesPage, /handleFetchReadmes\(\{[\s\S]*?autoGenerateAi: settingsHook\.settings\.ai\.enableAutoSummary,[\s\S]*?aiLimit: batchAiLimitValue,[\s\S]*?onlyMissing: true/, '抓取并分析入口的 AI 阶段必须复用同一个用户选择的批量上限');
assert.match(workspaceHook, /await handleBatchGenerateAiDocuments\(aiConfig, \{[\s\S]*?limit: options\.aiLimit,[\s\S]*?onlyMissing: options\.onlyMissing \?\? true,[\s\S]*?repositoryIds: options\.repositoryIds/, 'README 缓存后的自动 AI 阶段必须沿用同一批仓库 ID，避免用户选择部分仓库时触发全量 AI 分析');
assert.match(repositoriesPage, /isFindingSimilarRepositories[\s\S]*?发现中/, 'GitHub 相似发现按钮必须有运行态反馈');
assert.match(workspaceHook, /async function handleFindSimilarRepositories\(aiConfig: AISettings, repositoryIds: string\[\]/, 'workspace 必须暴露 GitHub 相似发现动作');
assert.match(workspaceHook, /handleFindSimilarRepositories,/, 'workspace 必须暴露 GitHub 相似发现动作');
assert.match(workspaceHook, /isFindingSimilarRepositories,/, 'workspace 必须暴露 GitHub 相似发现运行态');
assert.match(workspaceHook, /lastGithubRecommendationRepositoryIds,/, 'workspace 必须暴露 GitHub 相似发现重试上下文');
assert.match(workspaceHook, /limit: options\?\.limit,/, '批量 AI 前端调用不能在缺省情况下主动传入 50 个仓库的限制');
assert.doesNotMatch(`${appSource}\n${repositoriesPage}\n${settingsPage}\n${workspaceHook}`, /aiLimit:\s*50|handleBatchGenerateAiDocuments\([\s\S]{0,140}limit:\s*50/, '批量 AI 正常入口不能默认限制为 50 个仓库');
assert.match(tagNetworkPage, /isGeneratingTagNetwork[\s\S]*?生成中/, 'AI 标签网络按钮必须有运行态反馈');
assert.match(tagNetworkPage, /根据全部已同步 Stars 生成标签、关联和覆盖关系/, '标签网络页面必须说明 AI 会基于全部已同步 Stars 生成图谱，不能写成泛化知识图谱');
assert.match(tagNetworkPage, /const maxCloudRepoCount = useMemo\([\s\S]*?Math\.max\(\.\.\.cloudTags\.map\(\(tag\) => tag\.repoCount\), 1\)/, '标签云大小必须使用全部可见标签的最大仓库数，避免按字母或最近排序时热度尺寸失真');
assert.match(workspaceHook, /async function handleGenerateAiTagNetwork\(aiConfig: AISettings\)[\s\S]*?invoke<AiTagNetworkSummary>\('generate_ai_tag_network'/, 'AI 标签网络重试动作必须复用真实后端生成命令');
assert.match(workspaceHook, /async function handleGenerateAiTagNetwork\(aiConfig: AISettings\)[\s\S]*?await refreshRepositoryWorkspace\(\)/, 'AI 标签网络生成后必须刷新仓库和标签工作区');
assert.match(workspaceHook, /handleGenerateAiTagNetwork,[\s\S]*?isGeneratingTagNetwork,/, 'workspace 必须暴露 AI 标签网络生成动作和运行态');
assert.match(tagNetworkPage, /await workspace\.handleGenerateAiTagNetwork\(settingsHook\.settings\.ai\)/, 'AI 标签网络页面必须复用 workspace 动作，确保失败卡重试与页面按钮走同一条链路');
assert.match(tagNetworkPage, /setReloadKey\(\(current\) => current \+ 1\)/, 'AI 标签网络生成后必须重新读取图谱数据');
assert.match(tagNetworkPage, /AI 标签网络已生成：\$\{summary\.tagCount\} 个标签，\$\{summary\.linkedCount\} 条仓库关联/, 'AI 标签网络生成成功后必须展示真实写入数量');
assert.match(tagNetworkPage, /summary\.failedBatchCount > 0[\s\S]*?可稍后重试补全/, 'AI 标签网络部分批次失败时必须在前端成功提示中说明可重试补全');
assert.doesNotMatch(tagNetworkPage, /limit:\s*1000/, 'AI 标签网络前端默认必须处理全部 Stars，不能静默限制到 1000 个');
assert.match(tauriLib, /正在基于 \{\} 个 Stars 简略信息生成标签网络，预计分 \{\} 批处理[\s\S]*?repositories\.len\(\),[\s\S]*?batch_total/, 'AI 标签网络开始进度必须按批次展示总量，避免先用仓库数后用批次数导致进度跳动');
assert.match(tauriLib, /连续 3 个批次失败，已停止处理剩余 \{remaining_batch_count\} 个批次/, 'AI 标签网络连续失败提前停止时必须说明剩余未处理批次');
assert.match(tauriLib, /if summary\.linked_count == 0 \{[\s\S]*?模型返回的仓库名称未匹配到本地 Stars[\s\S]*?summary\.skipped_repository_count/, 'AI 标签网络没有任何真实仓库关联时必须返回失败，不能把空标签图谱当成功');
assert.match(tauriLib, /fn build_ai_tag_network_completion_progress\([\s\S]*?if summary\.failed_batch_count > 0 \{[\s\S]*?TaskProgressEvent::partial\("generate-ai-tag-network"[\s\S]*?TaskProgressEvent::succeeded\("generate-ai-tag-network"/, 'AI 标签网络部分批次失败必须发 partial 进度状态，成功时才发 succeeded');
assert.match(tauriLib, /ai_tag_network_completion_progress_uses_partial_status_for_batch_failures/, 'AI 标签网络部分失败进度状态必须有 Rust 单元测试覆盖');
assert.match(
  tauriLib,
  /let limit = request\.limit\.map\(\|value\| value\.clamp\(1, 1000\)\);[\s\S]*?list_repository_tagging_sources\(&request\.account_id, limit\)/,
  'AI 标签网络后端必须把缺省 limit 作为全量处理，仅显式 limit 才截断',
);
assert.match(
  tauriLib,
  /let mut failed_batch_count = 0_usize;[\s\S]*?Err\(error\) => \{[\s\S]*?failed_batch_count \+= 1;[\s\S]*?failures\.push\(failure_message\.clone\(\)\)[\s\S]*?failures\.push\(format!\([\s\S]*?连续 3 个批次失败[\s\S]*?failed_batch_count,/,
  'AI 标签网络失败批次数必须单独统计实际失败批次，停止剩余批次说明不能被计入失败批次数',
);
assert.match(
  storageSource,
  /fn list_repository_tagging_sources_reads_all_repositories_without_limit/,
  'AI 标签网络全量读取必须有 Rust 单元测试覆盖',
);
assert.match(
  storageSource,
  /fn ai_tag_assignments_do_not_create_empty_tags_for_unmatched_repositories[\s\S]*?assert_eq!\(summary\.tag_count, 0\)[\s\S]*?assert_eq!\(rows\.trim\(\), "0,0"\)/,
  'AI 标签网络写库必须有单元测试证明全未命中仓库时不会创建空标签',
);
assert.match(
  aiSource,
  /fn parse_tag_network_document_matches_repository_full_names_robustly[\s\S]*?HTTPS:\/\/github\.com\/owner\/react-ui\.git[\s\S]*?`owner\/react-ui`[\s\S]*?vec!\["Owner\/React-UI"\]/,
  'AI 标签网络解析层必须能把模型返回的 URL、小写或反引号仓库名匹配回本地 Stars，不能在写库前误丢弃真实仓库',
);
assert.match(tauriLib, /fn ai_tag_assignments_are_merged_across_batches/, 'AI 标签网络跨批次合并必须有 Rust 单元测试覆盖');

console.log('Task feedback verification passed.');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
