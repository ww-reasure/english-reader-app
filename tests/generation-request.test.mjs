import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadResolver() {
  const [source, profile] = await Promise.all([
    readFile(new URL('../src/components/generation-request.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8')
  ]);
  const profileUrl = `data:text/javascript;base64,${Buffer.from(profile).toString('base64')}`;
  const adapted = source.replace("from '../difficulty-profile.mjs'", `from '${profileUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('explicit exam cues are marked as a user-owned target selection and map the legacy challenge', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const cet4 = resolveGenerationRequest({
    request: '请生成一篇 CET-4 英语阅读。',
    selectedDifficulty: 'graduate',
    legacyLevel: 'easy'
  });
  const cet6 = resolveGenerationRequest({
    request: '请来一篇 CET6 阅读练习。',
    selectedDifficulty: 'cet4',
    legacyLevel: 'hard'
  });
  const graduate = resolveGenerationRequest({
    request: '给我一篇考研英语文章。',
    selectedDifficulty: 'cet4',
    legacyLevel: 'normal'
  });

  assert.equal(cet4.difficulty, 'cet4');
  assert.equal(cet4.targetSelectionRequested, 'cet4');
  assert.equal(cet4.challenge, 'support');
  assert.equal(cet6.difficulty, 'cet6');
  assert.equal(cet6.targetSelectionRequested, undefined);
  assert.equal(cet6.challenge, 'stretch');
  assert.equal(graduate.difficulty, 'cet4');
  assert.equal(graduate.targetSelectionRequested, undefined);
  assert.equal(graduate.challenge, 'standard');
});

test('treats a direct CET-4 request as a target selection when no target has been persisted', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇四级英语阅读。',
    selectedDifficulty: '',
    legacyLevel: 'easy'
  });

  assert.equal(result.difficulty, 'cet4');
  assert.equal(result.targetSelectionRequested, 'cet4');
});

test('does not treat an agent-authored request as a user target selection', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇六级英语阅读。',
    selectedDifficulty: 'cet4',
    allowExplicitUserTarget: false,
    legacyLevel: 'normal'
  });

  assert.equal(result.difficulty, 'cet4');
  assert.equal(result.targetSelectionRequested, undefined);
});

test('requires one unambiguous article-generation target before treating direct text as a first target selection', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const comparison = resolveGenerationRequest({
    request: '请比较四级和六级阅读的区别。',
    selectedDifficulty: ''
  });
  const consultation = resolveGenerationRequest({
    request: '四级和六级阅读哪个更难？',
    selectedDifficulty: ''
  });
  const howToConsultation = resolveGenerationRequest({
    request: '如何生成一篇四级英语阅读？',
    selectedDifficulty: ''
  });
  const explanationConsultation = resolveGenerationRequest({
    request: '给我解释一下四级词汇要求。',
    selectedDifficulty: ''
  });
  const readingExplanationConsultation = resolveGenerationRequest({
    request: '给我解释一篇四级阅读的词汇要求。',
    selectedDifficulty: ''
  });
  const mixedSpecificAndGraduate = resolveGenerationRequest({
    request: '请生成一篇四级或考研阅读。',
    selectedDifficulty: ''
  });
  const generated = resolveGenerationRequest({
    request: '请生成一篇英语二阅读练习。',
    selectedDifficulty: ''
  });
  const shortGenerated = resolveGenerationRequest({
    request: '来一篇四级',
    selectedDifficulty: ''
  });
  const giveMeGenerated = resolveGenerationRequest({
    request: '给我一篇四级',
    selectedDifficulty: ''
  });

  assert.equal(comparison.targetSelectionRequested, undefined);
  assert.equal(consultation.targetSelectionRequested, undefined);
  assert.equal(howToConsultation.targetSelectionRequested, undefined);
  assert.equal(explanationConsultation.targetSelectionRequested, undefined);
  assert.equal(readingExplanationConsultation.targetSelectionRequested, undefined);
  assert.equal(mixedSpecificAndGraduate.targetSelectionRequested, undefined);
  assert.equal(generated.targetSelectionRequested, 'kaoyan2');
  assert.equal(shortGenerated.targetSelectionRequested, 'cet4');
  assert.equal(giveMeGenerated.targetSelectionRequested, 'cet4');
});

test('keeps a persisted target stable when a direct generation prompt names another track', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇六级英语阅读。',
    selectedDifficulty: 'cet4'
  });

  assert.equal(result.difficulty, 'cet6');
  assert.equal(result.targetSelectionRequested, undefined);
});

test('does not mistake ordinary English number words for an exam level', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请写一篇介绍 four ways to learn vocabulary 的英语文章。',
    selectedDifficulty: 'graduate',
    legacyLevel: 'normal'
  });

  assert.equal(result.difficulty, 'graduate');
});

test('uses the selected difficulty and the profile midpoint when the request has no explicit settings', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇关于旅行的英语阅读。',
    selectedDifficulty: 'cet6',
    legacyLevel: 'hard'
  });

  assert.equal(result.request, '请生成一篇关于旅行的英语阅读。');
  assert.equal(result.difficulty, 'cet6');
  assert.equal(result.challenge, 'stretch');
  assert.deepEqual(result.profile.wordRange, { min: 430, max: 500 });
  assert.equal(result.wordCount, 465);
  assert.equal(result.adjustment, undefined);
});

test('recognizes explicit requested lengths and clamps an under-range request with an adjustment', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请写一篇四级英语阅读，180 个单词。',
    selectedDifficulty: 'cet6',
    legacyLevel: 'normal'
  });

  assert.equal(result.difficulty, 'cet4');
  assert.equal(result.wordCount, 320);
  assert.deepEqual(result.adjustment, {
    requested: 180,
    resolved: 320,
    range: { min: 320, max: 380 }
  });
});

test('recognizes English word-count requests and clamps an over-range request', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: 'Generate a graduate reading passage of 1000 words.',
    selectedDifficulty: 'cet4',
    legacyLevel: 'easy'
  });

  assert.equal(result.difficulty, 'cet4');
  assert.equal(result.wordCount, 320);
  assert.deepEqual(result.adjustment, {
    requested: 1000,
    resolved: 320,
    range: { min: 240, max: 320 }
  });
});

test('keeps an explicit in-range word count without an adjustment', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇六级阅读，340词。',
    selectedDifficulty: 'cet4',
    legacyLevel: 'easy'
  });

  assert.equal(result.difficulty, 'cet6');
  assert.equal(result.wordCount, 340);
  assert.equal(result.adjustment, undefined);
});

test('does not let an agent tool difficulty overwrite the selected user target', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请根据我的薄弱点出一篇阅读练习。',
    selectedDifficulty: 'cet4',
    toolDifficulty: 'cet6',
    toolWordCount: 1000,
    legacyLevel: 'normal'
  });

  assert.equal(result.difficulty, 'cet4');
  assert.equal(result.targetSelectionRequested, undefined);
  assert.equal(result.wordCount, 380);
  assert.deepEqual(result.adjustment, {
    requested: 1000,
    resolved: 380,
    range: { min: 320, max: 380 }
  });
});

test('keeps explicit user requirements ahead of controlled agent tool preferences', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇四级英语阅读，320 词。',
    selectedDifficulty: 'graduate',
    toolDifficulty: 'cet6',
    toolWordCount: 480,
    legacyLevel: 'normal'
  });

  assert.equal(result.difficulty, 'cet4');
  assert.equal(result.wordCount, 320);
  assert.equal(result.adjustment, undefined);
});

test('distinguishes English I and English II while a generic graduate request follows the selected new track', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const englishOne = resolveGenerationRequest({
    request: '请生成一篇考研英语一阅读。',
    selectedDifficulty: 'graduate'
  });
  const englishTwo = resolveGenerationRequest({
    request: 'Generate a Kaoyan English II reading.',
    selectedDifficulty: 'cet4'
  });
  const generic = resolveGenerationRequest({
    request: '请生成一篇考研阅读。',
    selectedDifficulty: 'kaoyan2'
  });

  assert.equal(englishOne.difficulty, 'kaoyan1');
  assert.equal(englishOne.targetSelectionRequested, 'kaoyan1');
  assert.equal(englishTwo.difficulty, 'kaoyan2');
  assert.equal(englishTwo.targetSelectionRequested, undefined);
  assert.equal(generic.difficulty, 'kaoyan2');
});

test('uses the separately stored reading mode ahead of the legacy easy/hard presentation setting', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇英语二阅读。',
    selectedDifficulty: 'kaoyan2',
    selectedChallenge: 'standard',
    legacyLevel: 'hard'
  });

  assert.equal(result.difficulty, 'kaoyan2');
  assert.equal(result.challenge, 'standard');
});
