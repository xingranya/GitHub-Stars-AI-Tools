PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS github_accounts (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  token_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  html_url TEXT NOT NULL,
  stars_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  starred_at TEXT NOT NULL,
  pushed_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'active' CHECK (sync_status IN ('active', 'removed', 'gone', 'error')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES github_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, full_name)
);

CREATE INDEX IF NOT EXISTS idx_repositories_account ON repositories(account_id);
CREATE INDEX IF NOT EXISTS idx_repositories_account_status_starred ON repositories(account_id, sync_status, starred_at DESC);
CREATE INDEX IF NOT EXISTS idx_repositories_account_language_status ON repositories(account_id, language, sync_status);
CREATE INDEX IF NOT EXISTS idx_repositories_language ON repositories(language);
CREATE INDEX IF NOT EXISTS idx_repositories_starred_at ON repositories(starred_at);
CREATE INDEX IF NOT EXISTS idx_repositories_sync_status ON repositories(sync_status);

CREATE TABLE IF NOT EXISTS repo_readmes (
  repo_id TEXT PRIMARY KEY,
  raw_markdown TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_path TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repo_readmes_content_hash ON repo_readmes(content_hash);

CREATE TABLE IF NOT EXISTS repo_ai_documents (
  repo_id TEXT PRIMARY KEY,
  summary_zh TEXT NOT NULL,
  readme_zh TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  suggested_tags_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repo_ai_documents_source_hash ON repo_ai_documents(source_hash);

CREATE TABLE IF NOT EXISTS repo_embeddings (
  repo_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('repository_knowledge')),
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, source_kind, model, model_version),
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repo_embeddings_model ON repo_embeddings(model, model_version);
CREATE INDEX IF NOT EXISTS idx_repo_embeddings_source_hash ON repo_embeddings(source_hash);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES github_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_account ON tags(account_id);

CREATE TABLE IF NOT EXISTS repo_tags (
  repo_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (repo_id, tag_id),
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_repo_tags_tag_repo ON repo_tags(tag_id, repo_id);

CREATE TABLE IF NOT EXISTS annotations (
  repo_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  note_md TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  read_status TEXT NOT NULL DEFAULT 'unread' CHECK (read_status IN ('unread', 'read', 'later')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES github_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_account ON annotations(account_id);
CREATE INDEX IF NOT EXISTS idx_annotations_account_repo ON annotations(account_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_annotations_read_status ON annotations(read_status);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sync_stars', 'fetch_readme', 'summarize', 'translate', 'embed')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  idempotency_key TEXT NOT NULL UNIQUE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES github_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_account_status ON jobs(account_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);

INSERT OR IGNORE INTO schema_migrations(version, name)
VALUES ('001', 'initial_schema');
