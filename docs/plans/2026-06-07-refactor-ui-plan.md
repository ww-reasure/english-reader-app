# 模块化重构 + UI 全面优化方案

> 日期：2026-06-07
> 备份：D:\download\claude_down\english-reader-v2.0.0-backup-*
> 目标：代码模块化 + UI 布局优化 + 视觉精致化

---

## 使用的 Skill

| Skill | 用途 | 触发时机 |
|-------|------|---------|
| **oiloil-ui-ux-guide** | UI/UX 指南 + review 模式 | Phase 1 审查现有 UI → 输出 P0/P1/P2 问题清单 |
| **design-auditor** | 19 条规则审查 + 评分 | Phase 3 完成后审查 → 输出 100 分制评分 |
| **frontend-design** | 设计感提升 | Phase 2 重写样式时参考 |
| **web-design-guidelines** | 最佳实践审查 | Phase 3 完成后补充审查 |
| **css-animations** | 动画模式参考 | Phase 3 微交互动效 |
| **superpowers-cn** | 开发工作流 | 全程遵循（澄清→设计→执行→审核） |

---

## Phase 1：UI 审查（0.5 天）

**调用 skill：oiloil-ui-ux-guide（review 模式）**

对现有 UI 做一次全面审查，输出 P0/P1/P2 问题清单。

**审查范围：**
- 对话页面
- 阅读页面
- 复习卡片
- 统计页面
- 历史页面
- 设置页面
- 导航栏

**输出：** `docs/ui-audit-report.md`

---

## Phase 2：CSS 变量系统重写（0.5 天）

**调用 skill：frontend-design（设计方向）**

重写 CSS 变量，建立统一的设计令牌系统。

**设计方向：精致极简 (Refined Minimalism)**

参考产品：Linear、Vercel、Notion

```css
:root {
  /* 颜色 - 不用纯黑纯白 */
  --bg: #F8FAFC;
  --bg-card: #FFFFFF;
  --text: #0F172A;
  --text-secondary: #64748B;
  --text-muted: #94A3B8;
  --border: #E2E8F0;
  --primary: #3B82F6;
  --primary-hover: #2563EB;
  --success: #10B981;
  --warning: #F59E0B;
  --danger: #EF4444;
  
  /* 间距 - 4px 网格 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  
  /* 圆角 */
  --radius-sm: 8px;
  --radius: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  
  /* 阴影 - 极淡 */
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow: 0 4px 6px rgba(0,0,0,0.06);
  
  /* 动画 */
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration: 200ms;
}
```

**改动文件：** `css/style.css`（:root 部分）

---

## Phase 3：布局优化（2 天）

**调用 skill：frontend-design + oiloil-ui-ux-guide**

逐页面优化布局和组件。

### 3.1 导航栏：顶部 → 底部 Tab

```
┌─────────────────────────┐
│         页面内容          │
├──────────────────────────┤
│ 💬对话  📚历史  📖词库  📊统计  ⚙设置 │
└──────────────────────────┘
```

**改动文件：** `index.html`, `css/style.css`, `js/router.js`

### 3.2 对话页面：输入区精简

```
[四级▾] [话题▾]
[输入框........................] [生成]
[导入文章] [导入单词] [学习词库]
```

**改动文件：** `js/views/chat.js`, `css/style.css`

### 3.3 阅读页面：工具栏整理

```
← 返回        ⭐ 收藏
标题
四级 · 300词 · 科技
─────────────────────
正文内容...
─────────────────────
⏱ 2:30 · 180词/分 · 查词 3
    [ ✓ 阅读完成 ]
```

**改动文件：** `js/views/reading.js`, `css/style.css`

### 3.4 复习卡片：交互优化

- 评分按钮始终在卡片下方
- 翻转后评分按钮也在卡片内
- 卡片可滚动（max-height: 70vh）

**改动文件：** `js/views/flashcard.js`, `css/style.css`

### 3.5 统计页面：信息层次

- 相关数据合并到一个卡片
- 大数字突出
- 趋势图和进度条更醒目

**改动文件：** `js/views/stats.js`, `css/style.css`

### 3.6 设置页面：卡片分组

- 每组设置用卡片包裹
- 标题用 emoji + 文字
- 相关设置放在一起

**改动文件：** `js/views/settings.js`, `css/style.css`

### 3.7 通用组件优化

| 组件 | 优化 |
|------|------|
| 卡片 | 轻微阴影 + hover 微升 |
| 按钮 | 三级（主要/次要/文字）+ 点击缩放 |
| 弹窗 | 16px 圆角 + 模糊背景 |
| 输入框 | 主色 focus 边框 + 微弱发光 |
| 标签 | 胶囊形状 + 颜色变体 |

**改动文件：** `css/style.css`

---

## Phase 4：微交动画效（0.5 天）

**调用 skill：css-animations**

| 交互 | 动效 |
|------|------|
| 按钮点击 | scale(0.97) + 150ms |
| 卡片进入 | fadeIn + slideUp 250ms |
| 弹窗打开 | scale(0.95→1) + fade 200ms |
| 列表项删除 | slideOut + height 收缩 |
| 收藏星星 | scale 弹跳 |
| 页面切换 | opacity fade 150ms |

**改动文件：** `css/style.css`

---

## Phase 5：引入 Vite（1 天）

**参考 skill：capacitor-app-development（构建配置）**

### 5.1 安装 Vite

```bash
npm install vite --save-dev
```

### 5.2 创建 vite.config.js

```javascript
import { defineConfig } from 'vite';
export default defineConfig({
  root: '.',
  build: { outDir: 'www', emptyOutDir: true }
});
```

### 5.3 目录重组

```
mobile/
├── src/
│   ├── modules/          # 核心模块
│   ├── views/            # 页面
│   ├── components/       # 通用组件
│   ├── styles/           # 样式
│   ├── helpers.js
│   ├── router.js
│   └── app.js
├── public/
│   ├── data/
│   └── index.html
├── vite.config.js
└── package.json
```

### 5.4 更新 index.html

```html
<script type="module" src="/src/app.js"></script>
```

**改动文件：** 新增 `vite.config.js`, 重组 `src/` 目录

---

## Phase 6：模块化改造（2 天）

**参考 skill：web-design-guidelines（代码质量）**

### 6.1 每个文件改为 export

```javascript
// Before
const Config = { ... };

// After
export const Config = { ... };
```

### 6.2 每个文件改为 import

```javascript
// Before
// 依赖全局变量 Config, DB, API

// After
import { Config } from '../modules/config.js';
import { DB } from '../modules/db.js';
import { API } from '../modules/api.js';
```

### 6.3 更新 Capacitor 构建

```json
// package.json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "cap:sync": "vite build && npx cap sync"
  }
}
```

**改动文件：** 所有 `src/` 下的 JS 文件

---

## Phase 7：审查 + 测试（1 天）

**调用 skill：design-auditor + web-design-guidelines**

### 7.1 设计审查

用 design-auditor 的 19 条规则审查 UI：
- 排版、颜色对比、间距、一致性
- 无障碍、状态覆盖、动效
- 输出 100 分制评分

### 7.2 最佳实践审查

用 web-design-guidelines 审查代码：
- 安全性、兼容性、性能
- 事件监听器清理、错误处理

### 7.3 功能测试

- 所有页面功能正常
- 暗黑模式正常
- APK 打包正常

---

## 总览

| Phase | 内容 | 时间 | Skill |
|-------|------|------|-------|
| 1 | UI 审查 | 0.5天 | oiloil-ui-ux-guide |
| 2 | CSS 变量重写 | 0.5天 | frontend-design |
| 3 | 布局优化 | 2天 | frontend-design + oiloil-ui-ux-guide |
| 4 | 微交互动效 | 0.5天 | css-animations |
| 5 | 引入 Vite | 1天 | capacitor-app-development |
| 6 | 模块化改造 | 2天 | web-design-guidelines |
| 7 | 审查测试 | 1天 | design-auditor + web-design-guidelines |
| **总计** | | **7.5天** | |

---

## 风险

| 风险 | 等级 | 应对 |
|------|------|------|
| 底部导航改变用户习惯 | 中 | 保持功能不变，只改位置 |
| Vite 打包兼容 Capacitor | 中 | 先测试小模块再全量 |
| 模块化循环依赖 | 低 | 依赖图分析 |
| UI 改动导致功能异常 | 中 | 每改一页测试一次 |
