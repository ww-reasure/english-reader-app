# Unified Mobile Learning Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Deliver a responsive, single-navigation mobile workspace with a real learning chat, article-scoped follow-up chat, and a read-only local-data learning agent.

**Architecture:** The router mounts every page inside one \`AppShell\`, which owns the safe-area header, navigation drawer, and page outlet. Conversation behavior is split into four focused modules: a versioned local store, a bounded read-only agent, a deterministic context builder, and a chat service that supports OpenAI-compatible tool calls with a fallback for APIs that reject tools.

**Tech Stack:** Vanilla ES modules, Vite, Capacitor Android, IndexedDB, localStorage, Node built-in test runner, OpenAI-compatible chat completions.

---

## File structure

| File | Responsibility |
| --- | --- |
| \`src/components/app-shell.js\` | Shared top bar, drawer, route labels, focus-safe drawer state. |
| \`src/components/conversation-store.js\` | Versioned local sessions, legacy \`chatHistory\` migration, compaction, expiry. |
| \`src/components/learning-agent.js\` | Bounded, read-only queries over words, articles, and reading statistics. |
| \`src/components/context-builder.js\` | Context-window construction with no implicit article full text. |
| \`src/components/chat-service.js\` | API requests, tool calls, fallback facts, cancellation. |
| \`src/views/chat.js\` | Default learning chat and explicit article-generation mode. |
| \`src/components/ai-analysis.js\` | Article-only “continue asking” experience after sentence analysis. |
| \`src/views/reading.js\` | Supplies/clears current article context. |
| \`src/router.js\`, \`src/app.js\`, \`src/components/modal.js\`, \`index.html\`, \`css/style.css\` | Shell integration, non-blocking API setup, viewport locking, responsive UI. |
| \`tests/*.test.mjs\` | Unit tests and source-level mobile regression guards. |

### Task 1: Create versioned conversation storage

**Files:**
- Create: \`src/components/conversation-store.js\`
- Create: \`tests/conversation-store.test.mjs\`

- [ ] **Step 1: Write the failing migration and compaction tests**

\`\`\`js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadStore() {
  const source = await readFile(new URL('../src/components/conversation-store.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test('migrates legacy chatHistory into home', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory({ chatHistory: JSON.stringify([{ type: 'user', text: '帮我复习' }, { type: 'article', article: { id: 7, title: 'A title' } }]) }), () => 1000);
  assert.deepEqual(store.getSession('home').messages.map(item => item.kind), ['text', 'article']);
});
test('keeps recent messages and expires stale article sessions', async () => {
  const { ConversationStore } = await loadStore();
  const store = new ConversationStore(memory(), () => 10 * 86400000);
  for (let index = 0; index < 10; index += 1) store.append('home', { role: index % 2 ? 'assistant' : 'user', kind: 'text', content: '消息 ' + index });
  assert.equal(store.compact('home', 4).recent.length, 4);
  store.replaceSession('reading:8', { updatedAt: 0, summary: '', messages: [] });
  store.pruneExpiredArticleSessions(7 * 86400000);
  assert.equal(store.hasSession('reading:8'), false);
});
\`\`\`

- [ ] **Step 2: Run the test to verify it fails**

Run: \`node --test tests/conversation-store.test.mjs\`  
Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement the full store API**

\`\`\`js
const KEY = 'learningConversationsV2';
const VERSION = 2;
const empty = now => ({ updatedAt: now(), summary: '', messages: [] });

export class ConversationStore {
  constructor(storage = localStorage, now = () => Date.now()) { this.storage = storage; this.now = now; }
  readState() {
    try { const value = JSON.parse(this.storage.getItem(KEY)); if (value?.version === VERSION && value.sessions) return value; } catch {}
    const legacy = this.readLegacy();
    const state = { version: VERSION, sessions: { home: { ...empty(this.now), messages: legacy } } };
    this.writeState(state);
    return state;
  }
  readLegacy() {
    try {
      return (JSON.parse(this.storage.getItem('chatHistory')) || []).map(item => ({
        role: item.type === 'user' ? 'user' : 'assistant',
        kind: item.type === 'article' ? 'article' : item.type === 'error' ? 'error' : item.type === 'system' ? 'notice' : 'text',
        content: item.text || '',
        article: item.article || null,
        createdAt: this.now()
      }));
    } catch { return []; }
  }
  writeState(state) { this.storage.setItem(KEY, JSON.stringify(state)); }
  hasSession(key) { return Boolean(this.readState().sessions[key]); }
  getSession(key) { return this.readState().sessions[key] || empty(this.now); }
  replaceSession(key, session) { const state = this.readState(); state.sessions[key] = { ...empty(this.now), ...session }; this.writeState(state); }
  append(key, message) { const session = this.getSession(key); this.replaceSession(key, { ...session, updatedAt: this.now(), messages: [...session.messages, { createdAt: this.now(), ...message }] }); }
  compact(key, keep) {
    const session = this.getSession(key);
    const archived = session.messages.slice(0, -keep);
    const recent = session.messages.slice(-keep);
    const lines = archived.filter(item => item.kind === 'text').slice(-8).map(item => (item.role === 'user' ? '用户：' : '助手：') + item.content);
    const summary = [session.summary, ...lines].filter(Boolean).join('\n').slice(-1800);
    this.replaceSession(key, { ...session, summary });
    return { summary, recent };
  }
  clear(key) { const state = this.readState(); delete state.sessions[key]; this.writeState(state); }
  pruneExpiredArticleSessions(maxAgeMs) {
    const state = this.readState();
    Object.entries(state.sessions).forEach(([key, session]) => { if (key.startsWith('reading:') && this.now() - session.updatedAt > maxAgeMs) delete state.sessions[key]; });
    this.writeState(state);
  }
}
\`\`\`

- [ ] **Step 4: Run the focused tests**

Run: \`node --test tests/conversation-store.test.mjs\`  
Expected: PASS with two tests.

- [ ] **Step 5: Commit**

\`\`\`powershell
git add src/components/conversation-store.js tests/conversation-store.test.mjs
git commit -m "feat: add versioned learning conversations"
\`\`\`

### Task 2: Create the read-only learning agent

**Files:**
- Create: \`src/components/learning-agent.js\`
- Create: \`tests/learning-agent.test.mjs\`

- [ ] **Step 1: Write failing data-boundary tests**

\`\`\`js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadAgent() {
  const source = await readFile(new URL('../src/components/learning-agent.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
test('returns at most ten favorite article metadata records without content', async () => {
  const { LearningAgent } = await loadAgent();
  const db = { getAllArticles: async () => Array.from({ length: 12 }, (_, id) => ({ id, title: '标题 ' + id, favorite: 1, content: 'private text', difficulty: 'cet4', topic: 'science', createdAt: id })) };
  const agent = new LearningAgent({ db, srs: { getDueWords: () => [], getStatus: () => 'new', getDueCount: () => 0 }, now: () => 100 });
  const result = await agent.execute('list_saved_articles', { favoriteOnly: true });
  assert.equal(result.articles.length, 10);
  assert.equal('content' in result.articles[0], false);
});
test('rejects mutating and unknown tool names', async () => {
  const { LearningAgent } = await loadAgent();
  await assert.rejects(new LearningAgent({ db: {}, srs: {} }).execute('delete_article', { id: 1 }), /not allowed/);
});
\`\`\`

- [ ] **Step 2: Run the test to verify it fails**

Run: \`node --test tests/learning-agent.test.mjs\`  
Expected: FAIL because \`LearningAgent\` is unavailable.

- [ ] **Step 3: Implement exactly four allowed queries**

\`\`\`js
const clip = (value, limit) => String(value || '').slice(0, limit);
const articleMeta = article => ({ id: article.id, title: clip(article.title, 120), difficulty: article.difficulty, topic: clip(article.topic, 48), createdAt: article.createdAt, favorite: Boolean(article.favorite), wordCount: article.wordCount || 0 });

export const LEARNING_TOOLS = [
  { type: 'function', function: { name: 'get_learning_overview', description: '读取学习概览', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'find_learning_words', description: '查询词库和复习状态', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
  { type: 'function', function: { name: 'list_saved_articles', description: '查询收藏或保存文章的元数据', parameters: { type: 'object', properties: { favoriteOnly: { type: 'boolean' }, topic: { type: 'string' } } } } },
  { type: 'function', function: { name: 'get_review_queue', description: '读取待复习词', parameters: { type: 'object', properties: {} } } }
];

export class LearningAgent {
  constructor({ db, srs, now = () => Date.now() }) { this.db = db; this.srs = srs; this.now = now; }
  async execute(name, args = {}) {
    if (name === 'get_learning_overview') return this.getLearningOverview();
    if (name === 'find_learning_words') return this.findLearningWords(args.query);
    if (name === 'list_saved_articles') return this.listSavedArticles(args);
    if (name === 'get_review_queue') return this.getReviewQueue();
    throw new Error('Tool not allowed: ' + name);
  }
  async getLearningOverview() {
    const [words, articles, stats] = await Promise.all([this.db.getAllLearnWords(), this.db.getAllArticles(), this.db.getAllReadingStats()]);
    return { source: 'learning_overview', totals: { words: words.length, due: this.srs.getDueCount(words), favorites: articles.filter(article => article.favorite).length, articles: articles.length, recentReadings: stats.filter(stat => this.now() - stat.createdAt <= 30 * 86400000).length } };
  }
  async findLearningWords(query = '') {
    const needle = String(query).trim().toLowerCase();
    const words = (await this.db.getAllLearnWords()).filter(word => !needle || word.word.includes(needle) || String(word.translation || '').includes(needle)).slice(0, 20).map(word => ({ word: word.word, translation: clip(word.translation, 80), status: this.srs.getStatus(word), nextReview: word.nextReview || null }));
    return { source: 'learning_words', words };
  }
  async listSavedArticles({ favoriteOnly = false, topic = '' }) {
    const needle = String(topic).trim().toLowerCase();
    const articles = (await this.db.getAllArticles()).filter(article => (!favoriteOnly || article.favorite) && (!needle || String(article.topic || '').toLowerCase().includes(needle) || String(article.title || '').toLowerCase().includes(needle))).slice(0, 10).map(articleMeta);
    return { source: 'saved_articles', articles };
  }
  async getReviewQueue() {
    const words = this.srs.getDueWords(await this.db.getAllLearnWords()).slice(0, 20).map(word => ({ word: word.word, translation: clip(word.translation, 80), status: this.srs.getStatus(word), nextReview: word.nextReview || null }));
    return { source: 'review_queue', words };
  }
}
\`\`\`

No method may call an IndexedDB write API. Do not expose article content, API keys, deletion, favorite toggles, or word mutations.

- [ ] **Step 4: Run the tests**

Run: \`node --test tests/learning-agent.test.mjs\`  
Expected: PASS with two tests.

- [ ] **Step 5: Commit**

\`\`\`powershell
git add src/components/learning-agent.js tests/learning-agent.test.mjs
git commit -m "feat: add read-only learning data agent"
\`\`\`

### Task 3: Add context budgeting, API chat, and tool fallback

**Files:**
- Create: \`src/components/context-builder.js\`
- Create: \`src/components/chat-service.js\`
- Modify: \`src/api.js\`
- Create: \`tests/context-builder.test.mjs\`
- Create: \`tests/chat-service.test.mjs\`

- [ ] **Step 1: Write failing isolation and fallback tests**

\`\`\`js
// tests/context-builder.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
async function loadBuilder() { const source = await readFile(new URL('../src/components/context-builder.js', import.meta.url), 'utf8'); return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
test('reading context includes selected text but never full article content', async () => {
  const { ContextBuilder } = await loadBuilder();
  const messages = new ContextBuilder().build({ kind: 'reading', summary: '', messages: [], userMessage: '继续解释', pageContext: { article: { title: 'Test', content: 'x'.repeat(5000) }, sentence: 'Selected sentence.', paragraph: 'Current paragraph.' } });
  const joined = messages.map(message => message.content).join('\n');
  assert.match(joined, /Selected sentence/);
  assert.equal(joined.includes('x'.repeat(300)), false);
});
\`\`\`

\`\`\`js
// tests/chat-service.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
async function loadService() { const source = await readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8'); return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
test('retries once without tools after a tools-unsupported response', async () => {
  const { ChatService } = await loadService();
  const calls = [];
  const service = new ChatService({
    api: { chat: async (_messages, options) => { calls.push(options); if (options.tools?.length) throw new Error('API error: 400 - tools unsupported'); return { content: '你有 2 个待复习词' }; } },
    agent: { getLearningOverview: async () => ({ source: 'learning_overview', totals: { due: 2 } }) },
    builder: { build: input => [{ role: 'user', content: JSON.stringify(input.toolResults || []) }] }
  });
  assert.equal((await service.ask({ sessionKey: 'home', session: { summary: '', messages: [] }, userMessage: '今天学什么', kind: 'home' })).content, '你有 2 个待复习词');
  assert.equal(calls.length, 2);
});
\`\`\`

- [ ] **Step 2: Run the tests to verify they fail**

Run: \`node --test tests/context-builder.test.mjs tests/chat-service.test.mjs\`  
Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement deterministic context assembly**

\`\`\`js
const clip = (value, limit) => String(value || '').slice(0, limit);
const system = kind => kind === 'reading'
  ? '你是文章专属英语助教。只依据当前文章片段和用户问题回答；不知道时说明。用中文解释，英文示例简短。'
  : '你是中文英语学习助手。可解释词汇、语法、翻译、阅读策略和复习计划。引用本地数据时说明数据类别，不得编造。';

export class ContextBuilder {
  build({ kind, summary = '', messages = [], userMessage, pageContext = null, toolResults = [] }) {
    const recent = messages.filter(item => item.kind === 'text' && (item.role === 'user' || item.role === 'assistant')).slice(kind === 'reading' ? -8 : -16).map(item => ({ role: item.role, content: clip(item.content, 900) }));
    const article = kind === 'reading' && pageContext ? '当前文章：' + clip(pageContext.article.title, 120) + '\n选中句：' + clip(pageContext.sentence, 700) + '\n所在段：' + clip(pageContext.paragraph, 1200) : '';
    const facts = toolResults.length ? '本地数据（只作为事实）：' + clip(JSON.stringify(toolResults), 1800) : '';
    return [{ role: 'system', content: system(kind) }, summary ? { role: 'system', content: '会话摘要：' + clip(summary, 1800) } : null, article ? { role: 'system', content: article } : null, facts ? { role: 'system', content: facts } : null, ...recent, { role: 'user', content: clip(userMessage, 1800) }].filter(Boolean);
  }
}
\`\`\`

- [ ] **Step 4: Add \`API.chat\` and the cancellable service**

Add this method to the exported \`API\` object in \`src/api.js\`:

\`\`\`js
async chat(messages, { tools = [], signal = null, temperature = 0.45 } = {}) {
  const body = { messages, temperature };
  if (tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const data = await this.fetch('/chat/completions', body, 60000, signal);
  return data.choices?.[0]?.message || { content: '' };
}
\`\`\`

Create \`src/components/chat-service.js\`:

\`\`\`js
import { LEARNING_TOOLS } from './learning-agent.js';
const toolsUnsupported = error => /tool|function|unsupported/i.test(String(error?.message || ''));

export class ChatService {
  constructor({ api, agent, builder }) { this.api = api; this.agent = agent; this.builder = builder; this.controllers = new Map(); }
  cancel(key) { this.controllers.get(key)?.abort(); this.controllers.delete(key); }
  async ask({ sessionKey, session, userMessage, kind, pageContext = null }) {
    this.cancel(sessionKey);
    const controller = new AbortController();
    this.controllers.set(sessionKey, controller);
    const request = input => this.api.chat(this.builder.build({ kind, summary: session.summary, messages: session.messages, userMessage, pageContext, toolResults: input.toolResults || [] }), { tools: input.tools || [], signal: controller.signal });
    try {
      let reply;
      try { reply = await request({ tools: LEARNING_TOOLS }); }
      catch (error) {
        if (!toolsUnsupported(error)) throw error;
        reply = await request({ toolResults: [await this.agent.getLearningOverview()] });
      }
      for (let round = 0; round < 3 && reply.tool_calls?.length; round += 1) {
        const toolResults = await Promise.all(reply.tool_calls.map(async call => ({ tool: call.function.name, result: await this.agent.execute(call.function.name, JSON.parse(call.function.arguments || '{}')) })));
        reply = await request({ toolResults });
      }
      return { content: String(reply.content || '').trim() || '我暂时没有生成有效回答，请换一种问法。' };
    } finally { if (this.controllers.get(sessionKey) === controller) this.controllers.delete(sessionKey); }
  }
}
\`\`\`

- [ ] **Step 5: Run tests and commit**

Run: \`node --test tests/context-builder.test.mjs tests/chat-service.test.mjs\`  
Expected: PASS with two tests.

\`\`\`powershell
git add src/api.js src/components/context-builder.js src/components/chat-service.js tests/context-builder.test.mjs tests/chat-service.test.mjs
git commit -m "feat: add bounded learning chat pipeline"
\`\`\`

### Task 4: Add the shared shell and mobile viewport lock

**Files:**
- Create: \`src/components/app-shell.js\`
- Modify: \`src/router.js\`
- Modify: \`src/app.js\`
- Modify: \`src/components/modal.js\`
- Modify: \`index.html\`
- Create: \`tests/app-shell.test.mjs\`
- Modify: \`tests/viewport-fit.test.mjs\`

- [ ] **Step 1: Write failing shell and viewport checks**

\`\`\`js
// tests/app-shell.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
async function loadShell() { const source = await readFile(new URL('../src/components/app-shell.js', import.meta.url), 'utf8'); return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
test('maps article routes to the bookshelf drawer item', async () => {
  const { AppShell } = await loadShell();
  assert.equal(AppShell.getRouteMeta('#/reading/42').navKey, 'reading-list');
  assert.equal(AppShell.getRouteMeta('#/history').title, '阅读记录');
});
\`\`\`

Replace the body of \`tests/viewport-fit.test.mjs\` with:

\`\`\`js
assert.match(html, /viewport-fit=cover/);
assert.match(html, /maximum-scale=1\\.0/);
assert.match(html, /user-scalable=no/);
assert.doesNotMatch(html, /class="tab-bar"/);
\`\`\`

- [ ] **Step 2: Run the tests to verify they fail**

Run: \`node --test tests/app-shell.test.mjs tests/viewport-fit.test.mjs\`  
Expected: FAIL because the shared shell and zoom lock are absent.

- [ ] **Step 3: Implement \`AppShell\` and mount every route inside its outlet**

\`\`\`js
const routes = [
  ['#/chat', 'chat', '学习对话'], ['#/history', 'history', '阅读记录'], ['#/vocab', 'vocab', '词汇学习'],
  ['#/reading-list', 'reading-list', '我的书架'], ['#/profile', 'profile', '学习档案']
];
export const AppShell = {
  getRouteMeta(hash) {
    if (hash.startsWith('#/reading/')) return { navKey: 'reading-list', title: '阅读' };
    if (hash === '#/learn-words' || hash === '#/flashcard') return { navKey: 'vocab', title: hash === '#/flashcard' ? '单词复习' : '词汇学习' };
    if (hash === '#/settings' || hash === '#/assessment' || hash === '#/report') return { navKey: 'profile', title: hash === '#/assessment' ? '水平测评' : hash === '#/report' ? '学习报告' : '设置' };
    const match = routes.find(item => item[0] === hash) || routes[0];
    return { navKey: match[1], title: match[2] };
  },
  mount(container, meta, pageMode) {
    document.body.classList.add('app-shell-active');
    document.body.dataset.pageMode = pageMode;
    const links = routes.map(item => '<a class="' + (item[1] === meta.navKey ? 'active' : '') + '" href="' + item[0] + '">' + item[2] + '</a>').join('');
    container.innerHTML = '<div class="app-shell app-shell--' + pageMode + '"><header class="app-header"><button id="appMenuBtn" class="app-icon-button" type="button" aria-label="打开导航" aria-expanded="false"></button><h1 class="app-header-title">' + meta.title + '</h1><a class="app-icon-button" href="#/settings" aria-label="打开设置"></a></header><button id="appDrawerBackdrop" class="app-drawer-backdrop" type="button" aria-label="关闭导航"></button><aside id="appDrawer" class="app-drawer" aria-hidden="true"><nav>' + links + '</nav></aside><main id="pageOutlet" class="app-page-outlet" tabindex="-1"></main></div>';
    const setOpen = open => { document.getElementById('appDrawer').classList.toggle('is-open', open); document.getElementById('appDrawer').setAttribute('aria-hidden', String(!open)); document.getElementById('appDrawerBackdrop').classList.toggle('is-open', open); document.getElementById('appMenuBtn').setAttribute('aria-expanded', String(open)); };
    document.getElementById('appMenuBtn').addEventListener('click', () => setOpen(true));
    document.getElementById('appDrawerBackdrop').addEventListener('click', () => setOpen(false));
    return document.getElementById('pageOutlet');
  },
  cleanup() { document.body.classList.remove('app-shell-active'); delete document.body.dataset.pageMode; }
};
\`\`\`

In \`Router.navigate\`, resolve the view first, then run \`const outlet = AppShell.mount(app, AppShell.getRouteMeta(hash), hash === '#/chat' ? 'chat' : 'standard');\` and pass \`outlet\` to every \`render\` call. Call \`AppShell.cleanup()\` at the start of route cleanup. Delete \`Router.updateNav\` and all its calls.

In \`index.html\`, delete the full legacy \`<nav class="tab-bar">…</nav>\` and replace the viewport tag with:

\`\`\`html
<meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
\`\`\`

In \`App.init\`, remove \`Modal.showApiSettings(true)\`; API setup must only open after a user presses send/generate. Keep \`Modal.hideApiSettings\` callable with no key.

- [ ] **Step 4: Run tests and commit**

Run: \`node --test tests/app-shell.test.mjs tests/viewport-fit.test.mjs\`  
Expected: PASS with two tests.

\`\`\`powershell
git add src/components/app-shell.js src/router.js src/app.js src/components/modal.js index.html tests/app-shell.test.mjs tests/viewport-fit.test.mjs
git commit -m "feat: add unified mobile navigation shell"
\`\`\`

### Task 5: Make the homepage a real chat with an explicit generation mode

**Files:**
- Modify: \`src/views/chat.js\`
- Modify: \`src/components/chat-shell.js\`
- Create: \`tests/chat-mode.test.mjs\`

- [ ] **Step 1: Write a failing source contract test**

\`\`\`js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
test('chat view has separate chat and generation modes', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.match(source, /mode === 'chat'/);
  assert.match(source, /mode === 'generate'/);
  assert.match(source, /ChatService/);
});
\`\`\`

- [ ] **Step 2: Run the test to verify it fails**

Run: \`node --test tests/chat-mode.test.mjs\`  
Expected: FAIL because all input currently reaches \`handleGenerate\`.

- [ ] **Step 3: Replace the homepage control flow**

Import and instantiate \`ConversationStore\`, \`LearningAgent\`, \`ContextBuilder\`, and \`ChatService\` once at module scope, injecting \`DB\`, \`SpacedRepetition\`, and \`API\`. In \`render\`, set \`this.mode = 'chat'\`, load \`conversationStore.getSession('home')\`, and render message records by kind.

Add the following visible control before the composer row:

\`\`\`html
<div class="chat-mode-switch" role="group" aria-label="输入模式">
  <button class="active" type="button" data-mode="chat">对话</button>
  <button type="button" data-mode="generate">生成阅读</button>
</div>
\`\`\`

Route the arrow button and Enter key through this single method:

\`\`\`js
async submitComposer() {
  const input = document.getElementById('promptInput');
  const value = input.value.trim();
  if (this.mode === 'generate') return this.handleGenerate();
  if (!value) return;
  if (!Config.hasApiKey()) { Modal.showApiSettings(); return; }
  this.appendConversation({ role: 'user', kind: 'text', content: value });
  input.value = '';
  this.showThinking();
  try {
    const session = conversationStore.getSession('home');
    const reply = await chatService.ask({ sessionKey: 'home', session, userMessage: value, kind: 'home' });
    this.removeThinking();
    this.appendConversation({ role: 'assistant', kind: 'text', content: reply.content });
  } catch (error) {
    this.removeThinking();
    this.appendConversation({ role: 'assistant', kind: 'error', content: '暂时无法回答：' + error.message });
  }
}
appendConversation(message) {
  conversationStore.append('home', message);
  conversationStore.compact('home', 16);
  this.addMessageToDOM(message.kind === 'error' ? 'error' : message.role, message.content);
}
\`\`\`

Make quick topic actions call \`this.setMode('generate')\` before selecting the topic. Keep random/review/import/word-library actions as direct actions. Keep generated article cards as \`kind: 'article'\` session records. Replace “清空生成记录” with “清空对话”; it calls \`chatService.cancel('home')\` and \`conversationStore.clear('home')\`, never touches saved articles or words.

- [ ] **Step 4: Run tests and commit**

Run: \`node --test tests/chat-mode.test.mjs tests/conversation-store.test.mjs\`  
Expected: PASS with three tests.

\`\`\`powershell
git add src/views/chat.js src/components/chat-shell.js tests/chat-mode.test.mjs
git commit -m "feat: add home learning conversation mode"
\`\`\`

### Task 6: Add article-scoped follow-up chat

**Files:**
- Modify: \`src/components/ai-analysis.js\`
- Modify: \`src/views/reading.js\`
- Create: \`tests/reading-context.test.mjs\`

- [ ] **Step 1: Write a failing isolation test**

\`\`\`js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
test('article AI uses article-keyed sessions and cleans up article state', async () => {
  const source = await readFile(new URL('../src/components/ai-analysis.js', import.meta.url), 'utf8');
  assert.match(source, /reading:/);
  assert.match(source, /clearArticleContext\\(\\)/);
});
\`\`\`

- [ ] **Step 2: Run the test to verify it fails**

Run: \`node --test tests/reading-context.test.mjs\`  
Expected: FAIL because the existing analysis modal is one-shot.

- [ ] **Step 3: Add the article conversation boundary**

Add \`setArticleContext(article, paragraph)\` and \`clearArticleContext()\` to \`AIAnalysis\`. In \`ReadingView.render\`, call \`AIAnalysis.setArticleContext({ id: article.id, title: article.title }, '')\` after the article is loaded. When a sentence is selected, set the paragraph containing the selected sentence. In \`ReadingView.cleanup\`, call \`AIAnalysis.clearArticleContext()\`.

In \`AIAnalysis.showResult\`, add a \`继续追问\` button. It opens a labelled textarea and sends the question via:

\`\`\`js
const key = 'reading:' + this.articleContext.id;
const session = conversationStore.getSession(key);
const reply = await chatService.ask({
  sessionKey: key,
  session,
  userMessage: question,
  kind: 'reading',
  pageContext: { article: this.articleContext, sentence, paragraph: this.articleContext.paragraph }
});
conversationStore.append(key, { role: 'user', kind: 'text', content: question });
conversationStore.append(key, { role: 'assistant', kind: 'text', content: reply.content });
conversationStore.compact(key, 8);
\`\`\`

Render the user and assistant follow-up bubbles inside the analysis modal with escaped content. Pass only the selected sentence and its paragraph; never set \`article.content\` in the page context. The article session must never use the \`home\` session key.

- [ ] **Step 4: Run tests and commit**

Run: \`node --test tests/reading-context.test.mjs tests/context-builder.test.mjs\`  
Expected: PASS with two tests.

\`\`\`powershell
git add src/components/ai-analysis.js src/views/reading.js tests/reading-context.test.mjs
git commit -m "feat: add article-scoped AI follow-ups"
\`\`\`

### Task 7: Apply the single responsive visual system

**Files:**
- Modify: \`css/style.css\`
- Modify: \`src/views/history.js\`
- Modify: \`src/views/vocabulary.js\`
- Modify: \`src/views/learn-words.js\`
- Modify: \`src/views/flashcard.js\`
- Modify: \`src/views/reading-list.js\`
- Modify: \`src/views/stats.js\`
- Modify: \`src/views/settings.js\`
- Modify: \`src/views/report.js\`
- Modify: \`src/views/assessment.js\`
- Create: \`tests/mobile-shell-style.test.mjs\`

- [ ] **Step 1: Write the failing mobile-shell guard**

\`\`\`js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
test('shared CSS contains safe areas and no legacy tab bar rule', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\\.app-shell\\s*\\{[^}]*min-height:\\s*100dvh/s);
  assert.match(css, /env\\(safe-area-inset-top/);
  assert.match(css, /env\\(safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\\.tab-bar\\s*\\{/);
});
\`\`\`

- [ ] **Step 2: Run the guard to verify it fails**

Run: \`node --test tests/mobile-shell-style.test.mjs\`  
Expected: FAIL because \`.tab-bar\` still has global CSS.

- [ ] **Step 3: Replace the legacy layout rules**

Delete the legacy \`.tab-bar\`, \`.tab-item\`, \`.tab-index\`, \`.tab-label\`, and \`.tab-badge\` rule groups. Add these concrete shared shell rules while retaining existing color variables:

\`\`\`css
body.app-shell-active { overflow: hidden; }
body.app-shell-active #app { height: 100dvh; min-height: 0; padding: 0; }
.app-shell { min-height: 100dvh; background: var(--paper); }
.app-shell--chat { height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }
.app-header { min-height: 64px; display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px; border-bottom: 1px solid var(--border-light); background: color-mix(in srgb, var(--surface) 94%, transparent); }
.app-header-title { margin: 0; overflow: hidden; font-family: Georgia, \"Noto Serif SC\", serif; font-size: 19px; line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.app-page-outlet { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.app-shell--chat .app-page-outlet { display: grid; overflow: hidden; }
.app-drawer { position: fixed; z-index: 50; inset: 0 auto 0 0; width: min(82vw, 340px); padding: calc(18px + env(safe-area-inset-top, 0px)) 16px calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-104%); background: var(--surface); transition: transform var(--duration) var(--ease); }
.app-drawer.is-open { transform: translateX(0); }
.app-drawer a { display: block; min-height: 48px; padding: 13px 12px; border-radius: 12px; color: var(--ink-soft); font-weight: 750; text-decoration: none; }
.app-drawer a.active { background: var(--signal-soft); color: var(--ink); }
.chat-container { height: 100%; min-width: 0; max-width: none; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.chat-messages { min-width: 0; padding: 18px 16px; overflow-y: auto; }
.chat-composer { padding: 10px 12px calc(12px + env(safe-area-inset-bottom, 0px)); }
@media (max-width: 359px) { .app-header { padding-inline: 12px; } .chat-messages { padding-inline: 12px; } .quick-action { padding-inline: 11px; } }
\`\`\`

Add dedicated styles for \`.chat-mode-switch\`, \`.chat-thinking\`, chat bubbles, and article follow-up controls in light and dark themes. Apply \`min-width:0\` and \`overflow-wrap:anywhere\` to cards, long titles, metadata, filter rows, and inputs that can exceed 320px. Do not use the new fixed composer outside the chat page.

- [ ] **Step 4: Remove duplicate route headings while preserving feature headings**

For every listed standard view, keep its filters, stats, lists, and actions. Replace only its duplicate route-name wrapper with this accessible pattern, using the page-specific IDs shown:

\`\`\`html
<section class="app-standard-page history-container" aria-labelledby="historyContentTitle">
  <h2 id="historyContentTitle" class="sr-only">阅读记录内容</h2>
</section>
\`\`\`

Use \`vocabularyContentTitle\`, \`learningWordsContentTitle\`, \`flashcardContentTitle\`, \`readingListContentTitle\`, \`profileContentTitle\`, \`settingsContentTitle\`, \`reportContentTitle\`, and \`assessmentContentTitle\` for the remaining views. Preserve the article title, timer, and reading progress as visible content in \`ReadingView\`.

- [ ] **Step 5: Run tests and commit**

Run: \`node --test tests/*.test.mjs\`  
Expected: all tests pass.

\`\`\`powershell
git add css/style.css src/views/history.js src/views/vocabulary.js src/views/learn-words.js src/views/flashcard.js src/views/reading-list.js src/views/stats.js src/views/settings.js src/views/report.js src/views/assessment.js tests/mobile-shell-style.test.mjs
git commit -m "feat: unify mobile workspace visuals"
\`\`\`

### Task 8: Verify browser, production build, and Android artifact

**Files:**
- Modify only focused production/test files revealed by the checks below.

- [ ] **Step 1: Run the full test suite**

Run: \`node --test tests/*.test.mjs\`  
Expected: all store, agent, context, API service, shell, mode, reading, and viewport tests pass.

- [ ] **Step 2: Run the production and Android builds**

Run: \`npm run build\`  
Expected: Vite build succeeds and Capacitor Android sync completes.

Run: \`npm run build:apk\`  
Expected: Gradle reports \`BUILD SUCCESSFUL\` and creates \`android/app/build/outputs/apk/debug/app-debug.apk\`.

- [ ] **Step 3: Validate five mobile widths and core flows**

Use 320×568, 360×800, 390×844, 412×915, and 430×932. At each width, verify:

\`\`\`text
1. Open each drawer route; no legacy bottom navigation is visible.
2. Confirm no horizontal scroll, cropped route title, or overlap with the Android gesture area.
3. On 首页, ask “我今天最应该复习什么？”; confirm the reply uses bounded local review facts.
4. Switch to 生成阅读, set difficulty/topic, generate, and open the result.
5. Long-press a sentence, analyze it, choose 继续追问, then send a follow-up.
6. Return 首页; the article follow-up must not appear in home history.
7. Toggle dark theme, open/close the drawer, and scroll home and history.
8. Pinch each page; the scale remains fixed while all controls stay usable.
\`\`\`

Capture accepted 412×915 screenshots for home, open drawer, history, reading follow-up, and settings. Compare them to the design: one navigation system, safe areas, independently scrolling chat messages, and a fixed home composer.

- [ ] **Step 4: Commit focused fixes and report the artifact**

\`\`\`powershell
git add css index.html src tests package.json package-lock.json
git commit -m "fix: polish unified mobile workspace"
\`\`\`

Report the complete test result, production build, Android build, and the absolute APK path. Do not upload the APK or create a GitHub release unless the user separately requests it.

## Plan self-review

- **Coverage:** Tasks 4 and 7 cover unified drawer navigation, zoom locking, safe areas, and every listed mobile page. Task 5 covers default chat and explicit generation. Tasks 1–3 cover storage, bounded local facts, context isolation, tool fallback, cancellation, and minimum data transfer. Task 6 covers article-only follow-up. Task 8 covers visual, theme, test, production, and Android acceptance.
- **No placeholders:** Every task names exact files, test commands, limits, interface names, and commit scope.
- **Type consistency:** Session keys are \`home\` and \`reading:<articleId>\` throughout. Session items consistently use \`role\`, \`kind\`, \`content\`, \`article\`, \`createdAt\`, and session \`summary\` fields.

