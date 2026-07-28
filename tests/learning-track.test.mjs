import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_TARGET_TRACKS,
  LEGACY_TRACK,
  getTrackLabel,
  isSelectableTrack,
  normalizeSelectableTrack,
  normalizeStoredTrack,
  requiresTargetTrackSelection
} from '../src/learning-track.mjs';
import { getDifficultyProfile, normalizeCoveragePreference } from '../src/difficulty-profile.mjs';

test('only the four current target tracks are selectable and legacy graduate material remains identifiable', () => {
  assert.deepEqual(CURRENT_TARGET_TRACKS, ['cet4', 'cet6', 'kaoyan1', 'kaoyan2']);
  assert.equal(isSelectableTrack(LEGACY_TRACK), false);
  assert.equal(normalizeSelectableTrack('graduate'), null);
  assert.equal(normalizeStoredTrack('graduate'), 'graduate');
  assert.equal(getTrackLabel('graduate'), '考研（旧版）');
  assert.equal(getTrackLabel('kaoyan1'), '考研英语一');
  assert.equal(getTrackLabel('kaoyan2'), '考研英语二');
});

test('each current track has a separate profile and the three modes express coverage rather than a vocabulary-size claim', () => {
  const englishOne = getDifficultyProfile('kaoyan1', 'standard');
  const englishTwo = getDifficultyProfile('kaoyan2', 'standard');
  const consolidate = getDifficultyProfile('cet4', 'support');
  const benchmark = getDifficultyProfile('cet4', 'standard');
  const stretch = getDifficultyProfile('cet4', 'stretch');

  assert.notDeepEqual(englishOne.syntaxRange, englishTwo.syntaxRange);
  assert.deepEqual(consolidate.coverageRange, { min: 97, max: 98 });
  assert.deepEqual(benchmark.coverageRange, { min: 95, max: 97 });
  assert.deepEqual(stretch.coverageRange, { min: 92, max: 95 });
  assert.equal(consolidate.coverageLabel, '巩固');
  assert.equal(benchmark.coverageLabel, '对标');
  assert.equal(stretch.coverageLabel, '加压');
});

test('manual coverage stays inside the selected mode and reports a transparent adjustment', () => {
  const below = normalizeCoveragePreference('support', 90);
  const within = normalizeCoveragePreference('standard', 96);
  const above = normalizeCoveragePreference('stretch', 99);

  assert.deepEqual(below, { challenge: 'support', coverage: 97, range: { min: 97, max: 98 }, adjusted: true });
  assert.deepEqual(within, { challenge: 'standard', coverage: 96, range: { min: 95, max: 97 }, adjusted: false });
  assert.deepEqual(above, { challenge: 'stretch', coverage: 95, range: { min: 92, max: 95 }, adjusted: true });
});

test('requires an explicit current target before generation but preserves an already selected current target', () => {
  assert.equal(requiresTargetTrackSelection('', ''), true, 'fresh installs must not silently assume CET-4');
  assert.equal(requiresTargetTrackSelection('graduate', 'false'), true, 'legacy graduate is not a new-generation target');
  assert.equal(requiresTargetTrackSelection('cet4', 'true'), true, 'an explicit pending-selection flag wins over a fallback value');
  assert.equal(requiresTargetTrackSelection('cet6', ''), false, 'an existing selectable target remains a valid migrated choice');
  assert.equal(requiresTargetTrackSelection('kaoyan2', 'false'), false);
});
