import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiCache } from '../src/components/ai-cache.mjs';

test('AiCache returns fresh values from memory and deduplicates in-flight work', async () => {
  const cache = createAiCache({ maxEntries: 10 });
  let calls = 0;
  const factory = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { examples: ['A useful sentence.'] };
  };

  const [first, second] = await Promise.all([
    cache.getOrCreate('word-detail', 'engage', factory),
    cache.getOrCreate('word-detail', 'engage', factory)
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.deepEqual((await cache.get('word-detail', 'engage')).value, first);
});

test('AiCache serves stale values immediately and allows a background refresh', async () => {
  let now = 1000;
  const cache = createAiCache({ now: () => now, defaultTtlMs: 10 });
  await cache.set('word-detail', 'claim', { examples: ['old'] });
  now += 11;
  const stale = await cache.get('word-detail', 'claim');
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.value, { examples: ['old'] });
  await cache.getOrCreate('word-detail', 'claim', async () => ({ examples: ['new'] }), { force: true });
  assert.deepEqual((await cache.get('word-detail', 'claim')).value, { examples: ['new'] });
});

test('AiCache does not retain failed factories and evicts the least recently used entry', async () => {
  const cache = createAiCache({ maxEntries: 2 });
  await assert.rejects(cache.getOrCreate('sentence', 'bad', async () => { throw new Error('network'); }));
  assert.equal(await cache.get('sentence', 'bad'), null);
  await cache.set('sentence', 'one', '1');
  await cache.set('sentence', 'two', '2');
  await cache.get('sentence', 'one');
  await cache.set('sentence', 'three', '3');
  assert.equal(await cache.get('sentence', 'two'), null);
  assert.equal((await cache.get('sentence', 'one')).value, '1');
});
