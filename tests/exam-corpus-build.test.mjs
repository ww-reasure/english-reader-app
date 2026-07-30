import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildExamCorpusArtifacts,
  deriveStableExampleId,
  normalizeExamExample,
  selectRepresentativeExamples
} from '../scripts/build-exam-corpus.mjs';

function example(id, sourceKind, year, overrides = {}) {
  return {
    id,
    lemma: 'author',
    statsTrack: 'cet4',
    examTrack: 'cet4',
    targetForm: 'author',
    sentenceEn: `The author explains this important social change in a clear way ${id}.`,
    translationZh: `作者清楚地解释了这一重要的社会变化（${id}）。`,
    year,
    paperId: `paper-${year}-${id}`,
    paperLabel: `${year} 四级`,
    questionType: 'readingMultipleChoice',
    sourceKind,
    positionLabel: sourceKind === 'question' ? '题干' : '文章原文',
    cefrReported: 'B1',
    sourceUrl: 'https://english-exam.lazynote.cn/cet4/words/author/',
    ...overrides
  };
}

function word(lemma, track, counts, overrides = {}) {
  return {
    lemma,
    track,
    rank: 1,
    cefrReported: 'B1',
    syllabusStatus: counts.sentenceTotal ? 'in_syllabus' : 'uncovered',
    counts,
    questionTypeCounts: {},
    sourceUrl: `https://english-exam.lazynote.cn/${track === 'kaoyan-general' ? 'kaoyan' : track}/words/${lemma}/`,
    ...overrides
  };
}

function sourceManifest() {
  return {
    schemaVersion: 1,
    datasetVersion: '2026-07-29-v2',
    generatedAt: '2026-07-29T14:09:03Z',
    source: {
      name: '懒笔记真题单词',
      url: 'https://english-exam.lazynote.cn/exam-words/',
      termsUrl: 'https://english-exam.lazynote.cn/terms/'
    },
    coverage: {
      tracks: {
        cet4: { papers: 73, years: '2015-2025', wordCount: 1 },
        cet6: { papers: 73, years: '2015-2025', wordCount: 1 },
        'kaoyan-general': { papers: 46, years: '1998-2026', wordCount: 1 }
      }
    },
    files: {
      'words.jsonl.gz': { records: 3, sha256: 'b'.repeat(64) },
      'examples.jsonl.gz': { records: 1, sha256: 'c'.repeat(64) }
    },
    usage: 'non-commercial-personal-learning'
  };
}

test('rejects a concatenated target form and keeps a valid Chinese true-exam sentence', () => {
  assert.equal(normalizeExamExample(example('bad', 'passage', 2025, {
    sentenceEn: 'The guestswouldcome if the room remained open.',
    targetForm: 'would'
  })), null);

  const valid = normalizeExamExample(example('good', 'question', 2024));
  assert.equal(valid.sourceKind, 'question');
  assert.match(valid.translationZh, /[\u3400-\u9fff]/u);
});

test('accepts a reliable contraction target form for the requested lemma', () => {
  const contracted = normalizeExamExample(example('contracted', 'passage', 2025, {
    lemma: 'would',
    targetForm: "'d",
    sentenceEn: "The managers said they 'd hire an experienced applicant today."
  }));

  assert.equal(contracted.lemma, 'would');
  assert.equal(contracted.targetForm, "'d");
});

test('accepts a possessive surface form without changing the dictionary lemma', () => {
  const possessive = normalizeExamExample(example('possessive', 'question', 2025, {
    lemma: 'employee',
    targetForm: "employees'",
    sentenceEn: "The company values its employees' work and professional judgment."
  }));

  assert.equal(possessive.lemma, 'employee');
  assert.equal(possessive.targetForm, "employees'");
});

test('normalizes quotation marks around a highlighted target word', () => {
  const quoted = normalizeExamExample(example('quoted', 'other', 2018, {
    lemma: 'endangered',
    targetForm: "'Endangered'",
    sentenceEn: "Venice may enter the 'Endangered' list after the review."
  }));

  assert.equal(quoted.targetForm, 'endangered');
});

test('strips source punctuation accidentally attached to a target form', () => {
  const leadingQuote = normalizeExamExample(example('leading-quote', 'passage', 2021, {
    lemma: 'enhance',
    targetForm: '"enhance',
    sentenceEn: 'Researchers use verbs like "enhance," promote, and strengthen.'
  }));
  const trailingComma = normalizeExamExample(example('trailing-comma', 'passage', 2021, {
    lemma: 'resource',
    targetForm: 'resources,',
    sentenceEn: 'Schools need resources, training, and clear public support.'
  }));

  assert.equal(leadingQuote.targetForm, 'enhance');
  assert.equal(trailingComma.targetForm, 'resources');
});

test('keeps a bounded mixed example set with passage priority and a question fallback', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, index) => example(`p${index}`, 'passage', 2025 - index)),
    example('q1', 'question', 2024),
    example('q2', 'question', 2023),
    example('o1', 'other', 2022)
  ];
  const selected = selectRepresentativeExamples(rows);

  assert.equal(selected.length, 6);
  assert.equal(selected.filter(row => row.sourceKind === 'question').length, 1);
  assert.equal(selected.filter(row => row.sourceKind === 'other').length, 1);
  assert.ok(selected.filter(row => row.sourceKind === 'passage').length >= 4);
});

test('never fills an absent other-source slot with a second question stem', () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => example(`p-only-${index}`, 'passage', 2025 - index)),
    example('q-only-1', 'question', 2024),
    example('q-only-2', 'question', 2023)
  ];
  const selected = selectRepresentativeExamples(rows);
  assert.equal(selected.length, 5);
  assert.equal(selected.filter(row => row.sourceKind === 'question').length, 1);
});

test('derives stable unique ids from provenance and content instead of trusting colliding source ids', () => {
  const first = example('source-collision', 'passage', 2025, {
    sentenceEn: 'The author explains the first social change in a careful argument.'
  });
  const second = example('source-collision', 'passage', 2025, {
    sentenceEn: 'The author explains a different historical change in this passage.'
  });
  const duplicate = { ...first, id: 'another-source-id' };

  assert.notEqual(deriveStableExampleId(first), deriveStableExampleId(second));
  assert.equal(deriveStableExampleId(first), deriveStableExampleId(duplicate));
  assert.equal(normalizeExamExample(first).sourceRecordId, 'source-collision');
});

test('filters unsuitable sentence lengths and duplicate content while reporting source id collisions', () => {
  const count = { sentenceTotal: 10, passage: 8, questionStem: 2, other: 0, papers: 4, years: 3 };
  const valid = example('shared-source-id', 'passage', 2024);
  const collision = example('shared-source-id', 'passage', 2023, {
    sentenceEn: 'The author presents another useful argument about public education.'
  });
  const duplicate = { ...valid, id: 'different-source-id' };
  const tooShort = example('short', 'passage', 2022, { sentenceEn: 'The author writes.' });
  const tooLong = example('long', 'passage', 2021, {
    sentenceEn: `The author ${Array.from({ length: 81 }, () => 'carefully').join(' ')} explains reform.`
  });
  const built = buildExamCorpusArtifacts({
    manifest: sourceManifest(),
    manifestSha256: 'a'.repeat(64),
    wordRecords: [
      word('author', 'cet4', count),
      word('author', 'cet6', count),
      word('author', 'kaoyan-general', count)
    ],
    exampleRecords: [valid, collision, duplicate, tooShort, tooLong]
  });

  assert.deepEqual(built.exampleAudit, {
    inputRecords: 5,
    acceptedRecords: 2,
    filteredShort: 1,
    filteredLong: 1,
    duplicateContent: 1,
    sourceIdCollisions: 1,
    selectedRecords: 2
  });
});

test('builds a versioned score index and per-track example shards without splitting graduate frequency', () => {
  const count = { sentenceTotal: 10, passage: 8, questionStem: 2, other: 0, papers: 4, years: 3 };
  const words = [
    word('author', 'cet4', count),
    word('author', 'cet6', count),
    word('author', 'kaoyan-general', count)
  ];
  const examples = [example('k1', 'passage', 2024, {
    statsTrack: 'kaoyan-general',
    examTrack: 'kaoyan1',
    paperLabel: '2024 英语一',
    sourceUrl: 'https://english-exam.lazynote.cn/kaoyan/words/author/'
  })];

  const built = buildExamCorpusArtifacts({
    manifest: sourceManifest(),
    manifestSha256: 'a'.repeat(64),
    wordRecords: words,
    exampleRecords: examples
  });

  assert.equal(built.indexArtifact.words.cet4.author.priorityLabel, '真题高频核心');
  assert.equal(built.indexArtifact.words['kaoyan-general'].author.examTrack, undefined);
  assert.equal(built.indexArtifact.words['kaoyan-general'].author.cefrReported, 'B1');
  assert.equal(built.indexArtifact.words.cet4.author.dictionaryLevel, undefined);
  assert.deepEqual(built.shards['kaoyan-general-a'].items.author.map(item => item.examTrack), ['kaoyan1']);
  assert.equal(built.exampleManifest.shards['kaoyan-general-a'].recordCount, 1);
});

test('ships the validated v3 corpus and includes its reproducible build in release preflight', () => {
  const sourceRoot = resolve('data/sources/lazynote-exam-corpus-v1');
  for (const name of ['manifest.json', 'EXPORT_REPORT.md', 'words.jsonl.gz', 'examples.jsonl.gz']) {
    assert.equal(existsSync(resolve(sourceRoot, name)), true, `缺少来源快照 ${name}`);
  }

  const index = JSON.parse(readFileSync(resolve('public/data/exam-corpus-index.json'), 'utf8'));
  const examples = JSON.parse(readFileSync(resolve('public/data/exam-examples/manifest.json'), 'utf8'));
  assert.equal(index.source.sourceVersion, '2026-07-29-v3');
  assert.deepEqual(Object.fromEntries(Object.entries(index.tracks).map(([track, meta]) => [track, meta.wordCount])), {
    cet4: 3161,
    cet6: 3639,
    'kaoyan-general': 2384
  });
  assert.deepEqual(examples.audit, {
    inputRecords: 70383,
    acceptedRecords: 70083,
    filteredShort: 6,
    filteredLong: 107,
    duplicateContent: 187,
    sourceIdCollisions: 154,
    selectedRecords: 29456
  });

  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.equal(pkg.scripts['exam-corpus:build'], 'node scripts/build-exam-corpus.mjs');
  assert.equal(pkg.scripts['exam-corpus:verify'], 'node scripts/build-exam-corpus.mjs');
  assert.match(pkg.scripts['release:preflight'], /exam-corpus:verify/);

  const catalog = JSON.parse(readFileSync(resolve('public/data/lexicon-source-catalog.json'), 'utf8'));
  const source = catalog.examCorpusSources?.find(item => item.id === 'lazynote-exam-corpus');
  assert.equal(source?.datasetVersion, '2026-07-29-v3');
  assert.deepEqual(source?.tracks, ['cet4', 'cet6', 'kaoyan-general']);
  assert.equal(source?.termsUrl, 'https://english-exam.lazynote.cn/terms/');
});
