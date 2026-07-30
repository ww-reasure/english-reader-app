import assert from 'node:assert/strict';
import test from 'node:test';

import { createArticleStreamParser, extractArticleDraft, parseSseChunk } from '../src/article-stream.mjs';

test('parses SSE data lines across chunk boundaries and ignores the terminal marker', () => {
  const first = parseSseChunk('data: {"choices":[{"delta":{"content":"{\\"title\\":\\"A"}}]}\r\n');
  assert.deepEqual(first.events, ['{"choices":[{"delta":{"content":"{\\"title\\":\\"A"}}]}']);
  assert.equal(first.remainder, '');

  const second = parseSseChunk('t"}}]}\n\ndata: [DONE]\n', 'data: {"choices":[{"delta":{"content":"par');
  assert.deepEqual(second.events, ['{"choices":[{"delta":{"content":"part"}}]}', '[DONE]']);
  assert.equal(second.remainder, '');
});

test('extracts confirmed article fields from a partial JSON response without treating it as final', () => {
  const draft = extractArticleDraft('{"title":"A short title","titleZh":"短标题","content":"First sentence. Second');
  assert.deepEqual(draft, {
    title: 'A short title',
    titleZh: '短标题',
    content: 'First sentence. Second',
    translation: ''
  });
});

test('streams draft snapshots while preserving escaped text and parses the final article only after completion', () => {
  const snapshots = [];
  const parser = createArticleStreamParser({ onDraft: draft => snapshots.push(draft) });
  parser.push('{"title":"A \\"safe\\" title","titleZh":"安全标题","content":"First ');
  parser.push('sentence. Second sentence.","translation":"第一句。第二句。"}');

  assert.ok(snapshots.some(snapshot => snapshot.content === 'First '));
  assert.equal(parser.finish().title, 'A "safe" title');
  assert.equal(parser.finish().translation, '第一句。第二句。');
});
