import { scheduleContextReview } from '../context-review-scheduler.mjs';

const normalizeWord = value => String(value || '').trim().toLocaleLowerCase('en-US');
const normalizeSpace = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeSentenceKey = value => normalizeSpace(value).toLocaleLowerCase('en-US');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sentenceWords = sentence => sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
const containsTarget = (sentence, target) => new RegExp(`(^|[^A-Za-z])${escapeRegExp(target)}(?=$|[^A-Za-z])`, 'iu').test(sentence);
const RECENT_SENTENCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function normalizeContextReviewSentence(value = {}) {
  const wordId = Number(value.wordId);
  const lemma = normalizeWord(value.lemma);
  const sentence = normalizeSpace(value.sentence);
  const targetForm = normalizeWord(value.targetForm || lemma);
  const translationZh = normalizeSpace(value.translationZh);
  const source = ['exam-passage', 'exam-question', 'article', 'example', 'ai', 'cache'].includes(value.source) ? value.source : 'cache';
  const senseIndex = Number.isInteger(Number(value.senseIndex)) && Number(value.senseIndex) >= 0
    ? Number(value.senseIndex)
    : null;
  const count = sentenceWords(sentence).length;

  if (!Number.isFinite(wordId) || wordId <= 0 || !lemma || !targetForm) return null;
  if (count < 7 || count > 30 || !containsTarget(sentence, targetForm)) return null;
  if (/\p{Script=Han}/u.test(sentence)) return null;

  return {
    wordId,
    lemma,
    sentence,
    targetForm,
    translationZh,
    senseIndex,
    source,
    ...(normalizeSpace(value.paperLabel) ? { paperLabel: normalizeSpace(value.paperLabel) } : {}),
    ...(normalizeSpace(value.positionLabel) ? { positionLabel: normalizeSpace(value.positionLabel) } : {}),
    ...(normalizeSpace(value.sourceUrl) ? { sourceUrl: normalizeSpace(value.sourceUrl) } : {}),
    ...(normalizeSpace(value.examTrack) ? { examTrack: normalizeSpace(value.examTrack) } : {}),
    ...(Number.isInteger(Number(value.year)) ? { year: Number(value.year) } : {})
  };
}

export function validateGeneratedContextReviewSentence(value = {}, requestedWord = {}) {
  const expectedId = Number(requestedWord.id ?? requestedWord.wordId);
  const expectedLemma = normalizeWord(requestedWord.word ?? requestedWord.lemma);
  const senseIndexes = new Set((Array.isArray(requestedWord.senses) ? requestedWord.senses : [])
    .map((sense, index) => Number.isInteger(Number(sense?.index)) ? Number(sense.index) : index));
  const senseIndex = Number(value.senseIndex);
  if (Number(value.wordId) !== expectedId || normalizeWord(value.lemma) !== expectedLemma) return null;
  if (normalizeWord(value.targetForm) !== expectedLemma) return null;
  if (!/\p{Script=Han}/u.test(normalizeSpace(value.translationZh))) return null;
  if (!Number.isInteger(senseIndex) || !senseIndexes.has(senseIndex)) return null;
  return normalizeContextReviewSentence({
    ...value,
    wordId: expectedId,
    lemma: expectedLemma,
    targetForm: expectedLemma,
    senseIndex,
    source: 'ai'
  });
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(normalizeSpace).filter(Boolean) || [];
}

function localCandidateFor(word, articles, examples, excludedSentences = new Set()) {
  const lemma = normalizeWord(word.word);
  for (const article of articles) {
    for (const sentence of splitSentences(article?.content)) {
      const candidate = normalizeContextReviewSentence({
        wordId: word.id,
        lemma,
        sentence,
        targetForm: lemma,
        source: 'article'
      });
      if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
    }
  }
  for (const sentence of examples) {
    const candidate = normalizeContextReviewSentence({
      wordId: word.id,
      lemma,
      sentence,
      targetForm: lemma,
      source: 'example'
    });
    if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
  }
  return null;
}

function examCandidateFor(word, rows, sourceKind, excludedSentences = new Set()) {
  const lemma = normalizeWord(word.word);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.sourceKind !== sourceKind) continue;
    const candidate = normalizeContextReviewSentence({
      wordId: word.id,
      lemma,
      sentence: row.sentenceEn,
      targetForm: row.targetForm || lemma,
      translationZh: row.translationZh,
      senseIndex: row.senseIndex,
      source: sourceKind === 'question' ? 'exam-question' : 'exam-passage',
      paperLabel: row.paperLabel,
      positionLabel: row.positionLabel,
      sourceUrl: row.sourceUrl,
      examTrack: row.examTrack,
      year: row.year
    });
    if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
  }
  return null;
}

export function createContextReviewService({
  examExamples = async () => [],
  articles = async () => [],
  examples = async () => [],
  generateBatch = async () => [],
  loadCached = async () => [],
  saveCached = async items => items,
  coordinator = null,
  recordReview = async () => null,
  now = () => Date.now()
} = {}) {
  return {
    async prepare({ words = [], limit = 10, targetTrack = '', signal = null } = {}) {
      const selected = (Array.isArray(words) ? words : []).slice(0, Math.max(0, Number(limit) || 0));
      if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      const [articleRows, cachedRows] = await Promise.all([articles(), loadCached({ targetTrack, words: selected })]);
      const preparedAt = now();
      const cached = new Map();
      for (const row of Array.isArray(cachedRows) ? cachedRows : []) {
        const normalized = normalizeContextReviewSentence(row);
        if (!normalized) continue;
        const items = cached.get(normalized.wordId) || [];
        items.push({
          ...normalized,
          key: row.key,
          targetTrack: row.targetTrack || '',
          lastUsedAt: Math.max(0, Number(row.lastUsedAt) || 0)
        });
        cached.set(normalized.wordId, items);
      }
      const byWordId = new Map();
      let questionStemCount = 0;

      for (const word of selected) {
        const candidates = cached.get(Number(word.id)) || [];
        const recentSentences = new Set(candidates
          .filter(item => item.lastUsedAt && preparedAt - item.lastUsedAt < RECENT_SENTENCE_COOLDOWN_MS)
          .map(item => normalizeSentenceKey(item.sentence)));
        const examRows = await examExamples(normalizeWord(word.word), targetTrack);
        const examPassage = examCandidateFor(word, examRows, 'passage', recentSentences);
        if (examPassage) {
          byWordId.set(Number(word.id), examPassage);
          continue;
        }
        const exampleRows = await examples(normalizeWord(word.word));
        const local = localCandidateFor(word, articleRows, exampleRows, recentSentences);
        if (local) {
          byWordId.set(Number(word.id), local);
          continue;
        }
        if (questionStemCount < 2) {
          const examQuestion = examCandidateFor(word, examRows, 'question', recentSentences);
          if (examQuestion) {
            byWordId.set(Number(word.id), examQuestion);
            questionStemCount += 1;
            continue;
          }
        }
        const cachedItem = candidates.find(item => item.targetTrack === targetTrack && !recentSentences.has(normalizeSentenceKey(item.sentence)))
          || candidates.find(item => !recentSentences.has(normalizeSentenceKey(item.sentence)));
        if (cachedItem) byWordId.set(Number(word.id), cachedItem);
      }

      const missing = selected.filter(word => !byWordId.has(Number(word.id)));
      if (missing.length) {
        const generated = await generateBatch(missing, { targetTrack, signal });
        for (const row of Array.isArray(generated) ? generated : []) {
          const normalized = normalizeContextReviewSentence(row);
          if (normalized && missing.some(word => Number(word.id) === normalized.wordId)) {
            byWordId.set(normalized.wordId, normalized);
          }
        }
      }

      // Reuse a recent sentence only as an offline/error fallback.  This keeps
      // short relearning steps usable without making the learner see the same
      // sentence again whenever a fresh local or generated candidate exists.
      for (const word of selected) {
        const wordId = Number(word.id);
        if (byWordId.has(wordId)) continue;
        const candidates = cached.get(wordId) || [];
        const fallback = candidates.find(item => item.targetTrack === targetTrack) || candidates[0];
        if (fallback) byWordId.set(wordId, fallback);
      }

      const items = selected.map(word => {
        const sentence = byWordId.get(Number(word.id));
        return sentence ? {
          ...sentence,
          targetTrack,
          expectedRevision: Math.max(0, Math.trunc(Number(word.reviewRevision) || 0)),
          word: { ...word }
        } : null;
      }).filter(Boolean);
      if (items.length) await saveCached(items);
      return {
        id: `context-review:${now()}`,
        targetTrack,
        createdAt: now(),
        requestedCount: selected.length,
        missingCount: Math.max(0, selected.length - items.length),
        items
      };
    },

    async submit({ item, result, assistedLookupCount = 0 } = {}) {
      if (!item || result === 'skipped') return { accepted: false, reason: 'skipped' };
      if (coordinator) {
        const checked = await coordinator.revalidate({ id: item.wordId, expectedRevision: item.expectedRevision });
        if (!checked.current) return { accepted: false, reason: checked.reason };
        item = { ...item, word: checked.word };
      }
      const schedule = scheduleContextReview(item.word || {}, result, now());
      if (!schedule) return { accepted: false, reason: 'skipped' };
      const updatedWord = await recordReview({ item, result, schedule, assistedLookupCount });
      return { accepted: true, word: updatedWord || { ...(item.word || {}), ...schedule }, schedule };
    }
  };
}
