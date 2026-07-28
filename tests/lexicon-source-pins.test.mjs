import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { fetchLexiconSourceSnapshots } from '../scripts/fetch-lexicon-sources.mjs';

const root = resolve('.');
const manifestPath = resolve(root, 'public/data/lexicon-manifest.json');
const catalogPath = resolve(root, 'public/data/lexicon-source-catalog.json');
const corePath = resolve(root, 'public/data/lexicon-core.json');
const attributionPath = resolve(root, 'public/data/lexicon-ATTRIBUTION.md');

const snapshotPins = Object.freeze({
  'ngsl-1.2-stats': {
    url: 'https://static1.squarespace.com/static/64336926d7c6bb38965fdf3b/t/644e0be4ad7bae3d45b9e62a/1682836452194/NGSL_1.2_stats.csv',
    sha256: '2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44',
    byteSize: 62566,
    recordCount: 2809,
    purpose: 'frequency',
    license: 'CC BY-SA 4.0',
    status: 'active-core'
  },
  'nawl-1.2-research': {
    url: 'https://static1.squarespace.com/static/64336926d7c6bb38965fdf3b/t/643c7cf96a3ed81c74e87a01/1681685753444/NAWL_1.2_lemmatized_for_research.csv',
    sha256: 'c28ef95623d79c08a4060d6d6d51d3331115e75a18ee247caa4cc3ae5506b92e',
    byteSize: 25980,
    recordCount: 959,
    purpose: 'academic',
    license: 'CC BY-SA 4.0',
    status: 'active-core'
  },
  'ecdict-2025-full': {
    url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.csv',
    sha256: '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf',
    byteSize: 65933428,
    recordCount: 770611,
    purpose: 'zh-gloss',
    license: 'MIT',
    status: 'active-core'
  },
  'wordfreq-3.2.0-en': {
    url: 'https://raw.githubusercontent.com/rspeer/wordfreq/912caf64b657478d1dff1138efdc078947d54bb1/wordfreq/data/large_en.msgpack.gz',
    sha256: 'dffae8066b78dce0a6667cf5f58e567054f902674667090a7ac8a8a44628b05c',
    byteSize: 1494836,
    purpose: 'lookup-frequency',
    license: 'CC BY-SA 4.0',
    status: 'active-core'
  }
});

test('activates only redistributable pinned NGSL, NAWL, and audited ECDICT-full sources', () => {
  assert.equal(existsSync(manifestPath), true);
  assert.equal(existsSync(attributionPath), true, '随 APK 发布的词库应包含独立署名说明');
  const attribution = readFileSync(attributionPath, 'utf8');
  assert.match(attribution, /NGSL-derived frequency layer/);
  assert.match(attribution, /NAWL-derived academic membership/);
  assert.match(attribution, /wordfreq 3\.2\.0/);
  assert.match(attribution, /Adapted Material/);
  assert.match(attribution, /Changes:/);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const byId = new Map(manifest.sources.map(source => [source.id, source]));

  assert.deepEqual(
    manifest.sources.filter((source) => source.status === 'active-core').map((source) => source.id).sort(),
    Object.keys(snapshotPins).sort(),
    'only sources that currently feed the core may be active'
  );
  assert.ok(manifest.sources.every((source) => typeof source.licenseUrl === 'string' && source.licenseUrl));
  assert.ok(manifest.sources.every((source) => typeof source.snapshotPath === 'string' && source.snapshotPath));
  assert.ok(manifest.sources.every((source) => Number.isSafeInteger(source.byteSize) && source.byteSize > 0));

  for (const [id, expected] of Object.entries(snapshotPins)) {
    const source = byId.get(id);
    assert.ok(source, `${id} must be an active source`);
    for (const [key, value] of Object.entries(expected)) assert.equal(source[key], value, `${id}.${key}`);
    if (id === 'wordfreq-3.2.0-en') {
      assert.match(source.version, /3\.2\.0.*912caf64b657478d1dff1138efdc078947d54bb1/);
      assert.match(source.retrievedAt, /^2026-07-27$/);
      assert.match(source.snapshotPath, /^wordfreq\//);
    } else {
      assert.match(source.version, /1\.[25]|bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/);
      assert.match(source.retrievedAt, /^2026-07-26$/);
      assert.match(source.snapshotPath, /^(cefrj|ngsl|nawl|ecdict)\//);
    }
    assert.ok(source.attribution.length > 30);
    assert.equal(source.redistribution, 'permitted');
    assert.ok(source.derivativeLicense);
    assert.ok(source.changeNotice);
  }

  const cefr = byId.get('cefrj-vocabulary-profile-1.5');
  assert.equal(cefr?.status, 'reserved-not-core');
  assert.equal(cefr?.redistribution, 'not-confirmed');
  assert.match(cefr?.activationBlocker || '', /redistribution/i);
});

test('documents ECDICT mini as a fixed but blocked sample instead of promoting it to dictionary truth', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const mini = catalog.pendingSources.find(source => source.id === 'ecdict-mini-2025');

  assert.ok(mini);
  assert.equal(mini.status, 'blocked-sample-not-learning-ready');
  assert.equal(mini.url, 'https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.mini.csv');
  assert.equal(mini.sha256, '6133bcc38ccfc1ed8eaf8f52a5cb567fb78f028d079647a85b4b92a99c3cf025');
  assert.equal(mini.byteSize, 4204);
  assert.equal(mini.recordCount, 53);
  assert.equal(mini.license, 'MIT');
  assert.match(mini.reason, /53/);
  assert.ok(!manifest.sources.some(source => source.id === mini.id));
});

test('ships enough reviewed high-confidence Chinese learning senses for the 24-question calibration, without domain-tag regressions', () => {
  const core = JSON.parse(readFileSync(corePath, 'utf8'));
  const high = core.entries.filter(entry => entry.quality === 'high');
  const highFrequencyWords = ['the', 'be', 'of', 'can', 'may', 'a', 'an', 'do', 'have', 'will'];

  assert.ok(high.length >= 24, 'initial calibration needs at least 24 reviewed entries');
  assert.ok(high.every(entry => entry.senses.some(sense => typeof sense.glossZh === 'string' && sense.glossZh.trim())));
  assert.ok(high.every(entry => entry.sourceRefs.includes('ecdict-2025-full')));
  assert.ok(high.every(entry => entry.senses.every(sense => !/\[(?:医|法|化|计|经|地名|网络)\]/u.test(sense.glossZh || ''))));
  assert.ok(highFrequencyWords.every(lemma => high.some(entry => entry.lemma === lemma || entry.forms.includes(lemma))));
  assert.ok(high.some(entry => entry.layers?.academic?.some(layer => layer.sourceRef === 'nawl-1.2-research')));
  assert.ok(high.some(entry => entry.layers?.frequency?.some(layer => layer.sourceRef === 'ngsl-1.2-stats')));
});

test('fetcher refuses a changed pinned source before it writes a source snapshot', async () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'fixture',
    sources: [{
      id: 'fixture',
      title: 'Fixture',
      url: 'https://example.test/fixture.csv',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: '0'.repeat(64),
      byteSize: Buffer.byteLength('changed'),
      purpose: 'frequency',
      attribution: 'Fixture attribution',
      snapshotPath: 'fixture.csv',
      status: 'active-core'
    }]
  };
  let wrote = false;

  await assert.rejects(() => fetchLexiconSourceSnapshots({
    manifest,
    sourceDir: resolve(root, '.tmp-lexicon-source-test'),
    fetchFn: async () => ({ ok: true, async arrayBuffer() { return new TextEncoder().encode('changed').buffer; } }),
    mkdirFn: async () => {},
    writeFileFn: async () => { wrote = true; }
  }), /校验和/);

  assert.equal(wrote, false);
});
