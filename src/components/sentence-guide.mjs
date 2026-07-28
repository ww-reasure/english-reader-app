export const SENTENCE_GUIDE_CACHE_VERSION = 1;
export const SENTENCE_GUIDE_CACHE_PREFIX = `sentence_guide_v${SENTENCE_GUIDE_CACHE_VERSION}_`;
const MAX_SENTENCE_GUIDE_CACHE_ENTRIES = 100;

const hasChinese = value => /[\u3400-\u9fff]/.test(String(value || ''));
const normalizeWhitespace = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalizedTrack = value => String(value || 'general').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'general';

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function wordAppearsInSentence(word, sentence) {
  const normalizedWord = normalizeWhitespace(word).toLowerCase();
  if (!/^[a-z][a-z'-]*$/i.test(normalizedWord)) return false;
  return new RegExp(`\\b${normalizedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence);
}

function parseCache(storage, key) {
  try {
    const cached = JSON.parse(storage?.getItem?.(key) || 'null');
    if (cached?.schemaVersion !== SENTENCE_GUIDE_CACHE_VERSION) return null;
    return cached?.data || null;
  } catch {
    return null;
  }
}

function trimCache(storage) {
  if (!storage?.key || !Number.isFinite(storage.length)) return;
  const cached = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(SENTENCE_GUIDE_CACHE_PREFIX)) continue;
    try {
      const savedAt = Number(JSON.parse(storage.getItem(key) || '{}')?.savedAt) || 0;
      cached.push({ key, savedAt });
    } catch {
      cached.push({ key, savedAt: 0 });
    }
  }
  cached.sort((left, right) => left.savedAt - right.savedAt);
  cached.slice(0, Math.max(0, cached.length - MAX_SENTENCE_GUIDE_CACHE_ENTRIES)).forEach(({ key }) => storage.removeItem(key));
}

export function makeSentenceGuideCacheKey(sentence, targetTrack) {
  const normalizedSentence = normalizeWhitespace(sentence).toLowerCase();
  return `${SENTENCE_GUIDE_CACHE_PREFIX}${normalizedTrack(targetTrack)}_${stableHash(normalizedSentence)}`;
}

export function normalizeSentenceGuidePayload(sentence, payload) {
  const normalizedSentence = normalizeWhitespace(sentence);
  const translationZh = normalizeWhitespace(payload?.translationZh);
  if (!normalizedSentence || !translationZh || !hasChinese(translationZh)) return null;

  const chunks = Array.isArray(payload?.chunks) ? payload.chunks.slice(0, 6).map(item => ({
    source: normalizeWhitespace(item?.source),
    glossZh: normalizeWhitespace(item?.glossZh)
  })).filter(item => item.source && item.glossZh && hasChinese(item.glossZh) && normalizedSentence.toLowerCase().includes(item.source.toLowerCase())) : [];
  if (!chunks.length) return null;

  const grammar = Array.isArray(payload?.grammar) ? payload.grammar.slice(0, 3)
    .map(normalizeWhitespace).filter(item => item && hasChinese(item)) : [];
  const keywords = Array.isArray(payload?.keywords) ? payload.keywords.slice(0, 3).map(item => ({
    word: normalizeWhitespace(item?.word),
    glossZh: normalizeWhitespace(item?.glossZh)
  })).filter(item => wordAppearsInSentence(item.word, normalizedSentence) && item.glossZh && hasChinese(item.glossZh)) : [];

  return { translationZh, chunks, grammar, keywords };
}

export function createSentenceGuide({ storage = globalThis.localStorage, request, now = () => Date.now() } = {}) {
  if (typeof request !== 'function') throw new TypeError('SentenceGuide requires a request function');
  const inFlight = new Map();

  const get = ({ sentence, paragraph = '', article = null, targetTrack = '', signal = null } = {}) => {
    const normalizedSentence = normalizeWhitespace(sentence);
    const key = makeSentenceGuideCacheKey(normalizedSentence, targetTrack);
    const cached = parseCache(storage, key);
    if (cached) return Promise.resolve(cached);
    if (inFlight.has(key)) return inFlight.get(key).promise;

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });

    let requested;
    try {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Start immediately so concurrent callers share a real request, not a
      // deferred microtask that can be cancelled before the request observes it.
      requested = request({ sentence: normalizedSentence, paragraph, article, targetTrack: normalizedTrack(targetTrack) }, { signal: controller.signal });
    } catch (error) {
      requested = Promise.reject(error);
    }

    const promise = Promise.resolve(requested)
      .then(payload => {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const guide = normalizeSentenceGuidePayload(normalizedSentence, payload);
        if (!guide) throw new Error('没有返回可用导读');
        storage?.setItem?.(key, JSON.stringify({ schemaVersion: SENTENCE_GUIDE_CACHE_VERSION, savedAt: now(), data: guide }));
        trimCache(storage);
        return guide;
      })
      .finally(() => {
        signal?.removeEventListener?.('abort', abort);
        inFlight.delete(key);
      });

    inFlight.set(key, { promise, controller });
    return promise;
  };

  return {
    get,
    cancel(sentence, targetTrack) {
      const key = makeSentenceGuideCacheKey(sentence, targetTrack);
      inFlight.get(key)?.controller.abort();
    },
    clearPending() {
      inFlight.forEach(({ controller }) => controller.abort());
      inFlight.clear();
    }
  };
}
