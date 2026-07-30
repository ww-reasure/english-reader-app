import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertExamFocusArtifact,
  createExamFocusIndex,
  mergeExamFocusIntoEntry
} from '../src/exam-focus.mjs';
import { createLexiconLoader } from '../src/lexicon-runtime.mjs';

function focusArtifact(overrides = {}) {
  return {
    schemaVersion: 1,
    focusVersion: '2026.07.27-cet.1',
    generatedAt: '2026-07-27T00:00:00.000Z',
    source: {
      id: 'public-cet-wordlists',
      sourceType: 'public-wordlist',
      useBoundary: 'exam-direction-only-not-official-truth',
      tracks: {
        cet4: {
          url: 'https://example.test/cet4.txt',
          commit: 'a'.repeat(40),
          sha256: 'b'.repeat(64),
          byteSize: 12,
          rawRecordCount: 3,
          normalizedWordCount: 2
        },
        cet6: {
          url: 'https://example.test/cet6.txt',
          commit: 'a'.repeat(40),
          sha256: 'c'.repeat(64),
          byteSize: 12,
          rawRecordCount: 3,
          normalizedWordCount: 2
        },
        'kaoyan-general': {
          url: 'https://example.test/kaoyan.txt',
          commit: 'a'.repeat(40),
          sha256: 'd'.repeat(64),
          byteSize: 12,
          rawRecordCount: 3,
          normalizedWordCount: 2
        }
      }
    },
    tracks: {
      cet4: ['abandon', 'access'],
      cet6: ['access', 'rival'],
      'kaoyan-general': ['revolt', 'rival']
    },
    ...overrides
  };
}

test('builds a separately versioned exam focus index without changing lexical difficulty layers', () => {
  const artifact = focusArtifact();
  assert.doesNotThrow(() => assertExamFocusArtifact(artifact));

  const index = createExamFocusIndex(artifact);
  assert.deepEqual(index.lookup('access'), ['cet4', 'cet6']);
  assert.deepEqual(index.lookup('revolt'), ['kaoyan-general']);
  assert.deepEqual(index.lookup('outside'), []);

  const baseEntry = {
    lemma: 'access',
    forms: ['access'],
    senses: [],
    layers: { frequency: [{ band: 'ngsl-2', sourceRef: 'ngsl' }] },
    quality: 'limited',
    sourceRefs: ['ngsl']
  };
  const decorated = mergeExamFocusIntoEntry(baseEntry, index.lookup('access'), artifact);

  assert.notStrictEqual(decorated, baseEntry);
  assert.deepEqual(decorated.layers.frequency, baseEntry.layers.frequency);
  assert.deepEqual(decorated.layers.examFocus, [{
    tracks: ['cet4', 'cet6'],
    sourceRef: 'public-cet-wordlists',
    focusVersion: '2026.07.27-cet.1'
  }]);
  assert.deepEqual(decorated.sourceRefs, ['ngsl', 'public-cet-wordlists']);
});

test('ships pinned public CET and graduate focus artifacts with an explicit non-official boundary', () => {
  const artifactPath = resolve('public/data/exam-focus.json');
  assert.equal(existsSync(artifactPath), true, '考试重点词表必须随应用发布');

  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.doesNotThrow(() => assertExamFocusArtifact(artifact));
  assert.equal(artifact.source.useBoundary, 'exam-direction-only-not-official-truth');
  assert.match(artifact.source.tracks.cet4.commit, /^[a-f0-9]{40}$/i);
  assert.match(artifact.source.tracks.cet6.commit, /^[a-f0-9]{40}$/i);
  assert.equal(artifact.source.tracks['kaoyan-general'].sha256, '8a88f5cc466ec18f86f389460e986530444083f5801a131693a057b6b6a5ab17');
  assert.ok(artifact.tracks.cet4.length >= 4500);
  assert.ok(artifact.tracks.cet6.length >= 3900);
  assert.equal(artifact.tracks['kaoyan-general'].length, 5044);
  assert.ok(artifact.tracks.cet4.includes('access'));
  assert.ok(artifact.tracks.cet6.includes('rival'));
  assert.ok(artifact.tracks['kaoyan-general'].includes('revolt'));
});

test('records the public wordlist as direction-only data rather than activating a pretend official corpus', () => {
  const catalog = JSON.parse(readFileSync(resolve('public/data/lexicon-source-catalog.json'), 'utf8'));
  const source = catalog.publicDirectionSources?.find(item => item.id === 'kylebing-english-vocabulary-exam');

  assert.ok(source, '公开四、六级词表必须记录在来源目录');
  assert.equal(source.status, 'active-public-direction-only');
  assert.deepEqual(source.tracks, ['cet4', 'cet6', 'kaoyan-general']);
  assert.equal(source.artifact, 'exam-focus.json');
  assert.equal(source.useBoundary, 'exam-direction-only-not-official-truth');
  assert.match(source.commit, /^[a-f0-9]{40}$/i);
});

test('overlays graduate membership at lookup time without importing source glosses', async () => {
  const manifest = JSON.parse(readFileSync(resolve('public/data/lexicon-manifest.json'), 'utf8'));
  const core = JSON.parse(readFileSync(resolve('public/data/lexicon-core.json'), 'utf8'));
  const focus = JSON.parse(readFileSync(resolve('public/data/exam-focus.json'), 'utf8'));
  const resources = {
    '/data/lexicon-manifest.json': manifest,
    '/data/lexicon-core.json': core,
    '/data/exam-focus.json': focus
  };
  const loader = createLexiconLoader({
    fetchFn: async url => ({ ok: Boolean(resources[url]), async json() { return resources[url]; } })
  });
  const revolt = await loader.lookup('revolt');

  assert.ok(revolt, '考研词必须存在于离线词典核心');
  assert.ok(revolt.layers.examFocus.some(layer => layer.tracks.includes('kaoyan-general')));
  assert.equal(revolt.sourceRefs.includes('kylebing-english-vocabulary-exam'), true);
  assert.equal(revolt.senses.some(sense => sense.sourceRef === 'kylebing-english-vocabulary-exam'), false);
});
