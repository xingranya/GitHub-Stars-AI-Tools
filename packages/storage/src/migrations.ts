export type SqlMigration = {
  version: string;
  name: string;
  fileName: string;
};

export const storageMigrations: SqlMigration[] = [
  {
    version: '001',
    name: 'initial_schema',
    fileName: '001_initial_schema.sql',
  },
  {
    version: '002',
    name: 'embedding_invalidation',
    fileName: '002_embedding_invalidation.sql',
  },
  {
    version: '003',
    name: 'embedding_dirty_queue',
    fileName: '003_embedding_dirty_queue.sql',
  },
];
