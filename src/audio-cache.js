/**
 * Audio Cache Module
 * Cache API based audio caching for offline word pronunciation
 *
 * Flow:
 *   1. getAudio(word) → check Cache API → play if cached
 *   2. If not cached → fetch from Free Dictionary API → play + cache
 *   3. preloadWords(text) → extract words → dedup → batch download → cache
 */

const AudioCache = {
  CACHE_NAME: 'english-reader-audio',
  CONCURRENCY: 5,

  // Get cache instance
  async getCache() {
    return await caches.open(this.CACHE_NAME);
  },

  // Get audio URL for a word (Free Dictionary API format)
  getAudioUrl(word) {
    return `https://api.dictionaryapi.dev/media/pronunciations/en/${word.toLowerCase()}-uk.mp3`;
  },

  // Play audio from blob/url
  async play(audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      audio.onended = () => { audio.src = ''; };
      await audio.play();
    } catch {
      // Silent fail
    }
  },

  // Get and play audio (cache-first)
  async getAudio(word) {
    const key = word.toLowerCase().replace(/[^a-z\-']/g, '');
    if (!key || key.length < 2) return false;

    try {
      const cache = await this.getCache();
      const url = this.getAudioUrl(key);

      // 1. Check cache first
      const cached = await cache.match(url);
      if (cached) {
        const blob = await cached.blob();
        this.play(URL.createObjectURL(blob));
        return true;
      }

      // 2. Fetch from network
      const response = await fetch(url);
      if (response.ok) {
        // Cache the response
        await cache.put(url, response.clone());
        const blob = await response.blob();
        this.play(URL.createObjectURL(blob));
        return true;
      }

      return false;
    } catch {
      return false;
    }
  },

  // Preload audio for words in a text (batch, dedup, progress)
  async preloadWords(text, onProgress) {
    // Extract unique words
    const words = (text.match(/[a-zA-Z]{3,}/g) || [])
      .map(w => w.toLowerCase())
      .filter(w => w.length >= 3);

    // Dedup with stemming
    const seen = new Set();
    const unique = [];
    for (const word of words) {
      const stem = getStemForm(word);
      if (!seen.has(stem)) {
        seen.add(stem);
        unique.push(word);
      }
    }

    // Filter already cached
    const cache = await this.getCache();
    const toFetch = [];
    for (const word of unique) {
      const url = this.getAudioUrl(word);
      const cached = await cache.match(url);
      if (!cached) {
        toFetch.push(word);
      }
    }

    if (toFetch.length === 0) return 0;

    // Batch download with concurrency control
    let downloaded = 0;
    const total = toFetch.length;

    for (let i = 0; i < toFetch.length; i += this.CONCURRENCY) {
      const batch = toFetch.slice(i, i + this.CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async word => {
          const url = this.getAudioUrl(word);
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
            return true;
          }
          return false;
        })
      );

      downloaded += results.filter(r => r.status === 'fulfilled' && r.value).length;
      if (onProgress) {
        onProgress(downloaded, total);
      }
    }

    return downloaded;
  },

  // Get cache size estimate
  async getCacheSize() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        // Rough estimate: audio cache is a subset of total usage
        const cache = await this.getCache();
        const keys = await cache.keys();
        return {
          count: keys.length,
          estimatedMB: Math.round((keys.length * 15) / 1024 * 10) / 10  // ~15KB per word
        };
      }
    } catch {}
    return { count: 0, estimatedMB: 0 };
  },

  // Clear all cached audio
  async clearCache() {
    try {
      await caches.delete(this.CACHE_NAME);
      return true;
    } catch {
      return false;
    }
  },

  // Check if a word is cached
  async isCached(word) {
    try {
      const cache = await this.getCache();
      const url = this.getAudioUrl(word.toLowerCase());
      const cached = await cache.match(url);
      return !!cached;
    } catch {
      return false;
    }
  }
};
