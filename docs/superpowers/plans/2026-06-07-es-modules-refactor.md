# ES Modules 模块化重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将英语阅读助手 25 个 JS 文件从全局对象模式转为 ES Modules，同时保持所有功能正常。

**Architecture:** 渐进式转换，分 5 个 Task：①清理死代码 ②基础模块(Layer 0-2) ③组件模块(Layer 3) ④视图模块(Layer 4) ⑤路由+入口。每个模块添加 `export`，需要时添加 `import`，所有视图/组件保留 `window.XXX = XXX` 兼容 onclick。循环依赖通过自定义事件解耦。

**Tech Stack:** Vanilla JavaScript ES Modules, Capacitor WebView, IndexedDB, Cache API

---

## 文件结构映射

### Layer 0 - 叶子模块（无依赖）
| 文件 | 导出 | 依赖 |
|------|------|------|
| `src/helpers.js` | `esc`, `escJs`, `DIFFICULTY_LABELS`, `formatDate`, `debounce`, `shuffleArray`, `IRREGULAR_MAP`, `getStemForm`, `ReadingTimer` | 无 |
| `src/config.js` | `Config` | 无 |
| `src/spaced-repetition.js` | `SpacedRepetition` | 无 |

### Layer 1 - 基础服务（仅依赖 L0）
| 文件 | 导出 | 依赖 |
|------|------|------|
| `src/db.js` | `DB` | `helpers.getStemForm` |
| `src/api.js` | `API` | `config.Config` |
| `src/theme.js` | `Theme` | `config.Config` |
| `src/audio-cache.js` | `AudioCache` | `helpers.getStemForm` |

### Layer 2 - 功能模块（依赖 L0-L1）
| 文件 | 导出 | 依赖 |
|------|------|------|
| `src/dictionary.js` | `Dictionary` | `api.API` |
| `src/affixes.js` | `Affixes` | `api.API` |
| `src/examples.js` | `Examples` | `api.API` |

### Layer 3 - 组件（依赖 L0-L2）
| 文件 | 导出 | 依赖 | 特殊处理 |
|------|------|------|---------|
| `src/components/modal.js` | `Modal` | `config`, `db` | ⚠️ 需要解耦对 ChatView 的依赖 |
| `src/components/tooltip.js` | `Tooltip` | `db`, `helpers`, `affixes`, `examples`, `audio-cache` | ⚠️ 需要解耦对 Router 的依赖 |
| `src/components/ai-analysis.js` | `AIAnalysis` | `tooltip`, `api`, `helpers` | 无 |

### Layer 4 - 视图（依赖 L0-L3）
| 文件 | 导出 | 依赖 | onclick 数量 |
|------|------|------|-------------|
| `src/views/chat.js` | `ChatView`, `WordImport`, `ChatHistory`, `PendingArticles` | config, helpers, db, api, modal, spaced-repetition, audio-cache, dictionary | 7 |
| `src/views/reading.js` | `ReadingView` | db, helpers, tooltip, ai-analysis, dictionary, audio-cache, config, modal, api, chat | 7 |
| `src/views/history.js` | `HistoryView` | db, helpers | 4 |
| `src/views/vocabulary.js` | `VocabularyView` | db, helpers | 3 |
| `src/views/flashcard.js` | `FlashcardView` | db, spaced-repetition, dictionary, helpers, config, modal, api, chat, examples, affixes | 9 |
| `src/views/learn-words.js` | `LearnWordsView` | db, spaced-repetition, helpers | 9 |
| `src/views/settings.js` | `SettingsView` | config, theme, audio-cache, helpers | 7 |
| `src/views/stats.js` | `StatsView` | db, helpers, spaced-repetition | 2 |
| `src/views/report.js` | `ReportView` | db, spaced-repetition, stats, helpers | 0 |
| `src/views/assessment.js` | `AssessmentView` | config, helpers, api, tooltip, dictionary, audio-cache, modal | 6 |

### Layer 5 - 路由+入口
| 文件 | 导出 | 依赖 |
|------|------|------|
| `src/router.js` | `Router` | 所有 10 个视图 |
| `src/app.js` | `App` | theme, config, modal, router, helpers |

---

## Task 1: 清理死代码 + 删除 reader.js

**Files:**
- Delete: `src/reader.js`

- [ ] **Step 1: 确认 reader.js 是死代码**

检查 index.html 中没有加载 reader.js：
```bash
grep -n "reader.js" E:/play/claude/english-reader/mobile/index.html
```
Expected: 无输出（index.html 不包含 reader.js）

检查 src/views/reading.js 不依赖 reader.js：
```bash
grep -n "reader.js\|initReadingView\|speakWord\|showTooltip\|saveWordFromTooltip" E:/play/claude/english-reader/mobile/src/views/reading.js
```
Expected: 无输出

- [ ] **Step 2: 删除 reader.js**

```bash
rm E:/play/claude/english-reader/mobile/src/reader.js
```

- [ ] **Step 3: 验证应用正常**

在浏览器中打开应用，确认无报错。

- [ ] **Step 4: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add -A
git commit -m "chore: 删除死代码 reader.js（已被 views/reading.js 替代）"
```

---

## Task 2: 转换 Layer 0-2 基础模块（8 个文件）

这些文件无循环依赖风险，直接添加 `export` + `import`。

### Task 2.1: helpers.js

**Files:**
- Modify: `src/helpers.js`

- [ ] **Step 1: 添加 export 到所有顶层声明**

在 `src/helpers.js` 中，将每个顶层 `const` / `function` 添加 `export`：

```javascript
// 文件顶部不变
/**
 * Helpers Module
 * ...
 */

// 将 const esc = (str) => {  改为:
export const esc = (str) => {
  // ... 内容不变
};

// 将 const escJs = (str) => {  改为:
export const escJs = (str) => {
  // ... 内容不变
};

// 将 const DIFFICULTY_LABELS = {  改为:
export const DIFFICULTY_LABELS = {
  // ... 内容不变
};

// 将 const formatDate = (timestamp) => {  改为:
export const formatDate = (timestamp) => {
  // ... 内容不变
};

// 将 const debounce = (fn, delay) => {  改为:
export const debounce = (fn, delay) => {
  // ... 内容不变
};

// 将 const shuffleArray = (arr) => {  改为:
export const shuffleArray = (arr) => {
  // ... 内容不变
};

// 将 const IRREGULAR_MAP = {  改为:
export const IRREGULAR_MAP = {
  // ... 内容不变
};

// 将 const getStemForm = (word) => {  改为:
export const getStemForm = (word) => {
  // ... 内容不变
};

// 将 class ReadingTimer {  改为:
export class ReadingTimer {
  // ... 内容不变
}
```

完整文件内容（保持原有逻辑不变，仅在每个声明前加 `export`）：

```javascript
/**
 * Helpers Module
 * Utility functions used across the application
 */

export const esc = (str) => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

export const escJs = (str) => {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
};

export const DIFFICULTY_LABELS = {
  cet4: '四级',
  cet6: '六级',
  graduate: '考研'
};

export const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

export const debounce = (fn, delay) => {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
};

export const shuffleArray = (arr) => {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const IRREGULAR_MAP = {
  // ... 保持原有内容
};

export const getStemForm = (word) => {
  const w = word.toLowerCase();
  // ... 保持原有逻辑
};

export class ReadingTimer {
  // ... 保持原有逻辑
}
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/helpers.js
```
Expected: 无输出（语法正确）

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/helpers.js
git commit -m "refactor(helpers): 添加 ES Module export"
```

### Task 2.2: config.js

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: 添加 export**

```javascript
/**
 * Config Module
 * Handles application settings via localStorage
 */

export const Config = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/config.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/config.js
git commit -m "refactor(config): 添加 ES Module export"
```

### Task 2.3: spaced-repetition.js

**Files:**
- Modify: `src/spaced-repetition.js`

- [ ] **Step 1: 添加 export**

```javascript
/**
 * Spaced Repetition Module (SM-2 Algorithm)
 * ...
 */

export const SpacedRepetition = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/spaced-repetition.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/spaced-repetition.js
git commit -m "refactor(spaced-repetition): 添加 ES Module export"
```

### Task 2.4: db.js

**Files:**
- Modify: `src/db.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Database Module
 * Handles IndexedDB operations for articles, vocabulary, and learn words
 */

import { getStemForm } from './helpers.js';

export const DB = {
  // ... 保持原有内容不变
  // 注意：saveLearnWord 中的 getStemForm 调用现在通过 import 获取
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/db.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/db.js
git commit -m "refactor(db): 添加 ES Module import/export"
```

### Task 2.5: api.js

**Files:**
- Modify: `src/api.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * API Module
 * Handles all AI API calls (DeepSeek)
 */

import { Config } from './config.js';

export const API = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/api.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/api.js
git commit -m "refactor(api): 添加 ES Module import/export"
```

### Task 2.6: theme.js

**Files:**
- Modify: `src/theme.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Theme Module
 * Handles dark/light mode switching
 */

import { Config } from './config.js';

export const Theme = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/theme.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/theme.js
git commit -m "refactor(theme): 添加 ES Module import/export"
```

### Task 2.7: audio-cache.js

**Files:**
- Modify: `src/audio-cache.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Audio Cache Module
 * Cache API based audio caching for offline word pronunciation
 */

import { getStemForm } from './helpers.js';

export const AudioCache = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/audio-cache.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/audio-cache.js
git commit -m "refactor(audio-cache): 添加 ES Module import/export"
```

### Task 2.8: dictionary.js

**Files:**
- Modify: `src/dictionary.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Dictionary Module
 * Handles word lookup with local dictionary, online API, and AI fallback
 */

import { API } from './api.js';

export const Dictionary = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/dictionary.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/dictionary.js
git commit -m "refactor(dictionary): 添加 ES Module import/export"
```

### Task 2.9: affixes.js

**Files:**
- Modify: `src/affixes.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Affixes Module
 * AI-powered word root analysis with memory tips
 */

import { API } from './api.js';

export const Affixes = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/affixes.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/affixes.js
git commit -m "refactor(affixes): 添加 ES Module import/export"
```

### Task 2.10: examples.js

**Files:**
- Modify: `src/examples.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Examples Module
 * AI-powered example sentences with caching
 */

import { API } from './api.js';

export const Examples = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/examples.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/examples.js
git commit -m "refactor(examples): 添加 ES Module import/export"
```

---

## Task 3: 解决循环依赖 + 转换组件模块（3 个文件）

### Task 3.1: 解耦 modal.js ↔ chat.js 循环依赖

**问题：** `modal.js` 的 `handleImport()` 直接调用 `ChatView.addArticleCard()` 和 `ChatView.addMessage()`，而 `chat.js` 也依赖 `Modal`。

**解决方案：** modal.js 触发自定义事件，chat.js 监听事件。

**Files:**
- Modify: `src/components/modal.js`
- Modify: `src/views/chat.js`

- [ ] **Step 1: 修改 modal.js - 替换直接调用为事件触发**

在 `modal.js` 的 `handleImport()` 方法中，找到直接调用 `ChatView` 的代码：

```javascript
// 原代码（约 line 101-103）：
ChatView.addMessage('article', article, title);
ChatView.addArticleCard(article, title);
```

替换为：

```javascript
// 新代码：通过自定义事件解耦
document.dispatchEvent(new CustomEvent('article-imported', {
  detail: { article, title }
}));
```

完整 `modal.js` 修改：

```javascript
/**
 * Modal Module
 * Handles API settings and import modals
 */

import { Config } from '../config.js';
import { DB } from '../db.js';

export const Modal = {
  // showApiSettings, hideApiSettings, saveApiSettings, onModelPresetChange
  // showImport, hideImport, normalizeText - 保持不变

  async handleImport() {
    // ... 原有逻辑不变，直到最后需要调用 ChatView 的地方

    // 替换 ChatView.addMessage / ChatView.addArticleCard 为事件触发
    document.dispatchEvent(new CustomEvent('article-imported', {
      detail: { article, title }
    }));

    this.hideImport();
  }
};
```

- [ ] **Step 2: 修改 chat.js - 监听自定义事件**

在 `chat.js` 的 `render()` 方法末尾或 `bindEvents()` 中添加事件监听：

```javascript
// 在 ChatView 对象内部添加方法
_bindImportEvent() {
  document.addEventListener('article-imported', (e) => {
    const { article, title } = e.detail;
    this.addMessage('article', article, title);
    this.addArticleCard(article, title);
  });
},
```

在 `ChatView.render()` 或初始化时调用 `this._bindImportEvent()`。

- [ ] **Step 3: 验证**

在应用中测试导入文章功能，确认文章能正常显示在对话中。

- [ ] **Step 4: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/components/modal.js src/views/chat.js
git commit -m "refactor: 解耦 modal↔chat 循环依赖，改用 CustomEvent"
```

### Task 3.2: 解耦 tooltip.js 对 Router 的依赖

**问题：** `tooltip.js` 调用 `Router.getArticleId()` 获取当前文章 ID。

**解决方案：** 直接从 URL hash 读取，不依赖 Router。

**Files:**
- Modify: `src/components/tooltip.js`

- [ ] **Step 1: 修改 tooltip.js**

找到 `Router.getArticleId()` 调用（约 line 72 的 `saveWord` 方法中）：

```javascript
// 原代码：
const articleId = Router.getArticleId();
```

替换为：

```javascript
// 新代码：直接从 URL hash 读取
const hash = location.hash;
const match = hash.match(/#\/read\/(\d+)/);
const articleId = match ? parseInt(match[1]) : null;
```

- [ ] **Step 2: 删除 Router import（如果有）**

确认 tooltip.js 不再引用 `Router`。

- [ ] **Step 3: 验证**

在阅读页面点击单词，测试保存功能正常。

- [ ] **Step 4: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/components/tooltip.js
git commit -m "refactor(tooltip): 解耦对 Router 的依赖，直接读取 URL hash"
```

### Task 3.3: 转换 tooltip.js 为 ES Module

**Files:**
- Modify: `src/components/tooltip.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Tooltip Module
 * Word lookup popup
 */

import { DB } from '../db.js';
import { getStemForm, esc, escJs } from '../helpers.js';
import { Affixes } from '../affixes.js';
import { Examples } from '../examples.js';
import { AudioCache } from '../audio-cache.js';

export const Tooltip = {
  // ... 保持原有内容不变
};

// 兼容 onclick="Tooltip.saveWord(...)"
window.Tooltip = Tooltip;
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/components/tooltip.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/components/tooltip.js
git commit -m "refactor(tooltip): 添加 ES Module import/export + window 挂载"
```

### Task 3.4: 转换 modal.js 为 ES Module

**Files:**
- Modify: `src/components/modal.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * Modal Module
 * Handles API settings and import modals
 */

import { Config } from '../config.js';
import { DB } from '../db.js';

export const Modal = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/components/modal.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/components/modal.js
git commit -m "refactor(modal): 添加 ES Module import/export"
```

### Task 3.5: 转换 ai-analysis.js 为 ES Module

**Files:**
- Modify: `src/components/ai-analysis.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * AI Analysis Module
 * AI sentence analysis
 */

import { Tooltip } from './tooltip.js';
import { API } from '../api.js';
import { esc, debounce } from '../helpers.js';

export const AIAnalysis = {
  // ... 保持原有内容不变
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/components/ai-analysis.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/components/ai-analysis.js
git commit -m "refactor(ai-analysis): 添加 ES Module import/export"
```

---

## Task 4: 转换视图模块（10 个文件）

每个视图文件添加 `import` + `export` + `window.XXX = XXX`（兼容 onclick）。

### Task 4.1: chat.js

**Files:**
- Modify: `src/views/chat.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
/**
 * Chat Module
 * Main chat view with article generation
 */

import { Config } from '../config.js';
import { DIFFICULTY_LABELS, esc, shuffleArray } from '../helpers.js';
import { DB } from '../db.js';
import { API } from '../api.js';
import { Modal } from '../components/modal.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { AudioCache } from '../audio-cache.js';
import { Dictionary } from '../dictionary.js';

// ChatHistory, PendingArticles, ChatView, WordImport - 保持原有定义
export const ChatHistory = { /* ... */ };
export const PendingArticles = { /* ... */ };
export const ChatView = { /* ... */ };
export const WordImport = { /* ... */ };

// 兼容 onclick
window.ChatView = ChatView;
window.WordImport = WordImport;
window.ChatHistory = ChatHistory;
window.PendingArticles = PendingArticles;
```

- [ ] **Step 2: 添加事件监听（替代 modal 的直接调用）**

在 ChatView 中添加 `_bindImportEvent` 方法并在 `render()` 中调用。

- [ ] **Step 3: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/chat.js
```

- [ ] **Step 4: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/views/chat.js
git commit -m "refactor(chat): 添加 ES Module import/export + window 挂载"
```

### Task 4.2: reading.js

**Files:**
- Modify: `src/views/reading.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { DIFFICULTY_LABELS, esc, getStemForm, ReadingTimer } from '../helpers.js';
import { Tooltip } from '../components/tooltip.js';
import { AIAnalysis } from '../components/ai-analysis.js';
import { Dictionary } from '../dictionary.js';
import { AudioCache } from '../audio-cache.js';
import { Config } from '../config.js';
import { Modal } from '../components/modal.js';
import { API } from '../api.js';
import { ChatView } from './chat.js';

export const ReadingView = {
  // ... 保持原有内容不变
};

window.ReadingView = ReadingView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/reading.js
cd E:/play/claude/english-reader/mobile
git add src/views/reading.js
git commit -m "refactor(reading): 添加 ES Module import/export + window 挂载"
```

### Task 4.3: history.js

**Files:**
- Modify: `src/views/history.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';

export const HistoryView = {
  // ... 保持原有内容不变
};

window.HistoryView = HistoryView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/history.js
cd E:/play/claude/english-reader/mobile
git add src/views/history.js
git commit -m "refactor(history): 添加 ES Module import/export + window 挂载"
```

### Task 4.4: vocabulary.js

**Files:**
- Modify: `src/views/vocabulary.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { esc } from '../helpers.js';

export const VocabularyView = {
  // ... 保持原有内容不变
};

window.VocabularyView = VocabularyView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/vocabulary.js
cd E:/play/claude/english-reader/mobile
git add src/views/vocabulary.js
git commit -m "refactor(vocabulary): 添加 ES Module import/export + window 挂载"
```

### Task 4.5: flashcard.js

**Files:**
- Modify: `src/views/flashcard.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { Dictionary } from '../dictionary.js';
import { esc } from '../helpers.js';
import { Config } from '../config.js';
import { Modal } from '../components/modal.js';
import { API } from '../api.js';
import { ChatView } from './chat.js';
import { Examples } from '../examples.js';
import { Affixes } from '../affixes.js';

export const FlashcardView = {
  // ... 保持原有内容不变
};

window.FlashcardView = FlashcardView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/flashcard.js
cd E:/play/claude/english-reader/mobile
git add src/views/flashcard.js
git commit -m "refactor(flashcard): 添加 ES Module import/export + window 挂载"
```

### Task 4.6: learn-words.js

**Files:**
- Modify: `src/views/learn-words.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { esc } from '../helpers.js';

export const LearnWordsView = {
  // ... 保持原有内容不变
};

window.LearnWordsView = LearnWordsView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/learn-words.js
cd E:/play/claude/english-reader/mobile
git add src/views/learn-words.js
git commit -m "refactor(learn-words): 添加 ES Module import/export + window 挂载"
```

### Task 4.7: settings.js

**Files:**
- Modify: `src/views/settings.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { Config } from '../config.js';
import { Theme } from '../theme.js';
import { AudioCache } from '../audio-cache.js';
import { esc } from '../helpers.js';

export const SettingsView = {
  // ... 保持原有内容不变
};

window.SettingsView = SettingsView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/settings.js
cd E:/play/claude/english-reader/mobile
git add src/views/settings.js
git commit -m "refactor(settings): 添加 ES Module import/export + window 挂载"
```

### Task 4.8: stats.js

**Files:**
- Modify: `src/views/stats.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { DIFFICULTY_LABELS, formatDate, esc } from '../helpers.js';
import { SpacedRepetition } from '../spaced-repetition.js';

export const StatsView = {
  // ... 保持原有内容不变
};

window.StatsView = StatsView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/stats.js
cd E:/play/claude/english-reader/mobile
git add src/views/stats.js
git commit -m "refactor(stats): 添加 ES Module import/export + window 挂载"
```

### Task 4.9: report.js

**Files:**
- Modify: `src/views/report.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { StatsView } from './stats.js';
import { esc } from '../helpers.js';

export const ReportView = {
  // ... 保持原有内容不变
};

window.ReportView = ReportView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/report.js
cd E:/play/claude/english-reader/mobile
git add src/views/report.js
git commit -m "refactor(report): 添加 ES Module import/export + window 挂载"
```

### Task 4.10: assessment.js

**Files:**
- Modify: `src/views/assessment.js`

- [ ] **Step 1: 添加 import + export + window 挂载**

```javascript
import { Config } from '../config.js';
import { DIFFICULTY_LABELS, esc, getStemForm } from '../helpers.js';
import { API } from '../api.js';
import { Tooltip } from '../components/tooltip.js';
import { Dictionary } from '../dictionary.js';
import { AudioCache } from '../audio-cache.js';
import { Modal } from '../components/modal.js';

export const AssessmentView = {
  // ... 保持原有内容不变
};

window.AssessmentView = AssessmentView;
```

- [ ] **Step 2: 验证语法 + 提交**

```bash
node -c E:/play/claude/english-reader/mobile/src/views/assessment.js
cd E:/play/claude/english-reader/mobile
git add src/views/assessment.js
git commit -m "refactor(assessment): 添加 ES Module import/export + window 挂载"
```

---

## Task 5: 转换路由 + 入口 + 修改 index.html

### Task 5.1: router.js

**Files:**
- Modify: `src/router.js`

- [ ] **Step 1: 改为显式 import + export**

```javascript
/**
 * Router Module
 * Hash-based SPA router
 */

import { ChatView } from './views/chat.js';
import { ReadingView } from './views/reading.js';
import { HistoryView } from './views/history.js';
import { VocabularyView } from './views/vocabulary.js';
import { FlashcardView } from './views/flashcard.js';
import { LearnWordsView } from './views/learn-words.js';
import { SettingsView } from './views/settings.js';
import { StatsView } from './views/stats.js';
import { ReportView } from './views/report.js';
import { AssessmentView } from './views/assessment.js';

// 显式视图映射（替代 window[viewName]）
const views = {
  ChatView,
  ReadingView,
  HistoryView,
  VocabularyView,
  FlashcardView,
  LearnWordsView,
  SettingsView,
  StatsView,
  ReportView,
  AssessmentView
};

export const Router = {
  currentView: null,

  cleanupCurrentView() {
    if (this.currentView) {
      const view = views[this.currentView];
      if (view && typeof view.cleanup === 'function') {
        view.cleanup();
      }
    }
  },

  async navigate(hash) {
    // ... 原有逻辑，但使用 views 映射替代 window[viewName]
    const route = hash.replace('#/', '') || 'chat';
    const app = document.getElementById('app');

    this.cleanupCurrentView();

    switch (route) {
      case 'chat':
        this.currentView = 'ChatView';
        ChatView.render(app);
        break;
      case 'history':
        this.currentView = 'HistoryView';
        HistoryView.render(app);
        break;
      // ... 其他路由
    }
  },

  getArticleId() {
    const hash = location.hash;
    const match = hash.match(/#\/read\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  },

  updateNav() {
    // ... 保持原有逻辑
  },

  init() {
    window.addEventListener('hashchange', () => this.navigate(location.hash));
    this.navigate(location.hash || '#/chat');
  }
};
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/router.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/router.js
git commit -m "refactor(router): 改为显式 import，移除 window[viewName] 动态访问"
```

### Task 5.2: app.js

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: 添加 import + export**

```javascript
/**
 * App Module
 * Application entry point
 */

import { Theme } from './theme.js';
import { Config } from './config.js';
import { Modal } from './components/modal.js';
import { Router } from './router.js';
import { esc } from './helpers.js';

export const App = {
  // ... 保持原有内容不变
};

// 全局错误处理
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
```

- [ ] **Step 2: 验证语法**

```bash
node -c E:/play/claude/english-reader/mobile/src/app.js
```

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add src/app.js
git commit -m "refactor(app): 添加 ES Module import/export"
```

### Task 5.3: 修改 index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 替换所有 script 标签为单一 module 入口**

将 index.html 底部的 25 个 `<script>` 标签替换为：

```html
  <!-- Scripts - ES Module entry point -->
  <script type="module" src="src/app.js"></script>
```

完整修改：

```html
  <!-- Main Content -->
  <main id="app" class="content"></main>

  <!-- Scripts - ES Module entry point -->
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

删除原有的所有 `<script src="src/...">` 标签（约 line 126-162）。

- [ ] **Step 2: 验证应用启动**

在浏览器中打开应用，检查：
1. 无白屏
2. 控制台无报错
3. 对话页面正常显示
4. 底部导航正常切换

- [ ] **Step 3: 提交**

```bash
cd E:/play/claude/english-reader/mobile
git add index.html
git commit -m "refactor: index.html 改为单一 ES Module 入口"
```

---

## Task 6: 全量功能测试

- [ ] **Step 1: 测试核心功能**

| 功能 | 测试步骤 | 预期结果 |
|------|---------|---------|
| 对话页面 | 打开应用 | 显示欢迎语和输入框 |
| API 设置 | 点击设置 → API 设置 | 弹窗正常显示 |
| 生成文章 | 输入话题，点击生成 | 文章正常显示 |
| 单词查询 | 点击文章中的单词 | 弹窗显示翻译 |
| 保存单词 | 点击弹窗中的保存按钮 | 单词保存到词库 |
| 历史记录 | 切换到历史 tab | 显示文章列表 |
| 词库 | 切换到词库 tab | 显示已保存单词 |
| 复习卡片 | 进入复习 | 卡片正常翻转和评分 |
| 统计 | 切换到统计 tab | 显示阅读统计 |
| 设置 | 切换到设置 tab | 设置项正常显示和保存 |
| 暗黑模式 | 点击主题切换 | 模式正常切换 |
| 测评 | 进入测评页面 | 测评流程正常 |
| 导入文章 | 导入一篇英文文章 | 文章正常显示在对话中 |
| 收藏 | 收藏文章 | 收藏状态正常切换 |

- [ ] **Step 2: 检查控制台**

打开浏览器开发者工具 Console，确认无错误。

- [ ] **Step 3: 最终提交**

```bash
cd E:/play/claude/english-reader/mobile
git add -A
git commit -m "refactor: ES Modules 重构完成，所有功能验证通过"
```

---

## 风险缓解

| 风险 | 缓解措施 |
|------|---------|
| onclick 白屏 | 每个视图/组件文件底部 `window.XXX = XXX` |
| 循环依赖 | modal↔chat 通过 CustomEvent 解耦 |
| Router 动态访问 | 改为显式 import + views 映射 |
| Capacitor 兼容性 | WebView 已支持 ES Modules |
| 性能回退 | 模块按需加载反而更快 |
