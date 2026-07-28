const KEY = 'learningConversationsV2';
const VERSION = 2;

const emptySession = now => ({ updatedAt: now(), summary: '', messages: [] });
const clip = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

const summaryLineFor = (item, key) => {
  if (item.kind === 'text') return (item.role === 'user' ? '用户：' : '助手：') + clip(item.content, 500);
  if (key !== 'home' || item.kind === 'notice' || item.kind === 'error') return '';
  if (item.kind === 'article') {
    const article = item.article || {};
    const title = clip(article.title, 120) || '未命名文章';
    const titleZh = clip(article.titleZh, 120);
    const details = [
      `成功生成文章：${title}${titleZh ? `（${titleZh}）` : ''}`,
      clip(article.difficulty, 32),
      clip(article.topic, 60),
      Number.isFinite(Number(article.wordCount)) ? `${Number(article.wordCount)} 词` : ''
    ].filter(Boolean);
    return details.join('；');
  }
  if (item.kind === 'generation_failure') {
    const failure = item.failure || {};
    const generation = failure.generation || {};
    const spec = [clip(generation.difficulty, 32), clip(generation.challenge, 32), Number.isFinite(Number(generation.wordCount)) ? `${Number(generation.wordCount)} 词` : '']
      .filter(Boolean).join(' / ');
    return `文章生成未完成：${clip(failure.message, 360) || '内容不完整'}${spec ? `（${spec}）` : ''}`;
  }
  return '';
};

export class ConversationStore {
  constructor(storage = localStorage, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
  }

  readState() {
    try {
      const value = JSON.parse(this.storage.getItem(KEY));
      if (value?.version === VERSION && value.sessions) return value;
    } catch {
      // Invalid persisted data is replaced by a safe, empty state below.
    }

    const state = {
      version: VERSION,
      sessions: { home: { ...emptySession(this.now), messages: this.readLegacy() } }
    };
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
    } catch {
      return [];
    }
  }

  writeState(state) {
    this.storage.setItem(KEY, JSON.stringify(state));
  }

  hasSession(key) {
    return Boolean(this.readState().sessions[key]);
  }

  getSession(key) {
    return this.readState().sessions[key] || emptySession(this.now);
  }

  replaceSession(key, session) {
    const state = this.readState();
    state.sessions[key] = { ...emptySession(this.now), ...session };
    this.writeState(state);
  }

  append(key, message) {
    const session = this.getSession(key);
    const createdAt = this.now();
    this.replaceSession(key, {
      ...session,
      updatedAt: createdAt,
      messages: [...session.messages, { createdAt, ...message }]
    });
  }

  replaceMessage(key, predicate, replacement) {
    const session = this.getSession(key);
    const index = session.messages.findIndex(predicate);
    if (index < 0) return false;
    const messages = [...session.messages];
    messages[index] = replacement(messages[index]);
    this.replaceSession(key, { ...session, updatedAt: this.now(), messages });
    return true;
  }

  removeMessages(key, predicate) {
    const session = this.getSession(key);
    const messages = session.messages.filter(message => !predicate(message));
    const removed = session.messages.length - messages.length;
    if (removed) this.replaceSession(key, { ...session, updatedAt: this.now(), messages });
    return removed;
  }

  compact(key, keep) {
    const session = this.getSession(key);
    const recent = session.messages.slice(-keep);
    const archived = session.messages.slice(0, -keep);
    const lines = archived
      .map(item => summaryLineFor(item, key))
      .filter(Boolean)
      .slice(-8)
      ;
    const summary = [session.summary, ...lines].filter(Boolean).join('\n').slice(-1800);

    this.replaceSession(key, { ...session, summary, messages: recent });
    return { summary, recent };
  }

  clear(key) {
    const state = this.readState();
    delete state.sessions[key];
    this.writeState(state);
  }

  pruneExpiredArticleSessions(maxAgeMs) {
    const state = this.readState();
    Object.entries(state.sessions).forEach(([key, session]) => {
      if (key.startsWith('reading:') && this.now() - session.updatedAt > maxAgeMs) {
        delete state.sessions[key];
      }
    });
    this.writeState(state);
  }
}
