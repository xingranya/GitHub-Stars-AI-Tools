import type {
  GitHubAccountId,
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
};