import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/app-layout';
import { DashboardPage } from '@/pages/dashboard';
import { RepositoriesPage } from '@/pages/repositories';
import { TagNetworkPage } from '@/pages/tag-network';
import { AISearchPage } from '@/pages/ai-search';
import { ProfilePage } from '@/pages/profile';
import { SettingsPage } from '@/pages/settings';
import { WelcomeFlow } from '@/components/welcome-flow';
import { useStarsWorkspace } from '@/hooks/use-stars-workspace';
import { useSettings } from '@/hooks/use-settings';

type Page = 'dashboard' | 'repositories' | 'tag-network' | 'ai-search' | 'profile' | 'settings';

export function App() {
  const workspace = useStarsWorkspace();
  const settingsHook = useSettings();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [showWelcome, setShowWelcome] = useState(false);

  // 检查是否需要显示欢迎流程
  useEffect(() => {
    if (!settingsHook.isLoading && !workspace.authState.hasToken && settingsHook.settings.general.showWelcomeOnStartup) {
      setShowWelcome(true);
    }
  }, [settingsHook.isLoading, workspace.authState.hasToken, settingsHook.settings.general.showWelcomeOnStartup]);

  // 应用品牌色
  useEffect(() => {
    if (settingsHook.settings.theme.brandColor) {
      document.documentElement.style.setProperty('--primary-color', settingsHook.settings.theme.brandColor);
    }
  }, [settingsHook.settings.theme.brandColor]);

  async function handleWelcomeComplete() {
    setShowWelcome(false);
    await settingsHook.updateGeneral({ showWelcomeOnStartup: false });
  }

  async function handleWelcomeConnect(token: string) {
    workspace.setToken(token);
    const event = new Event('submit', { bubbles: true, cancelable: true }) as any;
    event.preventDefault = () => {};
    await workspace.handleSaveToken(event);
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
    >
      {renderPage()}
    </AppLayout>
  );
}
