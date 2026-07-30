import { API } from '../api.js';
import { Config } from '../config.js';
import { DB } from '../db.js';
import { getSavableTranslation } from './definition-trust.mjs';
import { createContextReviewService, validateGeneratedContextReviewSentence } from './context-review.mjs';
import { ReviewQueue } from '../review-queue.js';
import { ExamCorpus } from '../exam-corpus-runtime.mjs';

const CACHE_VERSION = 1;
const normalize = value => String(value || '').trim().toLocaleLowerCase('en-US');
const safeJson = value => {
  try { return JSON.parse(value); } catch { return null; }
};

async function getCachedExamples(word) {
  const value = globalThis.localStorage?.getItem(`examples_${normalize(word)}`);
  const parsed = safeJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

async function loadCached({ words = [], targetTrack = '' } = {}) {
  const rows = [];
  for (const word of words) {
    const candidates = await DB.getContextReviewSentencesForWord(word.id, 8);
    const preferred = candidates.filter(item => item.targetTrack === targetTrack);
    rows.push(...preferred, ...candidates.filter(item => item.targetTrack !== targetTrack));
  }
  return rows;
}

async function saveCached(items = []) {
  const now = Date.now();
  const rows = items.map(item => ({
    ...item,
    key: item.key || `context-v${CACHE_VERSION}:${item.wordId}:${normalize(item.sentence)}`,
    cacheVersion: CACHE_VERSION,
    savedAt: item.savedAt || now,
    lastUsedAt: item.lastUsedAt || 0
  }));
  rows.forEach((row, index) => Object.assign(items[index], row));
  return DB.saveContextReviewSentences(rows);
}

async function generateBatch(words, { targetTrack = '', signal = null } = {}) {
  if (!words.length || !Config.hasApiKey()) return [];
  const rows = words.map(word => ({
    wordId: word.id,
    lemma: normalize(word.word),
    senses: Array.isArray(word.definitionSenses)
      ? word.definitionSenses.slice(0, 6).map((sense, index) => ({ index, pos: sense.pos || '', glossZh: sense.glossZh || '' }))
      : [{ index: 0, pos: word.pos || '', glossZh: getSavableTranslation(word) || '' }]
  }));
  const response = await API.fetch('/chat/completions', {
    messages: [
      {
        role: 'system',
        content: `你是英语语境复习材料编辑。仅返回 JSON {"items":[{"wordId":1,"lemma":"word","targetForm":"word","sentence":"...","translationZh":"...","senseIndex":0}]}。每个输入词生成一句 9-22 词的自然英文句子；句中必须使用输入的 lemma 原形，targetForm 与 lemma 完全相同。不得在英文句中写中文、括号释义或直接解释目标词。translationZh 必须是自然中文整句翻译，senseIndex 只能选择给定候选索引。除目标词外尽量使用不高于 ${targetTrack || '通用英语'} 的常用词，避免罕见专名。`
      },
      { role: 'user', content: JSON.stringify({ words: rows }) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.55
  }, 60000, signal);
  const parsed = safeJson(response?.choices?.[0]?.message?.content);
  const requested = new Map(rows.map(item => [Number(item.wordId), item]));
  return (Array.isArray(parsed?.items) ? parsed.items : [])
    .map(item => validateGeneratedContextReviewSentence(item, requested.get(Number(item?.wordId))))
    .filter(Boolean);
}

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
    return DB.recordLearnWordReview(item.wordId, schedule, {
      rating: result === 'known' ? 5 : result === 'uncertain' ? 3 : 1,
      source: 'context-review',
      sawAnswer: false,
      contextResult: result,
      assistedLookupCount: Math.max(0, Number(assistedLookupCount) || 0),
      expectedRevision: item.expectedRevision,
      attemptId
    }).then(word => ({ ...word, attemptId }));
  }
});
