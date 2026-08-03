export const AI_CACHE_VERSION = 'ai-cache-v1';
export const AI_CACHE_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AI_CACHE_MAX_ENTRIES = 1000;
export const AI_CACHE_MAX_BYTES = 12 * 1024 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function compositeKey(namespace, key, version) {
  return `${text(namespace)}:${text(version || AI_CACHE_VERSION)}:${text(key)}`;
}

function byteSize(value) {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function createAiCache({
  persistence = null,
  now = () => Date.now(),
  defaultTtlMs = AI_CACHE_DEFAULT_TTL_MS,
  maxEntries = AI_CACHE_MAX_ENTRIES,
  maxBytes = AI_CACHE_MAX_BYTES
} = {}) {
  const memory = new Map();
  const inFlight = new Map();

  const touch = (key, record) => {
    memory.delete(key);
    memory.set(key, record);
    while (memory.size > Math.max(1, Number(maxEntries) || AI_CACHE_MAX_ENTRIES)) {
      memory.delete(memory.keys().next().value);
    }
    return record;
  };

  const normalizeRecord = (record, key) => {
    if (!record || record.key !== key || !Object.hasOwn(record, 'value')) return null;
    if (record.cacheVersion !== AI_CACHE_VERSION) return null;
    if (!Number.isFinite(Number(record.expiresAt))) return null;
    return record;
  };

  const get = async (namespace, key, { version = AI_CACHE_VERSION } = {}) => {
    const normalizedNamespace = text(namespace);
    const normalizedKey = text(key);
    if (!normalizedNamespace || !normalizedKey) return null;
    const fullKey = compositeKey(normalizedNamespace, normalizedKey, version);
    let record = normalizeRecord(memory.get(fullKey), fullKey);
    if (!record && persistence?.get) {
      try {
        record = normalizeRecord(await persistence.get(fullKey), fullKey);
      } catch {
        // A cache outage must never make an otherwise usable study detail fail.
        record = null;
      }
    }
    if (!record) return null;
    touch(fullKey, record);
    return {
      value: record.value,
      stale: Number(record.expiresAt) <= Number(now()),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt,
      key: fullKey
    };
  };

  const set = async (namespace, key, value, { version = AI_CACHE_VERSION, ttlMs = defaultTtlMs } = {}) => {
    const normalizedNamespace = text(namespace);
    const normalizedKey = text(key);
    if (!normalizedNamespace || !normalizedKey || value === undefined) return value;
    const fullKey = compositeKey(normalizedNamespace, normalizedKey, version);
    const timestamp = Number(now());
    const record = {
      key: fullKey,
      namespace: normalizedNamespace,
      cacheVersion: AI_CACHE_VERSION,
      value,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + Math.max(1, Number(ttlMs) || defaultTtlMs),
      sizeBytes: byteSize(value)
    };
    touch(fullKey, record);
    if (persistence?.set) {
      try {
        await persistence.set(record, { maxEntries, maxBytes });
      } catch {
        // Keep the memory layer useful even when IndexedDB is unavailable.
      }
    }
    return value;
  };

  const getOrCreate = async (namespace, key, factory, options = {}) => {
    if (typeof factory !== 'function') throw new TypeError('AiCache.getOrCreate requires a factory');
    const version = options.version || AI_CACHE_VERSION;
    const fullKey = compositeKey(namespace, key, version);
    if (!options.force) {
      const cached = await get(namespace, key, { version });
      if (cached && !cached.stale) return cached.value;
    }
    if (inFlight.has(fullKey)) return inFlight.get(fullKey);
    const request = Promise.resolve().then(factory).then(async value => {
      await set(namespace, key, value, options);
      return value;
    }).finally(() => {
      if (inFlight.get(fullKey) === request) inFlight.delete(fullKey);
    });
    inFlight.set(fullKey, request);
    return request;
  };

  const invalidate = async (namespace, key, { version = AI_CACHE_VERSION } = {}) => {
    const fullKey = compositeKey(namespace, key, version);
    memory.delete(fullKey);
    inFlight.delete(fullKey);
    await persistence?.delete?.(fullKey);
  };

  return Object.freeze({ get, set, getOrCreate, invalidate, peek: (namespace, key, options = {}) => {
    const fullKey = compositeKey(namespace, key, options.version || AI_CACHE_VERSION);
    const record = normalizeRecord(memory.get(fullKey), fullKey);
    return record ? { value: record.value, stale: Number(record.expiresAt) <= Number(now()), key: fullKey } : null;
  } });
}

export const AiCache = createAiCache({
  persistence: {
    get: async key => {
      try { return await globalThis.__EnglishReaderDB?.getAiCache?.(key) || null; } catch { return null; }
    },
    set: async (record, limits) => {
      if (globalThis.__EnglishReaderDB?.saveAiCache) return globalThis.__EnglishReaderDB.saveAiCache(record, limits);
      return undefined;
    },
    delete: async key => {
      try { await globalThis.__EnglishReaderDB?.deleteAiCache?.(key); } catch {}
    }
  }
});
