import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadTool() {
  const source = await readFile(new URL('../src/components/article-generation-tool.js', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8');
  const profileUrl = 'data:text/javascript;base64,' + Buffer.from(profile).toString('base64');
  const adapted = source.replace("from '../difficulty-profile.mjs'", `from '${profileUrl}'`);
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

test('normalizes article tool arguments and saves a card-ready article', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const calls = [];
  const saved = [];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Learning by Travel', content: 'A short article', translation: '一篇短文', wordCount: 3 };
      }
    },
    db: {
      getAllLearnWords: async () => [{ word: 'journey' }, { word: 'culture' }],
      saveArticle: async article => { saved.push(article); return 42; },
      deleteArticle: async () => {}
    },
    pickWords: words => words,
    validate: () => ({ passed: true, metrics: { wordCount: 3 }, deviations: [] })
  });

  const result = await tool.execute({
    request: '请按我们的学习情况写一篇旅行阅读',
    difficulty: 'unsupported',
    topic: '旅行'.repeat(50),
    wordCount: 9999
  }, {
    fallbackDifficulty: 'cet6',
    fallbackTopic: '综合',
    learningContext: '学习者：想练习旅行词汇'
  });

  assert.equal(calls[0][1], 'cet6');
  assert.equal(calls[0][2].length, 80);
  assert.equal(calls[0][4], 500);
  assert.equal(calls[0][5], '学习者：想练习旅行词汇');
  assert.equal(saved.length, 1);
  assert.equal(result.article.id, 42);
  assert.deepEqual(result.metadata, { id: 42, title: 'Learning by Travel', difficulty: 'cet6', challenge: 'standard', wordCount: 3 });
});

test('prioritizes relearning, lapse and overdue words before ordinary vocabulary', async () => {
  const { prioritizeLearningWords } = await loadTool();
  const now = 1_000_000;
  const ordered = prioritizeLearningWords([
    { word: 'ordinary' },
    { word: 'overdue', nextReview: now - 1 },
    { word: 'lapse', lastQuality: 1 },
    { word: 'relearning', state: 'relearning' }
  ], now);

  assert.deepEqual(ordered.map(word => word.word), ['relearning', 'lapse', 'overdue', 'ordinary']);
});

test('does not save an article when the generation context has been cleared', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let saveCalls = 0;
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async () => ({ title: 'Late result', content: 'content', translation: '', wordCount: 1 }) },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async () => { saveCalls += 1; return 1; },
      deleteArticle: async () => {}
    },
    validate: () => ({ passed: true, metrics: { wordCount: 1 }, deviations: [] })
  });

  await assert.rejects(
    tool.execute({ request: '生成一篇文章' }, { isActive: () => false }),
    /已取消/
  );
  assert.equal(saveCalls, 0);
});

test('accepts an internal explicit-word set for review-generated readings', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const calls = [];
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async (...args) => { calls.push(args); return { title: 'Review', content: 'Review target.', translation: '', wordCount: 2 }; } },
    db: { getAllLearnWords: async () => [{ word: 'ignored' }], saveArticle: async () => 7, deleteArticle: async () => {} },
    validate: () => ({ passed: true, metrics: { wordCount: 2 }, deviations: [] })
  });

  await tool.execute({ request: '复习阅读', difficulty: 'cet4' }, { targetWords: ['target', 'practice'] });

  assert.equal(calls[0][3], 'target, practice');
});

test('keeps all review candidates available and saves only the candidates actually used', async () => {
  const { ArticleGenerationTool, normalizeTargetWords } = await loadTool();
  const calls = [];
  const saved = [];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Review', content: 'Review One w0 w9.', translation: '', wordCount: 4, unsafeField: 'discard me' };
      }
    },
    db: {
      getAllLearnWords: async () => [{ word: 'ignored' }],
      saveArticle: async article => { saved.push(article); return 9; },
      deleteArticle: async () => {}
    },
    validate: () => ({ passed: true, metrics: { wordCount: 2 }, deviations: [] })
  });
  const targets = ['One', 'one', '', ...Array.from({ length: 12 }, (_, index) => `w${index}`)];

  const result = await tool.execute({ request: '复习阅读', difficulty: 'cet4' }, {
    targetWords: targets,
    fallbackChallenge: 'support',
    articleFields: { reviewMode: true, usedWords: targets, unsafeField: 'not allowed' }
  });

  assert.deepEqual(normalizeTargetWords(targets), ['One', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
  assert.equal(calls[0][3], 'One, w0, w1, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11');
  assert.equal(calls[0][6].reviewMode, true);
  assert.equal(calls[0][6].reviewMaxWords, 280);
  assert.deepEqual(result.selectedWords, ['One', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w11']);
  assert.deepEqual(result.deferredWords, []);
  assert.equal(saved[0].reviewMode, true);
  assert.deepEqual(saved[0].usedWords, ['One', 'w0', 'w9']);
  assert.equal(saved[0].unsafeField, 'discard me');
});

test('persists a trusted generation job id without accepting arbitrary article fields', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const saved = [];
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async () => ({ title: 'Resume safe', content: 'A saved article.', translation: '', wordCount: 3 }) },
    db: { getAllLearnWords: async () => [], saveArticle: async article => { saved.push(article); return 18; }, deleteArticle: async () => {} },
    validate: () => ({ passed: true, metrics: { wordCount: 3 }, deviations: [] })
  });

  await tool.execute({ request: '生成文章' }, {
    articleFields: { generationJobId: 'job-18', unsafeField: 'discard' }
  });

  assert.equal(saved[0].generationJobId, 'job-18');
  assert.equal(saved[0].unsafeField, undefined);
});

test('chunks a normalized target list into batches of at most eight words', async () => {
  const { chunkTargetWords } = await loadTool();
  const words = ['One', 'one', ...Array.from({ length: 17 }, (_, index) => `w${index}`)];

  assert.deepEqual(chunkTargetWords(words), [
    ['One', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
    ['w7', 'w8', 'w9', 'w10', 'w11', 'w12', 'w13', 'w14'],
    ['w15', 'w16']
  ]);
});

test('retries one time with the measured deviations before saving a corrected article', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const calls = [];
  const saved = [];
  const outcomes = [
    { passed: false, metrics: { wordCount: 5 }, deviations: [{ code: 'word_count' }] },
    { passed: true, metrics: { wordCount: 320 }, deviations: [] }
  ];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Corrected', content: 'A validated article.', translation: '', wordCount: 320 };
      }
    },
    db: {
      getAllLearnWords: async () => [{ word: 'journey' }],
      saveArticle: async article => { saved.push(article); return 8; },
      deleteArticle: async () => {}
    },
    validate: () => outcomes.shift()
  });

  const result = await tool.execute({ request: '旅行主题阅读', difficulty: 'cet4' });

  assert.equal(calls.length, 2);
  assert.match(calls[1][0], /word_count/);
  assert.equal(saved.length, 1);
  assert.equal(result.article.id, 8);
});

test('awaits an injected asynchronous quality gate and forwards cancellation-safe validation options', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const received = [];
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async () => ({ title: 'Async', content: 'Validated article.', translation: '', wordCount: 2 }) },
    db: { getAllLearnWords: async () => [], saveArticle: async () => 12, deleteArticle: async () => {} },
    validate: async (_content, _profile, _targets, options) => {
      await Promise.resolve();
      received.push(options);
      return { passed: true, metrics: { wordCount: 2 }, deviations: [] };
    }
  });

  await tool.execute({ request: '生成文章' }, {
    validationOptions: { calibrationStatus: 'skipped', targetCoverage: null }
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].calibrationStatus, 'skipped');
  assert.equal(received[0].targetCoverage, null);
  assert.equal(typeof received[0].isActive, 'function');
});

test('forwards the resolved personalization contract to the generation API', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const calls = [];
  const personalization = {
    mode: 'uncalibrated_conservative',
    calibrationStatus: 'skipped',
    challenge: 'support',
    targetCoverage: null,
    prompt: 'Use high-frequency core vocabulary.'
  };
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Conservative', content: 'A short article.', translation: '', wordCount: 3 };
      }
    },
    db: { getAllLearnWords: async () => [], saveArticle: async () => 15, deleteArticle: async () => {} },
    validate: () => ({ passed: true, metrics: { wordCount: 3 }, deviations: [] })
  });

  await tool.execute({ request: '生成文章' }, { personalization });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][6].personalization, personalization);
});

test('formats a retry correction with measured limits and missing target words', async () => {
  const { formatValidationCorrection } = await loadTool();
  const correction = formatValidationCorrection({
    metrics: {
      wordCount: 287,
      averageSentenceLength: 9.5,
      targetWordCounts: { journey: 0, culture: 1 }
    },
    deviations: [
      { code: 'word_count', expected: { min: 320, max: 420 }, actual: 287 },
      { code: 'sentence_length', expected: { min: 14, max: 22 }, actual: 9.5 },
      { code: 'target_word', word: 'journey', actual: 0 }
    ]
  }, {
    wordRange: { min: 320, max: 420 },
    sentenceRange: { min: 14, max: 22 }
  }, ['journey', 'culture']);

  assert.match(correction, /实际总字数：287 词；要求：320-420 词/);
  assert.match(correction, /实际平均句长：9\.5 词；要求：14-22 词/);
  assert.match(correction, /缺失目标词：journey/);
});

test('uses safe lexical, grammar and personal-fit metrics in a refinement request', async () => {
  const { ArticleValidationError, formatValidationCorrection } = await loadTool();
  const validation = {
    passed: false,
    metrics: {
      wordCount: 340,
      averageSentenceLength: 17,
      lexicon: { tokenCount: 340, unknownTokenCount: 4, unbandedTokenCount: 1, unverifiedTokenCount: 0 },
      grammar: { maxDependencyDepth: 8, subordinateRate: 0.2, passiveRate: 0.1, nonFiniteRate: 0.1 },
      personalFit: {
        estimatedCoverage: 93,
        targetCoverage: 96,
        confidence: 0.4,
        traceableCoreCoveragePercent: 76,
        foundationCoveragePercent: 63,
        upperFrequencyCoveragePercent: 19
      }
    },
    lexiconProfile: { unknownLemmas: ['secret-unpublished-token'] },
    deviations: [
      { code: 'dependency_depth', expected: { min: 3, max: 6 }, value: 8, source: 'local' },
      { code: 'personal_coverage', expected: { min: 96, max: 100 }, actual: 93 },
      { code: 'conservative_core_coverage', expected: { min: 90, max: 100 }, actual: 76 },
      { code: 'conservative_foundation_coverage', expected: { min: 80, max: 100 }, actual: 63 },
      { code: 'conservative_upper_frequency_coverage', expected: { min: 0, max: 12 }, actual: 19 }
    ]
  };

  const correction = formatValidationCorrection(validation, {
    wordRange: { min: 320, max: 420 },
    sentenceRange: { min: 14, max: 22 }
  });
  const error = new ArticleValidationError({ validation });

  assert.match(correction, /词汇校验：未分类或未验证词 5 个/);
  assert.match(correction, /句法校验：依存深度 8，目标 3-6/);
  assert.match(correction, /个人匹配：预计掌握覆盖 93%，目标至少 96%/);
  assert.match(correction, /保守材料构成：可追溯核心词 76%，基础 NGSL 1-3 词 63%，NGSL 4 及以上词 19%/);
  assert.doesNotMatch(correction, /secret-unpublished-token/);
  assert.equal(error.validation.metrics.lexicon.unknownTokenCount, 4);
  assert.equal(error.validation.metrics.grammar.maxDependencyDepth, 8);
  assert.equal(error.validation.metrics.personalFit.estimatedCoverage, 93);
  assert.equal(error.validation.metrics.personalFit.traceableCoreCoveragePercent, 76);
  assert.doesNotMatch(JSON.stringify(error), /secret-unpublished-token/);
});

test('explains conservative material-policy failures without presenting them as learner mastery', async () => {
  const { formatValidationSummary } = await loadTool();
  const summary = formatValidationSummary({
    passed: false,
    metrics: {
      wordCount: 348,
      averageSentenceLength: 17,
      personalFit: {
        traceableCoreCoveragePercent: 76,
        foundationCoveragePercent: 63,
        upperFrequencyCoveragePercent: 19
      }
    },
    deviations: [
      { code: 'conservative_core_coverage', expected: { min: 90, max: 100 }, actual: 76 },
      { code: 'conservative_foundation_coverage', expected: { min: 80, max: 100 }, actual: 63 },
      { code: 'conservative_upper_frequency_coverage', expected: { min: 0, max: 12 }, actual: 19 }
    ]
  }, {
    wordRange: { min: 320, max: 420 },
    sentenceRange: { min: 14, max: 22 }
  });

  assert.match(summary, /可追溯基础词比例不符合保守材料要求/);
  assert.match(summary, /不代表你的词汇掌握率/);
  assert.doesNotMatch(summary, /预计掌握覆盖/);
});

test('reports drafting, checking and refining while retrying with the detailed correction', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const calls = [];
  const progress = [];
  const outcomes = [
    {
      passed: false,
      metrics: { wordCount: 287, averageSentenceLength: 9.5, targetWordCounts: { journey: 0 } },
      deviations: [
        { code: 'word_count', expected: { min: 320, max: 420 }, actual: 287 },
        { code: 'sentence_length', expected: { min: 14, max: 22 }, actual: 9.5 },
        { code: 'target_word', word: 'journey', actual: 0 }
      ]
    },
    { passed: true, metrics: { wordCount: 320, averageSentenceLength: 16, targetWordCounts: { journey: 1 } }, deviations: [] }
  ];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Corrected', content: 'A validated article.', translation: '', wordCount: 320 };
      }
    },
    db: { getAllLearnWords: async () => [{ word: 'journey' }], saveArticle: async () => 11, deleteArticle: async () => {} },
    validate: () => outcomes.shift()
  });

  await tool.execute({ request: '旅行主题阅读', difficulty: 'cet4' }, {
    onProgress: event => progress.push(event)
  });

  assert.deepEqual(progress, [
    { phase: 'drafting', attempt: 1 },
    { phase: 'checking', attempt: 1 },
    { phase: 'refining', attempt: 2 },
    { phase: 'checking', attempt: 2 }
  ]);
  assert.match(calls[1][0], /实际总字数：287 词；要求：320-420 词/);
  assert.match(calls[1][0], /实际平均句长：9\.5 词；要求：14-22 词/);
  assert.match(calls[1][0], /缺失目标词：journey/);
  assert.match(calls[1][6].validationCorrection, /实际总字数：287 词；要求：320-420 词/);
});

test('does not save an article when both validation attempts fail', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let saveCalls = 0;
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async () => ({ title: 'Invalid', content: 'too short', translation: '', wordCount: 2 }) },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async () => { saveCalls += 1; return 1; },
      deleteArticle: async () => {}
    },
    validate: () => ({ passed: false, metrics: { wordCount: 2 }, deviations: [{ code: 'word_count' }] })
  });

  await assert.rejects(tool.execute({ request: '生成文章' }), /未通过难度校验/);
  assert.equal(saveCalls, 0);
});

test('throws a safe structured validation error without keeping article content', async () => {
  const { ArticleGenerationTool, ArticleValidationError } = await loadTool();
  let saveCalls = 0;
  const secretDraft = 'secret article content must not escape';
  const validation = {
    passed: false,
    content: secretDraft,
    metrics: { wordCount: 2, averageSentenceLength: 2, targetWordCounts: { journey: 0 } },
    deviations: [
      { code: 'word_count', expected: { min: 320, max: 420 }, actual: 2 },
      { code: 'sentence_length', expected: { min: 14, max: 22 }, actual: 2 },
      { code: 'target_word', word: 'journey', actual: 0 }
    ]
  };
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async () => ({ title: 'Invalid', content: secretDraft, translation: '', wordCount: 2 }) },
    db: {
      getAllLearnWords: async () => [{ word: 'journey' }],
      saveArticle: async () => { saveCalls += 1; return 1; },
      deleteArticle: async () => {}
    },
    validate: () => validation
  });

  await assert.rejects(tool.execute({ request: '生成文章' }), error => {
    assert.ok(error instanceof ArticleValidationError);
    assert.equal(error.code, 'ARTICLE_VALIDATION_FAILED');
    assert.equal(error.attempts.length, 2);
    assert.deepEqual(error.attempts.map(item => item.attempt), [1, 2]);
    assert.equal(error.validation.metrics.wordCount, 2);
    assert.match(error.summary, /字数为 2/);
    assert.doesNotMatch(error.summary, /secret article content/);
    assert.doesNotMatch(JSON.stringify(error), /secret article content/);
    return true;
  });
  assert.equal(saveCalls, 0);
});

test('review-generated readings delegate to the home article tool instead of direct API saves', async () => {
  const [flashcard, reading] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  for (const source of [flashcard, reading]) {
    assert.match(source, /ChatView\.generateReviewReadings/);
    assert.doesNotMatch(source, /API\.generateArticle\(/);
  }
});

const buildArticleContent = (wordCount, extra = '') => {
  const words = Array.from({ length: wordCount }, () => 'practice');
  if (extra) words.splice(4, 0, ...extra.split(/\s+/));
  const chunk = Math.ceil(words.length / 3);
  return [
    words.slice(0, chunk).join(' ') + '.',
    words.slice(chunk, chunk * 2).join(' ') + '.',
    words.slice(chunk * 2).join(' ') + '.'
  ].join(' ');
};

test('admits structurally complete articles inside the light 70 to 140 percent range', async () => {
  const { admitArticle } = await loadTool();
  const result = admitArticle({
    title: 'Practice and Progress',
    titleZh: '练习与进步',
    content: buildArticleContent(240),
    translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
  }, { targetWordCount: 300 });

  assert.equal(result.passed, true);
  assert.equal(result.metrics.wordCount, 240);
  assert.deepEqual(result.deviations, []);
});

test('allows partial review coverage but does not require advisory words for ordinary generation', async () => {
  const { admitArticle } = await loadTool();
  const article = {
    title: 'Practice and Progress',
    titleZh: '练习与进步',
    content: buildArticleContent(300, 'memory'),
    translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
  };

  const ordinary = admitArticle(article, { targetWordCount: 300, advisoryWords: ['memory', 'missing'] });
  const review = admitArticle(article, { targetWordCount: 300, reviewWords: ['memory', 'missing'] });

  assert.equal(ordinary.passed, true);
  assert.equal(review.passed, true);
  assert.deepEqual(review.deviations, []);
  assert.deepEqual(review.matchedReviewWords, ['memory']);
  assert.deepEqual(review.missingReviewWords, ['missing']);
});

test('review admission allows short contextual articles when at least one candidate word is used', async () => {
  const { admitArticle } = await loadTool();
  const article = {
    title: 'A Short Context',
    titleZh: '短篇语境',
    content: buildArticleContent(173, 'memory'),
    translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
  };
  const result = admitArticle(article, {
    reviewMode: true,
    reviewWords: ['memory', 'missing'],
    reviewMaxWords: 280
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.matchedReviewWords, ['memory']);
  assert.deepEqual(result.missingReviewWords, ['missing']);
  assert.equal(result.metrics.wordCount, 174);
});

test('review admission retries or rejects only when no candidate word appears', async () => {
  const { admitArticle } = await loadTool();
  const result = admitArticle({
    title: 'A Short Context',
    titleZh: '短篇语境',
    content: buildArticleContent(173),
    translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
  }, {
    reviewMode: true,
    reviewWords: ['memory', 'missing'],
    reviewMaxWords: 280
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.matchedReviewWords, []);
  assert.match(result.deviations.map(item => item.code).join(','), /review_word/);
});

test('prefers the streaming article API and forwards draft snapshots without saving a draft', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const saved = [];
  const drafts = [];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticleStream: async (_request, _difficulty, _topic, _keywords, _wordCount, _context, options) => {
        options.onDraft({ title: '流式标题', content: 'First sentence.' });
        return {
          title: 'Streamed article',
          titleZh: '流式文章',
          content: buildArticleContent(300),
          translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
        };
      },
      generateArticle: async () => { throw new Error('must use stream'); }
    },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async article => { saved.push(article); return 88; },
      deleteArticle: async () => {}
    }
  });

  const result = await tool.execute({ request: '生成文章', difficulty: 'cet4', wordCount: 300 }, {
    onDraft: draft => drafts.push(draft)
  });

  assert.equal(result.article.id, 88);
  assert.equal(saved.length, 1);
  assert.equal(drafts.length, 1);
  assert.equal(saved[0].content, result.article.content);
});

test('saves an admitted article after one model request while quality inspection stays non-blocking', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let generationCalls = 0;
  let inspectStarted = false;
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async () => {
        generationCalls += 1;
        return {
          title: 'Saved immediately',
          titleZh: '立即保存',
          content: buildArticleContent(300),
          translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
        };
      }
    },
    db: { getAllLearnWords: async () => [], saveArticle: async () => 17, updateArticle: async () => {} },
    admit: () => ({ passed: true, metrics: { wordCount: 300 }, deviations: [] }),
    inspectQuality: async () => {
      inspectStarted = true;
      throw new Error('background grammar unavailable');
    },
    validate: () => {
      throw new Error('legacy deep validator must not block admission');
    }
  });

  const result = await tool.execute({ request: '生成一篇文章', difficulty: 'cet4', wordCount: 300 });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(generationCalls, 1);
  assert.equal(result.article.id, 17);
  assert.equal(result.article.difficultyReport.passed, true);
  assert.equal(inspectStarted, true);
});

test('records an unavailable background observation without withdrawing an admitted article', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let qualityUpdate = null;
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async () => ({
        title: 'Saved with observation',
        titleZh: '带观察结果保存',
        content: buildArticleContent(300),
        translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
      })
    },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async () => 18,
      updateArticle: async (_id, fields) => { qualityUpdate = fields; }
    },
    admit: () => ({ passed: true, metrics: { wordCount: 300 }, deviations: [] }),
    inspectQuality: async () => ({
      status: 'unavailable',
      reason: 'GRAMMAR_MODEL_UNAVAILABLE',
      report: { lexiconProfile: { status: 'available' } }
    }),
    scheduleBackground: callback => callback()
  });

  const result = await tool.execute({ request: '生成一篇文章', difficulty: 'cet4', wordCount: 300 });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(result.article.id, 18);
  assert.equal(qualityUpdate.qualityReport.status, 'unavailable');
  assert.equal(qualityUpdate.qualityReport.reason, 'GRAMMAR_MODEL_UNAVAILABLE');
});

test('uses true-exam priority as a learning-word preference without making it an admission gate', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let generatedKeywords = '';
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (_request, _difficulty, _topic, keywords) => {
        generatedKeywords = keywords;
        return {
          title: 'Preference only',
          titleZh: '仅作偏好',
          content: buildArticleContent(300),
          translation: '第一段中文翻译。\n\n第二段中文翻译。\n\n第三段中文翻译。'
        };
      }
    },
    db: {
      getAllLearnWords: async () => [
        { word: 'ordinary', state: 'new', interval: 0 },
        { word: 'frequent', state: 'new', interval: 0 }
      ],
      saveArticle: async () => 19
    },
    examCorpus: {
      lookup: async word => word === 'frequent' ? { priorityScore: 95, priorityTier: 'core' } : null
    },
    admit: () => ({ passed: true, metrics: { wordCount: 300 }, deviations: [] })
  });

  await tool.execute({ request: '生成阅读', difficulty: 'kaoyan1', wordCount: 300 });
  assert.equal(generatedKeywords.split(', ')[0], 'frequent');
});

test('adds exam coverage to the non-blocking background quality report', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let qualityUpdate = null;
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async () => ({
        title: 'Coverage',
        titleZh: '覆盖情况',
        content: 'Frequent words appear in useful reading practice. Another ordinary sentence follows.',
        translation: '高频词出现在有用的阅读练习中。另一个普通句子紧随其后。'
      })
    },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async () => 20,
      updateArticle: async (_id, fields) => { qualityUpdate = fields; }
    },
    examCorpus: {
      lookup: async word => word === 'frequent'
        ? { priorityScore: 90, priorityTier: 'core', counts: { sentenceTotal: 12 } }
        : null
    },
    admit: () => ({ passed: true, metrics: { wordCount: 11 }, deviations: [] }),
    inspectQuality: async () => ({ status: 'observed', report: { lexiconProfile: { status: 'available' } } }),
    scheduleBackground: callback => callback()
  });

  await tool.execute({ request: '生成阅读', difficulty: 'kaoyan1', wordCount: 300 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(qualityUpdate.qualityReport.report.examCorpusObservation.status, 'available');
  assert.equal(qualityUpdate.qualityReport.report.examCorpusObservation.observedUniqueWords, 1);
});
