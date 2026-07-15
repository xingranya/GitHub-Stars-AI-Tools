# Embedding 运行时许可

v1.5.0 的本地向量能力使用以下开源组件和模型：

- `fastembed 5.17.3`：Apache-2.0。
- `hf-hub 0.5.0`：Apache-2.0。
- ONNX Runtime 1.24.2：MIT/Apache-2.0。
- `intfloat/multilingual-e5-small`：MIT，固定 revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`。

模型只在用户首次确认后下载到本机应用缓存，不随安装包分发。用户可选择 Hugging Face 固定 revision，或使用工件完全一致的 ModelScope 国内镜像提交；应用在加载前始终校验文件大小和 SHA-256。
