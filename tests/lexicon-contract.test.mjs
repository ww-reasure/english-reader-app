import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import * as Lexicon from '../src/lexicon.mjs';

function activeSourceFixture(overrides = {}) {
  return {
    id: 'active-fixture',
    title: 'Active fixture',
    url: 'https://example.test/active-fixture.csv',
    version: '1',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    retrievedAt: '2026-07-26',
    sha256: 'a'.repeat(64),
    byteSize: 128,
    purpose: 'frequency',
    attribution: 'Active fixture attribution',
    snapshotPath: 'fixture/active-fixture.csv',
    status: 'active-core',
    ...overrides
  };
}

test('requires every active manifest source to pin a license URL, snapshot path, and exact byte size', () => {
  for (const field of ['licenseUrl', 'snapshotPath', 'byteSize']) {
    const source = activeSourceFixture();
    delete source[field];

    assert.throws(() => Lexicon.assertLexiconManifest({
      schemaVersion: 1,
      lexiconVersion: '0.1.0',
      sources: [source]
    }), new RegExp(field));
  }

  assert.throws(() => Lexicon.assertLexiconReleaseManifest({
    schemaVersion: 1,
    lexiconVersion: '0.1.0',
    sources: [activeSourceFixture({ byteSize: 0 })]
  }), /byteSize/);
});

test('requires active sources to declare redistribution evidence and derivative obligations', () => {
  const source = activeSourceFixture();

  assert.throws(() => Lexicon.assertLexiconReleaseManifest({
    schemaVersion: 1,
    lexiconVersion: '0.1.0',
    sources: [source]
  }), /redistribution/);
});

test('requires source and license declarations to use absolute web URLs', () => {
  for (const [field, value] of [
    ['url', 'not-a-url'],
    ['licenseUrl', '/licenses/by-4.0']
  ]) {
    assert.throws(() => Lexicon.assertLexiconManifest({
      schemaVersion: 1,
      lexiconVersion: '0.1.0',
      sources: [activeSourceFixture({ [field]: value })]
    }), new RegExp(field));
  }
});

test('keeps incomplete OEWN sources and CEFR-J redistribution-uncertain data reserved', () => {
  for (const [id, purpose] of [
    ['oewn-2025-entries-a', 'lexeme'],
    ['oewn-2025-verb-possession', 'definition']
  ]) {
    assert.throws(() => Lexicon.assertLexiconManifest({
      schemaVersion: 1,
      lexiconVersion: '0.1.0',
      sources: [activeSourceFixture({ id, purpose })]
    }), /预留来源/);

    assert.doesNotThrow(() => Lexicon.assertLexiconManifest({
      schemaVersion: 1,
      lexiconVersion: '0.1.0',
      sources: [activeSourceFixture({ id, purpose, status: 'reserved-not-core' })]
    }));
  }

  assert.doesNotThrow(() => Lexicon.assertLexiconManifest({
    schemaVersion: 1,
    lexiconVersion: '0.1.0',
    sources: [activeSourceFixture({
      id: 'cefrj-vocabulary-profile-1.5',
      purpose: 'cefr',
      status: 'reserved-not-core'
    })]
  }));
});

test('rejects a lexicon source without an immutable checksum', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '0.1.0',
    sources: [activeSourceFixture({
      id: 'example-source',
      title: 'Example source',
      url: 'https://example.test/source.txt',
      version: '2026.01',
      sha256: undefined
    })]
  };

  assert.throws(() => Lexicon.assertLexiconManifest(manifest), /sha256/);
});

test('rejects a source checksum that is not a SHA-256 digest', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '0.1.0',
    sources: [activeSourceFixture({
      id: 'example-source',
      title: 'Example source',
      url: 'https://example.test/source.txt',
      version: '2026.01',
      sha256: 'checksum-not-verified'
    })]
  };

  assert.throws(() => Lexicon.assertLexiconManifest(manifest), /SHA-256/);
});

test('rejects a manifest without a versioned lexicon identifier', () => {
  const manifest = {
    schemaVersion: 1,
    sources: [activeSourceFixture({
      id: 'example-source',
      title: 'Example source',
      url: 'https://example.test/source.txt',
      version: '2026.01'
    })]
  };

  assert.throws(() => Lexicon.assertLexiconManifest(manifest), /lexiconVersion/);
});

test('rejects duplicate source identifiers in a manifest', () => {
  const source = activeSourceFixture({
    id: 'same-source',
    title: 'Example source',
    url: 'https://example.test/source.txt',
    version: '2026.01'
  });

  assert.throws(() => Lexicon.assertLexiconManifest({
    schemaVersion: 1,
    lexiconVersion: '0.1.0',
    sources: [source, { ...source }]
  }), /重复/);
});

test('builds a deterministic core artifact with only declared sources', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-frequency',
      title: 'Reviewed frequency fixture',
      url: 'https://example.test/frequency.csv',
      sha256: 'a'.repeat(64),
      snapshotPath: 'fixture/frequency.csv'
    }), activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      url: 'https://example.test/definition.yaml',
      sha256: 'b'.repeat(64),
      byteSize: 256,
      purpose: 'definition',
      snapshotPath: 'fixture/definition.yaml'
    })]
  };
  const entry = {
    lemma: 'abandon',
    forms: ['abandoned', 'abandon'],
    senses: [{
      pos: 'verb',
      definitionEn: 'forsake, leave behind',
      quality: 'limited',
      sourceRefs: ['reviewed-definition']
    }],
    layers: {
      frequency: [{ band: 'ngsl-3', rank: 1001, sourceRef: 'reviewed-frequency' }]
    },
    quality: 'limited',
    sourceRefs: ['reviewed-frequency', 'reviewed-definition']
  };

  const artifact = Lexicon.buildCoreLexicon?.({
    manifest,
    entries: [entry],
    generatedAt: '2026-07-26T00:00:00.000Z'
  });

  assert.deepEqual(artifact, {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    generatedAt: '2026-07-26T00:00:00.000Z',
    sourceIds: ['reviewed-definition', 'reviewed-frequency'],
    entryCount: 1,
    entries: [{
      ...entry,
      forms: ['abandon', 'abandoned']
    }]
  });
});

test('requires a normalized lemma for every core entry', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      purpose: 'definition',
      sha256: 'b'.repeat(64),
      byteSize: 256,
      snapshotPath: 'fixture/definition.yaml'
    })]
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [{
      lemma: ' ',
      forms: ['sample'],
      senses: [{
        pos: 'noun',
        definitionEn: 'a fixture',
        quality: 'limited',
        sourceRefs: ['reviewed-definition']
      }],
      layers: {},
      quality: 'limited',
      sourceRefs: ['reviewed-definition']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /lemma/);
});

test('rejects duplicate normalized lemmas in a core artifact', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      purpose: 'definition',
      sha256: 'b'.repeat(64),
      byteSize: 256,
      snapshotPath: 'fixture/definition.yaml'
    })]
  };
  const entry = {
    lemma: 'sample',
    forms: ['sample'],
    senses: [{
      pos: 'noun',
      definitionEn: 'a fixture',
      quality: 'limited',
      sourceRefs: ['reviewed-definition']
    }],
    layers: {},
    quality: 'limited',
    sourceRefs: ['reviewed-definition']
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [entry, { ...entry }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /重复.*lemma/);
});

test('rejects a high-quality entry without a verified Chinese learning gloss', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      purpose: 'definition',
      sha256: 'b'.repeat(64),
      byteSize: 256,
      snapshotPath: 'fixture/definition.yaml'
    })]
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [{
      lemma: 'abandon',
      forms: ['abandon'],
      senses: [{
        pos: 'verb',
        definitionEn: 'forsake, leave behind',
        quality: 'high',
        sourceRefs: ['reviewed-definition']
      }],
      layers: {},
      quality: 'high',
      sourceRefs: ['reviewed-definition']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /glossZh/);
});

test('rejects a high-quality Chinese gloss without a dedicated Chinese-gloss source', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      purpose: 'definition',
      sha256: '3'.repeat(64),
      byteSize: 256,
      snapshotPath: 'fixture/definition.yaml'
    })]
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [{
      lemma: 'abandon',
      forms: ['abandon'],
      senses: [{
        pos: 'verb',
        definitionEn: 'forsake, leave behind',
        glossZh: '抛弃；舍弃',
        quality: 'high',
        sourceRefs: ['reviewed-definition']
      }],
      layers: {},
      quality: 'high',
      sourceRefs: ['reviewed-definition']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /中文释义来源/);
});

test('rejects a CEFR layer whose active source is not declared as CEFR data', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      purpose: 'definition',
      sha256: 'c'.repeat(64),
      byteSize: 256,
      snapshotPath: 'fixture/definition.yaml'
    })]
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [{
      lemma: 'abandon',
      forms: ['abandon'],
      senses: [],
      layers: {
        cefr: [{ level: 'B1', sourceRef: 'reviewed-definition' }]
      },
      quality: 'limited',
      sourceRefs: ['reviewed-definition']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /CEFR.*未声明为 cefr/i);
});

test('rejects a dictionary sense whose source is not declared for definitions', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-frequency',
      title: 'Reviewed frequency fixture',
      sha256: 'f'.repeat(64),
      snapshotPath: 'fixture/frequency.csv'
    })]
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [{
      lemma: 'abandon',
      forms: ['abandon'],
      senses: [{
        pos: 'verb',
        definitionEn: 'forsake, leave behind',
        quality: 'limited',
        sourceRefs: ['reviewed-frequency']
      }],
      layers: {},
      quality: 'limited',
      sourceRefs: ['reviewed-frequency']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /释义层来源/);
});

test('requires each entry source summary to include its sense and layer sources', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-frequency',
      title: 'Reviewed frequency fixture',
      sha256: '1'.repeat(64),
      snapshotPath: 'fixture/frequency.csv'
    }), activeSourceFixture({
      id: 'reviewed-definition',
      title: 'Reviewed definition fixture',
      purpose: 'definition',
      sha256: '2'.repeat(64),
      byteSize: 256,
      snapshotPath: 'fixture/definition.yaml'
    })]
  };

  assert.throws(() => Lexicon.buildCoreLexicon({
    manifest,
    entries: [{
      lemma: 'abandon',
      forms: ['abandon'],
      senses: [{
        pos: 'verb',
        definitionEn: 'forsake, leave behind',
        quality: 'limited',
        sourceRefs: ['reviewed-definition']
      }],
      layers: {
        frequency: [{ band: 'ngsl-3', rank: 1001, sourceRef: 'reviewed-frequency' }]
      },
      quality: 'limited',
      sourceRefs: ['reviewed-frequency']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /来源汇总/);
});

test('ships a traceable manifest instead of treating legacy app data as a source of truth', () => {
  const manifestPath = resolve('public/data/lexicon-manifest.json');
  assert.equal(existsSync(manifestPath), true, '词库来源清单必须随应用发布');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.doesNotThrow(() => Lexicon.assertLexiconManifest(manifest));
  assert.match(manifest.generatedAt || '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(manifest.sources.every((source) => source.id !== 'legacy-dict-5000'));
  assert.ok(manifest.sources.every((source) => source.id !== 'legacy-exam-words'));
});

test('ships a core-first artifact that declares its limits and source references', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const seed = JSON.parse(readFileSync(resolve('public/data/lexicon-core.seed.json'), 'utf8'));
  const corePath = resolve('public/data/lexicon-core.json');
  assert.equal(existsSync(corePath), true, '核心词库必须随应用发布');

  const core = JSON.parse(readFileSync(corePath, 'utf8'));
  const knownSourceIds = new Set(manifest.sources.map((source) => source.id));

  assert.equal(core.schemaVersion, 1);
  assert.equal(core.lexiconVersion, manifest.lexiconVersion);
  assert.equal(core.entryCount, core.entries.length);
  assert.ok(core.entries.every((entry) => entry.quality !== 'rejected'));
  assert.ok(core.entries.every((entry) => entry.sourceRefs.every((sourceId) => knownSourceIds.has(sourceId))));
  const highByLemma = new Map(core.entries.filter((entry) => entry.quality === 'high').map((entry) => [entry.lemma, entry]));
  assert.ok(core.entryCount >= 3700, '核心产物必须包含 NGSL/NAWL 的受限覆盖基础');
  assert.equal(highByLemma.size, seed.entries.length, '审核种子中的每个高可信词应被完整带入核心产物');
  for (const seedEntry of seed.entries) {
    const coreEntry = highByLemma.get(seedEntry.lemma);
    assert.ok(coreEntry, `核心产物缺少审核词条 ${seedEntry.lemma}`);
    assert.equal(coreEntry.quality, 'high');
    assert.ok(coreEntry.senses.some((sense) => sense.glossZh === seedEntry.senses[0].glossZh));
  }
});

test('keeps CEFR-J out of the shipped core until its redistribution permission is explicit', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const core = JSON.parse(readFileSync(resolve('public/data/lexicon-core.json'), 'utf8'));
  const reservedIds = [
    'oewn-2025-entries-a',
    'oewn-2025-verb-possession'
  ];

  for (const id of reservedIds) {
    const source = manifest.sources.find((candidate) => candidate.id === id);
    assert.ok(source, `${id} must retain its pinned provenance declaration`);
    assert.equal(source.status, 'reserved-not-core');
    assert.ok(source.snapshotPath);
    assert.ok(source.licenseUrl);
    assert.ok(Number.isSafeInteger(source.byteSize) && source.byteSize > 0);
    assert.ok(!core.sourceIds.includes(id), `${id} must not affect the active core artifact`);
  }
  const cefr = manifest.sources.find((candidate) => candidate.id === 'cefrj-vocabulary-profile-1.5');
  assert.equal(cefr?.status, 'reserved-not-core');
  assert.equal(cefr?.purpose, 'cefr');
  assert.ok(!core.sourceIds.includes('cefrj-vocabulary-profile-1.5'));
  const cefrLayers = core.entries.flatMap((entry) => entry.layers?.cefr || []);
  assert.equal(cefrLayers.length, 0);
  assert.ok(core.entries.every((entry) => !Object.hasOwn(entry.layers || {}, 'examFocus')));
});

test('rejects a shipped core artifact when an entry references an undeclared source', () => {
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const core = JSON.parse(readFileSync(resolve('public/data/lexicon-core.json'), 'utf8'));
  core.entries[0].sourceRefs = ['not-declared'];

  assert.equal(typeof Lexicon.assertCoreLexiconArtifact, 'function');
  assert.throws(() => Lexicon.assertCoreLexiconArtifact(core, manifest), /未声明来源/);
});

test('rejects legacy domain-tag glosses for high-frequency regression words', () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: '2026.07.26-core.1',
    sources: [activeSourceFixture({
      id: 'reviewed-gloss',
      title: 'Reviewed gloss fixture',
      url: 'https://example.test/reviewed-gloss.json',
      version: '1',
      sha256: 'd'.repeat(64),
      purpose: 'definition',
      snapshotPath: 'fixture/reviewed-gloss.json'
    })]
  };

  for (const lemma of ['the', 'be', 'of', 'can', 'may']) {
    assert.throws(() => Lexicon.buildCoreLexicon({
      manifest,
      entries: [{
        lemma,
        forms: [lemma],
        senses: [{
          pos: 'function',
          definitionEn: 'fixture',
          glossZh: '[医] 不应作为常用释义',
          quality: 'high',
          sourceRefs: ['reviewed-gloss']
        }],
        layers: {},
        quality: 'high',
        sourceRefs: ['reviewed-gloss']
      }],
      generatedAt: '2026-07-26T00:00:00.000Z'
    }), /领域标签/);
  }
});

test('keeps blocked sources out of the core while activating audited NGSL, NAWL, and ECDICT layers', () => {
  const catalogPath = resolve('public/data/lexicon-source-catalog.json');
  assert.equal(existsSync(catalogPath), true, '词库来源目录必须随应用发布');

  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const plannedIds = new Set(catalog.pendingSources.map((source) => source.id));
  const plannedRoles = new Set(catalog.pendingSources.map((source) => source.role));
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const core = JSON.parse(readFileSync(resolve('public/data/lexicon-core.json'), 'utf8'));

  assert.deepEqual([...plannedRoles].sort(), ['exam-focus', 'zh-gloss-candidate']);
  assert.ok(plannedIds.has('ecdict-mini-2025'));
  assert.ok(['target-focus-cet4', 'target-focus-cet6', 'target-focus-kaoyan1', 'target-focus-kaoyan2']
    .every((id) => plannedIds.has(id)));
  assert.ok(catalog.pendingSources.every((source) => source.status !== 'active'));
  assert.ok(core.sourceIds.every((sourceId) => !plannedIds.has(sourceId)));
  assert.ok(['ngsl-1.2-stats', 'nawl-1.2-research', 'cefrj-vocabulary-profile-1.5', 'ecdict-2025-full']
    .every((id) => manifest.sources.some((source) => source.id === id)));
  assert.ok(['ngsl-1.2-stats', 'nawl-1.2-research', 'ecdict-2025-full']
    .every((id) => core.sourceIds.includes(id)));
  assert.ok(!core.sourceIds.includes('cefrj-vocabulary-profile-1.5'));
  assert.ok(core.entryCount >= 3700, 'NGSL/NAWL 应生成保守词汇覆盖基础，而非只留下数十条审核词');
});
