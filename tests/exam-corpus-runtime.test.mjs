import assert from 'node:assert/strict';
import test from 'node:test';

import { createExamCorpusService } from '../src/exam-corpus-runtime.mjs';

function indexArtifact() {
  return {
    schemaVersion: 1,
    corpusVersion: 'fixture.app.1',
    generatedAt: '2026-07-29T14:09:03.000Z',
    source: {
      id: 'lazynote-exam-corpus',
      url: 'https://english-exam.lazynote.cn/exam-words/',
      termsUrl: 'https://english-exam.lazynote.cn/terms/',
      usage: 'non-commercial-personal-learning',
      sourceVersion: 'fixture',
      manifestSha256: 'a'.repeat(64)
    },
    scoring: {
      passageWeight: 1,
      questionStemWeight: 0.2,
      components: { weightedFrequency: 0.65, paperCoverage: 0.2, yearCoverage: 0.15 }
    },
    tracks: {
      cet4: { wordCount: 0, paperCount: 73, yearCount: 11 },
      cet6: { wordCount: 0, paperCount: 73, yearCount: 11 },
      'kaoyan-general': { wordCount: 1, paperCount: 46, yearCount: 29 }
    },
    words: {
      cet4: {},
      cet6: {},
      'kaoyan-general': {
        author: {
          priorityScore: 80,
          priorityTier: 'core',
          priorityLabel: '真题高频核心',
          weightedFrequency: 10,
          rank: 1,
          syllabusStatus: 'in_syllabus',
          cefrReported: 'B1',
          counts: { sentenceTotal: 10, passage: 8, questionStem: 2, other: 0, papers: 4, years: 3 },
          questionTypeCounts: {},
          sourceUrl: 'https://english-exam.lazynote.cn/kaoyan/words/author/',
          exampleShard: 'kaoyan-general-a'
        }
      }
    }
  };
}

function shardedIndexManifest() {
  const legacy = indexArtifact();
  return {
    schemaVersion: 2,
    corpusVersion: legacy.corpusVersion,
    generatedAt: legacy.generatedAt,
    source: legacy.source,
    scoring: legacy.scoring,
    tracks: {
      cet4: { ...legacy.tracks.cet4, wordCount: 1, path: 'exam-corpus-tracks/cet4.json', sha256: 'b'.repeat(64), byteSize: 100 },
      cet6: { ...legacy.tracks.cet6, path: 'exam-corpus-tracks/cet6.json', sha256: 'c'.repeat(64), byteSize: 80 },
      'kaoyan-general': { ...legacy.tracks['kaoyan-general'], path: 'exam-corpus-tracks/kaoyan-general.json', sha256: 'd'.repeat(64), byteSize: 120 }
    }
  };
}

function trackArtifact(track, words) {
  return {
    schemaVersion: 1,
    corpusVersion: 'fixture.app.1',
    track,
    words
  };
}

test('preloads only the selected score track and reuses it for lookup', async () => {
  const manifest = shardedIndexManifest();
  const author = indexArtifact().words['kaoyan-general'].author;
  const responses = {
    '/data/exam-corpus-index.json': manifest,
    '/data/exam-corpus-tracks/cet4.json': trackArtifact('cet4', { author })
  };
  const calls = [];
  const service = createExamCorpusService({
    fetchFn: async url => {
      calls.push(url);
      return { ok: Boolean(responses[url]), async json() { return responses[url]; } };
    }
  });

  assert.equal(typeof service.preload, 'function');
  assert.equal(await service.preload('cet4'), true);
  assert.equal((await service.lookup('author', 'cet4'))?.priorityScore, 80);
  assert.equal((await service.lookup('author', 'cet4'))?.priorityScore, 80);
  assert.deepEqual(calls, [
    '/data/exam-corpus-index.json',
    '/data/exam-corpus-tracks/cet4.json'
  ]);
});

test('loads one score index and maps both graduate targets to the transparent shared frequency', async () => {
  const calls = [];
  const service = createExamCorpusService({
    fetchFn: async url => {
      calls.push(url);
      return { ok: true, async json() { return indexArtifact(); } };
    }
  });

  const englishOne = await service.lookup('Author', 'kaoyan1');
  const englishTwo = await service.lookup('author', 'kaoyan2');

  assert.equal(englishOne.priorityLabel, '真题高频核心');
  assert.equal(englishTwo.priorityScore, 80);
  assert.equal(calls.filter(url => url.endsWith('exam-corpus-index.json')).length, 1);
});

test('loads a shard lazily and filters graduate examples by their real English I or II source', async () => {
  const index = indexArtifact();
  const responses = {
    '/data/exam-corpus-index.json': index,
    '/data/exam-examples/manifest.json': {
      schemaVersion: 1,
      corpusVersion: index.corpusVersion,
      shards: { 'kaoyan-general-a': { path: 'kaoyan-general-a.json', recordCount: 2, sha256: 'b'.repeat(64), byteSize: 100 } }
    },
    '/data/exam-examples/kaoyan-general-a.json': {
      schemaVersion: 1,
      corpusVersion: index.corpusVersion,
      track: 'kaoyan-general',
      bucket: 'a',
      items: {
        author: [
          { id: 'one', lemma: 'author', statsTrack: 'kaoyan-general', examTrack: 'kaoyan1', targetForm: 'author', sentenceEn: 'The author presents a careful argument about education policy.', translationZh: '作者提出了关于教育政策的审慎论点。', year: 2024, sourceKind: 'passage' },
          { id: 'two', lemma: 'author', statsTrack: 'kaoyan-general', examTrack: 'kaoyan2', targetForm: 'author', sentenceEn: 'What does the author suggest about public libraries today?', translationZh: '作者对当今公共图书馆有何建议？', year: 2023, sourceKind: 'question' }
        ]
      }
    }
  };
  const service = createExamCorpusService({
    fetchFn: async url => ({ ok: Boolean(responses[url]), async json() { return responses[url]; } })
  });

  assert.deepEqual((await service.getExamples('author', 'kaoyan1')).map(row => row.id), ['one']);
  assert.deepEqual((await service.getExamples('author', 'kaoyan2')).map(row => row.id), ['two']);
});

test('fails open when the optional exam corpus is unavailable', async () => {
  const service = createExamCorpusService({ fetchFn: async () => ({ ok: false, status: 404 }) });

  assert.equal(await service.lookup('author', 'cet4'), null);
  assert.deepEqual(await service.lookupAll('author'), {});
  assert.deepEqual(await service.getExamples('author', 'cet4'), []);
});
