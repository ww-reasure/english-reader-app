import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_IMPORT_BYTES,
  contentFingerprint,
  countEnglishWords,
  normalizeImportedContent,
  parseImportedDocument,
  prepareImportedArticle,
  titleFromFileName,
  validateImportedContent
} from '../src/components/article-import.mjs';

function file({ name, type = '', content, size = Buffer.byteLength(content) }) {
  let reads = 0;
  return {
    name,
    type,
    size,
    get reads() { return reads; },
    async text() {
      reads += 1;
      return content;
    }
  };
}

test('normalizes text, markdown and HTML without retaining executable or formatting markup', () => {
  const html = '\ufeff<h1>Reading&nbsp;note</h1><script>alert(1)</script><style>.x{}</style><p>First\u200b sentence.</p><p>Second <strong>sentence</strong>.</p>';
  assert.equal(
    normalizeImportedContent(html, { format: 'html' }),
    'Reading note\n\nFirst sentence.\n\nSecond sentence.'
  );
  assert.equal(
    normalizeImportedContent('# Title\r\n\r\n- [Read](https://example.com) **this**.\r> Keep `visible code`.', { format: 'markdown' }),
    'Title\n\nRead this.\nKeep visible code.'
  );
  assert.equal(normalizeImportedContent('\ufeffOne\r\n\r\n\r\nTwo\u200d  words.'), 'One\n\nTwo words.');
});

test('counts English words and validates the 3 to 50000 word limits', () => {
  assert.equal(countEnglishWords("It's a well-tested reader."), 4);
  assert.equal(validateImportedContent('Only two').valid, false);
  assert.equal(validateImportedContent('Only three words').valid, true);
  assert.equal(validateImportedContent('只有中文内容').valid, false);
  assert.equal(validateImportedContent('word '.repeat(50001)).valid, false);
});

test('derives titles and accepts supported txt, markdown and HTML variants', async () => {
  assert.equal(titleFromFileName('  my-reading_article.HTML  '), 'my reading article');
  for (const [name, type, format] of [
    ['note.txt', 'text/plain', 'text'],
    ['note.md', 'text/markdown', 'markdown'],
    ['note.markdown', '', 'markdown'],
    ['note.html', 'text/html', 'html'],
    ['note.htm', 'application/xhtml+xml', 'html']
  ]) {
    const parsed = await parseImportedDocument(file({
      name,
      type,
      content: format === 'html' ? '<p>This is valid imported content.</p>' : 'This is valid imported content.'
    }));
    assert.equal(parsed.format, format);
    assert.equal(parsed.sourceType, 'imported');
    assert.equal(parsed.source, 'local');
    assert.equal(parsed.wordCount, 5);
  }
});

test('rejects oversize and explicitly unsupported files before reading', async () => {
  const oversized = file({
    name: 'large.txt',
    type: 'text/plain',
    content: 'This content should never be read.',
    size: MAX_IMPORT_BYTES + 1
  });
  await assert.rejects(parseImportedDocument(oversized), error => error.code === 'IMPORT_FILE_TOO_LARGE');
  assert.equal(oversized.reads, 0);

  const wrongExtension = file({ name: 'note.pdf', type: 'text/plain', content: 'This is valid imported content.' });
  await assert.rejects(parseImportedDocument(wrongExtension), error => error.code === 'UNSUPPORTED_IMPORT_FILE');
  assert.equal(wrongExtension.reads, 0);

  const wrongMime = file({ name: 'note.txt', type: 'image/png', content: 'This is valid imported content.' });
  await assert.rejects(parseImportedDocument(wrongMime), error => error.code === 'UNSUPPORTED_IMPORT_FILE');
  assert.equal(wrongMime.reads, 0);
});

test('allows an empty or generic MIME only when the extension is supported', async () => {
  const emptyMime = await parseImportedDocument(file({ name: 'note.md', content: 'This is valid imported content.' }));
  assert.equal(emptyMime.format, 'markdown');
  const genericMime = await parseImportedDocument(file({ name: 'note.txt', type: 'application/octet-stream', content: 'This is valid imported content.' }));
  assert.equal(genericMime.format, 'text');
  await assert.rejects(
    parseImportedDocument(file({ name: 'note', content: 'This is valid imported content.' })),
    error => error.code === 'UNSUPPORTED_IMPORT_FILE'
  );
});

test('fingerprints ignore case, whitespace and harmless punctuation spacing but not different content', () => {
  const first = contentFingerprint('Hello, world!\nThis is a test.');
  assert.equal(first, contentFingerprint(' hello ,world ! this IS a test . '));
  assert.notEqual(first, contentFingerprint('Hello, reader! This is a test.'));
});

test('prepared article uses the final edited text and carries durable import metadata', () => {
  const article = prepareImportedArticle({
    title: ' Edited title ',
    content: 'This is final <visible> edited text.',
    translation: '  最终译文  ',
    difficulty: 'cet6',
    fileName: 'original.html'
  });
  assert.equal(article.title, 'Edited title');
  assert.equal(article.content, 'This is final <visible> edited text.');
  assert.equal(article.translation, '最终译文');
  assert.equal(article.sourceType, 'imported');
  assert.equal(article.source, 'local');
  assert.equal(article.fileName, 'original.html');
  assert.equal(article.wordCount, 6);
  assert.equal(article.contentFingerprint, contentFingerprint(article.content));
});
