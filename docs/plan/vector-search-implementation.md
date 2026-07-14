# Phase 10：zvec 精准检索实施规格

## 数据流

`用户问题 → 意图门控 → AI 查询理解（可选） → Query Embedding（可选） → zvec TopK → 严格关键词召回 → 融合精排 → Top 8/最多 10 → 证据约束回答`

## 任务

### P10.1 检索契约与配置（P0 / M）

- 增加独立 embedding Provider、baseUrl、API Key、model、dimensions、minScore、maxResults 配置。
- API Key 只写入系统凭据管理器，设置文件不保存明文。
- Anthropic 文本模型与 embedding Provider 解耦。
- 验收：配置可保存、读取、清理和测试；非法维度、阈值、数量会被归一化。

### P10.2 zvec Rust Adapter（P0 / L）

- 使用 `zvec-rust`，索引目录位于 Tauri app data 的 `vector-index/`。
- 按 `embedding_model + dimensions` 分桶，记录账号、仓库、source hash 和模型。
- SQLite 是事实源；zvec 缺失或损坏时从 `repo_embeddings` 恢复。
- 验收：创建、upsert、关闭重开、cosine 排序、账号隔离、模型/维度隔离测试通过。

### P10.3 索引生成与状态（P0 / L）

- 根据仓库名、描述、语言、Topics、AI 摘要、关键词、建议标签、个人标签和 README 片段生成知识文本；个人笔记不进入远程 Embedding 请求。
- 使用 source hash 跳过未变化记录；单仓失败不终止批次。
- 提供“测试 Embedding”和“重建向量索引”操作与进度。
- 验收：幂等重建、失败汇总、索引统计与清理行为可验证。

### P10.4 精准混合检索（P0 / L）

- 搜索前执行确定性意图门控。
- 上一轮上下文只能提高已有直接命中的排序，不能单独制造结果。
- 关键词候选必须达到最低分；向量候选必须达到 minScore。
- ASCII 技术词按完整词边界匹配；`AI`、`RAG`、`UI` 等短缩写不做宽泛 AI 扩写，向量候选必须同时有精确词命中。
- 多词关键词查询必须命中至少两个有效词，五个以上检索词至少命中三个；上下文只能对已命中候选加分。
- 融合后默认最多 8 条，硬上限 10 条。
- 验收：`你好` 返回 0 条；无关词不返回全库；语义同义查询能由向量召回；向量失败可回退。

### P10.5 RAG 回答与界面（P1 / M）

- 响应增加检索模式、向量状态、错误降级信息和回答正文。
- AI 回答只使用最终候选的仓库名、描述、Topics 和摘要，不发送个人笔记。
- 验收：回答和结果数量一致，空结果不编造项目，历史会话可兼容读取。

## 测试门槛

- Rust：意图门控、分词、最低分、上下文、TopK、融合排序、zvec 持久化与隔离。
- TypeScript：设置归一化、配置转换与响应兼容。
- 构建：共享包构建、桌面前端构建、Rust fmt/check/test。
- 完成判定：所有自动化测试通过，`你好` 为 0 条，任何搜索 `totalCount <= 10`，zvec smoke test 能关闭重开后保持排序。
