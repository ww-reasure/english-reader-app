import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIAGNOSTIC_CONSTANTS,
  createDiagnosticLogger
} from '../src/diagnostic-logger.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function clock(start = 1_700_000_000_000) {
  let value = start;
  return {
    now: () => value,
    advance: ms => { value += ms; }
  };
}

test('diagnostic events are structured and redact secrets and request content', () => {
  const time = clock();
  const logger = createDiagnosticLogger({
    now: time.now,
    storage: memoryStorage(),
    context: { appVersion: '2.0.0', platform: 'web' }
  });

  const event = logger.record('network.request_end', {
    category: 'network',
    level: 'info',
    sessionId: 'session-1',
    correlationId: 'request-1',
    payload: {
      status: 200,
      apiKey: 'sk-this-must-not-leak',
      authorization: 'Bearer secret-token',
      body: '完整请求正文不得记录'
    },
    detail: { word: 'evolutionary', scope: 'scheduled' }
  });

  assert.equal(event.schemaVersion, 1);
  assert.equal(event.event, 'network.request_end');
  assert.equal(event.platform, 'web');
  assert.equal(event.payload.status, 200);
  assert.equal(event.details, undefined, '详细内容默认不应记录');
  assert.doesNotMatch(JSON.stringify(event), /sk-this-must-not-leak|secret-token|完整请求正文/);
});

test('temporary detailed mode records the current word and expires automatically', () => {
  const time = clock();
  const logger = createDiagnosticLogger({
    now: time.now,
    storage: memoryStorage(),
    detailedDurationMs: 1000,
    detailedMaxEntries: 2
  });

  const enabled = logger.enableDetailed();
  assert.equal(enabled, true);
  const first = logger.record('review.rating_clicked', {
    category: 'review',
    detail: { word: 'evolutionary', scope: 'scheduled' }
  });
  assert.deepEqual(first.details, { word: 'evolutionary', scope: 'scheduled' });

  time.advance(1001);
  logger.record('review.rating_clicked', {
    category: 'review',
    detail: { word: 'delayed' }
  });
  assert.equal(logger.getStatus().detailed, false);
  assert.equal(logger.getStatus().detailedUntil, null);

  logger.enableDetailed();
  logger.record('review.card_rendered', { category: 'review', detail: { word: 'one' } });
  logger.record('review.card_rendered', { category: 'review', detail: { word: 'two' } });
  logger.record('review.card_rendered', { category: 'review', detail: { word: 'three' } });
  assert.equal(logger.getStatus().detailed, false, '达到详细事件上限后应自动关闭');
  assert.equal(logger.getStatus().detailedStopReason, 'event_limit');
});

test('detailed mode exposes whether it was manually disabled or timed out', () => {
  const time = clock();
  const logger = createDiagnosticLogger({
    now: time.now,
    storage: memoryStorage(),
    detailedDurationMs: 1000
  });

  logger.enableDetailed();
  logger.disableDetailed();
  assert.equal(logger.getStatus().detailed, false);
  assert.equal(logger.getStatus().detailedStopReason, 'manual');

  logger.enableDetailed();
  time.advance(1001);
  assert.equal(logger.getStatus().detailed, false);
  assert.equal(logger.getStatus().detailedStopReason, 'timeout');
  assert.equal(logger.getStatus().detailedRemainingMs, 0);
});

test('ordinary events roll off after the retention window', () => {
  const time = clock();
  const logger = createDiagnosticLogger({ now: time.now, storage: memoryStorage() });

  logger.record('app.start', { category: 'app' });
  time.advance(DIAGNOSTIC_CONSTANTS.RETENTION_MS + 1);
  logger.record('app.resume', { category: 'app' });

  const events = logger.getBufferedEvents();
  assert.equal(events.some(event => event.event === 'app.start'), false);
  assert.equal(events.some(event => event.event === 'app.resume'), true);
});

test('spans record duration and synthesize pending evidence when not ended', async () => {
  const time = clock();
  const logger = createDiagnosticLogger({
    now: time.now,
    storage: memoryStorage(),
    slowOperationMs: 100
  });

  const completed = logger.beginSpan('review.srs_transaction', {
    category: 'db',
    correlationId: 'rating-1'
  });
  time.advance(101);
  completed.end({ payload: { ok: true } });
  const completedEvents = logger.getBufferedEvents();
  assert.equal(completedEvents.some(event => event.event === 'review.srs_transaction.start'), true);
  assert.equal(completedEvents.some(event => event.event === 'review.srs_transaction.end' && event.durationMs === 101), true);
  assert.equal(completedEvents.some(event => event.event === 'review.srs_transaction.slow'), true);

  const previousStep = logger.beginSpan('review.rating_save', {
    category: 'review',
    correlationId: 'rating-2'
  });
  time.advance(10);
  previousStep.end({ payload: { ok: true } });
  const pending = logger.beginSpan('review.db_open', { category: 'db', correlationId: 'rating-2' });
  time.advance(200);
  const exported = await logger.collect();
  const pendingEvent = exported.events.find(event => event.event === 'review.db_open.pending');
  assert.equal(Boolean(pendingEvent), true);
  assert.equal(pendingEvent.payload.lastCompletedStep, 'review.rating_save.end');
  assert.equal(pending.end({ payload: { ok: true } }).event, 'review.db_open.end');
});

test('critical events are mirrored to the emergency ring and persistence failures are non-fatal', async () => {
  const storage = memoryStorage();
  const time = clock();
  const logger = createDiagnosticLogger({ now: time.now, storage });
  logger.setPersistence({
    append: async () => { throw new Error('IndexedDB unavailable'); },
    list: async () => [],
    clear: async () => {}
  });

  logger.record('db.open.pending', {
    category: 'db',
    level: 'warn',
    payload: { operation: 'open' }
  });
  await assert.doesNotReject(() => logger.flush());

  const panic = JSON.parse(storage.getItem(DIAGNOSTIC_CONSTANTS.PANIC_STORAGE_KEY));
  assert.equal(panic.length, 1);
  assert.equal(panic[0].event, 'db.open.pending');

  const restored = createDiagnosticLogger({ now: time.now, storage });
  assert.equal(restored.getBufferedEvents().some(event => event.event === 'db.open.pending'), true);
});

test('collect remains exportable when primary persistence is stuck', async () => {
  const time = clock();
  const logger = createDiagnosticLogger({ now: time.now, storage: memoryStorage() });
  logger.setPersistence({
    append: () => new Promise(() => {}),
    list: async () => [],
    clear: async () => {}
  });
  logger.record('review.rating_save_start', {
    category: 'review',
    level: 'error',
    correlationId: 'rating-stuck'
  });

  const result = await Promise.race([
    logger.collect(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('collect blocked by persistence')), 150))
  ]);
  assert.equal(result.events.some(event => event.event === 'review.rating_save_start'), true);
});

test('detailed records are capped without affecting ordinary event capture', () => {
  const logger = createDiagnosticLogger({
    storage: memoryStorage(),
    detailedMaxEntries: 1
  });
  logger.enableDetailed();
  logger.record('review.card_rendered', { category: 'review', detail: { word: 'one' } });
  logger.record('review.card_rendered', { category: 'review', detail: { word: 'two' } });
  const events = logger.getBufferedEvents();
  assert.equal(events.filter(event => event.details?.word).length, 1);
  assert.equal(events.filter(event => event.event === 'review.card_rendered').length, 2);
});

test('collect includes a snapshot of the detailed logging state', async () => {
  const logger = createDiagnosticLogger({ storage: memoryStorage(), detailedMaxEntries: 10 });
  logger.enableDetailed();
  const result = await logger.collect();
  assert.equal(result.diagnosticStatus.detailed, true);
  assert.equal(result.diagnosticStatus.detailedMaxEntries, 10);
  assert.equal(typeof result.diagnosticStatus.detailedRemainingMs, 'number');
});
