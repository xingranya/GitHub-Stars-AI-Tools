# Phase 11：本地 Embedding 官方版本实施规格

## 目标

`v1.5.0` 默认提供内置本地向量检索。用户首次启用时确认下载模型，应用完成工件校验、模型加载、仓库向量生成和 zvec 建库；准备完成后断网可用。OpenAI 与 OpenAI 兼容 Embedding 保留在高级设置。

## 固定模型配置

- 推理：`fastembed 5.17.3`、ORT 1.24.2、`hf-hub 0.5.0`。
- 模型：`intfloat/multilingual-e5-small`。
- revision：`614241f622f53c4eeff9890bdc4f31cfecc418b3`。
- 下载源：默认使用 ModelScope 国内源的固定提交 `1565e8a4587b93daf1d719018d6f880645fbd6e3`，可切换到 Hugging Face 官方源；两处工件的字节数和 SHA-256 必须与内置 manifest 一致。
- 输出：384 维、最大 512 tokens、batch 16、最多 4 个 CPU 线程。
- 协议：查询添加 `query: `，知识文本添加 `passage: `。
- 分数：本地 E5 原始余弦分数按 `0.70..1.00` 线性校准到用户可见的 `0..1`，默认最低相关度为 `0.80`；远程 Provider 不做校准。
- 模型缓存位于 Tauri app cache；SQLite 和 zvec 位于 app data。

模型工件必须按内置 manifest 校验大小与 SHA-256。所有工件通过后才原子写入 `ready.json`。模型身份包含 provider、revision、维度、最大长度、前缀协议和 `repository-knowledge-v2`，不同身份不得共用 SQLite 向量或 zvec bucket。

## 运行契约

运行状态固定为 `disabled`、`missing`、`downloading`、`verifying`、`loading`、`indexing`、`ready`、`partial`、`error`。下载不伪造百分比，索引阶段报告真实完成数。

后端通过 `EmbeddingProviderPort` 隔离本地和远程实现，由 `EmbeddingService` 统一处理 single-flight、模型生命周期、批量推理、重建和查询。关闭功能时保留缓存和索引；删除模型只清理模型缓存。任何准备或查询失败均回退严格关键词检索。

SQLite 是向量事实源，zvec 是可重建索引。知识数据变化时由持久化 dirty queue 记录待更新仓库；后台任务在启动和数据变更后自动补齐。重建使用完整快照与 zvec 原子替换，不能暴露半写入 bucket。

## 用户流程

首次开启显示约 490 MB 下载确认。用户可选择 ModelScope 国内源或 Hugging Face 官方源；连接被拒绝时提示切换下载源或检查代理/TUN 模式。确认后依次展示下载、校验、加载和建库状态；取消不修改设置。新用户默认本地模式，远程 Provider、URL、模型、维度和 API Key 收入高级设置。

## 验收

- 首次下载、缓存命中、断网重启、损坏恢复和并发启用均有自动化测试。
- 中、中英、英、英中四组各 10 条质量查询；混合 Recall@8 不低于 0.90，跨语言 Recall@8 不低于 0.80，MRR@8 不低于 0.70。
- 当前真实模型结果：混合 Recall@8 为 0.925、跨语言 Recall@8 为 0.850、MRR@8 为 0.758；阈值 0.80 时 Precision 为 0.875。
- 问候语返回零项目，任何查询最多返回 10 条，个人笔记不进入 Embedding。
- 官方发布支持 macOS Apple Silicon、Windows x64、Linux x64，不再发布 macOS Intel。
