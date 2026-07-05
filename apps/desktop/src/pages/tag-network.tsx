import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { getAiConfigMessage } from '@/lib/ai-config';
import type { AiTagNetworkSummary, TagNetworkData } from '@/types';

const TAG_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const EMPTY_TAG_NETWORK_DATA: TagNetworkData = {
  nodes: [],
  edges: [],
  totalRepos: 0,
  totalTags: 0,
  totalLinks: 0,
};

type TagNetworkPageProps = {
  onSelectTag: (tagId: string) => void;
};

export function TagNetworkPage(props: TagNetworkPageProps) {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const [networkData, setNetworkData] = useState<TagNetworkData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isGeneratingTagNetwork, setIsGeneratingTagNetwork] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [cloudSort, setCloudSort] = useState<'hot' | 'name' | 'recent'>('hot');

  useEffect(() => {
    let cancelled = false;
    const accountId = workspace.authState.user ? String(workspace.authState.user.id) : undefined;
    if (!accountId) {
      setNetworkData(EMPTY_TAG_NETWORK_DATA);
      setErrorMessage(null);
      return;
    }
    invoke<TagNetworkData>('get_tag_network_data', { request: { accountId } })
      .then((data) => {
        if (!cancelled) setNetworkData(data);
      })
      .catch((reason) => {
        if (!cancelled) setErrorMessage(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.authState.user?.id, workspace.repositoryPage, workspace.tags, workspace.syncSummary, reloadKey]);

  async function handleGenerateTagNetwork() {
    const accountId = workspace.authState.user ? String(workspace.authState.user.id) : null;
    if (!accountId) {
      setErrorMessage('请先在设置中连接 GitHub 账号。');
      return;
    }

    const aiConfigMessage = getAiConfigMessage(settingsHook.settings.ai);
    if (aiConfigMessage) {
      setErrorMessage(aiConfigMessage);
      return;
    }

    setIsGeneratingTagNetwork(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const summary = await invoke<AiTagNetworkSummary>('generate_ai_tag_network', {
        request: {
          accountId,
          aiConfig: {
            provider: settingsHook.settings.ai.provider,
            baseUrl: settingsHook.settings.ai.baseUrl,
            apiKey: settingsHook.settings.ai.apiKey,
            model: settingsHook.settings.ai.model,
          },
          limit: 1000,
        },
      });
      await workspace.refreshRepositoryWorkspace();
      setReloadKey((current) => current + 1);
      setSuccessMessage(`AI 标签网络已生成：${summary.tagCount} 个标签，${summary.linkedCount} 条仓库关联。`);
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsGeneratingTagNetwork(false);
    }
  }

  const tagStats = networkData?.nodes ?? [];

  // 按热度排序
  const trendingTags = useMemo(() => [...tagStats].sort((a, b) => b.repoCount - a.repoCount).slice(0, 10), [tagStats]);

  // 标签云 (全部标签)
  const cloudTags = useMemo(() => {
    const tags = [...tagStats];
    switch (cloudSort) {
      case 'name':
        return tags.sort((a, b) => a.name.localeCompare(b.name));
      case 'recent':
        return tags.reverse();
      case 'hot':
      default:
        return tags.sort((a, b) => b.repoCount - a.repoCount);
    }
  }, [cloudSort, tagStats]);

  // 标签组按真实标签热度分段展示
  const tagGroups = useMemo(() => {
    const groups = [
      { id: 'high', name: '高频标签', tags: tagStats.filter((tag) => tag.repoCount >= 5) },
      { id: 'mid', name: '常用标签', tags: tagStats.filter((tag) => tag.repoCount >= 2 && tag.repoCount < 5) },
      { id: 'new', name: '轻量标签', tags: tagStats.filter((tag) => tag.repoCount < 2) },
    ];
    return groups
      .filter((group) => group.tags.length > 0)
      .map((group, i) => ({
        id: group.id,
        name: group.name,
        color: TAG_COLORS[i % TAG_COLORS.length],
        tagCount: group.tags.length,
        repoCount: group.tags.reduce((sum, tag) => sum + tag.repoCount, 0),
        tags: group.tags.slice(0, 6).map((tag) => ({ id: tag.id, name: tag.name, count: tag.repoCount })),
      }))
      .slice(0, 4);
  }, [tagStats]);

  // 网络图节点和边 (简化版)
  const networkNodes = useMemo(() => {
    return trendingTags.slice(0, 10).map((tag, i) => ({
      id: tag.id,
      name: tag.name,
      x: 50 + Math.cos((i / Math.max(trendingTags.length, 1)) * Math.PI * 2) * (i === 0 ? 0 : 32),
      y: 50 + Math.sin((i / Math.max(trendingTags.length, 1)) * Math.PI * 2) * (i === 0 ? 0 : 32),
      size: 8 + Math.min(tag.repoCount * 2, 24),
      color: tag.color ?? TAG_COLORS[i % TAG_COLORS.length],
    }));
  }, [trendingTags]);

  const networkEdges = useMemo(() => {
    const indexById = new Map(networkNodes.map((node, index) => [node.id, index]));
    return (networkData?.edges ?? [])
      .map((edge) => ({ source: indexById.get(edge.source), target: indexById.get(edge.target), weight: edge.weight }))
      .filter((edge): edge is { source: number; target: number; weight: number } => edge.source !== undefined && edge.target !== undefined);
  }, [networkData?.edges, networkNodes]);

  const totalRepos = networkData?.totalRepos ?? 0;
  const totalLinks = networkData?.totalLinks ?? 0;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-5 lg:p-6">
      <div className="mx-auto w-full max-w-[min(1400px,100%)] space-y-5">
        {/* Header Actions */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h2 className="font-headline-lg text-on-surface">标签网络</h2>
            <p className="font-body-md text-on-surface-variant mt-1">管理和可视化您的代码库知识图谱</p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateTagNetwork()}
            disabled={isGeneratingTagNetwork || !workspace.authState.user}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition-all hover:brightness-110 disabled:opacity-60 md:w-auto"
            title={workspace.authState.user ? '根据全部 Stars 简略信息自动生成标签网络' : '请先连接 GitHub 账号'}
          >
            <Icon name={isGeneratingTagNetwork ? 'progress_activity' : 'auto_awesome'} size={18} className={isGeneratingTagNetwork ? 'animate-spin' : ''} />
            {isGeneratingTagNetwork ? '生成中...' : 'AI 生成标签网络'}
          </button>
        </div>
        {errorMessage && <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-error">{errorMessage}</div>}
        {successMessage && <div className="rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-success">{successMessage}</div>}

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.9fr)]">
          {/* Left Column (2/3) */}
          <div className="space-y-5">
            {/* Network Visualization Hero Card */}
            <div className="glass-card relative h-[min(46vh,360px)] min-h-[240px] overflow-hidden rounded-xl p-1 group">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-tertiary-container/5" />
              {/* Network Graph SVG */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {/* Edges */}
                {networkEdges.map((edge, i) => {
                  const s = networkNodes[edge.source];
                  const t = networkNodes[edge.target];
                  if (!s || !t) return null;
                  return (
                    <line
                      key={i}
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="var(--color-primary)"
                      opacity="0.18"
                      strokeWidth={Math.min(0.8, 0.2 + edge.weight * 0.1)}
                    />
                  );
                })}
                {/* Nodes */}
                {networkNodes.map((node) => (
                  <g key={node.id} className="cursor-pointer" onClick={() => props.onSelectTag(node.id)}>
                    <circle cx={node.x} cy={node.y} r={node.size / 5} fill={node.color} opacity="0.7" />
                    <text
                      x={node.x}
                      y={node.y + node.size / 5 + 3}
                      textAnchor="middle"
                      fontSize="2.5"
                      fill="var(--color-on-surface)"
                      className="font-label-sm"
                    >
                      {node.name}
                    </text>
                  </g>
                ))}
              </svg>
              {/* Overlay */}
              <div className="absolute top-4 left-5 right-5 flex justify-between items-center z-10">
                <h3 className="font-headline-md text-[16px] text-on-surface font-semibold flex items-center gap-2">
                  <Icon name="hub" size={18} className="text-primary" />
                  知识图谱全貌
                </h3>
              </div>
              <div className="absolute bottom-4 left-5 right-5 z-10 flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-surface-container-lowest/80 border border-outline-variant/20 backdrop-blur-md font-label-sm text-on-surface shadow-sm">
                  节点: {networkData?.totalTags ?? networkNodes.length}
                </span>
                <span className="px-3 py-1 rounded-full bg-surface-container-lowest/80 border border-outline-variant/20 backdrop-blur-md font-label-sm text-on-surface shadow-sm">
                  关联: {totalLinks}
                </span>
                <span className="px-3 py-1 rounded-full bg-surface-container-lowest/80 border border-outline-variant/20 backdrop-blur-md font-label-sm text-on-surface shadow-sm">
                  仓库: {totalRepos}
                </span>
              </div>
            </div>

            {/* Tag Groups */}
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <div className="flex justify-between items-center mb-5">
                <h3 className="font-headline-md text-[16px] text-on-surface font-semibold">标签分组</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {tagGroups.length === 0 ? (
                  <div className="col-span-2 flex flex-col items-center justify-center py-8 text-on-surface-variant gap-2">
                    <Icon name="label_off" size={48} className="opacity-30" />
                    <p className="font-body-md text-sm">创建并绑定标签后即可查看分组</p>
                  </div>
                ) : (
                  tagGroups.map((group) => (
                    <div
                      key={group.id}
                      className="p-4 rounded-lg bg-surface-container-low border border-outline-variant/20 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }} />
                          <h4 className="font-body-md font-medium text-on-surface">{group.name}</h4>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {group.tags.map((tag, i) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => props.onSelectTag(tag.id)}
                            className="tag-pill px-2.5 py-1 rounded-md font-label-sm text-on-surface-variant text-xs hover:text-primary"
                          >
                            {tag.name} ({tag.count > 1000 ? `${(tag.count / 1000).toFixed(0)}k` : tag.count})
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-on-surface-variant font-label-sm">
                        包含 {group.tagCount} 个标签 · {group.repoCount} 个仓库
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right Column (1/3) */}
          <div className="space-y-5">
            {/* Trending Tags */}
            <div className="glass-card rounded-xl p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-headline-md text-[16px] text-on-surface font-semibold flex items-center gap-2">
                  <Icon name="trending_up" size={18} className="text-tertiary-container" />
                  热门标签
                </h3>
              </div>
              <div className="space-y-3">
                {trendingTags.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant gap-2">
                    <Icon name="label_off" size={48} className="opacity-30" />
                    <p className="font-body-md text-sm">暂无标签</p>
                  </div>
                ) : (
                  trendingTags.map((tag, index) => (
                    <button
                      type="button"
                      key={tag.id}
                      onClick={() => props.onSelectTag(tag.id)}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-low transition-colors group cursor-pointer border border-transparent hover:border-outline-variant/20"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 text-center font-label-sm text-on-surface-variant text-xs">{index + 1}</div>
                        <div className="font-body-md font-medium text-on-surface">#{tag.name}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-label-sm text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
                          {tag.repoCount} 库
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tag Cloud */}
        <div className="glass-card rounded-xl p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-headline-md text-[16px] text-on-surface font-semibold">标签云</h3>
            <div className="flex gap-2">
              <select
                value={cloudSort}
                onChange={(event) => setCloudSort(event.target.value as 'hot' | 'name' | 'recent')}
                className="bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-1.5 text-sm font-body-md focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="hot">按热度排序</option>
                <option value="name">按字母排序</option>
                <option value="recent">最近添加</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:gap-3">
            {cloudTags.length === 0 ? (
              <p className="text-on-surface-variant font-body-md">暂无标签，同步仓库后自动生成标签云</p>
            ) : (
              cloudTags.map((tag, index) => {
                // 根据热度变化大小
                const maxCount = cloudTags[0]?.repoCount ?? 1;
                const ratio = maxCount > 0 ? tag.repoCount / maxCount : 0;
                const sizeClass = ratio > 0.7 ? 'px-4 py-2 text-base' : ratio > 0.4 ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';
                const radiusClass = ratio > 0.7 ? 'rounded-xl' : ratio > 0.4 ? 'rounded-lg' : 'rounded-md';
                const isHot = ratio > 0.7;
                return (
                  <button
                    type="button"
                    key={tag.id}
                    onClick={() => props.onSelectTag(tag.id)}
                    className={`tag-pill ${sizeClass} ${radiusClass} font-body-md cursor-pointer flex items-center gap-1 ${
                      isHot ? 'border-primary/30 bg-primary/5' : 'opacity-80'
                    }`}
                  >
                    <span className="text-primary font-bold">#</span> {tag.name}
                    <span className="text-xs text-on-surface-variant ml-1">{tag.repoCount}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
