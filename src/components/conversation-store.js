const KEY = 'learningConversationsV2';
const VERSION = 4;
const MAX_HOME_ACTIVITIES = 50;
const MAX_HOME_ROUNDS = 50;
const MAX_CONTEXT_ROUNDS = 24;
const CONTEXT_BATCH_ROUNDS = 8;

const emptySession = now => ({ updatedAt: now(), summary: '', contextSummary: '', messages: [], activities: [] });
const clip = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

const legacyActivityFromMessage = message => {
  if (message?.kind === 'article') {
    const article = message.article || {};
    return {
      type: 'generation',
      status: 'success',
      startedAt: message.createdAt,
      completedAt: message.createdAt,
      elapsedMs: null,
      article: {
        id: article.id,
        title: clip(article.title, 160),
        difficulty: clip(article.difficulty, 32),
        wordCount: Number.isFinite(Number(article.wordCount)) ? Number(article.wordCount) : 0
      },
      source: 'legacy_message'
    };
  }
  if (message?.kind === 'generation_failure') {
    const failure = message.failure || {};
    return {
      type: 'generation',
      status: 'failed',
      startedAt: message.createdAt,
      completedAt: message.createdAt,
      elapsedMs: null,
      failureReason: clip(failure.message, 700) || '文章生成未完成',
      generation: failure.generation || null,
      source: 'legacy_message'
    };
  }
  return null;
};

const normalizeSession = (session, now, key) => {
  const nowFn = typeof now === 'function' ? now : () => now;
  const safe = session && typeof session === 'object' ? session : {};
  const messages = Array.isArray(safe.messages) ? safe.messages : [];
  const existingActivities = Array.isArray(safe.activities) ? safe.activities : null;
  const activities = existingActivities || (key === 'home'
    ? messages.map(legacyActivityFromMessage).filter(Boolean)
    : []);
  return {
    ...emptySession(nowFn),
    ...safe,
    messages,
    contextSummary: String(safe.contextSummary || ''),
    activities: activities.slice(-MAX_HOME_ACTIVITIES)
  };
};

const summaryLineFor = (item, key) => {
  if (item.kind === 'text') return (item.role === 'user' ? '用户：' : '助手：') + clip(item.content, 500);
  if (key === 'home' && item.kind === 'activity') {
    const activity = item.activity || {};
    const articles = Array.isArray(activity.articles) ? activity.articles : activity.article ? [activity.article] : [];
    const titles = articles.slice(0, 4).map(article => clip(article?.title, 120)).filter(Boolean).join('、');
    return `真实活动：${clip(activity.type, 48) || 'learning'} / ${clip(activity.status, 48) || 'unknown'}${titles ? `；${titles}` : ''}${activity.elapsedMs == null ? '' : `；${Number(activity.elapsedMs) || 0}ms`}`;
  }
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
      if ((value?.version === 2 || value?.version === 3) && value.sessions) {
        const migrated = {
          version: VERSION,
          sessions: Object.fromEntries(
            Object.entries(value.sessions).map(([key, session]) => [key, normalizeSession(session, this.now(), key)])
          )
        };
        this.writeState(migrated);
        return migrated;
      }
    } catch {
      // Invalid persisted data is replaced by a safe, empty state below.
    }

    const state = {
      version: VERSION,
      sessions: { home: normalizeSession({ messages: this.readLegacy() }, this.now(), 'home') }
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

  getContextSession(key) {
    const session = this.getSession(key);
    if (key !== 'home') return session;
    return {
      ...session,
      summary: [session.summary, session.contextSummary].filter(Boolean).join('\n').slice(-6000),
      messages: session.messages.filter(message => !message.contextArchived)
    };
  }

  replaceSession(key, session) {
    const state = this.readState();
    state.sessions[key] = normalizeSession({ ...emptySession(this.now), ...session }, this.now(), key);
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

  maintainHomeConversation({
    maxRounds = MAX_HOME_ROUNDS,
    contextMaxRounds = MAX_CONTEXT_ROUNDS,
    batchRounds = CONTEXT_BATCH_ROUNDS
  } = {}) {
    const session = this.getSession('home');
    let messages = [...session.messages];
    const userIndexes = messages.reduce((indexes, message, index) => {
      if (message.kind === 'text' && message.role === 'user') indexes.push(index);
      return indexes;
    }, []);
    if (userIndexes.length > maxRounds) {
      messages = messages.slice(userIndexes[userIndexes.length - maxRounds]);
    }

    const activeUserIndexes = messages.reduce((indexes, message, index) => {
      if (!message.contextArchived && message.kind === 'text' && message.role === 'user') indexes.push(index);
      return indexes;
    }, []);
    let contextSummary = session.contextSummary || '';
    if (activeUserIndexes.length > contextMaxRounds) {
      const archiveRounds = Math.min(batchRounds, activeUserIndexes.length - contextMaxRounds + batchRounds - 1);
      const boundary = activeUserIndexes[archiveRounds] ?? messages.length;
      const lines = messages.slice(0, boundary)
        .filter(message => !message.contextArchived)
        .map(message => summaryLineFor(message, 'home'))
        .filter(Boolean);
      if (lines.length) contextSummary = [contextSummary, ...lines].filter(Boolean).join('\n').slice(-6000);
      messages = messages.map((message, index) => index < boundary ? { ...message, contextArchived: true } : message);
    }

    this.replaceSession('home', {
      ...session,
      messages,
      contextSummary,
      updatedAt: this.now()
    });
    return this.getSession('home');
  }

  appendActivity(key, activity) {
    const session = this.getSession(key);
    const createdAt = this.now();
    const nextActivity = {
      createdAt,
      completedAt: activity?.completedAt ?? createdAt,
      ...activity
    };
    this.replaceSession(key, {
      ...session,
      updatedAt: createdAt,
      messages: key === 'home'
        ? [...session.messages, { role: 'system', kind: 'activity', activity: nextActivity, createdAt }]
        : session.messages,
      activities: [...(session.activities || []), nextActivity].slice(-MAX_HOME_ACTIVITIES)
    });
    return nextActivity;
  }

  getRecentActivities(key, limit = 6) {
    const count = Math.max(0, Math.min(MAX_HOME_ACTIVITIES, Number(limit) || 0));
    return (this.getSession(key).activities || []).slice(-count);
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
