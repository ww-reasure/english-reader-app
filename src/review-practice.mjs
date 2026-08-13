/**
 * 专项复习（指定单词练习）
 *
 * Scope 决定“复习哪些词”，练习模式绝不更新正式 SRS 计划：
 * nextReview / interval / state / easeFactor / reviewCount / reviewRevision 全部保持不变。
 *
 * 词集来源只认 vocabulary 表的 createdAt（收藏进单词本的时间），
 * 但最终只练习 learnWords 里存在的词（按小写词形匹配）。
 */

export const PRACTICE_SCOPES = Object.freeze(['today_added', 'recent_added', 'manual']);
export const RECENT_ADDED_DAYS = 7;
export const PRACTICE_SESSION_KEY = 'review-practice-session-v1';
export const PRACTICE_DONE_PREFIX = 'review-practice-done-v2:';
export const PRACTICE_DONE_LEGACY_PREFIX = 'review-practice-done-v1:';

const lower = word => String(word || '').trim().toLowerCase();

function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localDateKey(now = Date.now()) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function doneStorageKey(scope) {
  return `${PRACTICE_DONE_PREFIX}${scope}`;
}

function isDoneRecordValid(scope, record, now) {
  const completedAt = Number(record?.completedAt) || 0;
  if (!completedAt) return false;
  if (scope === 'today_added') {
    // 今日新增按本地日期重置：只有当天完成的一轮才算有效
    return localDateKey(completedAt) === localDateKey(now);
  }
  if (scope === 'recent_added') {
    // 最近 7 天是滚动窗口：7 天内完成过的词不再自动出现，过期后整窗重新开放
    return now - completedAt <= RECENT_ADDED_DAYS * 24 * 60 * 60 * 1000;
  }
  return false;
}

/**
 * 把旧版“带日期键”的完成标记迁移到 v2 单键（只发生一次）。
 * 同一范围存在多个旧键时取 completedAt 最新的一条。
 */
function migrateLegacyDone(scope) {
  const legacyKeys = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && key.startsWith(`${PRACTICE_DONE_LEGACY_PREFIX}${scope}:`)) legacyKeys.push(key);
  }
  if (!legacyKeys.length) return null;
  let best = null;
  for (const key of legacyKeys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      if (!Array.isArray(parsed?.wordIds)) continue;
      const candidate = {
        wordIds: parsed.wordIds.map(id => Number(id)).filter(Number.isFinite),
        completedAt: Number(parsed.completedAt) || 0
      };
      if (!best || candidate.completedAt > best.completedAt) best = candidate;
    } catch {
      // 损坏的旧键直接丢弃
    }
  }
  if (!best) {
    for (const key of legacyKeys) localStorage.removeItem(key);
    return null;
  }
  try {
    localStorage.setItem(doneStorageKey(scope), JSON.stringify(best));
    for (const key of legacyKeys) localStorage.removeItem(key);
  } catch {
    // 迁移失败时保留旧键，下次读取再试
  }
  return best;
}

/**
 * 记录某个时间范围专项复习完成了一轮，并与已有记录做并集累积。
 *
 * 完成后同一天内入口不再直接开始，避免“复习了还能再复习同一批词”；
 * 用户仍可通过“再来一轮”主动重新进入。manual 每次勾选都是新批次，不锁定。
 * today_added 标记在次日失效；recent_added 标记在 7 天后失效。
 *
 * @param {'today_added'|'recent_added'} scope
 * @param {object} [options]
 * @param {number[]} [options.wordIds] 本轮实际练习的 learnWords id，用于展示已复习词数
 * @param {number} [options.now] 时间戳，测试可注入
 */
export function markPracticeScopeDone(scope, { wordIds = [], now = Date.now() } = {}) {
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) return;
  const previous = readPracticeScopeDone(scope, { now })?.wordIds || [];
  const merged = [...new Set([...previous, ...(wordIds || []).map(id => Number(id)).filter(Number.isFinite)])];
  const payload = {
    wordIds: merged,
    completedAt: now
  };
  try {
    localStorage.setItem(doneStorageKey(scope), JSON.stringify(payload));
  } catch {
    // localStorage 不可用时静默降级：入口不锁定，行为与旧版一致
  }
}

/**
 * 读取当前有效的完成记录（过期或损坏返回 null）。
 *
 * @param {'today_added'|'recent_added'} scope
 * @param {object} [options]
 * @param {number} [options.now] 时间戳，测试可注入
 * @returns {{ wordIds: number[], completedAt: number } | null}
 */
export function readPracticeScopeDone(scope, { now = Date.now() } = {}) {
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) return null;
  let raw = null;
  try {
    raw = localStorage.getItem(doneStorageKey(scope));
  } catch {
    return null;
  }
  if (!raw) {
    // 兼容旧版“范围:日期”键，迁移成功后视为有效
    try {
      const migrated = migrateLegacyDone(scope);
      if (migrated && isDoneRecordValid(scope, migrated, now)) return migrated;
    } catch {
      return null;
    }
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.wordIds)) return null;
    const record = {
      wordIds: parsed.wordIds.map(id => Number(id)).filter(Number.isFinite),
      completedAt: Number(parsed.completedAt) || 0
    };
    if (!isDoneRecordValid(scope, record, now)) return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * 清除完成标记（测试或显式重置用），同时清理旧版键。
 */
export function clearPracticeScopeDone(scope, { now = Date.now() } = {}) {
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) return;
  try {
    localStorage.removeItem(doneStorageKey(scope));
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key && key.startsWith(`${PRACTICE_DONE_LEGACY_PREFIX}${scope}:`)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // 忽略不可用存储
  }
}

/**
 * 计算某个范围入口的复习状态（三态渲染的判定依据）。
 *
 * @param {object} options
 * @param {'today_added'|'recent_added'|'manual'} options.scope
 * @param {number[]} options.currentWordIds 当前范围可练习的 learnWords id（去重）
 * @param {number} [options.now] 时间戳，测试可注入
 * @returns {{ done: boolean, reviewedIds: number[], newIds: number[] }}
 *   done=true 表示已全部复习完（锁定态）；有新词时 done=false 且 newIds 为未复习词。
 */
export function getPracticeScopeStatus({ scope, currentWordIds = [], now = Date.now() } = {}) {
  const current = [...new Set((currentWordIds || []).map(id => Number(id)).filter(Number.isFinite))];
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) {
    return { done: false, reviewedIds: [], newIds: current };
  }
  const record = readPracticeScopeDone(scope, { now });
  if (!record) {
    return { done: false, reviewedIds: [], newIds: current };
  }
  const reviewedSet = new Set(record.wordIds);
  const reviewedIds = current.filter(id => reviewedSet.has(id));
  const newIds = current.filter(id => !reviewedSet.has(id));
  return { done: newIds.length === 0, reviewedIds, newIds };
}

/**
 * 解析专项复习词集。
 *
 * @param {object} options
 * @param {object} options.db            实现 getAllWords / getAllLearnWords 的存储
 * @param {'today_added'|'recent_added'|'manual'} options.scope
 * @param {number[]} [options.wordIds]    manual 时传 vocabulary 记录 id
 * @param {number} [options.days]         recent_added 的天数（默认 7）
 * @param {number} [options.now]          当前时间戳，测试可注入
 * @returns {Promise<{ words: object[], skipped: number, scope: string }>}
 */
export async function resolvePracticeScope({ db, scope, wordIds = [], days = RECENT_ADDED_DAYS, now = Date.now() } = {}) {
  if (!PRACTICE_SCOPES.includes(scope)) {
    throw new TypeError(`不支持的专项复习范围: ${scope}`);
  }
  const [savedWords, learnWords] = await Promise.all([
    db.getAllWords(),
    db.getAllLearnWords()
  ]);
  const libraryByWord = new Map();
  for (const word of learnWords || []) {
    const key = lower(word?.word);
    if (key && !libraryByWord.has(key)) libraryByWord.set(key, word);
  }

  let candidates = [];
  if (scope === 'manual') {
    const ids = new Set((wordIds || []).map(id => Number(id)).filter(Number.isFinite));
    candidates = (savedWords || []).filter(word => ids.has(Number(word.id)));
  } else if (scope === 'today_added') {
    const boundary = startOfDay(now);
    candidates = (savedWords || []).filter(word => Number(word.createdAt) >= boundary);
  } else {
    const boundary = now - Number(days) * 24 * 60 * 60 * 1000;
    candidates = (savedWords || []).filter(word => Number(word.createdAt) >= boundary);
  }

  const words = [];
  const seen = new Set();
  let skipped = 0;
  for (const saved of candidates) {
    const libraryWord = libraryByWord.get(lower(saved?.word));
    if (!libraryWord) {
      skipped++;
      continue;
    }
    const id = Number(libraryWord.id);
    if (!seen.has(id)) {
      seen.add(id);
      words.push({ ...libraryWord });
    }
  }
  return { words, skipped, scope };
}

export function createPracticeSession({ scope, wordIds = [], skipped = 0 }) {
  const session = {
    scope,
    wordIds: (wordIds || []).map(id => Number(id)).filter(Number.isFinite),
    skipped: Number(skipped) || 0,
    createdAt: Date.now()
  };
  try {
    sessionStorage.setItem(PRACTICE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage 不可用（隐私模式等）时静默降级：练习入口仍可跳转，闪卡页读不到会话时按空处理
  }
  return session;
}

export function readPracticeSession() {
  let raw = null;
  try {
    raw = sessionStorage.getItem(PRACTICE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!PRACTICE_SCOPES.includes(parsed?.scope)) return null;
    const wordIds = Array.isArray(parsed.wordIds) ? parsed.wordIds.map(id => Number(id)).filter(Number.isFinite) : [];
    if (!wordIds.length) return null;
    return {
      scope: parsed.scope,
      wordIds,
      skipped: Number(parsed.skipped) || 0,
      createdAt: Number(parsed.createdAt) || 0
    };
  } catch {
    return null;
  }
}

export function clearPracticeSession() {
  try {
    sessionStorage.removeItem(PRACTICE_SESSION_KEY);
  } catch {
    // 忽略不可用存储
  }
}
