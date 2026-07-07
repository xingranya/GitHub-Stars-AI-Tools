import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = new URL('..', import.meta.url).pathname;
const appSource = readFileSync(join(projectRoot, 'src', 'App.tsx'), 'utf8');
const welcomeSource = readFileSync(join(projectRoot, 'src', 'components', 'welcome-flow.tsx'), 'utf8');
const workspaceSource = readFileSync(join(projectRoot, 'src', 'hooks', 'use-stars-workspace.ts'), 'utf8');
const settingsSource = readFileSync(join(projectRoot, 'src', 'pages', 'settings.tsx'), 'utf8');
const connectionPanelSource = readFileSync(join(projectRoot, 'src', 'features', 'sidebar', 'connection-panel.tsx'), 'utf8');
const tauriAuthSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'auth.rs'), 'utf8');
const libSource = readFileSync(join(projectRoot, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const stylesSource = readFileSync(join(projectRoot, 'src', 'styles.css'), 'utf8');

assert.match(
  welcomeSource,
  /const trimmedToken = token\.trim\(\)[\s\S]*?await props\.onConnectGitHub\(trimmedToken\)/,
  '初始化页必须直接提交输入框中的 trim 后 token，不能依赖异步 state 转发或把空白传给后端',
);
assert.match(
  appSource,
  /async function handleWelcomeConnect\(token: string\)[\s\S]*?return workspace\.connectWithToken\(token\)/,
  'WelcomeFlow 必须连接到 workspace.connectWithToken(token)，并把已验证用户返回给欢迎页展示',
);
assert.match(
  appSource,
  /if \(workspace\.isLoadingAuth\) \{[\s\S]*?正在检查 GitHub 连接\.\.\.[\s\S]*?\}/,
  '应用启动恢复 GitHub 凭据期间必须显示明确加载态，不能先露出未连接主界面',
);
assert.match(
  libSource,
  /const GITHUB_AUTH_STATE_TOTAL_TIMEOUT_SECONDS: u64 = 25;/,
  '启动恢复 GitHub 凭据必须有整体超时，避免一直停在正在检查 GitHub 连接',
);
assert.match(
  libSource,
  /async fn get_github_auth_state\([\s\S]*?tokio::time::timeout\([\s\S]*?Duration::from_secs\(GITHUB_AUTH_STATE_TOTAL_TIMEOUT_SECONDS\)[\s\S]*?auth_state_task[\s\S]*?\)[\s\S]*?\.await/,
  '启动恢复 GitHub 凭据必须异步执行并受整体超时保护',
);
assert.match(
  libSource,
  /Err\(_\) => \{[\s\S]*?timeout_guard\.store\(true, Ordering::SeqCst\)[\s\S]*?restore_cached_github_auth_state\(&storage\)/,
  '启动认证超时时必须回退本地缓存账号，不能阻断进入本地工作台',
);
assert.match(
  appSource,
  /const \[hasDismissedWelcome, setHasDismissedWelcome\] = useState\(false\)/,
  '欢迎页完成后必须记录本轮已关闭状态，避免设置异步保存期间重复弹回',
);
assert.match(
  appSource,
  /const shouldShowWelcome = showWelcome \|\| \([\s\S]*?!isWelcomeDecisionPending[\s\S]*?!hasDismissedWelcome[\s\S]*?!workspace\.authState\.user[\s\S]*?settingsHook\.settings\.general\.showWelcomeOnStartup[\s\S]*?\)/,
  '无 Token 首启时欢迎页显示条件必须同步派生，不能等 effect 下一拍后才显示',
);
assert.match(
  appSource,
  /async function handleWelcomeComplete\(\) \{[\s\S]*?await settingsHook\.updateGeneral\(\{ showWelcomeOnStartup: false \}\);[\s\S]*?setHasDismissedWelcome\(true\);[\s\S]*?setShowWelcome\(false\);/,
  '完成欢迎页必须等待欢迎页偏好写入后再关闭引导，避免下次启动重复进入初始化页',
);
assert.match(
  appSource,
  /if \(shouldShowWelcome\) \{[\s\S]*?<WelcomeFlow/,
  'App 渲染欢迎页必须使用同步派生的 shouldShowWelcome，避免首屏闪过主界面',
);
assert.match(
  workspaceSource,
  /async function connectWithToken\(rawToken: string\)[\s\S]*?invoke<GitHubUser>\('save_github_token', \{ token: trimmed \}\)/,
  'connectWithToken 必须用传入 token 调用 save_github_token',
);
assert.match(
  workspaceSource,
  /async function connectWithToken\(rawToken: string\)[\s\S]*?setTaskProgress\(buildRunningTaskProgress\([\s\S]*?'connect-github'[\s\S]*?'auth'[\s\S]*?'正在验证 GitHub Token'/,
  'connectWithToken 必须在调用后端前立刻显示连接进度，避免用户点击后以为无反应',
);
assert.match(
  workspaceSource,
  /async function connectWithToken\(rawToken: string\)[\s\S]*?setAuthMessage\('GitHub 账号已连接，可以同步 Stars。'\);[\s\S]*?setTaskProgress\(buildSucceededTaskProgress\('connect-github', 'auth', `GitHub 账号 @\$\{user\.login\} 已连接。`\)\);[\s\S]*?return user;/,
  'connectWithToken 连接成功后必须返回真实 GitHub 用户，供初始化页展示账号反馈',
);
assert.match(
  workspaceSource,
  /catch \(reason\) \{[\s\S]*?const message = toErrorMessage\(reason\);[\s\S]*?setError\(message\);[\s\S]*?setTaskProgress\(buildFailedTaskProgress\('connect-github', 'auth', message\)\)/,
  'GitHub 连接失败必须同步更新全局错误和连接任务失败进度',
);
assert.match(
  welcomeSource,
  /setConnectStatus\('正在验证 GitHub Token\.\.\.'\)/,
  '初始化页连接过程必须显示可见状态，避免用户以为点击无反应',
);
assert.match(
  welcomeSource,
  /const \[isCompleting, setIsCompleting\] = useState\(false\)/,
  '初始化页进入工作台必须有独立完成态，避免重复点击造成看起来无反应',
);
assert.match(
  welcomeSource,
  /const \[isConnectionTakingLonger, setIsConnectionTakingLonger\] = useState\(false\)/,
  '初始化页必须跟踪 GitHub 连接慢状态，避免用户把长耗时误判为点击无反应',
);
assert.match(
  welcomeSource,
  /setIsConnectionTakingLonger\(true\);[\s\S]*?setConnectStatus\('连接仍在进行中，可能是 GitHub 网络较慢。你可以先进入工作台，连接会在后台继续。'\)/,
  '初始化页连接较慢时必须明确告诉用户可以先进入工作台',
);
assert.match(
  welcomeSource,
  /async function completeWelcome\(statusMessage\?: string\)[\s\S]*?setIsCompleting\(true\)[\s\S]*?await props\.onComplete\(\)[\s\S]*?进入工作台失败/,
  '初始化页关闭或进入工作台必须走受保护完成函数，失败时留在当前页展示原因',
);
assert.match(
  welcomeSource,
  /didLeaveWelcome = await completeWelcome\('连接成功，正在进入工作台\.\.\.'\)/,
  'Token 验证成功后必须显示正在进入工作台，并等待完成动作结果',
);
assert.match(
  welcomeSource,
  /role="alert"[\s\S]*?\{errorMessage\}/,
  '初始化页连接错误必须进入 alert 区域，避免失败时没有明确反馈',
);
assert.match(
  welcomeSource,
  /role="status" aria-live="polite"[\s\S]*?\{connectStatus\}/,
  '初始化页连接等待状态必须进入 live status 区域，避免点击后看起来无变化',
);
assert.match(
  welcomeSource,
  /isConnectionTakingLonger && \([\s\S]*?连接没有卡住。你可以点击下方“先进入工作台，后台继续连接”/,
  '初始化页连接较慢时必须显示独立提示，解释当前请求仍在进行中且可先进入工作台',
);
assert.match(
  welcomeSource,
  /<form[\s\S]*?onSubmit=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(isLoading\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?handleGitHubConnect\('workspace'\)/,
  '初始化页 GitHub Token 必须由表单提交承接，点击按钮和回车都要进入同一条真实连接链路',
);
assert.match(
  welcomeSource,
  /type="submit"[\s\S]*?aria-busy=\{isLoading\}[\s\S]*?disabled=\{!token\.trim\(\) \|\| isLoading \|\| isCompleting\}[\s\S]*?isCompleting \? '正在进入工作台…' : isLoading \? '正在验证 Token…' : '验证并进入工作台'/,
  '初始化页主连接按钮提交后必须禁用并显示正在验证 Token，避免用户误以为点击无反应',
);
assert.match(
  welcomeSource,
  /isCompleting \? '正在进入工作台…' : isLoading \? '先进入工作台，后台继续连接' : '暂不连接，进入工作台'/,
  '初始化页连接中必须保留独立的先进入工作台按钮，不能把跳过动作混在主提交按钮里',
);
assert.match(
  tauriAuthSource,
  /const GITHUB_CONNECT_VERIFY_TIMEOUT_SECONDS: u64 = 15;/,
  '初始化页 GitHub Token 验证必须使用短超时，避免点击继续后长时间无反馈',
);
assert.match(
  tauriAuthSource,
  /const GITHUB_CONNECT_VERIFY_MAX_ATTEMPTS: usize = 1;/,
  '初始化页 GitHub Token 验证不能使用多轮后台重试，失败应尽快返回可见错误',
);
assert.match(
  libSource,
  /const GITHUB_CONNECT_TOTAL_TIMEOUT_SECONDS: u64 = 25;/,
  '初始化页 GitHub 连接必须有整体超时，避免系统凭据管理器或网络卡住时一直无反馈',
);
assert.match(
  libSource,
  /tokio::time::timeout\([\s\S]*?Duration::from_secs\(GITHUB_CONNECT_TOTAL_TIMEOUT_SECONDS\)[\s\S]*?save_task[\s\S]*?\)[\s\S]*?\.await/,
  '后端保存 GitHub Token 必须用整体超时包住验证和系统凭据写入',
);
assert.match(
  libSource,
  /Err\(_\) => \{[\s\S]*?timeout_guard\.store\(true, Ordering::SeqCst\)[\s\S]*?GitHub 连接超时[\s\S]*?TaskProgressEvent::failed\("connect-github", "auth", message\.clone\(\)\)[\s\S]*?Err\(message\)/,
  'GitHub 连接整体超时时必须发出失败任务进度并返回可见错误',
);
assert.match(
  libSource,
  /fn save_github_token_worker\([\s\S]*?timeout_guard: Arc<AtomicBool>[\s\S]*?auth::save_github_token\(token\)\?;[\s\S]*?if timeout_guard\.load\(Ordering::SeqCst\) \{[\s\S]*?return Ok\(user\);[\s\S]*?\}[\s\S]*?TaskProgressEvent::running\([\s\S]*?"save"/,
  'GitHub 连接超时后，后台凭据调用晚到时不能再发保存或成功进度覆盖失败状态',
);
assert.match(
  tauriAuthSource,
  /pub fn save_github_token\(token: String\)[\s\S]*?verify_github_token_for_connect\(&token\)/,
  '保存 GitHub Token 必须先走首次连接专用快速校验',
);
assert.match(
  tauriAuthSource,
  /fn verify_github_token_for_connect\(token: &str\)[\s\S]*?GITHUB_CONNECT_VERIFY_TIMEOUT_SECONDS[\s\S]*?GITHUB_CONNECT_VERIFY_MAX_ATTEMPTS/,
  '首次连接专用校验必须实际使用短超时和单次尝试配置',
);
assert.match(
  appSource,
  /taskProgress=\{workspace\.taskProgress\}/,
  '欢迎页必须接收 workspace 任务进度，连接、同步和 README 缓存都要可见',
);
assert.match(
  welcomeSource,
  /const visibleTaskProgress = getVisibleWelcomeProgress\(currentStep, props\.taskProgress\)/,
  '欢迎页必须按当前步骤过滤任务进度，避免连接成功后旧进度卡残留到同步步骤',
);
assert.match(
  welcomeSource,
  /const visibleTaskProgress = getVisibleWelcomeProgress\(currentStep, props\.taskProgress\)[\s\S]*?\?\? getFallbackWelcomeProgress\(currentStep, isLoading, connectStatus\)/,
  '初始化页连接 GitHub 时必须在后端任务事件到达前提供本地兜底进度，避免点击后看起来无反应',
);
assert.match(
  welcomeSource,
  /function getFallbackWelcomeProgress\(step: Step, isLoading: boolean, connectStatus: string \| null\): TaskProgressEvent \| null[\s\S]*?taskId: 'connect-github'[\s\S]*?status: 'running'[\s\S]*?stage: 'auth'[\s\S]*?message: connectStatus \?\? '正在验证 GitHub Token\.\.\.'/,
  '初始化页本地兜底进度必须明确标记 connect-github/auth/running 并展示当前连接状态',
);
assert.match(
  welcomeSource,
  /function getVisibleWelcomeProgress\(step: Step, progress: TaskProgressEvent \| null\)[\s\S]*?step === 'github'[\s\S]*?progress\.taskId === 'connect-github'/,
  '初始化连接步骤必须展示 connect-github 进度卡',
);
assert.match(
  welcomeSource,
  /case 'auth':[\s\S]*?return '验证账号';/,
  '初始化页必须识别账号验证阶段，避免连接请求已提交但用户看不到阶段说明',
);
assert.match(
  libSource,
  /async fn save_github_token\([\s\S]*?TaskProgressEvent::running\([\s\S]*?"connect-github"[\s\S]*?"auth"[\s\S]*?"正在验证 GitHub Token"[\s\S]*?run_immediate_blocking_task_with_failure_progress\([\s\S]*?"connect-github"[\s\S]*?"auth"/,
  '后端保存 GitHub Token 必须立即进入验证并接入任务进度和失败事件',
);
assert.doesNotMatch(
  libSource,
  /async fn save_github_token\([\s\S]*?run_background_task_with_failure_progress\([\s\S]*?"connect-github"[\s\S]*?"auth"/,
  'GitHub Token 首次连接不能进入批量任务 FIFO 队列，避免前面有长任务时点击后无反应',
);
assert.match(
  libSource,
  /fn save_github_token_worker\([\s\S]*?TaskProgressEvent::running\([\s\S]*?"connect-github"[\s\S]*?"正在验证 GitHub Token"[\s\S]*?TaskProgressEvent::running\([\s\S]*?"connect-github"[\s\S]*?"正在写入本地账号缓存"[\s\S]*?TaskProgressEvent::succeeded\([\s\S]*?"connect-github"/,
  '后端 GitHub 连接任务必须发出验证、写库和成功进度',
);
assert.match(
  libSource,
  /fn save_github_token_worker\([\s\S]*?AppStorage::from_app_handle\(&app_handle\)[\s\S]*?map_err\(clear_github_token_after_account_cache_failure\)[\s\S]*?upsert_github_account\(&user\)[\s\S]*?map_err\(clear_github_token_after_account_cache_failure\)/,
  '后端 Token 已写入但账号缓存失败时必须清理本机凭据，避免界面失败但凭据残留',
);
assert.match(
  libSource,
  /fn clear_github_token_after_account_cache_failure\(error: String\) -> String[\s\S]*?auth::clear_github_token\(\)[\s\S]*?已清理本机凭据/,
  '账号缓存失败的清理错误必须返回可读说明',
);
assert.match(
  settingsSource,
  /async function handleGitHubConnectSubmit\(event: FormEvent<HTMLFormElement>\)[\s\S]*?setConnectStatus\('正在验证 GitHub Token\.\.\.'\)/,
  '设置页连接 GitHub 时必须显示可见状态，避免用户以为点击无反应',
);
assert.match(
  settingsSource,
  /setConnectStatus\('正在保存本地凭据，如果系统弹出凭据管理授权，请选择允许。'\)/,
  '设置页连接 GitHub 时必须提示系统凭据管理器授权等待',
);
assert.match(
  settingsSource,
  /setConnectStatus\('连接仍在进行中，可能是 GitHub 网络较慢，请稍候。'\)/,
  '设置页连接 GitHub 网络较慢时必须继续展示明确等待状态',
);
assert.match(
  settingsSource,
  /onSubmit=\{\(event\) => void handleGitHubConnectSubmit\(event\)\}/,
  '设置页 Token 表单必须走受保护的连接提交函数',
);
assert.match(
  welcomeSource,
  /支持关键词、上下文搜索和组合筛选/,
  '欢迎页必须描述当前真实可用的检索能力，不能使用尚未落地的泛化能力文案',
);
assert.match(
  welcomeSource,
  /welcome-surface[\s\S]*?welcome-progress-panel[\s\S]*?GitHub-Stars-AI-Tools/,
  '欢迎页必须使用正式品牌和初始化进度区域，不能只是基础表单卡片',
);
assert.match(
  welcomeSource,
  /BookMarked[\s\S]*?KeyRound[\s\S]*?Search[\s\S]*?Sparkles/,
  '欢迎页图标必须覆盖知识库、凭据、搜索和数据能力',
);
assert.doesNotMatch(
  welcomeSource,
  /welcome-showcase|welcome-orbit|welcome-orbit-node|welcomeFloat/,
  '欢迎页不能再使用漂浮节点或玻璃展示区，避免 AI 化视觉',
);
assert.match(
  welcomeSource,
  /welcome-step-panel/,
  '欢迎页每个步骤内容必须有进入动效容器',
);
assert.match(
  welcomeSource,
  /style=\{\{ width: `\$\{Math\.min\(activeStepIndex, 3\) \* 25\}%` \}\}/,
  '欢迎页步骤进度线必须随当前步骤动态变化',
);
assert.match(
  welcomeSource,
  /同步公开 Stars 可使用只读 Token；如需读取私有仓库 Stars，再授予仓库读取权限/,
  '欢迎页 Token 指引必须采用最小权限口径',
);
assert.match(
  welcomeSource,
  /currentStep === 'welcome'[\s\S]*?onClick=\{\(\) => void completeWelcome\(\)\}[\s\S]*?跳过，进入工作台/,
  '欢迎页第一屏必须提供跳过入口，允许用户直接进入工作台',
);
assert.match(
  welcomeSource,
  /currentStep === 'welcome'[\s\S]*?variant="ghost"[\s\S]*?disabled=\{isCompleting\}[\s\S]*?onClick=\{\(\) => void completeWelcome\(\)\}[\s\S]*?跳过，进入工作台/,
  '欢迎页第一屏跳过入口必须在连接中仍可使用，避免网络或凭据授权较慢时用户被锁死',
);
assert.match(
  welcomeSource,
  /<header[\s\S]*?disabled=\{isCompleting\}[\s\S]*?onClick=\{\(\) => void completeWelcome\(\)\}[\s\S]*?跳过，进入工作台/,
  '欢迎页顶部跳过入口必须在连接中仍可使用，避免 GitHub 网络慢时界面像无反应',
);
assert.match(
  welcomeSource,
  /currentStep === 'github'[\s\S]*?onClick=\{\(\) => void completeWelcome\(isLoading \? '正在进入工作台，GitHub 连接会继续在后台完成。' : undefined\)\}[\s\S]*?先进入工作台，后台继续连接[\s\S]*?暂不连接，进入工作台/,
  '欢迎页连接 GitHub 步骤必须提供可恢复的进入工作台入口，连接中也不能把用户锁在初始化页',
);
assert.match(
  welcomeSource,
  /currentStep === 'sync'[\s\S]*?onClick=\{\(\) => void completeWelcome\(\)\}[\s\S]*?进入工作台/,
  '欢迎页同步步骤必须提供进入工作台入口，连接成功后不能把用户卡在初始化流程',
);
assert.doesNotMatch(
  `${welcomeSource}\n${settingsSource}`,
  /repo<\/code> 和 <code className="rounded bg-muted px-1 py-0.5">user|repo 和 user 权限/,
  'GitHub Token 指引不能要求过宽的 repo + user 权限',
);
assert.doesNotMatch(
  welcomeSource,
  /语义搜索和混合模式/,
  '欢迎页不能把本地知识召回包装成尚未落地的语义搜索或混合模式',
);
assert.match(
  welcomeSource,
  /const user = await props\.onConnectGitHub\(trimmedToken\)[\s\S]*?setConnectedUser\(user\)[\s\S]*?setSuccessMessage\(`GitHub 账号 @\$\{user\.login\} 已连接。`\)[\s\S]*?if \(nextStep === 'workspace'\) \{[\s\S]*?didLeaveWelcome = await completeWelcome\('连接成功，正在进入工作台\.\.\.'\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?setCurrentStep\('sync'\)/,
  '初始化页连接成功后必须默认进入工作台，并保留可选同步步骤',
);
assert.match(
  welcomeSource,
  /finally \{[\s\S]*?statusTimers\.forEach\(window\.clearTimeout\);[\s\S]*?if \(!didLeaveWelcome && isMountedRef\.current\) \{[\s\S]*?setIsLoading\(false\);[\s\S]*?\}[\s\S]*?\}/,
  '初始化页进入工作台失败或被打断时必须在组件仍挂载时恢复连接按钮，不能永久停在连接中',
);
assert.doesNotMatch(
  welcomeSource,
  /if \(nextStep === 'workspace'\) \{[\s\S]*?didLeaveWelcome = true;[\s\S]*?await props\.onComplete\(\)/,
  '初始化页不能在真正关闭欢迎页前提前锁定离开状态，否则关闭失败会卡住加载态',
);
assert.match(
  welcomeSource,
  /const user = await props\.onConnectGitHub\(trimmedToken\)[\s\S]*?setToken\(''\)[\s\S]*?setSuccessMessage\(`GitHub 账号 @\$\{user\.login\} 已连接。`\)/,
  '初始化页连接成功后必须清空本地 Token 输入框，避免明文继续留在 React state',
);
assert.match(
  welcomeSource,
  /async function handleGitHubConnect\(nextStep: GitHubConnectNextStep = 'workspace'\)[\s\S]*?if \(isLoading \|\| isCompleting\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?const trimmedToken = token\.trim\(\)[\s\S]*?if \(!trimmedToken\) \{[\s\S]*?setErrorMessage\('请输入 GitHub Personal Access Token'\)[\s\S]*?return;[\s\S]*?\}/,
  '初始化页连接函数必须拒绝加载中重复提交，并对空 Token 给出可见提示，不能静默无反应',
);
assert.match(
  welcomeSource,
  /type="submit"[\s\S]*?disabled=\{!token\.trim\(\) \|\| isLoading \|\| isCompleting\}/,
  '初始化页主连接按钮必须在空 Token、连接中或进入中禁用，避免重复提交同一个 Token',
);
assert.match(
  welcomeSource,
  /aria-busy=\{isLoading\}[\s\S]*?aria-describedby=\{connectStatus \? 'welcome-connect-status' : undefined\}[\s\S]*?disabled=\{!token\.trim\(\) \|\| isLoading \|\| isCompleting\}[\s\S]*?正在验证 Token/,
  '初始化页主连接按钮必须暴露忙碌状态，并在连接中显示正在验证 Token',
);
assert.match(
  welcomeSource,
  /variant="ghost"[\s\S]*?disabled=\{isCompleting\}[\s\S]*?completeWelcome\(isLoading \? '正在进入工作台，GitHub 连接会继续在后台完成。' : undefined\)[\s\S]*?先进入工作台，后台继续连接/,
  '初始化页连接中必须用独立按钮进入工作台，避免主提交按钮同时承担重复提交和跳过动作',
);
assert.match(
  welcomeSource,
  /验证并进入工作台/,
  '初始化页连接按钮必须明确表示连接成功后会进入工作台',
);
assert.match(
  welcomeSource,
  /onClick=\{\(\) => void handleGitHubConnect\('sync'\)\}[\s\S]*?验证并同步 Stars/,
  '初始化页必须保留连接后立即同步 Stars 的可选入口',
);
assert.match(
  welcomeSource,
  /connectedUser \? `已连接 @\$\{connectedUser\.login\}。` : ''[\s\S]*?连接已完成，即将同步你的 GitHub Stars 到本地数据库/,
  '初始化页同步步骤必须展示已连接账号，避免用户认为连接按钮无反应',
);
const welcomeSurfaceStyles = stylesSource.match(/\.welcome-surface\s*\{[\s\S]*?\}/)?.[0] ?? '';
assert.match(welcomeSurfaceStyles, /background: var\(--color-background\)/, '欢迎页背景必须保持扁平底色');
assert.doesNotMatch(welcomeSurfaceStyles, /radial-gradient|backdrop-filter|blur/, '欢迎页背景不能使用 AI 化径向渐变或玻璃模糊');
assert.match(stylesSource, /\.welcome-card,[\s\S]*?\.welcome-progress-panel[\s\S]*?welcomePanelIn/, '欢迎页主内容和进度区域必须有轻量进入动效');
assert.match(
  stylesSource,
  /@keyframes welcomeStepIn[\s\S]*?@keyframes welcomeIconIn[\s\S]*?@keyframes welcomeMessageIn/,
  '欢迎页必须定义步骤、图标和消息的轻量关键帧',
);
assert.match(
  welcomeSource,
  /<form[\s\S]*?onSubmit=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(isLoading\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?void handleGitHubConnect\('workspace'\);[\s\S]*?\}\}[\s\S]*?<Input[\s\S]*?value=\{token\}/,
  '初始化页 Token 输入框回车必须通过表单提交走受保护的连接函数',
);
assert.match(
  welcomeSource,
  /const isMountedRef = useRef\(true\)[\s\S]*?useEffect\(\(\) => \{[\s\S]*?isMountedRef\.current = false;[\s\S]*?\}, \[\]\)/,
  '初始化页允许连接后台完成时必须有卸载保护，避免进入工作台后异步连接继续写本地组件状态',
);
assert.match(
  welcomeSource,
  /<Input[\s\S]*?type="password"[\s\S]*?autoComplete="off"[\s\S]*?autoCapitalize="none"[\s\S]*?autoCorrect="off"[\s\S]*?spellCheck=\{false\}[\s\S]*?inputMode="text"[\s\S]*?placeholder="粘贴 GitHub Token"/,
  '初始化页 Token 输入框必须关闭自动补全、自动大写、自动纠错和拼写检查，避免粘贴令牌时被输入法干扰',
);
assert.match(
  connectionPanelSource,
  /<Input[\s\S]*?type="password"[\s\S]*?autoComplete="off"[\s\S]*?autoCapitalize="none"[\s\S]*?autoCorrect="off"[\s\S]*?spellCheck=\{false\}[\s\S]*?inputMode="text"[\s\S]*?placeholder="粘贴 GitHub Token"/,
  '侧栏 GitHub Token 输入框也必须关闭自动补全、自动大写、自动纠错和拼写检查，避免主界面连接账号时被输入法干扰',
);
assert.match(
  appSource,
  /onSyncStars=\{\(\) => workspace\.handleSyncStars\(\{ throwOnError: true \}\)\}/,
  '初始化页同步必须让错误冒泡给 WelcomeFlow 展示，避免同步失败时看起来无反应',
);
assert.match(
  appSource,
  /taskProgress=\{workspace\.taskProgress\}/,
  '初始化页必须接收后端任务进度，首次同步不能只显示按钮加载态',
);
assert.match(
  welcomeSource,
  /taskProgress: TaskProgressEvent \| null/,
  'WelcomeFlow props 必须包含任务进度事件',
);
assert.match(
  welcomeSource,
  /visibleTaskProgress && \([\s\S]*?<WelcomeTaskProgress progress=\{visibleTaskProgress\}/,
  '初始化同步步骤必须渲染任务进度卡片',
);
assert.doesNotMatch(
  welcomeSource,
  /\{warningMessage\}\s*\{warningMessage\}/,
  '初始化页 README 缓存警告不能重复渲染同一条消息',
);
assert.match(
  welcomeSource,
  /function WelcomeTaskProgress\(props: \{ progress: TaskProgressEvent \}\)/,
  '初始化页必须提供独立任务进度组件，覆盖欢迎页全屏时 AppLayout 不可见的问题',
);
assert.match(
  welcomeSource,
  /const isPartial = progress\.status === 'partial'/,
  '初始化页任务进度必须识别部分完成状态，避免 README 缓存部分失败时误报为任务完成',
);
assert.match(
  welcomeSource,
  /isPartial[\s\S]*?'border-warning\/30 bg-warning\/10 text-warning'/,
  '初始化页部分完成任务卡必须使用警告色，便于用户区分成功和可重试的部分失败',
);
assert.match(
  welcomeSource,
  /isPartial \? '任务部分完成' : '任务完成'/,
  '初始化页部分完成任务卡标题必须明确写出任务部分完成',
);
assert.match(
  workspaceSource,
  /async function refreshRepositoryWorkspace\(accountIdOverride\?: string\)[\s\S]*?Promise\.all\(\[[\s\S]*?loadRepositories\(repositoryFilters, accountIdOverride\)[\s\S]*?loadRepositoryLanguages\(accountIdOverride\)[\s\S]*?loadTags\(accountIdOverride\)[\s\S]*?\]\)/,
  '连接成功后必须同时刷新仓库列表、语言和标签数据，避免界面解锁但数据仍为空',
);
assert.match(
  workspaceSource,
  /function refreshRepositoryWorkspaceInBackground\(accountId: string\)[\s\S]*?void refreshRepositoryWorkspace\(accountId\)\.catch\(\(reason\) => \{[\s\S]*?GitHub 已连接，但本地数据刷新失败/,
  '连接成功后的本地数据刷新必须在后台执行并保留错误反馈，不能阻塞初始化页进入工作台',
);
assert.match(
  workspaceSource,
  /async function handleSaveToken\(event: FormEvent<HTMLFormElement>\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?invoke<GitHubUser>\('save_github_token', \{ token \}\)[\s\S]*?setAuthState\(\{ hasToken: true, user \}\)[\s\S]*?setToken\(''\)[\s\S]*?refreshRepositoryWorkspaceInBackground\(String\(user\.id\)\)/,
  '侧栏连接表单必须保存 Token、更新认证态、清空明文 Token 并后台刷新本地数据',
);
assert.match(
  workspaceSource,
  /async function connectWithToken\(rawToken: string\)[\s\S]*?const trimmed = rawToken\.trim\(\)[\s\S]*?if \(!trimmed\)[\s\S]*?setError\(message\)[\s\S]*?throw new Error\(message\)[\s\S]*?invoke<GitHubUser>\('save_github_token', \{ token: trimmed \}\)[\s\S]*?refreshRepositoryWorkspaceInBackground\(String\(user\.id\)\)[\s\S]*?throw reason/,
  '直接连接入口必须 trim Token、拒绝空 Token，并在失败时向调用方抛出错误',
);
assert.match(
  workspaceSource,
  /if \(!trimmed\) \{[\s\S]*?const message = '请输入 GitHub Personal Access Token';[\s\S]*?setError\(message\);[\s\S]*?throw new Error\(message\);[\s\S]*?\}/,
  '直接连接入口收到空 Token 时也必须抛出错误，避免调用方表现为无反应',
);
assert.match(
  settingsSource,
  /async function handleGitHubConnectSubmit\(event: FormEvent<HTMLFormElement>\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?workspace\.connectWithToken\(workspace\.token\)/,
  '设置页连接表单必须通过 connectWithToken 使用当前输入值连接 GitHub',
);
assert.match(
  settingsSource,
  /<input[\s\S]*?type="password"[\s\S]*?autoComplete="off"[\s\S]*?autoCapitalize="none"[\s\S]*?autoCorrect="off"[\s\S]*?spellCheck=\{false\}[\s\S]*?inputMode="text"[\s\S]*?value=\{workspace\.token\}/,
  '设置页 GitHub Token 输入框必须关闭自动补全、自动大写、自动纠错和拼写检查，避免粘贴令牌时被输入法干扰',
);
assert.match(
  settingsSource,
  /disabled=\{workspace\.isSavingToken \|\| !workspace\.token\.trim\(\)\}/,
  '设置页连接按钮必须在空 Token 或连接中禁用',
);
assert.match(
  connectionPanelSource,
  /<form className="grid gap-3" onSubmit=\{props\.onSaveToken\}>[\s\S]*?onChange=\{\(event\) => props\.onSetToken\(event\.target\.value\)\}[\s\S]*?disabled=\{props\.isSavingToken \|\| props\.token\.trim\(\)\.length === 0\}/,
  '侧栏连接表单必须提交到 workspace.handleSaveToken，并在空 Token 或连接中禁用',
);

console.log('Auth flow verification passed.');
