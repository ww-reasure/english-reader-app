/**
 * Audio Cache Module
 * Cache API based audio caching for offline word pronunciation
 *
 * Flow:
 *   1. getAudio(word) → check Cache API → play if cached
 *   2. If not cached → resolve Free Dictionary / Wikimedia recordings → play + cache
 *   3. preloadWords(text) → extract words → dedup → batch download → cache
 */

import { getStemForm } from './helpers.js';
import {
  createPronunciationResolver,
  fetchPronunciationResponse,
  normalizePronunciationWord
} from './pronunciation-resolver.mjs';

const RESOLUTION_CACHE_VERSION = 1;
const RESOLUTION_CACHE_PREFIX = 'https://english-reader.local/pronunciation-resolution/';
const POSITIVE_RESOLUTION_TTL = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_RESOLUTION_TTL = 24 * 60 * 60 * 1000;

export const AudioCache = {
  CACHE_NAME: 'english-reader-audio',
  CONCURRENCY: 5,
  _activeAudio: null,
  _resolver: createPronunciationResolver(),

  isAborted(signal) {
    return Boolean(signal?.aborted);
  },

  stop() {
    try {
      if (this._activeAudio) {
        this._activeAudio.pause();
        this._activeAudio.currentTime = 0;
      }
    } catch {}
    this._activeAudio = null;
  },

  // Get cache instance
  async getCache() {
    return await caches.open(this.CACHE_NAME);
  },

  // Keep already-downloaded legacy files usable, but never probe these guessed
  // URLs on the network. New recordings come only from authoritative API data.
  getLegacyAudioUrls(word) {
    const w = word.toLowerCase();
    return [
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}-uk.mp3`,
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}-us.mp3`,
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}-au.mp3`,
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}.mp3`,
    ];
  },

  getResolutionCacheUrl(word) {
    return `${RESOLUTION_CACHE_PREFIX}${encodeURIComponent(word)}`;
  },

  async readResolution(cache, word, { includeWikimedia = true } = {}) {
    if (!cache) return null;
    try {
      const response = await cache.match(this.getResolutionCacheUrl(word));
      if (!response) return null;
      const payload = await response.json();
      if (payload?.version !== RESOLUTION_CACHE_VERSION || !Array.isArray(payload?.candidates)) return null;
      if (includeWikimedia && payload.scope !== 'full' && payload.candidates.length === 0) return null;
      const ttl = payload.candidates.length ? POSITIVE_RESOLUTION_TTL : NEGATIVE_RESOLUTION_TTL;
      if (!Number.isFinite(payload.savedAt) || Date.now() - payload.savedAt > ttl) return null;
      return payload.candidates;
    } catch {
      return null;
    }
  },

  async writeResolution(cache, word, candidates, { includeWikimedia = true } = {}) {
    if (!cache || typeof Response === 'undefined') return;
    try {
      const response = new Response(JSON.stringify({
        version: RESOLUTION_CACHE_VERSION,
        savedAt: Date.now(),
        scope: includeWikimedia ? 'full' : 'dictionary',
        candidates
      }), { headers: { 'Content-Type': 'application/json' } });
      await cache.put(this.getResolutionCacheUrl(word), response);
    } catch {}
  },

  async getPronunciationMetadata(word, { cache: suppliedCache = null } = {}) {
    const key = normalizePronunciationWord(word);
    if (!key) return [];
    try {
      const cache = suppliedCache || await this.getCache();
      return await this.readResolution(cache, key, { includeWikimedia: true }) || [];
    } catch {
      return [];
    }
  },

  async resolveCandidates(word, { signal, includeWikimedia = true, cache = null } = {}) {
    const cached = await this.readResolution(cache, word, { includeWikimedia });
    if (cached) return cached;
    const candidates = await this._resolver.resolve(word, { signal, includeWikimedia });
    if (!this.isAborted(signal)) await this.writeResolution(cache, word, candidates, { includeWikimedia });
    return candidates;
  },

  async fetchAudio(word, { signal, includeWikimedia = true, cache = null } = {}) {
    const candidates = await this.resolveCandidates(word, { signal, includeWikimedia, cache });
    for (const candidate of candidates) {
      if (this.isAborted(signal)) return null;
      try {
        const cached = cache ? await cache.match(candidate.url) : null;
        if (cached) return { ...candidate, response: cached, cached: true };
        const response = await fetchPronunciationResponse(candidate.url, { signal });
        if (response) return { ...candidate, response, cached: false };
      } catch {
        if (this.isAborted(signal)) return null;
      }
    }
    return null;
  },

  // Play audio from blob/url
  async play(audioUrl, { signal } = {}) {
    if (this.isAborted(signal)) return false;
    try {
      this.stop();
      const audio = new Audio(audioUrl);
      this._activeAudio = audio;
      audio.onended = () => {
        if (this._activeAudio === audio) this._activeAudio = null;
        audio.src = '';
      };
      audio.onerror = () => {
        if (this._activeAudio === audio) this._activeAudio = null;
        audio.src = '';
      };
      if (this.isAborted(signal)) return false;
      await audio.play();
      if (this.isAborted(signal)) {
        this.stop();
        return false;
      }
      return true;
    } catch {
      if (this._activeAudio) this._activeAudio = null;
      return false;
    }
  },

  async playResponse(response, { signal } = {}) {
    if (this.isAborted(signal)) return false;
    let objectUrl = '';
    try {
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      this.stop();
      this._activeAudio = audio;
      const release = () => {
        if (this._activeAudio === audio) this._activeAudio = null;
        URL.revokeObjectURL(objectUrl);
      };
      audio.onended = release;
      audio.onerror = release;
      if (this.isAborted(signal)) {
        release();
        return false;
      }
      await audio.play();
      if (this.isAborted(signal)) {
        this.stop();
        release();
        return false;
      }
      return true;
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (this._activeAudio) this._activeAudio = null;
      return false;
    }
  },

  async playCandidates(candidates, { signal, cache = null } = {}) {
    for (const candidate of candidates) {
      if (this.isAborted(signal)) return false;
      const cached = cache ? await cache.match(candidate.url).catch(() => null) : null;
      if (cached && await this.playResponse(cached, { signal })) return true;
    }

    // API candidates are already ordered by preferred accent. Trying the first
    // authoritative URL with a hard timeout keeps a stalled CDN from delaying
    // the Wikimedia fallback or probing a series of URLs on the same host.
    const candidate = candidates[0];
    if (!candidate || this.isAborted(signal)) return false;
    const response = await fetchPronunciationResponse(candidate.url, { signal });
    if (!response || this.isAborted(signal)) return false;
    if (cache) await cache.put(candidate.url, response.clone()).catch(() => {});
    return this.playResponse(response, { signal });
  },

  // Get and play a recorded pronunciation. Synthetic speech is deliberately
  // excluded so audio quality remains consistent across the learning app.
  async getAudio(word, { signal, silent = false } = {}) {
    if (this.isAborted(signal)) return false;
    const key = normalizePronunciationWord(word);
    if (!key || key.length < 2) return false;

    let cache = null;
    try {
      if (typeof caches !== 'undefined') cache = await this.getCache();
    } catch {}

    // Preserve audio downloaded by older app versions without issuing guessed
    // network requests for those historical URL shapes.
    if (cache) {
      for (const url of this.getLegacyAudioUrls(key)) {
        if (this.isAborted(signal)) return false;
        const cached = await cache.match(url).catch(() => null);
        if (cached && await this.playResponse(cached, { signal })) return true;
      }
    }

    const candidates = await this.resolveCandidates(key, { signal, includeWikimedia: true, cache });
    if (this.isAborted(signal)) return false;

    const dictionary = candidates.filter(candidate => candidate.source === 'free-dictionary');
    let wikimedia = candidates.filter(candidate => candidate.source === 'wikimedia-commons');
    if (dictionary.length && await this.playCandidates(dictionary, { signal, cache })) return true;

    // A dictionary entry can exist while its media CDN is unavailable. Only in
    // that case, explicitly resolve the independent Lingua Libre recording.
    if (dictionary.length && !wikimedia.length) {
      wikimedia = await this._resolver.resolveWikimedia(key, { signal });
      if (this.isAborted(signal)) return false;
      const merged = [...candidates, ...wikimedia]
        .filter((candidate, index, list) => list.findIndex(item => item.url === candidate.url) === index);
      await this.writeResolution(cache, key, merged, { includeWikimedia: true });
    }
    if (await this.playCandidates(wikimedia, { signal, cache })) return true;

    if (!silent) this._showToast(`"${word}" 暂无真人发音`);
    return false;
  },

  // Simple toast notification
  _showToast(msg) {
    let toast = document.getElementById('audioToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'audioToast';
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--toast-bg);color:var(--toast-ink);padding:8px 16px;border-radius:20px;font-size:14px;z-index:10000;transition:opacity 0.3s';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
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

    // Bulk preload intentionally stays on the lightweight dictionary source;
    // Wikimedia is queried on demand when the user taps a missing recording.
    const cache = await this.getCache();
    const toFetch = [];
    for (const word of unique) {
      if (!await this.isCached(word, { cache })) toFetch.push(word);
    }

    if (toFetch.length === 0) return 0;

    // Batch download with concurrency control
    let downloaded = 0;
    const total = toFetch.length;

    for (let i = 0; i < toFetch.length; i += this.CONCURRENCY) {
      const batch = toFetch.slice(i, i + this.CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async word => {
          const audioResult = await this.fetchAudio(word, { includeWikimedia: false, cache });
          if (!audioResult) return false;
          const { url, response, cached } = audioResult;
          if (cached) return false;
          await cache.put(url, response);
          return true;
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
        const keys = (await cache.keys()).filter(request => !request.url.startsWith(RESOLUTION_CACHE_PREFIX));
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
  async isCached(word, { cache: suppliedCache = null } = {}) {
    try {
      const key = normalizePronunciationWord(word);
      if (!key) return false;
      const cache = suppliedCache || await this.getCache();
      for (const url of this.getLegacyAudioUrls(key)) {
        const cached = await cache.match(url);
        if (cached) return true;
      }
      const candidates = await this.readResolution(cache, key, { includeWikimedia: false });
      for (const candidate of candidates || []) {
        const cached = await cache.match(candidate.url);
        if (cached) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
};

if (typeof window !== 'undefined') window.AudioCache = AudioCache;
