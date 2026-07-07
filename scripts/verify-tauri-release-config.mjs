import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

const rootPackage = JSON.parse(read('package.json'));
const desktopPackage = JSON.parse(read('apps/desktop/package.json'));
const tauriConfig = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
const readme = read('README.md');
const gitignore = read('.gitignore');
const workflowPath = 'release.yml';
const workflow = read(`.github/workflows/${workflowPath}`);

assert.equal(tauriConfig.bundle?.active, true, 'Tauri bundle.active 必须开启，发布版要生成安装包');
assert.equal(tauriConfig.bundle?.targets, 'all', 'Tauri bundle.targets 应保持 all，让各平台 runner 生成本平台安装包');
assert.equal(tauriConfig.productName, 'GitHub-Stars-AI-Tools', '安装包产品名必须使用正式名称');
assert.equal(tauriConfig.app?.windows?.[0]?.title, 'GitHub-Stars-AI-Tools', '窗口标题必须使用正式名称');
assert.ok(Array.isArray(tauriConfig.bundle.icon), 'Tauri bundle.icon 必须声明图标数组');
for (const icon of ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.ico', 'icons/icon.png']) {
  assert.ok(tauriConfig.bundle.icon.includes(icon), `缺少安装包图标：${icon}`);
  assert.ok(existsSync(join(root, 'apps/desktop/src-tauri', icon)), `图标文件不存在：${icon}`);
}

assert.equal(desktopPackage.scripts.tauri, 'tauri', 'desktop tauri 脚本必须直连 Tauri CLI');
assert.equal(rootPackage.scripts['package:desktop'], 'pnpm build:packages && pnpm --filter @gsat/desktop tauri build', 'package:desktop 必须先构建共享包，再执行真实 Tauri bundle 打包');
assert.equal(rootPackage.scripts['verify:release'], 'pnpm verify:tauri-release-config && pnpm package:desktop', 'verify:release 必须先校验发布配置，再生成安装包');

const releaseScriptText = `${rootPackage.scripts['package:desktop']}\n${rootPackage.scripts['verify:release']}`;
assert.doesNotMatch(releaseScriptText, /--no-bundle/, '发布脚本禁止使用 --no-bundle，不能只产出二进制文件');
assert.doesNotMatch(
  readme,
  /build --no-bundle|--no-bundle[^。\n]*(?:发布|验收|安装包)|(?:发布包|发版|verify:release)[^。\n]*不生成安装包/,
  'README 不能把 --no-bundle 二进制描述成发布验收',
);
assert.match(readme, /pnpm package:desktop/, 'README 必须给出真实桌面安装包打包命令');
assert.match(readme, /workflow_dispatch|Run workflow|版本号|更新日志/, 'README 必须说明网页端手动发版流程');
assert.match(readme, /\.dmg/, 'README 必须说明 macOS dmg 产物');
assert.match(readme, /Apple Silicon[\s\S]*Intel|Intel[\s\S]*Apple Silicon/, 'README 必须说明 macOS Apple Silicon 与 Intel 两套安装包');
assert.match(readme, /\.msi|setup\.exe/, 'README 必须说明 Windows 安装包产物');
assert.match(readme, /\.deb|\.rpm|\.AppImage/, 'README 必须说明 Linux 安装包产物');

for (const ignoredArtifact of ['*.app/', '*.dmg', '*.msi', '*.exe', '*.deb', '*.rpm', '*.AppImage']) {
  assert.match(gitignore, new RegExp(`^${escapeRegExp(ignoredArtifact)}$`, 'm'), `.gitignore 必须忽略本地 Tauri 打包产物：${ignoredArtifact}`);
}
for (const ignoredLocalConfig of ['.env', '.env.*']) {
  assert.match(gitignore, new RegExp(`^${escapeRegExp(ignoredLocalConfig)}$`, 'm'), `.gitignore 必须忽略本地凭据配置：${ignoredLocalConfig}`);
}

assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/, 'Release workflow 必须支持网页端手动运行');
assert.match(workflow, /version:/, 'Release workflow 必须要求填写版本号');
assert.match(workflow, /changelog:/, 'Release workflow 必须要求填写更新日志');
assert.match(workflow, /contents:\s*write/, 'Release workflow 必须具备写 Release 的 contents: write 权限');
assert.match(workflow, /macos-latest/, 'Release workflow 必须覆盖 macOS');
assert.match(workflow, /windows-latest/, 'Release workflow 必须覆盖 Windows');
assert.match(workflow, /ubuntu-22\.04|ubuntu-latest/, 'Release workflow 必须覆盖 Linux');
assert.match(workflow, /platform:\s*macOS Apple Silicon[\s\S]*?args:\s*--target aarch64-apple-darwin/, 'Release workflow 必须构建 macOS Apple Silicon 安装包');
assert.match(workflow, /platform:\s*macOS Intel[\s\S]*?args:\s*--target x86_64-apple-darwin/, 'Release workflow 必须构建 macOS Intel 安装包');
assert.match(workflow, /Install Rust target[\s\S]*?if:\s*matrix\.rust_targets != ''[\s\S]*?rustup target add \$\{\{ matrix\.rust_targets \}\}/, 'Release workflow 必须只在矩阵声明 target 时安装 macOS 交叉编译 target');
assert.match(workflow, /tauri-apps\/tauri-action@v1/, 'Release workflow 必须使用 Tauri 官方 GitHub Action 上传安装包');
assert.match(workflow, /tagName:/, 'Release workflow 必须用版本号生成 Release tag');
assert.match(workflow, /releaseBody:/, 'Release workflow 必须把更新日志写入 Release');
assert.match(workflow, /uploadPlainBinary:\s*false/, 'Release workflow 必须禁止上传裸二进制文件');
assert.match(workflow, /args:\s*\$\{\{ matrix\.args \}\}/, 'Release workflow 必须把平台矩阵中的 Tauri build 参数传给 Tauri Action');
assert.match(workflow, /Sync release version/, 'Release workflow 必须在构建前同步安装包内部版本号');
assert.match(workflow, /Refresh Cargo lockfile[\s\S]*?cargo metadata --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml --format-version 1/, 'Release workflow 必须在同步 Cargo.toml 后刷新 Cargo.lock');
assert.match(workflow, /Verify synced release version/, 'Release workflow 必须在同步版本号后复核配置一致性');
assert.match(workflow, /Cargo\.lock 中 gsat-desktop 版本号/, 'Release workflow 必须复核 Cargo.lock 中本地 crate 版本号');
assert.match(workflow, /Run MVP verification[\s\S]*?pnpm verify:mvp/, 'Release workflow 必须在发布安装包前运行完整 MVP 静态验收');
assert.match(workflow, /apps\/desktop\/src-tauri\/tauri\.conf\.json/, 'Release workflow 必须同步 Tauri 配置版本');
assert.match(workflow, /apps\/desktop\/src-tauri\/Cargo\.toml/, 'Release workflow 必须同步 Rust crate 版本');
assert.match(workflow, /apps\/desktop\/package\.json/, 'Release workflow 必须同步桌面 package 版本');
assert.match(workflow, /libwebkit2gtk-4\.1-dev/, 'Linux runner 必须安装 Tauri v2 WebKitGTK 依赖');
assert.match(workflow, /libayatana-appindicator3-dev/, 'Linux runner 必须安装 AppIndicator 依赖');
assert.match(workflow, /librsvg2-dev/, 'Linux runner 必须安装图标渲染依赖');
assert.match(workflow, /patchelf/, 'Linux runner 必须安装 AppImage 打包依赖');
assert.match(workflow, /xdg-utils/, 'Linux runner 必须安装 xdg-utils');
assert.doesNotMatch(workflow, /--no-bundle/, 'Release workflow 禁止使用 --no-bundle');
const workflowInputs = workflow.match(/workflow_dispatch:\n\s+inputs:\n([\s\S]*?)\n\npermissions:/)?.[1] ?? '';
assert.doesNotMatch(
  workflowInputs,
  /^\s+(github_token|githubToken|github_pat|ai_key|aiKey|api_key|apiKey|openai|anthropic|base_url|baseUrl):/im,
  'Release workflow 的手动输入只能是版本与发布说明，不能要求填写 GitHub Token 或 AI Key',
);

console.log('Tauri release configuration verification passed.');

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
