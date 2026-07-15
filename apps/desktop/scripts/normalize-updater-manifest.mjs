import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_ASSET_NAMES = {
  'darwin-aarch64': (version) => `GitHub-Stars-AI-Tools_${version}_aarch64.app.tar.gz`,
  'darwin-aarch64-app': (version) => `GitHub-Stars-AI-Tools_${version}_aarch64.app.tar.gz`,
  'linux-x86_64': (version) => `GitHub-Stars-AI-Tools_${version}_amd64.AppImage`,
  'linux-x86_64-appimage': (version) => `GitHub-Stars-AI-Tools_${version}_amd64.AppImage`,
  'linux-x86_64-deb': (version) => `GitHub-Stars-AI-Tools_${version}_amd64.deb`,
  'linux-x86_64-rpm': (version) => `GitHub-Stars-AI-Tools-${version}-1.x86_64.rpm`,
  'windows-x86_64': (version) => `GitHub-Stars-AI-Tools_${version}_x64-setup.exe`,
  'windows-x86_64-nsis': (version) => `GitHub-Stars-AI-Tools_${version}_x64-setup.exe`,
};

const REQUIRED_PLATFORMS = [
  'darwin-aarch64',
  'linux-x86_64',
  'windows-x86_64',
];

/**
 * 将 Tauri updater 清单中的 GitHub API 资产地址替换为公开下载地址。
 */
export function normalizeUpdaterManifest(manifest, repository, tagName, version) {
  validateReleaseIdentity(repository, tagName, version);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('updater 清单必须是 JSON 对象。');
  }
  if (manifest.version !== version) {
    throw new Error(`updater 清单版本为 ${manifest.version ?? '空'}，预期为 ${version}。`);
  }
  if (!manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
    throw new Error('updater 清单缺少 platforms 对象。');
  }

  for (const platform of REQUIRED_PLATFORMS) {
    if (!manifest.platforms[platform]) {
      throw new Error(`updater 清单缺少 ${platform}。`);
    }
  }

  const normalized = structuredClone(manifest);
  for (const [platform, platformEntry] of Object.entries(normalized.platforms)) {
    const assetNameFactory = PLATFORM_ASSET_NAMES[platform];
    if (!assetNameFactory) {
      throw new Error(`updater 清单包含未支持的平台键：${platform}。`);
    }
    if (!platformEntry || typeof platformEntry !== 'object' || Array.isArray(platformEntry)) {
      throw new Error(`${platform} 的 updater 配置必须是对象。`);
    }
    if (typeof platformEntry.signature !== 'string' || platformEntry.signature.length === 0) {
      throw new Error(`${platform} 缺少 updater 签名。`);
    }

    const assetName = assetNameFactory(version);
    platformEntry.url = buildPublicAssetUrl(repository, tagName, assetName);
  }
  return normalized;
}

/**
 * 构建无需 GitHub API 凭据即可访问的 Release 资产地址。
 */
export function buildPublicAssetUrl(repository, tagName, assetName) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`;
}

function validateReleaseIdentity(repository, tagName, version) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`GitHub 仓库格式无效：${repository}`);
  }
  if (!/^v?[0-9A-Za-z][0-9A-Za-z.-]*$/.test(tagName)) {
    throw new Error(`Release 标签格式无效：${tagName}`);
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`版本号格式无效：${version}`);
  }
}

function runCli() {
  const [manifestPath, repository, tagName, version, ...extraArguments] = process.argv.slice(2);
  if (!manifestPath || !repository || !tagName || !version || extraArguments.length > 0) {
    throw new Error('用法：node normalize-updater-manifest.mjs <latest.json> <owner/repo> <tag> <version>');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const normalized = normalizeUpdaterManifest(manifest, repository, tagName, version);
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`);
  renameSync(temporaryPath, manifestPath);
  console.log(`已规范化 updater 清单公开下载地址：${manifestPath}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
