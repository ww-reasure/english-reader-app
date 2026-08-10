import { scheduleContextReview } from '../context-review-scheduler.mjs';
import { getDifficultyProfile, normalizeCoveragePreference } from '../difficulty-profile.mjs';

const normalizeWord = value => String(value || '').trim().toLocaleLowerCase('en-US');
const normalizeSpace = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeSentenceKey = value => normalizeSpace(value).toLocaleLowerCase('en-US');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sentenceWords = sentence => sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
const containsTarget = (sentence, target) => new RegExp(`(^|[^A-Za-z])${escapeRegExp(target)}(?=$|[^A-Za-z])`, 'iu').test(sentence);
const RECENT_SENTENCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CONTEXT_CACHE_VERSION = 2;

function resolveContextDifficultyProfile(targetTrack = '', challenge = 'standard', coverage) {
  const materialProfile = getDifficultyProfile(normalizeWord(targetTrack) || 'cet4', challenge);
  const coveragePreference = normalizeCoveragePreference(materialProfile.challenge, coverage);
  return {
    track: materialProfile.track,
    challenge: coveragePreference.challenge,
    coverage: coveragePreference.coverage,
    key: `context-v${CONTEXT_CACHE_VERSION}:${materialProfile.track}:${coveragePreference.challenge}:c${coveragePreference.coverage}`
  };
}

export function makeContextReviewCacheKey(item = {}) {
  return `context-v${CONTEXT_CACHE_VERSION}:${Number(item.wordId) || 0}:${normalizeSpace(item.difficultyProfileKey)}:${normalizeSentenceKey(item.sentence)}`;
}

function withProfile(item, difficultyProfile, source = item?.source) {
  return {
    ...item,
    source,
    sourceTrack: normalizeWord(item?.sourceTrack || item?.targetTrack || difficultyProfile.track),
    targetTrack: difficultyProfile.track,
    difficultyProfileKey: difficultyProfile.key,
    difficultyStatus: 'profiled'
  };
}

function matchesProfile(item, difficultyProfile) {
  return normalizeWord(item?.sourceTrack || item?.targetTrack) === difficultyProfile.track
    && normalizeSpace(item?.difficultyProfileKey) === difficultyProfile.key;
}

function asOfflineFallback(item, difficultyProfile) {
  return {
    ...item,
    source: 'cache',
    sourceTrack: difficultyProfile.track,
    targetTrack: difficultyProfile.track,
    difficultyStatus: 'offline-fallback',
    originalDifficultyProfileKey: item?.difficultyProfileKey || ''
  };
}

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
    ...(normalizeSpace(value.sourceTrack) ? { sourceTrack: normalizeSpace(value.sourceTrack) } : {}),
    ...(normalizeSpace(value.targetTrack) ? { targetTrack: normalizeSpace(value.targetTrack) } : {}),
    ...(normalizeSpace(value.difficultyProfileKey) ? { difficultyProfileKey: normalizeSpace(value.difficultyProfileKey) } : {}),
    ...(normalizeSpace(value.difficultyStatus) ? { difficultyStatus: normalizeSpace(value.difficultyStatus) } : {}),
    ...(normalizeSpace(value.originalDifficultyProfileKey) ? { originalDifficultyProfileKey: normalizeSpace(value.originalDifficultyProfileKey) } : {}),
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

function localCandidateFor(word, articles, examples, difficultyProfile, excludedSentences = new Set()) {
  const lemma = normalizeWord(word.word);
  for (const article of articles) {
    const declaredTrack = normalizeWord(article?.sourceTrack || article?.targetTrack || article?.difficulty);
    const declaredChallenge = normalizeWord(article?.challenge);
    if ((declaredTrack && declaredTrack !== difficultyProfile.track)
      || (declaredChallenge && declaredChallenge !== difficultyProfile.challenge)) continue;
    for (const sentence of splitSentences(article?.content)) {
      const candidate = normalizeContextReviewSentence(withProfile({
        wordId: word.id,
        lemma,
        sentence,
        targetForm: lemma,
        source: 'article'
      }, difficultyProfile));
      if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
    }
  }
  for (const example of examples) {
    const sentence = typeof example === 'string' ? example : example?.sentence;
    const declaredTrack = normalizeWord(example?.sourceTrack || example?.targetTrack);
    const declaredProfile = normalizeSpace(example?.difficultyProfileKey);
    if ((declaredTrack && declaredTrack !== difficultyProfile.track)
      || (declaredProfile && declaredProfile !== difficultyProfile.key)) continue;
    const candidate = normalizeContextReviewSentence(withProfile({
      wordId: word.id,
      lemma,
      sentence,
      targetForm: lemma,
      source: 'example'
    }, difficultyProfile));
    if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
  }
  return null;
}

function examCandidateFor(word, rows, sourceKind, targetTrack, excludedSentences = new Set()) {
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
      sourceTrack: targetTrack,
      targetTrack,
      difficultyStatus: 'authentic',
      difficultyProfileKey: `authentic-v1:${targetTrack}`,
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
    async prepare({ words = [], limit = 10, targetTrack = '', challenge = 'standard', coverage = undefined, signal = null } = {}) {
      const selected = (Array.isArray(words) ? words : []).slice(0, Math.max(0, Number(limit) || 0));
      if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      const difficultyProfile = resolveContextDifficultyProfile(targetTrack, challenge, coverage);
      const [articleRows, cachedRows] = await Promise.all([
        articles(),
        loadCached({ targetTrack: difficultyProfile.track, sourceTrack: difficultyProfile.track, difficultyProfile, words: selected })
      ]);
      const preparedAt = now();
      const cached = new Map();
      for (const row of Array.isArray(cachedRows) ? cachedRows : []) {
        const normalized = normalizeContextReviewSentence(row);
        if (!normalized) continue;
        const items = cached.get(normalized.wordId) || [];
        items.push({
          ...normalized,
          key: row.key,
          sourceTrack: normalizeWord(row.sourceTrack || row.targetTrack),
          targetTrack: normalizeWord(row.targetTrack || row.sourceTrack),
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
        const examRows = await examExamples(normalizeWord(word.word), difficultyProfile.track);
        const examPassage = examCandidateFor(word, examRows, 'passage', difficultyProfile.track, recentSentences);
        if (examPassage) {
          byWordId.set(Number(word.id), examPassage);
          continue;
        }
        const exactCached = candidates.find(item => matchesProfile(item, difficultyProfile)
          && !recentSentences.has(normalizeSentenceKey(item.sentence)));
        if (exactCached) {
          byWordId.set(Number(word.id), exactCached);
          continue;
        }
        const exampleRows = await examples(normalizeWord(word.word));
        const local = localCandidateFor(word, articleRows, exampleRows, difficultyProfile, recentSentences);
        if (local) {
          byWordId.set(Number(word.id), local);
          continue;
        }
        if (questionStemCount < 2) {
          const examQuestion = examCandidateFor(word, examRows, 'question', difficultyProfile.track, recentSentences);
          if (examQuestion) {
            byWordId.set(Number(word.id), examQuestion);
            questionStemCount += 1;
            continue;
          }
        }
      }

      const missing = selected.filter(word => !byWordId.has(Number(word.id)));
      let generationFailed = false;
      if (missing.length) {
        let generated = [];
        try {
          generated = await generateBatch(missing, {
            targetTrack: difficultyProfile.track,
            sourceTrack: difficultyProfile.track,
            challenge: difficultyProfile.challenge,
            coverage: difficultyProfile.coverage,
            difficultyProfile,
            signal
          });
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          generationFailed = true;
        }
        for (const row of Array.isArray(generated) ? generated : []) {
          const normalized = normalizeContextReviewSentence(withProfile({ ...row, source: 'ai' }, difficultyProfile));
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
        // Older cached rows predate explicit track/profile metadata. They are
        // never a preferred match, but remain an honest offline fallback for
        // the learner's current session. Explicitly profiled rows must still
        // match the requested track so profiles never leak into one another.
        const fallback = candidates.find(item => {
          const cachedTrack = normalizeWord(item.sourceTrack || item.targetTrack);
          return !cachedTrack || cachedTrack === difficultyProfile.track;
        });
        if (fallback) byWordId.set(wordId, asOfflineFallback(fallback, difficultyProfile));
      }

      const items = selected.map(word => {
        const sentence = byWordId.get(Number(word.id));
        return sentence ? {
          ...sentence,
          sourceTrack: difficultyProfile.track,
          targetTrack: difficultyProfile.track,
          challenge: difficultyProfile.challenge,
          coverage: difficultyProfile.coverage,
          expectedRevision: Math.max(0, Math.trunc(Number(word.reviewRevision) || 0)),
          word: { ...word }
        } : null;
      }).filter(Boolean);
      const persistable = items.filter(item => item.difficultyStatus !== 'offline-fallback');
      if (persistable.length) await saveCached(persistable);
      return {
        id: `context-review:${now()}`,
        sourceTrack: difficultyProfile.track,
        targetTrack: difficultyProfile.track,
        challenge: difficultyProfile.challenge,
        coverage: difficultyProfile.coverage,
        difficultyProfileKey: difficultyProfile.key,
        createdAt: now(),
        requestedCount: selected.length,
        missingCount: Math.max(0, selected.length - items.length),
        generationFailed,
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
