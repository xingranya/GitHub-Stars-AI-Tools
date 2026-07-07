import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopDir, '../..');
const tauriDir = path.join(desktopDir, 'src-tauri');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(tauriDir, 'target');
const config = JSON.parse(readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8'));
const targetArg = readArgValue('--target') ?? process.env.TAURI_TARGET ?? '';
const productName = config.productName;
const version = config.version;

if (process.platform !== 'darwin') {
  throw new Error('DMG 封装只能在 macOS 上运行。');
}

const appDir = findBuiltApp(targetArg);
const releaseBundleDir = findReleaseBundleDir(appDir);
const bundleScript = findBundleDmgScript(releaseBundleDir);
const dmgDir = path.join(releaseBundleDir, 'dmg');
const outputDir = path.join(desktopDir, 'dist-dmg');
const stageDir = path.join(dmgDir, `.stage-${targetArg || 'host'}`);
const appName = path.basename(appDir);
const archSuffix = getArchSuffix(targetArg);
const outputDmg = path.join(
  outputDir,
  `${productName}_${version}${archSuffix}.dmg`,
);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(dmgDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });
rmSync(outputDmg, { force: true });
cpSync(appDir, path.join(stageDir, appName), { recursive: true });

const result = spawnSync(
  'bash',
  [
    bundleScript,
    '--volname',
    productName,
    '--window-size',
    '900',
    '560',
    '--window-pos',
    '120',
    '80',
    '--icon-size',
    '128',
    '--text-size',
    '16',
    '--icon',
    appName,
    '300',
    '285',
    '--hide-extension',
    appName,
    '--app-drop-link',
    '620',
    '285',
    outputDmg,
    stageDir,
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
);

rmSync(stageDir, { recursive: true, force: true });

if (result.status !== 0) {
  throw new Error(`DMG 封装失败，退出码：${result.status ?? 'unknown'}`);
}

console.log(outputDmg);

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function findBuiltApp(target) {
  const candidates = [
    target && path.join(targetDir, target, 'release', 'bundle', 'macos'),
    path.join(targetDir, 'release', 'bundle', 'macos'),
  ].filter(Boolean);

  for (const dir of candidates) {
    const app = path.join(dir, `${productName}.app`);
    if (existsSync(app)) {
      return app;
    }
  }

  throw new Error(`没有找到 ${productName}.app，请先运行 tauri build --bundles app。`);
}

function findReleaseBundleDir(appDir) {
  const macosDir = path.dirname(appDir);
  return path.dirname(macosDir);
}

function findBundleDmgScript(releaseBundleDir) {
  const candidates = [
    path.join(releaseBundleDir, 'dmg', 'bundle_dmg.sh'),
    path.join(targetDir, 'release', 'bundle', 'dmg', 'bundle_dmg.sh'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('没有找到 Tauri 生成的 bundle_dmg.sh，请先运行一次 tauri build --bundles dmg。');
}

function getArchSuffix(target) {
  if (target.includes('aarch64')) {
    return '_aarch64';
  }
  if (target.includes('x86_64')) {
    return '_x64';
  }
  return '';
}
