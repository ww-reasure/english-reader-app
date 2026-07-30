import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createContextReviewService,
  normalizeContextReviewSentence,
  validateGeneratedContextReviewSentence
} from '../src/components/context-review.mjs';

test('validates one bounded English sentence containing the requested target form', () => {
  assert.deepEqual(normalizeContextReviewSentence({
    wordId: 7,
    lemma: 'retain',
    sentence: 'Daily practice helps learners retain useful words for much longer.',
    targetForm: 'retain',
    translationZh: '每天练习能帮助学习者更长久地记住实用单词。',
    senseIndex: 0,
    source: 'example'
  }), {
    wordId: 7,
    lemma: 'retain',
    sentence: 'Daily practice helps learners retain useful words for much longer.',
    targetForm: 'retain',
    translationZh: '每天练习能帮助学习者更长久地记住实用单词。',
    senseIndex: 0,
    source: 'example'
  });

  assert.equal(normalizeContextReviewSentence({
    wordId: 7,
    lemma: 'retain',
    sentence: 'Daily practice helps learners remember useful words.',
    targetForm: 'retain'
  }), null);
});

test('accepts generated context items only with the requested lemma, candidate sense and Chinese translation', () => {
  const requested = {
    id: 7,
    word: 'retain',
    senses: [{ index: 0 }, { index: 1 }]
  };
  const valid = {
    wordId: 7,
    lemma: 'retain',
    targetForm: 'retain',
    sentence: 'A short review can help students retain new vocabulary after class.',
    translationZh: '简短复习可以帮助学生在课后记住新词。',
    senseIndex: 1
  };

  assert.equal(validateGeneratedContextReviewSentence(valid, requested)?.source, 'ai');
  assert.equal(validateGeneratedContextReviewSentence({ ...valid, translationZh: 'retain new vocabulary' }, requested), null);
  assert.equal(validateGeneratedContextReviewSentence({ ...valid, targetForm: 'retained' }, requested), null);
  assert.equal(validateGeneratedContextReviewSentence({ ...valid, senseIndex: 3 }, requested), null);
});

test('prepares local article sentences before examples and batch-generates only missing words', async () => {
  const generatedFor = [];
  const service = createContextReviewService({
    articles: async () => [{
      id: 5,
      content: 'A careful editor will retain the strongest evidence in the final report. Other text.'
    }],
    examples: async word => word === 'adapt'
      ? ['Good teams adapt their plans when reliable new evidence appears.']
      : [],
    generateBatch: async words => {
      generatedFor.push(...words.map(word => word.word));
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: `Students can ${word.word} this idea through regular guided practice.`,
        translationZh: '学生可以通过定期的指导练习掌握这个想法。',
        senseIndex: 0,
        source: 'ai'
      }));
    },
    loadCached: async () => [],
    saveCached: async items => items,
    now: () => 100
  });

  const session = await service.prepare({
    words: [
      { id: 1, word: 'retain', reviewRevision: 0 },
      { id: 2, word: 'adapt', reviewRevision: 1 },
      { id: 3, word: 'analyze', reviewRevision: 2 }
    ],
    limit: 10,
    targetTrack: 'cet4'
  });

  assert.deepEqual(session.items.map(item => item.source), ['article', 'example', 'ai']);
  assert.deepEqual(generatedFor, ['analyze']);
  assert.deepEqual(session.items.map(item => item.expectedRevision), [0, 1, 2]);
  assert.deepEqual(session.items.map(item => item.targetTrack), ['cet4', 'cet4', 'cet4']);
});

test('prefers target-track exam passages and limits question stems to two per session', async () => {
  const service = createContextReviewService({
    examExamples: async word => word === 'retain'
      ? [{
          sentenceEn: 'Good institutions retain public trust by explaining difficult decisions clearly.',
          translationZh: '良好的机构通过清楚解释艰难决定来保持公众信任。',
          targetForm: 'retain',
          sourceKind: 'passage',
          paperLabel: '考研英语一 2024'
        }]
      : [{
          sentenceEn: `Why should students ${word} this method during the final review?`,
          translationZh: '为什么学生应在最终复习中采用这种方法？',
          targetForm: word,
          sourceKind: 'question',
          paperLabel: '考研英语一 2023'
        }],
    articles: async () => [{
      content: 'A careful editor will retain the strongest evidence in the final report.'
    }],
    examples: async () => [],
    generateBatch: async words => words.map(word => ({
      wordId: word.id,
      lemma: word.word,
      targetForm: word.word,
      sentence: `Students can ${word.word} this idea through regular guided practice.`,
      translationZh: '学生可以通过定期的指导练习掌握这个想法。',
      senseIndex: 0,
      source: 'ai'
    })),
    loadCached: async () => [],
    saveCached: async items => items,
    now: () => 100
  });

  const session = await service.prepare({
    words: [
      { id: 1, word: 'retain' },
      { id: 2, word: 'adapt' },
      { id: 3, word: 'analyze' },
      { id: 4, word: 'review' }
    ],
    targetTrack: 'kaoyan1'
  });

  assert.equal(session.items[0].source, 'exam-passage');
  assert.equal(session.items[0].paperLabel, '考研英语一 2024');
  assert.equal(session.items.filter(item => item.source === 'exam-question').length, 2);
  assert.equal(session.items.at(-1).source, 'ai');
});

test('avoids a recently used sentence and falls back to it only when no replacement is available', async () => {
  const repeated = 'Daily practice helps learners retain useful words for much longer.';
  const replacement = 'A short review can help students retain new vocabulary after class.';
  let generated = true;
  const service = createContextReviewService({
    articles: async () => [{ content: repeated }],
    examples: async () => [],
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: repeated,
      translationZh: '每天练习能帮助学习者更长久地记住实用单词。',
      source: 'article',
      lastUsedAt: 1_900
    }],
    generateBatch: async () => generated ? [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: replacement,
      translationZh: '简短复习可以帮助学生在课后记住新词。',
      source: 'ai'
    }] : [],
    saveCached: async items => items,
    now: () => 2_000
  });

  const fresh = await service.prepare({ words: [{ id: 7, word: 'retain' }] });
  assert.equal(fresh.items[0].sentence, replacement);

  generated = false;
  const offline = await service.prepare({ words: [{ id: 7, word: 'retain' }] });
  assert.equal(offline.items[0].sentence, repeated);
});

test('submitting a context result revalidates the shared revision before writing', async () => {
  let writes = 0;
  const service = createContextReviewService({
    coordinator: {
      revalidate: async () => ({ current: false, reason: 'reviewed-elsewhere', word: null })
    },
    recordReview: async () => { writes += 1; }
  });

  const result = await service.submit({
    item: { wordId: 1, expectedRevision: 2 },
    result: 'known'
  });

  assert.deepEqual(result, { accepted: false, reason: 'reviewed-elsewhere' });
  assert.equal(writes, 0);
});
