import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExamCorpusIndexArtifact,
  calculateTrackPriorities,
  corpusTrackForTarget,
  createExamCorpusIndex,
  weightedExamOccurrences
} from '../src/exam-corpus.mjs';

function word(lemma, counts, overrides = {}) {
  return {
    lemma,
    track: 'cet4',
    rank: 1,
    cefrReported: 'B1',
    syllabusStatus: 'in_syllabus',
    counts: {
      sentenceTotal: counts.passage + counts.questionStem + (counts.other || 0),
      passage: counts.passage,
      questionStem: counts.questionStem,
      other: counts.other || 0,
      papers: counts.papers,
      years: counts.years
    },
    questionTypeCounts: {},
    sourceUrl: `https://english-exam.lazynote.cn/cet4/words/${lemma}/`,
    ...overrides
  };
}

test('downweights question stems before ranking exam vocabulary', () => {
  const author = word('author', { passage: 43, questionStem: 201, papers: 59, years: 11 });
  const passageWord = word('research', { passage: 100, questionStem: 0, papers: 45, years: 9 });

  assert.equal(weightedExamOccurrences(author), 83.2);
  assert.equal(weightedExamOccurrences(passageWord), 100);

  const priorities = calculateTrackPriorities([author, passageWord]);
  assert.ok(priorities.get('research').priorityScore > priorities.get('author').priorityScore);
});

test('keeps uncovered syllabus words separate from words observed in real tests', () => {
  const observed = word('access', { passage: 8, questionStem: 0, papers: 2, years: 2 });
  const uncovered = word('affixation', { passage: 0, questionStem: 0, papers: 0, years: 0 }, {
    rank: 2,
    syllabusStatus: 'uncovered'
  });

  const priorities = calculateTrackPriorities([observed, uncovered]);
  assert.equal(priorities.get('affixation').priorityScore, 0);
  assert.equal(priorities.get('affixation').priorityTier, 'uncovered');
  assert.equal(priorities.get('affixation').priorityLabel, '考纲未见');
  assert.notEqual(priorities.get('access').priorityTier, 'uncovered');
});

test('uses one transparent graduate frequency track without inventing English I or II counts', () => {
  assert.equal(corpusTrackForTarget('kaoyan1'), 'kaoyan-general');
  assert.equal(corpusTrackForTarget('kaoyan2'), 'kaoyan-general');
  assert.equal(corpusTrackForTarget('graduate'), 'kaoyan-general');
  assert.equal(corpusTrackForTarget('cet6'), 'cet6');
});

test('validates and indexes a versioned exam corpus without treating reported CEFR as dictionary truth', () => {
  const artifact = {
    schemaVersion: 1,
    corpusVersion: '2026-07-29-v2.app.1',
    generatedAt: '2026-07-29T14:09:03.000Z',
    source: {
      id: 'lazynote-exam-corpus',
      url: 'https://english-exam.lazynote.cn/exam-words/',
      termsUrl: 'https://english-exam.lazynote.cn/terms/',
      usage: 'non-commercial-personal-learning',
      sourceVersion: '2026-07-29-v2',
      manifestSha256: 'a'.repeat(64)
    },
    scoring: {
      passageWeight: 1,
      questionStemWeight: 0.2,
      components: { weightedFrequency: 0.65, paperCoverage: 0.2, yearCoverage: 0.15 }
    },
    tracks: {
      cet4: { wordCount: 1, paperCount: 73, yearCount: 11 },
      cet6: { wordCount: 0, paperCount: 73, yearCount: 11 },
      'kaoyan-general': { wordCount: 0, paperCount: 46, yearCount: 29 }
    },
    words: {
      cet4: {
        found: {
          priorityScore: 88,
          priorityTier: 'core',
          priorityLabel: '真题高频核心',
          syllabusStatus: 'in_syllabus',
          cefrReported: 'A1',
          counts: { sentenceTotal: 20, passage: 18, questionStem: 2, other: 0, papers: 8, years: 5 },
          exampleShard: 'cet4-f'
        }
      },
      cet6: {},
      'kaoyan-general': {}
    }
  };

  assert.doesNotThrow(() => assertExamCorpusIndexArtifact(artifact));
  const index = createExamCorpusIndex(artifact);
  assert.equal(index.lookup('FOUND', 'cet4').priorityScore, 88);
  assert.equal(index.lookup('found', 'cet4').cefrReported, 'A1');
  assert.equal(index.lookup('found', 'cet4').dictionaryLevel, undefined);

  const broken = structuredClone(artifact);
  broken.source.termsUrl = 'https://english-exam.lazynote.cn/';
  assert.throws(() => assertExamCorpusIndexArtifact(broken), /termsUrl/);
});
