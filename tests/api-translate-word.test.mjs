import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadApi() {
  const [source, profile, stream] = await Promise.all([
    readFile(new URL('../src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/article-stream.mjs', import.meta.url), 'utf8')
  ]);
  const configUrl = `data:text/javascript;base64,${Buffer.from("export const Config = { get: () => '95' }; ").toString('base64')}`;
  const profileUrl = `data:text/javascript;base64,${Buffer.from(profile).toString('base64')}`;
  const streamUrl = `data:text/javascript;base64,${Buffer.from(stream).toString('base64')}`;
  const adapted = source
    .replace("from './config.js'", `from '${configUrl}'`)
    .replace("from './difficulty-profile.mjs'", `from '${profileUrl}'`)
    .replace("from './article-stream.mjs'", `from '${streamUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function withFetch(API, fetchImpl, callback) {
  const originalFetch = API.fetch;
  API.fetch = fetchImpl;
  try {
    await callback();
  } finally {
    API.fetch = originalFetch;
  }
}

test('translateWord returns a Chinese glossary only when the model returns Chinese text', async () => {
  const { API } = await loadApi();
  await withFetch(API, async () => ({
    choices: [{ message: { content: '{"translation":"生产；制造","phonetic":"prəˈdʌkʃn","pos":"noun"}' } }]
  }), async () => {
    assert.equal(await API.translateWord('production'), '生产；制造');
  });
});

test('translateWord rejects an English echo instead of returning it as a translation', async () => {
  const { API } = await loadApi();
  await withFetch(API, async () => ({
    choices: [{ message: { content: '{"translation":"production"}' } }]
  }), async () => {
    assert.equal(await API.translateWord('production'), null);
  });
});

test('translateWord returns null for malformed or failed responses', async (t) => {
  const { API } = await loadApi();
  await t.test('malformed JSON', async () => {
    await withFetch(API, async () => ({
      choices: [{ message: { content: 'not json' } }]
    }), async () => {
      assert.equal(await API.translateWord('production'), null);
    });
  });

  await t.test('request failure', async () => {
    await withFetch(API, async () => {
      throw new Error('offline');
    }, async () => {
      assert.equal(await API.translateWord('production'), null);
    });
  });
});
