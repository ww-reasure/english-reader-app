export const WORD_SIMILAR_CACHE_VERSION = 1;
const CACHE_PREFIX = `word_similar_v${WORD_SIMILAR_CACHE_VERSION}_`;
const CHINESE_TEXT = /[\u3400-\u9fff]/u;
const ENGLISH_WORD = /^[a-z][a-z'-]{1,34}$/iu;

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
  return forms;
}

export function normalizeWordSimilarPayload(word, payload) {
  const key = normalizeWord(word);
  if (!key) return [];
  const targetForms = getTargetForms(key);
  const rows = Array.isArray(payload?.similar) ? payload.similar : Array.isArray(payload?.synonyms) ? payload.synonyms : [];
  const seen = new Set();
  const items = [];

  for (const row of rows) {
    const candidate = normalizeWord(row?.word || row?.term || row?.similar);
    const glossZh = text(row?.glossZh || row?.translation);
    const nuanceZh = text(row?.nuanceZh || row?.noteZh || row?.note);
    if (!candidate || !ENGLISH_WORD.test(candidate) || targetForms.has(candidate) || seen.has(candidate)) continue;
    if (!glossZh || glossZh.length > 80 || !CHINESE_TEXT.test(glossZh)) continue;
    if (nuanceZh && (nuanceZh.length > 72 || !CHINESE_TEXT.test(nuanceZh))) continue;
    seen.add(candidate);
    items.push({ word: candidate, glossZh, ...(nuanceZh ? { nuanceZh } : {}) });
    if (items.length === 5) break;
  }

  return items.length >= 3 ? items : [];
}

function abortError() {
  if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

export function createWordSimilar({
  request,
  storage = globalThis.localStorage
} = {}) {
  if (typeof request !== 'function') throw new TypeError('近义词服务需要请求函数');
  const pending = new Map();

  const readCache = (key) => {
    if (!storage?.getItem) return null;
    try {
      const cached = JSON.parse(storage.getItem(`${CACHE_PREFIX}${key}`) || 'null');
      if (cached?.schemaVersion !== WORD_SIMILAR_CACHE_VERSION) return null;
      const items = normalizeWordSimilarPayload(key, cached);
      return items.length ? items : null;
    } catch {
      return null;
    }
  };

  const writeCache = (key, items) => {
    if (!storage?.setItem) return;
    try {
      storage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({
        schemaVersion: WORD_SIMILAR_CACHE_VERSION,
        cachedAt: Date.now(),
        similar: items
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
            const items = normalizeWordSimilarPayload(key, payload);
            if (!items.length) throw new Error('没有返回可用近义词');
            writeCache(key, items);
            return items;
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
