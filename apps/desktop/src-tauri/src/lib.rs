mod ai;
mod auth;
mod github;
mod ranking_query;
mod storage;
mod vector_index;

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use storage::AppStorage;
use tauri::{Emitter, Manager};

const TASK_PROGRESS_EVENT: &str = "task-progress";
const AI_STREAM_EVENT: &str = "ai-stream";
const README_FETCH_CONCURRENCY: usize = 6;
const GITHUB_RECOMMENDATION_REFERENCE_LIMIT: usize = 8;
const VECTOR_MODEL_VERSION: &str = "repository-knowledge-v1";
const AI_API_KEY_SERVICE: &str = "github-stars-ai-tools";
const EMBEDDING_API_KEY_ACCOUNT: &str = "embedding-api-key:openai-compatible";
const AI_API_KEY_PROVIDER_ACCOUNTS: &[&str] = &[
    "ai-api-key:openai",
    "ai-api-key:openai-compatible",
    "ai-api-key:anthropic",
];
const APP_SETTINGS_FILE: &str = "settings.json";
const GITHUB_AUTH_STATE_TOTAL_TIMEOUT_SECONDS: u64 = 25;
const GITHUB_CONNECT_TOTAL_TIMEOUT_SECONDS: u64 = 25;
static BACKGROUND_TASK_QUEUE: OnceLock<(Mutex<BackgroundTaskQueueState>, Condvar)> =
    OnceLock::new();

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
struct FetchReadmesRequest {
    only_missing: Option<bool>,
    repository_ids: Option<Vec<String>>,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AiStreamEvent {
    request_id: String,
    task_type: &'static str,
    stage: String,
    status: String,
    delta: Option<String>,
    text: Option<String>,
    message: Option<String>,
    repository_id: Option<String>,
    created_at: String,
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

    fn partial(
        task_id: &'static str,
        task_type: &'static str,
        current: usize,
        total: usize,
        message: impl Into<String>,
    ) -> Self {
        Self {
            task_id,
            task_type,
            status: "partial",
            stage: "partial-failure",
            current,
            total,
            message: message.into(),
            repository_name: None,
        }
    }

    fn failed(task_id: &'static str, task_type: &'static str, message: impl Into<String>) -> Self {
        Self {
            task_id,
            task_type,
            status: "failed",
            stage: "error",
            current: 0,
            total: 0,
            message: message.into(),
            repository_name: None,
        }
    }
}

fn emit_task_progress(app_handle: &tauri::AppHandle, payload: TaskProgressEvent) {
    let _ = app_handle.emit(TASK_PROGRESS_EVENT, payload);
}

fn emit_ai_stream(app_handle: &tauri::AppHandle, payload: AiStreamEvent) {
    let _ = app_handle.emit(AI_STREAM_EVENT, payload);
}

fn emit_ai_stream_status(
    app_handle: &tauri::AppHandle,
    request_id: &str,
    task_type: &'static str,
    stage: &str,
    status: &str,
    message: impl Into<String>,
    repository_id: Option<&str>,
) {
    emit_ai_stream(
        app_handle,
        AiStreamEvent {
            request_id: request_id.to_owned(),
            task_type,
            stage: stage.to_owned(),
            status: status.to_owned(),
            delta: None,
            text: None,
            message: Some(message.into()),
            repository_id: repository_id.map(str::to_owned),
            created_at: current_event_timestamp(),
        },
    );
}

fn emit_ai_stream_delta(
    app_handle: &tauri::AppHandle,
    request_id: &str,
    task_type: &'static str,
    stage: &str,
    delta: &str,
    text: &str,
    repository_id: Option<&str>,
) {
    emit_ai_stream(
        app_handle,
        AiStreamEvent {
            request_id: request_id.to_owned(),
            task_type,
            stage: stage.to_owned(),
            status: "delta".to_owned(),
            delta: Some(delta.to_owned()),
            text: Some(text.to_owned()),
            message: None,
            repository_id: repository_id.map(str::to_owned),
            created_at: current_event_timestamp(),
        },
    );
}

fn current_event_timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

struct BackgroundTaskGuard {
    task_label: &'static str,
    ticket: u64,
}

struct BackgroundTaskQueueState {
    running_task_label: Option<&'static str>,
    next_ticket: u64,
    serving_ticket: u64,
}

impl Drop for BackgroundTaskGuard {
    fn drop(&mut self) {
        let (queue, notifier) = background_task_queue();
        if let Ok(mut state) = queue.lock() {
            if state.running_task_label == Some(self.task_label)
                && state.serving_ticket == self.ticket
            {
                state.running_task_label = None;
                state.serving_ticket = state.serving_ticket.saturating_add(1);
                notifier.notify_all();
            }
        }
    }
}

fn background_task_queue() -> &'static (Mutex<BackgroundTaskQueueState>, Condvar) {
    BACKGROUND_TASK_QUEUE.get_or_init(|| {
        (
            Mutex::new(BackgroundTaskQueueState {
                running_task_label: None,
                next_ticket: 0,
                serving_ticket: 0,
            }),
            Condvar::new(),
        )
    })
}

fn acquire_background_task(task_label: &'static str) -> Result<BackgroundTaskGuard, String> {
    let (queue, notifier) = background_task_queue();
    let mut state = queue
        .lock()
        .map_err(|_| "后台任务状态异常，请重启应用后重试".to_owned())?;
    let ticket = state.next_ticket;
    state.next_ticket = state.next_ticket.saturating_add(1);

    while state.serving_ticket != ticket || state.running_task_label.is_some() {
        state = notifier
            .wait(state)
            .map_err(|_| "后台任务状态异常，请重启应用后重试".to_owned())?;
    }

    state.running_task_label = Some(task_label);
    Ok(BackgroundTaskGuard { task_label, ticket })
}

async fn run_background_task<T, F>(task_label: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let guard = acquire_background_task(task_label)?;
        let _guard = guard;
        operation()
    })
    .await
    .map_err(|error| format!("{task_label}后台任务执行失败：{error}"))?
}

async fn run_background_task_with_failure_progress<T, F>(
    task_label: &'static str,
    app_handle: tauri::AppHandle,
    task_id: &'static str,
    task_type: &'static str,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            task_id,
            task_type,
            "queue",
            0,
            0,
            format!("{task_label}已加入后台任务队列，正在等待执行"),
            None,
        ),
    );

    match run_background_task(task_label, operation).await {
        Ok(output) => Ok(output),
        Err(error) => {
            emit_task_progress(
                &app_handle,
                TaskProgressEvent::failed(task_id, task_type, error.clone()),
            );
            Err(error)
        }
    }
}

async fn run_immediate_blocking_task_with_failure_progress<T, F>(
    task_label: &'static str,
    app_handle: tauri::AppHandle,
    task_id: &'static str,
    task_type: &'static str,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("{task_label}执行失败：{error}"))?
    {
        Ok(output) => Ok(output),
        Err(error) => {
            emit_task_progress(
                &app_handle,
                TaskProgressEvent::failed(task_id, task_type, error.clone()),
            );
            Err(error)
        }
    }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GistRepositoryLibraryExportSummary {
    gist_id: String,
    html_url: String,
    tag_count: usize,
    repository_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GistRepositoryLibraryImportSummary {
    tag_count: usize,
    repository_count: usize,
    created_repository_count: usize,
    updated_repository_count: usize,
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
    ai_config: Option<ai::AiRequestConfig>,
    request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchGenerateAiDocumentsRequest {
    ai_config: Option<ai::AiRequestConfig>,
    limit: Option<usize>,
    only_missing: Option<bool>,
    repository_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAiTagNetworkRequest {
    account_id: String,
    ai_config: Option<ai::AiRequestConfig>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestAiConnectionRequest {
    ai_config: Option<ai::AiRequestConfig>,
    request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListAiModelsRequest {
    ai_config: Option<ai::AiRequestConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeReadinessCheckRequest {
    ai_config: Option<ai::AiRequestConfig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeReadinessCheckResult {
    storage: RuntimeReadinessCheckItem,
    settings: RuntimeReadinessCheckItem,
    github: RuntimeReadinessCheckItem,
    stars: RuntimeReadinessCheckItem,
    readme: RuntimeReadinessCheckItem,
    ai: RuntimeReadinessCheckItem,
    tag_network: RuntimeReadinessCheckItem,
    recommendation: RuntimeReadinessCheckItem,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeReadinessCheckItem {
    status: String,
    message: String,
    detail: Option<String>,
    action: Option<String>,
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
    offset: Option<usize>,
    account_id: String,
    context_queries: Option<Vec<String>>,
    context_repository_ids: Option<Vec<String>>,
    ai_config: Option<ai::AiRequestConfig>,
    embedding_config: Option<ai::EmbeddingRequestConfig>,
    request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestEmbeddingConnectionRequest {
    embedding_config: ai::EmbeddingRequestConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RebuildVectorIndexRequest {
    account_id: String,
    embedding_config: Option<ai::EmbeddingRequestConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorIndexStatusRequest {
    account_id: String,
    embedding_config: Option<ai::EmbeddingRequestConfig>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VectorIndexBuildSummary {
    total_count: usize,
    indexed_count: usize,
    restored_count: usize,
    skipped_count: usize,
    failed_count: usize,
    failures: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VectorIndexStatusData {
    enabled: bool,
    model: Option<String>,
    dimensions: Option<usize>,
    sqlite_count: usize,
    zvec_count: usize,
    ready: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExplainAiSearchTopicRequest {
    topic: String,
    ai_config: ai::AiRequestConfig,
    request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecommendGithubRepositoriesRequest {
    account_id: String,
    repository_ids: Vec<String>,
    ai_config: Option<ai::AiRequestConfig>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListGithubRecommendationCandidatesRequest {
    account_id: String,
    status: Option<String>,
    category: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateGithubRecommendationCandidateRequest {
    account_id: String,
    full_name: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarGithubRecommendationCandidateRequest {
    account_id: String,
    full_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchGithubRecommendationReadmeRequest {
    account_id: String,
    full_name: String,
    force_refresh: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateGithubRecommendationReadmeRequest {
    account_id: String,
    full_name: String,
    ai_config: Option<ai::AiRequestConfig>,
    force_refresh: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListGithubRankingsRequest {
    account_id: String,
    kind: String,
    language: Option<String>,
    page: Option<usize>,
    limit: Option<usize>,
    force_refresh: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListPersonalRankingsRequest {
    account_id: String,
    kind: String,
    language: Option<String>,
    page: Option<usize>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchGithubRankingReadmeRequest {
    account_id: String,
    full_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarGithubRankingRepositoryRequest {
    account_id: String,
    full_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubRecommendationResponse {
    rationale_zh: String,
    queries: Vec<String>,
    search_failures: Vec<GithubRecommendationSearchFailure>,
    results: Vec<github::GitHubRepositoryRecommendation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubRecommendationPage {
    rationale_zh: String,
    queries: Vec<String>,
    results: Vec<github::GitHubRepositoryRecommendation>,
    total_count: usize,
    limit: usize,
    offset: usize,
    categories: Vec<storage::GithubRecommendationCategoryCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubRecommendationReadme {
    full_name: String,
    raw_markdown: String,
    source_path: String,
    fetched_at: String,
    from_cache: bool,
    translation: Option<ai::AiReadmeTranslation>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RankingItem {
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics: Vec<String>,
    html_url: String,
    stars_count: u64,
    forks_count: u64,
    pushed_at: Option<String>,
    starred_at: Option<String>,
    is_starred: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RankingPage {
    kind: String,
    items: Vec<RankingItem>,
    total_count: usize,
    page: usize,
    limit: usize,
    has_more: bool,
    generated_at: String,
    is_stale: bool,
    from_cache: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RankingStarResult {
    full_name: String,
    is_starred: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubRecommendationSearchFailure {
    query: String,
    error: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportAnnotationGistRequest {
    gist_id: String,
}

#[tauri::command]
fn get_backend_status() -> BackendStatus {
    BackendStatus {
        backend: "本地服务已就绪",
        storage: "本地数据库已就绪",
        worker: "后台任务队列已就绪",
        provider: "AI 接口已支持 OpenAI 与 Anthropic 协议",
    }
}

#[tauri::command]
async fn get_github_auth_state(
    app_handle: tauri::AppHandle,
) -> Result<auth::GitHubAuthState, String> {
    let timeout_guard = Arc::new(AtomicBool::new(false));
    let worker_timeout_guard = Arc::clone(&timeout_guard);
    let worker_handle = app_handle.clone();
    let auth_state_task = tauri::async_runtime::spawn_blocking(move || {
        get_github_auth_state_worker(worker_handle, worker_timeout_guard)
    });

    match tokio::time::timeout(
        Duration::from_secs(GITHUB_AUTH_STATE_TOTAL_TIMEOUT_SECONDS),
        auth_state_task,
    )
    .await
    {
        Ok(result) => result.map_err(|error| format!("GitHub 连接状态检查失败：{error}"))?,
        Err(_) => {
            timeout_guard.store(true, Ordering::SeqCst);
            let storage = AppStorage::from_app_handle(&app_handle)?;
            restore_cached_github_auth_state(&storage)
        }
    }
}

fn get_github_auth_state_worker(
    app_handle: tauri::AppHandle,
    timeout_guard: Arc<AtomicBool>,
) -> Result<auth::GitHubAuthState, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let auth_check = auth::get_auth_state_check()?;
    if timeout_guard.load(Ordering::SeqCst) {
        return restore_cached_github_auth_state(&storage);
    }
    if let Some(user) = auth_check.state.user.as_ref() {
        storage.upsert_github_account(user)?;
        return Ok(auth_check.state);
    }
    if !auth_check.state.has_token {
        storage.mark_github_accounts_disconnected()?;
        return Ok(auth_check.state);
    }

    if !auth_check
        .verification_error
        .as_deref()
        .is_some_and(auth::can_restore_cached_user_after_auth_error)
    {
        auth::clear_github_token()?;
        storage.mark_github_accounts_disconnected()?;
        return Ok(auth::GitHubAuthState {
            has_token: false,
            user: None,
        });
    }

    Ok(auth::GitHubAuthState {
        has_token: true,
        user: storage.get_recent_github_account()?,
    })
}

fn restore_cached_github_auth_state(storage: &AppStorage) -> Result<auth::GitHubAuthState, String> {
    let user = storage.get_recent_github_account()?;
    Ok(auth::GitHubAuthState {
        has_token: user.is_some(),
        user,
    })
}

fn verify_github_token_for_required_action(
    storage: &AppStorage,
    token: &str,
) -> Result<auth::GitHubUser, String> {
    match auth::verify_github_token(token) {
        Ok(user) => Ok(user),
        Err(error) => {
            if !auth::can_restore_cached_user_after_auth_error(&error) {
                auth::clear_github_token().map_err(|clear_error| {
                    format!("{error}；本机 GitHub Token 清理失败：{clear_error}")
                })?;
                storage
                    .mark_github_accounts_disconnected()
                    .map_err(|disconnect_error| {
                        format!("{error}；本地账号连接状态更新失败：{disconnect_error}")
                    })?;
            }
            Err(error)
        }
    }
}

#[tauri::command]
async fn save_github_token(
    app_handle: tauri::AppHandle,
    token: String,
) -> Result<auth::GitHubUser, String> {
    let progress_handle = app_handle.clone();
    let timeout_guard = Arc::new(AtomicBool::new(false));
    let worker_timeout_guard = Arc::clone(&timeout_guard);
    emit_task_progress(
        &progress_handle,
        TaskProgressEvent::running(
            "connect-github",
            "auth",
            "auth",
            0,
            2,
            "正在验证 GitHub Token",
            None,
        ),
    );
    let save_task = run_immediate_blocking_task_with_failure_progress(
        "GitHub 连接",
        progress_handle.clone(),
        "connect-github",
        "auth",
        move || save_github_token_worker(app_handle, token, worker_timeout_guard),
    );

    match tokio::time::timeout(
        Duration::from_secs(GITHUB_CONNECT_TOTAL_TIMEOUT_SECONDS),
        save_task,
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            timeout_guard.store(true, Ordering::SeqCst);
            let message = "GitHub 连接超时：请检查网络、GitHub Token 是否可用，或确认系统凭据管理器授权弹窗后重试。".to_owned();
            emit_task_progress(
                &progress_handle,
                TaskProgressEvent::failed("connect-github", "auth", message.clone()),
            );
            Err(message)
        }
    }
}

fn save_github_token_worker(
    app_handle: tauri::AppHandle,
    token: String,
    timeout_guard: Arc<AtomicBool>,
) -> Result<auth::GitHubUser, String> {
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "connect-github",
            "auth",
            "auth",
            0,
            2,
            "正在验证 GitHub Token",
            None,
        ),
    );
    let user = auth::save_github_token(token)?;
    if timeout_guard.load(Ordering::SeqCst) {
        return Ok(user);
    }
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "connect-github",
            "auth",
            "save",
            1,
            2,
            "正在写入本地账号缓存",
            None,
        ),
    );
    let storage = AppStorage::from_app_handle(&app_handle)
        .map_err(clear_github_token_after_account_cache_failure)?;
    storage
        .upsert_github_account(&user)
        .map_err(clear_github_token_after_account_cache_failure)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "connect-github",
            "auth",
            2,
            2,
            format!("GitHub 账号 @{} 已连接", user.login),
        ),
    );
    Ok(user)
}

fn clear_github_token_after_account_cache_failure(error: String) -> String {
    match auth::clear_github_token() {
        Ok(()) => format!("GitHub Token 已验证，但本地账号缓存失败，已清理本机凭据：{error}"),
        Err(clear_error) => format!(
            "GitHub Token 已验证，但本地账号缓存失败：{error}；本机凭据清理失败：{clear_error}"
        ),
    }
}

#[tauri::command]
fn clear_github_token(app_handle: tauri::AppHandle) -> Result<(), String> {
    auth::clear_github_token()?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.mark_github_accounts_disconnected()
}

#[tauri::command]
fn has_ai_api_key(provider: String) -> Result<bool, String> {
    if provider.trim().eq_ignore_ascii_case("none") {
        return Ok(false);
    }
    let account = ai_api_key_account(&provider)?;
    Ok(auth::read_secure_password(AI_API_KEY_SERVICE, &account)?
        .as_deref()
        .is_some_and(|api_key| !api_key.trim().is_empty()))
}

#[tauri::command]
fn save_ai_api_key(provider: String, api_key: String) -> Result<(), String> {
    let account = ai_api_key_account(&provider)?;
    auth::save_secure_password(AI_API_KEY_SERVICE, &account, &api_key)
}

#[tauri::command]
fn has_embedding_api_key() -> Result<bool, String> {
    Ok(
        auth::read_secure_password(AI_API_KEY_SERVICE, EMBEDDING_API_KEY_ACCOUNT)?
            .as_deref()
            .is_some_and(|api_key| !api_key.trim().is_empty()),
    )
}

#[tauri::command]
fn save_embedding_api_key(api_key: String) -> Result<(), String> {
    auth::save_secure_password(AI_API_KEY_SERVICE, EMBEDDING_API_KEY_ACCOUNT, &api_key)
}

#[tauri::command]
fn clear_embedding_api_key() -> Result<(), String> {
    auth::delete_secure_password(AI_API_KEY_SERVICE, EMBEDDING_API_KEY_ACCOUNT)
}

fn read_ai_api_key_for_provider(provider: &str) -> Result<Option<String>, String> {
    let account = ai_api_key_account(provider)?;
    auth::read_secure_password(AI_API_KEY_SERVICE, &account)
}

fn clear_all_ai_api_keys() -> Result<(), String> {
    for account in AI_API_KEY_PROVIDER_ACCOUNTS {
        auth::delete_secure_password(AI_API_KEY_SERVICE, account)?;
    }
    Ok(())
}

fn ai_api_key_account(provider: &str) -> Result<String, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai" => Ok("ai-api-key:openai".to_owned()),
        "openai-compatible" => Ok("ai-api-key:openai-compatible".to_owned()),
        "anthropic" => Ok("ai-api-key:anthropic".to_owned()),
        _ => Err("AI Key 只能保存到 OpenAI、OpenAI 兼容接口或 Anthropic 配置。".to_owned()),
    }
}

fn hydrate_ai_request_config(
    app_handle: &tauri::AppHandle,
    config: Option<ai::AiRequestConfig>,
) -> Result<ai::AiRequestConfig, String> {
    let saved_config = load_saved_ai_request_config(app_handle)?;
    let mut config = merge_ai_request_config(config, saved_config.as_ref())?;
    if config.api_key.trim().is_empty() && !config.provider.trim().eq_ignore_ascii_case("none") {
        let can_use_keyless_local_ai = can_use_ai_without_api_key(&config);
        match read_ai_api_key_for_provider(&config.provider) {
            Ok(Some(api_key)) if !api_key.trim().is_empty() => config.api_key = api_key,
            Ok(_) => {}
            Err(_) if can_use_keyless_local_ai => {}
            Err(error) => return Err(error),
        }
    }
    Ok(config)
}

fn hydrate_embedding_request_config(
    app_handle: &tauri::AppHandle,
    config: Option<ai::EmbeddingRequestConfig>,
) -> Result<Option<ai::EmbeddingRequestConfig>, String> {
    let saved_config = load_saved_embedding_request_config(app_handle)?;
    let Some(mut config) = config.or(saved_config) else {
        return Ok(None);
    };
    if !config.enabled || config.provider.trim().eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    if config.api_key.trim().is_empty() {
        let can_use_keyless_local = config
            .provider
            .trim()
            .eq_ignore_ascii_case("openai-compatible")
            && config.base_url.as_deref().is_some_and(is_local_ai_base_url);
        match auth::read_secure_password(AI_API_KEY_SERVICE, EMBEDDING_API_KEY_ACCOUNT) {
            Ok(Some(api_key)) if !api_key.trim().is_empty() => config.api_key = api_key,
            Ok(_) => {}
            Err(_) if can_use_keyless_local => {}
            Err(error) => return Err(error),
        }
    }
    config.max_results = config.max_results.clamp(1, 10);
    config.min_score = config.min_score.clamp(0.0, 1.0);
    Ok(Some(config))
}

fn can_use_ai_without_api_key(config: &ai::AiRequestConfig) -> bool {
    config
        .provider
        .trim()
        .eq_ignore_ascii_case("openai-compatible")
        && config.base_url.as_deref().is_some_and(is_local_ai_base_url)
}

fn is_local_ai_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().to_ascii_lowercase();
    let Some(host_with_port) = normalized
        .strip_prefix("http://")
        .or_else(|| normalized.strip_prefix("https://"))
        .and_then(|rest| rest.split(['/', '?', '#']).next())
    else {
        return false;
    };
    if host_with_port.is_empty() || host_with_port.contains('@') {
        return false;
    }

    let host = if let Some(rest) = host_with_port.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host_with_port.split(':').next().unwrap_or("")
    };

    matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "::1")
}

fn load_saved_ai_request_config(
    app_handle: &tauri::AppHandle,
) -> Result<Option<ai::AiRequestConfig>, String> {
    let settings_path = app_settings_path(app_handle)?;
    if !settings_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(settings_path).map_err(|error| format!("应用设置读取失败：{error}"))?;
    let settings = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("应用设置解析失败：{error}"))?;
    Ok(ai_request_config_from_settings_value(&settings))
}

fn load_saved_embedding_request_config(
    app_handle: &tauri::AppHandle,
) -> Result<Option<ai::EmbeddingRequestConfig>, String> {
    let settings_path = app_settings_path(app_handle)?;
    if !settings_path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(settings_path).map_err(|error| format!("应用设置读取失败：{error}"))?;
    let settings = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("应用设置解析失败：{error}"))?;
    Ok(embedding_request_config_from_settings_value(&settings))
}

fn merge_ai_request_config(
    config: Option<ai::AiRequestConfig>,
    saved_config: Option<&ai::AiRequestConfig>,
) -> Result<ai::AiRequestConfig, String> {
    let Some(mut config) = config.or_else(|| saved_config.cloned()) else {
        return Err("请先在设置中配置 AI 服务".to_owned());
    };
    if config.provider.trim().eq_ignore_ascii_case("none") {
        return Ok(config);
    }

    if let Some(saved_config) = saved_config {
        if config.provider.trim().is_empty() {
            config.provider = saved_config.provider.clone();
        }
        if config.base_url.as_deref().unwrap_or("").trim().is_empty() {
            config.base_url = saved_config.base_url.clone();
        }
        if config.model.trim().is_empty() {
            config.model = saved_config.model.clone();
        }
    }

    Ok(config)
}

fn ai_request_config_from_settings_value(
    settings: &serde_json::Value,
) -> Option<ai::AiRequestConfig> {
    let ai_settings = settings.get("ai")?.as_object()?;
    Some(ai::AiRequestConfig {
        provider: json_string_field(ai_settings, "provider").unwrap_or_else(|| "none".to_owned()),
        api_key: String::new(),
        base_url: json_string_field(ai_settings, "baseUrl")
            .filter(|value| !value.trim().is_empty()),
        model: json_string_field(ai_settings, "model").unwrap_or_default(),
    })
}

fn embedding_request_config_from_settings_value(
    settings: &serde_json::Value,
) -> Option<ai::EmbeddingRequestConfig> {
    let embedding = settings.get("embedding")?.as_object()?;
    let enabled = embedding
        .get("enabled")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let dimensions = embedding
        .get("dimensions")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(1536);
    let min_score = embedding
        .get("minScore")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.72) as f32;
    let max_results = embedding
        .get("maxResults")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(8);
    Some(ai::EmbeddingRequestConfig {
        enabled,
        provider: json_string_field(embedding, "provider").unwrap_or_else(|| "none".to_owned()),
        api_key: String::new(),
        base_url: json_string_field(embedding, "baseUrl").filter(|value| !value.trim().is_empty()),
        model: json_string_field(embedding, "model").unwrap_or_default(),
        dimensions,
        min_score,
        max_results,
    })
}

fn json_string_field(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    object
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .map(str::to_owned)
}

#[tauri::command]
fn clear_ai_api_key(provider: Option<String>) -> Result<(), String> {
    match provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(provider) if !provider.eq_ignore_ascii_case("none") => {
            let account = ai_api_key_account(provider)?;
            auth::delete_secure_password(AI_API_KEY_SERVICE, &account)
        }
        Some(_) => Ok(()),
        None => clear_all_ai_api_keys(),
    }
}

#[tauri::command]
async fn test_embedding_connection(
    app_handle: tauri::AppHandle,
    request: TestEmbeddingConnectionRequest,
) -> Result<ai::EmbeddingTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = hydrate_embedding_request_config(&app_handle, Some(request.embedding_config))?
            .ok_or_else(|| "向量检索尚未启用".to_owned())?;
        let result = ai::embed_text(&config, "GitHub Stars 本地知识库向量检索测试")?;
        Ok(ai::EmbeddingTestResult {
            model: result.model,
            dimensions: result.vector.len(),
        })
    })
    .await
    .map_err(|error| format!("Embedding 配置测试执行失败：{error}"))?
}

#[tauri::command]
async fn rebuild_vector_index(
    app_handle: tauri::AppHandle,
    request: RebuildVectorIndexRequest,
) -> Result<VectorIndexBuildSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "重建向量索引",
        app_handle.clone(),
        "rebuild-vector-index",
        "vector-index",
        move || rebuild_vector_index_worker(progress_handle, request),
    )
    .await
}

fn rebuild_vector_index_worker(
    app_handle: tauri::AppHandle,
    request: RebuildVectorIndexRequest,
) -> Result<VectorIndexBuildSummary, String> {
    let config = hydrate_embedding_request_config(&app_handle, request.embedding_config)?
        .ok_or_else(|| "请先在设置中启用并配置向量检索".to_owned())?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let candidates = storage.list_vector_index_candidates(
        &request.account_id,
        &config.model,
        config.dimensions,
        VECTOR_MODEL_VERSION,
    )?;
    let stored_embeddings = storage.list_stored_repository_embeddings(
        &request.account_id,
        &config.model,
        config.dimensions,
        VECTOR_MODEL_VERSION,
    )?;
    let stored_by_repo = stored_embeddings
        .into_iter()
        .map(|record| (record.repo_id.clone(), record))
        .collect::<HashMap<_, _>>();
    let index = vector_index::ZvecRepositoryIndex::from_app_handle(&app_handle)?;
    index.reset_bucket(&request.account_id, &config.model, config.dimensions)?;
    let mut summary = VectorIndexBuildSummary {
        total_count: candidates.len(),
        indexed_count: 0,
        restored_count: 0,
        skipped_count: 0,
        failed_count: 0,
        failures: Vec::new(),
    };
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "rebuild-vector-index",
            "vector-index",
            "embedding",
            0,
            summary.total_count.max(1),
            "正在生成并恢复仓库向量",
            None,
        ),
    );

    for (position, candidate) in candidates.into_iter().enumerate() {
        let result =
            if candidate.existing_source_hash.as_deref() == Some(candidate.source_hash.as_str()) {
                if let Some(stored) = stored_by_repo.get(&candidate.repo_id) {
                    index
                        .upsert(&vector_index::RepositoryVectorRecord {
                            account_id: stored.account_id.clone(),
                            repo_id: stored.repo_id.clone(),
                            source_hash: stored.source_hash.clone(),
                            model: stored.model.clone(),
                            vector: stored.vector.clone(),
                        })
                        .map(|_| "restored")
                } else {
                    Ok("missing")
                }
            } else {
                Ok("missing")
            }
            .and_then(|state| {
                if state == "restored" {
                    return Ok(state);
                }
                let embedding = ai::embed_text(&config, &candidate.knowledge_text)?;
                let record = storage::StoredRepositoryEmbedding {
                    account_id: candidate.account_id.clone(),
                    repo_id: candidate.repo_id.clone(),
                    source_hash: candidate.source_hash.clone(),
                    model: config.model.clone(),
                    vector: embedding.vector,
                };
                storage.save_repository_embedding(&record, VECTOR_MODEL_VERSION)?;
                index.upsert(&vector_index::RepositoryVectorRecord {
                    account_id: record.account_id,
                    repo_id: record.repo_id,
                    source_hash: record.source_hash,
                    model: record.model,
                    vector: record.vector,
                })?;
                Ok("indexed")
            });

        match result {
            Ok("restored") => summary.restored_count += 1,
            Ok("indexed") => summary.indexed_count += 1,
            Ok(_) => summary.skipped_count += 1,
            Err(error) => {
                summary.failed_count += 1;
                if summary.failures.len() < 20 {
                    summary
                        .failures
                        .push(format!("{}：{error}", candidate.full_name));
                }
            }
        }
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "rebuild-vector-index",
                "vector-index",
                "embedding",
                position + 1,
                summary.total_count.max(1),
                format!(
                    "向量索引进度：新生成 {}，本地恢复 {}，失败 {}",
                    summary.indexed_count, summary.restored_count, summary.failed_count
                ),
                Some(candidate.full_name),
            ),
        );
    }

    emit_task_progress(
        &app_handle,
        if summary.failed_count == 0 {
            TaskProgressEvent::succeeded(
                "rebuild-vector-index",
                "vector-index",
                summary.total_count,
                summary.total_count,
                format!(
                    "向量索引完成：新生成 {}，本地恢复 {}",
                    summary.indexed_count, summary.restored_count
                ),
            )
        } else {
            TaskProgressEvent::partial(
                "rebuild-vector-index",
                "vector-index",
                summary.total_count,
                summary.total_count,
                format!(
                    "向量索引部分完成：成功 {}，失败 {}",
                    summary.indexed_count + summary.restored_count,
                    summary.failed_count
                ),
            )
        },
    );
    Ok(summary)
}

#[tauri::command]
async fn get_vector_index_status(
    app_handle: tauri::AppHandle,
    request: VectorIndexStatusRequest,
) -> Result<VectorIndexStatusData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(config) = hydrate_embedding_request_config(&app_handle, request.embedding_config)?
        else {
            return Ok(VectorIndexStatusData {
                enabled: false,
                model: None,
                dimensions: None,
                sqlite_count: 0,
                zvec_count: 0,
                ready: false,
                message: "向量检索尚未启用".to_owned(),
            });
        };
        let storage = AppStorage::from_app_handle(&app_handle)?;
        let sqlite_count = storage
            .list_stored_repository_embeddings(
                &request.account_id,
                &config.model,
                config.dimensions,
                VECTOR_MODEL_VERSION,
            )?
            .len();
        let index = vector_index::ZvecRepositoryIndex::from_app_handle(&app_handle)?;
        let zvec_count = index
            .count(&request.account_id, &config.model, config.dimensions)
            .unwrap_or(0);
        let ready = sqlite_count > 0 && zvec_count == sqlite_count;
        Ok(VectorIndexStatusData {
            enabled: true,
            model: Some(config.model),
            dimensions: Some(config.dimensions),
            sqlite_count,
            zvec_count,
            ready,
            message: if ready {
                format!("向量索引可用，共 {zvec_count} 个仓库")
            } else if sqlite_count > 0 {
                "zvec 索引需要从 SQLite 恢复，请执行重建".to_owned()
            } else {
                "尚未生成仓库向量，请执行重建".to_owned()
            },
        })
    })
    .await
    .map_err(|error| format!("读取向量索引状态失败：{error}"))?
}

#[tauri::command]
fn get_app_settings(app_handle: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let settings_path = app_settings_path(&app_handle)?;
    if !settings_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&settings_path).map_err(|error| format!("应用设置读取失败：{error}"))?;
    let settings = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("应用设置解析失败：{error}"))?;

    Ok(Some(sanitize_app_settings_value(settings)))
}

#[tauri::command]
fn save_app_settings(
    app_handle: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    let settings_path = app_settings_path(&app_handle)?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("应用设置目录创建失败：{error}"))?;
    }

    let sanitized_settings = sanitize_app_settings_value(settings);
    let content = serde_json::to_string_pretty(&sanitized_settings)
        .map_err(|error| format!("应用设置序列化失败：{error}"))?;
    fs::write(settings_path, content).map_err(|error| format!("应用设置保存失败：{error}"))
}

#[tauri::command]
fn clear_app_settings(app_handle: tauri::AppHandle) -> Result<(), String> {
    let settings_path = app_settings_path(&app_handle)?;
    if settings_path.exists() {
        fs::remove_file(settings_path).map_err(|error| format!("应用设置清理失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn clear_local_database(app_handle: tauri::AppHandle) -> Result<(), String> {
    let database_result = AppStorage::clear_local_database(&app_handle);
    let vector_result = vector_index::ZvecRepositoryIndex::from_app_handle(&app_handle)
        .and_then(|index| index.reset_all());
    match (database_result, vector_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(database_error), Ok(())) => Err(database_error),
        (Ok(()), Err(vector_error)) => Err(vector_error),
        (Err(database_error), Err(vector_error)) => Err(format!(
            "本地数据库清理失败：{database_error}；向量索引清理失败：{vector_error}"
        )),
    }
}

fn app_settings_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|error| format!("应用设置目录初始化失败：{error}"))?;

    Ok(config_dir.join(APP_SETTINGS_FILE))
}

fn sanitize_app_settings_value(mut settings: serde_json::Value) -> serde_json::Value {
    if let Some(ai_settings) = settings
        .get_mut("ai")
        .and_then(serde_json::Value::as_object_mut)
    {
        ai_settings.insert(
            "apiKey".to_owned(),
            serde_json::Value::String(String::new()),
        );
    }
    settings
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let normalized_url = normalize_external_url(&url)?;
    open_url_in_system_browser(&normalized_url)
}

fn normalize_external_url(url: &str) -> Result<String, String> {
    let normalized_url = url.trim();
    if normalized_url.is_empty() {
        return Err("外部链接不能为空".to_owned());
    }
    if normalized_url.chars().any(char::is_control) {
        return Err("外部链接包含不可见控制字符".to_owned());
    }

    let lower_url = normalized_url.to_ascii_lowercase();
    if !(lower_url.starts_with("https://") || lower_url.starts_with("http://")) {
        return Err("仅允许打开 http 或 https 外部链接".to_owned());
    }

    Ok(normalized_url.to_owned())
}

fn open_url_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("系统浏览器打开失败：{error}"))
}

#[tauri::command]
async fn test_ai_connection(
    app_handle: tauri::AppHandle,
    request: TestAiConnectionRequest,
) -> Result<ai::AiSummaryDocument, String> {
    run_background_task("AI 配置测试", move || {
        test_ai_connection_worker(app_handle, request)
    })
    .await
}

fn test_ai_connection_worker(
    app_handle: tauri::AppHandle,
    request: TestAiConnectionRequest,
) -> Result<ai::AiSummaryDocument, String> {
    let ai_config = hydrate_ai_request_config(&app_handle, request.ai_config)?;
    let request_id = request
        .request_id
        .unwrap_or_else(|| format!("ai-config-test-{}", current_event_timestamp()));
    run_ai_connection_probe(&app_handle, &request_id, &ai_config)
}

fn run_ai_connection_probe(
    app_handle: &tauri::AppHandle,
    request_id: &str,
    ai_config: &ai::AiRequestConfig,
) -> Result<ai::AiSummaryDocument, String> {
    emit_ai_stream_status(
        app_handle,
        request_id,
        "ai-config-test",
        "prepare",
        "started",
        "正在准备 AI 测试请求",
        None,
    );
    let stream_app_handle = app_handle.clone();
    let stream_request_id = request_id.to_owned();
    let mut latest_stream_text = String::new();
    let result = ai::summarize_readme_streaming(
        ai_config,
        "xingranya/GitHub-Stars-AI-Tools",
        Some("用于验证 AI 服务配置是否可以正常请求的测试仓库。"),
        r#"# GitHub-Stars-AI-Tools

GitHub-Stars-AI-Tools 是一个本地优先的桌面客户端，用于同步 GitHub Stars、缓存 README、生成中文摘要、维护标签网络，并通过自然语言检索个人开源知识库。
"#,
        &mut |stage, status, delta, text, message| {
            if let Some(next_text) = text {
                latest_stream_text = next_text.to_owned();
            }
            match status {
                "delta" => {
                    let delta = delta.unwrap_or_default();
                    let text = text.unwrap_or(latest_stream_text.as_str());
                    emit_ai_stream_delta(
                        &stream_app_handle,
                        &stream_request_id,
                        "ai-config-test",
                        stage,
                        delta,
                        text,
                        None,
                    );
                }
                _ => emit_ai_stream_status(
                    &stream_app_handle,
                    &stream_request_id,
                    "ai-config-test",
                    stage,
                    status,
                    message.unwrap_or("AI 测试状态已更新"),
                    None,
                ),
            }
        },
    );

    match result {
        Ok(document) => {
            emit_ai_stream_status(
                app_handle,
                request_id,
                "ai-config-test",
                "done",
                "finished",
                "AI 配置测试完成",
                None,
            );
            Ok(document)
        }
        Err(error) => {
            emit_ai_stream_status(
                app_handle,
                request_id,
                "ai-config-test",
                "error",
                "failed",
                error.clone(),
                None,
            );
            Err(error)
        }
    }
}

#[tauri::command]
async fn list_ai_models(
    app_handle: tauri::AppHandle,
    request: ListAiModelsRequest,
) -> Result<Vec<ai::AiModelOption>, String> {
    run_background_task("AI 模型列表获取", move || {
        let ai_config = hydrate_ai_request_config(&app_handle, request.ai_config)?;
        ai::list_models(&ai_config)
    })
    .await
}

#[tauri::command]
async fn check_runtime_readiness(
    app_handle: tauri::AppHandle,
    request: RuntimeReadinessCheckRequest,
) -> Result<RuntimeReadinessCheckResult, String> {
    run_background_task("真实链路自检", move || {
        check_runtime_readiness_worker(app_handle, request)
    })
    .await
}

fn check_runtime_readiness_worker(
    app_handle: tauri::AppHandle,
    request: RuntimeReadinessCheckRequest,
) -> Result<RuntimeReadinessCheckResult, String> {
    let (storage, storage_check) = match AppStorage::from_app_handle(&app_handle) {
        Ok(storage) => {
            let storage_check = check_runtime_storage(&storage);
            (Some(storage), storage_check)
        }
        Err(error) => (
            None,
            runtime_check_failed_with_action(
                "本地数据库初始化失败".to_owned(),
                Some(error),
                "在通用设置中清空本机数据后重新打开应用；如果仍失败，请检查应用数据目录权限。",
            ),
        ),
    };
    let settings = check_runtime_settings_storage(&app_handle);
    let token_result = auth::require_github_token();
    let mut verified_token = None;
    let mut verified_account_id = None;
    let (github, stars) = match token_result {
        Ok(token) => match auth::verify_github_token(&token) {
            Ok(user) => {
                let account_id = user.id.to_string();
                let github = runtime_check_passed(
                    format!("GitHub Token 已验证，当前账号 @{}", user.login),
                    Some(format!("账号 ID：{account_id}")),
                );
                let stars = match github::fetch_starred_repositories_page(&token, &account_id, 1) {
                    Ok(repositories) => runtime_check_passed(
                        format!(
                            "GitHub Stars API 可用，已读取首页 {} 个仓库",
                            repositories.len()
                        ),
                        Some("真实请求：GET /user/starred?per_page=100&page=1".to_owned()),
                    ),
                    Err(error) => runtime_check_failed_with_action(
                        "GitHub Stars API 请求失败".to_owned(),
                        Some(error),
                        "检查网络、代理或 GitHub API 限流状态，稍后重新运行同步。",
                    ),
                };
                verified_token = Some(token);
                verified_account_id = Some(account_id);
                (github, stars)
            }
            Err(error) => (
                runtime_check_failed_with_action(
                    "GitHub Token 验证失败".to_owned(),
                    Some(error.clone()),
                    "重新生成可读取 Stars 的 GitHub Token，并在 GitHub 设置区保存。",
                ),
                runtime_check_skipped_with_action(
                    "Stars API 未检测".to_owned(),
                    Some(format!("需要先修复 GitHub Token：{error}")),
                    "先修复 GitHub Token，再重新运行真实链路自检。",
                ),
            ),
        },
        Err(error) => (
            runtime_check_failed_with_action(
                "尚未连接 GitHub 账号".to_owned(),
                Some(error.clone()),
                "在 GitHub 设置区粘贴 Token 并连接账号。",
            ),
            runtime_check_skipped_with_action(
                "Stars API 未检测".to_owned(),
                Some(format!("需要先连接 GitHub 账号：{error}")),
                "先连接 GitHub 账号，再同步 Stars。",
            ),
        ),
    };

    let readme = match (verified_token.as_deref(), verified_account_id.as_deref()) {
        (Some(token), Some(account_id)) => match storage.as_ref() {
            Some(storage) => check_runtime_readme(storage, token, account_id),
            None => runtime_check_skipped_with_action(
                "README 抓取未检测".to_owned(),
                Some("需要先修复本地数据库。".to_owned()),
                "先清空本机数据或修复数据库权限，再重新运行自检。",
            ),
        },
        _ => runtime_check_skipped_with_action(
            "README 抓取未检测".to_owned(),
            Some("需要先完成 GitHub Token 验证。".to_owned()),
            "先连接 GitHub 账号并同步 Stars。",
        ),
    };

    let (ai, hydrated_ai_config) = if request
        .ai_config
        .as_ref()
        .is_some_and(|config| config.provider.trim().eq_ignore_ascii_case("none"))
    {
        (
            runtime_check_skipped_with_action(
                "AI 功能未开启".to_owned(),
                Some("可在 AI 引擎配置中选择 OpenAI、OpenAI 兼容接口或 Anthropic。".to_owned()),
                "在 AI 引擎配置中选择服务、填写请求地址、密钥和模型 ID 后测试连接。",
            ),
            None,
        )
    } else {
        match hydrate_ai_request_config(&app_handle, request.ai_config) {
            Ok(config) => match run_ai_connection_probe(
                &app_handle,
                &format!("runtime-ai-check-{}", current_event_timestamp()),
                &config,
            ) {
                Ok(document) => (
                    runtime_check_passed(
                        format!("AI 服务已响应，模型 {}", document.model),
                        Some("真实请求：使用当前设置生成一次项目摘要自检。".to_owned()),
                    ),
                    Some(config),
                ),
                Err(error) => (
                    runtime_check_failed_with_action(
                        "AI 服务请求失败".to_owned(),
                        Some(error),
                        "检查请求地址、模型 ID、API Key、额度和网络代理后重试。",
                    ),
                    None,
                ),
            },
            Err(error) => (
                runtime_check_failed_with_action(
                    "AI 服务配置读取失败".to_owned(),
                    Some(error),
                    "重新保存 AI 设置；如果使用本机兼容服务，请确认请求地址可访问。",
                ),
                None,
            ),
        }
    };

    let recommendation = match (
        verified_token.as_deref(),
        verified_account_id.as_deref(),
        hydrated_ai_config.as_ref(),
    ) {
        (Some(token), Some(account_id), Some(ai_config)) => match storage.as_ref() {
            Some(storage) => check_runtime_recommendation(storage, token, account_id, ai_config),
            None => runtime_check_skipped_with_action(
                "相似推荐未检测".to_owned(),
                Some("需要先修复本地数据库。".to_owned()),
                "先修复本地数据库，再重新运行自检。",
            ),
        },
        (_, _, None) => runtime_check_skipped_with_action(
            "相似推荐未检测".to_owned(),
            Some("需要先通过 AI 服务自检。".to_owned()),
            "先通过 AI 服务自检，再运行相似推荐。",
        ),
        _ => runtime_check_skipped_with_action(
            "相似推荐未检测".to_owned(),
            Some("需要先完成 GitHub Token 验证。".to_owned()),
            "先完成 GitHub Token 验证，再运行相似推荐。",
        ),
    };

    let tag_network = match (verified_account_id.as_deref(), hydrated_ai_config.as_ref()) {
        (Some(account_id), Some(ai_config)) => match storage.as_ref() {
            Some(storage) => check_runtime_tag_network(storage, account_id, ai_config),
            None => runtime_check_skipped_with_action(
                "AI 标签网络未检测".to_owned(),
                Some("需要先修复本地数据库。".to_owned()),
                "先修复本地数据库，再重新运行自检。",
            ),
        },
        (_, None) => runtime_check_skipped_with_action(
            "AI 标签网络未检测".to_owned(),
            Some("需要先通过 AI 服务自检。".to_owned()),
            "先通过 AI 服务自检，再生成标签网络。",
        ),
        _ => runtime_check_skipped_with_action(
            "AI 标签网络未检测".to_owned(),
            Some("需要先完成 GitHub Token 验证。".to_owned()),
            "先完成 GitHub Token 验证，再生成标签网络。",
        ),
    };

    Ok(RuntimeReadinessCheckResult {
        storage: storage_check,
        settings,
        github,
        stars,
        readme,
        ai,
        tag_network,
        recommendation,
    })
}

fn check_runtime_storage(storage: &AppStorage) -> RuntimeReadinessCheckItem {
    match storage.list_repository_page(
        1,
        0,
        storage::RepositoryListFilters {
            account_id: None,
            keyword: None,
            language: None,
            tag_id: None,
        },
    ) {
        Ok(page) => runtime_check_passed(
            "本地数据库可读，SQLite 初始化已完成".to_owned(),
            Some(format!(
                "真实查询：读取本地仓库索引，总计 {} 条记录。",
                page.total_count
            )),
        ),
        Err(error) => runtime_check_failed_with_action(
            "本地数据库读取失败".to_owned(),
            Some(error),
            "在通用设置中清空本机数据后重新打开应用；如果仍失败，请检查应用数据目录权限。",
        ),
    }
}

fn check_runtime_settings_storage(app_handle: &tauri::AppHandle) -> RuntimeReadinessCheckItem {
    let settings_path = match app_settings_path(app_handle) {
        Ok(path) => path,
        Err(error) => {
            return runtime_check_failed_with_action(
                "应用设置目录不可用".to_owned(),
                Some(error),
                "检查应用设置目录权限，或在通用设置中清空本机数据后重新打开应用。",
            );
        }
    };
    let Some(settings_dir) = settings_path.parent() else {
        return runtime_check_failed_with_action(
            "应用设置目录不可用".to_owned(),
            Some("无法解析应用设置目录。".to_owned()),
            "检查系统应用数据目录是否可写，然后重新打开应用。",
        );
    };
    if let Err(error) = fs::create_dir_all(settings_dir) {
        return runtime_check_failed_with_action(
            "应用设置目录创建失败".to_owned(),
            Some(error.to_string()),
            "检查应用设置目录权限，或手动删除损坏目录后重新打开应用。",
        );
    }

    let probe_path = settings_dir.join(".gsat-settings-write-check.tmp");
    if let Err(error) = fs::write(&probe_path, b"ok") {
        return runtime_check_failed_with_action(
            "应用设置写入失败".to_owned(),
            Some(error.to_string()),
            "授予应用设置目录写入权限后重新运行自检。",
        );
    }
    if let Err(error) = fs::remove_file(&probe_path) {
        return runtime_check_failed_with_action(
            "应用设置清理失败".to_owned(),
            Some(error.to_string()),
            "检查应用设置目录权限，清理残留临时文件后重新运行自检。",
        );
    }

    runtime_check_passed(
        "应用设置可保存".to_owned(),
        Some(format!(
            "真实写入：已验证设置目录 {} 可写。",
            settings_dir.display()
        )),
    )
}

fn check_runtime_readme(
    storage: &AppStorage,
    token: &str,
    account_id: &str,
) -> RuntimeReadinessCheckItem {
    let page = match storage.list_repository_page(
        1,
        0,
        storage::RepositoryListFilters {
            account_id: Some(account_id),
            keyword: None,
            language: None,
            tag_id: None,
        },
    ) {
        Ok(page) => page,
        Err(error) => {
            return runtime_check_failed_with_action(
                "本地 Stars 读取失败".to_owned(),
                Some(error),
                "重新同步 Stars；如果仍失败，请清空本机数据后重新连接 GitHub。",
            );
        }
    };
    let Some(repository) = page.items.into_iter().next() else {
        return runtime_check_skipped_with_action(
            "README 抓取未检测".to_owned(),
            Some("本地还没有 Stars 数据，请先同步 Stars。".to_owned()),
            "先点击同步 Stars，完成后重新运行自检。",
        );
    };

    match github::fetch_readme(token, &repository.id, &repository.full_name) {
        Ok(Some(readme)) => runtime_check_passed(
            format!("README 抓取可用，已读取 {}", repository.full_name),
            Some(format!(
                "真实请求：GitHub README Raw，来源 {}，{} 个字符。",
                readme.source_path,
                readme.raw_markdown.chars().count()
            )),
        ),
        Ok(None) => runtime_check_skipped_with_action(
            "README 抓取已请求，示例仓库未提供 README".to_owned(),
            Some(format!("真实请求仓库：{}", repository.full_name)),
            "可以继续使用；也可以同步更多 Stars 后重新运行自检。",
        ),
        Err(error) => runtime_check_failed_with_action(
            "README 抓取失败".to_owned(),
            Some(error),
            "检查网络、GitHub 权限和仓库 README 是否可访问后重试。",
        ),
    }
}

fn check_runtime_recommendation(
    storage: &AppStorage,
    token: &str,
    account_id: &str,
    ai_config: &ai::AiRequestConfig,
) -> RuntimeReadinessCheckItem {
    let briefs = match load_runtime_tag_repository_briefs(storage, account_id, "相似推荐") {
        Ok(briefs) => briefs,
        Err(error) => {
            return error;
        }
    };
    if briefs.is_empty() {
        return runtime_check_skipped_with_action(
            "相似推荐未检测".to_owned(),
            Some("本地还没有 Stars 数据，请先同步 Stars。".to_owned()),
            "先同步 Stars，再选择几个仓库生成相似推荐。",
        );
    }

    let plan = match ai::plan_github_recommendations(ai_config, &briefs) {
        Ok(plan) => plan,
        Err(error) => {
            return runtime_check_failed_with_action(
                "相似推荐 AI 规划失败".to_owned(),
                Some(error),
                "检查 AI 模型是否支持结构化 JSON 输出，并重新测试 AI 连接。",
            );
        }
    };
    let Some(query) = plan.queries.first() else {
        return runtime_check_failed_with_action(
            "相似推荐 AI 规划失败".to_owned(),
            Some("AI 未返回可执行的 GitHub 搜索式。".to_owned()),
            "换用更稳定的模型或调整模型 ID 后重新运行自检。",
        );
    };

    match github::search_repositories(token, query, 3) {
        Ok(results) => runtime_check_passed(
            format!(
                "相似推荐链路可用，GitHub Search 返回 {} 个候选",
                results.len()
            ),
            Some(format!(
                "真实请求：AI 生成搜索式 `{query}` 后调用 GitHub Search API。"
            )),
        ),
        Err(error) => runtime_check_failed_with_action(
            "相似推荐 GitHub Search 失败".to_owned(),
            Some(error),
            "检查 GitHub Token 权限、网络和 Search API 限流后重试。",
        ),
    }
}

fn check_runtime_tag_network(
    storage: &AppStorage,
    account_id: &str,
    ai_config: &ai::AiRequestConfig,
) -> RuntimeReadinessCheckItem {
    let briefs = match load_runtime_tag_repository_briefs(storage, account_id, "AI 标签网络") {
        Ok(briefs) => briefs,
        Err(error) => {
            return error;
        }
    };
    if briefs.is_empty() {
        return runtime_check_skipped_with_action(
            "AI 标签网络未检测".to_owned(),
            Some("本地还没有 Stars 数据，请先同步 Stars。".to_owned()),
            "先同步 Stars，再生成 AI 标签网络。",
        );
    }

    match ai::generate_tag_network(ai_config, &briefs) {
        Ok(suggestions) => runtime_check_passed(
            format!("AI 标签网络可用，模型返回 {} 个标签建议", suggestions.len()),
            Some("真实请求：读取本地 Star 简略信息后调用当前 AI 服务生成标签图谱。".to_owned()),
        ),
        Err(error) => runtime_check_failed_with_action(
            "AI 标签网络生成失败".to_owned(),
            Some(error),
            "检查 AI 模型是否支持结构化 JSON 输出，并重新测试 AI 连接。",
        ),
    }
}

fn load_runtime_tag_repository_briefs(
    storage: &AppStorage,
    account_id: &str,
    feature_name: &str,
) -> Result<Vec<ai::AiTagRepositoryBrief>, RuntimeReadinessCheckItem> {
    let sources = storage
        .list_repository_tagging_sources(account_id, Some(1))
        .map_err(|error| {
            runtime_check_failed_with_action(
                format!("{feature_name}本地数据读取失败"),
                Some(error),
                "重新同步 Stars；如果仍失败，请清空本机数据后重新连接 GitHub。",
            )
        })?;

    Ok(sources
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
        .collect())
}

fn runtime_check_passed(message: String, detail: Option<String>) -> RuntimeReadinessCheckItem {
    RuntimeReadinessCheckItem {
        status: "passed".to_owned(),
        message,
        detail,
        action: None,
    }
}

fn runtime_check_failed(message: String, detail: Option<String>) -> RuntimeReadinessCheckItem {
    RuntimeReadinessCheckItem {
        status: "failed".to_owned(),
        message,
        detail,
        action: None,
    }
}

fn runtime_check_skipped(message: String, detail: Option<String>) -> RuntimeReadinessCheckItem {
    RuntimeReadinessCheckItem {
        status: "skipped".to_owned(),
        message,
        detail,
        action: None,
    }
}

fn runtime_check_failed_with_action(
    message: String,
    detail: Option<String>,
    action: &str,
) -> RuntimeReadinessCheckItem {
    RuntimeReadinessCheckItem {
        action: Some(action.to_owned()),
        ..runtime_check_failed(message, detail)
    }
}

fn runtime_check_skipped_with_action(
    message: String,
    detail: Option<String>,
    action: &str,
) -> RuntimeReadinessCheckItem {
    RuntimeReadinessCheckItem {
        action: Some(action.to_owned()),
        ..runtime_check_skipped(message, detail)
    }
}

#[tauri::command]
async fn sync_github_stars(app_handle: tauri::AppHandle) -> Result<StarSyncSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "Stars 同步",
        progress_handle,
        "sync-stars",
        "sync",
        move || sync_github_stars_worker(app_handle),
    )
    .await
}

fn sync_github_stars_worker(app_handle: tauri::AppHandle) -> Result<StarSyncSummary, String> {
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
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let token = match auth::require_github_token() {
        Ok(token) => token,
        Err(error) => {
            storage.mark_github_accounts_disconnected()?;
            return Err(error);
        }
    };
    let user = verify_github_token_for_required_action(&storage, &token)?;
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
    let mut scanned_count = 0_usize;
    let repositories = collect_authoritative_star_pages(github::starred_page_size(), |page| {
        let page_items = github::fetch_starred_repositories_page(&token, &account_id, page)?;
        let page_len = page_items.len();
        scanned_count += page_len;
        let estimated_total = if page_len < github::starred_page_size() {
            scanned_count
        } else {
            scanned_count + github::starred_page_size()
        };
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "sync-stars",
                "sync",
                "fetch",
                scanned_count,
                estimated_total,
                format!("正在读取第 {page} 页，已扫描 {scanned_count} 个 Stars"),
                None,
            ),
        );
        Ok(page_items)
    })?;
    storage.upsert_repositories(&repositories)?;

    let incoming_ids = repositories
        .iter()
        .map(|repository| repository.id.as_str())
        .collect::<HashSet<_>>();
    let created_count = incoming_ids
        .iter()
        .filter(|repository_id| !existing_states.contains_key(**repository_id))
        .count();
    let updated_count = incoming_ids.len().saturating_sub(created_count);
    let removed_ids = compute_removed_repository_ids(&existing_states, &incoming_ids);
    storage.mark_repositories_removed(&account_id, &removed_ids)?;
    let removed_count = removed_ids.len();
    let active_count = storage.count_active_repositories_for_account(&account_id)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "sync-stars",
            "sync",
            incoming_ids.len(),
            incoming_ids.len(),
            format!(
                "同步完成：当前 {active_count} 个，新增 {created_count} 个，移除 {removed_count} 个"
            ),
        ),
    );

    Ok(StarSyncSummary {
        account_login: user.login,
        active_count,
        created_count,
        updated_count,
        removed_count,
        scanned_count: incoming_ids.len(),
    })
}

fn collect_authoritative_star_pages<T, FetchPage>(
    page_size: usize,
    mut fetch_page: FetchPage,
) -> Result<Vec<T>, String>
where
    FetchPage: FnMut(u32) -> Result<Vec<T>, String>,
{
    if page_size == 0 {
        return Err("GitHub Stars 分页大小必须大于 0".to_owned());
    }

    let mut repositories = Vec::new();
    let mut page = 1_u32;
    loop {
        let page_items = fetch_page(page)?;
        let page_len = page_items.len();
        repositories.extend(page_items);
        if page_len < page_size {
            return Ok(repositories);
        }
        page = page
            .checked_add(1)
            .ok_or_else(|| "GitHub Stars 分页数量超出支持范围".to_owned())?;
    }
}

fn compute_removed_repository_ids(
    existing_states: &HashMap<String, String>,
    incoming_ids: &HashSet<&str>,
) -> Vec<String> {
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
    request: Option<FetchReadmesRequest>,
) -> Result<ReadmeFetchSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "README 抓取",
        progress_handle,
        "fetch-readmes",
        "readme",
        move || fetch_repository_readmes_worker(app_handle, request),
    )
    .await
}

#[tauri::command]
async fn fetch_repository_readme(
    app_handle: tauri::AppHandle,
    request: RepositoryDetailRequest,
) -> Result<storage::RepositoryDetailView, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "单仓库 README 抓取",
        progress_handle,
        "fetch-repository-readme",
        "readme",
        move || fetch_repository_readme_worker(app_handle, request),
    )
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
    request: Option<FetchReadmesRequest>,
) -> Result<ReadmeFetchSummary, String> {
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let request = request.unwrap_or(FetchReadmesRequest {
        only_missing: None,
        repository_ids: None,
    });
    let repositories = filter_repositories_by_ids(
        storage.list_active_repositories(Some(&account_id))?,
        request.repository_ids,
    );
    let only_missing = request.only_missing.unwrap_or(true);
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
            if total_count == 0 {
                "没有需要处理的 README 任务".to_owned()
            } else {
                format!("正在并发抓取仓库 README（最多 {README_FETCH_CONCURRENCY} 个并行请求）")
            },
            None,
        ),
    );

    let (fetch_targets, cached_skipped_count, mut preflight_failures) =
        partition_readme_fetch_targets(repositories, only_missing, |repository_id| {
            storage.get_readme_hash(repository_id)
        });
    skipped_count += cached_skipped_count;
    failures.append(&mut preflight_failures);

    let mut processed_count = skipped_count + failures.len();
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "fetch-readmes",
            "readme",
            "fetch",
            processed_count,
            total_count,
            format!(
                "README 解析准备完成：已跳过 {skipped_count} 个缓存项，待处理 {} 个",
                total_count.saturating_sub(processed_count)
            ),
            None,
        ),
    );
    let mut repository_iter = fetch_targets.into_iter();

    loop {
        let batch = repository_iter
            .by_ref()
            .take(README_FETCH_CONCURRENCY)
            .collect::<Vec<_>>();

        if batch.is_empty() {
            break;
        }

        let batch_label = format_repository_batch_label(&batch);
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "fetch-readmes",
                "readme",
                "fetch",
                processed_count,
                total_count,
                format!("正在抓取 README：{batch_label}"),
                None,
            ),
        );

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
                    emit_task_progress(
                        &app_handle,
                        TaskProgressEvent::running(
                            "fetch-readmes",
                            "readme",
                            "fetch",
                            processed_count,
                            total_count,
                            "README 抓取线程异常退出，已记录失败并继续处理后续仓库",
                            None,
                        ),
                    );
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
    let completion_message = format!(
        "README 处理完成：更新 {fetched_count} 个，跳过 {skipped_count} 个，缺失 {missing_count} 个，失败 {} 个",
        failures.len()
    );
    let completion_progress = if failures.is_empty() {
        TaskProgressEvent::succeeded(
            "fetch-readmes",
            "readme",
            total_count,
            total_count,
            completion_message,
        )
    } else {
        TaskProgressEvent::partial(
            "fetch-readmes",
            "readme",
            total_count,
            total_count,
            completion_message,
        )
    };
    emit_task_progress(&app_handle, completion_progress);

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

fn partition_readme_fetch_targets<F>(
    repositories: Vec<storage::StoredRepository>,
    only_missing: bool,
    mut readme_hash_for: F,
) -> (
    Vec<storage::StoredRepository>,
    usize,
    Vec<ReadmeFetchFailure>,
)
where
    F: FnMut(&str) -> Result<Option<String>, String>,
{
    if !only_missing {
        return (repositories, 0, Vec::new());
    }

    let mut fetch_targets = Vec::new();
    let mut skipped_count = 0_usize;
    let mut failures = Vec::new();

    for repository in repositories {
        match readme_hash_for(&repository.id) {
            Ok(Some(_)) => skipped_count += 1,
            Ok(None) => fetch_targets.push(repository),
            Err(error) => failures.push(ReadmeFetchFailure {
                repository_id: repository.id,
                full_name: repository.full_name,
                error,
            }),
        }
    }

    (fetch_targets, skipped_count, failures)
}

fn format_repository_batch_label(repositories: &[storage::StoredRepository]) -> String {
    let names = repositories
        .iter()
        .take(3)
        .map(|repository| repository.full_name.as_str())
        .collect::<Vec<_>>()
        .join("、");
    let remaining_count = repositories.len().saturating_sub(3);

    if remaining_count > 0 {
        format!("{names}，另 {remaining_count} 个")
    } else {
        names
    }
}

fn filter_repositories_by_ids(
    repositories: Vec<storage::StoredRepository>,
    repository_ids: Option<Vec<String>>,
) -> Vec<storage::StoredRepository> {
    let Some(repository_ids) = repository_ids else {
        return repositories;
    };
    let requested_ids = repository_ids
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    if requested_ids.is_empty() {
        return repositories;
    }

    repositories
        .into_iter()
        .filter(|repository| requested_ids.contains(repository.id.as_str()))
        .collect()
}

fn progress_current(current: usize, total: usize) -> usize {
    if total == 0 {
        current
    } else {
        current.min(total)
    }
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
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "AI 标签网络生成",
        progress_handle,
        "generate-ai-tag-network",
        "ai",
        move || generate_ai_tag_network_worker(app_handle, request),
    )
    .await
}

fn generate_ai_tag_network_worker(
    app_handle: tauri::AppHandle,
    request: GenerateAiTagNetworkRequest,
) -> Result<storage::ApplyAiTagAssignmentsSummary, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let ai_config = hydrate_ai_request_config(&app_handle, request.ai_config)?;
    let limit = request.limit.map(|value| value.clamp(1, 1000));
    let sources = storage.list_repository_tagging_sources(&request.account_id, limit)?;

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
    if repositories.is_empty() {
        return Err("没有可用于生成标签网络的 Stars 仓库".to_owned());
    }

    let batch_total = repositories
        .chunks(ai::MAX_TAG_NETWORK_REPOSITORIES)
        .count()
        .max(1);
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "generate-ai-tag-network",
            "ai",
            "analyze",
            0,
            batch_total,
            format!(
                "正在基于 {} 个 Stars 简略信息生成标签网络，预计分 {} 批处理",
                repositories.len(),
                batch_total
            ),
            None,
        ),
    );

    let mut assignments = Vec::new();
    let mut failures = Vec::new();
    let mut failed_batch_count = 0_usize;
    let mut consecutive_failures = 0_usize;
    let mut processed_batch_count = 0_usize;
    for (batch_index, batch) in repositories
        .chunks(ai::MAX_TAG_NETWORK_REPOSITORIES)
        .enumerate()
    {
        processed_batch_count = batch_index + 1;
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "generate-ai-tag-network",
                "ai",
                "analyze",
                batch_index,
                batch_total,
                format!(
                    "正在分析第 {} / {} 批 Stars 简略信息（本批 {} 个仓库）",
                    batch_index + 1,
                    batch_total,
                    batch.len()
                ),
                None,
            ),
        );

        match ai::generate_tag_network(&ai_config, batch) {
            Ok(suggestions) => {
                consecutive_failures = 0;
                assignments.extend(suggestions.into_iter().map(|suggestion| {
                    storage::AiTagAssignment {
                        tag_name: suggestion.tag_name,
                        color: suggestion.color,
                        repository_full_names: suggestion.repository_full_names,
                    }
                }));
            }
            Err(error) => {
                failed_batch_count += 1;
                consecutive_failures += 1;
                let failure_message =
                    format!("第 {} / {} 批失败：{error}", batch_index + 1, batch_total);
                failures.push(failure_message.clone());
                emit_task_progress(
                    &app_handle,
                    TaskProgressEvent::running(
                        "generate-ai-tag-network",
                        "ai",
                        "partial-failure",
                        batch_index + 1,
                        batch_total,
                        format!("{failure_message}。已记录失败并继续处理后续批次"),
                        None,
                    ),
                );

                if consecutive_failures >= 3 {
                    let remaining_batch_count = batch_total.saturating_sub(batch_index + 1);
                    if remaining_batch_count > 0 {
                        failures.push(format!(
                            "连续 3 个批次失败，已停止处理剩余 {remaining_batch_count} 个批次"
                        ));
                    }
                    break;
                }
            }
        }
    }

    let assignments = merge_ai_tag_assignments(assignments);
    if assignments.is_empty() {
        let failure_summary = if failures.is_empty() {
            "AI 未返回可用的标签网络结果".to_owned()
        } else {
            failures.join("；")
        };
        return Err(format!("AI 标签网络生成失败：{failure_summary}"));
    }
    let summary = storage.apply_ai_tag_assignments(&request.account_id, &assignments)?;
    if summary.linked_count == 0 {
        return Err(format!(
            "AI 标签网络生成失败：模型返回的仓库名称未匹配到本地 Stars，已跳过 {} 个仓库引用。请重试，或先同步 Stars 后再生成。",
            summary.skipped_repository_count
        ));
    }
    let summary = storage::ApplyAiTagAssignmentsSummary {
        failed_batch_count,
        failures,
        ..summary
    };

    emit_task_progress(
        &app_handle,
        build_ai_tag_network_completion_progress(&summary, processed_batch_count, batch_total),
    );

    Ok(summary)
}

fn build_ai_tag_network_completion_progress(
    summary: &storage::ApplyAiTagAssignmentsSummary,
    processed_batch_count: usize,
    batch_total: usize,
) -> TaskProgressEvent {
    let total = batch_total.max(1);
    let current = processed_batch_count.min(total);
    let message = format_ai_tag_network_success_message(summary);

    if summary.failed_batch_count > 0 {
        TaskProgressEvent::partial("generate-ai-tag-network", "ai", current, total, message)
    } else {
        TaskProgressEvent::succeeded("generate-ai-tag-network", "ai", total, total, message)
    }
}

fn format_ai_tag_network_success_message(
    summary: &storage::ApplyAiTagAssignmentsSummary,
) -> String {
    let base_message = format!(
        "AI 标签网络已生成：{} 个标签，{} 条仓库关联",
        summary.tag_count, summary.linked_count
    );
    if summary.failed_batch_count > 0 {
        format!(
            "{base_message}，{} 个批次失败，可稍后重试补全",
            summary.failed_batch_count
        )
    } else {
        base_message
    }
}

fn merge_ai_tag_assignments(
    assignments: Vec<storage::AiTagAssignment>,
) -> Vec<storage::AiTagAssignment> {
    struct AssignmentAccumulator {
        tag_name: String,
        color: Option<String>,
        repository_full_names: Vec<String>,
        seen_repositories: HashSet<String>,
    }

    let mut order = Vec::new();
    let mut merged: HashMap<String, AssignmentAccumulator> = HashMap::new();
    for assignment in assignments {
        let tag_name = assignment.tag_name.trim();
        if tag_name.is_empty() {
            continue;
        }

        let key = tag_name.to_ascii_lowercase();
        if !merged.contains_key(&key) {
            order.push(key.clone());
        }

        let entry = merged.entry(key).or_insert_with(|| AssignmentAccumulator {
            tag_name: tag_name.to_owned(),
            color: assignment.color.clone(),
            repository_full_names: Vec::new(),
            seen_repositories: HashSet::new(),
        });
        if entry.color.is_none() {
            entry.color = assignment.color;
        }

        for full_name in assignment.repository_full_names {
            let normalized_full_name = full_name.trim();
            if normalized_full_name.is_empty() {
                continue;
            }
            if entry
                .seen_repositories
                .insert(normalized_full_name.to_owned())
            {
                entry
                    .repository_full_names
                    .push(normalized_full_name.to_owned());
            }
        }
    }

    order
        .into_iter()
        .filter_map(|key| merged.remove(&key))
        .filter(|entry| !entry.repository_full_names.is_empty())
        .map(|entry| storage::AiTagAssignment {
            tag_name: entry.tag_name,
            color: entry.color,
            repository_full_names: entry.repository_full_names,
        })
        .collect()
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
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "AI 摘要生成",
        progress_handle,
        "generate-ai-document",
        "ai",
        move || generate_repository_ai_document_worker(app_handle, request),
    )
    .await
}

fn generate_repository_ai_document_worker(
    app_handle: tauri::AppHandle,
    request: GenerateAiDocumentRequest,
) -> Result<storage::RepositoryDetailView, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let request_id = request
        .request_id
        .unwrap_or_else(|| format!("repository-ai-{}", request.repository_id));
    let account_id = match request.account_id {
        Some(account_id) => account_id,
        None => {
            let token = auth::require_github_token()?;
            let user = auth::verify_github_token(&token)?;
            user.id.to_string()
        }
    };
    let mut source = storage.get_repository_ai_source(&request.repository_id, Some(&account_id))?;
    let needs_readme_fetch = source.readme.is_none();
    let progress_total = if needs_readme_fetch { 2 } else { 1 };
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "repository-ai-document",
        "prepare",
        "started",
        format!("正在准备解析 {}", source.full_name),
        Some(&source.id),
    );
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "generate-ai-document",
            "ai",
            "prepare",
            0,
            progress_total,
            format!("正在准备 {}", source.full_name),
            Some(source.full_name.clone()),
        ),
    );
    let readme = match source.readme.take() {
        Some(readme) => readme,
        None => {
            let token = auth::require_github_token()?;
            emit_ai_stream_status(
                &app_handle,
                &request_id,
                "repository-ai-document",
                "fetch-readme",
                "started",
                format!("正在补抓 {} 的 README", source.full_name),
                Some(&source.id),
            );
            emit_task_progress(
                &app_handle,
                TaskProgressEvent::running(
                    "generate-ai-document",
                    "ai",
                    "fetch-readme",
                    0,
                    progress_total,
                    format!("正在补抓 {} 的 README", source.full_name),
                    Some(source.full_name.clone()),
                ),
            );
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
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "repository-ai-document",
        "summarize",
        "started",
        format!("正在生成 {} 的中文解析", source.full_name),
        Some(&source.id),
    );
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "generate-ai-document",
            "ai",
            "summarize",
            progress_total.saturating_sub(1),
            progress_total,
            format!("正在生成 {} 的 AI 摘要", source.full_name),
            Some(source.full_name.clone()),
        ),
    );
    let ai_config = hydrate_ai_request_config(&app_handle, request.ai_config)?;
    let stream_app_handle = app_handle.clone();
    let stream_request_id = request_id.clone();
    let stream_repository_id = source.id.clone();
    let mut latest_stream_text = String::new();
    let document = ai::summarize_readme_streaming(
        &ai_config,
        &source.full_name,
        source.description.as_deref(),
        &readme.raw_markdown,
        &mut |stage, status, delta, text, message| {
            if let Some(next_text) = text {
                latest_stream_text = next_text.to_owned();
            }
            match status {
                "delta" => {
                    let delta = delta.unwrap_or_default();
                    let text = text.unwrap_or(latest_stream_text.as_str());
                    emit_ai_stream_delta(
                        &stream_app_handle,
                        &stream_request_id,
                        "repository-ai-document",
                        stage,
                        delta,
                        text,
                        Some(&stream_repository_id),
                    );
                }
                _ => emit_ai_stream_status(
                    &stream_app_handle,
                    &stream_request_id,
                    "repository-ai-document",
                    stage,
                    status,
                    message.unwrap_or("AI 解析状态已更新"),
                    Some(&stream_repository_id),
                ),
            }
        },
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
        document.input_tokens,
        document.output_tokens,
    )?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "generate-ai-document",
            "ai",
            progress_total,
            progress_total,
            format!("{} 的 AI 摘要已生成", source.full_name),
        ),
    );
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "repository-ai-document",
        "done",
        "finished",
        format!("{} 的 AI 解析已生成", source.full_name),
        Some(&source.id),
    );
    storage.get_repository_detail(&source.id, &source.account_id)
}

#[tauri::command]
async fn batch_generate_repository_ai_documents(
    app_handle: tauri::AppHandle,
    request: BatchGenerateAiDocumentsRequest,
) -> Result<BatchAiDocumentSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "批量 AI 摘要生成",
        progress_handle,
        "batch-generate-ai-documents",
        "ai",
        move || batch_generate_repository_ai_documents_worker(app_handle, request),
    )
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
    let BatchGenerateAiDocumentsRequest {
        ai_config,
        limit,
        only_missing,
        repository_ids,
    } = request;
    let ai_config = hydrate_ai_request_config(&app_handle, ai_config)?;
    let repositories = filter_repositories_by_ids(
        storage.list_active_repositories(Some(&account_id))?,
        repository_ids,
    );
    let processing_limit = limit.map(|value| value.clamp(1, 1000));
    let progress_total = processing_limit
        .map(|limit| limit.min(repositories.len()))
        .unwrap_or(repositories.len());
    let only_missing = only_missing.unwrap_or(true);
    let mut scanned_count = 0_usize;
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
            if processing_limit.is_some() {
                "正在按本次上限批量解析 README"
            } else {
                "正在批量解析全部 Stars 的 README"
            },
            None,
        ),
    );

    for repository in repositories.into_iter().take(progress_total) {
        let repository_name = repository.full_name.clone();
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "batch-generate-ai-documents",
                "ai",
                "check",
                progress_current(scanned_count, progress_total),
                progress_total,
                format!("正在检查 {}", repository_name),
                Some(repository_name.clone()),
            ),
        );
        let result = (|| -> Result<BatchItemOutcome, String> {
            let mut source = storage.get_repository_ai_source(&repository.id, Some(&account_id))?;
            if only_missing {
                if let Some(readme) = source.readme.as_ref() {
                    if storage.get_ai_document_source_hash(&source.id)?.as_deref()
                        == Some(readme.content_hash.as_str())
                    {
                        return Ok(BatchItemOutcome::Skipped);
                    }
                }
            }

            emit_task_progress(
                &app_handle,
                TaskProgressEvent::running(
                    "batch-generate-ai-documents",
                    "ai",
                    "analyze",
                    progress_current(scanned_count, progress_total),
                    progress_total,
                    format!("正在分析 {}", source.full_name),
                    Some(source.full_name.clone()),
                ),
            );
            let readme = match source.readme.take() {
                Some(readme) => readme,
                None => {
                    emit_task_progress(
                        &app_handle,
                        TaskProgressEvent::running(
                            "batch-generate-ai-documents",
                            "ai",
                            "fetch-readme",
                            progress_current(scanned_count, progress_total),
                            progress_total,
                            format!("正在抓取 {} 的 README", source.full_name),
                            Some(source.full_name.clone()),
                        ),
                    );
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

            emit_task_progress(
                &app_handle,
                TaskProgressEvent::running(
                    "batch-generate-ai-documents",
                    "ai",
                    "summarize",
                    progress_current(scanned_count, progress_total),
                    progress_total,
                    format!("正在让 AI 解析 {}", source.full_name),
                    Some(source.full_name.clone()),
                ),
            );
            let document = ai::summarize_readme(
                &ai_config,
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
                document.input_tokens,
                document.output_tokens,
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
        scanned_count += 1;
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "batch-generate-ai-documents",
                "ai",
                "save",
                progress_current(scanned_count, progress_total),
                progress_total,
                format!("已处理 {}", repository_name),
                Some(repository_name),
            ),
        );
    }
    let completion_message = format!(
        "批量 AI 完成：生成 {generated_count} 个，跳过 {skipped_count} 个，缺少 README {missing_readme_count} 个，失败 {} 个",
        failures.len(),
    );
    let completion_progress = if failures.is_empty() {
        TaskProgressEvent::succeeded(
            "batch-generate-ai-documents",
            "ai",
            progress_current(scanned_count, progress_total),
            progress_total,
            completion_message,
        )
    } else {
        TaskProgressEvent::partial(
            "batch-generate-ai-documents",
            "ai",
            progress_current(scanned_count, progress_total),
            progress_total,
            completion_message,
        )
    };
    emit_task_progress(&app_handle, completion_progress);

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
    let progress_handle = app_handle.clone();
    run_immediate_blocking_task_with_failure_progress(
        "本地知识搜索",
        progress_handle,
        "ai-search",
        "ai",
        move || search_repositories_worker(app_handle, request),
    )
    .await
}

#[tauri::command]
async fn explain_ai_search_topic(
    app_handle: tauri::AppHandle,
    request: ExplainAiSearchTopicRequest,
) -> Result<String, String> {
    let progress_handle = app_handle.clone();
    run_immediate_blocking_task_with_failure_progress(
        "AI 搜索解释",
        progress_handle,
        "ai-search-explanation",
        "ai",
        move || explain_ai_search_topic_worker(app_handle, request),
    )
    .await
}

fn explain_ai_search_topic_worker(
    app_handle: tauri::AppHandle,
    request: ExplainAiSearchTopicRequest,
) -> Result<String, String> {
    let topic = request.topic.trim().to_owned();
    if topic.is_empty() {
        return Err("请选择要解释的问题".to_owned());
    }
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| format!("ai-search-explain-{}", current_event_timestamp()));
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "ai-search",
        "explain",
        "started",
        "正在生成解释",
        None,
    );
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "ai-search-explanation",
            "ai",
            "explain",
            0,
            1,
            format!("正在解释：{topic}"),
            Some(topic.clone()),
        ),
    );
    let ai_config = hydrate_ai_request_config(&app_handle, Some(request.ai_config))?;
    let stream_app_handle = app_handle.clone();
    let mut latest_stream_text = String::new();
    let content = ai::explain_search_topic_streaming(
        &ai_config,
        &topic,
        &mut |stage, status, delta, text, message| {
            if let Some(next_text) = text {
                latest_stream_text = next_text.to_owned();
            }
            match status {
                "delta" => {
                    let delta = delta.unwrap_or_default();
                    let text = text.unwrap_or(latest_stream_text.as_str());
                    emit_ai_stream_delta(
                        &stream_app_handle,
                        &request_id,
                        "ai-search",
                        stage,
                        delta,
                        text,
                        None,
                    );
                }
                _ => emit_ai_stream_status(
                    &stream_app_handle,
                    &request_id,
                    "ai-search",
                    stage,
                    status,
                    message.unwrap_or("AI 解释状态已更新"),
                    None,
                ),
            }
        },
    )?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded("ai-search-explanation", "ai", 1, 1, "解释完成"),
    );
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "ai-search",
        "done",
        "finished",
        "解释完成",
        None,
    );
    Ok(content)
}

fn search_repositories_worker(
    app_handle: tauri::AppHandle,
    request: SearchRepositoriesRequest,
) -> Result<storage::AiSearchResponseData, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let original_query = request.query.trim().to_owned();
    if let Some(answer) = conversational_query_reply(&original_query) {
        return Ok(storage::AiSearchResponseData {
            query: original_query,
            mode: "conversation".to_owned(),
            results: Vec::new(),
            total_count: 0,
            context_queries_used: Vec::new(),
            context_applied: false,
            ai_enhanced: false,
            ai_query: None,
            ai_rationale_zh: Some("当前内容是对话问候，不应触发仓库召回。".to_owned()),
            ai_error: None,
            answer_zh: Some(answer),
            retrieval_mode: "none".to_owned(),
            vector_applied: false,
            vector_error: None,
        });
    }
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| format!("ai-search-{}", original_query));
    let context_queries = request.context_queries.unwrap_or_default();
    let context_repository_ids = request.context_repository_ids.unwrap_or_default();
    let ai_config = request.ai_config.clone();
    let progress_total = if ai_config.is_some() { 4 } else { 3 };
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "ai-search",
        "plan",
        "started",
        if ai_config.is_some() {
            "正在理解你的搜索问题"
        } else {
            "正在准备本地知识搜索"
        },
        None,
    );
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "ai-search",
            "ai",
            "plan",
            0,
            progress_total,
            if ai_config.is_some() {
                "正在理解搜索问题并准备 AI 增强"
            } else {
                "正在准备本地知识搜索"
            },
            Some(original_query.clone()),
        ),
    );
    let (effective_query, metadata) = build_ai_search_query(
        &app_handle,
        &request_id,
        original_query.clone(),
        &context_queries,
        ai_config.clone(),
    )?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "ai-search",
            "ai",
            "vector",
            progress_total.saturating_sub(2),
            progress_total,
            "正在执行向量召回与严格相关度过滤",
            Some(original_query.clone()),
        ),
    );
    let vector_search = match build_vector_search_scores(
        &app_handle,
        &storage,
        &request.account_id,
        &effective_query,
        request.embedding_config,
    ) {
        Ok(result) => result,
        Err(error) => VectorSearchOutcome {
            scores: HashMap::new(),
            error: Some(format!("向量检索已降级：{error}")),
            max_results: 8,
        },
    };

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "ai-search",
            "ai",
            "analyze",
            progress_total.saturating_sub(1),
            progress_total,
            "正在融合向量、Stars 元数据、README、AI 摘要、标签和笔记",
            Some(original_query.clone()),
        ),
    );
    let mut response = storage.search_repositories(storage::RepositorySearchOptions {
        query: &effective_query,
        context_queries: &context_queries,
        context_repository_ids: &context_repository_ids,
        limit: request.limit.unwrap_or(vector_search.max_results),
        offset: request.offset.unwrap_or(0),
        max_results: vector_search.max_results,
        account_id: Some(&request.account_id),
        vector_scores: &vector_search.scores,
        vector_error: vector_search.error,
        metadata: Some(metadata),
    })?;
    let local_answer = build_local_search_answer(&original_query, &response);
    response.answer_zh = Some(local_answer.clone());
    if response.ai_enhanced && !response.results.is_empty() {
        if let Some(config) = ai_config {
            emit_ai_stream_status(
                &app_handle,
                &request_id,
                "ai-search",
                "answer",
                "started",
                "正在根据检索结果生成回答",
                None,
            );
            let evidence = response
                .results
                .iter()
                .map(|result| ai::AiSearchEvidence {
                    repository_full_name: result.repository.full_name.clone(),
                    description: result.repository.description.clone(),
                    topics: result.repository.topics.clone(),
                    summary_zh: result.ai_summary.clone(),
                })
                .collect::<Vec<_>>();
            match hydrate_ai_request_config(&app_handle, Some(config))
                .and_then(|config| ai::answer_search_results(&config, &original_query, &evidence))
            {
                Ok(answer) => {
                    response.answer_zh = Some(answer);
                    emit_ai_stream_status(
                        &app_handle,
                        &request_id,
                        "ai-search",
                        "answer",
                        "finished",
                        "已根据检索结果生成回答",
                        None,
                    );
                }
                Err(error) => {
                    let answer_error = format!("AI 回答生成失败，已使用本地证据回答：{error}");
                    response.ai_error = Some(match response.ai_error.take() {
                        Some(existing) => format!("{existing}；{answer_error}"),
                        None => answer_error.clone(),
                    });
                    emit_ai_stream_status(
                        &app_handle,
                        &request_id,
                        "ai-search",
                        "answer",
                        "fallback",
                        answer_error,
                        None,
                    );
                }
            }
        }
    }
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "ai-search",
        "analyze",
        "finished",
        format!("本地知识库已完成匹配，找到 {} 个仓库", response.total_count),
        None,
    );
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "ai-search",
            "ai",
            progress_total,
            progress_total,
            format!("搜索完成：找到 {} 个匹配仓库", response.total_count),
        ),
    );
    emit_ai_stream_status(
        &app_handle,
        &request_id,
        "ai-search",
        "done",
        "finished",
        format!("搜索完成：找到 {} 个匹配仓库", response.total_count),
        None,
    );
    Ok(response)
}

fn conversational_query_reply(query: &str) -> Option<String> {
    let normalized = query
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace() && !"，。！？,.!?~～".contains(*character))
        .collect::<String>();
    let is_greeting = matches!(
        normalized.as_str(),
        "你好"
            | "您好"
            | "嗨"
            | "哈喽"
            | "hello"
            | "hi"
            | "hey"
            | "谢谢"
            | "感谢"
            | "你是谁"
            | "在吗"
    );
    is_greeting.then(|| {
        "你好！这里用于精准查找你的 GitHub Stars。请描述你想找的项目能力，例如“支持离线缓存的 Rust HTTP 客户端”，我会最多返回 10 个高相关结果。".to_owned()
    })
}

struct VectorSearchOutcome {
    scores: HashMap<String, f64>,
    error: Option<String>,
    max_results: usize,
}

fn build_vector_search_scores(
    app_handle: &tauri::AppHandle,
    storage: &AppStorage,
    account_id: &str,
    query: &str,
    embedding_config: Option<ai::EmbeddingRequestConfig>,
) -> Result<VectorSearchOutcome, String> {
    let Some(config) = hydrate_embedding_request_config(app_handle, embedding_config)? else {
        return Ok(VectorSearchOutcome {
            scores: HashMap::new(),
            error: None,
            max_results: 8,
        });
    };
    let embedding = ai::embed_text(&config, query)?;
    let index = vector_index::ZvecRepositoryIndex::from_app_handle(app_handle)?;
    let request = vector_index::VectorSearchRequest {
        account_id: account_id.to_owned(),
        model: config.model.clone(),
        vector: embedding.vector,
        limit: config.max_results.saturating_mul(3).clamp(10, 30),
        min_score: config.min_score,
    };
    let mut hits = index.search(&request);
    let should_restore = hits.as_ref().is_err()
        || (hits.as_ref().is_ok_and(Vec::is_empty)
            && index
                .count(account_id, &config.model, config.dimensions)
                .unwrap_or(0)
                == 0);
    if should_restore {
        let stored = storage.list_stored_repository_embeddings(
            account_id,
            &config.model,
            config.dimensions,
            VECTOR_MODEL_VERSION,
        )?;
        if !stored.is_empty() {
            index.reset_bucket(account_id, &config.model, config.dimensions)?;
            for record in stored {
                index.upsert(&vector_index::RepositoryVectorRecord {
                    account_id: record.account_id,
                    repo_id: record.repo_id,
                    source_hash: record.source_hash,
                    model: record.model,
                    vector: record.vector,
                })?;
            }
            hits = index.search(&request);
        }
    }
    let hits = hits?;
    let scores = hits
        .into_iter()
        .map(|hit| (hit.repo_id, f64::from(hit.score)))
        .collect::<HashMap<_, _>>();
    let message = scores
        .is_empty()
        .then(|| "向量索引尚无达到阈值的候选，已使用严格关键词检索。".to_owned());
    Ok(VectorSearchOutcome {
        scores,
        error: message,
        max_results: config.max_results.clamp(1, 10),
    })
}

fn build_local_search_answer(query: &str, response: &storage::AiSearchResponseData) -> String {
    if response.results.is_empty() {
        return format!(
            "没有找到与“{query}”达到相关度门槛的仓库。可以补充技术栈、使用场景或关键能力后再试。"
        );
    }
    let recommendations = response
        .results
        .iter()
        .take(3)
        .map(|result| {
            let summary = result
                .ai_summary
                .as_deref()
                .or(result.repository.description.as_deref())
                .unwrap_or("暂无摘要");
            format!(
                "- {}：{}",
                result.repository.full_name,
                summary.chars().take(100).collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "为“{query}”筛选出 {} 个高相关仓库，优先建议：\n{}",
        response.total_count, recommendations
    )
}

fn build_ai_search_query(
    app_handle: &tauri::AppHandle,
    request_id: &str,
    original_query: String,
    context_queries: &[String],
    ai_config: Option<ai::AiRequestConfig>,
) -> Result<(String, storage::AiSearchMetadata), String> {
    let mut metadata = storage::AiSearchMetadata {
        original_query: original_query.clone(),
        ai_enhanced: false,
        ai_query: None,
        ai_rationale_zh: None,
        ai_error: None,
    };
    let Some(ai_config) = ai_config else {
        return Ok((original_query, metadata));
    };
    if ai_config.provider.trim().eq_ignore_ascii_case("none") {
        return Ok((original_query, metadata));
    }
    if is_short_exact_technical_query(&original_query) {
        metadata.ai_enhanced = true;
        metadata.ai_query = Some(original_query.clone());
        metadata.ai_rationale_zh =
            Some("短技术词使用完整词精确检索，避免 AI 扩写引入宽泛或无关候选。".to_owned());
        return Ok((original_query, metadata));
    }

    let stream_app_handle = app_handle.clone();
    let mut latest_stream_text = String::new();
    match hydrate_ai_request_config(app_handle, Some(ai_config)).and_then(|config| {
        ai::plan_search_query_streaming(
            &config,
            &original_query,
            context_queries,
            &mut |stage, status, delta, text, message| {
                if let Some(next_text) = text {
                    latest_stream_text = next_text.to_owned();
                }
                match status {
                    "delta" => {
                        let delta = delta.unwrap_or_default();
                        let text = text.unwrap_or(latest_stream_text.as_str());
                        emit_ai_stream_delta(
                            &stream_app_handle,
                            request_id,
                            "ai-search",
                            stage,
                            delta,
                            text,
                            None,
                        );
                    }
                    _ => emit_ai_stream_status(
                        &stream_app_handle,
                        request_id,
                        "ai-search",
                        stage,
                        status,
                        message.unwrap_or("AI 搜索状态已更新"),
                        None,
                    ),
                }
            },
        )
    }) {
        Ok(plan) => {
            let mut terms = vec![plan.search_query.clone()];
            terms.extend(plan.keywords.iter().cloned());
            let effective_query = terms
                .into_iter()
                .map(|term| term.trim().to_owned())
                .filter(|term| !term.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            metadata.ai_enhanced = true;
            metadata.ai_query = Some(effective_query.clone());
            metadata.ai_rationale_zh = Some(plan.rationale_zh);
            emit_ai_stream_status(
                app_handle,
                request_id,
                "ai-search",
                "plan",
                "finished",
                "已经理解问题，开始匹配本地知识库",
                None,
            );
            Ok((effective_query, metadata))
        }
        Err(error) => {
            metadata.ai_error = Some(format!("AI 搜索增强失败，已改用本地知识搜索：{error}"));
            emit_ai_stream_status(
                app_handle,
                request_id,
                "ai-search",
                "plan",
                "failed",
                format!("AI 理解失败，已改用本地知识搜索：{error}"),
                None,
            );
            Ok((original_query, metadata))
        }
    }
}

fn is_short_exact_technical_query(query: &str) -> bool {
    let normalized = query.trim();
    (1..=3).contains(&normalized.len())
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

#[tauri::command]
async fn list_github_rankings(
    app_handle: tauri::AppHandle,
    request: ListGithubRankingsRequest,
) -> Result<RankingPage, String> {
    run_background_task("加载开源榜单", move || {
        let storage = AppStorage::from_app_handle(&app_handle)?;
        let page = request.page.unwrap_or(1).max(1);
        let limit = request.limit.unwrap_or(20).clamp(1, 50);
        let language = request
            .language
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let cache_key = format!(
            "{}:{}:{}:{}:{}",
            request.account_id,
            request.kind.trim(),
            language.unwrap_or("all"),
            page,
            limit,
        );
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let cached = storage.get_github_ranking_cache(&cache_key)?;
        let starred_full_names = storage.list_active_repository_full_names(&request.account_id)?;

        if !request.force_refresh.unwrap_or(false) {
            if let Some(cache) = cached.as_ref() {
                if ranking_query::is_ranking_cache_fresh(cache.fetched_at, now) {
                    return parse_cached_ranking_page(cache, false, &starred_full_names);
                }
            }
        }

        let thirty_days_ago = (time::OffsetDateTime::now_utc() - time::Duration::days(30))
            .date()
            .to_string();
        let ninety_days_ago = (time::OffsetDateTime::now_utc() - time::Duration::days(90))
            .date()
            .to_string();
        let one_year_ago = (time::OffsetDateTime::now_utc() - time::Duration::days(365))
            .date()
            .to_string();
        let query = ranking_query::build_global_ranking_query(
            request.kind.trim(),
            language,
            ranking_query::RankingDateThresholds {
                thirty_days_ago: &thirty_days_ago,
                ninety_days_ago: &ninety_days_ago,
                one_year_ago: &one_year_ago,
            },
        )?;
        let token = auth::require_github_token()?;
        match github::search_repository_page(&token, &query, "stars", "desc", page, limit) {
            Ok(result) => {
                let accessible_total = result.total_count.min(1_000);
                let response = RankingPage {
                    kind: request.kind.trim().to_owned(),
                    items: result
                        .items
                        .into_iter()
                        .map(|repository| RankingItem {
                            is_starred: starred_full_names.contains(&repository.full_name),
                            full_name: repository.full_name,
                            description: repository.description,
                            language: repository.language,
                            topics: repository.topics,
                            html_url: repository.html_url,
                            stars_count: repository.stars_count,
                            forks_count: repository.forks_count,
                            pushed_at: repository.pushed_at,
                            starred_at: None,
                        })
                        .collect(),
                    total_count: accessible_total,
                    page,
                    limit,
                    has_more: page.saturating_mul(limit) < accessible_total,
                    generated_at: current_ranking_timestamp()?,
                    is_stale: false,
                    from_cache: false,
                };
                let payload_json = serde_json::to_string(&response)
                    .map_err(|error| format!("GitHub 排行榜缓存序列化失败：{error}"))?;
                storage.save_github_ranking_cache(&cache_key, &payload_json, now)?;
                Ok(response)
            }
            Err(error) => match cached.as_ref() {
                Some(cache) => parse_cached_ranking_page(cache, true, &starred_full_names),
                None => Err(error),
            },
        }
    })
    .await
}

#[tauri::command]
fn list_personal_rankings(
    app_handle: tauri::AppHandle,
    request: ListPersonalRankingsRequest,
) -> Result<RankingPage, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let page = request.page.unwrap_or(1).max(1);
    let limit = request.limit.unwrap_or(20).clamp(1, 50);
    let repository_page = storage.list_personal_ranking_page(
        limit,
        (page - 1).saturating_mul(limit),
        &request.account_id,
        request.language.as_deref(),
        request.kind.trim(),
    )?;
    let total_count = repository_page.total_count;

    Ok(RankingPage {
        kind: request.kind.trim().to_owned(),
        items: repository_page
            .items
            .into_iter()
            .map(|repository| RankingItem {
                full_name: repository.full_name,
                description: repository.description,
                language: repository.language,
                topics: repository.topics,
                html_url: repository.html_url,
                stars_count: repository.stars_count,
                forks_count: repository.forks_count,
                pushed_at: repository.pushed_at,
                starred_at: Some(repository.starred_at),
                is_starred: true,
            })
            .collect(),
        total_count,
        page,
        limit,
        has_more: page.saturating_mul(limit) < total_count,
        generated_at: current_ranking_timestamp()?,
        is_stale: false,
        from_cache: false,
    })
}

#[tauri::command]
async fn fetch_github_ranking_readme(
    app_handle: tauri::AppHandle,
    request: FetchGithubRankingReadmeRequest,
) -> Result<GithubRecommendationReadme, String> {
    run_background_task("读取排行榜项目介绍", move || {
        let storage = AppStorage::from_app_handle(&app_handle)?;
        let full_name = request.full_name.trim().to_owned();
        if let Some(readme) =
            storage.get_github_recommendation_readme(&request.account_id, &full_name)?
        {
            return github_recommendation_readme_response(
                &storage,
                &request.account_id,
                &full_name,
                readme,
                true,
            );
        }

        let token = auth::require_github_token()?;
        let readme = github::fetch_readme(&token, &full_name, &full_name)?
            .ok_or_else(|| format!("{full_name} 暂未提供 README"))?;
        storage.save_github_recommendation_readme(&request.account_id, &full_name, &readme)?;
        github_recommendation_readme_response(
            &storage,
            &request.account_id,
            &full_name,
            readme,
            false,
        )
    })
    .await
}

#[tauri::command]
async fn star_github_ranking_repository(
    request: StarGithubRankingRepositoryRequest,
) -> Result<RankingStarResult, String> {
    run_background_task("加入 GitHub Stars", move || {
        let token = auth::require_github_token()?;
        let user = auth::verify_github_token(&token)?;
        if request.account_id != user.id.to_string() {
            return Err("当前 GitHub 账号与排行榜所属账号不一致，请重新连接后再操作。".to_owned());
        }
        let full_name = request.full_name.trim().to_owned();
        github::star_repository(&token, &full_name)?;
        Ok(RankingStarResult {
            full_name,
            is_starred: true,
        })
    })
    .await
}

fn parse_cached_ranking_page(
    cache: &storage::GithubRankingCacheEntry,
    is_stale: bool,
    starred_full_names: &HashSet<String>,
) -> Result<RankingPage, String> {
    let mut response = serde_json::from_str::<RankingPage>(&cache.payload_json)
        .map_err(|error| format!("GitHub 排行榜缓存内容解析失败：{error}"))?;
    response.from_cache = true;
    response.is_stale = is_stale;
    for repository in &mut response.items {
        repository.is_starred = starred_full_names.contains(&repository.full_name);
    }
    Ok(response)
}

fn current_ranking_timestamp() -> Result<String, String> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| format!("排行榜生成时间格式化失败：{error}"))
}

#[tauri::command]
async fn recommend_github_repositories(
    app_handle: tauri::AppHandle,
    request: RecommendGithubRepositoriesRequest,
) -> Result<GithubRecommendationResponse, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "GitHub 相似项目发现",
        progress_handle,
        "recommend-github-repositories",
        "ai",
        move || recommend_github_repositories_worker(app_handle, request),
    )
    .await
}

#[tauri::command]
fn list_github_recommendation_candidates(
    app_handle: tauri::AppHandle,
    request: ListGithubRecommendationCandidatesRequest,
) -> Result<GithubRecommendationPage, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let candidates = storage.list_github_recommendation_candidates(
        &request.account_id,
        request.status.as_deref(),
        request.category.as_deref(),
        request.limit.unwrap_or(12),
        request.offset.unwrap_or(0),
    )?;

    Ok(GithubRecommendationPage {
        rationale_zh: candidates.rationale_zh,
        queries: candidates.queries,
        results: candidates.repositories,
        total_count: candidates.total_count,
        limit: candidates.limit,
        offset: candidates.offset,
        categories: candidates.categories,
    })
}

#[tauri::command]
fn update_github_recommendation_candidate_status(
    app_handle: tauri::AppHandle,
    request: UpdateGithubRecommendationCandidateRequest,
) -> Result<storage::GithubRecommendationCandidateState, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.update_github_recommendation_candidate_status(
        &request.account_id,
        &request.full_name,
        &request.status,
    )
}

#[tauri::command]
async fn fetch_github_recommendation_readme(
    app_handle: tauri::AppHandle,
    request: FetchGithubRecommendationReadmeRequest,
) -> Result<GithubRecommendationReadme, String> {
    run_background_task("读取推荐项目介绍", move || {
        let storage = AppStorage::from_app_handle(&app_handle)?;
        let full_name = request.full_name.trim().to_owned();
        ensure_github_recommendation_candidate(&storage, &request.account_id, &full_name)?;

        if !request.force_refresh.unwrap_or(false) {
            if let Some(readme) =
                storage.get_github_recommendation_readme(&request.account_id, &full_name)?
            {
                return github_recommendation_readme_response(
                    &storage,
                    &request.account_id,
                    &full_name,
                    readme,
                    true,
                );
            }
        }

        let token = auth::require_github_token()?;
        let readme = github::fetch_readme(&token, &full_name, &full_name)?
            .ok_or_else(|| format!("{full_name} 暂未提供 README"))?;
        storage.save_github_recommendation_readme(&request.account_id, &full_name, &readme)?;
        github_recommendation_readme_response(
            &storage,
            &request.account_id,
            &full_name,
            readme,
            false,
        )
    })
    .await
}

#[tauri::command]
async fn translate_github_recommendation_readme(
    app_handle: tauri::AppHandle,
    request: TranslateGithubRecommendationReadmeRequest,
) -> Result<ai::AiReadmeTranslation, String> {
    run_background_task("翻译推荐项目介绍", move || {
        let storage = AppStorage::from_app_handle(&app_handle)?;
        let full_name = request.full_name.trim().to_owned();
        ensure_github_recommendation_candidate(&storage, &request.account_id, &full_name)?;
        let readme = storage
            .get_github_recommendation_readme(&request.account_id, &full_name)?
            .ok_or_else(|| "请先加载项目 README，再生成中文翻译。".to_owned())?;
        if !request.force_refresh.unwrap_or(false) {
            if let Some(translation) = storage.get_github_recommendation_translation(
                &request.account_id,
                &full_name,
                &readme.content_hash,
            )? {
                return Ok(cached_github_translation_response(translation));
            }
        }

        let ai_config = hydrate_ai_request_config(&app_handle, request.ai_config)?;
        let translation = ai::translate_readme(&ai_config, &full_name, &readme.raw_markdown)?;
        storage.save_github_recommendation_translation(
            &request.account_id,
            &full_name,
            &readme.content_hash,
            &translation.markdown_zh,
            &translation.model,
            translation.input_tokens,
            translation.output_tokens,
            translation.source_char_count,
            translation.translated_char_count,
            translation.is_truncated,
        )?;
        Ok(translation)
    })
    .await
}

fn ensure_github_recommendation_candidate(
    storage: &AppStorage,
    account_id: &str,
    full_name: &str,
) -> Result<(), String> {
    let candidate_exists = storage
        .list_github_recommendation_candidate_states(account_id, &[full_name.to_owned()])?
        .contains_key(full_name);
    if candidate_exists {
        Ok(())
    } else {
        Err("推荐候选项目不存在，请刷新发现列表后重试。".to_owned())
    }
}

fn github_recommendation_readme_response(
    storage: &AppStorage,
    account_id: &str,
    full_name: &str,
    readme: github::ReadmeDocument,
    from_cache: bool,
) -> Result<GithubRecommendationReadme, String> {
    let translation = storage
        .get_github_recommendation_translation(account_id, full_name, &readme.content_hash)?
        .map(cached_github_translation_response);
    Ok(GithubRecommendationReadme {
        full_name: full_name.to_owned(),
        raw_markdown: readme.raw_markdown,
        source_path: readme.source_path,
        fetched_at: readme.fetched_at,
        from_cache,
        translation,
    })
}

fn cached_github_translation_response(
    translation: storage::GithubRecommendationCachedTranslation,
) -> ai::AiReadmeTranslation {
    ai::AiReadmeTranslation {
        markdown_zh: translation.markdown_zh,
        model: translation.model,
        input_tokens: translation.input_tokens,
        output_tokens: translation.output_tokens,
        source_char_count: translation.source_char_count,
        translated_char_count: translation.translated_char_count,
        is_truncated: translation.is_truncated,
    }
}

#[tauri::command]
async fn star_github_recommendation_candidate(
    app_handle: tauri::AppHandle,
    request: StarGithubRecommendationCandidateRequest,
) -> Result<storage::GithubRecommendationCandidateState, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "加入 GitHub Stars",
        progress_handle,
        "star-github-recommendation-candidate",
        "sync",
        move || star_github_recommendation_candidate_worker(app_handle, request),
    )
    .await
}

fn star_github_recommendation_candidate_worker(
    app_handle: tauri::AppHandle,
    request: StarGithubRecommendationCandidateRequest,
) -> Result<storage::GithubRecommendationCandidateState, String> {
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    if request.account_id != account_id {
        return Err(
            "当前 GitHub 账号与候选项目所属账号不一致，请重新连接账号后再操作。".to_owned(),
        );
    }

    let storage = AppStorage::from_app_handle(&app_handle)?;
    let full_name = request.full_name.trim().to_owned();
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "star-github-recommendation-candidate",
            "sync",
            "github-star",
            0,
            2,
            format!("正在确认推荐候选 {}", full_name),
            Some(full_name.clone()),
        ),
    );
    let candidate = storage
        .list_github_recommendation_candidate_states(&account_id, std::slice::from_ref(&full_name))?
        .remove(&full_name)
        .ok_or_else(|| "推荐候选项目不存在，请重新发现后再操作。".to_owned())?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "star-github-recommendation-candidate",
            "sync",
            "github-star",
            1,
            2,
            format!("正在加入 {} 到 GitHub Stars", candidate.full_name),
            Some(candidate.full_name.clone()),
        ),
    );
    github::star_repository(&token, &full_name)?;
    let next_candidate = storage.update_github_recommendation_candidate_status(
        &account_id,
        &candidate.full_name,
        "starred",
    )?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "star-github-recommendation-candidate",
            "sync",
            2,
            2,
            format!("{} 已加入 GitHub Stars", candidate.full_name),
        ),
    );

    Ok(next_candidate)
}

fn recommend_github_repositories_worker(
    app_handle: tauri::AppHandle,
    request: RecommendGithubRepositoriesRequest,
) -> Result<GithubRecommendationResponse, String> {
    let selected_repository_ids = normalize_recommendation_reference_ids(
        request.repository_ids,
        GITHUB_RECOMMENDATION_REFERENCE_LIMIT,
    );
    if selected_repository_ids.is_empty() {
        return Err("请先选择至少一个仓库".to_owned());
    }

    let token = auth::require_github_token()?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let ai_config = hydrate_ai_request_config(&app_handle, request.ai_config)?;
    let sources = storage
        .list_repository_tagging_sources_by_ids(&request.account_id, &selected_repository_ids)?;
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
    let plan = ai::plan_github_recommendations(&ai_config, &briefs)?;
    let limit = request.limit.unwrap_or(12).clamp(1, 30);
    let per_query = ((limit + plan.queries.len()).max(6) / plan.queries.len()).clamp(5, 10);
    let mut seen_full_names = HashSet::new();
    let mut results = Vec::new();
    let mut search_failures = Vec::new();

    for (index, query) in plan.queries.iter().enumerate() {
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "recommend-github-repositories",
                "ai",
                "github-search",
                index + 1,
                plan.queries.len(),
                format!("正在搜索 GitHub：{query}"),
                None,
            ),
        );

        let repositories = match github::search_repositories(&token, query, per_query) {
            Ok(repositories) => repositories,
            Err(error) => {
                search_failures.push(GithubRecommendationSearchFailure {
                    query: query.clone(),
                    error,
                });
                continue;
            }
        };

        for repository in repositories {
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

    if results.is_empty() && search_failures.len() == plan.queries.len() {
        return Err(format_recommendation_search_failure(&search_failures));
    }

    let candidate_states = storage.replace_github_recommendation_candidates(
        &request.account_id,
        &plan.rationale_zh,
        &plan.queries,
        &results,
    )?;
    for repository in &mut results {
        if let Some(candidate_state) = candidate_states.get(&repository.full_name) {
            repository.candidate_id = Some(candidate_state.id.clone());
            repository.candidate_status = Some(candidate_state.status.clone());
        }
    }

    let completion_message = if search_failures.is_empty() {
        format!("已找到 {} 个 GitHub 候选项目", results.len())
    } else {
        format!(
            "已找到 {} 个 GitHub 候选项目，{} 个搜索式暂未完成",
            results.len(),
            search_failures.len(),
        )
    };

    let completion_progress = build_github_recommendation_completion_progress(
        results.len(),
        limit,
        search_failures.len(),
        completion_message,
    );
    emit_task_progress(&app_handle, completion_progress);

    Ok(GithubRecommendationResponse {
        rationale_zh: plan.rationale_zh,
        queries: plan.queries,
        search_failures,
        results,
    })
}

fn format_recommendation_search_failure(
    search_failures: &[GithubRecommendationSearchFailure],
) -> String {
    let first_failure = search_failures
        .first()
        .map(|failure| format!("首个失败搜索式：{}，原因：{}", failure.query, failure.error))
        .unwrap_or_else(|| "没有返回可用候选项目。".to_owned());

    format!(
        "GitHub 相似项目发现失败：所有 GitHub 搜索式都未完成。{first_failure} 请检查网络连接、GitHub Token 权限或稍后重试。"
    )
}

fn build_github_recommendation_completion_progress(
    result_count: usize,
    _limit: usize,
    search_failure_count: usize,
    message: impl Into<String>,
) -> TaskProgressEvent {
    let completed_count = result_count.max(1);
    let message = message.into();

    if search_failure_count > 0 {
        TaskProgressEvent::partial(
            "recommend-github-repositories",
            "ai",
            completed_count,
            completed_count,
            message,
        )
    } else {
        TaskProgressEvent::succeeded(
            "recommend-github-repositories",
            "ai",
            completed_count,
            completed_count,
            message,
        )
    }
}

fn normalize_recommendation_reference_ids(
    repository_ids: Vec<String>,
    limit: usize,
) -> Vec<String> {
    let mut seen_repository_ids = HashSet::new();
    let mut normalized_repository_ids = Vec::new();
    for repository_id in repository_ids {
        let repository_id = repository_id.trim().to_owned();
        if repository_id.is_empty() || !seen_repository_ids.insert(repository_id.clone()) {
            continue;
        }
        normalized_repository_ids.push(repository_id);
        if normalized_repository_ids.len() >= limit {
            break;
        }
    }

    normalized_repository_ids
}

#[tauri::command]
async fn export_annotation_gist(
    app_handle: tauri::AppHandle,
) -> Result<GistAnnotationExportSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "Gist 注解导出",
        progress_handle,
        "export-annotation-gist",
        "backup",
        move || export_annotation_gist_worker(app_handle),
    )
    .await
}

fn export_annotation_gist_worker(
    app_handle: tauri::AppHandle,
) -> Result<GistAnnotationExportSummary, String> {
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "export-annotation-gist",
            "backup",
            "auth",
            0,
            4,
            "正在校验 GitHub Token",
            Some("GitHub Gist".to_owned()),
        ),
    );
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let storage = AppStorage::from_app_handle(&app_handle)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "export-annotation-gist",
            "backup",
            "prepare",
            1,
            4,
            "正在读取本地注解快照",
            Some("GitHub Gist".to_owned()),
        ),
    );
    let snapshot = storage.export_annotation_snapshot(&account_id)?;
    let tag_count = snapshot.tags.len();
    let repository_count = snapshot.repositories.len();
    let snapshot_json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("注解快照序列化失败：{error}"))?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "export-annotation-gist",
            "backup",
            "save",
            2,
            4,
            format!("正在创建 Gist 备份：{tag_count} 个标签，{repository_count} 条仓库注解"),
            Some("GitHub Gist".to_owned()),
        ),
    );
    let gist = github::create_annotation_gist(&token, &snapshot_json)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "export-annotation-gist",
            "backup",
            4,
            4,
            format!("注解已导出到 Gist {}", gist.gist_id),
        ),
    );

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
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "Gist 注解导入",
        progress_handle,
        "import-annotation-gist",
        "backup",
        move || import_annotation_gist_worker(app_handle, request),
    )
    .await
}

fn import_annotation_gist_worker(
    app_handle: tauri::AppHandle,
    request: ImportAnnotationGistRequest,
) -> Result<GistAnnotationImportSummary, String> {
    let gist_id = request.gist_id.trim().to_owned();
    if gist_id.is_empty() {
        return Err("请输入 Gist ID".to_owned());
    }
    let gist_label = format!("Gist {gist_id}");
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-annotation-gist",
            "backup",
            "auth",
            0,
            4,
            "正在校验 GitHub Token",
            Some(gist_label.clone()),
        ),
    );
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-annotation-gist",
            "backup",
            "fetch",
            1,
            4,
            "正在读取 Gist 备份",
            Some(gist_label.clone()),
        ),
    );
    let snapshot_json = github::fetch_annotation_gist(&token, &gist_id)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-annotation-gist",
            "backup",
            "parse",
            2,
            4,
            "正在解析 Gist 注解快照",
            Some(gist_label.clone()),
        ),
    );
    let snapshot = serde_json::from_str::<storage::AnnotationSnapshot>(&snapshot_json)
        .map_err(|error| format!("注解快照解析失败：{error}"))?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-annotation-gist",
            "backup",
            "save",
            3,
            4,
            "正在写入本地注解数据库",
            Some(gist_label.clone()),
        ),
    );
    let summary = storage.import_annotation_snapshot(&account_id, &snapshot)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "import-annotation-gist",
            "backup",
            4,
            4,
            format!(
                "注解已导入：{} 个标签，{} 条仓库注解",
                summary.tag_count, summary.repository_count
            ),
        ),
    );

    Ok(GistAnnotationImportSummary {
        tag_count: summary.tag_count,
        repository_count: summary.repository_count,
        skipped_repository_count: summary.skipped_repository_count,
    })
}

#[tauri::command]
async fn export_repository_library_gist(
    app_handle: tauri::AppHandle,
) -> Result<GistRepositoryLibraryExportSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "Gist 仓库清单导出",
        progress_handle,
        "export-repository-library-gist",
        "backup",
        move || export_repository_library_gist_worker(app_handle),
    )
    .await
}

fn export_repository_library_gist_worker(
    app_handle: tauri::AppHandle,
) -> Result<GistRepositoryLibraryExportSummary, String> {
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "export-repository-library-gist",
            "backup",
            "auth",
            0,
            4,
            "正在校验 GitHub Token",
            Some("GitHub Gist".to_owned()),
        ),
    );
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.upsert_github_account(&user)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "export-repository-library-gist",
            "backup",
            "prepare",
            1,
            4,
            "正在读取本地仓库清单",
            Some("GitHub Gist".to_owned()),
        ),
    );
    let snapshot = storage.export_repository_library_snapshot(&account_id)?;
    let tag_count = snapshot.tags.len();
    let repository_count = snapshot.repositories.len();
    let snapshot_json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("仓库快照序列化失败：{error}"))?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "export-repository-library-gist",
            "backup",
            "save",
            2,
            4,
            format!("正在创建 Gist 备份：{repository_count} 个仓库，{tag_count} 个标签"),
            Some("GitHub Gist".to_owned()),
        ),
    );
    let gist = github::create_repository_library_gist(&token, &snapshot_json)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "export-repository-library-gist",
            "backup",
            4,
            4,
            format!("仓库清单已导出到 Gist {}", gist.gist_id),
        ),
    );

    Ok(GistRepositoryLibraryExportSummary {
        gist_id: gist.gist_id,
        html_url: gist.html_url,
        tag_count,
        repository_count,
    })
}

#[tauri::command]
async fn import_repository_library_gist(
    app_handle: tauri::AppHandle,
    request: ImportAnnotationGistRequest,
) -> Result<GistRepositoryLibraryImportSummary, String> {
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "Gist 仓库清单导入",
        progress_handle,
        "import-repository-library-gist",
        "backup",
        move || import_repository_library_gist_worker(app_handle, request),
    )
    .await
}

fn import_repository_library_gist_worker(
    app_handle: tauri::AppHandle,
    request: ImportAnnotationGistRequest,
) -> Result<GistRepositoryLibraryImportSummary, String> {
    let gist_id = request.gist_id.trim().to_owned();
    if gist_id.is_empty() {
        return Err("请输入 Gist ID".to_owned());
    }
    let gist_label = format!("Gist {gist_id}");
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-repository-library-gist",
            "backup",
            "auth",
            0,
            4,
            "正在校验 GitHub Token",
            Some(gist_label.clone()),
        ),
    );
    let token = auth::require_github_token()?;
    let user = auth::verify_github_token(&token)?;
    let account_id = user.id.to_string();
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-repository-library-gist",
            "backup",
            "fetch",
            1,
            4,
            "正在读取 Gist 仓库清单",
            Some(gist_label.clone()),
        ),
    );
    let snapshot_json = github::fetch_repository_library_gist(&token, &gist_id)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-repository-library-gist",
            "backup",
            "parse",
            2,
            4,
            "正在解析 Gist 仓库快照",
            Some(gist_label.clone()),
        ),
    );
    let snapshot = serde_json::from_str::<storage::RepositoryLibrarySnapshot>(&snapshot_json)
        .map_err(|error| format!("仓库快照解析失败：{error}"))?;
    let storage = AppStorage::from_app_handle(&app_handle)?;
    storage.upsert_github_account(&user)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "import-repository-library-gist",
            "backup",
            "save",
            3,
            4,
            "正在写入本地仓库清单",
            Some(gist_label.clone()),
        ),
    );
    let summary = storage.import_repository_library_snapshot(&account_id, &snapshot)?;
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::succeeded(
            "import-repository-library-gist",
            "backup",
            4,
            4,
            format!(
                "仓库清单已导入：新增 {} 个，更新 {} 个",
                summary.created_repository_count, summary.updated_repository_count
            ),
        ),
    );

    Ok(GistRepositoryLibraryImportSummary {
        tag_count: summary.tag_count,
        repository_count: summary.repository_count,
        created_repository_count: summary.created_repository_count,
        updated_repository_count: summary.updated_repository_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            get_github_auth_state,
            save_github_token,
            clear_github_token,
            has_ai_api_key,
            save_ai_api_key,
            clear_ai_api_key,
            has_embedding_api_key,
            save_embedding_api_key,
            clear_embedding_api_key,
            test_embedding_connection,
            rebuild_vector_index,
            get_vector_index_status,
            get_app_settings,
            save_app_settings,
            clear_app_settings,
            clear_local_database,
            open_external_url,
            test_ai_connection,
            list_ai_models,
            check_runtime_readiness,
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
            export_repository_library_gist,
            import_repository_library_gist,
            get_dashboard_stats,
            get_tag_network_data,
            generate_ai_tag_network,
            get_profile_stats,
            generate_repository_ai_document,
            batch_generate_repository_ai_documents,
            explain_ai_search_topic,
            search_repositories,
            list_github_rankings,
            list_personal_rankings,
            fetch_github_ranking_readme,
            star_github_ranking_repository,
            recommend_github_repositories,
            list_github_recommendation_candidates,
            update_github_recommendation_candidate_status,
            fetch_github_recommendation_readme,
            translate_github_recommendation_readme,
            star_github_recommendation_candidate,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用运行失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn recommendation_readme_commands_are_allowed_by_main_capability() {
        let permissions = include_str!("../permissions/gsat-commands.toml");

        assert!(permissions.contains("\"fetch_github_recommendation_readme\""));
        assert!(permissions.contains("\"translate_github_recommendation_readme\""));
    }

    #[test]
    fn ranking_commands_are_allowed_by_main_capability() {
        let permissions = include_str!("../permissions/gsat-commands.toml");

        assert!(permissions.contains("\"list_github_rankings\""));
        assert!(permissions.contains("\"list_personal_rankings\""));
        assert!(permissions.contains("\"fetch_github_ranking_readme\""));
        assert!(permissions.contains("\"star_github_ranking_repository\""));
    }

    #[test]
    fn embedding_commands_are_allowed_by_main_capability() {
        let permissions = include_str!("../permissions/gsat-commands.toml");

        for command in [
            "has_embedding_api_key",
            "save_embedding_api_key",
            "clear_embedding_api_key",
            "test_embedding_connection",
            "rebuild_vector_index",
            "get_vector_index_status",
        ] {
            assert!(permissions.contains(&format!("\"{command}\"")));
        }
    }

    #[test]
    fn conversational_queries_do_not_trigger_repository_retrieval() {
        for query in [
            "你好",
            "您好！",
            " hello ",
            "Hi?",
            "谢谢",
            "你是谁",
            "在吗～",
        ] {
            let reply = conversational_query_reply(query).expect("问候语应直接返回对话答复");
            assert!(reply.contains("最多返回 10 个"));
        }
        assert!(conversational_query_reply("找一个 Rust 向量数据库").is_none());
    }

    #[test]
    fn short_technical_queries_keep_exact_semantics() {
        for query in ["AI", "ai", "RAG", "UI", "Go"] {
            assert!(is_short_exact_technical_query(query));
        }
        for query in ["OpenAI", "AI agent", "向量", "C++"] {
            assert!(!is_short_exact_technical_query(query));
        }
    }

    fn sync_states(values: &[(&str, &str)]) -> HashMap<String, String> {
        values
            .iter()
            .map(|(id, status)| ((*id).to_owned(), (*status).to_owned()))
            .collect()
    }

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn stored_repositories(values: &[(&str, &str)]) -> Vec<storage::StoredRepository> {
        values
            .iter()
            .map(|(id, full_name)| storage::StoredRepository {
                id: (*id).to_owned(),
                full_name: (*full_name).to_owned(),
            })
            .collect()
    }

    #[test]
    fn ai_request_config_can_be_loaded_from_saved_settings_snapshot() {
        let settings = serde_json::json!({
            "ai": {
                "provider": "openai-compatible",
                "baseUrl": "https://ai.example.com/v1",
                "apiKey": "",
                "model": "custom-chat-model",
                "enableAutoSummary": true
            }
        });

        let config = ai_request_config_from_settings_value(&settings)
            .expect("保存设置中应能恢复 AI 请求配置");

        assert_eq!(config.provider, "openai-compatible");
        assert_eq!(
            config.base_url.as_deref(),
            Some("https://ai.example.com/v1")
        );
        assert_eq!(config.api_key, "");
        assert_eq!(config.model, "custom-chat-model");
    }

    #[test]
    fn ai_request_config_merges_missing_fields_from_saved_settings() {
        let saved_config = ai::AiRequestConfig {
            provider: "anthropic".to_owned(),
            api_key: String::new(),
            base_url: Some("https://api.anthropic.com/v1".to_owned()),
            model: "claude-sonnet-4-5".to_owned(),
        };
        let request_config = ai::AiRequestConfig {
            provider: "anthropic".to_owned(),
            api_key: String::new(),
            base_url: None,
            model: String::new(),
        };

        let merged = merge_ai_request_config(Some(request_config), Some(&saved_config))
            .expect("缺省字段应从保存设置补齐");

        assert_eq!(merged.provider, "anthropic");
        assert_eq!(
            merged.base_url.as_deref(),
            Some("https://api.anthropic.com/v1")
        );
        assert_eq!(merged.model, "claude-sonnet-4-5");
    }

    #[test]
    fn external_url_validation_allows_only_http_and_https() {
        assert_eq!(
            normalize_external_url(" https://github.com/xingranya/GitHub-Stars-AI-Tools ")
                .expect("https 链接应允许"),
            "https://github.com/xingranya/GitHub-Stars-AI-Tools"
        );
        assert_eq!(
            normalize_external_url("http://example.com/readme").expect("http 链接应允许"),
            "http://example.com/readme"
        );
        assert!(normalize_external_url("javascript:alert(1)").is_err());
        assert!(normalize_external_url("file:///etc/passwd").is_err());
        assert!(normalize_external_url("https://example.com/\nnext").is_err());
    }

    #[test]
    fn app_settings_sanitization_removes_ai_api_key() {
        let settings = serde_json::json!({
            "theme": { "mode": "dark" },
            "ai": {
                "provider": "openai",
                "baseUrl": "https://api.openai.com/v1",
                "apiKey": "sk-secret",
                "model": "gpt-4o-mini"
            }
        });

        let sanitized = sanitize_app_settings_value(settings);

        assert_eq!(sanitized["ai"]["apiKey"], "");
        assert_eq!(sanitized["ai"]["provider"], "openai");
        assert_eq!(sanitized["theme"]["mode"], "dark");
    }

    #[test]
    fn runtime_check_items_use_stable_status_values() {
        let passed = runtime_check_passed("本地数据库可读".to_owned(), None);
        let failed =
            runtime_check_failed("AI 服务请求失败".to_owned(), Some("请求超时".to_owned()));
        let skipped = runtime_check_skipped(
            "README 抓取未检测".to_owned(),
            Some("本地还没有 Stars 数据，请先同步 Stars。".to_owned()),
        );
        let failed_with_action = runtime_check_failed_with_action(
            "GitHub Token 验证失败".to_owned(),
            Some("Token 无效或权限不足".to_owned()),
            "重新生成可读取 Stars 的 GitHub Token，并在 GitHub 设置区保存。",
        );
        let skipped_with_action = runtime_check_skipped_with_action(
            "AI 标签网络未检测".to_owned(),
            Some("需要先通过 AI 服务自检。".to_owned()),
            "先通过 AI 服务自检，再生成标签网络。",
        );

        assert_eq!(passed.status, "passed");
        assert_eq!(passed.message, "本地数据库可读");
        assert_eq!(passed.detail, None);
        assert_eq!(passed.action, None);
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.detail.as_deref(), Some("请求超时"));
        assert_eq!(failed.action, None);
        assert_eq!(skipped.status, "skipped");
        assert_eq!(
            skipped.detail.as_deref(),
            Some("本地还没有 Stars 数据，请先同步 Stars。")
        );
        assert_eq!(skipped.action, None);
        assert_eq!(failed_with_action.status, "failed");
        assert_eq!(
            failed_with_action.action.as_deref(),
            Some("重新生成可读取 Stars 的 GitHub Token，并在 GitHub 设置区保存。")
        );
        assert_eq!(skipped_with_action.status, "skipped");
        assert_eq!(
            skipped_with_action.action.as_deref(),
            Some("先通过 AI 服务自检，再生成标签网络。")
        );
    }

    #[test]
    fn recommendation_reference_ids_are_deduplicated_and_limited() {
        let repository_ids = vec![
            " 1001:1 ".to_owned(),
            "1001:2".to_owned(),
            "1001:1".to_owned(),
            "".to_owned(),
            "1001:3".to_owned(),
            "1001:4".to_owned(),
        ];

        let normalized_repository_ids = normalize_recommendation_reference_ids(repository_ids, 3);

        assert_eq!(
            normalized_repository_ids,
            vec![
                "1001:1".to_owned(),
                "1001:2".to_owned(),
                "1001:3".to_owned()
            ]
        );
    }

    #[test]
    fn recommendation_search_failure_reports_all_failed_queries() {
        let failures = vec![
            GithubRecommendationSearchFailure {
                query: "react animation language:TypeScript".to_owned(),
                error: "GitHub API 请求失败：网络连接中断".to_owned(),
            },
            GithubRecommendationSearchFailure {
                query: "spring animation stars:>1000".to_owned(),
                error: "GitHub API 请求失败：请求超时".to_owned(),
            },
        ];

        let message = format_recommendation_search_failure(&failures);

        assert!(message.contains("所有 GitHub 搜索式都未完成"));
        assert!(message.contains("react animation language:TypeScript"));
        assert!(message.contains("网络连接中断"));
        assert!(message.contains("请检查网络连接、GitHub Token 权限或稍后重试"));
    }

    #[test]
    fn recommendation_completion_progress_reports_partial_search_failures() {
        let progress = build_github_recommendation_completion_progress(
            3,
            12,
            1,
            "已找到 3 个 GitHub 候选项目，1 个搜索式暂未完成",
        );

        assert_eq!(progress.task_id, "recommend-github-repositories");
        assert_eq!(progress.status, "partial");
        assert_eq!(progress.stage, "partial-failure");
        assert_eq!(progress.current, 3);
        assert_eq!(progress.total, 3);
        assert!(progress.message.contains("搜索式暂未完成"));
    }

    #[test]
    fn recommendation_completion_progress_reports_success_without_search_failures() {
        let progress = build_github_recommendation_completion_progress(
            8,
            12,
            0,
            "已找到 8 个 GitHub 候选项目",
        );

        assert_eq!(progress.status, "succeeded");
        assert_eq!(progress.stage, "done");
        assert_eq!(progress.current, 8);
        assert_eq!(progress.total, 8);
    }

    #[test]
    fn readme_fetch_targets_skip_cached_repositories_when_only_missing() {
        let repositories = stored_repositories(&[
            ("1001:1", "owner/cached"),
            ("1001:2", "owner/missing"),
            ("1001:3", "owner/error"),
        ]);
        let (targets, skipped_count, failures) = partition_readme_fetch_targets(
            repositories,
            true,
            |repository_id| match repository_id {
                "1001:1" => Ok(Some("readme-hash".to_owned())),
                "1001:2" => Ok(None),
                _ => Err("SQLite README 状态读取失败".to_owned()),
            },
        );

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].id, "1001:2");
        assert_eq!(skipped_count, 1);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].repository_id, "1001:3");
        assert_eq!(failures[0].full_name, "owner/error");
    }

    #[test]
    fn readme_fetch_targets_include_cached_repositories_when_forced() {
        let repositories =
            stored_repositories(&[("1001:1", "owner/cached"), ("1001:2", "owner/missing")]);
        let (targets, skipped_count, failures) =
            partition_readme_fetch_targets(repositories, false, |_| {
                panic!("强制抓取时不应预先读取 README hash")
            });
        let target_ids = targets
            .iter()
            .map(|repository| repository.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids(&target_ids), vec!["1001:1", "1001:2"]);
        assert_eq!(skipped_count, 0);
        assert!(failures.is_empty());
    }

    #[test]
    fn repository_retry_filter_keeps_only_requested_active_repositories() {
        let repositories = stored_repositories(&[
            ("1001:1", "owner/first"),
            ("1001:2", "owner/second"),
            ("1001:3", "owner/third"),
        ]);

        let targets = filter_repositories_by_ids(
            repositories.clone(),
            Some(vec![
                "1001:3".to_owned(),
                " ".to_owned(),
                "missing".to_owned(),
                "1001:1".to_owned(),
            ]),
        );
        let target_ids = targets
            .iter()
            .map(|repository| repository.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(target_ids, vec!["1001:1", "1001:3"]);
        assert_eq!(
            filter_repositories_by_ids(repositories.clone(), None).len(),
            3
        );
        assert_eq!(
            filter_repositories_by_ids(repositories, Some(Vec::new())).len(),
            3
        );
    }

    #[test]
    fn background_tasks_wait_in_fifo_queue() {
        let events = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let first_events = Arc::clone(&events);
        let second_events = Arc::clone(&events);

        let first = thread::spawn(move || {
            let _guard = acquire_background_task("测试任务一").expect("第一个任务应能启动");
            first_events.lock().expect("记录事件").push("first-start");
            first_started_tx.send(()).expect("通知第二个任务");
            thread::sleep(Duration::from_millis(80));
            first_events.lock().expect("记录事件").push("first-end");
        });

        first_started_rx.recv().expect("第一个任务应已启动");
        let second = thread::spawn(move || {
            let _guard = acquire_background_task("测试任务二").expect("第二个任务应排队等待");
            second_events.lock().expect("记录事件").push("second-start");
        });

        first.join().expect("第一个任务应结束");
        second.join().expect("第二个任务应结束");

        let events = events.lock().expect("读取事件");
        assert_eq!(&*events, &["first-start", "first-end", "second-start"]);
    }

    #[test]
    fn authoritative_star_scan_reads_until_short_page() {
        let pages = [vec!["account:1", "account:2"], vec!["account:3"]];
        let mut requested_pages = Vec::new();

        let repositories = collect_authoritative_star_pages(2, |page| {
            requested_pages.push(page);
            Ok(pages[(page - 1) as usize].clone())
        })
        .expect("完整扫描应读取到末页");

        assert_eq!(requested_pages, vec![1, 2]);
        assert_eq!(repositories, vec!["account:1", "account:2", "account:3"]);
    }

    #[test]
    fn authoritative_star_scan_requests_empty_page_after_exact_page_size() {
        let pages = [vec!["account:1", "account:2"], Vec::new()];
        let mut requested_pages = Vec::new();

        let repositories = collect_authoritative_star_pages(2, |page| {
            requested_pages.push(page);
            Ok(pages[(page - 1) as usize].clone())
        })
        .expect("满页后应继续确认末页");

        assert_eq!(requested_pages, vec![1, 2]);
        assert_eq!(repositories, vec!["account:1", "account:2"]);
    }

    #[test]
    fn authoritative_star_scan_accepts_empty_remote_list() {
        let mut requested_pages = Vec::new();

        let repositories = collect_authoritative_star_pages::<String, _>(2, |page| {
            requested_pages.push(page);
            Ok(Vec::new())
        })
        .expect("空 Stars 列表应是有效完整结果");

        assert_eq!(requested_pages, vec![1]);
        assert!(repositories.is_empty());
    }

    #[test]
    fn authoritative_star_scan_discards_partial_result_after_page_failure() {
        let result = collect_authoritative_star_pages(2, |page| match page {
            1 => Ok(vec!["account:1", "account:2"]),
            _ => Err("第二页请求失败".to_owned()),
        });

        assert_eq!(
            result.expect_err("分页失败不得返回可用于删除对账的集合"),
            "第二页请求失败"
        );
    }

    #[test]
    fn authoritative_sync_computes_only_missing_active_repositories() {
        let existing_states = sync_states(&[
            ("account:1", "active"),
            ("account:2", "active"),
            ("account:3", "removed"),
        ]);
        let incoming_ids = HashSet::from(["account:1"]);
        let mut removed_ids = compute_removed_repository_ids(&existing_states, &incoming_ids);
        removed_ids.sort();

        assert_eq!(removed_ids, vec!["account:2".to_owned()]);
    }

    #[test]
    fn ai_tag_assignments_are_merged_across_batches() {
        let assignments = merge_ai_tag_assignments(vec![
            storage::AiTagAssignment {
                tag_name: "React 动画".to_owned(),
                color: Some("#ec4899".to_owned()),
                repository_full_names: vec![
                    "pmndrs/react-spring".to_owned(),
                    "motiondivision/motion".to_owned(),
                ],
            },
            storage::AiTagAssignment {
                tag_name: "react 动画".to_owned(),
                color: None,
                repository_full_names: vec![
                    "pmndrs/react-spring".to_owned(),
                    "greensock/GSAP".to_owned(),
                ],
            },
            storage::AiTagAssignment {
                tag_name: " ".to_owned(),
                color: Some("#000000".to_owned()),
                repository_full_names: vec!["ignored/repo".to_owned()],
            },
        ]);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].tag_name, "React 动画");
        assert_eq!(assignments[0].color.as_deref(), Some("#ec4899"));
        assert_eq!(
            assignments[0].repository_full_names,
            vec![
                "pmndrs/react-spring".to_owned(),
                "motiondivision/motion".to_owned(),
                "greensock/GSAP".to_owned(),
            ]
        );
    }

    #[test]
    fn ai_tag_network_success_message_reports_partial_failures() {
        let summary = storage::ApplyAiTagAssignmentsSummary {
            tag_count: 6,
            linked_count: 18,
            skipped_repository_count: 0,
            failed_batch_count: 2,
            failures: vec![
                "第 2 / 4 批失败：请求超时".to_owned(),
                "第 3 / 4 批失败：响应解析失败".to_owned(),
            ],
        };

        assert_eq!(
            format_ai_tag_network_success_message(&summary),
            "AI 标签网络已生成：6 个标签，18 条仓库关联，2 个批次失败，可稍后重试补全"
        );
    }

    #[test]
    fn ai_tag_network_completion_progress_uses_partial_status_for_batch_failures() {
        let summary = storage::ApplyAiTagAssignmentsSummary {
            tag_count: 6,
            linked_count: 18,
            skipped_repository_count: 0,
            failed_batch_count: 1,
            failures: vec![
                "第 2 / 4 批失败：请求超时".to_owned(),
                "连续 3 个批次失败，已停止处理剩余 1 个批次".to_owned(),
            ],
        };

        let progress = build_ai_tag_network_completion_progress(&summary, 3, 4);

        assert_eq!(progress.task_id, "generate-ai-tag-network");
        assert_eq!(progress.status, "partial");
        assert_eq!(progress.stage, "partial-failure");
        assert_eq!(progress.current, 3);
        assert_eq!(progress.total, 4);
        assert!(progress.message.contains("可稍后重试补全"));
        assert!(progress.message.contains("1 个批次失败"));
        assert!(!progress.message.contains("2 个批次失败"));
    }

    #[test]
    fn ai_tag_network_completion_progress_uses_batch_total_for_success() {
        let summary = storage::ApplyAiTagAssignmentsSummary {
            tag_count: 6,
            linked_count: 18,
            skipped_repository_count: 0,
            failed_batch_count: 0,
            failures: Vec::new(),
        };

        let progress = build_ai_tag_network_completion_progress(&summary, 2, 2);

        assert_eq!(progress.status, "succeeded");
        assert_eq!(progress.current, 2);
        assert_eq!(progress.total, 2);
        assert!(progress.message.contains("18 条仓库关联"));
    }
}
