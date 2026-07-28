import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER,
  createCalibrationSession,
  getNextCalibrationQuestion,
  submitCalibrationAnswer
} from '../src/calibration-engine.mjs';

const corePath = resolve('public/data/lexicon-core.json');

function reviewedEntries(tier, count) {
  return Array.from({ length: count }, (_, index) => ({
    lemma: `tier-${tier}-word-${index + 1}`,
    gloss: `词义 ${tier}-${index + 1}`,
    frequencyTier: tier,
    frequencyBand: `ngsl-${tier}`,
    quality: 'high'
  }));
}

test('uses only adequately reviewed NGSL tiers as stratified calibration anchors and reports a partial bank honestly', () => {
  const bank = [
    ...reviewedEntries(1, CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER),
    ...reviewedEntries(2, CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER),
    ...reviewedEntries(3, CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER - 1),
    ...reviewedEntries(4, CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER),
    ...reviewedEntries(5, 0)
  ];

  // Keep the test's data safely above the 24-item total minimum without
  // falsely making the missing NGSL-3 layer eligible for an anchor.
  bank.push(...reviewedEntries(6, CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER + 2));

  let session = createCalibrationSession({ bank, seed: 12 });
  assert.equal(session.stratification.status, 'partial');
  assert.deepEqual(session.stratification.anchorTiers, [1, 2, 4, 6]);
  assert.equal(session.stratification.tierCounts[3], CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER - 1);
  assert.equal(session.stratification.insufficientTiers.includes(3), true);

  for (const expectedTier of [1, 2, 4, 6]) {
    const question = getNextCalibrationQuestion(session);
    assert.equal(question.frequencyTier, expectedTier);
    session = submitCalibrationAnswer(session, { lemma: question.lemma, outcome: 'unsure' });
  }
});

test('ships enough independently reviewed high-quality entries for every NGSL calibration tier', () => {
  const core = JSON.parse(readFileSync(corePath, 'utf8'));
  const counts = Object.fromEntries([1, 2, 3, 4, 5, 6].map(tier => [`ngsl-${tier}`, 0]));

  for (const entry of core.entries) {
    if (entry.quality !== 'high') continue;
    for (const layer of entry.layers?.frequency || []) {
      if (Object.hasOwn(counts, layer.band)) counts[layer.band] += 1;
    }
  }

  for (const tier of [1, 2, 3, 4, 5, 6]) {
    assert.ok(
      counts[`ngsl-${tier}`] >= CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER,
      `NGSL ${tier} needs at least ${CALIBRATION_MIN_ITEMS_PER_FREQUENCY_TIER} reviewed calibration entries; found ${counts[`ngsl-${tier}`]}`
    );
  }
});

test('keeps the a/an calibration gloss neutral instead of encoding a context-specific article rule as a lexical meaning', () => {
  const core = JSON.parse(readFileSync(corePath, 'utf8'));
  const article = core.entries.find(entry => entry.lemma === 'a');
  const gloss = article?.senses?.find(sense => sense.quality === 'high')?.glossZh || '';

  assert.equal(gloss, '不定冠词（表示泛指）');
  assert.doesNotMatch(gloss, /(?:辅音|元音|一个)/u);
});
