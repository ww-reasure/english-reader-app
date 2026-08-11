import { API } from '../api.js';
import { Config } from '../config.js';
import { DB } from '../db.js';
import { getSavableTranslation } from './definition-trust.mjs';
import { createContextReviewService } from './context-review.mjs';
import { createContextReviewGenerator, makeContextReviewCacheKey } from './context-review-runtime.mjs';
import { ReviewQueue } from '../review-queue.js';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';

const CACHE_VERSION = 3;
const normalize = value => String(value || '').trim().toLocaleLowerCase('en-US');
const safeJson = value => {
  try { return JSON.parse(value); } catch { return null; }
};

async function getCachedExamples(word) {
  const value = globalThis.localStorage?.getItem(`examples_${normalize(word)}`);
  const parsed = safeJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

async function loadCached({ words = [], sourceTrack = '', targetTrack = '' } = {}) {
  const requestedTrack = normalize(sourceTrack || targetTrack);
  const itemTrack = item => normalize(item?.sourceTrack || item?.targetTrack || item?.examTrack);
  const rows = [];
  for (const word of words) {
    const candidates = await DB.getContextReviewSentencesForWord(word.id, 16);
    rows.push(...candidates.filter(item => itemTrack(item) === requestedTrack));
  }
  return rows;
}

async function saveCached(items = []) {
  const now = Date.now();
  const cacheable = items.filter(item => item?.difficultyStatus !== 'offline-fallback');
  const rows = cacheable.map(item => ({
    ...item,
    key: item.key || makeContextReviewCacheKey(item),
    cacheVersion: CACHE_VERSION,
    savedAt: item.savedAt || now,
    lastUsedAt: item.lastUsedAt || 0
  }));
  rows.forEach((row, index) => Object.assign(cacheable[index], row));
  return DB.saveContextReviewSentences(rows);
}

const generateBatch = createContextReviewGenerator({
  fetch: (...args) => API.fetch(...args),
  hasApiKey: () => Config.hasApiKey(),
  getTranslation: getSavableTranslation
});

export const ContextReview = createContextReviewService({
  examExamples: (word, targetTrack) => ExamCorpus.getExamples(word, targetTrack),
  articles: () => DB.getAllArticles(),
  examples: getCachedExamples,
  generateBatch,
  loadCached,
  saveCached,
  coordinator: ReviewQueue,
  recordReview: async ({ item, result, schedule, assistedLookupCount }) => {
    const attemptId = `context:${item.wordId}:${Date.now()}`;
    return DB.settleSessionReview(item.wordId, schedule, {
      rating: result === 'known' ? 5 : result === 'uncertain' ? 3 : 1,
      source: 'context-review',
      sawAnswer: false,
      contextResult: result,
      assistedLookupCount: Math.max(0, Number(assistedLookupCount) || 0),
      expectedRevision: item.expectedRevision,
      sessionDebt: result === 'uncertain' ? 1 : result === 'unknown' ? 2 : 0,
      attemptId
    }).then(word => ({ ...word, attemptId }));
  }
});
