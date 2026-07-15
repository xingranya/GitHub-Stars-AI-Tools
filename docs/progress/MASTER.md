# MASTER：GitHub-Stars-AI-Tools

## 当前状态

- 模式：LOCAL_ONLY
- 阶段：Phase 11 本地 Embedding 官方版本实施中
- 当前任务：完成本地模型首次下载、离线推理、自动建库和发布验收。
- 日期：2026-07-15

## 产品边界

本项目是独立应用，不是浏览器插件迁移。

保留能力：

- GitHub Stars 同步
- Star 列表管理
- 搜索与筛选
- 标签与笔记
- 批量整理
- 完整分页与权威对账同步
- 注解层导入导出
- README 中文摘要与翻译
- AI 知识库
- 自然语言检索
- AI 标签网络
- GitHub 相似项目发现
- 发布包自检记录

不做能力：

- Chrome Extension
- Manifest V3
- content script
- GitHub 页面注入
- GitHub 页面浮动按钮
- Repo 页面 tag chip 主线能力

## 文档索引

### 分析文档

- [项目分析](../analysis/project-overview.md)
- [模块清单](../analysis/module-inventory.md)
- [风险评估](../analysis/risk-assessment.md)
- [AI 检索质量审查](../analysis/search-quality-audit.md)

### 计划文档

- [产品规格](../plan/product-spec.md)
- [架构规格](../plan/architecture-spec.md)
- [任务拆解](../plan/task-breakdown.md)
- [zvec 向量能力接入计划](../plan/zvec-vector-roadmap.md)
- [zvec 精准检索实施规格](../plan/vector-search-implementation.md)
- [本地 Embedding 官方版本实施规格](../plan/local-embedding-v1.md)
- [Embedding 运行时许可](../licenses/embedding-runtime.md)
- [依赖图](../plan/dependency-graph.md)
- [里程碑](../plan/milestones.md)

### 执行入口

- [实现计划](../../tasks/plan.md)
- [任务清单](../../tasks/todo.md)

## 阶段进度

- [x] Phase 0：规格冻结（1/1）
- [x] Phase 1：项目骨架与基础设施（3/3）
- [x] Phase 2：GitHub 同步闭环（3/3）
- [x] Phase 3：Star 管理核心能力（3/3）
- [x] Phase 4：AI 知识库 MVP（3/3）
- [x] Phase 5：自然语言检索（3/3）
- [x] Phase 6：同步与发布增强（3/3）
- [x] Phase 7：AI 标签网络与 GitHub 相似项目发现
- [x] Phase 8：静态验收矩阵、任务监控与发布包验收项
- [x] Phase 9：成本统计与发布包自检记录
- [x] Phase 10：[zvec 本地向量索引与混合语义检索](phase-10-vector-search.md)（6/6）
- [ ] Phase 11：[本地 Embedding 官方版本](phase-11-local-embedding.md)（5/6）

## 下一步

实现 `v1.5.0` 本地 Embedding 全链路，并保持 10 条硬上限、对话门控和个人笔记隐私边界。

## 关键约束

- 业务逻辑不能写死在 Tauri 壳中。
- UI 不能直接调用 GitHub SDK 或模型 SDK。
- GitHub 事实数据、用户注解、AI 派生数据必须分层。
- AI 服务适配层必须支持 OpenAI、OpenAI 兼容接口和 Anthropic，并保留后续扩展边界。
- README 中文处理必须基于 hash 缓存，避免重复扣费。
- 用户 notes 默认不发送给 AI。
- 普通用户只在应用内填写 GitHub Token 与 AI Key；源码、GitHub Actions 和发布包不要求安装前配置 `.env`，也不要求普通用户参与发布验收。
- 日常提交检查只运行构建和编译检查，避免把 `target/`、`dist/` 或安装包产物带回工作树。
