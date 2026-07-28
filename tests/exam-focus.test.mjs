import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertExamFocusArtifact,
  createExamFocusIndex,
  mergeExamFocusIntoEntry
} from '../src/exam-focus.mjs';

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
        }
      }
    },
    tracks: {
      cet4: ['abandon', 'access'],
      cet6: ['access', 'rival']
    },
    ...overrides
  };
}

test('builds a separately versioned CET focus index without changing lexical difficulty layers', () => {
  const artifact = focusArtifact();
  assert.doesNotThrow(() => assertExamFocusArtifact(artifact));

  const index = createExamFocusIndex(artifact);
  assert.deepEqual(index.lookup('access'), ['cet4', 'cet6']);
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

test('ships a pinned public CET focus artifact with an explicit non-official boundary', () => {
  const artifactPath = resolve('public/data/exam-focus.json');
  assert.equal(existsSync(artifactPath), true, '考试重点词表必须随应用发布');

  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.doesNotThrow(() => assertExamFocusArtifact(artifact));
  assert.equal(artifact.source.useBoundary, 'exam-direction-only-not-official-truth');
  assert.match(artifact.source.tracks.cet4.commit, /^[a-f0-9]{40}$/i);
  assert.match(artifact.source.tracks.cet6.commit, /^[a-f0-9]{40}$/i);
  assert.ok(artifact.tracks.cet4.length >= 4500);
  assert.ok(artifact.tracks.cet6.length >= 3900);
  assert.ok(artifact.tracks.cet4.includes('access'));
  assert.ok(artifact.tracks.cet6.includes('rival'));
});

test('records the public wordlist as direction-only data rather than activating a pretend official corpus', () => {
  const catalog = JSON.parse(readFileSync(resolve('public/data/lexicon-source-catalog.json'), 'utf8'));
  const source = catalog.publicDirectionSources?.find(item => item.id === 'kylebing-english-vocabulary-cet');

  assert.ok(source, '公开四、六级词表必须记录在来源目录');
  assert.equal(source.status, 'active-public-direction-only');
  assert.deepEqual(source.tracks, ['cet4', 'cet6']);
  assert.equal(source.artifact, 'exam-focus.json');
  assert.equal(source.useBoundary, 'exam-direction-only-not-official-truth');
  assert.match(source.commit, /^[a-f0-9]{40}$/i);
});
