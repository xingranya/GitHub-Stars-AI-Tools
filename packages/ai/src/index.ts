import type { AiRepositoryDocument, ISODateString, ReadmeDocument, RepositoryFacts, RepositoryId } from '@gsat/domain';

export type AiProviderCapability = 'summarize_readme' | 'translate_readme' | 'embed_text' | 'understand_query';

export type AiProviderMetadata = {
  id: string;
  displayName: string;
  model: string;
  capabilities: AiProviderCapability[];
};

export type AiTaskUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type SummarizeReadmeInput = {
  repository: RepositoryFacts;
  readme: ReadmeDocument;
  promptVersion: string;
};

export type TranslateReadmeInput = {
  repository: RepositoryFacts;
  readme: ReadmeDocument;
  promptVersion: string;
};

export type TranslateReadmeResult = {
  repoId: RepositoryId;
  readmeZh: string;
  model: string;
  promptVersion: string;
  sourceHash: string;
  generatedAt: ISODateString;
  usage: AiTaskUsage;
};

export type EmbeddingInput = {
  repoId: RepositoryId;
  text: string;
  sourceHash: string;
};

export type EmbeddingResult = {
  repoId: RepositoryId;
  vector: number[];
  model: string;
  sourceHash: string;
};

export type QueryUnderstanding = {
  normalizedQuery: string;
  inferredLanguages: string[];
  inferredTopics: string[];
};

export type AiProvider = {
  metadata: AiProviderMetadata;
  summarizeReadme(input: SummarizeReadmeInput): Promise<AiRepositoryDocument>;
  translateReadme(input: TranslateReadmeInput): Promise<TranslateReadmeResult>;
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
  understandQuery(query: string): Promise<QueryUnderstanding>;
};

export type RemoteAiProviderProtocol = 'openai' | 'anthropic';

export type RemoteAiProviderOptions = {
  provider: RemoteAiProviderProtocol;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  generatedAt?: () => ISODateString;
};

type FetchLike = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const defaultGeneratedAt = (): ISODateString => new Date().toISOString();
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_README_CHARS = 18_000;

/**
 * 创建真实远程 AI Provider，支持 OpenAI Chat Completions 协议和 Anthropic Messages 协议。
 */
export function createRemoteAiProvider(options: RemoteAiProviderOptions): AiProvider {
  const provider = options.provider;
  const model = options.model.trim();
  const embeddingModel = options.embeddingModel?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL;
  const apiKey = options.apiKey.trim();
  const request = options.fetch ?? getGlobalFetch();
  const generatedAt = options.generatedAt ?? defaultGeneratedAt;
  const capabilities: AiProviderCapability[] = provider === 'openai'
    ? ['summarize_readme', 'translate_readme', 'understand_query', 'embed_text']
    : ['summarize_readme', 'translate_readme', 'understand_query'];

  if (!apiKey) {
    throw new Error('请先填写 AI API Key');
  }

  if (!model) {
    throw new Error('请先填写 AI 模型 ID');
  }

  return {
    metadata: {
      id: provider,
      displayName: provider === 'openai' ? 'OpenAI Compatible Provider' : 'Anthropic Claude Provider',
      model,
      capabilities,
    },

    async summarizeReadme(input) {
      const content = await requestAiText({
        provider,
        request,
        apiKey,
        model,
        baseUrl: options.baseUrl,
        prompt: buildSummaryPrompt(input.repository, input.readme.rawMarkdown),
      });
      const parsed = parseAiJsonDocument(content);

      return {
        repoId: input.repository.id,
        summaryZh: parsed.summaryZh,
        readmeZh: parsed.readmeZh,
        keywords: parsed.keywords,
        suggestedTags: parsed.suggestedTags,
        model,
        promptVersion: input.promptVersion,
        sourceHash: input.readme.contentHash,
        generatedAt: generatedAt(),
      };
    },

    async translateReadme(input) {
      const content = await requestAiText({
        provider,
        request,
        apiKey,
        model,
        baseUrl: options.baseUrl,
        prompt: buildTranslationPrompt(input.repository, input.readme.rawMarkdown),
      });
      const readmeZh = normalizeWhitespace(extractJsonStringField(content, 'readme_zh') ?? content);

      return {
        repoId: input.repository.id,
        readmeZh,
        model,
        promptVersion: input.promptVersion,
        sourceHash: input.readme.contentHash,
        generatedAt: generatedAt(),
        usage: {
          inputTokens: estimateTokens(input.readme.rawMarkdown),
          outputTokens: estimateTokens(readmeZh),
        },
      };
    },

    async embed(input) {
      if (provider !== 'openai') {
        throw new Error('Anthropic Messages 协议不提供 Embedding 接口，请改用 OpenAI 兼容 Provider 生成向量索引。');
      }

      const vector = await requestOpenAiEmbedding({
        request,
        apiKey,
        model: embeddingModel,
        baseUrl: options.baseUrl,
        text: input.text,
      });

      return {
        repoId: input.repoId,
        vector,
        model: embeddingModel,
        sourceHash: input.sourceHash,
      };
    },

    async understandQuery(query) {
      const normalizedQuery = normalizeWhitespace(query);
      const tokens = tokenize(normalizedQuery);

      return {
        normalizedQuery,
        inferredLanguages: inferLanguages(tokens),
        inferredTopics: tokens.filter((token) => token.length >= 3).slice(0, 8),
      };
    },
  };
}

type AiTextRequest = {
  provider: RemoteAiProviderProtocol;
  request: FetchLike;
  apiKey: string;
  model: string;
  baseUrl?: string;
  prompt: string;
};

type OpenAiEmbeddingRequest = {
  request: FetchLike;
  apiKey: string;
  model: string;
  baseUrl?: string;
  text: string;
};

type ParsedAiJsonDocument = {
  summaryZh: string;
  readmeZh: string | null;
  keywords: string[];
  suggestedTags: string[];
};

async function requestAiText(input: AiTextRequest) {
  const endpoint = buildTextEndpoint(input.provider, input.baseUrl);
  const response = input.provider === 'openai'
    ? await requestOpenAiText(input.request, endpoint, input.apiKey, input.model, input.prompt)
    : await requestAnthropicText(input.request, endpoint, input.apiKey, input.model, input.prompt);

  return response.trim();
}

async function requestOpenAiEmbedding(input: OpenAiEmbeddingRequest) {
  const endpoint = buildOpenAiEndpoint(input.baseUrl, 'embeddings');
  const response = await input.request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      input: truncateText(input.text, 24_000),
      encoding_format: 'float',
    }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(formatRemoteAiError('OpenAI Embeddings', response.status, body));
  }

  const vector = readNumberListPath(parseJsonValue(body), ['data', 0, 'embedding']);

  if (vector.length === 0) {
    throw new Error('OpenAI Embeddings 响应中没有向量数据');
  }

  return vector;
}

async function requestOpenAiText(
  request: FetchLike,
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
) {
  const response = await request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是开源项目知识库助手。只输出 JSON，不要输出 Markdown。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(formatRemoteAiError('OpenAI', response.status, body));
  }

  const parsed = parseJsonValue(body);
  const content = getPathString(parsed, ['choices', 0, 'message', 'content']);

  if (!content) {
    throw new Error('OpenAI 响应中没有摘要内容');
  }

  return content;
}

async function requestAnthropicText(
  request: FetchLike,
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
) {
  const response = await request(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: '你是开源项目知识库助手。只输出 JSON，不要输出 Markdown。',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(formatRemoteAiError('Anthropic', response.status, body));
  }

  const parsed = parseJsonValue(body);
  const content = getPathString(parsed, ['content', 0, 'text']);

  if (!content) {
    throw new Error('Anthropic 响应中没有摘要内容');
  }

  return content;
}

function buildTextEndpoint(provider: RemoteAiProviderProtocol, baseUrl: string | undefined) {
  return provider === 'openai'
    ? buildOpenAiEndpoint(baseUrl, 'chat/completions')
    : buildProviderEndpoint(baseUrl, DEFAULT_ANTHROPIC_BASE_URL, 'messages');
}

function buildOpenAiEndpoint(baseUrl: string | undefined, suffix: string) {
  return buildProviderEndpoint(baseUrl, DEFAULT_OPENAI_BASE_URL, suffix);
}

function buildProviderEndpoint(baseUrl: string | undefined, defaultBaseUrl: string, suffix: string) {
  const normalizedBaseUrl = (baseUrl?.trim() || defaultBaseUrl).replace(/\/+$/u, '');

  if (!/^https?:\/\//iu.test(normalizedBaseUrl)) {
    throw new Error('AI 请求地址必须以 http:// 或 https:// 开头');
  }

  return normalizedBaseUrl.endsWith(suffix) ? normalizedBaseUrl : `${normalizedBaseUrl}/${suffix}`;
}

function buildSummaryPrompt(repository: RepositoryFacts, readmeMarkdown: string) {
  const readme = buildReadmeExcerpt(readmeMarkdown);

  return `请分析这个 GitHub 仓库 README，生成结构化中文知识卡片。

仓库：${repository.fullName}
描述：${repository.description ?? '无'}
语言：${repository.language ?? '未标注'}
Topics：${repository.topics.join(', ') || '无'}
内容状态：${readme.status}

输出必须是严格 JSON，对象字段如下：
- summary_zh: 80 到 160 字中文摘要，说明项目解决什么问题、适合什么场景。
- readme_zh: 可选，README 核心内容中文梳理，200 到 500 字。
- keywords: 5 到 10 个关键词，数组。
- suggested_tags: 3 到 6 个适合知识库管理的短标签，数组。

README:
${readme.excerpt}`;
}

function buildTranslationPrompt(repository: RepositoryFacts, readmeMarkdown: string) {
  const readme = buildReadmeExcerpt(readmeMarkdown);

  return `请把这个 GitHub 仓库 README 的核心内容整理为中文，保留关键命令、API 名称和项目名。

仓库：${repository.fullName}
内容状态：${readme.status}

输出必须是 JSON：{ "readme_zh": "中文整理内容" }

README:
${readme.excerpt}`;
}

function buildReadmeExcerpt(readmeMarkdown: string) {
  const excerpt = readmeMarkdown.slice(0, MAX_README_CHARS);
  const status = readmeMarkdown.length > MAX_README_CHARS
    ? 'README 内容较长，以下内容已截取开头部分。请基于已提供内容总结，不要编造未出现的信息。'
    : 'README 内容完整。';

  return { excerpt, status };
}

function parseAiJsonDocument(content: string): ParsedAiJsonDocument {
  const parsed = parseJsonValue(extractJsonObject(content) ?? content);
  const summaryZh = readStringField(parsed, 'summary_zh') ?? truncateText(normalizeWhitespace(content), 180);

  if (!summaryZh) {
    throw new Error('AI 返回内容为空，无法生成摘要');
  }

  return {
    summaryZh,
    readmeZh: readStringField(parsed, 'readme_zh'),
    keywords: readStringListField(parsed, 'keywords').slice(0, 10),
    suggestedTags: readStringListField(parsed, 'suggested_tags').slice(0, 8),
  };
}

function extractJsonStringField(content: string, fieldName: string) {
  const parsed = parseJsonValue(extractJsonObject(content) ?? content);

  return readStringField(parsed, fieldName);
}

function extractJsonObject(content: string) {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');

  return start >= 0 && end >= start ? content.slice(start, end + 1) : null;
}

function parseJsonValue(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readStringField(value: unknown, fieldName: string) {
  if (!value || typeof value !== 'object' || !(fieldName in value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[fieldName];

  return typeof fieldValue === 'string' ? normalizeWhitespace(fieldValue) : null;
}

function readStringListField(value: unknown, fieldName: string) {
  if (!value || typeof value !== 'object' || !(fieldName in value)) {
    return [];
  }

  const fieldValue = (value as Record<string, unknown>)[fieldName];

  if (!Array.isArray(fieldValue)) {
    return [];
  }

  return Array.from(
    new Set(
      fieldValue
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeWhitespace(item))
        .filter((item) => item.length > 0),
    ),
  );
}

function getPathString(value: unknown, path: Array<string | number>) {
  let current = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return null;
      }
      current = current[segment];
    } else {
      if (!current || typeof current !== 'object') {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return typeof current === 'string' ? current : null;
}

function readNumberListPath(value: unknown, path: Array<string | number>) {
  let current = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return [];
      }
      current = current[segment];
    } else {
      if (!current || typeof current !== 'object') {
        return [];
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }

  if (!Array.isArray(current)) {
    return [];
  }

  return current.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function formatRemoteAiError(provider: string, status: number, body: string) {
  const parsed = parseJsonValue(body);
  const message = getPathString(parsed, ['error', 'message'])
    ?? getPathString(parsed, ['error', 'type'])
    ?? truncateText(normalizeWhitespace(body), 180)
    ?? '接口没有返回错误详情';

  if (isTokenLimitError(status, message)) {
    return `${provider} 接口请求失败（HTTP ${status}）：README 内容超过模型上下文限制，请换用更大上下文模型或降低 README 输入长度。`;
  }

  return `${provider} 接口请求失败（HTTP ${status}）：${message}`;
}

function isTokenLimitError(status: number, message: string) {
  const normalized = message.toLowerCase();
  return (
    status === 413 ||
    normalized.includes('context length') ||
    normalized.includes('maximum context') ||
    normalized.includes('token') && normalized.includes('limit') ||
    normalized.includes('too many tokens')
  );
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function getGlobalFetch() {
  const fetchFn = (globalThis as { fetch?: FetchLike }).fetch;

  if (!fetchFn) {
    throw new Error('当前运行环境不支持 fetch，请注入自定义 fetch 实现');
  }

  return fetchFn;
}

function inferLanguages(tokens: string[]) {
  const languageNames = new Set(['typescript', 'javascript', 'rust', 'python', 'go', 'java', 'swift', 'kotlin', 'ruby']);

  return tokens.filter((token) => languageNames.has(token.toLowerCase()));
}

function tokenize(value: string) {
  return normalizeWhitespace(value)
    .split(/[^\p{L}\p{N}+#.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}
