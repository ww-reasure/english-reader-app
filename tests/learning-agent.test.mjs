import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadAgent() {
  const source = await readFile(new URL('../src/components/learning-agent.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('returns at most ten favorite article metadata records without content', async () => {
  const { LearningAgent } = await loadAgent();
  const db = {
    getAllArticles: async () => Array.from({ length: 12 }, (_, id) => ({
      id,
      title: '标题 ' + id,
      favorite: 1,
      content: 'private text',
      difficulty: 'cet4',
      topic: 'science',
      createdAt: id
    }))
  };
  const agent = new LearningAgent({
    db,
    srs: { getDueWords: () => [], getStatus: () => 'new', getDueCount: () => 0 },
    now: () => 100
  });

  const result = await agent.execute('list_saved_articles', { favoriteOnly: true });
  assert.equal(result.articles.length, 10);
  assert.equal('content' in result.articles[0], false);
});

test('rejects mutating and unknown tool names', async () => {
  const { LearningAgent } = await loadAgent();
  await assert.rejects(
    new LearningAgent({ db: {}, srs: {} }).execute('delete_article', { id: 1 }),
    /not allowed/
  );
});
