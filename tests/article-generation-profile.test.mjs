import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getDifficultyProfile } from '../src/difficulty-profile.mjs';

async function loadApi() {
  const [source, profile, stream, catalog] = await Promise.all([
    readFile(new URL('../src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/difficulty-profile.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/article-stream.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/deepseek-model-catalog.mjs', import.meta.url), 'utf8')
  ]);
  const configUrl = 'data:text/javascript;base64,' + Buffer.from("export const Config = { get: () => 'easy' }; ").toString('base64');
  const profileUrl = 'data:text/javascript;base64,' + Buffer.from(profile).toString('base64');
  const streamUrl = 'data:text/javascript;base64,' + Buffer.from(stream).toString('base64');
  const catalogUrl = 'data:text/javascript;base64,' + Buffer.from(catalog).toString('base64');
  const adapted = source
    .replace("from './config.js'", `from '${configUrl}'`)
    .replace("from './difficulty-profile.mjs'", `from '${profileUrl}'`)
    .replace("from './article-stream.mjs'", `from '${streamUrl}'`)
    .replace("from './components/deepseek-model-catalog.mjs'", `from '${catalogUrl}'`);
  return import('data:text/javascript;base64,' + Buffer.from(adapted).toString('base64'));
}

test('uses the requested generation profile in the API prompt', async () => {
  const { API } = await loadApi();
  const profile = getDifficultyProfile('cet4', 'support');

  const prompt = API.buildArticlePrompt('cet4', 280, 'one, two', profile);

  assert.match(prompt, /平均句长必须控制在 10-17 词/);
  assert.match(prompt, /总字数必须控制在 240-320 词/);
  assert.doesNotMatch(prompt, /每句18-25个单词/);
});
