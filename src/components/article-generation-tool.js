import { normalizeGenerationRequest, validateArticle } from '../difficulty-profile.mjs';

const DIFFICULTIES = new Set(['cet4', 'cet6', 'graduate']);
export const MAX_TARGET_WORDS = 8;

const clip = (value, limit) => String(value || '').trim().slice(0, limit);
const cancelled = () => new Error('请求已取消');

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

  const deviations = (Array.isArray(validation?.deviations) ? validation.deviations : []).map(item => {
    const selected = { code: clip(item?.code, 64) || 'unknown' };
    const word = clip(item?.word, 80);
    const actual = toFiniteNumber(item?.actual);
    const expected = safeRange(item?.expected);
    if (word) selected.word = word;
    if (actual !== null) selected.actual = actual;
    if (expected) selected.expected = expected;
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

  return [
    '上次生成未通过难度校验。请保留主题，但完整重写文章并严格满足以下要求：',
    `- 实际总字数：${formatNumber(wordCount)} 词；要求：${formatRange(wordRange)} 词。`,
    `- 实际平均句长：${formatNumber(sentenceLength)} 词；要求：${formatRange(sentenceRange)} 词。`,
    `- 缺失目标词：${missing.length ? missing.join(', ') : '无'}。`,
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
  const parts = [
    `字数为 ${formatNumber(wordCount)}（要求 ${formatRange(wordRange)} 词）`,
    `平均句长为 ${formatNumber(sentenceLength)}（要求 ${formatRange(sentenceRange)} 词）`
  ];
  if (missing.length) parts.push(`缺少目标词 ${missing.join(', ')}`);
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
        difficulty: { type: 'string', enum: ['cet4', 'cet6', 'graduate'], description: '四级、六级或考研' },
        wordCount: { type: 'integer', minimum: 250, maximum: 600, description: '建议篇幅' }
      },
      required: ['request']
    }
  }
};

export class ArticleGenerationTool {
  constructor({ api, db, pickWords = words => prioritizeLearningWords(words).slice(0, 8), now = () => Date.now(), validate = validateArticle }) {
    this.api = api;
    this.db = db;
    this.pickWords = pickWords;
    this.now = now;
    this.validate = validate;
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
    let validation;
    const attempts = [];
    let validationCorrection = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const retrying = attempt > 1;
      reportProgress(options.onProgress, retrying ? ARTICLE_GENERATION_PROGRESS.REFINING : ARTICLE_GENERATION_PROGRESS.DRAFTING, attempt);
      assertActive({ signal: options.signal, isActive });
      const validationHint = retrying ? `${request}\n\n${validationCorrection}` : request;
      const requestOptions = {
        signal: options.signal,
        profile: generation.profile
      };
      if (retrying) requestOptions.validationCorrection = validationCorrection;
      article = await this.api.generateArticle(validationHint, difficulty, topic, keywords, wordCount, options.learningContext || '', requestOptions);
      assertActive({ signal: options.signal, isActive });
      reportProgress(options.onProgress, ARTICLE_GENERATION_PROGRESS.CHECKING, attempt);
      validation = this.validate(article.content || '', generation.profile, selectedWords);
      attempts.push({ attempt, validation });
      if (validation.passed) break;
      validationCorrection = formatValidationCorrection(validation, generation.profile, selectedWords);
    }
    if (!validation?.passed) {
      throw new ArticleValidationError({
        validation,
        attempts,
        profile: generation.profile,
        targetWords: selectedWords
      });
    }

    const articleToSave = {
      ...article,
      ...controlledArticleFields(options.articleFields),
      difficulty,
      topic,
      challenge: generation.challenge,
      difficultyReport: validation,
      createdAt: this.now()
    };
    const id = await this.db.saveArticle(articleToSave);
    if (options.signal?.aborted || !isActive()) {
      await this.db.deleteArticle?.(id);
      throw cancelled();
    }

    const savedArticle = { ...articleToSave, id };
    return {
      article: savedArticle,
      metadata: { id, title: savedArticle.title, difficulty, challenge: generation.challenge, wordCount: savedArticle.wordCount || validation.metrics.wordCount || 0 },
      keywords,
      selectedWords,
      deferredWords
    };
  }
}
