import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { createLexiconLoader, selectLexiconLookupCandidate } from '../src/lexicon-runtime.mjs';

function createJsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

test('prefers an audited irregular form over a same-quality surface homograph', () => {
  const entry = selectLexiconLookupCandidate([
    {
      lemma: 'its',
      forms: ['its'],
      senses: [{ pos: 'pronoun', glossZh: '它的', quality: 'screened' }],
      layers: {},
      quality: 'screened',
      sourceRefs: ['fixture-gloss']
    },
    {
      lemma: 'it',
      forms: ['it', 'its'],
      formProvenance: [{
        form: 'its',
        kind: 'generated-inflection',
        policy: 'conservative-english-inflection-v1',
        rule: 'audited-irregular'
      }],
      senses: [{ pos: 'pronoun', glossZh: '它', quality: 'screened' }],
      layers: {},
      quality: 'screened',
      sourceRefs: ['fixture-gloss']
    }
  ], 'its');

  assert.equal(entry?.lemma, 'it');
});

test('loads only the versioned lexicon assets and resolves an inflected form', async () => {
  const calls = [];
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    sources: [{
      id: 'reviewed-source',
      title: 'Reviewed source',
      url: 'https://example.test/source',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: 'e'.repeat(64),
      byteSize: 128,
      purpose: 'frequency',
      attribution: 'Fixture',
      snapshotPath: 'fixture/source.json',
      status: 'active-core'
    }]
  };
  const core = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    generatedAt: '2026-07-26T00:00:00.000Z',
    sourceIds: ['reviewed-source'],
    entryCount: 1,
    entries: [{
      lemma: 'abandon',
      forms: ['abandon', 'abandoned'],
      senses: [],
      layers: {},
      quality: 'limited',
      sourceRefs: ['reviewed-source']
    }]
  };
  const loader = createLexiconLoader({
    dataUrl: 'https://example.test/data',
    fetchFn: async (url) => {
      calls.push(url);
      if (url.endsWith('/lexicon-manifest.json')) return createJsonResponse(manifest);
      if (url.endsWith('/lexicon-core.json')) return createJsonResponse(core);
      throw new Error(`unexpected resource ${url}`);
    }
  });

  const entry = await loader.lookup('Abandoned');

  assert.equal(entry.lemma, 'abandon');
  assert.deepEqual(calls, [
    'https://example.test/data/lexicon-manifest.json',
    'https://example.test/data/lexicon-core.json',
    'https://example.test/data/exam-focus.json'
  ]);
});

test('adds the separately shipped exam focus layer without changing core frequency or creating a false core entry', async () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    sources: [{
      id: 'reviewed-source',
      title: 'Reviewed source',
      url: 'https://example.test/source',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: 'e'.repeat(64),
      byteSize: 128,
      purpose: 'frequency',
      attribution: 'Fixture',
      snapshotPath: 'fixture/source.json',
      status: 'active-core'
    }]
  };
  const core = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    generatedAt: '2026-07-26T00:00:00.000Z',
    sourceIds: ['reviewed-source'],
    entryCount: 1,
    entries: [{
      lemma: 'access',
      forms: ['access'],
      senses: [],
      layers: { frequency: [{ band: 'ngsl-2', sourceRef: 'reviewed-source' }] },
      quality: 'limited',
      sourceRefs: ['reviewed-source']
    }]
  };
  const examFocus = {
    schemaVersion: 1,
    focusVersion: 'fixture-cet.1',
    generatedAt: '2026-07-27T00:00:00.000Z',
    source: {
      id: 'public-cet-wordlists',
      sourceType: 'public-wordlist',
      useBoundary: 'exam-direction-only-not-official-truth',
      tracks: {
        cet4: { url: 'https://example.test/cet4', commit: 'a'.repeat(40), sha256: 'b'.repeat(64), byteSize: 1, rawRecordCount: 2, normalizedWordCount: 2 },
        cet6: { url: 'https://example.test/cet6', commit: 'a'.repeat(40), sha256: 'c'.repeat(64), byteSize: 1, rawRecordCount: 2, normalizedWordCount: 2 },
        'kaoyan-general': { url: 'https://example.test/graduate', commit: 'a'.repeat(40), sha256: 'd'.repeat(64), byteSize: 1, rawRecordCount: 1, normalizedWordCount: 1 }
      }
    },
    tracks: { cet4: ['access', 'rival'], cet6: ['access', 'rival'], 'kaoyan-general': ['revolt'] }
  };
  const loader = createLexiconLoader({
    dataUrl: 'https://example.test/data',
    fetchFn: async (url) => {
      if (url.endsWith('/lexicon-manifest.json')) return createJsonResponse(manifest);
      if (url.endsWith('/lexicon-core.json')) return createJsonResponse(core);
      if (url.endsWith('/exam-focus.json')) return createJsonResponse(examFocus);
      throw new Error(`unexpected resource ${url}`);
    }
  });

  const coreEntry = await loader.lookup('access');
  assert.deepEqual(coreEntry.layers.frequency, [{ band: 'ngsl-2', sourceRef: 'reviewed-source' }]);
  assert.deepEqual(coreEntry.layers.examFocus, [{
    tracks: ['cet4', 'cet6'],
    sourceRef: 'public-cet-wordlists',
    focusVersion: 'fixture-cet.1'
  }]);
  assert.deepEqual(coreEntry.sourceRefs, ['reviewed-source', 'public-cet-wordlists']);

  const focusOnly = await loader.lookup('rival');
  assert.equal(focusOnly.lemma, 'rival');
  assert.equal(focusOnly.quality, 'limited');
  assert.equal(focusOnly.layers.frequency, undefined);
  assert.deepEqual(focusOnly.layers.examFocus[0].tracks, ['cet4', 'cet6']);
});

test('resolves common generated inflections from the shipped core artifact without a fallback stemmer', async () => {
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const core = JSON.parse(readFileSync(resolve('public/data/lexicon-core.json'), 'utf8'));
  const loader = createLexiconLoader({
    dataUrl: 'https://example.test/data',
    fetchFn: async (url) => {
      if (url.endsWith('/lexicon-manifest.json')) return createJsonResponse(manifest);
      if (url.endsWith('/lexicon-core.json')) return createJsonResponse(core);
      throw new Error(`unexpected resource ${url}`);
    }
  });

  for (const [form, lemma] of Object.entries({
    students: 'student',
    treated: 'treat',
    visitors: 'visitor',
    records: 'record',
    came: 'come',
    weekends: 'weekend',
    stations: 'station',
    residents: 'resident',
    showed: 'show',
    its: 'it',
    their: 'they'
  })) {
    assert.equal((await loader.lookup(form))?.lemma, lemma, `${form} 应映射到 ${lemma}`);
  }
});

test('prefers the trusted explicit-form candidate when the shipped core has a lower-quality homograph', async () => {
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const core = JSON.parse(readFileSync(resolve('public/data/lexicon-core.json'), 'utf8'));
  const loader = createLexiconLoader({
    dataUrl: 'https://example.test/data',
    fetchFn: async (url) => {
      if (url.endsWith('/lexicon-manifest.json')) return createJsonResponse(manifest);
      if (url.endsWith('/lexicon-core.json')) return createJsonResponse(core);
      throw new Error(`unexpected resource ${url}`);
    }
  });

  for (const [form, lemma] of Object.entries({
    could: 'can',
    might: 'may',
    would: 'will'
  })) {
    const entry = await loader.lookup(form);
    assert.equal(entry?.lemma, lemma, `${form} 应优先解析到已审校的 ${lemma}`);
    assert.equal(entry?.quality, 'high', `${form} 不应被同形的 limited 词条覆盖`);
  }
});

test('prefers a screened Chinese learning sense over a limited homograph', async () => {
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'screened-priority-test',
    sources: [{
      id: 'fixture-zh',
      title: 'Fixture Chinese glossary',
      url: 'https://example.test/fixture',
      version: '1',
      license: 'MIT',
      licenseUrl: 'https://example.test/license',
      retrievedAt: '2026-07-27',
      sha256: 'f'.repeat(64),
      byteSize: 1,
      purpose: 'zh-gloss',
      attribution: 'Fixture Chinese glossary',
      snapshotPath: 'fixture.csv',
      status: 'active-core'
    }]
  };
  const core = {
    schemaVersion: 1,
    lexiconVersion: 'screened-priority-test',
    generatedAt: '2026-07-27T00:00:00.000Z',
    sourceIds: ['fixture-zh'],
    entryCount: 2,
    entries: [
      {
        lemma: 'production', forms: ['production'], senses: [], layers: {}, quality: 'limited', sourceRefs: ['fixture-zh']
      },
      {
        lemma: 'produce', forms: ['production'],
        senses: [{ pos: 'noun', glossZh: '生产；制造；产量', quality: 'screened', sourceRefs: ['fixture-zh'] }],
        layers: {}, quality: 'screened', sourceRefs: ['fixture-zh']
      }
    ]
  };
  const loader = createLexiconLoader({
    dataUrl: 'https://example.test/data',
    fetchFn: async (url) => {
      if (url.endsWith('/lexicon-manifest.json')) return createJsonResponse(manifest);
      if (url.endsWith('/lexicon-core.json')) return createJsonResponse(core);
      throw new Error(`unexpected resource ${url}`);
    }
  });

  const entry = await loader.lookup('production');

  assert.equal(entry?.lemma, 'produce');
  assert.equal(entry?.quality, 'screened');
});
