import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { useAppUpdate, type AppUpdateContextValue } from '@/providers/app-update-provider';
import { AppUpdatePanel } from '@/components/app-update-panel';
import { Icon } from '@/components/ui/icon';
import {
  getAiConfigMessage,
  getEmbeddingConfigMessage,
  isSavedAiApiKeyPlaceholder,
  shouldFlushAiApiKey,
  shouldFlushEmbeddingApiKey,
  toBackendAiRequestConfig,
  toBackendEmbeddingRequestConfig,
} from '@/lib/ai-config';
import { compactNumber } from '@/lib/format';
import { COLOR_PRESETS } from '@/types-settings';
import type { AiStreamEvent, DashboardStats, RuntimeReadinessCheckItem, RuntimeReadinessCheckResult } from '@/types';
import type {
  AISettings as AISettingsValue,
  EmbeddingSettings as EmbeddingSettingsValue,
  RuntimeSelfCheckRecord,
  ThemeSettings as ThemeSettingsValue,
} from '@/types-settings';

type SettingsTab = 'github' | 'ai' | 'general' | 'backup' | 'about';
type AIProviderPreset = AISettingsValue['providerPreset'];

type AIProviderPresetOption = {
  id: AIProviderPreset;
  label: string;
  description: string;
  provider: AISettingsValue['provider'];
  baseUrl: string;
  apiKeyLabel: string;
  modelPlaceholder: string;
  modelSuggestions: string[];
};

const AI_PROVIDER_PRESETS: AIProviderPresetOption[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: '官方 Chat Completions 接口',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '填写 OpenAI 模型 ID',
    modelSuggestions: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-nano'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude Messages API',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '填写 Claude 模型 ID',
    modelSuggestions: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '多模型 OpenAI 兼容网关',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '例如 openai/gpt-5.5',
    modelSuggestions: ['openai/gpt-5.5', 'anthropic/claude-sonnet-5', 'deepseek/deepseek-chat'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek OpenAI 兼容接口',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '例如 deepseek-chat',
    modelSuggestions: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    description: 'Moonshot OpenAI 兼容接口',
    provider: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '例如 kimi-k2-0711-preview',
    modelSuggestions: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    id: 'qwen',
    label: '阿里通义 Qwen',
    description: 'DashScope OpenAI 兼容接口',
    provider: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '例如 qwen-plus',
    modelSuggestions: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    description: '智谱 OpenAI 兼容接口',
    provider: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '例如 glm-4.5',
    modelSuggestions: ['glm-4.5', 'glm-4.5-air', 'glm-4-flash'],
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    description: 'SiliconFlow OpenAI 兼容接口',
    provider: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '填写 SiliconFlow 模型 ID',
    modelSuggestions: ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/GLM-4.1V-9B-Thinking'],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: '本机 OpenAI 兼容服务，可不填 Key',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyLabel: 'API Key（可留空）',
    modelPlaceholder: '例如 llama3.1',
    modelSuggestions: ['llama3.1', 'qwen2.5-coder', 'deepseek-r1'],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    description: '本机 OpenAI 兼容服务，可不填 Key',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKeyLabel: 'API Key（可留空）',
    modelPlaceholder: '填写本机加载的模型 ID',
    modelSuggestions: ['local-model'],
  },
  {
    id: 'custom-openai-compatible',
    label: '自定义兼容接口',
    description: '手动填写 OpenAI 兼容地址',
    provider: 'openai-compatible',
    baseUrl: '',
    apiKeyLabel: 'API Key（本机服务可留空）',
    modelPlaceholder: '填写服务商模型 ID',
    modelSuggestions: [],
  },
  {
    id: 'none',
    label: '关闭 AI',
    description: '只使用本地知识搜索和手动整理',
    provider: 'none',
    baseUrl: '',
    apiKeyLabel: 'API Key',
    modelPlaceholder: '选择服务后填写模型 ID',
    modelSuggestions: [],
  },
];
const PROJECT_REPOSITORY_URL = 'https://github.com/xingranya/GitHub-Stars-AI-Tools';
const PROJECT_ISSUES_URL = 'https://github.com/xingranya/GitHub-Stars-AI-Tools/issues';
const PROJECT_LICENSE_URL = 'https://github.com/xingranya/GitHub-Stars-AI-Tools/blob/main/LICENSE';
const PROJECT_ACKNOWLEDGEMENTS_URL = 'https://github.com/xingranya/GitHub-Stars-AI-Tools#%E8%87%B4%E8%B0%A2';
const WEILOO_GPT_URL = 'https://ai.weiloo.com';

type AiConnectionTestResult = {
  summaryZh: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
};

type AiModelOption = {
  id: string;
  displayName?: string | null;
  ownedBy?: string | null;
};

type AiTestDialogState = {
  isOpen: boolean;
  status: 'preparing' | 'running' | 'success' | 'error';
  stage: string;
  providerLabel: string;
  endpoint: string;
  model: string;
  startedAt: number;
  firstTokenLatencyMs: number | null;
  totalLatencyMs: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  summary: string | null;
  error: string | null;
};

type EmbeddingConnectionTestResult = {
  model: string;
  dimensions: number;
};

type VectorIndexStatus = {
  enabled: boolean;
  model: string | null;
  dimensions: number | null;
  sqliteCount: number;
  zvecCount: number;
  ready: boolean;
  message: string;
};

type VectorIndexBuildSummary = {
  totalCount: number;
  indexedCount: number;
  restoredCount: number;
  skippedCount: number;
  failedCount: number;
  failures: string[];
};

export function SettingsPage() {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const appUpdate = useAppUpdate();
  const [activeTab, setActiveTab] = useState<SettingsTab>('github');

  const tabs: { key: SettingsTab; icon: string; label: string; shortLabel: string }[] = [
    { key: 'github', icon: 'code', label: 'GitHub 账号', shortLabel: '账号' },
    { key: 'ai', icon: 'smart_toy', label: 'AI 引擎配置', shortLabel: '引擎' },
    { key: 'general', icon: 'tune', label: '通用设置', shortLabel: '通用' },
    { key: 'backup', icon: 'backup', label: '数据备份', shortLabel: '备份' },
    { key: 'about', icon: 'info', label: '关于项目', shortLabel: '关于' },
  ];
  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? '设置';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4 sm:p-5 lg:p-margin-page">
      <header className="mx-auto mb-6 flex w-full max-w-5xl flex-col items-center gap-4 text-center">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">设置</h2>
          <p className="mt-1 font-body-md text-sm text-on-surface-variant">{activeTabLabel}</p>
        </div>
        <nav className="grid w-full max-w-[620px] grid-cols-5 gap-2 rounded-xl border border-card-border bg-surface/55 p-2 shadow-sm backdrop-blur-md">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={activeTab === tab.key ? 'page' : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-center transition-all ${
                activeTab === tab.key
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
              }`}
            >
              <Icon name={tab.icon} size={19} />
              <span className="truncate font-label-sm text-[11px]">{tab.shortLabel}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* 设置内容 */}
      <div className="mx-auto w-full max-w-5xl min-w-0 flex-1 space-y-6">
        {settingsHook.settingsError && (
          <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 font-body-md text-sm text-error">
            {settingsHook.settingsError}
          </div>
        )}
        {activeTab === 'github' && (
          <GitHubSettings
            workspace={workspace}
            settingsHook={settingsHook}
            onOpenAiSettings={() => setActiveTab('ai')}
          />
        )}
        {activeTab === 'ai' && <AISettings settingsHook={settingsHook} />}
        {activeTab === 'general' && <GeneralSettings settingsHook={settingsHook} workspace={workspace} />}
        {activeTab === 'backup' && <BackupSettings workspace={workspace} />}
        {activeTab === 'about' && <AboutSettings appUpdate={appUpdate} />}
      </div>
    </div>
  );
}

/* === GitHub 设置 === */
function GitHubSettings({
  workspace,
  settingsHook,
  onOpenAiSettings,
}: {
  workspace: ReturnType<typeof useWorkspace>;
  settingsHook: ReturnType<typeof useAppSettings>;
  onOpenAiSettings: () => void;
}) {
  const isConnected = workspace.authState.hasToken && Boolean(workspace.authState.user);
  const user = workspace.authState.user;
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [readinessStats, setReadinessStats] = useState<DashboardStats | null>(null);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [readinessWarning, setReadinessWarning] = useState<string | null>(null);
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeReadinessCheckResult | null>(null);
  const [runtimeCheckCompletedAt, setRuntimeCheckCompletedAt] = useState<string | null>(null);
  const [isCheckingRuntime, setIsCheckingRuntime] = useState(false);
  const autoSummaryConfigMessage = settingsHook.settings.ai.enableAutoSummary
    ? getAiConfigMessage(settingsHook.settings.ai)
    : null;

  useEffect(() => {
    let cancelled = false;
    const accountId = user ? String(user.id) : null;
    if (!accountId) {
      setReadinessStats(null);
      setIsLoadingReadiness(false);
      setReadinessError(null);
      setReadinessWarning(null);
      return;
    }

    setIsLoadingReadiness(true);
    setReadinessError(null);
    invoke<DashboardStats>('get_dashboard_stats', { request: { accountId } })
      .then((stats) => {
        if (!cancelled) {
          setReadinessStats(stats);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReadinessStats(null);
          setReadinessError(toErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingReadiness(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    workspace.repositoryPage?.totalCount,
    workspace.syncSummary,
    workspace.readmeSummary,
    workspace.batchAiSummary,
  ]);

  useEffect(() => {
    setRuntimeCheck(null);
    setRuntimeCheckCompletedAt(null);
  }, [
    user?.id,
    settingsHook.settings.ai.provider,
    settingsHook.settings.ai.baseUrl,
    settingsHook.settings.ai.model,
    settingsHook.settings.ai.apiKey,
    workspace.repositoryPage?.totalCount,
  ]);

  async function handleGitHubConnectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workspace.isSavingToken || !workspace.token.trim()) {
      return;
    }

    const statusTimers: number[] = [];
    setConnectStatus('正在验证 GitHub Token...');
    try {
      statusTimers.push(window.setTimeout(() => {
        setConnectStatus('正在保存本地凭据，如果系统弹出凭据管理授权，请选择允许。');
      }, 1200));
      statusTimers.push(window.setTimeout(() => {
        setConnectStatus('连接仍在进行中，可能是 GitHub 网络较慢，请稍候。');
      }, 8000));
      await workspace.connectWithToken(workspace.token);
      setConnectStatus(null);
    } catch {
      setConnectStatus(null);
    } finally {
      statusTimers.forEach(window.clearTimeout);
    }
  }

  async function handleRuntimeReadinessCheck() {
    setIsCheckingRuntime(true);
    setReadinessError(null);
    setReadinessWarning(null);
    try {
      if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
        await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
      }
      const result = await invoke<RuntimeReadinessCheckResult>('check_runtime_readiness', {
        request: {
          aiConfig: toBackendAiRequestConfig(settingsHook.settings.ai),
        },
      });
      setRuntimeCheck(result);
      const record = buildRuntimeSelfCheckRecord(result);
      setRuntimeCheckCompletedAt(record.completedAt);
      try {
        await settingsHook.updateRuntime({ lastSelfCheckRecord: record });
      } catch (error) {
        setReadinessWarning(`真实链路自检已完成，但自检记录未保存：${toErrorMessage(error)}`);
      }
    } catch (error) {
      setReadinessError(toErrorMessage(error));
    } finally {
      setIsCheckingRuntime(false);
    }
  }

  return (
    <>
      {/* 连接状态卡片 */}
      <section className="glass-panel rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 pointer-events-none opacity-10">
          <Icon name="cloud_sync" size={96} />
        </div>
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-1">GitHub 连接状态</h3>
            <p className="font-body-md text-on-surface-variant mb-6">
              管理 GitHub Personal Access Token。公开 Stars 可使用只读 Token，私有仓库 Stars 需要仓库读取权限，Gist 备份需要 gist 权限。
            </p>
            <div
              className={`flex w-fit max-w-full flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 ${
                isConnected ? 'bg-success/10 border-success/20' : 'bg-error/10 border-error/20'
              }`}
            >
              <Icon
                name={isConnected ? 'check_circle' : 'error'}
                size={20}
                className={`shrink-0 ${isConnected ? 'text-success' : 'text-error'}`}
              />
              <span className={`font-body-md font-medium ${isConnected ? 'text-success' : 'text-error'}`}>
                {isConnected ? '已连接 (Token 有效)' : '未连接'}
              </span>
            </div>
          </div>
          {isConnected && user && (
            <div className="flex max-w-full shrink-0 items-center gap-3 rounded-lg border border-card-border bg-surface-container-low px-4 py-2">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.login} className="h-6 w-6 shrink-0 rounded-full" />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-container/20">
                  <Icon name="person" size={16} className="text-primary" />
                </div>
              )}
              <span className="min-w-0 truncate font-label-sm text-label-sm text-on-surface" title={`@${user.login}`}>
                @{user.login}
              </span>
            </div>
          )}
        </div>
      </section>

      <RuntimeReadinessPanel
        isConnected={isConnected}
        userLogin={user?.login ?? null}
        stats={readinessStats}
        isLoading={isLoadingReadiness}
        errorMessage={readinessError}
        warningMessage={readinessWarning}
        aiConfigMessage={getAiConfigMessage(settingsHook.settings.ai)}
        isSyncingStars={workspace.isSyncingStars}
        isFetchingReadmes={workspace.isFetchingReadmes}
        isBatchGeneratingAiDocuments={workspace.isBatchGeneratingAiDocuments}
        isGeneratingTagNetwork={workspace.isGeneratingTagNetwork}
        runtimeCheck={runtimeCheck}
        runtimeCheckCompletedAt={runtimeCheckCompletedAt}
        lastSelfCheckRecord={settingsHook.settings.runtime.lastSelfCheckRecord}
        isCheckingRuntime={isCheckingRuntime}
        onSyncStars={() => void workspace.handleSyncStars()}
        onFetchReadmes={() => {
          void workspace.handleFetchReadmes({
            aiConfig: settingsHook.settings.ai,
            autoGenerateAi: false,
            onlyMissing: true,
          });
        }}
        onGenerateAi={() => {
          void (async () => {
            if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
              await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
            }
            await workspace.handleFetchReadmes({
              aiConfig: settingsHook.settings.ai,
              autoGenerateAi: true,
              onlyMissing: true,
            });
          })().catch(() => undefined);
        }}
        onGenerateTagNetwork={() => {
          void (async () => {
            if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
              await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
            }
            await workspace.handleGenerateAiTagNetwork(settingsHook.settings.ai);
          })().catch(() => undefined);
        }}
        onOpenAiSettings={onOpenAiSettings}
        onCheckRuntime={() => void handleRuntimeReadinessCheck()}
      />

      {/* 配置表单 */}
      <section className="glass-panel rounded-xl p-0 overflow-hidden">
        <div className="p-6 border-b border-card-border bg-surface/50">
          <h3 className="font-headline-md text-[20px] font-semibold text-on-surface">访问配置</h3>
        </div>
        <div className="p-6 space-y-6">
          {/* Token 输入 */}
          {isConnected ? (
            <div className="space-y-2">
              <label className="font-body-md text-on-surface font-medium flex items-center gap-2">
                Personal Access Token
                <Icon name="info" size={16} className="text-on-surface-variant cursor-help" />
              </label>
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2">
                  <p className="font-label-sm text-on-surface">Token 已保存到系统凭据管理器</p>
                  <p className="mt-1 text-xs text-on-surface-variant">为保护凭据安全，应用不会在界面中显示明文 Token。</p>
                </div>
                <button
                  onClick={() => void workspace.handleClearToken()}
                  disabled={workspace.isClearingToken}
                  className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md transition-all"
                >
                  断开连接
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(event) => void handleGitHubConnectSubmit(event)}
              className="space-y-2"
            >
              <label className="font-body-md text-on-surface font-medium flex items-center gap-2">
                Personal Access Token
                <Icon name="info" size={16} className="text-on-surface-variant cursor-help" />
              </label>
              <div className="flex gap-3">
                <input
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  value={workspace.token}
                  onChange={(e) => workspace.setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-label-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <button
                  type="submit"
                  disabled={workspace.isSavingToken || !workspace.token.trim()}
                  className="px-4 py-2 bg-primary text-white rounded-lg font-body-md hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
                >
                  {workspace.isSavingToken ? '连接中...' : '连接 GitHub'}
                </button>
              </div>
            </form>
          )}

          {workspace.authMessage && (
            <p className="font-body-md text-[13px] text-success flex items-center gap-1">
              <Icon name="check_circle" size={16} /> {workspace.authMessage}
            </p>
          )}
          {connectStatus && (
            <p className="font-body-md text-[13px] text-primary flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
              <Icon name="progress_activity" size={16} className="animate-spin" /> {connectStatus}
            </p>
          )}
          {workspace.error && (
            <p className="font-body-md text-[13px] text-error flex items-center gap-1 rounded-lg border border-error/20 bg-error/10 px-3 py-2">
              <Icon name="error" size={16} /> {workspace.error}
            </p>
          )}

          <hr className="border-card-border" />

          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-6">
              <h4 className="font-body-lg font-medium text-on-surface flex items-center gap-2">
                README 缓存
                <span className="bg-primary-fixed text-on-primary-fixed text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  AI 上下文
                </span>
              </h4>
              <p className="font-body-md text-on-surface-variant mt-1">
                README 是中文定位、AI 摘要和标签网络的上下文；只抓取 README 不会直接生成中文用途说明。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 同步操作 */}
      <section className="glass-panel rounded-xl p-6">
        <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-4">数据同步操作</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void workspace.handleSyncStars()}
            disabled={workspace.isSyncingStars || !isConnected}
            className="px-4 py-2 bg-primary text-white rounded-lg font-body-md flex items-center gap-2 hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
          >
            <Icon name="sync" size={18} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
            {workspace.isSyncingStars ? '同步中...' : '同步 Stars'}
          </button>
          <button
            onClick={() => {
              void (async () => {
                if (settingsHook.settings.ai.enableAutoSummary && shouldFlushAiApiKey(settingsHook.settings.ai)) {
                  await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
                }
                const readmeSummary = await workspace.handleFetchReadmes({
                  aiConfig: settingsHook.settings.ai,
                  autoGenerateAi: settingsHook.settings.ai.enableAutoSummary,
                  onlyMissing: true,
                });
                if (!readmeSummary) {
                  return;
                }
              })().catch(() => undefined);
            }}
            disabled={
              workspace.isFetchingReadmes ||
              workspace.isBatchGeneratingAiDocuments ||
              !isConnected ||
              Boolean(autoSummaryConfigMessage)
            }
            title={autoSummaryConfigMessage ?? undefined}
            className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md flex items-center gap-2 transition-all disabled:opacity-60"
          >
            <Icon name="description" size={18} className={workspace.isFetchingReadmes || workspace.isBatchGeneratingAiDocuments ? 'animate-spin' : ''} />
            {workspace.isFetchingReadmes
              ? '抓取中...'
              : workspace.isBatchGeneratingAiDocuments
                ? 'AI 分析中...'
                : settingsHook.settings.ai.enableAutoSummary
                  ? '抓取 README 并分析'
	                  : '抓取 README'}
	          </button>
          <button
            onClick={() => {
              void (async () => {
                if (shouldFlushAiApiKey(settingsHook.settings.ai)) {
                  await settingsHook.flushAIKey(settingsHook.settings.ai.apiKey);
                }
                await workspace.handleGenerateAiTagNetwork(settingsHook.settings.ai);
              })().catch(() => undefined);
            }}
            disabled={
              workspace.isGeneratingTagNetwork ||
              workspace.isBatchGeneratingAiDocuments ||
              !isConnected ||
              Boolean(getAiConfigMessage(settingsHook.settings.ai))
            }
            title={getAiConfigMessage(settingsHook.settings.ai) ?? '根据已同步仓库、README 摘要和 Topics 生成标签网络'}
            className="px-4 py-2 bg-primary/10 hover:bg-primary/15 text-primary rounded-lg border border-primary/20 font-body-md flex items-center gap-2 transition-all disabled:opacity-60"
          >
            <Icon name="hub" size={18} className={workspace.isGeneratingTagNetwork ? 'animate-spin' : ''} />
            {workspace.isGeneratingTagNetwork ? '生成中...' : '生成标签网络'}
          </button>
        </div>
        {autoSummaryConfigMessage && (
          <div className="mt-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body-md text-sm text-error">
            {autoSummaryConfigMessage}
          </div>
        )}
        {workspace.syncSummary && (
          <div className="mt-4 p-3 rounded-lg bg-success/10 border border-success/20">
            <p className="font-body-md text-sm text-success">
              同步完成：活跃 {workspace.syncSummary.activeCount} 个，新增{' '}
              {workspace.syncSummary.createdCount} 个，更新 {workspace.syncSummary.updatedCount} 个，移除{' '}
              {workspace.syncSummary.removedCount} 个，扫描 {workspace.syncSummary.scannedCount} 个。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function RuntimeReadinessPanel(props: {
  isConnected: boolean;
  userLogin: string | null;
  stats: DashboardStats | null;
  isLoading: boolean;
  errorMessage: string | null;
  warningMessage: string | null;
  aiConfigMessage: string | null;
  isSyncingStars: boolean;
  isFetchingReadmes: boolean;
  isBatchGeneratingAiDocuments: boolean;
  isGeneratingTagNetwork: boolean;
  runtimeCheck: RuntimeReadinessCheckResult | null;
  runtimeCheckCompletedAt: string | null;
  lastSelfCheckRecord: RuntimeSelfCheckRecord | null;
  isCheckingRuntime: boolean;
  onSyncStars: () => void;
  onFetchReadmes: () => void;
  onGenerateAi: () => void;
  onGenerateTagNetwork: () => void;
  onOpenAiSettings: () => void;
  onCheckRuntime: () => void;
}) {
  const totalRepos = props.stats?.totalRepos ?? 0;
  const totalReadmes = props.stats?.totalReadmes ?? 0;
  const totalAiSummaries = props.stats?.totalAiSummaries ?? 0;
  const totalTags = props.stats?.totalTags ?? 0;
  const totalAiInputTokens = props.stats?.totalAiInputTokens ?? 0;
  const totalAiOutputTokens = props.stats?.totalAiOutputTokens ?? 0;
  const hasRepos = totalRepos > 0;
  const readmeNeedsTopUp = props.isConnected && hasRepos && totalReadmes < totalRepos;
  const aiNeedsTopUp = props.isConnected && hasRepos && (
    totalAiSummaries === 0 || (totalReadmes > 0 && totalAiSummaries < totalReadmes)
  );
  const aiReady = !props.aiConfigMessage;
  const isReadmeBusy = props.isFetchingReadmes || props.isBatchGeneratingAiDocuments;
  const isAiWorkflowBusy = isReadmeBusy || props.isGeneratingTagNetwork;
  const runtimeCheckSummary = props.runtimeCheck ? summarizeRuntimeCheck(props.runtimeCheck) : null;
  const selfCheckRecord = runtimeCheckSummary
    ? {
        completedAt: props.runtimeCheckCompletedAt ?? '刚刚完成',
        ...runtimeCheckSummary,
      }
    : props.lastSelfCheckRecord;
  const readinessItems = [
    {
      title: 'GitHub 账号',
      done: props.isConnected,
      detail: props.isConnected && props.userLogin ? `已连接 @${props.userLogin}` : '请先输入 GitHub Token 并连接账号',
      actionLabel: null,
      onAction: null,
      actionDisabled: false,
    },
    {
      title: 'Stars 同步',
      done: totalRepos > 0,
      detail: totalRepos > 0 ? `本地已有 ${totalRepos} 个仓库` : '连接后执行同步 Stars',
      actionLabel: props.isSyncingStars ? '同步中...' : '同步 Stars',
      onAction: props.isConnected ? props.onSyncStars : null,
      actionDisabled: props.isSyncingStars,
    },
    {
      title: 'README 缓存',
      done: totalReadmes > 0,
      detail: totalReadmes > 0
        ? `已缓存 ${totalReadmes} / ${Math.max(totalRepos, totalReadmes)} 个 README${readmeNeedsTopUp ? '，可继续补抓缺失项' : ''}`
        : '同步后先抓取 README，作为中文定位和标签网络的上下文',
      actionLabel: props.isFetchingReadmes ? '抓取中...' : totalReadmes > 0 ? '补抓缺失 README' : '抓取 README',
      onAction: readmeNeedsTopUp ? props.onFetchReadmes : null,
      actionDisabled: isAiWorkflowBusy,
    },
    {
      title: 'AI 引擎',
      done: aiReady && totalAiSummaries > 0,
      detail: totalAiSummaries > 0
        ? `已生成 ${totalAiSummaries} 个 AI 摘要，累计输入 ${compactNumber(totalAiInputTokens)} tokens，输出 ${compactNumber(totalAiOutputTokens)} tokens`
        : aiReady
          ? '配置已完整，可在 AI 引擎配置中测试连接并生成摘要'
          : props.aiConfigMessage ?? '请配置 AI 服务',
      actionLabel: aiReady
        ? props.isBatchGeneratingAiDocuments ? '分析中...' : totalAiSummaries > 0 ? '继续分析缺失摘要' : '抓取 README 并分析'
        : '打开 AI 设置',
      onAction: aiReady
        ? aiNeedsTopUp ? props.onGenerateAi : null
        : props.onOpenAiSettings,
      actionDisabled: isAiWorkflowBusy,
    },
    {
      title: '标签网络',
      done: totalTags > 0,
      detail: totalTags > 0
        ? `已生成 ${totalTags} 个标签，可在标签网络页查看关联`
        : totalAiSummaries > 0
          ? '已有中文摘要后，可生成标签网络并联动中文定位'
          : '先生成 AI 摘要，再用标签网络聚类项目用途',
      actionLabel: props.isGeneratingTagNetwork ? '生成中...' : totalTags > 0 ? '重新生成标签网络' : '生成标签网络',
      onAction: aiReady && totalAiSummaries > 0 ? props.onGenerateTagNetwork : aiReady ? null : props.onOpenAiSettings,
      actionDisabled: isAiWorkflowBusy,
    },
  ];

  return (
    <section className="glass-panel rounded-xl p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-headline-md text-[20px] font-semibold text-on-surface">客户端就绪状态</h3>
          <p className="mt-1 font-body-md text-sm text-on-surface-variant">
            基于当前本地数据库和应用内设置检查真实可用链路。
          </p>
        </div>
        {props.isLoading && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-primary">
            <Icon name="progress_activity" size={14} className="animate-spin" />
            正在检查
          </span>
        )}
        <button
          type="button"
          onClick={props.onCheckRuntime}
          disabled={props.isCheckingRuntime}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5 font-body-md text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
        >
          <Icon name="verified" size={14} className={props.isCheckingRuntime ? 'animate-spin' : ''} />
          {props.isCheckingRuntime ? '正在运行真实链路自检' : '运行真实链路自检'}
        </button>
      </div>
      {props.errorMessage && (
        <p className="mt-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body-md text-sm text-error">
          就绪状态读取失败：{props.errorMessage}
        </p>
      )}
      {props.warningMessage && (
        <p className="mt-4 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 font-body-md text-sm text-warning">
          {props.warningMessage}
        </p>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {readinessItems.map((item) => (
          <div
            key={item.title}
            className={`rounded-lg border px-4 py-3 ${
              item.done
                ? 'border-success/20 bg-success/10'
                : 'border-card-border bg-surface-container-low'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon
                name={item.done ? 'check_circle' : 'radio_button_unchecked'}
                size={18}
                className={item.done ? 'text-success' : 'text-on-surface-variant'}
              />
              <h4 className="font-body-md font-medium text-on-surface">{item.title}</h4>
            </div>
            <p className="mt-1 pl-6 font-body-md text-xs leading-relaxed text-on-surface-variant">
              {item.detail}
            </p>
            {item.onAction && (
              <button
                type="button"
                onClick={item.onAction}
                disabled={item.actionDisabled}
                className="mt-3 ml-6 inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-surface px-3 py-1.5 font-body-md text-xs text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-60"
              >
                {item.actionLabel?.includes('中...') && (
                  <Icon name="progress_activity" size={14} className="animate-spin" />
                )}
                {item.actionLabel ?? '继续'}
              </button>
            )}
          </div>
        ))}
      </div>
      {!props.runtimeCheck && selfCheckRecord && (
        <div className="mt-5 rounded-lg border border-card-border bg-surface-container-low p-4">
          <div className="flex min-w-0 items-start gap-2">
            <Icon name="fact_check" size={18} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h4 className="font-body-md font-medium text-on-surface">发布包自检记录</h4>
              <p className="mt-1 font-body-md text-xs leading-relaxed text-on-surface-variant">
                上一次真实链路自检摘要已保存，重新运行自检可刷新当前结果。
              </p>
              <SelfCheckRecordCard record={selfCheckRecord} className="mt-3" />
            </div>
          </div>
        </div>
      )}
      {props.runtimeCheck && (
        <div className="mt-5 rounded-lg border border-card-border bg-surface-container-low p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="fact_check" size={18} className="shrink-0 text-primary" />
              <h4 className="font-body-md font-medium text-on-surface">真实链路自检结果</h4>
            </div>
            {selfCheckRecord && (
              <SelfCheckRecordCard record={selfCheckRecord} />
            )}
          </div>
          <div className="mt-3 grid gap-2">
            <RuntimeCheckRow title="本地数据库" item={props.runtimeCheck.storage} />
            <RuntimeCheckRow title="应用设置存储" item={props.runtimeCheck.settings} />
            <RuntimeCheckRow title="GitHub Token" item={props.runtimeCheck.github} />
            <RuntimeCheckRow title="Stars API" item={props.runtimeCheck.stars} />
            <RuntimeCheckRow title="README 抓取" item={props.runtimeCheck.readme} />
            <RuntimeCheckRow title="AI 服务" item={props.runtimeCheck.ai} />
            <RuntimeCheckRow title="AI 标签网络" item={props.runtimeCheck.tagNetwork} />
            <RuntimeCheckRow title="相似推荐" item={props.runtimeCheck.recommendation} />
          </div>
        </div>
      )}
    </section>
  );
}

function SelfCheckRecordCard(props: { record: RuntimeSelfCheckRecord; className?: string }) {
  return (
    <div className={`rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-xs text-on-surface-variant ${props.className ?? ''}`}>
      <p className="font-body-md font-medium text-on-surface">发布包自检记录</p>
      <p className="mt-1 font-body-md">
        检查时间：{props.record.completedAt}
      </p>
      <p className="mt-1 font-body-md">
        通过 {props.record.passed} 项，失败 {props.record.failed} 项，跳过 {props.record.skipped} 项
      </p>
    </div>
  );
}

function buildRuntimeSelfCheckRecord(result: RuntimeReadinessCheckResult): RuntimeSelfCheckRecord {
  return {
    completedAt: new Date().toLocaleString(),
    ...summarizeRuntimeCheck(result),
  };
}

function summarizeRuntimeCheck(result: RuntimeReadinessCheckResult) {
  const items = [
    result.storage,
    result.settings,
    result.github,
    result.stars,
    result.readme,
    result.ai,
    result.tagNetwork,
    result.recommendation,
  ];
  return items.reduce(
    (summary, item) => {
      if (item.status === 'passed') {
        summary.passed += 1;
      } else if (item.status === 'failed') {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
      return summary;
    },
    { passed: 0, failed: 0, skipped: 0 },
  );
}

function RuntimeCheckRow({ title, item }: { title: string; item: RuntimeReadinessCheckItem }) {
  const tone = item.status === 'passed'
    ? 'text-success'
    : item.status === 'failed'
      ? 'text-error'
      : 'text-on-surface-variant';
  const icon = item.status === 'passed'
    ? 'check_circle'
    : item.status === 'failed'
      ? 'error'
      : 'radio_button_unchecked';
  const label = item.status === 'passed' ? '通过' : item.status === 'failed' ? '失败' : '跳过';

  return (
    <div className="rounded-md border border-outline-variant/30 bg-surface px-3 py-2">
      <div className="flex items-start gap-2">
        <Icon name={icon} size={16} className={`mt-0.5 ${tone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-body-md text-xs font-medium text-on-surface">{title}</p>
            <span className={`text-[11px] font-medium ${tone}`}>{label}</span>
          </div>
          <p className="mt-0.5 font-body-md text-xs leading-relaxed text-on-surface-variant">
            {item.message}
          </p>
          {item.detail && (
            <p className="mt-1 break-words font-body-md text-[11px] leading-relaxed text-on-surface-variant/80">
              {item.detail}
            </p>
          )}
          {item.action && (
            <p className="mt-2 rounded-md border border-outline-variant/25 bg-surface-container-low px-2 py-1.5 font-body-md text-[11px] leading-relaxed text-on-surface">
              <span className="font-medium text-on-surface">建议处理：</span>
              {item.action}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* === AI 引擎设置 === */
function AISettings({ settingsHook }: { settingsHook: ReturnType<typeof useAppSettings> }) {
  const workspace = useWorkspace();
  const ai = settingsHook.settings.ai;
  const needsRemoteConfig = ai.provider !== 'none';
  const hasSavedApiKey = isSavedAiApiKeyPlaceholder(ai.apiKey);
  const [apiKeyDraft, setApiKeyDraft] = useState(hasSavedApiKey ? '' : ai.apiKey);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>([]);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modelListMessage, setModelListMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testDialog, setTestDialog] = useState<AiTestDialogState | null>(null);
  const activeTestRequestRef = useRef<{ requestId: string; startedAt: number; firstTokenSeen: boolean } | null>(null);
  const currentPreset = getAiProviderPreset(ai.providerPreset);
  const endpointPlaceholder = currentPreset.baseUrl || getAiEndpointPlaceholder(ai.provider);
  const apiKeyPlaceholder = currentPreset.apiKeyLabel;
  const modelPlaceholder = currentPreset.modelPlaceholder;
  const effectiveApiKey = apiKeyDraft.trim() ? apiKeyDraft : ai.apiKey;
  const currentConfigMessage = getAiConfigMessage({ ...ai, apiKey: effectiveApiKey });
  const canTestAi = needsRemoteConfig && !currentConfigMessage;
  const aiKeySaveMessage = getAiKeySaveMessage(settingsHook.aiKeySaveStatus);
  const modelOptions = mergeAiModelOptions(currentPreset, availableModels, ai.model);

  useEffect(() => {
    setApiKeyDraft(isSavedAiApiKeyPlaceholder(ai.apiKey) ? '' : ai.apiKey);
  }, [ai.apiKey]);

  useEffect(() => {
    setAvailableModels([]);
    setModelListMessage(null);
  }, [ai.providerPreset, ai.provider, ai.baseUrl]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<AiStreamEvent>('ai-stream', (event) => {
      const payload = event.payload;
      const active = activeTestRequestRef.current;
      if (!active || payload.taskType !== 'ai-config-test' || payload.requestId !== active.requestId) {
        return;
      }

      const now = performance.now();
      if (payload.status === 'delta') {
        const firstTokenLatencyMs = active.firstTokenSeen ? null : now - active.startedAt;
        if (!active.firstTokenSeen) {
          activeTestRequestRef.current = { ...active, firstTokenSeen: true };
        }
        setTestDialog((current) => current
          ? {
              ...current,
              status: 'running',
              stage: '正在接收模型输出',
              firstTokenLatencyMs: current.firstTokenLatencyMs ?? firstTokenLatencyMs,
              summary: payload.text ? payload.text.slice(0, 120) : current.summary,
            }
          : current);
        return;
      }

      if (payload.status === 'started' || payload.status === 'fallback') {
        setTestDialog((current) => current
          ? {
              ...current,
              status: 'running',
              stage: payload.message ?? current.stage,
            }
          : current);
      }
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  async function handleProviderPresetChange(providerPreset: AIProviderPreset) {
    const preset = getAiProviderPreset(providerPreset);
    setApiKeyDraft('');
    setTestMessage({
      type: 'success',
      text: preset.provider === 'none'
        ? 'AI 功能已关闭，已保存的服务 Key 会保留在系统凭据管理器中。'
        : `已切换到 ${preset.label}，请填写 API Key 和模型 ID。`,
    });
    await settingsHook.updateAI({
      provider: preset.provider,
      providerPreset: preset.id,
      baseUrl: preset.baseUrl,
      model: '',
      enableAutoSummary: preset.provider === 'none' ? false : ai.enableAutoSummary,
    });
  }

  async function handleTestAiConnection() {
    const nextAi = { ...ai, apiKey: effectiveApiKey };
    const configMessage = getAiConfigMessage(nextAi);
    const startedAt = performance.now();
    const requestId = `ai-config-test-${Date.now()}`;
    const providerLabel = currentPreset.label;
    const endpoint = nextAi.baseUrl.trim() || currentPreset.baseUrl || '默认服务地址';
    const model = nextAi.model.trim() || '未填写模型';

    setTestDialog({
      isOpen: true,
      status: configMessage ? 'error' : 'preparing',
      stage: configMessage ? '配置未完成' : '正在准备配置',
      providerLabel,
      endpoint,
      model,
      startedAt,
      firstTokenLatencyMs: null,
      totalLatencyMs: null,
      outputTokens: null,
      tokensPerSecond: null,
      summary: null,
      error: configMessage,
    });
    activeTestRequestRef.current = configMessage ? null : { requestId, startedAt, firstTokenSeen: false };

    if (configMessage) {
      setTestMessage({ type: 'error', text: configMessage });
      return;
    }

    setIsTestingAi(true);
    setTestMessage(null);
    try {
      if (shouldFlushAiApiKey(nextAi)) {
        await settingsHook.flushAIKey(nextAi.apiKey);
      }
      setTestDialog((current) => current
        ? { ...current, status: 'running', stage: '正在请求 AI 服务' }
        : current);
      const result = await invoke<AiConnectionTestResult>('test_ai_connection', {
        request: {
          aiConfig: toBackendAiRequestConfig(nextAi),
          requestId,
        },
      });
      const completedAt = performance.now();
      const totalLatencyMs = completedAt - startedAt;
      const outputTokens = Math.max(0, result.outputTokens || estimateTextTokens(result.summaryZh));
      const tokensPerSecond = totalLatencyMs > 0 ? outputTokens / (totalLatencyMs / 1000) : null;
      const summary = result.summaryZh.slice(0, 120);
      setTestMessage({
        type: 'success',
        text: `AI 配置可用，${result.model} 已返回摘要：${summary}`,
      });
      setTestDialog((current) => current
        ? {
            ...current,
            status: 'success',
            stage: '测试完成',
            firstTokenLatencyMs: current.firstTokenLatencyMs ?? totalLatencyMs,
            totalLatencyMs,
            outputTokens,
            tokensPerSecond,
            summary,
            error: null,
          }
        : current);
    } catch (error) {
      const message = toErrorMessage(error);
      const completedAt = performance.now();
      setTestMessage({ type: 'error', text: message });
      setTestDialog((current) => current
        ? {
            ...current,
            status: 'error',
            stage: '测试失败',
            firstTokenLatencyMs: null,
            totalLatencyMs: completedAt - startedAt,
            outputTokens: null,
            tokensPerSecond: null,
            summary: null,
            error: message,
          }
        : current);
    } finally {
      setIsTestingAi(false);
      activeTestRequestRef.current = null;
    }
  }

  async function handleLoadAiModels() {
    if (!needsRemoteConfig) {
      setModelListMessage({ type: 'error', text: '请先选择 AI 服务。' });
      return;
    }

    const nextAi = { ...ai, apiKey: effectiveApiKey };
    const baseUrl = nextAi.baseUrl.trim();
    if (nextAi.provider === 'openai-compatible' && !baseUrl) {
      setModelListMessage({ type: 'error', text: '请先填写 OpenAI 兼容接口的请求地址。' });
      return;
    }
    if (!nextAi.apiKey.trim() && nextAi.provider !== 'openai-compatible') {
      setModelListMessage({ type: 'error', text: '请先填写 API Key 后再获取模型列表。' });
      return;
    }

    setIsLoadingModels(true);
    setModelListMessage(null);
    try {
      if (shouldFlushAiApiKey(nextAi)) {
        await settingsHook.flushAIKey(nextAi.apiKey);
      }
      const models = await invoke<AiModelOption[]>('list_ai_models', {
        request: {
          aiConfig: toBackendAiRequestConfig({
            ...nextAi,
            model: nextAi.model.trim() || currentPreset.modelSuggestions[0] || 'model-list',
          }),
        },
      });
      const normalizedModels = normalizeAiModelOptions(models);
      setAvailableModels(normalizedModels);
      setModelListMessage({
        type: 'success',
        text: normalizedModels.length > 0
          ? `已获取 ${normalizedModels.length} 个可用模型。`
          : '服务已响应，但没有返回可显示的模型。',
      });
    } catch (error) {
      setModelListMessage({ type: 'error', text: toErrorMessage(error) });
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function handleClearSavedAiKey() {
    setApiKeyDraft('');
    setTestMessage({ type: 'success', text: '已清除保存的 AI API Key。' });
    await settingsHook.updateAI({ apiKey: '' });
  }

  return (
    <>
      <section className="glass-panel rounded-xl p-6">
        <div className="mb-4">
          <h3 className="font-headline-md text-[20px] font-semibold text-on-surface">AI 引擎配置</h3>
          <p className="mt-1 font-body-md text-sm text-on-surface-variant">
            推荐使用
            <a
              href={WEILOO_GPT_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              weiloo GPT
            </a>
            ，高级模型效果更好，费用更低！
          </p>
        </div>
        <div className="space-y-6">
        <div>
          <label className="font-body-md text-on-surface font-medium mb-2 block">AI 服务</label>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {AI_PROVIDER_PRESETS.map((preset) => {
              const selected = currentPreset.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void handleProviderPresetChange(preset.id)}
                  aria-pressed={selected}
                  className={`min-h-[82px] rounded-lg border px-3 py-2 text-left transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    selected
                      ? 'border-primary bg-primary/10 text-on-surface shadow-sm'
                      : 'border-outline-variant/30 bg-surface-container-low text-on-surface hover:border-primary/40 hover:bg-surface-container-high'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-body-md text-sm font-semibold">{preset.label}</span>
                    {selected && <Icon name="check_circle" size={16} className="text-primary" />}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">{preset.description}</span>
                  <span className="mt-2 block truncate text-[11px] text-on-surface-variant">
                    {preset.provider === 'none' ? '关闭远程 AI' : preset.baseUrl || '手动填写请求地址'}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="font-body-md text-[13px] text-on-surface-variant mt-2">
            OpenAI 兼容接口会按 Chat Completions 协议请求；Anthropic 使用 Claude Messages API。
          </p>
        </div>
        {needsRemoteConfig && (
          <>
            <div className="grid gap-2">
              <label className="font-body-md text-on-surface font-medium">请求地址</label>
              <input
                type="url"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                value={ai.baseUrl}
                onChange={(e) => void settingsHook.updateAI({ baseUrl: e.target.value })}
                placeholder={endpointPlaceholder}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="font-body-md text-[12px] text-on-surface-variant">
                {ai.provider === 'openai-compatible'
                  ? '填写服务商提供的 OpenAI Chat Completions 兼容地址。'
                  : '也可以直接填写完整接口路径，系统会自动避免重复拼接。'}
              </p>
            </div>
            <div className="grid gap-2">
              <label className="font-body-md text-on-surface font-medium">
                {currentPreset.apiKeyLabel}
              </label>
              <input
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                value={apiKeyDraft}
                onChange={(e) => {
                  const nextApiKey = e.target.value;
                  setApiKeyDraft(nextApiKey);
                  void settingsHook.updateAIKeyDraft(nextApiKey);
                }}
                onBlur={() => {
                  const nextAi = { ...ai, apiKey: apiKeyDraft };
                  if ((apiKeyDraft.trim() || !hasSavedApiKey) && shouldFlushAiApiKey(nextAi)) {
                    void settingsHook.flushAIKey(apiKeyDraft).catch(() => undefined);
                  }
                }}
                placeholder={apiKeyPlaceholder}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="font-body-md text-[12px] text-on-surface-variant">
                {hasSavedApiKey
                  ? '已保存 AI API Key；输入新 Key 可替换，或清除后重新配置。'
                  : ai.provider === 'openai-compatible'
                    ? '连接 Ollama、LM Studio 等本机兼容服务时可留空；填写后仅保存到系统凭据管理器。'
                    : 'API Key 仅保存到系统凭据管理器，本地设置文件只保存请求地址和模型 ID。'}
              </p>
              {hasSavedApiKey && !apiKeyDraft.trim() && (
                <button
                  type="button"
                  onClick={() => void handleClearSavedAiKey()}
                  className="w-fit rounded-lg border border-card-border bg-surface-container-high px-3 py-1.5 font-body-md text-xs text-on-surface transition-colors hover:bg-surface-container-highest"
                >
                  清除已保存 Key
                </button>
              )}
              {aiKeySaveMessage && (
                <p
                  className={`font-body-md text-[12px] ${
                    settingsHook.aiKeySaveStatus === 'error' ? 'text-error' : 'text-on-surface-variant'
                  }`}
                >
                  {aiKeySaveMessage}
                </p>
              )}
            </div>
          </>
        )}
        <div className="flex flex-col gap-3 border-t border-card-border py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 sm:pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">自动生成 AI 摘要</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              {needsRemoteConfig
                ? '同步 README 后自动调用 AI 引擎生成中文定位、摘要、关键词和建议标签。'
                : '选择 OpenAI、OpenAI 兼容接口或 Anthropic 后可启用自动摘要。'}
            </p>
          </div>
          <ToggleSwitch
            checked={needsRemoteConfig && settingsHook.settings.ai.enableAutoSummary}
            disabled={!needsRemoteConfig}
            onChange={(checked) => void settingsHook.updateAI({ enableAutoSummary: checked })}
          />
        </div>
        <div className="grid gap-4 border-t border-card-border py-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-start">
          <div>
            <h4 className="font-body-lg font-medium text-on-surface">AI 服务模型</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              可从当前服务拉取模型列表，也可以手动输入服务商提供的模型 ID。
            </p>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex gap-2">
              <select
                value={modelOptions.some((model) => model.id === ai.model) ? ai.model : ''}
                onChange={(event) => {
                  if (event.target.value) {
                    void settingsHook.updateAI({ model: event.target.value });
                  }
                }}
                disabled={!needsRemoteConfig || modelOptions.length === 0}
                className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                <option value="">选择模型</option>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {formatAiModelOptionLabel(model)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleLoadAiModels()}
                disabled={!needsRemoteConfig || isLoadingModels}
                className="gsat-primary-button inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 font-body-md text-sm font-medium text-white transition-all hover:bg-primary-container disabled:opacity-60"
              >
                <Icon name="refresh" size={16} />
                {isLoadingModels ? '获取中' : '获取模型'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {currentPreset.modelSuggestions.map((model) => (
                <button
                  key={model}
                  type="button"
                  disabled={!needsRemoteConfig}
                  onClick={() => void settingsHook.updateAI({ model })}
                  className={`rounded-md border px-2.5 py-1.5 font-body-md text-xs transition-colors disabled:opacity-60 ${
                    ai.model === model
                      ? 'border-primary bg-primary text-white'
                      : 'border-card-border bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                  }`}
                >
                  {model}
                </button>
              ))}
            </div>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              value={ai.model}
              onChange={(e) => void settingsHook.updateAI({ model: e.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              placeholder={modelPlaceholder}
              disabled={!needsRemoteConfig}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
            {modelListMessage && (
              <p
                className={`rounded-lg border px-3 py-2 font-body-md text-xs ${
                  modelListMessage.type === 'success'
                    ? 'border-success/20 bg-success/10 text-success'
                    : 'border-error/20 bg-error/10 text-error'
                }`}
              >
                {modelListMessage.text}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-stretch justify-between gap-4 border-t border-card-border py-4 sm:flex-row sm:items-start">
          <div className="flex-1">
            <h4 className="font-body-lg font-medium text-on-surface">测试 AI 配置</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              使用当前请求地址、密钥和模型发起一次测试摘要请求。
            </p>
            <p
              className={`mt-3 rounded-lg border px-3 py-2 font-body-md text-sm ${
                canTestAi
                  ? 'border-success/20 bg-success/10 text-success'
                  : 'border-error/20 bg-error/10 text-error'
              }`}
            >
              {canTestAi ? '当前 AI 配置已填写完整，可以发起测试连接。' : currentConfigMessage}
            </p>
            {testMessage && (
              <p
                className={`mt-3 rounded-lg border px-3 py-2 font-body-md text-sm ${
                  testMessage.type === 'success'
                    ? 'border-success/20 bg-success/10 text-success'
                    : 'border-error/20 bg-error/10 text-error'
                }`}
              >
                {testMessage.text}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleTestAiConnection()}
            disabled={isTestingAi || !canTestAi}
            title={canTestAi ? '测试当前 AI 配置' : (currentConfigMessage ?? '请先补全 AI 配置')}
            className="shrink-0 rounded-lg border border-card-border bg-surface-container-high px-4 py-2 font-body-md text-sm text-on-surface transition-all hover:bg-surface-container-highest disabled:opacity-60"
          >
            {isTestingAi ? '测试中...' : '测试连接'}
          </button>
        </div>
        </div>
      </section>
      <EmbeddingSettingsPanel
        accountId={workspace.authState.user ? String(workspace.authState.user.id) : null}
        settingsHook={settingsHook}
      />
      {testDialog?.isOpen && (
        <AiTestDialog
          state={testDialog}
          isTesting={isTestingAi}
          onClose={() => setTestDialog((current) => current ? { ...current, isOpen: false } : current)}
        />
      )}
    </>
  );
}

function EmbeddingSettingsPanel({
  accountId,
  settingsHook,
}: {
  accountId: string | null;
  settingsHook: ReturnType<typeof useAppSettings>;
}) {
  const embedding = settingsHook.settings.embedding;
  const hasSavedApiKey = isSavedAiApiKeyPlaceholder(embedding.apiKey);
  const [apiKeyDraft, setApiKeyDraft] = useState(hasSavedApiKey ? '' : embedding.apiKey);
  const [isTesting, setIsTesting] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [status, setStatus] = useState<VectorIndexStatus | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const effectiveApiKey = apiKeyDraft.trim() ? apiKeyDraft : embedding.apiKey;
  const effectiveEmbedding = { ...embedding, apiKey: effectiveApiKey };
  const configMessage = getEmbeddingConfigMessage(effectiveEmbedding);
  const canUseEmbedding = Boolean(accountId && !configMessage);
  const keySaveMessage = getAiKeySaveMessage(settingsHook.embeddingKeySaveStatus);

  useEffect(() => {
    setApiKeyDraft(isSavedAiApiKeyPlaceholder(embedding.apiKey) ? '' : embedding.apiKey);
  }, [embedding.apiKey]);

  useEffect(() => {
    setStatus(null);
    setMessage(null);
  }, [accountId, embedding.enabled, embedding.provider, embedding.baseUrl, embedding.model, embedding.dimensions]);

  async function persistEmbeddingKey() {
    if (shouldFlushEmbeddingApiKey(effectiveEmbedding)) {
      await settingsHook.flushEmbeddingKey(effectiveApiKey);
    }
  }

  async function loadStatus() {
    if (!accountId) {
      setMessage({ type: 'error', text: '请先连接 GitHub 账号并同步 Stars。' });
      return;
    }
    setIsLoadingStatus(true);
    try {
      await persistEmbeddingKey();
      const result = await invoke<VectorIndexStatus>('get_vector_index_status', {
        request: {
          accountId,
          embeddingConfig: embedding.enabled
            ? toBackendEmbeddingRequestConfig(effectiveEmbedding)
            : null,
        },
      });
      setStatus(result);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: toErrorMessage(error) });
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function handleTestConnection() {
    if (configMessage) {
      setMessage({ type: 'error', text: configMessage });
      return;
    }
    setIsTesting(true);
    setMessage(null);
    try {
      await persistEmbeddingKey();
      const result = await invoke<EmbeddingConnectionTestResult>('test_embedding_connection', {
        request: { embeddingConfig: toBackendEmbeddingRequestConfig(effectiveEmbedding) },
      });
      setMessage({
        type: 'success',
        text: `Embedding 服务可用：${result.model} 返回 ${result.dimensions} 维向量。`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: toErrorMessage(error) });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleRebuildIndex() {
    if (!accountId) {
      setMessage({ type: 'error', text: '请先连接 GitHub 账号并同步 Stars。' });
      return;
    }
    if (configMessage) {
      setMessage({ type: 'error', text: configMessage });
      return;
    }
    setIsRebuilding(true);
    setMessage(null);
    try {
      await persistEmbeddingKey();
      const result = await invoke<VectorIndexBuildSummary>('rebuild_vector_index', {
        request: {
          accountId,
          embeddingConfig: toBackendEmbeddingRequestConfig(effectiveEmbedding),
        },
      });
      const succeeded = result.indexedCount + result.restoredCount;
      setMessage({
        type: result.failedCount > 0 ? 'error' : 'success',
        text: result.failedCount > 0
          ? `向量索引已处理 ${result.totalCount} 个仓库，成功 ${succeeded} 个，失败 ${result.failedCount} 个。${result.failures[0] ? ` 首个错误：${result.failures[0]}` : ''}`
          : `向量索引已就绪：新生成 ${result.indexedCount} 个，从 SQLite 恢复 ${result.restoredCount} 个。`,
      });
      await loadStatus();
    } catch (error) {
      setMessage({ type: 'error', text: toErrorMessage(error) });
    } finally {
      setIsRebuilding(false);
    }
  }

  async function handleClearSavedKey() {
    setApiKeyDraft('');
    await settingsHook.updateEmbedding({ apiKey: '' });
    setMessage({ type: 'success', text: '已清除保存的 Embedding API Key。' });
  }

  return (
    <section className="glass-panel rounded-xl p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-headline-md text-[20px] font-semibold text-on-surface">向量检索</h3>
          <p className="mt-1 max-w-3xl font-body-md text-sm text-on-surface-variant">
            使用独立的 Embedding 服务生成仓库向量，并由本机 zvec 索引完成语义召回。仓库笔记不会发送到远程服务。
          </p>
        </div>
        <ToggleSwitch
          checked={embedding.enabled}
          onChange={(checked) => void settingsHook.updateEmbedding({
            enabled: checked,
            provider: checked && embedding.provider === 'none' ? 'openai' : embedding.provider,
            baseUrl: checked && embedding.provider === 'none' ? 'https://api.openai.com/v1' : embedding.baseUrl,
          })}
        />
      </div>

      <div className="space-y-5 border-t border-card-border pt-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            Embedding 服务
            <select
              value={embedding.provider}
              onChange={(event) => {
                const provider = event.target.value as EmbeddingSettingsValue['provider'];
                void settingsHook.updateEmbedding({
                  provider,
                  enabled: provider !== 'none' && embedding.enabled,
                  baseUrl: provider === 'openai'
                    ? 'https://api.openai.com/v1'
                    : provider === 'none'
                      ? ''
                      : embedding.baseUrl,
                });
              }}
              disabled={!embedding.enabled}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              <option value="openai">OpenAI</option>
              <option value="openai-compatible">OpenAI 兼容接口</option>
              <option value="none">不使用向量检索</option>
            </select>
          </label>
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            请求地址
            <input
              type="url"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={embedding.baseUrl}
              onChange={(event) => void settingsHook.updateEmbedding({ baseUrl: event.target.value })}
              disabled={!embedding.enabled}
              placeholder="https://api.openai.com/v1"
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            API Key
            <input
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              onBlur={() => void persistEmbeddingKey().catch(() => undefined)}
              disabled={!embedding.enabled}
              placeholder={hasSavedApiKey ? '已保存，输入新 Key 可替换' : '输入 Embedding API Key'}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
            <span className="font-body-md text-xs font-normal text-on-surface-variant">
              {embedding.provider === 'openai-compatible'
                ? '本机兼容服务可留空；填写后仅保存到系统凭据管理器。'
                : '仅保存到系统凭据管理器，不写入设置文件。'}
            </span>
            {hasSavedApiKey && !apiKeyDraft.trim() && (
              <button
                type="button"
                onClick={() => void handleClearSavedKey()}
                className="w-fit rounded-lg border border-card-border bg-surface-container-high px-3 py-1.5 font-body-md text-xs font-normal text-on-surface transition-colors hover:bg-surface-container-highest"
              >
                清除已保存 Key
              </button>
            )}
            {keySaveMessage && (
              <span className={`font-body-md text-xs font-normal ${settingsHook.embeddingKeySaveStatus === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>
                {keySaveMessage}
              </span>
            )}
          </label>
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            模型 ID
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={embedding.model}
              onChange={(event) => void settingsHook.updateEmbedding({ model: event.target.value })}
              disabled={!embedding.enabled}
              placeholder="text-embedding-3-small"
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            向量维度
            <input
              type="number"
              min={1}
              max={8192}
              step={1}
              value={embedding.dimensions}
              onChange={(event) => void settingsHook.updateEmbedding({ dimensions: Number(event.target.value) })}
              disabled={!embedding.enabled}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </label>
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            最低相似度
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={embedding.minScore}
              onChange={(event) => void settingsHook.updateEmbedding({ minScore: Number(event.target.value) })}
              disabled={!embedding.enabled}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </label>
          <label className="grid gap-2 font-body-md text-sm font-medium text-on-surface">
            最大结果数
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={embedding.maxResults}
              onChange={(event) => void settingsHook.updateEmbedding({ maxResults: Number(event.target.value) })}
              disabled={!embedding.enabled}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-md text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </label>
        </div>

        <div className="rounded-lg border border-card-border bg-surface-container-low px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-body-md text-sm font-medium text-on-surface">
                {status?.message ?? (embedding.enabled ? '可测试连接并检查本机索引状态。' : '启用后可生成并使用语义向量。')}
              </p>
              {status?.enabled && (
                <p className="mt-1 font-body-md text-xs text-on-surface-variant">
                  SQLite 向量 {status.sqliteCount} 个 · zvec 索引 {status.zvecCount} 个 · {status.model} / {status.dimensions} 维
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={!canUseEmbedding || isTesting || isRebuilding}
                className="rounded-lg border border-card-border bg-surface-container-high px-3 py-2 font-body-md text-sm text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-60"
              >
                {isTesting ? '测试中…' : '测试连接'}
              </button>
              <button
                type="button"
                onClick={() => void loadStatus()}
                disabled={!accountId || isLoadingStatus || isRebuilding}
                className="rounded-lg border border-card-border bg-surface-container-high px-3 py-2 font-body-md text-sm text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-60"
              >
                {isLoadingStatus ? '检查中…' : '检查状态'}
              </button>
              <button
                type="button"
                onClick={() => void handleRebuildIndex()}
                disabled={!canUseEmbedding || isTesting || isRebuilding}
                className="gsat-primary-button rounded-lg bg-primary px-3 py-2 font-body-md text-sm font-medium text-white transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                {isRebuilding ? '重建中…' : '重建索引'}
              </button>
            </div>
          </div>
          {!canUseEmbedding && (
            <p className="mt-3 font-body-md text-xs text-on-surface-variant">
              {accountId ? configMessage : '请先连接 GitHub 账号并同步 Stars。'}
            </p>
          )}
          {message && (
            <p className={`mt-3 rounded-lg border px-3 py-2 font-body-md text-sm ${message.type === 'success' ? 'border-success/20 bg-success/10 text-success' : 'border-error/20 bg-error/10 text-error'}`}>
              {message.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function getAiEndpointPlaceholder(provider: AISettingsValue['provider']) {
  switch (provider) {
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'openai-compatible':
      return 'https://你的兼容服务/v1 或 http://127.0.0.1:11434/v1';
    case 'openai':
    default:
      return 'https://api.openai.com/v1';
  }
}

function AiTestDialog(props: {
  state: AiTestDialogState;
  isTesting: boolean;
  onClose: () => void;
}) {
  const state = props.state;
  const toneClass = state.status === 'success'
    ? 'border-success/20 bg-success/10 text-success'
    : state.status === 'error'
      ? 'border-error/20 bg-error/10 text-error'
      : 'border-primary/20 bg-primary/10 text-primary';
  const statusLabel = state.status === 'success'
    ? '测试通过'
    : state.status === 'error'
      ? '测试失败'
      : '测试中';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-[560px] rounded-xl border border-card-border bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-headline-md text-[20px] font-semibold text-on-surface">AI 配置测试</h3>
            <p className="mt-1 font-body-md text-sm text-on-surface-variant">
              正在用当前配置发起一次真实摘要请求，结果会显示响应耗时和估算输出速度。
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-card-border bg-surface-container-high px-3 py-1.5 font-body-md text-sm text-on-surface transition-colors hover:bg-surface-container-highest"
          >
            {props.isTesting ? '后台等待' : '关闭'}
          </button>
        </div>

        <div className={`mt-4 rounded-lg border px-3 py-2 font-body-md text-sm ${toneClass}`}>
          <div className="flex items-center gap-2 font-medium">
            {state.status === 'running' || state.status === 'preparing' ? (
              <Icon name="progress_activity" size={16} className="animate-spin" />
            ) : (
              <Icon name={state.status === 'success' ? 'check_circle' : 'error'} size={16} />
            )}
            {statusLabel}：{state.stage}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 font-body-md text-sm sm:grid-cols-2">
          <AiTestMetric label="服务" value={state.providerLabel} />
          <AiTestMetric label="模型" value={state.model} />
          <AiTestMetric label="请求地址" value={state.endpoint} wide />
          <AiTestMetric label="首字响应" value={formatLatency(state.firstTokenLatencyMs)} />
          <AiTestMetric label="总耗时" value={formatLatency(state.totalLatencyMs)} />
          <AiTestMetric label="输出 token" value={state.outputTokens === null ? '等待结果' : String(state.outputTokens)} />
          <AiTestMetric label="输出速度" value={formatTokensPerSecond(state.tokensPerSecond)} />
          <AiTestMetric label="最长等待" value="约 120 秒" />
        </dl>

        {state.summary && (
          <div className="mt-4 rounded-lg border border-success/20 bg-success/10 px-3 py-2">
            <p className="font-body-md text-xs font-medium text-success">模型返回摘要</p>
            <p className="mt-1 font-body-md text-sm leading-relaxed text-on-surface">{state.summary}</p>
          </div>
        )}

        {state.error && (
          <div className="mt-4 rounded-lg border border-error/20 bg-error/10 px-3 py-2">
            <p className="font-body-md text-xs font-medium text-error">失败原因</p>
            <p className="mt-1 font-body-md text-sm leading-relaxed text-error">{state.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AiTestMetric(props: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={props.wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="font-body-md text-xs text-on-surface-variant">{props.label}</dt>
      <dd className="mt-1 truncate font-body-md text-sm font-medium text-on-surface" title={props.value}>
        {props.value}
      </dd>
    </div>
  );
}

function formatLatency(value: number | null) {
  if (value === null) {
    return '等待结果';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(2)} 秒`;
}

function formatTokensPerSecond(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '等待结果';
  }
  return `${value.toFixed(1)} token/s`;
}

function estimateTextTokens(value: string) {
  return Math.max(1, Math.ceil(Array.from(value).length / 4));
}

function getAiProviderPreset(providerPreset: AIProviderPreset): AIProviderPresetOption {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === providerPreset)
    ?? AI_PROVIDER_PRESETS.find((preset) => preset.id === 'custom-openai-compatible')
    ?? AI_PROVIDER_PRESETS[0];
}

function mergeAiModelOptions(
  preset: AIProviderPresetOption,
  availableModels: AiModelOption[],
  currentModel: string,
) {
  const seen = new Set<string>();
  const options: AiModelOption[] = [];

  for (const id of preset.modelSuggestions) {
    if (!seen.has(id)) {
      seen.add(id);
      options.push({ id });
    }
  }

  for (const model of normalizeAiModelOptions(availableModels)) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      options.push(model);
    }
  }

  const normalizedCurrentModel = currentModel.trim();
  if (normalizedCurrentModel && !seen.has(normalizedCurrentModel)) {
    options.unshift({ id: normalizedCurrentModel });
  }

  return options;
}

function normalizeAiModelOptions(models: AiModelOption[]) {
  const seen = new Set<string>();
  const normalizedModels: AiModelOption[] = [];

  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalizedModels.push({
      id,
      displayName: model.displayName?.trim() || null,
      ownedBy: model.ownedBy?.trim() || null,
    });
  }

  return normalizedModels.sort((left, right) => left.id.localeCompare(right.id));
}

function formatAiModelOptionLabel(model: AiModelOption) {
  const meta = model.displayName || model.ownedBy;
  return meta && meta !== model.id ? `${model.id} · ${meta}` : model.id;
}

function getAiApiKeyPlaceholder(provider: AISettingsValue['provider']) {
  switch (provider) {
    case 'anthropic':
      return 'sk-ant-...';
    case 'openai-compatible':
      return '本机服务可留空，云端兼容服务填写 API Key';
    case 'openai':
    default:
      return 'sk-...';
  }
}

function getAiModelPlaceholder(provider: AISettingsValue['provider']) {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-5';
    case 'openai-compatible':
      return '服务商模型 ID';
    case 'openai':
    default:
      return 'gpt-5.5';
  }
}

function getAiKeySaveMessage(status: ReturnType<typeof useAppSettings>['aiKeySaveStatus']) {
  switch (status) {
    case 'saving':
      return '正在安全保存 API Key...';
    case 'saved':
      return 'API Key 已安全保存。';
    case 'error':
      return 'API Key 保存失败，请检查系统凭据管理器权限。';
    case 'idle':
    default:
      return null;
  }
}

/* === 通用设置 === */
function GeneralSettings({
  settingsHook,
  workspace,
}: {
  settingsHook: ReturnType<typeof useAppSettings>;
  workspace: ReturnType<typeof useWorkspace>;
}) {
  const [isClearingAllLocalData, setIsClearingAllLocalData] = useState(false);
  const [isClearDataConfirmOpen, setIsClearDataConfirmOpen] = useState(false);
  const [localDataMessage, setLocalDataMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleClearAllLocalData() {
    setIsClearingAllLocalData(true);
    setLocalDataMessage(null);
    try {
      await settingsHook.resetSettings();
      await workspace.handleClearLocalData();
      setIsClearDataConfirmOpen(false);
      setLocalDataMessage({ type: 'success', text: '本机数据已清空，重新连接 GitHub 后即可重新同步。' });
    } catch (error) {
      setLocalDataMessage({ type: 'error', text: `本机数据清空失败：${toErrorMessage(error)}` });
    } finally {
      setIsClearingAllLocalData(false);
    }
  }

  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">通用设置</h3>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1 md:pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">界面主题</h4>
            <p className="font-body-md text-on-surface-variant mt-1">选择浅色、深色，或跟随系统外观自动切换。</p>
          </div>
          <div className="flex w-full rounded-lg border border-outline-variant/30 bg-surface-container-low p-1 md:w-auto">
            {[
              { value: 'system', label: '系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => void settingsHook.updateTheme({ mode: item.value as ThemeSettingsValue['mode'] })}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors md:flex-none ${
                  settingsHook.settings.theme.mode === item.value
                    ? 'bg-primary text-white'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="font-body-md text-on-surface font-medium mb-2 block">品牌色</label>
          <div className="flex gap-2">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                title={preset.label}
                onClick={() => void settingsHook.updateTheme({ brandColor: preset.color, colorPreset: preset.name })}
                className={`w-10 h-10 rounded-full border-2 transition-transform hover:scale-110 ${
                  settingsHook.settings.theme.brandColor === preset.color
                    ? 'border-on-surface scale-110'
                    : 'border-transparent'
                }`}
                style={{ backgroundColor: preset.color }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-card-border py-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1 md:pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">界面字号</h4>
            <p className="font-body-md text-on-surface-variant mt-1">调整主要文字、标题和标签的显示尺寸。</p>
          </div>
          <div className="flex w-full rounded-lg border border-outline-variant/30 bg-surface-container-low p-1 md:w-auto">
            {[
              { value: 'small', label: '小' },
              { value: 'medium', label: '中' },
              { value: 'large', label: '大' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => void settingsHook.updateTheme({ fontSize: item.value as ThemeSettingsValue['fontSize'] })}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors md:flex-none ${
                  settingsHook.settings.theme.fontSize === item.value
                    ? 'bg-primary text-white'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-card-border py-4">
          <div className="min-w-0 flex-1">
            <h4 className="font-body-lg font-medium text-on-surface">启动时显示欢迎引导</h4>
            <p className="font-body-md text-on-surface-variant mt-1">首次打开应用时显示欢迎流程。</p>
          </div>
          <ToggleSwitch
            checked={settingsHook.settings.general.showWelcomeOnStartup}
            onChange={(checked) => void settingsHook.updateGeneral({ showWelcomeOnStartup: checked })}
          />
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-card-border py-4">
          <div className="min-w-0 flex-1">
            <h4 className="font-body-lg font-medium text-on-surface">自动同步</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              应用启动后立即同步一次，并按设定间隔完整核对 GitHub Stars。
            </p>
          </div>
          <ToggleSwitch
            checked={settingsHook.settings.sync.enableAutoSync}
            onChange={(checked) => void settingsHook.updateSync({ enableAutoSync: checked })}
          />
        </div>
        {settingsHook.settings.sync.enableAutoSync && (
          <div className="flex flex-col gap-3 border-t border-card-border py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 sm:pr-6">
              <h4 className="font-body-lg font-medium text-on-surface">同步间隔</h4>
              <p className="font-body-md text-on-surface-variant mt-1">可设置 5 到 1440 分钟，避免过于频繁请求 GitHub API。</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={settingsHook.settings.sync.autoSyncInterval}
                onChange={(event) =>
                  void settingsHook.updateSync({ autoSyncInterval: normalizeSyncIntervalInput(event.target.value) })
                }
                className="w-24 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-sm text-on-surface-variant">分钟</span>
            </div>
          </div>
        )}
        <div className="border-t border-card-border pt-5">
          <div className="mb-5 rounded-xl border border-error/25 bg-error/10 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon name="delete" size={20} className="text-error" />
                  <h4 className="font-body-lg font-semibold text-on-surface">清空本机数据</h4>
                </div>
                <p className="mt-2 max-w-2xl font-body-md text-sm leading-relaxed text-on-surface-variant">
                  删除本机 SQLite 数据库、应用设置、GitHub Token 和 AI API Key。适合重新登录、清理损坏数据或准备重新同步。
                </p>
                {localDataMessage && (
                  <p
                    className={`mt-3 text-sm ${
                      localDataMessage.type === 'success' ? 'text-success' : 'text-error'
                    }`}
                  >
                    {localDataMessage.text}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocalDataMessage(null);
                  setIsClearDataConfirmOpen(true);
                }}
                disabled={isClearingAllLocalData || workspace.isClearingLocalData}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-error/30 bg-error px-4 py-2 text-sm font-semibold text-on-error transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name="delete" size={17} />
                {isClearingAllLocalData || workspace.isClearingLocalData ? '正在清空' : '清空本机数据'}
              </button>
            </div>
          </div>
          {isClearDataConfirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="clear-local-data-title"
                className="w-full max-w-md rounded-lg border border-error/25 bg-surface p-5 shadow-xl shadow-black/20"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-error/10">
                    <Icon name="delete" size={20} className="text-error" />
                  </span>
                  <div className="min-w-0">
                    <h4 id="clear-local-data-title" className="font-body-lg font-semibold text-on-surface">
                      确认清空本机数据
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                      这会删除本机 Stars、README、AI 摘要、标签、笔记、GitHub Token 和 AI API Key。操作完成后应用会回到新安装状态。
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setIsClearDataConfirmOpen(false)}
                    disabled={isClearingAllLocalData || workspace.isClearingLocalData}
                    className="inline-flex items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClearAllLocalData()}
                    disabled={isClearingAllLocalData || workspace.isClearingLocalData}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-semibold text-on-error transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Icon name="delete" size={17} />
                    {isClearingAllLocalData || workspace.isClearingLocalData ? '正在清空' : '确认清空'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AboutSettings({ appUpdate }: { appUpdate: AppUpdateContextValue }) {
  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="mb-6 font-headline-md text-[20px] font-semibold text-on-surface">关于项目</h3>
      <div className="space-y-5">
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Icon name="stars" size={20} className="shrink-0 text-primary" />
                <h4 className="min-w-0 font-body-lg font-semibold text-on-surface">GitHub-Stars-AI-Tools</h4>
              </div>
              <p className="mt-2 max-w-2xl font-body-md text-sm leading-relaxed text-on-surface-variant">
                面向 GitHub Stars 的本地优先桌面知识库，用 README、AI 摘要和标签网络把收藏仓库整理成可检索、可理解的个人技术资产。
              </p>
              <p className="mt-2 max-w-2xl font-body-md text-sm leading-relaxed text-on-surface-variant">
                本项目源码公开，采用非商用许可。个人学习、研究和非营利用途可以使用；商业使用、集成或再分发需要另行获得授权。
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-on-surface-variant">
                <span className="rounded-lg border border-outline-variant/30 bg-surface px-2.5 py-1">GSAT</span>
                <span className="rounded-lg border border-outline-variant/30 bg-surface px-2.5 py-1">本地优先客户端</span>
                <span className="rounded-lg border border-outline-variant/30 bg-surface px-2.5 py-1">AI 知识整理</span>
                <span className="rounded-lg border border-outline-variant/30 bg-surface px-2.5 py-1">PolyForm Noncommercial 1.0.0</span>
              </div>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:min-w-40">
              <a
                href={PROJECT_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0"
              >
                <Icon name="code" size={17} />
                项目仓库
                <Icon name="open_in_new" size={15} />
              </a>
              <a
                href={PROJECT_ISSUES_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-outline-variant/35 bg-surface px-3 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <Icon name="bug_report" size={17} />
                问题反馈
                <Icon name="open_in_new" size={15} />
              </a>
            </div>
          </div>
          <div className="mt-4 grid gap-2 border-t border-outline-variant/25 pt-3 md:grid-cols-2">
            <a
              href={PROJECT_LICENSE_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded-lg border border-outline-variant/25 bg-surface px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="policy" size={18} className="mt-0.5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block font-medium text-on-surface">查看许可证</span>
                <span className="text-xs">确认非商用授权边界</span>
              </span>
            </a>
            <a
              href={PROJECT_ACKNOWLEDGEMENTS_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded-lg border border-outline-variant/25 bg-surface px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="diversity_3" size={18} className="mt-0.5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block font-medium text-on-surface">开源组件鸣谢</span>
                <span className="text-xs">查看项目依赖与生态致谢</span>
              </span>
            </a>
          </div>
        </div>
        <AppUpdatePanel appUpdate={appUpdate} />
      </div>
    </section>
  );
}

function normalizeSyncIntervalInput(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(Math.max(parsed, 5), 1440);
}

/* === 数据备份设置 === */
function BackupSettings({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const isConnected = workspace.authState.hasToken && Boolean(workspace.authState.user);
  const isAnyBackupActionRunning =
    workspace.isExportingAnnotations ||
    workspace.isImportingAnnotations ||
    workspace.isExportingRepositoryLibrary ||
    workspace.isImportingRepositoryLibrary;
  const importHint = !isConnected
    ? '请先连接 GitHub 账号后再导入 Gist 备份。'
    : workspace.gistIdDraft.trim()
      ? '导入会覆盖匹配仓库的标签、笔记和阅读状态，请确认 Gist ID 来自你的 GSAT 备份。'
      : '输入 Gist ID 后即可从备份恢复数据。';

  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">数据备份与恢复</h3>
      <div className="space-y-6">
        {!isConnected && (
          <p className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body-md text-sm text-error">
            请先连接 GitHub 账号。Gist 备份需要 Token 具备 gist 权限。
          </p>
        )}
        {workspace.authMessage && (
          <p className="rounded-lg border border-success/20 bg-success/10 px-3 py-2 font-body-md text-sm text-success">
            {workspace.authMessage}
          </p>
        )}
        {workspace.error && (
          <p className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body-md text-sm text-error">
            {workspace.error}
          </p>
        )}
        <div className="p-4 rounded-lg bg-surface-container-low border border-card-border">
          <h4 className="font-body-lg font-medium text-on-surface mb-2 flex items-center gap-2">
            <Icon name="cloud_upload" size={20} className="text-primary" />
            导出注解
          </h4>
          <p className="font-body-md text-sm text-on-surface-variant mb-3">
            只导出标签、笔记和阅读状态。适合在已同步相同 Stars 的设备之间恢复整理结果。
          </p>
          <button
            onClick={() => void workspace.handleExportAnnotations()}
            disabled={isAnyBackupActionRunning || !isConnected}
            title={isConnected ? '导出标签、笔记和阅读状态到私密 Gist' : '请先连接 GitHub 账号'}
            className="px-4 py-2 bg-primary text-white rounded-lg font-body-md flex items-center gap-2 hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
          >
            <Icon name="upload" size={18} />
            {workspace.isExportingAnnotations ? '导出中...' : '导出注解'}
          </button>
        </div>
        <div className="p-4 rounded-lg bg-surface-container-low border border-card-border">
          <h4 className="font-body-lg font-medium text-on-surface mb-2 flex items-center gap-2">
            <Icon name="inventory_2" size={20} className="text-primary" />
            导出所有仓库
          </h4>
          <p className="font-body-md text-sm text-on-surface-variant mb-3">
            导出仓库清单、标签、笔记和阅读状态，不包含 README、AI 摘要、Embedding、API Key 或本机设置。
          </p>
          <button
            onClick={() => void workspace.handleExportRepositoryLibrary()}
            disabled={isAnyBackupActionRunning || !isConnected}
            title={isConnected ? '导出所有仓库和整理结果到私密 Gist' : '请先连接 GitHub 账号'}
            className="px-4 py-2 bg-primary text-white rounded-lg font-body-md flex items-center gap-2 hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
          >
            <Icon name="upload" size={18} />
            {workspace.isExportingRepositoryLibrary ? '导出中...' : '导出所有仓库'}
          </button>
        </div>
        <div className="p-4 rounded-lg bg-surface-container-low border border-card-border">
          <h4 className="font-body-lg font-medium text-on-surface mb-2 flex items-center gap-2">
            <Icon name="cloud_download" size={20} className="text-primary" />
            从 Gist 导入
          </h4>
          <p className="font-body-md text-sm text-on-surface-variant mb-3">
            输入 Gist ID 后选择导入范围。导入所有仓库会为当前账号创建缺失的本地仓库记录。
          </p>
          <form
            onSubmit={(event) => void workspace.handleImportAnnotations(event)}
            className="space-y-3"
          >
            <input
              type="text"
              value={workspace.gistIdDraft}
              onChange={(e) => workspace.setGistIdDraft(e.target.value)}
              placeholder="输入 Gist ID..."
              className="w-full bg-surface border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <button
                type="submit"
                disabled={isAnyBackupActionRunning || !workspace.gistIdDraft.trim() || !isConnected}
                title={isConnected ? '从 Gist 恢复已有仓库的标签、笔记和阅读状态' : '请先连接 GitHub 账号'}
                className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md transition-all disabled:opacity-60"
              >
                {workspace.isImportingAnnotations ? '导入中...' : '导入注解'}
              </button>
              <button
                type="button"
                onClick={(event) => void workspace.handleImportRepositoryLibrary(event)}
                disabled={isAnyBackupActionRunning || !workspace.gistIdDraft.trim() || !isConnected}
                title={isConnected ? '从 Gist 恢复仓库清单、标签、笔记和阅读状态' : '请先连接 GitHub 账号'}
                className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md transition-all disabled:opacity-60"
              >
                {workspace.isImportingRepositoryLibrary ? '导入中...' : '导入所有仓库'}
              </button>
            </div>
          </form>
          <p className={`mt-2 font-body-md text-xs ${isConnected ? 'text-on-surface-variant' : 'text-error'}`}>
            {importHint}
          </p>
        </div>
      </div>
    </section>
  );
}

/* === Toggle Switch 组件 === */
function ToggleSwitch({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        const next = !checked;
        onChange?.(next);
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 shrink-0 ${
        checked ? 'bg-primary' : 'bg-outline-variant'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
