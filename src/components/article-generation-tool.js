import { normalizeGenerationRequest, validateArticle } from '../difficulty-profile.mjs';

const DIFFICULTIES = new Set(['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'graduate']);
export const MAX_TARGET_WORDS = 8;
const CHINESE_TEXT = /[\u3400-\u9fff]/u;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’'-][A-Za-z]+)*/g;

const clip = (value, limit) => String(value || '').trim().slice(0, limit);
const cancelled = () => new Error('请求已取消');
const scheduleWhenIdle = callback => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => callback(), { timeout: 2500 });
    return;
  }
  setTimeout(callback, 0);
};

export const ARTICLE_GENERATION_PROGRESS = Object.freeze({
  DRAFTING: 'drafting',
  CHECKING: 'checking',
  REFINING: 'refining'
});

const assertActive = ({ signal, isActive }) => {
  if (signal?.aborted || !isActive()) throw cancelled();
};

const challengeFromLegacyLevel = level => level === 'easy' ? 'support' : level === 'hard' ? 'stretch' : 'standard';

const normalizeLimit = (limit, fallback) => {
  if (limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(limit, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const toFiniteNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const rangeFrom = (range, fallback = {}) => {
  const min = toFiniteNumber(range?.min ?? fallback.min);
  const max = toFiniteNumber(range?.max ?? fallback.max);
  return min === null || max === null ? null : { min, max };
};

const deviationFor = (validation, code) => (validation?.deviations || []).find(item => item?.code === code);

const expectedRangeFor = (validation, profile, code) => {
  const fallback = code === 'word_count' ? profile?.wordRange : profile?.sentenceRange;
  return rangeFrom(deviationFor(validation, code)?.expected, fallback);
};

const metricFor = (validation, code) => {
  const metric = code === 'word_count'
    ? validation?.metrics?.wordCount
    : validation?.metrics?.averageSentenceLength;
  return toFiniteNumber(metric ?? deviationFor(validation, code)?.actual);
};

const formatNumber = value => value === null ? '未知' : String(value);

const formatRange = range => range ? `${range.min}-${range.max}` : '目标范围未知';

const uniqueWords = words => {
  const selected = [];
  const seen = new Set();
  for (const value of Array.isArray(words) ? words : []) {
    const word = clip(value, 80);
    const key = word.toLowerCase();
    if (word && !seen.has(key)) {
      seen.add(key);
      selected.push(word);
    }
  }
  return selected;
};

const countWords = value => (String(value || '').match(ENGLISH_WORD_PATTERN) || []).length;
const countSentences = value => String(value || '').split(/[.!?]+/).filter(part => countWords(part) > 0).length;
const containsChinese = value => CHINESE_TEXT.test(String(value || ''));
const containsEnglish = value => /[A-Za-z]/.test(String(value || ''));
const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordOccurs = (content, word) => new RegExp(`(^|[^A-Za-z])${escapeRegExp(word)}(?=$|[^A-Za-z])`, 'i').test(String(content || ''));

/**
 * Fast, deterministic admission gate.  It deliberately checks only whether a
 * card is usable; deep lexical and grammar analysis runs after the card exists.
 */
export function admitArticle(article = {}, { targetWordCount, reviewWords = [] } = {}) {
  const title = clip(article.title, 240);
  const titleZh = clip(article.titleZh, 240);
  const content = String(article.content || '').trim();
  const translation = String(article.translation || '').trim();
  const wordCount = countWords(content);
  const sentenceCount = countSentences(content);
  const target = Number.parseInt(targetWordCount, 10);
  const acceptanceRange = Number.isFinite(target) && target > 0
    ? { min: Math.ceil(target * 0.7), max: Math.floor(target * 1.4) }
    : null;
  const normalizedReviewWords = normalizeTargetWords(reviewWords, Number.POSITIVE_INFINITY);
  const missingReviewWords = normalizedReviewWords.filter(word => !wordOccurs(content, word));
  const deviations = [];

  if (!containsEnglish(title)) deviations.push({ code: 'title' });
  if (!containsChinese(titleZh)) deviations.push({ code: 'title_zh' });
  if (!content || !containsEnglish(content)) deviations.push({ code: 'content' });
  if (!translation || !containsChinese(translation)) deviations.push({ code: 'translation' });
  if (sentenceCount < 3) deviations.push({ code: 'sentence_count', actual: sentenceCount, expected: { min: 3, max: Number.POSITIVE_INFINITY } });
  if (acceptanceRange && (wordCount < acceptanceRange.min || wordCount > acceptanceRange.max)) {
    deviations.push({ code: 'word_count', actual: wordCount, expected: acceptanceRange });
  }
  missingReviewWords.forEach(word => deviations.push({ code: 'review_word', word }));

  return {
    passed: deviations.length === 0,
    metrics: { wordCount, sentenceCount, acceptanceRange },
    deviations,
    missingReviewWords
  };
}

export function formatAdmissionCorrection(admission = {}) {
  const codes = new Set((admission.deviations || []).map(item => item?.code));
  const parts = ['上次文章未达到可保存条件。请重新完整输出文章 JSON，不要解释。'];
  if (codes.has('title')) parts.push('- 英文标题不能为空。');
  if (codes.has('title_zh')) parts.push('- titleZh 必须是自然中文标题。');
  if (codes.has('content')) parts.push('- content 必须是完整英文正文。');
  if (codes.has('translation')) parts.push('- translation 必须是完整中文翻译。');
  if (codes.has('sentence_count')) parts.push('- 正文至少写成 3 个完整英文句子。');
  const wordCount = admission.metrics?.wordCount;
  const range = admission.metrics?.acceptanceRange;
  if (codes.has('word_count') && range) parts.push(`- 正文实际 ${wordCount} 词，请控制在 ${range.min}-${range.max} 词。`);
  if (admission.missingReviewWords?.length) parts.push(`- 必须自然包含复习词：${admission.missingReviewWords.join(', ')}。`);
  return parts.join('\n');
}

export function formatAdmissionSummary(admission = {}) {
  const codes = new Set((admission.deviations || []).map(item => item?.code));
  const details = [];
  if (codes.has('content') || codes.has('sentence_count')) details.push('英文正文不完整');
  if (codes.has('title') || codes.has('title_zh') || codes.has('translation')) details.push('标题或中文翻译不完整');
  if (codes.has('word_count')) {
    const range = admission.metrics?.acceptanceRange;
    details.push(range ? `篇幅为 ${admission.metrics?.wordCount || 0} 词（允许 ${range.min}-${range.max} 词）` : '篇幅明显异常');
  }
  if (admission.missingReviewWords?.length) details.push(`缺少复习词：${admission.missingReviewWords.join(', ')}`);
  return `文章内容未达到可保存条件：${details.join('；') || '内容不完整'}。已自动重试一次，请重新生成。`;
}

export class ArticleAdmissionError extends Error {
  constructor({ admission, attempts = [] } = {}) {
    const summary = formatAdmissionSummary(admission);
    super(summary);
    this.name = 'ArticleAdmissionError';
    this.code = 'ARTICLE_ADMISSION_FAILED';
    this.summary = summary;
    this.admission = {
      passed: Boolean(admission?.passed),
      metrics: admission?.metrics || {},
      deviations: Array.isArray(admission?.deviations) ? admission.deviations : [],
      missingReviewWords: Array.isArray(admission?.missingReviewWords) ? admission.missingReviewWords : []
    };
    this.attemptCount = attempts.length;
  }
}

const missingTargetWords = (validation, targetWords = []) => {
  const labels = new Map(uniqueWords(targetWords).map(word => [word.toLowerCase(), word]));
  const missing = new Set();
  for (const [word, count] of Object.entries(validation?.metrics?.targetWordCounts || {})) {
    if (toFiniteNumber(count) === 0) missing.add(String(word).toLowerCase());
  }
  for (const deviation of validation?.deviations || []) {
    if (deviation?.code === 'target_word' && deviation.word) missing.add(String(deviation.word).toLowerCase());
  }
  return [...missing].map(word => labels.get(word) || clip(word, 80)).filter(Boolean);
};

const safeRange = range => {
  const normalized = rangeFrom(range);
  return normalized || undefined;
};

const safeProfile = profile => {
  const selected = {};
  const track = clip(profile?.track, 32);
  const challenge = clip(profile?.challenge, 32);
  if (track) selected.track = track;
  if (challenge) selected.challenge = challenge;
  const wordRange = safeRange(profile?.wordRange);
  const sentenceRange = safeRange(profile?.sentenceRange);
  if (wordRange) selected.wordRange = wordRange;
  if (sentenceRange) selected.sentenceRange = sentenceRange;
  return selected;
};

const safeMetricGroup = (value, keys) => {
  const source = value && typeof value === 'object' ? value : {};
  const selected = {};
  for (const key of keys) {
    const number = toFiniteNumber(source[key]);
    if (number !== null) selected[key] = number;
  }
  return selected;
};

const safeStatus = value => {
  const normalized = clip(value, 48);
  return /^[a-z_]+$/i.test(normalized) ? normalized : '';
};

const safeAnalysisSource = value => value === 'ai_fallback' ? 'ai_fallback' : value === 'local' ? 'local' : '';

const safeDeviationReason = value => {
  const normalized = clip(value, 80).toUpperCase();
  return /^[A-Z0-9_:-]+$/.test(normalized) ? normalized : '';
};

const safeValidation = (validation, fallbackProfile) => {
  const metrics = validation?.metrics || {};
  const safeMetrics = {};
  for (const key of ['wordCount', 'sentenceCount', 'averageSentenceLength']) {
    const value = toFiniteNumber(metrics[key]);
    if (value !== null) safeMetrics[key] = value;
  }
  const targetWordCounts = Object.fromEntries(
    Object.entries(metrics.targetWordCounts || {})
      .map(([word, count]) => [clip(word, 80), toFiniteNumber(count)])
      .filter(([word, count]) => word && count !== null)
  );
  if (Object.keys(targetWordCounts).length) safeMetrics.targetWordCounts = targetWordCounts;

  const lexicon = safeMetricGroup(metrics.lexicon || validation?.lexiconProfile?.metrics, [
    'tokenCount', 'knownLexiconTokenCount', 'unknownTokenCount', 'unbandedTokenCount', 'unverifiedTokenCount'
  ]);
  if (Object.keys(lexicon).length) safeMetrics.lexicon = lexicon;

  const grammar = safeMetricGroup(metrics.grammar || validation?.grammarReport?.metrics, [
    'tokenCount', 'sentenceCount', 'clauseRelationCount', 'passivePredicateCount', 'nonFiniteRelationCount',
    'maxDependencyDepth', 'subordinateRate', 'passiveRate', 'nonFiniteRate'
  ]);
  const grammarSource = safeAnalysisSource(validation?.grammarReport?.source);
  if (grammarSource) grammar.source = grammarSource;
  if (Object.keys(grammar).length) safeMetrics.grammar = grammar;

  const personalFit = safeMetricGroup(metrics.personalFit || validation?.personalFit?.metrics, [
    'tokenCount', 'expectedKnownTokenCount', 'estimatedCoverage', 'confidence', 'targetCoverage',
    'traceableCoreCoveragePercent', 'foundationCoveragePercent', 'upperFrequencyCoveragePercent',
    'minTraceableCoreCoveragePercent', 'minFoundationCoveragePercent', 'maxUpperFrequencyCoveragePercent'
  ]);
  const personalStatus = safeStatus(validation?.personalFit?.status);
  if (personalStatus) personalFit.status = personalStatus;
  if (Object.keys(personalFit).length) safeMetrics.personalFit = personalFit;

  const deviations = (Array.isArray(validation?.deviations) ? validation.deviations : []).map(item => {
    const selected = { code: clip(item?.code, 64) || 'unknown' };
    const word = clip(item?.word, 80);
    const actual = toFiniteNumber(item?.actual ?? item?.value);
    const expected = safeRange(item?.expected);
    const reason = safeDeviationReason(item?.reason);
    const source = safeAnalysisSource(item?.source);
    if (word) selected.word = word;
    if (actual !== null) selected.actual = actual;
    if (expected) selected.expected = expected;
    if (reason) selected.reason = reason;
    if (source) selected.source = source;
    return selected;
  });

  return {
    passed: Boolean(validation?.passed),
    metrics: safeMetrics,
    deviations,
    profile: safeProfile(validation?.profile || fallbackProfile)
  };
};

export function formatValidationCorrection(validation, profile, targetWords = []) {
  const wordCount = metricFor(validation, 'word_count');
  const sentenceLength = metricFor(validation, 'sentence_length');
  const wordRange = expectedRangeFor(validation, profile, 'word_count');
  const sentenceRange = expectedRangeFor(validation, profile, 'sentence_length');
  const missing = missingTargetWords(validation, targetWords);
  const codes = [...new Set((validation?.deviations || []).map(item => clip(item?.code, 64)).filter(Boolean))];
  const lexicon = validation?.metrics?.lexicon || validation?.lexiconProfile?.metrics || {};
  const unresolvedCount = ['unknownTokenCount', 'unbandedTokenCount', 'unverifiedTokenCount']
    .reduce((total, key) => total + (toFiniteNumber(lexicon[key]) || 0), 0);
  const dependencyDeviation = deviationFor(validation, 'dependency_depth');
  const dependencyDepth = toFiniteNumber(dependencyDeviation?.actual ?? dependencyDeviation?.value ?? validation?.metrics?.grammar?.maxDependencyDepth);
  const dependencyRange = rangeFrom(dependencyDeviation?.expected);
  const personal = validation?.metrics?.personalFit || validation?.personalFit?.metrics || {};
  const estimatedCoverage = toFiniteNumber(personal.estimatedCoverage ?? validation?.personalFit?.estimatedCoverage);
  const targetCoverage = toFiniteNumber(personal.targetCoverage ?? validation?.personalFit?.targetCoverage);
  const traceableCoreCoverage = toFiniteNumber(personal.traceableCoreCoveragePercent);
  const foundationCoverage = toFiniteNumber(personal.foundationCoveragePercent);
  const upperFrequencyCoverage = toFiniteNumber(personal.upperFrequencyCoveragePercent);

  return [
    '上次生成未通过难度校验。请保留主题，但完整重写文章并严格满足以下要求：',
    `- 实际总字数：${formatNumber(wordCount)} 词；要求：${formatRange(wordRange)} 词。`,
    `- 实际平均句长：${formatNumber(sentenceLength)} 词；要求：${formatRange(sentenceRange)} 词。`,
    `- 缺失目标词：${missing.length ? missing.join(', ') : '无'}。`,
    unresolvedCount > 0 ? `- 词汇校验：未分类或未验证词 ${unresolvedCount} 个。请优先改用常见核心词，避免罕见、专有或专业词。` : '',
    dependencyDepth !== null && dependencyRange ? `- 句法校验：依存深度 ${formatNumber(dependencyDepth)}，目标 ${formatRange(dependencyRange)}。请调整从句和修饰链，使句法复杂度落入范围。` : '',
    estimatedCoverage !== null && targetCoverage !== null ? `- 个人匹配：预计掌握覆盖 ${formatNumber(estimatedCoverage)}%，目标至少 ${formatNumber(targetCoverage)}%。请降低未掌握词比例。` : '',
    traceableCoreCoverage !== null && foundationCoverage !== null && upperFrequencyCoverage !== null
      ? `- 保守材料构成：可追溯核心词 ${formatNumber(traceableCoreCoverage)}%，基础 NGSL 1-3 词 ${formatNumber(foundationCoverage)}%，NGSL 4 及以上词 ${formatNumber(upperFrequencyCoverage)}%。请用更常见的基础词重写，不要把这些材料来源比例表述为学习者掌握率。`
      : '',
    codes.length ? `- 校验问题：${codes.join('、')}。` : '',
    '请只返回符合要求的文章 JSON。'
  ].filter(Boolean).join('\n');
}

export function formatValidationSummary(validation, profile, targetWords = []) {
  const wordCount = metricFor(validation, 'word_count');
  const sentenceLength = metricFor(validation, 'sentence_length');
  const wordRange = expectedRangeFor(validation, profile, 'word_count');
  const sentenceRange = expectedRangeFor(validation, profile, 'sentence_length');
  const missing = missingTargetWords(validation, targetWords);
  const personal = validation?.metrics?.personalFit || validation?.personalFit?.metrics || {};
  const conservativeMaterialCodes = new Set([
    'conservative_core_coverage',
    'conservative_foundation_coverage',
    'conservative_upper_frequency_coverage'
  ]);
  const hasConservativeMaterialDeviation = (validation?.deviations || [])
    .some(item => conservativeMaterialCodes.has(item?.code));
  const traceableCoreCoverage = toFiniteNumber(personal.traceableCoreCoveragePercent);
  const foundationCoverage = toFiniteNumber(personal.foundationCoveragePercent);
  const upperFrequencyCoverage = toFiniteNumber(personal.upperFrequencyCoveragePercent);
  const parts = [
    `字数为 ${formatNumber(wordCount)}（要求 ${formatRange(wordRange)} 词）`,
    `平均句长为 ${formatNumber(sentenceLength)}（要求 ${formatRange(sentenceRange)} 词）`
  ];
  if (missing.length) parts.push(`缺少目标词 ${missing.join(', ')}`);
  if (hasConservativeMaterialDeviation) {
    const materialDetails = [
      traceableCoreCoverage !== null ? `可追溯核心词 ${formatNumber(traceableCoreCoverage)}%` : '',
      foundationCoverage !== null ? `NGSL 1-3 ${formatNumber(foundationCoverage)}%` : '',
      upperFrequencyCoverage !== null ? `NGSL 4 及以上 ${formatNumber(upperFrequencyCoverage)}%` : ''
    ].filter(Boolean).join('、');
    parts.push(`可追溯基础词比例不符合保守材料要求${materialDetails ? `（${materialDetails}）` : ''}；这反映文章材料组成，不代表你的词汇掌握率`);
  }
  return `文章未通过难度校验：${parts.join('；')}。请重新生成。`;
}

export class ArticleValidationError extends Error {
  constructor({ validation, attempts = [], profile, targetWords = [] } = {}) {
    const summary = formatValidationSummary(validation, profile, targetWords);
    super(summary);
    this.name = 'ArticleValidationError';
    this.code = 'ARTICLE_VALIDATION_FAILED';
    this.summary = summary;
    this.validation = safeValidation(validation, profile);
    this.attempts = attempts.map(({ attempt, validation: attemptValidation }) => ({
      attempt: Number.isInteger(attempt) ? attempt : 0,
      validation: safeValidation(attemptValidation, profile)
    }));
    this.attemptCount = this.attempts.length;
  }
}

const reportProgress = (callback, phase, attempt) => {
  if (typeof callback === 'function') callback({ phase, attempt });
};

export function normalizeTargetWords(words = [], limit = MAX_TARGET_WORDS) {
  const selected = [];
  const seen = new Set();
  const max = normalizeLimit(limit, MAX_TARGET_WORDS);

  for (const value of Array.isArray(words) ? words : []) {
    const word = String(value || '').trim();
    const key = word.toLowerCase();
    if (word && !seen.has(key) && selected.length < max) {
      seen.add(key);
      selected.push(word);
    }
  }
  return selected;
}

export function chunkTargetWords(words = [], size = MAX_TARGET_WORDS) {
  const normalized = normalizeTargetWords(words, Number.POSITIVE_INFINITY);
  const chunkSize = Math.max(1, normalizeLimit(size, MAX_TARGET_WORDS));
  const batches = [];
  for (let index = 0; index < normalized.length; index += chunkSize) {
    batches.push(normalized.slice(index, index + chunkSize));
  }
  return batches;
}

const controlledArticleFields = fields => {
  if (!fields || typeof fields !== 'object') return {};
  const selected = {};
  if (Object.hasOwn(fields, 'reviewMode')) selected.reviewMode = Boolean(fields.reviewMode);
  if (Array.isArray(fields.usedWords)) selected.usedWords = normalizeTargetWords(fields.usedWords);
  return selected;
};

export function prioritizeLearningWords(words = [], now = Date.now()) {
  return [...words].sort((a, b) => {
    const priority = word => {
      if (word.state === 'relearning') return 5;
      if (word.lastQuality === 1) return 4;
      if (word.nextReview && word.nextReview <= now) return 3;
      if (word.lastQuality === 3) return 2;
      return 1;
    };
    return priority(b) - priority(a) || (b.lapseCount || 0) - (a.lapseCount || 0) || (a.nextReview || Infinity) - (b.nextReview || Infinity);
  });
}

export const GENERATE_READING_TOOL = {
  type: 'function',
  function: {
    name: 'generate_reading',
    description: '为用户生成并保存一篇可点击阅读的英语学习文章。仅在用户明确要求定制阅读、练习文章或基于学习情况出一篇阅读时调用，不要在聊天正文中直接写完整文章。',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: '用户的阅读生成要求' },
        topic: { type: 'string', description: '文章主题，可省略' },
        difficulty: { type: 'string', enum: ['cet4', 'cet6', 'kaoyan1', 'kaoyan2'], description: '四级、六级、考研英语一或考研英语二' },
        wordCount: { type: 'integer', minimum: 250, maximum: 600, description: '建议篇幅' }
      },
      required: ['request']
    }
  }
};

export class ArticleGenerationTool {
  constructor({
    api,
    db,
    pickWords = words => prioritizeLearningWords(words).slice(0, 8),
    now = () => Date.now(),
    admit = null,
    inspectQuality = null,
    scheduleBackground = scheduleWhenIdle,
    // Retained for existing callers and regression fixtures. New entry points
    // pass `admit` explicitly, so a deep validator can no longer block saving.
    validate = null
  }) {
    this.api = api;
    this.db = db;
    this.pickWords = pickWords;
    this.now = now;
    this.admit = typeof admit === 'function' ? admit : (typeof validate === 'function' ? validate : admitArticle);
    this.usesLegacyValidator = typeof admit !== 'function' && typeof validate === 'function';
    this.inspectQuality = typeof inspectQuality === 'function' ? inspectQuality : null;
    this.scheduleBackground = typeof scheduleBackground === 'function' ? scheduleBackground : scheduleWhenIdle;
  }

  async execute(args = {}, options = {}) {
    const fallbackDifficulty = DIFFICULTIES.has(options.fallbackDifficulty) ? options.fallbackDifficulty : 'cet4';
    const difficulty = DIFFICULTIES.has(args.difficulty) ? args.difficulty : fallbackDifficulty;
    const challenge = args.challenge || options.fallbackChallenge || challengeFromLegacyLevel(options.legacyLevel);
    const generation = normalizeGenerationRequest({ track: difficulty, challenge, wordCount: args.wordCount });
    const topic = clip(args.topic, 80) || clip(options.fallbackTopic, 80) || '综合';
    const wordCount = generation.wordCount;
    const request = clip(args.request || args.prompt, 1200) || `请生成一篇${difficulty}难度的英语阅读文章。`;
    const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;

    assertActive({ signal: options.signal, isActive });
    const learnWords = await this.db.getAllLearnWords();
    assertActive({ signal: options.signal, isActive });
    const rawTargetWords = Array.isArray(options.targetWords) && options.targetWords.length
      ? options.targetWords
      : (this.pickWords(learnWords) || []).map(word => typeof word === 'string' ? word : word.word);
    const allTargetWords = normalizeTargetWords(rawTargetWords, Number.POSITIVE_INFINITY);
    const selectedWords = normalizeTargetWords(allTargetWords);
    const deferredWords = allTargetWords.slice(selectedWords.length);
    const keywords = selectedWords.join(', ');
    let article;
    let admission;
    const attempts = [];
    let admissionCorrection = '';
    const isReviewMode = Boolean(options.articleFields?.reviewMode);
    const reviewWords = isReviewMode ? selectedWords : [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const retrying = attempt > 1;
      reportProgress(options.onProgress, retrying ? ARTICLE_GENERATION_PROGRESS.REFINING : ARTICLE_GENERATION_PROGRESS.DRAFTING, attempt);
      assertActive({ signal: options.signal, isActive });
      const validationHint = retrying ? `${request}\n\n${admissionCorrection}` : request;
      const requestOptions = {
        signal: options.signal,
        profile: generation.profile
      };
      if (options.personalization && typeof options.personalization === 'object') {
        requestOptions.personalization = options.personalization;
      }
      if (retrying) requestOptions.validationCorrection = admissionCorrection;
      article = await this.api.generateArticle(validationHint, difficulty, topic, keywords, wordCount, options.learningContext || '', requestOptions);
      assertActive({ signal: options.signal, isActive });
      reportProgress(options.onProgress, ARTICLE_GENERATION_PROGRESS.CHECKING, attempt);
      admission = this.usesLegacyValidator
        ? await this.admit(article.content || '', generation.profile, selectedWords, {
          signal: options.signal,
          isActive,
          ...(options.validationOptions && typeof options.validationOptions === 'object' ? options.validationOptions : {})
        })
        : await this.admit(article, {
          targetWordCount: wordCount,
          reviewWords,
          advisoryWords: selectedWords,
          profile: generation.profile
        });
      assertActive({ signal: options.signal, isActive });
      attempts.push({ attempt, validation: admission });
      if (admission.passed) break;
      admissionCorrection = this.usesLegacyValidator
        ? formatValidationCorrection(admission, generation.profile, selectedWords)
        : formatAdmissionCorrection(admission);
    }
    if (!admission?.passed) {
      if (this.usesLegacyValidator) {
        throw new ArticleValidationError({
          validation: admission,
          attempts,
          profile: generation.profile,
          targetWords: selectedWords
        });
      }
      throw new ArticleAdmissionError({ admission, attempts });
    }

    const articleToSave = {
      ...article,
      ...controlledArticleFields(options.articleFields),
      difficulty,
      topic,
      challenge: generation.challenge,
      difficultyReport: admission,
      qualityReport: { status: 'pending' },
      createdAt: this.now()
    };
    const id = await this.db.saveArticle(articleToSave);
    if (options.signal?.aborted || !isActive()) {
      await this.db.deleteArticle?.(id);
      throw cancelled();
    }

    const savedArticle = { ...articleToSave, id };
    this.scheduleQualityInspection({
      id,
      article: savedArticle,
      profile: generation.profile,
      selectedWords,
      validationOptions: options.validationOptions
    });
    return {
      article: savedArticle,
      metadata: { id, title: savedArticle.title, difficulty, challenge: generation.challenge, wordCount: savedArticle.wordCount || admission.metrics.wordCount || 0 },
      keywords,
      selectedWords,
      deferredWords
    };
  }

  scheduleQualityInspection({ id, article, profile, selectedWords, validationOptions }) {
    if (!this.inspectQuality || !this.db.updateArticle) return;
    this.scheduleBackground(() => {
      void this.inspectQuality(article.content || '', profile, selectedWords, {
        ...(validationOptions && typeof validationOptions === 'object' ? validationOptions : {})
      })
        .then(observation => {
          const report = observation?.report || observation || null;
          const status = observation?.status === 'unavailable' ? 'unavailable' : 'observed';
          const reason = status === 'unavailable' ? clip(observation?.reason, 80) || 'BACKGROUND_INSPECTION_UNAVAILABLE' : '';
          return this.db.updateArticle(id, {
            qualityReport: { status, ...(reason ? { reason } : {}), report },
            lexiconVersion: report?.lexiconProfile?.lexiconVersion || '',
            lexiconProfile: report?.lexiconProfile || null,
            grammarReport: report?.grammarReport || null,
            personalFit: report?.personalFit || null
          });
        })
        .catch(() => this.db.updateArticle(id, {
          qualityReport: { status: 'unavailable', reason: 'BACKGROUND_INSPECTION_FAILED' }
        }));
    });
  }
}
