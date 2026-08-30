const DAY_MS = 24 * 60 * 60 * 1000;
const PERSISTENCE_OPERATION_TIMEOUT_MS = 100;

export const DIAGNOSTIC_LOG_SCHEMA_VERSION = 1;

export const DIAGNOSTIC_CONSTANTS = Object.freeze({
  RETENTION_MS: 7 * DAY_MS,
  ORDINARY_MAX_ENTRIES: 5_000,
  ORDINARY_MAX_BYTES: 2 * 1024 * 1024,
  DETAILED_DURATION_MS: 30 * 60 * 1000,
  DETAILED_MAX_ENTRIES: 2_000,
  PANIC_MAX_ENTRIES: 100,
  PANIC_STORAGE_KEY: 'english-reader:diagnostic-panic',
  DETAIL_STORAGE_KEY: 'english-reader:diagnostic-detail',
  DETAIL_REASON_STORAGE_KEY: 'english-reader:diagnostic-detail-reason',
  SLOW_OPERATION_MS: 1_500,
  PENDING_OPERATION_MS: 10_000
});

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|secret|private[_-]?key|request|response|body|prompt|messages?|conversation|article|translation|transcript|user[_-]?input|input[_-]?text|full[_-]?text|raw[_-]?text|content)/i;
const SENSITIVE_STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|tvly|xai|AIza)[-_][A-Za-z0-9._~-]{8,}/gi,
  /([?&](?:api[_-]?key|token|authorization|secret|password)=)[^&\s]+/gi
];
const MAX_STRING_LENGTH = 512;

function getDefaultStorage() {
  try {
    const candidate = globalThis?.localStorage;
    if (!candidate || typeof candidate.getItem !== 'function') return null;
    return candidate;
  } catch {
    return null;
  }
}

function safeStorage(storage) {
  return {
    getItem(key) {
      try {
        return storage?.getItem?.(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        storage?.setItem?.(key, value);
      } catch {
        // Diagnostics must never become a source of application failures.
      }
    },
    removeItem(key) {
      try {
        storage?.removeItem?.(key);
      } catch {
        // Diagnostics must never become a source of application failures.
      }
    }
  };
}

function redactString(value) {
  let result = String(value);
  for (const pattern of SENSITIVE_STRING_PATTERNS) {
    result = result.replace(pattern, match => {
      if (match.includes('=')) {
        const separator = match.slice(0, match.indexOf('=') + 1);
        return `${separator}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }
  if (result.length > MAX_STRING_LENGTH) {
    return `${result.slice(0, MAX_STRING_LENGTH)}…`;
  }
  return result;
}

function sanitizeValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(key)) return undefined;
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) {
    return {
      name: redactString(value.name || 'Error'),
      message: redactString(value.message || '')
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map(item => sanitizeValue(item, '', depth + 1))
      .filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeValue(childValue, childKey, depth + 1);
      if (sanitized !== undefined) result[childKey] = sanitized;
    }
    return result;
  }
  return redactString(value);
}

export function sanitizeDiagnosticEvent(event = {}) {
  const sanitized = sanitizeValue(event);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

async function settlePersistenceOperation(operation, timeoutMs = PERSISTENCE_OPERATION_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = globalThis.setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    timer?.unref?.();
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(operation),
      timeout
    ]);
    return value;
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

function defaultPlatform() {
  try {
    if (globalThis?.Capacitor?.getPlatform) return globalThis.Capacitor.getPlatform();
  } catch {
    // Fall through to a neutral value.
  }
  return typeof navigator !== 'undefined' ? 'web' : 'unknown';
}

function currentRoute() {
  try {
    const hash = globalThis?.location?.hash;
    if (!hash) return undefined;
    return String(hash).split('?')[0].slice(0, 200);
  } catch {
    return undefined;
  }
}

function makeId(now, sequence) {
  let random = '';
  try {
    random = globalThis?.crypto?.randomUUID?.() || '';
  } catch {
    random = '';
  }
  return `${now}-${sequence}${random ? `-${random}` : ''}`;
}

function eventIsCritical(event) {
  return event.level === 'error' || /\.(?:slow|pending)$/.test(event.event);
}

function eventSize(event) {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 0;
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

export function createDiagnosticLogger(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const monotonicNow = typeof options.monotonicNow === 'function' ? options.monotonicNow : now;
  const storage = safeStorage(options.storage ?? getDefaultStorage());
  let context = options.context && typeof options.context === 'object' ? { ...options.context } : {};
  const retentionMs = options.retentionMs ?? DIAGNOSTIC_CONSTANTS.RETENTION_MS;
  const ordinaryMaxEntries = options.ordinaryMaxEntries ?? DIAGNOSTIC_CONSTANTS.ORDINARY_MAX_ENTRIES;
  const ordinaryMaxBytes = options.ordinaryMaxBytes ?? DIAGNOSTIC_CONSTANTS.ORDINARY_MAX_BYTES;
  const detailedDurationMs = options.detailedDurationMs ?? DIAGNOSTIC_CONSTANTS.DETAILED_DURATION_MS;
  const detailedMaxEntries = options.detailedMaxEntries ?? DIAGNOSTIC_CONSTANTS.DETAILED_MAX_ENTRIES;
  const slowOperationMs = options.slowOperationMs ?? DIAGNOSTIC_CONSTANTS.SLOW_OPERATION_MS;
  const pendingOperationMs = options.pendingOperationMs ?? DIAGNOSTIC_CONSTANTS.PENDING_OPERATION_MS;
  const panicMaxEntries = options.panicMaxEntries ?? DIAGNOSTIC_CONSTANTS.PANIC_MAX_ENTRIES;
  const schedulePersistence = typeof options.schedulePersistence === 'function'
    ? options.schedulePersistence
    : callback => {
      if (typeof globalThis?.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(callback, { timeout: 1000 });
        return;
      }
      const frame = globalThis?.requestAnimationFrame;
      if (typeof frame === 'function') {
        frame(() => frame(callback));
        return;
      }
      const timer = globalThis?.setTimeout?.(callback, 16);
      timer?.unref?.();
    };

  let sequence = 0;
  let events = [];
  let panicEvents = [];
  let persistence = null;
  let persistenceQueue = [];
  let flushPromise = null;
  let flushScheduled = false;
  let detailState = { until: null, count: 0 };
  let detailStopReason = null;
  let lastError = null;
  const openSpans = new Map();
  const lastCompletedByCorrelation = new Map();

  const persistedDetail = storage.getItem(DIAGNOSTIC_CONSTANTS.DETAIL_STORAGE_KEY);
  let detailExpiredOnRestore = false;
  if (persistedDetail) {
    try {
      const parsed = JSON.parse(persistedDetail);
      if (Number.isFinite(parsed?.until) && parsed.until > now()) {
        detailState = {
          until: parsed.until,
          count: Number.isFinite(parsed.count) ? parsed.count : 0
        };
      } else {
        storage.removeItem(DIAGNOSTIC_CONSTANTS.DETAIL_STORAGE_KEY);
        detailState = { until: null, count: Number.isFinite(parsed?.count) ? parsed.count : 0 };
        detailStopReason = 'timeout';
        detailExpiredOnRestore = true;
      }
    } catch {
      storage.removeItem(DIAGNOSTIC_CONSTANTS.DETAIL_STORAGE_KEY);
      detailStopReason = 'timeout';
      detailExpiredOnRestore = true;
    }
  }

  const persistedDetailReason = storage.getItem(DIAGNOSTIC_CONSTANTS.DETAIL_REASON_STORAGE_KEY);
  if (!detailExpiredOnRestore && ['manual', 'timeout', 'event_limit'].includes(persistedDetailReason)) {
    detailStopReason = persistedDetailReason;
  }

  const persistedPanic = storage.getItem(DIAGNOSTIC_CONSTANTS.PANIC_STORAGE_KEY);
  if (persistedPanic) {
    try {
      panicEvents = normalizeList(JSON.parse(persistedPanic)).slice(-panicMaxEntries);
      events.push(...panicEvents);
    } catch {
      storage.removeItem(DIAGNOSTIC_CONSTANTS.PANIC_STORAGE_KEY);
    }
  }

  function saveDetailState() {
    if (detailState.until && detailState.until > now()) {
      storage.setItem(DIAGNOSTIC_CONSTANTS.DETAIL_STORAGE_KEY, JSON.stringify(detailState));
    } else {
      storage.removeItem(DIAGNOSTIC_CONSTANTS.DETAIL_STORAGE_KEY);
    }
  }

  function saveDetailStopReason() {
    if (detailStopReason) {
      storage.setItem(DIAGNOSTIC_CONSTANTS.DETAIL_REASON_STORAGE_KEY, detailStopReason);
    } else {
      storage.removeItem(DIAGNOSTIC_CONSTANTS.DETAIL_REASON_STORAGE_KEY);
    }
  }

  function expireDetailedIfNeeded() {
    if (detailState.until && now() >= detailState.until) {
      detailState = { until: null, count: detailState.count };
      detailStopReason = 'timeout';
      saveDetailState();
      saveDetailStopReason();
      return true;
    }
    return false;
  }

  function isDetailedEnabled() {
    expireDetailedIfNeeded();
    return Boolean(detailState.until && detailState.until > now());
  }

  function pruneEvents() {
    const cutoff = now() - retentionMs;
    events = events.filter(event => Number(event.occurredAt) >= cutoff);
    panicEvents = panicEvents.filter(event => Number(event.occurredAt) >= cutoff);

    if (events.length > ordinaryMaxEntries) {
      events = events.slice(-ordinaryMaxEntries);
    }
    while (events.length > 1 && events.reduce((total, event) => total + eventSize(event), 0) > ordinaryMaxBytes) {
      events.shift();
    }
  }

  function writePanic(event) {
    panicEvents = [...panicEvents.filter(item => item.id !== event.id), event].slice(-panicMaxEntries);
    storage.setItem(DIAGNOSTIC_CONSTANTS.PANIC_STORAGE_KEY, JSON.stringify(panicEvents));
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    schedulePersistence(() => {
      flushScheduled = false;
      void flush();
    });
  }

  function record(eventName, recordOptions = {}) {
    const occurredAt = Number(now());
    const event = String(eventName || 'diagnostic.unknown');
    const detailEnabled = isDetailedEnabled();
    const normalized = {
      id: makeId(occurredAt, ++sequence),
      schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
      occurredAt,
      monotonicMs: finiteNumber(Number(monotonicNow())),
      level: recordOptions.level || 'info',
      category: recordOptions.category || 'app',
      event,
      route: recordOptions.route === undefined ? currentRoute() : redactString(recordOptions.route),
      sessionId: recordOptions.sessionId === undefined ? undefined : redactString(recordOptions.sessionId),
      correlationId: recordOptions.correlationId === undefined ? undefined : redactString(recordOptions.correlationId),
      durationMs: finiteNumber(recordOptions.durationMs),
      appVersion: context.appVersion === undefined ? undefined : redactString(context.appVersion),
      platform: context.platform === undefined ? defaultPlatform() : redactString(context.platform),
      buildId: context.buildId === undefined ? undefined : redactString(context.buildId),
      payload: sanitizeValue(recordOptions.payload ?? {}, 'payload')
    };

    if (detailEnabled && detailState.count < detailedMaxEntries && recordOptions.detail !== undefined) {
      normalized.details = sanitizeValue(recordOptions.detail, 'details');
    }
    if (detailEnabled) {
      detailState.count += 1;
      if (detailState.count >= detailedMaxEntries) {
        detailState.until = null;
        detailStopReason = 'event_limit';
      }
      saveDetailState();
      if (detailStopReason === 'event_limit') saveDetailStopReason();
    }

    for (const key of Object.keys(normalized)) {
      if (normalized[key] === undefined) delete normalized[key];
    }
    events.push(normalized);
    if (normalized.correlationId
      && !/(?:\.start|_start|\.slow|\.pending)$/.test(normalized.event)) {
      lastCompletedByCorrelation.set(normalized.correlationId, normalized.event);
      if (lastCompletedByCorrelation.size > 1_000) {
        lastCompletedByCorrelation.delete(lastCompletedByCorrelation.keys().next().value);
      }
    }
    if (eventIsCritical(normalized)) writePanic(normalized);
    persistenceQueue.push(normalized);
    pruneEvents();
    scheduleFlush();
    return normalized;
  }

  function beginSpan(name, spanOptions = {}) {
    const spanId = makeId(Number(now()), ++sequence);
    const startedAt = Number(monotonicNow());
    const correlationId = spanOptions.correlationId;
    const startEvent = record(`${name}.start`, spanOptions);
    let slowTimer = null;
    let pendingTimer = null;
    const span = {
      id: spanId,
      name: String(name),
      startedAt,
      correlationId,
      slowEmitted: false,
      pendingEmitted: false,
      ended: false,
      endEvent: null,
      slowTimer,
      pendingTimer
    };

    const emitThreshold = (threshold, suffix, level) => {
      if (span.ended || (suffix === 'slow' && span.slowEmitted) || (suffix === 'pending' && span.pendingEmitted)) return;
      const durationMs = Math.max(0, Number(monotonicNow()) - startedAt);
      record(`${name}.${suffix}`, {
        ...spanOptions,
        level,
        correlationId,
        durationMs,
        payload: {
          ...(spanOptions.payload || {}),
          durationMs,
          thresholdMs: threshold
        }
      });
      if (suffix === 'slow') span.slowEmitted = true;
      if (suffix === 'pending') span.pendingEmitted = true;
    };

    if (typeof globalThis?.setTimeout === 'function') {
      slowTimer = globalThis.setTimeout(() => emitThreshold(slowOperationMs, 'slow', 'warn'), slowOperationMs);
      pendingTimer = globalThis.setTimeout(() => emitThreshold(pendingOperationMs, 'pending', 'error'), pendingOperationMs);
      slowTimer?.unref?.();
      pendingTimer?.unref?.();
      span.slowTimer = slowTimer;
      span.pendingTimer = pendingTimer;
    }
    openSpans.set(spanId, span);

    return {
      id: spanId,
      startEvent,
      correlationId,
      isEnded: () => span.ended,
      end(result = {}) {
        if (span.ended) return span.endEvent;
        if (span.slowTimer !== null) globalThis?.clearTimeout?.(span.slowTimer);
        if (span.pendingTimer !== null) globalThis?.clearTimeout?.(span.pendingTimer);
        const durationMs = Math.max(0, Number(monotonicNow()) - startedAt);
        if (durationMs >= slowOperationMs && !span.slowEmitted) {
          emitThreshold(slowOperationMs, 'slow', 'warn');
        }
        if (durationMs >= pendingOperationMs && !span.pendingEmitted) {
          emitThreshold(pendingOperationMs, 'pending', 'error');
        }
        span.ended = true;
        openSpans.delete(spanId);
        span.endEvent = record(`${name}.end`, {
          ...spanOptions,
          ...result,
          correlationId,
          durationMs,
          payload: {
            ...(spanOptions.payload || {}),
            ...(result.payload || {})
          }
        });
        return span.endEvent;
      }
    };
  }

  function getBufferedEvents() {
    pruneEvents();
    const byId = new Map();
    for (const event of [...panicEvents, ...events]) {
      if (event?.id) byId.set(event.id, event);
    }
    return [...byId.values()].sort((a, b) => Number(a.occurredAt) - Number(b.occurredAt));
  }

  function collectPendingEvents() {
    return [...openSpans.values()].map(span => {
      if (span.pendingEmitted) return null;
      const durationMs = Math.max(0, Number(monotonicNow()) - span.startedAt);
      return {
        id: `${span.id}:pending`,
        schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
        occurredAt: Number(now()),
        monotonicMs: finiteNumber(Number(monotonicNow())),
        level: 'error',
        category: 'diagnostic',
        event: `${span.name}.pending`,
        correlationId: span.correlationId,
        durationMs,
        payload: {
          pending: true,
          durationMs,
          lastCompletedStep: `${span.name}.start`
        }
      };
    }).filter(Boolean).map(event => {
      const correlationId = event.correlationId;
      if (correlationId && lastCompletedByCorrelation.has(correlationId)) {
        event.payload.lastCompletedStep = lastCompletedByCorrelation.get(correlationId);
      }
      return event;
    });
  }

  async function flush() {
    if (!persistence?.append || persistenceQueue.length === 0) return { ok: true, count: 0 };
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      const batch = persistenceQueue.splice(0);
      try {
        await persistence.append(batch);
        return { ok: true, count: batch.length };
      } catch (error) {
        persistenceQueue.unshift(...batch);
        lastError = sanitizeValue(error);
        return { ok: false, count: 0, error: lastError };
      } finally {
        flushPromise = null;
      }
    })();
    return flushPromise;
  }

  async function collect(range = {}) {
    const flushResult = await settlePersistenceOperation(() => flush());
    if (flushResult?.timedOut) {
      lastError = { name: 'TimeoutError', message: 'Diagnostic log persistence timed out' };
    }
    let persisted = [];
    if (typeof persistence?.list === 'function') {
      try {
        const listResult = await settlePersistenceOperation(() => persistence.list(range));
        if (!listResult?.timedOut) persisted = normalizeList(listResult);
        else lastError = { name: 'TimeoutError', message: 'Diagnostic log listing timed out' };
      } catch (error) {
        lastError = sanitizeValue(error);
      }
    }
    const cutoff = now() - retentionMs;
    const from = Number.isFinite(range.from) ? range.from : cutoff;
    const to = Number.isFinite(range.to) ? range.to : now();
    const byId = new Map();
    for (const event of [...persisted, ...getBufferedEvents(), ...collectPendingEvents()]) {
      if (!event?.id) continue;
      const occurredAt = Number(event.occurredAt);
      if (occurredAt < from || occurredAt > to) continue;
      byId.set(event.id, event);
    }
    const collected = [...byId.values()].sort((a, b) => {
      const timeDifference = Number(a.occurredAt) - Number(b.occurredAt);
      return timeDifference || String(a.id).localeCompare(String(b.id));
    });
    const pending = collected.filter(event => event.event.endsWith('.pending'));
    const errors = collected.filter(event => event.level === 'error');
    const slow = collected.filter(event => event.event.endsWith('.slow'));
    return {
      schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
      exportedAt: Number(now()),
      events: collected,
      pending,
      summary: {
        total: collected.length,
        errors: errors.length,
        slow: slow.length,
        pending: pending.length,
        from: collected[0]?.occurredAt ?? null,
        to: collected[collected.length - 1]?.occurredAt ?? null
      },
      diagnosticStatus: getStatus()
    };
  }

  function getStatus() {
    expireDetailedIfNeeded();
    const detailed = isDetailedEnabled();
    const buffered = getBufferedEvents();
    return {
      detailed,
      detailedUntil: detailState.until || null,
      detailedCount: detailState.count,
      detailedMaxEntries,
      detailedDurationMs,
      detailedRemainingMs: detailed ? Math.max(0, detailState.until - Number(now())) : 0,
      detailedStopReason: detailStopReason,
      eventCount: buffered.length,
      emergencyCount: panicEvents.length,
      pendingCount: openSpans.size,
      queuedCount: persistenceQueue.length,
      persistenceAvailable: Boolean(persistence?.append),
      lastError
    };
  }

  function enableDetailed(durationMs = detailedDurationMs) {
    const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : detailedDurationMs;
    detailState = { until: Number(now()) + safeDuration, count: 0 };
    detailStopReason = null;
    saveDetailState();
    saveDetailStopReason();
    return true;
  }

  function disableDetailed() {
    detailState = { until: null, count: detailState.count };
    detailStopReason = 'manual';
    saveDetailState();
    saveDetailStopReason();
    return true;
  }

  function setPersistence(adapter) {
    persistence = adapter && typeof adapter === 'object' ? adapter : null;
    if (persistence) scheduleFlush();
    return persistence;
  }

  function setContext(nextContext = {}) {
    if (nextContext && typeof nextContext === 'object') {
      context = { ...context, ...nextContext };
    }
    return { ...context };
  }

  async function clear() {
    events = [];
    panicEvents = [];
    lastCompletedByCorrelation.clear();
    persistenceQueue = [];
    lastError = null;
    storage.removeItem(DIAGNOSTIC_CONSTANTS.PANIC_STORAGE_KEY);
    if (typeof persistence?.clear === 'function') {
      try {
        const clearResult = await settlePersistenceOperation(() => persistence.clear());
        if (clearResult?.timedOut) {
          lastError = { name: 'TimeoutError', message: 'Diagnostic log clearing timed out' };
        }
      } catch (error) {
        lastError = sanitizeValue(error);
      }
    }
    return true;
  }

  return {
    record,
    beginSpan,
    flush,
    collect,
    clear,
    setPersistence,
    setContext,
    enableDetailed,
    disableDetailed,
    isDetailedEnabled,
    getStatus,
    getBufferedEvents,
    getEmergencyEvents: () => [...panicEvents]
  };
}

export const DiagnosticLogger = createDiagnosticLogger();
