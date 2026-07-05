import { useState } from 'react';
import { X, Palette, RefreshCw, Sparkles, Globe, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { COLOR_PRESETS } from '@/types-settings';
import type { AppSettings } from '@/types-settings';

type SettingsPanelProps = {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdateTheme: (theme: Partial<AppSettings['theme']>) => void;
  onUpdateSync: (sync: Partial<AppSettings['sync']>) => void;
  onUpdateAI: (ai: Partial<AppSettings['ai']>) => void;
  onUpdateGeneral: (general: Partial<AppSettings['general']>) => void;
  onResetSettings: () => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'theme' | 'sync' | 'ai' | 'general'>('theme');

  if (!props.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="flex h-[680px] w-[920px] overflow-hidden rounded-2xl border bg-background shadow-lg">
        {/* 侧边导航 */}
        <aside className="w-56 border-r bg-muted/20 p-4">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight">设置</h2>
            <p className="mt-1 text-xs text-muted-foreground">偏好设置与配置</p>
          </div>
          <nav className="grid gap-1">
            <TabButton
              icon={<Palette className="size-4" />}
              label="外观"
              isActive={activeTab === 'theme'}
              onClick={() => setActiveTab('theme')}
            />
            <TabButton
              icon={<RefreshCw className="size-4" />}
              label="同步"
              isActive={activeTab === 'sync'}
              onClick={() => setActiveTab('sync')}
            />
            <TabButton
              icon={<Sparkles className="size-4" />}
              label="AI"
              isActive={activeTab === 'ai'}
              onClick={() => setActiveTab('ai')}
            />
            <TabButton
              icon={<Globe className="size-4" />}
              label="通用"
              isActive={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
            />
          </nav>
          <Separator className="my-4" />
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start rounded-lg"
            onClick={props.onResetSettings}
          >
            <RotateCcw className="size-4" />
            重置为默认
          </Button>
        </aside>

        {/* 内容区域 */}
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b px-6">
            <h3 className="text-sm font-semibold">
              {activeTab === 'theme' && '外观设置'}
              {activeTab === 'sync' && '同步设置'}
              {activeTab === 'ai' && 'AI 设置'}
              {activeTab === 'general' && '通用设置'}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              onClick={props.onClose}
            >
              <X className="size-4" />
            </Button>
          </header>

          <ScrollArea className="flex-1 p-6">
            {activeTab === 'theme' && <ThemeSettings settings={props.settings} onUpdate={props.onUpdateTheme} />}
            {activeTab === 'sync' && <SyncSettings settings={props.settings} onUpdate={props.onUpdateSync} />}
            {activeTab === 'ai' && <AISettings settings={props.settings} onUpdate={props.onUpdateAI} />}
            {activeTab === 'general' && <GeneralSettings settings={props.settings} onUpdate={props.onUpdateGeneral} />}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function TabButton(props: { icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all ${
        props.isActive
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      onClick={props.onClick}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function ThemeSettings(props: { settings: AppSettings; onUpdate: (theme: Partial<AppSettings['theme']>) => void }) {
  const { theme } = props.settings;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="text-sm font-semibold">品牌色</label>
        <div className="grid grid-cols-6 gap-3">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className={`group relative flex h-20 flex-col items-center justify-center gap-2 rounded-xl border-2 transition-all hover:scale-105 ${
                theme.colorPreset === preset.name
                  ? 'border-primary shadow-lg'
                  : 'border-transparent hover:border-muted-foreground/20'
              }`}
              onClick={() => props.onUpdate({ colorPreset: preset.name, brandColor: preset.color })}
            >
              <span
                className="size-8 rounded-lg shadow-sm"
                style={{ backgroundColor: preset.color }}
              />
              <span className="text-xs font-medium">{preset.label}</span>
              {theme.colorPreset === preset.name && (
                <div className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <label className="text-sm font-semibold" htmlFor="custom-color">
          自定义颜色
        </label>
        <div className="flex gap-3">
          <Input
            id="custom-color"
            type="color"
            value={theme.brandColor}
            className="h-12 w-20 cursor-pointer rounded-lg p-1 shadow-sm"
            onChange={(e) => props.onUpdate({ brandColor: e.target.value, colorPreset: 'custom' })}
          />
          <Input
            type="text"
            value={theme.brandColor}
            placeholder="#3b82f6"
            className="flex-1 rounded-lg shadow-sm"
            onChange={(e) => props.onUpdate({ brandColor: e.target.value, colorPreset: 'custom' })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          支持 16 进制颜色代码，例如 #3b82f6
        </p>
      </div>

      <Separator />

      <div className="grid gap-3">
        <label className="text-sm font-semibold">字体大小</label>
        <Select
          value={theme.fontSize}
          onValueChange={(value) => props.onUpdate({ fontSize: value as AppSettings['theme']['fontSize'] })}
        >
          <SelectTrigger className="h-10 rounded-lg shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="small">小</SelectItem>
            <SelectItem value="medium">中（推荐）</SelectItem>
            <SelectItem value="large">大</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SyncSettings(props: { settings: AppSettings; onUpdate: (sync: Partial<AppSettings['sync']>) => void }) {
  const { sync } = props.settings;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="flex items-center justify-between text-sm font-semibold">
          自动同步
          <input
            type="checkbox"
            checked={sync.enableAutoSync}
            className="size-4 rounded accent-primary"
            onChange={(e) => props.onUpdate({ enableAutoSync: e.target.checked })}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          启用后将按设定间隔自动同步 GitHub Stars
        </p>
      </div>

      {sync.enableAutoSync && (
        <div className="grid gap-3">
          <label className="text-sm font-semibold">同步间隔（分钟）</label>
          <Input
            type="number"
            min="5"
            max="1440"
            value={sync.autoSyncInterval}
            className="rounded-lg shadow-sm"
            onChange={(e) => props.onUpdate({ autoSyncInterval: parseInt(e.target.value) || 30 })}
          />
          <p className="text-xs text-muted-foreground">
            建议设置为 30 分钟或更长，避免频繁请求
          </p>
        </div>
      )}

      <Separator />

      <div className="grid gap-3">
        <label className="text-sm font-semibold" htmlFor="default-gist">
          默认 Gist ID
        </label>
        <Input
          id="default-gist"
          type="text"
          value={sync.defaultGistId}
          placeholder="保存后自动填入导入框"
          className="rounded-lg shadow-sm"
          onChange={(e) => props.onUpdate({ defaultGistId: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          设置常用的 Gist ID，方便快速导入注解
        </p>
      </div>
    </div>
  );
}

function AISettings(props: { settings: AppSettings; onUpdate: (ai: Partial<AppSettings['ai']>) => void }) {
  const { ai } = props.settings;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="text-sm font-semibold">AI Provider</label>
        <Select
          value={ai.provider}
          onValueChange={(value) => props.onUpdate({ provider: value as AppSettings['ai']['provider'] })}
        >
          <SelectTrigger className="h-10 rounded-lg shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未配置</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="local">本地模型</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {ai.provider !== 'none' && (
        <>
          <div className="grid gap-3">
            <label className="text-sm font-semibold" htmlFor="api-key">
              API Key
            </label>
            <Input
              id="api-key"
              type="password"
              value={ai.apiKey}
              placeholder="输入 API Key"
              className="rounded-lg shadow-sm"
              onChange={(e) => props.onUpdate({ apiKey: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              API Key 仅保存在本地，不会上传到任何服务器
            </p>
          </div>

          <div className="grid gap-3">
            <label className="text-sm font-semibold" htmlFor="model">
              模型
            </label>
            <Input
              id="model"
              type="text"
              value={ai.model}
              placeholder="例如：gpt-4, claude-3-sonnet"
              className="rounded-lg shadow-sm"
              onChange={(e) => props.onUpdate({ model: e.target.value })}
            />
          </div>

          <Separator />

          <div className="grid gap-3">
            <label className="flex items-center justify-between text-sm font-semibold">
              自动生成摘要
              <input
                type="checkbox"
                checked={ai.enableAutoSummary}
                className="size-4 rounded accent-primary"
                onChange={(e) => props.onUpdate({ enableAutoSummary: e.target.checked })}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              抓取 README 后自动调用 AI 生成中文摘要
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function GeneralSettings(props: { settings: AppSettings; onUpdate: (general: Partial<AppSettings['general']>) => void }) {
  const { general } = props.settings;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="text-sm font-semibold">语言</label>
        <Select
          value={general.language}
          onValueChange={(value) => props.onUpdate({ language: value as AppSettings['general']['language'] })}
        >
          <SelectTrigger className="h-10 rounded-lg shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">简体中文</SelectItem>
            <SelectItem value="en-US">English</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="grid gap-3">
        <label className="flex items-center justify-between text-sm font-semibold">
          启动时显示欢迎页
          <input
            type="checkbox"
            checked={general.showWelcomeOnStartup}
            className="size-4 rounded accent-primary"
            onChange={(e) => props.onUpdate({ showWelcomeOnStartup: e.target.checked })}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          首次启动或未连接 GitHub 时显示引导流程
        </p>
      </div>

      <Separator />

      <div className="grid gap-3">
        <label className="text-sm font-semibold">数据目录</label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={general.dataDirectory || '默认位置'}
            readOnly
            className="flex-1 rounded-lg bg-muted shadow-sm"
          />
          <Button variant="outline" className="rounded-lg shadow-sm">
            选择
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          SQLite 数据库和缓存文件的存储位置
        </p>
      </div>
    </div>
  );
}
