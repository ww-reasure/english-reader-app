import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadApi(model = 'deepseek-v4-flash') {
  const [source, profile, stream, catalog] = await Promise.all([
    readFile(new URL('../src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/article-stream.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/deepseek-model-catalog.mjs', import.meta.url), 'utf8')
  ]);
  const configUrl = `data:text/javascript;base64,${Buffer.from(`export const Config = { get: key => key === 'model' ? ${JSON.stringify(model)} : key === 'base_url' ? 'https://api.example' : 'test-key' };`).toString('base64')}`;
  const profileUrl = `data:text/javascript;base64,${Buffer.from(profile).toString('base64')}`;
  const streamUrl = `data:text/javascript;base64,${Buffer.from(stream).toString('base64')}`;
  const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalog).toString('base64')}`;
  const adapted = source
    .replace("from './config.js'", `from '${configUrl}'`)
    .replace("from './difficulty-profile.mjs'", `from '${profileUrl}'`)
    .replace("from './article-stream.mjs'", `from '${streamUrl}'`)
    .replace("from './components/deepseek-model-catalog.mjs'", `from '${catalogUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

test('configures V4 article streaming as non-thinking JSON with a bounded output budget', async () => {
  const { API } = await loadApi();
  let request;
  const originalFetchStream = API.fetchStream;
  API.fetchStream = async (_endpoint, body, _timeout, _signal, onEvent) => {
    request = body;
    onEvent({ choices: [{ delta: { content: JSON.stringify({
      title: 'Fast article',
      titleZh: '快速文章',
      content: 'One sentence. Another sentence. A final sentence.',
      translation: '第一句。第二句。最后一句。'
    }) } }] });
    return { usage: { total_tokens: 12 } };
  };

  try {
    const article = await API.generateArticleStream('写一篇文章', 'cet4', '旅行', 'journey', 280);
    assert.equal(article.title, 'Fast article');
    assert.deepEqual(request.thinking, { type: 'disabled' });
    assert.equal(request.stream, true);
    assert.deepEqual(request.stream_options, { include_usage: true });
    assert.equal(request.max_tokens, 4096);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.match(request.messages[0].content, /json/i);
  } finally {
    API.fetchStream = originalFetchStream;
  }
});

test('does not add V4-only thinking controls to custom or legacy models', async () => {
  const { API } = await loadApi('custom-compatible-model');
  let request;
  const originalFetchStream = API.fetchStream;
  API.fetchStream = async (_endpoint, body, _timeout, _signal, onEvent) => {
    request = body;
    onEvent({ choices: [{ delta: { content: JSON.stringify({
      title: 'Fallback model', titleZh: '兼容模型',
      content: 'One sentence. Another sentence. A final sentence.',
      translation: '第一句。第二句。最后一句。'
    }) } }] });
    return { usage: null };
  };
  try {
    await API.generateArticleStream('写一篇文章', 'cet4', '旅行', '', 280);
    assert.equal('thinking' in request, false);
  } finally {
    API.fetchStream = originalFetchStream;
  }
});

test('parses a normal JSON response from a stream endpoint without issuing a duplicate request', async () => {
  const { API } = await loadApi();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"title":"Normal"}' } }],
        usage: { total_tokens: 8 }
      })
    };
  };
  try {
    const result = await API.fetchStream('/chat/completions', { messages: [] }, 1000);
    assert.equal(calls, 1);
    assert.equal(result.payload.choices[0].message.content, '{"title":"Normal"}');
    assert.equal(result.usage.total_tokens, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('adds fast non-thinking controls to ordinary V4 JSON material requests and normalizes the endpoint URL', async () => {
  const { API } = await loadApi();
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = url;
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] })
    };
  };
  try {
    await API.fetch('/chat/completions', { response_format: { type: 'json_object' } }, 1000);
    assert.equal(requestUrl, 'https://api.example/chat/completions');
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
