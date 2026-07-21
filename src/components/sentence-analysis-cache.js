/**
 * Small in-memory LRU cache for AI sentence analysis.
 * It stores pending promises too, so repeated long presses share one request.
 */
export class SentenceAnalysisCache {
  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  normalize(sentence) {
    return String(sentence || '').trim().replace(/\s+/g, ' ');
  }

  get(sentence) {
    const key = this.normalize(sentence);
    if (!key || !this.entries.has(key)) return undefined;

    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(sentence, value) {
    const key = this.normalize(sentence);
    if (!key) return;

    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  delete(sentence) {
    this.entries.delete(this.normalize(sentence));
  }

  getOrCreate(sentence, create) {
    const cached = this.get(sentence);
    if (cached !== undefined) return Promise.resolve(cached);

    const request = Promise.resolve().then(create);
    this.set(sentence, request);

    return request.then(
      result => {
        this.set(sentence, result);
        return result;
      },
      error => {
        this.delete(sentence);
        throw error;
      }
    );
  }
}
