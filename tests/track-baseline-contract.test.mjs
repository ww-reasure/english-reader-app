import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  validateTrackBaselineRegistry,
  validateTrackFocusCatalog
} from '../scripts/track-baseline-contract.mjs';

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const registry = () => readJson('public/data/track-baseline-registry.json');
const catalog = () => readJson('public/data/lexicon-source-catalog.json');

test('the shipped target-track baseline remains explicitly disabled and only permits derived-statistics activation', () => {
  const currentRegistry = registry();
  const report = validateTrackBaselineRegistry(currentRegistry);

  assert.equal(report.ok, true);
  assert.equal(report.activationState, 'disabled');
  assert.equal(currentRegistry.corpusAdmissionPolicy.shipRawExamTextInApk, false);
  assert.equal(currentRegistry.corpusAdmissionPolicy.acceptedBuildOutput, 'derived-statistics-only');
  assert.ok(currentRegistry.corpusAdmissionPolicy.requiredEvidence.includes('immutable-source-snapshot-and-sha256'));
  assert.ok(currentRegistry.corpusAdmissionPolicy.requiredEvidence.includes('same-tokenizer-and-udpipe-metric-schema'));
});

test('target-focus catalog entries cannot become a word layer before the audited registry is activated', () => {
  const report = validateTrackFocusCatalog(catalog(), registry());

  assert.equal(report.ok, true);
  assert.equal(report.activationState, 'disabled');
  assert.deepEqual(report.blockedTracks.sort(), ['cet4', 'cet6', 'kaoyan1', 'kaoyan2']);
});

test('an active registry without a licensed immutable derived-only artifact is rejected', () => {
  const invalid = readJson('tests/fixtures/track-baseline-invalid-activation.json');
  const report = validateTrackBaselineRegistry(invalid);

  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.code === 'active_track_missing_derived_artifact'));
  assert.ok(report.errors.some((error) => error.code === 'active_track_missing_eligible_use'));
});

test('a synthetic derived-only fixture documents the minimum reproducible activation record', () => {
  const fixture = readJson('tests/fixtures/track-baseline-derived-only.fixture.json');
  const report = validateTrackBaselineRegistry(fixture);

  assert.equal(report.ok, true);
  assert.equal(report.activationState, 'active');
});
