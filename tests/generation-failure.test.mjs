import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGenerationFailure,
  normalizeGenerationFailure,
  safeGenerationFailureMessage
} from '../src/components/generation-failure.mjs';

const fallbackGeneration = Object.freeze({
  request: '根据我的薄弱点生成一篇英语阅读。',
  difficulty: 'cet4',
  challenge: 'standard',
  wordCount: 320
});

test('creates a retryable validation failure without retaining a draft body', () => {
  const failure = createGenerationFailure({
    code: 'ARTICLE_VALIDATION_FAILED',
    summary: '文章未通过难度校验：字数为 221（要求 320-420 词）。',
    message: 'private draft body must not be displayed'
  }, fallbackGeneration, '城市公园');

  assert.equal(failure.reason, 'validation_failed');
  assert.equal(failure.message, '文章未通过难度校验：字数为 221（要求 320-420 词）。');
  assert.deepEqual(failure.generation, fallbackGeneration);
  assert.equal(failure.topic, '城市公园');
  assert.doesNotMatch(JSON.stringify(failure), /private draft body/);
});

test('turns an arbitrary generation exception into a generic retryable failure', () => {
  const failure = createGenerationFailure(new Error('provider diagnostic: api-key=should-not-appear'), fallbackGeneration, '旅行');

  assert.equal(failure.reason, 'generation_failed');
  assert.equal(failure.message, '文章定制暂时失败，请重新生成。');
  assert.deepEqual(failure.generation, fallbackGeneration);
  assert.doesNotMatch(JSON.stringify(failure), /api-key/);
  assert.equal(safeGenerationFailureMessage(new Error('provider diagnostic: api-key=should-not-appear')), '文章定制暂时失败，请重新生成。');
});

test('adds a fallback generation specification to tool failures so the retry card can work', () => {
  const failure = normalizeGenerationFailure({
    message: 'upstream tool diagnostic should not be displayed',
    reason: 'tool_error'
  }, fallbackGeneration, '教育');

  assert.equal(failure.reason, 'tool_error');
  assert.equal(failure.message, '文章定制暂时失败，请重新生成。');
  assert.deepEqual(failure.generation, fallbackGeneration);
  assert.equal(failure.topic, '教育');
  assert.doesNotMatch(JSON.stringify(failure), /upstream tool diagnostic/);
});

test('keeps a locally produced validation retry specification over a generic fallback', () => {
  const localGeneration = {
    request: '根据当前错误率生成一篇六级阅读。',
    difficulty: 'cet6',
    challenge: 'stretch',
    wordCount: 500
  };
  const failure = normalizeGenerationFailure({
    message: '文章未通过难度校验：平均句长为 9（要求 16-25 词）。',
    reason: 'validation_failed',
    generation: localGeneration,
    topic: '学习策略'
  }, fallbackGeneration, '教育');

  assert.equal(failure.message, '文章未通过难度校验：平均句长为 9（要求 16-25 词）。');
  assert.deepEqual(failure.generation, localGeneration);
  assert.equal(failure.topic, '学习策略');
});
