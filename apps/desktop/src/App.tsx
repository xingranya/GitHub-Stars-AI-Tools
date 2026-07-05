import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/app-layout';
import { DashboardPage } from '@/pages/dashboard';
import { RepositoriesPage } from '@/pages/repositories';
import { TagNetworkPage } from '@/pages/tag-network';
import { AISearchPage } from '@/pages/ai-search';
import { ProfilePage } from '@/pages/profile';
import { SettingsPage } from '@/pages/settings';
import { WelcomeFlow } from '@/components/welcome-flow';
import { WorkspaceProvider, useWorkspace } from '@/providers/workspace-provider';
import { SettingsProvider, useAppSettings } from '@/providers/settings-provider';

type Page = 'dashboard' | 'repositories' | 'tag-network' | 'ai-search' | 'profile' | 'settings';

function AppContent() {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [showWelcome, setShowWelcome] = useState(false);

  // 检查是否需要显示欢迎流程
  useEffect(() => {
    if (!settingsHook.isLoading && !workspace.authState.hasToken && settingsHook.settings.general.showWelcomeOnStartup) {
      setShowWelcome(true);
    }
  }, [settingsHook.isLoading, workspace.authState.hasToken, settingsHook.settings.general.showWelcomeOnStartup]);

  async function handleWelcomeComplete() {
    setShowWelcome(false);
    await settingsHook.updateGeneral({ showWelcomeOnStartup: false });
  }

  async function handleWelcomeConnect(token: string) {
    await workspace.connectWithToken(token);
  }

  if (showWelcome) {
    return (
      <WelcomeFlow
        onComplete={handleWelcomeComplete}
        onConnectGitHub={handleWelcomeConnect}
        onSyncStars={workspace.handleSyncStars}
      />
    );
  }

  // 渲染当前页面
  function renderPage() {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'repositories':
        return <RepositoriesPage />;
      case 'tag-network':
        return <TagNetworkPage />;
      case 'ai-search':
        return <AISearchPage />;
      case 'profile':
        return <ProfilePage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  }

  return (
    <AppLayout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      user={workspace.authState.user}
      onSyncStars={workspace.handleSyncStars}
      isSyncing={workspace.isSyncingStars}
      syncSummary={workspace.syncSummary}
    >
      {renderPage()}
    </AppLayout>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <WorkspaceProvider>
        <AppContent />
      </WorkspaceProvider>
    </SettingsProvider>
  );
}
