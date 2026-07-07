import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const sourceUrl = new URL('../src/index.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
const { createGitHubProvider } = await import(moduleUrl);

const requests = [];
const fetch = async (url, init) => {
  requests.push({ url, init });
  const path = new URL(url).pathname;

  if (init.headers.Authorization !== 'Bearer ghp_valid') {
    return jsonResponse(401, { message: 'Bad credentials' });
  }

  if (path === '/user') {
    return jsonResponse(200, { id: 1001, login: 'alice', avatar_url: 'https://example.com/avatar.png' });
  }

  if (path === '/user/starred') {
    return jsonResponse(200, [
      {
        starred_at: '2026-01-02T00:00:00Z',
        repo: {
          id: 42,
          owner: { login: 'octo' },
          name: 'hello',
          full_name: 'octo/hello',
          description: 'Demo repository',
          language: 'TypeScript',
          topics: ['ai', 'stars'],
          html_url: 'https://github.com/octo/hello',
          stargazers_count: 1200,
          forks_count: 34,
          pushed_at: '2026-01-01T00:00:00Z',
        },
      },
    ]);
  }

  if (path === '/repos/octo/hello/readme') {
    return jsonResponse(200, {
      path: 'README.md',
      encoding: 'base64',
      content: Buffer.from('# Hello\n\nREADME body', 'utf8').toString('base64'),
    });
  }

  if (path === '/repos/octo/missing/readme') {
    return jsonResponse(404, { message: 'Not Found' });
  }

  if (path === '/search/repositories') {
    return jsonResponse(200, {
      items: [
        {
          id: 84,
          owner: { login: 'better' },
          name: 'hello-plus',
          full_name: 'better/hello-plus',
          description: 'A better demo repository',
          language: 'TypeScript',
          topics: ['ai', 'stars', 'search'],
          html_url: 'https://github.com/better/hello-plus',
          stargazers_count: 4500,
          forks_count: 120,
          pushed_at: '2026-01-02T00:00:00Z',
        },
      ],
    });
  }

  return jsonResponse(500, { message: `Unexpected path: ${path}` });
};

const provider = createGitHubProvider({
  fetch,
  now: () => '2026-01-03T00:00:00Z',
  tokenResolver: (tokenRef) => tokenRef === 'valid-ref' ? 'ghp_valid' : tokenRef,
});

const profile = await provider.verifyToken('valid-ref');
assert.deepEqual(profile, {
  accountId: '1001',
  login: 'alice',
  avatarUrl: 'https://example.com/avatar.png',
});

const page = await provider.listStarredRepositories('1001', { page: 1, perPage: 30 });
assert.equal(page.repositories.length, 1);
assert.equal(page.repositories[0].id, '1001:42');
assert.equal(page.repositories[0].fullName, 'octo/hello');
assert.equal(page.repositories[0].language, 'TypeScript');
assert.equal(page.repositories[0].starredAt, '2026-01-02T00:00:00Z');

const readme = await provider.fetchReadme('1001:42', 'octo/hello');
assert.equal(readme.rawMarkdown, '# Hello\n\nREADME body');
assert.equal(readme.sourcePath, 'README.md');
assert.equal(readme.fetchedAt, '2026-01-03T00:00:00Z');
assert.match(readme.contentHash, /^fnv1a-/);

const missingReadme = await provider.fetchReadme('1001:404', 'octo/missing');
assert.equal(missingReadme, null);

const recommendations = await provider.searchRepositories('react animation language:TypeScript stars:>1000', 100);
assert.equal(recommendations.length, 1);
assert.equal(recommendations[0].fullName, 'better/hello-plus');
assert.equal(recommendations[0].starsCount, 4500);
assert.equal(recommendations[0].forksCount, 120);
assert.deepEqual(recommendations[0].topics, ['ai', 'stars', 'search']);
const searchRequest = requests.find((request) => new URL(request.url).pathname === '/search/repositories');
assert.ok(searchRequest, '必须请求 GitHub Search API');
assert.equal(
  new URL(searchRequest.url).search,
  '?q=react%20animation%20language%3ATypeScript%20stars%3A%3E1000&sort=stars&order=desc&per_page=30',
);

await assert.rejects(
  () => createGitHubProvider({ fetch }).verifyToken('bad-token'),
  /Token 无效或权限不足/,
);
await assert.rejects(
  () => createGitHubProvider({ fetch }).searchRepositories('react', 10),
  /请先校验 GitHub Token 后再搜索相似项目/,
);

const localHttpProvider = createGitHubProvider({
  apiBaseUrl: 'http://127.0.0.1:3000',
  fetch,
  tokenResolver: (tokenRef) => tokenRef === 'valid-ref' ? 'ghp_valid' : tokenRef,
});
const localProfile = await localHttpProvider.verifyToken('valid-ref');
assert.equal(localProfile.accountId, '1001');
assert.ok(
  requests.some((request) => request.url === 'http://127.0.0.1:3000/user'),
  '本机 HTTP GitHub API 地址应允许用于本地调试',
);

const localIpv6Provider = createGitHubProvider({
  apiBaseUrl: 'http://[::1]:3000',
  fetch,
  tokenResolver: (tokenRef) => tokenRef === 'valid-ref' ? 'ghp_valid' : tokenRef,
});
const localIpv6Profile = await localIpv6Provider.verifyToken('valid-ref');
assert.equal(localIpv6Profile.accountId, '1001');
assert.ok(
  requests.some((request) => request.url === 'http://[::1]:3000/user'),
  'IPv6 本机 HTTP GitHub API 地址应允许用于本地调试',
);

assert.throws(
  () => createGitHubProvider({ apiBaseUrl: 'http://github.enterprise.example/api/v3', fetch }),
  /GitHub API 地址必须使用 https:\/\/；只有本机调试地址可以使用 http:\/\//,
);
assert.throws(
  () => createGitHubProvider({ apiBaseUrl: 'http://localhost@github.enterprise.example/api/v3', fetch }),
  /GitHub API 地址必须使用 https:\/\/；只有本机调试地址可以使用 http:\/\//,
);

assert.equal(requests[0].init.headers['User-Agent'], 'GitHub-Stars-AI-Tools');
console.log('GitHub provider verification passed.');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
