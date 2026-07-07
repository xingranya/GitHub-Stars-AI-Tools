import assert from 'node:assert/strict';
import { createRemoteAiProvider } from '../dist/index.js';

const repository = {
  id: '1001:42',
  accountId: '1001',
  owner: 'octo',
  name: 'hello',
  fullName: 'octo/hello',
  description: 'Demo repository',
  language: 'TypeScript',
  topics: ['ai', 'stars'],
  htmlUrl: 'https://github.com/octo/hello',
  starsCount: 1200,
  forksCount: 34,
  starredAt: '2026-01-02T00:00:00Z',
  pushedAt: '2026-01-01T00:00:00Z',
  syncStatus: 'active',
};

const readme = {
  repoId: repository.id,
  rawMarkdown: '# Hello\n\nA demo README for GitHub-Stars-AI-Tools.',
  contentHash: 'hash-readme',
  sourcePath: 'README.md',
  fetchedAt: '2026-01-03T00:00:00Z',
};

const openAiRequests = [];
const openAiProvider = createRemoteAiProvider({
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-test',
  embeddingModel: 'text-embedding-test',
  baseUrl: 'https://llm.example.test/v1/',
  generatedAt: () => '2026-01-04T00:00:00Z',
  fetch: async (url, init) => {
    openAiRequests.push({ url, init, body: JSON.parse(init.body) });

    if (url.endsWith('/chat/completions')) {
      const prompt = JSON.parse(init.body).messages.at(-1)?.content ?? '';
      if (prompt.includes('检索需求')) {
        return jsonResponse(200, {
          choices: [
            {
              message: {
                content: '{"normalized_query":"TypeScript animation tools","inferred_languages":["TypeScript"],"inferred_topics":["animation","tools","React"]}',
              },
            },
          ],
        });
      }

      return jsonResponse(200, {
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: '```json\n{"summary_zh":"适合用 {owner}/{repo} 管理 GitHub Stars 的桌面知识库。",',
                },
                {
                  type: 'text',
                  text: '"readme_zh":"README 中文整理。","keywords":["Stars","AI"],"suggested_tags":["知识库","GitHub"]}\n```\n备注：不要解析这里的 {额外说明}',
                },
              ],
            },
          },
        ],
      });
    }

    if (url.endsWith('/embeddings')) {
      return jsonResponse(200, { data: [{ embedding: [0.1, 0.2, 0.3] }] });
    }

    return jsonResponse(500, { error: { message: `Unexpected URL: ${url}` } });
  },
});

const summary = await openAiProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' });
assert.ok(openAiProvider.metadata.capabilities.includes('embed_text'));
assert.equal(typeof openAiProvider.embed, 'function');
assert.equal(summary.repoId, repository.id);
assert.equal(summary.summaryZh, '适合用 {owner}/{repo} 管理 GitHub Stars 的桌面知识库。');
assert.equal(summary.readmeZh, 'README 中文整理。');
assert.deepEqual(summary.keywords, ['Stars', 'AI']);
assert.deepEqual(summary.suggestedTags, ['知识库', 'GitHub']);
assert.equal(summary.model, 'gpt-test');
assert.equal(summary.promptVersion, 'v1');
assert.equal(summary.sourceHash, 'hash-readme');
assert.equal(summary.generatedAt, '2026-01-04T00:00:00Z');

const embedding = await openAiProvider.embed({ repoId: repository.id, text: 'embedding text', sourceHash: 'hash-ai' });
assert.deepEqual(embedding.vector, [0.1, 0.2, 0.3]);
assert.equal(embedding.model, 'text-embedding-test');
assert.equal(openAiRequests[0].url, 'https://llm.example.test/v1/chat/completions');
assert.equal(openAiRequests[0].init.headers.Authorization, 'Bearer sk-test');
assert.equal(openAiRequests[0].body.model, 'gpt-test');
assert.equal(openAiRequests[1].url, 'https://llm.example.test/v1/embeddings');
assert.equal(openAiRequests[1].body.model, 'text-embedding-test');

const chatOnlyRequests = [];
const chatOnlyProvider = createRemoteAiProvider({
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-test',
  baseUrl: 'https://llm.example.test/v1/',
  fetch: async (url, init) => {
    chatOnlyRequests.push({ url, init, body: JSON.parse(init.body) });
    return jsonResponse(200, {
      choices: [{ message: { content: '{"summary_zh":"默认只需要聊天模型。"}' } }],
    });
  },
});
const chatOnlySummary = await chatOnlyProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' });
assert.equal(chatOnlySummary.summaryZh, '默认只需要聊天模型。');
assert.equal(chatOnlyProvider.metadata.capabilities.includes('embed_text'), false);
assert.equal(chatOnlyProvider.embed, undefined);
assert.equal(chatOnlyRequests.length, 1);
assert.equal(chatOnlyRequests[0].url, 'https://llm.example.test/v1/chat/completions');

const compatibleRequests = [];
const compatibleProvider = createRemoteAiProvider({
  provider: 'openai-compatible',
  apiKey: 'compat-key',
  model: 'compat-chat-model',
  baseUrl: 'https://compat.example.test/v1',
  fetch: async (url, init) => {
    compatibleRequests.push({ url, init, body: JSON.parse(init.body) });
    return jsonResponse(200, {
      choices: [
        {
          message: {
            content: '{"summary_zh":"兼容 OpenAI 协议的摘要。","keywords":["兼容接口"],"suggested_tags":["AI"]}',
          },
        },
      ],
    });
  },
});
const compatibleSummary = await compatibleProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' });
assert.equal(compatibleProvider.metadata.id, 'openai-compatible');
assert.equal(compatibleProvider.metadata.capabilities.includes('embed_text'), false);
assert.equal(compatibleProvider.embed, undefined);
assert.equal(compatibleSummary.summaryZh, '兼容 OpenAI 协议的摘要。');
assert.equal(compatibleRequests[0].url, 'https://compat.example.test/v1/chat/completions');
assert.equal(compatibleRequests[0].init.headers.Authorization, 'Bearer compat-key');
assert.equal(compatibleRequests[0].body.model, 'compat-chat-model');

const anthropicRequests = [];
const anthropicProvider = createRemoteAiProvider({
  provider: 'anthropic',
  apiKey: 'ant-test',
  model: 'claude-test',
  baseUrl: 'https://anthropic.example.test/v1/messages',
  generatedAt: () => '2026-01-04T00:00:00Z',
  fetch: async (url, init) => {
    anthropicRequests.push({ url, init, body: JSON.parse(init.body) });
    const prompt = JSON.parse(init.body).messages.at(-1)?.content ?? '';
    if (prompt.includes('检索需求')) {
      return jsonResponse(200, {
        content: [
          {
            text: '{"normalized_query":"Rust task queue","inferred_languages":["Rust"],"inferred_topics":["任务队列","并发"]}',
          },
        ],
      });
    }

    return jsonResponse(200, {
      content: [
        {
          text: '{"summary_zh":"Claude 生成的摘要。",',
        },
        {
          text: '"keywords":["Claude"],"suggested_tags":["AI"]}',
        },
      ],
    });
  },
});

const anthropicSummary = await anthropicProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' });
assert.equal(anthropicSummary.summaryZh, 'Claude 生成的摘要。');
assert.deepEqual(anthropicSummary.keywords, ['Claude']);
assert.equal(anthropicRequests[0].url, 'https://anthropic.example.test/v1/messages');
assert.equal(anthropicRequests[0].init.headers['x-api-key'], 'ant-test');
assert.equal(anthropicRequests[0].init.headers['anthropic-version'], '2023-06-01');
assert.equal(anthropicRequests[0].body.model, 'claude-test');

assert.equal(anthropicProvider.metadata.capabilities.includes('embed_text'), false);
assert.equal(anthropicProvider.embed, undefined);

const queryUnderstanding = await openAiProvider.understandQuery('  TypeScript animation tools  ');
assert.equal(queryUnderstanding.normalizedQuery, 'TypeScript animation tools');
assert.deepEqual(queryUnderstanding.inferredLanguages, ['TypeScript']);
assert.deepEqual(queryUnderstanding.inferredTopics, ['animation', 'tools', 'React']);
assert.equal(openAiRequests[2].url, 'https://llm.example.test/v1/chat/completions');
assert.match(openAiRequests[2].body.messages[1].content, /检索需求/);

const anthropicQueryUnderstanding = await anthropicProvider.understandQuery('Rust 并发任务队列');
assert.equal(anthropicQueryUnderstanding.normalizedQuery, 'Rust task queue');
assert.deepEqual(anthropicQueryUnderstanding.inferredLanguages, ['Rust']);
assert.deepEqual(anthropicQueryUnderstanding.inferredTopics, ['任务队列', '并发']);
assert.equal(anthropicRequests[1].url, 'https://anthropic.example.test/v1/messages');
assert.match(anthropicRequests[1].body.messages[0].content, /检索需求/);

assert.throws(
  () => createRemoteAiProvider({ provider: 'openai', apiKey: '', model: 'gpt-test' }),
  /请先填写 AI API Key/,
);
assert.throws(
  () => createRemoteAiProvider({ provider: 'openai', apiKey: 'sk-test', model: ' ' }),
  /请先填写 AI 模型 ID/,
);

const failingProvider = createRemoteAiProvider({
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-test',
  fetch: async () => jsonResponse(413, { error: { message: 'maximum context length exceeded' } }),
});
await assert.rejects(
  () => failingProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' }),
  /上下文限制/,
);

const gatewayArrayErrorProvider = createRemoteAiProvider({
  provider: 'openai-compatible',
  apiKey: 'compat-key',
  model: 'compat-chat-model',
  baseUrl: 'https://compat.example.test/v1',
  fetch: async () => jsonResponse(400, { errors: [{ code: 'bad_request', message: 'model does not exist' }] }),
});
await assert.rejects(
  () => gatewayArrayErrorProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' }),
  /model does not exist/,
);

const nestedTokenLimitProvider = createRemoteAiProvider({
  provider: 'anthropic',
  apiKey: 'ant-test',
  model: 'claude-test',
  fetch: async () => jsonResponse(400, { error: { details: [{ message: 'too many tokens in prompt' }] } }),
});
await assert.rejects(
  () => nestedTokenLimitProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' }),
  /上下文限制/,
);

const localHttpProvider = createRemoteAiProvider({
  provider: 'openai-compatible',
  apiKey: '',
  model: 'local-model',
  baseUrl: 'http://127.0.0.1:11434/v1',
  fetch: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(init.headers.Authorization, undefined);
    return jsonResponse(200, {
      choices: [{ message: { content: '{"summary_zh":"本机模型摘要。"}' } }],
    });
  },
});
const localHttpSummary = await localHttpProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' });
assert.equal(localHttpSummary.summaryZh, '本机模型摘要。');

const localIpv6Provider = createRemoteAiProvider({
  provider: 'openai-compatible',
  apiKey: 'local-key',
  model: 'local-model',
  baseUrl: 'http://[::1]:11434/v1',
  fetch: async (url) => {
    assert.equal(url, 'http://[::1]:11434/v1/chat/completions');
    return jsonResponse(200, {
      choices: [{ message: { content: '{"summary_zh":"IPv6 本机模型摘要。"}' } }],
    });
  },
});
const localIpv6Summary = await localIpv6Provider.summarizeReadme({ repository, readme, promptVersion: 'v1' });
assert.equal(localIpv6Summary.summaryZh, 'IPv6 本机模型摘要。');

const publicHttpProvider = createRemoteAiProvider({
  provider: 'openai-compatible',
  apiKey: 'compat-key',
  model: 'compat-chat-model',
  baseUrl: 'http://compat.example.test/v1',
  fetch: async () => jsonResponse(500, { error: { message: 'should not request public http' } }),
});
await assert.rejects(
  () => publicHttpProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' }),
  /AI 请求地址必须使用 https:\/\/；只有本机调试地址可以使用 http:\/\//,
);

const userinfoSpoofProvider = createRemoteAiProvider({
  provider: 'openai-compatible',
  apiKey: 'compat-key',
  model: 'compat-chat-model',
  baseUrl: 'http://localhost@compat.example.test/v1',
  fetch: async () => jsonResponse(500, { error: { message: 'should not request spoofed http' } }),
});
await assert.rejects(
  () => userinfoSpoofProvider.summarizeReadme({ repository, readme, promptVersion: 'v1' }),
  /AI 请求地址必须使用 https:\/\/；只有本机调试地址可以使用 http:\/\//,
);

console.log('AI provider verification passed.');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
