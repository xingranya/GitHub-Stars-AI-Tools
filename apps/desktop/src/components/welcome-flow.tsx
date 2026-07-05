import { useState } from 'react';
import { Check, ChevronRight, Rocket, GitBranch, Database, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type WelcomeFlowProps = {
  onComplete: () => void;
  onConnectGitHub: (token: string) => Promise<void>;
  onSyncStars: () => Promise<void>;
  onFetchReadmes: () => Promise<void>;
};

type Step = 'welcome' | 'github' | 'sync' | 'complete';

export function WelcomeFlow(props: WelcomeFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);

  async function handleGitHubConnect() {
    if (!token.trim()) return;
    const statusTimers: number[] = [];
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    setConnectStatus('正在验证 GitHub Token...');
    try {
      statusTimers.push(window.setTimeout(() => {
        setConnectStatus('正在保存本地凭据，如果系统弹出钥匙串授权，请选择允许。');
      }, 1200));
      statusTimers.push(window.setTimeout(() => {
        setConnectStatus('连接仍在进行中，可能是 GitHub 网络较慢，请稍候。');
      }, 8000));
      await props.onConnectGitHub(token);
      setSuccessMessage('GitHub 账号已连接，可以同步 Stars。');
      setConnectStatus(null);
      setCurrentStep('sync');
    } catch (error) {
      setConnectStatus(null);
      setErrorMessage(toErrorMessage(error));
    } finally {
      statusTimers.forEach(window.clearTimeout);
      setIsLoading(false);
    }
  }

  async function handleSync() {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    try {
      await props.onSyncStars();
      setSuccessMessage('Stars 已同步，正在缓存 README...');
      try {
        await props.onFetchReadmes();
      } catch (error) {
        setWarningMessage(`Stars 已同步，README 缓存暂未完成：${toErrorMessage(error)}。进入工作台后可在仓库页重新抓取 README。`);
      }
      setCurrentStep('complete');
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center">
        {/* 进度指示器 */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2 sm:mb-10 sm:gap-3">
          <StepIndicator label="欢迎" isActive={currentStep === 'welcome'} isCompleted={currentStep !== 'welcome'} />
          <div className="hidden h-px w-12 bg-border sm:block lg:w-16" />
          <StepIndicator label="连接" isActive={currentStep === 'github'} isCompleted={currentStep === 'sync' || currentStep === 'complete'} />
          <div className="hidden h-px w-12 bg-border sm:block lg:w-16" />
          <StepIndicator label="同步" isActive={currentStep === 'sync'} isCompleted={currentStep === 'complete'} />
          <div className="hidden h-px w-12 bg-border sm:block lg:w-16" />
          <StepIndicator label="完成" isActive={currentStep === 'complete'} isCompleted={false} />
        </div>

        {/* 内容区域 */}
        <div className="rounded-2xl border bg-card p-5 shadow-lg sm:p-8 lg:p-12">
          {currentStep === 'welcome' && (
            <div className="text-center">
              <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-primary/10 sm:mb-8 sm:size-20">
                <Rocket className="size-8 text-primary sm:size-10" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">欢迎使用 GitHub-Stars-AI-Tools</h1>
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                GSAT 将你的 GitHub Stars 转化为可搜索、可管理的个人知识库
              </p>
              <div className="mt-10 grid gap-4">
                <FeatureItem icon={<GitBranch className="size-5" />} title="本地优先" description="所有数据存储在本地 SQLite，完全掌控" />
                <FeatureItem icon={<Database className="size-5" />} title="智能检索" description="支持关键词、语义搜索和混合模式" />
                <FeatureItem icon={<Sparkles className="size-5" />} title="AI 增强" description="自动生成中文摘要与关键词提取" />
              </div>
              <Button
                size="lg"
                className="mt-10 h-12 rounded-xl px-8 shadow-sm"
                onClick={() => setCurrentStep('github')}
              >
                开始使用
                <ChevronRight className="ml-2 size-5" />
              </Button>
            </div>
          )}

          {currentStep === 'github' && (
            <div className="text-center">
              <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-primary/10 sm:mb-8 sm:size-20">
                <GitBranch className="size-8 text-primary sm:size-10" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">连接 GitHub</h2>
              <p className="mt-3 text-muted-foreground">
                需要 Personal Access Token 才能同步你的 Stars
              </p>
              <div className="mt-8 grid gap-4 text-left">
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-sm font-semibold">如何获取 Token？</p>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>1. 访问 <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" className="text-primary hover:underline">GitHub Token 设置</a></li>
                    <li>2. 勾选 <code className="rounded bg-muted px-1 py-0.5">repo</code> 和 <code className="rounded bg-muted px-1 py-0.5">user</code> 权限用于同步 Stars</li>
                    <li>3. 如需使用 Gist 备份，再勾选 <code className="rounded bg-muted px-1 py-0.5">gist</code> 权限</li>
                    <li>4. 生成并复制 Token</li>
                  </ol>
                </div>
                <Input
                  type="password"
                  placeholder="粘贴 GitHub Token"
                  value={token}
                  className="h-12 rounded-lg shadow-sm"
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGitHubConnect()}
                />
                <p className="text-xs text-muted-foreground">
                  Token 仅保存在本地 Keychain，不会上传到任何服务器
                </p>
                {errorMessage && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {errorMessage}
                  </p>
                )}
                {connectStatus && (
                  <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                    {connectStatus}
                  </p>
                )}
                {successMessage && (
                  <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                    {successMessage}
                  </p>
                )}
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 rounded-xl"
                  disabled={isLoading}
                  onClick={() => setCurrentStep('welcome')}
                >
                  返回
                </Button>
                <Button
                  size="lg"
                  className="flex-1 rounded-xl shadow-sm"
                  disabled={!token.trim() || isLoading}
                  onClick={handleGitHubConnect}
                >
                  {isLoading ? '连接中…' : '连接账号'}
                  <ChevronRight className="ml-2 size-5" />
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'sync' && (
            <div className="text-center">
              <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-primary/10 sm:mb-8 sm:size-20">
                <Database className="size-8 text-primary sm:size-10" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">同步 Stars</h2>
              <p className="mt-3 text-muted-foreground">
                首次同步可能需要几分钟，请耐心等待
              </p>
              <div className="mt-8 rounded-lg bg-muted/30 p-6">
                <p className="text-sm text-muted-foreground">
                  即将同步你的 GitHub Stars 到本地数据库，并缓存仓库 README。
                  同步完成后，你可以开始搜索、筛选、打标签和记笔记。
                </p>
              </div>
              {errorMessage && (
                <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {errorMessage}
                </p>
              )}
              {successMessage && (
                <p className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                  {successMessage}
                </p>
              )}
              {warningMessage && (
                <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  {warningMessage}
                </p>
              )}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 rounded-xl"
                  disabled={isLoading}
                  onClick={props.onComplete}
                >
                  稍后同步
                </Button>
                <Button
                  size="lg"
                  className="flex-1 rounded-xl shadow-sm"
                  disabled={isLoading}
                  onClick={handleSync}
                >
                  {isLoading ? '同步中…' : '开始同步'}
                  <ChevronRight className="ml-2 size-5" />
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'complete' && (
            <div className="text-center">
              <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-success/10 sm:mb-8 sm:size-20">
                <Check className="size-8 text-success sm:size-10" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">一切就绪！</h2>
              <p className="mt-3 text-muted-foreground">
                你的 Stars 已经同步完成，现在可以开始探索了
              </p>
              <div className="mt-8 grid gap-3 text-left">
                <TipItem number="1" text="使用搜索框查找项目，支持名称、描述、Topics 和笔记" />
                <TipItem number="2" text="在知识面板中为项目添加标签和笔记" />
                <TipItem number="3" text="通过 Gist 在多设备间同步注解数据" />
              </div>
              {warningMessage && (
                <p className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  {warningMessage}
                </p>
              )}
              <Button
                size="lg"
                className="mt-10 h-12 rounded-xl px-8 shadow-sm"
                onClick={props.onComplete}
              >
                进入工作台
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function StepIndicator(props: { label: string; isActive: boolean; isCompleted: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`grid size-10 place-items-center rounded-full border-2 font-semibold transition-all ${
          props.isCompleted
            ? 'border-success bg-success text-success-foreground'
            : props.isActive
            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
            : 'border-border text-muted-foreground'
        }`}
      >
        {props.isCompleted ? <Check className="size-5" /> : null}
      </div>
      <span className={`text-xs font-medium ${props.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
        {props.label}
      </span>
    </div>
  );
}

function FeatureItem(props: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border bg-muted/20 p-4 text-left">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        {props.icon}
      </div>
      <div>
        <p className="font-semibold">{props.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
      </div>
    </div>
  );
}

function TipItem(props: { number: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/20 p-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {props.number}
      </span>
      <p className="text-sm text-muted-foreground">{props.text}</p>
    </div>
  );
}
