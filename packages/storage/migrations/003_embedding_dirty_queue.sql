PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS embedding_dirty_queue (
  account_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  dirty_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_embedding_dirty_queue_account_dirty
ON embedding_dirty_queue(account_id, dirty_at, repo_id);

DELETE FROM embedding_dirty_queue
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM embedding_dirty_queue
  GROUP BY account_id, repo_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_dirty_queue_repository
ON embedding_dirty_queue(account_id, repo_id);

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_repository_knowledge_update
AFTER UPDATE OF full_name, description, language, topics_json ON repositories
WHEN OLD.full_name IS NOT NEW.full_name
  OR OLD.description IS NOT NEW.description
  OR OLD.language IS NOT NEW.language
  OR OLD.topics_json IS NOT NEW.topics_json
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  VALUES (NEW.account_id, NEW.id)
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_readme_insert
AFTER INSERT ON repo_readmes
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, NEW.repo_id FROM repositories WHERE id = NEW.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_readme_update
AFTER UPDATE OF raw_markdown, content_hash ON repo_readmes
WHEN OLD.content_hash IS NOT NEW.content_hash
  OR SUBSTR(OLD.raw_markdown, 1, 12000) IS NOT SUBSTR(NEW.raw_markdown, 1, 12000)
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, NEW.repo_id FROM repositories WHERE id = NEW.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_readme_delete
AFTER DELETE ON repo_readmes
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, OLD.repo_id FROM repositories WHERE id = OLD.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_ai_document_insert
AFTER INSERT ON repo_ai_documents
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, NEW.repo_id FROM repositories WHERE id = NEW.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_ai_document_update
AFTER UPDATE OF summary_zh, keywords_json, suggested_tags_json ON repo_ai_documents
WHEN OLD.summary_zh IS NOT NEW.summary_zh
  OR OLD.keywords_json IS NOT NEW.keywords_json
  OR OLD.suggested_tags_json IS NOT NEW.suggested_tags_json
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, NEW.repo_id FROM repositories WHERE id = NEW.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_ai_document_delete
AFTER DELETE ON repo_ai_documents
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, OLD.repo_id FROM repositories WHERE id = OLD.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_repository_tag_insert
AFTER INSERT ON repo_tags
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, NEW.repo_id FROM repositories WHERE id = NEW.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_repository_tag_delete
AFTER DELETE ON repo_tags
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT account_id, OLD.repo_id FROM repositories WHERE id = OLD.repo_id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_after_tag_name_update
AFTER UPDATE OF name ON tags
WHEN OLD.name IS NOT NEW.name
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT r.account_id, rt.repo_id
  FROM repo_tags rt JOIN repositories r ON r.id = rt.repo_id
  WHERE rt.tag_id = NEW.id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

CREATE TRIGGER IF NOT EXISTS queue_embedding_before_tag_delete
BEFORE DELETE ON tags
BEGIN
  INSERT INTO embedding_dirty_queue(account_id, repo_id)
  SELECT r.account_id, rt.repo_id
  FROM repo_tags rt JOIN repositories r ON r.id = rt.repo_id
  WHERE rt.tag_id = OLD.id
  ON CONFLICT(account_id, repo_id) DO UPDATE SET dirty_at = excluded.dirty_at;
END;

INSERT OR IGNORE INTO schema_migrations(version, name)
VALUES ('003', 'embedding_dirty_queue');
