import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_SOURCE_VERSION,
  planLegacyVocabularyMigration,
  projectUnifiedVocabulary,
  selectUnifiedVocabulary
} from '../src/vocabulary-library.mjs';

test('legacy saved rows are reading sources and unmatched learning rows are imports', () => {
  const plan = planLegacyVocabularyMigration({
    learnWords: [
      { id: 1, word: 'derive', createdAt: 10, interval: 30, reviewRevision: 4 },
      { id: 2, word: 'retain', createdAt: 20, interval: 7, reviewRevision: 2 }
    ],
    vocabulary: [{ id: 9, word: 'Derived', createdAt: 30, translation: '获得' }],
    normalizeLemma: word => word.toLowerCase().replace(/d$/, '')
  });
  assert.equal(plan.updates.find(row => row.id === 1).librarySources.reading.active, true);
  assert.equal(plan.updates.find(row => row.id === 1).librarySources.import.active, false);
  assert.equal(plan.updates.find(row => row.id === 2).librarySources.import.active, true);
  assert.equal(plan.updates.find(row => row.id === 1).interval, 30);
  assert.equal(plan.updates.find(row => row.id === 1).reviewRevision, 4);
});

test('legacy migration creates a missing canonical word from saved metadata', () => {
  const plan = planLegacyVocabularyMigration({
    learnWords: [],
    vocabulary: [{ id: 3, word: 'constraint', createdAt: 50, translation: '限制', phonetic: '/kənˈstreɪnt/' }],
    normalizeLemma: word => word.toLowerCase()
  });
  assert.deepEqual(plan.inserts.map(row => row.word), ['constraint']);
  assert.equal(plan.inserts[0].librarySources.reading.active, true);
  assert.equal(plan.inserts[0].librarySources.import.active, false);
});

test('versioned rows are never reclassified after a source becomes inactive', () => {
  const versioned = {
    id: 1,
    word: 'derive',
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: {
      reading: { active: false, firstAddedAt: 10, lastAddedAt: 10 },
      import: { active: false, firstAddedAt: null, lastAddedAt: null }
    },
    archivedAt: 99
  };
  const plan = planLegacyVocabularyMigration({ learnWords: [versioned], vocabulary: [], normalizeLemma: value => value });
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.inserts, []);
});

function fixtures() {
  return [
    {
      id: 1, word: 'gamma', phonetic: '/ˈɡæmə/', translation: '第三个字母',
      libraryAddedAt: 10, sourceKeys: ['reading'], isDue: false, nextReview: 300, status: 'stable'
    },
    {
      id: 2, word: 'alpha', phonetic: '/ˈælfə/', translation: '第一个字母',
      libraryAddedAt: 20, sourceKeys: ['import'], isDue: false, nextReview: 200, status: 'learning'
    },
    {
      id: 3, word: 'beta', phonetic: '/ˈbiːtə/', translation: '第二个字母',
      libraryAddedAt: 30, sourceKeys: ['reading', 'import'], isDue: true, nextReview: 50, status: 'due'
    }
  ];
}

test('projection emits one canonical row with both active sources', () => {
  const rows = projectUnifiedVocabulary({
    learnWords: [{
      id: 7,
      word: 'inevitable',
      translation: '不可避免的',
      libraryAddedAt: 20,
      librarySources: {
        reading: { active: true, firstAddedAt: 20, lastAddedAt: 30 },
        import: { active: true, firstAddedAt: 25, lastAddedAt: 25 }
      }
    }],
    vocabulary: [{ id: 70, word: 'inevitable', articleId: 4, contextSentence: 'It was inevitable.' }],
    normalizeLemma: value => value.toLowerCase()
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sourceKeys, ['reading', 'import']);
  assert.equal(rows[0].savedContexts.length, 1);
});

test('source filters include a dual-source row in both tabs', () => {
  const rows = fixtures();
  assert.deepEqual(selectUnifiedVocabulary(rows, { source: 'reading' }).map(row => row.id), [3, 1]);
  assert.deepEqual(selectUnifiedVocabulary(rows, { source: 'import' }).map(row => row.id), [3, 2]);
});

test('default sort is recent, with alphabetical and due alternatives', () => {
  const rows = fixtures();
  assert.deepEqual(selectUnifiedVocabulary(rows, { sort: 'recent' }).map(row => row.id), [3, 2, 1]);
  assert.deepEqual(selectUnifiedVocabulary(rows, { sort: 'alpha' }).map(row => row.word), ['alpha', 'beta', 'gamma']);
  assert.equal(selectUnifiedVocabulary(rows, { sort: 'due', now: 100 })[0].isDue, true);
});

test('search matches lemma phonetic and Chinese definition', () => {
  const rows = [{
    id: 4,
    word: 'constrain',
    phonetic: '/kənˈstreɪn/',
    translation: '限制；约束',
    libraryAddedAt: 5,
    sourceKeys: ['import'],
    isDue: false,
    status: 'new'
  }];
  assert.deepEqual(selectUnifiedVocabulary(rows, { query: '限制' }).map(row => row.word), ['constrain']);
  assert.deepEqual(selectUnifiedVocabulary(rows, { query: 'streɪn' }).map(row => row.word), ['constrain']);
});
