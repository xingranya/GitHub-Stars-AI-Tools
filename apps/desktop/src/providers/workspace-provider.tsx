/**
 * 工作区上下文 Provider
 * 将 useStarsWorkspace 提升为全局 Context，所有页面共享单一状态实例
 * 解决原来 App / dashboard / repositories 三处各自实例化导致状态不共享、数据重复拉取的问题
 */

import { createContext, useContext, ReactNode } from 'react';
import { useStarsWorkspace } from '@/hooks/use-stars-workspace';

type WorkspaceContextValue = ReturnType<typeof useStarsWorkspace>;

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useStarsWorkspace();
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace 必须在 <WorkspaceProvider> 内部使用');
  }
  return context;
}
