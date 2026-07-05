use crate::auth::GitHubUser;
use crate::github::{ReadmeDocument, StarredRepository};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const INITIAL_SCHEMA_SQL: &str =
    include_str!("../../../../packages/storage/migrations/001_initial_schema.sql");

pub struct AppStorage {
    database_path: PathBuf,
}

#[derive(Clone)]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAiTagAssignmentsSummary {
    pub tag_count: usize,
    pub linked_count: usize,
    pub skipped_repository_count: usize,
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

pub struct AnnotationImportSummary {
    pub tag_count: usize,
    pub repository_count: usize,
    pub skipped_repository_count: usize,
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

impl AppStorage {
    pub fn from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("本地数据目录初始化失败：{error}"))?;

        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("本地数据目录创建失败：{error}"))?;

        let database_path = data_dir.join("gsat.sqlite3");
        let legacy_database_path = data_dir.join("stars-ai-tools.sqlite3");
        if !database_path.exists() && legacy_database_path.exists() {
            std::fs::copy(&legacy_database_path, &database_path)
                .map_err(|error| format!("本地旧数据库迁移失败：{error}"))?;
        }

        let storage = Self { database_path };
        storage.migrate()?;

        Ok(storage)
    }

    pub fn upsert_github_account(&self, user: &GitHubUser) -> Result<(), String> {
        let sql = format!(
            r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, avatar_url, token_ref, updated_at)
VALUES ({id}, {login}, {avatar_url}, 'macos-keychain:github-pat', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  login = excluded.login,
  avatar_url = excluded.avatar_url,
  token_ref = excluded.token_ref,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
"#,
            id = sql_text(&user.id.to_string()),
            login = sql_text(&user.login),
            avatar_url = sql_optional_text(user.avatar_url.as_deref()),
        );

        self.execute_sql(&sql)
    }

    pub fn get_recent_github_account(&self) -> Result<Option<GitHubUser>, String> {
        let sql = r#"
.mode json
SELECT id, login, avatar_url
FROM github_accounts
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
VALUES ({id}, {account_id});
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
.mode tabs
SELECT id, full_name
FROM repositories
WHERE sync_status = 'active'
  {account_clause}
ORDER BY starred_at DESC;
"#,
            account_clause = account_clause,
        );
        let output = self.query_sql(&sql)?;

        output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                let mut fields = line.split('\t');
                let id = fields
                    .next()
                    .ok_or_else(|| "SQLite 仓库查询结果缺少 id".to_owned())?;
                let full_name = fields
                    .next()
                    .ok_or_else(|| "SQLite 仓库查询结果缺少 full_name".to_owned())?;

                Ok(StoredRepository {
                    id: id.to_owned(),
                    full_name: full_name.to_owned(),
                })
            })
            .collect()
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

    pub fn list_repository_page(
        &self,
        limit: usize,
        offset: usize,
        filters: RepositoryListFilters<'_>,
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
	  ai.generated_at AS ai_generated_at
	FROM repositories r
	LEFT JOIN repo_readmes rr ON rr.repo_id = r.id
	LEFT JOIN repo_ai_documents ai ON ai.repo_id = r.id
		LEFT JOIN annotations a ON a.repo_id = r.id AND a.account_id = r.account_id
	WHERE {where_clause}
ORDER BY r.starred_at DESC
LIMIT {limit} OFFSET {offset};
"#,
            where_clause = where_clause,
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
        limit: usize,
    ) -> Result<Vec<RepositoryTaggingSource>, String> {
        let normalized_limit = limit.clamp(1, 1000);
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
LIMIT {limit};
"#,
            account_id = sql_text(account_id),
            limit = normalized_limit,
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
            if !seen_tags.insert(tag_name.to_lowercase()) {
                continue;
            }

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

            for full_name in &assignment.repository_full_names {
                let Some(repository_id) = repository_ids_by_full_name.get(full_name) else {
                    skipped_repository_count += 1;
                    continue;
                };
                if !seen_links.insert((repository_id.clone(), tag_name.to_lowercase())) {
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
                    repository_id = sql_text(repository_id),
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

    fn list_repository_ids(&self, account_id: &str) -> Result<HashSet<String>, String> {
        let states = self.list_repository_sync_states(account_id)?;

        Ok(states.into_keys().collect())
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
WHERE account_id = {account_id};
"#,
            account_id = sql_text(account_id),
        );
        let rows = parse_json_rows::<RepositoryFullNameIdRow>(
            &self.query_sql(&sql)?,
            "SQLite 仓库名称索引解析失败",
        )?;

        Ok(rows
            .into_iter()
            .map(|row| (row.full_name, row.id))
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
SELECT COUNT(*) FROM annotations WHERE note_md != '' AND account_id = {};
"#,
                sql_text(account_id)
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
            3,
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
            language_breakdown,
            monthly_trend,
            recent_repos: recent.items,
        })
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
INSERT INTO repo_ai_documents (repo_id, summary_zh, readme_zh, keywords_json, suggested_tags_json, model, prompt_version, source_hash, generated_at)
VALUES ({repo_id}, {summary}, {readme_zh}, {keywords}, {suggested}, {model}, {prompt_version}, {source_hash}, {timestamp})
ON CONFLICT(repo_id) DO UPDATE SET
  summary_zh = excluded.summary_zh,
  readme_zh = excluded.readme_zh,
  keywords_json = excluded.keywords_json,
  suggested_tags_json = excluded.suggested_tags_json,
  model = excluded.model,
  prompt_version = excluded.prompt_version,
  source_hash = excluded.source_hash,
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
            timestamp = sql_text(&timestamp),
        );

        self.execute_sql(&sql)
    }

    pub fn search_repositories(
        &self,
        query: &str,
        context_queries: &[String],
        limit: usize,
        account_id: Option<&str>,
    ) -> Result<AiSearchResponseData, String> {
        let normalized_query = query.trim();
        if normalized_query.is_empty() {
            return Ok(AiSearchResponseData {
                query: String::new(),
                mode: "local_knowledge".to_owned(),
                results: Vec::new(),
                total_count: 0,
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
        let context_text = context_queries
            .iter()
            .rev()
            .take(4)
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let scoring_query = if context_text.is_empty() {
            normalized_query.to_owned()
        } else {
            format!("{context_text} {normalized_query}")
        };
        let tokens = tokenize_query(&scoring_query);
        let mut results = rows
            .into_iter()
            .filter_map(|row| score_search_row(row, normalized_query, &tokens).transpose())
            .collect::<Result<Vec<_>, String>>()?;

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.repository.stars_count.cmp(&a.repository.stars_count))
        });
        let total_count = results.len();
        results.truncate(limit.clamp(1, 100));

        Ok(AiSearchResponseData {
            query: normalized_query.to_owned(),
            mode: "local_knowledge".to_owned(),
            results,
            total_count,
        })
    }

    fn migrate(&self) -> Result<(), String> {
        self.execute_sql(INITIAL_SCHEMA_SQL)?;
        self.migrate_repository_ids_to_account_scope()
    }

    fn migrate_repository_ids_to_account_scope(&self) -> Result<(), String> {
        self.execute_sql(
            r#"
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TEMP TABLE IF NOT EXISTS repository_id_migration (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL
);

DELETE FROM repository_id_migration;

INSERT INTO repository_id_migration (old_id, new_id)
SELECT id, account_id || ':' || id
FROM repositories
WHERE INSTR(id, ':') = 0;

UPDATE repo_readmes
SET repo_id = (
  SELECT new_id FROM repository_id_migration WHERE old_id = repo_readmes.repo_id
)
WHERE repo_id IN (SELECT old_id FROM repository_id_migration);

UPDATE repo_ai_documents
SET repo_id = (
  SELECT new_id FROM repository_id_migration WHERE old_id = repo_ai_documents.repo_id
)
WHERE repo_id IN (SELECT old_id FROM repository_id_migration);

UPDATE annotations
SET repo_id = (
  SELECT new_id FROM repository_id_migration WHERE old_id = annotations.repo_id
)
WHERE repo_id IN (SELECT old_id FROM repository_id_migration);

UPDATE repo_tags
SET repo_id = (
  SELECT new_id FROM repository_id_migration WHERE old_id = repo_tags.repo_id
)
WHERE repo_id IN (SELECT old_id FROM repository_id_migration);

UPDATE repositories
SET id = (
  SELECT new_id FROM repository_id_migration WHERE old_id = repositories.id
)
WHERE id IN (SELECT old_id FROM repository_id_migration);

DROP TABLE repository_id_migration;

COMMIT;
PRAGMA foreign_keys = ON;
"#,
        )
    }

    fn execute_sql(&self, sql: &str) -> Result<(), String> {
        execute_sqlite(&self.database_path, sql).map(|_| ())
    }

    fn query_sql(&self, sql: &str) -> Result<String, String> {
        execute_sqlite(&self.database_path, sql)
    }
}

// === 聚合统计返回类型 ===

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStatsData {
    pub total_repos: usize,
    pub total_stars: u64,
    pub total_readmes: usize,
    pub total_ai_summaries: usize,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSearchResultData {
    pub repository: RepositoryListItem,
    pub score: f64,
    pub explanation_zh: String,
    pub reasons: Vec<SearchMatchReasonData>,
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
        clauses.push(format!("r.language = {}", sql_text(language)));
    }

    if let Some(tag_id) = normalize_optional_text(filters.tag_id) {
        clauses.push(format!(
            "EXISTS (SELECT 1 FROM repo_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.repo_id = r.id AND t.account_id = r.account_id AND rt.tag_id = {})",
            sql_text(tag_id),
        ));
    }

    clauses.join(" AND ")
}

fn score_search_row(
    row: SearchRepositoryRow,
    query: &str,
    tokens: &[String],
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

    let mut score = 0.0_f64;
    let mut reasons = Vec::new();
    let mut matched_keywords = Vec::new();
    let lower_query = query.to_lowercase();

    for token in tokens {
        let token_lower = token.to_lowercase();
        for (label, value, weight) in &fields {
            let value_lower = value.to_lowercase();
            if value_lower.contains(&token_lower) {
                score += weight;
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

    if row.full_name.to_lowercase().contains(&lower_query) {
        score += 20.0;
    }
    if row
        .summary_zh
        .as_deref()
        .unwrap_or_default()
        .to_lowercase()
        .contains(&lower_query)
    {
        score += 18.0;
    }

    if score <= 0.0 {
        return Ok(None);
    }

    score += (row.stars_count as f64 + 1.0).log10().min(6.0);
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
        ai_generated_at: None,
    };

    let explanation_zh = if let Some(summary) = row.summary_zh.as_deref() {
        format!(
            "该仓库的名称、标签或 AI 摘要与“{query}”相关。摘要：{}",
            truncate_chars(summary, 120)
        )
    } else {
        format!("该仓库的基础元数据与“{query}”匹配，可作为候选项目继续查看 README 与笔记。")
    };

    Ok(Some(AiSearchResultData {
        repository,
        score: (score * 10.0).round() / 10.0,
        explanation_zh,
        reasons,
        keywords: matched_keywords,
        ai_summary: row.summary_zh,
    }))
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
    let mut child = Command::new("sqlite3")
        .arg(database_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("SQLite 进程启动失败：{error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "SQLite 输入流初始化失败".to_owned())?;
    stdin
        .write_all(sql.as_bytes())
        .map_err(|error| format!("SQLite 写入 SQL 失败：{error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("SQLite 执行失败：{error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if stderr.is_empty() {
            "SQLite 执行失败".to_owned()
        } else {
            format!("SQLite 执行失败：{stderr}")
        });
    }

    String::from_utf8(output.stdout).map_err(|_| "SQLite 输出不是有效文本".to_owned())
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

    #[test]
    fn sql_like_pattern_escapes_wildcards_and_quotes() {
        assert_eq!(sql_like_pattern("50%_owner's"), "'%50\\%\\_owner''s%'");
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
    fn migration_scopes_legacy_repository_ids_by_account() {
        let database_path = std::env::temp_dir().join(format!(
            "gsat-storage-test-{}.sqlite3",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间应可用")
                .as_nanos()
        ));
        let storage = AppStorage {
            database_path: database_path.clone(),
        };

        storage
            .execute_sql(INITIAL_SCHEMA_SQL)
            .expect("初始化测试库");
        storage
            .execute_sql(
                r#"
PRAGMA foreign_keys = ON;
INSERT INTO github_accounts (id, login, token_ref) VALUES ('1001', 'alice', 'test');
INSERT INTO repositories (id, account_id, owner, name, full_name, topics_json, html_url, stars_count, forks_count, starred_at)
VALUES ('42', '1001', 'owner', 'repo', 'owner/repo', '[]', 'https://github.com/owner/repo', 10, 1, '2026-01-01T00:00:00Z');
INSERT INTO repo_readmes (repo_id, raw_markdown, content_hash, source_path, fetched_at)
VALUES ('42', '# README', 'hash', 'README.md', '2026-01-01T00:00:00Z');
INSERT INTO repo_ai_documents (repo_id, summary_zh, keywords_json, suggested_tags_json, model, prompt_version, source_hash, generated_at)
VALUES ('42', '摘要', '[]', '[]', 'gpt-test', 'v1', 'hash', '2026-01-01T00:00:00Z');
INSERT INTO tags (id, account_id, name) VALUES ('tag_1', '1001', '工具');
INSERT INTO repo_tags (repo_id, tag_id) VALUES ('42', 'tag_1');
INSERT INTO annotations (repo_id, account_id, note_md) VALUES ('42', '1001', '笔记');
"#,
            )
            .expect("写入旧格式测试数据");

        storage
            .migrate_repository_ids_to_account_scope()
            .expect("迁移仓库 ID");

        let rows = storage
            .query_sql(
                r#"
.mode list
SELECT
  (SELECT COUNT(*) FROM repositories WHERE id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM repo_readmes WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM repo_ai_documents WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM annotations WHERE repo_id = '1001:42') || ',' ||
  (SELECT COUNT(*) FROM repo_tags WHERE repo_id = '1001:42');
"#,
            )
            .expect("读取迁移结果");

        assert_eq!(rows.trim(), "1,1,1,1,1");

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
        assert_eq!(ai_document.keywords, vec!["关键词", "工具"]);
        assert_eq!(ai_document.suggested_tags, vec!["AI 工具", "开发效率"]);
        assert_eq!(ai_document.model, "gpt-test");
        assert_eq!(ai_document.prompt_version, "v1");
        assert_eq!(ai_document.source_hash, "readme-hash");

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
  ('1001:3', '1001', 'owner', 'plain-ui', 'owner/plain-ui', 'Plain UI toolkit', 'TypeScript', '["ui"]', 'https://github.com/owner/plain-ui', 8, 1, '2026-01-01T00:00:00Z');
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

        let _ = std::fs::remove_file(database_path);
    }

    #[test]
    fn search_repositories_reports_local_knowledge_mode() {
        let storage = AppStorage {
            database_path: std::env::temp_dir().join("gsat-search-mode-unused.sqlite3"),
        };
        let response = storage
            .search_repositories("  ", &[], 20, Some("1001"))
            .expect("空查询应返回空结果");

        assert_eq!(response.mode, "local_knowledge");
        assert!(response.results.is_empty());
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

        let result = score_search_row(row, "组件化 UI", &tokenize_query("组件化 UI"))
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
        assert!(result.explanation_zh.contains("React 适合构建组件化 UI"));
    }
}
