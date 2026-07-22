import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadTool() {
  const source = await readFile(new URL('../src/components/article-generation-tool.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('normalizes article tool arguments and saves a card-ready article', async () => {
  const { ArticleGenerationTool } = await loadTool();
  const calls = [];
  const saved = [];
  const tool = new ArticleGenerationTool({
    api: {
      generateArticle: async (...args) => {
        calls.push(args);
        return { title: 'Learning by Travel', content: 'A short article', translation: '一篇短文', wordCount: 3 };
      }
    },
    db: {
      getAllLearnWords: async () => [{ word: 'journey' }, { word: 'culture' }],
      saveArticle: async article => { saved.push(article); return 42; },
      deleteArticle: async () => {}
    },
    pickWords: words => words
  });

  const result = await tool.execute({
    request: '请按我们的学习情况写一篇旅行阅读',
    difficulty: 'unsupported',
    topic: '旅行'.repeat(50),
    wordCount: 9999
  }, {
    fallbackDifficulty: 'cet6',
    fallbackTopic: '综合',
    learningContext: '学习者：想练习旅行词汇'
  });

  assert.equal(calls[0][1], 'cet6');
  assert.equal(calls[0][2].length, 80);
  assert.equal(calls[0][4], 600);
  assert.equal(calls[0][5], '学习者：想练习旅行词汇');
  assert.equal(saved.length, 1);
  assert.equal(result.article.id, 42);
  assert.deepEqual(result.metadata, { id: 42, title: 'Learning by Travel', difficulty: 'cet6', wordCount: 3 });
});

test('does not save an article when the generation context has been cleared', async () => {
  const { ArticleGenerationTool } = await loadTool();
  let saveCalls = 0;
  const tool = new ArticleGenerationTool({
    api: { generateArticle: async () => ({ title: 'Late result', content: 'content', translation: '', wordCount: 1 }) },
    db: {
      getAllLearnWords: async () => [],
      saveArticle: async () => { saveCalls += 1; return 1; },
      deleteArticle: async () => {}
    }
  });

  await assert.rejects(
    tool.execute({ request: '生成一篇文章' }, { isActive: () => false }),
    /已取消/
  );
  assert.equal(saveCalls, 0);
});
