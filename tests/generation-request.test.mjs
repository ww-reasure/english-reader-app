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

test('explicit exam cues override the selected difficulty and map the legacy challenge', async () => {
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
  assert.equal(cet4.challenge, 'support');
  assert.equal(cet6.difficulty, 'cet6');
  assert.equal(cet6.challenge, 'stretch');
  assert.equal(graduate.difficulty, 'graduate');
  assert.equal(graduate.challenge, 'standard');
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
  assert.deepEqual(result.profile.wordRange, { min: 450, max: 560 });
  assert.equal(result.wordCount, 505);
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
    range: { min: 320, max: 420 }
  });
});

test('recognizes English word-count requests and clamps an over-range request', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: 'Generate a graduate reading passage of 1000 words.',
    selectedDifficulty: 'cet4',
    legacyLevel: 'easy'
  });

  assert.equal(result.difficulty, 'graduate');
  assert.equal(result.wordCount, 460);
  assert.deepEqual(result.adjustment, {
    requested: 1000,
    resolved: 460,
    range: { min: 340, max: 460 }
  });
});

test('keeps an explicit in-range word count without an adjustment', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请生成一篇六级阅读，420词。',
    selectedDifficulty: 'cet4',
    legacyLevel: 'easy'
  });

  assert.equal(result.difficulty, 'cet6');
  assert.equal(result.wordCount, 420);
  assert.equal(result.adjustment, undefined);
});

test('uses controlled agent tool preferences only when the user did not specify a difficulty or length', async () => {
  const { resolveGenerationRequest } = await loadResolver();
  const result = resolveGenerationRequest({
    request: '请根据我的薄弱点出一篇阅读练习。',
    selectedDifficulty: 'cet4',
    toolDifficulty: 'cet6',
    toolWordCount: 1000,
    legacyLevel: 'normal'
  });

  assert.equal(result.difficulty, 'cet6');
  assert.equal(result.wordCount, 500);
  assert.deepEqual(result.adjustment, {
    requested: 1000,
    resolved: 500,
    range: { min: 380, max: 500 }
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
