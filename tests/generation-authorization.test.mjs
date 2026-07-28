import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/components/generation-authorization.mjs', import.meta.url), 'utf8').catch(() => null);
const authorization = source
  ? await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  : null;

test('authorizes only an explicit current request for a reading card', () => {
  assert.ok(authorization, 'generation authorization module is required');

  assert.equal(authorization.isGenerationAuthorized('请生成一篇考研英语一阅读'), true);
  assert.equal(authorization.isGenerationAuthorized('根据我薄弱词来一篇练习'), true);
  assert.equal(authorization.isGenerationAuthorized('给我一篇旅行主题的英语文章'), true);
});

test('rejects article follow-ups and filler messages as generation authority', () => {
  assert.ok(authorization, 'generation authorization module is required');

  assert.equal(authorization.isGenerationAuthorized('这是一篇什么类型的文章'), false);
  assert.equal(authorization.isGenerationAuthorized('为什么刚才只生成了一篇'), false);
  assert.equal(authorization.isGenerationAuthorized('啊？'), false);
});
