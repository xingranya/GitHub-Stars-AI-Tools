# GitHub-Stars-AI-Tools

> GSAT 是本地优先的 GitHub Stars 管理桌面应用，支持 README 缓存、AI 摘要、标签图谱、自然语言搜索与 GitHub 相似项目发现。

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)

**项目仓库**: [xingranya/GitHub-Stars-AI-Tools](https://github.com/xingranya/GitHub-Stars-AI-Tools)

## 项目主要特点

GitHub-Stars-AI-Tools 的核心定位不是“另一个 GitHub Stars 列表”，而是把长期收藏的开源项目沉淀成本地可检索、可解释、可继续追问的个人开源知识库。它适合 Stars 数量较多、经常需要回看项目用途、比较同类工具、整理技术栈和快速理解英文 README 的用户。

| 特点 | 价值 | 对应能力 |
| --- | --- | --- |
| 本地优先的桌面客户端 | 普通用户安装一个客户端即可使用，不需要自行部署服务、配置 `.env` 或维护数据库 | Tauri 桌面应用、SQLite 本地数据库、应用内 GitHub Token 与 AI 设置 |
| GitHub Stars 变成知识库 | 不只保存仓库名称，而是把 README、Topics、语言、标签、笔记和 AI 摘要统一沉淀 | Stars 同步、README 缓存、Markdown 渲染、仓库详情知识面板 |
| AI 是增强层，不是门槛 | 用户可以只使用本地管理能力；需要 AI 时再接入 OpenAI、OpenAI 兼容接口或 Anthropic | 自定义请求地址、API Key、模型 ID；不强制 Embeddings 或向量模型 |
| 面向中文理解的项目解析 | 解决英文 README、缩写项目名和复杂工具链难以快速理解的问题 | 中文摘要、中文定位、关键词、建议标签、README 梳理和右侧 AI 解析面板 |
| 可持续对话的自然语言搜索 | 搜索不是一次性关键词匹配，可以结合最近查询上下文继续追问 | AI 搜索上下文、卡片式结果、总结与下一步操作入口 |
| 自动整理标签图谱 | 减少手动给大量 Stars 分类的成本，让标签体系从已有收藏中自然生成 | AI 标签网络、标签建议、标签与仓库关联写入本地 |
| 发现更好或相似项目 | 不只管理已经收藏的项目，还能根据选中的 Stars 继续探索 GitHub 上的替代方案 | AI 生成 GitHub Search 策略、相似项目推荐、候选项目状态管理 |
| 长任务可见且可恢复 | 同步、README 抓取和 AI 分析耗时较长时，用户能看到进度和失败原因 | 后台 FIFO 任务队列、阶段/仓库名进度、失败卡片、重试动作 |
| 上线友好的安全模型 | Token 和 AI Key 不写入前端存储，降低本机泄露风险 | macOS Keychain、Windows Credential Manager、Linux Secret Service |
| 可验证的发布链路 | 开发者可以用统一脚本验收核心链路，发版时由 GitHub Actions 产出三端安装包 | `pnpm verify:mvp`、Tauri 发布配置校验、Release Desktop Apps 工作流 |

一句话总结：GSAT 把 GitHub Stars 从“收藏夹”升级为“本地开源知识库”，重点解决同步、理解、检索、整理、推荐和跨设备注解备份这几条真实使用链路。

## ✨ 特性

- 🔄 **本地同步** - 将 GitHub Stars 同步到本地数据库
- 🤖 **AI 摘要** - 接入 OpenAI、OpenAI 兼容接口或 Anthropic，自定义请求地址、API Key 与模型 ID
- 🔍 **智能检索** - 支持名称、描述、Topics、README、AI 摘要、标签与笔记的本地知识召回
- 🏷️ **标签管理** - 自定义标签组织你的 Star 列表
- 🕸️ **AI 标签网络** - 根据 Stars 简略信息自动生成标签图谱并写入本地标签体系
- 🧭 **相似项目发现** - 基于选中的 Stars 生成 GitHub Search 策略，寻找相似或更活跃的项目
- 📝 **笔记注解** - 为每个仓库添加个人笔记
- 📖 **阅读状态** - 标记已读/未读/稍后阅读
- ⚡ **大列表优化** - 1000+ Stars 使用虚拟列表渲染，降低滚动卡顿
- ☁️ **跨设备同步** - 通过 GitHub Gist 同步注解数据
- 🔒 **隐私优先** - GitHub Token 和 AI API Key 使用系统凭据管理器保存，知识库数据存储在本地数据库
- 🧩 **桌面体验** - 首次引导、任务进度、失败重试、深色模式、响应式布局与应用内真实链路自检

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

### 打包

```bash
# 构建生产版本
pnpm build

# 运行 MVP 静态验收
pnpm verify:mvp

# 打包当前系统的桌面安装包
pnpm package:desktop
```

`pnpm package:desktop` 会先构建 Monorepo 共享包，再执行 Tauri 安装包打包。安装包位于 `apps/desktop/src-tauri/target/release/bundle/`。本机只能稳定产出当前系统对应安装包；Linux、Windows、macOS 三端安装包由 GitHub Actions 分平台构建：

- macOS: Apple Silicon 与 Intel 两套 `.dmg`
- Windows: `.msi` 或 `setup.exe`
- Linux: `.deb`、`.rpm` 或 `.AppImage`

### GitHub Actions 发版

仓库内置 `Release Desktop Apps` 工作流。提交代码后，在 GitHub 网页端进入 **Actions → Release Desktop Apps → Run workflow**，填写：

- `version`: 版本号，例如 `0.1.0` 或 `v0.1.0`
- `changelog`: 本次更新日志，会写入 Release
- `release_draft`: 是否先创建草稿 Release
- `prerelease`: 是否标记为预发布

工作流会先把填写的版本号同步到 Tauri、Cargo 和 package 配置，再在 macOS Apple Silicon、macOS Intel、Windows、Linux runner 上分别执行 Tauri `build`，并把各平台安装包上传到同一个 `v版本号` GitHub Release。普通安装包用户不需要任何 `.env`、Node.js、pnpm 或 Rust；GitHub Token 与 AI Key 都在应用内设置。

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

### MVP 验收边界

- `pnpm verify:mvp` 覆盖 AUTH、SYNC、VIEW、AI、SRCH、DATA 的静态验收、离线 Provider 映射、SQLite 持久化、前端构建、Rust 单元测试和 Tauri 发布配置校验；该命令不生成安装包，并会在结束后清理 `dist`、`target` 和 `tsconfig.tsbuildinfo` 构建产物。
- `pnpm verify:acceptance` 会打印验收矩阵，列出每个 MVP 测试项的自动化证据。
- `pnpm verify:release` 会先校验 Tauri 分发配置和 GitHub Actions 发版链路，再执行 Tauri `build` 生成当前系统安装包；只有准备发版或检查安装包时才需要运行。
- `pnpm verify:ai-search-flow` 覆盖自然语言搜索上下文传递、按账号会话恢复和后端上下文评分。
- `pnpm verify:recommendation-flow` 覆盖 AI 生成 GitHub Search 策略、过滤已收藏仓库和相似项目结果展示。
- 设置页“客户端就绪状态”提供真实链路自检，会检查本地 SQLite 数据库、应用设置目录写入权限，读取系统凭据中的 GitHub Token，请求 Stars API、抓取 README、调用当前 AI 服务生成摘要、生成 AI 标签网络建议，并用 AI 生成的搜索式请求 GitHub Search。
- 真实链路自检完成后会在本地设置中持久化发布包自检记录，只保存检查时间和通过、失败、跳过数量，不保存 Token、AI Key 或错误详情。
- GitHub Token、AI 请求地址、API Key 和模型 ID 都在应用界面中填写，并保存到系统凭据管理器。
- 真实链路复核只在应用内进行：用户安装后填写自己的 GitHub Token、AI 请求地址、API Key 和模型 ID，即可连接账号、同步 Stars、测试 AI、生成 README 摘要并执行相似推荐联动；不需要安装前配置环境变量或额外脚本。

## 🔐 隐私与安全

- GitHub Token 存储在系统凭据管理器：macOS Keychain、Windows Credential Manager 或 Linux Secret Service
- 最近连接的 GitHub 账号资料会缓存在本地数据库，用于重启后快速恢复工作台；清除 Token 后该账号会标记为已断开，不再自动恢复
- AI API Key 同样存储在系统凭据管理器，不写入 localStorage
- Stars、README、标签、笔记和 AI 文档存储在本地数据库
- 只有用户主动启用 AI 功能时，README 摘要请求才会发送到配置的 AI 服务
- Gist 同步使用私密 Gist，仅包含用户注解数据

## 🗺️ 路线图

- [x] Phase 1: 基础设施搭建
- [x] Phase 2: GitHub 同步功能
- [x] Phase 3: Star 管理核心能力
- [x] Phase 4: AI 知识库集成
- [x] Phase 5: 自然语言检索
- [x] Phase 6: 增量同步与 Gist 同步
- [x] Phase 7: AI 标签网络与 GitHub 相似项目发现
- [x] Phase 8: 静态验收矩阵、任务监控与发布包验收项
- [x] Phase 9: 成本统计与发布包自检记录
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
