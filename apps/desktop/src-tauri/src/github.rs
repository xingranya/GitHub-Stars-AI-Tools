use crate::auth::{github_api_get, github_api_get_optional, github_api_post};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const STARRED_REPOSITORIES_API: &str = "https://api.github.com/user/starred";
const STARRED_ACCEPT: &str = "application/vnd.github.star+json";
const README_ACCEPT: &str = "application/vnd.github+json";
const GIST_API: &str = "https://api.github.com/gists";
const SEARCH_REPOSITORIES_API: &str = "https://api.github.com/search/repositories";
const ANNOTATION_GIST_FILE: &str = "github-stars-ai-tools-annotations.json";
const PAGE_SIZE: u16 = 100;

pub fn starred_page_size() -> usize {
    PAGE_SIZE as usize
}

#[derive(Debug, Clone)]
pub struct StarredRepository {
    pub id: String,
    pub account_id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub topics_json: String,
    pub html_url: String,
    pub stars_count: u64,
    pub forks_count: u64,
    pub starred_at: String,
    pub pushed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ReadmeDocument {
    pub repo_id: String,
    pub raw_markdown: String,
    pub content_hash: String,
    pub source_path: String,
    pub fetched_at: String,
}

#[derive(Debug, Clone)]
pub struct GistExportResult {
    pub gist_id: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryRecommendation {
    pub full_name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub html_url: String,
    pub stars_count: u64,
    pub forks_count: u64,
    pub pushed_at: Option<String>,
}

#[derive(Deserialize)]
struct GistFileResponse {
    content: Option<String>,
    raw_url: Option<String>,
}

#[derive(Deserialize)]
struct GistResponse {
    id: String,
    html_url: String,
    files: std::collections::HashMap<String, GistFileResponse>,
}

#[derive(Deserialize)]
struct GitHubReadmeResponse {
    path: String,
    content: String,
    encoding: String,
}

#[derive(Deserialize)]
struct StarredRepositoryItem {
    starred_at: String,
    repo: GitHubRepository,
}

#[derive(Deserialize)]
struct GitHubRepository {
    id: u64,
    name: String,
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics: Option<Vec<String>>,
    html_url: String,
    stargazers_count: u64,
    forks_count: u64,
    pushed_at: Option<String>,
    owner: GitHubOwner,
}

#[derive(Deserialize)]
struct GitHubSearchRepositoryResponse {
    items: Vec<GitHubSearchRepositoryItem>,
}

#[derive(Deserialize)]
struct GitHubSearchRepositoryItem {
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics: Option<Vec<String>>,
    html_url: String,
    stargazers_count: u64,
    forks_count: u64,
    pushed_at: Option<String>,
}

#[derive(Deserialize)]
struct GitHubOwner {
    login: String,
}

pub fn fetch_readme(
    token: &str,
    repo_id: &str,
    full_name: &str,
) -> Result<Option<ReadmeDocument>, String> {
    let url = format!("https://api.github.com/repos/{full_name}/readme");
    let body = match github_api_get_optional(token, &url, README_ACCEPT)? {
        Some(body) => body,
        None => return Ok(None),
    };
    let readme = serde_json::from_str::<GitHubReadmeResponse>(&body)
        .map_err(|error| format!("GitHub README 响应解析失败：{error}"))?;

    if !readme.encoding.eq_ignore_ascii_case("base64") {
        return Err(format!(
            "GitHub README 使用了不支持的编码：{}",
            readme.encoding
        ));
    }

    let normalized_content = readme.content.replace(['\n', '\r'], "");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(normalized_content)
        .map_err(|error| format!("GitHub README 解码失败：{error}"))?;
    let raw_markdown =
        String::from_utf8(bytes).map_err(|_| "GitHub README 不是有效 UTF-8 文本".to_owned())?;
    let content_hash = sha256_hex(raw_markdown.as_bytes());

    Ok(Some(ReadmeDocument {
        repo_id: repo_id.to_owned(),
        raw_markdown,
        content_hash,
        source_path: readme.path,
        fetched_at: current_iso_timestamp()?,
    }))
}

pub fn create_annotation_gist(
    token: &str,
    snapshot_json: &str,
) -> Result<GistExportResult, String> {
    let mut files = serde_json::Map::new();
    files.insert(
        ANNOTATION_GIST_FILE.to_owned(),
        serde_json::json!({ "content": snapshot_json }),
    );
    let body = serde_json::json!({
        "description": "GitHub-Stars-AI-Tools annotation snapshot",
        "public": false,
        "files": files,
    })
    .to_string();
    let response_body = github_api_post(token, GIST_API, README_ACCEPT, &body)?;
    let response = serde_json::from_str::<GistResponse>(&response_body)
        .map_err(|error| format!("GitHub Gist 响应解析失败：{error}"))?;

    Ok(GistExportResult {
        gist_id: response.id,
        html_url: response.html_url,
    })
}

pub fn fetch_annotation_gist(token: &str, gist_id: &str) -> Result<String, String> {
    let url = format!("{GIST_API}/{gist_id}");
    let body = github_api_get(token, &url, README_ACCEPT)?;
    let response = serde_json::from_str::<GistResponse>(&body)
        .map_err(|error| format!("GitHub Gist 响应解析失败：{error}"))?;
    let file = response
        .files
        .get(ANNOTATION_GIST_FILE)
        .ok_or_else(|| "Gist 中没有 GitHub-Stars-AI-Tools 注解快照文件".to_owned())?;

    if let Some(content) = file.content.clone() {
        return Ok(content);
    }

    let raw_url = file
        .raw_url
        .as_deref()
        .ok_or_else(|| "Gist 注解快照内容为空，且没有可读取的原始文件地址".to_owned())?;
    github_api_get(token, raw_url, README_ACCEPT)
}

pub fn search_repositories(
    token: &str,
    query: &str,
    per_page: usize,
) -> Result<Vec<GitHubRepositoryRecommendation>, String> {
    let normalized_query = query.trim();
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!(
        "{SEARCH_REPOSITORIES_API}?q={query}&sort=stars&order=desc&per_page={per_page}",
        query = percent_encode(normalized_query),
        per_page = per_page.clamp(1, 30),
    );
    let body = github_api_get(token, &url, README_ACCEPT)?;
    let response = serde_json::from_str::<GitHubSearchRepositoryResponse>(&body)
        .map_err(|error| format!("GitHub 搜索响应解析失败：{error}"))?;

    Ok(response
        .items
        .into_iter()
        .map(|item| GitHubRepositoryRecommendation {
            full_name: item.full_name,
            description: item.description,
            language: item.language,
            topics: item.topics.unwrap_or_default(),
            html_url: item.html_url,
            stars_count: item.stargazers_count,
            forks_count: item.forks_count,
            pushed_at: item.pushed_at,
        })
        .collect())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn current_iso_timestamp() -> Result<String, String> {
    let output = std::process::Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .map_err(|error| format!("系统时间读取失败：{error}"))?;

    if !output.status.success() {
        return Err("系统时间读取失败".to_owned());
    }

    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_owned())
        .map_err(|_| "系统时间输出不是有效文本".to_owned())
}

pub fn fetch_starred_repositories_page(
    token: &str,
    account_id: &str,
    page: u32,
) -> Result<Vec<StarredRepository>, String> {
    let url = format!(
        "{STARRED_REPOSITORIES_API}?per_page={PAGE_SIZE}&page={page}&sort=created&direction=desc"
    );
    let body = github_api_get(token, &url, STARRED_ACCEPT)?;
    let items = serde_json::from_str::<Vec<StarredRepositoryItem>>(&body)
        .map_err(|error| format!("GitHub Stars 响应解析失败：{error}"))?;

    items
        .into_iter()
        .map(|item| map_starred_repository(account_id, item))
        .collect()
}

fn map_starred_repository(
    account_id: &str,
    item: StarredRepositoryItem,
) -> Result<StarredRepository, String> {
    let topics_json = serde_json::to_string(&item.repo.topics.unwrap_or_default())
        .map_err(|error| format!("GitHub Topics 序列化失败：{error}"))?;

    Ok(StarredRepository {
        id: repository_local_id(account_id, item.repo.id),
        account_id: account_id.to_owned(),
        owner: item.repo.owner.login,
        name: item.repo.name,
        full_name: item.repo.full_name,
        description: item.repo.description,
        language: item.repo.language,
        topics_json,
        html_url: item.repo.html_url,
        stars_count: item.repo.stargazers_count,
        forks_count: item.repo.forks_count,
        starred_at: item.starred_at,
        pushed_at: item.repo.pushed_at,
    })
}

fn repository_local_id(account_id: &str, github_repository_id: u64) -> String {
    format!("{account_id}:{github_repository_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_local_id_is_scoped_by_account() {
        assert_eq!(repository_local_id("1001", 42), "1001:42");
        assert_ne!(
            repository_local_id("1001", 42),
            repository_local_id("1002", 42)
        );
    }
}
