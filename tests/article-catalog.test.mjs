import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARTICLE_CATALOG_TTL_MS,
  createArticleCatalog
} from '../src/components/article-catalog.mjs';

const article = (id, overrides = {}) => ({
  id,
  title: `Article ${id}`,
  titleZh: `文章 ${id}`,
  difficulty: 'cet6',
  examType: '英语一',
  source: 'test',
  sourceUrl: `https://example.test/${id}`,
  wordCount: 320,
  publishedAt: 1,
  summary: 'summary',
  content: 'full text must not enter the catalog cache',
  translation: '全文翻译也不能进入目录缓存',
  ...overrides
});

function repository(initial = null) {
  let value = initial;
  let writes = 0;
  return {
    async getArticleCatalog() { return value; },
    async saveArticleCatalog(next) { value = structuredClone(next); writes += 1; },
    inspect: () => ({ value, writes })
  };
}

test('fresh indexed catalog is shown without another request inside the six hour TTL', async () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: now - 1_000,
    signature: 'stored',
    articles: [article('cached')]
  });
  let requests = 0;
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => now,
    fetchCatalog: async () => { requests += 1; return [article('network')]; }
  });

  const snapshot = await catalog.getSnapshot();
  const result = await catalog.refresh();

  assert.equal(snapshot.articles[0].id, 'cached');
  assert.equal(result.source, 'cache');
  assert.equal(result.refreshed, false);
  assert.equal(requests, 0);
  assert.equal(ARTICLE_CATALOG_TTL_MS, 6 * 60 * 60 * 1000);
});

test('stale refreshes are deduplicated and store metadata without article bodies', async () => {
  let resolveRequest;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const repo = repository();
  let requests = 0;
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => 10_000,
    fetchCatalog: () => {
      requests += 1;
      markStarted();
      return new Promise(resolve => { resolveRequest = resolve; });
    }
  });

  const first = catalog.refresh();
  const second = catalog.refresh();
  await started;
  resolveRequest([article('one')]);
  const [one, two] = await Promise.all([first, second]);

  assert.equal(requests, 1);
  assert.equal(one.snapshot, two.snapshot);
  assert.equal(repo.inspect().writes, 1);
  assert.equal(repo.inspect().value.articles[0].content, undefined);
  assert.equal(repo.inspect().value.articles[0].translation, undefined);
  assert.equal(repo.inspect().value.articles[0].examType, '英语一');
});

test('a broken persisted value is ignored and replaced from the network', async () => {
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: Date.now(),
    articles: 'not-an-array'
  });
  const catalog = createArticleCatalog({
    repository: repo,
    fetchCatalog: async () => [article('recovered')]
  });

  assert.equal(await catalog.getSnapshot(), null);
  const result = await catalog.refresh();

  assert.equal(result.snapshot.articles[0].id, 'recovered');
  assert.equal(result.source, 'network');
});

test('network failure keeps a stale snapshot available instead of blanking the shelf', async () => {
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: 1,
    signature: 'old',
    articles: [article('offline')]
  });
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => ARTICLE_CATALOG_TTL_MS + 100,
    fetchCatalog: async () => { throw new Error('offline'); }
  });

  const result = await catalog.refresh();

  assert.equal(result.source, 'cache');
  assert.equal(result.snapshot.articles[0].id, 'offline');
  assert.equal(result.error.message, 'offline');
});

test('subscribers are notified only when a background refresh changes an existing catalog', async () => {
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: 1,
    signature: 'old-signature',
    articles: [article('old')]
  });
  const events = [];
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => ARTICLE_CATALOG_TTL_MS + 1_000,
    fetchCatalog: async () => [article('new')]
  });
  catalog.subscribe(event => events.push(event));

  await catalog.getSnapshot();
  await catalog.refresh();

  assert.equal(events.length, 1);
  assert.equal(events[0].previous.articles[0].id, 'old');
  assert.equal(events[0].snapshot.articles[0].id, 'new');
});

test('prewarm skips fresh data and refreshes an expired snapshot once', async () => {
  let current = 1_000;
  const repo = repository({
    key: 'cloud-main', schemaVersion: 1, fetchedAt: current, signature: 'cached', articles: [article('cached')]
  });
  let requests = 0;
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => current,
    fetchCatalog: async () => { requests += 1; return [article(`network-${requests}`)]; }
  });

  await catalog.prewarm();
  assert.equal(requests, 0);

  current += ARTICLE_CATALOG_TTL_MS + 1;
  await Promise.all([catalog.prewarm(), catalog.prewarm()]);
  assert.equal(requests, 1);
});
