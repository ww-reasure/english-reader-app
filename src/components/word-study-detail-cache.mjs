import { Affixes } from '../affixes.js';
import { Examples } from '../examples.js';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';
import { AiCache } from './ai-cache.mjs';

export const WORD_DETAIL_CACHE_VERSION = 'word-detail-v2';
export const WORD_DETAIL_CACHE_NAMESPACE = 'word-detail';

const writes = new Map();

function normalizeWord(word) {
  return String(word || '').trim().toLocaleLowerCase('en-US');
}

function normalizeContext(context = {}) {
  return {
    targetTrack: String(context.targetTrack || '').trim().toLocaleLowerCase('en-US'),
    lexiconVersion: String(context.lexiconVersion || '').trim(),
    promptVersion: String(context.promptVersion || 'study-material-v2').trim()
  };
}

function cacheKey(word, context = {}) {
  const normalized = normalizeContext(context);
  return [normalizeWord(word), normalized.targetTrack, normalized.lexiconVersion, normalized.promptVersion]
    .map(value => encodeURIComponent(value))
    .join('|');
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeWordStudyDetailSnapshot(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const loaded = source.loaded && typeof source.loaded === 'object' ? source.loaded : {};
  return {
    schemaVersion: 2,
    examples: array(source.examples),
    examExamples: array(source.examExamples),
    personalExamples: array(source.personalExamples),
    rootAnalysis: source.rootAnalysis && typeof source.rootAnalysis === 'object' ? source.rootAnalysis : null,
    examCorpus: source.examCorpus && typeof source.examCorpus === 'object' ? source.examCorpus : null,
    phrases: array(source.phrases),
    similar: array(source.similar),
    loaded: {
      examples: Boolean(loaded.examples),
      root: Boolean(loaded.root),
      exam: Boolean(loaded.exam),
      phrases: Boolean(loaded.phrases),
      similar: Boolean(loaded.similar)
    }
  };
}

export async function loadCachedDetail(word, context = {}) {
  const normalizedWord = normalizeWord(word);
  if (!normalizedWord) return null;
  const entry = await AiCache.get(WORD_DETAIL_CACHE_NAMESPACE, cacheKey(normalizedWord, context), {
    version: WORD_DETAIL_CACHE_VERSION
  });
  if (!entry) return null;
  return { ...entry, value: normalizeWordStudyDetailSnapshot(entry.value) };
}

async function writeSnapshot(word, context, patch = {}) {
  const normalizedWord = normalizeWord(word);
  if (!normalizedWord) return null;
  const key = cacheKey(normalizedWord, context);
  const previous = await loadCachedDetail(normalizedWord, context);
  const current = normalizeWordStudyDetailSnapshot(previous?.value);
  const next = normalizeWordStudyDetailSnapshot({ ...current, ...patch, loaded: { ...current.loaded, ...(patch.loaded || {}) } });
  return AiCache.set(WORD_DETAIL_CACHE_NAMESPACE, key, next, { version: WORD_DETAIL_CACHE_VERSION });
}

export async function persistDetailCache(word, context = {}, patch = {}) {
  const normalizedWord = normalizeWord(word);
  if (!normalizedWord) return null;
  const key = cacheKey(normalizedWord, context);
  const previous = writes.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeSnapshot(normalizedWord, context, patch));
  writes.set(key, next);
  try {
    return await next;
  } finally {
    if (writes.get(key) === next) writes.delete(key);
  }
}

export const WordStudyDetailCache = Object.freeze({
  get: loadCachedDetail,
  loadCachedDetail,
  update(word, context, patch) {
    const loaded = { ...(patch?.loaded || {}) };
    if ((Object.hasOwn(patch || {}, 'examples') || Object.hasOwn(patch || {}, 'examExamples') || Object.hasOwn(patch || {}, 'personalExamples')) && loaded.examples !== false) loaded.examples = true;
    if (Object.hasOwn(patch || {}, 'rootAnalysis') && loaded.root !== false) loaded.root = true;
    if (Object.hasOwn(patch || {}, 'examCorpus') && loaded.exam !== false) loaded.exam = true;
    if (Object.hasOwn(patch || {}, 'phrases') && loaded.phrases !== false) loaded.phrases = true;
    if (Object.hasOwn(patch || {}, 'similar') && loaded.similar !== false) loaded.similar = true;
    return persistDetailCache(word, context, { ...patch, loaded });
  },
  persistDetailCache,
  async prefetch(word, context = {}) {
    const normalizedWord = normalizeWord(word);
    if (!normalizedWord) return null;
    const cached = await loadCachedDetail(normalizedWord, context).catch(() => null);
    if (cached && !cached.stale && cached.value.loaded.examples && cached.value.loaded.root && cached.value.loaded.exam) return cached.value;

    const targetTrack = normalizeContext(context).targetTrack;
    const [examExamples, examples, root, examCorpus] = await Promise.allSettled([
      ExamCorpus.getExamples(normalizedWord, targetTrack),
      Examples.getExamples(normalizedWord),
      Affixes.getAnalysis(normalizedWord),
      ExamCorpus.lookupAll(normalizedWord)
    ]);
    const complete = [examExamples, examples, root, examCorpus].every(item => item.status === 'fulfilled');
    if (!complete) return cached?.value || null;
    const patch = {};
    if (examExamples.status === 'fulfilled') patch.examExamples = array(examExamples.value);
    if (examples.status === 'fulfilled') {
      patch.personalExamples = array(examples.value);
      patch.examples = [...array(patch.examExamples), ...patch.personalExamples];
    }
    if (root.status === 'fulfilled' && root.value) patch.rootAnalysis = root.value;
    if (examCorpus.status === 'fulfilled') patch.examCorpus = examCorpus.value || {};
    patch.loaded = {
      examples: examExamples.status === 'fulfilled' && examples.status === 'fulfilled',
      root: root.status === 'fulfilled' && Boolean(root.value),
      exam: examCorpus.status === 'fulfilled'
    };
    if (!Object.keys(patch).length) return cached?.value || null;
    return persistDetailCache(normalizedWord, context, patch);
  },
  invalidate(word, context = {}) {
    const normalizedWord = normalizeWord(word);
    return AiCache.invalidate(WORD_DETAIL_CACHE_NAMESPACE, cacheKey(normalizedWord, context), {
      version: WORD_DETAIL_CACHE_VERSION
    });
  },
  key: cacheKey
});
