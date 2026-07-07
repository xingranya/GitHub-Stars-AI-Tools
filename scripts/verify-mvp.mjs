import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const generatedArtifacts = [
  'apps/desktop/dist',
  'apps/desktop/src-tauri/target',
  'packages/ai/dist',
  'packages/ai/tsconfig.tsbuildinfo',
  'packages/domain/dist',
  'packages/domain/tsconfig.tsbuildinfo',
  'packages/github/dist',
  'packages/github/tsconfig.tsbuildinfo',
  'packages/search/dist',
  'packages/search/tsconfig.tsbuildinfo',
  'packages/storage/dist',
  'packages/storage/tsconfig.tsbuildinfo',
  'packages/worker/dist',
  'packages/worker/tsconfig.tsbuildinfo',
];

const checks = [
  {
    id: 'AUTH/AI/SRCH',
    label: '前后端 Tauri 命令覆盖',
    command: 'pnpm',
    args: ['verify:commands'],
  },
  {
    id: 'AUTH-01',
    label: '初始化页 Token 提交流程防回归',
    command: 'pnpm',
    args: ['verify:auth-flow'],
  },
  {
    id: 'AUTH-02/DATA-01',
    label: '无效 Token 反馈与本地数据恢复',
    command: 'pnpm',
    args: ['verify:auth-data-flow'],
  },
  {
    id: 'DATA-02',
    label: 'Gist 注解备份与恢复链路',
    command: 'pnpm',
    args: ['verify:backup-flow'],
  },
  {
    id: 'SETTINGS-01',
    label: 'AI Key 安全存储与即时生效',
    command: 'pnpm',
    args: ['verify:settings-flow'],
  },
  {
    id: 'SYNC-01',
    label: 'TypeScript GitHub Provider 真实 API 映射',
    command: 'pnpm',
    args: ['verify:github'],
  },
  {
    id: 'SYNC-02/SYNC-03',
    label: '增量同步与弱网中断数据保留',
    command: 'pnpm',
    args: ['verify:sync-resilience'],
  },
  {
    id: 'SRCH-01/SRCH-02',
    label: '本地知识搜索引擎与组合筛选',
    command: 'pnpm',
    args: ['verify:search'],
  },
  {
    id: 'SRCH-03',
    label: '自然语言搜索上下文持续对话',
    command: 'pnpm',
    args: ['verify:ai-search-flow'],
  },
  {
    id: 'AI-01',
    label: 'TypeScript AI 服务请求封装与错误处理',
    command: 'pnpm',
    args: ['verify:ai'],
  },
  {
    id: 'AI-03',
    label: 'AI GitHub 相似项目发现链路',
    command: 'pnpm',
    args: ['verify:recommendation-flow'],
  },
  {
    id: 'SYNC/AI/DATA',
    label: 'Worker 批处理编排与失败隔离',
    command: 'pnpm',
    args: ['verify:worker'],
  },
  {
    id: 'DOCS',
    label: '项目命名与 README 功能说明',
    command: 'pnpm',
    args: ['verify:branding'],
  },
  {
    id: 'DESKTOP-RUNTIME',
    label: '发布态 IPC、任务事件与外部链接安全打开',
    command: 'pnpm',
    args: ['verify:desktop-runtime'],
  },
  {
    id: 'NO-MOCK',
    label: '源代码无空实现或 mock 占位',
    command: 'pnpm',
    args: ['verify:no-empty'],
  },
  {
    id: 'WORKER-UI',
    label: '耗时任务进度与失败反馈',
    command: 'pnpm',
    args: ['verify:task-feedback'],
  },
  {
    id: 'VIEW-01',
    label: '仪表盘未连接入口与同步按钮反馈',
    command: 'pnpm',
    args: ['verify:dashboard-flow'],
  },
  {
    id: 'VIEW-02',
    label: '1000+ Stars 虚拟列表窗口计算',
    command: 'pnpm',
    args: ['verify:virtual-list'],
  },
  {
    id: 'VIEW-03',
    label: '详情页 README 自适应与深色模式约束',
    command: 'pnpm',
    args: ['verify:ui'],
  },
  {
    id: 'VIEW-01/VIEW-03/AI-02',
    label: '空状态、详情元数据与 AI 失败占位',
    command: 'pnpm',
    args: ['verify:view-ai-ui'],
  },
  {
    id: 'DATA-01',
    label: 'SQLite 初始化幂等、持久化与关键表索引',
    command: 'node',
    args: ['packages/storage/scripts/verify-migrations.mjs'],
  },
  {
    id: 'MATRIX',
    label: 'MVP 验收矩阵覆盖',
    command: 'pnpm',
    args: ['verify:acceptance'],
  },
  {
    id: 'FE',
    label: '前端 TypeScript 与生产构建',
    command: 'pnpm',
    args: ['build'],
  },
  {
    id: 'BE',
    label: 'Rust 后端格式检查',
    command: 'cargo',
    args: ['fmt', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--', '--check'],
  },
  {
    id: 'BE',
    label: 'Rust 后端编译与单元测试',
    command: 'cargo',
    args: ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'],
  },
  {
    id: 'DESKTOP',
    label: 'Tauri 桌面安装包配置与发版链路',
    command: 'pnpm',
    args: ['verify:tauri-release-config'],
  },
];

try {
  for (const check of checks) {
    console.log(`\n[${check.id}] ${check.label}`);
    execFileSync(check.command, check.args, {
      cwd: root,
      stdio: 'inherit',
    });
  }

  console.log('\nMVP 静态验收通过，设置页已提供真实链路自检入口。真实链路复核只在应用内进行，用户安装后填写自己的 GitHub Token 与 AI 配置即可自检，不需要安装前配置环境变量或额外脚本。');
} finally {
  for (const artifact of generatedArtifacts) {
    rmSync(resolve(root, artifact), { recursive: true, force: true });
  }
}
