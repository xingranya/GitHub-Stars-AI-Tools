import { useState } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { useAppSettings } from '@/providers/settings-provider';
import { Icon } from '@/components/ui/icon';

type SettingsTab = 'github' | 'ai' | 'general' | 'backup';

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
    <div className="p-margin-page h-[calc(100vh-64px)] overflow-y-auto flex gap-8">
      {/* Settings Sidebar */}
      <aside className="w-64 flex-shrink-0">
        <h2 className="font-headline-md text-headline-md text-on-surface mb-6">设置</h2>
        <nav className="flex flex-col gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-left transition-colors ${
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
      <div className="flex-1 max-w-4xl space-y-6">
        {activeTab === 'github' && (
          <GitHubSettings
            workspace={workspace}
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
function GitHubSettings({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const [showToken, setShowToken] = useState(false);
  const isConnected = workspace.authState.hasToken;
  const user = workspace.authState.user;

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
              管理您的 GitHub Personal Access Token 及同步权限。
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
                <div className="relative flex-1">
                  <input
                    type={showToken ? 'text' : 'password'}
                    readOnly
                    value="ghp_***********************************"
                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-label-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <Icon name={showToken ? 'visibility_off' : 'visibility'} size={20} />
                  </button>
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
                void workspace.connectWithToken(workspace.token);
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

          <hr className="border-card-border" />

          {/* Sync Strategy */}
          <div className="flex items-center justify-between py-4 border-b border-card-border">
            <div className="flex-1 pr-6">
              <h4 className="font-body-lg font-medium text-on-surface">同步策略</h4>
              <p className="font-body-md text-on-surface-variant mt-1">
                选择获取仓库数据的方式。增量同步速度更快。
              </p>
            </div>
            <div className="flex bg-surface-container-low p-1 rounded-lg border border-card-border">
              <button className="px-4 py-1.5 text-sm font-medium rounded-md text-on-surface-variant hover:text-on-surface transition-colors">
                全量同步
              </button>
              <button className="px-4 py-1.5 text-sm font-medium rounded-md bg-surface border border-card-border shadow-sm text-primary transition-all">
                增量同步
              </button>
            </div>
          </div>

          {/* Fetch README Toggle */}
          <div className="flex items-center justify-between py-4">
            <div className="flex-1 pr-6">
              <h4 className="font-body-lg font-medium text-on-surface flex items-center gap-2">
                自动抓取 README
                <span className="bg-primary-fixed text-on-primary-fixed text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  AI 推荐
                </span>
              </h4>
              <p className="font-body-md text-on-surface-variant mt-1">
                开启后，将在同步时自动下载并解析 README.md 以供 AI 引擎构建上下文。
              </p>
            </div>
            <ToggleSwitch defaultChecked={true} />
          </div>
        </div>
        <div className="p-4 border-t border-card-border bg-surface-container-low flex justify-end gap-3">
          <button className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md transition-all">
            取消
          </button>
          <button className="px-4 py-2 bg-primary text-on-primary rounded-lg font-body-md hover:brightness-110 transition-all shadow-sm">
            保存更改
          </button>
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
            onClick={() => void workspace.handleFetchReadmes()}
            disabled={workspace.isFetchingReadmes || !isConnected}
            className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg border border-card-border font-body-md flex items-center gap-2 transition-all disabled:opacity-60"
          >
            <Icon name="description" size={18} className={workspace.isFetchingReadmes ? 'animate-spin' : ''} />
            {workspace.isFetchingReadmes ? '抓取中...' : '抓取 README'}
          </button>
        </div>
        {workspace.syncSummary && (
          <div className="mt-4 p-3 rounded-lg bg-success/10 border border-success/20">
            <p className="font-body-md text-sm text-success">
              同步完成：活跃 {workspace.syncSummary.activeCount} 个，新增{' '}
              {workspace.syncSummary.createdCount} 个，更新 {workspace.syncSummary.updatedCount} 个。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

/* === AI 引擎设置 === */
function AISettings({ settingsHook }: { settingsHook: ReturnType<typeof useAppSettings> }) {
  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">AI 引擎配置</h3>
      <div className="space-y-6">
        <div>
          <label className="font-body-md text-on-surface font-medium mb-2 block">AI Provider</label>
          <select className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 font-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary">
            <option value="mock">Mock Provider (本地，无需 API Key)</option>
            <option value="openai">OpenAI (需要 API Key)</option>
            <option value="anthropic">Anthropic Claude (需要 API Key)</option>
          </select>
          <p className="font-body-md text-[13px] text-on-surface-variant mt-2">
            当前使用 Mock Provider，可在本地生成摘要和关键词，无需外部 API。
          </p>
        </div>
        <div className="flex items-center justify-between py-4 border-t border-card-border">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">自动生成 AI 摘要</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              同步 README 后自动调用 AI 引擎生成中文摘要和关键词。
            </p>
          </div>
          <ToggleSwitch
            defaultChecked={settingsHook.settings.ai.enableAutoSummary}
            onChange={(checked) => void settingsHook.updateAI({ enableAutoSummary: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-4 border-t border-card-border">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">AI Provider 模型</h4>
            <p className="font-body-md text-on-surface-variant mt-1">
              指定 AI 引擎使用的模型名称（留空则使用默认 Mock Provider）。
            </p>
          </div>
          <input
            type="text"
            value={settingsHook.settings.ai.model}
            onChange={(e) => void settingsHook.updateAI({ model: e.target.value })}
            placeholder="如 gpt-4o-mini"
            className="w-48 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-1.5 font-body-md text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </section>
  );
}

/* === 通用设置 === */
function GeneralSettings({ settingsHook }: { settingsHook: ReturnType<typeof useAppSettings> }) {
  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">通用设置</h3>
      <div className="space-y-6">
        <div>
          <label className="font-body-md text-on-surface font-medium mb-2 block">品牌色</label>
          <div className="flex gap-2">
            {[
              { name: 'blue', color: 'oklch(0.48 0.14 240)' },
              { name: 'purple', color: 'oklch(0.48 0.14 300)' },
              { name: 'green', color: 'oklch(0.48 0.14 145)' },
              { name: 'orange', color: 'oklch(0.65 0.16 55)' },
              { name: 'pink', color: 'oklch(0.55 0.18 350)' },
              { name: 'teal', color: 'oklch(0.5 0.1 195)' },
            ].map((preset) => (
              <button
                key={preset.name}
                onClick={() => void settingsHook.updateTheme({ brandColor: preset.color })}
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
            <h4 className="font-body-lg font-medium text-on-surface">启动时显示欢迎引导</h4>
            <p className="font-body-md text-on-surface-variant mt-1">首次打开应用时显示欢迎流程。</p>
          </div>
          <ToggleSwitch
            defaultChecked={settingsHook.settings.general.showWelcomeOnStartup}
            onChange={(checked) => void settingsHook.updateGeneral({ showWelcomeOnStartup: checked })}
          />
        </div>
        <div className="flex items-center justify-between py-4 border-t border-card-border">
          <div className="flex-1 pr-6">
            <h4 className="font-body-lg font-medium text-on-surface">自动增量同步</h4>
            <p className="font-body-md text-on-surface-variant mt-1">启动时自动同步新增的 GitHub Stars。</p>
          </div>
          <ToggleSwitch
            defaultChecked={settingsHook.settings.sync.enableAutoSync}
            onChange={(checked) => void settingsHook.updateSync({ enableAutoSync: checked })}
          />
        </div>
      </div>
    </section>
  );
}

/* === 数据备份设置 === */
function BackupSettings({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  return (
    <section className="glass-panel rounded-xl p-6">
      <h3 className="font-headline-md text-[20px] font-semibold text-on-surface mb-6">数据备份与恢复</h3>
      <div className="space-y-6">
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
            disabled={workspace.isExportingAnnotations}
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
            onSubmit={(e) => {
              e.preventDefault();
              void workspace.handleImportAnnotations(e as any);
            }}
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
              disabled={workspace.isImportingAnnotations || !workspace.gistIdDraft.trim()}
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
  defaultChecked = false,
  onChange,
}: {
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        const next = !checked;
        setChecked(next);
        onChange?.(next);
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 shrink-0 ${
        checked ? 'bg-primary' : 'bg-outline-variant'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-on-primary transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
