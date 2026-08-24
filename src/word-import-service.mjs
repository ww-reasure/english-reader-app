import { localDayKey } from './learning-day.mjs';
import { ActivityType, importWordDedupeKey } from './learning-activity.mjs';
import { getDefinitionSenses, getSavableTranslation } from './components/definition-trust.mjs';
import { DEFINITION_SCHEMA_VERSION } from './components/saved-word-definition.mjs';

const MAX_WORDS = 200;
const MAX_LEMMA_LENGTH = 200;
const BATCH_PREFIX = 'import-batch:';
const CATEGORIES = Object.freeze(['new', 'externalReview', 'todayIgnored', 'invalid', 'failed']);

const emptyCategories = () => ({
  new: [],
  externalReview: [],
  todayIgnored: [],
  invalid: [],
  failed: []
});

const clipReason = value => String(value?.message || value || '导入失败')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 180);

const clone = value => {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function normalizeImportCandidate(value) {
  const raw = String(value || '').trim();
  if (!/^[a-zA-Z]{2,200}$/.test(raw)) return null;
  return raw.toLocaleLowerCase('en-US').slice(0, MAX_LEMMA_LENGTH);
}

export function normalizeImportWords(text) {
  const matches = String(text || '').match(/[a-zA-Z]{2,}/g) || [];
  const seen = new Set();
  const words = [];
  for (const match of matches) {
    if (match.length > MAX_LEMMA_LENGTH) continue;
    const lemma = normalizeImportCandidate(match);
    if (!lemma || seen.has(lemma)) continue;
    seen.add(lemma);
    words.push(lemma);
    if (words.length >= MAX_WORDS) break;
  }
  return words;
}

export async function analyzeWordImport({ words = [], findWord, findDaily, dayKey } = {}) {
  const categories = emptyCategories();
  const normalizedWords = [];
  const seen = new Set();
  for (const rawWord of Array.isArray(words) ? words : []) {
    const lemma = normalizeImportCandidate(rawWord);
    if (!lemma) {
      categories.invalid.push(String(rawWord || ''));
      continue;
    }
    if (seen.has(lemma)) continue;
    seen.add(lemma);
    normalizedWords.push(lemma);
    try {
      const existing = typeof findWord === 'function' ? await findWord(lemma) : null;
      if (!existing) {
        categories.new.push(lemma);
        continue;
      }
      const daily = typeof findDaily === 'function' ? await findDaily(lemma, dayKey) : null;
      categories[daily ? 'todayIgnored' : 'externalReview'].push(lemma);
    } catch {
      categories.failed.push(lemma);
    }
  }

  const counts = {
    recognized: categories.new.length + categories.externalReview.length + categories.todayIgnored.length,
    new: categories.new.length,
    externalReview: categories.externalReview.length,
    todayIgnored: categories.todayIgnored.length,
    invalid: categories.invalid.length
  };
  return { words: normalizedWords, categories, counts };
}

function createBatchId(dayKey) {
  const random = globalThis.crypto?.randomUUID?.();
  return `import-${dayKey}-${random || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export class WordImportService {
  constructor({ db, lookup = async () => null, now = () => Date.now() } = {}) {
    if (!db) throw new TypeError('导入服务需要数据库');
    this.db = db;
    this.lookup = typeof lookup === 'function' ? lookup : async () => null;
    this.now = typeof now === 'function' ? now : () => Date.now();
  }

  batchDedupeKey(batchId) {
    return `${BATCH_PREFIX}${String(batchId || '')}`;
  }

  async createPlan(text) {
    const now = this.now();
    const dayKey = localDayKey(now);
    const words = normalizeImportWords(text);
    const result = await analyzeWordImport({
      words,
      dayKey,
      findWord: word => this.db.findLearnWord?.(word),
      findDaily: word => this.db.getLearningActivityByDedupeKey?.(importWordDedupeKey(dayKey, word))
    });
    return {
      batchId: createBatchId(dayKey),
      dayKey,
      words: result.words,
      categories: result.categories,
      counts: result.counts,
      status: 'preview'
    };
  }

  async saveBatch(state) {
    const occurredAt = this.now();
    const payload = clone({
      ...state,
      batchId: String(state.batchId || ''),
      dayKey: String(state.dayKey || localDayKey(occurredAt)),
      categories: { ...emptyCategories(), ...(state.categories || {}) },
      completedLemmas: [...new Set(state.completedLemmas || [])],
      failed: Array.isArray(state.failed) ? state.failed : []
    });
    return this.db.saveLearningActivity({
      id: this.batchDedupeKey(payload.batchId),
      type: ActivityType.WORD_IMPORT_BATCH,
      occurredAt,
      dayKey: payload.dayKey,
      sessionId: payload.batchId,
      dedupeKey: this.batchDedupeKey(payload.batchId),
      payload
    });
  }

  async loadBatch(batchId) {
    const record = await this.db.getLearningActivityByDedupeKey(this.batchDedupeKey(batchId));
    return record?.payload ? clone(record.payload) : null;
  }

  categoryFor(lemma, categories = {}) {
    for (const category of CATEGORIES) {
      if (Array.isArray(categories[category]) && categories[category].includes(lemma)) return category;
    }
    return 'failed';
  }

  async applyWord(lemma, { plan, category, occurredAt } = {}) {
    const context = {
      batchId: plan.batchId,
      dayKey: plan.dayKey,
      occurredAt
    };
    if (category !== 'new') return this.db.applyWordImportSignal({ word: lemma }, context);

    let definition = null;
    let definitionPending = false;
    try {
      definition = await this.lookup(lemma);
      definitionPending = !definition;
    } catch {
      definitionPending = true;
    }

    const wordData = {
      word: lemma,
      translation: definitionPending ? '' : getSavableTranslation(definition),
      phonetic: definitionPending ? '' : String(definition?.phonetic || ''),
      pos: definitionPending ? '' : String(definition?.pos || ''),
      definitionSenses: definitionPending ? [] : getDefinitionSenses(definition),
      definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
      definitionLexiconVersion: definitionPending ? '' : String(definition?.lexiconVersion || ''),
      definitionPending
    };
    return this.db.applyWordImportSignal(wordData, context);
  }

  summarizeResult(summary, result) {
    if (!result) return;
    if (result.status === 'new') summary.new += 1;
    if (result.status === 'external_review') {
      summary.externalReview += 1;
      if (result.scheduleChanged) summary.scheduleAdjusted += 1;
      if (result.reason === 'recovery') summary.recoveryContact += 1;
      if (result.reason === 'stubborn') summary.stubbornContact += 1;
    }
    if (result.status === 'today_ignored') summary.todayIgnored += 1;
  }

  async execute(plan, { onProgress = () => {} } = {}) {
    const source = clone(plan || {});
    const completed = new Set(Array.isArray(source.completedLemmas) ? source.completedLemmas : []);
    const failures = [];
    const summary = {
      new: 0,
      externalReview: 0,
      scheduleAdjusted: 0,
      recoveryContact: 0,
      stubbornContact: 0,
      todayIgnored: 0,
      failed: 0
    };
    const words = Array.isArray(source.words) ? source.words : [];
    const recognized = Number(source.counts?.recognized) || words.length;
    const state = {
      ...source,
      status: 'in_progress',
      completedLemmas: [...completed],
      failed: [],
      progress: { processed: 0, recognized },
      summary
    };
    await this.saveBatch(state);

    for (const lemma of words) {
      if (completed.has(lemma)) continue;
      const category = this.categoryFor(lemma, source.categories);
      let result = null;
      let failure = null;
      try {
        if (category === 'invalid') throw new Error('无法识别的单词');
        result = await this.applyWord(lemma, { plan: source, category, occurredAt: this.now() });
        completed.add(lemma);
        this.summarizeResult(summary, result);
      } catch (error) {
        failure = { lemma, reason: clipReason(error) };
        failures.push(failure);
        summary.failed = failures.length;
      }

      state.completedLemmas = [...completed];
      state.failed = [...failures];
      state.progress = { processed: state.completedLemmas.length + failures.length, recognized };
      state.summary = { ...summary };
      await this.saveBatch(state);
      try {
        await onProgress({
          lemma,
          result,
          failure,
          processed: state.progress.processed,
          recognized,
          summary: { ...summary }
        });
      } catch {}
    }

    state.status = failures.length ? 'failed' : 'completed';
    state.failed = [...failures];
    state.summary = { ...summary };
    state.progress = { processed: state.completedLemmas.length + failures.length, recognized };
    await this.saveBatch(state);
    if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent('word-library-changed', {
        detail: { reason: 'import', batchId: state.batchId || '' }
      }));
    }
    return clone(state);
  }

  async resume(batchId, options = {}) {
    const batch = await this.loadBatch(batchId);
    if (!batch) throw new Error('导入批次不存在');
    return this.execute(batch, options);
  }
}
