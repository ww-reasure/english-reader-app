/**
 * Audio Cache Module
 * Cache API based audio caching for offline word pronunciation
 *
 * Flow:
 *   1. getAudio(word) → check Cache API → play if cached
 *   2. If not cached → fetch from Free Dictionary API → play + cache
 *   3. preloadWords(text) → extract words → dedup → batch download → cache
 */

import { getStemForm } from './helpers.js';

export const AudioCache = {
  CACHE_NAME: 'english-reader-audio',
  CONCURRENCY: 5,

  // Get cache instance
  async getCache() {
    return await caches.open(this.CACHE_NAME);
  },

  // Get audio URL variants for a word (Free Dictionary API has multiple formats)
  getAudioUrls(word) {
    const w = word.toLowerCase();
    return [
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}-uk.mp3`,
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}-us.mp3`,
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}-au.mp3`,
      `https://api.dictionaryapi.dev/media/pronunciations/en/${w}.mp3`,
    ];
  },

  // Get first working audio URL
  async findAudioUrl(word) {
    const urls = this.getAudioUrls(word);
    for (const url of urls) {
      try {
        const resp = await fetch(url, { method: 'HEAD' });
        if (resp.ok) return url;
      } catch {}
    }
    return null;
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

  // Get and play audio (try multiple URL formats + cache)
  async getAudio(word) {
    const key = word.toLowerCase().replace(/[^a-z\-']/g, '');
    if (!key || key.length < 2) return false;

    // 1. Check cache first (try all URL variants)
    try {
      if (typeof caches !== 'undefined') {
        const cache = await this.getCache();
        for (const url of this.getAudioUrls(key)) {
          const cached = await cache.match(url);
          if (cached) {
            const blob = await cached.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            await audio.play();
            return true;
          }
        }
      }
    } catch {}

    // 2. Find a working URL from network
    const url = await this.findAudioUrl(key);
    if (!url) {
      this._showToast(`"${word}" 暂无发音`);
      return false;
    }

    // 3. Play and cache
    try {
      const audio = new Audio(url);
      await audio.play();
      // Cache for next time
      try {
        if (typeof caches !== 'undefined') {
          const resp = await fetch(url);
          if (resp.ok) {
            const cache = await this.getCache();
            await cache.put(url, resp);
          }
        }
      } catch {}
      return true;
    } catch (e) {
      console.warn('Audio play failed:', e);
      return false;
    }
  },

  // Simple toast notification
  _showToast(msg) {
    let toast = document.getElementById('audioToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'audioToast';
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:20px;font-size:14px;z-index:10000;transition:opacity 0.3s';
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

    // Filter already cached (check all URL variants)
    const cache = await this.getCache();
    const toFetch = [];
    for (const word of unique) {
      const urls = this.getAudioUrls(word);
      let found = false;
      for (const url of urls) {
        const cached = await cache.match(url);
        if (cached) { found = true; break; }
      }
      if (!found) toFetch.push(word);
    }

    if (toFetch.length === 0) return 0;

    // Batch download with concurrency control
    let downloaded = 0;
    const total = toFetch.length;

    for (let i = 0; i < toFetch.length; i += this.CONCURRENCY) {
      const batch = toFetch.slice(i, i + this.CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async word => {
          const url = await this.findAudioUrl(word);
          if (!url) return false;
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
      for (const url of this.getAudioUrls(word)) {
        const cached = await cache.match(url);
        if (cached) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
};

window.AudioCache = AudioCache;
