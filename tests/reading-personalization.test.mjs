import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArticleGenerationPolicy, buildReadingPersonalization } from '../src/reading-personalization.mjs';

test('uses an initial calibration for recommendation and evidence collection, not an unsupported hard coverage claim', () => {
  const value = buildReadingPersonalization({ calibrationStatus: 'calibrated', challenge: 'stretch', coverage: '94' });

  assert.equal(value.mode, 'evidence_collecting');
  assert.equal(value.targetCoverage, null);
  assert.equal(value.recommendedCoverage, 94);
  assert.match(value.prompt, /初测/);
  assert.doesNotMatch(value.prompt, /94%/);
});

test('keeps skipped and new users in a transparent conservative mode without a fake coverage promise', () => {
  for (const calibrationStatus of ['new', 'skipped', 'legacy', '']) {
    const value = buildReadingPersonalization({ calibrationStatus, challenge: 'stretch', coverage: '92' });
    assert.equal(value.mode, 'uncalibrated_conservative');
    assert.equal(value.challenge, 'support');
    assert.equal(value.targetCoverage, null);
    assert.doesNotMatch(value.prompt, /\d+%/);
  }
});

test('provides one consistent personalization contract to the generator and validator', () => {
  const policy = buildArticleGenerationPolicy({
    calibrationStatus: 'calibrated',
    challenge: 'standard',
    coverage: 96
  });

  assert.equal(policy.personalization.mode, 'evidence_collecting');
  assert.equal(policy.validationOptions.personalization, policy.personalization);
  assert.equal(policy.validationOptions.calibrationStatus, 'calibrated');
  assert.equal(policy.validationOptions.targetCoverage, null);
  assert.equal(policy.validationOptions.recommendedCoverage, 96);
});
