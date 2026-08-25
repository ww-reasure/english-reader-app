import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadApi(model = 'deepseek-v4-pro') {
  const [source, profile, stream, catalog] = await Promise.all([
    readFile(new URL('../src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/article-stream.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/deepseek-model-catalog.mjs', import.meta.url), 'utf8')
  ]);
  const config = dataModule(`
    const values = ${JSON.stringify({ model, base_url: 'https://api.deepseek.com/v1', api_key: 'test-key' })};
    export const Config = { get: key => values[key] || '' };
  `);
  const adapted = source
    .replace("from './config.js'", `from '${config}'`)
    .replace("from './difficulty-profile.mjs'", `from '${dataModule(profile)}'`)
    .replace("from './article-stream.mjs'", `from '${dataModule(stream)}'`)
    .replace("from './components/deepseek-model-catalog.mjs'", `from '${dataModule(catalog)}'`);
  return import(dataModule(adapted));
}

test('request-level model routing keeps text defaults and sends only the selected model', async () => {
  const { API } = await loadApi();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  try {
    await API.chatCompletion([{ role: 'user', content: 'text' }]);
    await API.chatCompletion([{ role: 'user', content: 'image' }], { modelOverride: 'deepseek-v4-flash-vision-exp' });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(bodies[0].model, 'deepseek-v4-pro');
  assert.equal(bodies[1].model, 'deepseek-v4-flash-vision-exp');
});
