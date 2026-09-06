import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [toolSource, importSource] = await Promise.all([
  readFile(new URL('../src/components/article-import-tool.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/article-import.mjs', import.meta.url), 'utf8')
]);
const { ArticleImportTool, SAVE_READING_CARD_TOOL } = await import(
  `data:text/javascript;base64,${Buffer.from(
    toolSource.replace(
      "from './article-import.mjs'",
      `from 'data:text/javascript;base64,${Buffer.from(importSource).toString('base64')}'`
    )
  ).toString('base64')}`
);

const PARAGRAPH = 'The early morning light slipped across the quiet harbour as fishermen prepared their nets for another long day at sea.';

const createFixture = ({ records = [], saveArticle = null } = {}) => {
  const saved = [];
  const db = {
    async getAllArticles() { return records.map(row => ({ ...row })); },
    async saveArticle(article) {
      saved.push({ ...article });
      const id = 101 + saved.length;
      return (typeof saveArticle === 'function') ? saveArticle(article, id) : id;
    }
  };
  const difficultyRequests = [];
  const tool = new ArticleImportTool({
    db,
    resolveDifficulty: () => {
      difficultyRequests.push(true);
      return 'kaoyan1';
    }
  });
  return { tool, db, saved, difficultyRequests };
};

test('tool definition requires title and full-text content', () => {
  assert.equal(SAVE_READING_CARD_TOOL.function.name, 'save_reading_card');
  assert.deepEqual(SAVE_READING_CARD_TOOL.function.parameters.required, ['title', 'content']);
  assert.match(SAVE_READING_CARD_TOOL.function.description, /不得摘要|不要总结|不得.*改写|不得摘要、缩写或原创改写/);
});

test('saves a prepared imported article and returns an import article artifact', async () => {
  const { tool, saved } = createFixture();
  const handled = await tool.execute({
    title: ' Harbour Morning ',
    content: PARAGRAPH,
    translation: ' 清晨的晨光洒在安静的港湾。 ',
    difficulty: 'cet6'
  });
  assert.equal(handled.result.status, 'saved');
  assert.equal(handled.result.articleId, 102);
  assert.equal(handled.result.wordCount, 20);
  assert.equal(handled.artifact.type, 'article');
  assert.equal(handled.artifact.source, 'import');
  assert.equal(handled.artifact.importStatus, 'saved');
  assert.equal(handled.artifact.article.id, 102);
  assert.equal(handled.artifact.article.difficulty, 'cet6');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].topic, 'imported');
  assert.match(saved[0].contentFingerprint, /^v1-/);
});

test('defaults difficulty to the resolved exam level when the model omits it', async () => {
  const { tool, difficultyRequests } = createFixture();
  const handled = await tool.execute({ title: 'Morning', content: PARAGRAPH });
  assert.equal(handled.artifact.article.difficulty, 'kaoyan1');
  assert.equal(difficultyRequests.length, 1);
});

test('rejects content that fails import validation without writing to the db', async () => {
  const { tool, saved } = createFixture();
  const handled = await tool.execute({ title: 'Too short', content: 'Hi there.' });
  assert.equal(handled.result.status, 'invalid_content');
  assert.equal(handled.artifact, undefined);
  assert.equal(saved.length, 0);
});

test('detects duplicates by stored fingerprint and by recomputed content hash', async () => {
  const article = { id: 7, title: 'Existing', content: PARAGRAPH };
  const { tool: byStored } = createFixture({ records: [{ ...article, contentFingerprint: 'v1-nothing' }] });
  const recompute = await byStored.execute({ title: 'Again', content: PARAGRAPH });
  assert.equal(recompute.result.status, 'duplicate');
  assert.equal(recompute.artifact.importStatus, 'duplicate');
  assert.equal(recompute.artifact.article.id, 7);

  const { tool: byComputed } = createFixture({ records: [article] });
  const computed = await byComputed.execute({ title: 'Again', content: PARAGRAPH });
  assert.equal(computed.result.status, 'duplicate');
  assert.equal(computed.artifact.article.id, 7);
});
