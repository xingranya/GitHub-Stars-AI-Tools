mod ai;
mod auth;
mod github;
mod storage;

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
    thread,
};
use storage::AppStorage;
use tauri::Emitter;

const TASK_PROGRESS_EVENT: &str = "task-progress";
const README_FETCH_CONCURRENCY: usize = 6;
const AI_API_KEY_SERVICE: &str = "github-stars-ai-tools";
const AI_API_KEY_ACCOUNT: &str = "ai-api-key";
static RUNNING_BACKGROUND_TASK: OnceLock<Mutex<Option<&'static str>>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    backend: &'static str,
    storage: &'static str,
    worker: &'static str,
    provider: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StarSyncSummary {
    account_login: String,
    active_count: usize,
    created_count: usize,
    updated_count: usize,
    removed_count: usize,
    scanned_count: usize,
    mode: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadmeFetchSummary {
    total_count: usize,
    fetched_count: usize,
    skipped_count: usize,
    missing_count: usize,
    failed_count: usize,
    failures: Vec<ReadmeFetchFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadmeFetchFailure {
    repository_id: String,
    full_name: String,
    error: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncGithubStarsRequest {
    force_full: Option<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskProgressEvent {
    task_id: &'static str,
    task_type: &'static str,
    status: &'static str,
    stage: &'static str,
    current: usize,
    total: usize,
    message: String,
    repository_name: Option<String>,
}

impl TaskProgressEvent {
    fn running(
        task_id: &'static str,
        task_type: &'static str,
        stage: &'static str,
        current: usize,
        total: usize,
        message: impl Into<String>,
        repository_name: Option<String>,
    ) -> Self {
        Self {
            task_id,
            task_type,
            status: "running",
            stage,
            current,
            total,
            message: message.into(),
            repository_name,
        }
    }

    fn succeeded(
        task_id: &'static str,
        task_type: &'static str,
        current: usize,
        total: usize,
        message: impl Into<String>,
    ) -> Self {
        Self {
            task_id,
            task_type,
            status: "succeeded",
            stage: "done",
            current,
            total,
            message: message.into(),
            repository_name: None,
        }
    }
}

fn emit_task_progress(app_handle: &tauri::AppHandle, payload: TaskProgressEvent) {
    let _ = app_handle.emit(TASK_PROGRESS_EVENT, payload);
}

struct BackgroundTaskGuard {
    task_label: &'static str,
}

impl Drop for BackgroundTaskGuard {
    fn drop(&mut self) {
        if let Ok(mut running_task) = running_background_task().lock() {
            if running_task.as_deref() == Some(self.task_label) {
                *running_task = None;
            }
        }
    }
}

fn running_background_task() -> &'static Mutex<Option<&'static str>> {
    RUNNING_BACKGROUND_TASK.get_or_init(|| Mutex::new(None))
}

fn acquire_background_task(task_label: &'static str) -> Result<BackgroundTaskGuard, String> {
    let mut running_task = running_background_task()
        .lock()
        .map_err(|_| "后台任务状态异常，请重启应用后重试".to_owned())?;

    if let Some(current_task_label) = running_task.as_deref() {
        return Err(format!(
            "{current_task_label}正在执行，请等待当前任务完成后再开始新任务"
        ));
    }

    *running_task = Some(task_label);
    Ok(BackgroundTaskGuard { task_label })
}

async fn run_background_task<T, F>(task_label: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let guard = acquire_background_task(task_label)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        operation()
    })
    .await
    .map_err(|error| format!("{task_label}后台任务执行失败：{error}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GistAnnotationExportSummary {
    gist_id: String,
    html_url: String,
    tag_count: usize,
    repository_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GistAnnotationImportSummary {
    tag_count: usize,
    repository_count: usize,
    skipped_repository_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryListRequest {
    limit: Option<usize>,
    offset: Option<usize>,
    account_id: String,
    keyword: Option<String>,
    language: Option<String>,
    tag_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTagsRequest {
    account_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTagRequest {
    account_id: String,
    name: String,
    color: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTagRequest {
    account_id: String,
    tag_id: String,
    name: String,
    color: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteTagRequest {
    account_id: String,
    tag_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryAnnotationRequest {
    account_id: String,
    repository_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryDetailRequest {
    account_id: String,
    repository_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRepositoryAnnotationRequest {
    account_id: String,
    repository_id: String,
    note_markdown: String,
    reading_status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetRepositoryTagsRequest {
    account_id: String,
    repository_id: String,
    tag_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAiDocumentRequest {
    repository_id: String,
    account_id: Option<String>,
    ai_config: ai::AiRequestConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchGenerateAiDocumentsRequest {
    ai_config: ai::AiRequestConfig,
    limit: Option<usize>,
    only_missing: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAiTagNetworkRequest {
    account_id: String,
    ai_config: ai::AiRequestConfig,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestAiConnectionRequest {
    ai_config: ai::AiRequestConfig,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchAiDocumentSummary {
    total_count: usize,
    generated_count: usize,
    skipped_count: usize,
    missing_readme_count: usize,
    failed_count: usize,
    failures: Vec<BatchAiDocumentFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchAiDocumentFailure {
    repository_id: String,
    full_name: String,
    error: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRepositoriesRequest {
    query: String,
    limit: Option<usize>,
    account_id: String,
    context_queries: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecommendGithubRepositoriesRequest {
    account_id: String,
    repository_ids: Vec<String>,
    ai_config: ai::AiRequestConfig,
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubRecommendationResponse {
    rationale_zh: String,
    queries: Vec<String>,
    results: Vec<github::GitHubRepositoryRecommendation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportAnnotationGistRequest {
    gist_id: String,
}

#[tauri::command]
fn get_backend_status() -> BackendStatus {
    BackendStatus {
        backend: "Rust 本地后端已就绪",
        storage: "SQLite 已接入",
        worker: "后台任务线程池已接入",
        provider: "OpenAI / Anthropic 兼容 AI Provider 已接入",
    }
}

#[tauri::command]
fn get_github_auth_state(app_handle: tauri::AppHandle) -> Result<auth::GitHubAuthState, String> {
    let auth_check = auth::get_auth_state_check()?;
    if auth_check.state.user.is_some() || !auth_check.state.has_token {
        return Ok(auth_check.state);
    }

    if !auth_check
        .verification_error
        .as_deref()
        .is_some_and(auth::can_restore_cached_user_after_auth_error)
    {
        return Ok(auth_check.state);
    }

    let storage = AppStorage::from_app_handle(&app_handle)?;
    Ok(auth::GitHubAuthState {
        has_token: true,
        user: storage.get_recent_github_account()?,
    })
}

#[tauri::command]
fn save_github_token(
    app_handle: tauri::AppHandle,
    token: String,
) -> Result<auth::GitHubUser, String> {
    let user = auth::save_github_token(token)?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.upsert_github_account(&user)?;
    Ok(user)
}

#[tauri::command]
fn clear_github_token() -> Result<(), String> {
    auth::clear_github_token()
}

#[tauri::command]
fn get_ai_api_key() -> Result<Option<String>, String> {
    auth::read_secure_password(AI_API_KEY_SERVICE, AI_API_KEY_ACCOUNT)
}

#[tauri::command]
fn save_ai_api_key(api_key: String) -> Result<(), String> {
    auth::save_secure_password(AI_API_KEY_SERVICE, AI_API_KEY_ACCOUNT, &api_key)
}

#[tauri::command]
fn clear_ai_api_key() -> Result<(), String> {
    auth::delete_secure_password(AI_API_KEY_SERVICE, AI_API_KEY_ACCOUNT)
}

#[tauri::command]
async fn test_ai_connection(
    request: TestAiConnectionRequest,
) -> Result<ai::AiSummaryDocument, String> {
    run_background_task("AI 配置测试", move || {
        test_ai_connection_worker(request)
    })
    .await
}

fn test_ai_connection_worker(
    request: TestAiConnectionRequest,
) -> Result<ai::AiSummaryDocument, String> {
    ai::summarize_readme(
        &request.ai_config,
        "example/ai-config-check",
        Some("用于验证 AI Provider 配置是否可以正常请求的测试仓库。"),
        r#"# AI Config Check

This repository is a short test fixture for validating an AI provider integration.
It contains a README, a small API surface, and a local-first desktop workflow.
"#,
    )
}

#[tauri::command]
async fn sync_github_stars(
    app_handle: tauri::AppHandle,
    request: Option<SyncGithubStarsRequest>,
) -> Result<StarSyncSummary, String> {
    let force_full = request
        .and_then(|request| request.force_full)
        .unwrap_or(false);
    run_background_task("Stars 同步", move || {
        sync_github_stars_worker(app_handle, force_full)
    })
    .await
}

fn sync_github_stars_worker(
    app_handle: tauri::AppHandle,
    force_full: bool,
) -> Result<StarSyncSummary, String> {
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "sync-stars",
            "sync",
            "auth",
            0,
            0,
            "正在校验 GitHub Token",
            None,
        ),
    );
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let account_id = user.id.to_string();
    storage.upsert_github_account(&user)?;
    let existing_states = storage.list_repository_sync_states(&account_id)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "sync-stars",
            "sync",
            "fetch",
            0,
            0,
            "正在从 GitHub 拉取 Stars",
            None,
        ),
    );
    let mut repositories = Vec::new();
    let mut page = 1_u32;
    let has_existing_active_repositories = !force_full
        && existing_states
            .values()
            .any(|sync_status| sync_status == "active");
    let mut completed_full_scan = true;

    loop {
        let page_items = github::fetch_starred_repositories_page(&token, &account_id, page)?;
        let page_len = page_items.len();
        let page_repository_ids = page_items
            .iter()
            .map(|repository| repository.id.clone())
            .collect::<Vec<_>>();
        let page_contains_only_known_active = should_stop_incremental_on_page(
            has_existing_active_repositories,
            &existing_states,
            &page_repository_ids,
        );
        storage.upsert_repositories(&page_items)?;
        repositories.extend(page_items);
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "sync-stars",
                "sync",
                "save",
                repositories.len(),
                0,
                format!("已同步 {} 个 Stars 到本地", repositories.len()),
                None,
            ),
        );

        if page_contains_only_known_active {
            completed_full_scan = false;
            emit_task_progress(
                &app_handle,
                TaskProgressEvent::running(
                    "sync-stars",
                    "sync",
                    "incremental-stop",
                    repositories.len(),
                    repositories.len(),
                    "已遇到本地已同步的 Stars 页面，本次增量同步提前完成",
                    None,
                ),
            );
            break;
        }

        if page_len < github::starred_page_size() {
            break;
        }

        page += 1;
    }

    let incoming_ids = repositories
        .iter()
        .map(|repository| repository.id.as_str())
        .collect::<HashSet<_>>();
    let created_count = repositories
        .iter()
        .filter(|repository| !existing_states.contains_key(repository.id.as_str()))
        .count();
    let updated_count = repositories.len().saturating_sub(created_count);
    let removed_ids =
        compute_removed_repository_ids(completed_full_scan, &existing_states, &incoming_ids);
    if completed_full_scan {
        storage.mark_repositories_removed(&account_id, &removed_ids)?;
    }
    let removed_count = removed_ids.len();
    let active_count = storage.count_active_repositories_for_account(&account_id)?;
    let sync_mode = if completed_full_scan {
        "full"
    } else {
        "incremental"
    };
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "sync-stars",
            "sync",
            repositories.len(),
            repositories.len(),
            format!(
                "同步完成：当前 {active_count} 个，新增 {created_count} 个，模式 {}",
                if completed_full_scan {
                    "全量"
                } else {
                    "增量"
                }
            ),
        ),
    );

    Ok(StarSyncSummary {
        account_login: user.login,
        active_count,
        created_count,
        updated_count,
        removed_count,
        scanned_count: repositories.len(),
        mode: sync_mode,
    })
}

fn should_stop_incremental_on_page(
    has_existing_active_repositories: bool,
    existing_states: &HashMap<String, String>,
    page_repository_ids: &[String],
) -> bool {
    has_existing_active_repositories
        && !page_repository_ids.is_empty()
        && page_repository_ids.iter().all(|repository_id| {
            existing_states
                .get(repository_id.as_str())
                .is_some_and(|sync_status| sync_status == "active")
        })
}

fn compute_removed_repository_ids(
    completed_full_scan: bool,
    existing_states: &HashMap<String, String>,
    incoming_ids: &HashSet<&str>,
) -> Vec<String> {
    if !completed_full_scan {
        return Vec::new();
    }

    existing_states
        .iter()
        .filter_map(|(repository_id, sync_status)| {
            (sync_status == "active" && !incoming_ids.contains(repository_id.as_str()))
                .then(|| repository_id.to_owned())
        })
        .collect()
}

#[tauri::command]
async fn fetch_repository_readmes(
    app_handle: tauri::AppHandle,
) -> Result<ReadmeFetchSummary, String> {
    run_background_task("README 抓取", move || {
        fetch_repository_readmes_worker(app_handle)
    })
    .await
}

#[tauri::command]
async fn fetch_repository_readme(
    app_handle: tauri::AppHandle,
    request: RepositoryDetailRequest,
) -> Result<storage::RepositoryDetailView, String> {
    run_background_task("单仓库 README 抓取", move || {
        fetch_repository_readme_worker(app_handle, request)
    })
    .await
}

fn fetch_repository_readme_worker(
    app_handle: tauri::AppHandle,
    request: RepositoryDetailRequest,
) -> Result<storage::RepositoryDetailView, String> {
    let token = auth::require_github_token()?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let source =
        storage.get_repository_ai_source(&request.repository_id, Some(&request.account_id))?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "fetch-repository-readme",
            "readme",
            "fetch",
            0,
            1,
            format!("正在抓取 {} 的 README", source.full_name),
            Some(source.full_name.clone()),
        ),
    );

    let readme = github::fetch_readme(&token, &source.id, &source.full_name)?
        .ok_or_else(|| format!("{} 没有可缓存的 README", source.full_name))?;
    storage.save_readme(&readme)?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "fetch-repository-readme",
            "readme",
            1,
            1,
            format!("{} 的 README 已缓存", source.full_name),
        ),
    );

    storage.get_repository_detail(&source.id, &source.account_id)
}

fn fetch_repository_readmes_worker(
    app_handle: tauri::AppHandle,
) -> Result<ReadmeFetchSummary, String> {
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let repositories = storage.list_active_repositories(Some(&account_id))?;
    let total_count = repositories.len();
    let mut fetched_count = 0_usize;
    let mut skipped_count = 0_usize;
    let mut missing_count = 0_usize;
    let mut failures = Vec::new();

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "fetch-readmes",
            "readme",
            "fetch",
            0,
            total_count,
            format!("正在并发抓取仓库 README（最多 {README_FETCH_CONCURRENCY} 个并行请求）"),
            None,
        ),
    );

    let mut processed_count = 0_usize;
    let mut repository_iter = repositories.into_iter();

    loop {
        let batch = repository_iter
            .by_ref()
            .take(README_FETCH_CONCURRENCY)
            .collect::<Vec<_>>();

        if batch.is_empty() {
            break;
        }

        let handles = batch
            .into_iter()
            .map(|repository| {
                let token = token.clone();
                thread::spawn(move || {
                    let result =
                        github::fetch_readme(&token, &repository.id, &repository.full_name);
                    (repository, result)
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            let (repository, result) = match handle.join() {
                Ok(output) => output,
                Err(_) => {
                    processed_count += 1;
                    failures.push(ReadmeFetchFailure {
                        repository_id: "unknown".to_owned(),
                        full_name: "未知仓库".to_owned(),
                        error: "README 抓取线程异常退出".to_owned(),
                    });
                    continue;
                }
            };

            processed_count += 1;
            emit_task_progress(
                &app_handle,
                TaskProgressEvent::running(
                    "fetch-readmes",
                    "readme",
                    "fetch",
                    processed_count,
                    total_count,
                    format!("已处理 {}", repository.full_name),
                    Some(repository.full_name.clone()),
                ),
            );

            match result {
                Ok(Some(readme)) => match storage.get_readme_hash(&repository.id) {
                    Ok(existing_hash)
                        if existing_hash.as_deref() == Some(readme.content_hash.as_str()) =>
                    {
                        skipped_count += 1;
                    }
                    Ok(_) => match storage.save_readme(&readme) {
                        Ok(()) => fetched_count += 1,
                        Err(error) => failures.push(ReadmeFetchFailure {
                            repository_id: repository.id,
                            full_name: repository.full_name,
                            error,
                        }),
                    },
                    Err(error) => failures.push(ReadmeFetchFailure {
                        repository_id: repository.id,
                        full_name: repository.full_name,
                        error,
                    }),
                },
                Ok(None) => missing_count += 1,
                Err(error) => failures.push(ReadmeFetchFailure {
                    repository_id: repository.id,
                    full_name: repository.full_name,
                    error,
                }),
            }
        }
    }
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "fetch-readmes",
            "readme",
            total_count,
            total_count,
            format!(
                "README 处理完成：更新 {fetched_count} 个，跳过 {skipped_count} 个，失败 {} 个",
                failures.len()
            ),
        ),
    );

    let failed_count = failures.len();
    Ok(ReadmeFetchSummary {
        total_count,
        fetched_count,
        skipped_count,
        missing_count,
        failed_count,
        failures,
    })
}

#[tauri::command]
fn list_repositories(
    app_handle: tauri::AppHandle,
    request: RepositoryListRequest,
) -> Result<storage::RepositoryListPage, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.list_repository_page(
        request.limit.unwrap_or(1000),
        request.offset.unwrap_or(0),
        storage::RepositoryListFilters {
            account_id: Some(&request.account_id),
            keyword: request.keyword.as_deref(),
            language: request.language.as_deref(),
            tag_id: request.tag_id.as_deref(),
        },
    )
}

#[tauri::command]
fn list_repository_languages(
    app_handle: tauri::AppHandle,
    request: ListTagsRequest,
) -> Result<Vec<String>, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.list_repository_languages(Some(&request.account_id))
}

#[tauri::command]
fn get_repository_detail(
    app_handle: tauri::AppHandle,
    request: RepositoryDetailRequest,
) -> Result<storage::RepositoryDetailView, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.get_repository_detail(&request.repository_id, &request.account_id)
}

#[tauri::command]
fn list_tags(
    app_handle: tauri::AppHandle,
    request: ListTagsRequest,
) -> Result<Vec<storage::TagItem>, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.list_tags(&request.account_id)
}

#[tauri::command]
fn create_tag(
    app_handle: tauri::AppHandle,
    request: CreateTagRequest,
) -> Result<storage::TagItem, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.create_tag(&request.account_id, &request.name, request.color.as_deref())
}

#[tauri::command]
fn update_tag(
    app_handle: tauri::AppHandle,
    request: UpdateTagRequest,
) -> Result<storage::TagItem, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.update_tag(
        &request.account_id,
        &request.tag_id,
        &request.name,
        request.color.as_deref(),
    )
}

#[tauri::command]
fn delete_tag(app_handle: tauri::AppHandle, request: DeleteTagRequest) -> Result<(), String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.delete_tag(&request.account_id, &request.tag_id)
}

#[tauri::command]
fn get_repository_annotation(
    app_handle: tauri::AppHandle,
    request: RepositoryAnnotationRequest,
) -> Result<storage::RepositoryAnnotationView, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.get_repository_annotation(&request.repository_id, &request.account_id)
}

#[tauri::command]
fn save_repository_annotation(
    app_handle: tauri::AppHandle,
    request: SaveRepositoryAnnotationRequest,
) -> Result<storage::RepositoryAnnotationView, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.save_repository_annotation(
        &request.repository_id,
        &request.account_id,
        &request.note_markdown,
        &request.reading_status,
    )
}

#[tauri::command]
fn set_repository_tags(
    app_handle: tauri::AppHandle,
    request: SetRepositoryTagsRequest,
) -> Result<storage::RepositoryAnnotationView, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.set_repository_tags(
        &request.repository_id,
        &request.account_id,
        &request.tag_ids,
    )
}

#[tauri::command]
fn get_dashboard_stats(
    app_handle: tauri::AppHandle,
    request: ListTagsRequest,
) -> Result<storage::DashboardStatsData, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.get_dashboard_stats(Some(&request.account_id))
}

#[tauri::command]
fn get_tag_network_data(
    app_handle: tauri::AppHandle,
    request: ListTagsRequest,
) -> Result<storage::TagNetworkData, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.get_tag_network_data(Some(&request.account_id))
}

#[tauri::command]
async fn generate_ai_tag_network(
    app_handle: tauri::AppHandle,
    request: GenerateAiTagNetworkRequest,
) -> Result<storage::ApplyAiTagAssignmentsSummary, String> {
    run_background_task("AI 标签网络生成", move || {
        generate_ai_tag_network_worker(app_handle, request)
    })
    .await
}

fn generate_ai_tag_network_worker(
    app_handle: tauri::AppHandle,
    request: GenerateAiTagNetworkRequest,
) -> Result<storage::ApplyAiTagAssignmentsSummary, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let limit = request.limit.unwrap_or(500).clamp(1, 1000);
    let sources = storage.list_repository_tagging_sources(&request.account_id, limit)?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "generate-ai-tag-network",
            "ai",
            "analyze",
            0,
            sources.len(),
            "正在基于 Stars 简略信息生成标签网络",
            None,
        ),
    );

    let repositories = sources
        .into_iter()
        .map(|source| ai::AiTagRepositoryBrief {
            full_name: source.full_name,
            description: source.description,
            language: source.language,
            topics: source.topics,
            ai_summary: source.ai_summary,
            suggested_tags: source.suggested_tags,
            stars_count: source.stars_count,
        })
        .collect::<Vec<_>>();
    let suggestions = ai::generate_tag_network(&request.ai_config, &repositories)?;
    let assignments = suggestions
        .into_iter()
        .map(|suggestion| storage::AiTagAssignment {
            tag_name: suggestion.tag_name,
            color: suggestion.color,
            repository_full_names: suggestion.repository_full_names,
        })
        .collect::<Vec<_>>();
    let summary = storage.apply_ai_tag_assignments(&request.account_id, &assignments)?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "generate-ai-tag-network",
            "ai",
            summary.linked_count,
            summary.linked_count,
            format!(
                "AI 标签网络已生成：{} 个标签，{} 条仓库关联",
                summary.tag_count, summary.linked_count
            ),
        ),
    );

    Ok(summary)
}

#[tauri::command]
fn get_profile_stats(
    app_handle: tauri::AppHandle,
    request: Option<ListTagsRequest>,
) -> Result<storage::ProfileStatsData, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    // 使用传入的 account_id 或尝试从 auth state 获取
    let account_id = match request {
        Some(req) => req.account_id,
        None => {
            let token = auth::require_github_token()?;
            let user = auth::verify_github_token(&token)?;
            user.id.to_string()
        }
    };
    storage.get_profile_stats(&account_id)
}

#[tauri::command]
async fn generate_repository_ai_document(
    app_handle: tauri::AppHandle,
    request: GenerateAiDocumentRequest,
) -> Result<storage::RepositoryDetailView, String> {
    run_background_task("AI 摘要生成", move || {
        generate_repository_ai_document_worker(app_handle, request)
    })
    .await
}

fn generate_repository_ai_document_worker(
    app_handle: tauri::AppHandle,
    request: GenerateAiDocumentRequest,
) -> Result<storage::RepositoryDetailView, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let account_id = match request.account_id {
        Some(account_id) => account_id,
        None => {
            let token = auth::require_github_token()?;
            let user = auth::verify_github_token(&token)?;
            user.id.to_string()
        }
    };
    let mut source = storage.get_repository_ai_source(&request.repository_id, Some(&account_id))?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "generate-ai-document",
            "ai",
            "prepare",
            0,
            1,
            format!("正在准备 {}", source.full_name),
            Some(source.full_name.clone()),
        ),
    );
    let readme = match source.readme.take() {
        Some(readme) => readme,
        None => {
            let token = auth::require_github_token()?;
            let fetched = github::fetch_readme(&token, &source.id, &source.full_name)?
                .ok_or_else(|| "该仓库没有可用于 AI 摘要的 README".to_owned())?;
            let content_hash = fetched.content_hash.clone();
            let raw_markdown = fetched.raw_markdown.clone();
            let source_path = fetched.source_path.clone();
            let fetched_at = fetched.fetched_at.clone();
            storage.save_readme(&fetched)?;
            storage::RepositoryReadmeView {
                raw_markdown,
                content_hash,
                source_path,
                fetched_at,
            }
        }
    };
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "generate-ai-document",
            "ai",
            "summarize",
            0,
            1,
            format!("正在生成 {} 的 AI 摘要", source.full_name),
            Some(source.full_name.clone()),
        ),
    );
    let document = ai::summarize_readme(
        &request.ai_config,
        &source.full_name,
        source.description.as_deref(),
        &readme.raw_markdown,
    )?;

    storage.save_repository_ai_document(
        &source.id,
        &document.summary_zh,
        document.readme_zh.as_deref(),
        &document.keywords,
        &document.suggested_tags,
        &document.model,
        &document.prompt_version,
        &readme.content_hash,
    )?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "generate-ai-document",
            "ai",
            1,
            1,
            format!("{} 的 AI 摘要已生成", source.full_name),
        ),
    );
    storage.get_repository_detail(&source.id, &source.account_id)
}

#[tauri::command]
async fn batch_generate_repository_ai_documents(
    app_handle: tauri::AppHandle,
    request: BatchGenerateAiDocumentsRequest,
) -> Result<BatchAiDocumentSummary, String> {
    run_background_task("批量 AI 摘要生成", move || {
        batch_generate_repository_ai_documents_worker(app_handle, request)
    })
    .await
}

fn batch_generate_repository_ai_documents_worker(
    app_handle: tauri::AppHandle,
    request: BatchGenerateAiDocumentsRequest,
) -> Result<BatchAiDocumentSummary, String> {
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let repositories = storage.list_active_repositories(Some(&account_id))?;
    let limit = request.limit.unwrap_or(20).clamp(1, 200);
    let only_missing = request.only_missing.unwrap_or(true);
    let progress_total = repositories.len();
    let mut scanned_count = 0_usize;
    let mut processed_count = 0_usize;
    let mut generated_count = 0_usize;
    let mut skipped_count = 0_usize;
    let mut missing_readme_count = 0_usize;
    let mut failures = Vec::new();

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "batch-generate-ai-documents",
            "ai",
            "batch",
            0,
            progress_total,
            "正在批量生成 AI 摘要",
            None,
        ),
    );

    for repository in repositories {
        if processed_count >= limit {
            break;
        }

        scanned_count += 1;
        let repository_name = repository.full_name.clone();
        let mut source = storage.get_repository_ai_source(&repository.id, Some(&account_id))?;
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "batch-generate-ai-documents",
                "ai",
                "batch",
                scanned_count,
                progress_total,
                format!("正在检查 {}", repository_name),
                Some(repository_name.clone()),
            ),
        );
        if only_missing {
            if let Some(readme) = source.readme.as_ref() {
                if storage.get_ai_document_source_hash(&source.id)?.as_deref()
                    == Some(readme.content_hash.as_str())
                {
                    skipped_count += 1;
                    continue;
                }
            }
        }

        processed_count += 1;
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "batch-generate-ai-documents",
                "ai",
                "batch",
                scanned_count,
                progress_total,
                format!("正在分析 {}", repository_name),
                Some(repository_name.clone()),
            ),
        );
        let result = (|| -> Result<BatchItemOutcome, String> {
            let readme = match source.readme.take() {
                Some(readme) => readme,
                None => {
                    let Some(fetched) =
                        github::fetch_readme(&token, &source.id, &source.full_name)?
                    else {
                        return Ok(BatchItemOutcome::MissingReadme);
                    };
                    let readme_view = storage::RepositoryReadmeView {
                        raw_markdown: fetched.raw_markdown.clone(),
                        content_hash: fetched.content_hash.clone(),
                        source_path: fetched.source_path.clone(),
                        fetched_at: fetched.fetched_at.clone(),
                    };
                    storage.save_readme(&fetched)?;
                    readme_view
                }
            };

            if only_missing
                && storage.get_ai_document_source_hash(&source.id)?.as_deref()
                    == Some(readme.content_hash.as_str())
            {
                return Ok(BatchItemOutcome::Skipped);
            }

            let document = ai::summarize_readme(
                &request.ai_config,
                &source.full_name,
                source.description.as_deref(),
                &readme.raw_markdown,
            )?;
            storage.save_repository_ai_document(
                &source.id,
                &document.summary_zh,
                document.readme_zh.as_deref(),
                &document.keywords,
                &document.suggested_tags,
                &document.model,
                &document.prompt_version,
                &readme.content_hash,
            )?;

            Ok(BatchItemOutcome::Generated)
        })();

        match result {
            Ok(BatchItemOutcome::Generated) => generated_count += 1,
            Ok(BatchItemOutcome::Skipped) => skipped_count += 1,
            Ok(BatchItemOutcome::MissingReadme) => missing_readme_count += 1,
            Err(error) => failures.push(BatchAiDocumentFailure {
                repository_id: repository.id,
                full_name: repository.full_name,
                error,
            }),
        }
    }
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "batch-generate-ai-documents",
            "ai",
            progress_total,
            progress_total,
            format!(
                "批量 AI 完成：生成 {generated_count} 个，跳过 {skipped_count} 个，失败 {} 个",
                failures.len(),
            ),
        ),
    );

    Ok(BatchAiDocumentSummary {
        total_count: scanned_count,
        generated_count,
        skipped_count,
        missing_readme_count,
        failed_count: failures.len(),
        failures,
    })
}

enum BatchItemOutcome {
    Generated,
    Skipped,
    MissingReadme,
}

#[tauri::command]
async fn search_repositories(
    app_handle: tauri::AppHandle,
    request: SearchRepositoriesRequest,
) -> Result<storage::AiSearchResponseData, String> {
    tauri::async_runtime::spawn_blocking(move || search_repositories_worker(app_handle, request))
        .await
        .map_err(|error| format!("本地知识搜索后台任务执行失败：{error}"))?
}

fn search_repositories_worker(
    app_handle: tauri::AppHandle,
    request: SearchRepositoriesRequest,
) -> Result<storage::AiSearchResponseData, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;

    storage.search_repositories(
        &request.query,
        request.context_queries.as_deref().unwrap_or(&[]),
        request.limit.unwrap_or(20),
        Some(&request.account_id),
    )
}

#[tauri::command]
async fn recommend_github_repositories(
    app_handle: tauri::AppHandle,
    request: RecommendGithubRepositoriesRequest,
) -> Result<GithubRecommendationResponse, String> {
    run_background_task("GitHub 相似项目发现", move || {
        recommend_github_repositories_worker(app_handle, request)
    })
    .await
}

fn recommend_github_repositories_worker(
    app_handle: tauri::AppHandle,
    request: RecommendGithubRepositoriesRequest,
) -> Result<GithubRecommendationResponse, String> {
    if request.repository_ids.is_empty() {
        return Err("请先选择至少一个仓库".to_owned());
    }

    let token = auth::require_github_token()?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let sources = storage
        .list_repository_tagging_sources_by_ids(&request.account_id, &request.repository_ids)?;
    if sources.is_empty() {
        return Err("选中的仓库不存在或不属于当前账号".to_owned());
    }

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "recommend-github-repositories",
            "ai",
            "plan",
            0,
            sources.len(),
            "正在根据选中仓库生成 GitHub 搜索策略",
            None,
        ),
    );

    let selected_full_names = sources
        .iter()
        .map(|source| source.full_name.clone())
        .collect::<HashSet<_>>();
    let existing_full_names = storage.list_active_repository_full_names(&request.account_id)?;
    let briefs = sources
        .into_iter()
        .map(|source| ai::AiTagRepositoryBrief {
            full_name: source.full_name,
            description: source.description,
            language: source.language,
            topics: source.topics,
            ai_summary: source.ai_summary,
            suggested_tags: source.suggested_tags,
            stars_count: source.stars_count,
        })
        .collect::<Vec<_>>();
    let plan = ai::plan_github_recommendations(&request.ai_config, &briefs)?;
    let limit = request.limit.unwrap_or(12).clamp(1, 30);
    let per_query = ((limit + plan.queries.len()).max(6) / plan.queries.len()).clamp(5, 10);
    let mut seen_full_names = HashSet::new();
    let mut results = Vec::new();

    for (index, query) in plan.queries.iter().enumerate() {
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "recommend-github-repositories",
                "ai",
                "github-search",
                index,
                plan.queries.len(),
                format!("正在搜索 GitHub：{query}"),
                None,
            ),
        );

        for repository in github::search_repositories(&token, query, per_query)? {
            if selected_full_names.contains(&repository.full_name)
                || existing_full_names.contains(&repository.full_name)
                || !seen_full_names.insert(repository.full_name.clone())
            {
                continue;
            }

            results.push(repository);
            if results.len() >= limit {
                break;
            }
        }

        if results.len() >= limit {
            break;
        }
    }

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "recommend-github-repositories",
            "ai",
            results.len(),
            limit,
            format!("已找到 {} 个 GitHub 候选项目", results.len()),
        ),
    );

    Ok(GithubRecommendationResponse {
        rationale_zh: plan.rationale_zh,
        queries: plan.queries,
        results,
    })
}

#[tauri::command]
async fn export_annotation_gist(
    app_handle: tauri::AppHandle,
) -> Result<GistAnnotationExportSummary, String> {
    run_background_task("Gist 注解导出", move || {
        export_annotation_gist_worker(app_handle)
    })
    .await
}

fn export_annotation_gist_worker(
    app_handle: tauri::AppHandle,
) -> Result<GistAnnotationExportSummary, String> {
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let snapshot = storage.export_annotation_snapshot(&account_id)?;
    let tag_count = snapshot.tags.len();
    let repository_count = snapshot.repositories.len();
    let snapshot_json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("注解快照序列化失败：{error}"))?;
    let gist = github::create_annotation_gist(&token, &snapshot_json)?;

    Ok(GistAnnotationExportSummary {
        gist_id: gist.gist_id,
        html_url: gist.html_url,
        tag_count,
        repository_count,
    })
}

#[tauri::command]
async fn import_annotation_gist(
    app_handle: tauri::AppHandle,
    request: ImportAnnotationGistRequest,
) -> Result<GistAnnotationImportSummary, String> {
    run_background_task("Gist 注解导入", move || {
        import_annotation_gist_worker(app_handle, request)
    })
    .await
}

fn import_annotation_gist_worker(
    app_handle: tauri::AppHandle,
    request: ImportAnnotationGistRequest,
) -> Result<GistAnnotationImportSummary, String> {
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let snapshot_json = github::fetch_annotation_gist(&token, &request.gist_id)?;
    let snapshot = serde_json::from_str::<storage::AnnotationSnapshot>(&snapshot_json)
        .map_err(|error| format!("注解快照解析失败：{error}"))?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let summary = storage.import_annotation_snapshot(&account_id, &snapshot)?;

    Ok(GistAnnotationImportSummary {
        tag_count: summary.tag_count,
        repository_count: summary.repository_count,
        skipped_repository_count: summary.skipped_repository_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            get_github_auth_state,
            save_github_token,
            clear_github_token,
            get_ai_api_key,
            save_ai_api_key,
            clear_ai_api_key,
            test_ai_connection,
            sync_github_stars,
            fetch_repository_readme,
            fetch_repository_readmes,
            list_repositories,
            list_repository_languages,
            get_repository_detail,
            list_tags,
            create_tag,
            update_tag,
            delete_tag,
            get_repository_annotation,
            save_repository_annotation,
            set_repository_tags,
            export_annotation_gist,
            import_annotation_gist,
            get_dashboard_stats,
            get_tag_network_data,
            generate_ai_tag_network,
            get_profile_stats,
            generate_repository_ai_document,
            batch_generate_repository_ai_documents,
            search_repositories,
            recommend_github_repositories,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用运行失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sync_states(values: &[(&str, &str)]) -> HashMap<String, String> {
        values
            .iter()
            .map(|(id, status)| ((*id).to_owned(), (*status).to_owned()))
            .collect()
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn incremental_sync_stops_on_page_with_only_known_active_repositories() {
        let existing_states = sync_states(&[("account:1", "active"), ("account:2", "active")]);

        assert!(should_stop_incremental_on_page(
            true,
            &existing_states,
            &ids(&["account:1", "account:2"]),
        ));
    }

    #[test]
    fn incremental_sync_continues_when_page_contains_new_or_removed_repository() {
        let existing_states = sync_states(&[("account:1", "active"), ("account:2", "removed")]);

        assert!(!should_stop_incremental_on_page(
            true,
            &existing_states,
            &ids(&["account:1", "account:3"]),
        ));
        assert!(!should_stop_incremental_on_page(
            true,
            &existing_states,
            &ids(&["account:1", "account:2"]),
        ));
    }

    #[test]
    fn removed_repositories_are_computed_only_after_full_scan() {
        let existing_states = sync_states(&[
            ("account:1", "active"),
            ("account:2", "active"),
            ("account:3", "removed"),
        ]);
        let incoming_ids = HashSet::from(["account:1"]);
        let mut removed_ids = compute_removed_repository_ids(true, &existing_states, &incoming_ids);
        removed_ids.sort();

        assert_eq!(removed_ids, vec!["account:2".to_owned()]);
        assert!(compute_removed_repository_ids(false, &existing_states, &incoming_ids).is_empty());
    }
}
