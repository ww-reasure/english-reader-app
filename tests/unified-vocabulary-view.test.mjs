import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const source = await read('../src/views/vocabulary.js');

test('unified page reads canonical rows and exposes the selected hierarchy', () => {
  assert.match(source, /DB\.getUnifiedVocabulary\(\)/);
  assert.match(source, /我的词汇/);
  assert.match(source, /导入单词/);
  assert.match(source, /搜索单词或释义/);
  assert.match(source, /全部/);
  assert.match(source, /收藏/);
  assert.match(source, /导入/);
  assert.match(source, /今日新增/);
  assert.match(source, /待复习/);
  assert.match(source, /最近加入/);
});

test('manual selection uses learnWord ids without saved-word remapping', () => {
  assert.match(source, /selectedWordIds/);
  assert.match(source, /scope:\s*'manual'/);
  assert.doesNotMatch(source, /learnWordsByWord/);
});

test('manage mode distinguishes cancel save from archive', () => {
  assert.match(source, /removeReadingSource/);
  assert.match(source, /archiveWords/);
  assert.match(source, /取消收藏/);
  assert.match(source, /移出词库/);
});

function createDocument() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event.type) || [])]) listener(event);
      return true;
    },
    querySelector() { return null; }
  };
}

function createRows() {
  return [
    { id: 1, word: 'saved', translation: '收藏', phonetic: '/seɪvd/', libraryAddedAt: 10, archivedAt: null, sourceKeys: ['reading'], sourceLabel: '收藏', librarySources: { reading: sourceAt(true, 10), import: sourceAt(false, 10) }, status: 'new', isDue: true },
    { id: 2, word: 'imported', translation: '导入', phonetic: '/ɪmˈpɔːrtɪd/', libraryAddedAt: 20, archivedAt: null, sourceKeys: ['import'], sourceLabel: '导入', librarySources: { reading: sourceAt(false, 20), import: sourceAt(true, 20) }, status: 'learning', isDue: false },
    { id: 3, word: 'shared', translation: '共同', phonetic: '/ʃerd/', libraryAddedAt: 30, archivedAt: null, sourceKeys: ['reading', 'import'], sourceLabel: '收藏·导入', librarySources: { reading: sourceAt(true, 30), import: sourceAt(true, 30) }, status: 'review', isDue: true }
  ];
}

const sourceAt = (active, at) => ({ active, firstAddedAt: active ? at : null, lastAddedAt: active ? at : null });

function createDb() {
  const rows = createRows();
  const getUnifiedVocabulary = (...args) => {
    getUnifiedVocabulary.mock.calls.push(args);
    return Promise.resolve(rows.filter(row => row.archivedAt == null).map(row => structuredClone(row)));
  };
  getUnifiedVocabulary.mock = { calls: [] };
  return {
    rows,
    getUnifiedVocabulary,
    async removeReadingVocabularySource(id) {
      const row = rows.find(item => item.id === Number(id));
      if (!row) return;
      row.librarySources.reading = sourceAt(false, 0);
      row.sourceKeys = row.sourceKeys.filter(source => source !== 'reading');
      row.sourceLabel = row.sourceKeys.join('·');
    },
    async archiveLearnWords(ids) {
      for (const id of ids) {
        const row = rows.find(item => item.id === Number(id));
        if (row) row.archivedAt = 100;
      }
    }
  };
}

async function loadView(db) {
  const viewSource = await read('../src/views/vocabulary.js');
  const practiceUrl = new URL('../src/review-practice.mjs', import.meta.url).href;
  const libraryUrl = new URL('../src/vocabulary-library.mjs', import.meta.url).href;
  const adapted = viewSource
    .replace("import { DB } from '../db.js';", 'const DB = globalThis.__unifiedVocabularyTestDB;')
    .replace("import { Dictionary } from '../dictionary.js';", 'const Dictionary = { lookup: async () => null };')
    .replace("import { esc, escAttr } from '../helpers.js';", "const esc = value => String(value || '').replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[char])); const escAttr = esc;")
    .replace("import { formatPhonetic, getDefinitionDisplayLines, getSavableTranslation } from '../components/definition-trust.mjs';", "const formatPhonetic = value => String(value || ''); const getDefinitionDisplayLines = word => word.translation ? [{ label: '释义', glossZh: word.translation }] : []; const getSavableTranslation = word => String(word?.translation || '');")
    .replace("import { ensureSavedWordDefinition } from '../components/saved-word-definition.mjs';", 'const ensureSavedWordDefinition = async word => word;')
    .replace("import { WordStudyDetail } from '../components/word-study-detail.js';", 'const WordStudyDetail = { open() {} };')
    .replace("import { SpacedRepetition } from '../spaced-repetition.js';", "const SpacedRepetition = { getDueCount: words => words.filter(word => word.isDue).length, getStatusDisplay: word => ({ label: word.status || '新词' }) };")
    .replace("from '../review-practice.mjs'", `from '${practiceUrl}'`)
    .replace("from '../vocabulary-library.mjs'", `from '${libraryUrl}'`);
  globalThis.__unifiedVocabularyTestDB = db;
  globalThis.window = {};
  globalThis.document = createDocument();
  globalThis.location = { hash: '#/vocab' };
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}#${Date.now()}-${Math.random()}`);
}

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));
const visibleIds = container => [...container.innerHTML.matchAll(/data-vocab-row="(\d+)"/g)].map(match => Number(match[1]));
const rowById = (container, id) => new RegExp(`data-vocab-row="${id}"`).test(container.innerHTML) ? {} : null;

const db = createDb();
const { VocabularyView: view } = await loadView(db);
const container = { innerHTML: '', isConnected: true };

test('source filtering keeps a dual-source row in both filters', async () => {
  await view.render(container);
  await view.setSourceFilter('reading');
  assert.deepEqual(visibleIds(container), [3, 1]);
  await view.setSourceFilter('import');
  assert.deepEqual(visibleIds(container), [3, 2]);
});

test('import completion refreshes the mounted route exactly once', async () => {
  view.sourceFilter = 'all';
  db.getUnifiedVocabulary.mock.calls.length = 0;
  await view.render(container);
  document.dispatchEvent(new CustomEvent('word-library-changed', { detail: { reason: 'import' } }));
  await flushPromises();
  assert.equal(db.getUnifiedVocabulary.mock.calls.length, 2);
  await view.cleanup();
  document.dispatchEvent(new CustomEvent('word-library-changed'));
  assert.equal(db.getUnifiedVocabulary.mock.calls.length, 2);
});

test('cancel saved on a dual-source word keeps the row while archive removes it', async () => {
  await view.render(container);
  await view.removeReadingSource(3);
  assert.ok(rowById(container, 3));
  await view.archiveWords([3]);
  assert.equal(rowById(container, 3), null);
});
