import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MODEL_DISCOVERY_TTL_MS,
  chooseRecommendedModel,
  createModelDiscovery,
  isLikelyChatModel,
  normalizeModelRecords
} from '../src/components/model-discovery.mjs';
import { buildModelOptionRecords } from '../src/components/model-selector.mjs';

const API_SOURCE_URL = new URL('../src/api.js', import.meta.url);
const PROFILE_URL = new URL('../src/difficulty-profile.mjs', import.meta.url);
const STREAM_URL = new URL('../src/article-stream.mjs', import.meta.url);
const CATALOG_URL = new URL('../src/components/deepseek-model-catalog.mjs', import.meta.url);
const SETTINGS_URL = new URL('../src/views/settings.js', import.meta.url);
const MODAL_URL = new URL('../src/components/modal.js', import.meta.url);
const INDEX_URL = new URL('../index.html', import.meta.url);

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadApi(values = {}) {
  const [source, profile, stream, catalog] = await Promise.all([
    readFile(API_SOURCE_URL, 'utf8'),
    readFile(PROFILE_URL, 'utf8'),
    readFile(STREAM_URL, 'utf8'),
    readFile(CATALOG_URL, 'utf8')
  ]);
  const state = {
    base_url: 'https://api.example/v1',
    api_key: 'test-key',
    model: 'deepseek-v4-flash-vision-exp',
    ...values
  };
  const config = dataModule(`
    const state = ${JSON.stringify(state)};
    export const Config = {
      get: key => state[key] || '',
      set: (key, value) => { state[key] = value; }
    };
  `);
  const adapted = source
    .replace("from './config.js'", `from '${config}'`)
    .replace("from './difficulty-profile.mjs'", `from '${dataModule(profile)}'`)
    .replace("from './article-stream.mjs'", `from '${dataModule(stream)}'`)
    .replace("from './components/deepseek-model-catalog.mjs'", `from '${dataModule(catalog)}'`);
  return import(dataModule(adapted));
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('API.listModels requests the configured OpenAI-compatible /models endpoint and normalizes ids', async () => {
  const { API } = await loadApi();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          object: 'list',
          data: [
            { id: ' deepseek-v4-flash-vision-exp ', owned_by: 'deepseek' },
            { id: 'deepseek-v4-flash-vision-exp' },
            { id: 'custom-chat' },
            { id: 123 },
            null
          ]
        };
      }
    };
  };

  const models = await API.listModels();

  assert.deepEqual(models.map(model => model.id), ['deepseek-v4-flash-vision-exp', 'custom-chat']);
  assert.equal(request.url, 'https://api.example/v1/models');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(request.options.body, undefined);
});

test('API.listModels never exposes the remote error body and classifies provider failures', async () => {
  const { API } = await loadApi();
  for (const [status, code] of [[401, 'MODEL_LIST_AUTH'], [404, 'MODEL_LIST_UNSUPPORTED'], [429, 'MODEL_LIST_RATE_LIMITED']]) {
    globalThis.fetch = async () => ({
      ok: false,
      status,
      async text() { return 'secret-provider-response-and-key'; }
    });

    await assert.rejects(API.listModels(), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret-provider-response-and-key|test-key/);
      return true;
    });
  }
});

test('API.listModels skips the network when no API key is available', async () => {
  const { API } = await loadApi({ api_key: '' });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network should not be called');
  };

  await assert.rejects(API.listModels(), error => error.code === 'MODEL_LIST_MISSING_KEY');
  assert.equal(calls, 0);
});

test('API.listModels classifies malformed URLs, responses, network errors and timeouts safely', async () => {
  const { API } = await loadApi();

  await assert.rejects(API.listModels({ baseUrl: 'not-a-url' }), error => {
    assert.equal(error.code, 'MODEL_LIST_INVALID_BASE_URL');
    return true;
  });

  for (const payload of [null, [], {}, { data: {} }]) {
    globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return payload; } });
    await assert.rejects(API.listModels(), error => error.code === 'MODEL_LIST_INVALID_RESPONSE');
  }
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { data: [{ id: 42 }] }; } });
  assert.deepEqual(await API.listModels(), []);

  globalThis.fetch = async () => { throw new TypeError('network failure with test-key'); };
  await assert.rejects(API.listModels(), error => {
    assert.equal(error.code, 'MODEL_LIST_NETWORK');
    assert.doesNotMatch(error.message, /test-key|network failure/);
    return true;
  });

  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(API.listModels({ timeoutMs: 1 }), error => error.code === 'MODEL_LIST_TIMEOUT');
});

test('API.listModels distinguishes caller cancellation from timeout', async () => {
  const { API } = await loadApi();
  const controller = new AbortController();
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const request = API.listModels({ signal: controller.signal, timeoutMs: 1000 });
  controller.abort();
  await assert.rejects(request, error => error.code === 'MODEL_LIST_CANCELLED');
});

test('model discovery deduplicates in-flight requests and caches for the TTL', async () => {
  let calls = 0;
  let now = 1000;
  const discovery = createModelDiscovery({
    now: () => now,
    listModels: async () => {
      calls += 1;
      return [{ id: 'chat-a' }];
    }
  });

  const first = discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key' });
  const second = discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key' });
  assert.deepEqual(await Promise.all([first, second]), [
    { models: [{ id: 'chat-a' }], fromCache: false },
    { models: [{ id: 'chat-a' }], fromCache: false }
  ]);
  assert.equal(calls, 1);

  const cached = await discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key' });
  assert.deepEqual(cached, { models: [{ id: 'chat-a' }], fromCache: true });
  assert.equal(calls, 1);

  now += MODEL_DISCOVERY_TTL_MS + 1;
  await discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key' });
  assert.equal(calls, 2);
  await discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key', force: true });
  assert.equal(calls, 3);
});

test('cancelling one selector consumer does not cancel another deduplicated request', async () => {
  let calls = 0;
  let release;
  const discovery = createModelDiscovery({
    listModels: ({ signal }) => {
      calls += 1;
      return new Promise((resolve, reject) => {
        release = () => resolve([{ id: 'shared-chat' }]);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
          code: 'MODEL_LIST_CANCELLED'
        })), { once: true });
      });
    }
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key', signal: firstController.signal });
  const second = discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key', signal: secondController.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  firstController.abort();
  await assert.rejects(first, error => error.code === 'MODEL_LIST_CANCELLED');
  release();
  assert.deepEqual(await second, { models: [{ id: 'shared-chat' }], fromCache: false });
  assert.equal(calls, 1);
});

test('a pre-aborted model discovery signal does not start a network request', async () => {
  let calls = 0;
  const discovery = createModelDiscovery({
    listModels: async () => {
      calls += 1;
      return [{ id: 'should-not-run' }];
    }
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discovery.load({ baseUrl: 'https://example/v1', apiKey: 'key', signal: controller.signal }),
    error => error.code === 'MODEL_LIST_CANCELLED'
  );
  assert.equal(calls, 0);
});

test('model recommendation keeps an available model and replaces a stale model with the preferred chat model', () => {
  const models = normalizeModelRecords([
    { id: 'text-embedding-3-small' },
    { id: 'deepseek-v4-flash-vision-exp' },
    { id: 'custom-chat' }
  ]);

  assert.equal(isLikelyChatModel('text-embedding-3-small'), false);
  assert.equal(isLikelyChatModel('custom-chat'), true);
  assert.deepEqual(chooseRecommendedModel({
    models,
    currentModel: 'deepseek-v4-flash-vision-exp'
  }), { model: 'deepseek-v4-flash-vision-exp', changed: false, reason: 'available' });
  assert.deepEqual(chooseRecommendedModel({
    models,
    currentModel: 'retired-model'
  }), { model: 'deepseek-v4-flash-vision-exp', changed: true, reason: 'preferred' });
});

test('model recommendation does not prefer non-chat model families', () => {
  assert.deepEqual(chooseRecommendedModel({
    models: normalizeModelRecords([
      { id: 'text-embedding-3-small' },
      { id: 'rerank-v3' },
      { id: 'provider-chat' }
    ]),
    currentModel: 'retired-model',
    preferredModel: 'missing-model'
  }), { model: 'provider-chat', changed: true, reason: 'likely_chat' });

  assert.deepEqual(chooseRecommendedModel({
    models: normalizeModelRecords([{ id: 'text-embedding-3-small' }]),
    currentModel: 'retired-model',
    preferredModel: 'missing-model'
  }), { model: 'text-embedding-3-small', changed: true, reason: 'first_available' });
});

test('model options preserve known labels while exposing remote custom ids', () => {
  assert.deepEqual(buildModelOptionRecords({
    models: [{ id: 'deepseek-v4-flash-vision-exp' }, { id: 'provider-chat' }],
    remote: true
  }), [
    { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash Vision Exp（默认·视觉）', known: true },
    { id: 'provider-chat', label: 'provider-chat', known: false }
  ]);
});

test('settings and onboarding use the same refreshable selector and abort model discovery on exit', async () => {
  const [settings, modal, index] = await Promise.all([
    readFile(SETTINGS_URL, 'utf8'),
    readFile(MODAL_URL, 'utf8'),
    readFile(INDEX_URL, 'utf8')
  ]);
  for (const source of [settings, modal]) {
    assert.match(source, /model-discovery-client/);
    assert.match(source, /refreshModelList/);
    assert.match(source, /AbortController/);
    assert.match(source, /describeModelDiscoveryError/);
    assert.doesNotMatch(source, /oninput\s*=.*refreshModelList/);
  }
  assert.match(settings, /id="settingsModelRefresh"/);
  assert.match(modal, /getElementById\(['"]modelRefresh['"]\)/);
  assert.match(index, /id="modelRefresh"/);
  assert.match(index, /id="modelStatus"/);
});
