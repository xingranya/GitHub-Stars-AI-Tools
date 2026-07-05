import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { Icon } from '@/components/ui/icon';
import { getAiConfigMessage } from '@/lib/ai-config';
import { COLOR_PRESETS } from '@/types-settings';
import type { AISettings as AISettingsValue, ThemeSettings as ThemeSettingsValue } from '@/types-settings';

type SettingsTab = 'github' | 'ai' | 'general' | 'backup';

const AI_PROVIDER_DEFAULTS: Record<AISettingsValue['provider'], Pick<AISettingsValue, 'baseUrl' | 'model'>> = {
  none: { baseUrl: '', model: 'gpt-4o-mini' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  'openai-compatible': { baseUrl: '', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
};

type AiConnectionTestResult = {
  summaryZh: string;
  model: string;
  promptVersion: string;
};

export function SettingsPage() {
  const workspace = useWorkspace();
  const settingsHook = useAppSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('github');

  const tabs: { key: SettingsTab; icon: string; label: string }[] = [
    { key: 'github', icon: 'code', label: 'GitHub 账号' },
    { key: 'ai', icon: 'smart_toy', label: 'AI 引擎配置' },
    { key: 'general', icon: 'tune', label: '通用设置' },
    { key: 'backup', icon: 'backup', label: '数据备份' },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col gap-5 overflow-y-auto p-4 sm:p-5 lg:flex-row lg:gap-8 lg:p-margin-page">
      {/* Settings Sidebar */}
      <aside className="w-full flex-shrink-0 lg:w-64">
        <h2 className="font-headline-md text-headline-md text-on-surface mb-6">设置</h2>
        <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex w-max shrink-0 items-center gap-3 rounded-lg px-4 py-3 text-left font-medium transition-colors lg:w-full ${
                activeTab === tab.key
                  ? 'bg-surface-container text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
              }`}
            >
              <Icon name={tab.icon} size={20} />
              <span className="font-body-md text-body-md">{tab.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Settings Content */}
      <div className="min-w-0 flex-1 space-y-6 lg:max-w-4xl">
        {settingsHook.settingsError && (
          <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 font-body-md text-sm text-error">
            {settingsHook.settingsError}
          </div>
        )}
        {activeTab === 'github' && (
          <GitHubSettings
            workspace={workspace}
            settingsHook={settingsHook}
          />
        )}
        {activeTab === 'ai' && <AISettings settingsHook={settingsHook} />}
        {activeTab === 'general' && <GeneralSettings settingsHook={settingsHook} />}
        {activeTab === 'backup' && <BackupSettings workspace={workspace} />}
      </div>
    </div>
  );
}

/* === GitHub 设置 === */
function GitHubSettings({
  workspace,
  settingsHook,
}: {
  workspace: ReturnType<typeof useWorkspace>;
  settingsHook: ReturnType<typeof useAppSettings>;
}) {
  const isConnected = workspace.authState.hasToken && Boolean(workspace.authState.user);
  const user = workspace.authState.user;
  const autoSummaryConfigMessage = settingsHook.settings.ai.enableAutoSummary
    ? getAiConfigMessage(settingsHook.settings.ai)
    : null;

  return (
    <>
      {/* Connection Status Card */}
      <section className="glass-panel rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 pointer-events-none opacity-10">
          <Icon name="cloud_sync" size={96} />
        </div>
        <div className="flex items-start justify-between relative z-10">
          <div>
            <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-1">GitHub 连接状态</h3>
            <p className="font-body-md text-on-surface-variant mb-6">
              管理 GitHub Personal Access Token。同步 Stars 需要 repo 和 user 权限，Gist 备份需要 gist 权限。
            </p>
            <div
              className={`flex items-center gap-3 border px-4 py-2.5 rounded-lg w-max ${
                isConnected ? 'bg-success/10 border-success/20' : 'bg-error/10 border-error/20'
              }`}
            >
              <Icon
                name={isConnected ? 'check_circle' : 'error'}
                size={20}
                className={isConnected ? 'text-success' : 'text-error'}
              />
              <span className={`font-body-md font-medium ${isConnected ? 'text-success' : 'text-error'}`}>
                {isConnected ? '已连接 (Token 有效)' : '未连接'}
              </span>
            </div>
          </div>
          {isConnected && user && (
            <div className="flex items-center gap-3 bg-surface-container-low border border-card-border px-4 py-2 rounded-lg">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.login} className="w-6 h-6 rounded-full" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <Icon name="person" size={16} className="text-primary" />
                </div>
              )}
              <span className="font-label-sm text-label-sm text-on-surface">@{user.login}</span>
            </div>
          )}
        </div>
      </section>

      {/* Configuration Form */}
      <section className="glass-panel rounded-xl p-0 overflow-hidden">
        <div className="p-6 border-b border-card-border bg-surface/50">
          <h3 className="font-headline-md text-[20px] font-semibold text-on-surface">访问配置</h3>
        </div>
        <div className="p-6 space-y-6">
          {/* Token Input */}
          {isConnected ? (
            <div className="space-y-2">
              <label className="font-body-md text-on-surface font-medium flex items-center gap-2">
                Personal Access Token
                <Icon name="info" size={16} className="text-on-surface-variant cursor-help" />
              </label>
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2">
                  <p className="font-label-sm text-on-surface">Token 已保存到系统钥匙串</p>
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
              onSubmit={(e) => {
                e.preventDefault();
                void workspace.connectWithToken(workspace.token).catch(() => undefined);
              }}
              className="space-y-2"
            >
              <label className="font-body-md text-on-surface font-medium flex items-center gap-2">
                Personal Access Token
                <Icon name="info" size={16} className="text-on-surface-variant cursor-help" />
              </label>
              <div className="flex gap-3">
                <input
                  type="password"
                  value={workspace.token}
                  onChange={(e) => workspace.setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxx"
                  className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-label-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <button
                  type="submit"
                  disabled={workspace.isSavingToken || !workspace.token.trim()}
                  className="px-4 py-2 bg-primary text-on-primary rounded-lg font-body-md hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
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
                手动抓取会批量缓存 README；生成单个 AI 摘要时也会自动补抓当前仓库 README。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sync Actions */}
      <section className="glass-panel rounded-xl p-6">
        <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-4">数据同步操作</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void workspace.handleSyncStars()}
            disabled={workspace.isSyncingStars || !isConnected}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg font-body-md flex items-center gap-2 hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
          >
            <Icon name="sync" size={18} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
            {workspace.isSyncingStars ? '同步中...' : '同步 Stars'}
          </button>
          <button
            onClick={() => void workspace.handleSyncStars({ forceFull: true })}
            disabled={workspace.isSyncingStars || !isConnected}
            title="重新扫描完整 Stars 列表，并清理已取消 Star 的本地仓库"
            className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md flex items-center gap-2 transition-all disabled:opacity-60"
          >
            <Icon name="published_with_changes" size={18} className={workspace.isSyncingStars ? 'animate-spin' : ''} />
            强制全量同步
          </button>
          <button
            onClick={() => {
              void (async () => {
                const readmeSummary = await workspace.handleFetchReadmes({
                  aiConfig: settingsHook.settings.ai,
                  autoGenerateAi: settingsHook.settings.ai.enableAutoSummary,
                  aiLimit: 50,
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
              {workspace.syncSummary.createdCount} 个，扫描 {workspace.syncSummary.scannedCount} 个，
              {workspace.syncSummary.mode === 'incremental' ? '增量同步' : '全量同步'}。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

/* === AI 引擎设置 === */
function AISettings({ settingsHook }: { settingsHook: ReturnType<typeof useAppSettings> }) {
  const ai = settingsHook.settings.ai;
  const needsRemoteConfig = ai.provider !== 'none';
  const [apiKeyDraft, setApiKeyDraft] = useState(ai.apiKey);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const endpointPlaceholder = getAiEndpointPlaceholder(ai.provider);
  const apiKeyPlaceholder = getAiApiKeyPlaceholder(ai.provider);
  const modelPlaceholder = getAiModelPlaceholder(ai.provider);

  useEffect(() => {
    setApiKeyDraft(ai.apiKey);
  }, [ai.apiKey]);

  async function handleProviderChange(provider: AISettingsValue['provider']) {
    const defaults = AI_PROVIDER_DEFAULTS[provider];
    setTestMessage(null);
    let savedApiKey = '';
    if (provider !== 'none' && !apiKeyDraft.trim()) {
      try {
        savedApiKey = (await invoke<string | null>('get_ai_api_key'))?.trim() ?? '';
      } catch (error) {
        setTestMessage({ type: 'error', text: `AI Key 读取失败：${toErrorMessage(error)}` });
      }
    }
    if (savedApiKey) setApiKeyDraft(savedApiKey);
    void settingsHook.updateAI({
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      ...(savedApiKey ? { apiKey: savedApiKey } : {}),
      enableAutoSummary: provider === 'none' ? false : ai.enableAutoSummary,
    });
  }

  async function handleTestAiConnection() {
    const nextAi = { ...ai, apiKey: apiKeyDraft };
    const configMessage = getAiConfigMessage(nextAi);
    if (configMessage) {
      setTestMessage({ type: 'error', text: configMessage });
      return;
    }

    setIsTestingAi(true);
    setTestMessage(null);
    try {
      if (apiKeyDraft !== ai.apiKey) {
        await settingsHook.updateAI({ apiKey: apiKeyDraft });
      }
      const result = await invoke<AiConnectionTestResult>('test_ai_connection', {
        request: {
          aiConfig: {
            provider: nextAi.provider,
            baseUrl: nextAi.baseUrl,
            apiKey: nextAi.apiKey,
            model: nextAi.model,
          },
        },
      });
      setTestMessage({
        type: 'success',
        text: `AI 配置可用，${result.model} 已返回摘要：${result.summaryZh.slice(0, 80)}`,
      });
    } catch (error) {
      setTestMessage({ type: 'error', text: toErrorMessage(error) });
    } finally {
      setIsTestingAi(false);
    }
  }

  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">AI 引擎配置</h3>
      <div className="space-y-6">
        <div>
          <label className="font-body-md text-on-surface font-medium mb-2 block">AI Provider</label>
          <select
            value={ai.provider}
            onChange={(e) => void handleProviderChange(e.target.value as AISettingsValue['provider'])}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="openai">OpenAI 官方接口</option>
            <option value="openai-compatible">OpenAI 兼容接口</option>
            <option value="anthropic">Anthropic Claude 接口</option>
            <option value="none">关闭 AI 功能</option>
          </select>
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
                value={ai.baseUrl}
                onChange={(e) => void settingsHook.updateAI({ baseUrl: e.target.value })}
                placeholder={endpointPlaceholder}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="font-body-md text-[12px] text-on-surface-variant">
                {ai.provider === 'openai-compatible'
                  ? '填写兼容 OpenAI Chat Completions 的网关地址，例如 https://api.example.com/v1。'
                  : '也可以直接填写完整接口路径，系统会自动避免重复拼接。'}
              </p>
            </div>
            <div className="grid gap-2">
              <label className="font-body-md text-on-surface font-medium">API Key</label>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onBlur={() => {
                  if (apiKeyDraft !== ai.apiKey) {
                    void settingsHook.updateAI({ apiKey: apiKeyDraft });
                  }
                }}
                placeholder={apiKeyPlaceholder}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="font-body-md text-[12px] text-on-surface-variant">
                API Key 仅保存到系统钥匙串，本地设置文件只保存请求地址和模型 ID。
              </p>
            </div>
          </>
        )}
        <div className="flex flex-col gap-3 border-t border-card-border py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 sm:pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">自动生成 AI 摘要</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              {needsRemoteConfig
                ? '同步 README 后自动调用 AI 引擎生成中文摘要和关键词。'
                : '选择 OpenAI、OpenAI 兼容接口或 Anthropic 后可启用自动摘要。'}
            </p>
          </div>
          <ToggleSwitch
            checked={needsRemoteConfig && settingsHook.settings.ai.enableAutoSummary}
            disabled={!needsRemoteConfig}
            onChange={(checked) => void settingsHook.updateAI({ enableAutoSummary: checked })}
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-card-border py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 sm:pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">AI Provider 模型</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              指定远程 AI 引擎使用的模型名称，例如 gpt-4o-mini 或 claude-3-5-haiku-latest。
            </p>
          </div>
          <input
            type="text"
            value={ai.model}
            onChange={(e) => void settingsHook.updateAI({ model: e.target.value })}
            placeholder={modelPlaceholder}
            disabled={!needsRemoteConfig}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-1.5 font-body-md text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60 sm:w-64"
          />
        </div>
        <div className="flex flex-col items-stretch justify-between gap-4 border-t border-card-border py-4 sm:flex-row sm:items-start">
          <div className="flex-1">
            <h4 className="font-body-lg font-medium text-on-surface">测试 AI 配置</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              使用当前请求地址、密钥和模型发起一次测试摘要请求。
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
            disabled={isTestingAi || !needsRemoteConfig}
            title={needsRemoteConfig ? '测试当前 AI 配置' : '请先选择 OpenAI、OpenAI 兼容接口或 Anthropic Provider'}
            className="shrink-0 rounded-lg border border-card-border bg-surface-container-high px-4 py-2 font-body-md text-sm text-on-surface transition-all hover:bg-surface-container-highest disabled:opacity-60"
          >
            {isTestingAi ? '测试中...' : '测试连接'}
          </button>
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
      return 'https://api.example.com/v1';
    case 'openai':
    default:
      return 'https://api.openai.com/v1';
  }
}

function getAiApiKeyPlaceholder(provider: AISettingsValue['provider']) {
  switch (provider) {
    case 'anthropic':
      return 'sk-ant-...';
    case 'openai-compatible':
      return '填写兼容服务提供的 API Key';
    case 'openai':
    default:
      return 'sk-...';
  }
}

function getAiModelPlaceholder(provider: AISettingsValue['provider']) {
  switch (provider) {
    case 'anthropic':
      return 'claude-3-5-haiku-latest';
    case 'openai-compatible':
      return '服务商模型 ID';
    case 'openai':
    default:
      return 'gpt-4o-mini';
  }
}

/* === 通用设置 === */
function GeneralSettings({ settingsHook }: { settingsHook: ReturnType<typeof useAppSettings> }) {
  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">通用设置</h3>
      <div className="space-y-6">
        <div className="flex items-center justify-between py-4">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">界面主题</h4>
            <p className="font-body-md text-on-surface-variant mt-1">选择浅色、深色，或跟随系统外观自动切换。</p>
          </div>
          <div className="flex rounded-lg border border-outline-variant/30 bg-surface-container-low p-1">
            {[
              { value: 'system', label: '系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => void settingsHook.updateTheme({ mode: item.value as ThemeSettingsValue['mode'] })}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  settingsHook.settings.theme.mode === item.value
                    ? 'bg-primary text-on-primary'
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
        <div className="flex items-center justify-between py-4 border-t border-card-border">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">界面字号</h4>
            <p className="font-body-md text-on-surface-variant mt-1">调整主要文字、标题和标签的显示尺寸。</p>
          </div>
          <div className="flex rounded-lg border border-outline-variant/30 bg-surface-container-low p-1">
            {[
              { value: 'small', label: '小' },
              { value: 'medium', label: '中' },
              { value: 'large', label: '大' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => void settingsHook.updateTheme({ fontSize: item.value as ThemeSettingsValue['fontSize'] })}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  settingsHook.settings.theme.fontSize === item.value
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between py-4 border-t border-card-border">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">启动时显示欢迎引导</h4>
            <p className="font-body-md text-on-surface-variant mt-1">首次打开应用时显示欢迎流程。</p>
          </div>
          <ToggleSwitch
            checked={settingsHook.settings.general.showWelcomeOnStartup}
            onChange={(checked) => void settingsHook.updateGeneral({ showWelcomeOnStartup: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-4 border-t border-card-border">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">自动增量同步</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              应用启动后立即同步一次，并按设定间隔继续同步新增的 GitHub Stars。
            </p>
          </div>
          <ToggleSwitch
            checked={settingsHook.settings.sync.enableAutoSync}
            onChange={(checked) => void settingsHook.updateSync({ enableAutoSync: checked })}
          />
        </div>
        {settingsHook.settings.sync.enableAutoSync && (
          <div className="flex items-center justify-between py-4 border-t border-card-border">
            <div className="flex-1 pr-6">
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
            导出到 GitHub Gist
          </h4>
          <p className="font-body-md text-sm text-on-surface-variant mb-3">
            将标签、笔记、阅读状态等注解数据导出为私密 Gist，用于跨设备同步。
          </p>
          <button
            onClick={() => void workspace.handleExportAnnotations()}
            disabled={workspace.isExportingAnnotations || !isConnected}
            title={isConnected ? '导出标签、笔记和阅读状态到私密 Gist' : '请先连接 GitHub 账号'}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg font-body-md flex items-center gap-2 hover:brightness-110 transition-all shadow-sm disabled:opacity-60"
          >
            <Icon name="upload" size={18} />
            {workspace.isExportingAnnotations ? '导出中...' : '导出注解'}
          </button>
        </div>
        <div className="p-4 rounded-lg bg-surface-container-low border border-card-border">
          <h4 className="font-body-lg font-medium text-on-surface mb-2 flex items-center gap-2">
            <Icon name="cloud_download" size={20} className="text-primary" />
            从 Gist 导入
          </h4>
          <p className="font-body-md text-sm text-on-surface-variant mb-3">
            输入 Gist ID，从备份恢复注解数据到本地。
          </p>
          <form
            onSubmit={(event) => void workspace.handleImportAnnotations(event)}
            className="flex gap-3"
          >
            <input
              type="text"
              value={workspace.gistIdDraft}
              onChange={(e) => workspace.setGistIdDraft(e.target.value)}
              placeholder="输入 Gist ID..."
              className="flex-1 bg-surface border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={workspace.isImportingAnnotations || !workspace.gistIdDraft.trim() || !isConnected}
              title={isConnected ? '从 Gist 恢复注解数据' : '请先连接 GitHub 账号'}
              className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md transition-all disabled:opacity-60"
            >
              {workspace.isImportingAnnotations ? '导入中...' : '导入'}
            </button>
          </form>
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
        className={`inline-block h-4 w-4 transform rounded-full bg-on-primary transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
