import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadCache() {
  const sourceUrl = new URL('../src/components/sentence-analysis-cache.js', import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(dataUrl);
}

test('reuses one analysis for the same sentence despite whitespace differences', async () => {
  const { SentenceAnalysisCache } = await loadCache();
  const cache = new SentenceAnalysisCache();
  let requests = 0;

  const first = await cache.getOrCreate(' It  is widely\nacknowledged. ', async () => {
    requests += 1;
    return '分析结果';
  });
  const second = await cache.getOrCreate('It is widely acknowledged.', async () => {
    requests += 1;
    return '不应再次请求';
  });

  assert.equal(first, '分析结果');
  assert.equal(second, '分析结果');
  assert.equal(requests, 1);
});

test('shares an in-flight request and does not cache a failed analysis', async () => {
  const { SentenceAnalysisCache } = await loadCache();
  const cache = new SentenceAnalysisCache();
  let requests = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });

  const first = cache.getOrCreate('A useful sentence.', async () => {
    requests += 1;
    await pending;
    return '完成';
  });
  const second = cache.getOrCreate('A useful sentence.', async () => {
    requests += 1;
    return '重复请求';
  });
  release();

  assert.deepEqual(await Promise.all([first, second]), ['完成', '完成']);
  assert.equal(requests, 1);

  await assert.rejects(
    cache.getOrCreate('Retry me.', async () => { throw new Error('network'); }),
    /network/
  );
  const retried = await cache.getOrCreate('Retry me.', async () => {
    requests += 1;
    return '重试成功';
  });

  assert.equal(retried, '重试成功');
});
