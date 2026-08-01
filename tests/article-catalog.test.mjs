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

test('recently checked indexed catalog is shown without another background request', async () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: now - 1_000,
    lastCheckedAt: now - 1_000,
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

test('background refresh uses the last checked time instead of the six hour cache age', async () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: now - 1_000,
    lastCheckedAt: now - 11 * 60 * 1000,
    signature: 'stored',
    articles: [article('cached')]
  });
  let requests = 0;
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => now,
    fetchCatalog: async () => {
      requests += 1;
      return [article('network')];
    }
  });

  const result = await catalog.refresh();

  assert.equal(result.source, 'network');
  assert.equal(result.snapshot.articles[0].id, 'network');
  assert.equal(requests, 1);
  assert.equal(repo.inspect().value.lastCheckedAt, now);
});

test('manual refresh bypasses the background refresh interval', async () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: now - 1_000,
    lastCheckedAt: now - 1_000,
    signature: 'stored',
    articles: [article('cached')]
  });
  let requests = 0;
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => now,
    fetchCatalog: async () => {
      requests += 1;
      return [article('network')];
    }
  });

  const result = await catalog.refresh({ force: true, reason: 'pull' });

  assert.equal(result.source, 'network');
  assert.equal(result.snapshot.articles[0].id, 'network');
  assert.equal(requests, 1);
});

test('findCurrentArticle resolves a stale article id through its stable source url', async () => {
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: 1,
    lastCheckedAt: 1,
    signature: 'current',
    articles: [article('new-id', { sourceUrl: 'https://example.test/stable' })]
  });
  const catalog = createArticleCatalog({
    repository: repo,
    fetchCatalog: async () => []
  });

  const current = await catalog.findCurrentArticle({
    id: 'old-id',
    sourceUrl: 'https://example.test/stable'
  });

  assert.equal(current.id, 'new-id');
});

test('removing a confirmed stale article also persists the cleaned catalog', async () => {
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: 1,
    lastCheckedAt: 1,
    signature: 'current',
    articles: [
      article('removed', { sourceUrl: 'https://example.test/removed' }),
      article('kept')
    ]
  });
  const catalog = createArticleCatalog({
    repository: repo,
    fetchCatalog: async () => []
  });

  const removed = await catalog.removeArticle({
    id: 'removed',
    sourceUrl: 'https://example.test/removed'
  });
  const snapshot = await catalog.getSnapshot();

  assert.equal(removed, true);
  assert.deepEqual(snapshot.articles.map(item => item.id), ['kept']);
  assert.deepEqual(repo.inspect().value.articles.map(item => item.id), ['kept']);
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

test('a forced refresh queued during a background request runs immediately after it', async () => {
  let resolveFirst;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let requests = 0;
  const repo = repository({
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: 1,
    lastCheckedAt: 1,
    signature: 'old',
    articles: [article('old')]
  });
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => 20 * 60 * 1000,
    fetchCatalog: () => {
      requests += 1;
      markStarted();
      if (requests === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve([article('manual')]);
    }
  });

  const background = catalog.refresh();
  await started;
  const manual = catalog.refresh({ force: true, reason: 'manual' });
  resolveFirst([article('background')]);
  const [backgroundResult, manualResult] = await Promise.all([background, manual]);

  assert.equal(requests, 2);
  assert.equal(backgroundResult.snapshot.articles[0].id, 'manual');
  assert.equal(manualResult.snapshot.articles[0].id, 'manual');
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
    key: 'cloud-main',
    schemaVersion: 1,
    fetchedAt: current,
    lastCheckedAt: current,
    signature: 'cached',
    articles: [article('cached')]
  });
  let requests = 0;
  const catalog = createArticleCatalog({
    repository: repo,
    now: () => current,
    fetchCatalog: async () => { requests += 1; return [article(`network-${requests}`)]; }
  });

  await catalog.prewarm();
  assert.equal(requests, 0);

  current += 10 * 60 * 1000 + 1;
  await Promise.all([catalog.prewarm(), catalog.prewarm()]);
  assert.equal(requests, 1);
});
