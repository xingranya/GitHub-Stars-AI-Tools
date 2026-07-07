import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourceRoots = [
  'apps/desktop/src',
  'apps/desktop/src-tauri/src',
  'packages/ai/src',
  'packages/domain/src',
  'packages/github/src',
  'packages/search/src',
  'packages/storage/src',
  'packages/worker/src',
];
const clientConfigFiles = [
  'apps/desktop/components.json',
  'apps/desktop/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'README.md',
];
const sourceExtensions = new Set(['.ts', '.tsx', '.rs']);
const coreNetworkFiles = [
  'apps/desktop/src-tauri/src/auth.rs',
  'apps/desktop/src-tauri/src/ai.rs',
  'apps/desktop/src-tauri/src/github.rs',
];
const runtimeProcessFiles = [
  ...coreNetworkFiles,
  'apps/desktop/src-tauri/src/storage.rs',
];
const forbiddenPatterns = [
  { label: 'TODO 占位', pattern: /\bTODO\b/u },
  { label: 'FIXME 占位', pattern: /\bFIXME\b/u },
  { label: 'mock 实现', pattern: /\bmock(?:ed)?\b/iu },
  { label: '未实现占位', pattern: /not implemented|NotImplemented|未实现/u },
  { label: '空实现错误', pattern: /throw new Error\(['"`](?:TODO|Not implemented|NotImplemented|未实现)/u },
  { label: '客户端运行时不能读取环境变量配置', pattern: /process\.env|import\.meta\.env|dotenv/u },
];

const violations = [];

for (const sourceRoot of sourceRoots) {
  for (const file of walk(join(root, sourceRoot))) {
    if (!sourceExtensions.has(extname(file))) {
      continue;
    }

    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      for (const { label, pattern } of forbiddenPatterns) {
        if (pattern.test(line)) {
          violations.push(`${file.replace(`${root}/`, '')}:${index + 1} ${label}: ${line.trim()}`);
        }
      }
    });
  }
}

assert.equal(violations.length, 0, `发现未完成或占位实现：\n${violations.join('\n')}`);

const clientEnvConfigViolations = [];
for (const file of clientConfigFiles) {
  const source = readFileSync(join(root, file), 'utf8');
  [
    { label: '客户端配置不能引用 .env 文件', pattern: /\.env(?:\.|\\b|$)/u },
    { label: '客户端配置不能读取 Node 环境变量', pattern: /process\.env|import\.meta\.env|dotenv/u },
    { label: '客户端配置不能保留密钥环境变量占位', pattern: /\$\{[A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*\}/u },
  ].forEach(({ label, pattern }) => {
    if (pattern.test(source)) {
      clientEnvConfigViolations.push(`${file} ${label}`);
    }
  });
}

assert.equal(
  clientEnvConfigViolations.length,
  0,
  `发现客户端配置仍依赖环境变量：\n${clientEnvConfigViolations.join('\n')}`,
);

const networkProcessViolations = [];
for (const file of runtimeProcessFiles) {
  const source = readFileSync(join(root, file), 'utf8');
  [
    { label: '核心网络请求不能依赖系统 curl', pattern: /Command::new\("curl"\)/u },
    { label: '核心时间戳不能依赖系统 date', pattern: /Command::new\("date"\)/u },
    { label: '客户端存储不能依赖系统 sqlite3 命令行', pattern: /Command::new\("sqlite3"\)/u },
    { label: '不能保留 curl 配置转义辅助函数', pattern: /curl_config_string/u },
    { label: '不能为 curl 请求保留临时请求体文件', pattern: /write_temp_request_body/u },
  ].forEach(({ label, pattern }) => {
    if (pattern.test(source)) {
      networkProcessViolations.push(`${file} ${label}`);
    }
  });
}

assert.equal(
  networkProcessViolations.length,
  0,
  `发现客户端核心运行时仍依赖外部命令：\n${networkProcessViolations.join('\n')}`,
);

console.log('No empty implementation verification passed.');

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      yield* walk(path);
      continue;
    }

    yield path;
  }
}
