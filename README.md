# GitHub Stars AI Tools

> 本地优先的 GitHub Stars 管理桌面应用，支持 AI 智能检索与知识管理

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-blue.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)

## ✨ 特性

- 🔄 **本地同步** - 将 GitHub Stars 同步到本地 SQLite 数据库
- 🤖 **AI 摘要** - 自动生成仓库的中文摘要与关键词
- 🔍 **智能检索** - 支持关键词、语义搜索和混合模式
- 🏷️ **标签管理** - 自定义标签组织你的 Star 列表
- 📝 **笔记注解** - 为每个仓库添加个人笔记
- 📖 **阅读状态** - 标记已读/未读/稍后阅读
- ☁️ **跨设备同步** - 通过 GitHub Gist 同步注解数据
- 🔒 **隐私优先** - 所有数据存储在本地，Token 使用系统 Keychain 保护

## 🖥️ 系统要求

- macOS 10.15+ / Windows 10+ / Linux
- Node.js >= 24
- pnpm >= 11
- Rust (用于构建 Tauri 应用)

## 🚀 快速开始

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/yourusername/github-stars-ai-tools.git
cd github-stars-ai-tools

# 启用 corepack（如果尚未启用）
corepack enable

# 安装依赖
pnpm install
```

### 开发

```bash
# 启动开发服务器（包含桌面窗口）
pnpm tauri dev

# 仅启动前端（浏览器预览）
pnpm dev
```

### 构建

```bash
# 构建生产版本
pnpm build

# 打包桌面应用
pnpm tauri build
```

安装包位于 `apps/desktop/src-tauri/target/release/bundle/`

## 📖 使用指南

### 首次设置

1. 启动应用后，点击"连接 GitHub"
2. 创建 GitHub Personal Access Token（需要 `repo` 和 `user` 权限）
3. 粘贴 Token 并保存
4. 点击"同步 Stars"开始同步
5. 点击"抓取 README"缓存仓库详情

### 功能说明

#### 智能检索

- **关键词搜索**: 按仓库名称、描述、语言、主题搜索
- **语义搜索**: 使用自然语言描述你想找的内容
- **混合模式**: 结合关键词和语义搜索提供最佳结果

#### 标签管理

- 创建自定义标签分类仓库
- 支持多标签筛选
- AI 自动建议相关标签

#### 跨设备同步

- 导出注解数据到私密 Gist
- 在其他设备导入 Gist 恢复注解
- 仅同步标签、笔记、阅读状态等用户数据

## 🏗️ 技术架构

### 技术栈

- **前端**: React 18 + TypeScript + Vite + Tailwind CSS
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
  storage/              # SQLite Schema 与迁移
  github/               # GitHub API 封装
  ai/                   # AI Provider 抽象层
  search/               # 搜索引擎
  worker/               # 后台任务编排
```

详细架构说明见 [CLAUDE.md](CLAUDE.md)

## 🛠️ 开发指南

### 运行测试

```bash
# 检查 TypeScript 类型
pnpm build:packages

# 验证数据库迁移
pnpm --filter @stars-ai/storage verify:migrations

# 检查 Rust 代码
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

# 格式化 Rust 代码
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### 提交前检查

```bash
pnpm build:packages
pnpm build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## 🔐 隐私与安全

- GitHub Token 存储在系统 Keychain（macOS）或等效的安全存储中
- 所有数据处理均在本地完成，不会上传到任何第三方服务
- Gist 同步使用私密 Gist，仅包含用户注解数据

## 🗺️ 路线图

- [x] Phase 1: 基础设施搭建
- [x] Phase 2: GitHub 同步功能
- [x] Phase 3: Star 管理核心能力
- [x] Phase 4: AI 知识库集成
- [x] Phase 5: 自然语言检索
- [x] Phase 6: 增量同步与 Gist 同步
- [ ] Phase 7: 成本与任务监控
- [ ] 后续: Windows/Linux 支持、团队协作功能

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

开发前请阅读 [CLAUDE.md](CLAUDE.md) 了解项目架构和开发规范。

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

本项目使用以下开源项目：

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [React](https://react.dev/) - UI 框架
- [Radix UI](https://www.radix-ui.com/) - 无障碍 UI 组件库
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架