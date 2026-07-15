# 发布维护文档

这份文档只给维护者使用，普通用户阅读 README 即可。

## 本地验证

开发环境需要 Node.js >= 24、pnpm >= 11 和 Rust。

```bash
corepack enable
pnpm install
pnpm --filter @gsat/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## 本机打包

```bash
pnpm package:desktop
pnpm package:desktop:dmg
```

`pnpm package:desktop` 会先构建共享包，再执行真实 Tauri bundle 打包。macOS 可用 `pnpm package:desktop:dmg` 生成拖拽安装 DMG，Finder 中应用与 Applications 图标均使用 192px 大图标布局，生成后会执行 DMG 完整性校验。

## GitHub Actions 发版

进入 **Actions → Release Desktop Apps → Run workflow**，填写：

- `version`：版本号，例如 `0.1.0` 或 `v0.1.0`
- `changelog`：简短更新日志
- `changelog_file`：可选，仓库内 Markdown 更新日志路径
- `release_draft`：是否先创建草稿 Release
- `prerelease`：是否标记为预发布版本

工作流会构建并上传：

- macOS：Apple Silicon `.dmg` 和 updater `.app.tar.gz`
- Windows：`.msi` 或 `setup.exe`
- Linux：`.deb`、`.rpm` 或 `.AppImage`

`v1.5.0` 的本地 Embedding 运行时只提供 `aarch64-apple-darwin` 预编译依赖，因此不再构建 macOS Intel 安装包。发布结束后，工作流会核对三平台安装包、签名文件和 `latest.json`，任一产物缺失都会使发布任务失败。

## 应用内更新

应用内更新使用 GitHub Releases 的静态 `latest.json`，端点固定为：

```text
https://github.com/xingranya/GitHub-Stars-AI-Tools/releases/latest/download/latest.json
```

发布前必须配置 GitHub Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`：Tauri updater 私钥
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码

Release workflow 会生成 updater artifact、`.sig` 和 `latest.json`。正式更新请使用普通 Release；draft 和 prerelease 不作为默认更新源。

## 更新验收

1. 安装一个旧版本。
2. 发布更高版本的正式 Release。
3. 打开旧版本应用。
4. 到“设置 → 通用设置 → 应用更新”检查更新。
5. 确认能看到新版本、更新说明、下载进度和重启入口。
