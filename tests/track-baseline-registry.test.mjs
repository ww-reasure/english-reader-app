import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const registryPath = resolve('public/data/track-baseline-registry.json');
const CURRENT_TRACKS = ['cet4', 'cet6', 'kaoyan1', 'kaoyan2'];

const readRegistry = () => JSON.parse(readFileSync(registryPath, 'utf8'));

test('track baseline registry remains provisional until a licensable corpus is processed with the app metric schema', () => {
  const registry = readRegistry();

  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.activeForGeneration, false);
  assert.equal(registry.activeForValidator, false);
  assert.ok(registry.activationRequirements.includes('licensed-or-permitted-raw-corpus'));
  assert.ok(registry.activationRequirements.includes('same-tokenizer-and-udpipe-metric-schema'));

  for (const track of CURRENT_TRACKS) {
    const status = registry.trackStatus[track];
    assert.ok(status, `${track} requires an explicit status`);
    assert.equal(status.status, 'provisional-aggregate-only');
    assert.equal(status.rawCorpusStatus, 'not-accepted-for-app-distribution-or-build');
    assert.ok(status.notDirectlyUsableForValidator.includes('dependencyDepth'));
    assert.ok(status.notDirectlyUsableForValidator.includes('subordinateRate'));
  }
});

test('every source is auditable and aggregate research cannot be promoted to a test-text corpus', () => {
  const registry = readRegistry();
  const byId = new Map(registry.sources.map(source => [source.id, source]));

  for (const source of registry.sources) {
    for (const key of ['id', 'title', 'status', 'sourceType', 'url', 'version', 'license', 'retrievedAt', 'use', 'forbiddenUse']) {
      assert.ok(source[key], `${source.id}.${key} is required`);
    }
    assert.ok(source.forbiddenUse.includes('raw-test-text-in-apk'));
    assert.notEqual(source.status, 'active-for-validator');
  }

  const cetAggregate = byId.get('liu-et-al-2023-cet-reading-aggregate');
  assert.equal(cetAggregate.license, 'CC BY 4.0');
  assert.equal(cetAggregate.sha256, '4852cd0afbfa1e0ff4f881081477ede9d5c4b45136850e9f628e9c0f9c9bd06c');
  assert.equal(cetAggregate.derivedStatistics.cet4.academicWordCoveragePercent, 6.6);
  assert.equal(cetAggregate.derivedStatistics.cet6.academicWordCoveragePercent, 7.44);
  assert.equal(cetAggregate.derivedStatistics.cet4.passageCount, 204);
  assert.equal(cetAggregate.derivedStatistics.cet6.passageCount, 204);
  assert.equal(cetAggregate.directValidatorUse, false);

  const netemAggregate = byId.get('zhang-shi-2023-netem-reading-a-aggregate');
  assert.equal(netemAggregate.license, 'CC BY 4.0');
  assert.equal(netemAggregate.sha256, '47f0365bf51b891d6edb1ade58d90a0c856b0842c0f4af8ab5aa1a342f1793bb');
  assert.equal(netemAggregate.derivedStatistics.kaoyan1.readingATextCount, 20);
  assert.equal(netemAggregate.derivedStatistics.kaoyan2.readingATextCount, 20);
  assert.equal(netemAggregate.directValidatorUse, false);
});
