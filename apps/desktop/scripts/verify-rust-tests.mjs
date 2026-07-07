import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const desktopDist = resolve(root, 'apps/desktop/dist');
const tauriTarget = resolve(root, 'apps/desktop/src-tauri/target');

try {
  execFileSync('pnpm', ['--filter', '@gsat/desktop', 'build'], {
    cwd: root,
    stdio: 'inherit',
  });
  execFileSync('cargo', ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'], {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  removeDirectoryWithRetry(desktopDist);
  removeDirectoryWithRetry(tauriTarget);
}

function removeDirectoryWithRetry(directory) {
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 250,
  });
}
