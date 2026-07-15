# Phase 11：本地 Embedding 官方版本

- [x] P11.0 冻结 `v1.5.0` 规格、模型 revision、工件校验和发布矩阵
- [x] P11.1 本地模型工件管理、Provider 与运行状态
- [x] P11.2 批量向量生成、SQLite 事实源与 zvec 原子建库
- [x] P11.3 首次启用下载、状态展示与远程高级设置
- [x] P11.4 自动增量维护、错误恢复与离线运行
- [ ] P11.5 中英检索质量、三平台构建与发布验收

## Notes

- SQLite 用户数据不得因模型或索引升级被重置。
- 当前工作树包含 Phase 10 的原子重建、指纹恢复、内容失效与凭据隔离修复，Phase 11 在其上继续实现。
- fastembed 5.17.3 的 ORT 预编译运行时不提供 macOS Intel，因此 `v1.5.0` 停止该平台发布。
- 自动化验证：Rust 166 项通过、2 项真实模型测试按需执行，前端 7 项、共享包构建、clippy 和 Apple Silicon release 构建通过。
- 真实模型验证：固定 revision 下载、SHA-256 校验、L2 归一化、中文查询、英文知识文本排序和缓存重载通过。
- 中英质量集：混合 Recall@8 0.925、跨语言 Recall@8 0.850、MRR@8 0.758；本地 E5 分数校准后选择默认阈值 0.80，Precision 0.875。
- Apple Silicon `.app` 已生成且版本为 1.5.0；Windows/Linux 构建和三端真实桌面交互留给发布 CI 验收。
