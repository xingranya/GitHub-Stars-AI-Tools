import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, '..');
const tauriDir = path.join(desktopDir, 'src-tauri');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(tauriDir, 'target');
const platform = normalizePlatform(process.env.TAURI_ENV_PLATFORM ?? process.platform);
const architecture = normalizeArchitecture(process.env.TAURI_ENV_ARCH ?? process.arch);
const targetTriple = targetTripleFor(platform, architecture);
const libraryName = libraryNameFor(platform);
const source = findZvecLibrary(targetDir, targetTriple, libraryName);
const runtimeDir = path.join(tauriDir, 'runtime');
const destination = path.join(runtimeDir, libraryName);

mkdirSync(runtimeDir, { recursive: true });
copyFileSync(source, destination);
patchExecutableRuntimePath(targetDir, targetTriple, platform);
console.log(`已准备 ${targetTriple} zvec 运行库：${destination}`);

function normalizePlatform(value) {
  const normalized = value.toLowerCase();
  if (normalized === 'darwin' || normalized === 'macos') return 'macos';
  if (normalized === 'win32' || normalized === 'windows') return 'windows';
  if (normalized === 'linux') return 'linux';
  throw new Error(`不支持的本机运行库平台：${value}`);
}

function normalizeArchitecture(value) {
  const normalized = value.toLowerCase();
  if (normalized === 'arm64' || normalized === 'aarch64') return 'aarch64';
  if (normalized === 'x64' || normalized === 'x86_64') return 'x86_64';
  throw new Error(`不支持的本机运行库架构：${value}`);
}

function targetTripleFor(targetPlatform, targetArchitecture) {
  if (targetPlatform === 'macos') return `${targetArchitecture}-apple-darwin`;
  if (targetPlatform === 'windows') return `${targetArchitecture}-pc-windows-msvc`;
  return `${targetArchitecture}-unknown-linux-gnu`;
}

function libraryNameFor(targetPlatform) {
  if (targetPlatform === 'macos') return 'libzvec_c_api.dylib';
  if (targetPlatform === 'windows') return 'zvec_c_api.dll';
  return 'libzvec_c_api.so';
}

function findZvecLibrary(root, targetTripleValue, fileName) {
  const buildRoots = [
    path.join(root, targetTripleValue, 'release', 'build'),
    path.join(root, 'release', 'build'),
  ];
  for (const buildRoot of buildRoots) {
    if (!existsSync(buildRoot)) continue;
    const packageDirs = readdirSync(buildRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('zvec-rust-sys-'))
      .map((entry) => path.join(buildRoot, entry.name));
    for (const packageDir of packageDirs) {
      const prebuiltDir = path.join(packageDir, 'out', 'zvec-prebuilt');
      const marker = path.join(prebuiltDir, 'TARGET');
      const candidate = path.join(prebuiltDir, fileName);
      if (
        existsSync(marker)
        && readFileSync(marker, 'utf8').trim() === targetTripleValue
        && existsSync(candidate)
      ) {
        return candidate;
      }
    }
  }
  throw new Error(`没有找到 ${targetTripleValue} 的 ${fileName}，请检查 zvec-rust-sys 构建输出。`);
}

function patchExecutableRuntimePath(root, targetTripleValue, targetPlatform) {
  if (targetPlatform === 'windows') return;
  const executable = findReleaseExecutable(root, targetTripleValue);
  const command = targetPlatform === 'macos' ? 'install_name_tool' : 'patchelf';
  const args = targetPlatform === 'macos'
    ? ['-add_rpath', '@executable_path/../Frameworks', executable]
    : ['--set-rpath', '$ORIGIN/../lib/github-stars-ai-tools', executable];
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} 写入 zvec 相对运行库路径失败，退出码：${result.status ?? 'unknown'}`);
  }
}

function findReleaseExecutable(root, targetTripleValue) {
  const executableName = process.platform === 'win32' ? 'gsat-desktop.exe' : 'gsat-desktop';
  const candidates = [
    path.join(root, targetTripleValue, 'release', executableName),
    path.join(root, 'release', executableName),
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(`没有找到 ${targetTripleValue} 的 release 主程序。`);
  }
  return executable;
}
