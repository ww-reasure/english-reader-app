import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const API_SOURCE_URL = new URL('../src/api.js', import.meta.url);
const PROFILE_URL = new URL('../src/difficulty-profile.mjs', import.meta.url);
const STREAM_URL = new URL('../src/article-stream.mjs', import.meta.url);
const CATALOG_URL = new URL('../src/components/deepseek-model-catalog.mjs', import.meta.url);

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadApi(values = {}) {
  const [source, profile, stream, catalog] = await Promise.all([
    readFile(API_SOURCE_URL, 'utf8'),
    readFile(PROFILE_URL, 'utf8'),
    readFile(STREAM_URL, 'utf8'),
    readFile(CATALOG_URL, 'utf8')
  ]);
  const state = {
    base_url: 'https://api.deepseek.com/v1',
    api_key: 'test-key',
    model: 'deepseek-v4-pro',
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
const fetchCalls = [];

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  async json() { return payload; },
  async text() { return JSON.stringify(payload); }
});

const installFetchRecorder = (payload, status = 200) => {
  fetchCalls.length = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return jsonResponse(payload, status);
  };
  return fetchCalls;
};

const installFetchSequence = responses => {
  fetchCalls.length = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    const next = responses.shift();
    return jsonResponse(JSON.parse(next.body || '{}'), next.status);
  };
  return fetchCalls;
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('uploadVisionFile uses user_data and a 30 day expiry', async () => {
  const { API } = await loadApi();
  const calls = installFetchRecorder({ id: 'file-api-1', bytes: 5, created_at: 100 });
  const result = await API.uploadVisionFile(new Blob(['image'], { type: 'image/jpeg' }), 'image-01.jpg');

  assert.equal(result.id, 'file-api-1');
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/files');
  const form = calls[0].options.body;
  assert.equal(form.get('purpose'), 'user_data');
  assert.equal(form.get('expires_after[anchor]'), 'created_at');
  assert.equal(form.get('expires_after[seconds]'), '2592000');
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
  assert.equal(form.get('file').name, 'image-01.jpg');
});

test('deleteVisionFile treats missing remote files as success and encodes IDs', async () => {
  const { API } = await loadApi();
  const calls = installFetchSequence([{ status: 404, body: '{}' }]);
  assert.deepEqual(await API.deleteVisionFile('file-api-a_b-1'), { deleted: true, alreadyMissing: true });
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/files/file-api-a_b-1');
  await assert.rejects(API.deleteVisionFile('not-a-file-id'), /invalid/i);
  assert.equal(calls.length, 1);
});

test('chatCompletion can override the model for one image request', async () => {
  const { API } = await loadApi();
  const calls = installFetchRecorder({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  await API.chatCompletion([{ role: 'user', content: 'hi' }], { modelOverride: 'deepseek-v4-flash-vision-exp' });
  assert.equal(JSON.parse(calls[0].options.body).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(JSON.parse(calls[0].options.body).thinking, undefined);
});

test('model-unavailable fallback matches only official model errors', async () => {
  const { isVisionModelUnavailable } = await loadApi();
  assert.equal(isVisionModelUnavailable(new Error('API error: 404 - model not found')), true);
  assert.equal(isVisionModelUnavailable(new Error('API error: 400 - The model is unavailable')), true);
  assert.equal(isVisionModelUnavailable(new Error('API error: 400 - invalid image payload')), false);
  assert.equal(isVisionModelUnavailable(new Error('API error: 401 - model not found')), false);
  assert.equal(isVisionModelUnavailable(new Error('API error: 429 - model unavailable')), false);
  assert.equal(isVisionModelUnavailable(new Error('request timeout: model unavailable')), false);
});
