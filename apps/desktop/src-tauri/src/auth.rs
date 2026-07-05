use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const GITHUB_TOKEN_SERVICE: &str = "github-stars-ai-tools";
const GITHUB_TOKEN_ACCOUNT: &str = "github-pat";
const GITHUB_USER_API: &str = "https://api.github.com/user";
const GITHUB_API_VERSION: &str = "2022-11-28";
const GITHUB_CONNECT_TIMEOUT_SECONDS: u16 = 12;
const GITHUB_REQUEST_TIMEOUT_SECONDS: u16 = 45;
static SECURE_PASSWORD_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    #[serde(alias = "avatar_url")]
    pub avatar_url: Option<String>,
    #[serde(alias = "html_url")]
    pub html_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthState {
    pub has_token: bool,
    pub user: Option<GitHubUser>,
}

pub struct GitHubAuthStateCheck {
    pub state: GitHubAuthState,
    pub verification_error: Option<String>,
}

pub fn get_auth_state_check() -> Result<GitHubAuthStateCheck, String> {
    let token = match read_github_token()? {
        Some(token) => token,
        None => {
            return Ok(GitHubAuthStateCheck {
                state: GitHubAuthState {
                    has_token: false,
                    user: None,
                },
                verification_error: None,
            });
        }
    };

    match verify_github_token(&token) {
        Ok(user) => Ok(GitHubAuthStateCheck {
            state: GitHubAuthState {
                has_token: true,
                user: Some(user),
            },
            verification_error: None,
        }),
        Err(error) => Ok(GitHubAuthStateCheck {
            state: GitHubAuthState {
                has_token: true,
                user: None,
            },
            verification_error: Some(error),
        }),
    }
}

pub fn can_restore_cached_user_after_auth_error(error: &str) -> bool {
    !(error.contains("Token 无效或权限不足") || error.contains("HTTP 401"))
}

pub fn save_github_token(token: String) -> Result<GitHubUser, String> {
    let token = token.trim().to_owned();

    if token.is_empty() {
        return Err("请输入 GitHub Personal Access Token".to_owned());
    }

    let user = verify_github_token(&token)?;
    save_github_token_to_secure_store(&token)?;

    Ok(user)
}

pub fn clear_github_token() -> Result<(), String> {
    delete_github_token_from_secure_store()
}

pub fn read_secure_password(service: &str, account: &str) -> Result<Option<String>, String> {
    read_password_from_secure_store(service, account)
}

pub fn save_secure_password(service: &str, account: &str, password: &str) -> Result<(), String> {
    let password = password.trim();
    if password.is_empty() {
        return delete_secure_password(service, account);
    }

    save_password_to_secure_store(service, account, password)
}

pub fn delete_secure_password(service: &str, account: &str) -> Result<(), String> {
    delete_password_from_secure_store(service, account)
}

pub fn require_github_token() -> Result<String, String> {
    read_github_token()?.ok_or_else(|| "请先连接 GitHub 账号".to_owned())
}

pub fn verify_github_token(token: &str) -> Result<GitHubUser, String> {
    let body = github_api_get(token, GITHUB_USER_API, "application/vnd.github+json")?;
    serde_json::from_str::<GitHubUser>(&body)
        .map_err(|error| format!("GitHub 用户信息解析失败：{error}"))
}

pub fn github_api_get(token: &str, url: &str, accept: &str) -> Result<String, String> {
    let response = github_api_request(token, url, accept)?;

    if !response.status_success {
        return Err(format_github_http_error(response.http_code, &response.body));
    }

    Ok(response.body)
}

pub fn github_api_get_optional(
    token: &str,
    url: &str,
    accept: &str,
) -> Result<Option<String>, String> {
    let response = github_api_request(token, url, accept)?;

    if response.status_success {
        return Ok(Some(response.body));
    }

    if response.http_code == Some(404) {
        return Ok(None);
    }

    Err(format_github_http_error(response.http_code, &response.body))
}

pub fn github_api_post(token: &str, url: &str, accept: &str, body: &str) -> Result<String, String> {
    let response = github_api_request_with_body(token, url, accept, "POST", body)?;

    if !response.status_success {
        return Err(format_github_http_error(response.http_code, &response.body));
    }

    Ok(response.body)
}

struct GitHubApiResponse {
    status_success: bool,
    http_code: Option<u16>,
    body: String,
}

fn github_api_request(token: &str, url: &str, accept: &str) -> Result<GitHubApiResponse, String> {
    let escaped_url = curl_config_string(url);
    let escaped_accept = curl_config_string(accept);
    let escaped_token = curl_config_string(token);
    let config = format!(
        r#"
		silent
	show-error
		location
		connect-timeout = "{GITHUB_CONNECT_TIMEOUT_SECONDS}"
		max-time = "{GITHUB_REQUEST_TIMEOUT_SECONDS}"
		url = "{escaped_url}"
	write-out = "\n__GITHUB_STARS_AI_HTTP_STATUS__:%{{http_code}}"
	header = "Accept: {escaped_accept}"
	header = "X-GitHub-Api-Version: {GITHUB_API_VERSION}"
	header = "User-Agent: GitHub-Stars-AI-Tools"
	header = "Authorization: Bearer {escaped_token}"
	"#
    );

    execute_curl_config(&config)
}

fn github_api_request_with_body(
    token: &str,
    url: &str,
    accept: &str,
    method: &str,
    body: &str,
) -> Result<GitHubApiResponse, String> {
    let body_path = write_temp_request_body(body)?;
    let escaped_url = curl_config_string(url);
    let escaped_accept = curl_config_string(accept);
    let escaped_method = curl_config_string(method);
    let escaped_token = curl_config_string(token);
    let config = format!(
        r#"
			silent
	show-error
	location
	connect-timeout = "{GITHUB_CONNECT_TIMEOUT_SECONDS}"
	max-time = "{GITHUB_REQUEST_TIMEOUT_SECONDS}"
	url = "{escaped_url}"
request = "{escaped_method}"
write-out = "\n__GITHUB_STARS_AI_HTTP_STATUS__:%{{http_code}}"
header = "Accept: {escaped_accept}"
header = "Content-Type: application/json"
header = "X-GitHub-Api-Version: {GITHUB_API_VERSION}"
header = "User-Agent: GitHub-Stars-AI-Tools"
header = "Authorization: Bearer {escaped_token}"
data-binary = "@{}"
	"#,
        curl_config_string(&body_path.to_string_lossy())
    );

    let result = execute_curl_config(&config);
    let _ = fs::remove_file(body_path);
    result
}

fn execute_curl_config(config: &str) -> Result<GitHubApiResponse, String> {
    let mut child = Command::new("curl")
        .args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("GitHub API 请求失败：{error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "GitHub API 请求初始化失败".to_owned())?;
    stdin
        .write_all(config.as_bytes())
        .map_err(|error| format!("GitHub API 请求写入失败：{error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("GitHub API 请求失败：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if stderr.to_ascii_lowercase().contains("timed out")
            || stderr.to_ascii_lowercase().contains("timeout")
        {
            return Err(format!(
                "GitHub API 请求超时，请检查网络连接或稍后重试（已等待 {GITHUB_REQUEST_TIMEOUT_SECONDS} 秒）。"
            ));
        }
        return Err(if stderr.is_empty() {
            "GitHub API 请求失败，请检查网络连接或 GitHub 服务状态".to_owned()
        } else {
            format!("GitHub API 请求失败：{stderr}")
        });
    }

    let output_text =
        String::from_utf8(output.stdout).map_err(|_| "GitHub API 响应不是有效文本".to_owned())?;
    let (body, http_code) = split_http_status(&output_text);

    Ok(GitHubApiResponse {
        status_success: output.status.success()
            && http_code.is_some_and(|code| (200..300).contains(&code)),
        http_code,
        body,
    })
}

fn curl_config_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn write_temp_request_body(body: &str) -> Result<std::path::PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("GitHub API 请求临时文件时间戳生成失败：{error}"))?
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "github-stars-api-request-{}-{timestamp}.json",
        std::process::id()
    ));
    fs::write(&path, body).map_err(|error| format!("GitHub API 请求临时文件写入失败：{error}"))?;
    Ok(path)
}

fn split_http_status(output: &str) -> (String, Option<u16>) {
    let marker = "\n__GITHUB_STARS_AI_HTTP_STATUS__:";

    match output.rsplit_once(marker) {
        Some((body, code)) => (body.to_owned(), code.trim().parse::<u16>().ok()),
        None => (output.to_owned(), None),
    }
}

fn format_github_http_error(http_code: Option<u16>, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/message")
                .and_then(|message| message.as_str())
                .map(str::to_owned)
        })
        .filter(|message| !message.trim().is_empty());

    let is_rate_limit = detail.as_deref().is_some_and(is_github_rate_limit_message);

    let base_message = match http_code {
        Some(401) => "Token 无效或权限不足，请重新检查 GitHub Personal Access Token",
        Some(403) if is_rate_limit => "GitHub API 请求过于频繁，请稍后再试",
        Some(403) => "Token 无效或权限不足，请重新检查 GitHub Personal Access Token",
        Some(429) => "GitHub API 请求过于频繁，请稍后再试",
        Some(404) => "GitHub 资源不存在或当前 Token 无权访问",
        Some(code) if (500..600).contains(&code) => "GitHub 服务暂时不可用，请稍后重试",
        _ => "GitHub API 请求失败，请检查网络、Token 权限或 GitHub 限流状态",
    };

    match (http_code, detail) {
        (Some(code), Some(detail)) => format!("{base_message}（HTTP {code}：{detail}）"),
        (Some(code), None) => format!("{base_message}（HTTP {code}）"),
        (None, Some(detail)) => format!("{base_message}：{detail}"),
        (None, None) => base_message.to_owned(),
    }
}

fn is_github_rate_limit_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("rate limit")
        || normalized.contains("secondary rate")
        || normalized.contains("abuse detection")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_http_status_reads_marker_from_curl_output() {
        let (body, status) =
            split_http_status("{\"login\":\"demo\"}\n__GITHUB_STARS_AI_HTTP_STATUS__:200");

        assert_eq!(body, "{\"login\":\"demo\"}");
        assert_eq!(status, Some(200));
    }

    #[test]
    fn split_http_status_keeps_body_when_marker_missing() {
        let (body, status) = split_http_status("network failure");

        assert_eq!(body, "network failure");
        assert_eq!(status, None);
    }

    #[test]
    fn curl_config_string_escapes_unsafe_values() {
        assert_eq!(
            curl_config_string("token\\with\"quote\nand\ttab"),
            "token\\\\with\\\"quote\\nand\\ttab"
        );
    }

    #[test]
    fn format_github_http_error_reports_invalid_token() {
        let message = format_github_http_error(
            Some(401),
            r#"{"message":"Bad credentials","documentation_url":"https://docs.github.com"}"#,
        );

        assert!(message.contains("Token 无效或权限不足"));
        assert!(message.contains("HTTP 401"));
        assert!(message.contains("Bad credentials"));
    }

    #[test]
    fn format_github_http_error_reports_server_failure() {
        let message = format_github_http_error(Some(502), "");

        assert!(message.contains("GitHub 服务暂时不可用"));
        assert!(message.contains("HTTP 502"));
    }

    #[test]
    fn format_github_http_error_reports_rate_limit_separately_from_invalid_token() {
        let message = format_github_http_error(
            Some(403),
            r#"{"message":"API rate limit exceeded for user ID 1001."}"#,
        );

        assert!(message.contains("GitHub API 请求过于频繁"));
        assert!(message.contains("HTTP 403"));
        assert!(!message.contains("Token 无效或权限不足"));
    }

    #[test]
    fn invalid_token_error_cannot_restore_cached_user() {
        assert!(!can_restore_cached_user_after_auth_error(
            "Token 无效或权限不足，请重新检查 GitHub Personal Access Token（HTTP 401：Bad credentials）"
        ));
        assert!(!can_restore_cached_user_after_auth_error(
            "Token 无效或权限不足，请重新检查 GitHub Personal Access Token（HTTP 403）"
        ));
    }

    #[test]
    fn network_error_can_restore_cached_user() {
        assert!(can_restore_cached_user_after_auth_error(
            "GitHub API 请求超时，请检查网络连接或稍后重试（已等待 45 秒）。"
        ));
        assert!(can_restore_cached_user_after_auth_error(
            "GitHub 服务暂时不可用，请稍后重试（HTTP 502）"
        ));
        assert!(can_restore_cached_user_after_auth_error(
            "GitHub API 请求过于频繁，请稍后再试（HTTP 403：API rate limit exceeded for user ID 1001.）"
        ));
    }
}

#[cfg(target_os = "macos")]
fn read_github_token() -> Result<Option<String>, String> {
    read_password_from_secure_store(GITHUB_TOKEN_SERVICE, GITHUB_TOKEN_ACCOUNT)
}

#[cfg(not(target_os = "macos"))]
fn read_github_token() -> Result<Option<String>, String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn save_github_token_to_secure_store(token: &str) -> Result<(), String> {
    save_password_to_secure_store(GITHUB_TOKEN_SERVICE, GITHUB_TOKEN_ACCOUNT, token)
}

#[cfg(not(target_os = "macos"))]
fn save_github_token_to_secure_store(_token: &str) -> Result<(), String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn delete_github_token_from_secure_store() -> Result<(), String> {
    delete_password_from_secure_store(GITHUB_TOKEN_SERVICE, GITHUB_TOKEN_ACCOUNT)
}

#[cfg(not(target_os = "macos"))]
fn delete_github_token_from_secure_store() -> Result<(), String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn read_password_from_secure_store(service: &str, account: &str) -> Result<Option<String>, String> {
    let cache_key = secure_password_cache_key(service, account);
    let cache = SECURE_PASSWORD_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(cached) = cache
        .lock()
        .map_err(|_| "安全凭据缓存已损坏".to_owned())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(cached);
    }

    let password = macos_keychain::read_password(service, account)?;
    cache
        .lock()
        .map_err(|_| "安全凭据缓存已损坏".to_owned())?
        .insert(cache_key, password.clone());
    Ok(password)
}

#[cfg(not(target_os = "macos"))]
fn read_password_from_secure_store(
    _service: &str,
    _account: &str,
) -> Result<Option<String>, String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn save_password_to_secure_store(
    service: &str,
    account: &str,
    password: &str,
) -> Result<(), String> {
    macos_keychain::save_password(service, account, password)?;
    update_secure_password_cache(service, account, Some(password.to_owned()))
}

#[cfg(not(target_os = "macos"))]
fn save_password_to_secure_store(
    _service: &str,
    _account: &str,
    _password: &str,
) -> Result<(), String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn delete_password_from_secure_store(service: &str, account: &str) -> Result<(), String> {
    macos_keychain::delete_password(service, account)?;
    update_secure_password_cache(service, account, None)
}

#[cfg(not(target_os = "macos"))]
fn delete_password_from_secure_store(_service: &str, _account: &str) -> Result<(), String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

fn secure_password_cache_key(service: &str, account: &str) -> String {
    format!("{service}\n{account}")
}

fn update_secure_password_cache(
    service: &str,
    account: &str,
    password: Option<String>,
) -> Result<(), String> {
    SECURE_PASSWORD_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "安全凭据缓存已损坏".to_owned())?
        .insert(secure_password_cache_key(service, account), password);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos_keychain {
    use std::ffi::{c_char, c_void};
    use std::ptr;
    use std::slice;

    type OSStatus = i32;
    type SecKeychainRef = *const c_void;
    type SecKeychainItemRef = *mut c_void;

    const ERR_SEC_ITEM_NOT_FOUND: OSStatus = -25300;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainAddGenericPassword(
            keychain: SecKeychainRef,
            service_name_length: u32,
            service_name: *const c_char,
            account_name_length: u32,
            account_name: *const c_char,
            password_length: u32,
            password_data: *const c_void,
            item_ref: *mut SecKeychainItemRef,
        ) -> OSStatus;

        fn SecKeychainFindGenericPassword(
            keychain: SecKeychainRef,
            service_name_length: u32,
            service_name: *const c_char,
            account_name_length: u32,
            account_name: *const c_char,
            password_length: *mut u32,
            password_data: *mut *mut c_void,
            item_ref: *mut SecKeychainItemRef,
        ) -> OSStatus;

        fn SecKeychainItemDelete(item_ref: SecKeychainItemRef) -> OSStatus;
        fn SecKeychainItemFreeContent(attr_list: *mut c_void, data: *mut c_void) -> OSStatus;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }

    pub fn read_password(service: &str, account: &str) -> Result<Option<String>, String> {
        let mut password_length = 0_u32;
        let mut password_data: *mut c_void = ptr::null_mut();
        let mut item_ref: SecKeychainItemRef = ptr::null_mut();

        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr().cast::<c_char>(),
                account.len() as u32,
                account.as_ptr().cast::<c_char>(),
                &mut password_length,
                &mut password_data,
                &mut item_ref,
            )
        };

        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(None);
        }

        if status != 0 {
            return Err("安全凭据读取失败".to_owned());
        }

        let bytes =
            unsafe { slice::from_raw_parts(password_data.cast::<u8>(), password_length as usize) };
        let password = String::from_utf8(bytes.to_vec())
            .map_err(|_| "安全凭据读取结果不是有效文本".to_owned())?;

        unsafe {
            SecKeychainItemFreeContent(ptr::null_mut(), password_data);
            if !item_ref.is_null() {
                CFRelease(item_ref.cast::<c_void>());
            }
        }

        Ok(Some(password))
    }

    pub fn save_password(service: &str, account: &str, password: &str) -> Result<(), String> {
        delete_password(service, account)?;

        let status = unsafe {
            SecKeychainAddGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr().cast::<c_char>(),
                account.len() as u32,
                account.as_ptr().cast::<c_char>(),
                password.len() as u32,
                password.as_ptr().cast::<c_void>(),
                ptr::null_mut(),
            )
        };

        if status == 0 {
            Ok(())
        } else {
            Err("安全凭据写入系统安全存储失败".to_owned())
        }
    }

    pub fn delete_password(service: &str, account: &str) -> Result<(), String> {
        let mut item_ref: SecKeychainItemRef = ptr::null_mut();

        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                service.len() as u32,
                service.as_ptr().cast::<c_char>(),
                account.len() as u32,
                account.as_ptr().cast::<c_char>(),
                ptr::null_mut(),
                ptr::null_mut(),
                &mut item_ref,
            )
        };

        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(());
        }

        if status != 0 {
            return Err("安全凭据定位失败".to_owned());
        }

        let delete_status = unsafe { SecKeychainItemDelete(item_ref) };
        unsafe {
            if !item_ref.is_null() {
                CFRelease(item_ref.cast::<c_void>());
            }
        }

        if delete_status == 0 {
            Ok(())
        } else {
            Err("安全凭据清除失败".to_owned())
        }
    }
}
