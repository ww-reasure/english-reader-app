import { ActivityType, normalizeLearningActivity } from './learning-activity.mjs';
import { localDayBounds, localDayKey, splitIntervalByLocalDay } from './learning-day.mjs';

export const READING_ACTIVITY_SAVE_INTERVAL_MS = 15_000;

const SECOND_MS = 1_000;
const MAX_GUIDE_INDEX = 10_000;

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const nonNegative = value => Math.max(0, finiteNumber(value));

const clampProgress = value => Math.max(0, Math.min(1, finiteNumber(value)));

const clip = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

function integer(value, fallback = -1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function normalizeGuideVisitedIndexes(indexes, totalSentences = 0) {
  const total = Math.max(0, integer(totalSentences, 0));
  return [...new Set((Array.isArray(indexes) ? indexes : [])
    .map(value => integer(value))
    .filter(value => value >= 0 && value <= MAX_GUIDE_INDEX && (total === 0 || value < total)))]
    .sort((left, right) => left - right);
}

export function readingActivityDedupeKey(dayKey, completionId) {
  return `reading-active:${String(dayKey || '')}:${String(completionId || '')}`;
}

/**
 * Split a timer delta across local calendar days.  `durationMs` is the active
 * timer delta, not necessarily the wall-clock interval, so time spent in the
 * background is never silently counted as reading.
 */
export function splitActiveDuration({ fromMs, toMs, durationMs, fallbackDayKey } = {}) {
  const duration = nonNegative(durationMs);
  const finish = finiteNumber(toMs, 0);
  const start = finiteNumber(fromMs, 0);
  let fallback = String(fallbackDayKey || '');
  if (!fallback) {
    try { fallback = localDayKey(finish || Date.now()); } catch { fallback = ''; }
  }
  if (!duration || !fallback) return [];
  if (!start || !finish || finish <= start) {
    return [{ dayKey: fallback, durationMs: Math.round(duration), occurredAt: finish || Date.now() }];
  }

  const slices = splitIntervalByLocalDay({ startedAt: start, endedAt: finish });
  if (!slices.length) return [{ dayKey: fallback, durationMs: Math.round(duration), occurredAt: finish }];
  const wallDuration = finish - start;
  let assigned = 0;
  return slices.map((slice, index) => {
    const value = index === slices.length - 1
      ? Math.max(0, Math.round(duration) - assigned)
      : Math.max(0, Math.round(duration * (slice.durationMs / wallDuration)));
    assigned += value;
    const dayBounds = localDayBounds(slice.dayKey);
    const occurredAt = Math.min(
      dayBounds.end - 1,
      Math.max(dayBounds.start, Math.min(finish, Math.max(start, slice.endedAt - 1)))
    );
    return { dayKey: slice.dayKey, durationMs: value, occurredAt };
  });
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}

function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' ? record.payload : {};
}

function guideIndexesOf(record, totalSentences = 0) {
  return normalizeGuideVisitedIndexes(payloadOf(record).guideVisitedIndexes, totalSentences);
}

function readActivityRecord(record, fallbackDayKey = '') {
  if (!record || typeof record !== 'object') return null;
  const payload = payloadOf(record);
  const dayKey = String(record.dayKey || fallbackDayKey || '');
  const completionId = String(payload.completionId || record.sessionId || '');
  if (!dayKey || !completionId) return null;
  return {
    ...record,
    dayKey,
    payload: {
      ...payload,
      durationMs: nonNegative(payload.durationMs),
      maxContentProgress: clampProgress(payload.maxContentProgress),
      guideVisitedIndexes: guideIndexesOf(record),
      guideVisitedCount: guideIndexesOf(record).length,
      completedToday: Boolean(payload.completedToday)
    }
  };
}

function mergeRecords(existing, incoming) {
  if (!existing) return clone(incoming);
  const oldPayload = payloadOf(existing);
  const newPayload = payloadOf(incoming);
  const guideVisitedIndexes = normalizeGuideVisitedIndexes([
    ...guideIndexesOf(existing),
    ...guideIndexesOf(incoming)
  ]);
  return {
    ...incoming,
    ...existing,
    id: incoming.id || existing.id,
    type: ActivityType.READING_ACTIVE_SLICE,
    occurredAt: Math.max(finiteNumber(existing.occurredAt), finiteNumber(incoming.occurredAt)),
    dayKey: incoming.dayKey || existing.dayKey,
    sessionId: incoming.sessionId || existing.sessionId,
    dedupeKey: incoming.dedupeKey || existing.dedupeKey,
    payload: {
      ...oldPayload,
      ...newPayload,
      durationMs: nonNegative(oldPayload.durationMs) + nonNegative(newPayload.durationMs),
      maxContentProgress: Math.max(clampProgress(oldPayload.maxContentProgress), clampProgress(newPayload.maxContentProgress)),
      guideVisitedIndexes,
      guideVisitedCount: guideVisitedIndexes.length,
      completedToday: Boolean(oldPayload.completedToday || newPayload.completedToday)
    }
  };
}

function buildRecord({ dayKey, completionId, articleId, articleTitle, durationMs, occurredAt, maxContentProgress, guideVisitedIndexes, mode, completedToday }) {
  const dedupeKey = readingActivityDedupeKey(dayKey, completionId);
  return normalizeLearningActivity({
    id: dedupeKey,
    type: ActivityType.READING_ACTIVE_SLICE,
    occurredAt,
    dayKey,
    sessionId: completionId,
    dedupeKey,
    payload: {
      articleId: articleId ?? null,
      articleTitle: clip(articleTitle, 240),
      completionId,
      durationMs: Math.max(0, Math.round(nonNegative(durationMs))),
      maxContentProgress: clampProgress(maxContentProgress),
      guideVisitedIndexes: normalizeGuideVisitedIndexes(guideVisitedIndexes),
      guideVisitedCount: normalizeGuideVisitedIndexes(guideVisitedIndexes).length,
      lastMode: mode === 'guide' ? 'guide' : 'full',
      completedToday: Boolean(completedToday)
    }
  }, occurredAt);
}

/**
 * Tracks one reading cycle as one bounded activity row per local day.  The
 * tracker intentionally keeps the timer/session details out of the report
 * layer and uses a latest-wins serialized writer so frequent timer callbacks do
 * not create a write storm.
 */
export function createReadingActivityTracker({
  db,
  articleId,
  articleTitle = '',
  completionId,
  now = () => Date.now(),
  saveIntervalMs = READING_ACTIVITY_SAVE_INTERVAL_MS,
  onError = null
} = {}) {
  const records = new Map();
  const pending = new Map();
  let initialized = false;
  let initializePromise = null;
  let writer = null;
  let flushScheduled = false;
  let sequence = 0;
  let lastFlushAt = 0;
  let lastError = null;
  let lastAccountedTimerElapsed = 0;
  let lastAccountedAt = null;
  let sawActiveObservation = false;

  const reportError = error => {
    lastError = error;
    try { onError?.(error); } catch {}
  };

  async function initialize() {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      try {
        const currentDay = localDayKey(now());
        let existing = null;
        if (typeof db?.getLearningActivityByDedupeKey === 'function') {
          existing = await db.getLearningActivityByDedupeKey(readingActivityDedupeKey(currentDay, completionId));
        } else if (typeof db?.listLearningActivities === 'function') {
          const bounds = localDayBounds(currentDay);
          const candidates = await db.listLearningActivities({
            from: bounds.start,
            to: bounds.end,
            types: [ActivityType.READING_ACTIVE_SLICE]
          });
          existing = (Array.isArray(candidates) ? candidates : []).find(item => (
            item?.type === ActivityType.READING_ACTIVE_SLICE
            && payloadOf(item).completionId === completionId
          )) || null;
        }
        const normalized = readActivityRecord(existing, currentDay);
        if (normalized) {
          records.set(currentDay, normalized);
          const key = normalized.dedupeKey || normalized.id;
          const queued = pending.get(key);
          if (queued) {
            const merged = mergeRecords(normalized, queued.record);
            records.set(currentDay, merged);
            pending.set(key, { record: merged, sequence: queued.sequence });
          }
        }
      } catch (error) {
        // A read failure should not block entering or continuing an article;
        // the first later write can still establish the stable row.
        reportError(error);
      } finally {
        initialized = true;
        initializePromise = null;
      }
    })();
    return initializePromise;
  }

  function enqueue(record) {
    const key = record.dedupeKey || record.id;
    const entry = { record: clone(record), sequence: ++sequence };
    pending.set(key, entry);
  }

  function scheduleFlush(nowMs) {
    if (!pending.size || writer || flushScheduled) return;
    if (lastFlushAt && nowMs - lastFlushAt < Math.max(0, Number(saveIntervalMs) || 0)) return;
    flushScheduled = true;
    const run = () => {
      flushScheduled = false;
      void flush().catch(() => {});
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function upsertDay({ dayKey, occurredAt, durationMs = 0, maxContentProgress = 0, guideVisitedIndexes = [], mode = 'full', completedToday = false }) {
    const current = records.get(dayKey);
    const currentPayload = payloadOf(current);
    const next = buildRecord({
      dayKey,
      completionId,
      articleId,
      articleTitle,
      durationMs: nonNegative(currentPayload.durationMs) + nonNegative(durationMs),
      occurredAt,
      maxContentProgress: Math.max(current ? currentPayload.maxContentProgress : 0, maxContentProgress),
      guideVisitedIndexes: [
        ...(current ? guideIndexesOf(current) : []),
        ...guideVisitedIndexes
      ],
      mode,
      completedToday: Boolean(current && payloadOf(current).completedToday) || completedToday
    });
    records.set(dayKey, next);
    enqueue(next);
    return next;
  }

  function record({
    phase = 'preview',
    active = true,
    elapsedSeconds = 0,
    nowMs = now(),
    maxContentProgress = 0,
    guideVisitedIndexes = [],
    totalSentences = 0,
    mode = 'full'
  } = {}) {
    if (phase !== 'active' || active === false || !completionId) return false;
    const timestamp = finiteNumber(nowMs, now());
    const elapsedMs = nonNegative(elapsedSeconds) * SECOND_MS;
    const normalizedIndexes = normalizeGuideVisitedIndexes(guideVisitedIndexes, totalSentences);

    if (!sawActiveObservation) {
      sawActiveObservation = true;
      lastAccountedTimerElapsed = 0;
      lastAccountedAt = timestamp - elapsedMs;
      if (!lastFlushAt) lastFlushAt = timestamp;
    }

    let deltaMs = 0;
    if (elapsedMs >= lastAccountedTimerElapsed * SECOND_MS) {
      deltaMs = elapsedMs - lastAccountedTimerElapsed * SECOND_MS;
    } else {
      // A timer reset starts a new view-level measurement.  It must not make
      // the old duration negative or remove already durable activity.
      lastAccountedTimerElapsed = 0;
      lastAccountedAt = timestamp - elapsedMs;
      deltaMs = elapsedMs;
    }

    const fromMs = lastAccountedAt ?? (timestamp - deltaMs);
    const segments = deltaMs > 0
      ? splitActiveDuration({
        fromMs,
        toMs: timestamp,
        durationMs: deltaMs,
        fallbackDayKey: localDayKey(timestamp)
      })
      : [{ dayKey: localDayKey(timestamp), durationMs: 0, occurredAt: timestamp }];
    for (const segment of segments) {
      upsertDay({
        ...segment,
        maxContentProgress,
        guideVisitedIndexes: normalizedIndexes,
        mode
      });
    }

    lastAccountedTimerElapsed = elapsedMs / SECOND_MS;
    lastAccountedAt = timestamp;
    lastError = null;
    scheduleFlush(timestamp);
    return true;
  }

  async function markCompleted({ nowMs = now() } = {}) {
    await initialize();
    const timestamp = finiteNumber(nowMs, now());
    const dayKey = localDayKey(timestamp);
    const existing = records.get(dayKey);
    if (existing) {
      upsertDay({
        dayKey,
        occurredAt: timestamp,
        maxContentProgress: payloadOf(existing).maxContentProgress,
        guideVisitedIndexes: guideIndexesOf(existing),
        mode: payloadOf(existing).lastMode,
        completedToday: true
      });
    } else {
      upsertDay({ dayKey, occurredAt: timestamp, completedToday: true });
    }
    return clone(records.get(dayKey));
  }

  async function runWriter() {
    if (writer) return writer;
    writer = (async () => {
      while (pending.size) {
        const entries = [...pending.entries()];
        pending.clear();
        const restoreIfNewer = (key, entry) => {
          const newer = pending.get(key);
          if (!newer || newer.sequence < entry.sequence) pending.set(key, entry);
        };
        for (let index = 0; index < entries.length; index += 1) {
          const [key, entry] = entries[index];
          try {
            if (typeof db?.saveLearningActivity !== 'function') throw new Error('学习活动保存接口不可用');
            await db.saveLearningActivity(clone(entry.record));
            const newer = pending.get(key);
            if (newer && newer.sequence <= entry.sequence) pending.delete(key);
            lastFlushAt = finiteNumber(now(), Date.now());
            lastError = null;
          } catch (error) {
            // If one day fails, preserve the failed row and every later day
            // from this batch.  A cross-midnight checkpoint can legitimately
            // contain more than one pending row; dropping the tail would make
            // a retry silently lose part of the user's reading time.
            restoreIfNewer(key, entry);
            for (const [remainingKey, remainingEntry] of entries.slice(index + 1)) {
              restoreIfNewer(remainingKey, remainingEntry);
            }
            reportError(error);
            throw error;
          }
        }
      }
      return true;
    })();
    try {
      return await writer;
    } finally {
      writer = null;
    }
  }

  async function flush() {
    await initialize();
    if (writer) await writer;
    if (pending.size) await runWriter();
    if (lastError && pending.size) throw lastError;
    return { ok: true, pendingCount: pending.size };
  }

  return {
    initialize,
    record,
    markCompleted,
    flush,
    getRecord: dayKey => clone(records.get(dayKey) || null),
    getRecords: () => [...records.values()].map(clone),
    getStatus: () => ({
      initialized,
      pendingCount: pending.size,
      writing: Boolean(writer),
      lastError,
      lastFlushAt
    })
  };
}
