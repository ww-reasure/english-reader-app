import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const elements = new Map([
  ['importModal', { style: { display: 'flex' } }],
  ['importTitle', { value: '', focus() {} }],
  ['importContent', { value: '' }],
  ['importTranslation', { value: '' }],
  ['importDifficulty', { value: 'cet4' }],
  ['importFile', { value: '', disabled: false }],
  ['importStatus', { textContent: '', dataset: {} }],
  ['importSubmit', { disabled: false }],
  ['importCancel', { disabled: false }]
]);
const dispatched = [];

globalThis.window = {};
globalThis.document = {
  getElementById(id) { return elements.get(id) || null; },
  dispatchEvent(event) { dispatched.push(event); return true; }
};
globalThis.alert = () => {};
globalThis.__articleImportTestDB = {
  async getAllArticles() { return []; },
  async saveArticle() { return 1; }
};

const modalSource = await readFile(new URL('../src/components/modal.js', import.meta.url), 'utf8');
const articleImportUrl = new URL('../src/components/article-import.mjs', import.meta.url).href;
const adaptedModalSource = modalSource
  .replace("import { Config } from '../config.js';", 'const Config = {};')
  .replace("import { DB } from '../db.js';", 'const DB = globalThis.__articleImportTestDB;')
  .replace("from './article-import.mjs'", `from '${articleImportUrl}'`);
const { Modal } = await import(`data:text/javascript;base64,${Buffer.from(adaptedModalSource).toString('base64')}`);
const DB = globalThis.__articleImportTestDB;

function resetElements() {
  elements.get('importModal').style.display = 'flex';
  for (const id of ['importTitle', 'importContent', 'importTranslation', 'importFile', 'importStatus']) {
    elements.get(id).value = '';
    elements.get(id).textContent = '';
  }
  elements.get('importDifficulty').value = 'cet4';
  elements.get('importStatus').dataset = {};
  elements.get('importSubmit').disabled = false;
  elements.get('importCancel').disabled = false;
  elements.get('importFile').disabled = false;
  dispatched.length = 0;
  Modal._resetImportState({ clearFields: true });
}

test('a late first file cannot overwrite a newer selected file', async () => {
  resetElements();
  let resolveFirst;
  const first = {
    name: 'first.txt', type: 'text/plain', size: 30,
    text: () => new Promise(resolve => { resolveFirst = resolve; })
  };
  const second = {
    name: 'second.md', type: 'text/markdown', size: 50,
    text: async () => '# Second\n\nThis newer file must remain visible.'
  };
  const firstTarget = { files: [first], value: 'first' };
  const secondTarget = { files: [second], value: 'second' };

  const firstPending = Modal.handleImportFile({ target: firstTarget });
  const secondPending = Modal.handleImportFile({ target: secondTarget });
  await secondPending;
  resolveFirst('This stale file must not replace anything.');
  await firstPending;

  assert.equal(elements.get('importTitle').value, 'second');
  assert.equal(elements.get('importContent').value, 'Second\n\nThis newer file must remain visible.');
  assert.match(elements.get('importStatus').textContent, /second\.md/);
  assert.equal(elements.get('importSubmit').disabled, false);
});

test('duplicate final content is rejected without writing another article', async () => {
  resetElements();
  elements.get('importTitle').value = 'Duplicate title';
  elements.get('importContent').value = 'Hello, world! This is duplicate content.';
  const originalGetAll = DB.getAllArticles;
  const originalSave = DB.saveArticle;
  let saves = 0;
  DB.getAllArticles = async () => [{ content: ' hello ,world ! this IS duplicate content. ' }];
  DB.saveArticle = async () => { saves += 1; return 1; };
  try {
    await Modal.handleImport();
    assert.equal(saves, 0);
    assert.match(elements.get('importStatus').textContent, /已经在书架/);
    assert.equal(elements.get('importModal').style.display, 'flex');
  } finally {
    DB.getAllArticles = originalGetAll;
    DB.saveArticle = originalSave;
  }
});

test('saving uses the edited textarea and publishes one article-imported event', async () => {
  resetElements();
  elements.get('importTitle').value = 'Edited title';
  elements.get('importContent').value = 'This is the final edited article content.';
  elements.get('importDifficulty').value = 'kaoyan1';
  const originalGetAll = DB.getAllArticles;
  const originalSave = DB.saveArticle;
  let saved = null;
  DB.getAllArticles = async () => [];
  DB.saveArticle = async article => { saved = article; return 42; };
  try {
    await Modal.handleImport();
    assert.equal(saved.title, 'Edited title');
    assert.equal(saved.content, 'This is the final edited article content.');
    assert.equal(saved.difficulty, 'kaoyan1');
    assert.match(saved.contentFingerprint, /^v1-[\da-f]{16}$/);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, 'article-imported');
    assert.equal(dispatched[0].detail.article.id, 42);
    assert.equal(elements.get('importModal').style.display, 'none');
  } finally {
    DB.getAllArticles = originalGetAll;
    DB.saveArticle = originalSave;
  }
});
