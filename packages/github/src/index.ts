import type {
  GitHubAccountId,
  ISODateString,
  ReadmeDocument,
  RepositoryFacts,
  RepositoryId,
} from '@gsat/domain';

export type GitHubAccountProfile = {
  accountId: GitHubAccountId;
  login: string;
  avatarUrl: string | null;
};

export type StarSyncCursor = {
  page: number;
  perPage: number;
  since?: string;
};

export type StarSyncPage = {
  repositories: RepositoryFacts[];
  nextCursor: StarSyncCursor | null;
};

export type GitHubProvider = {
  verifyToken(tokenRef: string): Promise<GitHubAccountProfile>;
  listStarredRepositories(accountId: GitHubAccountId, cursor: StarSyncCursor): Promise<StarSyncPage>;
  fetchReadme(repoId: RepositoryId, fullName: string): Promise<ReadmeDocument | null>;
  searchRepositories(query: string, perPage: number): Promise<GitHubRepositoryRecommendation[]>;
};

export type GitHubFetchLike = (
  input: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type GitHubProviderOptions = {
  apiBaseUrl?: string;
  fetch?: GitHubFetchLike;
  tokenResolver?: (tokenRef: string) => Promise<string> | string;
  now?: () => ISODateString;
};

type GitHubUserResponse = {
  id: number;
  login: string;
  avatar_url?: string | null;
};

type GitHubRepositoryResponse = {
  id: number;
  owner?: { login?: string | null } | null;
  name: string;
  full_name: string;
  description?: string | null;
  language?: string | null;
  topics?: string[] | null;
  html_url: string;
  stargazers_count?: number | null;
  forks_count?: number | null;
  pushed_at?: string | null;
};

type GitHubStarredRepositoryResponse = GitHubRepositoryResponse | {
  starred_at?: string | null;
  repo?: GitHubRepositoryResponse | null;
};

type GitHubReadmeResponse = {
  path?: string | null;
  content?: string | null;
  encoding?: string | null;
};

export type GitHubRepositoryRecommendation = {
  fullName: string;
  description: string | null;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  starsCount: number;
  forksCount: number;
  pushedAt: string | null;
};

type GitHubSearchRepositoryResponse = {
  items?: GitHubRepositoryResponse[] | null;
};

const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_USER_AGENT = 'GitHub-Stars-AI-Tools';

export function createGitHubProvider(options: GitHubProviderOptions = {}): GitHubProvider {
  const request = options.fetch ?? getGlobalFetch();
  const tokenResolver = options.tokenResolver ?? ((tokenRef: string) => tokenRef);
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? DEFAULT_GITHUB_API_BASE_URL);
  const now = options.now ?? (() => new Date().toISOString());
  let verifiedTokenRef: string | null = null;
  let verifiedAccountId: GitHubAccountId | null = null;

  async function resolveToken(tokenRef: string) {
    const token = (await tokenResolver(tokenRef)).trim();
    if (!token) {
      throw new Error('请先填写 GitHub Personal Access Token');
    }
    return token;
  }

  async function requestJson<T>(token: string, path: string, accept = 'application/vnd.github+json') {
    const response = await request(`${apiBaseUrl}${path}`, {
      method: 'GET',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'User-Agent': DEFAULT_USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(formatGitHubError(response.status, body));
    }

    return parseJson<T>(body, 'GitHub 响应解析失败');
  }

  return {
    async verifyToken(tokenRef) {
      const token = await resolveToken(tokenRef);
      const user = await requestJson<GitHubUserResponse>(token, '/user');
      verifiedTokenRef = tokenRef;
      verifiedAccountId = String(user.id);

      return {
        accountId: verifiedAccountId,
        login: user.login,
        avatarUrl: user.avatar_url ?? null,
      };
    },

    async listStarredRepositories(accountId, cursor) {
      if (verifiedAccountId !== accountId || !verifiedTokenRef) {
        throw new Error('请先校验 GitHub Token 后再同步 Stars');
      }
      const token = await resolveToken(verifiedTokenRef);
      const page = normalizePage(cursor.page);
      const perPage = normalizePerPage(cursor.perPage);
      const starred = await requestJson<GitHubStarredRepositoryResponse[]>(
        token,
        `/user/starred?page=${page}&per_page=${perPage}&sort=created&direction=desc`,
        'application/vnd.github.star+json',
      );
      const repositories = starred
        .map((item) => mapStarredRepository(accountId, item))
        .filter((repository) => !cursor.since || repository.starredAt > cursor.since!);

      return {
        repositories,
        nextCursor: starred.length >= perPage
          ? { ...cursor, page: page + 1, perPage }
          : null,
      };
    },

    async fetchReadme(repoId, fullName) {
      if (!verifiedTokenRef) {
        throw new Error('请先校验 GitHub Token 后再抓取 README');
      }
      const token = await resolveToken(verifiedTokenRef);
      const response = await request(`${apiBaseUrl}/repos/${encodeURIComponentFullName(fullName)}/readme`, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': DEFAULT_USER_AGENT,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      const body = await response.text();

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(formatGitHubError(response.status, body));
      }

      const readme = parseJson<GitHubReadmeResponse>(body, 'GitHub README 响应解析失败');
      const rawMarkdown = decodeReadmeContent(readme);

      return {
        repoId,
        rawMarkdown,
        contentHash: createContentHash(rawMarkdown),
        sourcePath: readme.path?.trim() || 'README.md',
        fetchedAt: now(),
      };
    },

    async searchRepositories(query, perPage) {
      if (!verifiedTokenRef) {
        throw new Error('请先校验 GitHub Token 后再搜索相似项目');
      }
      const normalizedQuery = query.trim();
      if (!normalizedQuery) {
        return [];
      }
      const token = await resolveToken(verifiedTokenRef);
      const response = await requestJson<GitHubSearchRepositoryResponse>(
        token,
        `/search/repositories?q=${encodeURIComponent(normalizedQuery)}&sort=stars&order=desc&per_page=${normalizeSearchPerPage(perPage)}`,
      );

      return (response.items ?? []).map(mapSearchRepository);
    },
  };
}

function mapSearchRepository(repository: GitHubRepositoryResponse): GitHubRepositoryRecommendation {
  return {
    fullName: repository.full_name,
    description: repository.description ?? null,
    language: repository.language ?? null,
    topics: Array.isArray(repository.topics) ? repository.topics : [],
    htmlUrl: repository.html_url,
    starsCount: repository.stargazers_count ?? 0,
    forksCount: repository.forks_count ?? 0,
    pushedAt: repository.pushed_at ?? null,
  };
}

function mapStarredRepository(accountId: GitHubAccountId, item: GitHubStarredRepositoryResponse): RepositoryFacts {
  const isWrapped = isStarredRepositoryWrapper(item);
  const repository = isWrapped ? item.repo : item;
  const starredAt = isWrapped ? item.starred_at : null;
  if (!repository) {
    throw new Error('GitHub Stars 响应缺少仓库数据');
  }

  return {
    id: `${accountId}:${repository.id}`,
    accountId,
    owner: repository.owner?.login ?? repository.full_name.split('/')[0] ?? '',
    name: repository.name,
    fullName: repository.full_name,
    description: repository.description ?? null,
    language: repository.language ?? null,
    topics: Array.isArray(repository.topics) ? repository.topics : [],
    htmlUrl: repository.html_url,
    starsCount: repository.stargazers_count ?? 0,
    forksCount: repository.forks_count ?? 0,
    starredAt: starredAt ?? new Date(0).toISOString(),
    pushedAt: repository.pushed_at ?? null,
    syncStatus: 'active',
  };
}

function isStarredRepositoryWrapper(
  item: GitHubStarredRepositoryResponse,
): item is { starred_at?: string | null; repo?: GitHubRepositoryResponse | null } {
  return Object.prototype.hasOwnProperty.call(item, 'repo');
}

function decodeReadmeContent(readme: GitHubReadmeResponse) {
  if (readme.encoding !== 'base64' || !readme.content) {
    throw new Error('GitHub README 响应缺少 base64 内容');
  }

  const normalizedContent = readme.content.replace(/\s+/g, '');
  const bufferCtor = (globalThis as unknown as { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(normalizedContent, 'base64').toString('utf8');
  }

  const atobFn = (globalThis as unknown as { atob?: (value: string) => string }).atob;
  if (!atobFn) {
    throw new Error('当前运行环境不支持 base64 解码');
  }

  const binary = atobFn(normalizedContent);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return decodeUtf8(bytes);
}

function decodeUtf8(bytes: Uint8Array) {
  let output = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!;
    if (first < 0x80) {
      output += String.fromCharCode(first);
      index += 1;
      continue;
    }

    if (first >= 0xc0 && first < 0xe0) {
      const second = bytes[index + 1] ?? 0;
      output += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      index += 2;
      continue;
    }

    if (first >= 0xe0 && first < 0xf0) {
      const second = bytes[index + 1] ?? 0;
      const third = bytes[index + 2] ?? 0;
      output += String.fromCharCode(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
      index += 3;
      continue;
    }

    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const fourth = bytes[index + 3] ?? 0;
    const codePoint = ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
    output += String.fromCodePoint(codePoint);
    index += 4;
  }

  return output;
}

function createContentHash(content: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${content.length}`;
}

function formatGitHubError(status: number, body: string) {
  const message = extractGitHubMessage(body);
  if (status === 401 || status === 403) {
    return `GitHub Token 无效或权限不足（HTTP ${status}）：${message}`;
  }
  if (status === 404) {
    return `GitHub 资源不存在或无权访问（HTTP ${status}）：${message}`;
  }
  return `GitHub API 请求失败（HTTP ${status}）：${message}`;
}

function extractGitHubMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    return parsed.message?.trim() || body.slice(0, 240);
  } catch {
    return body.trim().slice(0, 240) || '无响应内容';
  }
}

function parseJson<T>(body: string, errorPrefix: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new Error(`${errorPrefix}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeApiBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/g, '');
  if (!isAllowedApiBaseUrl(normalized)) {
    throw new Error('GitHub API 地址必须使用 https://；只有本机调试地址可以使用 http://。');
  }
  return normalized;
}

function isAllowedApiBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized.startsWith('https://')) {
    return true;
  }

  if (!normalized.startsWith('http://')) {
    return false;
  }

  const hostWithPort = normalized
    .slice('http://'.length)
    .split(/[/?#]/u, 1)[0] ?? '';
  if (!hostWithPort || hostWithPort.includes('@')) {
    return false;
  }

  const host = hostWithPort.startsWith('[')
    ? hostWithPort.slice(1).split(']', 1)[0] ?? ''
    : hostWithPort.split(':', 1)[0] ?? '';

  return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
}

function normalizePage(value: number) {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 1) : 1;
}

function normalizePerPage(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 100) : 100;
}

function normalizeSearchPerPage(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 30) : 10;
}

function encodeURIComponentFullName(fullName: string) {
  return fullName.split('/').map(encodeURIComponent).join('/');
}

function getGlobalFetch(): GitHubFetchLike {
  const fetchFn = (globalThis as unknown as { fetch?: GitHubFetchLike }).fetch;
  if (!fetchFn) {
    throw new Error('当前运行环境不支持 fetch，请注入自定义 fetch 实现');
  }
  return fetchFn;
}
