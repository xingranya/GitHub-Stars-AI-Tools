<div align="center">
  <img src="apps/desktop/public/icon.png" alt="GitHub-Stars-AI-Tools 应用图标" width="128" />
  <h1>GitHub-Stars-AI-Tools</h1>
  <p><strong>把 GitHub Stars 变成可搜索、可总结、可继续探索的本地 AI 知识库。</strong></p>
  <p>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-111827?style=for-the-badge" /></a>
    <a href="https://tauri.app/"><img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" /></a>
    <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-19-087EA4?style=for-the-badge&logo=react&logoColor=white" /></a>
    <a href="https://www.rust-lang.org/"><img alt="Rust" src="https://img.shields.io/badge/Rust-backend-B7410E?style=for-the-badge&logo=rust&logoColor=white" /></a>
    <a href="https://www.sqlite.org/"><img alt="SQLite" src="https://img.shields.io/badge/SQLite-local-003B57?style=for-the-badge&logo=sqlite&logoColor=white" /></a>
  </p>
</div>

## 核心能力

|  |  |
| --- | --- |
| 🔄 **Stars 同步** | 全量/增量同步 GitHub Stars，写入本地 SQLite 数据库 |
| 📚 **README 知识库** | 缓存 README、Topics、语言、标签、笔记和阅读状态 |
| ✨ **AI 摘要** | 支持 OpenAI、OpenAI 兼容接口与 Anthropic，生成中文摘要和关键词 |
| 🔍 **自然语言搜索** | 跨仓库名称、描述、README、AI 文档、标签和笔记检索 |
| 🏷️ **AI 标签网络** | 自动生成标签建议，把大量 Stars 整理成可维护的分类体系 |
| 🧭 **相似项目发现** | 根据已收藏项目生成 GitHub Search 策略，发现更好或更活跃的替代项目 |

## 为什么用它

- **本地优先**：GitHub Token、AI Key 和知识库数据都保存在本机，密钥进入系统凭据管理器。
- **不强制 AI**：基础管理能力可离线使用，需要总结、标签和推荐时再接入 AI 服务。
- **面向重度收藏者**：适合 Stars 很多、经常回看项目用途、比较同类工具和整理技术栈的用户。
- **桌面级体验**：后台任务队列、失败重试、大列表虚拟滚动、深色模式和跨平台安装包都已覆盖。

## 🖥️ 系统要求

- macOS 10.15+ / Windows 10+ / Linux（Linux 需要可用的 Secret Service 或兼容凭据服务）
- 安装包用户只需要安装 GitHub-Stars-AI-Tools 客户端，不需要安装 Node.js、pnpm 或 Rust；账号与 AI 服务都在应用内设置。

## 🚀 快速开始

### 安装包用户

1. 安装并启动 GitHub-Stars-AI-Tools。
2. 在欢迎页或设置页粘贴 GitHub Personal Access Token，应用会校验并保存到系统凭据管理器。
3. 点击同步 Stars，应用会把 GitHub Stars 写入本地数据库，并显示同步进度。
4. 在设置页选择 OpenAI、OpenAI 兼容接口或 Anthropic，填写请求地址、API Key 和模型 ID。
5. 点击测试 AI 连接，通过后即可生成 README 摘要、AI 标签网络和相似项目推荐。

### 开发者构建

开发者从源码构建时需要 Node.js >= 24、pnpm >= 11 和 Rust。

```bash
# 克隆仓库
git clone https://github.com/xingranya/GitHub-Stars-AI-Tools.git
cd GitHub-Stars-AI-Tools

# 启用 corepack（如果尚未启用）
corepack enable

# 安装依赖
pnpm install
```

```bash
# 启动开发服务器（包含桌面窗口）
pnpm tauri dev

# 仅启动前端（浏览器预览）
pnpm dev
```

平时开发桌面应用优先使用：

```bash
pnpm tauri dev
```

这个命令会启动 Vite 开发服务并打开 Tauri 桌面窗口，适合日常改前端界面、Tauri 命令和本地功能联调。`pnpm dev` 只启动前端浏览器预览，不会打开桌面壳，适合单独调试纯 UI。

### 打包

```bash
# 构建生产版本
pnpm build

# 运行 MVP 静态验收
pnpm verify:mvp

# 打包当前系统的桌面安装包
pnpm package:desktop

# macOS：生成标准拖拽安装 DMG（大图标 App + Applications）
pnpm package:desktop:dmg
```

## 📖 使用指南

### 首次设置

1. 启动应用后，点击"连接 GitHub"
2. 创建 GitHub Personal Access Token（读取公开 Stars 可使用只读 Token；私有仓库 Stars 需要相应仓库读取权限）
3. 粘贴 Token 并保存
4. 点击"同步 Stars"开始同步
5. 点击"抓取 README"缓存仓库详情
6. 在设置页配置 AI 服务后，可生成单仓摘要、批量摘要、AI 标签网络和相似项目推荐

### 功能说明

#### AI 配置

- **OpenAI**: 默认请求地址为 `https://api.openai.com/v1`，模型 ID 可自定义
- **OpenAI 兼容接口**: 必须填写请求地址，适配兼容 Chat Completions 的第三方服务
- **Anthropic**: 默认请求地址为 `https://api.anthropic.com/v1`，支持 Claude Messages API
- **无向量门槛**: 当前主功能只需要聊天/文本生成接口，不要求用户配置 Embeddings 或向量模型
- **安全存储**: AI API Key 不写入 localStorage，只保存到系统凭据管理器

#### Stars 同步与 README 缓存

- 支持首次全量同步和后续增量同步
- 同步、README 抓取、AI 分析和 GitHub 相似发现会进入后台 FIFO 队列，持续发送任务进度，不阻塞主界面
- README 批量抓取默认并发处理，单仓失败不会中断整批
- 网络中断或 Token 失效时会显示明确错误，已写入本地的数据不会被删除

#### 智能检索

- **关键词搜索**: 按仓库名称、描述、语言、Topics、标签和笔记搜索
- **知识召回**: 搜索会读取 README 摘要、AI 文档、标签和笔记等本地知识字段
- **上下文搜索**: 自然语言搜索会携带最近对话查询上下文，适合连续追问

#### 标签管理

- 创建自定义标签分类仓库
- 支持多标签筛选
- AI 自动建议相关标签
- AI 可根据全部 Stars 简略信息自动生成标签网络

#### 跨设备同步

- 导出注解数据到私密 Gist
- 在其他设备导入 Gist 恢复注解
- 仅同步标签、笔记、阅读状态等用户数据

#### 产品体验

- 设置页提供项目仓库、问题反馈、许可证和开源组件鸣谢入口，首页保持同步、搜索和仓库管理优先
- 同步、README 抓取、AI 摘要、AI 标签网络、Gist 导入导出和相似项目推荐都会显示任务阶段、当前仓库、进度和失败重试入口
- 仓库列表支持卡片/表格视图、组合筛选、虚拟列表滚动和自适应窗口布局
- README 原文会在详情面板内渲染 Markdown，并处理 GitHub 相对图片和链接

## 🏗️ 技术架构

### 技术栈

- **前端**: React 19 + TypeScript + Vite + Tailwind CSS
- **桌面**: Tauri 2
- **后端**: Rust
- **数据库**: SQLite
- **包管理**: pnpm (monorepo)

### 项目结构

```
apps/
  desktop/              # Tauri 桌面应用
    src/                # React 前端代码
    src-tauri/          # Rust 后端代码

packages/
  domain/               # 领域类型定义
  storage/              # SQLite Schema、初始化与持久化验证
  github/               # GitHub API 封装
  ai/                   # AI 服务抽象层
  search/               # 搜索引擎
  worker/               # 后台任务编排
```

详细架构说明见 [CLAUDE.md](CLAUDE.md)

## 🛠️ 开发指南

### 运行测试

```bash
# 检查 TypeScript 类型
pnpm build:packages

# 验证数据库 schema 初始化
pnpm --filter @gsat/storage verify:migrations

# 验证前端 Tauri 命令覆盖、虚拟列表与 UI 约束
pnpm verify:commands
pnpm verify:virtual-list
pnpm verify:ui
pnpm verify:ai-search-flow
pnpm verify:recommendation-flow

# 一键运行当前 MVP 静态验收，结束后自动清理构建产物
pnpm verify:mvp

# 打印 MVP 验收矩阵与发布包真实链路复核项
pnpm verify:acceptance

# 上线前：验证 Tauri 发布配置并生成当前系统安装包
pnpm verify:release

# 检查 Rust 代码
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# 格式化 Rust 代码
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### 提交前检查

```bash
pnpm build:packages
pnpm build
pnpm verify:mvp
pnpm verify:acceptance
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

`pnpm verify:release` 会生成当前系统安装包，只在准备发版或检查安装包时运行，不作为日常提交前检查。

## 🔐 隐私与安全

- GitHub Token 存储在系统凭据管理器：macOS Keychain、Windows Credential Manager 或 Linux Secret Service
- 最近连接的 GitHub 账号资料会缓存在本地数据库，用于重启后快速恢复工作台；清除 Token 后该账号会标记为已断开，不再自动恢复
- AI API Key 同样存储在系统凭据管理器，不写入 localStorage
- Stars、README、标签、笔记和 AI 文档存储在本地数据库
- 只有用户主动启用 AI 功能时，README 摘要请求才会发送到配置的 AI 服务
- Gist 同步使用私密 Gist，仅包含用户注解数据

## 🗺️ 路线图

- [X] Phase 1: 基础设施搭建
- [X] Phase 2: GitHub 同步功能
- [X] Phase 3: Star 管理核心能力
- [X] Phase 4: AI 知识库集成
- [X] Phase 5: 自然语言检索
- [X] Phase 6: 增量同步与 Gist 同步
- [X] Phase 7: AI 标签网络与 GitHub 相似项目发现
- [X] Phase 8: 静态验收矩阵、任务监控与发布包验收项
- [X] Phase 9: 成本统计与发布包自检记录
- [ ] Phase 10: zvec 本地向量索引与混合语义检索（计划见 [zvec-vector-roadmap.md](docs/plan/zvec-vector-roadmap.md)）
- [ ] 后续: 团队协作功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

开发前请阅读 [CLAUDE.md](CLAUDE.md) 了解项目架构和开发规范。

## 📄 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。源码可用于个人学习、研究、非营利组织和非商业场景；不得用于商业托管、商业再分发、商业产品集成或其他商业用途。商业使用需要先获得版权持有者的书面授权。

本项目源码公开，但“非商用许可”不等同于 OSI 定义下的开源许可；使用、分发或二次开发前请阅读完整 LICENSE。

## 🙏 致谢

本项目使用并感谢以下开源项目与生态组件。这里列出直接依赖和核心运行时；完整传递依赖以 lockfile 为准。

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Rust](https://www.rust-lang.org/) - 桌面后端与系统能力
- [React](https://react.dev/) - 前端 UI 框架
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [Vite](https://vite.dev/) - 前端构建工具
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- [Radix UI](https://www.radix-ui.com/) - 无障碍 UI 组件库
- [Material Symbols](https://fonts.google.com/icons) - 应用图标体系
- [SQLite](https://www.sqlite.org/) / [rusqlite](https://github.com/rusqlite/rusqlite) - 本地数据库
- [reqwest](https://github.com/seanmonstar/reqwest) - Rust HTTP 客户端
- [keyring-rs](https://github.com/open-source-cooperative/keyring-rs) - 系统凭据管理器访问
- [react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm)、[rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) - README Markdown 渲染与安全处理
- [Chart.js](https://www.chartjs.org/) / [react-chartjs-2](https://react-chartjs-2.js.org/) - 数据图表
- [pnpm](https://pnpm.io/) - Monorepo 包管理
