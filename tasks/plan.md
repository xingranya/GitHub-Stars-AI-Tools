# Implementation Plan: GitHub-Stars-AI-Tools

## Overview

构建一个独立桌面应用，用于管理 GitHub Stars，并把 Star 列表自动转化为个人 AI 知识库。产品不保留浏览器插件形态，只保留原工具的核心管理能力，并支持 README 缓存、AI 中文摘要、AI 标签网络、自然语言上下文搜索、GitHub 相似项目发现和发布包自检记录。

## Architecture Decisions

- 使用 `Tauri 2 + React 19 + TypeScript` 作为首发形态。
- 使用 `SQLite` 做本地优先数据存储。
- 使用 `SQLite FTS5` 作为当前搜索能力，后续按 zvec 计划加入本地向量索引。
- 建立 AI 服务适配层，当前桌面运行时支持 OpenAI、OpenAI 兼容接口与 Anthropic，后续新增服务不影响业务层。
- GitHub 事实数据、用户注解、AI 派生结果分层存储。
- 插件专属能力不进入主线。
- GitHub Token 与 AI API Key 只在应用内设置并保存到系统凭据管理器，不要求普通安装包用户配置 `.env`。

## Task List

### Phase 1: Foundation

- [x] Task 1.1: 初始化 Tauri + React 项目
- [x] Task 1.2: 建立共享包结构
- [x] Task 1.3: 建立本地 SQLite 初始化机制

### Checkpoint: Foundation

- [x] 应用可启动
- [x] 数据库 schema 初始化可执行
- [x] 包依赖方向清晰

### Phase 2: GitHub Sync

- [x] Task 2.1: GitHub 认证
- [x] Task 2.2: 全量 Star 同步
- [x] Task 2.3: README 抓取与缓存

### Checkpoint: GitHub Sync

- [x] 能同步真实 GitHub Stars
- [x] 能持久化仓库事实数据
- [x] 能抓取 README

### Phase 3: Core Management

- [x] Task 3.1: Star 工作台列表
- [x] Task 3.2: 标签与笔记
- [x] Task 3.3: 关键词搜索与筛选

### Checkpoint: Core Management

- [x] 用户能整理 Star
- [x] 用户注解不会被同步覆盖
- [x] 1000 条数据下搜索可用

### Phase 4: AI Knowledge MVP

- [x] Task 4.1: AI 服务适配层
- [x] Task 4.2: README 中文摘要
- [x] Task 4.3: 项目详情页中文展示

### Checkpoint: AI Knowledge MVP

- [x] 用户能看到项目中文用途说明
- [x] AI 结果可缓存
- [x] 失败任务可重试

### Phase 5: Natural Language Search

- [x] Task 5.1: 查询 DSL
- [ ] Task 5.2: zvec 本地向量索引
- [x] Task 5.3: 检索结果解释

### Checkpoint: Search

- [x] 用户能用中文需求找到项目
- [x] 结果包含匹配理由
- [x] 不编造 README 中不存在的信息
- [x] 当前搜索不依赖向量模型

### Phase 6: Long-term Usage

- [x] Task 6.1: 增量同步与全量重扫
- [x] Task 6.2: Gist 注解导入导出
- [x] Task 6.3: 成本与任务监控

### Phase 7: AI Enhancement

- [x] Task 7.1: AI 标签网络
- [x] Task 7.2: GitHub 相似项目发现
- [x] Task 7.3: 自然语言搜索上下文

### Phase 8: Release Readiness

- [x] Task 8.1: 静态验收矩阵
- [x] Task 8.2: GitHub Actions 三端发版链路
- [x] Task 8.3: 发布包真实链路自检记录

### Phase 10: zvec Vector Index

- [x] Task 10.0: 本地向量索引基准实现
- [ ] Task 10.0a: 桌面端可选向量召回 fallback
- [ ] Task 10.1: 技术验证与数据边界确认
- [ ] Task 10.2: `VectorIndexPort` 与 zvec adapter
- [ ] Task 10.3: zvec 混合语义检索接入

### Phase 11: Local Embedding v1.5.0

- [x] Task 11.0: 冻结本地模型、工件校验与发布矩阵
- [x] Task 11.1: 本地模型下载、校验、加载和运行状态
- [x] Task 11.2: 批量生成、原子建库和增量维护
- [x] Task 11.3: 一键启用界面与远程高级设置
- [ ] Task 11.4: 中英质量、离线恢复和三平台发布验收

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| AI 功能过早复杂化 | MVP 延期 | 已先完成摘要、标签网络、搜索计划和推荐计划，向量检索按 Phase 10 单独推进 |
| GitHub API 限流 | 同步失败 | 分页、ETag、退避、增量同步 |
| AI 服务绑定单一厂商 | 后续新增服务成本高 | 统一 OpenAI / OpenAI 兼容 / Anthropic 配置结构，业务层只传标准请求配置 |
| 用户注解被同步覆盖 | 数据丢失 | 注解层与事实层分离 |

## Open Questions

- Phase 10 暂不进入当前上线主链路；是否接入 `alibaba/zvec` 应以后续明确需要向量模型且用户能接受配置成本为前提。
- 真实链路复核只在打包客户端的应用内完成，用户安装后填写自己的 GitHub Token 与 AI 配置即可自检，不需要安装前配置环境变量或额外脚本。
