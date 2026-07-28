import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { encode } from '@msgpack/msgpack';

import * as Build from '../scripts/build-lexicon.mjs';

const ECDICT_HEADER = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';

test('refuses to build when a pinned source snapshot does not match its manifest checksum', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-'));
  const sourceDir = join(root, 'sources');
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, 'sample.txt'), 'changed source bytes', 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    sources: [{
      id: 'sample-source',
      title: 'Sample source',
      url: 'https://example.test/sample.txt',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: '0'.repeat(64),
      byteSize: Buffer.byteLength('changed source bytes'),
      purpose: 'frequency',
      attribution: 'Sample source',
      snapshotPath: 'sample.txt',
      status: 'active-core'
    }]
  };

  await assert.rejects(
    () => Build.verifySourceSnapshots?.({ manifest, sourceDir }),
    /校验和/
  );
});

test('refuses to build when a checksum-matched snapshot has a different audited byte size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-'));
  const sourceDir = join(root, 'sources');
  const sourceBytes = 'pinned source bytes';
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, 'sample.txt'), sourceBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    sources: [{
      id: 'sample-source',
      title: 'Sample source',
      url: 'https://example.test/sample.txt',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      byteSize: Buffer.byteLength(sourceBytes) + 1,
      purpose: 'frequency',
      attribution: 'Sample source',
      snapshotPath: 'sample.txt',
      status: 'active-core'
    }]
  };

  await assert.rejects(
    () => Build.verifySourceSnapshots?.({ manifest, sourceDir }),
    /字节数/
  );
});

test('builds a core artifact only after every pinned source snapshot verifies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-'));
  const sourceDir = join(root, 'sources');
  const sourceBytes = 'pinned source bytes';
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, 'sample.txt'), sourceBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'test',
    sources: [{
      id: 'sample-frequency',
      title: 'Sample frequency source',
      url: 'https://example.test/sample.txt',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      byteSize: Buffer.byteLength(sourceBytes),
      purpose: 'frequency',
      attribution: 'Sample source',
      snapshotPath: 'sample.txt',
      status: 'active-core'
    }]
  };

  const artifact = await Build.buildLexiconArtifact?.({
    manifest,
    sourceDir,
    entries: [{
      lemma: 'sample',
      forms: ['sample'],
      senses: [],
      layers: {
        frequency: [{ band: 'core', sourceRef: 'sample-frequency' }]
      },
      quality: 'limited',
      sourceRefs: ['sample-frequency']
    }],
    generatedAt: '2026-07-26T00:00:00.000Z'
  });

  assert.equal(artifact?.lexiconVersion, 'test');
  assert.deepEqual(artifact?.sourceIds, ['sample-frequency']);
  assert.equal(artifact?.entries?.[0]?.lemma, 'sample');
});

test('writes a reproducible core artifact from a manifest and seed file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-'));
  const sourceDir = join(root, 'sources');
  const sourceBytes = 'pinned source bytes';
  const manifestPath = join(root, 'manifest.json');
  const entriesPath = join(root, 'entries.json');
  const outputPath = join(root, 'lexicon-core.json');
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, 'sample.txt'), sourceBytes, 'utf8');

  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    lexiconVersion: 'test',
    sources: [{
      id: 'sample-frequency',
      title: 'Sample frequency source',
      url: 'https://example.test/sample.txt',
      version: '1',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      retrievedAt: '2026-07-26',
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      byteSize: Buffer.byteLength(sourceBytes),
      purpose: 'frequency',
      attribution: 'Sample source',
      snapshotPath: 'sample.txt',
      status: 'active-core'
    }]
  }), 'utf8');
  await writeFile(entriesPath, JSON.stringify({
    entries: [{
      lemma: 'sample',
      forms: ['sample'],
      senses: [],
      layers: {
        frequency: [{ band: 'core', sourceRef: 'sample-frequency' }]
      },
      quality: 'limited',
      sourceRefs: ['sample-frequency']
    }]
  }), 'utf8');

  const artifact = await Build.buildLexiconFile?.({
    manifestPath,
    entriesPath,
    outputPath,
    sourceDir,
    generatedAt: '2026-07-26T00:00:00.000Z'
  });

  assert.equal(artifact?.entryCount, 1);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), artifact);
});

test('builds a conservative frequency-only NGSL and academic-only NAWL core before overlaying reviewed senses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-generated-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nthe,1,87.85,60910\nresearch,423,60.1,100\n';
  const nawlBytes = 'coherent\nresearch,researches\n';
  const ecdictBytes = `${ECDICT_HEADER}\nresearch,,,"研究",noun\n`;
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'generated-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-26', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' }
    ]
  };

  const artifact = await Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: {
      entries: [{
        lemma: 'research',
        forms: ['research', 'researches'],
        senses: [{ pos: 'noun', glossZh: '研究；调查', quality: 'high', sourceRecord: 'ecdict.csv:research', sourceRefs: ['ecdict-2025-full'] }],
        layers: {},
        quality: 'high',
        sourceRefs: ['ecdict-2025-full']
      }]
    },
    generatedAt: '2026-07-26T00:00:00.000Z'
  });

  assert.equal(artifact.entryCount, 3);
  const byLemma = new Map(artifact.entries.map(entry => [entry.lemma, entry]));
  assert.equal(byLemma.get('the').quality, 'limited');
  assert.deepEqual(byLemma.get('the').layers.frequency, [{ band: 'ngsl-1', rank: 1, sourceRef: 'ngsl-1.2-stats' }]);
  assert.equal(byLemma.get('coherent').quality, 'limited');
  assert.deepEqual(byLemma.get('coherent').layers.academic, [{ membership: 'nawl-1.2', sourceRef: 'nawl-1.2-research' }]);
  assert.equal(byLemma.get('research').quality, 'high');
  assert.deepEqual(byLemma.get('research').forms, ['research', 'researches']);
  assert.equal(byLemma.get('research').layers.frequency[0].rank, 423);
  assert.equal(byLemma.get('research').layers.academic[0].sourceRef, 'nawl-1.2-research');
});

test('merges wordfreq lookup candidates with screened ECDICT learning senses without altering NGSL difficulty layers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-wordfreq-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nthe,1,87.85,60910\n';
  const nawlBytes = 'research\n';
  const ecdictBytes = [
    ECDICT_HEADER,
    'production,,,"n. 生产, 制造, 产量",noun,,,,,,s:productions,,'
  ].join('\n');
  const wordfreqBytes = gzipSync(encode([
    { format: 'cB', version: 1 },
    ['the'],
    [],
    ['production']
  ]));
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await mkdir(join(sourceDir, 'wordfreq'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');
  await writeFile(join(sourceDir, 'wordfreq', 'large_en.msgpack.gz'), wordfreqBytes);

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'wordfreq-generated-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-27', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-27', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-27', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' },
      { id: 'wordfreq-3.2.0-en', title: 'wordfreq English', url: 'https://example.test/wordfreq', version: '3.2.0', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-27', sha256: hash(wordfreqBytes), byteSize: Buffer.byteLength(wordfreqBytes), purpose: 'lookup-frequency', attribution: 'wordfreq fixture', snapshotPath: 'wordfreq/large_en.msgpack.gz', status: 'active-core' }
    ]
  };

  const artifact = await Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: { entries: [] },
    generatedAt: '2026-07-27T00:00:00.000Z'
  });
  const byLemma = new Map(artifact.entries.map(entry => [entry.lemma, entry]));

  assert.equal(byLemma.get('the').quality, 'limited');
  assert.deepEqual(byLemma.get('the').layers.frequency, [{ band: 'ngsl-1', rank: 1, sourceRef: 'ngsl-1.2-stats' }]);
  assert.deepEqual(byLemma.get('the').layers.lookupFrequency, [{ band: 'wordfreq-top-25000', rank: 1, zipf: 9, sourceRef: 'wordfreq-3.2.0-en' }]);
  assert.deepEqual(byLemma.get('production'), {
    lemma: 'production',
    forms: ['production', 'productions'],
    formProvenance: [{ form: 'productions', kind: 'declared-inflection', policy: 'ecdict-explicit-form-v1', rule: 's' }],
    senses: [{ pos: 'noun', glossZh: '生产；制造；产量', quality: 'screened', sourceRecord: 'ecdict.csv:production', sourceRefs: ['ecdict-2025-full'] }],
    layers: { lookupFrequency: [{ band: 'wordfreq-top-25000', rank: 2, zipf: 8.98, sourceRef: 'wordfreq-3.2.0-en' }] },
    quality: 'screened',
    sourceRefs: ['wordfreq-3.2.0-en', 'ecdict-2025-full']
  });
});

test('screens a CET-focus candidate without treating its focus tag as a difficulty layer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-exam-focus-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nthe,1,87.85,60910\n';
  const nawlBytes = 'research\n';
  const ecdictBytes = [
    ECDICT_HEADER,
    'syllabus,,,"n. 教学大纲；课程纲要",noun'
  ].join('\n');
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');
  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'exam-focus-candidate-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-27', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-27', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-27', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' }
    ]
  };

  const artifact = await Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: { entries: [] },
    examFocusLemmas: ['syllabus'],
    generatedAt: '2026-07-27T00:00:00.000Z'
  });
  const entry = artifact.entries.find(value => value.lemma === 'syllabus');

  assert.equal(entry?.quality, 'screened');
  assert.equal(entry?.senses[0]?.glossZh, '教学大纲；课程纲要');
  assert.deepEqual(entry?.layers, {});
  assert.deepEqual(entry?.sourceRefs, ['ecdict-2025-full']);
});

test('adds checksum-pinned CEFR-J levels and source POS only to exact core lemmas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-cefrj-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nabandon,100,70,100\nresearch,423,60.1,100\n';
  const nawlBytes = 'research\n';
  const ecdictBytes = `${ECDICT_HEADER}\nreviewed,,,"已审核",noun\n`;
  const cefrBytes = [
    'headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold',
    'abandon,verb,B1,"News, lifestyles and current affairs",,',
    'research,noun,B2,,,',
    'ice cream,noun,A2,,,',
    'a.m./A.M./am/AM,adverb,A1,,,'
  ].join('\n');
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await mkdir(join(sourceDir, 'cefrj'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');
  await writeFile(join(sourceDir, 'cefrj', 'profile.csv'), cefrBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'cefr-generated-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-26', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' },
      { id: 'cefrj-vocabulary-profile-1.5', title: 'CEFR-J', url: 'https://example.test/cefrj', version: '1.5', license: 'Citation required', licenseUrl: 'https://example.test/cefrj-license', retrievedAt: '2026-07-26', sha256: hash(cefrBytes), byteSize: Buffer.byteLength(cefrBytes), purpose: 'cefr', attribution: 'CEFR-J fixture attribution', snapshotPath: 'cefrj/profile.csv', status: 'active-core' }
    ]
  };

  const artifact = await Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: { entries: [] },
    generatedAt: '2026-07-26T00:00:00.000Z'
  });
  const byLemma = new Map(artifact.entries.map(entry => [entry.lemma, entry]));

  assert.deepEqual(byLemma.get('abandon').layers.cefr, [{
    level: 'B1',
    pos: 'verb',
    sourceRef: 'cefrj-vocabulary-profile-1.5'
  }]);
  assert.deepEqual(byLemma.get('research').layers.cefr, [{
    level: 'B2',
    pos: 'noun',
    sourceRef: 'cefrj-vocabulary-profile-1.5'
  }]);
  assert.equal(byLemma.has('ice cream'), false, 'CEFR-J multiword records must not create a new core lemma');
  assert.equal(byLemma.has('am'), false, 'slash-delimited CEFR-J aliases must not be split into unproven forms');
});

test('does not promote NAWL comma variants into default coverage forms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-nawl-forms-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nacidic,100,70,100\n';
  const nawlBytes = 'acidic,acidics\n';
  const ecdictBytes = `${ECDICT_HEADER}\nreviewed,,,"已审核",noun\n`;
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'nawl-form-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-26', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' }
    ]
  };

  const artifact = await Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: { entries: [] },
    generatedAt: '2026-07-26T00:00:00.000Z'
  });
  const acidic = artifact.entries.find(entry => entry.lemma === 'acidic');

  assert.deepEqual(acidic.forms, ['acidic']);
  assert.equal(acidic.forms.includes('acidics'), false);
});

test('rejects an audited high seed whose cited ECDICT record is absent from the pinned full snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-ecdict-record-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nclaimed,100,70,100\n';
  const nawlBytes = 'claimed\n';
  const ecdictBytes = `${ECDICT_HEADER}\nlisted,,,"存在",verb\n`;
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'ecdict-record-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-26', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' }
    ]
  };

  await assert.rejects(() => Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: {
      entries: [{
        lemma: 'claimed',
        forms: ['claimed'],
        senses: [{
          pos: 'verb',
          glossZh: '声称',
          quality: 'high',
          sourceRecord: 'ecdict.csv:claimed',
          sourceRefs: ['ecdict-2025-full']
        }],
        layers: {},
        quality: 'high',
        sourceRefs: ['ecdict-2025-full']
      }]
    },
    generatedAt: '2026-07-26T00:00:00.000Z'
  }), /ECDICT.*记录/);
});

test('does not treat a checksum-pinned but reserved NGSL snapshot as an active core input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-reserved-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = 'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\nthe,1,87.85,60910\n';
  const nawlBytes = 'research\n';
  const ecdictBytes = `${ECDICT_HEADER}\nreviewed,,,"已审核",noun\n`;
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'reserved-input-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'reserved-not-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-26', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' }
    ]
  };

  await assert.rejects(
    () => Build.buildCoreLexiconFromSnapshots({
      manifest,
      sourceDir,
      seed: { entries: [] },
      generatedAt: '2026-07-26T00:00:00.000Z'
    }),
    /生成核心词库需要已固定的 NGSL 1\.2/
  );
});

test('adds only auditable conservative inflections for NGSL lemmas that otherwise ship as lemma-only entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'english-reader-lexicon-inflections-'));
  const sourceDir = join(root, 'sources');
  const ngslBytes = [
    'Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)',
    'student,100,70,100',
    'treat,101,70,100',
    'visitor,102,70,100',
    'record,103,70,100',
    'come,104,70,100',
    'happy,105,70,100',
    'about,106,70,100',
    'admit,107,70,100',
    'control,108,70,100',
    'open,109,70,100',
    'prefer,110,70,100'
  ].join('\n');
  const nawlBytes = 'research,researches\n';
  const ecdictBytes = `${ECDICT_HEADER}\nreviewed,,,"\u5df2\u5ba1\u6838",noun\n`;
  const hash = value => createHash('sha256').update(value).digest('hex');
  await mkdir(join(sourceDir, 'ngsl'), { recursive: true });
  await mkdir(join(sourceDir, 'nawl'), { recursive: true });
  await mkdir(join(sourceDir, 'ecdict'), { recursive: true });
  await writeFile(join(sourceDir, 'ngsl', 'stats.csv'), ngslBytes, 'utf8');
  await writeFile(join(sourceDir, 'nawl', 'research.csv'), nawlBytes, 'utf8');
  await writeFile(join(sourceDir, 'ecdict', 'full.csv'), ecdictBytes, 'utf8');

  const manifest = {
    schemaVersion: 1,
    lexiconVersion: 'generated-inflections-test',
    sources: [
      { id: 'ngsl-1.2-stats', title: 'NGSL', url: 'https://example.test/ngsl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(ngslBytes), byteSize: Buffer.byteLength(ngslBytes), purpose: 'frequency', attribution: 'NGSL', snapshotPath: 'ngsl/stats.csv', status: 'active-core' },
      { id: 'nawl-1.2-research', title: 'NAWL', url: 'https://example.test/nawl', version: '1.2', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', retrievedAt: '2026-07-26', sha256: hash(nawlBytes), byteSize: Buffer.byteLength(nawlBytes), purpose: 'academic', attribution: 'NAWL', snapshotPath: 'nawl/research.csv', status: 'active-core' },
      { id: 'ecdict-2025-full', title: 'ECDICT', url: 'https://example.test/ecdict', version: 'pinned', license: 'MIT', licenseUrl: 'https://example.test/licenses/mit', retrievedAt: '2026-07-26', sha256: hash(ecdictBytes), byteSize: Buffer.byteLength(ecdictBytes), purpose: 'zh-gloss', attribution: 'ECDICT', snapshotPath: 'ecdict/full.csv', status: 'active-core' }
    ]
  };

  const artifact = await Build.buildCoreLexiconFromSnapshots({
    manifest,
    sourceDir,
    seed: { entries: [] },
    generatedAt: '2026-07-26T00:00:00.000Z'
  });
  const byLemma = new Map(artifact.entries.map(entry => [entry.lemma, entry]));

  assert.ok(byLemma.get('student').forms.includes('students'));
  assert.ok(byLemma.get('treat').forms.includes('treated'));
  assert.ok(byLemma.get('visitor').forms.includes('visitors'));
  assert.ok(byLemma.get('record').forms.includes('records'));
  assert.ok(byLemma.get('come').forms.includes('came'));
  assert.equal(byLemma.get('student').quality, 'limited');
  assert.deepEqual(byLemma.get('student').sourceRefs, ['ngsl-1.2-stats']);
  assert.deepEqual(byLemma.get('student').formProvenance, [{
    form: 'students',
    kind: 'generated-inflection',
    policy: 'conservative-english-inflection-v1',
    rule: 'regular-s'
  }]);
  assert.ok(!byLemma.get('happy').forms.includes('happiness'), '不应把派生词伪装为曲折词形');
  assert.deepEqual(byLemma.get('about').forms, ['about'], '词性未知的功能词不应被猜测为复数');
  assert.ok(byLemma.get('admit').forms.includes('admitted'));
  assert.ok(byLemma.get('admit').forms.includes('admitting'));
  assert.ok(!byLemma.get('admit').forms.includes('admited'));
  assert.ok(byLemma.get('control').forms.includes('controlled'));
  assert.ok(byLemma.get('control').forms.includes('controlling'));
  assert.ok(!byLemma.get('open').forms.includes('openned'));
  assert.ok(byLemma.get('open').forms.includes('opened'));
  assert.ok(byLemma.get('prefer').forms.includes('preferred'));
  assert.ok(byLemma.get('prefer').forms.includes('preferring'));
});
