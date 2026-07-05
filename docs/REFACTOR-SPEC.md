# UI 重构规范文档 (SPEC)

## 项目概述

基于 Stitch 设计系统，将 GitHub-Stars-AI-Tools 从当前 UI 完全重构为具有毛玻璃效果的现代桌面应用。

**当前状态**: 已完成设计系统 CSS，已下载所有 Stitch 页面。

**目标**: 分阶段实现 6 个核心页面，采用 SPEC 驱动开发。

---

## 阶段规划

### Phase 1: 设计系统基础 ✅ 已完成
- [x] 创建 `design-system.css`
- [x] 定义所有 CSS 变量
- [x] 配置字体系统（Manrope + Inter + JetBrains Mono）
- [x] 毛玻璃效果工具类
- [x] 下载所有 Stitch 页面（6个）

**文件位置**:
- `/tmp/stitch-downloads/` - 所有 Stitch HTML 参考页面
- `apps/desktop/src/styles/design-system.css` - 设计系统

---

### Phase 2: 全局布局框架 (1-2小时)

**目标**: 创建应用骨架，支持所有页面的导航和布局。

#### 2.1 新建全局布局组件

**文件**: `apps/desktop/src/components/app-layout.tsx`

**功能需求**:
1. 左侧边栏（260px，毛玻璃效果）
   - Logo + 应用名称
   - 导航菜单：
     - 仪表盘（Dashboard）
     - 全部仓库（Repositories）
     - 标签网络（Tag Network）
     - AI 搜索（AI Search）
     - 个人主页（Profile）
     - 设置（Settings）
   - 用户信息卡片（底部）

2. 顶部栏（毛玻璃效果）
   - 全局搜索框（居中）
   - 快捷键提示（⌘K）
   - 通知图标
   - 用户头像

3. 主内容区（带路由）
   - 使用 `children` 渲染页面内容
   - 背景使用毛玻璃效果

**技术实现**:
```typescript
// 布局结构
<div className="app-layout">
  <aside className="glass-sidebar">
    {/* 侧边栏内容 */}
  </aside>
  <div className="main-container">
    <header className="glass-topbar">
      {/* 搜索栏 */}
    </header>
    <main className="content-area">
      {children}
    </main>
  </div>
</div>
```

**验收标准**:
- [ ] 侧边栏宽度固定 260px
- [ ] 毛玻璃效果正常显示
- [ ] 导航菜单可点击切换路由
- [ ] 响应式布局（最小宽度 1280px）

---

### Phase 3: 仪表盘页面 (2-3小时)

**文件**: `apps/desktop/src/pages/dashboard.tsx`

**参考**: `/tmp/stitch-downloads/02-dashboard.html`

#### 3.1 数据卡片网格

**组件**: `apps/desktop/src/components/dashboard/stats-grid.tsx`

**布局**: 4列网格，每个卡片显示：
- 图标
- 主要数值
- 标签
- 增长趋势（可选）

**数据源**:
- 总仓库数
- 已标记仓库数
- 活跃标签数
- 本周新增

#### 3.2 活动时间线

**组件**: `apps/desktop/src/components/dashboard/activity-timeline.tsx`

**内容**:
- 同步记录
- 标签操作
- 笔记更新

#### 3.3 标签热力图

**组件**: `apps/desktop/src/components/dashboard/tag-heatmap.tsx`

**可视化**:
- 标签使用频率
- 颜色强度映射

#### 3.4 最近仓库列表

**组件**: `apps/desktop/src/components/dashboard/recent-repos.tsx`

**显示**:
- 最近访问的 5 个仓库
- 仓库名称、描述、Stars 数
- 快速操作按钮

**验收标准**:
- [ ] 所有卡片正常显示数据
- [ ] 毛玻璃效果应用到卡片
- [ ] 悬浮交互正常
- [ ] 数据从真实 API 加载

---

### Phase 4: 仓库列表页 (2-3小时)

**文件**: `apps/desktop/src/pages/repositories.tsx`

**参考**: `/tmp/stitch-downloads/03-repository-list.html`

#### 4.1 筛选栏

**组件**: `apps/desktop/src/components/repositories/filter-bar.tsx`

**功能**:
- 语言筛选（多选）
- 标签筛选（多选）
- 排序方式（Stars/更新时间/名称）
- 视图切换（列表/网格）

#### 4.2 仓库卡片

**组件**: `apps/desktop/src/components/repositories/repo-card.tsx`

**显示信息**:
- 仓库名称 + Owner
- 描述
- 语言 + Stars + Forks
- 标签列表
- 操作按钮（打开/标签/笔记）

#### 4.3 仓库详情侧边栏

**组件**: `apps/desktop/src/components/repositories/repo-detail-sidebar.tsx`

**内容**:
- README 预览
- AI 摘要
- 标签管理
- 笔记编辑

**验收标准**:
- [ ] 筛选功能正常
- [ ] 卡片布局美观
- [ ] 详情侧边栏可展开/收起
- [ ] 标签管理功能完整

---

### Phase 5: 标签网络页 (3-4小时)

**文件**: `apps/desktop/src/pages/tag-network.tsx`

**参考**: `/tmp/stitch-downloads/01-tag-network.html`

#### 5.1 网络图可视化

**组件**: `apps/desktop/src/components/tag-network/network-graph.tsx`

**技术选型**:
- 使用 D3.js 或 React Flow
- 力导向图布局
- 节点大小映射仓库数量

**交互**:
- 点击节点显示相关仓库
- 拖拽调整布局
- 缩放和平移

#### 5.2 标签列表

**组件**: `apps/desktop/src/components/tag-network/tag-list.tsx`

**功能**:
- 显示所有标签
- 统计使用次数
- 颜色编辑
- 删除/重命名

**验收标准**:
- [ ] 网络图正确渲染
- [ ] 交互流畅
- [ ] 标签操作功能完整
- [ ] 性能优化（大量节点）

---

### Phase 6: AI 搜索页 (2-3小时)

**文件**: `apps/desktop/src/pages/ai-search.tsx`

**参考**: `/tmp/stitch-downloads/05-ai-search.html`

#### 6.1 搜索输入区

**组件**: `apps/desktop/src/components/ai-search/search-input.tsx`

**功能**:
- 自然语言输入
- 搜索模式切换（关键词/语义/混合）
- 搜索建议

#### 6.2 结果列表

**组件**: `apps/desktop/src/components/ai-search/search-results.tsx`

**显示**:
- 匹配仓库列表
- 相关度评分
- 匹配原因高亮

#### 6.3 解释面板

**组件**: `apps/desktop/src/components/ai-search/explanation-panel.tsx`

**内容**:
- AI 搜索解释
- 引用来源
- 改进建议

**验收标准**:
- [ ] 搜索功能正常
- [ ] 结果排序准确
- [ ] AI 解释清晰
- [ ] 高亮匹配文本

---

### Phase 7: 设置页面 (1-2小时)

**文件**: `apps/desktop/src/pages/settings.tsx`

**参考**: `/tmp/stitch-downloads/04-settings.html`

#### 7.1 设置分组

**组件**: `apps/desktop/src/components/settings/settings-group.tsx`

**分组**:
1. 外观设置（主题、颜色、字体）
2. 同步设置（自动同步、Gist）
3. AI 设置（Provider、API Key）
4. 通用设置（语言、数据目录）

**验收标准**:
- [ ] 设置正确保存
- [ ] 实时预览变化
- [ ] 表单验证

---

### Phase 8: 个人主页 (1-2小时)

**文件**: `apps/desktop/src/pages/profile.tsx`

**参考**: `/tmp/stitch-downloads/06-profile.html`

#### 8.1 用户信息卡

**组件**: `apps/desktop/src/components/profile/user-info-card.tsx`

**显示**:
- GitHub 头像
- 用户名
- Bio
- 统计数据

#### 8.2 贡献日历

**组件**: `apps/desktop/src/components/profile/contribution-calendar.tsx`

**可视化**:
- GitHub 风格的贡献热力图
- 显示标记活动

**验收标准**:
- [ ] 用户信息正确显示
- [ ] 贡献图渲染正常
- [ ] 数据统计准确

---

## 技术约束

### 必须使用
1. **React 18** + **TypeScript**
2. **Tailwind CSS 4** + 自定义 CSS 变量
3. **Tauri 2** 后端
4. **现有的 Hooks**（`useStarsWorkspace`, `useSettings`）

### 禁止使用
1. 不引入新的 UI 库（除可视化库）
2. 不修改现有 Rust 后端（除非必要）
3. 不改变数据库 Schema

### 可选使用
1. **D3.js** 或 **React Flow**（标签网络）
2. **Recharts**（图表）
3. **Framer Motion**（动画）

---

## 样式规范

### 毛玻璃卡片
```css
.glass-card {
  background: var(--card);
  backdrop-filter: var(--blur-card);
  border: 1px solid var(--card-border);
  border-radius: var(--rounded-xl);
  box-shadow: var(--shadow-sm);
}
```

### 悬浮效果
```css
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
```

### 按钮状态
```css
.btn-primary {
  background: var(--primary);
  color: var(--on-primary);
}

.btn-primary:hover {
  transform: scale(1.02);
}

.btn-primary:active {
  transform: scale(0.98);
}
```

---

## 数据流

### 现有 API 保持不变
- `useStarsWorkspace` - 仓库数据
- `useSettings` - 设置数据
- Tauri Commands - 后端通信

### 新增（如需要）
- 标签网络数据计算
- AI 搜索结果处理

---

## 验收清单

### 全局要求
- [ ] 所有页面应用毛玻璃效果
- [ ] 响应式布局（最小 1280px）
- [ ] 所有交互有动画反馈
- [ ] 性能优化（列表虚拟化）
- [ ] 无障碍支持（键盘导航）

### 浏览器兼容
- [ ] Chrome/Edge（主要）
- [ ] Safari（macOS）
- [ ] Firefox（可选）

---

## 时间估算

| 阶段 | 预计时间 | 优先级 |
|------|---------|--------|
| Phase 1 | ✅ 完成 | P0 |
| Phase 2 | 1-2h | P0 |
| Phase 3 | 2-3h | P0 |
| Phase 4 | 2-3h | P1 |
| Phase 5 | 3-4h | P2 |
| Phase 6 | 2-3h | P1 |
| Phase 7 | 1-2h | P1 |
| Phase 8 | 1-2h | P2 |

**总计**: 12-20 小时

---

## 下一步行动

**立即开始**: Phase 2 - 全局布局框架

请确认是否开始执行 Phase 2？
