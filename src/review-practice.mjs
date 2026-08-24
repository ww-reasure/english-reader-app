/**
 * 专项复习（指定单词练习）
 *
 * Scope 决定“复习哪些词”，练习模式绝不更新正式 SRS 计划：
 * nextReview / interval / state / easeFactor / reviewCount / reviewRevision 全部保持不变。
 *
 * 词集来源只认 learnWords 中的 active canonical rows，收藏与导入通过 source
 * metadata 共用同一个练习身份。
 */

export const PRACTICE_SCOPES = Object.freeze(['today_added', 'recent_added', 'manual']);
export const RECENT_ADDED_DAYS = 7;
export const PRACTICE_SESSION_KEY = 'review-practice-session-v1';
export const PRACTICE_DONE_PREFIX = 'review-practice-done-v2:';
export const PRACTICE_DONE_LEGACY_PREFIX = 'review-practice-done-v1:';
export const PRACTICE_DONE_VERSION = 2;

function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeIds(wordIds) {
  return [...new Set((wordIds || []).map(id => Number(id)).filter(Number.isFinite))];
}

const addedAtOf = word => Number(word?.libraryAddedAt ?? word?.createdAt) || 0;

function defaultStorage(name) {
  try {
    return globalThis?.[name] || null;
  } catch {
    return null;
  }
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

function normalizeDoneRecord(scope, value) {
  if (!value || !Array.isArray(value.wordIds)) return null;
  if (value.version !== undefined && ![1, PRACTICE_DONE_VERSION].includes(Number(value.version))) return null;
  if (value.scope && value.scope !== scope) return null;
  const completedAt = Number(value.completedAt) || 0;
  if (!completedAt) return null;
  return {
    version: PRACTICE_DONE_VERSION,
    scope,
    wordIds: normalizeIds(value.wordIds),
    completedAt
  };
}

function isDoneRecordValid(scope, record, now) {
  if (!record || record.completedAt > now) return false;
  if (scope === 'today_added') {
    return localDateKey(record.completedAt) === localDateKey(now);
  }
  if (scope === 'recent_added') {
    return now - record.completedAt <= RECENT_ADDED_DAYS * 24 * 60 * 60 * 1000;
  }
  return false;
}

function listStorageKeys(storage) {
  if (!storage) return [];
  try {
    const keys = [];
    const length = Math.max(0, Number(storage.length) || 0);
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (typeof key === 'string') keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

function migrateLegacyDone(scope, storage) {
  const prefix = `${PRACTICE_DONE_LEGACY_PREFIX}${scope}:`;
  const candidates = [];
  for (const key of listStorageKeys(storage).filter(item => item.startsWith(prefix))) {
    try {
      const parsed = JSON.parse(storage.getItem(key));
      const record = normalizeDoneRecord(scope, parsed);
      if (record) candidates.push({ key, record });
    } catch {
      // 损坏的旧键不是完成证据，也不阻塞其他有效旧键迁移。
    }
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.record.completedAt - left.record.completedAt);
  const best = candidates[0].record;
  try {
    storage.setItem(doneStorageKey(scope), JSON.stringify(best));
    for (const candidate of candidates) storage.removeItem(candidate.key);
  } catch {
    // 写入失败时保留旧键，下次仍可读取和重试迁移。
  }
  return best;
}

/**
 * 记录一个时间范围已完成的 learnWords id。manual 是一次性词集，不建立完成锁。
 */
export function markPracticeScopeDone(scope, {
  wordIds = [],
  now = Date.now(),
  storage
} = {}) {
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) return null;
  const targetStorage = storage === undefined ? defaultStorage('localStorage') : storage;
  if (!targetStorage) return null;
  const previous = readPracticeScopeDone(scope, { now, storage: targetStorage });
  const payload = {
    version: PRACTICE_DONE_VERSION,
    scope,
    wordIds: normalizeIds([...(previous?.wordIds || []), ...wordIds]),
    completedAt: Number(now) || Date.now()
  };
  try {
    targetStorage?.setItem(doneStorageKey(scope), JSON.stringify(payload));
  } catch {
    // 存储不可用时保持旧行为：不锁入口，也绝不影响专项练习本身。
    return null;
  }
  return payload;
}

/**
 * 读取仍在有效窗口内的 v2 完成记录，并兼容 main 曾使用的 v1 日期键。
 */
export function readPracticeScopeDone(scope, {
  now = Date.now(),
  storage
} = {}) {
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) return null;
  const targetStorage = storage === undefined ? defaultStorage('localStorage') : storage;
  if (!targetStorage) return null;
  let raw = null;
  try {
    raw = targetStorage.getItem(doneStorageKey(scope));
  } catch {
    return null;
  }
  if (!raw) {
    const migrated = migrateLegacyDone(scope, targetStorage);
    return isDoneRecordValid(scope, migrated, now) ? migrated : null;
  }
  try {
    const parsed = JSON.parse(raw);
    const record = normalizeDoneRecord(scope, parsed);
    if (!isDoneRecordValid(scope, record, now)) return null;
    // 接受 main 早期无 version/scope 的 v2 内容，并尽力升级为明确版本。
    if (parsed.version !== PRACTICE_DONE_VERSION || parsed.scope !== scope) {
      try {
        targetStorage.setItem(doneStorageKey(scope), JSON.stringify(record));
      } catch {}
    }
    return record;
  } catch {
    return null;
  }
}

export function clearPracticeScopeDone(scope, { storage } = {}) {
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) return;
  const targetStorage = storage === undefined ? defaultStorage('localStorage') : storage;
  try {
    targetStorage?.removeItem(doneStorageKey(scope));
    const prefix = `${PRACTICE_DONE_LEGACY_PREFIX}${scope}:`;
    for (const key of listStorageKeys(targetStorage).filter(item => item.startsWith(prefix))) {
      targetStorage.removeItem(key);
    }
  } catch {
    // 清理失败只会让入口保持原状态，不影响用户数据或 SRS。
  }
}

export function getPracticeScopeStatus({
  scope,
  currentWordIds = [],
  now = Date.now(),
  storage
} = {}) {
  const current = normalizeIds(currentWordIds);
  if (scope === 'manual' || !PRACTICE_SCOPES.includes(scope)) {
    return { done: false, hasCompletion: false, reviewedIds: [], newIds: current };
  }
  const record = readPracticeScopeDone(scope, { now, storage });
  if (!record) {
    return { done: false, hasCompletion: false, reviewedIds: [], newIds: current };
  }
  const reviewed = new Set(record.wordIds);
  const reviewedIds = current.filter(id => reviewed.has(id));
  const newIds = current.filter(id => !reviewed.has(id));
  return {
    done: current.length > 0 && newIds.length === 0,
    hasCompletion: true,
    reviewedIds,
    newIds
  };
}

/**
 * 解析专项复习词集。
 *
 * @param {object} options
 * @param {object} options.db            实现 getAllLearnWords 的存储
 * @param {'today_added'|'recent_added'|'manual'} options.scope
 * @param {number[]} [options.wordIds]    manual 时传 canonical learnWords 记录 id
 * @param {number} [options.days]         recent_added 的天数（默认 7）
 * @param {number} [options.now]          当前时间戳，测试可注入
 * @returns {Promise<{ words: object[], skipped: number, scope: string }>}
 */
export async function resolvePracticeScope({ db, scope, wordIds = [], days = RECENT_ADDED_DAYS, now = Date.now() } = {}) {
  if (!PRACTICE_SCOPES.includes(scope)) {
    throw new TypeError(`不支持的专项复习范围: ${scope}`);
  }
  const allWords = await db.getAllLearnWords();
  const seen = new Set();
  const activeWords = (allWords || []).filter(word => {
    if (!word || word.archivedAt != null) return false;
    const key = Number.isFinite(Number(word.id))
      ? `id:${Number(word.id)}`
      : `word:${String(word.word || '').trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (scope === 'manual') {
    const requested = new Set(normalizeIds(wordIds));
    const words = activeWords
      .filter(word => requested.has(Number(word.id)))
      .map(word => ({ ...word }));
    return { words, skipped: requested.size - words.length, scope };
  }

  const candidates = scope === 'today_added'
    ? activeWords.filter(word => addedAtOf(word) >= startOfDay(now) && addedAtOf(word) <= Number(now))
    : activeWords.filter(word => addedAtOf(word) >= Number(now) - Number(days) * 24 * 60 * 60 * 1000);
  return { words: candidates.map(word => ({ ...word })), skipped: 0, scope };
}

export function createPracticeSession({ scope, wordIds = [], skipped = 0 }) {
  const session = {
    scope,
    wordIds: normalizeIds(wordIds),
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

export function clearPracticeSession({ storage } = {}) {
  const targetStorage = storage === undefined ? defaultStorage('sessionStorage') : storage;
  try {
    targetStorage?.removeItem(PRACTICE_SESSION_KEY);
  } catch {
    // 忽略不可用存储
  }
}

/**
 * 仅当每个有效词都至少成功写入一次练习评分时结算。空词集和部分完成都保留会话。
 */
export function finalizePracticeSession({
  scope,
  expectedWordIds = [],
  completedWordIds = [],
  now = Date.now(),
  storage,
  sessionStorage
} = {}) {
  if (!PRACTICE_SCOPES.includes(scope)) return false;
  const expected = normalizeIds(expectedWordIds);
  if (!expected.length) return false;
  const completed = new Set(normalizeIds(completedWordIds));
  if (!expected.every(id => completed.has(id))) return false;
  markPracticeScopeDone(scope, { wordIds: expected, now, storage });
  clearPracticeSession({
    storage: sessionStorage === undefined ? defaultStorage('sessionStorage') : sessionStorage
  });
  return true;
}
