# 任务拆解：GitHub-Stars-AI-Tools

## 阶段 0：规格冻结

### Task 0.1 确认产品边界

**描述**：确认产品是独立应用，不保留浏览器插件形态。

**验收标准**：

- 明确“不做 Chrome 插件、Manifest V3、content script、GitHub 页面注入”。
- 明确保留 Star 管理核心能力。
- 文档中不再把插件能力作为 MVP。

**验证**：人工检查 `docs/analysis/project-overview.md` 与 `docs/plan/product-spec.md`。

**依赖**：无。

## 阶段 1：项目骨架与基础设施

### Task 1.1 初始化 Tauri + React 项目

**描述**：建立桌面应用基础结构。

**验收标准**：

- `apps/desktop` 可启动开发环境。
- React、TypeScript、Vite、Tauri 2 基础链路可运行。
- 基础布局包含导航、工作台和设置页的可用入口。

**验证**：

- `pnpm dev`
- `pnpm build`

**依赖**：Task 0.1。

### Task 1.2 建立共享包结构

**描述**：创建 `packages/domain`、`packages/storage`、`packages/github`、`packages/ai`、`packages/search`、`packages/worker`。

**验收标准**：

- 包之间有明确依赖方向。
- UI 不直接依赖 GitHub SDK 或模型 SDK。
- Domain 不依赖 Tauri。

**验证**：构建通过，依赖图无反向引用。

**依赖**：Task 1.1。

### Task 1.3 建立本地 SQLite 初始化机制

**描述**：实现数据库连接、完整 schema 初始化、基础 Repository。本机测试期旧 SQLite 不做迁移，结构不兼容时删除并重建。

**验收标准**：

- 创建账号、仓库、README、注解、标签、任务表。
- schema 初始化可重复执行。
- 测试库可独立初始化。

**验证**：数据库 schema 初始化测试通过。

**依赖**：Task 1.2。

## 阶段 2：GitHub 同步闭环

### Task 2.1 GitHub 认证

**描述**：实现 PAT 输入与保存，后续可替换 OAuth Device Flow。

**验收标准**：

- Token 保存到系统 Keychain 或安全存储引用。
- 应用能验证当前 GitHub 用户。
- 日志不输出 Token。

**验证**：输入有效 Token 后能展示 GitHub 用户信息。

**依赖**：Task 1.3。

### Task 2.2 全量 Star 同步

**描述**：分页拉取用户全部 starred repositories 并写入事实层。

**验收标准**：

- 支持 1000+ stars。
- 写入 `repositories`。
- 重复同步不产生重复数据。

**验证**：本地库记录数与 GitHub Star 数基本一致。

**依赖**：Task 2.1。

### Task 2.3 README 抓取与缓存

**描述**：抓取每个仓库 README 原文并按 hash 缓存。

**验收标准**：

- 有 README 的仓库保存原文与 hash。
- 无 README 或 404 标记为可解释状态。
- hash 未变化时跳过后续处理。

**验证**：重复执行不会重复抓取或重复入队。

**依赖**：Task 2.2。

## 阶段 3：Star 管理核心能力

### Task 3.1 Star 工作台列表

**描述**：实现 Star 列表展示、分页或虚拟滚动。

**验收标准**：

- 展示 name、description、language、topics、tags、starred_at。
- 1000 条数据滚动不卡顿。
- 点击项目进入详情。

**验证**：手动导入/同步后检查列表体验。

**依赖**：Task 2.2。

### Task 3.2 标签与笔记

**描述**：实现 tags、notes、收藏状态等注解能力。

**验收标准**：

- 可新增、删除、重命名标签。
- 可给仓库添加/移除标签。
- 可编辑 Markdown 笔记。
- 全量同步不会覆盖注解。

**验证**：同步前后注解保持一致。

**依赖**：Task 3.1。

### Task 3.3 关键词搜索与筛选

**描述**：实现 name、description、topics、notes、summary_zh 的关键词搜索与 language/tag 筛选。

**验收标准**：

- 搜索响应小于 300ms。
- 多条件筛选可组合。
- 空状态文案可直接上线。

**验证**：构造 1000 条数据进行搜索测试。

**依赖**：Task 3.2。

## 阶段 4：AI 知识库 MVP

### Task 4.1 AI 服务适配层

**描述**：定义统一 AI 服务接口，并接入 OpenAI、OpenAI 兼容接口与 Anthropic。

**验收标准**：

- 业务层只依赖接口。
- 支持摘要、翻译、查询理解的接口定义；Embedding 只作为后续可选能力边界保留。
- 后续新增模型服务时不影响业务层。

**验证**：用离线请求桩覆盖 OpenAI Chat Completions、OpenAI 兼容接口与 Anthropic Messages 请求封装。

**依赖**：Task 1.2。

### Task 4.2 README 中文摘要

**描述**：对 README 生成中文摘要、关键词和推荐标签。

**验收标准**：

- 摘要可解释项目用途。
- 内容 hash 未变不重复生成。
- 失败任务进入可重试状态。

**验证**：选 10 个仓库抽样检查摘要质量。

**依赖**：Task 2.3、Task 4.1。

### Task 4.3 项目详情页中文展示

**描述**：详情页展示中文摘要、README 原文、标签、笔记。

**验收标准**：

- 用户能不读英文 README 先理解项目用途。
- 中文摘要、原文、笔记层级清晰。
- README 渲染安全，不执行不可信 HTML。

**验证**：打开多个项目详情页人工检查。

**依赖**：Task 4.2。

## 阶段 5：自然语言检索

### Task 5.1 查询 DSL

**描述**：建立统一 `RepoQuery`，普通筛选和自然语言检索都转换为同一查询结构。

**验收标准**：

- UI 搜索和 AI 查询不各自造参数。
- 支持 text、language、tags、topics、sort、limit、offset。

**验证**：查询 DSL 单元测试通过。

**依赖**：Task 3.3。

### Task 5.2 zvec 本地向量索引

**描述**：用户主动启用独立 Embedding 配置后，对 repo name、description、language、topics、summary_zh、关键词、标签和 README 片段生成向量；个人笔记不发送给远程服务。未启用时继续使用严格关键词检索。

**zvec 实现**：向量库采用“SQLite 事实源 + zvec 可重建索引层”的方案，已完成 Embedding 后台任务、索引恢复、状态面板和混合检索。详细设计见 [zvec 向量能力接入计划](./zvec-vector-roadmap.md)。

**验收标准**：

- 向量记录带 model_version 和 source_hash。
- 内容不变不重复向量化。
- 可按 query embedding 找到相似项目。
- 没有 Embedding 配置或索引为空时，当前本地知识检索仍可正常工作。

**验证**：固定测试覆盖向量持久化、cosine 排序、账号和模型隔离、阈值过滤、严格关键词门槛、上下文限制、结果上限和 SQLite 恢复。

**依赖**：Task 4.2、Task 5.1。

### Task 5.3 检索结果解释

**描述**：返回匹配原因、中文用途、README 引用片段。

**验收标准**：

- 每个结果必须有“为什么匹配”。
- 结果可显示标签命中、语言命中、语义命中。
- 不编造 README 中不存在的信息。

**验证**：人工检查 Top 10 结果解释质量。

**依赖**：Task 5.2。

## 阶段 6：同步与发布增强

### Task 6.1 完整分页与权威对账

**描述**：支持定时或手动完整同步，并在全部分页成功后权威对账已取消的 Stars。

**验收标准**：

- 新 Star 自动加入。
- 已 unstar 项目标记 removed，不删除用户注解。
- GitHub API 限流时可恢复。

**验证**：模拟新增和取消 Star。

**依赖**：Task 2.2。

### Task 6.2 Gist 注解导入导出

**描述**：兼容原工具的注解层同步思路。

**验收标准**：

- 只同步 tags、notes、tag metadata。
- 不默认同步 README 和 AI 派生内容。
- 冲突策略明确。

**验证**：导出后导入到新数据库，注解一致。

**依赖**：Task 3.2。

### Task 6.3 成本与任务监控

**描述**：展示 AI 调用、失败任务、同步队列、重试入口。

**验收标准**：

- 用户知道当前处理进度。
- 用户知道 AI 用量和失败原因。
- 可重试失败任务。

**当前进展**：

- AI README 摘要已记录输入/输出 tokens 估算值，写入 `repo_ai_documents` 并在知识面板展示。
- SQLite 初始 schema 与持久化验证已覆盖 `input_tokens`、`output_tokens` 字段。
- 失败任务卡片已提供同步、README、AI 摘要、Gist 导出和 Gist 导入的重试入口。
- 任务进度卡片会展示当前阶段和正在处理的仓库名，欢迎页全屏任务也有同等反馈。
- 发布包真实链路复核项在打包应用内完成，覆盖本地数据库、应用设置存储、账号连接、Stars 同步、README 抓取、AI 摘要、AI 标签网络和相似推荐。
- 设置页真实链路自检完成后会持久化发布包自检记录，只保存检查时间和通过、失败、跳过数量，不保存 Token、AI Key 或错误详情。
- 真实链路复核只在打包应用内完成；用户安装后填写自己的 GitHub Token、AI 请求地址、API Key 和模型 ID 即可自检，不需要安装前配置环境变量或额外脚本。

**验证**：`pnpm build` 与 `cargo check`。

**依赖**：Task 4.2、Task 5.2。

## 依赖与并行策略

- 阶段 1 必须先完成。
- 阶段 2 与阶段 3 前半段可部分并行：UI 使用本地持久化数据和离线验收数据验证列表。
- 阶段 4 的 `AI 服务适配层` 可与 GitHub 同步并行。
- 阶段 5 必须依赖中文摘要和查询 DSL。
- 阶段 6 是增强项，可在 MVP 验收后推进。

## 验收检查点

- Checkpoint A：项目可启动，本地数据库可按最新 schema 初始化。
- Checkpoint B：能同步 Stars 并展示列表。
- Checkpoint C：能标签/笔记/搜索。
- Checkpoint D：能展示中文摘要。
- Checkpoint E：能自然语言找项目并解释原因。
