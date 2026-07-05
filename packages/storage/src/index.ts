import type {
  AiRepositoryDocument,
  EmbeddingSourceKind,
  GitHubAccountId,
  PipelineJob,
  ReadmeDocument,
  RepositoryAnnotation,
  RepositoryEmbeddingRecord,
  RepositoryFacts,
  RepositoryId,
} from '@stars-ai/domain';
import { storageMigrations, type SqlMigration } from './migrations.js';

export type ReadmeAiCandidate = {
  repository: RepositoryFacts;
  readme: ReadmeDocument;
  aiDocument: AiRepositoryDocument | null;
};

export type RepositoryEmbeddingCandidate = {
  repository: RepositoryFacts;
  aiDocument: AiRepositoryDocument;
  embedding: RepositoryEmbeddingRecord | null;
};

export type RepositoryEmbeddingLookup = {
  repoId: RepositoryId;
  sourceKind: EmbeddingSourceKind;
  model: string;
  modelVersion: string;
};

export type StoragePort = {
  upsertRepository(repository: RepositoryFacts): Promise<void>;
  getRepository(repoId: RepositoryId): Promise<RepositoryFacts | null>;
  saveReadme(readme: ReadmeDocument): Promise<void>;
  getAiDocument(repoId: RepositoryId): Promise<AiRepositoryDocument | null>;
  listReadmeAiCandidates(accountId: GitHubAccountId, limit: number): Promise<ReadmeAiCandidate[]>;
  saveAiDocument(document: AiRepositoryDocument): Promise<void>;
  getRepositoryEmbedding(lookup: RepositoryEmbeddingLookup): Promise<RepositoryEmbeddingRecord | null>;
  listRepositoryEmbeddingCandidates(
    accountId: GitHubAccountId,
    model: string,
    modelVersion: string,
    limit: number,
  ): Promise<RepositoryEmbeddingCandidate[]>;
  saveRepositoryEmbedding(record: RepositoryEmbeddingRecord): Promise<void>;
  saveAnnotation(annotation: RepositoryAnnotation): Promise<void>;
  listPendingJobs(accountId: GitHubAccountId): Promise<PipelineJob[]>;
};

export type MigrationPort = {
  migrate(): Promise<void>;
};

export type MigrationSource = {
  listMigrations(): readonly SqlMigration[];
};

export const sqliteMigrationSource: MigrationSource = {
  listMigrations() {
    return storageMigrations;
  },
};