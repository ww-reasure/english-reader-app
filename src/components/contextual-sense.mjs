export const CONTEXTUAL_SENSE_CACHE_VERSION = 1;
export const CONTEXTUAL_SENSE_CACHE_PREFIX = `contextual_sense_v${CONTEXTUAL_SENSE_CACHE_VERSION}_`;

const hasChinese = value => /[\u3400-\u9fff]/u.test(String(value || ''));
const text = value => String(value || '').replace(/\s+/g, ' ').trim();

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedSenses(senses) {
  return (Array.isArray(senses) ? senses : []).map(sense => ({
    pos: text(sense?.pos),
    glossZh: text(sense?.glossZh)
  })).filter(sense => sense.glossZh && hasChinese(sense.glossZh));
}

function isAbort(error) {
  return error?.name === 'AbortError';
}

export function makeContextualSenseCacheKey(word, sentence, senses, lexiconVersion = '') {
  const fingerprint = [
    text(word).toLowerCase(),
    text(sentence).toLowerCase(),
    text(lexiconVersion),
    normalizedSenses(senses).map(sense => `${sense.pos}:${sense.glossZh}`).join('|')
  ].join('\u0000');
  return `${CONTEXTUAL_SENSE_CACHE_PREFIX}${stableHash(fingerprint)}`;
}

export function normalizeContextualSensePayload(payload, senses) {
  const candidates = normalizedSenses(senses);
  const senseIndex = Number(payload?.senseIndex);
  const reasonZh = text(payload?.reasonZh);
  if (!Number.isInteger(senseIndex) || senseIndex < 0 || senseIndex >= candidates.length) return null;
  if (!reasonZh || reasonZh.length > 120 || !hasChinese(reasonZh)) return null;
  return { senseIndex, reasonZh };
}

export function createContextualSense({ storage = globalThis.localStorage, request, now = () => Date.now() } = {}) {
  if (typeof request !== 'function') throw new TypeError('ContextualSense requires a request function');
  const inFlight = new Map();

  async function resolve({ word, sentence, senses, lexiconVersion = '', signal = null } = {}) {
    const candidates = normalizedSenses(senses);
    if (!candidates.length || !text(sentence) || !text(word)) return null;
    if (candidates.length === 1) return { senseIndex: 0, reasonZh: '' };
    const key = makeContextualSenseCacheKey(word, sentence, candidates, lexiconVersion);
    try {
      const cached = JSON.parse(storage?.getItem?.(key) || 'null');
      if (cached?.schemaVersion === CONTEXTUAL_SENSE_CACHE_VERSION) {
        const normalized = normalizeContextualSensePayload(cached.data, candidates);
        if (normalized) return normalized;
      }
    } catch {
      // A malformed cache is simply ignored and can be replaced after a valid result.
    }
    if (inFlight.has(key)) return inFlight.get(key);

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });

    let requested;
    try {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      requested = request({ word: text(word), sentence: text(sentence), senses: candidates, lexiconVersion: text(lexiconVersion) }, { signal: controller.signal });
    } catch (error) {
      requested = Promise.reject(error);
    }
    const pending = Promise.resolve(requested)
      .then(payload => {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const resolved = normalizeContextualSensePayload(payload, candidates);
        if (!resolved) return null;
        storage?.setItem?.(key, JSON.stringify({ schemaVersion: CONTEXTUAL_SENSE_CACHE_VERSION, savedAt: now(), data: resolved }));
        return resolved;
      })
      .catch(error => {
        if (controller.signal.aborted || isAbort(error)) throw error;
        return null;
      })
      .finally(() => {
        signal?.removeEventListener?.('abort', abort);
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
    return pending;
  }

  return { resolve };
}
