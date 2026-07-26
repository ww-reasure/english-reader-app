import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadApi() {
  const [source, profile] = await Promise.all([
    readFile(new URL('../src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8')
  ]);
  const configUrl = 'data:text/javascript;base64,' + Buffer.from("export const Config = { get: () => '95' }; ").toString('base64');
  const profileUrl = 'data:text/javascript;base64,' + Buffer.from(profile).toString('base64');
  const adapted = source
    .replace("from './config.js'", `from '${configUrl}'`)
    .replace("from './difficulty-profile.mjs'", `from '${profileUrl}'`);
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

test('article generation requests and returns titleZh in the same JSON response', async () => {
  const { API } = await loadApi();
  const prompt = API.buildArticlePrompt('cet4', 300, 'travel');
  assert.match(prompt, /"titleZh"/);

  const originalFetch = API.fetch;
  let request;
  API.fetch = async (_endpoint, body) => {
    request = body;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Learning Through Travel',
            titleZh: '旅行中的学习',
            content: 'Travel teaches us.',
            translation: '旅行教会我们。'
          })
        }
      }]
    };
  };

  try {
    const article = await API.generateArticle('写一篇旅行阅读', 'cet4', '旅行', 'travel', 300);
    assert.match(request.messages[0].content, /"titleZh"/);
    assert.equal(article.titleZh, '旅行中的学习');
  } finally {
    API.fetch = originalFetch;
  }
});
