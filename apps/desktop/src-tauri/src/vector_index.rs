use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;
use zvec_rust::{
    initialize, Collection, CollectionSchema, DataType, Doc, FieldSchema, IndexParams, MetricType,
    SearchQuery,
};

const VECTOR_FIELD: &str = "embedding";
const COLLECTION_NAME: &str = "repository_embeddings";
const FINGERPRINT_FILE: &str = ".sources";
static ZVEC_INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
static ZVEC_OPERATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone)]
pub struct RepositoryVectorRecord {
    pub account_id: String,
    pub repo_id: String,
    pub source_hash: String,
    pub model: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VectorSearchHit {
    pub repo_id: String,
    pub score: f32,
}

#[derive(Debug, Clone)]
pub struct VectorSearchRequest {
    pub account_id: String,
    pub model: String,
    pub vector: Vec<f32>,
    pub limit: usize,
    pub min_score: f32,
}

#[derive(Debug, Clone)]
pub struct ZvecRepositoryIndex {
    base_dir: PathBuf,
}

impl ZvecRepositoryIndex {
    pub fn from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let base_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位向量索引目录：{error}"))?
            .join("vector-index");
        Ok(Self::new(base_dir))
    }

    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    pub fn replace_bucket(
        &self,
        account_id: &str,
        model: &str,
        dimensions: usize,
        records: &[RepositoryVectorRecord],
    ) -> Result<(), String> {
        for record in records {
            validate_vector(&record.vector)?;
            if record.account_id != account_id
                || record.model != model
                || record.vector.len() != dimensions
            {
                return Err(format!("仓库 {} 的向量分桶信息不一致", record.repo_id));
            }
        }
        let fingerprint = crate::embedding_state::fingerprint(
            records
                .iter()
                .map(|record| (record.repo_id.as_str(), record.source_hash.as_str())),
        );

        let _guard = lock_zvec()?;
        ensure_zvec_initialized()?;
        let path = self.bucket_path(account_id, model, dimensions);
        let staging_path = path.with_extension("rebuild");
        let backup_path = path.with_extension("backup");
        remove_directory_if_exists(&staging_path, "清理 zvec 临时索引失败")?;
        remove_directory_if_exists(&backup_path, "清理 zvec 备份索引失败")?;

        if records.is_empty() {
            write_bucket_fingerprint(&path, &fingerprint)?;
            remove_directory_if_exists(&path, "清理 zvec 索引失败")?;
            return Ok(());
        }

        let docs = records
            .iter()
            .map(repository_vector_doc)
            .collect::<Result<Vec<_>, _>>()?;
        let doc_refs = docs.iter().collect::<Vec<_>>();
        let collection = create_bucket(&staging_path, dimensions)?;
        let result = collection
            .upsert(&doc_refs)
            .map_err(zvec_error("批量更新 zvec 向量索引失败"))?;
        if result.error_count > 0 || result.success_count as usize != records.len() {
            return Err(format!(
                "批量更新 zvec 向量索引失败：成功 {} 条，失败 {} 条",
                result.success_count, result.error_count
            ));
        }
        collection
            .flush()
            .map_err(zvec_error("刷新 zvec 向量索引失败"))?;
        drop(collection);
        write_staged_bucket_fingerprint(&staging_path, &fingerprint)?;

        replace_directory(&path, &staging_path, &backup_path)
    }

    pub fn search(&self, request: &VectorSearchRequest) -> Result<Vec<VectorSearchHit>, String> {
        validate_vector(&request.vector)?;
        if request.limit == 0 {
            return Ok(Vec::new());
        }
        let _guard = lock_zvec()?;
        ensure_zvec_initialized()?;
        let path = self.bucket_path(&request.account_id, &request.model, request.vector.len());
        if !path.exists() {
            return Ok(Vec::new());
        }
        let collection = open_collection(&path)?;
        let query = SearchQuery::builder()
            .field_name(VECTOR_FIELD)
            .vector(&request.vector)
            .topk(request.limit.min(50) as i32)
            .output_fields(&["repo_id"])
            .build()
            .map_err(zvec_error("创建 zvec 查询失败"))?;
        let results = collection
            .query(&query)
            .map_err(zvec_error("执行 zvec 查询失败"))?;
        let mut hits = Vec::new();
        for doc in results {
            // zvec 的 Cosine score 是距离（0 表示完全相同），对外统一转换为相似度。
            let score = 1.0 - doc.get_score();
            if !score.is_finite() || score < request.min_score {
                continue;
            }
            let stored_repo_id = doc
                .get_string("repo_id")
                .map_err(zvec_error("读取 zvec 查询结果失败"))?
                .or_else(|| doc.get_pk().map(str::to_owned));
            if let Some(stored_repo_id) = stored_repo_id {
                let repo_id = decode_repository_id(&stored_repo_id)?;
                hits.push(VectorSearchHit { repo_id, score });
            }
        }
        Ok(hits)
    }

    pub fn count(&self, account_id: &str, model: &str, dimensions: usize) -> Result<usize, String> {
        let _guard = lock_zvec()?;
        ensure_zvec_initialized()?;
        let path = self.bucket_path(account_id, model, dimensions);
        if !path.exists() {
            return Ok(0);
        }
        let collection = open_collection(&path)?;
        let stats = collection
            .stats()
            .map_err(zvec_error("读取 zvec 索引状态失败"))?;
        Ok(stats.doc_count as usize)
    }

    pub fn bucket_fingerprint(
        &self,
        account_id: &str,
        model: &str,
        dimensions: usize,
    ) -> Result<Option<String>, String> {
        let _guard = lock_zvec()?;
        let path = self.bucket_path(account_id, model, dimensions);
        let staged_fingerprint_path = path.join(FINGERPRINT_FILE);
        let fingerprint_path = if staged_fingerprint_path.is_file() {
            staged_fingerprint_path
        } else {
            bucket_fingerprint_path(&path)
        };
        if !fingerprint_path.exists() {
            return Ok(None);
        }
        let fingerprint = fs::read_to_string(&fingerprint_path).map_err(|error| {
            format!(
                "读取 zvec 来源指纹失败（{}）：{error}",
                fingerprint_path.display()
            )
        })?;
        let fingerprint = fingerprint.trim();
        if fingerprint.is_empty() {
            return Err("zvec 来源指纹为空".to_owned());
        }
        Ok(Some(fingerprint.to_owned()))
    }

    pub fn reset_all(&self) -> Result<(), String> {
        let _guard = lock_zvec()?;
        if self.base_dir.exists() {
            fs::remove_dir_all(&self.base_dir).map_err(|error| {
                format!(
                    "清理全部 zvec 索引失败（{}）：{error}",
                    self.base_dir.display()
                )
            })?;
        }
        Ok(())
    }

    fn bucket_path(&self, account_id: &str, model: &str, dimensions: usize) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(account_id.as_bytes());
        hasher.update([0]);
        hasher.update(model.as_bytes());
        hasher.update([0]);
        hasher.update(dimensions.to_le_bytes());
        let digest = format!("{:x}", hasher.finalize());
        self.base_dir
            .join(format!("{}-{dimensions}", &digest[..20]))
    }
}

fn create_bucket(path: &Path, dimensions: usize) -> Result<Collection, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("向量索引路径没有父目录：{}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("创建向量索引根目录失败：{error}"))?;
    let dimensions =
        u32::try_from(dimensions).map_err(|_| "向量维度超过 zvec 支持范围".to_owned())?;
    let schema = CollectionSchema::builder(COLLECTION_NAME)
        .add_field(
            FieldSchema::new("repo_id", DataType::String, false, 0)
                .map_err(zvec_error("创建仓库字段失败"))?,
        )
        .add_field(
            FieldSchema::new("account_id", DataType::String, false, 0)
                .map_err(zvec_error("创建账号字段失败"))?,
        )
        .add_field(
            FieldSchema::new("source_hash", DataType::String, false, 0)
                .map_err(zvec_error("创建来源字段失败"))?,
        )
        .add_field(
            FieldSchema::new("model", DataType::String, false, 0)
                .map_err(zvec_error("创建模型字段失败"))?,
        )
        .add_vector_field(
            VECTOR_FIELD,
            DataType::VectorFp32,
            dimensions,
            IndexParams::hnsw(MetricType::Cosine, 16, 200)
                .map_err(zvec_error("创建 HNSW 索引参数失败"))?,
        )
        .build()
        .map_err(zvec_error("创建 zvec schema 失败"))?;
    Collection::create_and_open(path_to_string(path)?.as_str(), &schema, None)
        .map_err(zvec_error("创建 zvec collection 失败"))
}

fn replace_directory(path: &Path, staging_path: &Path, backup_path: &Path) -> Result<(), String> {
    let had_existing = path.exists();
    if had_existing {
        fs::rename(path, backup_path)
            .map_err(|error| format!("备份现有 zvec 索引失败（{}）：{error}", path.display()))?;
    }

    if let Err(error) = fs::rename(staging_path, path) {
        let restore_error = if had_existing {
            fs::rename(backup_path, path).err()
        } else {
            None
        };
        return match restore_error {
            Some(restore_error) => Err(format!(
                "切换 zvec 新索引失败：{error}；恢复旧索引也失败：{restore_error}"
            )),
            None => Err(format!("切换 zvec 新索引失败：{error}")),
        };
    }

    remove_directory_if_exists(backup_path, "清理 zvec 备份索引失败")
}

fn remove_directory_if_exists(path: &Path, message: &str) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("{message}（{}）：{error}", path.display()))?;
    }
    Ok(())
}

fn bucket_fingerprint_path(bucket_path: &Path) -> PathBuf {
    bucket_path.with_extension("sources")
}

fn write_bucket_fingerprint(bucket_path: &Path, fingerprint: &str) -> Result<(), String> {
    let fingerprint_path = bucket_fingerprint_path(bucket_path);
    let parent = fingerprint_path
        .parent()
        .ok_or_else(|| format!("向量指纹路径没有父目录：{}", fingerprint_path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("创建向量索引根目录失败：{error}"))?;
    let staging_path = fingerprint_path.with_extension("sources.tmp");
    fs::write(&staging_path, fingerprint).map_err(|error| {
        format!(
            "写入 zvec 临时来源指纹失败（{}）：{error}",
            staging_path.display()
        )
    })?;
    fs::rename(&staging_path, &fingerprint_path).map_err(|error| {
        format!(
            "切换 zvec 来源指纹失败（{}）：{error}",
            fingerprint_path.display()
        )
    })
}

fn write_staged_bucket_fingerprint(bucket_path: &Path, fingerprint: &str) -> Result<(), String> {
    let fingerprint_path = bucket_path.join(FINGERPRINT_FILE);
    fs::write(&fingerprint_path, fingerprint).map_err(|error| {
        format!(
            "写入 zvec staging 来源指纹失败（{}）：{error}",
            fingerprint_path.display()
        )
    })
}

fn ensure_zvec_initialized() -> Result<(), String> {
    match ZVEC_INITIALIZED
        .get_or_init(|| initialize(None).map_err(|error| format!("初始化 zvec 失败：{error}")))
    {
        Ok(()) => Ok(()),
        Err(error) => Err(error.clone()),
    }
}

fn lock_zvec() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    ZVEC_OPERATION_LOCK
        .lock()
        .map_err(|_| "zvec 操作锁已损坏".to_owned())
}

fn open_collection(path: &Path) -> Result<Collection, String> {
    Collection::open(path_to_string(path)?.as_str(), None)
        .map_err(zvec_error("打开 zvec collection 失败"))
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("向量索引路径不是有效 UTF-8：{}", path.display()))
}

fn validate_vector(vector: &[f32]) -> Result<(), String> {
    if vector.is_empty() {
        return Err("向量不能为空".to_owned());
    }
    if vector.iter().any(|value| !value.is_finite()) {
        return Err("向量包含无效数值".to_owned());
    }
    Ok(())
}

fn repository_vector_doc(record: &RepositoryVectorRecord) -> Result<Doc, String> {
    let mut doc = Doc::new().map_err(zvec_error("创建向量文档失败"))?;
    let primary_key = repository_vector_primary_key(&record.repo_id);
    doc.set_pk(&primary_key);
    doc.add_string("repo_id", &encode_repository_id(&record.repo_id))
        .map_err(zvec_error("写入仓库编号失败"))?;
    doc.add_string("account_id", &record.account_id)
        .map_err(zvec_error("写入账号编号失败"))?;
    doc.add_string("source_hash", &record.source_hash)
        .map_err(zvec_error("写入向量来源哈希失败"))?;
    doc.add_string("model", &record.model)
        .map_err(zvec_error("写入向量模型失败"))?;
    doc.add_vector_f32(VECTOR_FIELD, &record.vector)
        .map_err(zvec_error("写入仓库向量失败"))?;
    Ok(doc)
}

fn repository_vector_primary_key(repo_id: &str) -> String {
    let digest = Sha256::digest(repo_id.as_bytes());
    let digest = format!("{digest:x}");
    format!("repo_{}", &digest[..24])
}

fn encode_repository_id(repo_id: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(7 + repo_id.len() * 2);
    encoded.push_str("repoid_");
    for byte in repo_id.as_bytes() {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn decode_repository_id(stored: &str) -> Result<String, String> {
    let Some(encoded) = stored.strip_prefix("repoid_") else {
        return Ok(stored.to_owned());
    };
    if encoded.len() % 2 != 0 {
        return Err("zvec 仓库编号编码长度无效".to_owned());
    }
    let bytes = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = decode_hex_digit(pair[0])?;
            let low = decode_hex_digit(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect::<Result<Vec<_>, String>>()?;
    String::from_utf8(bytes).map_err(|error| format!("zvec 仓库编号不是有效 UTF-8：{error}"))
}

fn decode_hex_digit(value: u8) -> Result<u8, String> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err("zvec 仓库编号包含无效十六进制字符".to_owned()),
    }
}

fn zvec_error(prefix: &'static str) -> impl FnOnce(zvec_rust::Error) -> String {
    move |error| format!("{prefix}：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ai, embedding};
    use rusqlite::{Connection, OpenFlags};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_index(name: &str) -> (ZvecRepositoryIndex, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间有效")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("gsat-zvec-{name}-{nonce}"));
        (ZvecRepositoryIndex::new(path.clone()), path)
    }

    fn record(account_id: &str, repo_id: &str, vector: &[f32]) -> RepositoryVectorRecord {
        RepositoryVectorRecord {
            account_id: account_id.to_owned(),
            repo_id: repo_id.to_owned(),
            source_hash: format!("hash-{repo_id}"),
            model: "embedding-test".to_owned(),
            vector: vector.to_vec(),
        }
    }

    #[test]
    fn zvec_index_persists_and_orders_cosine_hits() {
        let (index, path) = test_index("persistence");
        let records = vec![
            record("account-a", "rust-search", &[1.0, 0.0, 0.0]),
            record("account-a", "ui-tool", &[0.0, 1.0, 0.0]),
        ];
        index
            .replace_bucket("account-a", "embedding-test", 3, &records)
            .expect("批量写入向量");
        drop(index);

        let reopened = ZvecRepositoryIndex::new(path.clone());
        let hits = reopened
            .search(&VectorSearchRequest {
                account_id: "account-a".to_owned(),
                model: "embedding-test".to_owned(),
                vector: vec![0.95, 0.05, 0.0],
                limit: 2,
                min_score: 0.0,
            })
            .expect("重新打开后查询成功");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].repo_id, "rust-search");
        assert!(hits[0].score > hits[1].score);
        reopened.reset_all().expect("清理测试索引");
    }

    #[test]
    fn zvec_index_accepts_composite_repository_ids() {
        let (index, _) = test_index("composite-repository-id");
        let repo_id = "71560643:1279057919";
        let mut composite_record = record("71560643", repo_id, &[1.0, 0.0]);
        composite_record.source_hash = "source_hash_composite".to_owned();
        let records = vec![composite_record];

        index
            .replace_bucket("71560643", "embedding-test", 2, &records)
            .expect("复合仓库编号应能写入 zvec");
        let hits = index
            .search(&VectorSearchRequest {
                account_id: "71560643".to_owned(),
                model: "embedding-test".to_owned(),
                vector: vec![1.0, 0.0],
                limit: 1,
                min_score: 0.0,
            })
            .expect("复合仓库编号应能从 zvec 检索");

        assert_eq!(hits[0].repo_id, repo_id);
        assert!(!repository_vector_primary_key(repo_id).contains(':'));
        index.reset_all().expect("清理测试索引");
    }

    #[test]
    fn zvec_index_isolates_accounts_and_models() {
        let (index, _) = test_index("isolation");
        let account_a = vec![record("account-a", "repo-a", &[1.0, 0.0])];
        index
            .replace_bucket("account-a", "embedding-test", 2, &account_a)
            .expect("写入账号 A");
        let account_b = vec![record("account-b", "repo-b", &[1.0, 0.0])];
        index
            .replace_bucket("account-b", "embedding-test", 2, &account_b)
            .expect("写入账号 B");

        let hits = index
            .search(&VectorSearchRequest {
                account_id: "account-a".to_owned(),
                model: "embedding-test".to_owned(),
                vector: vec![1.0, 0.0],
                limit: 10,
                min_score: 0.0,
            })
            .expect("查询账号 A");
        assert_eq!(
            hits,
            vec![VectorSearchHit {
                repo_id: "repo-a".to_owned(),
                score: 1.0
            }]
        );

        let missing_model = index
            .search(&VectorSearchRequest {
                account_id: "account-a".to_owned(),
                model: "other-model".to_owned(),
                vector: vec![1.0, 0.0],
                limit: 10,
                min_score: 0.0,
            })
            .expect("不存在的模型返回空结果");
        assert!(missing_model.is_empty());
        index.reset_all().expect("清理测试索引");
    }

    #[test]
    fn zvec_bucket_replacement_is_validated_and_removes_stale_records() {
        let (index, _) = test_index("replace");
        let stale = vec![record("account-a", "stale", &[1.0, 0.0])];
        index
            .replace_bucket("account-a", "embedding-test", 2, &stale)
            .expect("写入待替换向量");
        let stale_fingerprint = index
            .bucket_fingerprint("account-a", "embedding-test", 2)
            .expect("读取旧索引指纹")
            .expect("旧索引应有指纹");

        let invalid = vec![record("account-b", "wrong-account", &[1.0, 0.0])];
        assert!(index
            .replace_bucket("account-a", "embedding-test", 2, &invalid)
            .is_err());
        assert_eq!(
            index
                .count("account-a", "embedding-test", 2)
                .expect("校验失败不应删除旧索引"),
            1
        );
        assert_eq!(
            index
                .bucket_fingerprint("account-a", "embedding-test", 2)
                .expect("校验失败后读取索引指纹")
                .as_deref(),
            Some(stale_fingerprint.as_str())
        );

        let replacement = vec![
            record("account-a", "semantic", &[1.0, 0.0]),
            record("account-a", "frontend", &[0.0, 1.0]),
        ];
        index
            .replace_bucket("account-a", "embedding-test", 2, &replacement)
            .expect("批量替换向量桶");
        let hits = index
            .search(&VectorSearchRequest {
                account_id: "account-a".to_owned(),
                model: "embedding-test".to_owned(),
                vector: vec![1.0, 0.0],
                limit: 10,
                min_score: 0.0,
            })
            .expect("替换后查询成功");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].repo_id, "semantic");
        assert!(!hits.iter().any(|hit| hit.repo_id == "stale"));
        assert_ne!(
            index
                .bucket_fingerprint("account-a", "embedding-test", 2)
                .expect("读取替换后的索引指纹")
                .as_deref(),
            Some(stale_fingerprint.as_str())
        );
        assert!(index
            .bucket_path("account-a", "embedding-test", 2)
            .join(FINGERPRINT_FILE)
            .is_file());

        index
            .replace_bucket("account-a", "embedding-test", 2, &[])
            .expect("空快照应能原子清理索引");
        assert_eq!(
            index
                .count("account-a", "embedding-test", 2)
                .expect("空快照索引计数应可读取"),
            0
        );
        assert_eq!(
            index
                .bucket_fingerprint("account-a", "embedding-test", 2)
                .expect("空快照指纹应可读取")
                .as_deref(),
            Some(crate::embedding_state::fingerprint(std::iter::empty()).as_str())
        );
        index.reset_all().expect("清理测试索引");
    }

    #[test]
    fn zvec_index_rejects_invalid_vectors_and_applies_threshold() {
        let (index, _) = test_index("validation");
        let invalid = vec![record("a", "empty", &[])];
        assert!(index
            .replace_bucket("a", "embedding-test", 2, &invalid)
            .is_err());
        let valid = vec![record("a", "orthogonal", &[0.0, 1.0])];
        index
            .replace_bucket("a", "embedding-test", 2, &valid)
            .expect("写入有效向量");
        let hits = index
            .search(&VectorSearchRequest {
                account_id: "a".to_owned(),
                model: "embedding-test".to_owned(),
                vector: vec![1.0, 0.0],
                limit: 10,
                min_score: 0.5,
            })
            .expect("阈值查询成功");
        assert!(hits.is_empty());
        index.reset_all().expect("清理测试索引");
    }

    #[test]
    #[ignore = "需要通过环境变量指定本机应用数据、模型缓存和账号"]
    fn local_user_catalog_vector_search_smoke() {
        let data_dir = std::env::var_os("GSAT_VECTOR_TEST_DATA_DIR")
            .map(PathBuf::from)
            .expect("请设置 GSAT_VECTOR_TEST_DATA_DIR");
        let cache_dir = std::env::var_os("GSAT_EMBEDDING_TEST_CACHE")
            .map(PathBuf::from)
            .expect("请设置 GSAT_EMBEDDING_TEST_CACHE");
        let account_id = std::env::var("GSAT_VECTOR_TEST_ACCOUNT_ID")
            .expect("请设置 GSAT_VECTOR_TEST_ACCOUNT_ID");
        let queries = std::env::var("GSAT_VECTOR_TEST_QUERIES")
            .unwrap_or_else(|_| {
                [
                    "Grok",
                    "轻量级进程内向量数据库",
                    "OCR document recognition",
                    "agentic video production",
                    "AI coding agent CLI",
                ]
                .join("|")
            })
            .split('|')
            .map(str::trim)
            .filter(|query| !query.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert!(!queries.is_empty(), "至少需要一条向量检索测试查询");

        let database_path = data_dir.join("gsat.sqlite3");
        let connection =
            Connection::open_with_flags(&database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .expect("应能以只读方式打开本机数据库");
        let active_repository_count = connection
            .query_row(
                "SELECT COUNT(*) FROM repositories WHERE sync_status = 'active' AND account_id = ?1",
                [&account_id],
                |row| row.get::<_, i64>(0),
            )
            .expect("应能统计活跃仓库");
        let profile = embedding::local_profile();
        let storage_model = profile.profile_id();
        let sqlite_vector_count = connection
            .query_row(
                "SELECT COUNT(*) FROM repo_embeddings e JOIN repositories r ON r.id = e.repo_id WHERE r.account_id = ?1 AND e.model = ?2 AND e.dimensions = ?3 AND e.model_version = ?4",
                rusqlite::params![
                    account_id,
                    storage_model,
                    embedding::LOCAL_DIMENSIONS as i64,
                    embedding::KNOWLEDGE_TEXT_VERSION,
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("应能统计 SQLite 向量");
        let index = ZvecRepositoryIndex::new(data_dir.join("vector-index"));
        let zvec_count = index
            .count(&account_id, &storage_model, embedding::LOCAL_DIMENSIONS)
            .expect("应能统计 zvec 文档");
        assert_eq!(active_repository_count, sqlite_vector_count);
        assert_eq!(sqlite_vector_count, zvec_count as i64);

        let service = embedding::EmbeddingService::new(
            ai::EmbeddingRequestConfig {
                enabled: true,
                provider: embedding::LOCAL_PROVIDER_ID.to_owned(),
                download_source: Some(embedding::LOCAL_DOWNLOAD_SOURCE_MODELSCOPE.to_owned()),
                api_key: String::new(),
                base_url: None,
                model: embedding::LOCAL_MODEL_ID.to_owned(),
                dimensions: embedding::LOCAL_DIMENSIONS,
                min_score: 0.72,
                max_results: 10,
            },
            cache_dir,
        );
        service
            .prepare(&|_| {})
            .expect("应能从现有缓存校验并加载本地模型");

        println!(
            "CATALOG active={active_repository_count} sqlite_vectors={sqlite_vector_count} zvec={zvec_count}"
        );
        for query in queries {
            let vector = service.embed_query(&query).expect("查询应能生成向量");
            let hits = index
                .search(&VectorSearchRequest {
                    account_id: account_id.clone(),
                    model: storage_model.clone(),
                    vector,
                    limit: 30,
                    min_score: 0.0,
                })
                .expect("zvec 查询应成功");
            assert!(!hits.is_empty(), "查询 {query} 不应没有任何 zvec 候选");
            println!("QUERY {query}");
            for hit in hits.iter().take(10) {
                let (full_name, description) = connection
                    .query_row(
                        "SELECT full_name, COALESCE(description, '') FROM repositories WHERE id = ?1",
                        [&hit.repo_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .expect("zvec 结果应能回查仓库");
                println!(
                    "  {:.4}\t{full_name}\t{}",
                    embedding::normalize_local_similarity(hit.score),
                    description.replace(['\n', '\r', '\t'], " ")
                );
            }
        }
    }
}
