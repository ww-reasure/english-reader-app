import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeImportedContent,
  countEnglishWords,
  titleFromFileName,
  validateImportedContent,
  contentFingerprint,
  parseImportedDocument
} from '../src/components/article-import.mjs';

test('normalizes HTML, Markdown noise, BOM and zero-width characters into paragraphs', () => {
  const html = '\ufeff<h1>Ignored heading</h1><p>First&nbsp;sentence.</p><p>Second <strong>sentence</strong>.</p><!-- note -->';
  const normalized = normalizeImportedContent(html, { format: 'html' });

  assert.equal(normalized, 'Ignored heading\n\nFirst sentence.\n\nSecond sentence.');
  assert.equal(normalizeImportedContent('# Title\n\n[Read](https://example.com) **this**.', { format: 'markdown' }), 'Title\n\nRead this.');
});

test('derives a readable title from supported file names and counts English words', () => {
  assert.equal(titleFromFileName('  my-reading_article.HTML  '), 'my reading article');
  assert.equal(countEnglishWords("It's a short, clear test."), 5);
});

test('rejects non-English or out-of-range imported content with actionable errors', () => {
  assert.equal(validateImportedContent('只有中文内容').valid, false);
  assert.equal(validateImportedContent('Too short').valid, false);
  assert.equal(validateImportedContent('This is a sufficiently long English article for import.').valid, true);
});

test('fingerprint is stable across harmless whitespace changes and parsed files carry source metadata', async () => {
  assert.equal(contentFingerprint('A sentence.\n\nAnother sentence.'), contentFingerprint(' a   sentence.\n another sentence. '));

  const parsed = await parseImportedDocument({
    name: 'reading-note.md',
    type: 'text/markdown',
    text: async () => '# Reading Note\n\nThis is a sufficiently long English article for import.'
  });
  assert.equal(parsed.title, 'reading note');
  assert.equal(parsed.sourceType, 'imported');
  assert.equal(parsed.format, 'markdown');
  assert.equal(parsed.wordCount, 11);
});
