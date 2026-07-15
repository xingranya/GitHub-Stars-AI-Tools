use crate::ai;
use fastembed::{InitOptionsUserDefined, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel};
use hf_hub::{api::sync::ApiBuilder, Repo, RepoType};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

pub const LOCAL_PROVIDER_ID: &str = "local";
pub const LOCAL_MODEL_ID: &str = "intfloat/multilingual-e5-small";
pub const LOCAL_MODEL_REVISION: &str = "614241f622f53c4eeff9890bdc4f31cfecc418b3";
pub const LOCAL_DOWNLOAD_SOURCE_MODELSCOPE: &str = "modelscope";
pub const LOCAL_DOWNLOAD_SOURCE_HUGGING_FACE: &str = "huggingface";
pub const LOCAL_DIMENSIONS: usize = 384;
pub const LOCAL_MAX_LENGTH: usize = 512;
pub const LOCAL_BATCH_SIZE: usize = 16;
pub const KNOWLEDGE_TEXT_VERSION: &str = "repository-knowledge-v2";
const QUERY_PREFIX: &str = "query: ";
const PASSAGE_PREFIX: &str = "passage: ";
const LOCAL_SIMILARITY_FLOOR: f32 = 0.70;
const LOCAL_SIMILARITY_RANGE: f32 = 1.0 - LOCAL_SIMILARITY_FLOOR;
const MODEL_CACHE_DIR: &str = "embedding-models";
const READY_MANIFEST_FILE: &str = "ready.json";
const MODELSCOPE_MODEL_ID: &str = "AI-ModelScope/multilingual-e5-small";
const MODELSCOPE_MODEL_REVISION: &str = "1565e8a4587b93daf1d719018d6f880645fbd6e3";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalModelDownloadSource {
    ModelScope,
    HuggingFace,
}

impl LocalModelDownloadSource {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.map(str::trim).filter(|value| !value.is_empty()) {
            None | Some(LOCAL_DOWNLOAD_SOURCE_MODELSCOPE) => Ok(Self::ModelScope),
            Some(LOCAL_DOWNLOAD_SOURCE_HUGGING_FACE) => Ok(Self::HuggingFace),
            Some(value) => Err(format!("不支持的本地模型下载源：{value}")),
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::ModelScope => "ModelScope 国内源",
            Self::HuggingFace => "Hugging Face 官方源",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
/// 描述一个可持久化隔离的 Embedding 模型与文本协议。
pub struct EmbeddingProfile {
    pub provider: String,
    pub model: String,
    pub revision: String,
    pub dimensions: usize,
    pub max_length: usize,
    pub query_prefix: String,
    pub passage_prefix: String,
    pub knowledge_text_version: String,
}

impl EmbeddingProfile {
    pub fn profile_id(&self) -> String {
        let serialized = serde_json::to_vec(self).expect("Embedding profile 应可序列化");
        format!("embedding-{:x}", Sha256::digest(serialized))
    }
}

pub fn local_profile() -> EmbeddingProfile {
    EmbeddingProfile {
        provider: LOCAL_PROVIDER_ID.to_owned(),
        model: LOCAL_MODEL_ID.to_owned(),
        revision: LOCAL_MODEL_REVISION.to_owned(),
        dimensions: LOCAL_DIMENSIONS,
        max_length: LOCAL_MAX_LENGTH,
        query_prefix: QUERY_PREFIX.to_owned(),
        passage_prefix: PASSAGE_PREFIX.to_owned(),
        knowledge_text_version: KNOWLEDGE_TEXT_VERSION.to_owned(),
    }
}

pub fn remote_profile(config: &ai::EmbeddingRequestConfig) -> EmbeddingProfile {
    let endpoint = config
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.openai.com/v1");
    EmbeddingProfile {
        provider: config.provider.trim().to_ascii_lowercase(),
        model: config.model.trim().to_owned(),
        revision: format!("remote-api:{endpoint}"),
        dimensions: config.dimensions,
        max_length: 0,
        query_prefix: String::new(),
        passage_prefix: String::new(),
        knowledge_text_version: "repository-knowledge-v1".to_owned(),
    }
}

pub fn profile_for_config(config: &ai::EmbeddingRequestConfig) -> EmbeddingProfile {
    if config
        .provider
        .trim()
        .eq_ignore_ascii_case(LOCAL_PROVIDER_ID)
    {
        local_profile()
    } else {
        remote_profile(config)
    }
}

/// 将 E5 集中的原始余弦分数校准为用户可理解的 0 到 1 相关度。
pub fn normalize_local_similarity(raw_similarity: f32) -> f32 {
    ((raw_similarity - LOCAL_SIMILARITY_FLOOR) / LOCAL_SIMILARITY_RANGE).clamp(0.0, 1.0)
}

/// 将用户设置的本地相关度阈值还原为 zvec 使用的原始余弦阈值。
pub fn raw_local_similarity_threshold(normalized_threshold: f32) -> f32 {
    LOCAL_SIMILARITY_FLOOR + normalized_threshold.clamp(0.0, 1.0) * LOCAL_SIMILARITY_RANGE
}

/// 本地与远程 Embedding Provider 必须实现的统一端口。
pub trait EmbeddingProviderPort: Send + Sync {
    fn descriptor(&self) -> EmbeddingProfile;
    fn prepare(&self, cache_dir: &Path, on_stage: &dyn Fn(&str)) -> Result<(), String>;
    fn embed_query(&self, text: &str) -> Result<Vec<f32>, String>;
    fn embed_passages(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

/// 负责模型准备和查询/知识文本向量生成的应用服务。
pub struct EmbeddingService {
    provider: Arc<dyn EmbeddingProviderPort>,
    cache_dir: PathBuf,
    download_source: LocalModelDownloadSource,
}

impl EmbeddingService {
    pub fn new(config: ai::EmbeddingRequestConfig, cache_dir: PathBuf) -> Self {
        let download_source = LocalModelDownloadSource::parse(config.download_source.as_deref())
            .unwrap_or(LocalModelDownloadSource::ModelScope);
        Self {
            provider: provider_for_config(config),
            cache_dir,
            download_source,
        }
    }

    pub fn descriptor(&self) -> EmbeddingProfile {
        self.provider.descriptor()
    }

    pub fn prepare(&self, on_stage: &dyn Fn(&str)) -> Result<(), String> {
        if self.provider.descriptor().provider == LOCAL_PROVIDER_ID {
            local_provider().prepare_with_source(&self.cache_dir, self.download_source, on_stage)
        } else {
            self.provider.prepare(&self.cache_dir, on_stage)
        }
    }

    pub fn embed_query(&self, text: &str) -> Result<Vec<f32>, String> {
        self.provider.embed_query(text)
    }

    pub fn embed_passages(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        self.provider.embed_passages(texts)
    }
}

pub struct LocalEmbeddingProvider {
    model: Mutex<Option<TextEmbedding>>,
    prepare_lock: Mutex<()>,
}

impl LocalEmbeddingProvider {
    fn new() -> Self {
        Self {
            model: Mutex::new(None),
            prepare_lock: Mutex::new(()),
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.model
            .lock()
            .map(|model| model.is_some())
            .unwrap_or(false)
    }

    pub fn unload(&self) -> Result<(), String> {
        let _prepare_guard = self
            .prepare_lock
            .lock()
            .map_err(|_| "本地 Embedding 准备锁已损坏".to_owned())?;
        self.clear_model()
    }

    fn clear_model(&self) -> Result<(), String> {
        *self
            .model
            .lock()
            .map_err(|_| "本地 Embedding 模型状态已损坏".to_owned())? = None;
        Ok(())
    }

    fn ensure_model_loaded(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<TextEmbedding>>, String> {
        let guard = self
            .model
            .lock()
            .map_err(|_| "本地 Embedding 模型状态已损坏".to_owned())?;
        if guard.is_none() {
            return Err("本地 Embedding 模型尚未加载".to_owned());
        }
        Ok(guard)
    }

    pub fn prepare_with_source(
        &self,
        cache_dir: &Path,
        source: LocalModelDownloadSource,
        on_stage: &dyn Fn(&str),
    ) -> Result<(), String> {
        let _prepare_guard = self
            .prepare_lock
            .lock()
            .map_err(|_| "本地 Embedding 准备锁已损坏".to_owned())?;
        if self.is_loaded() {
            return Ok(());
        }
        let artifacts = prepare_local_artifacts(cache_dir, source, on_stage)?;
        on_stage("loading");
        let model = UserDefinedEmbeddingModel::new(
            fs::read(&artifacts.onnx).map_err(|error| format!("本地模型读取失败：{error}"))?,
            TokenizerFiles {
                tokenizer_file: read_artifact(&artifacts.tokenizer, "tokenizer.json")?,
                config_file: read_artifact(&artifacts.config, "config.json")?,
                special_tokens_map_file: read_artifact(
                    &artifacts.special_tokens_map,
                    "special_tokens_map.json",
                )?,
                tokenizer_config_file: read_artifact(
                    &artifacts.tokenizer_config,
                    "tokenizer_config.json",
                )?,
            },
        );
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().min(4))
            .unwrap_or(1);
        let loaded = TextEmbedding::try_new_from_user_defined(
            model,
            InitOptionsUserDefined::new()
                .with_max_length(LOCAL_MAX_LENGTH)
                .with_intra_threads(threads),
        )
        .map_err(|error| format!("本地 Embedding 模型加载失败：{error}"))?;
        *self
            .model
            .lock()
            .map_err(|_| "本地 Embedding 模型状态已损坏".to_owned())? = Some(loaded);
        Ok(())
    }
}

impl EmbeddingProviderPort for LocalEmbeddingProvider {
    fn descriptor(&self) -> EmbeddingProfile {
        local_profile()
    }

    fn prepare(&self, cache_dir: &Path, on_stage: &dyn Fn(&str)) -> Result<(), String> {
        self.prepare_with_source(cache_dir, LocalModelDownloadSource::ModelScope, on_stage)
    }

    fn embed_query(&self, text: &str) -> Result<Vec<f32>, String> {
        let normalized = text.trim();
        if normalized.is_empty() {
            return Err("Embedding 查询不能为空".to_owned());
        }
        let mut guard = self.ensure_model_loaded()?;
        let vectors = guard
            .as_mut()
            .expect("已检查模型加载状态")
            .embed([format!("{QUERY_PREFIX}{normalized}")], Some(1))
            .map_err(|error| format!("本地查询向量生成失败：{error}"))?;
        validate_vectors(vectors, 1)?
            .into_iter()
            .next()
            .ok_or_else(|| "本地模型未返回查询向量".to_owned())
    }

    fn embed_passages(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let prefixed = texts
            .iter()
            .map(|text| format!("{PASSAGE_PREFIX}{}", text.trim()))
            .collect::<Vec<_>>();
        if prefixed.iter().any(|text| text == PASSAGE_PREFIX) {
            return Err("Embedding 知识文本不能为空".to_owned());
        }
        let mut guard = self.ensure_model_loaded()?;
        let vectors = guard
            .as_mut()
            .expect("已检查模型加载状态")
            .embed(&prefixed, Some(LOCAL_BATCH_SIZE))
            .map_err(|error| format!("本地仓库向量生成失败：{error}"))?;
        validate_vectors(vectors, texts.len())
    }
}

pub struct RemoteEmbeddingProvider {
    config: ai::EmbeddingRequestConfig,
}

impl RemoteEmbeddingProvider {
    pub fn new(config: ai::EmbeddingRequestConfig) -> Self {
        Self { config }
    }
}

impl EmbeddingProviderPort for RemoteEmbeddingProvider {
    fn descriptor(&self) -> EmbeddingProfile {
        remote_profile(&self.config)
    }

    fn prepare(&self, _cache_dir: &Path, _on_stage: &dyn Fn(&str)) -> Result<(), String> {
        Ok(())
    }

    fn embed_query(&self, text: &str) -> Result<Vec<f32>, String> {
        ai::embed_text(&self.config, text).map(|result| result.vector)
    }

    fn embed_passages(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        texts
            .iter()
            .map(|text| ai::embed_text(&self.config, text).map(|result| result.vector))
            .collect()
    }
}

pub fn local_provider() -> Arc<LocalEmbeddingProvider> {
    static PROVIDER: OnceLock<Arc<LocalEmbeddingProvider>> = OnceLock::new();
    PROVIDER
        .get_or_init(|| Arc::new(LocalEmbeddingProvider::new()))
        .clone()
}

pub fn provider_for_config(config: ai::EmbeddingRequestConfig) -> Arc<dyn EmbeddingProviderPort> {
    if config
        .provider
        .trim()
        .eq_ignore_ascii_case(LOCAL_PROVIDER_ID)
    {
        local_provider()
    } else {
        Arc::new(RemoteEmbeddingProvider::new(config))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
/// 向设置页公开的 Embedding 下载、加载和索引状态。
pub struct EmbeddingRuntimeStatus {
    pub account_id: String,
    pub enabled: bool,
    pub provider: String,
    pub state: String,
    pub model_ready: bool,
    pub model: String,
    pub revision: Option<String>,
    pub profile_id: String,
    pub dimensions: usize,
    pub cache_bytes: u64,
    pub indexed_count: usize,
    pub total_count: usize,
    pub failed_count: usize,
    pub message: String,
    pub can_retry: bool,
}

impl EmbeddingRuntimeStatus {
    pub fn local(account_id: &str, state: &str, message: impl Into<String>) -> Self {
        let profile = local_profile();
        Self {
            account_id: account_id.to_owned(),
            enabled: state != "disabled",
            provider: profile.provider.clone(),
            state: state.to_owned(),
            model_ready: false,
            model: profile.model.clone(),
            revision: Some(profile.revision.clone()),
            profile_id: profile.profile_id(),
            dimensions: profile.dimensions,
            cache_bytes: 0,
            indexed_count: 0,
            total_count: 0,
            failed_count: 0,
            message: message.into(),
            can_retry: state == "missing" || state == "partial" || state == "error",
        }
    }
}

#[derive(Default)]
struct RuntimeRegistry {
    statuses: HashMap<String, EmbeddingRuntimeStatus>,
    running_account: Option<String>,
}

fn runtime_registry() -> &'static Mutex<RuntimeRegistry> {
    static REGISTRY: OnceLock<Mutex<RuntimeRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(RuntimeRegistry::default()))
}

pub fn runtime_status(account_id: &str) -> Option<EmbeddingRuntimeStatus> {
    runtime_registry()
        .lock()
        .ok()
        .and_then(|registry| registry.statuses.get(account_id).cloned())
}

pub fn set_runtime_status(
    account_id: &str,
    status: EmbeddingRuntimeStatus,
) -> Result<EmbeddingRuntimeStatus, String> {
    runtime_registry()
        .lock()
        .map_err(|_| "Embedding 运行状态已损坏".to_owned())?
        .statuses
        .insert(account_id.to_owned(), status.clone());
    Ok(status)
}

pub fn begin_runtime_job(account_id: &str) -> Result<(), String> {
    let mut registry = runtime_registry()
        .lock()
        .map_err(|_| "Embedding 运行状态已损坏".to_owned())?;
    if registry.running_account.is_some() {
        return Err("本地 Embedding 正在准备，请等待当前任务完成".to_owned());
    }
    registry.running_account = Some(account_id.to_owned());
    Ok(())
}

pub fn finish_runtime_job(account_id: &str) {
    if let Ok(mut registry) = runtime_registry().lock() {
        if registry.running_account.as_deref() == Some(account_id) {
            registry.running_account = None;
        }
    }
}

pub fn runtime_job_is_running() -> bool {
    runtime_registry()
        .lock()
        .map(|registry| registry.running_account.is_some())
        .unwrap_or(true)
}

pub fn local_cache_root(app_cache_dir: &Path) -> PathBuf {
    app_cache_dir
        .join(MODEL_CACHE_DIR)
        .join(local_profile().profile_id())
}

pub fn local_cache_size(app_cache_dir: &Path) -> u64 {
    directory_size(&local_cache_root(app_cache_dir)).unwrap_or(0)
}

pub fn local_model_is_ready(app_cache_dir: &Path) -> bool {
    local_cache_root(app_cache_dir)
        .join(READY_MANIFEST_FILE)
        .is_file()
}

pub fn delete_local_model(app_cache_dir: &Path) -> Result<(), String> {
    let provider = local_provider();
    let _prepare_guard = provider
        .prepare_lock
        .lock()
        .map_err(|_| "本地 Embedding 准备锁已损坏".to_owned())?;
    provider.clear_model()?;
    let root = local_cache_root(app_cache_dir);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| format!("本地模型删除失败：{error}"))?;
    }
    Ok(())
}

#[derive(Debug)]
struct PreparedArtifacts {
    onnx: PathBuf,
    tokenizer: PathBuf,
    config: PathBuf,
    special_tokens_map: PathBuf,
    tokenizer_config: PathBuf,
}

#[derive(Debug, Clone, Copy)]
struct ArtifactSpec {
    path: &'static str,
    size: u64,
    sha256: &'static str,
}

const ARTIFACTS: &[ArtifactSpec] = &[
    ArtifactSpec {
        path: "onnx/model.onnx",
        size: 470_268_510,
        sha256: "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665",
    },
    ArtifactSpec {
        path: "tokenizer.json",
        size: 17_082_730,
        sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    },
    ArtifactSpec {
        path: "config.json",
        size: 655,
        sha256: "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959",
    },
    ArtifactSpec {
        path: "special_tokens_map.json",
        size: 167,
        sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    },
    ArtifactSpec {
        path: "tokenizer_config.json",
        size: 443,
        sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    },
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyManifest {
    profile_id: String,
    revision: String,
    files: Vec<ReadyArtifact>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyArtifact {
    source_path: String,
    relative_path: String,
    size: u64,
    sha256: String,
}

fn prepare_local_artifacts(
    app_cache_dir: &Path,
    source: LocalModelDownloadSource,
    on_stage: &dyn Fn(&str),
) -> Result<PreparedArtifacts, String> {
    let root = local_cache_root(app_cache_dir);
    if root.join(READY_MANIFEST_FILE).is_file() {
        on_stage("verifying");
        match verified_ready_artifacts(&root) {
            Ok(artifacts) => return Ok(artifacts),
            Err(_) => clear_invalid_local_cache(&root)?,
        }
    }
    fs::create_dir_all(&root).map_err(|error| format!("本地模型缓存目录创建失败：{error}"))?;
    on_stage("downloading");
    let mut downloaded_paths = match source {
        LocalModelDownloadSource::ModelScope => download_modelscope_artifacts(&root),
        LocalModelDownloadSource::HuggingFace => download_hugging_face_artifacts(&root),
    }
    .map_err(|error| {
        format!(
            "{error}；当前使用{}，可在设置中切换下载源后重试，或检查代理/TUN 模式",
            source.display_name()
        )
    })?;
    let mut ready_files = Vec::with_capacity(ARTIFACTS.len());
    for artifact in ARTIFACTS {
        let path = downloaded_paths
            .remove(artifact.path)
            .ok_or_else(|| format!("模型工件 {} 下载后未找到", artifact.path))?;
        if let Err(error) = verify_artifact(&path, *artifact) {
            clear_invalid_local_cache(&root)?;
            return Err(format!("{error}；损坏缓存已清理，请重试下载"));
        }
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| format!("模型工件 {} 不在应用缓存目录中", artifact.path))?;
        ready_files.push(ReadyArtifact {
            source_path: artifact.path.to_owned(),
            relative_path: relative.to_string_lossy().into_owned(),
            size: artifact.size,
            sha256: artifact.sha256.to_owned(),
        });
    }
    on_stage("verifying");
    let ready = ReadyManifest {
        profile_id: local_profile().profile_id(),
        revision: LOCAL_MODEL_REVISION.to_owned(),
        files: ready_files,
    };
    write_ready_manifest(&root, &ready)?;
    verified_ready_artifacts(&root)
}

fn download_hugging_face_artifacts(root: &Path) -> Result<HashMap<&'static str, PathBuf>, String> {
    let api = ApiBuilder::new()
        .with_cache_dir(root.join("hf"))
        .with_endpoint("https://huggingface.co".to_owned())
        .with_progress(false)
        .with_retries(2)
        .build()
        .map_err(|error| format!("模型下载器初始化失败：{error}"))?;
    let repo = api.repo(Repo::with_revision(
        LOCAL_MODEL_ID.to_owned(),
        RepoType::Model,
        LOCAL_MODEL_REVISION.to_owned(),
    ));
    let mut paths = HashMap::with_capacity(ARTIFACTS.len());
    for artifact in ARTIFACTS {
        let path = repo
            .get(artifact.path)
            .map_err(|error| format!("模型工件 {} 下载失败：{error}", artifact.path))?;
        paths.insert(artifact.path, path);
    }
    Ok(paths)
}

fn download_modelscope_artifacts(root: &Path) -> Result<HashMap<&'static str, PathBuf>, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("ModelScope 下载器初始化失败：{error}"))?;
    let mut paths = HashMap::with_capacity(ARTIFACTS.len());
    for artifact in ARTIFACTS {
        let path = download_modelscope_artifact(&client, root, *artifact)?;
        paths.insert(artifact.path, path);
    }
    Ok(paths)
}

fn download_modelscope_artifact(
    client: &reqwest::blocking::Client,
    root: &Path,
    artifact: ArtifactSpec,
) -> Result<PathBuf, String> {
    let target = safe_cache_path(&root.join("modelscope"), artifact.path)?;
    if target.is_file() && verify_artifact(&target, artifact).is_ok() {
        return Ok(target);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("模型工件目录创建失败（{}）：{error}", parent.display()))?;
    }
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("模型工件路径无效：{}", target.display()))?;
    let temporary = target.with_file_name(format!("{file_name}.part"));
    let url = modelscope_artifact_url(artifact.path);
    let mut last_error = String::new();

    for attempt in 1..=3 {
        let result = (|| -> Result<(), String> {
            if temporary.exists() {
                fs::remove_file(&temporary).map_err(|error| {
                    format!("模型临时文件清理失败（{}）：{error}", temporary.display())
                })?;
            }
            let mut response = client
                .get(&url)
                .send()
                .map_err(|error| format!("请求失败：{error}"))?
                .error_for_status()
                .map_err(|error| format!("服务器返回错误：{error}"))?;
            let mut file = fs::File::create(&temporary).map_err(|error| {
                format!("模型临时文件创建失败（{}）：{error}", temporary.display())
            })?;
            std::io::copy(&mut response, &mut file)
                .map_err(|error| format!("模型文件写入失败：{error}"))?;
            file.flush()
                .map_err(|error| format!("模型文件刷新失败：{error}"))?;
            file.sync_all()
                .map_err(|error| format!("模型文件落盘失败：{error}"))?;
            verify_artifact(&temporary, artifact)?;
            if target.exists() {
                fs::remove_file(&target).map_err(|error| {
                    format!("旧模型工件清理失败（{}）：{error}", target.display())
                })?;
            }
            fs::rename(&temporary, &target)
                .map_err(|error| format!("模型工件激活失败：{error}"))?;
            Ok(())
        })();
        match result {
            Ok(()) => return Ok(target),
            Err(error) if attempt < 3 => last_error = error,
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(format!(
                    "模型工件 {} 下载失败（已重试 3 次）：{error}",
                    artifact.path
                ));
            }
        }
    }

    Err(format!("模型工件 {} 下载失败：{last_error}", artifact.path))
}

fn modelscope_artifact_url(path: &str) -> String {
    format!(
        "https://modelscope.cn/models/{MODELSCOPE_MODEL_ID}/resolve/{MODELSCOPE_MODEL_REVISION}/{path}"
    )
}

fn clear_invalid_local_cache(root: &Path) -> Result<(), String> {
    for file_name in [READY_MANIFEST_FILE, "ready.json.tmp"] {
        let path = root.join(file_name);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("损坏模型标记清理失败（{}）：{error}", path.display()))?;
        }
    }
    for cache_name in ["hf", "modelscope"] {
        let download_cache = root.join(cache_name);
        if download_cache.exists() {
            fs::remove_dir_all(&download_cache).map_err(|error| {
                format!(
                    "损坏模型缓存清理失败（{}）：{error}",
                    download_cache.display()
                )
            })?;
        }
    }
    Ok(())
}

fn verified_ready_artifacts(root: &Path) -> Result<PreparedArtifacts, String> {
    let content = fs::read(root.join(READY_MANIFEST_FILE))
        .map_err(|error| format!("本地模型尚未准备完成：{error}"))?;
    let ready = serde_json::from_slice::<ReadyManifest>(&content)
        .map_err(|error| format!("本地模型完成标记损坏：{error}"))?;
    if ready.profile_id != local_profile().profile_id() || ready.revision != LOCAL_MODEL_REVISION {
        return Err("本地模型版本已变化，需要重新下载".to_owned());
    }
    let mut paths = HashMap::new();
    for expected in ARTIFACTS {
        let record = ready
            .files
            .iter()
            .find(|file| file.source_path == expected.path)
            .ok_or_else(|| format!("本地模型缺少工件记录：{}", expected.path))?;
        let path = safe_cache_path(root, &record.relative_path)?;
        verify_artifact(&path, *expected)?;
        paths.insert(expected.path, path);
    }
    Ok(PreparedArtifacts {
        onnx: take_path(&mut paths, "onnx/model.onnx")?,
        tokenizer: take_path(&mut paths, "tokenizer.json")?,
        config: take_path(&mut paths, "config.json")?,
        special_tokens_map: take_path(&mut paths, "special_tokens_map.json")?,
        tokenizer_config: take_path(&mut paths, "tokenizer_config.json")?,
    })
}

fn write_ready_manifest(root: &Path, ready: &ReadyManifest) -> Result<(), String> {
    let target = root.join(READY_MANIFEST_FILE);
    let temporary = root.join("ready.json.tmp");
    let content = serde_json::to_vec_pretty(ready)
        .map_err(|error| format!("本地模型完成标记序列化失败：{error}"))?;
    fs::write(&temporary, content).map_err(|error| format!("本地模型完成标记写入失败：{error}"))?;
    if target.exists() {
        fs::remove_file(&target).map_err(|error| format!("旧模型完成标记清理失败：{error}"))?;
    }
    fs::rename(temporary, target).map_err(|error| format!("本地模型完成标记激活失败：{error}"))
}

fn verify_artifact(path: &Path, expected: ArtifactSpec) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("模型工件 {} 无法读取：{error}", expected.path))?;
    if metadata.len() != expected.size {
        return Err(format!(
            "模型工件 {} 大小校验失败：预期 {} 字节，实际 {} 字节",
            expected.path,
            expected.size,
            metadata.len()
        ));
    }
    let file = fs::File::open(path)
        .map_err(|error| format!("模型工件 {} 无法打开：{error}", expected.path))?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("模型工件 {} 校验读取失败：{error}", expected.path))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected.sha256 {
        return Err(format!("模型工件 {} 完整性校验失败", expected.path));
    }
    Ok(())
}

fn safe_cache_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("本地模型完成标记包含非法路径".to_owned());
    }
    Ok(root.join(relative))
}

fn take_path(
    paths: &mut HashMap<&'static str, PathBuf>,
    key: &'static str,
) -> Result<PathBuf, String> {
    paths
        .remove(key)
        .ok_or_else(|| format!("本地模型缺少工件：{key}"))
}

fn read_artifact(path: &Path, name: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("模型工件 {name} 读取失败：{error}"))
}

fn validate_vectors(
    vectors: Vec<Vec<f32>>,
    expected_count: usize,
) -> Result<Vec<Vec<f32>>, String> {
    if vectors.len() != expected_count {
        return Err(format!(
            "本地模型返回向量数量不匹配：预期 {expected_count}，实际 {}",
            vectors.len()
        ));
    }
    if vectors.iter().any(|vector| {
        vector.len() != LOCAL_DIMENSIONS || vector.iter().any(|value| !value.is_finite())
    }) {
        return Err("本地模型返回了维度错误或包含无效数值的向量".to_owned());
    }
    Ok(vectors)
}

fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(path).map_err(|error| format!("模型缓存读取失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("模型缓存读取失败：{error}"))?;
        let metadata = entry
            .metadata()
            .map_err(|error| format!("模型缓存信息读取失败：{error}"))?;
        total = total.saturating_add(if metadata.is_dir() {
            directory_size(&entry.path())?
        } else {
            metadata.len()
        });
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[derive(Deserialize)]
    struct QualitySet {
        version: u32,
        documents: Vec<QualityDocument>,
        groups: Vec<QualityGroup>,
    }

    #[derive(Deserialize)]
    struct QualityDocument {
        id: String,
        text: String,
    }

    #[derive(Deserialize)]
    struct QualityGroup {
        name: String,
        queries: Vec<QualityQuery>,
    }

    #[derive(Deserialize)]
    struct QualityQuery {
        id: String,
        query: String,
        positive: Vec<String>,
    }

    struct RankedQualityQuery<'a> {
        group: &'a str,
        query_id: &'a str,
        positive: &'a [String],
        ranking: Vec<(&'a str, f32)>,
    }

    #[test]
    fn local_profile_id_is_stable_and_protocol_sensitive() {
        let profile = local_profile();
        assert_eq!(profile.profile_id(), local_profile().profile_id());

        let mut changed = profile.clone();
        changed.query_prefix = "search: ".to_owned();
        assert_ne!(profile.profile_id(), changed.profile_id());
    }

    #[test]
    fn local_manifest_has_unique_paths_and_expected_size() {
        let paths = ARTIFACTS
            .iter()
            .map(|artifact| artifact.path)
            .collect::<HashSet<_>>();
        assert_eq!(paths.len(), ARTIFACTS.len());
        assert_eq!(
            ARTIFACTS.iter().map(|artifact| artifact.size).sum::<u64>(),
            487_352_505
        );
    }

    #[test]
    fn local_download_source_defaults_to_modelscope_and_keeps_official_option() {
        assert_eq!(
            LocalModelDownloadSource::parse(None).expect("默认下载源应有效"),
            LocalModelDownloadSource::ModelScope
        );
        assert_eq!(
            LocalModelDownloadSource::parse(Some(LOCAL_DOWNLOAD_SOURCE_HUGGING_FACE))
                .expect("官方下载源应有效"),
            LocalModelDownloadSource::HuggingFace
        );
        assert!(LocalModelDownloadSource::parse(Some("unknown")).is_err());
    }

    #[test]
    fn modelscope_download_is_pinned_to_matching_model_revision() {
        let url = modelscope_artifact_url("onnx/model.onnx");
        assert!(url.contains(MODELSCOPE_MODEL_ID));
        assert!(url.contains(MODELSCOPE_MODEL_REVISION));
        assert!(url.ends_with("/onnx/model.onnx"));
    }

    #[test]
    fn e5_prefixes_and_batch_validation_preserve_protocol_order() {
        assert_eq!(QUERY_PREFIX, "query: ");
        assert_eq!(PASSAGE_PREFIX, "passage: ");
        let first = vec![0.25; LOCAL_DIMENSIONS];
        let second = vec![0.75; LOCAL_DIMENSIONS];
        let validated = validate_vectors(vec![first.clone(), second.clone()], 2)
            .expect("合法批量向量应通过校验");
        assert_eq!(validated, vec![first, second]);
        assert!((normalize_local_similarity(0.94) - 0.80).abs() < f32::EPSILON);
        assert!((raw_local_similarity_threshold(0.80) - 0.94).abs() < f32::EPSILON);
    }

    #[test]
    fn ready_manifest_rejects_parent_paths() {
        assert!(safe_cache_path(Path::new("/tmp/cache"), "../model.onnx").is_err());
        assert!(safe_cache_path(Path::new("/tmp/cache"), "hf/model.onnx").is_ok());
    }

    #[test]
    fn invalid_local_cache_cleanup_removes_ready_marker_and_downloads() {
        let root = std::env::temp_dir().join(format!(
            "gsat-invalid-embedding-cache-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("hf")).expect("应能创建损坏缓存目录");
        fs::create_dir_all(root.join("modelscope")).expect("应能创建国内源损坏缓存目录");
        fs::write(root.join(READY_MANIFEST_FILE), b"invalid").expect("应能写入损坏完成标记");
        fs::write(root.join("ready.json.tmp"), b"partial").expect("应能写入临时完成标记");
        fs::write(root.join("hf").join("artifact"), b"invalid").expect("应能写入损坏工件");
        fs::write(root.join("modelscope").join("artifact"), b"invalid")
            .expect("应能写入国内源损坏工件");

        clear_invalid_local_cache(&root).expect("应能清理损坏模型缓存");

        assert!(!root.join(READY_MANIFEST_FILE).exists());
        assert!(!root.join("ready.json.tmp").exists());
        assert!(!root.join("hf").exists());
        assert!(!root.join("modelscope").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn runtime_job_is_single_flight_per_account() {
        let account_id = "single-flight-test";
        assert!(begin_runtime_job(account_id).is_ok());
        assert!(begin_runtime_job(account_id).is_err());
        assert!(begin_runtime_job("another-account").is_err());
        assert!(runtime_job_is_running());
        finish_runtime_job(account_id);
        assert!(!runtime_job_is_running());
        assert!(begin_runtime_job(account_id).is_ok());
        finish_runtime_job(account_id);
    }

    #[test]
    #[ignore = "需要下载约 490 MB 官方模型工件"]
    fn local_model_real_bilingual_smoke_and_cache_reload() {
        let root =
            std::env::temp_dir().join(format!("gsat-local-embedding-smoke-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("应能创建模型 smoke 缓存目录");

        let provider = LocalEmbeddingProvider::new();
        provider
            .prepare(&root, &|_| {})
            .expect("官方模型应能下载、校验并加载");
        let query = provider
            .embed_query("支持离线的本地向量检索")
            .expect("中文查询应生成向量");
        let passages = provider
            .embed_passages(&[
                "An offline local vector database for semantic repository search.".to_owned(),
                "A recipe for a chocolate cake with vanilla frosting.".to_owned(),
            ])
            .expect("英文知识文本应批量生成向量");
        assert_eq!(query.len(), LOCAL_DIMENSIONS);
        assert_eq!(passages.len(), 2);
        assert!((l2_norm(&query) - 1.0).abs() < 0.01);
        assert!(passages
            .iter()
            .all(|passage| (l2_norm(passage) - 1.0).abs() < 0.01));
        assert!(cosine(&query, &passages[0]) > cosine(&query, &passages[1]));

        let cached_provider = LocalEmbeddingProvider::new();
        cached_provider
            .prepare(&root, &|_| {})
            .expect("ready 标记应支持无网络缓存重载");
        let reloaded = cached_provider
            .embed_query("offline semantic search")
            .expect("缓存重载后英文查询应可用");
        assert_eq!(reloaded.len(), LOCAL_DIMENSIONS);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    #[ignore = "需要下载约 490 MB 官方模型并执行 40 条中英质量查询"]
    fn local_model_bilingual_quality_gate() {
        let quality = serde_json::from_str::<QualitySet>(include_str!(
            "../../../../docs/quality/embedding-golden.json"
        ))
        .expect("质量集应为有效 JSON");
        assert_eq!(quality.version, 2);
        assert_eq!(quality.groups.len(), 4);
        assert!(quality.groups.iter().all(|group| group.queries.len() == 10));

        let document_ids = quality
            .documents
            .iter()
            .map(|document| document.id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(document_ids.len(), quality.documents.len());
        for query in quality.groups.iter().flat_map(|group| &group.queries) {
            assert!(!query.positive.is_empty(), "{} 缺少正例", query.id);
            assert!(
                query
                    .positive
                    .iter()
                    .all(|positive| document_ids.contains(positive.as_str())),
                "{} 引用了不存在的正例",
                query.id
            );
        }

        let configured_cache = std::env::var_os("GSAT_EMBEDDING_TEST_CACHE");
        let keep_cache = configured_cache.is_some();
        let root = configured_cache.map(PathBuf::from).unwrap_or_else(|| {
            std::env::temp_dir().join(format!(
                "gsat-local-embedding-quality-{}",
                std::process::id()
            ))
        });
        fs::create_dir_all(&root).expect("应能创建模型质量测试缓存目录");
        let provider = LocalEmbeddingProvider::new();
        provider
            .prepare(&root, &|_| {})
            .expect("官方模型应能下载、校验并加载");
        let passages = provider
            .embed_passages(
                &quality
                    .documents
                    .iter()
                    .map(|document| document.text.clone())
                    .collect::<Vec<_>>(),
            )
            .expect("质量集知识文本应能批量生成向量");

        let mut ranked_queries = Vec::new();
        for group in &quality.groups {
            for query in &group.queries {
                let query_vector = provider
                    .embed_query(&query.query)
                    .unwrap_or_else(|error| panic!("{} 生成查询向量失败：{error}", query.id));
                let mut ranking = quality
                    .documents
                    .iter()
                    .zip(&passages)
                    .map(|(document, passage)| {
                        (
                            document.id.as_str(),
                            normalize_local_similarity(cosine(&query_vector, passage)),
                        )
                    })
                    .collect::<Vec<_>>();
                ranking.sort_by(|left, right| {
                    right
                        .1
                        .partial_cmp(&left.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                ranked_queries.push(RankedQualityQuery {
                    group: &group.name,
                    query_id: &query.id,
                    positive: &query.positive,
                    ranking,
                });
            }
        }

        let (overall_recall, overall_mrr) = recall_and_mrr(&ranked_queries);
        let cross_language = ranked_queries
            .iter()
            .filter(|query| matches!(query.group, "zh-en" | "en-zh"))
            .collect::<Vec<_>>();
        let cross_recall = cross_language
            .iter()
            .filter(|query| positive_rank(query, 8).is_some())
            .count() as f32
            / cross_language.len() as f32;
        for group in ["zh-zh", "en-en", "zh-en", "en-zh"] {
            let group_queries = ranked_queries
                .iter()
                .filter(|query| query.group == group)
                .collect::<Vec<_>>();
            let group_recall = group_queries
                .iter()
                .filter(|query| positive_rank(query, 8).is_some())
                .count() as f32
                / group_queries.len() as f32;
            println!("{group} Recall@8={group_recall:.3}");
        }
        for query in &ranked_queries {
            if positive_rank(query, 8).is_none() {
                let full_rank = positive_rank(query, query.ranking.len()).unwrap_or(0);
                let top = query
                    .ranking
                    .iter()
                    .take(3)
                    .map(|(document_id, score)| format!("{document_id}={score:.3}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                println!("MISS {} positive_rank={full_rank}: {top}", query.query_id);
            }
        }
        for step in 70..=90 {
            let threshold = step as f32 / 100.0;
            let (precision, recall, f1) = quality_threshold_metrics(&ranked_queries, threshold);
            println!(
                "threshold={threshold:.2}, precision={precision:.3}, recall={recall:.3}, F1={f1:.3}"
            );
        }
        let (threshold, precision, recall, f1) = select_quality_threshold(&ranked_queries)
            .expect("0.70 到 0.90 之间应存在精确率不低于 0.85 的阈值");
        println!(
            "overall Recall@8={overall_recall:.3}, cross Recall@8={cross_recall:.3}, MRR@8={overall_mrr:.3}, threshold={threshold:.2}, precision={precision:.3}, recall={recall:.3}, F1={f1:.3}"
        );

        assert!(overall_recall >= 0.90);
        assert!(cross_recall >= 0.80);
        assert!(overall_mrr >= 0.70);
        if !keep_cache {
            let _ = fs::remove_dir_all(&root);
        }
    }

    fn recall_and_mrr(queries: &[RankedQualityQuery<'_>]) -> (f32, f32) {
        let hits = queries
            .iter()
            .filter(|query| positive_rank(query, 8).is_some())
            .count();
        let reciprocal_rank = queries
            .iter()
            .filter_map(|query| positive_rank(query, 8))
            .map(|rank| 1.0 / rank as f32)
            .sum::<f32>();
        (
            hits as f32 / queries.len() as f32,
            reciprocal_rank / queries.len() as f32,
        )
    }

    fn positive_rank(query: &RankedQualityQuery<'_>, limit: usize) -> Option<usize> {
        query
            .ranking
            .iter()
            .take(limit)
            .position(|(document_id, _)| {
                query
                    .positive
                    .iter()
                    .any(|positive| positive == document_id)
            })
            .map(|position| position + 1)
    }

    fn select_quality_threshold(
        queries: &[RankedQualityQuery<'_>],
    ) -> Option<(f32, f32, f32, f32)> {
        (70..=90)
            .filter_map(|step| {
                let threshold = step as f32 / 100.0;
                let (precision, recall, f1) = quality_threshold_metrics(queries, threshold);
                if precision < 0.85 {
                    return None;
                }
                Some((threshold, precision, recall, f1))
            })
            .max_by(|left, right| {
                left.3
                    .partial_cmp(&right.3)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| {
                        right
                            .0
                            .partial_cmp(&left.0)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
            })
    }

    fn quality_threshold_metrics(
        queries: &[RankedQualityQuery<'_>],
        threshold: f32,
    ) -> (f32, f32, f32) {
        let mut retrieved = 0_usize;
        let mut true_positive = 0_usize;
        let mut query_hits = 0_usize;
        for query in queries {
            let results = query
                .ranking
                .iter()
                .take(8)
                .filter(|(_, score)| *score >= threshold)
                .collect::<Vec<_>>();
            retrieved += results.len();
            let positives = results
                .iter()
                .filter(|(document_id, _)| {
                    query
                        .positive
                        .iter()
                        .any(|positive| positive == *document_id)
                })
                .count();
            true_positive += positives;
            query_hits += usize::from(positives > 0);
        }
        let precision = if retrieved == 0 {
            0.0
        } else {
            true_positive as f32 / retrieved as f32
        };
        let recall = query_hits as f32 / queries.len() as f32;
        let f1 = if precision + recall == 0.0 {
            0.0
        } else {
            2.0 * precision * recall / (precision + recall)
        };
        (precision, recall, f1)
    }

    fn cosine(left: &[f32], right: &[f32]) -> f32 {
        left.iter().zip(right).map(|(a, b)| a * b).sum()
    }

    fn l2_norm(vector: &[f32]) -> f32 {
        vector.iter().map(|value| value * value).sum::<f32>().sqrt()
    }
}
