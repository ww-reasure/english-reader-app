import { DIAGNOSTIC_LOG_SCHEMA_VERSION, sanitizeDiagnosticEvent } from './diagnostic-logger.mjs';

const pad2 = value => String(value).padStart(2, '0');

export function formatDiagnosticFileName(value = Date.now()) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return 'english-reader-diagnostics-unknown.json';
  return `english-reader-diagnostics-${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}.json`;
}

function asEvents(value) {
  return Array.isArray(value) ? value.filter(event => event && typeof event === 'object') : [];
}

function buildSummary(events) {
  const errors = events.filter(event => event.level === 'error');
  const slow = events.filter(event => String(event.event || '').endsWith('.slow'));
  const pending = events.filter(event => String(event.event || '').endsWith('.pending'));
  const byCategory = {};
  for (const event of events) {
    const category = String(event.category || 'unknown');
    byCategory[category] = (byCategory[category] || 0) + 1;
  }
  const slowest = events
    .filter(event => Number.isFinite(Number(event.durationMs)))
    .sort((left, right) => Number(right.durationMs) - Number(left.durationMs))
    .slice(0, 10)
    .map(event => sanitizeDiagnosticEvent({
      event: event.event,
      category: event.category,
      durationMs: Number(event.durationMs),
      occurredAt: event.occurredAt,
      correlationId: event.correlationId
    }));
  return {
    total: events.length,
    errors: errors.length,
    slow: slow.length,
    pending: pending.length,
    byCategory,
    slowest
  };
}

export function buildDiagnosticBundle({ events = [], app = {}, now = Date.now(), diagnosticStatus = null } = {}) {
  const safeEvents = asEvents(events)
    .map(sanitizeDiagnosticEvent)
    .sort((left, right) => Number(left.occurredAt) - Number(right.occurredAt)
      || String(left.id || '').localeCompare(String(right.id || '')));
  const timestamps = safeEvents
    .map(event => Number(event.occurredAt))
    .filter(Number.isFinite);
  const safeApp = sanitizeDiagnosticEvent({
    version: app.version ?? app.appVersion,
    platform: app.platform,
    dbVersion: app.dbVersion
  });
  const pendingOperations = safeEvents.filter(event => String(event.event || '').endsWith('.pending'));

  const safeDiagnosticStatus = diagnosticStatus && typeof diagnosticStatus === 'object'
    ? sanitizeDiagnosticEvent(diagnosticStatus)
    : {};

  return {
    schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
    exportedAt: Number(now),
    app: safeApp,
    timeRange: {
      from: timestamps.length ? Math.min(...timestamps) : null,
      to: timestamps.length ? Math.max(...timestamps) : null
    },
    diagnosticStatus: safeDiagnosticStatus,
    summary: buildSummary(safeEvents),
    pendingOperations,
    events: safeEvents
  };
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function triggerWebDownload(contents, fileName) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

async function detectNative(platform) {
  if (platform === 'native') return true;
  if (platform === 'web') return false;
  if (platform && platform !== 'auto') return true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Boolean(Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/**
 * Collect, sanitize and save/share local diagnostic events. The adapters are
 * injectable so web downloads and native share failures are testable without
 * a browser or Android runtime.
 */
export async function exportDiagnosticLogs({
  logger = null,
  events = null,
  app = {},
  platform = 'auto',
  now = Date.now(),
  fsImpl = null,
  shareImpl = null,
  directory = null,
  downloadImpl = null
} = {}) {
  try {
    const collected = events
      ? { events: asEvents(events) }
      : (logger ? await logger.collect() : { events: [] });
    const bundle = buildDiagnosticBundle({
      events: collected.events,
      app,
      now,
      diagnosticStatus: collected.diagnosticStatus || logger?.getStatus?.() || null
    });
    const contents = JSON.stringify(bundle, null, 2);
    const fileName = formatDiagnosticFileName(now);
    const isNative = await detectNative(platform);

    if (isNative) {
      let Filesystem = fsImpl;
      let Directory = directory;
      if (!Filesystem || !Directory) {
        const filesystemModule = await import('@capacitor/filesystem');
        Filesystem ||= filesystemModule.Filesystem;
        Directory ||= filesystemModule.Directory.Cache;
      }
      const written = await Filesystem.writeFile({
        path: fileName,
        data: utf8ToBase64(contents),
        directory: Directory || 'CACHE'
      });
      let shared = false;
      try {
        let Share = shareImpl;
        if (!Share) Share = (await import('@capacitor/share')).Share;
        await Share.share({
          title: 'English Reader 诊断日志',
          files: [written.uri],
          dialogTitle: '导出诊断日志'
        });
        shared = true;
      } catch (shareError) {
        const fallback = typeof downloadImpl === 'function'
          ? downloadImpl
          : (contentsValue, name) => triggerWebDownload(contentsValue, name);
        const downloaded = fallback(contents, fileName, 'application/json');
        return {
          ok: true,
          platform: 'native',
          shared: false,
          downloaded: downloaded !== false,
          path: written.uri,
          fileName,
          warning: String(shareError?.message || shareError || '系统分享不可用')
        };
      }
      return { ok: true, platform: 'native', shared, path: written.uri, fileName };
    }

    const downloaded = typeof downloadImpl === 'function'
      ? downloadImpl(contents, fileName, 'application/json')
      : triggerWebDownload(contents, fileName);
    return { ok: true, platform: 'web', downloaded: downloaded !== false, fileName, contents };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || '导出失败') };
  }
}
