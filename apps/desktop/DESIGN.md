# DESIGN.md

本文档记录 GitHub Stars AI Tools 桌面应用的视觉系统与设计决策。

## 设计原则

1. **工作台优先**：首屏直接呈现核心功能，减少导航层级
2. **信息层次清晰**：用边框、留白、颜色深浅建立视觉层次
3. **克制使用颜色**：主色仅用于主要操作和状态指示
4. **一致的交互语言**：相同控件在不同位置保持相同外观和行为

## 色彩系统

### 语义色板

```css
/* 基础 */
--background: oklch(0.985 0.002 90);     /* 轻微暖灰底，舒适阅读 */
--foreground: oklch(0.18 0.008 90);      /* 深灰文字，4.5:1 对比度 */

/* 表面层 */
--card: oklch(1 0 0);                     /* 纯白卡片，清晰分层 */
--muted: oklch(0.97 0.005 90);            /* 弱化区域背景 */

/* 主色 */
--primary: oklch(0.48 0.14 240);          /* 知识蓝，专业可靠 */
--primary-foreground: oklch(0.99 0 0);

/* 次要色 */
--secondary: oklch(0.96 0.008 240);       /* 灰蓝，低调层次 */
--accent: oklch(0.95 0.02 240);           /* 强调色 */

/* 状态色 */
--success: oklch(0.55 0.15 145);          /* 柔和绿 */
--warning: oklch(0.68 0.16 75);           /* 琥珀 */
--destructive: oklch(0.58 0.22 25);       /* 柔和红 */
```

### 颜色使用规则

- **主色（蓝）**：主要操作按钮、选中状态、焦点指示、重要信息标记
- **次要色（灰蓝）**：次要按钮、Badge、标签
- **成功色（绿）**：完成状态、正向反馈
- **警告色（黄）**：待处理状态、注意提示
- **危险色（红）**：删除操作、错误提示

## 排版系统

### 字体

- **系统字体栈**：`-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`
- **等宽字体**：用于代码、Gist ID、日期时间

### 字号层级

```
text-xs   11px   标签、辅助信息、时间戳
text-sm   13px   正文、表格内容、按钮文字
text-base 14px   卡片标题、输入框
```

### 字重

- **400 (normal)**：正文、描述
- **500 (medium)**：次要标题、强调文字
- **600 (semibold)**：区块标题、按钮
- **700 (bold)**：主标题

## 布局系统

### 网格结构

```
[280px 左侧边栏] | [minmax(620px, 1fr) 主内容区] | [400px 知识面板]
```

### 间距规范

- **xs**: 4px - 图标与文字间距
- **sm**: 8px - 小型元素内边距
- **md**: 12px - 标准间距
- **lg**: 16px - 区块间距
- **xl**: 24px - 大区块间距

### 圆角

- **按钮、输入框、选择器**: 8px (rounded-lg)
- **卡片**: 12px (rounded-xl)
- **头像**: 8px (rounded-lg)
- **标签芯片**: 8px (rounded-lg)

## 组件规范

### 按钮

**主要按钮**
- 背景：`--primary`
- 文字：`--primary-foreground`
- 圆角：8px
- 高度：40px (h-10)
- 阴影：`shadow-sm`
- Hover: 轻微上移 + 加深阴影

**次要按钮**
- 边框：`--border`
- 背景：透明
- 文字：`--foreground`
- Hover: 背景 `--muted`

### 输入框

- 高度：40px (h-10)
- 圆角：8px
- 边框：`--border`
- 背景：`--input`
- Focus: 2px 蓝色外框，阴影加深

### 徽章 (Badge)

- 圆角：8px
- 内边距：8px 12px
- 字号：12px
- 阴影：`shadow-sm`
- 变体：
  - `default`: 主色背景
  - `secondary`: 次要色背景
  - `outline`: 边框样式

### 标签芯片

- 最小高度：34px
- 圆角：8px
- 边框：1.5px
- 阴影：`shadow-xs`
- 选中状态：主色边框 + 10% 主色背景 + 外发光
- Hover: 上移 1px + 阴影加深

### 表格

- 表头：固定顶部，半透明背景，backdrop-blur
- 行高：保证触控友好（最小 44px）
- 选中行：淡蓝背景
- Hover: 淡灰背景
- 字号：13px (text-sm)

### 卡片

- 背景：`--card`
- 边框：`--border`
- 圆角：12px (rounded-xl)
- 阴影：`shadow-sm`
- Hover: `shadow-md`

## 交互状态

### 焦点

- 外框：2px solid `--ring`
- 偏移：2px
- 清晰可见，适配键盘导航

### 加载

- 旋转图标：`animate-spin`
- 骨架屏：`animate-pulse` + `--muted`
- 文字提示：动词 + "中…"（同步中…、抓取中…）

### 空状态

- 居中布局
- 图标：8x8 (32px)，`--muted-foreground`
- 标题：14px，600 字重
- 描述：13px，`--muted-foreground`
- 边框：虚线，`--border`
- 圆角：8px

### 禁用

- 不透明度：50%
- 鼠标样式：not-allowed
- 移除 Hover 效果

## 动效

### 过渡时长

- 快速：100ms - 颜色、不透明度
- 标准：150ms - 大多数交互
- 缓慢：200ms - 位移、缩放

### 缓动曲线

- `ease-out` - 交互反馈
- 禁用动效：`@media (prefers-reduced-motion: reduce)`

## 无障碍

- **对比度**：所有文字至少 4.5:1（正文）或 3:1（大标题）
- **焦点可见**：所有可交互元素提供清晰焦点指示
- **语义标签**：按钮、输入框、链接使用正确 ARIA 标签
- **键盘导航**：所有功能可通过键盘操作

## 设计资源

- **图标库**：[Lucide React](https://lucide.dev/)
- **组件库**：[Radix UI](https://www.radix-ui.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **样式框架**：[Tailwind CSS 4](https://tailwindcss.com/)

## 更新日志

- 2026-07-05: 初始化设计系统，建立色彩、排版、组件规范
