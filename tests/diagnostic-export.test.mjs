import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDiagnosticBundle,
  exportDiagnosticLogs,
  formatDiagnosticFileName
} from '../src/diagnostic-export.mjs';

test('diagnostic bundle summarizes pending and slow events and redacts again', () => {
  const bundle = buildDiagnosticBundle({
    now: 1_700_000_000_000,
    app: {
      version: '2.0.0',
      platform: 'android',
      dbVersion: 20,
      apiKey: 'sk-do-not-export'
    },
    diagnosticStatus: {
      detailed: false,
      detailedStopReason: 'event_limit',
      detailedCount: 2000,
      detailedRemainingMs: 0,
      apiKey: 'sk-status-secret'
    },
    events: [
      { id: 'a', occurredAt: 1_699_999_900_000, category: 'review', event: 'review.rating_clicked', level: 'info' },
      { id: 'b', occurredAt: 1_699_999_901_500, category: 'db', event: 'db.open.slow', level: 'warn', durationMs: 1500 },
      { id: 'c', occurredAt: 1_699_999_902_000, category: 'network', event: 'network.request_end', level: 'error', payload: {
        authorization: 'Bearer top-secret',
        body: 'do not export this request',
        status: 500
      } },
      { id: 'd', occurredAt: 1_699_999_903_000, category: 'review', event: 'review.srs_transaction.pending', level: 'error', payload: { pending: true } }
    ]
  });

  assert.equal(bundle.schemaVersion, 1);
  assert.deepEqual(bundle.app, { version: '2.0.0', platform: 'android', dbVersion: 20 });
  assert.equal(bundle.summary.total, 4);
  assert.equal(bundle.summary.errors, 2);
  assert.equal(bundle.summary.slow, 1);
  assert.equal(bundle.summary.pending, 1);
  assert.equal(bundle.pendingOperations.length, 1);
  assert.equal(bundle.diagnosticStatus.detailedStopReason, 'event_limit');
  assert.equal(bundle.diagnosticStatus.detailedCount, 2000);
  assert.doesNotMatch(JSON.stringify(bundle), /sk-do-not-export|top-secret|do not export this request/);
  assert.doesNotMatch(JSON.stringify(bundle), /sk-status-secret/);
  assert.equal(bundle.events.find(event => event.id === 'c').payload.status, 500);
});

test('diagnostic file names use local date and minute', () => {
  assert.equal(formatDiagnosticFileName(new Date(2026, 7, 26, 9, 5).getTime()), 'english-reader-diagnostics-2026-08-26-0905.json');
});

test('web export uses the injected download adapter and returns the file', async () => {
  let downloaded = null;
  const result = await exportDiagnosticLogs({
    platform: 'web',
    now: 1_700_000_000_000,
    events: [{ id: 'web-1', occurredAt: 1_700_000_000_000, event: 'app.start' }],
    downloadImpl: (contents, fileName, mimeType) => {
      downloaded = { contents, fileName, mimeType };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'web');
  assert.equal(downloaded.mimeType, 'application/json');
  assert.equal(downloaded.fileName, formatDiagnosticFileName(1_700_000_000_000));
  assert.equal(JSON.parse(downloaded.contents).events[0].id, 'web-1');
});

test('native export writes to cache and shares; share failure falls back to download', async () => {
  const writes = [];
  const shares = [];
  let fallback = null;
  const result = await exportDiagnosticLogs({
    platform: 'native',
    now: 1_700_000_000_000,
    events: [{ id: 'native-1', occurredAt: 1_700_000_000_000, event: 'app.start' }],
    fsImpl: {
      async writeFile(input) {
        writes.push(input);
        return { uri: 'file:///cache/diagnostics.json' };
      }
    },
    shareImpl: {
      async share(input) {
        shares.push(input);
        throw new Error('share unavailable');
      }
    },
    directory: 'CACHE',
    downloadImpl: (contents, fileName) => {
      fallback = { contents, fileName };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'native');
  assert.equal(result.shared, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].directory, 'CACHE');
  assert.equal(shares.length, 1);
  assert.equal(fallback.fileName, result.fileName);
  assert.equal(JSON.parse(fallback.contents).events[0].id, 'native-1');
});
