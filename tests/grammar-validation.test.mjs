import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { getDifficultyProfile } from '../src/difficulty-profile.mjs';
import { validateGrammarAnalysis } from '../src/grammar-validation.mjs';

const syntaxRange = {
  dependencyDepth: { min: 2, max: 5 },
  subordinateRate: { min: 0.1, max: 0.4 },
  passiveRate: { min: 0, max: 0.5 },
  nonFiniteRate: { min: 0, max: 0.5 }
};

test('validates only parser-supplied dependency metrics against a selected syntax profile', () => {
  const result = validateGrammarAnalysis({
    status: 'available',
    source: 'local',
    metrics: {
      tokenCount: 20,
      sentenceCount: 2,
      clauseRelationCount: 4,
      passivePredicateCount: 1,
      nonFiniteRelationCount: 2,
      maxDependencyDepth: 4
    }
  }, syntaxRange);

  assert.equal(result.passed, true);
  assert.equal(result.source, 'local');
  assert.equal(result.metrics.subordinateRate, 0.2);
  assert.equal(result.metrics.passiveRate, 0.5);
});

test('refuses unavailable or incomplete grammar analyses instead of inventing dependency metrics', () => {
  const unavailable = validateGrammarAnalysis({ status: 'unavailable', source: 'local', reason: 'MODEL_LOAD_FAILED', metrics: null }, syntaxRange);
  const incomplete = validateGrammarAnalysis({ status: 'available', source: 'ai_fallback', metrics: { tokenCount: 3 } }, syntaxRange);

  assert.equal(unavailable.passed, false);
  assert.deepEqual(unavailable.deviations, [{ code: 'grammar_unavailable', reason: 'MODEL_LOAD_FAILED', source: 'local' }]);
  assert.equal(incomplete.passed, false);
  assert.ok(incomplete.deviations.some(item => item.code === 'grammar_metrics'));
});

test('reports a measurable syntax deviation without calling it an exam-equivalence score', () => {
  const result = validateGrammarAnalysis({
    status: 'available', source: 'local', metrics: {
      tokenCount: 10, sentenceCount: 1, clauseRelationCount: 0,
      passivePredicateCount: 0, nonFiniteRelationCount: 0, maxDependencyDepth: 1
    }
  }, syntaxRange);

  assert.equal(result.passed, false);
  assert.ok(result.deviations.some(item => item.code === 'dependency_depth'));
  assert.ok(result.deviations.some(item => item.code === 'subordinate_rate'));
});

test('a provisional registry profile preserves parser metrics and reports strategy-range drift as observations', () => {
  const registry = JSON.parse(readFileSync(resolve('public/data/track-baseline-registry.json'), 'utf8'));
  const profile = getDifficultyProfile('cet4', 'standard');
  const result = validateGrammarAnalysis({
    status: 'available', source: 'local', metrics: {
      tokenCount: 10, sentenceCount: 1, clauseRelationCount: 0,
      passivePredicateCount: 0, nonFiniteRelationCount: 0, maxDependencyDepth: 9
    }
  }, profile.syntaxRange);

  assert.equal(registry.activeForValidator, false);
  assert.equal(profile.syntaxValidation.status, 'provisional');
  assert.equal(profile.syntaxValidation.enforcement, 'observe');
  assert.equal(profile.syntaxRange.validation.status, 'provisional');
  assert.equal(result.passed, true);
  assert.equal(result.status, 'observed');
  assert.equal(result.enforcement, 'observe');
  assert.equal(result.metrics.maxDependencyDepth, 9);
  assert.ok(result.deviations.some(item => item.code === 'dependency_depth' && item.severity === 'observation'));
  assert.ok(result.deviations.some(item => item.code === 'subordinate_rate' && item.severity === 'observation'));
});

test('a provisional profile still fails closed without complete parser evidence', () => {
  const syntaxRange = getDifficultyProfile('cet4', 'standard').syntaxRange;
  const unavailable = validateGrammarAnalysis({
    status: 'unavailable', source: 'local', reason: 'MODEL_LOAD_FAILED', metrics: null
  }, syntaxRange);
  const incomplete = validateGrammarAnalysis({
    status: 'available', source: 'local', metrics: { tokenCount: 8 }
  }, syntaxRange);

  assert.equal(unavailable.passed, false);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(incomplete.passed, false);
  assert.equal(incomplete.status, 'unavailable');
});

test('an activated corpus baseline keeps syntax range deviations as hard failures', () => {
  const profile = getDifficultyProfile('cet4', 'standard');
  const activatedRange = {
    ...profile.syntaxRange,
    validation: {
      ...profile.syntaxRange.validation,
      status: 'active',
      enforcement: 'required',
      baselineId: 'licensed-cet4-udpipe-fixture',
      baselineVersion: 'fixture-1'
    }
  };
  const result = validateGrammarAnalysis({
    status: 'available', source: 'local', metrics: {
      tokenCount: 10, sentenceCount: 1, clauseRelationCount: 0,
      passivePredicateCount: 0, nonFiniteRelationCount: 0, maxDependencyDepth: 9
    }
  }, activatedRange);

  assert.equal(result.passed, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.enforcement, 'required');
  assert.ok(result.deviations.some(item => item.code === 'dependency_depth' && item.severity === 'failure'));
});
