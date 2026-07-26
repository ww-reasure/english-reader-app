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

test('bounds explicit review targets case-insensitively and saves only controlled review fields', async () => {
  const { ArticleGenerationTool, normalizeTargetWords } = await loadTool();
  const calls = [];
  const saved = [];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Review', content: 'Review target.', translation: '', wordCount: 2, unsafeField: 'discard me' };
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
  assert.equal(calls[0][3], 'One, w0, w1, w2, w3, w4, w5, w6');
  assert.deepEqual(calls[0][6].profile.wordRange, { min: 240, max: 320 });
  assert.deepEqual(result.selectedWords, ['One', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
  assert.deepEqual(result.deferredWords, ['w7', 'w8', 'w9', 'w10', 'w11']);
  assert.equal(saved[0].reviewMode, true);
  assert.deepEqual(saved[0].usedWords, ['One', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
  assert.equal(saved[0].unsafeField, 'discard me');
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

test('review-generated readings use the validated article tool instead of direct API saves', async () => {
  const [flashcard, reading] = await Promise.all([
    readFile(new URL('../src/views/flashcard.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/reading.js', import.meta.url), 'utf8')
  ]);

  for (const source of [flashcard, reading]) {
    assert.match(source, /ArticleGenerationTool/);
    assert.match(source, /reviewArticleTool\.execute\(/);
    assert.doesNotMatch(source, /API\.generateArticle\(/);
  }
});
