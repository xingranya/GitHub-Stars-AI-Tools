import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ZVEC_VERSION = '0.5.1';
const ZVEC_RELEASE_BASE_URL = `https://github.com/zvec-ai/zvec-rust/releases/download/v${ZVEC_VERSION}`;
const ZVEC_ARTIFACTS = {
  'aarch64-apple-darwin': {
    platform: 'macos',
    libraryName: 'libzvec_c_api.dylib',
    archiveSha256: '403d07371aadb55b25fb8ebec9105d310604c40e411a6548eecd203a4999c1ca',
    librarySha256: '41c62c92ea0ea205bd7cee27c92aa2db376749a01784082e0f75fc03f3e11086',
  },
  'x86_64-pc-windows-msvc': {
    platform: 'windows',
    libraryName: 'zvec_c_api.dll',
    archiveSha256: 'bcbf28f1650452d8c8dd58287f8bde9c4b3c7657bd619dae9bc6b81b68cb6ecd',
    librarySha256: '883564bb9ee7855db16115346f2fa19b61b93f6977b92ca71f385e8465429083',
  },
  'x86_64-unknown-linux-gnu': {
    platform: 'linux',
    libraryName: 'libzvec_c_api.so',
    archiveSha256: 'a4d0b23ca3493f6f31b6572242b52596621286f433b4f34b376a6b170337b05c',
    librarySha256: 'bfd0d12b942600e291eed56a979448514866efca68cc2a136fe925a3ffaad7d6',
  },
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, '..');
const tauriDir = path.join(desktopDir, 'src-tauri');
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(tauriDir, 'target');
const bootstrap = process.argv.includes('--bootstrap');
const requestedTarget = readOption('--target');
const hostPlatform = normalizePlatform(process.env.TAURI_ENV_PLATFORM ?? process.platform);
const hostArchitecture = normalizeArchitecture(process.env.TAURI_ENV_ARCH ?? process.arch);
const targetTriple = requestedTarget ?? targetTripleFor(hostPlatform, hostArchitecture);
const artifact = ZVEC_ARTIFACTS[targetTriple];
if (!artifact) {
  throw new Error(`不支持的 zvec 原生运行库目标：${targetTriple}`);
}

const runtimeDir = path.join(tauriDir, 'runtime');
const destination = path.join(runtimeDir, artifact.libraryName);

mkdirSync(runtimeDir, { recursive: true });
if (bootstrap) {
  await bootstrapZvecLibrary(targetTriple, artifact, destination);
} else {
  const source = findZvecLibrary(targetDir, targetTriple, artifact.libraryName);
  verifyFileSha256(source, artifact.librarySha256, 'Cargo 构建输出中的 zvec 运行库');
  installRuntimeLibrary(source, destination);
  patchExecutableRuntimePath(targetDir, targetTriple, artifact.platform);
  console.log(`已准备 ${targetTriple} zvec 运行库：${destination}`);
}

function readOption(name) {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex === -1) return undefined;
  const value = process.argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 缺少参数值。`);
  }
  return value;
}

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

async function bootstrapZvecLibrary(targetTripleValue, artifactValue, destination) {
  if (existsSync(destination) && sha256File(destination) === artifactValue.librarySha256) {
    console.log(`已命中 ${targetTripleValue} zvec 运行库缓存：${destination}`);
    return;
  }

  const archiveName = `zvec-prebuilt-${targetTripleValue}.tar.gz`;
  const downloadUrl = `${ZVEC_RELEASE_BASE_URL}/${archiveName}`;
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'gsat-zvec-'));
  try {
    const response = await fetch(downloadUrl, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`下载失败，HTTP ${response.status} ${response.statusText}`);
    }
    const archive = Buffer.from(await response.arrayBuffer());
    verifyBufferSha256(archive, artifactValue.archiveSha256, archiveName);

    const archivePath = path.join(temporaryDirectory, archiveName);
    writeFileSync(archivePath, archive);
    const extraction = spawnSync(
      'tar',
      ['-xzf', archivePath, '-C', temporaryDirectory],
      { stdio: 'inherit' },
    );
    if (extraction.status !== 0) {
      throw new Error(`解压 ${archiveName} 失败，退出码：${extraction.status ?? 'unknown'}`);
    }

    const marker = path.join(temporaryDirectory, 'TARGET');
    const source = path.join(temporaryDirectory, artifactValue.libraryName);
    if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== targetTripleValue) {
      throw new Error(`${archiveName} 的 TARGET 与目标平台不一致。`);
    }
    if (!existsSync(source)) {
      throw new Error(`${archiveName} 不包含 ${artifactValue.libraryName}。`);
    }
    verifyFileSha256(source, artifactValue.librarySha256, artifactValue.libraryName);
    installRuntimeLibrary(source, destination);
    console.log(`已下载并校验 ${targetTripleValue} zvec ${ZVEC_VERSION} 运行库：${destination}`);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function installRuntimeLibrary(source, destination) {
  const temporaryDestination = `${destination}.${process.pid}.tmp`;
  copyFileSync(source, temporaryDestination);
  rmSync(destination, { force: true });
  renameSync(temporaryDestination, destination);
}

function verifyBufferSha256(buffer, expectedSha256, description) {
  const actualSha256 = createHash('sha256').update(buffer).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${description} SHA-256 校验失败：${actualSha256}`);
  }
}

function verifyFileSha256(file, expectedSha256, description) {
  const actualSha256 = sha256File(file);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${description} SHA-256 校验失败：${actualSha256}`);
  }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
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
