/**
 * Review persistence coordinator.
 *
 * The review UI may advance optimistically, but every formal rating is first
 * written to a small local journal and then applied to IndexedDB in order.
 * Session snapshots are coalesced independently so a slow storage device does
 * not turn every card transition into a visible wait.
 */

export const REVIEW_PENDING_STORAGE_KEY = 'english-reader:pending-review-writes:v1';
export const REVIEW_SESSION_EMERGENCY_PREFIX = 'english-reader:review-session-checkpoint:v1:';

const DEFAULT_RETRY_DELAYS = Object.freeze([250, 1000, 3000]);
const MAX_PENDING_RATINGS = 100;
const RATING_INTENT_VERSION = 2;

function clone(value) {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function safeNow(now) {
  const value = Number(now?.());
  return Number.isFinite(value) ? value : Date.now();
}

function defaultStorage() {
  try {
    return globalThis?.localStorage || null;
  } catch {
    return null;
  }
}

function safeCallback(callback, ...args) {
  try {
    callback?.(...args);
  } catch {
    // Persistence status must never become another source of review failures.
  }
}

function diagnosticLogger() {
  try {
    return globalThis?.__englishReaderDiagnosticLogger || null;
  } catch {
    return null;
  }
}

function ratingMetadata(source = {}, event = {}) {
  const { rating, sessionDebt, occurredAt, source: _source, sawAnswer, metadata, ...legacyMetadata } = event || {};
  const explicitMetadata = source?.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
    ? source.metadata
    : metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null;
  const merged = { ...legacyMetadata, ...(explicitMetadata || {}) };
  return Object.keys(merged).length ? clone(merged) : null;
}

function normalizeRatingIntent(row = {}) {
  const source = row?.intent || row?.ratingIntent || {};
  const event = row?.event || {};
  const rating = [1, 3, 5].includes(Number(source.rating))
    ? Number(source.rating)
    : [1, 3, 5].includes(Number(event.rating)) ? Number(event.rating) : null;
  if (rating === null) return null;
  const metadata = ratingMetadata(source, event);
  return {
    version: RATING_INTENT_VERSION,
    rating,
    sessionDebt: Math.max(0, Math.trunc(Number(source.sessionDebt ?? event.sessionDebt) || 0)),
    occurredAt: Number.isFinite(Number(source.occurredAt))
      ? Number(source.occurredAt)
      : Number.isFinite(Number(event.reviewedAt)) ? Number(event.reviewedAt) : Math.max(0, Number(row.queuedAt) || 0),
    source: String(source.source || event.source || 'flashcard'),
    sawAnswer: Boolean(source.sawAnswer ?? event.sawAnswer),
    ...(metadata ? { metadata } : {})
  };
}

function errorCodeFor(error) {
  const explicit = String(error?.code || '').trim();
  if (explicit) return explicit;
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (name === 'QuotaExceededError') return 'STORAGE_FULL';
  if (name === 'BlockedError' || /blocked|阻塞/i.test(message)) return 'DB_BLOCKED';
  if (name === 'AbortError' || name === 'TransactionInactiveError') return 'DB_TRANSACTION_ABORTED';
  if (/不存在|missing/i.test(message)) return 'MISSING_WORD';
  if (/corrupt|损坏/i.test(message)) return 'DATA_CORRUPT';
  return 'UNKNOWN';
}

// An unreadable journal must never read as "nothing pending": the raw text is
// kept as one quarantined evidence row so the result screen can explain the
// failure and retry never executes the damaged payload as a rating.
function quarantineRow(raw) {
  return {
    operationId: 'corrupt-journal',
    attemptId: 'corrupt-journal',
    wordId: Number.NaN,
    corruptRaw: raw,
    queuedAt: 0,
    attempts: 0,
    nextRetryAt: 0,
    status: 'failed',
    errorCode: 'DATA_CORRUPT'
  };
}

function readJournal(storage) {
  let raw = null;
  try {
    raw = storage?.getItem?.(REVIEW_PENDING_STORAGE_KEY) ?? null;
  } catch {
    return [];
  }
  if (raw == null || raw === '') return [];
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [quarantineRow(raw)];
  }
  if (!Array.isArray(rows)) return [quarantineRow(raw)];
  return rows
    .map(row => {
      // 数组里的每个元素都保留：数字、字符串、null 等非对象元素同样转成
      // 隔离证据行，绝不能 filter 掉后把 journal 误读为空。
      if (!row || typeof row !== 'object') {
        return quarantineRow(typeof row === 'string' ? row : JSON.stringify(row));
      }
      const intent = normalizeRatingIntent(row);
      // Identifiers are trimmed first, then validated: a blank-padded id is
      // usable, but whitespace-only ids or a non-positive/non-integer wordId
      // can never be replayed idempotently, so they stay as DATA_CORRUPT
      // diagnostics instead of reaching the database layer.
      const operationId = String(row.operationId ?? '').trim();
      const attemptId = String(row.attemptId ?? '').trim();
      const wordId = Number(row.wordId);
      const hasStableIds = operationId !== '' && attemptId !== ''
        && Number.isSafeInteger(wordId) && wordId > 0;
      return {
        ...row,
        operationId: hasStableIds ? operationId : row.operationId,
        attemptId: hasStableIds ? attemptId : row.attemptId,
        wordId,
        intent: hasStableIds ? intent : null,
        attempts: Math.max(0, Number(row.attempts) || 0),
        nextRetryAt: Math.max(0, Number(row.nextRetryAt) || 0),
        errorCode: hasStableIds && intent ? String(row.errorCode || '').trim() : 'DATA_CORRUPT',
        // Keep malformed historical entries in the journal.  They cannot be
        // replayed safely, but deleting them would hide recoverable evidence
        // and leave the result screen stuck without an explanation.
        status: !hasStableIds || !intent || row.status === 'failed' ? 'failed' : 'queued'
      };
    });
}

function writeJournal(storage, rows) {
  if (!storage?.setItem) throw new Error('复习评分暂时无法建立本地保存凭据');
  storage.setItem(REVIEW_PENDING_STORAGE_KEY, JSON.stringify(rows));
}

function removeCheckpoint(storage, key, sequence) {
  try {
    const storageKey = `${REVIEW_SESSION_EMERGENCY_PREFIX}${encodeURIComponent(String(key))}`;
    const raw = storage?.getItem?.(storageKey);
    if (!raw) return;
    const checkpoint = JSON.parse(raw);
    if (Number(checkpoint?.sequence) === Number(sequence)) storage.removeItem(storageKey);
  } catch {
    // The IndexedDB copy remains authoritative when checkpoint cleanup fails.
  }
}

export function clearEmergencySessionCheckpoint({ storage = defaultStorage(), key } = {}) {
  try {
    if (!storage?.removeItem || !String(key || '').trim()) return;
    storage.removeItem(`${REVIEW_SESSION_EMERGENCY_PREFIX}${encodeURIComponent(String(key))}`);
  } catch {
    // A stale emergency copy is harmless when the durable session is gone.
  }
}

function writeCheckpoint(storage, key, snapshot) {
  try {
    if (!storage?.setItem) return;
    const storageKey = `${REVIEW_SESSION_EMERGENCY_PREFIX}${encodeURIComponent(String(key))}`;
    storage.setItem(storageKey, JSON.stringify({
      key,
      sequence: snapshot.sequence,
      updatedAt: snapshot.updatedAt,
      snapshot: clone(snapshot)
    }));
  } catch {
    // The caller still has the in-memory snapshot and the IndexedDB writer.
  }
}

export function readEmergencySessionCheckpoint({ storage = defaultStorage(), key } = {}) {
  try {
    const sessionKey = String(key || '').trim();
    if (!sessionKey) return null;
    const storageKey = `${REVIEW_SESSION_EMERGENCY_PREFIX}${encodeURIComponent(sessionKey)}`;
    const raw = storage?.getItem?.(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw);
    const snapshot = value?.snapshot;
    if (!snapshot || (!Array.isArray(snapshot.queue) && !Array.isArray(snapshot.buffer) && !Array.isArray(snapshot.items))) return null;
    return {
      ...snapshot,
      key: sessionKey,
      sequence: Number(value.sequence ?? snapshot.sequence) || 0,
      updatedAt: Number(value.updatedAt ?? snapshot.updatedAt) || 0
    };
  } catch {
    return null;
  }
}

function normalizeSnapshot(key, snapshot, now, sequence) {
  const value = clone(snapshot || {});
  return {
    ...value,
    id: value.id || key,
    key,
    sequence: Math.max(0, Number(sequence) || Number(value.sequence) || 0),
    updatedAt: Math.max(0, Number(value.updatedAt) || safeNow(now))
  };
}

export function createReviewPersistence({
  db = null,
  storage = defaultStorage(),
  now = () => Date.now(),
  onStatus = null,
  executeRating = null,
  saveSession = null,
  retryDelays = DEFAULT_RETRY_DELAYS
} = {}) {
  const delays = Array.isArray(retryDelays)
    ? retryDelays.map(value => Math.max(0, Number(value) || 0))
    : [...DEFAULT_RETRY_DELAYS];

  const execute = executeRating || (async operation => {
    if (db?.applyReviewRatingIntent) {
      return db.applyReviewRatingIntent(operation.wordId, operation.intent, {
        attemptId: operation.attemptId,
        expectedRevision: operation.expectedRevision,
        correlationId: operation.correlationId
      });
    }
    if (!db?.settleSessionReview) throw new Error('缺少正式复习保存接口');
    return db.settleSessionReview(operation.wordId, operation.srsData, {
      ...(operation.event || {}),
      attemptId: operation.attemptId,
      expectedRevision: operation.expectedRevision,
      correlationId: operation.correlationId
    });
  });
  const save = saveSession || (async (snapshot, key) => {
    const saveMethod = key === 'context-review-active' && db?.saveContextReviewSession
      ? db.saveContextReviewSession.bind(db)
      : db?.saveReviewSession?.bind(db);
    if (!saveMethod) throw new Error('缺少复习会话保存接口');
    return saveMethod({ ...snapshot, id: key || snapshot.id });
  });
  const removeSession = async key => {
    if (key === 'context-review-active' && db?.deleteContextReviewSession) {
      return db.deleteContextReviewSession(key);
    }
    if (db?.deleteReviewSession) return db.deleteReviewSession(key);
    return undefined;
  };

  let journal = readJournal(storage);
  if (journal.length) {
    try { writeJournal(storage, journal); } catch {}
  }
  let ratingRunning = null;
  let retryTimer = null;
  let retryTimerAt = 0;
  let sessionRunning = null;
  let sessionRunningKey = null;
  let sessionSequence = 0;
  const sessionPending = new Map();
  const sessionState = new Map();
  // A completed session may still have an in-flight save. Remember its
  // sequence so a late write cannot resurrect it after the result screen.
  const sessionDiscards = new Map();
  const subscribers = new Set();

  for (const row of journal) sessionSequence = Math.max(sessionSequence, Number(row.sequence) || 0);

  const emit = (type, payload = {}) => {
    const event = { type, ...clone(payload) };
    safeCallback(onStatus, event);
    for (const subscriber of subscribers) safeCallback(subscriber, event);
    const logger = diagnosticLogger();
    const diagnosticType = {
      rating_queued: 'review.write_queued',
      rating_started: 'review.write_started',
      rating_completed: 'review.write_completed',
      rating_retry_scheduled: 'review.retry_scheduled',
      rating_failed: 'review.write_failed',
      rating_idle: 'review.write_idle',
      session_queued: 'review.session_save_queued',
      session_started: 'review.session_save_started',
      session_completed: 'review.session_save_completed',
      session_failed: 'review.session_save_failed',
      pending_replayed: 'review.pending_replayed'
    }[type];
    if (diagnosticType && logger?.record) {
      safeCallback(logger.record.bind(logger), diagnosticType, {
        category: 'review',
        level: type.endsWith('failed') ? 'error' : 'info',
        correlationId: payload.correlationId,
        payload: {
          operationId: payload.operationId,
          attemptId: payload.attemptId,
          wordId: payload.wordId,
          key: payload.key,
          sequence: payload.sequence,
          errorName: payload.errorName,
          errorCode: payload.errorCode,
          nextRetryAt: payload.nextRetryAt
        }
      });
    }
  };

  const ratingStatus = () => {
    const pendingRows = journal.filter(row => row.status !== 'failed');
    return {
      pending: journal.length,
      failed: journal.filter(row => row.status === 'failed').length,
      running: Boolean(ratingRunning),
      operationIds: journal.map(row => row.operationId),
      nextRetryAt: pendingRows.reduce((next, row) => {
        const value = Math.max(0, Number(row.nextRetryAt) || 0);
        return value && (!next || value < next) ? value : next;
      }, 0),
      errorCodes: [...new Set(journal.map(row => row.errorCode).filter(Boolean))]
    };
  };

  const sessionStatus = () => {
    const failed = [...sessionState.values()].filter(state => state === 'failed').length;
    return {
      pending: sessionPending.size,
      failed,
      running: Boolean(sessionRunning),
      pendingKeys: [...sessionPending.keys()]
    };
  };

  const scheduleRatings = () => {
    if (ratingRunning) return;
    queueMicrotask(() => {
      void drainRatings().catch(error => emit('rating_drain_failed', { errorName: error?.name || 'Error' }));
    });
  };

  const scheduleRetryWake = () => {
    const nowAt = safeNow(now);
    const nextRetryAt = journal
      .filter(row => row.status === 'queued' && Number(row.nextRetryAt) > nowAt)
      .reduce((next, row) => !next || Number(row.nextRetryAt) < next ? Number(row.nextRetryAt) : next, 0);
    if (!nextRetryAt) return;
    // Keep at most one wake timer, but re-arm it whenever an operation becomes
    // due earlier than the currently scheduled wake.
    if (retryTimer !== null && retryTimerAt <= nextRetryAt) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimerAt = nextRetryAt;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryTimerAt = 0;
      scheduleRatings();
    }, Math.max(0, nextRetryAt - nowAt));
  };

  const scheduleSessions = () => {
    if (sessionRunning) return;
    queueMicrotask(() => {
      void drainSessions().catch(error => emit('session_drain_failed', { errorName: error?.name || 'Error' }));
    });
  };

  async function drainRatings() {
    if (ratingRunning) return ratingRunning;
    const run = (async () => {
      while (true) {
        const nowAt = safeNow(now);
        const row = journal.find((item, index) => item.status === 'queued'
          && Number(item.nextRetryAt || 0) <= nowAt
          && !journal.slice(0, index).some(previous => previous.wordId === item.wordId));
        if (!row) {
          scheduleRetryWake();
          break;
        }
        const attempt = Math.max(0, Number(row.attempts) || 0);
        row.status = 'running';
        writeJournal(storage, journal);
        sessionState.set(`rating:${row.operationId}`, 'running');
        emit('rating_started', { operationId: row.operationId, attemptId: row.attemptId, wordId: row.wordId, correlationId: row.correlationId });
        try {
          await execute(clone(row));
          journal = journal.filter(item => item.operationId !== row.operationId);
          writeJournal(storage, journal);
          sessionState.delete(`rating:${row.operationId}`);
          emit('rating_completed', { operationId: row.operationId, attemptId: row.attemptId, wordId: row.wordId, correlationId: row.correlationId });
        } catch (error) {
          row.attempts = attempt + 1;
          const retryDelay = delays[attempt];
          if (retryDelay !== undefined) {
            row.status = 'queued';
            row.errorCode = errorCodeFor(error);
            row.lastErrorAt = safeNow(now);
            row.nextRetryAt = row.lastErrorAt + retryDelay;
            writeJournal(storage, journal);
            emit('rating_retry_scheduled', {
              operationId: row.operationId,
              attempt: row.attempts,
              delayMs: retryDelay,
              wordId: row.wordId,
              correlationId: row.correlationId,
              errorName: error?.name || 'Error',
              errorCode: row.errorCode,
              nextRetryAt: row.nextRetryAt
            });
          } else {
            row.status = 'failed';
            row.errorCode = errorCodeFor(error);
            row.lastErrorAt = safeNow(now);
            writeJournal(storage, journal);
            sessionState.set(`rating:${row.operationId}`, 'failed');
            emit('rating_failed', {
              operationId: row.operationId,
              attemptId: row.attemptId,
              wordId: row.wordId,
              correlationId: row.correlationId,
              errorName: error?.name || 'Error',
              errorCode: row.errorCode
            });
            // Do not let one permanently failed word block other ratings.
          }
        }
      }
    })();
    ratingRunning = run;
    const finishDrain = () => {
      if (ratingRunning !== run) return;
      ratingRunning = null;
      if (!journal.length) emit('rating_idle', ratingStatus());
    };
    // Consume both branches here; the scheduled caller still receives the
    // original promise and reports unexpected drain failures.
    void run.then(finishDrain, finishDrain);
    return run;
  }

  async function drainSessions() {
    if (sessionRunning) return sessionRunning;
    sessionRunning = (async () => {
      while (true) {
        const entry = [...sessionPending.entries()].find(([, job]) => job.status !== 'failed');
        if (!entry) break;
        const [key, job] = entry;
        sessionPending.delete(key);
        sessionRunningKey = key;
        sessionState.set(key, 'running');
        emit('session_started', { key, sequence: job.snapshot.sequence });
        try {
          await save(job.snapshot, key);
          const discardThrough = sessionDiscards.get(key);
          if (discardThrough !== undefined && job.snapshot.sequence <= discardThrough) {
            // The result screen may have requested cleanup while this write
            // was in flight. Delete once more after the write to prevent the
            // old snapshot from being resurrected.
            await removeSession(key).catch(() => {});
            sessionDiscards.delete(key);
          }
          removeCheckpoint(storage, key, job.snapshot.sequence);
          sessionState.set(key, 'completed');
          emit('session_completed', { key, sequence: job.snapshot.sequence });
        } catch (error) {
          const discardThrough = sessionDiscards.get(key);
          if (discardThrough !== undefined && job.snapshot.sequence <= discardThrough) {
            sessionPending.delete(key);
            sessionDiscards.delete(key);
            sessionState.set(key, 'completed');
            emit('session_completed', { key, sequence: job.snapshot.sequence, discarded: true });
          } else {
            sessionPending.set(key, { ...job, status: 'failed' });
            sessionState.set(key, 'failed');
            emit('session_failed', { key, sequence: job.snapshot.sequence, errorName: error?.name || 'Error' });
          }
        } finally {
          if (sessionRunningKey === key) sessionRunningKey = null;
        }
      }
    })().finally(() => {
      sessionRunning = null;
    });
    return sessionRunning;
  }

  function enqueueRating(operation = {}) {
    const intent = normalizeRatingIntent({ ...operation, queuedAt: operation.queuedAt || safeNow(now) });
    const normalized = {
      ...clone(operation),
      operationId: String(operation.operationId || '').trim(),
      attemptId: String(operation.attemptId || '').trim(),
      wordId: Number(operation.wordId),
      expectedRevision: Number.isFinite(Number(operation.expectedRevision)) ? Number(operation.expectedRevision) : undefined,
      queuedAt: Math.max(0, Number(operation.queuedAt) || safeNow(now)),
      intent,
      attempts: 0,
      nextRetryAt: 0,
      status: 'queued'
    };
    if (!normalized.operationId || !normalized.attemptId
      || !(Number.isSafeInteger(normalized.wordId) && normalized.wordId > 0)
      || !intent) {
      throw new TypeError('复习评分缺少可恢复标识');
    }
    if (journal.some(row => row.operationId === normalized.operationId || row.attemptId === normalized.attemptId)) {
      return { accepted: true, duplicate: true, operationId: normalized.operationId };
    }
    if (journal.length >= MAX_PENDING_RATINGS) throw new Error('待保存评分过多，请先恢复网络后再继续复习');
    const next = [...journal, normalized];
    writeJournal(storage, next);
    journal = next;
    emit('rating_queued', { operationId: normalized.operationId, attemptId: normalized.attemptId, wordId: normalized.wordId, correlationId: normalized.correlationId });
    scheduleRatings();
    return { accepted: true, duplicate: false, operationId: normalized.operationId };
  }

  function enqueueSession({ key, snapshot } = {}) {
    const sessionKey = String(key || snapshot?.id || '').trim();
    if (!sessionKey) throw new TypeError('复习会话缺少稳定标识');
    const incomingSequence = Math.max(0, Number(snapshot?.sequence) || 0);
    // Preserve a sequence restored from durable storage on the first enqueue,
    // then advance it even when the restored snapshot keeps reporting that
    // same sequence. This makes every new checkpoint strictly newer.
    if (sessionSequence === 0 && incomingSequence > 0) {
      sessionSequence = incomingSequence;
    } else {
      sessionSequence = Math.max(sessionSequence + 1, incomingSequence);
    }
    if (sessionSequence === 0) sessionSequence = 1;
    const normalized = normalizeSnapshot(sessionKey, snapshot, now, sessionSequence);
    const discardedThrough = sessionDiscards.get(sessionKey);
    if (discardedThrough !== undefined && normalized.sequence > discardedThrough) {
      sessionDiscards.delete(sessionKey);
    }
    sessionPending.set(sessionKey, { key: sessionKey, snapshot: normalized, status: 'queued' });
    sessionState.set(sessionKey, 'queued');
    writeCheckpoint(storage, sessionKey, normalized);
    emit('session_queued', { key: sessionKey, sequence: normalized.sequence });
    scheduleSessions();
    return { accepted: true, key: sessionKey, sequence: normalized.sequence };
  }

  async function clearSession({ key } = {}) {
    const sessionKey = String(key || '').trim();
    if (!sessionKey) return { accepted: false, reason: 'missing-key' };
    const discardThrough = sessionSequence;
    sessionDiscards.set(sessionKey, Math.max(sessionDiscards.get(sessionKey) || 0, discardThrough));
    sessionPending.delete(sessionKey);
    sessionState.set(sessionKey, 'clearing');
    clearEmergencySessionCheckpoint({ storage, key: sessionKey });
    try {
      await removeSession(sessionKey);
      if (sessionRunningKey !== sessionKey) sessionDiscards.delete(sessionKey);
      sessionState.set(sessionKey, 'completed');
      return { accepted: true, running: sessionRunningKey === sessionKey };
    } catch (error) {
      sessionState.set(sessionKey, 'failed');
      emit('session_clear_failed', { key: sessionKey, errorName: error?.name || 'Error' });
      return { accepted: false, error };
    }
  }

  async function flush({ timeoutMs = 5000 } = {}) {
    const timeout = Math.max(0, Number(timeoutMs) || 0);
    const deadline = safeNow(now) + timeout;
    const wallClockStart = Date.now();

    const waitForRunning = async (running, remainingMs) => {
      if (remainingMs <= 0) return false;
      let timer = null;
      let timedOut = false;
      const timeoutPromise = new Promise(resolve => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, remainingMs);
      });
      try {
        await Promise.race([Promise.all(running), timeoutPromise]);
        return !timedOut;
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    };

    while (safeNow(now) <= deadline && Date.now() - wallClockStart <= timeout) {
      scheduleRatings();
      scheduleSessions();
      const running = [ratingRunning, sessionRunning].filter(Boolean);
      if (!running.length) {
        const nowAt = safeNow(now);
        const ratingQueued = journal.some(row => row.status !== 'failed');
        const ratingReady = journal.some((row, index) => row.status === 'queued'
          && Number(row.nextRetryAt || 0) <= nowAt
          && !journal.slice(0, index).some(previous => previous.wordId === row.wordId));
        const sessionQueued = [...sessionPending.values()].some(job => job.status !== 'failed');
        if (!ratingQueued && !sessionQueued) break;
        if (ratingQueued && !ratingReady && !sessionQueued) break;
      } else {
        // A storage operation can remain pending forever on a locked or
        // broken IndexedDB connection. Do not make pagehide, correction, or
        // app shutdown wait forever; the journal/checkpoint remains durable
        // and the in-flight operation is allowed to finish independently.
        const clockRemaining = deadline - safeNow(now);
        const wallRemaining = timeout - (Date.now() - wallClockStart);
        const completed = await waitForRunning(running, Math.max(0, Math.min(clockRemaining, wallRemaining)));
        if (!completed) break;
      }
      if (safeNow(now) >= deadline) break;
      if (!ratingRunning && !sessionRunning) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return getStatus();
  }

  async function replay() {
    if (journal.length) {
      journal = journal.map(row => row.intent
        ? { ...row, status: 'queued', attempts: 0, nextRetryAt: 0, errorCode: '' }
        : { ...row, status: 'failed', errorCode: 'DATA_CORRUPT' });
      writeJournal(storage, journal);
      emit('pending_replayed', { count: journal.length });
    }
    for (const job of sessionPending.values()) job.status = 'queued';
    return flush();
  }

  async function retryFailed() {
    return replay();
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  function getPendingWordIds() {
    return [...new Set(journal.map(row => Number(row.wordId)).filter(Number.isFinite))];
  }

  function getStatus() {
    return {
      rating: ratingStatus(),
      session: sessionStatus()
    };
  }

  return Object.freeze({
    enqueueRating,
    enqueueSession,
    clearSession,
    flush,
    replay,
    retryFailed,
    subscribe,
    getPendingWordIds,
    getStatus
  });
}

let defaultPersistence = null;
let defaultPersistenceDb = null;

// The default instance is created by a .js caller with its DB dependency. This
// keeps the pure .mjs module importable by Node tests in this CommonJS package
// while production screens still share one coordinator.
export function getReviewPersistence(db, options = {}) {
  if (!defaultPersistence || defaultPersistenceDb !== db) {
    defaultPersistenceDb = db;
    defaultPersistence = createReviewPersistence({ db, ...options });
  }
  return defaultPersistence;
}
