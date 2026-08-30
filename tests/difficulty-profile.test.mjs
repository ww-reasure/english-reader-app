import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeArticle,
  formatProfileConstraints,
  getDifficultyProfile,
  normalizeGenerationRequest,
  resolveContextDifficultyProfile,
  validateArticle
} from '../src/difficulty-profile.mjs';

test('generation settings use bounded ranges for each exam track and challenge', () => {
  const profile = getDifficultyProfile('cet6', 'stretch');
  const request = normalizeGenerationRequest({ track: 'cet6', challenge: 'stretch', wordCount: 9999 });

  assert.equal(profile.wordRange.max, 500);
  assert.equal(request.wordCount, 500);
  assert.equal(request.track, 'cet6');
  assert.equal(request.challenge, 'stretch');
});

test('uses calibrated standard article ranges without treating the tracks as one ladder', () => {
  assert.deepEqual(getDifficultyProfile('cet4', 'standard').wordRange, { min: 320, max: 380 });
  assert.deepEqual(getDifficultyProfile('cet6', 'standard').sentenceRange, { min: 19, max: 22 });
  assert.deepEqual(getDifficultyProfile('kaoyan2', 'standard').wordRange, { min: 380, max: 450 });
  assert.deepEqual(getDifficultyProfile('kaoyan1', 'standard').sentenceRange, { min: 20, max: 23 });
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

  assert.match(constraints, /硬性校验：总字数必须控制在 240-320 词/);
  assert.match(constraints, /硬性校验：平均句长必须控制在 10-17 词/);
  assert.match(constraints, /词汇方向（观察指标，不是未经校准的真题阈值）：约 5-7% 学术词/);
  assert.match(constraints, /句法方向仅记录本地依存句法指标；语料基线尚未激活，不宣称与真题等值/);
  assert.doesNotMatch(constraints, /所有要求必须同时满足/);
});

test('resolves a compact context profile only from global challenge and coverage', () => {
  const profile = resolveContextDifficultyProfile('stretch', 94);

  assert.equal(profile.key, 'context-v2:stretch:c94');
  assert.equal('track' in profile, false);
  assert.equal(profile.challenge, 'stretch');
  assert.deepEqual(profile.sentenceRange, { min: 14, max: 22 });
  assert.equal(profile.academicTarget, '适中偏高');
});

test('projects global modes into fixed one-sentence profiles independent of exam source', () => {
  assert.deepEqual(resolveContextDifficultyProfile('support').sentenceRange, { min: 8, max: 15 });
  assert.deepEqual(resolveContextDifficultyProfile('standard').sentenceRange, { min: 11, max: 19 });
  assert.deepEqual(resolveContextDifficultyProfile('stretch').sentenceRange, { min: 14, max: 22 });
  assert.deepEqual(resolveContextDifficultyProfile('stretch').coverageRange, { min: 92, max: 95 });
  assert.equal(resolveContextDifficultyProfile('unsupported').key, 'context-v2:standard:c96');
});

test('includes the learner coverage preference in a context profile identity', () => {
  const standard = resolveContextDifficultyProfile('standard', 97);
  const stretch = resolveContextDifficultyProfile('stretch', 94);

  assert.equal(standard.coverage, 97);
  assert.equal(standard.key, 'context-v2:standard:c97');
  assert.equal(stretch.coverage, 94);
  assert.equal(stretch.key, 'context-v2:stretch:c94');
});
