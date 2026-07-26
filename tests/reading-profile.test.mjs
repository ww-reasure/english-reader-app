import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReadingProfile } from '../src/reading-profile.mjs';

test('reading profile reports observable performance instead of a vocabulary-size estimate', () => {
  const profile = buildReadingProfile([
    { wordCount: 320, elapsedSeconds: 160, comprehensionCorrect: 4, comprehensionTotal: 5, explicitLookups: 6, confidence: 4 },
    { wordCount: 400, elapsedSeconds: 272, comprehensionCorrect: 3, comprehensionTotal: 5, explicitLookups: 12, confidence: 3 }
  ]);

  assert.equal(profile.comprehensionAccuracy, 70);
  assert.equal(profile.averageWpm, 100);
  assert.equal(profile.vocabularyEstimate, undefined);
  assert.equal(profile.recommendedTrack, 'cet4');
});
