import { AppShell } from '@/components/app-shell';
import { KnowledgePanel } from '@/features/knowledge/knowledge-panel';
import { RepositoryFilterBar } from '@/features/repositories/repository-filter-bar';
import { RepositoryTable } from '@/features/repositories/repository-table';
import { ConnectionPanel } from '@/features/sidebar/connection-panel';
import { SyncPanel } from '@/features/sidebar/sync-panel';
import { SystemPanel } from '@/features/sidebar/system-panel';
import { useStarsWorkspace } from '@/hooks/use-stars-workspace';

export function App() {
  const workspace = useStarsWorkspace();

  return (
    <AppShell
      authState={workspace.authState}
      error={workspace.error}
      message={workspace.authMessage}
      repositoryStats={workspace.repositoryStats}
      status={workspace.status}
      toolbar={
        <RepositoryFilterBar
          filters={workspace.repositoryFilters}
          isLoading={workspace.isLoadingRepositories}
          languages={workspace.repositoryLanguages}
          tags={workspace.tags}
          onApplyFilters={workspace.applyRepositoryFilters}
          onResetFilters={workspace.resetRepositoryFilters}
        />
      }
      sidebar={
        <>
          <ConnectionPanel
            authState={workspace.authState}
            isClearingToken={workspace.isClearingToken}
            isSavingToken={workspace.isSavingToken}
            token={workspace.token}
            onClearToken={workspace.handleClearToken}
            onSaveToken={workspace.handleSaveToken}
            onSetToken={workspace.setToken}
          />
          <SyncPanel
            authState={workspace.authState}
            gistIdDraft={workspace.gistIdDraft}
            isExportingAnnotations={workspace.isExportingAnnotations}
            isFetchingReadmes={workspace.isFetchingReadmes}
            isImportingAnnotations={workspace.isImportingAnnotations}
            isSyncingStars={workspace.isSyncingStars}
            readmeSummary={workspace.readmeSummary}
            syncSummary={workspace.syncSummary}
            onExportAnnotations={workspace.handleExportAnnotations}
            onFetchReadmes={workspace.handleFetchReadmes}
            onImportAnnotations={workspace.handleImportAnnotations}
            onSetGistIdDraft={workspace.setGistIdDraft}
            onSyncStars={workspace.handleSyncStars}
          />
          <SystemPanel status={workspace.status} stats={workspace.repositoryStats} />
        </>
      }
      content={
        <RepositoryTable
          filters={workspace.repositoryFilters}
          isLoading={workspace.isLoadingRepositories}
          page={workspace.repositoryPage}
          selectedRepository={workspace.selectedRepository}
          tags={workspace.tags}
          onRefresh={workspace.refreshRepositoryWorkspace}
          onSelectRepository={workspace.setSelectedRepositoryId}
        />
      }
      detail={
        <KnowledgePanel
          annotation={workspace.annotation}
          annotationMessage={workspace.annotationMessage}
          isLoadingAnnotation={workspace.isLoadingAnnotation}
          isLoadingRepositoryDetail={workspace.isLoadingRepositoryDetail}
          isSavingAnnotation={workspace.isSavingAnnotation}
          isSavingTag={workspace.isSavingTag}
          newTagColor={workspace.newTagColor}
          newTagName={workspace.newTagName}
          noteDraft={workspace.noteDraft}
          readingStatusDraft={workspace.readingStatusDraft}
          repository={workspace.selectedRepository}
          repositoryDetail={workspace.repositoryDetail}
          tags={workspace.tags}
          onCreateTag={workspace.handleCreateTag}
          onDeleteTag={workspace.handleDeleteTag}
          onRenameTag={workspace.handleRenameTag}
          onSaveAnnotation={workspace.handleSaveAnnotation}
          onSetNewTagColor={workspace.setNewTagColor}
          onSetNewTagName={workspace.setNewTagName}
          onSetNoteDraft={workspace.setNoteDraft}
          onSetReadingStatusDraft={workspace.setReadingStatusDraft}
          onToggleRepositoryTag={workspace.handleToggleRepositoryTag}
        />
      }
    />
  );
}
