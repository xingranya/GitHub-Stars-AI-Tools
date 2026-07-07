import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = new URL('..', import.meta.url).pathname;
const appSource = readFileSync(join(projectRoot, 'src', 'App.tsx'), 'utf8');
const appLayoutSource = readFileSync(join(projectRoot, 'src', 'components', 'app-layout.tsx'), 'utf8');
const appShellSource = readFileSync(join(projectRoot, 'src', 'components', 'app-shell.tsx'), 'utf8');
const welcomeFlowSource = readFileSync(join(projectRoot, 'src', 'components', 'welcome-flow.tsx'), 'utf8');
const repositoriesPage = readFileSync(join(projectRoot, 'src', 'pages', 'repositories.tsx'), 'utf8');
const profilePage = readFileSync(join(projectRoot, 'src', 'pages', 'profile.tsx'), 'utf8');
const settingsPage = readFileSync(join(projectRoot, 'src', 'pages', 'settings.tsx'), 'utf8');
const readmeRendererSource = readFileSync(join(projectRoot, 'src', 'components', 'readme-renderer.tsx'), 'utf8');
const settingsProviderSource = readFileSync(join(projectRoot, 'src', 'providers', 'settings-provider.tsx'), 'utf8');
const workspaceHook = readFileSync(join(projectRoot, 'src', 'hooks', 'use-stars-workspace.ts'), 'utf8');
const styles = readFileSync(join(projectRoot, 'src', 'styles.css'), 'utf8');

assert.match(
  repositoriesPage,
  /computeVirtualWindow\(/,
  '仓库列表必须继续使用虚拟列表，避免 1000+ Stars 全量渲染',
);
assert.match(appSource, /import \{ lazy, Suspense,[^}]+ \} from 'react'/, '页面组件必须使用 lazy/Suspense 分块加载，降低启动首包体积');
assert.match(appSource, /const RepositoriesPage = lazy\(\(\) => import\('@\/pages\/repositories'\)/, '仓库页必须保持懒加载，避免 README 渲染依赖进入首包');
assert.match(appSource, /<Suspense fallback=\{<PageLoadingFallback \/>\}>/, '懒加载页面必须提供稳定的加载占位，避免页面切换空白');
assert.match(appSource, /document\.addEventListener\('click', handleExternalLinkClick\)/, '桌面外链必须统一拦截，避免 WebView 内部吞掉 target=_blank');
assert.match(appSource, /invoke\('open_external_url', \{ url \}\)/, '外链必须通过 Tauri 命令交给系统浏览器打开');
assert.match(appSource, /\^https\?:\\\/\\\//, '外链拦截必须只处理 http/https URL');
assert.match(appSource, /rawHref\.startsWith\('#'\)/, '外链拦截必须放过 README 和页面内的 hash 锚点');
assert.match(appSource, /function isSameDocumentHashLink\(url: string\)/, '外链拦截必须识别同文档 hash 链接，避免误送系统浏览器');
assert.doesNotMatch(appLayoutSource, /PROJECT_REPOSITORY_URL|项目仓库|aria-label="打开项目仓库"/, '应用壳首页不能重复显示项目仓库入口，避免和连接 GitHub 入口混淆');
assert.match(settingsPage, /const PROJECT_REPOSITORY_URL = 'https:\/\/github\.com\/xingranya\/GitHub-Stars-AI-Tools'/, '设置页必须保留项目仓库真实链接');
assert.match(settingsPage, /href=\{PROJECT_REPOSITORY_URL\}[\s\S]*?项目仓库/, '项目仓库入口应收纳到设置页，减少首页重复 GitHub 入口');
assert.doesNotMatch(appLayoutSource, /<span className="hidden sm:inline">GitHub<\/span>/, '桌面右上角不应重复显示项目仓库入口，设置页已提供入口');
assert.match(appLayoutSource, /onClick=\{\(\) => \(props\.user \? props\.onSyncStars\(\) : props\.onNavigate\('settings'\)\)\}/, '顶部必须保留同步入口，小窗口不应只能从仪表盘同步');
assert.doesNotMatch(appShellSource, /min-h-\[calc\(100vh-113px\)\]/, '旧应用壳不能写死 header 高度，避免窗口变窄时内容区被裁切');
assert.match(appShellSource, /<main className="flex min-h-screen min-w-0 flex-col/, '旧应用壳也必须使用纵向 flex 自适应可变 header 高度');
assert.match(appShellSource, /grid min-h-0 flex-1 grid-cols-1/, '旧应用壳内容区必须使用 flex-1 和 min-h-0，避免双滚动或底部裁切');
assert.doesNotMatch(
  `${appLayoutSource}\n${appShellSource}\n${welcomeFlowSource}`,
  /bg-white/,
  '应用内图标容器不能使用硬白底，深色模式必须使用主题容器色',
);
assert.match(welcomeFlowSource, /className="size-12 shrink-0 rounded-xl border border-card-border bg-surface-container-lowest object-contain shadow-sm"/, '欢迎页应用图标必须有圆角、主题背景和阴影');

const readmeRendererMatch = readmeRendererSource.match(/function ReadmeRenderer[\s\S]*?const className = props\.className[\s\S]*?\?\? '([^']+)'/);
assert.ok(readmeRendererMatch, '必须存在 README 渲染容器');
assert.ok(
  !/\bmax-h-\[/.test(readmeRendererMatch[1]),
  'README 渲染器不应使用固定 max-height，避免窗口缩放时内容被内部截断',
);
assert.ok(
  !/\boverflow-auto\b/.test(readmeRendererMatch[1]),
  'README 渲染器不应额外创建纵向滚动容器，详情页外层负责滚动',
);

assert.match(styles, /\.dark \.readme-rendered code/, '深色模式必须覆盖 README 行内代码样式');
assert.match(styles, /\.readme-rendered pre/, 'README 代码块必须有独立样式');
assert.match(styles, /\.readme-rendered table/, 'README 表格必须支持横向滚动');
assert.ok(
  readmeRendererSource.includes("replace(/^\\.\\//, '')"),
  'README 相对路径只能剥离真正的 ./ 前缀，不能误删 a/b.png 的首级目录',
);
assert.match(readmeRendererSource, /segment === '\.\.'[\s\S]*?segments\.pop\(\)/, 'README 相对资源路径必须支持 ../ 回到上级目录');
assert.match(readmeRendererSource, /segments\.map\(encodeURIComponent\)\.join\('\/'\)/, 'README 相对资源路径必须按路径段编码，避免空格等字符破坏 URL');
assert.match(readmeRendererSource, /const scheme = trimmedUrl\.match\(\/\^\(\[a-z\]\[a-z0-9\+\.\-\]\*\):\/i\)/, 'README 链接和图片必须识别显式协议，不能直接透传任意 URL');
assert.match(readmeRendererSource, /if \(scheme === 'http' \|\| scheme === 'https'\)[\s\S]*?return trimmedUrl/, 'README 绝对 URL 只应直接允许 http 和 https');
assert.match(readmeRendererSource, /mode === 'link' && scheme === 'mailto'/, 'README 链接可以保留 mailto，但图片不能使用 mailto');
assert.match(readmeRendererSource, /return undefined;[\s\S]*?const normalizedPath = normalizeReadmePath/, 'README 渲染必须拒绝 javascript 等非白名单协议，避免危险协议进入 WebView');
assert.match(readmeRendererSource, /trimmedUrl\.startsWith\('\/\/'\)[\s\S]*?return `https:\$\{trimmedUrl\}`/, 'README 协议相对资源必须归一化为 https，避免 WebView 内部相对协议歧义');
assert.match(readmeRendererSource, /h1: createHeadingComponent\('h1', headingSlugCounts\)/, 'README 一级标题必须生成可跳转锚点');
assert.match(readmeRendererSource, /h6: createHeadingComponent\('h6', headingSlugCounts\)/, 'README 所有标题层级都必须生成可跳转锚点');
assert.match(readmeRendererSource, /function createGithubHeadingSlug\(text: string\)/, 'README 标题锚点必须使用稳定 slug 规则');
assert.match(readmeRendererSource, /resolvedHref\.startsWith\('#'\)/, 'README hash 链接必须在渲染器内处理，不能按外链打开');
assert.match(readmeRendererSource, /target\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/, 'README 目录点击必须滚动到对应标题');

assert.match(settingsProviderSource, /const primaryForeground = getReadableForegroundColor\(brandColor\)/, '主题主色必须自动计算可读前景色');
assert.match(settingsProviderSource, /root\.style\.setProperty\('--color-on-primary', primaryForeground\)/, '主题按钮文字颜色必须跟随主色对比度调整');
assert.match(settingsProviderSource, /root\.style\.setProperty\('--color-primary-foreground', primaryForeground\)/, 'shadcn 兼容主色前景变量必须同步调整');
assert.match(settingsProviderSource, /root\.style\.setProperty\('--color-on-primary-container', primaryForeground\)/, '主色容器文字颜色必须跟随主色对比度调整');
assert.match(settingsProviderSource, /function getContrastRatio\(firstColor: RgbColor, secondColor: RgbColor\)/, '主题前景色选择必须基于对比度计算');
assert.match(profilePage, /function readChartTheme\(\)[\s\S]*?--color-primary[\s\S]*?--color-on-surface-variant[\s\S]*?--color-outline-variant/, '个人主页图表颜色必须读取当前 CSS 主题 token');
assert.match(profilePage, /new MutationObserver\(refreshChartTheme\)/, '个人主页图表必须监听主题 class 和内联 token 变化，保证深色模式与品牌色切换后刷新');
assert.doesNotMatch(profilePage, /const CHART_COLORS = \{[\s\S]*?#2563eb/, '个人主页图表不能继续使用硬编码浅色主题色');
assert.match(profilePage, /onOpenSettings: \(\) => void/, '个人主页未连接空态必须接收设置页入口回调');
assert.match(profilePage, /!user && \([\s\S]*?连接 GitHub 账号/, '个人主页未连接时必须展示连接 GitHub 的直接入口');
assert.match(appSource, /<ProfilePage onOpenRepository=\{handleRepositoryOpen\} onOpenSettings=\{\(\) => setCurrentPage\('settings'\)\} \/>/, '个人主页连接入口必须跳转真实设置页');

assert.match(
  repositoriesPage,
  /window\.setTimeout\(\(\) => \{[\s\S]*?workspace\.applyRepositoryFilters\(\{[\s\S]*?keyword: searchKeyword,[\s\S]*?language: selectedLanguage,[\s\S]*?tagId: selectedTagId,[\s\S]*?\}\);[\s\S]*?\}, 220\)/,
  '仓库页关键词、语言、标签变化后必须防抖即时应用筛选，不能要求用户再点搜索按钮',
);
assert.match(repositoriesPage, /onChange=\{\(e\) => setSearchKeyword\(e\.target\.value\)\}/, '仓库搜索框输入必须直接更新筛选状态');
assert.match(repositoriesPage, /onChange=\{\(e\) => setSelectedLanguage\(e\.target\.value\)\}/, '语言筛选变化必须直接更新筛选状态');
assert.match(repositoriesPage, /onChange=\{\(e\) => setSelectedTagId\(e\.target\.value\)\}/, '标签筛选变化必须直接更新筛选状态');
assert.match(workspaceHook, /const repositoryLoadSequence = useRef\(0\)/, '仓库列表加载必须有请求序号，避免快速筛选时旧请求覆盖新结果');
assert.match(workspaceHook, /const requestId = \+\+repositoryLoadSequence\.current/, '每次仓库列表加载都必须递增请求序号');
assert.match(workspaceHook, /requestId === repositoryLoadSequence\.current[\s\S]*?setRepositoryPage\(page\)/, '只有最新的仓库列表请求可以写入页面结果');
assert.match(workspaceHook, /requestId === repositoryLoadSequence\.current[\s\S]*?setIsLoadingRepositories\(false\)/, '旧仓库列表请求完成时不能提前关闭最新请求的加载状态');
assert.match(workspaceHook, /async function handleRenameTag[\s\S]*?await loadRepositories\(repositoryFilters\)/, '标签重命名后必须刷新仓库列表，避免本地即时筛选继续使用旧标签名');
assert.match(repositoriesPage, /const hasPendingRepositoryFilters = workspace\.isLoadingRepositories \|\| \(/, '仓库页必须识别本地筛选条件尚未被后端结果确认的状态');
assert.match(repositoriesPage, /repositoryMatchesLocalFilters\(repo,[\s\S]*?keyword: searchKeyword,[\s\S]*?language: selectedLanguage,[\s\S]*?tagId: selectedTagId/, '仓库页必须在后端查询返回前先用本地数据即时过滤');
assert.match(repositoriesPage, /function repositoryMatchesLocalFilters\(repo: RepositoryListItem,[\s\S]*?filters\.tagId && !repo\.tagIds\.includes\(filters\.tagId\)[\s\S]*?repo\.tagNames/, '仓库页本地即时过滤必须使用本地标签 ID 做交集，并把标签名纳入关键词匹配');
assert.match(repositoriesPage, /workspace\.isLoadingRepositories && filteredRepos\.length === 0/, '仓库页筛选加载中如已有本地即时结果，应继续显示结果而不是整块转圈');
assert.doesNotMatch(
  repositoriesPage,
  /md:grid-cols-\[minmax\(200px,1\.8fr\)_minmax\(220px,2fr\)_110px_90px_110px\]/,
  '仓库表格不能在 md 断点展开 5 列，否则 720 到 801px 窗口会横向裁切',
);
assert.match(
  repositoriesPage,
  /lg:grid-cols-\[minmax\(200px,1\.8fr\)_minmax\(220px,2fr\)_110px_90px_110px\]/,
  '仓库表格应到 lg 断点再展开语言和状态列，保证最小窗口宽度可用',
);
assert.match(repositoriesPage, /<span className="hidden lg:block">语言<\/span>[\s\S]*?<span className="hidden lg:block">状态<\/span>/, '仓库表格语言和状态表头必须跟随 lg 断点显示');
assert.match(repositoriesPage, /<span className="hidden items-center gap-1\.5 text-sm lg:flex">[\s\S]*?<span className="hidden flex-wrap gap-1 lg:flex">/, '仓库表格语言和状态单元格必须跟随 lg 断点显示');
assert.match(repositoriesPage, /<h2 className="[^"]*min-w-0[^"]*flex-1[^"]*truncate[^"]*font-headline-lg[^"]*font-bold[^"]*tracking-tight[^"]*text-on-surface[^"]*">/, '仓库详情标题必须允许长仓库名在 flex 行内收缩，避免挤压右侧徽标');
assert.match(repositoriesPage, /function AiMetaItem[\s\S]*?\[overflow-wrap:anywhere\]/, 'AI 生成参数值必须允许长模型 ID 或哈希换行展示');
assert.match(repositoriesPage, /<div className="grid grid-cols-1 gap-2 text-\[11px\] sm:grid-cols-2">[\s\S]*?<AiMetaItem label="模型"/, 'AI 生成参数在窄窗口必须单列展示，避免长模型名被截断');

console.log('UI constraints verification passed.');
