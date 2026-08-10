import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_RESEARCH_MAX_SOURCES,
  buildResearchBrief,
  createWebResearch,
  normalizeResearchSources
} from '../src/components/web-research.mjs';

function createConfig(apiKey = 'tvly-test') {
  return { get: key => (key === 'tavily_api_key' ? apiKey : '') };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

function tavilyResponse(results = []) {
  return { results };
}

test('search normalizes Tavily results, keeps five valid sources and tracks the search time', async () => {
  const now = () => 1000;
  const service = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => ({
      ok: true,
      json: async () => tavilyResponse([
        { title: 'Alpha News', url: 'https://example.com/alpha', published_date: '2026-08-09', content: 'First result body.' },
        { title: 'Beta Report', url: 'https://example.org/beta', content: 'Second result body.' },
        { title: 'No URL', url: '', content: 'Ignored.' },
        { title: 'Bad URL', url: 'not-a-url', content: 'Ignored.' },
        { title: 'Gamma', url: 'https://example.net/gamma' },
        { title: 'Delta', url: 'https://example.edu/delta' },
        { title: 'Epsilon', url: 'https://example.io/epsilon' }
      ])
    }),
    storage: createStorage(),
    now
  });

  const result = await service.search({ query: 'latest AI news', recencyDays: 7 });

  assert.equal(result.status, 'ok');
  assert.equal(result.service, 'tavily');
  assert.equal(result.searchedAt, 1000);
  assert.equal(result.sources.length, WEB_RESEARCH_MAX_SOURCES);
  assert.equal(result.sources[0].title, 'Alpha News');
  assert.equal(result.sources[0].domain, 'example.com');
  assert.equal(result.sources[0].publishedAt, '2026-08-09');
  assert.equal(result.sources[0].snippet, 'First result body.');
  assert.ok(result.sources.every(source => /^https?:\/\//.test(source.url)));
});

test('search without a configured Tavily key reports missing_key', async () => {
  let calls = 0;
  const service = createWebResearch({
    config: createConfig(''),
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => tavilyResponse() };
    }
  });

  const result = await service.search({ query: 'anything' });

  assert.equal(result.status, 'missing_key');
  assert.deepEqual(result.sources, []);
  assert.equal(calls, 0);
});

test('search turns an HTTP failure into an error result without throwing', async () => {
  const service = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => ({ ok: false, status: 401 })
  });

  const result = await service.search({ query: 'weather' });

  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'http_401');
});

test('search returns cancelled when the caller aborts before the response', async () => {
  const controller = new AbortController();
  const service = createWebResearch({
    config: createConfig(),
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });

  const pending = service.search({ query: 'stocks', signal: controller.signal });
  controller.abort();
  const result = await pending;

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.sources, []);
});

test('search returns no_results when Tavily returns an empty list', async () => {
  const service = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => ({ ok: true, json: async () => tavilyResponse() })
  });

  const result = await service.search({ query: 'rare topic' });

  assert.equal(result.status, 'no_results');
  assert.deepEqual(result.sources, []);
});

test('fresh cached results are reused and stale results refresh once in the background', async () => {
  const now = () => nowValue;
  let nowValue = 1000;
  const storage = createStorage();
  let calls = 0;
  const service = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => tavilyResponse([{ title: 'Fresh', url: 'https://example.com/fresh' }]) };
    },
    storage,
    now
  });

  const first = await service.search({ query: 'economy' });
  assert.equal(first.status, 'ok');
  assert.equal(calls, 1);

  const cached = await service.search({ query: 'economy' });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);

  nowValue = 1000 + 25 * 60 * 60 * 1000;
  const stale = await service.search({ query: 'economy' });
  assert.equal(stale.stale, true);
  assert.equal(stale.sources[0].title, 'Fresh');
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2);
});

test('concurrent identical queries share one request', async () => {
  let calls = 0;
  const service = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { ok: true, json: async () => tavilyResponse([{ title: 'Shared', url: 'https://example.com/shared' }]) };
    }
  });

  const [left, right] = await Promise.all([
    service.search({ query: 'climate' }),
    service.search({ query: 'climate' })
  ]);

  assert.equal(left.status, 'ok');
  assert.equal(right.status, 'ok');
  assert.equal(calls, 1);
});

test('normalizeResearchSources keeps five unique valid URLs and drops invalid entries', () => {
  const rows = normalizeResearchSources([
    { title: 'One', url: 'https://example.com/1', domain: 'example.com' },
    { title: 'One again', url: 'https://example.com/1' },
    { title: 'Bad', url: 'ftp://example.com/file' },
    { title: 'Empty', url: '' },
    { title: 'Two', url: 'https://example.org/2' },
    { title: 'Three', url: 'https://example.net/3' },
    { title: 'Four', url: 'https://example.edu/4' },
    { title: 'Five', url: 'https://example.io/5' },
    { title: 'Six', url: 'https://example.dev/6' }
  ]);

  assert.equal(rows.length, WEB_RESEARCH_MAX_SOURCES);
  assert.deepEqual(rows.map(item => item.title), ['One', 'Two', 'Three', 'Four', 'Five']);
});

test('buildResearchBrief is bounded and only includes validated sources', () => {
  const brief = buildResearchBrief({
    query: 'space launch',
    sources: [
      { title: 'Rocket', url: 'https://example.com/rocket', publishedAt: '2026-08-10', snippet: 'A short summary.' },
      { title: 'Bad', url: '' },
      { title: 'Broken', url: 'http://' }
    ],
    limit: 400
  });

  assert.match(brief, /联网检索主题：space launch/);
  assert.match(brief, /example\.com/);
  assert.doesNotMatch(brief, /Broken/);
  assert.ok(brief.length <= 400);
});

test('testConnection reports ok only for a successful minimal request', async () => {
  const ok = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => ({ ok: true, json: async () => tavilyResponse([{ title: 'Ping', url: 'https://example.com/ping' }]) })
  });
  assert.deepEqual(await ok.testConnection(), { ok: true });

  const missing = createWebResearch({ config: createConfig('') });
  assert.deepEqual(await missing.testConnection(), { ok: false, reason: 'missing_key' });

  const failing = createWebResearch({
    config: createConfig(),
    fetchImpl: async () => ({ ok: false, status: 500 })
  });
  assert.deepEqual(await failing.testConnection(), { ok: false, reason: 'http_500' });
});