import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const intentSource = await readFile(new URL('../src/components/composer-intent.js', import.meta.url), 'utf8').catch(() => null);
const intentModule = intentSource
  ? await import(`data:text/javascript;base64,${Buffer.from(intentSource).toString('base64')}`)
  : null;

test('composer routes explicit article requests into the learning-reading flow', () => {
  assert.ok(intentModule, 'composer intent router module is required');
  assert.equal(intentModule.classifyComposerIntent('请生成一篇关于科技的四级英语阅读'), 'generate');
  assert.equal(intentModule.classifyComposerIntent('帮我来一篇旅行主题的英文文章'), 'generate');
});

test('composer keeps questions about reading generation in the chat flow', () => {
  assert.ok(intentModule, 'composer intent router module is required');
  assert.equal(intentModule.classifyComposerIntent('怎么生成一篇适合我的文章？'), 'chat');
  assert.equal(intentModule.classifyComposerIntent('我今天最应该复习什么？'), 'chat');
});
