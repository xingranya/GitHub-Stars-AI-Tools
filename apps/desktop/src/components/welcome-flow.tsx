import { useState } from 'react';
import { Check, ChevronRight, Rocket, Github as GitHub, Database, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type WelcomeFlowProps = {
  onComplete: () => void;
  onConnectGitHub: (token: string) => Promise<void>;
  onSyncStars: () => Promise<void>;
};

type Step = 'welcome' | 'github' | 'sync' | 'complete';

export function WelcomeFlow(props: WelcomeFlowProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleGitHubConnect() {
    if (!token.trim()) return;
    setIsLoading(true);
    try {
      await props.onConnectGitHub(token);
      setCurrentStep('sync');
    } catch (error) {
      console.error('GitHub connection failed:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSync() {
    setIsLoading(true);
    try {
      await props.onSyncStars();
      setCurrentStep('complete');
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-2xl px-8">
        {/* 进度指示器 */}
        <div className="mb-12 flex items-center justify-center gap-3">
          <StepIndicator label="欢迎" isActive={currentStep === 'welcome'} isCompleted={currentStep !== 'welcome'} />
          <div className="h-px w-16 bg-border" />
          <StepIndicator label="连接" isActive={currentStep === 'github'} isCompleted={currentStep === 'sync' || currentStep === 'complete'} />
          <div className="h-px w-16 bg-border" />
          <StepIndicator label="同步" isActive={currentStep === 'sync'} isCompleted={currentStep === 'complete'} />
          <div className="h-px w-16 bg-border" />
          <StepIndicator label="完成" isActive={currentStep === 'complete'} isCompleted={false} />
        </div>

        {/* 内容区域 */}
        <div className="rounded-2xl border bg-card p-12 shadow-lg">
          {currentStep === 'welcome' && (
            <div className="text-center">
              <div className="mx-auto mb-8 grid size-20 place-items-center rounded-2xl bg-primary/10">
                <Rocket className="size-10 text-primary" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">欢迎使用 Stars Knowledge</h1>
              <p className="mt-4 text-lg text-muted-foreground">
                将你的 GitHub Stars 转化为可搜索、可管理的个人知识库
              </p>
              <div className="mt-10 grid gap-4">
                <FeatureItem icon={<GitHub className="size-5" />} title="本地优先" description="所有数据存储在本地 SQLite，完全掌控" />
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
              <div className="mx-auto mb-8 grid size-20 place-items-center rounded-2xl bg-primary/10">
                <GitHub className="size-10 text-primary" />
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
                    <li>2. 勾选 <code className="rounded bg-muted px-1 py-0.5">repo</code> 和 <code className="rounded bg-muted px-1 py-0.5">user</code> 权限</li>
                    <li>3. 生成并复制 Token</li>
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
              </div>
              <div className="mt-8 flex gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 rounded-xl"
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
                  {isLoading ? '验证中…' : '连接账号'}
                  <ChevronRight className="ml-2 size-5" />
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'sync' && (
            <div className="text-center">
              <div className="mx-auto mb-8 grid size-20 place-items-center rounded-2xl bg-primary/10">
                <Database className="size-10 text-primary" />
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
              <div className="mt-8 flex gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 rounded-xl"
                  disabled={isLoading}
                  onClick={() => setCurrentStep('github')}
                >
                  返回
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
              <div className="mx-auto mb-8 grid size-20 place-items-center rounded-2xl bg-success/10">
                <Check className="size-10 text-success" />
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
