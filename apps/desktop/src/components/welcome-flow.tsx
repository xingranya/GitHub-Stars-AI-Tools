import { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  Check,
  ChevronRight,
  Database,
  KeyRound,
  Search,
  Sparkles,
} from 'lucide-react';
import { BrandIcon } from '@/components/ui/brand-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GitHubUser, TaskProgressEvent } from '@/types';

type WelcomeFlowProps = {
  onComplete: () => void | Promise<void>;
  onConnectGitHub: (token: string) => Promise<GitHubUser>;
  onSyncStars: () => Promise<void>;
  onFetchReadmes: () => Promise<void>;
  taskProgress: TaskProgressEvent | null;
};

type Step = 'welcome' | 'github' | 'sync' | 'complete';
type GitHubConnectNextStep = 'workspace' | 'sync';

export function WelcomeFlow(props: WelcomeFlowProps) {
  const isMountedRef = useRef(true);
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [isConnectionTakingLonger, setIsConnectionTakingLonger] = useState(false);
  const [connectedUser, setConnectedUser] = useState<GitHubUser | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function completeWelcome(statusMessage?: string) {
    if (isCompleting) {
      return false;
    }

    setIsCompleting(true);
    setErrorMessage(null);
    if (statusMessage) {
      setConnectStatus(statusMessage);
    }

    try {
      await props.onComplete();
      return true;
    } catch (error) {
      setErrorMessage(`进入工作台失败：${toErrorMessage(error)}`);
      setIsCompleting(false);
      return false;
    }
  }

  async function handleGitHubConnect(nextStep: GitHubConnectNextStep = 'workspace') {
    if (isLoading || isCompleting) {
      return;
    }
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setErrorMessage('请输入 GitHub Personal Access Token');
      setSuccessMessage(null);
      setWarningMessage(null);
      setConnectStatus(null);
      setIsConnectionTakingLonger(false);
      return;
    }
    const statusTimers: number[] = [];
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    setConnectStatus('正在验证 GitHub Token...');
    setIsConnectionTakingLonger(false);
    let didLeaveWelcome = false;
    try {
      statusTimers.push(window.setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }
        setConnectStatus('正在保存本地凭据，如果系统弹出凭据管理授权，请选择允许。');
      }, 1200));
      statusTimers.push(window.setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }
        setIsConnectionTakingLonger(true);
        setConnectStatus('连接仍在进行中，可能是 GitHub 网络较慢。你可以先进入工作台，连接会在后台继续。');
      }, 8000));
      const user = await props.onConnectGitHub(trimmedToken);
      if (!isMountedRef.current) {
        return;
      }
      setConnectedUser(user);
      setToken('');
      setSuccessMessage(`GitHub 账号 @${user.login} 已连接。`);
      setConnectStatus(null);
      setIsConnectionTakingLonger(false);
      if (nextStep === 'workspace') {
        didLeaveWelcome = await completeWelcome('连接成功，正在进入工作台...');
        return;
      }
      setCurrentStep('sync');
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      setConnectStatus(null);
      setIsConnectionTakingLonger(false);
      setErrorMessage(toErrorMessage(error));
    } finally {
      statusTimers.forEach(window.clearTimeout);
      if (!didLeaveWelcome && isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }

  async function handleSync() {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setWarningMessage(null);
    try {
      await props.onSyncStars();
      setSuccessMessage('Stars 已同步，正在缓存 README，随后可生成中文定位和标签网络...');
      try {
        await props.onFetchReadmes();
      } catch (error) {
        setWarningMessage(`Stars 已同步，后续处理暂未全部完成：${toErrorMessage(error)}。进入工作台后可在仓库页重新抓取 README、生成 AI 解析，或在标签网络页生成项目标签。`);
      }
      setCurrentStep('complete');
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  const activeStepIndex = getStepIndex(currentStep);
  const visibleTaskProgress = getVisibleWelcomeProgress(currentStep, props.taskProgress)
    ?? getFallbackWelcomeProgress(currentStep, isLoading, connectStatus);

  return (
    <div className="welcome-surface fixed inset-0 z-40 overflow-y-auto bg-background px-4 py-4 sm:px-6 lg:px-8">
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
        <header className="flex flex-col gap-4 border-b border-card-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <BrandIcon title="GitHub-Stars-AI-Tools 应用图标" className="size-12 rounded-xl shadow-sm" />
            <div className="min-w-0">
              <p className="truncate font-headline-md text-lg font-bold text-on-surface">GitHub-Stars-AI-Tools</p>
              <p className="text-sm text-on-surface-variant">GSAT 本地 Stars 知识库</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="lg"
            className="self-start rounded-lg px-0 text-on-surface-variant hover:bg-transparent hover:text-on-surface sm:self-auto sm:px-3"
            type="button"
            disabled={isCompleting}
            onClick={() => void completeWelcome()}
          >
            {isCompleting ? '正在进入工作台…' : '跳过，进入工作台'}
          </Button>
        </header>

        <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          <aside className="welcome-progress-panel border border-card-border bg-card p-4">
            <p className="text-sm font-semibold text-on-surface">初始化进度</p>
            <div className="relative mt-4 grid grid-cols-4 gap-2">
              <div className="absolute left-[12.5%] right-[12.5%] top-5 hidden h-px bg-border sm:block" />
              <div
                className="absolute left-[12.5%] top-5 hidden h-px bg-primary transition-all duration-300 ease-out sm:block"
                style={{ width: `${Math.min(activeStepIndex, 3) * 25}%` }}
              />
              <StepIndicator label="欢迎" icon={<BookMarked className="size-4" />} isActive={currentStep === 'welcome'} isCompleted={currentStep !== 'welcome'} />
              <StepIndicator label="连接" icon={<KeyRound className="size-4" />} isActive={currentStep === 'github'} isCompleted={currentStep === 'sync' || currentStep === 'complete'} />
              <StepIndicator label="同步" icon={<Database className="size-4" />} isActive={currentStep === 'sync'} isCompleted={currentStep === 'complete'} />
              <StepIndicator label="完成" icon={<Check className="size-4" />} isActive={currentStep === 'complete'} isCompleted={false} />
            </div>
          </aside>

          <div className="welcome-card border border-card-border bg-card p-5 sm:p-7 lg:p-8">
          {currentStep === 'welcome' && (
            <section className="welcome-step-panel">
              <div className="welcome-icon-tile mb-6 grid size-12 place-items-center border border-primary/25 bg-primary/10 text-primary">
                <BookMarked className="size-6" />
              </div>
              <h1 className="text-balance font-headline-lg text-2xl font-bold tracking-normal text-on-surface sm:text-3xl">欢迎使用 GitHub-Stars-AI-Tools</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                GSAT 将你的 GitHub Stars 转化为可搜索、可管理的个人知识库
              </p>
              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <FeatureItem icon={<Database className="size-5" />} title="本地优先" description="所有数据存储在本地数据库，完全掌控" />
                <FeatureItem icon={<Search className="size-5" />} title="智能检索" description="支持关键词、上下文搜索和组合筛选" />
                <FeatureItem icon={<Sparkles className="size-5" />} title="AI 增强" description="生成中文定位、关键词和标签网络" />
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="h-11 rounded-lg px-6"
                  type="button"
                  onClick={() => setCurrentStep('github')}
                >
                  开始使用
                  <ChevronRight className="ml-2 size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-11 rounded-lg px-6"
                  type="button"
                  disabled={isCompleting}
                  onClick={() => void completeWelcome()}
                >
                  {isCompleting ? '正在进入工作台…' : '跳过，进入工作台'}
                </Button>
              </div>
            </section>
          )}

          {currentStep === 'github' && (
            <section className="welcome-step-panel">
              <div className="welcome-icon-tile mb-6 grid size-12 place-items-center border border-primary/25 bg-primary/10 text-primary">
                <KeyRound className="size-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-normal">连接 GitHub</h2>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                需要 Personal Access Token 才能同步你的 Stars
              </p>
              <form
                className="mt-8 grid gap-4 text-left"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isLoading) {
                    return;
                  }
                  void handleGitHubConnect('workspace');
                }}
              >
                <div className="border border-border/60 bg-muted/30 p-4">
                  <p className="text-sm font-semibold">如何获取 Token？</p>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>1. 访问 <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" className="text-primary hover:underline">GitHub Token 设置</a></li>
                    <li>2. 同步公开 Stars 可使用只读 Token；如需读取私有仓库 Stars，再授予仓库读取权限</li>
                    <li>3. 如需使用 Gist 备份，再勾选 <code className="rounded-lg bg-muted px-1 py-0.5">gist</code> 权限</li>
                    <li>4. 生成并复制 Token</li>
                  </ol>
                </div>
                <Input
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  placeholder="粘贴 GitHub Token"
                  value={token}
                  className="h-12 rounded-lg border-border/70 bg-background shadow-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Token 仅保存在本机系统凭据管理器，不会上传到任何服务器
                </p>
                {errorMessage && (
                  <p role="alert" className="welcome-message rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {errorMessage}
                  </p>
                )}
                {connectStatus && (
                  <p id="welcome-connect-status" role="status" aria-live="polite" className="welcome-message rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                    {connectStatus}
                  </p>
                )}
                {isConnectionTakingLonger && (
                  <p role="status" aria-live="polite" className="welcome-message rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    连接没有卡住。你可以点击下方“先进入工作台，后台继续连接”，稍后在设置页查看连接结果。
                  </p>
                )}
                {successMessage && (
                  <p role="status" aria-live="polite" className="welcome-message rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                    {successMessage}
                  </p>
                )}
                {visibleTaskProgress && (
                  <WelcomeTaskProgress progress={visibleTaskProgress} />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-lg"
                    type="button"
                    disabled={isLoading}
                    onClick={() => setCurrentStep('welcome')}
                  >
                    返回
                  </Button>
                  <Button
                    size="lg"
                    className="rounded-lg"
                    type="submit"
                    aria-busy={isLoading}
                    aria-describedby={connectStatus ? 'welcome-connect-status' : undefined}
                    disabled={!token.trim() || isLoading || isCompleting}
                  >
                    {isCompleting ? '正在进入工作台…' : isLoading ? '正在验证 Token…' : '验证并进入工作台'}
                    <ChevronRight className="ml-2 size-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-lg sm:col-span-2"
                    type="button"
                    aria-busy={isLoading}
                    aria-describedby={connectStatus ? 'welcome-connect-status' : undefined}
                    disabled={!token.trim() || isLoading || isCompleting}
                    onClick={() => void handleGitHubConnect('sync')}
                  >
                    验证并同步 Stars
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="rounded-lg sm:col-span-2"
                    type="button"
                    disabled={isCompleting}
                    onClick={() => void completeWelcome(isLoading ? '正在进入工作台，GitHub 连接会继续在后台完成。' : undefined)}
                  >
                    {isCompleting ? '正在进入工作台…' : isLoading ? '先进入工作台，后台继续连接' : '暂不连接，进入工作台'}
                  </Button>
                </div>
              </form>
            </section>
          )}

          {currentStep === 'sync' && (
            <section className="welcome-step-panel">
              <div className="welcome-icon-tile mb-6 grid size-12 place-items-center border border-primary/25 bg-primary/10 text-primary">
                <Database className="size-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-normal">同步 Stars</h2>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                首次同步可能需要几分钟，请耐心等待
              </p>
              <div className="mt-8 border border-border/60 bg-muted/30 p-5">
                <p className="text-sm text-muted-foreground">
                  {connectedUser ? `已连接 @${connectedUser.login}。` : ''}
                  连接已完成，即将同步你的 GitHub Stars 到本地数据库，并缓存仓库 README。
                  README 是中文定位和标签网络的上下文；配置 AI 后可以继续生成中文解析和项目标签。
                </p>
              </div>
              {errorMessage && (
                <p role="alert" className="welcome-message mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {errorMessage}
                </p>
              )}
              {successMessage && (
                <p role="status" aria-live="polite" className="welcome-message mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                  {successMessage}
                </p>
              )}
              {warningMessage && (
                <p role="status" aria-live="polite" className="welcome-message mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  {warningMessage}
                </p>
              )}
              {visibleTaskProgress && (
                <WelcomeTaskProgress progress={visibleTaskProgress} />
              )}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 rounded-lg"
                  type="button"
                  disabled={isLoading || isCompleting}
                  onClick={() => void completeWelcome()}
                >
                  {isCompleting ? '正在进入工作台…' : '进入工作台'}
                </Button>
                <Button
                  size="lg"
                  className="flex-1 rounded-lg"
                  type="button"
                  disabled={isLoading}
                  onClick={handleSync}
                >
                  {isLoading ? '同步中…' : '开始同步'}
                  <ChevronRight className="ml-2 size-5" />
                </Button>
              </div>
            </section>
          )}

          {currentStep === 'complete' && (
            <section className="welcome-step-panel">
              <div className="welcome-icon-tile mb-6 grid size-12 place-items-center border border-success/25 bg-success/10 text-success">
                <Check className="size-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-normal">一切就绪</h2>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                你的 Stars 已经同步完成，现在可以开始探索了
              </p>
              <div className="mt-8 grid gap-3 text-left">
                <TipItem number="1" text="使用搜索框查找项目，支持名称、描述、Topics 和笔记" />
                <TipItem number="2" text="为项目生成 AI 解析后，列表会显示更准确的中文定位" />
                <TipItem number="3" text="在标签网络页生成项目标签，再按用途聚类和筛选" />
              </div>
              {warningMessage && (
                <p role="status" aria-live="polite" className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  {warningMessage}
                </p>
              )}
              <Button
                size="lg"
                className="mt-10 h-12 rounded-lg px-8"
                type="button"
                disabled={isCompleting}
                onClick={() => void completeWelcome()}
              >
                {isCompleting ? '正在进入工作台…' : '进入工作台'}
              </Button>
            </section>
          )}
        </div>
        </section>
      </main>
    </div>
  );
}

function getVisibleWelcomeProgress(step: Step, progress: TaskProgressEvent | null) {
  if (!progress) {
    return null;
  }

  if (step === 'github') {
    return progress.taskId === 'connect-github' ? progress : null;
  }

  if (step === 'sync') {
    return ['sync-stars', 'fetch-readmes', 'batch-generate-ai-documents'].includes(progress.taskId)
      ? progress
      : null;
  }

  return null;
}

function getFallbackWelcomeProgress(step: Step, isLoading: boolean, connectStatus: string | null): TaskProgressEvent | null {
  if (step !== 'github' || !isLoading) {
    return null;
  }

  return {
    taskId: 'connect-github',
    taskType: 'auth',
    status: 'running',
    stage: 'auth',
    current: 0,
    total: 2,
    message: connectStatus ?? '正在验证 GitHub Token...',
    repositoryName: null,
  };
}

function toErrorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function WelcomeTaskProgress(props: { progress: TaskProgressEvent }) {
  const progress = props.progress;
  const hasKnownProgress = progress.total > 0;
  const safeCurrent = hasKnownProgress ? Math.min(progress.current, progress.total) : progress.current;
  const percentage = hasKnownProgress
    ? Math.min(100, Math.round((safeCurrent / progress.total) * 100))
    : 0;
  const isFailed = progress.status === 'failed';
  const isPartial = progress.status === 'partial';
  const isRunning = progress.status === 'running';
  const stageLabel = getWelcomeTaskStageLabel(progress.stage);

  return (
    <div
      className={`mt-4 rounded-lg border px-4 py-3 text-left text-sm ${
        isFailed
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : isPartial
            ? 'border-warning/30 bg-warning/10 text-warning'
            : 'border-primary/20 bg-primary/10 text-primary'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {isRunning ? '正在处理' : isFailed ? '任务失败' : isPartial ? '任务部分完成' : '任务完成'}
          </p>
          <p className="mt-1 break-words text-current/85">{progress.message}</p>
          {(stageLabel || progress.repositoryName) && (
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs text-current/80">
              {stageLabel && (
                <span className="rounded-lg bg-background/60 px-2 py-1">
                  阶段：{stageLabel}
                </span>
              )}
              {progress.repositoryName && (
                <span className="max-w-full truncate rounded-lg bg-background/60 px-2 py-1" title={progress.repositoryName}>
                  当前：{progress.repositoryName}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {(hasKnownProgress || isRunning) && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-lg bg-background/70">
            {hasKnownProgress ? (
              <div className="h-full rounded-lg bg-current transition-all" style={{ width: `${percentage}%` }} />
            ) : (
              <div className="task-progress-indeterminate h-full w-1/3 rounded-lg bg-current" />
            )}
          </div>
          <p className="mt-1 text-right text-xs text-current/75">
            {hasKnownProgress ? `${safeCurrent}/${progress.total} · ${percentage}%` : '正在处理...'}
          </p>
        </div>
      )}
    </div>
  );
}

function getWelcomeTaskStageLabel(stage: string) {
  switch (stage) {
    case 'auth':
      return '验证账号';
    case 'queue':
      return '等待调度';
    case 'prepare':
      return '准备数据';
    case 'batch':
      return '批量处理';
    case 'check':
      return '检查仓库';
    case 'plan':
      return '生成计划';
    case 'fetch':
    case 'fetch-readme':
    case 'github-search':
      return '请求数据';
    case 'parse':
      return '解析数据';
    case 'save':
      return '写入本地';
    case 'summarize':
    case 'analyze':
      return 'AI 分析';
    case 'partial-failure':
      return '部分失败';
    case 'done':
      return '已完成';
    case 'error':
      return '失败';
    case 'request':
      return '准备中';
    default:
      return stage ? stage : '';
  }
}

function StepIndicator(props: { label: string; icon: React.ReactNode; isActive: boolean; isCompleted: boolean }) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-2">
      <div
        className={`grid size-10 shrink-0 place-items-center rounded-lg border font-semibold transition-colors duration-200 ${
          props.isCompleted
            ? 'border-success bg-success text-success-foreground'
            : props.isActive
            ? 'border-primary bg-primary text-white'
            : 'border-border bg-card text-muted-foreground'
        }`}
      >
        {props.isCompleted ? <Check className="size-5" /> : props.icon}
      </div>
      <span className={`text-xs font-semibold ${props.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
        {props.label}
      </span>
    </div>
  );
}

function FeatureItem(props: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="group flex items-start gap-4 rounded-lg border border-border/60 bg-muted/20 p-4 text-left transition-colors duration-200 hover:border-primary/35 hover:bg-primary/5">
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
    <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary text-xs font-bold text-white">
        {props.number}
      </span>
      <p className="text-sm text-muted-foreground">{props.text}</p>
    </div>
  );
}

function getStepIndex(step: Step) {
  switch (step) {
    case 'welcome':
      return 0;
    case 'github':
      return 1;
    case 'sync':
      return 2;
    case 'complete':
      return 3;
    default:
      return 0;
  }
}
