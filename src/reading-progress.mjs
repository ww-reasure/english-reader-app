/**
 * Durable, content-bound reading progress.
 *
 * This module deliberately has no dependency on ReadingView or IndexedDB.  The
 * view supplies the persistence functions so the state machine can be tested
 * independently and a slow database can never dictate the UI state model.
 */

export const READING_PROGRESS_VERSION = 1;
export const PREVIEW_ACTIVE_SECONDS = 30;
export const PREVIEW_SCROLL_THRESHOLD = 0.1;

const VALID_MODES = new Set(['full', 'guide']);

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, numberOr(value, fallback));
}

function integerOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clampProgress(value, fallback = 0) {
  return Math.min(1, Math.max(0, numberOr(value, fallback)));
}

function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

/**
 * A small deterministic fingerprint is sufficient here.  It is a content
 * version guard, not a cryptographic identity.  Only the English body is
 * supplied by callers; translations and presentation metadata are excluded.
 */
export function contentFingerprint(content) {
  const source = normalizeLineEndings(content).trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `reading-v${READING_PROGRESS_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeVisitedIndexes(indexes, totalSentences) {
  const total = Math.max(0, integerOr(totalSentences, 0));
  const values = Array.isArray(indexes) ? indexes : [];
  return [...new Set(values
    .map(value => integerOr(value, -1))
    .filter(value => value >= 0 && (total === 0 || value < total)))]
    .sort((left, right) => left - right);
}

function normalizeAnchor(anchor = {}) {
  return {
    paragraphIndex: Math.max(0, integerOr(anchor.paragraphIndex, 0)),
    sentenceIndex: Math.max(0, integerOr(anchor.sentenceIndex, 0))
  };
}

/**
 * Normalize a stored snapshot and reject snapshots belonging to another
 * article/body.  Missing optional fields are tolerated for forward/backward
 * compatibility; a mismatched fingerprint is never silently resumed.
 */
export function normalizeReadingProgress(raw, {
  articleId,
  contentFingerprint: expectedFingerprint,
  totalSentences = 0
} = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (articleId !== undefined && raw.articleId !== articleId) return null;
  if (expectedFingerprint && raw.contentFingerprint !== expectedFingerprint) return null;
  if (raw.status && raw.status !== 'in_progress') return null;

  const total = Math.max(0, integerOr(totalSentences || raw.guide?.totalSentences, 0));
  const rawFull = raw.full && typeof raw.full === 'object' ? raw.full : {};
  const rawGuide = raw.guide && typeof raw.guide === 'object' ? raw.guide : {};
  const visitedIndexes = normalizeVisitedIndexes(rawGuide.visitedIndexes, total);
  const lastIndex = total > 0
    ? Math.min(total - 1, Math.max(0, integerOr(rawGuide.lastIndex, visitedIndexes.at(-1) || 0)))
    : Math.max(0, integerOr(rawGuide.lastIndex, visitedIndexes.at(-1) || 0));

  return {
    articleId: raw.articleId ?? articleId,
    version: READING_PROGRESS_VERSION,
    contentFingerprint: expectedFingerprint || raw.contentFingerprint || '',
    status: 'in_progress',
    startedAt: nonNegative(raw.startedAt, 0),
    updatedAt: nonNegative(raw.updatedAt, 0),
    lastReadAt: nonNegative(raw.lastReadAt, 0),
    lastMode: VALID_MODES.has(raw.lastMode) ? raw.lastMode : 'full',
    activeSeconds: nonNegative(raw.activeSeconds, 0),
    full: {
      maxProgress: clampProgress(rawFull.maxProgress, 0),
      ...normalizeAnchor(rawFull)
    },
    guide: {
      lastIndex,
      visitedIndexes,
      totalSentences: total
    }
  };
}

export function shouldPromoteReading({
  activeSeconds = 0,
  actualScrollProgress = 0,
  didUserScroll = false,
  sessionGuideVisitedCount = 0,
  bodyLookupCount = 0,
  explicitResume = false
} = {}) {
  return Boolean(explicitResume)
    || nonNegative(activeSeconds) >= PREVIEW_ACTIVE_SECONDS
    || (Boolean(didUserScroll) && numberOr(actualScrollProgress) >= PREVIEW_SCROLL_THRESHOLD)
    || integerOr(sessionGuideVisitedCount, 0) >= 2
    || integerOr(bodyLookupCount, 0) > 0;
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Create a resumable reading session.  `activeSeconds` in all activity inputs
 * is relative to this app session.  The persisted base is captured once, so
 * repeated checkpoints can never add the same old time more than once.
 */
export function createReadingProgressSession({
  articleId,
  content,
  persisted = null,
  now = () => Date.now(),
  save = async () => {},
  remove = async () => {},
  onError = null
} = {}) {
  const fingerprint = contentFingerprint(content);
  const normalizedPersisted = normalizeReadingProgress(persisted, {
    articleId,
    contentFingerprint: fingerprint,
    totalSentences: persisted?.guide?.totalSentences || 0
  });
  const persistedBase = normalizedPersisted?.activeSeconds || 0;
  const startedAt = normalizedPersisted?.startedAt || nonNegative(now(), Date.now());
  const persistedGuideVisited = new Set(normalizedPersisted?.guide?.visitedIndexes || []);
  const guideVisited = new Set(persistedGuideVisited);
  const sessionGuideVisited = new Set();
  let phase = normalizedPersisted ? 'resume' : 'preview';
  let sessionActiveSeconds = 0;
  let mode = normalizedPersisted?.lastMode || 'full';
  let full = clone(normalizedPersisted?.full || { maxProgress: 0, paragraphIndex: 0, sentenceIndex: 0 });
  let fullAnchorProgress = normalizedPersisted ? Number(full.maxProgress || 0) : -1;
  let guideLastIndex = normalizedPersisted?.guide?.lastIndex || 0;
  let totalSentences = normalizedPersisted?.guide?.totalSentences || 0;
  let bodyLookupCount = 0;
  let explicitActivation = false;
  let finalized = false;
  let finalSnapshot = null;
  let lastError = null;
  let pendingSnapshot = null;
  let writer = null;
  let writerKickScheduled = false;
  let checkpointTimer = null;
  const waiters = [];

  const resolveWaiters = (error = null) => {
    while (waiters.length) {
      const waiter = waiters.shift();
      if (error) waiter.reject(error);
      else waiter.resolve(finalSnapshot || lastSnapshot());
    }
  };

  const lastSnapshot = () => buildSnapshot();

  function applyActivity({
    activeSeconds,
    mode: nextMode,
    fullProgress,
    fullAnchor,
    guideIndex,
    actualScrollProgress,
    didUserScroll,
    bodyLookup,
    bodyLookupCount: nextBodyLookupCount,
    explicitResume = false,
    totalSentenceCount
  } = {}) {
    const nextSeconds = numberOr(activeSeconds, sessionActiveSeconds);
    sessionActiveSeconds = Math.max(sessionActiveSeconds, nonNegative(nextSeconds));
    if (VALID_MODES.has(nextMode)) mode = nextMode;
    if (Number.isFinite(Number(totalSentenceCount))) {
      totalSentences = Math.max(totalSentences, integerOr(totalSentenceCount, 0));
    }
    if (Number.isFinite(Number(guideIndex))) {
      const index = Math.max(0, integerOr(guideIndex, 0));
      guideLastIndex = index;
      sessionGuideVisited.add(index);
      guideVisited.add(index);
    }
    if (Number.isFinite(Number(nextBodyLookupCount))) {
      bodyLookupCount = Math.max(bodyLookupCount, integerOr(nextBodyLookupCount, 0));
    } else if (bodyLookup) {
      bodyLookupCount += 1;
    }
    if (Number.isFinite(Number(fullProgress))) {
      const progress = clampProgress(fullProgress);
      if (progress > Number(full.maxProgress || 0)) {
        full = { ...full, maxProgress: progress };
        if (fullAnchor) {
          full = { ...full, ...normalizeAnchor(fullAnchor) };
          fullAnchorProgress = progress;
        } else {
          fullAnchorProgress = -1;
        }
      } else if (fullAnchor && progress >= fullAnchorProgress) {
        full = { ...full, ...normalizeAnchor(fullAnchor) };
        fullAnchorProgress = progress;
      }
    }
    if (explicitResume) explicitActivation = true;
  }

  function buildSnapshot() {
    const timestamp = nonNegative(now(), Date.now());
    return {
      articleId,
      version: READING_PROGRESS_VERSION,
      contentFingerprint: fingerprint,
      status: 'in_progress',
      startedAt,
      updatedAt: timestamp,
      lastReadAt: timestamp,
      lastMode: mode,
      activeSeconds: persistedBase + sessionActiveSeconds,
      full: {
        maxProgress: clampProgress(full.maxProgress),
        paragraphIndex: Math.max(0, integerOr(full.paragraphIndex, 0)),
        sentenceIndex: Math.max(0, integerOr(full.sentenceIndex, 0))
      },
      guide: {
        lastIndex: Math.max(0, integerOr(guideLastIndex, 0)),
        visitedIndexes: [...guideVisited].sort((left, right) => left - right),
        totalSentences: Math.max(0, integerOr(totalSentences, 0))
      }
    };
  }

  async function runWriter() {
    if (writer) return writer;
    writer = (async () => {
      let failure = null;
      while (pendingSnapshot) {
        const snapshot = pendingSnapshot;
        pendingSnapshot = null;
        try {
          await save(clone(snapshot));
          finalSnapshot = clone(snapshot);
          lastError = null;
        } catch (error) {
          lastError = error;
          pendingSnapshot = snapshot;
          failure = error;
          break;
        }
      }
      writer = null;
      resolveWaiters(failure);
      if (failure) throw failure;
      return finalSnapshot || lastSnapshot();
    })();
    return writer;
  }

  function enqueueSnapshot(snapshot) {
    pendingSnapshot = clone(snapshot);
    const promise = new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    if (!writer && !writerKickScheduled) {
      writerKickScheduled = true;
      const start = () => {
        writerKickScheduled = false;
        void runWriter().catch(error => {
          try { onError?.(error); } catch {}
        });
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(start);
      else Promise.resolve().then(start);
    }
    return promise;
  }

  function activate(reason = 'signal') {
    if (finalized) return false;
    if (phase !== 'active') phase = 'active';
    if (reason === 'explicit_resume') explicitActivation = true;
    return true;
  }

  function recordActivity(activity = {}) {
    if (finalized) return getState();
    applyActivity(activity);
    const promoted = shouldPromoteReading({
      activeSeconds: sessionActiveSeconds,
      actualScrollProgress: activity.actualScrollProgress,
      didUserScroll: activity.didUserScroll,
      sessionGuideVisitedCount: sessionGuideVisited.size,
      bodyLookupCount,
      explicitResume: activity.explicitResume
    });
    if (phase !== 'active' && promoted) activate(activity.explicitResume ? 'explicit_resume' : 'signal');
    return getState();
  }

  function getState() {
    return {
      phase,
      articleId,
      contentFingerprint: fingerprint,
      sessionBaseActiveSeconds: persistedBase,
      sessionActiveSeconds,
      cumulativeActiveSeconds: persistedBase + sessionActiveSeconds,
      persistedGuideVisited: [...persistedGuideVisited].sort((left, right) => left - right),
      sessionGuideVisited: [...sessionGuideVisited].sort((left, right) => left - right),
      sessionGuideVisitedCount: sessionGuideVisited.size,
      guideVisited: [...guideVisited].sort((left, right) => left - right),
      bodyLookupCount,
      lastError
    };
  }

  function getResume() {
    return normalizedPersisted ? clone(normalizedPersisted) : null;
  }

  function checkpoint(data = {}) {
    if (finalized || phase !== 'active') return Promise.resolve(finalSnapshot || null);
    applyActivity(data);
    return enqueueSnapshot(buildSnapshot());
  }

  function scheduleCheckpoint(data = {}, delayMs = 3000) {
    if (finalized || phase !== 'active') return Promise.resolve(null);
    clearTimeout(checkpointTimer);
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null;
      void checkpoint(data).catch(error => { try { onError?.(error); } catch {} });
    }, Math.max(0, Number(delayMs) || 0));
    return Promise.resolve(null);
  }

  async function flush(data = null) {
    clearTimeout(checkpointTimer);
    checkpointTimer = null;
    if (data && !finalized && phase === 'active') applyActivity(data);
    if (data && !finalized && phase === 'active') enqueueSnapshot(buildSnapshot());
    if (writer) await writer.catch(() => {});
    if (pendingSnapshot) await runWriter().catch(() => {});
    if (lastError) throw lastError;
    return finalSnapshot || null;
  }

  async function complete(data = {}) {
    if (finalized) return finalSnapshot;
    clearTimeout(checkpointTimer);
    checkpointTimer = null;
    applyActivity(data);
    if (phase !== 'active' && shouldPromoteReading({
      activeSeconds: sessionActiveSeconds,
      actualScrollProgress: data.actualScrollProgress,
      didUserScroll: data.didUserScroll,
      sessionGuideVisitedCount: sessionGuideVisited.size,
      bodyLookupCount,
      explicitResume: data.explicitResume
    })) {
      activate(data.explicitResume ? 'explicit_resume' : 'completion');
    }
    if (phase !== 'active') return finalSnapshot || null;
    finalized = true;
    phase = 'completed';
    pendingSnapshot = clone(buildSnapshot());
    const writePromise = runWriter();
    try {
      await writePromise;
      await remove(articleId);
      lastError = null;
      return finalSnapshot;
    } catch (error) {
      lastError = error;
      try { onError?.(error); } catch {}
      throw error;
    }
  }

  return {
    activate,
    recordActivity,
    checkpoint,
    scheduleCheckpoint,
    flush,
    complete,
    getState,
    getResume,
    getCumulativeActiveSeconds: ({ activeSeconds } = {}) => persistedBase + Math.max(sessionActiveSeconds, nonNegative(activeSeconds, 0)),
    getSnapshot: () => buildSnapshot(),
    cancelScheduledCheckpoint: () => { clearTimeout(checkpointTimer); checkpointTimer = null; },
    hasPersistedProgress: Boolean(normalizedPersisted)
  };
}
