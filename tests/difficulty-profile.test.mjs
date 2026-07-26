import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeArticle, formatProfileConstraints, getDifficultyProfile, normalizeGenerationRequest, validateArticle } from '../src/difficulty-profile.mjs';

test('generation settings use bounded ranges for each exam track and challenge', () => {
  const profile = getDifficultyProfile('cet6', 'stretch');
  const request = normalizeGenerationRequest({ track: 'cet6', challenge: 'stretch', wordCount: 9999 });

  assert.equal(profile.wordRange.max, 560);
  assert.equal(request.wordCount, 560);
  assert.equal(request.track, 'cet6');
  assert.equal(request.challenge, 'stretch');
});

test('article analysis measures words, sentence length and requested target words', () => {
  const result = analyzeArticle('Travel improves learning. Travel also builds curiosity!', ['travel', 'memory']);

  assert.equal(result.wordCount, 7);
  assert.equal(result.sentenceCount, 2);
  assert.equal(result.targetWordCounts.travel, 2);
  assert.equal(result.targetWordCounts.memory, 0);
});

test('validator reports measurable deviations instead of claiming a prompt met a level', () => {
  const profile = getDifficultyProfile('cet4', 'standard');
  const result = validateArticle('One short sentence.', profile, ['journey']);

  assert.equal(result.passed, false);
  assert.ok(result.deviations.some(item => item.code === 'word_count'));
  assert.ok(result.deviations.some(item => item.code === 'target_word'));
});

test('formats one authoritative prompt constraint section from a selected profile', () => {
  const constraints = formatProfileConstraints(getDifficultyProfile('cet4', 'support'));

  assert.match(constraints, /总字数必须控制在 240-320 词/);
  assert.match(constraints, /平均句长必须控制在 10-17 词/);
  assert.match(constraints, /约 5-7% 学术词/);
});
