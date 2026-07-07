import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourceUrl = new URL('../src/lib/virtual-list.ts', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const workspaceHook = await readFile(new URL('../src/hooks/use-stars-workspace.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
const { computeVirtualWindow } = await import(moduleUrl);

const items = Array.from({ length: 1000 }, (_, index) => ({ id: index }));
const firstWindow = computeVirtualWindow({
  items,
  scrollTop: 0,
  viewportHeight: 720,
  rowHeight: 98,
  overscan: 8,
});
assert.equal(firstWindow.startIndex, 0);
assert.equal(firstWindow.totalHeight, 98_000);
assert.ok(firstWindow.items.length <= 24, '首屏不应渲染全部 1000 条仓库');
assert.deepEqual(firstWindow.items.map((item) => item.id).slice(0, 3), [0, 1, 2]);

const middleWindow = computeVirtualWindow({
  items,
  scrollTop: 50_000,
  viewportHeight: 720,
  rowHeight: 98,
  overscan: 8,
});
assert.equal(middleWindow.startIndex, 502);
assert.equal(middleWindow.offsetY, 49_196);
assert.ok(middleWindow.items.length <= 24, '中段滚动不应渲染全部 1000 条仓库');
assert.equal(middleWindow.items[0].id, 502);

const tableWindow = computeVirtualWindow({
  items,
  scrollTop: 353,
  viewportHeight: 320,
  rowHeight: 64,
  overscan: 2,
  stickyHeaderHeight: 33,
});
assert.equal(tableWindow.startIndex, 3);
assert.equal(tableWindow.items[0].id, 3);
assert.equal(tableWindow.items.length, 9);

const clampedWindow = computeVirtualWindow({
  items,
  scrollTop: -100,
  viewportHeight: 0,
  rowHeight: 0,
  overscan: -10,
});
assert.equal(clampedWindow.startIndex, 0);
assert.equal(clampedWindow.items.length, 1);

assert.match(workspaceHook, /const REPOSITORY_PAGE_SIZE = 5000/, '仓库页应保留单次 SQLite 分页大小，避免一次 IPC 拉取过大');
assert.match(
  workspaceHook,
  /async function loadRepositoryPage\(accountId: string, filters: RepositoryFilters, offset: number\)[\s\S]*?invoke<RepositoryListPage>\('list_repositories'[\s\S]*?limit: REPOSITORY_PAGE_SIZE,[\s\S]*?offset,/,
  '仓库列表必须通过统一分页 helper 从本地 SQLite 拉取数据',
);
assert.match(
  workspaceHook,
  /while \([\s\S]*?nextOffset < page\.totalCount[\s\S]*?\) \{[\s\S]*?const nextPage = await loadRepositoryPage\(accountId, nextFilters, nextOffset\)/,
  '仓库列表必须根据 totalCount 继续拉取后续分页，避免超过 5000 Stars 时漏数据',
);
assert.match(
  workspaceHook,
  /if \(nextPage\.items\.length === 0\) \{[\s\S]*?break;[\s\S]*?\}/,
  '仓库分页加载必须防止数据变化时空页导致循环卡住',
);
assert.match(
  workspaceHook,
  /items: \[\.\.\.page\.items, \.\.\.nextPage\.items\][\s\S]*?setRepositoryPage\(page\)/,
  '仓库分页加载必须把后续页合并进同一个虚拟列表数据源',
);

console.log('Virtual list verification passed.');
