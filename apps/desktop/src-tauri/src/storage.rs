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

pub struct StoredRepository {
    pub id: String,
    pub full_name: String,
}

pub struct RepositoryReconcileSummary {
    pub active_count: usize,
    pub created_count: usize,
    pub updated_count: usize,
    pub removed_count: usize,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryListPage {
    pub items: Vec<RepositoryListItem>,
    pub total_count: usize,
    pub limit: usize,
    pub offset: usize,
}

pub struct RepositoryListFilters<'a> {
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

impl AppStorage {
    pub fn from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("本地数据目录初始化失败：{error}"))?;

        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("本地数据目录创建失败：{error}"))?;

        let storage = Self {
            database_path: data_dir.join("stars-ai-tools.sqlite3"),
        };
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

    pub fn reconcile_starred_repositories(
        &self,
        account_id: &str,
        repositories: &[StarredRepository],
    ) -> Result<RepositoryReconcileSummary, String> {
        let existing_states = self.list_repository_sync_states(account_id)?;
        let incoming_ids = repositories
            .iter()
            .map(|repository| repository.id.as_str())
            .collect::<HashSet<_>>();
        let created_count = repositories
            .iter()
            .filter(|repository| !existing_states.contains_key(repository.id.as_str()))
            .count();
        let updated_count = repositories.len().saturating_sub(created_count);
        let removed_ids = existing_states
            .iter()
            .filter_map(|(repository_id, sync_status)| {
                (sync_status == "active" && !incoming_ids.contains(repository_id.as_str()))
                    .then(|| repository_id.to_owned())
            })
            .collect::<Vec<_>>();
        let removed_count = removed_ids.len();

        self.upsert_repositories(repositories)?;
        self.mark_repositories_removed(account_id, &removed_ids)?;

        Ok(RepositoryReconcileSummary {
            active_count: repositories.len(),
            created_count,
            updated_count,
            removed_count,
        })
    }

    pub fn list_active_repositories(&self) -> Result<Vec<StoredRepository>, String> {
        let sql = r#"
.mode tabs
SELECT id, full_name
FROM repositories
WHERE sync_status = 'active'
ORDER BY starred_at DESC;
"#;
        let output = self.query_sql(sql)?;

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
        let normalized_limit = limit.clamp(1, 1000);
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
  CASE WHEN rr.repo_id IS NULL THEN 0 ELSE 1 END AS has_readme
FROM repositories r
LEFT JOIN repo_readmes rr ON rr.repo_id = r.id
LEFT JOIN annotations a ON a.repo_id = r.id
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

    pub fn list_repository_languages(&self) -> Result<Vec<String>, String> {
        let sql = r#"
.mode json
SELECT DISTINCT language
FROM repositories
WHERE sync_status = 'active'
  AND language IS NOT NULL
  AND TRIM(language) != ''
ORDER BY language COLLATE NOCASE ASC;
"#;
        let rows = parse_json_rows::<RepositoryLanguageRow>(
            &self.query_sql(sql)?,
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
VALUES ({id}, {account_id}, {name}, {color}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
"#,
            id = sql_text(&id),
            account_id = sql_text(account_id),
            name = sql_text(&normalized_name),
            color = sql_optional_text(color),
        );

        self.execute_sql(&sql)?;
        self.get_tag(account_id, &id)
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
            if !local_repository_ids.contains(repository.repository_id.as_str()) {
                skipped_repository_count += 1;
                continue;
            }

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
                repository_id = sql_text(&repository.repository_id),
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
                    repository_id = sql_text(&repository.repository_id),
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

    fn list_repository_sync_states(
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

    fn mark_repositories_removed(
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

    fn ensure_repository_belongs_to_account(
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
LEFT JOIN annotations a ON a.repo_id = r.id
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

    fn migrate(&self) -> Result<(), String> {
        self.execute_sql(INITIAL_SCHEMA_SQL)
    }

    fn execute_sql(&self, sql: &str) -> Result<(), String> {
        execute_sqlite(&self.database_path, sql).map(|_| ())
    }

    fn query_sql(&self, sql: &str) -> Result<String, String> {
        execute_sqlite(&self.database_path, sql)
    }
}

impl TryFrom<RepositoryListRow> for RepositoryListItem {
    type Error = String;

    fn try_from(row: RepositoryListRow) -> Result<Self, Self::Error> {
        let topics = serde_json::from_str::<Vec<String>>(&row.topics_json)
            .map_err(|error| format!("SQLite topics_json 解析失败：{error}"))?;

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
        })
    }
}

fn build_repository_filter_clause(filters: &RepositoryListFilters<'_>) -> String {
    let mut clauses = vec!["r.sync_status = 'active'".to_owned()];

    if let Some(keyword) = normalize_optional_text(filters.keyword) {
        let pattern = sql_like_pattern(keyword);
        clauses.push(format!(
            "(r.full_name LIKE {pattern} ESCAPE '\\' OR r.description LIKE {pattern} ESCAPE '\\' OR r.language LIKE {pattern} ESCAPE '\\' OR r.topics_json LIKE {pattern} ESCAPE '\\' OR a.note_md LIKE {pattern} ESCAPE '\\')"
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
