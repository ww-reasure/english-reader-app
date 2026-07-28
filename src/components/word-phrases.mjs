export const WORD_PHRASES_CACHE_VERSION = 1;
const CACHE_PREFIX = `word_phrases_v${WORD_PHRASES_CACHE_VERSION}_`;
const CHINESE_TEXT = /[\u3400-\u9fff]/u;
const ENGLISH_TEXT = /[a-z]/iu;

const text = value => String(value || '').trim().replace(/\s+/gu, ' ');
const normalizeWord = value => text(value).toLocaleLowerCase('en-US').replace(/[^a-z'-]/gu, '');

function getTargetForms(word) {
  const forms = new Set([word]);
  if (word.endsWith('ies') && word.length > 4) forms.add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es') && word.length > 3) {
    forms.add(word.slice(0, -2));
    forms.add(word.slice(0, -1));
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) forms.add(word.slice(0, -1));
  if (word.endsWith('ed') && word.length > 4) {
    forms.add(word.slice(0, -2));
    forms.add(word.slice(0, -1));
  }
  if (word.endsWith('ing') && word.length > 5) {
    forms.add(word.slice(0, -3));
    forms.add(`${word.slice(0, -3)}e`);
  }
  return [...forms].filter(Boolean);
}

function includesTargetWord(phrase, word) {
  const lower = phrase.toLocaleLowerCase('en-US');
  return getTargetForms(word).some(form => new RegExp(`(^|[^a-z])${form.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}([^a-z]|$)`, 'u').test(lower));
}

export function normalizeWordPhrasePayload(word, payload) {
  const key = normalizeWord(word);
  if (!key) return [];
  const rows = Array.isArray(payload?.phrases) ? payload.phrases : [];
  const seen = new Set();
  const phrases = [];

  for (const row of rows) {
    const phrase = text(row?.phrase || row?.text);
    const glossZh = text(row?.glossZh || row?.translation);
    const phraseKey = phrase.toLocaleLowerCase('en-US');
    if (!phrase || phrase.length > 90 || !ENGLISH_TEXT.test(phrase) || !includesTargetWord(phrase, key)) continue;
    if (!glossZh || glossZh.length > 80 || !CHINESE_TEXT.test(glossZh)) continue;
    if (seen.has(phraseKey)) continue;
    seen.add(phraseKey);
    phrases.push({ phrase, glossZh });
    if (phrases.length === 5) break;
  }

  return phrases.length >= 3 ? phrases : [];
}

function abortError() {
  if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

export function createWordPhrases({
  request,
  storage = globalThis.localStorage
} = {}) {
  if (typeof request !== 'function') throw new TypeError('词组服务需要请求函数');
  const pending = new Map();

  const readCache = (key) => {
    if (!storage?.getItem) return null;
    try {
      const cached = JSON.parse(storage.getItem(`${CACHE_PREFIX}${key}`) || 'null');
      if (cached?.schemaVersion !== WORD_PHRASES_CACHE_VERSION) return null;
      const phrases = normalizeWordPhrasePayload(key, cached);
      return phrases.length ? phrases : null;
    } catch {
      return null;
    }
  };

  const writeCache = (key, phrases) => {
    if (!storage?.setItem) return;
    try {
      storage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({
        schemaVersion: WORD_PHRASES_CACHE_VERSION,
        cachedAt: Date.now(),
        phrases
      }));
    } catch {}
  };

  const subscribe = (entry, signal) => {
    entry.consumers += 1;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        entry.consumers = Math.max(0, entry.consumers - 1);
        if (signal) signal.removeEventListener('abort', onAbort);
        return true;
      };
      const onAbort = () => {
        if (!finish()) return;
        if (!entry.settled && entry.consumers === 0) entry.controller.abort();
        reject(abortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        value => { if (finish()) resolve(value); },
        error => { if (finish()) reject(error); }
      );
    });
  };

  return {
    async get(word, { signal } = {}) {
      const key = normalizeWord(word);
      if (!key) throw new TypeError('请输入有效英文单词');
      if (signal?.aborted) throw abortError();

      const cached = readCache(key);
      if (cached) return cached;

      let entry = pending.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, consumers: 0, settled: false, promise: null };
        let requestResult;
        try {
          requestResult = request(key, { signal: controller.signal });
        } catch (error) {
          requestResult = Promise.reject(error);
        }
        entry.promise = Promise.resolve(requestResult)
          .then(payload => {
            const phrases = normalizeWordPhrasePayload(key, payload);
            if (!phrases.length) throw new Error('没有返回可用词组');
            writeCache(key, phrases);
            return phrases;
          })
          .finally(() => {
            entry.settled = true;
            if (pending.get(key) === entry) pending.delete(key);
          });
        pending.set(key, entry);
      }
      return subscribe(entry, signal);
    }
  };
}
