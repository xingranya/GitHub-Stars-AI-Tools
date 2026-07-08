mod ai;
mod auth;
mod github;
mod storage;

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
const README_FETCH_CONCURRENCY: usize = 6;
const GITHUB_RECOMMENDATION_REFERENCE_LIMIT: usize = 8;
const AI_API_KEY_SERVICE: &str = "github-stars-ai-tools";
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
struct FetchReadmesRequest {
    only_missing: Option<bool>,
    repository_ids: Option<Vec<String>>,
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
    account_id: String,
    context_queries: Option<Vec<String>>,
    context_repository_ids: Option<Vec<String>>,
    ai_config: Option<ai::AiRequestConfig>,
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
    limit: Option<usize>,
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
    AppStorage::clear_local_database(&app_handle)
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
    run_ai_connection_probe(&ai_config)
}

fn run_ai_connection_probe(
    ai_config: &ai::AiRequestConfig,
) -> Result<ai::AiSummaryDocument, String> {
    ai::summarize_readme(
        ai_config,
        "xingranya/GitHub-Stars-AI-Tools",
        Some("用于验证 AI 服务配置是否可以正常请求的测试仓库。"),
        r#"# GitHub-Stars-AI-Tools

GitHub-Stars-AI-Tools 是一个本地优先的桌面客户端，用于同步 GitHub Stars、缓存 README、生成中文摘要、维护标签网络，并通过自然语言检索个人开源知识库。
"#,
    )
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
            Ok(config) => match run_ai_connection_probe(&config) {
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
async fn sync_github_stars(
    app_handle: tauri::AppHandle,
    request: Option<SyncGithubStarsRequest>,
) -> Result<StarSyncSummary, String> {
    let force_full = request
        .and_then(|request| request.force_full)
        .unwrap_or(false);
    let progress_handle = app_handle.clone();
    run_background_task_with_failure_progress(
        "Stars 同步",
        progress_handle,
        "sync-stars",
        "sync",
        move || sync_github_stars_worker(app_handle, force_full),
    )
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
        let estimated_total =
            if page_contains_only_known_active || page_len < github::starred_page_size() {
                repositories.len()
            } else {
                repositories.len() + github::starred_page_size()
            };
        emit_task_progress(
            &app_handle,
            TaskProgressEvent::running(
                "sync-stars",
                "sync",
                "save",
                repositories.len(),
                estimated_total,
                format!(
                    "正在同步第 {page} 页，已写入 {} 个 Stars",
                    repositories.len()
                ),
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

fn search_repositories_worker(
    app_handle: tauri::AppHandle,
    request: SearchRepositoriesRequest,
) -> Result<storage::AiSearchResponseData, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let original_query = request.query.trim().to_owned();
    let context_queries = request.context_queries.unwrap_or_default();
    let context_repository_ids = request.context_repository_ids.unwrap_or_default();
    let progress_total = if request.ai_config.is_some() { 3 } else { 2 };
    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "ai-search",
            "ai",
            "plan",
            0,
            progress_total,
            if request.ai_config.is_some() {
                "正在理解搜索问题并准备 AI 增强"
            } else {
                "正在准备本地知识搜索"
            },
            Some(original_query.clone()),
        ),
    );
    let (effective_query, metadata) = build_ai_search_query(
        &app_handle,
        original_query.clone(),
        &context_queries,
        request.ai_config,
    )?;

    emit_task_progress(
        &app_handle,
        TaskProgressEvent::running(
            "ai-search",
            "ai",
            "analyze",
            progress_total.saturating_sub(1),
            progress_total,
            "正在匹配本地 Stars、README、AI 摘要、标签和笔记",
            Some(original_query.clone()),
        ),
    );
    let response = storage.search_repositories(
        &effective_query,
        &context_queries,
        &context_repository_ids,
        request.limit.unwrap_or(20),
        Some(&request.account_id),
        Some(metadata),
    )?;
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
    Ok(response)
}

fn build_ai_search_query(
    app_handle: &tauri::AppHandle,
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

    match hydrate_ai_request_config(app_handle, Some(ai_config))
        .and_then(|config| ai::plan_search_query(&config, &original_query, context_queries))
    {
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
            Ok((effective_query, metadata))
        }
        Err(error) => {
            metadata.ai_error = Some(format!("AI 搜索增强失败，已改用本地知识搜索：{error}"));
            Ok((original_query, metadata))
        }
    }
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
) -> Result<GithubRecommendationResponse, String> {
    let storage = AppStorage::from_app_handle(&app_handle)?;
    let candidates = storage.list_github_recommendation_candidates(
        &request.account_id,
        request.status.as_deref(),
        request.limit.unwrap_or(12),
    )?;

    Ok(GithubRecommendationResponse {
        rationale_zh: candidates.rationale_zh,
        queries: candidates.queries,
        search_failures: Vec::new(),
        results: candidates.repositories,
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

    let candidate_states = storage.upsert_github_recommendation_candidates(
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
    limit: usize,
    search_failure_count: usize,
    message: impl Into<String>,
) -> TaskProgressEvent {
    let total = limit.max(1);
    let current = result_count.min(total);
    let message = message.into();

    if search_failure_count > 0 {
        TaskProgressEvent::partial(
            "recommend-github-repositories",
            "ai",
            current,
            total,
            message,
        )
    } else {
        TaskProgressEvent::succeeded(
            "recommend-github-repositories",
            "ai",
            current,
            total,
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
            get_dashboard_stats,
            get_tag_network_data,
            generate_ai_tag_network,
            get_profile_stats,
            generate_repository_ai_document,
            batch_generate_repository_ai_documents,
            search_repositories,
            recommend_github_repositories,
            list_github_recommendation_candidates,
            update_github_recommendation_candidate_status,
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
        assert_eq!(progress.total, 12);
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
        assert_eq!(progress.total, 12);
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
    fn first_sync_does_not_stop_incrementally_without_existing_active_repositories() {
        let existing_states = sync_states(&[]);

        assert!(!should_stop_incremental_on_page(
            false,
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
