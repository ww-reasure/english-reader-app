import assert from 'node:assert/strict';
import test from 'node:test';

test('near-synonym service validates Chinese glosses and persists a versioned cache', async () => {
  const module = await import('../src/components/word-similar.mjs').catch(() => null);
  assert.ok(module, 'word-similar service should exist');

  const { createWordSimilar, normalizeWordSimilarPayload, WORD_SIMILAR_CACHE_VERSION } = module;
  const items = normalizeWordSimilarPayload('important', {
    similar: [
      { word: 'significant', glossZh: '重要的；显著的', nuanceZh: '强调影响或意义' },
      { word: 'crucial', glossZh: '至关重要的', nuanceZh: '强调决定性' },
      { word: 'vital', glossZh: '极其重要的；必不可少的', nuanceZh: '强调不可缺少' },
      { word: 'important', glossZh: '重要的' },
      { word: 'essential', glossZh: '必要的；本质的', nuanceZh: '强调必需' }
    ]
  });
  assert.deepEqual(items, [
    { word: 'significant', glossZh: '重要的；显著的', nuanceZh: '强调影响或意义' },
    { word: 'crucial', glossZh: '至关重要的', nuanceZh: '强调决定性' },
    { word: 'vital', glossZh: '极其重要的；必不可少的', nuanceZh: '强调不可缺少' },
    { word: 'essential', glossZh: '必要的；本质的', nuanceZh: '强调必需' }
  ]);

  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  let calls = 0;
  const service = createWordSimilar({
    storage,
    request: async () => {
      calls += 1;
      return { similar: items };
    }
  });
  assert.deepEqual(await service.get('important'), items);
  assert.deepEqual(await service.get('Important'), items);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(values.get('word_similar_v1_important')).schemaVersion, WORD_SIMILAR_CACHE_VERSION);
});
