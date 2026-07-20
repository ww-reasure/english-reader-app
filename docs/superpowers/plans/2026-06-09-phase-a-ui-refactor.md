# Phase A: UI 重构 — 实施计划

> 基于 reading-weekly-plan.md 的 Phase A 详细任务分解

## 任务清单

### A1: 底部导航修改（index.html）
**File:** `index.html`
- 修改 `.tab-bar` 中的 5 个 tab
- 旧：💬对话 | 📚历史 | 📖词库 | 📊统计 | ⚙️设置
- 新：💬对话 | 📚历史 | 📖词库 | 📰阅读 | 👤我的

**href 映射：**
- 对话 → `#/chat`
- 历史 → `#/history`  
- 词库 → `#/vocab`
- 阅读 → `#/reading-list`
- 我的 → `#/profile`

---

### A2: 路由调整（router.js）
**File:** `src/router.js`
- 新增路由：`#/reading-list` → ReadingListView
- 新增路由：`#/profile` → StatsView（复用现有）
- 保留：`#/reading/:id`、`#/settings`、`#/report`、`#/assessment`、`#/flashcard`、`#/learn-words`
- 移除独立路由：`#/stats`（重定向到 #/profile）
- **关键修复——updateNav 改为前缀匹配：** 确保子页面高亮对应 tab
- cleanupCurrentView：新增 ReadingListView 清理支持

---

### A3: 新建 reading-list.js
**File:** `src/views/reading-list.js`（新建）
**功能：**
- 阅读 tab 主页面
- 从服务器 API 获取文章列表（`/api/articles`）
- 按难度分类展示（cet4/cet6/graduate）
- 状态处理：
  - 加载中：骨架屏（3 个占位卡片）
  - 错误：显示"无法连接" + 重试按钮 + 本地缓存文章
  - 空列表：提示信息
  - 离线：缓存文章列表
- 点击文章流程：
  - 检查 IndexedDB 是否已存在（按 url 去重）
  - 未下载 → fetch('/api/articles/{id}') → DB.syncArticle() → 跳转 #/reading/:newId
  - 已下载 → 直接跳转 #/reading/:existingId
- 手动刷新按钮
- 服务器 URL 从 Config 读取（默认 localhost:5000）

---

### A4: 修改 stats.js → "我的"主页面
**File:** `src/views/stats.js`
- render 内容不变（统计界面）
- 主题标题改为"我的"
- 右上角加 ⚙️ 设置按钮 → location.hash='#/settings'
- 更新导航链接

---

### A5: 更新 report.js 导航链接
**File:** `src/views/report.js`
- 详细统计链接 → `#/profile`
- 去阅读链接 → `#/reading-list`

---

### A6: DB 版本迁移至 v6
**File:** `src/db.js`
- DB_VERSION: 5 → 6
- onupgradeneeded: 新增字段
  - source (string)
  - sourceType (string) — 'ai' | 'rss' | 'manual'
  - url (string)
  - publishedAt (number)
  - summary (string)
  - tags (array)
- 新增索引：source、sourceType、url
- 新增方法：
  - syncArticle(serverArticle) — 按 url 去重，映射字段到 DB schema
  - findArticleByUrl(url) — 按 url 查询

---

## 执行顺序

1. A6: DB 迁移（基础层先改）
2. A1: index.html tab bar
3. A2: router.js 路由
4. A3: reading-list.js 新建
5. A4: stats.js 修改
6. A5: report.js 导航链接

## 验证方式

1. 底部显示 5 个 tab，点击切换正常
2. `#/reading/123` 高亮"阅读"tab
3. `#/settings` 高亮"我的"tab
4. reading-list 页面显示（至少加载中/错误状态）
5. 统计页面在"我的"tab 下正常显示
6. report 导航链接指向正确
