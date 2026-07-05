use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const PROMPT_VERSION: &str = "readme-summary-v1";
const TAG_NETWORK_PROMPT_VERSION: &str = "tag-network-v1";
const MAX_README_CHARS: usize = 18_000;
const MAX_TAG_NETWORK_REPOSITORIES: usize = 300;
const AI_CONNECT_TIMEOUT_SECONDS: u16 = 15;
const AI_REQUEST_TIMEOUT_SECONDS: u16 = 120;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestConfig {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummaryDocument {
    pub summary_zh: String,
    pub readme_zh: Option<String>,
    pub keywords: Vec<String>,
    pub suggested_tags: Vec<String>,
    pub model: String,
    pub prompt_version: String,
}

pub struct AiTagRepositoryBrief {
    pub full_name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub topics: Vec<String>,
    pub ai_summary: Option<String>,
    pub suggested_tags: Vec<String>,
    pub stars_count: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTagNetworkSuggestion {
    pub tag_name: String,
    pub color: Option<String>,
    pub repository_full_names: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGithubRecommendationPlan {
    pub rationale_zh: String,
    pub queries: Vec<String>,
}

#[derive(Deserialize)]
struct AiJsonDocument {
    summary_zh: Option<String>,
    readme_zh: Option<String>,
    keywords: Option<Vec<String>>,
    suggested_tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct AiTagNetworkJson {
    tags: Option<Vec<AiTagNetworkJsonTag>>,
}

#[derive(Deserialize)]
struct AiTagNetworkJsonTag {
    tag_name: Option<String>,
    color: Option<String>,
    repository_full_names: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct AiGithubRecommendationJson {
    rationale_zh: Option<String>,
    queries: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicMessageResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Deserialize)]
struct AnthropicContentBlock {
    text: Option<String>,
}

struct HttpResponse {
    status_success: bool,
    http_code: Option<u16>,
    body: String,
}

pub fn summarize_readme(
    config: &AiRequestConfig,
    repository_full_name: &str,
    description: Option<&str>,
    readme_markdown: &str,
) -> Result<AiSummaryDocument, String> {
    let provider = validate_request_config(config)?;

    let prompt = build_summary_prompt(repository_full_name, description, readme_markdown);
    let content = match provider.as_str() {
        "openai" => request_openai(config, &prompt)?,
        "anthropic" => request_anthropic(config, &prompt)?,
        _ => return Err("当前仅支持 OpenAI、OpenAI 兼容接口或 Anthropic AI Provider".to_owned()),
    };
    let document = parse_ai_document(&content)?;

    Ok(AiSummaryDocument {
        summary_zh: document.summary_zh.unwrap_or_default(),
        readme_zh: document.readme_zh,
        keywords: document.keywords.unwrap_or_default(),
        suggested_tags: document.suggested_tags.unwrap_or_default(),
        model: config.model.trim().to_owned(),
        prompt_version: PROMPT_VERSION.to_owned(),
    })
}

pub fn generate_tag_network(
    config: &AiRequestConfig,
    repositories: &[AiTagRepositoryBrief],
) -> Result<Vec<AiTagNetworkSuggestion>, String> {
    let provider = validate_request_config(config)?;
    if repositories.is_empty() {
        return Err("没有可用于生成标签网络的 Stars 仓库".to_owned());
    }

    let prompt = build_tag_network_prompt(repositories);
    let content = match provider.as_str() {
        "openai" => request_openai(config, &prompt)?,
        "anthropic" => request_anthropic(config, &prompt)?,
        _ => return Err("当前仅支持 OpenAI、OpenAI 兼容接口或 Anthropic AI Provider".to_owned()),
    };

    parse_tag_network_document(&content, repositories)
}

pub fn plan_github_recommendations(
    config: &AiRequestConfig,
    repositories: &[AiTagRepositoryBrief],
) -> Result<AiGithubRecommendationPlan, String> {
    let provider = validate_request_config(config)?;
    if repositories.is_empty() {
        return Err("请先选择至少一个 Star 仓库".to_owned());
    }

    let prompt = build_github_recommendation_prompt(repositories);
    let content = match provider.as_str() {
        "openai" => request_openai(config, &prompt)?,
        "anthropic" => request_anthropic(config, &prompt)?,
        _ => return Err("当前仅支持 OpenAI、OpenAI 兼容接口或 Anthropic AI Provider".to_owned()),
    };

    parse_github_recommendation_plan(&content)
}

fn validate_request_config(config: &AiRequestConfig) -> Result<String, String> {
    let provider = config.provider.trim().to_ascii_lowercase();
    if provider == "none" || provider.is_empty() {
        return Err("请先在设置中配置 AI Provider".to_owned());
    }

    if config.api_key.trim().is_empty() {
        return Err("请先填写 AI API Key".to_owned());
    }

    let base_url = config.base_url.as_deref().map(str::trim).unwrap_or("");
    if provider == "openai-compatible" && base_url.is_empty() {
        return Err("请填写 OpenAI 兼容接口的请求地址".to_owned());
    }
    if !base_url.is_empty()
        && !(base_url.starts_with("http://") || base_url.starts_with("https://"))
    {
        return Err("AI 请求地址必须以 http:// 或 https:// 开头".to_owned());
    }

    if config.model.trim().is_empty() {
        return Err("请先填写 AI 模型 ID".to_owned());
    }

    match provider.as_str() {
        "openai" | "openai-compatible" => Ok("openai".to_owned()),
        "anthropic" => Ok("anthropic".to_owned()),
        _ => Err("当前仅支持 OpenAI、OpenAI 兼容接口或 Anthropic AI Provider".to_owned()),
    }
}

fn request_openai(config: &AiRequestConfig, prompt: &str) -> Result<String, String> {
    let endpoint = build_endpoint(
        config.base_url.as_deref(),
        DEFAULT_OPENAI_BASE_URL,
        "chat/completions",
    );
    let body = serde_json::json!({
        "model": config.model.trim(),
        "temperature": 0.2,
        "messages": [
            {
                "role": "system",
                "content": "你是开源项目知识库助手。只输出 JSON，不要输出 Markdown。"
            },
            {
                "role": "user",
                "content": prompt
            }
        ]
    })
    .to_string();
    let response = execute_json_post(
        &endpoint,
        &[
            ("Authorization", format!("Bearer {}", config.api_key.trim())),
            ("Content-Type", "application/json".to_owned()),
        ],
        &body,
    )?;

    if !response.status_success {
        return Err(format_ai_http_error(
            "OpenAI",
            response.http_code,
            &response.body,
        ));
    }

    let parsed = serde_json::from_str::<OpenAiChatResponse>(&response.body)
        .map_err(|error| format!("OpenAI 响应解析失败：{error}"))?;
    parsed
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
        .ok_or_else(|| "OpenAI 响应中没有摘要内容".to_owned())
}

fn request_anthropic(config: &AiRequestConfig, prompt: &str) -> Result<String, String> {
    let endpoint = build_endpoint(
        config.base_url.as_deref(),
        DEFAULT_ANTHROPIC_BASE_URL,
        "messages",
    );
    let body = serde_json::json!({
        "model": config.model.trim(),
        "max_tokens": 1200,
        "temperature": 0.2,
        "system": "你是开源项目知识库助手。只输出 JSON，不要输出 Markdown。",
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    })
    .to_string();
    let response = execute_json_post(
        &endpoint,
        &[
            ("x-api-key", config.api_key.trim().to_owned()),
            ("anthropic-version", "2023-06-01".to_owned()),
            ("Content-Type", "application/json".to_owned()),
        ],
        &body,
    )?;

    if !response.status_success {
        return Err(format_ai_http_error(
            "Anthropic",
            response.http_code,
            &response.body,
        ));
    }

    let parsed = serde_json::from_str::<AnthropicMessageResponse>(&response.body)
        .map_err(|error| format!("Anthropic 响应解析失败：{error}"))?;
    parsed
        .content
        .into_iter()
        .find_map(|block| block.text)
        .ok_or_else(|| "Anthropic 响应中没有摘要内容".to_owned())
}

fn build_summary_prompt(
    repository_full_name: &str,
    description: Option<&str>,
    readme_markdown: &str,
) -> String {
    let readme_excerpt = readme_markdown
        .chars()
        .take(MAX_README_CHARS)
        .collect::<String>();
    let truncated_notice = if readme_markdown.chars().count() > MAX_README_CHARS {
        "README 内容较长，以下内容已截取开头部分。请基于已提供内容总结，不要编造未出现的信息。"
    } else {
        "README 内容完整。"
    };
    format!(
        r#"请分析这个 GitHub 仓库 README，生成结构化中文知识卡片。

仓库：{repository_full_name}
描述：{description}
内容状态：{truncated_notice}

输出必须是严格 JSON，对象字段如下：
- summary_zh: 80 到 160 字中文摘要，说明项目解决什么问题、适合什么场景。
- readme_zh: 可选，README 核心内容中文梳理，200 到 500 字。
- keywords: 5 到 10 个关键词，数组。
- suggested_tags: 3 到 6 个适合知识库管理的短标签，数组。

README:
{readme_excerpt}
"#,
        description = description.unwrap_or("无"),
    )
}

fn build_tag_network_prompt(repositories: &[AiTagRepositoryBrief]) -> String {
    let repository_lines = repositories
        .iter()
        .take(MAX_TAG_NETWORK_REPOSITORIES)
        .map(|repository| {
            format!(
                "- full_name: {full_name}\n  language: {language}\n  stars: {stars_count}\n  topics: {topics}\n  ai_suggested_tags: {suggested_tags}\n  ai_summary: {ai_summary}\n  description: {description}",
                full_name = repository.full_name,
                language = repository.language.as_deref().unwrap_or("未知"),
                stars_count = repository.stars_count,
                topics = repository.topics.join(", "),
                suggested_tags = repository.suggested_tags.join(", "),
                ai_summary = truncate_chars(repository.ai_summary.as_deref().unwrap_or(""), 120),
                description = truncate_chars(repository.description.as_deref().unwrap_or(""), 120),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let truncated_notice = if repositories.len() > MAX_TAG_NETWORK_REPOSITORIES {
        format!(
            "仓库数量较多，本次只发送 Star 数和最近收藏排序靠前的 {MAX_TAG_NETWORK_REPOSITORIES} 个仓库。"
        )
    } else {
        "已发送当前账号全部可用仓库简略信息。".to_owned()
    };

    format!(
        r##"请根据 GitHub Stars 仓库简略信息生成知识库标签网络建议。
目标：
- 生成 8 到 24 个中文短标签，覆盖技术领域、使用场景、架构类型、开发工具、AI 能力等维度。
- 每个标签绑定 1 到 30 个最相关仓库，repository_full_names 必须来自输入的 full_name，不能编造仓库。
- 标签名要适合长期知识库管理，不要使用“工具”“项目”“开源”等过泛标签。
- color 可选，若给出必须是 #RRGGBB。

输出必须是严格 JSON，对象字段如下：
{{
  "tags": [
    {{
      "tag_name": "React 动画",
      "color": "#ec4899",
      "repository_full_names": ["owner/repo"]
    }}
  ]
}}

内容状态：{truncated_notice}
提示版本：{TAG_NETWORK_PROMPT_VERSION}

仓库：
{repository_lines}
"##
    )
}

fn build_github_recommendation_prompt(repositories: &[AiTagRepositoryBrief]) -> String {
    let repository_lines = repositories
        .iter()
        .take(8)
        .map(|repository| {
            format!(
                "- full_name: {full_name}\n  language: {language}\n  stars: {stars_count}\n  topics: {topics}\n  ai_suggested_tags: {suggested_tags}\n  ai_summary: {ai_summary}\n  description: {description}",
                full_name = repository.full_name,
                language = repository.language.as_deref().unwrap_or("未知"),
                stars_count = repository.stars_count,
                topics = repository.topics.join(", "),
                suggested_tags = repository.suggested_tags.join(", "),
                ai_summary = truncate_chars(repository.ai_summary.as_deref().unwrap_or(""), 180),
                description = truncate_chars(repository.description.as_deref().unwrap_or(""), 180),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r##"请根据用户选择的 GitHub Stars 仓库，生成用于 GitHub Search API 的相似/更优项目搜索策略。
目标：
- 给出 2 到 5 条 GitHub repository search 查询语句。
- 查询语句要能找到功能相似、维护更活跃、Star 更多或工程质量更高的项目。
- 查询语句必须简短，可以包含 language:、stars:>、topic: 等 GitHub 搜索限定符。
- 不要包含已给出的仓库 full_name。

输出必须是严格 JSON：
{{
  "rationale_zh": "一句中文说明推荐依据",
  "queries": ["react animation library stars:>1000 language:TypeScript"]
}}

用户选择的仓库：
{repository_lines}
"##
    )
}

fn parse_ai_document(content: &str) -> Result<AiJsonDocument, String> {
    let json_text = extract_json_object(content).unwrap_or_else(|| content.trim().to_owned());
    let parsed = match serde_json::from_str::<AiJsonDocument>(&json_text) {
        Ok(parsed) => parsed,
        Err(_) => {
            let fallback = normalize_text(Some(content))
                .map(|value| truncate_chars(&value, 180))
                .ok_or_else(|| "AI 返回内容为空，无法生成摘要".to_owned())?;
            return Ok(AiJsonDocument {
                summary_zh: Some(fallback),
                readme_zh: None,
                keywords: Some(Vec::new()),
                suggested_tags: Some(Vec::new()),
            });
        }
    };
    let summary = normalize_text(parsed.summary_zh.as_deref())
        .ok_or_else(|| "AI 摘要缺少 summary_zh 字段".to_owned())?;

    Ok(AiJsonDocument {
        summary_zh: Some(summary),
        readme_zh: normalize_text(parsed.readme_zh.as_deref()),
        keywords: Some(normalize_list(parsed.keywords.unwrap_or_default(), 10)),
        suggested_tags: Some(normalize_list(parsed.suggested_tags.unwrap_or_default(), 8)),
    })
}

fn parse_tag_network_document(
    content: &str,
    repositories: &[AiTagRepositoryBrief],
) -> Result<Vec<AiTagNetworkSuggestion>, String> {
    let known_repositories = repositories
        .iter()
        .map(|repository| repository.full_name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let json_text = extract_json_object(content).unwrap_or_else(|| content.trim().to_owned());
    let parsed = serde_json::from_str::<AiTagNetworkJson>(&json_text)
        .map_err(|error| format!("AI 标签网络响应解析失败：{error}"))?;
    let mut suggestions = Vec::new();

    for tag in parsed.tags.unwrap_or_default() {
        let Some(tag_name) = normalize_text(tag.tag_name.as_deref()) else {
            continue;
        };
        let repository_full_names =
            normalize_list(tag.repository_full_names.unwrap_or_default(), 30)
                .into_iter()
                .filter(|full_name| known_repositories.contains(full_name.as_str()))
                .collect::<Vec<_>>();

        if repository_full_names.is_empty() {
            continue;
        }

        suggestions.push(AiTagNetworkSuggestion {
            tag_name,
            color: normalize_color(tag.color.as_deref()),
            repository_full_names,
        });
        if suggestions.len() >= 24 {
            break;
        }
    }

    if suggestions.is_empty() {
        Err("AI 未返回可用的标签网络建议".to_owned())
    } else {
        Ok(suggestions)
    }
}

fn parse_github_recommendation_plan(content: &str) -> Result<AiGithubRecommendationPlan, String> {
    let json_text = extract_json_object(content).unwrap_or_else(|| content.trim().to_owned());
    let parsed = serde_json::from_str::<AiGithubRecommendationJson>(&json_text)
        .map_err(|error| format!("AI GitHub 推荐策略解析失败：{error}"))?;
    let queries = normalize_list(parsed.queries.unwrap_or_default(), 5)
        .into_iter()
        .filter(|query| query.len() <= 180)
        .collect::<Vec<_>>();

    if queries.is_empty() {
        return Err("AI 未返回可用的 GitHub 搜索查询".to_owned());
    }

    Ok(AiGithubRecommendationPlan {
        rationale_zh: normalize_text(parsed.rationale_zh.as_deref())
            .unwrap_or_else(|| "根据所选仓库的功能、语言、Topics 和摘要寻找相似项目。".to_owned()),
        queries,
    })
}

fn normalize_color(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| {
            value.len() == 7
                && value.starts_with('#')
                && value
                    .chars()
                    .skip(1)
                    .all(|character| character.is_ascii_hexdigit())
        })
        .map(str::to_owned)
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn normalize_list(values: Vec<String>, limit: usize) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let item = value.trim();
        if item.is_empty() || normalized.iter().any(|existing: &String| existing == item) {
            continue;
        }
        normalized.push(item.to_owned());
        if normalized.len() >= limit {
            break;
        }
    }
    normalized
}

fn extract_json_object(content: &str) -> Option<String> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    (start <= end).then(|| content[start..=end].to_owned())
}

fn build_endpoint(base_url: Option<&str>, default_base_url: &str, suffix: &str) -> String {
    let base = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_base_url)
        .trim_end_matches('/');

    if base.ends_with(suffix) {
        base.to_owned()
    } else {
        format!("{base}/{suffix}")
    }
}

fn execute_json_post(
    url: &str,
    headers: &[(&str, String)],
    body: &str,
) -> Result<HttpResponse, String> {
    let body_path = write_temp_request_body(body)?;
    let mut config = format!(
        r#"
		silent
	show-error
	location
	connect-timeout = "{AI_CONNECT_TIMEOUT_SECONDS}"
	max-time = "{AI_REQUEST_TIMEOUT_SECONDS}"
	url = "{}"
		request = "POST"
	write-out = "\n__GITHUB_STARS_AI_HTTP_STATUS__:%{{http_code}}"
	data-binary = "@{}"
	"#,
        curl_config_string(url),
        curl_config_string(&body_path.to_string_lossy()),
    );

    for (name, value) in headers {
        config.push_str(&format!(
            "header = \"{}: {}\"\n",
            curl_config_string(name),
            curl_config_string(value)
        ));
    }

    let mut child = Command::new("curl")
        .args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            let _ = fs::remove_file(&body_path);
            format!("AI 接口请求失败：{error}")
        })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "AI 接口请求初始化失败".to_owned())?;
    stdin.write_all(config.as_bytes()).map_err(|error| {
        let _ = fs::remove_file(&body_path);
        format!("AI 接口请求写入失败：{error}")
    })?;
    drop(stdin);

    let output = child.wait_with_output().map_err(|error| {
        let _ = fs::remove_file(&body_path);
        format!("AI 接口请求执行失败：{error}")
    })?;
    let _ = fs::remove_file(&body_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if stderr.to_ascii_lowercase().contains("timed out")
            || stderr.to_ascii_lowercase().contains("timeout")
        {
            return Err(format!(
                "AI 接口请求超时，请检查请求地址、模型 ID 或网络连接（已等待 {AI_REQUEST_TIMEOUT_SECONDS} 秒）。"
            ));
        }
        return Err(if stderr.is_empty() {
            "AI 接口请求失败".to_owned()
        } else {
            format!("AI 接口请求失败：{stderr}")
        });
    }

    let stdout =
        String::from_utf8(output.stdout).map_err(|_| "AI 接口响应不是有效文本".to_owned())?;
    let marker = "\n__GITHUB_STARS_AI_HTTP_STATUS__:";
    let (body, http_code) = match stdout.rsplit_once(marker) {
        Some((body, status)) => (body.to_owned(), status.trim().parse::<u16>().ok()),
        None => (stdout, None),
    };

    Ok(HttpResponse {
        status_success: http_code
            .map(|code| (200..300).contains(&code))
            .unwrap_or(false),
        http_code,
        body,
    })
}

fn write_temp_request_body(body: &str) -> Result<std::path::PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("AI 请求临时文件时间戳生成失败：{error}"))?
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "gsat-ai-request-{}-{timestamp}.json",
        std::process::id()
    ));
    fs::write(&path, body).map_err(|error| format!("AI 请求临时文件写入失败：{error}"))?;
    Ok(path)
}

fn curl_config_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn format_ai_http_error(provider: &str, http_code: Option<u16>, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.pointer("/error/type"))
                .and_then(|message| message.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| truncate_chars(body.trim(), 180));

    if is_token_limit_error(http_code, &detail) {
        return match http_code {
            Some(code) => format!("{provider} 接口请求失败（HTTP {code}）：README 内容超过模型上下文限制，请换用更大上下文模型或降低 README 输入长度。"),
            None => format!("{provider} 接口请求失败：README 内容超过模型上下文限制，请换用更大上下文模型或降低 README 输入长度。"),
        };
    }

    match http_code {
        Some(code) => format!("{provider} 接口请求失败（HTTP {code}）：{detail}"),
        None => format!("{provider} 接口请求失败：{detail}"),
    }
}

fn is_token_limit_error(http_code: Option<u16>, message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    http_code == Some(413)
        || normalized.contains("context length")
        || normalized.contains("maximum context")
        || normalized.contains("too many tokens")
        || (normalized.contains("token") && normalized.contains("limit"))
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut result = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        result.push_str("...");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_endpoint_accepts_base_or_full_endpoint() {
        assert_eq!(
            build_endpoint(
                Some("https://api.example.com/v1/"),
                DEFAULT_OPENAI_BASE_URL,
                "chat/completions"
            ),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(
                Some("https://api.example.com/v1/chat/completions"),
                DEFAULT_OPENAI_BASE_URL,
                "chat/completions"
            ),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn parse_ai_document_extracts_json_from_model_text() {
        let parsed = parse_ai_document(
            r#"这里是结果：
            {"summary_zh":"一个用于管理 GitHub Stars 的工具。","readme_zh":"核心内容","keywords":["rust","rust",""],"suggested_tags":["AI","知识库"]}
            "#,
        )
        .expect("AI JSON 应能解析");

        assert_eq!(
            parsed.summary_zh.as_deref(),
            Some("一个用于管理 GitHub Stars 的工具。")
        );
        assert_eq!(parsed.keywords.unwrap(), vec!["rust"]);
        assert_eq!(parsed.suggested_tags.unwrap(), vec!["AI", "知识库"]);
    }

    #[test]
    fn parse_ai_document_falls_back_to_plain_text_summary() {
        let parsed = parse_ai_document("这是一个普通文本摘要").expect("普通文本应作为摘要兜底");

        assert_eq!(parsed.summary_zh.as_deref(), Some("这是一个普通文本摘要"));
        assert!(parsed.keywords.unwrap().is_empty());
    }

    #[test]
    fn summarize_readme_rejects_local_provider() {
        let error = match summarize_readme(
            &AiRequestConfig {
                provider: "local".to_owned(),
                api_key: "test-key".to_owned(),
                base_url: None,
                model: "unsupported-provider".to_owned(),
            },
            "owner/repo",
            Some("测试仓库"),
            "# README",
        ) {
            Ok(_) => panic!("local provider should not be accepted"),
            Err(error) => error,
        };

        assert!(error.contains("当前仅支持 OpenAI、OpenAI 兼容接口或 Anthropic"));
    }

    #[test]
    fn validate_request_config_maps_openai_compatible_protocol() {
        let provider = validate_request_config(&AiRequestConfig {
            provider: "openai-compatible".to_owned(),
            api_key: "test-key".to_owned(),
            base_url: Some("https://api.example.com/v1".to_owned()),
            model: "custom-chat-model".to_owned(),
        })
        .expect("OpenAI 兼容接口应按 OpenAI 协议执行");

        assert_eq!(provider, "openai");
    }

    #[test]
    fn validate_request_config_requires_openai_compatible_base_url() {
        let error = validate_request_config(&AiRequestConfig {
            provider: "openai-compatible".to_owned(),
            api_key: "test-key".to_owned(),
            base_url: Some("".to_owned()),
            model: "custom-chat-model".to_owned(),
        })
        .expect_err("OpenAI 兼容接口必须显式填写请求地址");

        assert!(error.contains("请填写 OpenAI 兼容接口的请求地址"));
    }

    #[test]
    fn curl_config_string_escapes_control_characters() {
        assert_eq!(
            curl_config_string("a\\b\"c\nd\re\tf"),
            "a\\\\b\\\"c\\nd\\re\\tf"
        );
    }

    #[test]
    fn format_ai_http_error_reports_token_limit() {
        let message = format_ai_http_error(
            "OpenAI",
            Some(400),
            r#"{"error":{"message":"This model's maximum context length is 128000 tokens."}}"#,
        );

        assert!(message.contains("README 内容超过模型上下文限制"));
        assert!(message.contains("OpenAI"));
        assert!(message.contains("HTTP 400"));
    }

    #[test]
    fn format_ai_http_error_reports_payload_too_large_as_token_limit() {
        let message = format_ai_http_error("Anthropic", Some(413), "");

        assert!(message.contains("README 内容超过模型上下文限制"));
        assert!(message.contains("HTTP 413"));
    }
}
