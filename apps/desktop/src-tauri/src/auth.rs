use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const GITHUB_TOKEN_SERVICE: &str = "github-stars-ai-tools";
const GITHUB_TOKEN_ACCOUNT: &str = "github-pat";
const GITHUB_USER_API: &str = "https://api.github.com/user";
const GITHUB_API_VERSION: &str = "2022-11-28";
const DEBUG_SESSION_ID: &str = "974fcdfc-8128-4fa9-849e-60e37b172aad";
const DEBUG_LOG_PATH: &str = "/.cursor/debug-974fcdfc-8128-4fa9-849e-60e37b172aad.log";

fn debug_log(run_id: &str, hypothesis_id: &str, location: &str, message: &str, data: serde_json::Value) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let payload = serde_json::json!({
        "sessionId": DEBUG_SESSION_ID,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": timestamp,
    });

    if let Some(parent) = Path::new(DEBUG_LOG_PATH).parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(DEBUG_LOG_PATH)
    {
        let _ = writeln!(file, "{}", payload);
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthState {
    pub has_token: bool,
    pub user: Option<GitHubUser>,
}

pub fn get_auth_state() -> Result<GitHubAuthState, String> {
    let token = match read_github_token()? {
        Some(token) => token,
        None => {
            return Ok(GitHubAuthState {
                has_token: false,
                user: None,
            });
        }
    };

    match verify_github_token(&token) {
        Ok(user) => Ok(GitHubAuthState {
            has_token: true,
            user: Some(user),
        }),
        Err(_) => Ok(GitHubAuthState {
            has_token: true,
            user: None,
        }),
    }
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

pub fn require_github_token() -> Result<String, String> {
    read_github_token()?.ok_or_else(|| "请先连接 GitHub 账号".to_owned())
}

pub fn verify_github_token(token: &str) -> Result<GitHubUser, String> {
    let body = github_api_get(token, GITHUB_USER_API, "application/vnd.github+json")?;
    let json_value = serde_json::from_str::<serde_json::Value>(&body).ok();
    let keys = json_value
        .as_ref()
        .and_then(|value| value.as_object())
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    // #region agent log
    debug_log(
        "initial",
        "H1,H2,H3,H4",
        "auth.rs:verify_github_token:before_parse",
        "GitHub user response shape before parsing",
        serde_json::json!({
            "bodyLength": body.len(),
            "hasId": json_value.as_ref().and_then(|value| value.get("id")).is_some(),
            "hasLogin": json_value.as_ref().and_then(|value| value.get("login")).is_some(),
            "hasHtmlUrlSnake": json_value.as_ref().and_then(|value| value.get("html_url")).is_some(),
            "hasHtmlUrlCamel": json_value.as_ref().and_then(|value| value.get("htmlUrl")).is_some(),
            "hasMessage": json_value.as_ref().and_then(|value| value.get("message")).is_some(),
            "topLevelKeys": keys,
        }),
    );
    // #endregion

    serde_json::from_str::<GitHubUser>(&body).map_err(|error| {
        // #region agent log
        debug_log(
            "initial",
            "H1,H2,H3,H4",
            "auth.rs:verify_github_token:parse_error",
            "GitHub user response parse failed",
            serde_json::json!({
                "error": error.to_string(),
            }),
        );
        // #endregion
        format!("GitHub 用户信息解析失败：{error}")
    })
}

pub fn github_api_get(token: &str, url: &str, accept: &str) -> Result<String, String> {
    let response = github_api_request(token, url, accept)?;

    if !response.status_success {
        return Err("GitHub API 请求失败，请检查 Token 权限或 GitHub 限流状态".to_owned());
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

    Err("GitHub API 请求失败，请检查 Token 权限或 GitHub 限流状态".to_owned())
}

pub fn github_api_post(token: &str, url: &str, accept: &str, body: &str) -> Result<String, String> {
    let response = github_api_request_with_body(token, url, accept, "POST", body)?;

    if !response.status_success {
        return Err("GitHub API 写入失败，请检查 Token Gist 权限或 GitHub 限流状态".to_owned());
    }

    Ok(response.body)
}

struct GitHubApiResponse {
    status_success: bool,
    http_code: Option<u16>,
    body: String,
}

fn github_api_request(token: &str, url: &str, accept: &str) -> Result<GitHubApiResponse, String> {
    let config = format!(
        r#"
silent
show-error
location
url = "{url}"
write-out = "\n__GITHUB_STARS_AI_HTTP_STATUS__:%{{http_code}}"
header = "Accept: {accept}"
header = "X-GitHub-Api-Version: {GITHUB_API_VERSION}"
header = "User-Agent: GitHub-Stars-AI-Tools"
header = "Authorization: Bearer {token}"
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
    let escaped_body = curl_config_string(body);
    let config = format!(
        r#"
silent
show-error
location
url = "{url}"
request = "{method}"
write-out = "\n__GITHUB_STARS_AI_HTTP_STATUS__:%{{http_code}}"
header = "Accept: {accept}"
header = "Content-Type: application/json"
header = "X-GitHub-Api-Version: {GITHUB_API_VERSION}"
header = "User-Agent: GitHub-Stars-AI-Tools"
header = "Authorization: Bearer {token}"
data = "{escaped_body}"
"#
    );

    execute_curl_config(&config)
}

fn execute_curl_config(config: &str) -> Result<GitHubApiResponse, String> {
    let mut child = Command::new("curl")
        .args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
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

fn split_http_status(output: &str) -> (String, Option<u16>) {
    let marker = "\n__GITHUB_STARS_AI_HTTP_STATUS__:";

    match output.rsplit_once(marker) {
        Some((body, code)) => (body.to_owned(), code.trim().parse::<u16>().ok()),
        None => (output.to_owned(), None),
    }
}

#[cfg(target_os = "macos")]
fn read_github_token() -> Result<Option<String>, String> {
    macos_keychain::read_password(GITHUB_TOKEN_SERVICE, GITHUB_TOKEN_ACCOUNT)
}

#[cfg(not(target_os = "macos"))]
fn read_github_token() -> Result<Option<String>, String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn save_github_token_to_secure_store(token: &str) -> Result<(), String> {
    macos_keychain::save_password(GITHUB_TOKEN_SERVICE, GITHUB_TOKEN_ACCOUNT, token)
}

#[cfg(not(target_os = "macos"))]
fn save_github_token_to_secure_store(_token: &str) -> Result<(), String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
}

#[cfg(target_os = "macos")]
fn delete_github_token_from_secure_store() -> Result<(), String> {
    macos_keychain::delete_password(GITHUB_TOKEN_SERVICE, GITHUB_TOKEN_ACCOUNT)
}

#[cfg(not(target_os = "macos"))]
fn delete_github_token_from_secure_store() -> Result<(), String> {
    Err("当前安全存储实现暂只支持 macOS".to_owned())
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
            return Err("GitHub Token 读取失败".to_owned());
        }

        let bytes =
            unsafe { slice::from_raw_parts(password_data.cast::<u8>(), password_length as usize) };
        let password = String::from_utf8(bytes.to_vec())
            .map_err(|_| "GitHub Token 读取结果不是有效文本".to_owned())?;

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
            Err("GitHub Token 写入系统安全存储失败".to_owned())
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
            return Err("GitHub Token 定位失败".to_owned());
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
            Err("GitHub Token 清除失败".to_owned())
        }
    }
}
