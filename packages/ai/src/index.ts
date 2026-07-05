import type { AiRepositoryDocument, ISODateString, ReadmeDocument, RepositoryFacts, RepositoryId } from '@stars-ai/domain';

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

export type MockAiProviderOptions = {
  model?: string;
  generatedAt?: () => ISODateString;
};

const defaultMockGeneratedAt = (): ISODateString => new Date().toISOString();

/**
 * 创建不访问网络的 Provider，用于验证摘要、翻译、Embedding 编排链路。
 */
export function createMockAiProvider(options: MockAiProviderOptions = {}): AiProvider {
  const model = options.model ?? 'mock-ai-provider';
  const generatedAt = options.generatedAt ?? defaultMockGeneratedAt;

  return {
    metadata: {
      id: 'mock',
      displayName: 'Mock AI Provider',
      model,
      capabilities: ['summarize_readme', 'translate_readme', 'embed_text', 'understand_query'],
    },

    async summarizeReadme(input) {
      const summarySource = firstReadableParagraph(input.readme.rawMarkdown) ?? input.repository.description ?? input.repository.fullName;
      const keywords = extractRepositoryKeywords(input.repository, input.readme.rawMarkdown);
      const suggestedTags = suggestRepositoryTags(input.repository, keywords);

      return {
        repoId: input.repository.id,
        summaryZh: buildMockSummary(input.repository, summarySource, keywords),
        readmeZh: null,
        keywords,
        suggestedTags,
        model,
        promptVersion: input.promptVersion,
        sourceHash: input.readme.contentHash,
        generatedAt: generatedAt(),
      };
    },

    async translateReadme(input) {
      const normalizedMarkdown = normalizeWhitespace(input.readme.rawMarkdown);
      const readmeZh = normalizedMarkdown.length > 0
        ? `【Mock 中文翻译】${normalizedMarkdown}`
        : `【Mock 中文翻译】${input.repository.fullName} 暂无 README 内容。`;

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
      return {
        repoId: input.repoId,
        vector: toDeterministicVector(input.text, 32),
        model,
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

const commonStopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'you',
  'your',
  'are',
  'can',
  'use',
  'using',
  'install',
  'readme',
  'github',
]);

function buildMockSummary(repository: RepositoryFacts, summarySource: string, keywords: string[]) {
  const languagePart = repository.language ? `主要语言是 ${repository.language}` : '主要语言暂未标注';
  const topicPart = repository.topics.length > 0 ? `已标注 Topics：${repository.topics.slice(0, 5).join('、')}` : '暂无 GitHub Topics';
  const keywordPart = keywords.length > 0 ? `关键词：${keywords.slice(0, 6).join('、')}` : '关键词待补充';

  return `${repository.fullName} 适合用于理解或复用该项目能力。${languagePart}，${topicPart}。README 重点信息：${summarySource}。${keywordPart}。`;
}

function suggestRepositoryTags(repository: RepositoryFacts, keywords: string[]) {
  const candidates = [repository.language, ...repository.topics, ...keywords]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.toLowerCase())
    .filter((item) => !commonStopWords.has(item));

  return Array.from(new Set(candidates)).slice(0, 6);
}

function firstReadableParagraph(markdown: string) {
  return markdown
    .split(/\n{2,}/u)
    .map((part) => normalizeWhitespace(part.replace(/^#+\s*/u, '')))
    .find((part) => part.length >= 20)
    ?.slice(0, 220);
}

function extractRepositoryKeywords(repository: RepositoryFacts, readmeMarkdown: string) {
  const candidates = [
    repository.language,
    ...repository.topics,
    ...tokenize(repository.description ?? ''),
    ...tokenize(readmeMarkdown),
  ].filter((item): item is string => Boolean(item));

  return Array.from(new Set(candidates.map((item) => item.toLowerCase())))
    .filter((item) => item.length >= 2 && !commonStopWords.has(item))
    .slice(0, 12);
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

function toDeterministicVector(text: string, dimensions: number) {
  const vector = Array.from({ length: dimensions }, () => 0);

  for (const [index, char] of Array.from(text).entries()) {
    vector[index % dimensions] += char.codePointAt(0) ?? 0;
  }

  const magnitude = Math.hypot(...vector) || 1;

  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}