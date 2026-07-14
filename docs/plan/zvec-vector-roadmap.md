# zvec 向量能力接入计划

## 背景

GSAT 当前以 SQLite 作为本地事实源，已经具备 Stars 元数据、README、AI 摘要、标签、笔记和自然语言搜索上下文。后续可以引入 `alibaba/zvec` 作为本地嵌入式向量索引层，增强语义搜索、相似项目发现、标签网络和本地 RAG 能力。

## 总体原则

- SQLite 继续作为唯一事实源，保存账号、仓库、README、AI 文档、标签、笔记、同步状态和 schema 版本记录。
- zvec 只作为可重建的本地向量索引，不直接承载主业务数据。
- 所有向量记录必须带 `account_id`、`repo_id`、`source_kind`、`source_hash`、`embedding_model`、`dimensions` 和 `indexed_at`。
- 向量索引损坏或版本不兼容时，必须能从 SQLite 重新生成，不影响已同步数据。
- 首版作为可选增强能力接入，不能影响现有关键词搜索、组合筛选、AI 摘要和标签网络主流程。

## 分阶段计划

### Phase Z1：技术验证

**目标**：确认 zvec 能在 Tauri 发布环境中稳定运行。

**任务**：

- 验证 zvec 的 Rust/Node 接口形态、License、平台支持和打包依赖。
- 在 macOS release 构建中验证 zvec 数据目录读写。
- 确认 Windows、Linux 打包是否需要额外动态库或资源声明。
- 写一个最小连通性验证：创建索引、写入 3 条向量、按 query vector 返回 TopK。

**验收**：

- 不启动桌面应用也能检查向量索引创建、写入、查询、关闭和重开。
- macOS、Windows、Linux 打包前需要确认相关动态库和数据目录声明完整。

### Phase Z2：向量索引 Port

**目标**：把 zvec 接到现有 `VectorIndexPort`，保持实现可替换。

**任务**：

- 新增 `packages/vector` 或在 `packages/search` 下新增 zvec adapter。
- 实现 `upsertRepositoryEmbedding(record)`。
- 实现 `searchRepositoryEmbeddings({ vector, accountId, limit, minScore })`。
- 索引路径使用 Tauri app data 目录下的 `vector-index/`。
- 过滤字段至少支持 `account_id`、`source_kind`、`embedding_model`。

**验收**：

- 固定向量样本能按 cosine/dot score 返回稳定排序。
- 不同账号的数据互不召回。
- 删除或重建索引后可从 SQLite 元数据恢复。

### Phase Z3：Embedding 生成与同步

**目标**：把 README、AI 摘要和笔记转为可搜索向量。

**任务**：

- 增加 embedding 配置：Provider、baseUrl、apiKey、modelId、dimensions。
- OpenAI/OpenAI-compatible 使用 embeddings endpoint。
- Anthropic Provider 下提示需单独配置兼容 embedding Provider。
- 生成内容优先级：`summary_zh + keywords + suggested_tags + description + topics + note_md`。
- 按 `source_hash` 幂等跳过未变化内容。
- 后台任务队列中新增“生成向量索引”任务和进度事件。

**验收**：

- 同一个仓库内容不变时不会重复生成向量。
- AI 摘要更新后对应向量会重新生成。
- 单仓失败不会影响其他仓库向量化。

### Phase Z4：混合检索

**目标**：自然语言搜索从“本地关键词/上下文评分”升级为“关键词 + 向量召回”。

**任务**：

- AI 搜索页保留当前 SQL 搜索结果。
- 查询文本生成 query embedding 后走 zvec TopK。
- 将 SQL 结果与 zvec 结果按归一化分数融合。
- 搜索结果解释新增“语义相似命中”。
- 没有 embedding 配置或索引为空时自动退回当前搜索。

**验收**：

- 语义查询能召回同义但未直接包含关键词的仓库。
- 向量层不可用时搜索仍可正常返回关键词结果。
- `contextQueriesUsed` 和 `contextApplied` 继续保留。

### Phase Z5：能力扩展

**目标**：把向量能力用于更高阶功能。

**任务**：

- 相似项目发现：先用本地 zvec 找相似 Stars，再让 AI 生成 GitHub Search 策略。
- 标签网络：先按向量聚类找候选簇，再让 AI 命名标签。
- 仓库详情：展示“本地相似 Stars”列表。
- 提供“重建向量索引”按钮和索引状态面板。

**验收**：

- 选中 1 到 8 个仓库时，能返回本地相似仓库和 GitHub 外部推荐。
- 标签网络生成结果更稳定，重复标签减少。
- 用户可以手动重建向量索引并看到进度。

## 风险与处理

- zvec API 或打包方式变化：通过 `VectorIndexPort` 隔离实现，保留内存向量索引或 SQLite FTS 作为回退。
- 向量成本过高：仅对仓库公开元数据、AI 摘要和截断 README 生成单条知识向量，不发送个人笔记，也不做 README 全文分片。
- 模型维度变化：索引按 `embedding_model + dimensions` 分桶，切换模型时新建索引或触发重建。
- 数据隐私：embedding 生成只在用户主动配置 AI 服务后执行，并在界面明确提示会发送摘要文本到配置的服务。

## 当前状态

- 已接入 `zvec-rust 0.5.1`，按账号、模型和维度隔离 HNSW cosine 索引。
- SQLite `repo_embeddings` 是向量事实源；zvec 缺失、为空或损坏时可自动恢复或手动重建。
- 设置页已提供独立 Embedding Provider、地址、凭据、模型、维度、阈值、结果数、连接测试、索引状态和重建操作。
- AI 搜索已接入问候语门控、严格关键词门槛、zvec TopK、融合精排、默认 Top 8 和最多 10 条硬上限。
- 向量能力默认关闭；未配置或请求失败时自动降级为严格关键词检索。
