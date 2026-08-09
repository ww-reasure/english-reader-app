import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createContextReviewService,
  normalizeContextReviewSentence,
  validateGeneratedContextReviewSentence
} from '../src/components/context-review.mjs';
import { resolveContextDifficultyProfile } from '../src/difficulty-profile.mjs';

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

test('rejects generated context sentences that miss the selected sentence profile', () => {
  const requested = { id: 7, word: 'retain', senses: [{ index: 0 }] };
  const profile = resolveContextDifficultyProfile('stretch');
  const tooShort = {
    wordId: 7,
    lemma: 'retain',
    targetForm: 'retain',
    sentence: 'Students retain key terms through steady practice after class.',
    translationZh: '学生通过课后持续练习记住关键术语。',
    senseIndex: 0
  };

  assert.equal(validateGeneratedContextReviewSentence(tooShort, requested, profile), null);
});

test('prepares local article sentences before examples and batch-generates only missing words', async () => {
  const generatedFor = [];
  const service = createContextReviewService({
    articles: async () => [{
      id: 5,
      difficulty: 'cet4',
      challenge: 'standard',
      content: 'A careful editor will retain the strongest evidence in the final report. Other text.'
    }],
    examples: async word => word === 'adapt'
      ? [{
          sentence: 'Good teams adapt their plans when reliable new evidence appears again.',
          sourceTrack: 'cet4',
          difficultyProfileKey: 'context-v2:standard:c96'
        }]
      : [],
    generateBatch: async words => {
      generatedFor.push(...words.map(word => word.word));
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: `Students can ${word.word} this complex idea through regular guided classroom practice.`,
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
          examTrack: 'kaoyan1',
          paperLabel: '考研英语一 2024'
        }]
      : [{
          sentenceEn: `Why should students ${word} this method during the final review?`,
          translationZh: '为什么学生应在最终复习中采用这种方法？',
          targetForm: word,
          sourceKind: 'question',
          examTrack: 'kaoyan1',
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
      sentence: `Students can ${word.word} a challenging method through regular guided practice after each class.`,
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
      sourceTrack: 'cet4',
      targetTrack: 'cet4',
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

  const fresh = await service.prepare({ words: [{ id: 7, word: 'retain' }], sourceTrack: 'cet4' });
  assert.equal(fresh.items[0].sentence, replacement);

  generated = false;
  const offline = await service.prepare({ words: [{ id: 7, word: 'retain' }], sourceTrack: 'cet4' });
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

test('uses same-track authentic context before profile-bound generation for every mode', async () => {
  const calls = [];
  const service = createContextReviewService({
    examExamples: async () => [{
      sentenceEn: 'Public institutions retain trust by explaining difficult decisions clearly.',
      translationZh: '公共机构通过清楚说明艰难决定来保持信任。',
      targetForm: 'retain',
      sourceKind: 'passage',
      examTrack: 'kaoyan1'
    }],
    generateBatch: async (words, options) => {
      calls.push(options);
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: 'Clear review routines help learners retain words after class.',
        translationZh: '清晰的复习流程能帮助学习者在课后记住单词。',
        senseIndex: 0,
        source: 'ai',
        difficultyProfileKey: options.difficultyProfile.key,
        difficultyStatus: 'profiled'
      }));
    },
    loadCached: async () => [],
    saveCached: async items => items
  });

  const standard = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'kaoyan1',
    challenge: 'standard'
  });
  const support = await service.prepare({
    words: [{ id: 8, word: 'retain' }],
    targetTrack: 'kaoyan1',
    challenge: 'support'
  });

  assert.equal(standard.items[0].source, 'exam-passage');
  assert.equal(standard.items[0].difficultyStatus, 'authentic');
  assert.equal(support.items[0].source, 'exam-passage');
  assert.equal(support.items[0].difficultyStatus, 'authentic');
  assert.equal(calls.length, 0);
});

test('does not treat a different exam track as authentic context', async () => {
  const service = createContextReviewService({
    examExamples: async () => [{
      sentenceEn: 'Institutions retain trust by explaining difficult decisions clearly.',
      translationZh: '机构通过清楚解释艰难决定来保持信任。',
      targetForm: 'retain',
      sourceKind: 'passage',
      examTrack: 'cet6'
    }],
    generateBatch: async words => words.map(word => ({
      wordId: word.id,
      lemma: word.word,
      targetForm: word.word,
      sentence: 'Students retain important words through regular guided practice after every class session.',
      translationZh: '学生通过课后规律的指导练习记住重要单词。',
      senseIndex: 0
    })),
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'cet4',
    challenge: 'standard'
  });

  assert.equal(session.items[0].source, 'ai');
  assert.equal(session.items[0].difficultyStatus, 'profiled');
});

test('does not reuse a cached AI sentence across different context difficulty profiles', async () => {
  const generated = [];
  const service = createContextReviewService({
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: 'Learners retain new words through regular review sessions.',
      translationZh: '学习者通过定期复习记住新词。',
      senseIndex: 0,
      source: 'ai',
      targetTrack: 'cet6',
      difficultyProfileKey: 'context-v1:cet6:standard',
      difficultyStatus: 'profiled'
    }],
    generateBatch: async (words, options) => {
      generated.push(options.difficultyProfile.key);
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: 'Guided practice helps students retain difficult academic vocabulary through regular sessions after each class.',
        translationZh: '指导练习能帮助学生在课后记住较难的单词。',
        senseIndex: 0,
        source: 'ai',
        difficultyProfileKey: options.difficultyProfile.key,
        difficultyStatus: 'profiled'
      }));
    },
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'cet6',
    challenge: 'stretch'
  });

  assert.equal(session.items[0].difficultyProfileKey, 'context-v2:stretch:c94');
  assert.deepEqual(generated, ['context-v2:stretch:c94']);
});

test('uses the configured coverage target when creating a context profile', async () => {
  const generated = [];
  const service = createContextReviewService({
    generateBatch: async (words, options) => {
      generated.push(options.difficultyProfile.key);
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: 'Students retain important words through regular guided practice after class.',
        translationZh: '学生通过课后规律的指导练习记住重要单词。',
        senseIndex: 0
      }));
    },
    saveCached: async items => items
  });

  await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'cet4',
    challenge: 'standard',
    coverage: 97
  });

  assert.deepEqual(generated, ['context-v2:standard:c97']);
});

test('reuses an exact context-profile cache without a generation request', async () => {
  let generationCalls = 0;
  const profile = resolveContextDifficultyProfile('standard');
  const service = createContextReviewService({
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: 'Students retain difficult vocabulary through regular guided review after each class meeting.',
      translationZh: '学生通过定期指导复习记住较难词汇。',
      senseIndex: 0,
      source: 'ai',
      targetTrack: 'cet6',
      difficultyProfileKey: profile.key,
      difficultyStatus: 'profiled'
    }],
    generateBatch: async () => {
      generationCalls += 1;
      return [];
    },
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'cet6',
    challenge: 'standard'
  });

  assert.equal(session.items[0].difficultyProfileKey, profile.key);
  assert.equal(session.items[0].difficultyStatus, 'profiled');
  assert.equal(generationCalls, 0);
});

test('does not treat an exact-key cache outside the sentence profile as compatible', async () => {
  let generationCalls = 0;
  const profile = resolveContextDifficultyProfile('standard');
  const service = createContextReviewService({
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: 'Learners retain useful words through regular guided practice.',
      translationZh: '学习者通过规律的指导练习记住实用单词。',
      senseIndex: 0,
      source: 'ai',
      targetTrack: 'cet6',
      difficultyProfileKey: profile.key,
      difficultyStatus: 'profiled'
    }],
    generateBatch: async words => {
      generationCalls += 1;
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: 'Students retain important vocabulary by following regular guided practice routines after each class.',
        translationZh: '学生通过每节课后的规律指导练习记住重要词汇。',
        senseIndex: 0
      }));
    },
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'cet6',
    challenge: 'standard'
  });

  assert.equal(generationCalls, 1);
  assert.equal(session.items[0].sentence, 'Students retain important vocabulary by following regular guided practice routines after each class.');
});

test('labels a mismatched cache as an offline fallback only after generation fails', async () => {
  const service = createContextReviewService({
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: 'Learners retain new words through regular review sessions.',
      translationZh: '学习者通过定期复习记住新词。',
      senseIndex: 0,
      source: 'ai',
      targetTrack: 'cet6',
      difficultyProfileKey: 'context-v1:cet6:standard',
      difficultyStatus: 'profiled'
    }],
    generateBatch: async () => [],
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    targetTrack: 'cet6',
    challenge: 'stretch'
  });

  assert.equal(session.items[0].difficultyStatus, 'offline-fallback');
  assert.equal(session.items[0].originalDifficultyProfileKey, 'context-v1:cet6:standard');
});

test('uses sourceTrack only for provenance while global settings determine the generated profile', async () => {
  const calls = [];
  const service = createContextReviewService({
    generateBatch: async (words, options) => {
      calls.push({ sourceTrack: options.sourceTrack, profileKey: options.difficultyProfile.key });
      return words.map(word => ({
        wordId: word.id,
        lemma: word.word,
        targetForm: word.word,
        sentence: 'Students retain important vocabulary through regular guided review after each class meeting.',
        translationZh: '学生通过每节课后的定期指导复习记住重要词汇。',
        senseIndex: 0
      }));
    },
    saveCached: async items => items
  });

  const [cet4, kaoyan1] = await Promise.all([
    service.prepare({ words: [{ id: 7, word: 'retain' }], sourceTrack: 'cet4', challenge: 'standard', coverage: 97 }),
    service.prepare({ words: [{ id: 8, word: 'retain' }], sourceTrack: 'kaoyan1', challenge: 'standard', coverage: 97 })
  ]);

  assert.equal(cet4.sourceTrack, 'cet4');
  assert.equal(kaoyan1.sourceTrack, 'kaoyan1');
  assert.deepEqual(calls, [
    { sourceTrack: 'cet4', profileKey: 'context-v2:standard:c97' },
    { sourceTrack: 'kaoyan1', profileKey: 'context-v2:standard:c97' }
  ]);
});

test('never falls back to an authentic cache from a different source track', async () => {
  const service = createContextReviewService({
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: 'Public institutions retain public trust through transparent explanations during difficult political periods.',
      translationZh: '公共机构通过在困难政治时期作出透明解释来保持公众信任。',
      senseIndex: 0,
      source: 'exam-passage',
      sourceTrack: 'cet4',
      targetTrack: 'cet4',
      examTrack: 'cet4',
      difficultyStatus: 'authentic',
      difficultyProfileKey: 'authentic-v1:cet4'
    }],
    generateBatch: async () => [],
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    sourceTrack: 'cet6',
    challenge: 'standard'
  });

  assert.equal(session.missingCount, 1);
  assert.deepEqual(session.items, []);
});

test('uses a same-track offline fallback after a non-abort generation failure', async () => {
  const service = createContextReviewService({
    loadCached: async () => [{
      wordId: 7,
      lemma: 'retain',
      targetForm: 'retain',
      sentence: 'Learners retain useful words through regular guided review sessions.',
      translationZh: '学习者通过定期指导复习记住实用单词。',
      senseIndex: 0,
      source: 'ai',
      sourceTrack: 'kaoyan1',
      targetTrack: 'kaoyan1',
      difficultyProfileKey: 'context-v1:kaoyan1:standard:c96',
      difficultyStatus: 'profiled'
    }],
    generateBatch: async () => { throw new Error('network unavailable'); },
    saveCached: async items => items
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    sourceTrack: 'kaoyan1',
    challenge: 'stretch',
    coverage: 94
  });

  assert.equal(session.items[0].difficultyStatus, 'offline-fallback');
  assert.equal(session.items[0].originalDifficultyProfileKey, 'context-v1:kaoyan1:standard:c96');
  assert.equal(session.items[0].sourceTrack, 'kaoyan1');
  assert.equal(session.items[0].source, 'cache');
  assert.equal(session.generationFailed, true);
});

test('does not resolve a context profile or invoke providers for a legacy source track', async () => {
  const calls = [];
  const service = createContextReviewService({
    articles: async () => { calls.push('articles'); return []; },
    loadCached: async () => { calls.push('cache'); return []; },
    examExamples: async () => { calls.push('exam'); return []; },
    generateBatch: async () => { calls.push('ai'); return []; }
  });

  const session = await service.prepare({
    words: [{ id: 7, word: 'retain' }],
    sourceTrack: 'graduate',
    challenge: 'stretch',
    coverage: 94
  });

  assert.equal(session.targetSelectionRequired, true);
  assert.deepEqual(session.items, []);
  assert.deepEqual(calls, []);
});
