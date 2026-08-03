export const getExampleCacheKey = word => `examples_${String(word || '').toLowerCase()}`;

export function readExampleCache(word, storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return { hit: false, examples: [] };
  }

  try {
    const cached = storage.getItem(getExampleCacheKey(word));
    if (!cached) return { hit: false, examples: [] };

    const examples = JSON.parse(cached);
    return Array.isArray(examples)
      ? { hit: true, examples }
      : { hit: false, examples: [] };
  } catch {
    return { hit: false, examples: [] };
  }
}
