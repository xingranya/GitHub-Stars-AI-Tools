import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicAssetUrl,
  normalizeUpdaterManifest,
} from './normalize-updater-manifest.mjs';

const platforms = {
  'darwin-aarch64': { signature: 'mac-signature', url: 'https://api.github.com/mac' },
  'darwin-aarch64-app': { signature: 'mac-signature', url: 'https://api.github.com/mac' },
  'linux-x86_64': { signature: 'appimage-signature', url: 'https://api.github.com/appimage' },
  'linux-x86_64-appimage': { signature: 'appimage-signature', url: 'https://api.github.com/appimage' },
  'linux-x86_64-deb': { signature: 'deb-signature', url: 'https://api.github.com/deb' },
  'linux-x86_64-rpm': { signature: 'rpm-signature', url: 'https://api.github.com/rpm' },
  'windows-x86_64': { signature: 'windows-signature', url: 'https://api.github.com/windows' },
  'windows-x86_64-nsis': { signature: 'windows-signature', url: 'https://api.github.com/windows' },
};

test('将全部 updater 平台映射到公开 Release 资产', () => {
  const original = { version: '1.5.0', platforms };
  const normalized = normalizeUpdaterManifest(
    original,
    'xingranya/GitHub-Stars-AI-Tools',
    'v1.5.0',
    '1.5.0',
  );

  assert.equal(
    normalized.platforms['windows-x86_64'].url,
    'https://github.com/xingranya/GitHub-Stars-AI-Tools/releases/download/v1.5.0/GitHub-Stars-AI-Tools_1.5.0_x64-setup.exe',
  );
  assert.equal(
    normalized.platforms['darwin-aarch64'].url,
    'https://github.com/xingranya/GitHub-Stars-AI-Tools/releases/download/v1.5.0/GitHub-Stars-AI-Tools_1.5.0_aarch64.app.tar.gz',
  );
  assert.equal(
    normalized.platforms['linux-x86_64-rpm'].url,
    'https://github.com/xingranya/GitHub-Stars-AI-Tools/releases/download/v1.5.0/GitHub-Stars-AI-Tools-1.5.0-1.x86_64.rpm',
  );
  assert.equal(normalized.platforms['linux-x86_64-deb'].signature, 'deb-signature');
  assert.equal(original.platforms['windows-x86_64'].url, 'https://api.github.com/windows');
});

test('公开资产地址会转义标签和文件名', () => {
  assert.equal(
    buildPublicAssetUrl('owner/repo', 'v1.5.0-beta.1', 'GSAT 1.5.0.exe'),
    'https://github.com/owner/repo/releases/download/v1.5.0-beta.1/GSAT%201.5.0.exe',
  );
});

test('拒绝版本不一致或缺少主要平台的清单', () => {
  assert.throws(
    () => normalizeUpdaterManifest({ version: '1.4.0', platforms }, 'owner/repo', 'v1.5.0', '1.5.0'),
    /版本为 1\.4\.0/,
  );
  assert.throws(
    () => normalizeUpdaterManifest(
      { version: '1.5.0', platforms: { 'darwin-aarch64': platforms['darwin-aarch64'] } },
      'owner/repo',
      'v1.5.0',
      '1.5.0',
    ),
    /缺少 linux-x86_64/,
  );
});
