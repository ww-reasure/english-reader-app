import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { encode } from '@msgpack/msgpack';

import * as Build from '../scripts/build-lexicon.mjs';
import { buildCoreLexicon } from '../src/lexicon.mjs';

const source = {
  id: 'ecdict-2025-full',
  title: 'ECDICT',
  url: 'https://example.test/ecdict.csv',
  version: 'pinned',
  license: 'MIT',
  licenseUrl: 'https://example.test/license',
  retrievedAt: '2026-07-27',
  sha256: 'a'.repeat(64),
  byteSize: 1,
  purpose: 'zh-gloss',
  attribution: 'ECDICT',
  snapshotPath: 'ecdict/ecdict.csv',
  status: 'active-core'
};

test('accepts a source-pinned screened Chinese learning sense without promoting it to high', () => {
  const artifact = buildCoreLexicon({
    manifest: { schemaVersion: 1, lexiconVersion: 'screened-test', sources: [source] },
    entries: [{
      lemma: 'production',
      forms: ['production', 'productions'],
      senses: [{
        pos: 'noun',
        glossZh: '生产；制造；产量',
        quality: 'screened',
        sourceRecord: 'ecdict.csv:production',
        sourceRefs: ['ecdict-2025-full']
      }],
      layers: {},
      quality: 'screened',
      sourceRefs: ['ecdict-2025-full']
    }],
    generatedAt: '2026-07-27T00:00:00.000Z'
  });

  assert.equal(artifact.entries[0].quality, 'screened');
  assert.equal(artifact.entries[0].senses[0].glossZh, '生产；制造；产量');
});

test('screens ECDICT records into compact common Chinese learning senses and declared forms', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'production,,,"n. 生产, 制造, 产量",,,,,,,s:productions,,',
    'mike,,,"[网络] 麦克风输入",noun,,,,,,,,,',
    'amp,,,"abbr. 安培",noun,,,,,,,,,',
    'michael,,,"n. 迈克尔；男子名",noun,,,,,,,,,'
  ].join('\n');

  const entries = Build.buildScreenedEcdictEntries({
    csv,
    candidateLemmas: new Set(['production', 'mike', 'amp', 'michael']),
    sourceId: 'ecdict-2025-full'
  });

  assert.deepEqual(entries, [{
    lemma: 'production',
    forms: ['production', 'productions'],
    formProvenance: [{
      form: 'productions',
      kind: 'declared-inflection',
      policy: 'ecdict-explicit-form-v1',
      rule: 's'
    }],
    senses: [{
      pos: 'noun',
      glossZh: '生产；制造；产量',
      quality: 'screened',
      sourceRecord: 'ecdict.csv:production',
      sourceRefs: ['ecdict-2025-full']
    }],
    layers: {},
    quality: 'screened',
    sourceRefs: ['ecdict-2025-full']
  }]);
});

test('preserves common ECDICT senses grouped by part of speech', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'form,fɔːm,,"n. 类型；形式\\nvt. 形成；建立\\nadj. 正式的",noun,,,,,,,,,'
  ].join('\n');

  const [entry] = Build.buildScreenedEcdictEntries({
    csv,
    candidateLemmas: new Set(['form']),
    sourceId: 'ecdict-2025-full'
  });

  assert.deepEqual(entry?.senses, [
    { pos: 'noun', glossZh: '类型；形式', quality: 'screened', sourceRecord: 'ecdict.csv:form', sourceRefs: ['ecdict-2025-full'] },
    { pos: 'verb', glossZh: '形成；建立', quality: 'screened', sourceRecord: 'ecdict.csv:form', sourceRefs: ['ecdict-2025-full'] },
    { pos: 'adjective', glossZh: '正式的', quality: 'screened', sourceRecord: 'ecdict.csv:form', sourceRefs: ['ecdict-2025-full'] }
  ]);
  assert.equal(entry?.phonetic, 'fɔːm');
});

test('merges an ECDICT inflected-row record into its declared base lemma', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'container,,,"n. 容器, 集装箱",noun,,,,,,s:containers,,',
    'containers,,,"n. 集装箱；容器",noun,,,,,,0:container/1:s,,'
  ].join('\n');

  assert.deepEqual(Build.buildScreenedEcdictEntries({
    csv,
    candidateLemmas: new Set(['container', 'containers']),
    sourceId: 'ecdict-2025-full'
  }), [{
    lemma: 'container',
    forms: ['container', 'containers'],
    formProvenance: [{
      form: 'containers',
      kind: 'declared-inflection',
      policy: 'ecdict-explicit-form-v1',
      rule: 's'
    }],
    senses: [{
      pos: 'noun',
      glossZh: '容器；集装箱',
      quality: 'screened',
      sourceRecord: 'ecdict.csv:container',
      sourceRefs: ['ecdict-2025-full']
    }],
    layers: {},
    quality: 'screened',
    sourceRefs: ['ecdict-2025-full']
  }]);
});

test('recognizes an ECDICT base mapping that follows another exchange marker', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'weekends,,,"adv. 在每周末",adverb,,,,,,1:s3/0:weekend,,'
  ].join('\n');

  const [entry] = Build.buildScreenedEcdictEntries({
    csv,
    candidateLemmas: new Set(['weekends']),
    sourceId: 'ecdict-2025-full'
  });

  assert.equal(entry?.lemma, 'weekend');
  assert.deepEqual(entry?.forms, ['weekend', 'weekends']);
  assert.deepEqual(entry?.formProvenance, [{
    form: 'weekends',
    kind: 'declared-inflection',
    policy: 'ecdict-explicit-form-v1',
    rule: 'declared-base-map'
  }]);
});

test('keeps declared ECDICT forms while ignoring relation metadata fragments', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'weekend,,,"n. 周末",noun,,,,,,s:weekends/i:weekending/p:weekended/3:weekends/d:weekended,,'
  ].join('\n');

  const [entry] = Build.buildScreenedEcdictEntries({
    csv,
    candidateLemmas: new Set(['weekend']),
    sourceId: 'ecdict-2025-full'
  });

  assert.deepEqual(entry?.forms, ['weekend', 'weekended', 'weekending', 'weekends']);
  assert.deepEqual(entry?.formProvenance, [
    { form: 'weekended', kind: 'declared-inflection', policy: 'ecdict-explicit-form-v1', rule: 'd' },
    { form: 'weekended', kind: 'declared-inflection', policy: 'ecdict-explicit-form-v1', rule: 'p' },
    { form: 'weekending', kind: 'declared-inflection', policy: 'ecdict-explicit-form-v1', rule: 'i' },
    { form: 'weekends', kind: 'declared-inflection', policy: 'ecdict-explicit-form-v1', rule: '3' },
    { form: 'weekends', kind: 'declared-inflection', policy: 'ecdict-explicit-form-v1', rule: 's' }
  ]);
  assert.equal(entry?.forms.includes('i'), false);
  assert.equal(entry?.forms.includes('d'), false);
});

test('creates a bounded alphabetic wordfreq candidate layer with an auditable rank', () => {
  const entries = Build.buildWordfreqCandidateEntries({
    frequencies: [
      { word: 'production', zipf: 5.1 },
      { word: 'new york', zipf: 6.2 },
      { word: 'manufacturing', zipf: 4.8 },
      { word: '3d', zipf: 5.2 }
    ],
    sourceId: 'wordfreq-3.2.0-en',
    limit: 2
  });

  assert.deepEqual(entries, [
    {
      lemma: 'production',
      forms: ['production'],
      senses: [],
      layers: { lookupFrequency: [{ band: 'wordfreq-top-25000', rank: 1, zipf: 5.1, sourceRef: 'wordfreq-3.2.0-en' }] },
      quality: 'limited',
      sourceRefs: ['wordfreq-3.2.0-en']
    },
    {
      lemma: 'manufacturing',
      forms: ['manufacturing'],
      senses: [],
      layers: { lookupFrequency: [{ band: 'wordfreq-top-25000', rank: 2, zipf: 4.8, sourceRef: 'wordfreq-3.2.0-en' }] },
      quality: 'limited',
      sourceRefs: ['wordfreq-3.2.0-en']
    }
  ]);
});

test('decodes the pinned wordfreq cBpack snapshot into Zipf-ranked English tokens', () => {
  const bytes = gzipSync(encode([
    { format: 'cB', version: 1 },
    ['the'],
    [],
    ['book', 'cat']
  ]));

  assert.deepEqual(Build.decodeWordfreqSnapshot(bytes), [
    { word: 'the', zipf: 9 },
    { word: 'book', zipf: 8.98 },
    { word: 'cat', zipf: 8.98 }
  ]);
});

test('extracts only normalized single-token CET-focus candidates for ECDICT screening', () => {
  assert.deepEqual(Build.extractExamFocusCandidateLemmas({
    tracks: {
      cet4: ['production', 'New York', 'CET-4'],
      cet6: ['production', 'syllabus']
    }
  }), ['production', 'syllabus']);
});
