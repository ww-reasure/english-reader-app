import { localDayKey } from './learning-day.mjs';

export const ActivityType = Object.freeze({
  WORD_IMPORT_BATCH: 'word_import_batch',
  WORD_IMPORT_DAILY: 'word_import_daily',
  READING_WORD_LOOKUP: 'reading_word_lookup',
  READING_WORD_SAVED: 'reading_word_saved',
  REVIEW_SESSION_SUMMARY: 'review_session_summary',
  EXAM_ACTIVE_SLICE: 'exam_active_slice',
  AI_LEARNING_INTERACTION: 'ai_learning_interaction'
});
export const Completeness = Object.freeze({
  AVAILABLE: 'available',
  EMPTY: 'empty',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
  // Keep the old constant name for callers that still import it. Reports now
  // emit the clearer `available` value instead of the ambiguous `complete`.
  COMPLETE: 'available'
});
const TYPES = new Set(Object.values(ActivityType));
const clip = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
export const normalizeLemma = value => clip(value, 100).toLocaleLowerCase('en-US');
export const importWordDedupeKey = (dayKey, lemma) => `import-word:${dayKey}:${normalizeLemma(lemma)}`;

export function normalizeLearningActivity(value, now = Date.now()) {
  if (!value?.id || !TYPES.has(value.type)) throw new TypeError('学习活动类型或 id 无效');
  const occurredAt = Number.isFinite(Number(value.occurredAt)) ? Number(value.occurredAt) : Number(now);
  const payload = { ...(value.payload || {}) };
  if ('lemma' in payload) payload.lemma = normalizeLemma(payload.lemma);
  if ('title' in payload) payload.title = clip(payload.title, 240);
  return {
    id: clip(value.id, 180),
    type: value.type,
    occurredAt,
    dayKey: value.dayKey || localDayKey(occurredAt),
    timezoneOffset: Number.isFinite(Number(value.timezoneOffset)) ? Number(value.timezoneOffset) : new Date(occurredAt).getTimezoneOffset(),
    sessionId: clip(value.sessionId, 180),
    ...(value.dedupeKey ? { dedupeKey: clip(value.dedupeKey, 240) } : {}),
    payload
  };
}
