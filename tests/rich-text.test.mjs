import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function loadRenderer() {
  const source = await readFile(new URL('../src/components/rich-text.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('renders supported learning markdown into readable semantic blocks', async () => {
  const { renderLearningMarkdown } = await loadRenderer();
  const html = renderLearningMarkdown('## 重点词汇\n- **brain drain**：人才流失\n- `emigrate`：移居\n\n> 注意搭配');

  assert.match(html, /<h2>重点词汇<\/h2>/);
  assert.match(html, /<ul><li><strong>brain drain<\/strong>：人才流失<\/li>/);
  assert.match(html, /<code>emigrate<\/code>/);
  assert.match(html, /<blockquote>注意搭配<\/blockquote>/);
});

test('escapes model-provided HTML before formatting markdown', async () => {
  const { renderLearningMarkdown } = await loadRenderer();
  const html = renderLearningMarkdown('<img src=x onerror=alert(1)>\n\n**安全**');

  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>安全<\/strong>/);
});
