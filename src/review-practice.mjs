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

const lower = word => String(word || '').trim().toLowerCase();

function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
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
