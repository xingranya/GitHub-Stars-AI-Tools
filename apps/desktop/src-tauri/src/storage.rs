use crate::auth::GitHubUser;
use crate::github::{GitHubRepositoryRecommendation, ReadmeDocument, StarredRepository};
use crate::ranking_query::personal_ranking_order_clause;
use rusqlite::{types::ValueRef, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const INITIAL_SCHEMA_SQL: &str =
    include_str!("../../../../packages/storage/migrations/001_initial_schema.sql");
const LEGACY_SQLITE_DATABASE_FILE_NAMES: &[&str] = &["stars-ai-tools.sqlite3"];
const OTHER_LANGUAGE_LABEL: &str = "其他";
const RECOMMENDATION_CATEGORY_OPTIONS: &[(&str, &str)] = &[
    ("ai-agent", "AI 与 Agent"),
    ("desktop", "桌面应用"),
    ("web", "Web 与前端"),
    ("backend", "后端与 API"),
    ("data", "数据与数据库"),
    ("devops", "DevOps 与基础设施"),
    ("developer-tools", "开发工具"),
    ("learning", "学习与文档"),
    ("other", "其他"),
];
const REQUIRED_SCHEMA_COLUMNS: &[(&str, &[&str])] = &[
    ("schema_migrations", &["version", "name", "applied_at"]),
    (
        "github_accounts",
        &[
            "id",
            "login",
            "avatar_url",
            "token_ref",
            "connection_status",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "repositories",
        &[
            "id",
            "account_id",
            "owner",
            "name",
            "full_name",
            "description",
            "language",
            "topics_json",
            "html_url",
            "stars_count",
            "forks_count",
            "starred_at",
            "pushed_at",
            "sync_status",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "repo_readmes",
        &[
            "repo_id",
            "raw_markdown",
            "content_hash",
            "source_path",
            "fetched_at",
        ],
    ),
    (
        "repo_ai_documents",
        &[
            "repo_id",
            "summary_zh",
            "readme_zh",
            "keywords_json",
            "suggested_tags_json",
            "model",
            "prompt_version",
            "source_hash",
            "input_tokens",
            "output_tokens",
            "generated_at",
        ],
    ),
    (
        "repo_embeddings",
        &[
            "repo_id",
            "source_kind",
            "source_hash",
            "model",
            "model_version",
            "dimensions",
            "vector_json",
            "generated_at",
        ],
    ),
    (
        "tags",
        &[
            "id",
            "account_id",
            "name",
            "color",
            "created_at",
            "updated_at",
        ],
    ),
    ("repo_tags", &["repo_id", "tag_id", "created_at"]),
    (
        "annotations",
        &[
            "repo_id",
            "account_id",
            "note_md",
            "rating",
            "read_status",
            "updated_at",
        ],
    ),
    (
        "jobs",
        &[
            "id",
            "account_id",
            "type",
            "payload_json",
            "status",
            "idempotency_key",
            "retry_count",
            "last_error",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "github_recommendation_candidates",
        &[
            "id",
            "account_id",
            "full_name",
            "description",
            "language",
            "topics_json",
            "html_url",
            "stars_count",
            "forks_count",
            "pushed_at",
            "status",
            "rationale_zh",
            "queries_json",
            "last_seen_at",
            "updated_at",
        ],
    ),
];

pub struct AppStorage {
    database_path: PathBuf,
}

#[derive(Clone, Deserialize)]
pub struct StoredRepository {
    pub id: String,
    pub full_name: String,
}

pub struct RepositoryAiSource {
    pub id: String,
    pub account_id: String,
    pub full_name: String,
    pub description: Option<String>,
    pub readme: Option<RepositoryReadmeView>,
}

pub struct RepositoryTaggingSource {
    pub full_name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub ai_summary: Option<String>,
    pub suggested_tags: Vec<String>,
    pub stars_count: u64,
}

pub struct AiTagAssignment {
    pub tag_name: String,
    pub color: Option<String>,
    pub repository_full_names: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRecommendationCandidateState {
    pub id: String,
    pub full_name: String,
    pub status: String,
}

pub struct GithubRecommendationCandidateList {
    pub rationale_zh: String,
    pub queries: Vec<String>,
    pub repositories: Vec<GitHubRepositoryRecommendation>,
    pub total_count: usize,
    pub limit: usize,
    pub offset: usize,
    pub categories: Vec<GithubRecommendationCategoryCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRecommendationCategoryCount {
    pub value: String,
    pub label: String,
    pub count: usize,
}

pub struct GithubRecommendationCachedTranslation {
    pub markdown_zh: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub source_char_count: usize,
    pub translated_char_count: usize,
    pub is_truncated: bool,
}

pub struct GithubRankingCacheEntry {
    pub payload_json: String,
    pub fetched_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAiTagAssignmentsSummary {
    pub tag_count: usize,
    pub linked_count: usize,
    pub skipped_repository_count: usize,
    pub failed_batch_count: usize,
    pub failures: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSnapshot {
    pub schema_version: u8,
    pub exported_at: String,
    pub account_id: String,
    pub tags: Vec<AnnotationSnapshotTag>,
    pub repositories: Vec<AnnotationSnapshotRepository>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLibrarySnapshot {
    pub schema_version: u8,
    pub exported_at: String,
    pub account_id: String,
    pub tags: Vec<AnnotationSnapshotTag>,
    pub repositories: Vec<RepositoryLibrarySnapshotRepository>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSnapshotTag {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSnapshotRepository {
    pub repository_id: String,
    pub full_name: String,
    pub note_markdown: String,
    pub read_status: String,
    pub tag_names: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLibrarySnapshotRepository {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub html_url: String,
    pub stars_count: u64,
    pub forks_count: u64,
    pub starred_at: String,
    pub pushed_at: Option<String>,
    pub note_markdown: String,
    pub read_status: String,
    pub tag_names: Vec<String>,
}

pub struct AnnotationImportSummary {
    pub tag_count: usize,
    pub repository_count: usize,
    pub skipped_repository_count: usize,
}

pub struct RepositoryLibraryImportSummary {
    pub tag_count: usize,
    pub repository_count: usize,
    pub created_repository_count: usize,
    pub updated_repository_count: usize,
}

#[derive(Deserialize)]
struct RepositorySyncStateRow {
    id: String,
    sync_status: String,
}

#[derive(Deserialize)]
struct RepositoryFullNameIdRow {
    full_name: String,
    id: String,
}

#[derive(Deserialize)]
struct RecommendationCandidateRow {
    id: String,
    full_name: String,
    status: String,
}

#[derive(Deserialize)]
struct RecommendationCandidateDetailRow {
    id: String,
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics_json: String,
    html_url: String,
    stars_count: u64,
    forks_count: u64,
    pushed_at: Option<String>,
    status: String,
    updated_at: String,
    rationale_zh: Option<String>,
    queries_json: String,
    candidate_category: String,
}

#[derive(Deserialize)]
struct RecommendationCategoryCountRow {
    candidate_category: String,
    count: usize,
}

#[derive(Deserialize)]
struct GithubRecommendationTranslationRow {
    markdown_zh: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    source_char_count: usize,
    translated_char_count: usize,
    is_truncated: u8,
}

#[derive(Deserialize)]
struct GithubRankingCacheRow {
    payload_json: String,
    fetched_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryListPage {
    pub items: Vec<RepositoryListItem>,
    pub total_count: usize,
    pub limit: usize,
    pub offset: usize,
}

pub struct RepositoryListFilters<'a> {
    pub account_id: Option<&'a str>,
    pub keyword: Option<&'a str>,
    pub language: Option<&'a str>,
    pub tag_id: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryListItem {
    pub id: String,
    pub account_id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub html_url: String,
    pub stars_count: u64,
    pub forks_count: u64,
    pub starred_at: String,
    pub pushed_at: Option<String>,
    pub has_readme: bool,
    pub ai_summary: Option<String>,
    pub ai_keywords: Vec<String>,
    pub suggested_tags: Vec<String>,
    pub tag_ids: Vec<String>,
    pub tag_names: Vec<String>,
    pub ai_generated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagItem {
    pub id: String,
    pub account_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAnnotationView {
    pub repository_id: String,
    pub account_id: String,
    pub note_markdown: String,
    pub reading_status: String,
    pub tags: Vec<TagItem>,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDetailView {
    pub repository_id: String,
    pub account_id: String,
    pub readme: Option<RepositoryReadmeView>,
    pub ai_document: Option<RepositoryAiDocumentView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryReadmeView {
    pub raw_markdown: String,
    pub content_hash: String,
    pub source_path: String,
    pub fetched_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAiDocumentView {
    pub summary_zh: String,
    pub readme_zh: Option<String>,
    pub keywords: Vec<String>,
    pub suggested_tags: Vec<String>,
    pub model: String,
    pub prompt_version: String,
    pub source_hash: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub generated_at: String,
}

#[derive(Deserialize)]
struct GitHubAccountRow {
    id: String,
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct RepositoryListRow {
    id: String,
    account_id: String,
    owner: String,
    name: String,
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics_json: String,
    html_url: String,
    stars_count: u64,
    forks_count: u64,
    starred_at: String,
    pushed_at: Option<String>,
    has_readme: u8,
    ai_summary: Option<String>,
    ai_keywords_json: Option<String>,
    suggested_tags_json: Option<String>,
    tag_ids_json: String,
    tag_names_json: String,
    ai_generated_at: Option<String>,
}

#[derive(Deserialize)]
struct AnnotationRow {
    repository_id: String,
    account_id: String,
    note_markdown: String,
    reading_status: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct AnnotationSnapshotRepositoryRow {
    repository_id: String,
    full_name: String,
    note_markdown: String,
    read_status: String,
    tag_names_json: String,
}

#[derive(Deserialize)]
struct RepositoryLibrarySnapshotRepositoryRow {
    full_name: String,
    owner: String,
    name: String,
    description: Option<String>,
    language: Option<String>,
    topics_json: String,
    html_url: String,
    stars_count: u64,
    forks_count: u64,
    starred_at: String,
    pushed_at: Option<String>,
    note_markdown: String,
    read_status: String,
    tag_names_json: String,
}

#[derive(Deserialize)]
struct RepositoryLanguageRow {
    language: String,
}

#[derive(Deserialize)]
struct RepositoryReadmeRow {
    raw_markdown: String,
    content_hash: String,
    source_path: String,
    fetched_at: String,
}

#[derive(Deserialize)]
struct RepositoryAiDocumentRow {
    summary_zh: String,
    readme_zh: Option<String>,
    keywords_json: String,
    suggested_tags_json: String,
    model: String,
    prompt_version: String,
    source_hash: String,
    input_tokens: u64,
    output_tokens: u64,
    generated_at: String,
}

#[derive(Deserialize)]
struct RepositoryAiSourceRow {
    id: String,
    account_id: String,
    full_name: String,
    description: Option<String>,
}

#[derive(Deserialize)]
struct RepositoryTaggingSourceRow {
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics_json: String,
    stars_count: u64,
    ai_summary: Option<String>,
    suggested_tags_json: Option<String>,
}

#[derive(Deserialize)]
struct SearchRepositoryRow {
    id: String,
    account_id: String,
    owner: String,
    name: String,
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics_json: String,
    html_url: String,
    stars_count: u64,
    forks_count: u64,
    starred_at: String,
    pushed_at: Option<String>,
    has_readme: u8,
    note_markdown: Option<String>,
    summary_zh: Option<String>,
    keywords_json: Option<String>,
    suggested_tags_json: Option<String>,
    readme_excerpt: Option<String>,
    tag_names_json: String,
}

#[derive(Debug, Clone)]
pub struct VectorIndexCandidate {
    pub account_id: String,
    pub repo_id: String,
    pub full_name: String,
    pub source_hash: String,
    pub knowledge_text: String,
    pub existing_source_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredRepositoryEmbedding {
    pub account_id: String,
    pub repo_id: String,
    pub source_hash: String,
    pub model: String,
    pub vector: Vec<f32>,
}

#[derive(Deserialize)]
struct VectorIndexCandidateRow {
    account_id: String,
    repo_id: String,
    full_name: String,
    description: Option<String>,
    language: Option<String>,
    topics_json: String,
    summary_zh: Option<String>,
    keywords_json: Option<String>,
    suggested_tags_json: Option<String>,
    readme_excerpt: Option<String>,
    tag_names_json: String,
    existing_source_hash: Option<String>,
}

#[derive(Deserialize)]
struct StoredRepositoryEmbeddingRow {
    account_id: String,
    repo_id: String,
    source_hash: String,
    model: String,
    vector_json: String,
}

impl AppStorage {
    pub fn from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let database_path = Self::database_path_from_app_handle(app_handle)?;
        let storage = Self { database_path };
        storage.migrate()?;

        Ok(storage)
    }

    pub fn clear_local_database(app_handle: &tauri::AppHandle) -> Result<(), String> {
        let database_path = Self::database_path_from_app_handle(app_handle)?;
        remove_sqlite_database_files(&database_path)
    }

    fn database_path_from_app_handle(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("本地数据目录初始化失败：{error}"))?;

        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("本地数据目录创建失败：{error}"))?;
        remove_legacy_sqlite_database_files(&data_dir)?;

        Ok(data_dir.join("gsat.sqlite3"))
    }

    pub fn upsert_github_account(&self, user: &GitHubUser) -> Result<(), String> {
        let sql = format!(
            r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, avatar_url, token_ref, connection_status, updated_at)
VALUES ({id}, {login}, {avatar_url}, 'macos-keychain:github-pat', 'connected', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  login = excluded.login,
  avatar_url = excluded.avatar_url,
  token_ref = excluded.token_ref,
  connection_status = 'connected',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
            id = sql_text(&user.id.to_string()),
            login = sql_text(&user.login),
            avatar_url = sql_optional_text(user.avatar_url.as_deref()),
        );

        self.execute_sql(&sql)
    }

    pub fn mark_github_accounts_disconnected(&self) -> Result<(), String> {
        self.execute_sql(
            r#"
UPDATE github_accounts
SET connection_status = 'disconnected',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE connection_status = 'connected';
"#,
        )
    }

    pub fn get_recent_github_account(&self) -> Result<Option<GitHubUser>, String> {
        let sql = r#"
.mode json
SELECT id, login, avatar_url
FROM github_accounts
WHERE connection_status = 'connected'
ORDER BY updated_at DESC
LIMIT 1;
"#;
        let mut rows = parse_json_rows::<GitHubAccountRow>(
            &self.query_sql(sql)?,
            "SQLite GitHub 账号解析失败",
        )?;
        let Some(row) = rows.pop() else {
            return Ok(None);
        };
        let id = row
            .id
            .parse::<u64>()
            .map_err(|_| "SQLite GitHub 账号 ID 解析失败".to_owned())?;

        Ok(Some(GitHubUser {
            id,
            login: row.login.clone(),
            name: None,
            avatar_url: row.avatar_url,
            html_url: format!("https://github.com/{}", row.login),
        }))
    }

    pub fn upsert_repositories(&self, repositories: &[StarredRepository]) -> Result<(), String> {
        if repositories.is_empty() {
            return Ok(());
        }

        let mut sql = String::from("PRAGMA foreign_keys = ON;\nBEGIN;\n");

        for repository in repositories {
            sql.push_str(&format!(
                r#"
INSERT INTO repositories (
  id,
  account_id,
  owner,
  name,
  full_name,
  description,
  language,
  topics_json,
  html_url,
  stars_count,
  forks_count,
  starred_at,
  pushed_at,
  sync_status,
  updated_at
)
VALUES ({id}, {account_id}, {owner}, {name}, {full_name}, {description}, {language}, {topics_json}, {html_url}, {stars_count}, {forks_count}, {starred_at}, {pushed_at}, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  account_id = excluded.account_id,
  owner = excluded.owner,
  name = excluded.name,
  full_name = excluded.full_name,
  description = excluded.description,
  language = excluded.language,
  topics_json = excluded.topics_json,
  html_url = excluded.html_url,
  stars_count = excluded.stars_count,
  forks_count = excluded.forks_count,
  starred_at = excluded.starred_at,
  pushed_at = excluded.pushed_at,
  sync_status = 'active',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
ON CONFLICT(account_id, full_name) DO UPDATE SET
  owner = excluded.owner,
  name = excluded.name,
  description = excluded.description,
  language = excluded.language,
  topics_json = excluded.topics_json,
  html_url = excluded.html_url,
  stars_count = excluded.stars_count,
  forks_count = excluded.forks_count,
  starred_at = excluded.starred_at,
  pushed_at = excluded.pushed_at,
  sync_status = 'active',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT OR IGNORE INTO annotations (repo_id, account_id)
SELECT id, account_id
FROM repositories
WHERE account_id = {account_id}
  AND full_name = {full_name};
"#,
                id = sql_text(&repository.id),
                account_id = sql_text(&repository.account_id),
                owner = sql_text(&repository.owner),
                name = sql_text(&repository.name),
                full_name = sql_text(&repository.full_name),
                description = sql_optional_text(repository.description.as_deref()),
                language = sql_optional_text(repository.language.as_deref()),
                topics_json = sql_text(&repository.topics_json),
                html_url = sql_text(&repository.html_url),
                stars_count = repository.stars_count,
                forks_count = repository.forks_count,
                starred_at = sql_text(&repository.starred_at),
                pushed_at = sql_optional_text(repository.pushed_at.as_deref()),
            ));
        }

        sql.push_str("COMMIT;\n");
        self.execute_sql(&sql)
    }

    pub fn list_active_repositories(
        &self,
        account_id: Option<&str>,
    ) -> Result<Vec<StoredRepository>, String> {
        let account_clause = account_id
            .map(|value| format!("AND account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let sql = format!(
            r#"
.mode json
SELECT id, full_name
FROM repositories
WHERE sync_status = 'active'
  {account_clause}
ORDER BY starred_at DESC;
"#,
            account_clause = account_clause,
        );
        parse_json_rows::<StoredRepository>(&self.query_sql(&sql)?, "SQLite 活跃仓库列表解析失败")
    }

    pub fn get_readme_hash(&self, repo_id: &str) -> Result<Option<String>, String> {
        let sql = format!(
            r#"
.mode list
SELECT content_hash
FROM repo_readmes
WHERE repo_id = {repo_id}
LIMIT 1;
"#,
            repo_id = sql_text(repo_id),
        );
        let output = self.query_sql(&sql)?;
        let value = output.trim();

        Ok((!value.is_empty()).then(|| value.to_owned()))
    }

    pub fn get_ai_document_source_hash(&self, repo_id: &str) -> Result<Option<String>, String> {
        let sql = format!(
            r#"
.mode list
SELECT source_hash
FROM repo_ai_documents
WHERE repo_id = {repo_id}
LIMIT 1;
"#,
            repo_id = sql_text(repo_id),
        );
        let output = self.query_sql(&sql)?;
        let value = output.trim();

        Ok((!value.is_empty()).then(|| value.to_owned()))
    }

    pub fn save_readme(&self, readme: &ReadmeDocument) -> Result<(), String> {
        let sql = format!(
            r#"
PRAGMA foreign_keys = ON;
INSERT INTO repo_readmes (repo_id, raw_markdown, content_hash, source_path, fetched_at)
VALUES ({repo_id}, {raw_markdown}, {content_hash}, {source_path}, {fetched_at})
ON CONFLICT(repo_id) DO UPDATE SET
  raw_markdown = excluded.raw_markdown,
  content_hash = excluded.content_hash,
  source_path = excluded.source_path,
  fetched_at = excluded.fetched_at;
"#,
            repo_id = sql_text(&readme.repo_id),
            raw_markdown = sql_text(&readme.raw_markdown),
            content_hash = sql_text(&readme.content_hash),
            source_path = sql_text(&readme.source_path),
            fetched_at = sql_text(&readme.fetched_at),
        );

        self.execute_sql(&sql)
    }

    pub fn get_github_ranking_cache(
        &self,
        cache_key: &str,
    ) -> Result<Option<GithubRankingCacheEntry>, String> {
        let normalized_cache_key =
            normalize_required_text(cache_key, "GitHub 排行榜缓存键不能为空")?;
        let sql = format!(
            r#"
.mode json
SELECT payload_json, fetched_at
FROM github_ranking_cache
WHERE cache_key = {cache_key}
LIMIT 1;
"#,
            cache_key = sql_text(&normalized_cache_key),
        );
        let mut rows = parse_json_rows::<GithubRankingCacheRow>(
            &self.query_sql(&sql)?,
            "SQLite GitHub 排行榜缓存解析失败",
        )?;

        Ok(rows.pop().map(|row| GithubRankingCacheEntry {
            payload_json: row.payload_json,
            fetched_at: row.fetched_at,
        }))
    }

    pub fn save_github_ranking_cache(
        &self,
        cache_key: &str,
        payload_json: &str,
        fetched_at: i64,
    ) -> Result<(), String> {
        let normalized_cache_key =
            normalize_required_text(cache_key, "GitHub 排行榜缓存键不能为空")?;
        let normalized_payload =
            normalize_required_text(payload_json, "GitHub 排行榜缓存内容不能为空")?;
        let sql = format!(
            r#"
INSERT INTO github_ranking_cache (cache_key, payload_json, fetched_at)
VALUES ({cache_key}, {payload_json}, {fetched_at})
ON CONFLICT(cache_key) DO UPDATE SET
  payload_json = excluded.payload_json,
  fetched_at = excluded.fetched_at;
"#,
            cache_key = sql_text(&normalized_cache_key),
            payload_json = sql_text(&normalized_payload),
            fetched_at = fetched_at,
        );
        self.execute_sql(&sql)
    }

    pub fn list_repository_page(
        &self,
        limit: usize,
        offset: usize,
        filters: RepositoryListFilters<'_>,
    ) -> Result<RepositoryListPage, String> {
        self.list_repository_page_with_order(
            limit,
            offset,
            filters,
            "r.starred_at DESC, r.full_name COLLATE NOCASE ASC",
        )
    }

    pub fn list_personal_ranking_page(
        &self,
        limit: usize,
        offset: usize,
        account_id: &str,
        language: Option<&str>,
        kind: &str,
    ) -> Result<RepositoryListPage, String> {
        let order_clause = personal_ranking_order_clause(kind)?;
        self.list_repository_page_with_order(
            limit,
            offset,
            RepositoryListFilters {
                account_id: Some(account_id),
                keyword: None,
                language,
                tag_id: None,
            },
            order_clause,
        )
    }

    fn list_repository_page_with_order(
        &self,
        limit: usize,
        offset: usize,
        filters: RepositoryListFilters<'_>,
        order_clause: &str,
    ) -> Result<RepositoryListPage, String> {
        let normalized_limit = limit.clamp(1, 5000);
        let where_clause = build_repository_filter_clause(&filters);
        let total_count = self.count_active_repositories(&where_clause)?;
        let sql = format!(
            r#"
.mode json
SELECT
  r.id,
  r.account_id,
  r.owner,
  r.name,
  r.full_name,
  r.description,
  r.language,
  r.topics_json,
  r.html_url,
	  r.stars_count,
	  r.forks_count,
	  r.starred_at,
	  r.pushed_at,
	  CASE WHEN rr.repo_id IS NULL THEN 0 ELSE 1 END AS has_readme,
	  ai.summary_zh AS ai_summary,
	  ai.keywords_json AS ai_keywords_json,
	  ai.suggested_tags_json,
	  COALESCE((SELECT json_group_array(tag_id) FROM (SELECT rt_list.tag_id AS tag_id FROM repo_tags rt_list JOIN tags t_list ON t_list.id = rt_list.tag_id AND t_list.account_id = r.account_id WHERE rt_list.repo_id = r.id ORDER BY t_list.name COLLATE NOCASE ASC)), '[]') AS tag_ids_json,
	  COALESCE((SELECT json_group_array(tag_name) FROM (SELECT t_list.name AS tag_name FROM repo_tags rt_list JOIN tags t_list ON t_list.id = rt_list.tag_id AND t_list.account_id = r.account_id WHERE rt_list.repo_id = r.id ORDER BY t_list.name COLLATE NOCASE ASC)), '[]') AS tag_names_json,
	  ai.generated_at AS ai_generated_at
	FROM repositories r
	LEFT JOIN repo_readmes rr ON rr.repo_id = r.id
	LEFT JOIN repo_ai_documents ai ON ai.repo_id = r.id
		LEFT JOIN annotations a ON a.repo_id = r.id AND a.account_id = r.account_id
	WHERE {where_clause}
	ORDER BY {order_clause}
LIMIT {limit} OFFSET {offset};
"#,
            where_clause = where_clause,
            order_clause = order_clause,
            limit = normalized_limit,
            offset = offset,
        );
        let rows = parse_json_rows::<RepositoryListRow>(
            &self.query_sql(&sql)?,
            "SQLite 仓库列表解析失败",
        )?;
        let items = rows
            .into_iter()
            .map(RepositoryListItem::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(RepositoryListPage {
            items,
            total_count,
            limit: normalized_limit,
            offset,
        })
    }

    pub fn list_repository_languages(
        &self,
        account_id: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let account_clause = account_id
            .map(|value| format!("AND account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let sql = format!(
            r#"
.mode json
SELECT DISTINCT language
FROM repositories
WHERE sync_status = 'active'
  {account_clause}
  AND language IS NOT NULL
  AND TRIM(language) != ''
ORDER BY language COLLATE NOCASE ASC;
"#,
            account_clause = account_clause,
        );
        let rows = parse_json_rows::<RepositoryLanguageRow>(
            &self.query_sql(&sql)?,
            "SQLite 语言列表解析失败",
        )?;

        Ok(rows.into_iter().map(|row| row.language).collect())
    }

    pub fn get_repository_detail(
        &self,
        repository_id: &str,
        account_id: &str,
    ) -> Result<RepositoryDetailView, String> {
        self.ensure_repository_belongs_to_account(repository_id, account_id)?;

        Ok(RepositoryDetailView {
            repository_id: repository_id.to_owned(),
            account_id: account_id.to_owned(),
            readme: self.get_repository_readme(repository_id)?,
            ai_document: self.get_repository_ai_document(repository_id)?,
        })
    }

    pub fn get_repository_ai_source(
        &self,
        repository_id: &str,
        account_id: Option<&str>,
    ) -> Result<RepositoryAiSource, String> {
        let account_clause = account_id
            .map(|value| format!("AND account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let sql = format!(
            r#"
.mode json
SELECT id, account_id, full_name, description
FROM repositories
WHERE id = {repository_id}
  AND sync_status = 'active'
  {account_clause}
LIMIT 1;
"#,
            repository_id = sql_text(repository_id),
            account_clause = account_clause,
        );
        let mut rows = parse_json_rows::<RepositoryAiSourceRow>(
            &self.query_sql(&sql)?,
            "SQLite AI 仓库信息解析失败",
        )?;
        let row = rows
            .pop()
            .ok_or_else(|| "仓库不存在或账号不匹配".to_owned())?;
        let readme = self.get_repository_readme(repository_id)?;

        Ok(RepositoryAiSource {
            id: row.id,
            account_id: row.account_id,
            full_name: row.full_name,
            description: row.description,
            readme,
        })
    }

    pub fn list_repository_tagging_sources(
        &self,
        account_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<RepositoryTaggingSource>, String> {
        let limit_clause = limit
            .map(|value| format!("LIMIT {}", value.clamp(1, 1000)))
            .unwrap_or_default();
        let sql = format!(
            r#"
.mode json
SELECT
  r.full_name,
  r.description,
  r.language,
  r.topics_json,
  r.stars_count,
  ai.summary_zh AS ai_summary,
  ai.suggested_tags_json
FROM repositories r
LEFT JOIN repo_ai_documents ai ON ai.repo_id = r.id
WHERE r.account_id = {account_id}
  AND r.sync_status = 'active'
ORDER BY r.stars_count DESC, r.starred_at DESC
{limit_clause};
"#,
            account_id = sql_text(account_id),
            limit_clause = limit_clause,
        );
        let rows = parse_json_rows::<RepositoryTaggingSourceRow>(
            &self.query_sql(&sql)?,
            "SQLite AI 标签网络仓库数据解析失败",
        )?;

        rows.into_iter()
            .map(|row| {
                Ok(RepositoryTaggingSource {
                    full_name: row.full_name,
                    description: row.description,
                    language: row.language,
                    topics: serde_json::from_str::<Vec<String>>(&row.topics_json)
                        .map_err(|error| format!("SQLite topics_json 解析失败：{error}"))?,
                    ai_summary: row.ai_summary,
                    suggested_tags: parse_optional_json_array(row.suggested_tags_json.as_deref())?,
                    stars_count: row.stars_count,
                })
            })
            .collect()
    }

    pub fn list_repository_tagging_sources_by_ids(
        &self,
        account_id: &str,
        repository_ids: &[String],
    ) -> Result<Vec<RepositoryTaggingSource>, String> {
        if repository_ids.is_empty() {
            return Ok(Vec::new());
        }

        let repository_id_list = repository_ids
            .iter()
            .map(|repository_id| sql_text(repository_id))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
.mode json
SELECT
  r.full_name,
  r.description,
  r.language,
  r.topics_json,
  r.stars_count,
  ai.summary_zh AS ai_summary,
  ai.suggested_tags_json
FROM repositories r
LEFT JOIN repo_ai_documents ai ON ai.repo_id = r.id
WHERE r.account_id = {account_id}
  AND r.sync_status = 'active'
  AND r.id IN ({repository_id_list})
ORDER BY r.stars_count DESC, r.starred_at DESC;
"#,
            account_id = sql_text(account_id),
            repository_id_list = repository_id_list,
        );
        let rows = parse_json_rows::<RepositoryTaggingSourceRow>(
            &self.query_sql(&sql)?,
            "SQLite AI 推荐仓库数据解析失败",
        )?;

        rows.into_iter()
            .map(|row| {
                Ok(RepositoryTaggingSource {
                    full_name: row.full_name,
                    description: row.description,
                    language: row.language,
                    topics: serde_json::from_str::<Vec<String>>(&row.topics_json)
                        .map_err(|error| format!("SQLite topics_json 解析失败：{error}"))?,
                    ai_summary: row.ai_summary,
                    suggested_tags: parse_optional_json_array(row.suggested_tags_json.as_deref())?,
                    stars_count: row.stars_count,
                })
            })
            .collect()
    }

    pub fn list_active_repository_full_names(
        &self,
        account_id: &str,
    ) -> Result<HashSet<String>, String> {
        let sql = format!(
            r#"
.mode list
SELECT full_name
FROM repositories
WHERE account_id = {account_id}
  AND sync_status = 'active';
"#,
            account_id = sql_text(account_id),
        );

        Ok(self
            .query_sql(&sql)?
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect())
    }

    pub fn replace_github_recommendation_candidates(
        &self,
        account_id: &str,
        rationale_zh: &str,
        queries: &[String],
        repositories: &[GitHubRepositoryRecommendation],
    ) -> Result<HashMap<String, GithubRecommendationCandidateState>, String> {
        let queries_json = serde_json::to_string(queries)
            .map_err(|error| format!("GitHub 推荐搜索式序列化失败：{error}"))?;
        let mut sql = String::from("PRAGMA foreign_keys = ON;\nBEGIN;\n");
        for repository in repositories {
            let normalized_full_name =
                normalize_required_text(&repository.full_name, "GitHub 推荐候选仓库名称不能为空")?;
            let candidate_id = next_local_id("gh_candidate")?;
            let topics_json = serde_json::to_string(&repository.topics)
                .map_err(|error| format!("GitHub 推荐 Topics 序列化失败：{error}"))?;
            sql.push_str(&format!(
                r#"
INSERT INTO github_recommendation_candidates (
  id,
  account_id,
  full_name,
  description,
  language,
  topics_json,
  html_url,
  stars_count,
  forks_count,
  pushed_at,
  status,
  rationale_zh,
  queries_json,
  last_seen_at,
  updated_at
) VALUES (
  {id},
  {account_id},
  {full_name},
  {description},
  {language},
  {topics_json},
  {html_url},
  {stars_count},
  {forks_count},
  {pushed_at},
  'new',
  {rationale_zh},
  {queries_json},
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(account_id, full_name) DO UPDATE SET
  description = excluded.description,
  language = excluded.language,
  topics_json = excluded.topics_json,
  html_url = excluded.html_url,
  stars_count = excluded.stars_count,
  forks_count = excluded.forks_count,
  pushed_at = excluded.pushed_at,
  status = github_recommendation_candidates.status,
  rationale_zh = excluded.rationale_zh,
  queries_json = excluded.queries_json,
  last_seen_at = excluded.last_seen_at,
  updated_at = excluded.updated_at;
"#,
                id = sql_text(&candidate_id),
                account_id = sql_text(account_id),
                full_name = sql_text(&normalized_full_name),
                description = sql_optional_text(repository.description.as_deref()),
                language = sql_optional_text(repository.language.as_deref()),
                topics_json = sql_text(&topics_json),
                html_url = sql_text(&repository.html_url),
                stars_count = repository.stars_count,
                forks_count = repository.forks_count,
                pushed_at = sql_optional_text(repository.pushed_at.as_deref()),
                rationale_zh = sql_text(rationale_zh),
                queries_json = sql_text(&queries_json),
            ));
        }
        let retained_full_names = repositories
            .iter()
            .map(|repository| sql_text(repository.full_name.trim()))
            .collect::<Vec<_>>();
        let replacement_clause = if retained_full_names.is_empty() {
            String::new()
        } else {
            format!("AND full_name NOT IN ({})", retained_full_names.join(", "))
        };
        sql.push_str(&format!(
            r#"
DELETE FROM github_recommendation_documents
WHERE account_id = {account_id}
  AND full_name IN (
    SELECT full_name
    FROM github_recommendation_candidates
    WHERE account_id = {account_id}
      {replacement_clause}
  );

DELETE FROM github_recommendation_candidates
WHERE account_id = {account_id}
  {replacement_clause};
"#,
            account_id = sql_text(account_id),
            replacement_clause = replacement_clause,
        ));
        sql.push_str("COMMIT;\n");
        self.execute_sql(&sql)?;
        self.list_github_recommendation_candidate_states(
            account_id,
            &repositories
                .iter()
                .map(|repository| repository.full_name.clone())
                .collect::<Vec<_>>(),
        )
    }

    pub fn list_github_recommendation_candidate_states(
        &self,
        account_id: &str,
        full_names: &[String],
    ) -> Result<HashMap<String, GithubRecommendationCandidateState>, String> {
        if full_names.is_empty() {
            return Ok(HashMap::new());
        }

        let full_name_list = full_names
            .iter()
            .map(|full_name| sql_text(full_name))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
.mode json
SELECT id, full_name, status
FROM github_recommendation_candidates
WHERE account_id = {account_id}
  AND full_name IN ({full_name_list});
"#,
            account_id = sql_text(account_id),
            full_name_list = full_name_list,
        );
        let rows = parse_json_rows::<RecommendationCandidateRow>(
            &self.query_sql(&sql)?,
            "SQLite GitHub 推荐候选状态解析失败",
        )?;

        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    row.full_name.clone(),
                    GithubRecommendationCandidateState {
                        id: row.id,
                        full_name: row.full_name,
                        status: row.status,
                    },
                )
            })
            .collect())
    }

    pub fn get_github_recommendation_readme(
        &self,
        account_id: &str,
        full_name: &str,
    ) -> Result<Option<ReadmeDocument>, String> {
        let normalized_full_name =
            normalize_required_text(full_name, "GitHub 推荐候选仓库名称不能为空")?;
        let sql = format!(
            r#"
.mode json
SELECT raw_markdown, content_hash, source_path, fetched_at
FROM github_recommendation_documents
WHERE account_id = {account_id}
  AND full_name = {full_name}
LIMIT 1;
"#,
            account_id = sql_text(account_id),
            full_name = sql_text(&normalized_full_name),
        );
        let mut rows = parse_json_rows::<RepositoryReadmeRow>(
            &self.query_sql(&sql)?,
            "SQLite 推荐 README 缓存解析失败",
        )?;

        Ok(rows.pop().map(|row| ReadmeDocument {
            repo_id: normalized_full_name,
            raw_markdown: row.raw_markdown,
            content_hash: row.content_hash,
            source_path: row.source_path,
            fetched_at: row.fetched_at,
        }))
    }

    pub fn save_github_recommendation_readme(
        &self,
        account_id: &str,
        full_name: &str,
        readme: &ReadmeDocument,
    ) -> Result<(), String> {
        let normalized_full_name =
            normalize_required_text(full_name, "GitHub 推荐候选仓库名称不能为空")?;
        let sql = format!(
            r#"
INSERT INTO github_recommendation_documents (
  account_id,
  full_name,
  raw_markdown,
  content_hash,
  source_path,
  fetched_at,
  updated_at
) VALUES (
  {account_id},
  {full_name},
  {raw_markdown},
  {content_hash},
  {source_path},
  {fetched_at},
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(account_id, full_name) DO UPDATE SET
  raw_markdown = excluded.raw_markdown,
  content_hash = excluded.content_hash,
  source_path = excluded.source_path,
  fetched_at = excluded.fetched_at,
  translation_markdown_zh = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_markdown_zh END,
  translation_model = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_model END,
  translation_input_tokens = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_input_tokens END,
  translation_output_tokens = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_output_tokens END,
  translation_source_char_count = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_source_char_count END,
  translation_translated_char_count = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_translated_char_count END,
  translation_is_truncated = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_is_truncated END,
  translation_source_hash = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_source_hash END,
  translation_generated_at = CASE WHEN github_recommendation_documents.translation_source_hash = excluded.content_hash THEN github_recommendation_documents.translation_generated_at END,
  updated_at = excluded.updated_at;
"#,
            account_id = sql_text(account_id),
            full_name = sql_text(&normalized_full_name),
            raw_markdown = sql_text(&readme.raw_markdown),
            content_hash = sql_text(&readme.content_hash),
            source_path = sql_text(&readme.source_path),
            fetched_at = sql_text(&readme.fetched_at),
        );
        self.execute_sql(&sql)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_github_recommendation_translation(
        &self,
        account_id: &str,
        full_name: &str,
        source_hash: &str,
        markdown_zh: &str,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
        source_char_count: usize,
        translated_char_count: usize,
        is_truncated: bool,
    ) -> Result<(), String> {
        let normalized_full_name =
            normalize_required_text(full_name, "GitHub 推荐候选仓库名称不能为空")?;
        let sql = format!(
            r#"
UPDATE github_recommendation_documents
SET translation_markdown_zh = {markdown_zh},
    translation_model = {model},
    translation_input_tokens = {input_tokens},
    translation_output_tokens = {output_tokens},
    translation_source_char_count = {source_char_count},
    translation_translated_char_count = {translated_char_count},
    translation_is_truncated = {is_truncated},
    translation_source_hash = {source_hash},
    translation_generated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE account_id = {account_id}
  AND full_name = {full_name}
  AND content_hash = {source_hash};
"#,
            markdown_zh = sql_text(markdown_zh),
            model = sql_text(model),
            input_tokens = input_tokens,
            output_tokens = output_tokens,
            source_char_count = source_char_count,
            translated_char_count = translated_char_count,
            is_truncated = u8::from(is_truncated),
            source_hash = sql_text(source_hash),
            account_id = sql_text(account_id),
            full_name = sql_text(&normalized_full_name),
        );
        self.execute_sql(&sql)?;
        if self
            .get_github_recommendation_translation(account_id, &normalized_full_name, source_hash)?
            .is_none()
        {
            return Err("项目 README 已更新，请重新打开项目介绍后再翻译。".to_owned());
        }
        Ok(())
    }

    pub fn get_github_recommendation_translation(
        &self,
        account_id: &str,
        full_name: &str,
        source_hash: &str,
    ) -> Result<Option<GithubRecommendationCachedTranslation>, String> {
        let normalized_full_name =
            normalize_required_text(full_name, "GitHub 推荐候选仓库名称不能为空")?;
        let sql = format!(
            r#"
.mode json
SELECT
  translation_markdown_zh AS markdown_zh,
  translation_model AS model,
  translation_input_tokens AS input_tokens,
  translation_output_tokens AS output_tokens,
  translation_source_char_count AS source_char_count,
  translation_translated_char_count AS translated_char_count,
  translation_is_truncated AS is_truncated
FROM github_recommendation_documents
WHERE account_id = {account_id}
  AND full_name = {full_name}
  AND translation_source_hash = {source_hash}
  AND translation_markdown_zh IS NOT NULL
LIMIT 1;
"#,
            account_id = sql_text(account_id),
            full_name = sql_text(&normalized_full_name),
            source_hash = sql_text(source_hash),
        );
        let mut rows = parse_json_rows::<GithubRecommendationTranslationRow>(
            &self.query_sql(&sql)?,
            "SQLite 推荐 README 翻译缓存解析失败",
        )?;

        Ok(rows.pop().map(|row| GithubRecommendationCachedTranslation {
            markdown_zh: row.markdown_zh,
            model: row.model,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            source_char_count: row.source_char_count,
            translated_char_count: row.translated_char_count,
            is_truncated: row.is_truncated != 0,
        }))
    }

    pub fn list_github_recommendation_candidates(
        &self,
        account_id: &str,
        status: Option<&str>,
        category: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<GithubRecommendationCandidateList, String> {
        let status_clause = match normalize_optional_text(status) {
            Some(status) => format!(
                "AND c.status = {}",
                sql_text(normalize_recommendation_candidate_status(status)?)
            ),
            None => String::new(),
        };
        let category_expression = recommendation_category_sql_expression("c");
        let category_clause = match normalize_optional_text(category) {
            Some(category) => format!(
                "AND ({category_expression}) = {}",
                sql_text(normalize_recommendation_category(category)?)
            ),
            None => String::new(),
        };
        let limit = limit.clamp(1, 50);
        let category_count_sql = format!(
            r#"
.mode json
SELECT candidate_category, COUNT(*) AS count
FROM (
  SELECT {category_expression} AS candidate_category
  FROM github_recommendation_candidates c
  WHERE c.account_id = {account_id}
    {status_clause}
)
GROUP BY candidate_category;
"#,
            category_expression = category_expression,
            account_id = sql_text(account_id),
            status_clause = status_clause,
        );
        let category_count_rows = parse_json_rows::<RecommendationCategoryCountRow>(
            &self.query_sql(&category_count_sql)?,
            "SQLite GitHub 推荐候选类型统计解析失败",
        )?;
        let category_count_map = category_count_rows
            .into_iter()
            .map(|row| (row.candidate_category, row.count))
            .collect::<HashMap<_, _>>();
        let categories = RECOMMENDATION_CATEGORY_OPTIONS
            .iter()
            .map(|(value, label)| GithubRecommendationCategoryCount {
                value: (*value).to_owned(),
                label: (*label).to_owned(),
                count: category_count_map.get(*value).copied().unwrap_or_default(),
            })
            .collect::<Vec<_>>();
        let count_sql = format!(
            r#"
.mode list
SELECT COUNT(*)
FROM github_recommendation_candidates c
WHERE c.account_id = {account_id}
  {status_clause}
  {category_clause};
"#,
            account_id = sql_text(account_id),
            status_clause = status_clause,
            category_clause = category_clause,
        );
        let total_count = self
            .query_sql(&count_sql)?
            .trim()
            .parse::<usize>()
            .map_err(|error| format!("SQLite GitHub 推荐候选总数解析失败：{error}"))?;
        let sql = format!(
            r#"
.mode json
SELECT
  id,
  full_name,
  description,
  language,
  topics_json,
  html_url,
  stars_count,
  forks_count,
  pushed_at,
  status,
  updated_at,
  rationale_zh,
  queries_json,
  {category_expression} AS candidate_category
FROM github_recommendation_candidates c
WHERE c.account_id = {account_id}
  {status_clause}
  {category_clause}
ORDER BY
  CASE status
    WHEN 'marked' THEN 0
    WHEN 'new' THEN 1
    WHEN 'starred' THEN 2
    ELSE 3
  END,
  last_seen_at DESC,
  updated_at DESC
LIMIT {limit}
OFFSET {offset};
"#,
            account_id = sql_text(account_id),
            status_clause = status_clause,
            category_clause = category_clause,
            category_expression = category_expression,
            limit = limit,
            offset = offset,
        );
        let rows = parse_json_rows::<RecommendationCandidateDetailRow>(
            &self.query_sql(&sql)?,
            "SQLite GitHub 推荐候选列表解析失败",
        )?;
        let mut rationale_zh = String::new();
        let mut queries = Vec::new();
        let mut repositories = Vec::new();

        for row in rows {
            if rationale_zh.is_empty() {
                rationale_zh = row.rationale_zh.clone().unwrap_or_default();
            }
            for query in
                parse_json_string_array(&row.queries_json, "SQLite GitHub 推荐搜索式解析失败")?
            {
                push_unique(&mut queries, &query);
            }
            let topics = serde_json::from_str::<Vec<String>>(&row.topics_json)
                .map_err(|error| format!("SQLite GitHub 推荐 Topics 解析失败：{error}"))?;
            repositories.push(GitHubRepositoryRecommendation {
                candidate_id: Some(row.id),
                candidate_status: Some(row.status),
                candidate_updated_at: Some(row.updated_at),
                candidate_category: Some(row.candidate_category),
                full_name: row.full_name,
                description: row.description,
                language: row.language,
                topics,
                html_url: row.html_url,
                stars_count: row.stars_count,
                forks_count: row.forks_count,
                pushed_at: row.pushed_at,
            });
        }

        if rationale_zh.is_empty() && !repositories.is_empty() {
            rationale_zh = "已从本地恢复最近发现的 GitHub 相似项目。".to_owned();
        }

        Ok(GithubRecommendationCandidateList {
            rationale_zh,
            queries,
            repositories,
            total_count,
            limit,
            offset,
            categories,
        })
    }

    pub fn update_github_recommendation_candidate_status(
        &self,
        account_id: &str,
        full_name: &str,
        status: &str,
    ) -> Result<GithubRecommendationCandidateState, String> {
        let normalized_status = normalize_recommendation_candidate_status(status)?;
        let normalized_full_name =
            normalize_required_text(full_name, "GitHub 推荐候选仓库名称不能为空")?;
        let sql = format!(
            r#"
UPDATE github_recommendation_candidates
SET status = {status},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE account_id = {account_id}
  AND full_name = {full_name};
"#,
            status = sql_text(normalized_status),
            account_id = sql_text(account_id),
            full_name = sql_text(&normalized_full_name),
        );
        self.execute_sql(&sql)?;
        self.list_github_recommendation_candidate_states(
            account_id,
            std::slice::from_ref(&normalized_full_name),
        )?
        .remove(&normalized_full_name)
        .ok_or_else(|| "推荐候选项目不存在，请重新发现后再操作。".to_owned())
    }

    pub fn list_tags(&self, account_id: &str) -> Result<Vec<TagItem>, String> {
        let sql = format!(
            r#"
.mode json
SELECT id, account_id AS accountId, name, color, created_at AS createdAt, updated_at AS updatedAt
FROM tags
WHERE account_id = {account_id}
ORDER BY name COLLATE NOCASE ASC;
"#,
            account_id = sql_text(account_id),
        );

        parse_json_rows(&self.query_sql(&sql)?, "SQLite 标签列表解析失败")
    }

    pub fn create_tag(
        &self,
        account_id: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<TagItem, String> {
        let normalized_name = normalize_required_text(name, "标签名称不能为空")?;
        let id = next_local_id("tag")?;
        let sql = format!(
            r#"
	PRAGMA foreign_keys = ON;
	INSERT INTO tags (id, account_id, name, color, updated_at)
	VALUES ({id}, {account_id}, {name}, {color}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	ON CONFLICT(account_id, name) DO UPDATE SET
	  color = COALESCE(excluded.color, tags.color),
	  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
	"#,
            id = sql_text(&id),
            account_id = sql_text(account_id),
            name = sql_text(&normalized_name),
            color = sql_optional_text(color),
        );

        self.execute_sql(&sql)?;
        self.get_tag_by_name(account_id, &normalized_name)
    }

    pub fn update_tag(
        &self,
        account_id: &str,
        tag_id: &str,
        name: &str,
        color: Option<&str>,
    ) -> Result<TagItem, String> {
        let normalized_name = normalize_required_text(name, "标签名称不能为空")?;
        let sql = format!(
            r#"
UPDATE tags
SET name = {name},
    color = {color},
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = {tag_id} AND account_id = {account_id};
"#,
            name = sql_text(&normalized_name),
            color = sql_optional_text(color),
            tag_id = sql_text(tag_id),
            account_id = sql_text(account_id),
        );

        self.execute_sql(&sql)?;
        self.get_tag(account_id, tag_id)
    }

    pub fn delete_tag(&self, account_id: &str, tag_id: &str) -> Result<(), String> {
        let sql = format!(
            r#"
PRAGMA foreign_keys = ON;
DELETE FROM tags
WHERE id = {tag_id} AND account_id = {account_id};
"#,
            tag_id = sql_text(tag_id),
            account_id = sql_text(account_id),
        );

        self.execute_sql(&sql)
    }

    pub fn get_repository_annotation(
        &self,
        repository_id: &str,
        account_id: &str,
    ) -> Result<RepositoryAnnotationView, String> {
        self.ensure_repository_annotation(repository_id, account_id)?;

        let annotation_sql = format!(
            r#"
.mode json
SELECT
  repo_id AS repository_id,
  account_id,
  note_md AS note_markdown,
  read_status AS reading_status,
  updated_at
FROM annotations
WHERE repo_id = {repository_id} AND account_id = {account_id}
LIMIT 1;
"#,
            repository_id = sql_text(repository_id),
            account_id = sql_text(account_id),
        );
        let mut rows = parse_json_rows::<AnnotationRow>(
            &self.query_sql(&annotation_sql)?,
            "SQLite 仓库注解解析失败",
        )?;
        let row = rows
            .pop()
            .ok_or_else(|| "仓库注解不存在或账号不匹配".to_owned())?;

        Ok(RepositoryAnnotationView {
            repository_id: row.repository_id,
            account_id: row.account_id,
            note_markdown: row.note_markdown,
            reading_status: row.reading_status,
            tags: self.list_repository_tags(repository_id, account_id)?,
            updated_at: row.updated_at,
        })
    }

    pub fn save_repository_annotation(
        &self,
        repository_id: &str,
        account_id: &str,
        note_markdown: &str,
        reading_status: &str,
    ) -> Result<RepositoryAnnotationView, String> {
        let normalized_status = normalize_reading_status(reading_status)?;
        let sql = format!(
            r#"
PRAGMA foreign_keys = ON;
INSERT INTO annotations (repo_id, account_id, note_md, read_status, updated_at)
SELECT id, account_id, {note_markdown}, {reading_status}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM repositories
WHERE id = {repository_id} AND account_id = {account_id}
ON CONFLICT(repo_id) DO UPDATE SET
  note_md = excluded.note_md,
  read_status = excluded.read_status,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
            note_markdown = sql_text(note_markdown),
            reading_status = sql_text(normalized_status),
            repository_id = sql_text(repository_id),
            account_id = sql_text(account_id),
        );

        self.execute_sql(&sql)?;
        self.get_repository_annotation(repository_id, account_id)
    }

    pub fn set_repository_tags(
        &self,
        repository_id: &str,
        account_id: &str,
        tag_ids: &[String],
    ) -> Result<RepositoryAnnotationView, String> {
        let mut sql = format!(
            r#"
PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM repo_tags
WHERE repo_id = {repository_id}
  AND EXISTS (
    SELECT 1 FROM repositories
    WHERE id = {repository_id} AND account_id = {account_id}
  );
"#,
            repository_id = sql_text(repository_id),
            account_id = sql_text(account_id),
        );

        for tag_id in tag_ids {
            sql.push_str(&format!(
                r#"
INSERT OR IGNORE INTO repo_tags (repo_id, tag_id)
SELECT r.id, t.id
FROM repositories r
JOIN tags t ON t.id = {tag_id} AND t.account_id = r.account_id
WHERE r.id = {repository_id} AND r.account_id = {account_id};
"#,
                tag_id = sql_text(tag_id),
                repository_id = sql_text(repository_id),
                account_id = sql_text(account_id),
            ));
        }

        sql.push_str("COMMIT;\n");
        self.execute_sql(&sql)?;
        self.get_repository_annotation(repository_id, account_id)
    }

    pub fn apply_ai_tag_assignments(
        &self,
        account_id: &str,
        assignments: &[AiTagAssignment],
    ) -> Result<ApplyAiTagAssignmentsSummary, String> {
        let repository_ids_by_full_name = self.list_repository_ids_by_full_name(account_id)?;
        let mut sql = String::from("PRAGMA foreign_keys = ON;\nBEGIN;\n");
        let mut seen_tags = HashSet::new();
        let mut seen_links = HashSet::new();
        let mut skipped_repository_count = 0_usize;

        for assignment in assignments {
            let tag_name = normalize_required_text(&assignment.tag_name, "标签名称不能为空")?;
            let tag_key = tag_name.to_lowercase();
            if seen_tags.contains(&tag_key) {
                continue;
            }

            let mut matched_repository_ids = Vec::new();
            let mut seen_assignment_repository_ids = HashSet::new();
            for full_name in &assignment.repository_full_names {
                let normalized_full_name = normalize_repository_full_name_lookup_key(full_name);
                let Some(repository_id) = repository_ids_by_full_name.get(&normalized_full_name)
                else {
                    skipped_repository_count += 1;
                    continue;
                };
                if seen_assignment_repository_ids.insert(repository_id.clone()) {
                    matched_repository_ids.push(repository_id.clone());
                }
            }
            if matched_repository_ids.is_empty() {
                continue;
            }
            seen_tags.insert(tag_key.clone());

            let tag_id = next_local_id("tag")?;
            sql.push_str(&format!(
                r#"
INSERT INTO tags (id, account_id, name, color, updated_at)
VALUES ({tag_id}, {account_id}, {name}, {color}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(account_id, name) DO UPDATE SET
  color = COALESCE(excluded.color, tags.color),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
                tag_id = sql_text(&tag_id),
                account_id = sql_text(account_id),
                name = sql_text(&tag_name),
                color = sql_optional_text(assignment.color.as_deref()),
            ));

            for repository_id in matched_repository_ids {
                if !seen_links.insert((repository_id.clone(), tag_key.clone())) {
                    continue;
                }

                sql.push_str(&format!(
                    r#"
INSERT OR IGNORE INTO annotations (repo_id, account_id)
VALUES ({repository_id}, {account_id});

INSERT OR IGNORE INTO repo_tags (repo_id, tag_id)
SELECT {repository_id}, t.id
FROM tags t
WHERE t.account_id = {account_id}
  AND t.name = {tag_name};
"#,
                    repository_id = sql_text(&repository_id),
                    account_id = sql_text(account_id),
                    tag_name = sql_text(&tag_name),
                ));
            }
        }

        sql.push_str("COMMIT;\n");
        self.execute_sql(&sql)?;

        Ok(ApplyAiTagAssignmentsSummary {
            tag_count: seen_tags.len(),
            linked_count: seen_links.len(),
            skipped_repository_count,
            failed_batch_count: 0,
            failures: Vec::new(),
        })
    }

    pub fn export_annotation_snapshot(
        &self,
        account_id: &str,
    ) -> Result<AnnotationSnapshot, String> {
        let tags = self
            .list_tags(account_id)?
            .into_iter()
            .map(|tag| AnnotationSnapshotTag {
                name: tag.name,
                color: tag.color,
            })
            .collect::<Vec<_>>();
        let repository_sql = format!(
            r#"
.mode json
SELECT
  r.id AS repository_id,
  r.full_name,
  a.note_md AS note_markdown,
  a.read_status,
  COALESCE(json_group_array(t.name) FILTER (WHERE t.name IS NOT NULL), '[]') AS tag_names_json
FROM annotations a
JOIN repositories r ON r.id = a.repo_id AND r.account_id = a.account_id
LEFT JOIN repo_tags rt ON rt.repo_id = r.id
LEFT JOIN tags t ON t.id = rt.tag_id AND t.account_id = r.account_id
WHERE a.account_id = {account_id}
  AND r.sync_status = 'active'
  AND (a.note_md != '' OR a.read_status != 'unread' OR t.id IS NOT NULL)
GROUP BY r.id, r.full_name, a.note_md, a.read_status
ORDER BY r.full_name COLLATE NOCASE ASC;
"#,
            account_id = sql_text(account_id),
        );
        let rows = parse_json_rows::<AnnotationSnapshotRepositoryRow>(
            &self.query_sql(&repository_sql)?,
            "SQLite 注解快照解析失败",
        )?;
        let repositories = rows
            .into_iter()
            .map(|row| {
                Ok(AnnotationSnapshotRepository {
                    repository_id: row.repository_id,
                    full_name: row.full_name,
                    note_markdown: row.note_markdown,
                    read_status: row.read_status,
                    tag_names: parse_json_string_array(
                        &row.tag_names_json,
                        "SQLite 注解标签快照解析失败",
                    )?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(AnnotationSnapshot {
            schema_version: 1,
            exported_at: self.current_database_timestamp()?,
            account_id: account_id.to_owned(),
            tags,
            repositories,
        })
    }

    pub fn import_annotation_snapshot(
        &self,
        account_id: &str,
        snapshot: &AnnotationSnapshot,
    ) -> Result<AnnotationImportSummary, String> {
        if snapshot.schema_version != 1 {
            return Err("不支持的注解快照版本".to_owned());
        }

        let local_repository_ids = self.list_repository_ids(account_id)?;
        let local_repository_ids_by_full_name =
            self.list_repository_ids_by_full_name(account_id)?;
        let mut sql = String::from("PRAGMA foreign_keys = ON;\nBEGIN;\n");
        let mut imported_repository_count = 0_usize;
        let mut skipped_repository_count = 0_usize;

        for tag in &snapshot.tags {
            let normalized_name = normalize_required_text(&tag.name, "标签名称不能为空")?;
            let tag_id = next_local_id("tag")?;
            sql.push_str(&format!(
                r#"
INSERT INTO tags (id, account_id, name, color, updated_at)
VALUES ({tag_id}, {account_id}, {name}, {color}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(account_id, name) DO UPDATE SET
  color = excluded.color,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
                tag_id = sql_text(&tag_id),
                account_id = sql_text(account_id),
                name = sql_text(&normalized_name),
                color = sql_optional_text(tag.color.as_deref()),
            ));
        }

        for repository in &snapshot.repositories {
            let local_repository_id = match local_repository_ids
                .contains(repository.repository_id.as_str())
                .then(|| repository.repository_id.as_str())
                .or_else(|| {
                    local_repository_ids_by_full_name
                        .get(repository.full_name.as_str())
                        .map(String::as_str)
                }) {
                Some(repository_id) => repository_id,
                None => {
                    skipped_repository_count += 1;
                    continue;
                }
            };

            let read_status = normalize_reading_status(&repository.read_status)?;
            imported_repository_count += 1;
            sql.push_str(&format!(
                r#"
INSERT INTO annotations (repo_id, account_id, note_md, read_status, updated_at)
VALUES ({repository_id}, {account_id}, {note_markdown}, {read_status}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(repo_id) DO UPDATE SET
  note_md = excluded.note_md,
  read_status = excluded.read_status,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

DELETE FROM repo_tags
WHERE repo_id = {repository_id};
"#,
                repository_id = sql_text(local_repository_id),
                account_id = sql_text(account_id),
                note_markdown = sql_text(&repository.note_markdown),
                read_status = sql_text(read_status),
            ));

            for tag_name in &repository.tag_names {
                let normalized_tag_name = normalize_required_text(tag_name, "标签名称不能为空")?;
                sql.push_str(&format!(
                    r#"
INSERT OR IGNORE INTO repo_tags (repo_id, tag_id)
SELECT {repository_id}, t.id
FROM tags t
WHERE t.account_id = {account_id}
  AND t.name = {tag_name};
"#,
                    repository_id = sql_text(local_repository_id),
                    account_id = sql_text(account_id),
                    tag_name = sql_text(&normalized_tag_name),
                ));
            }
        }

        sql.push_str("COMMIT;\n");
        self.execute_sql(&sql)?;

        Ok(AnnotationImportSummary {
            tag_count: snapshot.tags.len(),
            repository_count: imported_repository_count,
            skipped_repository_count,
        })
    }

    pub fn export_repository_library_snapshot(
        &self,
        account_id: &str,
    ) -> Result<RepositoryLibrarySnapshot, String> {
        let tags = self
            .list_tags(account_id)?
            .into_iter()
            .map(|tag| AnnotationSnapshotTag {
                name: tag.name,
                color: tag.color,
            })
            .collect::<Vec<_>>();
        let repository_sql = format!(
            r#"
.mode json
SELECT
  r.full_name,
  r.owner,
  r.name,
  r.description,
  r.language,
  r.topics_json,
  r.html_url,
  r.stars_count,
  r.forks_count,
  r.starred_at,
  r.pushed_at,
  COALESCE(a.note_md, '') AS note_markdown,
  COALESCE(a.read_status, 'unread') AS read_status,
  COALESCE(json_group_array(t.name) FILTER (WHERE t.name IS NOT NULL), '[]') AS tag_names_json
FROM repositories r
LEFT JOIN annotations a ON a.repo_id = r.id AND a.account_id = r.account_id
LEFT JOIN repo_tags rt ON rt.repo_id = r.id
LEFT JOIN tags t ON t.id = rt.tag_id AND t.account_id = r.account_id
WHERE r.account_id = {account_id}
  AND r.sync_status = 'active'
GROUP BY
  r.id,
  r.full_name,
  r.owner,
  r.name,
  r.description,
  r.language,
  r.topics_json,
  r.html_url,
  r.stars_count,
  r.forks_count,
  r.starred_at,
  r.pushed_at,
  a.note_md,
  a.read_status
ORDER BY r.starred_at DESC, r.full_name COLLATE NOCASE ASC;
"#,
            account_id = sql_text(account_id),
        );
        let rows = parse_json_rows::<RepositoryLibrarySnapshotRepositoryRow>(
            &self.query_sql(&repository_sql)?,
            "SQLite 仓库快照解析失败",
        )?;
        let repositories = rows
            .into_iter()
            .map(|row| {
                Ok(RepositoryLibrarySnapshotRepository {
                    full_name: row.full_name,
                    owner: row.owner,
                    name: row.name,
                    description: row.description,
                    language: row.language,
                    topics: parse_json_string_array(
                        &row.topics_json,
                        "SQLite 仓库 Topics 快照解析失败",
                    )?,
                    html_url: row.html_url,
                    stars_count: row.stars_count,
                    forks_count: row.forks_count,
                    starred_at: row.starred_at,
                    pushed_at: row.pushed_at,
                    note_markdown: row.note_markdown,
                    read_status: row.read_status,
                    tag_names: parse_json_string_array(
                        &row.tag_names_json,
                        "SQLite 仓库标签快照解析失败",
                    )?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(RepositoryLibrarySnapshot {
            schema_version: 1,
            exported_at: self.current_database_timestamp()?,
            account_id: account_id.to_owned(),
            tags,
            repositories,
        })
    }

    pub fn import_repository_library_snapshot(
        &self,
        account_id: &str,
        snapshot: &RepositoryLibrarySnapshot,
    ) -> Result<RepositoryLibraryImportSummary, String> {
        if snapshot.schema_version != 1 {
            return Err("不支持的仓库快照版本".to_owned());
        }

        let repository_ids_by_full_name = self.list_repository_ids_by_full_name(account_id)?;
        let mut seen_repository_keys = HashSet::new();
        let mut sql = String::from("PRAGMA foreign_keys = ON;\nBEGIN;\n");
        let mut created_repository_count = 0_usize;
        let mut updated_repository_count = 0_usize;

        for tag in &snapshot.tags {
            let normalized_name = normalize_required_text(&tag.name, "标签名称不能为空")?;
            let tag_id = next_local_id("tag")?;
            sql.push_str(&format!(
                r#"
INSERT INTO tags (id, account_id, name, color, updated_at)
VALUES ({tag_id}, {account_id}, {name}, {color}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(account_id, name) DO UPDATE SET
  color = excluded.color,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
                tag_id = sql_text(&tag_id),
                account_id = sql_text(account_id),
                name = sql_text(&normalized_name),
                color = sql_optional_text(tag.color.as_deref()),
            ));
        }

        for repository in &snapshot.repositories {
            let (owner, name, full_name) = normalize_repository_library_identity(repository)?;
            let repository_key = normalize_repository_full_name_lookup_key(&full_name);
            if !seen_repository_keys.insert(repository_key.clone()) {
                continue;
            }

            let existing_repository_id = repository_ids_by_full_name.get(&repository_key);
            let repository_id = existing_repository_id
                .cloned()
                .unwrap_or_else(|| format!("imported:{account_id}:{repository_key}"));
            let topics_json = serde_json::to_string(&repository.topics)
                .map_err(|error| format!("仓库 Topics 序列化失败：{error}"))?;
            let read_status = normalize_reading_status(&repository.read_status)?;
            let starred_at = match normalize_optional_text(Some(&repository.starred_at)) {
                Some(value) => value.to_owned(),
                None => self.current_database_timestamp()?,
            };

            if existing_repository_id.is_some() {
                updated_repository_count += 1;
            } else {
                created_repository_count += 1;
            }

            sql.push_str(&format!(
                r#"
INSERT INTO repositories (
  id,
  account_id,
  owner,
  name,
  full_name,
  description,
  language,
  topics_json,
  html_url,
  stars_count,
  forks_count,
  starred_at,
  pushed_at,
  sync_status,
  updated_at
)
VALUES ({repository_id}, {account_id}, {owner}, {name}, {full_name}, {description}, {language}, {topics_json}, {html_url}, {stars_count}, {forks_count}, {starred_at}, {pushed_at}, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(account_id, full_name) DO UPDATE SET
  owner = excluded.owner,
  name = excluded.name,
  description = excluded.description,
  language = excluded.language,
  topics_json = excluded.topics_json,
  html_url = excluded.html_url,
  stars_count = excluded.stars_count,
  forks_count = excluded.forks_count,
  starred_at = excluded.starred_at,
  pushed_at = excluded.pushed_at,
  sync_status = 'active',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO annotations (repo_id, account_id, note_md, read_status, updated_at)
VALUES ({repository_id}, {account_id}, {note_markdown}, {read_status}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(repo_id) DO UPDATE SET
  note_md = excluded.note_md,
  read_status = excluded.read_status,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

DELETE FROM repo_tags
WHERE repo_id = {repository_id};
"#,
                repository_id = sql_text(&repository_id),
                account_id = sql_text(account_id),
                owner = sql_text(&owner),
                name = sql_text(&name),
                full_name = sql_text(&full_name),
                description = sql_optional_text(repository.description.as_deref()),
                language = sql_optional_text(repository.language.as_deref()),
                topics_json = sql_text(&topics_json),
                html_url = sql_text(&repository.html_url),
                stars_count = repository.stars_count,
                forks_count = repository.forks_count,
                starred_at = sql_text(&starred_at),
                pushed_at = sql_optional_text(repository.pushed_at.as_deref()),
                note_markdown = sql_text(&repository.note_markdown),
                read_status = sql_text(read_status),
            ));

            for tag_name in &repository.tag_names {
                let normalized_tag_name = normalize_required_text(tag_name, "标签名称不能为空")?;
                sql.push_str(&format!(
                    r#"
INSERT OR IGNORE INTO repo_tags (repo_id, tag_id)
SELECT {repository_id}, t.id
FROM tags t
WHERE t.account_id = {account_id}
  AND t.name = {tag_name};
"#,
                    repository_id = sql_text(&repository_id),
                    account_id = sql_text(account_id),
                    tag_name = sql_text(&normalized_tag_name),
                ));
            }
        }

        sql.push_str("COMMIT;\n");
        self.execute_sql(&sql)?;

        Ok(RepositoryLibraryImportSummary {
            tag_count: snapshot.tags.len(),
            repository_count: created_repository_count + updated_repository_count,
            created_repository_count,
            updated_repository_count,
        })
    }

    fn list_repository_ids(&self, account_id: &str) -> Result<HashSet<String>, String> {
        let states = self.list_repository_sync_states(account_id)?;

        Ok(states
            .into_iter()
            .filter_map(|(id, status)| (status == "active").then_some(id))
            .collect())
    }

    fn list_repository_ids_by_full_name(
        &self,
        account_id: &str,
    ) -> Result<HashMap<String, String>, String> {
        let sql = format!(
            r#"
.mode json
SELECT full_name, id
FROM repositories
WHERE account_id = {account_id}
  AND sync_status = 'active';
"#,
            account_id = sql_text(account_id),
        );
        let rows = parse_json_rows::<RepositoryFullNameIdRow>(
            &self.query_sql(&sql)?,
            "SQLite 仓库名称索引解析失败",
        )?;

        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    normalize_repository_full_name_lookup_key(&row.full_name),
                    row.id,
                )
            })
            .collect())
    }

    fn current_database_timestamp(&self) -> Result<String, String> {
        let output = self.query_sql(
            r#"
.mode list
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
        )?;
        let timestamp = output.trim();

        if timestamp.is_empty() {
            Err("SQLite 当前时间读取失败".to_owned())
        } else {
            Ok(timestamp.to_owned())
        }
    }

    pub fn list_repository_sync_states(
        &self,
        account_id: &str,
    ) -> Result<HashMap<String, String>, String> {
        let sql = format!(
            r#"
.mode json
SELECT id, sync_status
FROM repositories
WHERE account_id = {account_id};
"#,
            account_id = sql_text(account_id),
        );
        let rows = parse_json_rows::<RepositorySyncStateRow>(
            &self.query_sql(&sql)?,
            "SQLite 仓库同步状态解析失败",
        )?;

        Ok(rows
            .into_iter()
            .map(|row| (row.id, row.sync_status))
            .collect())
    }

    pub fn count_active_repositories_for_account(&self, account_id: &str) -> Result<usize, String> {
        self.count_active_repositories(&format!(
            "r.sync_status = 'active' AND r.account_id = {}",
            sql_text(account_id)
        ))
    }

    pub fn mark_repositories_removed(
        &self,
        account_id: &str,
        repository_ids: &[String],
    ) -> Result<(), String> {
        if repository_ids.is_empty() {
            return Ok(());
        }

        let repository_id_list = repository_ids
            .iter()
            .map(|repository_id| sql_text(repository_id))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
UPDATE repositories
SET sync_status = 'removed',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE account_id = {account_id}
  AND sync_status = 'active'
  AND id IN ({repository_id_list});
"#,
            account_id = sql_text(account_id),
            repository_id_list = repository_id_list,
        );

        self.execute_sql(&sql)
    }

    fn get_tag(&self, account_id: &str, tag_id: &str) -> Result<TagItem, String> {
        let sql = format!(
            r#"
.mode json
SELECT id, account_id AS accountId, name, color, created_at AS createdAt, updated_at AS updatedAt
FROM tags
WHERE id = {tag_id} AND account_id = {account_id}
LIMIT 1;
"#,
            tag_id = sql_text(tag_id),
            account_id = sql_text(account_id),
        );
        let mut rows = parse_json_rows::<TagItem>(&self.query_sql(&sql)?, "SQLite 标签解析失败")?;

        rows.pop()
            .ok_or_else(|| "标签不存在或账号不匹配".to_owned())
    }

    fn get_tag_by_name(&self, account_id: &str, name: &str) -> Result<TagItem, String> {
        let sql = format!(
            r#"
.mode json
SELECT id, account_id AS accountId, name, color, created_at AS createdAt, updated_at AS updatedAt
FROM tags
WHERE account_id = {account_id} AND name = {name}
LIMIT 1;
"#,
            account_id = sql_text(account_id),
            name = sql_text(name),
        );
        let mut rows = parse_json_rows::<TagItem>(&self.query_sql(&sql)?, "SQLite 标签解析失败")?;

        rows.pop()
            .ok_or_else(|| "标签不存在或账号不匹配".to_owned())
    }

    fn list_repository_tags(
        &self,
        repository_id: &str,
        account_id: &str,
    ) -> Result<Vec<TagItem>, String> {
        let sql = format!(
            r#"
.mode json
SELECT t.id, t.account_id AS accountId, t.name, t.color, t.created_at AS createdAt, t.updated_at AS updatedAt
FROM tags t
JOIN repo_tags rt ON rt.tag_id = t.id
JOIN repositories r ON r.id = rt.repo_id AND r.account_id = t.account_id
WHERE r.id = {repository_id} AND r.account_id = {account_id}
ORDER BY t.name COLLATE NOCASE ASC;
"#,
            repository_id = sql_text(repository_id),
            account_id = sql_text(account_id),
        );

        parse_json_rows(&self.query_sql(&sql)?, "SQLite 仓库标签解析失败")
    }

    fn get_repository_readme(
        &self,
        repository_id: &str,
    ) -> Result<Option<RepositoryReadmeView>, String> {
        let sql = format!(
            r#"
.mode json
SELECT raw_markdown, content_hash, source_path, fetched_at
FROM repo_readmes
WHERE repo_id = {repository_id}
LIMIT 1;
"#,
            repository_id = sql_text(repository_id),
        );
        let mut rows = parse_json_rows::<RepositoryReadmeRow>(
            &self.query_sql(&sql)?,
            "SQLite README 详情解析失败",
        )?;

        Ok(rows.pop().map(|row| RepositoryReadmeView {
            raw_markdown: row.raw_markdown,
            content_hash: row.content_hash,
            source_path: row.source_path,
            fetched_at: row.fetched_at,
        }))
    }

    fn get_repository_ai_document(
        &self,
        repository_id: &str,
    ) -> Result<Option<RepositoryAiDocumentView>, String> {
        let sql = format!(
            r#"
.mode json
SELECT
  summary_zh,
  readme_zh,
  keywords_json,
  suggested_tags_json,
  model,
  prompt_version,
  source_hash,
  input_tokens,
  output_tokens,
  generated_at
FROM repo_ai_documents
WHERE repo_id = {repository_id}
LIMIT 1;
"#,
            repository_id = sql_text(repository_id),
        );
        let mut rows = parse_json_rows::<RepositoryAiDocumentRow>(
            &self.query_sql(&sql)?,
            "SQLite AI 文档解析失败",
        )?;
        let Some(row) = rows.pop() else {
            return Ok(None);
        };

        Ok(Some(RepositoryAiDocumentView {
            summary_zh: row.summary_zh,
            readme_zh: row.readme_zh,
            keywords: parse_json_string_array(&row.keywords_json, "SQLite AI 关键词解析失败")?,
            suggested_tags: parse_json_string_array(
                &row.suggested_tags_json,
                "SQLite AI 推荐标签解析失败",
            )?,
            model: row.model,
            prompt_version: row.prompt_version,
            source_hash: row.source_hash,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            generated_at: row.generated_at,
        }))
    }

    pub(crate) fn ensure_repository_belongs_to_account(
        &self,
        repository_id: &str,
        account_id: &str,
    ) -> Result<(), String> {
        let sql = format!(
            r#"
.mode list
SELECT 1
FROM repositories
WHERE id = {repository_id} AND account_id = {account_id}
LIMIT 1;
"#,
            repository_id = sql_text(repository_id),
            account_id = sql_text(account_id),
        );
        let output = self.query_sql(&sql)?;

        if output.trim() == "1" {
            Ok(())
        } else {
            Err("仓库不存在或账号不匹配".to_owned())
        }
    }

    fn ensure_repository_annotation(
        &self,
        repository_id: &str,
        account_id: &str,
    ) -> Result<(), String> {
        let sql = format!(
            r#"
PRAGMA foreign_keys = ON;
INSERT OR IGNORE INTO annotations (repo_id, account_id)
SELECT id, account_id
FROM repositories
WHERE id = {repository_id} AND account_id = {account_id};
"#,
            repository_id = sql_text(repository_id),
            account_id = sql_text(account_id),
        );

        self.execute_sql(&sql)
    }

    fn count_active_repositories(&self, where_clause: &str) -> Result<usize, String> {
        let sql = format!(
            r#"
.mode list
SELECT COUNT(DISTINCT r.id)
FROM repositories r
LEFT JOIN annotations a ON a.repo_id = r.id AND a.account_id = r.account_id
WHERE {where_clause};
"#,
            where_clause = where_clause,
        );
        let output = self.query_sql(&sql)?;

        output
            .trim()
            .parse::<usize>()
            .map_err(|_| "SQLite 仓库数量解析失败".to_owned())
    }

    // === 聚合统计方法 ===

    /// 仪表盘统计数据：总数、语言分布、标签统计、最近仓库
    pub fn get_dashboard_stats(
        &self,
        account_id: Option<&str>,
    ) -> Result<DashboardStatsData, String> {
        let account_clause = account_id
            .map(|value| format!(" AND r.account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let tag_account_clause = account_id
            .map(|value| format!("WHERE account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let total_repos =
            self.count_active_repositories(&format!("r.sync_status = 'active'{account_clause}"))?;

        let total_stars = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COALESCE(SUM(r.stars_count), 0) FROM repositories r WHERE r.sync_status = 'active'{account_clause};
"#,
            ))?
            .trim()
            .parse::<u64>()
            .unwrap_or(0);

        let total_readmes = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COUNT(*)
FROM repo_readmes rr
JOIN repositories r ON r.id = rr.repo_id
WHERE r.sync_status = 'active'{account_clause};
"#,
            ))?
            .trim()
            .parse::<usize>()
            .unwrap_or(0);

        let total_ai_summaries = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COUNT(*)
FROM repo_ai_documents ai
JOIN repositories r ON r.id = ai.repo_id
WHERE r.sync_status = 'active'{account_clause};
"#,
            ))?
            .trim()
            .parse::<usize>()
            .unwrap_or(0);
        let (total_ai_input_tokens, total_ai_output_tokens) =
            self.get_ai_usage_totals(&account_clause)?;

        let total_tags = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COUNT(*) FROM tags {tag_account_clause};
"#,
            ))?
            .trim()
            .parse::<usize>()
            .unwrap_or(0);

        let total_notes = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COUNT(*)
FROM annotations a
JOIN repositories r ON r.id = a.repo_id AND r.account_id = a.account_id
WHERE r.sync_status = 'active'{account_clause} AND a.note_md != '';
"#,
            ))?
            .trim()
            .parse::<usize>()
            .unwrap_or(0);

        // 语言分布
        let lang_sql = format!(
            r#"
.mode json
SELECT COALESCE(NULLIF(language, ''), '其他') AS language, COUNT(*) as count
FROM repositories r
WHERE r.sync_status = 'active'{account_clause}
GROUP BY COALESCE(NULLIF(language, ''), '其他')
ORDER BY count DESC
LIMIT 10;
"#
        );
        let lang_rows =
            parse_json_rows::<LanguageCountRow>(&self.query_sql(&lang_sql)?, "语言分布查询失败")?;
        let lang_total: usize = lang_rows.iter().map(|r| r.count).sum::<usize>().max(1);
        let language_distribution: Vec<LanguageDistributionItem> = lang_rows
            .into_iter()
            .map(|r| LanguageDistributionItem {
                language: r.language.unwrap_or_else(|| "其他".to_owned()),
                count: r.count,
                percentage: ((r.count as f64 / lang_total as f64) * 100.0).round() as u32,
            })
            .collect();

        // 最近仓库 (5个)
        let recent = self.list_repository_page(
            5,
            0,
            RepositoryListFilters {
                account_id,
                keyword: None,
                language: None,
                tag_id: None,
            },
        )?;
        let recent_repos = recent.items;
        let last_sync_at = normalize_optional_text(Some(
            self.query_sql(&format!(
                r#"
.mode list
SELECT COALESCE(MAX(updated_at), '') FROM repositories r WHERE r.sync_status = 'active'{account_clause};
"#,
            ))?
            .trim(),
        ))
        .map(str::to_owned);

        Ok(DashboardStatsData {
            total_repos,
            total_stars,
            total_readmes,
            total_ai_summaries,
            total_ai_input_tokens,
            total_ai_output_tokens,
            total_tags,
            total_notes,
            language_distribution,
            recent_repos,
            last_sync_at,
        })
    }

    /// 标签网络数据：节点（标签+仓库数）和边（共现关系）
    pub fn get_tag_network_data(&self, account_id: Option<&str>) -> Result<TagNetworkData, String> {
        let tag_account_clause = account_id
            .map(|value| format!("WHERE t.account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let edge_account_clause = account_id
            .map(|value| format!("AND ta.account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let repository_account_clause = account_id
            .map(|value| format!(" AND r.account_id = {}", sql_text(value)))
            .unwrap_or_default();
        // 获取所有标签及其关联仓库数
        let tag_sql = format!(
            r#"
.mode json
SELECT t.id, t.name, t.color, COUNT(DISTINCT r.id) as repo_count
FROM tags t
LEFT JOIN repo_tags rt ON rt.tag_id = t.id
LEFT JOIN repositories r ON r.id = rt.repo_id AND r.account_id = t.account_id AND r.sync_status = 'active'
{tag_account_clause}
GROUP BY t.id
ORDER BY repo_count DESC;
"#
        );
        let tag_rows =
            parse_json_rows::<TagNodeRow>(&self.query_sql(&tag_sql)?, "标签网络节点查询失败")?;
        let nodes: Vec<TagNetworkNode> = tag_rows
            .into_iter()
            .map(|r| TagNetworkNode {
                id: r.id,
                name: r.name,
                color: r.color,
                repo_count: r.repo_count,
            })
            .collect();

        // 标签共现边（同一仓库上的标签对）
        let edge_sql = format!(
            r#"
.mode json
SELECT a.tag_id as source, b.tag_id as target, COUNT(*) as weight
FROM repo_tags a
JOIN repo_tags b ON a.repo_id = b.repo_id AND a.tag_id < b.tag_id
JOIN tags ta ON ta.id = a.tag_id
JOIN tags tb ON tb.id = b.tag_id AND tb.account_id = ta.account_id
JOIN repositories r ON r.id = a.repo_id AND r.account_id = ta.account_id AND r.sync_status = 'active'
WHERE 1 = 1
  {edge_account_clause}
GROUP BY a.tag_id, b.tag_id
ORDER BY weight DESC
LIMIT 100;
"#
        );
        let edge_rows =
            parse_json_rows::<TagEdgeRow>(&self.query_sql(&edge_sql)?, "标签网络边查询失败")?;
        let edges: Vec<TagNetworkEdge> = edge_rows
            .into_iter()
            .map(|r| TagNetworkEdge {
                source: r.source,
                target: r.target,
                weight: r.weight,
            })
            .collect();

        let total_repos = self.count_active_repositories(&format!(
            "r.sync_status = 'active'{repository_account_clause}"
        ))?;
        let total_tags = nodes.len();
        let total_links = edges.len();

        Ok(TagNetworkData {
            nodes,
            edges,
            total_repos,
            total_tags,
            total_links,
        })
    }

    /// 个人主页统计：语言分布、月度趋势、最近收藏
    pub fn get_profile_stats(&self, account_id: &str) -> Result<ProfileStatsData, String> {
        let account_clause = format!(" AND r.account_id = {}", sql_text(account_id));
        let total_stars = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COALESCE(SUM(r.stars_count), 0) FROM repositories r WHERE r.sync_status = 'active'{account_clause};
"#,
            ))?
            .trim()
            .parse::<u64>()
            .unwrap_or(0);

        let total_notes = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COUNT(*)
FROM annotations a
JOIN repositories r ON r.id = a.repo_id AND r.account_id = a.account_id
WHERE r.sync_status = 'active'{account_clause} AND a.note_md != '';
"#,
            ))?
            .trim()
            .parse::<usize>()
            .unwrap_or(0);

        let total_ai_words = self
            .query_sql(&format!(
                r#"
.mode list
SELECT COALESCE(SUM(LENGTH(ai.summary_zh)), 0)
FROM repo_ai_documents ai
JOIN repositories r ON r.id = ai.repo_id
WHERE r.sync_status = 'active'{account_clause};
"#,
            ))?
            .trim()
            .parse::<usize>()
            .unwrap_or(0);
        let (total_ai_input_tokens, total_ai_output_tokens) =
            self.get_ai_usage_totals(&account_clause)?;

        // 语言分布 (雷达图)
        let lang_sql = format!(
            r#"
.mode json
SELECT language, COUNT(*) as count
FROM repositories r
WHERE r.sync_status = 'active'{account_clause} AND language IS NOT NULL
GROUP BY language
ORDER BY count DESC
LIMIT 6;
"#
        );
        let lang_rows =
            parse_json_rows::<LanguageCountRow>(&self.query_sql(&lang_sql)?, "语言分布查询失败")?;
        let lang_total: usize = lang_rows.iter().map(|r| r.count).sum::<usize>().max(1);
        let language_breakdown: Vec<LanguageBreakdownItem> = lang_rows
            .into_iter()
            .map(|r| LanguageBreakdownItem {
                language: r.language.unwrap_or_else(|| "其他".to_owned()),
                count: r.count,
                percentage: ((r.count as f64 / lang_total as f64) * 100.0).round() as u32,
            })
            .collect();

        // 月度趋势 (近12个月)
        let trend_sql = format!(
            r#"
.mode json
SELECT strftime('%Y-%m', starred_at) as month, COUNT(*) as count
FROM repositories r
WHERE r.sync_status = 'active'{account_clause}
  AND starred_at >= date('now', '-12 months', 'start of month')
GROUP BY month
ORDER BY month;
"#
        );
        let trend_rows =
            parse_json_rows::<MonthTrendRow>(&self.query_sql(&trend_sql)?, "月度趋势查询失败")?;
        let monthly_trend: Vec<MonthlyTrendItem> = trend_rows
            .into_iter()
            .map(|r| MonthlyTrendItem {
                month: r.month,
                count: r.count,
            })
            .collect();

        // 最近收藏
        let recent = self.list_repository_page(
            8,
            0,
            RepositoryListFilters {
                account_id: Some(account_id),
                keyword: None,
                language: None,
                tag_id: None,
            },
        )?;

        Ok(ProfileStatsData {
            total_stars,
            total_notes,
            total_ai_words,
            total_ai_input_tokens,
            total_ai_output_tokens,
            language_breakdown,
            monthly_trend,
            recent_repos: recent.items,
        })
    }

    fn get_ai_usage_totals(&self, account_clause: &str) -> Result<(u64, u64), String> {
        let output = self.query_sql(&format!(
            r#"
.mode list
SELECT
  COALESCE(SUM(ai.input_tokens), 0) || '|' ||
  COALESCE(SUM(ai.output_tokens), 0)
FROM repo_ai_documents ai
JOIN repositories r ON r.id = ai.repo_id
WHERE r.sync_status = 'active'{account_clause};
"#,
        ))?;
        let normalized = output.trim();
        let Some((input_tokens, output_tokens)) = normalized.split_once('|') else {
            return Err("AI 用量统计解析失败".to_owned());
        };

        Ok((
            input_tokens.trim().parse::<u64>().unwrap_or(0),
            output_tokens.trim().parse::<u64>().unwrap_or(0),
        ))
    }

    /// 保存 AI 文档（摘要、关键词、建议标签）
    pub fn save_repository_ai_document(
        &self,
        repository_id: &str,
        summary_zh: &str,
        readme_zh: Option<&str>,
        keywords: &[String],
        suggested_tags: &[String],
        model: &str,
        prompt_version: &str,
        source_hash: &str,
        input_tokens: u64,
        output_tokens: u64,
    ) -> Result<(), String> {
        let keywords_json =
            serde_json::to_string(keywords).map_err(|e| format!("关键词序列化失败：{e}"))?;
        let suggested_tags_json = serde_json::to_string(suggested_tags)
            .map_err(|e| format!("建议标签序列化失败：{e}"))?;
        let timestamp = self.current_database_timestamp()?;
        let readme_zh_sql = match readme_zh {
            Some(text) => sql_text(text),
            None => "NULL".to_owned(),
        };

        let sql = format!(
            r#"
INSERT INTO repo_ai_documents (repo_id, summary_zh, readme_zh, keywords_json, suggested_tags_json, model, prompt_version, source_hash, input_tokens, output_tokens, generated_at)
VALUES ({repo_id}, {summary}, {readme_zh}, {keywords}, {suggested}, {model}, {prompt_version}, {source_hash}, {input_tokens}, {output_tokens}, {timestamp})
ON CONFLICT(repo_id) DO UPDATE SET
  summary_zh = excluded.summary_zh,
  readme_zh = excluded.readme_zh,
  keywords_json = excluded.keywords_json,
  suggested_tags_json = excluded.suggested_tags_json,
  model = excluded.model,
  prompt_version = excluded.prompt_version,
  source_hash = excluded.source_hash,
  input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens,
  generated_at = excluded.generated_at;
"#,
            repo_id = sql_text(repository_id),
            summary = sql_text(summary_zh),
            readme_zh = readme_zh_sql,
            keywords = sql_text(&keywords_json),
            suggested = sql_text(&suggested_tags_json),
            model = sql_text(model),
            prompt_version = sql_text(prompt_version),
            source_hash = sql_text(source_hash),
            input_tokens = input_tokens,
            output_tokens = output_tokens,
            timestamp = sql_text(&timestamp),
        );

        self.execute_sql(&sql)
    }

    pub fn search_repositories(
        &self,
        options: RepositorySearchOptions<'_>,
    ) -> Result<AiSearchResponseData, String> {
        let RepositorySearchOptions {
            query,
            context_queries,
            context_repository_ids,
            limit,
            offset,
            max_results,
            account_id,
            vector_scores,
            vector_error,
            metadata,
        } = options;
        let normalized_query = query.trim();
        let metadata = metadata.unwrap_or_else(|| AiSearchMetadata {
            original_query: normalized_query.to_owned(),
            ai_enhanced: false,
            ai_query: None,
            ai_rationale_zh: None,
            ai_error: None,
        });
        if normalized_query.is_empty() {
            return Ok(AiSearchResponseData {
                query: metadata.original_query,
                mode: "local_knowledge".to_owned(),
                results: Vec::new(),
                total_count: 0,
                context_queries_used: Vec::new(),
                context_applied: false,
                ai_enhanced: metadata.ai_enhanced,
                ai_query: metadata.ai_query,
                ai_rationale_zh: metadata.ai_rationale_zh,
                ai_error: metadata.ai_error,
                answer_zh: None,
                retrieval_mode: "keyword".to_owned(),
                vector_applied: false,
                vector_error,
            });
        }

        let account_clause = account_id
            .map(|value| format!("AND r.account_id = {}", sql_text(value)))
            .unwrap_or_default();
        let sql = format!(
            r#"
.mode json
SELECT
  r.id,
  r.account_id,
  r.owner,
  r.name,
  r.full_name,
  r.description,
  r.language,
  r.topics_json,
  r.html_url,
  r.stars_count,
  r.forks_count,
  r.starred_at,
  r.pushed_at,
  CASE WHEN rr.repo_id IS NULL THEN 0 ELSE 1 END AS has_readme,
  a.note_md AS note_markdown,
  ai.summary_zh,
  ai.keywords_json,
  ai.suggested_tags_json,
  SUBSTR(rr.raw_markdown, 1, 5000) AS readme_excerpt,
  COALESCE(json_group_array(t.name) FILTER (WHERE t.name IS NOT NULL), '[]') AS tag_names_json
FROM repositories r
LEFT JOIN annotations a ON a.repo_id = r.id AND a.account_id = r.account_id
LEFT JOIN repo_readmes rr ON rr.repo_id = r.id
LEFT JOIN repo_ai_documents ai ON ai.repo_id = r.id
LEFT JOIN repo_tags rt ON rt.repo_id = r.id
LEFT JOIN tags t ON t.id = rt.tag_id AND t.account_id = r.account_id
WHERE r.sync_status = 'active'
  {account_clause}
GROUP BY r.id
ORDER BY r.starred_at DESC;
"#
        );
        let rows = parse_json_rows::<SearchRepositoryRow>(
            &self.query_sql(&sql)?,
            "SQLite 搜索数据解析失败",
        )?;
        let context_queries_used = context_queries
            .iter()
            .rev()
            .take(4)
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let context_text = context_queries_used
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" ");
        let context_repository_set = context_repository_ids
            .iter()
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .take(30)
            .collect::<HashSet<_>>();
        let context_tokens = tokenize_query(&context_text);
        let query_tokens = tokenize_query(normalized_query);
        let mut results = rows
            .into_iter()
            .filter_map(|row| {
                let vector_score = vector_scores.get(&row.id).copied();
                score_search_row(
                    row,
                    normalized_query,
                    &query_tokens,
                    &context_tokens,
                    &context_repository_set,
                    vector_score,
                )
                .transpose()
            })
            .collect::<Result<Vec<_>, String>>()?;

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.repository.stars_count.cmp(&a.repository.stars_count))
        });
        results.truncate(max_results.clamp(1, 10));
        let total_count = results.len();
        let page_limit = limit.clamp(1, 10);
        results = results.into_iter().skip(offset).take(page_limit).collect();
        let context_applied = results.iter().any(search_result_uses_context);
        let vector_applied = results.iter().any(search_result_uses_vector);

        Ok(AiSearchResponseData {
            query: metadata.original_query,
            mode: if vector_applied && metadata.ai_enhanced {
                "hybrid".to_owned()
            } else if vector_applied {
                "vector".to_owned()
            } else if metadata.ai_enhanced {
                "ai_enhanced".to_owned()
            } else {
                "local_knowledge".to_owned()
            },
            results,
            total_count,
            context_queries_used,
            context_applied,
            ai_enhanced: metadata.ai_enhanced,
            ai_query: metadata.ai_query,
            ai_rationale_zh: metadata.ai_rationale_zh,
            ai_error: metadata.ai_error,
            answer_zh: None,
            retrieval_mode: if vector_applied {
                "vector+keyword".to_owned()
            } else {
                "keyword".to_owned()
            },
            vector_applied,
            vector_error,
        })
    }

    pub fn list_vector_index_candidates(
        &self,
        account_id: &str,
        model: &str,
        dimensions: usize,
        model_version: &str,
    ) -> Result<Vec<VectorIndexCandidate>, String> {
        let sql = format!(
            r#"
.mode json
SELECT
  r.account_id,
  r.id AS repo_id,
  r.full_name,
  r.description,
  r.language,
  r.topics_json,
  ai.summary_zh,
  ai.keywords_json,
  ai.suggested_tags_json,
  SUBSTR(rr.raw_markdown, 1, 12000) AS readme_excerpt,
  COALESCE(json_group_array(t.name) FILTER (WHERE t.name IS NOT NULL), '[]') AS tag_names_json,
  e.source_hash AS existing_source_hash
FROM repositories r
LEFT JOIN repo_readmes rr ON rr.repo_id = r.id
LEFT JOIN repo_ai_documents ai ON ai.repo_id = r.id
LEFT JOIN repo_tags rt ON rt.repo_id = r.id
LEFT JOIN tags t ON t.id = rt.tag_id AND t.account_id = r.account_id
LEFT JOIN repo_embeddings e
  ON e.repo_id = r.id
  AND e.source_kind = 'repository_knowledge'
  AND e.model = {model}
  AND e.model_version = {model_version}
  AND e.dimensions = {dimensions}
WHERE r.sync_status = 'active'
  AND r.account_id = {account_id}
GROUP BY r.id
ORDER BY r.starred_at DESC;
"#,
            account_id = sql_text(account_id),
            model = sql_text(model),
            model_version = sql_text(model_version),
        );
        let rows = parse_json_rows::<VectorIndexCandidateRow>(
            &self.query_sql(&sql)?,
            "SQLite 向量候选解析失败",
        )?;
        rows.into_iter().map(build_vector_index_candidate).collect()
    }

    pub fn save_repository_embedding(
        &self,
        record: &StoredRepositoryEmbedding,
        model_version: &str,
    ) -> Result<(), String> {
        if record.vector.is_empty() || record.vector.iter().any(|value| !value.is_finite()) {
            return Err("不能保存空向量或包含无效数值的向量".to_owned());
        }
        let vector_json = serde_json::to_string(&record.vector)
            .map_err(|error| format!("仓库向量序列化失败：{error}"))?;
        let timestamp = self.current_database_timestamp()?;
        let sql = format!(
            r#"
INSERT INTO repo_embeddings (
  repo_id,
  source_kind,
  source_hash,
  model,
  model_version,
  dimensions,
  vector_json,
  generated_at
)
VALUES (
  {repo_id},
  'repository_knowledge',
  {source_hash},
  {model},
  {model_version},
  {dimensions},
  {vector_json},
  {timestamp}
)
ON CONFLICT(repo_id, source_kind, model, model_version) DO UPDATE SET
  source_hash = excluded.source_hash,
  dimensions = excluded.dimensions,
  vector_json = excluded.vector_json,
  generated_at = excluded.generated_at;
"#,
            repo_id = sql_text(&record.repo_id),
            source_hash = sql_text(&record.source_hash),
            model = sql_text(&record.model),
            model_version = sql_text(model_version),
            dimensions = record.vector.len(),
            vector_json = sql_text(&vector_json),
            timestamp = sql_text(&timestamp),
        );
        self.execute_sql(&sql)
    }

    pub fn list_stored_repository_embeddings(
        &self,
        account_id: &str,
        model: &str,
        dimensions: usize,
        model_version: &str,
    ) -> Result<Vec<StoredRepositoryEmbedding>, String> {
        let sql = format!(
            r#"
.mode json
SELECT
  r.account_id,
  e.repo_id,
  e.source_hash,
  e.model,
  e.vector_json
FROM repo_embeddings e
JOIN repositories r ON r.id = e.repo_id
WHERE r.sync_status = 'active'
  AND r.account_id = {account_id}
  AND e.source_kind = 'repository_knowledge'
  AND e.model = {model}
  AND e.model_version = {model_version}
  AND e.dimensions = {dimensions}
ORDER BY e.repo_id;
"#,
            account_id = sql_text(account_id),
            model = sql_text(model),
            model_version = sql_text(model_version),
        );
        let rows = parse_json_rows::<StoredRepositoryEmbeddingRow>(
            &self.query_sql(&sql)?,
            "SQLite 仓库向量解析失败",
        )?;
        rows.into_iter()
            .map(|row| {
                let vector = serde_json::from_str::<Vec<f32>>(&row.vector_json)
                    .map_err(|error| format!("仓库 {} 向量解析失败：{error}", row.repo_id))?;
                if vector.len() != dimensions || vector.iter().any(|value| !value.is_finite()) {
                    return Err(format!("仓库 {} 的向量维度或数值无效", row.repo_id));
                }
                Ok(StoredRepositoryEmbedding {
                    account_id: row.account_id,
                    repo_id: row.repo_id,
                    source_hash: row.source_hash,
                    model: row.model,
                    vector,
                })
            })
            .collect()
    }

    fn migrate(&self) -> Result<(), String> {
        self.reset_incompatible_database()?;
        self.execute_sql(INITIAL_SCHEMA_SQL)?;

        if !self.database_uses_current_schema()? {
            return Err("本地数据库初始化后仍缺少当前版本所需表结构".to_owned());
        }

        Ok(())
    }

    fn execute_sql(&self, sql: &str) -> Result<(), String> {
        execute_sqlite(&self.database_path, sql).map(|_| ())
    }

    fn query_sql(&self, sql: &str) -> Result<String, String> {
        execute_sqlite(&self.database_path, sql)
    }

    fn reset_incompatible_database(&self) -> Result<(), String> {
        if !self.database_path.exists() || self.database_uses_current_schema()? {
            return Ok(());
        }

        remove_sqlite_database_files(&self.database_path)
    }

    fn database_uses_current_schema(&self) -> Result<bool, String> {
        if !self.database_path.exists() {
            return Ok(true);
        }

        let connection = match Connection::open(&self.database_path) {
            Ok(connection) => connection,
            Err(_) => return Ok(false),
        };

        match sqlite_database_uses_current_schema(&connection) {
            Ok(is_current) => Ok(is_current),
            Err(_) => Ok(false),
        }
    }
}

fn sqlite_database_uses_current_schema(connection: &Connection) -> Result<bool, String> {
    if !sqlite_schema_has_current_marker(connection)? {
        return Ok(false);
    }

    for (table_name, required_columns) in REQUIRED_SCHEMA_COLUMNS {
        if !sqlite_table_has_columns(connection, table_name, required_columns)? {
            return Ok(false);
        }
    }

    Ok(true)
}

fn sqlite_schema_has_current_marker(connection: &Connection) -> Result<bool, String> {
    let count = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = '001' AND name = 'initial_schema';",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("SQLite schema_migrations 读取失败：{error}"))?;

    Ok(count == 1)
}

fn sqlite_table_has_columns(
    connection: &Connection,
    table_name: &str,
    required_columns: &[&str],
) -> Result<bool, String> {
    let pragma_sql = format!("PRAGMA table_info({table_name});");
    let mut statement = connection
        .prepare(&pragma_sql)
        .map_err(|error| format!("SQLite 表结构读取失败：{table_name}：{error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("SQLite 表结构查询失败：{table_name}：{error}"))?;
    let mut existing_columns = HashSet::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("SQLite 表结构行读取失败：{table_name}：{error}"))?
    {
        let column_name = row
            .get::<_, String>(1)
            .map_err(|error| format!("SQLite 表结构列名读取失败：{table_name}：{error}"))?;
        existing_columns.insert(column_name);
    }

    if existing_columns.is_empty() {
        return Ok(false);
    }

    Ok(required_columns
        .iter()
        .all(|column_name| existing_columns.contains(*column_name)))
}

fn remove_sqlite_database_files(database_path: &Path) -> Result<(), String> {
    for path in sqlite_database_files(database_path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("本地数据库文件清理失败：{}：{error}", path.display()))?;
        }
    }

    Ok(())
}

fn remove_legacy_sqlite_database_files(data_dir: &Path) -> Result<(), String> {
    for file_name in LEGACY_SQLITE_DATABASE_FILE_NAMES {
        remove_sqlite_database_files(&data_dir.join(file_name))?;
    }

    Ok(())
}

fn sqlite_database_files(database_path: &Path) -> Vec<PathBuf> {
    let mut paths = vec![database_path.to_path_buf()];

    if let Some(file_name) = database_path.file_name() {
        let file_name = file_name.to_string_lossy();
        for suffix in ["-wal", "-shm", "-journal"] {
            paths.push(database_path.with_file_name(format!("{file_name}{suffix}")));
        }
    }

    paths
}

fn normalize_repository_full_name_lookup_key(value: &str) -> String {
    let trimmed = value.trim().trim_matches(|character: char| {
        character.is_whitespace() || character == '`' || character == '"' || character == '\''
    });
    let lower_trimmed = trimmed.to_ascii_lowercase();
    let without_host = lower_trimmed
        .find("github.com/")
        .map(|index| &trimmed[index + "github.com/".len()..])
        .unwrap_or(trimmed);
    let without_suffix = without_host.trim_end_matches('/').trim_end_matches(".git");
    let parts = without_suffix
        .split('/')
        .filter(|part| !part.trim().is_empty())
        .map(str::trim)
        .collect::<Vec<_>>();

    if parts.len() >= 2 {
        format!("{}/{}", parts[0], parts[1]).to_ascii_lowercase()
    } else {
        without_suffix.to_ascii_lowercase()
    }
}

fn normalize_repository_library_identity(
    repository: &RepositoryLibrarySnapshotRepository,
) -> Result<(String, String, String), String> {
    let snapshot_full_name = normalize_optional_text(Some(&repository.full_name))
        .map(str::to_owned)
        .or_else(|| {
            let owner = normalize_optional_text(Some(&repository.owner))?;
            let name = normalize_optional_text(Some(&repository.name))?;
            Some(format!("{owner}/{name}"))
        })
        .ok_or_else(|| "仓库快照缺少 owner/repo 名称".to_owned())?;
    let full_name_key = normalize_repository_full_name_lookup_key(&snapshot_full_name);
    let Some((owner, name)) = full_name_key.split_once('/') else {
        return Err("仓库快照中的 fullName 必须是 owner/repo 格式".to_owned());
    };
    if owner.is_empty() || name.is_empty() {
        return Err("仓库快照中的 fullName 必须是 owner/repo 格式".to_owned());
    }

    Ok((owner.to_owned(), name.to_owned(), full_name_key))
}

// === 聚合统计返回类型 ===

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStatsData {
    pub total_repos: usize,
    pub total_stars: u64,
    pub total_readmes: usize,
    pub total_ai_summaries: usize,
    pub total_ai_input_tokens: u64,
    pub total_ai_output_tokens: u64,
    pub total_tags: usize,
    pub total_notes: usize,
    pub language_distribution: Vec<LanguageDistributionItem>,
    pub recent_repos: Vec<RepositoryListItem>,
    pub last_sync_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageDistributionItem {
    pub language: String,
    pub count: usize,
    pub percentage: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagNetworkData {
    pub nodes: Vec<TagNetworkNode>,
    pub edges: Vec<TagNetworkEdge>,
    pub total_repos: usize,
    pub total_tags: usize,
    pub total_links: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagNetworkNode {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub repo_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagNetworkEdge {
    pub source: String,
    pub target: String,
    pub weight: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatsData {
    pub total_stars: u64,
    pub total_notes: usize,
    pub total_ai_words: usize,
    pub total_ai_input_tokens: u64,
    pub total_ai_output_tokens: u64,
    pub language_breakdown: Vec<LanguageBreakdownItem>,
    pub monthly_trend: Vec<MonthlyTrendItem>,
    pub recent_repos: Vec<RepositoryListItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSearchResponseData {
    pub query: String,
    pub mode: String,
    pub results: Vec<AiSearchResultData>,
    pub total_count: usize,
    pub context_queries_used: Vec<String>,
    pub context_applied: bool,
    pub ai_enhanced: bool,
    pub ai_query: Option<String>,
    pub ai_rationale_zh: Option<String>,
    pub ai_error: Option<String>,
    pub answer_zh: Option<String>,
    pub retrieval_mode: String,
    pub vector_applied: bool,
    pub vector_error: Option<String>,
}

pub struct AiSearchMetadata {
    pub original_query: String,
    pub ai_enhanced: bool,
    pub ai_query: Option<String>,
    pub ai_rationale_zh: Option<String>,
    pub ai_error: Option<String>,
}

pub struct RepositorySearchOptions<'a> {
    pub query: &'a str,
    pub context_queries: &'a [String],
    pub context_repository_ids: &'a [String],
    pub limit: usize,
    pub offset: usize,
    pub max_results: usize,
    pub account_id: Option<&'a str>,
    pub vector_scores: &'a HashMap<String, f64>,
    pub vector_error: Option<String>,
    pub metadata: Option<AiSearchMetadata>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSearchResultData {
    pub repository: RepositoryListItem,
    pub score: f64,
    pub explanation_zh: String,
    pub reasons: Vec<SearchMatchReasonData>,
    pub citations: Vec<SearchCitationData>,
    pub keywords: Vec<String>,
    pub ai_summary: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchReasonData {
    pub label: String,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCitationData {
    pub title: String,
    pub snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageBreakdownItem {
    pub language: String,
    pub count: usize,
    pub percentage: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyTrendItem {
    pub month: String,
    pub count: usize,
}

// === 内部查询行类型 ===

#[derive(Deserialize)]
struct LanguageCountRow {
    language: Option<String>,
    count: usize,
}

#[derive(Deserialize)]
struct TagNodeRow {
    id: String,
    name: String,
    color: Option<String>,
    repo_count: usize,
}

#[derive(Deserialize)]
struct TagEdgeRow {
    source: String,
    target: String,
    weight: usize,
}

#[derive(Deserialize)]
struct MonthTrendRow {
    month: String,
    count: usize,
}

impl TryFrom<RepositoryListRow> for RepositoryListItem {
    type Error = String;

    fn try_from(row: RepositoryListRow) -> Result<Self, Self::Error> {
        let topics = serde_json::from_str::<Vec<String>>(&row.topics_json)
            .map_err(|error| format!("SQLite topics_json 解析失败：{error}"))?;
        let ai_keywords = parse_optional_json_array(row.ai_keywords_json.as_deref())?;
        let suggested_tags = parse_optional_json_array(row.suggested_tags_json.as_deref())?;
        let tag_ids = parse_json_string_array(&row.tag_ids_json, "SQLite 仓库标签 ID 解析失败")?;
        let tag_names =
            parse_json_string_array(&row.tag_names_json, "SQLite 仓库标签名称解析失败")?;

        Ok(Self {
            id: row.id,
            account_id: row.account_id,
            owner: row.owner,
            name: row.name,
            full_name: row.full_name,
            description: row.description,
            language: row.language,
            topics,
            html_url: row.html_url,
            stars_count: row.stars_count,
            forks_count: row.forks_count,
            starred_at: row.starred_at,
            pushed_at: row.pushed_at,
            has_readme: row.has_readme == 1,
            ai_summary: row.ai_summary,
            ai_keywords,
            suggested_tags,
            tag_ids,
            tag_names,
            ai_generated_at: row.ai_generated_at,
        })
    }
}

fn build_repository_filter_clause(filters: &RepositoryListFilters<'_>) -> String {
    let mut clauses = vec!["r.sync_status = 'active'".to_owned()];

    if let Some(account_id) = normalize_optional_text(filters.account_id) {
        clauses.push(format!("r.account_id = {}", sql_text(account_id)));
    }

    if let Some(keyword) = normalize_optional_text(filters.keyword) {
        let pattern = sql_like_pattern(keyword);
        clauses.push(format!(
	            "(r.full_name LIKE {pattern} ESCAPE '\\' OR r.description LIKE {pattern} ESCAPE '\\' OR r.language LIKE {pattern} ESCAPE '\\' OR r.topics_json LIKE {pattern} ESCAPE '\\' OR a.note_md LIKE {pattern} ESCAPE '\\' OR EXISTS (SELECT 1 FROM repo_readmes rr_filter WHERE rr_filter.repo_id = r.id AND rr_filter.raw_markdown LIKE {pattern} ESCAPE '\\') OR EXISTS (SELECT 1 FROM repo_ai_documents ai_filter WHERE ai_filter.repo_id = r.id AND (ai_filter.summary_zh LIKE {pattern} ESCAPE '\\' OR ai_filter.keywords_json LIKE {pattern} ESCAPE '\\' OR ai_filter.suggested_tags_json LIKE {pattern} ESCAPE '\\')) OR EXISTS (SELECT 1 FROM repo_tags rt_filter JOIN tags t_filter ON t_filter.id = rt_filter.tag_id WHERE rt_filter.repo_id = r.id AND t_filter.account_id = r.account_id AND t_filter.name LIKE {pattern} ESCAPE '\\'))"
	        ));
    }

    if let Some(language) = normalize_optional_text(filters.language) {
        if language == OTHER_LANGUAGE_LABEL {
            clauses.push("(r.language IS NULL OR TRIM(r.language) = '')".to_owned());
        } else {
            clauses.push(format!("r.language = {}", sql_text(language)));
        }
    }

    if let Some(tag_id) = normalize_optional_text(filters.tag_id) {
        clauses.push(format!(
            "EXISTS (SELECT 1 FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.repo_id = r.id AND t.account_id = r.account_id AND rt.tag_id = {})",
            sql_text(tag_id),
        ));
    }

    clauses.join(" AND ")
}

fn build_vector_index_candidate(
    row: VectorIndexCandidateRow,
) -> Result<VectorIndexCandidate, String> {
    let topics = parse_json_string_array(&row.topics_json, "SQLite 向量候选 Topics 解析失败")?;
    let keywords = parse_optional_json_array(row.keywords_json.as_deref())?;
    let suggested_tags = parse_optional_json_array(row.suggested_tags_json.as_deref())?;
    let tag_names =
        parse_json_string_array(&row.tag_names_json, "SQLite 向量候选个人标签解析失败")?;
    let knowledge_text = [
        Some(format!("仓库：{}", row.full_name)),
        row.description
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("描述：{value}")),
        row.language
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("语言：{value}")),
        (!topics.is_empty()).then(|| format!("Topics：{}", topics.join("、"))),
        row.summary_zh
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("AI 摘要：{value}")),
        (!keywords.is_empty()).then(|| format!("关键词：{}", keywords.join("、"))),
        (!suggested_tags.is_empty()).then(|| format!("建议标签：{}", suggested_tags.join("、"))),
        (!tag_names.is_empty()).then(|| format!("个人标签：{}", tag_names.join("、"))),
        row.readme_excerpt
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("README：{value}")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n");
    let source_hash = format!("{:x}", Sha256::digest(knowledge_text.as_bytes()));
    Ok(VectorIndexCandidate {
        account_id: row.account_id,
        repo_id: row.repo_id,
        full_name: row.full_name,
        source_hash,
        knowledge_text,
        existing_source_hash: row.existing_source_hash,
    })
}

fn score_search_row(
    row: SearchRepositoryRow,
    query: &str,
    query_tokens: &[String],
    context_tokens: &[String],
    context_repository_ids: &HashSet<&str>,
    vector_score: Option<f64>,
) -> Result<Option<AiSearchResultData>, String> {
    let topics = serde_json::from_str::<Vec<String>>(&row.topics_json)
        .map_err(|error| format!("SQLite topics_json 解析失败：{error}"))?;
    let ai_keywords = parse_optional_json_array(row.keywords_json.as_deref())?;
    let suggested_tags = parse_optional_json_array(row.suggested_tags_json.as_deref())?;
    let tag_names = parse_json_string_array(&row.tag_names_json, "SQLite 搜索标签解析失败")?;
    let topics_text = topics.join(" ");
    let ai_keywords_text = ai_keywords.join(" ");
    let suggested_tags_text = suggested_tags.join(" ");
    let tag_names_text = tag_names.join(" ");

    let fields = [
        ("仓库名称", row.full_name.as_str(), 34.0),
        ("描述", row.description.as_deref().unwrap_or_default(), 18.0),
        ("语言", row.language.as_deref().unwrap_or_default(), 12.0),
        ("Topics", topics_text.as_str(), 18.0),
        (
            "AI 摘要",
            row.summary_zh.as_deref().unwrap_or_default(),
            26.0,
        ),
        ("AI 关键词", ai_keywords_text.as_str(), 20.0),
        ("建议标签", suggested_tags_text.as_str(), 16.0),
        ("个人标签", tag_names_text.as_str(), 18.0),
        (
            "个人笔记",
            row.note_markdown.as_deref().unwrap_or_default(),
            16.0,
        ),
        (
            "README",
            row.readme_excerpt.as_deref().unwrap_or_default(),
            8.0,
        ),
    ];

    const MIN_LEXICAL_SCORE: f64 = 18.0;
    let mut lexical_score = 0.0_f64;
    let mut context_score = 0.0_f64;
    let mut reasons = Vec::new();
    let mut matched_keywords = Vec::new();
    let mut used_context_match = false;
    let lower_query = query.to_lowercase();
    let is_previous_result = context_repository_ids.contains(row.id.as_str());

    for token in query_tokens {
        for (label, value, weight) in &fields {
            if find_search_term_byte_index(value, token).is_some() {
                lexical_score += weight;
                push_unique(&mut matched_keywords, token);
                if reasons.len() < 5 {
                    reasons.push(SearchMatchReasonData {
                        label: format!("{label}命中"),
                        detail: format!("{label}包含“{token}”"),
                    });
                }
                break;
            }
        }
    }

    let full_name_query_match = find_search_term_byte_index(&row.full_name, &lower_query).is_some();
    if full_name_query_match {
        lexical_score += 20.0;
    }
    let summary_query_match =
        find_search_term_byte_index(row.summary_zh.as_deref().unwrap_or_default(), &lower_query)
            .is_some();
    if summary_query_match {
        lexical_score += 18.0;
    }

    let vector_score =
        vector_score.filter(|score| score.is_finite() && (0.0..=1.0).contains(score));
    let required_token_matches = match query_tokens.len() {
        0 | 1 => 1,
        2..=4 => 2,
        _ => 3,
    };
    let has_direct_match = lexical_score >= MIN_LEXICAL_SCORE
        && (matched_keywords.len() >= required_token_matches
            || full_name_query_match
            || summary_query_match);
    let requires_exact_lexical_match = is_short_ascii_search_term(query);
    if !has_direct_match && (vector_score.is_none() || requires_exact_lexical_match) {
        return Ok(None);
    }

    if let Some(vector_score) = vector_score {
        reasons.insert(
            0,
            SearchMatchReasonData {
                label: "语义相似命中".to_owned(),
                detail: format!("向量相似度为 {:.0}%", vector_score * 100.0),
            },
        );
        reasons.truncate(5);
    }

    for token in context_tokens {
        if contains_token(query_tokens, token) {
            continue;
        }
        for (label, value, weight) in &fields {
            if find_search_term_byte_index(value, token).is_some() {
                context_score += *weight * 0.2;
                used_context_match = true;
                if !reasons.iter().any(is_context_reason) {
                    if reasons.len() >= 5 {
                        reasons.pop();
                    }
                    reasons.push(SearchMatchReasonData {
                        label: format!("上下文{label}命中"),
                        detail: format!("本轮上下文“{token}”在{label}中命中"),
                    });
                }
                break;
            }
        }
    }
    context_score = context_score.min(12.0);
    if is_previous_result {
        context_score += 6.0;
        used_context_match = true;
        if !reasons
            .iter()
            .any(|reason| reason.label == "上一轮结果命中")
        {
            if reasons.len() >= 5 {
                reasons.pop();
            }
            reasons.push(SearchMatchReasonData {
                label: "上一轮结果命中".to_owned(),
                detail: "该仓库来自本轮对话的上一轮搜索结果，并且本轮仍有直接或语义命中".to_owned(),
            });
        }
    }

    let mut score = if let Some(vector_score) = vector_score {
        lexical_score.min(80.0) * 0.55 + vector_score * 100.0 * 0.45
    } else {
        lexical_score
    };
    score += context_score;

    let explanation_zh = if let Some(summary) = row.summary_zh.as_deref() {
        let prefix = if vector_score.is_some() {
            "根据向量语义与本地知识字段，"
        } else if used_context_match {
            "结合本轮上下文，"
        } else {
            ""
        };
        format!(
            "{prefix}该仓库的名称、标签或 AI 摘要与“{query}”相关。摘要：{}",
            truncate_chars(summary, 120)
        )
    } else {
        let prefix = if vector_score.is_some() {
            "根据向量语义与本地知识字段，"
        } else if used_context_match {
            "结合本轮上下文，"
        } else {
            ""
        };
        format!("{prefix}该仓库的基础元数据与“{query}”匹配，可作为候选项目继续查看 README 与笔记。")
    };
    let citations = build_search_citations(&row, &matched_keywords, query_tokens);
    score += (row.stars_count as f64 + 1.0).log10().min(3.0);
    let score = score.min(99.0);
    let repository = RepositoryListItem {
        id: row.id,
        account_id: row.account_id,
        owner: row.owner,
        name: row.name,
        full_name: row.full_name.clone(),
        description: row.description,
        language: row.language,
        topics,
        html_url: row.html_url,
        stars_count: row.stars_count,
        forks_count: row.forks_count,
        starred_at: row.starred_at,
        pushed_at: row.pushed_at,
        has_readme: row.has_readme == 1,
        ai_summary: row.summary_zh.clone(),
        ai_keywords: ai_keywords.clone(),
        suggested_tags: suggested_tags.clone(),
        tag_ids: Vec::new(),
        tag_names,
        ai_generated_at: None,
    };

    Ok(Some(AiSearchResultData {
        repository,
        score: (score * 10.0).round() / 10.0,
        explanation_zh,
        reasons,
        citations,
        keywords: matched_keywords,
        ai_summary: row.summary_zh,
    }))
}

fn build_search_citations(
    row: &SearchRepositoryRow,
    matched_keywords: &[String],
    query_tokens: &[String],
) -> Vec<SearchCitationData> {
    let keywords = if matched_keywords.is_empty() {
        query_tokens
    } else {
        matched_keywords
    };
    let candidates = [
        ("仓库描述", row.description.as_deref()),
        ("AI 中文摘要", row.summary_zh.as_deref()),
        ("个人笔记", row.note_markdown.as_deref()),
        ("README 片段", row.readme_excerpt.as_deref()),
    ];

    candidates
        .into_iter()
        .filter_map(|(title, content)| {
            build_search_citation(title, content.unwrap_or_default(), keywords)
        })
        .take(3)
        .collect()
}

fn build_search_citation(
    title: &str,
    content: &str,
    keywords: &[String],
) -> Option<SearchCitationData> {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }

    let match_keyword = keywords
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|keyword| !keyword.is_empty())
        .find(|keyword| find_search_term_byte_index(&normalized, keyword).is_some());

    match match_keyword {
        Some(keyword) => Some(SearchCitationData {
            title: title.to_owned(),
            snippet: build_keyword_snippet(&normalized, keyword, 180),
        }),
        None if keywords.is_empty() => Some(SearchCitationData {
            title: title.to_owned(),
            snippet: truncate_chars(&normalized, 180),
        }),
        _ => None,
    }
}

fn build_keyword_snippet(content: &str, keyword: &str, max_chars: usize) -> String {
    let Some(byte_index) = find_search_term_byte_index(content, keyword) else {
        return truncate_chars(content, max_chars);
    };
    let match_char_index = content[..byte_index].chars().count();
    let context_before = max_chars / 3;
    let start_char = match_char_index.saturating_sub(context_before);
    let mut snippet = content
        .chars()
        .skip(start_char)
        .take(max_chars)
        .collect::<String>();

    if start_char > 0 {
        snippet = format!("...{snippet}");
    }
    if start_char + max_chars < content.chars().count() {
        snippet.push_str("...");
    }

    snippet
}

fn find_search_term_byte_index(content: &str, term: &str) -> Option<usize> {
    let normalized_term = term.trim();
    if normalized_term.is_empty() {
        return None;
    }
    if normalized_term
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
    {
        let normalized_content = content.to_ascii_lowercase();
        let normalized_term = normalized_term.to_ascii_lowercase();
        return normalized_content
            .match_indices(&normalized_term)
            .map(|(index, _)| index)
            .find(|index| {
                let bytes = normalized_content.as_bytes();
                let start_boundary = *index == 0 || !bytes[*index - 1].is_ascii_alphanumeric();
                let end = *index + normalized_term.len();
                let end_boundary = end == bytes.len() || !bytes[end].is_ascii_alphanumeric();
                start_boundary && end_boundary
            });
    }
    content.to_lowercase().find(&normalized_term.to_lowercase())
}

fn is_short_ascii_search_term(query: &str) -> bool {
    let normalized = query.trim();
    (1..=3).contains(&normalized.len())
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    for token in query
        .split(|character: char| {
            character.is_whitespace()
                || [
                    ',', '，', '.', '。', ';', '；', '!', '！', '?', '？', '(', ')', '（', '）',
                    '[', ']', '【', '】',
                ]
                .contains(&character)
        })
        .map(str::trim)
        .filter(|token| token.chars().count() >= 2)
    {
        push_unique(&mut tokens, token);
    }

    let chinese_chars = query
        .chars()
        .filter(|character| ('\u{4e00}'..='\u{9fff}').contains(character))
        .collect::<Vec<_>>();
    for window in chinese_chars.windows(2) {
        let token = window.iter().collect::<String>();
        push_unique(&mut tokens, &token);
    }

    if tokens.is_empty() {
        push_unique(&mut tokens, query);
    }

    tokens
}

fn contains_token(tokens: &[String], needle: &str) -> bool {
    tokens
        .iter()
        .any(|token| token.eq_ignore_ascii_case(needle))
}

fn search_result_uses_context(result: &AiSearchResultData) -> bool {
    result.reasons.iter().any(is_context_reason)
}

fn search_result_uses_vector(result: &AiSearchResultData) -> bool {
    result
        .reasons
        .iter()
        .any(|reason| reason.label == "语义相似命中")
}

fn is_context_reason(reason: &SearchMatchReasonData) -> bool {
    reason.label.starts_with("上下文") || reason.label == "上一轮结果命中"
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    let normalized = value.trim();
    if !normalized.is_empty() && !values.iter().any(|existing| existing == normalized) {
        values.push(normalized.to_owned());
    }
}

fn parse_optional_json_array(value: Option<&str>) -> Result<Vec<String>, String> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            parse_json_string_array(value, "SQLite 搜索数组解析失败")
        }
        _ => Ok(Vec::new()),
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut result = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        result.push_str("...");
    }
    result
}

fn execute_sqlite(database_path: &Path, sql: &str) -> Result<String, String> {
    let (mode, sql_body) = split_sqlite_mode(sql)?;
    let connection = Connection::open(database_path)
        .map_err(|error| format!("SQLite 数据库打开失败：{error}"))?;

    match mode {
        None => {
            connection
                .execute_batch(&sql_body)
                .map_err(|error| format!("SQLite 执行失败：{error}"))?;
            Ok(String::new())
        }
        Some(SqliteOutputMode::Json) => query_sqlite_json(&connection, &sql_body),
        Some(SqliteOutputMode::List) => query_sqlite_list(&connection, &sql_body),
    }
}

#[derive(Clone, Copy)]
enum SqliteOutputMode {
    Json,
    List,
}

fn split_sqlite_mode(sql: &str) -> Result<(Option<SqliteOutputMode>, String), String> {
    let mut mode = None;
    let mut sql_lines = Vec::new();
    let mut sql_body_started = false;

    for line in sql.lines() {
        let trimmed = line.trim();
        if !sql_body_started && trimmed.starts_with('.') {
            let mut parts = trimmed.split_whitespace();
            match (parts.next(), parts.next(), parts.next()) {
                (Some(".mode"), Some("json"), None) => mode = Some(SqliteOutputMode::Json),
                (Some(".mode"), Some("list"), None) => mode = Some(SqliteOutputMode::List),
                _ => return Err(format!("不支持的 SQLite 元命令：{trimmed}")),
            }
        } else {
            if !trimmed.is_empty() {
                sql_body_started = true;
            }
            sql_lines.push(line);
        }
    }

    Ok((mode, sql_lines.join("\n")))
}

fn query_sqlite_json(connection: &Connection, sql: &str) -> Result<String, String> {
    let mut statement = connection
        .prepare(sql.trim())
        .map_err(|error| format!("SQLite 查询准备失败：{error}"))?;
    let column_names = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement
        .query([])
        .map_err(|error| format!("SQLite 查询执行失败：{error}"))?;
    let mut values = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("SQLite 查询读取失败：{error}"))?
    {
        let mut object = serde_json::Map::new();
        for (index, column_name) in column_names.iter().enumerate() {
            let value = row
                .get_ref(index)
                .map_err(|error| format!("SQLite 字段读取失败：{error}"))?;
            object.insert(column_name.clone(), sqlite_value_to_json(value));
        }
        values.push(serde_json::Value::Object(object));
    }

    serde_json::to_string(&values).map_err(|error| format!("SQLite JSON 输出序列化失败：{error}"))
}

fn query_sqlite_list(connection: &Connection, sql: &str) -> Result<String, String> {
    let mut statement = connection
        .prepare(sql.trim())
        .map_err(|error| format!("SQLite 查询准备失败：{error}"))?;
    let column_count = statement.column_count();
    let mut rows = statement
        .query([])
        .map_err(|error| format!("SQLite 查询执行失败：{error}"))?;
    let mut lines = Vec::new();

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("SQLite 查询读取失败：{error}"))?
    {
        let mut fields = Vec::with_capacity(column_count);
        for index in 0..column_count {
            let value = row
                .get_ref(index)
                .map_err(|error| format!("SQLite 字段读取失败：{error}"))?;
            fields.push(sqlite_value_to_list_text(value));
        }
        lines.push(fields.join("|"));
    }

    Ok(lines.join("\n"))
}

fn sqlite_value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(value) => serde_json::Value::Number(value.into()),
        ValueRef::Real(value) => serde_json::Number::from_f64(value)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        ValueRef::Text(value) => serde_json::Value::String(String::from_utf8_lossy(value).into()),
        ValueRef::Blob(value) => serde_json::Value::Array(
            value
                .iter()
                .map(|byte| serde_json::Value::Number((*byte).into()))
                .collect(),
        ),
    }
}

fn sqlite_value_to_list_text(value: ValueRef<'_>) -> String {
    match value {
        ValueRef::Null => String::new(),
        ValueRef::Integer(value) => value.to_string(),
        ValueRef::Real(value) => value.to_string(),
        ValueRef::Text(value) => String::from_utf8_lossy(value).into(),
        ValueRef::Blob(value) => value
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
    }
}

fn parse_json_rows<T>(output: &str, error_message: &str) -> Result<Vec<T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    let normalized_output = output.trim();

    if normalized_output.is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<T>>(normalized_output)
        .map_err(|error| format!("{error_message}：{error}"))
}

fn parse_json_string_array(value: &str, error_message: &str) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(value).map_err(|error| format!("{error_message}：{error}"))
}

fn next_local_id(prefix: &str) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("本地时间读取失败：{error}"))?
        .as_nanos();

    Ok(format!("{prefix}_{timestamp}"))
}

fn normalize_optional_text(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn normalize_required_text(value: &str, error_message: &str) -> Result<String, String> {
    let normalized = value.trim();

    if normalized.is_empty() {
        Err(error_message.to_owned())
    } else {
        Ok(normalized.to_owned())
    }
}

fn normalize_reading_status(value: &str) -> Result<&'static str, String> {
    match value {
        "unread" => Ok("unread"),
        "read" => Ok("read"),
        "later" => Ok("later"),
        _ => Err("阅读状态只能是 unread、read 或 later".to_owned()),
    }
}

fn normalize_recommendation_candidate_status(value: &str) -> Result<&'static str, String> {
    match value {
        "new" => Ok("new"),
        "marked" => Ok("marked"),
        "ignored" => Ok("ignored"),
        "starred" => Ok("starred"),
        _ => Err("推荐候选状态只能是 new、marked、ignored 或 starred".to_owned()),
    }
}

fn normalize_recommendation_category(value: &str) -> Result<&'static str, String> {
    RECOMMENDATION_CATEGORY_OPTIONS
        .iter()
        .find_map(|(category, _)| (*category == value).then_some(*category))
        .ok_or_else(|| "推荐候选类型无效，请重新选择。".to_owned())
}

fn recommendation_category_sql_expression(table_alias: &str) -> String {
    let searchable_text = format!(
        "LOWER(' ' || COALESCE({table_alias}.full_name, '') || ' ' || COALESCE({table_alias}.description, '') || ' ' || COALESCE({table_alias}.language, '') || ' ' || COALESCE({table_alias}.topics_json, '') || ' ')"
    );
    format!(
        r#"CASE
  WHEN {searchable_text} LIKE '%"ai"%'
    OR {searchable_text} LIKE '%"agent"%'
    OR {searchable_text} LIKE '%"llm"%'
    OR {searchable_text} LIKE '%artificial-intelligence%'
    OR {searchable_text} LIKE '%machine-learning%'
    OR {searchable_text} LIKE '%large language model%'
    OR {searchable_text} LIKE '%openai%'
    OR {searchable_text} LIKE '% ai %' THEN 'ai-agent'
  WHEN {searchable_text} LIKE '%"desktop"%'
    OR {searchable_text} LIKE '%"tauri"%'
    OR {searchable_text} LIKE '%"electron"%'
    OR {searchable_text} LIKE '%"macos"%'
    OR {searchable_text} LIKE '%"gtk"%'
    OR {searchable_text} LIKE '% desktop %' THEN 'desktop'
  WHEN {searchable_text} LIKE '%"frontend"%'
    OR {searchable_text} LIKE '%"react"%'
    OR {searchable_text} LIKE '%"vue"%'
    OR {searchable_text} LIKE '%"svelte"%'
    OR {searchable_text} LIKE '%"nextjs"%'
    OR {searchable_text} LIKE '%"browser"%'
    OR {searchable_text} LIKE '% web interface%'
    OR {searchable_text} LIKE '% web app%' THEN 'web'
  WHEN {searchable_text} LIKE '%"backend"%'
    OR {searchable_text} LIKE '%"api"%'
    OR {searchable_text} LIKE '%"server"%'
    OR {searchable_text} LIKE '%"graphql"%'
    OR {searchable_text} LIKE '%microservice%'
    OR {searchable_text} LIKE '% api server%' THEN 'backend'
  WHEN {searchable_text} LIKE '%"database"%'
    OR {searchable_text} LIKE '%"sql"%'
    OR {searchable_text} LIKE '%"analytics"%'
    OR {searchable_text} LIKE '%data-engineering%'
    OR {searchable_text} LIKE '%vector database%' THEN 'data'
  WHEN {searchable_text} LIKE '%"devops"%'
    OR {searchable_text} LIKE '%"kubernetes"%'
    OR {searchable_text} LIKE '%"docker"%'
    OR {searchable_text} LIKE '%"terraform"%'
    OR {searchable_text} LIKE '%"infrastructure"%'
    OR {searchable_text} LIKE '%"ci-cd"%'
    OR {searchable_text} LIKE '%deployment tool%' THEN 'devops'
  WHEN {searchable_text} LIKE '%"developer-tools"%'
    OR {searchable_text} LIKE '%"cli"%'
    OR {searchable_text} LIKE '%"sdk"%'
    OR {searchable_text} LIKE '%"editor"%'
    OR {searchable_text} LIKE '%"linter"%'
    OR {searchable_text} LIKE '%command line%'
    OR {searchable_text} LIKE '%developer tool%' THEN 'developer-tools'
  WHEN {searchable_text} LIKE '%"tutorial"%'
    OR {searchable_text} LIKE '%"documentation"%'
    OR {searchable_text} LIKE '%"awesome"%'
    OR {searchable_text} LIKE '%"course"%'
    OR {searchable_text} LIKE '% learning %'
    OR {searchable_text} LIKE '% tutorial%' THEN 'learning'
  ELSE 'other'
END"#
    )
}

fn sql_like_pattern(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");

    sql_text(&format!("%{escaped}%"))
}

fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_optional_text(value: Option<&str>) -> String {
    value.map(sql_text).unwrap_or_else(|| "NULL".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_storage(name: &str) -> (AppStorage, PathBuf) {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-{name}-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };
        storage.migrate().expect("初始化测试库");
        (storage, database_path)
    }

    #[test]
    fn sql_like_pattern_escapes_wildcards_and_quotes() {
        assert_eq!(sql_like_pattern("50%_owner's"), "'%50\\%\\_owner''s%'");
    }

    #[test]
    fn embedded_sqlite_executor_keeps_json_and_list_modes() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-embedded-sqlite-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));

        execute_sqlite(
            &database_path,
            r#"
CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO items (name) VALUES ('alpha'), ('beta');
"#,
        )
        .expect("内嵌 SQLite 应能执行批量 SQL");

        let list_output = execute_sqlite(
            &database_path,
            r#"
.mode list
SELECT COUNT(*) FROM items;
"#,
        )
        .expect("内嵌 SQLite 应能输出 list 模式");
        assert_eq!(list_output.trim(), "2");

        let json_output = execute_sqlite(
            &database_path,
            r#"
.mode json
SELECT id, name FROM items ORDER BY id;
"#,
        )
        .expect("内嵌 SQLite 应能输出 JSON 模式");
        let rows =
            serde_json::from_str::<serde_json::Value>(&json_output).expect("JSON 模式输出应可解析");
        assert_eq!(rows[0]["id"], 1);
        assert_eq!(rows[0]["name"], "alpha");
        assert_eq!(rows[1]["name"], "beta");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn embedded_sqlite_executor_allows_dot_prefixed_lines_inside_sql_text() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-dot-prefixed-readme-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));

        execute_sqlite(
            &database_path,
            r#"
CREATE TABLE readmes (content TEXT NOT NULL);
INSERT INTO readmes (content) VALUES ('README section
.github/workflows/ GitHub Actions workflows, including GHCR image publishing');
"#,
        )
        .expect("SQL 文本中的行首点号不应被当成 SQLite 元命令");

        let output = execute_sqlite(
            &database_path,
            r#"
.mode list
SELECT content FROM readmes;
"#,
        )
        .expect("应能读回包含行首点号的文本");

        assert!(output.contains(".github/workflows/ GitHub Actions workflows"));

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn initialization_resets_incompatible_local_test_database() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-incompatible-schema-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        execute_sqlite(
            &database_path,
            r#"
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
INSERT INTO schema_migrations(version, name, applied_at)
VALUES ('001', 'initial_schema', '2026-01-01T00:00:00Z');
CREATE TABLE repo_ai_documents (
  repo_id TEXT PRIMARY KEY,
  summary_zh TEXT NOT NULL
);
INSERT INTO repo_ai_documents(repo_id, summary_zh)
VALUES ('legacy-repo', '旧测试数据');
"#,
        )
        .expect("应能准备旧测试库");
        let legacy_sidecar_paths: Vec<PathBuf> = sqlite_database_files(&database_path)
            .into_iter()
            .filter(|path| path != &database_path)
            .collect();
        for path in &legacy_sidecar_paths {
            std::fs::write(path, "legacy sqlite sidecar").expect("应能准备旧 SQLite 旁路文件");
        }
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("不兼容旧测试库应自动删除并重建");

        let ai_columns = execute_sqlite(
            &database_path,
            r#"
.mode list
PRAGMA table_info(repo_ai_documents);
"#,
        )
        .expect("应能读取重建后的 AI 文档表结构");
        assert!(ai_columns.contains("|readme_zh|"));
        assert!(ai_columns.contains("|input_tokens|"));
        assert!(ai_columns.contains("|output_tokens|"));

        let recommendation_table_count = execute_sqlite(
            &database_path,
            r#"
.mode list
SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'github_recommendation_candidates';
"#,
        )
        .expect("应能读取重建后的推荐候选表");
        assert_eq!(recommendation_table_count.trim(), "1");

        let legacy_row_count = execute_sqlite(
            &database_path,
            r#"
.mode list
SELECT COUNT(*) FROM repo_ai_documents WHERE repo_id = 'legacy-repo';
"#,
        )
        .expect("应能确认旧测试数据已清理");
        assert_eq!(legacy_row_count.trim(), "0");
        for path in legacy_sidecar_paths {
            assert!(
                !path.exists(),
                "不兼容旧库重建后不应保留 SQLite 旁路文件：{}",
                path.display()
            );
        }

        let _ = remove_sqlite_database_files(&database_path);
    }

    #[test]
    fn startup_removes_legacy_local_test_database_without_migrating() {
        let data_dir = std::env::temp_dir().join(format!(
            "gsat-legacy-cleanup-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        std::fs::create_dir_all(&data_dir).expect("应能准备本地测试数据目录");
        let old_named_database_path = data_dir.join("stars-ai-tools.sqlite3");
        execute_sqlite(
            &old_named_database_path,
            r#"
CREATE TABLE legacy_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO legacy_items (name) VALUES ('old-local-data');
"#,
        )
        .expect("应能准备旧命名测试库");
        let old_named_paths = sqlite_database_files(&old_named_database_path);
        for path in old_named_paths
            .iter()
            .filter(|path| path != &&old_named_database_path)
        {
            std::fs::write(path, "legacy sqlite sidecar").expect("应能准备旧命名 SQLite 旁路文件");
        }

        remove_legacy_sqlite_database_files(&data_dir).expect("旧命名测试库应被直接清理");

        for path in old_named_paths {
            assert!(
                !path.exists(),
                "旧命名测试库不应保留或迁移：{}",
                path.display()
            );
        }
        assert!(
            !data_dir.join("gsat.sqlite3").exists(),
            "旧测试库清理不应生成新的 GSAT 数据库"
        );

        let _ = std::fs::remove_dir_all(data_dir);
    }

    #[test]
    fn list_active_repositories_uses_supported_mode_and_tracks_renamed_full_name() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-active-repository-list-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");

        let repository = StarredRepository {
            id: "1001:42".to_owned(),
            account_id: "1001".to_owned(),
            owner: "old-owner".to_owned(),
            name: "old-name".to_owned(),
            full_name: "old-owner/old-name".to_owned(),
            description: Some("旧仓库名".to_owned()),
            language: Some("TypeScript".to_owned()),
            topics_json: "[]".to_owned(),
            html_url: "https://github.com/old-owner/old-name".to_owned(),
            stars_count: 100,
            forks_count: 10,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: Some("2026-01-02T00:00:00Z".to_owned()),
        };
        storage
            .upsert_repositories(&[repository])
            .expect("首次写入仓库");

        let renamed_repository = StarredRepository {
            id: "1001:42".to_owned(),
            account_id: "1001".to_owned(),
            owner: "new-owner".to_owned(),
            name: "new-name".to_owned(),
            full_name: "new-owner/new-name".to_owned(),
            description: Some("新仓库名".to_owned()),
            language: Some("Rust".to_owned()),
            topics_json: "[\"desktop\"]".to_owned(),
            html_url: "https://github.com/new-owner/new-name".to_owned(),
            stars_count: 120,
            forks_count: 12,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: Some("2026-01-03T00:00:00Z".to_owned()),
        };
        storage
            .upsert_repositories(&[renamed_repository])
            .expect("仓库改名后应可更新");

        let repositories = storage
            .list_active_repositories(Some("1001"))
            .expect("活跃仓库列表应使用当前 SQLite 支持的输出模式");
        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].id, "1001:42");
        assert_eq!(repositories[0].full_name, "new-owner/new-name");

        let _ = remove_sqlite_database_files(&database_path);
    }

    #[test]
    fn repository_filter_clause_combines_keyword_language_and_tag() {
        let clause = build_repository_filter_clause(&RepositoryListFilters {
            account_id: Some("acct_1"),
            keyword: Some("react"),
            language: Some("TypeScript"),
            tag_id: Some("tag_1"),
        });

        assert!(clause.contains("r.sync_status = 'active'"));
        assert!(clause.contains("r.account_id = 'acct_1'"));
        assert!(clause.contains("LIKE '%react%' ESCAPE '\\'"));
        assert!(clause.contains("r.language = 'TypeScript'"));
        assert!(clause.contains("rt.tag_id = 'tag_1'"));
        assert!(clause.matches(" AND ").count() >= 2);
    }

    #[test]
    fn recent_github_account_restores_cached_user() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-account-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
INSERT INTO github_accounts (id, login, avatar_url, token_ref, updated_at)
VALUES ('1001', 'alice', 'https://avatars.example/alice.png', 'test', '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入账号");

        let user = storage
            .get_recent_github_account()
            .expect("读取最近账号")
            .expect("应存在账号");
        assert_eq!(user.id, 1001);
        assert_eq!(user.login, "alice");
        assert_eq!(
            user.avatar_url.as_deref(),
            Some("https://avatars.example/alice.png")
        );
        assert_eq!(user.html_url, "https://github.com/alice");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn disconnected_github_account_is_not_restored_as_connected_user() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-disconnected-account-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
INSERT INTO github_accounts (id, login, avatar_url, token_ref, updated_at)
VALUES ('1001', 'alice', 'https://avatars.example/alice.png', 'test', '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入账号");

        assert!(storage
            .get_recent_github_account()
            .expect("读取最近账号")
            .is_some());

        storage
            .mark_github_accounts_disconnected()
            .expect("账号应能标记为已断开");

        assert!(storage
            .get_recent_github_account()
            .expect("读取最近账号")
            .is_none());

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn repository_detail_reads_persisted_readme_and_ai_document() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-detail-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES ('1001:42', '1001', 'owner', 'repo', '演示仓库', '可验证 README 与 AI 摘要持久化', 'TypeScript', '["ai","tools"]', 'https://github.com/owner/repo', 10, 1, '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入测试仓库");

        storage
            .save_readme(&ReadmeDocument {
                repo_id: "1001:42".to_owned(),
                raw_markdown: "# README\n\n真实说明".to_owned(),
                content_hash: "readme-hash".to_owned(),
                source_path: "README.md".to_owned(),
                fetched_at: "2026-01-01T00:00:00Z".to_owned(),
            })
            .expect("保存 README");
        storage
            .save_repository_ai_document(
                "1001:42",
                "这是中文摘要",
                Some("这是 README 中文整理"),
                &["关键词".to_owned(), "工具".to_owned()],
                &["AI 工具".to_owned(), "开发效率".to_owned()],
                "gpt-test",
                "v1",
                "readme-hash",
                321,
                45,
            )
            .expect("保存 AI 文档");

        let detail = storage
            .get_repository_detail("1001:42", "1001")
            .expect("读取仓库详情");
        let readme = detail.readme.expect("详情应包含 README");
        let ai_document = detail.ai_document.expect("详情应包含 AI 文档");

        assert_eq!(readme.raw_markdown, "# README\n\n真实说明");
        assert_eq!(readme.content_hash, "readme-hash");
        assert_eq!(readme.source_path, "README.md");
        assert_eq!(ai_document.summary_zh, "这是中文摘要");
        assert_eq!(
            ai_document.readme_zh.as_deref(),
            Some("这是 README 中文整理")
        );
        assert_eq!(ai_document.input_tokens, 321);
        assert_eq!(ai_document.output_tokens, 45);
        assert_eq!(ai_document.keywords, vec!["关键词", "工具"]);
        assert_eq!(ai_document.suggested_tags, vec!["AI 工具", "开发效率"]);
        assert_eq!(ai_document.model, "gpt-test");
        assert_eq!(ai_document.prompt_version, "v1");
        assert_eq!(ai_document.source_hash, "readme-hash");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn list_repository_tagging_sources_reads_all_repositories_without_limit() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-tagging-sources-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
WITH RECURSIVE numbers(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM numbers WHERE n < 1002
)
INSERT INTO repositories (id, account_id, owner, name, full_name, topics_json, html_url, stars_count, forks_count, starred_at)
SELECT
  '1001:' || n,
  '1001',
  'owner',
  'repo' || n,
  'owner/repo' || n,
  '[]',
  'https://github.com/owner/repo' || n,
  n,
  0,
  '2026-01-01T00:00:00Z'
FROM numbers;
"#,
            )
            .expect("写入超过一千个测试仓库");

        let all_sources = storage
            .list_repository_tagging_sources("1001", None)
            .expect("无 limit 时应读取全部标签源");
        let limited_sources = storage
            .list_repository_tagging_sources("1001", Some(10))
            .expect("显式 limit 应生效");

        assert_eq!(all_sources.len(), 1002);
        assert_eq!(limited_sources.len(), 10);
        assert_eq!(all_sources[0].full_name, "owner/repo1002");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn profile_stats_counts_only_active_repositories_for_account() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-profile-stats-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO github_accounts (id, login, token_ref) VALUES ('2002', 'bob', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at, sync_status)
VALUES
  ('1001:1', '1001', 'owner', 'active', 'owner/active', '当前账号 active 仓库', 'TypeScript', '[]', 'https://github.com/owner/active', 10, 1, '2026-01-03T00:00:00Z', 'active'),
  ('1001:2', '1001', 'owner', 'removed', 'owner/removed', '当前账号已取消 Star 仓库', 'Rust', '[]', 'https://github.com/owner/removed', 20, 1, '2026-01-02T00:00:00Z', 'removed'),
  ('2002:1', '2002', 'owner', 'other', 'owner/other', '其他账号仓库', 'Go', '[]', 'https://github.com/owner/other', 30, 1, '2026-01-01T00:00:00Z', 'active');
INSERT INTO annotations (repo_id, account_id, note_md)
VALUES
  ('1001:1', '1001', 'active note'),
  ('1001:2', '1001', 'removed note'),
  ('2002:1', '2002', 'other note');
INSERT INTO repo_ai_documents (repo_id, summary_zh, keywords_json, suggested_tags_json, model, prompt_version, source_hash, input_tokens, output_tokens, generated_at)
VALUES
  ('1001:1', '当前账号摘要', '[]', '[]', 'gpt-test', 'v1', 'hash-active', 120, 30, '2026-01-03T00:00:00Z'),
  ('1001:2', '已移除仓库摘要不应计入', '[]', '[]', 'gpt-test', 'v1', 'hash-removed', 999, 999, '2026-01-02T00:00:00Z'),
  ('2002:1', '其他账号摘要不应计入', '[]', '[]', 'gpt-test', 'v1', 'hash-other', 888, 888, '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入个人统计测试数据");

        let stats = storage.get_profile_stats("1001").expect("读取个人统计");
        let dashboard_stats = storage
            .get_dashboard_stats(Some("1001"))
            .expect("读取仪表盘统计");

        assert_eq!(stats.total_stars, 10);
        assert_eq!(stats.total_notes, 1);
        assert_eq!(stats.total_ai_words, "当前账号摘要".chars().count());
        assert_eq!(stats.total_ai_input_tokens, 120);
        assert_eq!(stats.total_ai_output_tokens, 30);
        assert_eq!(dashboard_stats.total_ai_input_tokens, 120);
        assert_eq!(dashboard_stats.total_ai_output_tokens, 30);
        assert_eq!(stats.language_breakdown.len(), 1);
        assert_eq!(stats.language_breakdown[0].language, "TypeScript");
        assert_eq!(stats.recent_repos.len(), 1);
        assert_eq!(stats.recent_repos[0].id, "1001:1");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn import_annotation_snapshot_matches_repository_by_full_name() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-import-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES ('1001:42', '1001', 'owner', 'repo', 'owner/repo', '[]', 'https://github.com/owner/repo', 10, 1, '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入测试仓库");

        let snapshot = AnnotationSnapshot {
            schema_version: 1,
            exported_at: "2026-01-01T00:00:00Z".to_owned(),
            account_id: "legacy".to_owned(),
            tags: vec![AnnotationSnapshotTag {
                name: "工具".to_owned(),
                color: Some("#3b82f6".to_owned()),
            }],
            repositories: vec![AnnotationSnapshotRepository {
                repository_id: "42".to_owned(),
                full_name: "owner/repo".to_owned(),
                note_markdown: "按 full_name 恢复".to_owned(),
                read_status: "later".to_owned(),
                tag_names: vec!["工具".to_owned()],
            }],
        };

        let summary = storage
            .import_annotation_snapshot("1001", &snapshot)
            .expect("导入注解快照");
        assert_eq!(summary.repository_count, 1);
        assert_eq!(summary.skipped_repository_count, 0);

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT note_md FROM annotations WHERE repo_id = '1001:42') || ',' ||
  (SELECT read_status FROM annotations WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM repo_tags WHERE repo_id = '1001:42');
"#,
            )
            .expect("读取导入结果");

        assert_eq!(rows.trim(), "按 full_name 恢复,later,1");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn export_annotation_snapshot_ignores_removed_repositories() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-export-active-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, topics_json, html_url, stars_count, forks_count, starred_at, sync_status)
VALUES
  ('1001:1', '1001', 'owner', 'active', 'owner/active', '[]', 'https://github.com/owner/active', 10, 1, '2026-01-02T00:00:00Z', 'active'),
  ('1001:2', '1001', 'owner', 'removed', 'owner/removed', '[]', 'https://github.com/owner/removed', 20, 1, '2026-01-01T00:00:00Z', 'removed');
INSERT INTO tags (id, account_id, name, color)
VALUES ('tag-1', '1001', '工具', '#3b82f6');
INSERT INTO annotations (repo_id, account_id, note_md, read_status)
VALUES
  ('1001:1', '1001', 'active note', 'later'),
  ('1001:2', '1001', 'removed note', 'read');
INSERT INTO repo_tags (repo_id, tag_id)
VALUES
  ('1001:1', 'tag-1'),
  ('1001:2', 'tag-1');
"#,
            )
            .expect("写入导出测试数据");

        let snapshot = storage
            .export_annotation_snapshot("1001")
            .expect("导出注解快照");

        assert_eq!(snapshot.repositories.len(), 1);
        assert_eq!(snapshot.repositories[0].repository_id, "1001:1");
        assert_eq!(snapshot.repositories[0].full_name, "owner/active");
        assert_eq!(snapshot.repositories[0].note_markdown, "active note");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn import_annotation_snapshot_skips_removed_repositories() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-import-active-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, topics_json, html_url, stars_count, forks_count, starred_at, sync_status)
VALUES
  ('1001:1', '1001', 'owner', 'active', 'owner/active', '[]', 'https://github.com/owner/active', 10, 1, '2026-01-02T00:00:00Z', 'active'),
  ('1001:2', '1001', 'owner', 'removed', 'owner/removed', '[]', 'https://github.com/owner/removed', 20, 1, '2026-01-01T00:00:00Z', 'removed');
INSERT INTO annotations (repo_id, account_id, note_md, read_status)
VALUES ('1001:2', '1001', '原有已移除仓库注解', 'unread');
"#,
            )
            .expect("写入导入测试数据");

        let snapshot = AnnotationSnapshot {
            schema_version: 1,
            exported_at: "2026-01-01T00:00:00Z".to_owned(),
            account_id: "legacy".to_owned(),
            tags: vec![AnnotationSnapshotTag {
                name: "工具".to_owned(),
                color: Some("#3b82f6".to_owned()),
            }],
            repositories: vec![
                AnnotationSnapshotRepository {
                    repository_id: "legacy-active".to_owned(),
                    full_name: "owner/active".to_owned(),
                    note_markdown: "恢复 active 仓库".to_owned(),
                    read_status: "read".to_owned(),
                    tag_names: vec!["工具".to_owned()],
                },
                AnnotationSnapshotRepository {
                    repository_id: "1001:2".to_owned(),
                    full_name: "owner/removed".to_owned(),
                    note_markdown: "不应恢复 removed 仓库".to_owned(),
                    read_status: "later".to_owned(),
                    tag_names: vec!["工具".to_owned()],
                },
            ],
        };

        let summary = storage
            .import_annotation_snapshot("1001", &snapshot)
            .expect("导入注解快照");
        assert_eq!(summary.repository_count, 1);
        assert_eq!(summary.skipped_repository_count, 1);

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT note_md FROM annotations WHERE repo_id = '1001:1') || ',' ||
  (SELECT read_status FROM annotations WHERE repo_id = '1001:1') || ',' ||
  (SELECT COUNT(*) FROM repo_tags WHERE repo_id = '1001:1') || ',' ||
  (SELECT note_md FROM annotations WHERE repo_id = '1001:2') || ',' ||
  (SELECT read_status FROM annotations WHERE repo_id = '1001:2') || ',' ||
  (SELECT COUNT(*) FROM repo_tags WHERE repo_id = '1001:2');
"#,
            )
            .expect("读取导入结果");

        assert_eq!(
            rows.trim(),
            "恢复 active 仓库,read,1,原有已移除仓库注解,unread,0"
        );

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn export_repository_library_snapshot_includes_active_repositories() {
        let (storage, database_path) = temp_storage("repository-library-export");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at, pushed_at, sync_status)
VALUES
  ('1001:1', '1001', 'owner', 'active', 'owner/active', 'active repo', 'Rust', '["cli","ai"]', 'https://github.com/owner/active', 10, 1, '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', 'active'),
  ('1001:2', '1001', 'owner', 'removed', 'owner/removed', 'removed repo', 'TypeScript', '[]', 'https://github.com/owner/removed', 20, 2, '2026-01-01T00:00:00Z', NULL, 'removed');
INSERT INTO tags (id, account_id, name, color)
VALUES ('tag-1', '1001', '工具', '#3b82f6');
INSERT INTO annotations (repo_id, account_id, note_md, read_status)
VALUES ('1001:1', '1001', 'active note', 'later');
INSERT INTO repo_tags (repo_id, tag_id)
VALUES ('1001:1', 'tag-1');
"#,
            )
            .expect("写入仓库快照测试数据");

        let snapshot = storage
            .export_repository_library_snapshot("1001")
            .expect("导出仓库快照");

        assert_eq!(snapshot.repositories.len(), 1);
        assert_eq!(snapshot.repositories[0].full_name, "owner/active");
        assert_eq!(snapshot.repositories[0].topics, vec!["cli", "ai"]);
        assert_eq!(snapshot.repositories[0].note_markdown, "active note");
        assert_eq!(snapshot.repositories[0].read_status, "later");
        assert_eq!(snapshot.repositories[0].tag_names, vec!["工具"]);

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn import_repository_library_snapshot_creates_missing_repositories() {
        let (storage, database_path) = temp_storage("repository-library-import-create");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");
        let snapshot = RepositoryLibrarySnapshot {
            schema_version: 1,
            exported_at: "2026-01-01T00:00:00Z".to_owned(),
            account_id: "legacy".to_owned(),
            tags: vec![AnnotationSnapshotTag {
                name: "工具".to_owned(),
                color: Some("#3b82f6".to_owned()),
            }],
            repositories: vec![RepositoryLibrarySnapshotRepository {
                full_name: "owner/repo".to_owned(),
                owner: "owner".to_owned(),
                name: "repo".to_owned(),
                description: Some("demo".to_owned()),
                language: Some("Rust".to_owned()),
                topics: vec!["cli".to_owned()],
                html_url: "https://github.com/owner/repo".to_owned(),
                stars_count: 42,
                forks_count: 3,
                starred_at: "2026-01-02T00:00:00Z".to_owned(),
                pushed_at: Some("2026-01-03T00:00:00Z".to_owned()),
                note_markdown: "shared note".to_owned(),
                read_status: "read".to_owned(),
                tag_names: vec!["工具".to_owned()],
            }],
        };

        let summary = storage
            .import_repository_library_snapshot("1001", &snapshot)
            .expect("导入仓库快照");
        assert_eq!(summary.repository_count, 1);
        assert_eq!(summary.created_repository_count, 1);
        assert_eq!(summary.updated_repository_count, 0);

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT id FROM repositories WHERE account_id = '1001' AND full_name = 'owner/repo') || ',' ||
  (SELECT sync_status FROM repositories WHERE account_id = '1001' AND full_name = 'owner/repo') || ',' ||
  (SELECT note_md FROM annotations WHERE repo_id = 'imported:1001:owner/repo') || ',' ||
  (SELECT COUNT(*) FROM repo_tags WHERE repo_id = 'imported:1001:owner/repo');
"#,
            )
            .expect("读取导入结果");

        assert_eq!(rows.trim(), "imported:1001:owner/repo,active,shared note,1");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn import_repository_library_snapshot_merges_existing_full_name() {
        let (storage, database_path) = temp_storage("repository-library-import-merge");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, topics_json, html_url, stars_count, forks_count, starred_at, sync_status)
VALUES ('1001:42', '1001', 'owner', 'repo', 'owner/repo', '[]', 'https://github.com/owner/repo', 1, 0, '2026-01-01T00:00:00Z', 'active');
INSERT INTO annotations (repo_id, account_id, note_md, read_status)
VALUES ('1001:42', '1001', 'old note', 'unread');
"#,
            )
            .expect("写入现有仓库");
        let snapshot = RepositoryLibrarySnapshot {
            schema_version: 1,
            exported_at: "2026-01-01T00:00:00Z".to_owned(),
            account_id: "legacy".to_owned(),
            tags: Vec::new(),
            repositories: vec![RepositoryLibrarySnapshotRepository {
                full_name: "OWNER/REPO".to_owned(),
                owner: "OWNER".to_owned(),
                name: "REPO".to_owned(),
                description: Some("updated".to_owned()),
                language: Some("TypeScript".to_owned()),
                topics: Vec::new(),
                html_url: "https://github.com/OWNER/REPO".to_owned(),
                stars_count: 99,
                forks_count: 5,
                starred_at: "2026-02-02T00:00:00Z".to_owned(),
                pushed_at: None,
                note_markdown: "new note".to_owned(),
                read_status: "later".to_owned(),
                tag_names: Vec::new(),
            }],
        };

        let summary = storage
            .import_repository_library_snapshot("1001", &snapshot)
            .expect("合并仓库快照");
        assert_eq!(summary.created_repository_count, 0);
        assert_eq!(summary.updated_repository_count, 1);

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT COUNT(*) FROM repositories WHERE account_id = '1001' AND lower(full_name) = 'owner/repo') || ',' ||
  (SELECT id FROM repositories WHERE account_id = '1001' AND id = '1001:42') || ',' ||
  (SELECT note_md FROM annotations WHERE repo_id = '1001:42') || ',' ||
  (SELECT read_status FROM annotations WHERE repo_id = '1001:42');
"#,
            )
            .expect("读取合并结果");

        assert_eq!(rows.trim(), "1,1001:42,new note,later");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn imported_repository_library_row_merges_with_future_github_sync() {
        let (storage, database_path) = temp_storage("repository-library-import-sync");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");
        let snapshot = RepositoryLibrarySnapshot {
            schema_version: 1,
            exported_at: "2026-01-01T00:00:00Z".to_owned(),
            account_id: "legacy".to_owned(),
            tags: Vec::new(),
            repositories: vec![RepositoryLibrarySnapshotRepository {
                full_name: "owner/repo".to_owned(),
                owner: "owner".to_owned(),
                name: "repo".to_owned(),
                description: None,
                language: None,
                topics: Vec::new(),
                html_url: "https://github.com/owner/repo".to_owned(),
                stars_count: 1,
                forks_count: 0,
                starred_at: "2026-01-02T00:00:00Z".to_owned(),
                pushed_at: None,
                note_markdown: "imported note".to_owned(),
                read_status: "read".to_owned(),
                tag_names: Vec::new(),
            }],
        };
        storage
            .import_repository_library_snapshot("1001", &snapshot)
            .expect("导入仓库快照");
        storage
            .upsert_repositories(&[StarredRepository {
                id: "1001:42".to_owned(),
                account_id: "1001".to_owned(),
                owner: "owner".to_owned(),
                name: "repo".to_owned(),
                full_name: "owner/repo".to_owned(),
                description: Some("real sync".to_owned()),
                language: Some("Rust".to_owned()),
                topics_json: r#"["synced"]"#.to_owned(),
                html_url: "https://github.com/owner/repo".to_owned(),
                stars_count: 100,
                forks_count: 7,
                starred_at: "2026-02-02T00:00:00Z".to_owned(),
                pushed_at: Some("2026-02-03T00:00:00Z".to_owned()),
            }])
            .expect("真实 GitHub 同步应按 fullName 合并导入仓库");

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT COUNT(*) FROM repositories WHERE account_id = '1001' AND full_name = 'owner/repo') || ',' ||
  (SELECT id FROM repositories WHERE account_id = '1001' AND full_name = 'owner/repo') || ',' ||
  (SELECT stars_count FROM repositories WHERE account_id = '1001' AND full_name = 'owner/repo') || ',' ||
  (SELECT note_md FROM annotations WHERE repo_id = 'imported:1001:owner/repo');
"#,
            )
            .expect("读取同步合并结果");

        assert_eq!(rows.trim(), "1,imported:1001:owner/repo,100,imported note");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn create_tag_reuses_existing_name_for_account() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-tag-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");

        let created = storage
            .create_tag("1001", "工具", Some("#3b82f6"))
            .expect("首次创建标签");
        let reused = storage
            .create_tag("1001", "工具", Some("#10b981"))
            .expect("重复创建标签应复用");

        assert_eq!(created.id, reused.id);
        assert_eq!(reused.name, "工具");
        assert_eq!(reused.color.as_deref(), Some("#10b981"));

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT COUNT(*) FROM tags WHERE account_id = '1001' AND name = '工具';
"#,
            )
            .expect("读取标签数量");

        assert_eq!(rows.trim(), "1");

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn ai_tag_assignments_match_repository_full_names_robustly() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-ai-tag-assignment-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'Owner', 'React-UI', 'Owner/React-UI', 'React UI toolkit', 'TypeScript', '["react","ui"]', 'https://github.com/Owner/React-UI', 10, 1, '2026-01-03T00:00:00Z');
"#,
            )
            .expect("写入 AI 标签测试数据");

        let summary = storage
            .apply_ai_tag_assignments(
                "1001",
                &[AiTagAssignment {
                    tag_name: "前端".to_owned(),
                    color: Some("#3b82f6".to_owned()),
                    repository_full_names: vec![
                        "HTTPS://github.com/Owner/React-UI.git".to_owned(),
                        "`owner/react-ui`".to_owned(),
                        "missing/repo".to_owned(),
                    ],
                }],
            )
            .expect("应用 AI 标签建议");

        assert_eq!(summary.tag_count, 1);
        assert_eq!(summary.linked_count, 1);
        assert_eq!(summary.skipped_repository_count, 1);

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT COUNT(*) FROM tags WHERE account_id = '1001' AND name = '前端') || ',' ||
  (SELECT COUNT(*) FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.repo_id = '1001:1' AND t.name = '前端');
"#,
            )
            .expect("读取 AI 标签写入结果");

        assert_eq!(rows.trim(), "1,1");

        let _ = remove_sqlite_database_files(&database_path);
    }

    #[test]
    fn ai_tag_assignments_do_not_create_empty_tags_for_unmatched_repositories() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-ai-empty-tag-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'owner', 'real-repo', 'owner/real-repo', '真实仓库', 'TypeScript', '[]', 'https://github.com/owner/real-repo', 10, 1, '2026-01-03T00:00:00Z');
"#,
            )
            .expect("写入 AI 空标签测试数据");

        let summary = storage
            .apply_ai_tag_assignments(
                "1001",
                &[AiTagAssignment {
                    tag_name: "幻觉标签".to_owned(),
                    color: Some("#ef4444".to_owned()),
                    repository_full_names: vec![
                        "ghost/missing-one".to_owned(),
                        "https://github.com/ghost/missing-two".to_owned(),
                    ],
                }],
            )
            .expect("应用全未命中 AI 标签建议");

        assert_eq!(summary.tag_count, 0);
        assert_eq!(summary.linked_count, 0);
        assert_eq!(summary.skipped_repository_count, 2);

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT COUNT(*) FROM tags WHERE account_id = '1001' AND name = '幻觉标签') || ',' ||
  (SELECT COUNT(*) FROM repo_tags);
"#,
            )
            .expect("读取空标签写入结果");

        assert_eq!(rows.trim(), "0,0");

        let _ = remove_sqlite_database_files(&database_path);
    }

    #[test]
    fn list_repository_page_applies_keyword_language_and_tag_intersection() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-filter-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'owner', 'react-ui', 'owner/react-ui', 'React UI toolkit', 'TypeScript', '["react","ui"]', 'https://github.com/owner/react-ui', 10, 1, '2026-01-03T00:00:00Z'),
  ('1001:2', '1001', 'owner', 'react-python', 'owner/react-python', 'React helper in Python', 'Python', '["react"]', 'https://github.com/owner/react-python', 9, 1, '2026-01-02T00:00:00Z'),
  ('1001:3', '1001', 'owner', 'plain-ui', 'owner/plain-ui', 'Plain UI toolkit', 'TypeScript', '["ui"]', 'https://github.com/owner/plain-ui', 8, 1, '2026-01-01T00:00:00Z'),
  ('1001:4', '1001', 'owner', 'unknown-language', 'owner/unknown-language', 'No detected language', NULL, '[]', 'https://github.com/owner/unknown-language', 7, 1, '2026-01-05T00:00:00Z'),
  ('1001:5', '1001', 'owner', 'blank-language', 'owner/blank-language', 'Blank language', '', '[]', 'https://github.com/owner/blank-language', 6, 1, '2026-01-04T00:00:00Z'),
  ('1001:6', '1001', 'owner', 'whitespace-language', 'owner/whitespace-language', 'Whitespace language', '   ', '[]', 'https://github.com/owner/whitespace-language', 5, 1, '2026-01-03T00:00:00Z');
INSERT INTO tags (id, account_id, name) VALUES ('tag-ui', '1001', 'UI');
INSERT INTO repo_tags (repo_id, tag_id) VALUES ('1001:1', 'tag-ui');
INSERT INTO repo_tags (repo_id, tag_id) VALUES ('1001:2', 'tag-ui');
"#,
            )
            .expect("写入筛选测试数据");

        let page = storage
            .list_repository_page(
                20,
                0,
                RepositoryListFilters {
                    account_id: Some("1001"),
                    keyword: Some("react"),
                    language: Some("TypeScript"),
                    tag_id: Some("tag-ui"),
                },
            )
            .expect("组合筛选应可执行");

        assert_eq!(page.total_count, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "1001:1");
        assert_eq!(page.items[0].full_name, "owner/react-ui");
        assert_eq!(page.items[0].tag_ids, vec!["tag-ui".to_owned()]);
        assert_eq!(page.items[0].tag_names, vec!["UI".to_owned()]);

        let other_language_page = storage
            .list_repository_page(
                20,
                0,
                RepositoryListFilters {
                    account_id: Some("1001"),
                    keyword: None,
                    language: Some("其他"),
                    tag_id: None,
                },
            )
            .expect("其他语言筛选应匹配未识别语言仓库");
        assert_eq!(other_language_page.total_count, 3);
        assert_eq!(
            other_language_page
                .items
                .iter()
                .map(|repository| repository.id.as_str())
                .collect::<Vec<_>>(),
            vec!["1001:4", "1001:5", "1001:6"]
        );

        let typescript_page = storage
            .list_repository_page(
                20,
                0,
                RepositoryListFilters {
                    account_id: Some("1001"),
                    keyword: None,
                    language: Some("TypeScript"),
                    tag_id: None,
                },
            )
            .expect("普通语言筛选仍应精确匹配");
        assert_eq!(typescript_page.total_count, 2);
        assert!(typescript_page
            .items
            .iter()
            .all(|repository| repository.language.as_deref() == Some("TypeScript")));

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn list_repository_page_matches_keyword_across_readme_ai_and_tags() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-knowledge-filter-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'owner', 'plain', 'owner/plain', '基础仓库', 'TypeScript', '[]', 'https://github.com/owner/plain', 10, 1, '2026-01-03T00:00:00Z'),
  ('1001:2', '1001', 'owner', 'other', 'owner/other', '无关仓库', 'Go', '[]', 'https://github.com/owner/other', 8, 1, '2026-01-02T00:00:00Z');
INSERT INTO repo_readmes (repo_id, raw_markdown, content_hash, source_path, fetched_at)
VALUES ('1001:1', 'This README explains vector-search indexing.', 'readme-hash', 'README.md', '2026-01-01T00:00:00Z');
INSERT INTO repo_ai_documents (repo_id, summary_zh, keywords_json, suggested_tags_json, model, prompt_version, source_hash, generated_at)
VALUES ('1001:1', '适合构建向量检索索引。', '["向量检索","索引"]', '["知识库"]', 'gpt-test', 'v1', 'readme-hash', '2026-01-01T00:00:00Z');
INSERT INTO tags (id, account_id, name) VALUES ('tag-knowledge', '1001', '知识库');
INSERT INTO repo_tags (repo_id, tag_id) VALUES ('1001:1', 'tag-knowledge');
"#,
            )
            .expect("写入知识筛选测试数据");

        let readme_page = storage
            .list_repository_page(
                20,
                0,
                RepositoryListFilters {
                    account_id: Some("1001"),
                    keyword: Some("vector-search"),
                    language: None,
                    tag_id: None,
                },
            )
            .expect("README 关键词筛选应可执行");
        let ai_page = storage
            .list_repository_page(
                20,
                0,
                RepositoryListFilters {
                    account_id: Some("1001"),
                    keyword: Some("向量检索"),
                    language: None,
                    tag_id: None,
                },
            )
            .expect("AI 关键词筛选应可执行");
        let tag_page = storage
            .list_repository_page(
                20,
                0,
                RepositoryListFilters {
                    account_id: Some("1001"),
                    keyword: Some("知识库"),
                    language: None,
                    tag_id: None,
                },
            )
            .expect("标签关键词筛选应可执行");

        assert_eq!(readme_page.items[0].id, "1001:1");
        assert_eq!(ai_page.items[0].id, "1001:1");
        assert_eq!(tag_page.items[0].id, "1001:1");
        assert_eq!(readme_page.total_count, 1);
        assert_eq!(ai_page.total_count, 1);
        assert_eq!(tag_page.total_count, 1);

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn search_repositories_reports_local_knowledge_mode() {
        let storage = AppStorage {
            database_path: std::env::temp_dir().join("gsat-search-mode-unused.sqlite3"),
        };
        let response = storage
            .search_repositories(RepositorySearchOptions {
                query: "  ",
                context_queries: &[],
                context_repository_ids: &[],
                limit: 20,
                offset: 0,
                max_results: 8,
                account_id: Some("1001"),
                vector_scores: &HashMap::new(),
                vector_error: None,
                metadata: None,
            })
            .expect("空查询应返回空结果");

        assert_eq!(response.mode, "local_knowledge");
        assert!(!response.ai_enhanced);
        assert_eq!(response.ai_query, None);
        assert!(response.results.is_empty());
    }

    #[test]
    fn search_repositories_reports_ai_enhanced_metadata() {
        let storage = AppStorage {
            database_path: std::env::temp_dir().join("gsat-search-ai-mode-unused.sqlite3"),
        };
        let metadata = AiSearchMetadata {
            original_query: "帮我找动画库".to_owned(),
            ai_enhanced: true,
            ai_query: Some("React animation spring".to_owned()),
            ai_rationale_zh: Some("AI 已提取 React 动画意图。".to_owned()),
            ai_error: None,
        };
        let response = storage
            .search_repositories(RepositorySearchOptions {
                query: "  ",
                context_queries: &[],
                context_repository_ids: &[],
                limit: 20,
                offset: 0,
                max_results: 8,
                account_id: Some("1001"),
                vector_scores: &HashMap::new(),
                vector_error: None,
                metadata: Some(metadata),
            })
            .expect("空查询也应保留 AI 搜索元数据");

        assert_eq!(response.query, "帮我找动画库");
        assert_eq!(response.mode, "local_knowledge");
        assert!(response.ai_enhanced);
        assert_eq!(response.ai_query.as_deref(), Some("React animation spring"));
        assert_eq!(
            response.ai_rationale_zh.as_deref(),
            Some("AI 已提取 React 动画意图。")
        );
    }

    #[test]
    fn search_row_scores_metadata_ai_summary_and_tags() {
        let row = SearchRepositoryRow {
            id: "1001:42".to_owned(),
            account_id: "1001".to_owned(),
            owner: "facebook".to_owned(),
            name: "react".to_owned(),
            full_name: "facebook/react".to_owned(),
            description: Some("用于构建 Web 和原生用户界面的库".to_owned()),
            language: Some("JavaScript".to_owned()),
            topics_json: r#"["ui","frontend","hooks"]"#.to_owned(),
            html_url: "https://github.com/facebook/react".to_owned(),
            stars_count: 213_000,
            forks_count: 45_000,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: Some("2026-01-02T00:00:00Z".to_owned()),
            has_readme: 1,
            note_markdown: Some("重点关注组件化和状态管理".to_owned()),
            summary_zh: Some("React 适合构建组件化 UI，支持 Hooks 和声明式视图。".to_owned()),
            keywords_json: Some(r#"["组件化","Hooks","UI"]"#.to_owned()),
            suggested_tags_json: Some(r#"["前端框架","UI"]"#.to_owned()),
            readme_excerpt: Some("Declarative views make your code predictable.".to_owned()),
            tag_names_json: r#"["前端框架","UI"]"#.to_owned(),
        };

        let query_tokens = tokenize_query("组件化 UI");
        let context_tokens = Vec::new();
        let context_repository_ids = HashSet::new();
        let result = score_search_row(
            row,
            "组件化 UI",
            &query_tokens,
            &context_tokens,
            &context_repository_ids,
            None,
        )
        .expect("搜索评分应可执行")
        .expect("应命中搜索结果");

        assert_eq!(result.repository.full_name, "facebook/react");
        assert_eq!(result.repository.language.as_deref(), Some("JavaScript"));
        assert!(result.repository.has_readme);
        assert!(result.score > 0.0);
        assert!(result.keywords.iter().any(|keyword| keyword == "组件化"));
        assert!(result
            .reasons
            .iter()
            .any(|reason| reason.label.contains("AI")));
        assert!(result
            .citations
            .iter()
            .any(|citation| citation.title == "AI 中文摘要"
                && citation.snippet.contains("组件化 UI")));
        assert!(result.explanation_zh.contains("React 适合构建组件化 UI"));
    }

    #[test]
    fn search_row_preserves_context_reason_when_reason_limit_is_full() {
        let row = SearchRepositoryRow {
            id: "1001:43".to_owned(),
            account_id: "1001".to_owned(),
            owner: "owner".to_owned(),
            name: "react-ui".to_owned(),
            full_name: "owner/react-ui".to_owned(),
            description: Some("React UI component library".to_owned()),
            language: Some("TypeScript".to_owned()),
            topics_json: r#"["frontend","hooks","ui"]"#.to_owned(),
            html_url: "https://github.com/owner/react-ui".to_owned(),
            stars_count: 10_000,
            forks_count: 500,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: Some("2026-01-02T00:00:00Z".to_owned()),
            has_readme: 1,
            note_markdown: Some("适合离线缓存场景的组件知识库".to_owned()),
            summary_zh: Some("React UI 组件库，支持 Hooks 和前端工程化。".to_owned()),
            keywords_json: Some(r#"["React","UI","Hooks"]"#.to_owned()),
            suggested_tags_json: Some(r#"["前端","组件库"]"#.to_owned()),
            readme_excerpt: Some("A frontend hooks component toolkit.".to_owned()),
            tag_names_json: r#"["前端","组件库"]"#.to_owned(),
        };
        let query_tokens = tokenize_query("React UI TypeScript frontend hooks component");
        let context_tokens = tokenize_query("离线缓存");
        let context_repository_ids = HashSet::new();

        let result = score_search_row(
            row,
            "React UI TypeScript frontend hooks component",
            &query_tokens,
            &context_tokens,
            &context_repository_ids,
            None,
        )
        .expect("搜索评分应可执行")
        .expect("应命中搜索结果");

        assert!(result.reasons.len() <= 5);
        assert!(result.reasons.iter().any(is_context_reason));
        assert!(result.explanation_zh.contains("结合本轮上下文"));
    }

    #[test]
    fn search_row_returns_readme_citation_when_readme_matches() {
        let row = SearchRepositoryRow {
            id: "1001:44".to_owned(),
            account_id: "1001".to_owned(),
            owner: "owner".to_owned(),
            name: "deploy-tool".to_owned(),
            full_name: "owner/deploy-tool".to_owned(),
            description: Some("Command line helper".to_owned()),
            language: Some("Rust".to_owned()),
            topics_json: r#"["cli"]"#.to_owned(),
            html_url: "https://github.com/owner/deploy-tool".to_owned(),
            stars_count: 800,
            forks_count: 20,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: Some("2026-01-02T00:00:00Z".to_owned()),
            has_readme: 1,
            note_markdown: None,
            summary_zh: None,
            keywords_json: None,
            suggested_tags_json: None,
            readme_excerpt: Some(
                "Install the binary, configure deployment target, and run deploy-tool release."
                    .to_owned(),
            ),
            tag_names_json: "[]".to_owned(),
        };
        let query_tokens = tokenize_query("deployment target release");
        let context_tokens = Vec::new();
        let context_repository_ids = HashSet::new();

        let result = score_search_row(
            row,
            "deployment target release",
            &query_tokens,
            &context_tokens,
            &context_repository_ids,
            None,
        )
        .expect("搜索评分应可执行")
        .expect("README 命中时应返回结果");

        assert!(result
            .citations
            .iter()
            .any(|citation| citation.title == "README 片段"
                && citation.snippet.contains("deployment target")));
    }

    #[test]
    fn search_row_rejects_weak_keyword_but_accepts_vector_match() {
        let make_row = || SearchRepositoryRow {
            id: "1001:45".to_owned(),
            account_id: "1001".to_owned(),
            owner: "owner".to_owned(),
            name: "semantic-tool".to_owned(),
            full_name: "owner/semantic-tool".to_owned(),
            description: Some("Command line helper".to_owned()),
            language: Some("Rust".to_owned()),
            topics_json: r#"["cli"]"#.to_owned(),
            html_url: "https://github.com/owner/semantic-tool".to_owned(),
            stars_count: 600,
            forks_count: 20,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: None,
            has_readme: 1,
            note_markdown: None,
            summary_zh: None,
            keywords_json: None,
            suggested_tags_json: None,
            readme_excerpt: Some("Supports obscure capability through a local plugin.".to_owned()),
            tag_names_json: "[]".to_owned(),
        };
        let query_tokens = tokenize_query("obscure");
        let context_repository_ids = HashSet::new();

        let weak_keyword = score_search_row(
            make_row(),
            "obscure",
            &query_tokens,
            &[],
            &context_repository_ids,
            None,
        )
        .expect("弱关键词评分应可执行");
        assert!(weak_keyword.is_none());

        let vector_match = score_search_row(
            make_row(),
            "obscure",
            &query_tokens,
            &[],
            &context_repository_ids,
            Some(0.91),
        )
        .expect("向量评分应可执行")
        .expect("高相似度向量应允许语义召回");
        assert!(vector_match
            .reasons
            .iter()
            .any(|reason| reason.label == "语义相似命中"));
        assert!(vector_match.score > 40.0);
    }

    #[test]
    fn multi_term_keyword_search_requires_more_than_one_matching_term() {
        let row = SearchRepositoryRow {
            id: "1001:46".to_owned(),
            account_id: "1001".to_owned(),
            owner: "owner".to_owned(),
            name: "react-form".to_owned(),
            full_name: "owner/react-form".to_owned(),
            description: Some("React form component library".to_owned()),
            language: Some("TypeScript".to_owned()),
            topics_json: r#"["react","form"]"#.to_owned(),
            html_url: "https://github.com/owner/react-form".to_owned(),
            stars_count: 500,
            forks_count: 20,
            starred_at: "2026-01-01T00:00:00Z".to_owned(),
            pushed_at: None,
            has_readme: 0,
            note_markdown: None,
            summary_zh: None,
            keywords_json: None,
            suggested_tags_json: None,
            readme_excerpt: None,
            tag_names_json: "[]".to_owned(),
        };
        let query_tokens = tokenize_query("React animation");
        let result = score_search_row(
            row,
            "React animation",
            &query_tokens,
            &[],
            &HashSet::new(),
            None,
        )
        .expect("多词关键词评分应可执行");

        assert!(result.is_none());
    }

    #[test]
    fn search_repositories_enforces_hard_result_limit() {
        let (storage, database_path) = temp_storage("search-hard-limit");
        storage
            .execute_sql(
                "INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');",
            )
            .expect("写入测试账号");
        let values = (1..=15)
            .map(|index| {
                format!(
                    "('1001:{index}', '1001', 'owner', 'react-{index}', 'owner/react-{index}', 'React animation library', 'TypeScript', '[\"react\",\"animation\"]', 'https://github.com/owner/react-{index}', {}, 1, '2026-01-{:02}T00:00:00Z')",
                    100 + index,
                    index.min(15),
                )
            })
            .collect::<Vec<_>>()
            .join(",\n");
        storage
            .execute_sql(&format!(
                "INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at) VALUES {values};"
            ))
            .expect("写入搜索上限测试仓库");

        let response = storage
            .search_repositories(RepositorySearchOptions {
                query: "React animation",
                context_queries: &[],
                context_repository_ids: &[],
                limit: 100,
                offset: 0,
                max_results: 100,
                account_id: Some("1001"),
                vector_scores: &HashMap::new(),
                vector_error: None,
                metadata: None,
            })
            .expect("搜索上限测试应可执行");

        assert_eq!(response.total_count, 10);
        assert_eq!(response.results.len(), 10);
        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn ai_acronym_search_rejects_substrings_and_unconfirmed_vector_hits() {
        assert!(find_search_term_byte_index("AI agent framework", "AI").is_some());
        assert!(find_search_term_byte_index("tailwind", "AI").is_none());
        assert!(find_search_term_byte_index("maintain styles", "AI").is_none());
        assert!(find_search_term_byte_index("available plugins", "AI").is_none());

        let (storage, database_path) = temp_storage("search-ai-acronym");
        storage
            .execute_sql(
                r#"
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'owner', 'ai-agent', 'owner/ai-agent', 'AI agent framework for local workflows', 'Python', '["ai","agent"]', 'https://github.com/owner/ai-agent', 100, 5, '2026-01-02T00:00:00Z'),
  ('1001:2', '1001', 'owner', 'tailwind-kit', 'owner/tailwind-kit', 'Utility CSS framework to maintain consistent styles', 'TypeScript', '["css","frontend"]', 'https://github.com/owner/tailwind-kit', 10000, 500, '2026-01-01T00:00:00Z');
INSERT INTO repo_readmes (repo_id, raw_markdown, content_hash, source_path, fetched_at)
VALUES ('1001:2', 'Build available utility classes and maintain design tokens.', 'hash-tailwind', 'README.md', '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入 AI 缩写检索测试数据");
        let vector_scores =
            HashMap::from([("1001:1".to_owned(), 0.82), ("1001:2".to_owned(), 0.99)]);

        let response = storage
            .search_repositories(RepositorySearchOptions {
                query: "AI",
                context_queries: &[],
                context_repository_ids: &[],
                limit: 10,
                offset: 0,
                max_results: 8,
                account_id: Some("1001"),
                vector_scores: &vector_scores,
                vector_error: None,
                metadata: None,
            })
            .expect("AI 缩写检索应可执行");

        assert_eq!(response.total_count, 1);
        assert_eq!(response.results[0].repository.full_name, "owner/ai-agent");
        assert!(!response
            .results
            .iter()
            .any(|result| result.repository.full_name == "owner/tailwind-kit"));
        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn repository_embedding_save_is_idempotent_and_readable() {
        let (storage, database_path) = temp_storage("embedding-persistence");
        storage
            .execute_sql(
                r#"
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES ('1001:1', '1001', 'owner', 'repo', 'owner/repo', 'Vector repository', 'Rust', '[]', 'https://github.com/owner/repo', 10, 1, '2026-01-01T00:00:00Z');
"#,
            )
            .expect("写入向量持久化测试数据");
        let first = StoredRepositoryEmbedding {
            account_id: "1001".to_owned(),
            repo_id: "1001:1".to_owned(),
            source_hash: "hash-1".to_owned(),
            model: "embedding-test".to_owned(),
            vector: vec![1.0, 0.0],
        };
        storage
            .save_repository_embedding(&first, "v-test")
            .expect("首次保存向量");
        let updated = StoredRepositoryEmbedding {
            source_hash: "hash-2".to_owned(),
            vector: vec![0.0, 1.0],
            ..first
        };
        storage
            .save_repository_embedding(&updated, "v-test")
            .expect("相同仓库向量应幂等更新");

        let records = storage
            .list_stored_repository_embeddings("1001", "embedding-test", 2, "v-test")
            .expect("应能读取保存的向量");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].source_hash, "hash-2");
        assert_eq!(records[0].vector, vec![0.0, 1.0]);
        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn search_repositories_does_not_create_matches_from_context_only() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-context-search-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'pmndrs', 'react-spring', 'pmndrs/react-spring', 'React animation library', 'TypeScript', '["react","animation"]', 'https://github.com/pmndrs/react-spring', 28000, 1200, '2026-01-03T00:00:00Z'),
  ('1001:2', '1001', 'owner', 'database-tool', 'owner/database-tool', 'SQLite desktop utility', 'Rust', '["sqlite"]', 'https://github.com/owner/database-tool', 900, 80, '2026-01-02T00:00:00Z');
"#,
            )
            .expect("写入上下文搜索测试数据");

        let without_context = storage
            .search_repositories(RepositorySearchOptions {
                query: "弹簧效果",
                context_queries: &[],
                context_repository_ids: &[],
                limit: 20,
                offset: 0,
                max_results: 8,
                account_id: Some("1001"),
                vector_scores: &HashMap::new(),
                vector_error: None,
                metadata: None,
            })
            .expect("无上下文搜索应可执行");
        let with_context = storage
            .search_repositories(RepositorySearchOptions {
                query: "弹簧效果",
                context_queries: &["React 动画库".to_owned()],
                context_repository_ids: &[],
                limit: 20,
                offset: 0,
                max_results: 8,
                account_id: Some("1001"),
                vector_scores: &HashMap::new(),
                vector_error: None,
                metadata: None,
            })
            .expect("上下文搜索应可执行");

        assert!(without_context.results.is_empty());
        assert!(without_context.context_queries_used.is_empty());
        assert!(!without_context.context_applied);
        assert!(with_context.results.is_empty());
        assert_eq!(with_context.context_queries_used, vec!["React 动画库"]);
        assert!(!with_context.context_applied);

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn search_repositories_boosts_previous_result_context() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-context-result-search-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, description, language, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES
  ('1001:1', '1001', 'owner', 'previous-result', 'owner/previous-result', 'A project from the previous result set', 'TypeScript', '["context"]', 'https://github.com/owner/previous-result', 100, 10, '2026-01-03T00:00:00Z'),
  ('1001:2', '1001', 'owner', 'fresh-result', 'owner/fresh-result', 'A fresh result without conversation context', 'TypeScript', '["context"]', 'https://github.com/owner/fresh-result', 100, 10, '2026-01-02T00:00:00Z');
"#,
            )
            .expect("写入上一轮结果上下文测试数据");

        let response = storage
            .search_repositories(RepositorySearchOptions {
                query: "context",
                context_queries: &["上一轮 TypeScript 工具".to_owned()],
                context_repository_ids: &["1001:1".to_owned()],
                limit: 20,
                offset: 0,
                max_results: 8,
                account_id: Some("1001"),
                vector_scores: &HashMap::new(),
                vector_error: None,
                metadata: None,
            })
            .expect("上一轮结果上下文搜索应可执行");

        assert_eq!(response.total_count, 2);
        assert!(response.context_applied);
        assert_eq!(
            response.results[0].repository.full_name,
            "owner/previous-result"
        );
        assert!(response.results[0]
            .reasons
            .iter()
            .any(|reason| reason.label == "上一轮结果命中"));

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn github_recommendation_candidates_persist_status() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-recommendation-candidates-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");

        let recommendations = vec![GitHubRepositoryRecommendation {
            candidate_id: None,
            candidate_status: None,
            candidate_updated_at: None,
            candidate_category: None,
            full_name: "better/hello-plus".to_owned(),
            description: Some("A better demo repository".to_owned()),
            language: Some("TypeScript".to_owned()),
            topics: vec!["ai".to_owned(), "stars".to_owned()],
            html_url: "https://github.com/better/hello-plus".to_owned(),
            stars_count: 4500,
            forks_count: 120,
            pushed_at: Some("2026-01-02T00:00:00Z".to_owned()),
        }];
        let states = storage
            .replace_github_recommendation_candidates(
                "1001",
                "基于参考仓库寻找更完整的实现",
                &["react animation stars:>1000".to_owned()],
                &recommendations,
            )
            .expect("推荐候选应可保存");
        assert_eq!(states["better/hello-plus"].status, "new");

        let marked = storage
            .update_github_recommendation_candidate_status("1001", "better/hello-plus", "marked")
            .expect("推荐候选应可标记关注");
        assert_eq!(marked.status, "marked");

        let ignored = storage
            .update_github_recommendation_candidate_status("1001", "better/hello-plus", "ignored")
            .expect("推荐候选应可忽略");
        assert_eq!(ignored.status, "ignored");

        let starred = storage
            .update_github_recommendation_candidate_status("1001", "better/hello-plus", "starred")
            .expect("推荐候选应可记录已加入 Stars");
        assert_eq!(starred.status, "starred");

        let refreshed = storage
            .replace_github_recommendation_candidates(
                "1001",
                "再次发现",
                &["react animation".to_owned()],
                &recommendations,
            )
            .expect("重复发现应更新候选元数据");
        assert_eq!(refreshed["better/hello-plus"].status, "starred");

        let additional_recommendations = vec![GitHubRepositoryRecommendation {
            candidate_id: None,
            candidate_status: None,
            candidate_updated_at: None,
            candidate_category: None,
            full_name: "better/second-choice".to_owned(),
            description: Some("Another candidate".to_owned()),
            language: Some("Rust".to_owned()),
            topics: vec!["desktop".to_owned()],
            html_url: "https://github.com/better/second-choice".to_owned(),
            stars_count: 3200,
            forks_count: 80,
            pushed_at: Some("2026-01-03T00:00:00Z".to_owned()),
        }];
        storage
            .replace_github_recommendation_candidates(
                "1001",
                "分页发现",
                &["rust desktop".to_owned()],
                &additional_recommendations,
            )
            .expect("第二个推荐候选应可保存");
        storage
            .update_github_recommendation_candidate_status("1001", "better/second-choice", "marked")
            .expect("第二个候选应可标记");

        let history = storage
            .list_github_recommendation_candidates("1001", None, None, 1, 0)
            .expect("推荐候选应可从本地列表恢复");
        assert_eq!(history.total_count, 1);
        assert_eq!(history.limit, 1);
        assert_eq!(history.offset, 0);
        assert_eq!(history.rationale_zh, "分页发现");
        assert_eq!(history.queries, vec!["rust desktop"]);
        assert_eq!(history.repositories.len(), 1);
        assert_eq!(history.repositories[0].full_name, "better/second-choice");
        assert!(history.repositories[0].candidate_updated_at.is_some());
        assert_eq!(
            history.repositories[0].candidate_status.as_deref(),
            Some("marked")
        );

        let starred_history = storage
            .list_github_recommendation_candidates("1001", Some("starred"), None, 12, 0)
            .expect("推荐候选应支持按状态读取");
        assert_eq!(starred_history.total_count, 0);
        assert!(starred_history.repositories.is_empty());

        let marked_history = storage
            .list_github_recommendation_candidates("1001", Some("ignored"), None, 12, 0)
            .expect("推荐候选应支持读取空状态列表");
        assert_eq!(marked_history.total_count, 0);
        assert!(marked_history.repositories.is_empty());

        storage
            .replace_github_recommendation_candidates("1001", "本批没有结果", &[], &[])
            .expect("空结果也应作为成功批次替换旧候选");
        let empty_history = storage
            .list_github_recommendation_candidates("1001", None, None, 12, 0)
            .expect("空批次后应可读取候选列表");
        assert_eq!(empty_history.total_count, 0);
        assert!(empty_history.repositories.is_empty());

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn github_recommendation_documents_persist_and_invalidate_stale_translation() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-recommendation-documents-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage.migrate().expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");

        storage
            .save_github_recommendation_readme(
                "1001",
                "owner/project",
                &ReadmeDocument {
                    repo_id: "owner/project".to_owned(),
                    raw_markdown: "# Project".to_owned(),
                    content_hash: "hash-v1".to_owned(),
                    source_path: "README.md".to_owned(),
                    fetched_at: "2026-07-10T10:00:00Z".to_owned(),
                },
            )
            .expect("推荐 README 应可保存");
        storage
            .save_github_recommendation_translation(
                "1001",
                "owner/project",
                "hash-v1",
                "# 项目",
                "gpt-test",
                120,
                80,
                9,
                4,
                false,
            )
            .expect("推荐 README 翻译应可保存");

        let cached_readme = storage
            .get_github_recommendation_readme("1001", "owner/project")
            .expect("推荐 README 应可读取")
            .expect("推荐 README 应存在");
        assert_eq!(cached_readme.raw_markdown, "# Project");
        let cached_translation = storage
            .get_github_recommendation_translation("1001", "owner/project", "hash-v1")
            .expect("推荐 README 翻译应可读取")
            .expect("推荐 README 翻译应存在");
        assert_eq!(cached_translation.markdown_zh, "# 项目");
        assert_eq!(cached_translation.model, "gpt-test");

        storage
            .save_github_recommendation_readme(
                "1001",
                "owner/project",
                &ReadmeDocument {
                    repo_id: "owner/project".to_owned(),
                    raw_markdown: "# Project v2".to_owned(),
                    content_hash: "hash-v2".to_owned(),
                    source_path: "README.md".to_owned(),
                    fetched_at: "2026-07-10T11:00:00Z".to_owned(),
                },
            )
            .expect("刷新后的推荐 README 应可保存");
        assert!(storage
            .get_github_recommendation_translation("1001", "owner/project", "hash-v2")
            .expect("刷新后应可检查翻译缓存")
            .is_none());

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn replacing_recommendation_batch_removes_only_retired_candidate_documents() {
        let (storage, database_path) = temp_storage("recommendation-document-cleanup");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");

        let recommendation = |full_name: &str| GitHubRepositoryRecommendation {
            candidate_id: None,
            candidate_status: None,
            candidate_updated_at: None,
            candidate_category: None,
            full_name: full_name.to_owned(),
            description: Some("候选项目".to_owned()),
            language: Some("Rust".to_owned()),
            topics: vec!["tool".to_owned()],
            html_url: format!("https://github.com/{full_name}"),
            stars_count: 100,
            forks_count: 10,
            pushed_at: Some("2026-07-01T00:00:00Z".to_owned()),
        };
        let initial_batch = vec![
            recommendation("demo/retired"),
            recommendation("demo/retained"),
        ];
        storage
            .replace_github_recommendation_candidates("1001", "第一批", &[], &initial_batch)
            .expect("第一批推荐候选应可保存");

        for full_name in ["demo/retired", "demo/retained", "demo/ranking-only"] {
            storage
                .save_github_recommendation_readme(
                    "1001",
                    full_name,
                    &ReadmeDocument {
                        repo_id: full_name.to_owned(),
                        raw_markdown: format!("# {full_name}"),
                        content_hash: format!("hash-{full_name}"),
                        source_path: "README.md".to_owned(),
                        fetched_at: "2026-07-10T10:00:00Z".to_owned(),
                    },
                )
                .expect("推荐 README 应可保存");
        }

        storage
            .replace_github_recommendation_candidates(
                "1001",
                "第二批",
                &[],
                &[recommendation("demo/retained")],
            )
            .expect("第二批推荐候选应可替换第一批");

        assert!(storage
            .get_github_recommendation_readme("1001", "demo/retired")
            .expect("应可检查已淘汰候选缓存")
            .is_none());
        assert!(storage
            .get_github_recommendation_readme("1001", "demo/retained")
            .expect("应可检查当前候选缓存")
            .is_some());
        assert!(storage
            .get_github_recommendation_readme("1001", "demo/ranking-only")
            .expect("应可检查非发现候选缓存")
            .is_some());

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn github_recommendation_candidates_support_category_filtering_before_pagination() {
        let (storage, database_path) = temp_storage("recommendation-category-filter");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
"#,
            )
            .expect("写入测试账号");

        let recommendation =
            |full_name: &str, description: &str, language: &str, topics: &[&str]| {
                GitHubRepositoryRecommendation {
                    candidate_id: None,
                    candidate_status: None,
                    candidate_updated_at: None,
                    candidate_category: None,
                    full_name: full_name.to_owned(),
                    description: Some(description.to_owned()),
                    language: Some(language.to_owned()),
                    topics: topics.iter().map(|topic| (*topic).to_owned()).collect(),
                    html_url: format!("https://github.com/{full_name}"),
                    stars_count: 100,
                    forks_count: 10,
                    pushed_at: Some("2026-07-01T00:00:00Z".to_owned()),
                }
            };
        let recommendations = vec![
            recommendation(
                "demo/agent",
                "LLM agent framework",
                "Python",
                &["ai", "agent"],
            ),
            recommendation(
                "demo/desktop",
                "Cross-platform desktop app",
                "Rust",
                &["tauri"],
            ),
            recommendation(
                "demo/web-one",
                "React component library",
                "TypeScript",
                &["frontend"],
            ),
            recommendation("demo/web-two", "Vue web interface", "TypeScript", &["vue"]),
            recommendation("demo/backend", "GraphQL API server", "Go", &["backend"]),
            recommendation("demo/data", "Vector database", "Rust", &["database"]),
            recommendation(
                "demo/devops",
                "Kubernetes deployment tools",
                "Go",
                &["devops"],
            ),
            recommendation(
                "demo/tools",
                "Developer command line utility",
                "Rust",
                &["cli"],
            ),
            recommendation(
                "demo/learning",
                "Practical programming tutorial",
                "Markdown",
                &["tutorial"],
            ),
            recommendation("demo/other", "A small creative experiment", "Zig", &[]),
        ];
        storage
            .replace_github_recommendation_candidates(
                "1001",
                "分类测试",
                &["topic:test".to_owned()],
                &recommendations,
            )
            .expect("推荐候选应可保存");

        let first_web_page = storage
            .list_github_recommendation_candidates("1001", None, Some("web"), 1, 0)
            .expect("推荐候选应支持按类型筛选");
        assert_eq!(first_web_page.total_count, 2);
        assert_eq!(first_web_page.repositories.len(), 1);
        assert_eq!(
            first_web_page.repositories[0].candidate_category.as_deref(),
            Some("web")
        );
        let second_web_page = storage
            .list_github_recommendation_candidates("1001", None, Some("web"), 1, 1)
            .expect("类型筛选应在偏移分页前执行");
        assert_eq!(second_web_page.total_count, 2);
        assert_eq!(second_web_page.repositories.len(), 1);
        assert_ne!(
            first_web_page.repositories[0].full_name,
            second_web_page.repositories[0].full_name
        );

        let all_candidates = storage
            .list_github_recommendation_candidates("1001", None, None, 20, 0)
            .expect("推荐候选分类应可读取");
        let category_counts = all_candidates
            .categories
            .iter()
            .map(|category| (category.value.as_str(), category.count))
            .collect::<HashMap<_, _>>();
        assert_eq!(category_counts["ai-agent"], 1);
        assert_eq!(category_counts["desktop"], 1);
        assert_eq!(category_counts["web"], 2);
        assert_eq!(category_counts["backend"], 1);
        assert_eq!(category_counts["data"], 1);
        assert_eq!(category_counts["devops"], 1);
        assert_eq!(category_counts["developer-tools"], 1);
        assert_eq!(category_counts["learning"], 1);
        assert_eq!(category_counts["other"], 1);

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn github_ranking_cache_round_trips_payload_and_timestamp() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-ranking-cache-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };
        storage.migrate().expect("初始化排行榜缓存测试库");

        storage
            .save_github_ranking_cache("1001:trending:all:1:20", "{\"items\":[]}", 1_720_000_000)
            .expect("排行榜缓存应可保存");
        let cached = storage
            .get_github_ranking_cache("1001:trending:all:1:20")
            .expect("排行榜缓存应可读取")
            .expect("排行榜缓存应存在");

        assert_eq!(cached.payload_json, "{\"items\":[]}");
        assert_eq!(cached.fetched_at, 1_720_000_000);
        assert!(storage
            .get_github_ranking_cache("missing")
            .expect("不存在的排行榜缓存应正常返回")
            .is_none());

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn personal_ranking_page_sorts_before_pagination() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-personal-ranking-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };
        storage.migrate().expect("初始化个人榜单测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, language, topics_json, html_url, stars_count, forks_count, starred_at, pushed_at)
VALUES
  ('1001:1', '1001', 'demo', 'one', 'demo/one', 'Rust', '[]', 'https://github.com/demo/one', 10, 1, '2026-07-01T00:00:00Z', '2026-07-09T00:00:00Z'),
  ('1001:2', '1001', 'demo', 'two', 'demo/two', 'Rust', '[]', 'https://github.com/demo/two', 500, 1, '2026-06-01T00:00:00Z', '2026-05-01T00:00:00Z'),
  ('1001:3', '1001', 'demo', 'three', 'demo/three', 'TypeScript', '[]', 'https://github.com/demo/three', 100, 1, '2026-07-08T00:00:00Z', '2026-07-10T00:00:00Z');
"#,
            )
            .expect("写入个人榜单测试数据");

        let stars_page = storage
            .list_personal_ranking_page(1, 0, "1001", None, "stars")
            .expect("Stars 榜单应可读取");
        assert_eq!(stars_page.total_count, 3);
        assert_eq!(stars_page.items[0].full_name, "demo/two");

        let updated_page = storage
            .list_personal_ranking_page(1, 0, "1001", None, "updated")
            .expect("更新榜单应可读取");
        assert_eq!(updated_page.items[0].full_name, "demo/three");

        let starred_second_page = storage
            .list_personal_ranking_page(1, 1, "1001", None, "starred")
            .expect("收藏榜单应支持分页");
        assert_eq!(starred_second_page.items[0].full_name, "demo/one");

        let rust_page = storage
            .list_personal_ranking_page(20, 0, "1001", Some("Rust"), "stars")
            .expect("个人榜单应支持语言筛选");
        assert_eq!(rust_page.total_count, 2);
        assert!(rust_page
            .items
            .iter()
            .all(|repository| repository.language.as_deref() == Some("Rust")));

        let _ = std::fs::remove_file(database_path);
    }
}
