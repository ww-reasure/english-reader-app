import { scheduleContextReview } from '../context-review-scheduler.mjs';
import { resolveContextDifficultyProfile } from '../difficulty-profile.mjs';
import { isSelectableTrack } from '../learning-track.mjs';

const normalizeWord = value => String(value || '').trim().toLocaleLowerCase('en-US');
const normalizeSpace = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeSentenceKey = value => normalizeSpace(value).toLocaleLowerCase('en-US');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sentenceWords = sentence => sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
const containsTarget = (sentence, target) => new RegExp(`(^|[^A-Za-z])${escapeRegExp(target)}(?=$|[^A-Za-z])`, 'iu').test(sentence);
const RECENT_SENTENCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const VALID_DIFFICULTY_STATUSES = new Set(['authentic', 'profiled', 'offline-fallback']);
const subordinateMarkerPattern = /\b(?:although|because|if|since|that|unless|when|where|whereas|whether|which|while|who|whom|whose)\b/giu;
const passiveMarkerPattern = /\b(?:am|are|be|been|being|get|gets|got|is|was|were)\s+[a-z]+(?:ed|en)\b/giu;
const nonFiniteMarkerPattern = /\b(?:to\s+[a-z]+|[a-z]+ing)\b/giu;

const markerCount = (sentence, pattern) => (String(sentence || '').match(pattern) || []).length;
const isSingleSentence = sentence => splitSentences(sentence).length === 1;

function matchesContextSyntaxCaps(sentence, profile) {
  const caps = profile?.syntaxCaps;
  if (!caps) return true;
  return markerCount(sentence, subordinateMarkerPattern) <= caps.subordinateMarkers
    && markerCount(sentence, passiveMarkerPattern) <= caps.passiveMarkers
    && markerCount(sentence, nonFiniteMarkerPattern) <= caps.nonFiniteMarkers;
}

function normalizeDifficultyMetadata(value = {}) {
  const difficultyStatus = VALID_DIFFICULTY_STATUSES.has(value.difficultyStatus)
    ? value.difficultyStatus
    : '';
  const difficultyProfileKey = normalizeSpace(value.difficultyProfileKey);
  const originalDifficultyProfileKey = normalizeSpace(value.originalDifficultyProfileKey);
  return {
    ...(difficultyStatus ? { difficultyStatus } : {}),
    ...(difficultyProfileKey ? { difficultyProfileKey } : {}),
    ...(originalDifficultyProfileKey ? { originalDifficultyProfileKey } : {})
  };
}

export function normalizeContextReviewSentence(value = {}, difficultyProfile = null) {
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
  const range = difficultyProfile?.sentenceRange || { min: 7, max: 30 };
  if (count < range.min || count > range.max || !containsTarget(sentence, targetForm)) return null;
  if (/\p{Script=Han}/u.test(sentence)) return null;
  if (!isSingleSentence(sentence) || !matchesContextSyntaxCaps(sentence, difficultyProfile)) return null;

  return {
    wordId,
    lemma,
    sentence,
    targetForm,
    translationZh,
    senseIndex,
    source,
    ...normalizeDifficultyMetadata(value),
    ...(normalizeSpace(value.paperLabel) ? { paperLabel: normalizeSpace(value.paperLabel) } : {}),
    ...(normalizeSpace(value.positionLabel) ? { positionLabel: normalizeSpace(value.positionLabel) } : {}),
    ...(normalizeSpace(value.sourceUrl) ? { sourceUrl: normalizeSpace(value.sourceUrl) } : {}),
    ...(normalizeSpace(value.sourceTrack) ? { sourceTrack: normalizeSpace(value.sourceTrack) } : {}),
    ...(normalizeSpace(value.targetTrack) ? { targetTrack: normalizeSpace(value.targetTrack) } : {}),
    ...(normalizeSpace(value.examTrack) ? { examTrack: normalizeSpace(value.examTrack) } : {}),
    ...(Number.isInteger(Number(value.year)) ? { year: Number(value.year) } : {})
  };
}

export function validateGeneratedContextReviewSentence(value = {}, requestedWord = {}, difficultyProfile = null) {
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
    source: 'ai',
    difficultyProfileKey: difficultyProfile?.key || value.difficultyProfileKey,
    difficultyStatus: 'profiled'
  }, difficultyProfile);
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(normalizeSpace).filter(Boolean) || [];
}

function articleMatchesProfile(article, difficultyProfile, sourceTrack) {
  if (!article || !difficultyProfile) return false;
  const articleTrack = normalizeWord(article.sourceTrack || article.targetTrack || article.difficulty);
  const articleChallenge = normalizeWord(article.challenge);
  if (articleTrack !== sourceTrack || !articleChallenge) return false;
  return resolveContextDifficultyProfile(articleChallenge, article.coverage).key === difficultyProfile.key;
}

function localCandidateFor(word, articles, examples, sourceTrack, difficultyProfile, excludedSentences = new Set()) {
  const lemma = normalizeWord(word.word);
  for (const article of articles) {
    if (!articleMatchesProfile(article, difficultyProfile, sourceTrack)) continue;
    for (const sentence of splitSentences(article?.content)) {
      const candidate = normalizeContextReviewSentence({
        wordId: word.id,
        lemma,
        sentence,
        targetForm: lemma,
        source: 'article',
        difficultyProfileKey: difficultyProfile.key,
        difficultyStatus: 'profiled'
      }, difficultyProfile);
      if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
    }
  }
  for (const example of examples) {
    const exampleTrack = normalizeWord(example?.sourceTrack || example?.targetTrack);
    if (!example || typeof example !== 'object' || exampleTrack !== sourceTrack || example.difficultyProfileKey !== difficultyProfile?.key) continue;
    const candidate = normalizeContextReviewSentence({
      wordId: word.id,
      lemma,
      sentence: example.sentence,
      targetForm: lemma,
      source: 'example',
      difficultyProfileKey: difficultyProfile.key,
      difficultyStatus: 'profiled'
    }, difficultyProfile);
    if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
  }
  return null;
}

function examCandidateFor(word, rows, sourceKind, sourceTrack, excludedSentences = new Set()) {
  const lemma = normalizeWord(word.word);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.sourceKind !== sourceKind) continue;
    if (normalizeWord(row?.examTrack) !== sourceTrack) continue;
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
      sourceTrack,
      targetTrack: sourceTrack,
      examTrack: row.examTrack,
      year: row.year,
      difficultyStatus: 'authentic',
      difficultyProfileKey: `authentic-v1:${sourceTrack}`
    });
    if (candidate && !excludedSentences.has(normalizeSentenceKey(candidate.sentence))) return candidate;
  }
  return null;
}

function candidateSourceTrack(item) {
  return normalizeWord(item?.sourceTrack || item?.targetTrack || item?.examTrack);
}

function isSameSourceTrack(item, sourceTrack) {
  return candidateSourceTrack(item) === sourceTrack;
}

function isAuthenticCandidate(item, sourceTrack) {
  return item?.difficultyStatus === 'authentic'
    && isSameSourceTrack(item, sourceTrack)
    && normalizeWord(item?.examTrack) === sourceTrack
    && ['exam-passage', 'exam-question'].includes(item?.source);
}

function isExactProfileCandidate(item, sourceTrack, difficultyProfile) {
  if (!item || !isSameSourceTrack(item, sourceTrack)) return false;
  if (isAuthenticCandidate(item, sourceTrack)) return true;
  if (item.difficultyStatus !== 'profiled' || item.difficultyProfileKey !== difficultyProfile.key) return false;
  return Boolean(normalizeContextReviewSentence(item, difficultyProfile));
}

function asOfflineFallback(item, sourceTrack) {
  return {
    ...item,
    source: 'cache',
    sourceTrack,
    targetTrack: sourceTrack,
    difficultyStatus: 'offline-fallback',
    originalDifficultyProfileKey: item?.difficultyProfileKey || ''
  };
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
    async prepare({ words = [], limit = 10, sourceTrack = '', targetTrack = '', challenge = 'standard', coverage = undefined, signal = null } = {}) {
      const selected = (Array.isArray(words) ? words : []).slice(0, Math.max(0, Number(limit) || 0));
      if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      const resolvedSourceTrack = normalizeWord(sourceTrack || targetTrack);
      if (!isSelectableTrack(resolvedSourceTrack)) {
        return {
          id: `context-review:${now()}`,
          sourceTrack: '',
          targetTrack: '',
          targetSelectionRequired: true,
          createdAt: now(),
          requestedCount: selected.length,
          missingCount: selected.length,
          items: []
        };
      }
      const difficultyProfile = resolveContextDifficultyProfile(challenge, coverage);
      const [articleRows, cachedRows] = await Promise.all([
        articles(),
        loadCached({ sourceTrack: resolvedSourceTrack, targetTrack: resolvedSourceTrack, difficultyProfile, words: selected })
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
          sourceTrack: normalizeWord(row.sourceTrack || row.targetTrack || normalized.examTrack),
          targetTrack: normalizeWord(row.sourceTrack || row.targetTrack || normalized.examTrack),
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
        const examRows = await examExamples(normalizeWord(word.word), resolvedSourceTrack);
        const examPassage = examCandidateFor(word, examRows, 'passage', resolvedSourceTrack, recentSentences);
        if (examPassage) {
          byWordId.set(Number(word.id), examPassage);
          continue;
        }
        if (questionStemCount < 2) {
          const examQuestion = examCandidateFor(word, examRows, 'question', resolvedSourceTrack, recentSentences);
          if (examQuestion) {
            byWordId.set(Number(word.id), examQuestion);
            questionStemCount += 1;
            continue;
          }
        }
        const cachedItem = candidates.find(item => isExactProfileCandidate(item, resolvedSourceTrack, difficultyProfile)
          && !recentSentences.has(normalizeSentenceKey(item.sentence)));
        if (cachedItem) byWordId.set(Number(word.id), cachedItem);
        if (cachedItem) continue;
        const exampleRows = await examples(normalizeWord(word.word));
        const local = localCandidateFor(word, articleRows, exampleRows, resolvedSourceTrack, difficultyProfile, recentSentences);
        if (local) byWordId.set(Number(word.id), local);
      }

      const missing = selected.filter(word => !byWordId.has(Number(word.id)));
      let generationFailed = false;
      if (missing.length) {
        let generated = [];
        try {
          generated = await generateBatch(missing, {
            sourceTrack: resolvedSourceTrack,
            targetTrack: resolvedSourceTrack,
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
          const normalized = normalizeContextReviewSentence({
            ...row,
            source: 'ai',
            difficultyProfileKey: difficultyProfile.key,
            difficultyStatus: 'profiled'
          }, difficultyProfile);
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
        const fallback = candidates.find(item => isSameSourceTrack(item, resolvedSourceTrack));
        if (fallback) byWordId.set(wordId, asOfflineFallback(fallback, resolvedSourceTrack));
      }

      const items = selected.map(word => {
        const sentence = byWordId.get(Number(word.id));
        return sentence ? {
          ...sentence,
          sourceTrack: resolvedSourceTrack,
          targetTrack: resolvedSourceTrack,
          challenge: difficultyProfile.challenge,
          coverage: difficultyProfile.coverage,
          expectedRevision: Math.max(0, Math.trunc(Number(word.reviewRevision) || 0)),
          word: { ...word }
        } : null;
      }).filter(Boolean);
      if (items.length) await saveCached(items);
      return {
        id: `context-review:${now()}`,
        sourceTrack: resolvedSourceTrack,
        targetTrack: resolvedSourceTrack,
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

    async submit({ item, result, assistedLookupCount = 0, validate = true } = {}) {
      if (!item || result === 'skipped') return { accepted: false, reason: 'skipped' };
      if (coordinator && validate) {
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
