# TODO：GitHub-Stars-AI-Tools

## Phase 11: Local Embedding v1.5.0

- [x] Task 11.0: 冻结本地模型规格
  - Status: 已固定 multilingual-e5-small、revision、SHA-256 manifest、状态机和三平台发布矩阵。
  - Acceptance: 实施期间不再跟随 Hugging Face `main`，不重置用户数据库。
  - Files: `docs/plan/local-embedding-v1.md`、`docs/progress/phase-11-local-embedding.md`

- [x] Task 11.1: 完成本地模型运行时
  - Status: 已完成固定 revision 下载、工件校验、缓存重载、状态事件和 single-flight。
  - Acceptance: 首次确认下载后完成校验和加载，后续断网可用，失败可重试。

- [x] Task 11.2: 完成自动向量建库与维护
  - Status: 已完成 batch 16、profileId 分桶、dirty queue、SQLite 恢复和 zvec 原子替换。
  - Acceptance: 批量生成、内容失效、SQLite 恢复和 zvec 原子替换均可验证。

- [x] Task 11.3: 完成一键启用体验
  - Status: 已完成首次下载确认、阶段状态、重试、缓存删除和远程高级设置。
  - Acceptance: 普通设置只需开关；远程 Embedding 位于高级设置；状态和错误真实可见。

- [ ] Task 11.4: 完成质量与发布验收
  - Status: 本地真实模型、40 条中英质量集、Apple Silicon release 和 `.app` 已通过；待 Windows/Linux CI 与三端桌面交互验收。
  - Acceptance: 中英质量门槛、离线测试和 macOS arm64/Windows x64/Linux x64 构建全部通过。

## Phase 1: Foundation

- [x] Task 1.1: 初始化 Tauri + React 项目
  - Status: 已完成。骨架、基础布局、前端构建验证均通过。
  - Acceptance: 应用可启动，基础布局存在，构建通过。
  - Verify: `pnpm build` 已通过；`pnpm dev` 可用于本地预览。
  - Files: `apps/desktop/**`、`package.json`、`pnpm-workspace.yaml`、`.gitignore`

- [x] Task 1.2: 建立共享包结构
  - Status: 已完成。共享包目录、TypeScript 配置、领域类型、端口接口和构建验证均通过。
  - Acceptance: `domain/storage/github/ai/search/worker` 包存在，依赖方向清晰。
  - Verify: `pnpm build:packages` 与 `pnpm build` 已通过。
  - Files: `packages/**`、`tsconfig.base.json`、`tsconfig.packages.json`、`package.json`、`pnpm-lock.yaml`

- [x] Task 1.3: 建立本地 SQLite 初始化机制
  - Status: 已完成。核心表、schema 记录表、FTS 表和完整初始化 SQL 均已建立；本机测试期旧 SQLite 不做迁移，结构不兼容时删除并重建。
  - Acceptance: 核心表可创建，schema 初始化可重复执行。
  - Verify: `pnpm build` 已通过。
  - Files: `packages/storage/**`

## Phase 2: GitHub Sync

- [x] Task 2.1: GitHub 认证
  - Status: 已完成。PAT 由 Tauri 本地后端写入 macOS Keychain，保存前通过 GitHub `/user` 接口验证，前端只展示用户资料和连接状态。
  - Acceptance: Token 安全保存，可验证用户身份，日志不泄露 Token。
  - Verify: `pnpm build`、`cargo fmt --check` 与 `cargo check` 已通过。
  - Files: `apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`、`apps/desktop/src-tauri/**`

- [x] Task 2.2: 全量 Star 同步
  - Status: 已完成。Tauri 后端复用 Keychain Token，分页拉取 GitHub Stars，初始化本地 SQLite，并将仓库事实层幂等写入 `repositories` 和默认 `annotations`。
  - Acceptance: 支持分页同步，重复同步不重复写入。
  - Verify: `pnpm build`、`cargo fmt --check` 与 `cargo check` 已通过；真实数量校验需在已连接 GitHub 后点击“同步 Stars”完成。
  - Files: `apps/desktop/src-tauri/src/auth.rs`、`apps/desktop/src-tauri/src/github.rs`、`apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

- [x] Task 2.3: README 抓取与缓存
  - Status: 已完成。基于本地 active 仓库抓取 GitHub README，解析 base64 内容，计算 SHA-256 content hash，保存 `repo_readmes`；hash 未变化时跳过写入，无 README 的仓库计入 missing，不阻断整体任务。
  - Acceptance: README 原文和 hash 入库，hash 未变跳过处理。
  - Verify: `pnpm build`、`cargo fmt` 与 `cargo check` 已通过；真实缓存命中需在已同步 Stars 后点击“抓取 README”重复执行验证。
  - Files: `apps/desktop/src-tauri/src/auth.rs`、`apps/desktop/src-tauri/src/github.rs`、`apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`、`apps/desktop/src-tauri/Cargo.toml`

## Phase 3: Core Management

- [x] Task 3.1: Star 工作台列表
  - Status: 已完成。Tauri 后端提供本地仓库列表分页查询，前端工作台展示 name、description、language、topics、starred_at、stars_count、forks_count 和 README 缓存状态，并提供刷新入口。
  - Acceptance: 展示核心字段，支持外链跳转，最多加载 1000 条数据并在列表容器内滚动。
  - Verify: `pnpm build`、`cargo fmt --check` 与 `cargo check` 已通过。
  - Files: `apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

- [x] Task 3.2: 标签与笔记
  - Status: 已完成。注解层已接入本地 SQLite，支持标签 CRUD、仓库打标、阅读状态和 Markdown 笔记；GitHub 同步仍只写事实层，不覆盖用户整理内容。
  - Acceptance: 标签 CRUD、仓库打标、Markdown 笔记可用，同步不覆盖注解。
  - Verify: `pnpm build`、`cargo fmt --check` 与 `cargo check` 已通过；真实同步前后注解一致性需在已连接 GitHub 后执行同步回归。
  - Files: `apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

- [x] Task 3.3: 关键词搜索与筛选
  - Status: 已完成。本地仓库查询已支持关键词、language、tag 组合筛选；关键词覆盖仓库名称、描述、语言、Topics 和用户笔记；前端 Star 工作台已接入搜索框、语言筛选、标签筛选和重置入口。
  - Acceptance: 支持关键词、language、tag 组合筛选。
  - Verify: `pnpm build` 与 `cargo check`。
  - Files: `apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

## Phase 4: AI Knowledge MVP

- [x] Task 4.1: AI 服务适配层
  - Status: 已完成。领域层补齐 `AiRepositoryDocument.readmeZh`；`ai` 包提供 Provider 元信息、能力声明、摘要、翻译、查询理解标准接口，并保留可选 Embedding 边界但默认不启用；桌面后端已接入 OpenAI、OpenAI 兼容接口与 Anthropic，支持用户在应用内填写请求地址、API Key 和模型 ID。
  - Acceptance: 业务层只依赖标准接口，桌面运行时使用真实远程 AI 协议，离线测试使用请求桩验证协议封装。
  - Verify: `pnpm build` 与 `cargo check`。
  - Files: `packages/domain/src/index.ts`、`packages/ai/src/index.ts`、`packages/worker/src/index.ts`

- [x] Task 4.2: README 中文摘要
  - Status: 已完成。`StoragePort` 已补齐 AI 文档读取与 README AI 候选项接口；桌面后端支持单仓与批量摘要，按 README `contentHash` 跳过未变化内容；AI 结果包含中文摘要、README 中文梳理、关键词、推荐标签与 token 用量。
  - Acceptance: 摘要、关键词、推荐标签可生成，hash 未变不重复生成。
  - Verify: `pnpm build` 与 `cargo check`。
  - Files: `packages/storage/src/index.ts`、`packages/ai/src/index.ts`、`packages/worker/src/index.ts`

- [x] Task 4.3: 项目详情页中文展示
  - Status: 已完成。Tauri 后端新增仓库详情查询，按账号边界读取 README 缓存与 AI 派生文档；前端详情区展示 AI 中文摘要、关键词、推荐标签、README 原文、标签、阅读状态和用户笔记。AI 派生数据保持只读展示，不写入用户注解层。
  - Acceptance: 详情页展示中文摘要、README 原文、标签、笔记。
  - Verify: `pnpm build` 与 `cargo check`。
  - Files: `apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

## Phase 5: Natural Language Search

- [x] Task 5.1: 查询 DSL
  - Status: 已完成。领域层新增标准 `RepoQuery` DSL、默认查询、分页边界、查询模式和归一化入口；搜索层新增默认解释器，可将关键词筛选、language/tag 过滤和自然语言查询统一转换为 `RepoQuery`。
  - Acceptance: 普通筛选和自然语言查询使用统一 `RepoQuery`。
  - Verify: `packages/domain/src/index.ts`、`packages/search/src/index.ts` 静态诊断无新增错误；本机 `cargo check` 需要先清理旧目录构建缓存后复跑。
  - Files: `packages/domain/src/index.ts`、`packages/search/src/index.ts`

- [ ] Task 5.2: zvec 本地向量索引
  - Status: 已规划，暂不进入当前上线主链路。当前产品知识库能力基于普通 OpenAI/Anthropic 聊天协议生成 README 摘要、关键词、标签建议，并结合本地 SQLite/README/笔记/标签做知识检索；不要求用户配置向量模型，也不自动调用 Embeddings 接口。`VectorIndexPort` 和 zvec 路线保留为后续可选增强。
  - Acceptance: 向量记录带 model_version/source_hash，内容未变不重复生成，固定测试查询可召回预期仓库。
  - Verify: 当前仅保留包层向量边界测试；桌面端上线验收不依赖向量模型。待后续明确需要 zvec 时，再补 zvec adapter 单测、独立索引目录、重建入口和性能回归。
  - Files: `packages/domain/src/index.ts`、`packages/storage/src/index.ts`、`packages/search/src/index.ts`、`packages/worker/src/index.ts`

- [x] Task 5.3: 检索结果解释
  - Status: 已完成。领域层 `SearchResult` 已扩展中文解释和引用片段；搜索层新增解释生成器，可从仓库事实、AI 文档、README 和用户笔记生成中文匹配理由；自然语言搜索会携带最近对话上下文并复用同一结果解释结构。
  - Acceptance: 每个结果都有中文匹配理由和引用片段。
  - Verify: `pnpm build` 与 `cargo check`。
  - Files: `packages/domain/src/index.ts`、`packages/search/src/index.ts`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

## Phase 6: Long-term Usage

- [x] Task 6.1: 增量同步与全量重扫
  - Status: 已完成。同步命令现在以 GitHub 全量 starred 列表作为事实来源执行本地对账：新 Star 幂等写入，已有 Star 更新事实字段，未出现在本次 GitHub 返回中的 active 仓库标记为 removed；标签、笔记、README 和 AI 派生数据不删除、不覆盖。同步结果返回 active、新增、更新、移除统计并在前端展示。
  - Acceptance: 新 Star 加入，unstar 标记 removed，不删除注解。
  - Verify: `pnpm build` 与 `cargo check`；真实新增与取消 Star 对账需连接 GitHub 后重复执行同步验证。
  - Files: `apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`

- [x] Task 6.2: Gist 注解导入导出
  - Status: 已完成。注解层快照仅包含 tags、repo_tags、notes 和 read_status；导出通过 Secret Gist 保存 JSON 快照，导入只合并到当前账号本地已存在仓库，不创建 GitHub 事实数据，不包含 README、AI 派生数据、PAT 或完整数据库。
  - Acceptance: 只同步 tags、notes、tag metadata。
  - Verify: 前端静态诊断无新增错误；`cargo fmt --check` / `cargo check` / `pnpm build` 当前需在本机终端复跑确认。真实导入导出一致性需连接 GitHub 后使用 Secret Gist ID 回归验证。
  - Files: `apps/desktop/src-tauri/src/auth.rs`、`apps/desktop/src-tauri/src/github.rs`、`apps/desktop/src-tauri/src/storage.rs`、`apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`

- [x] Task 6.3: 成本与任务监控
  - Status: 已完成。AI 摘要记录输入/输出 token 用量；全局任务卡展示阶段、进度、当前仓库和失败原因；同步、README、AI 摘要、Gist 导入导出失败后均有重试入口；发布包真实链路自检会持久化非敏感检查记录。
  - Acceptance: 展示 AI 用量、失败任务、重试入口，并能区分运行中、完成、失败和部分失败。
  - Verify: `pnpm build` 与 `cargo check`。
  - Files: `apps/desktop/src/**`、`apps/desktop/src-tauri/src/**`、`scripts/**`
