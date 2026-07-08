# MASTER：GitHub-Stars-AI-Tools

## 当前状态

- 模式：LOCAL_ONLY
- 阶段：Phase 9 静态验收与发布包自检闭环完成，Phase 10 zvec 本地向量索引待实施
- 当前任务：AI 设置、GitHub 同步、README 缓存、AI 摘要、AI 标签网络、自然语言上下文搜索、GitHub 相似推荐、任务进度、失败重试、发布包配置与自检记录已接入；桌面端上线主链路不要求向量模型，下一步进入发布包真实链路复核，zvec adapter 作为后续可选增强保留。
- 日期：2026-07-06

## 产品边界

本项目是独立应用，不是浏览器插件迁移。

保留能力：

- GitHub Stars 同步
- Star 列表管理
- 搜索与筛选
- 标签与笔记
- 批量整理
- 增量同步与全量重扫
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

### 计划文档

- [产品规格](../plan/product-spec.md)
- [架构规格](../plan/architecture-spec.md)
- [任务拆解](../plan/task-breakdown.md)
- [zvec 向量能力接入计划](../plan/zvec-vector-roadmap.md)
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
- [ ] Phase 10：zvec 本地向量索引与混合语义检索（当前上线主链路暂不依赖向量模型，zvec adapter 待后续评估）

## 下一步

下一步应在打包应用内通过欢迎页或设置页填写 GitHub Token、AI 请求地址、API Key 和模型 ID，运行真实链路自检并确认发布包自检记录写入成功，完成本地数据库、应用设置存储、账号连接、Stars 同步、README 抓取、AI 摘要、AI 标签网络与相似推荐复核。随后按 `docs/plan/zvec-vector-roadmap.md` 推进 zvec 本地向量索引。不改变 GitHub 事实层、用户注解层和 AI 派生层的既有边界。

## 关键约束

- 业务逻辑不能写死在 Tauri 壳中。
- UI 不能直接调用 GitHub SDK 或模型 SDK。
- GitHub 事实数据、用户注解、AI 派生数据必须分层。
- AI 服务适配层必须支持 OpenAI、OpenAI 兼容接口和 Anthropic，并保留后续扩展边界。
- README 中文处理必须基于 hash 缓存，避免重复扣费。
- 用户 notes 默认不发送给 AI。
- 普通用户只在应用内填写 GitHub Token 与 AI Key；源码、GitHub Actions 和发布包不要求安装前配置 `.env`，也不要求普通用户参与发布验收。
- 日常提交检查只运行构建和编译检查，避免把 `target/`、`dist/` 或安装包产物带回工作树。
