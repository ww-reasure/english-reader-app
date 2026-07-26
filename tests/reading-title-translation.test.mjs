import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readingUrl = new URL('../src/views/reading.js', import.meta.url);

test('reading title exposes a collapsed cloud translation only when titleZh is available', async () => {
  const source = await readFile(readingUrl, 'utf8');

  assert.match(source, /_renderArticleTitle\(article\)/);
  assert.match(source, /const titleZh = String\(article\.titleZh \|\| ''\)\.trim\(\);/);
  assert.match(
    source,
    /\$\{titleZh \? `[^`]*reading-title-translate[^`]*style="display:none"[^`]*` : ''\}/s
  );
  assert.doesNotMatch(source, /translateWord/);
});

test('reading title uses the shared Tooltip and Dictionary lookup with close-first behavior', async () => {
  const source = await readFile(readingUrl, 'utf8');

  assert.match(source, /id="readingTitleLookup"/);
  assert.match(source, /const titleLookupHost = document\.getElementById\('readingTitleLookup'\);/);
  assert.match(source, /const titleLookupHandler = e => \{\s*e\.stopPropagation\(\);\s*lookupWord\(e\);\s*\};/);
  assert.match(source, /titleLookupHost\?\.addEventListener\('click', titleLookupHandler\);/);

  const lookup = source.match(/const lookupWord = async \(e, \{ allowSentenceAnalysis = false, recordLookup = false \} = \{\}\) => \{([\s\S]*?)\n    \};/);
  assert.ok(lookup, 'shared title/body word lookup handler should exist');
  assert.match(lookup[1], /if \(Tooltip\.isVisible\(\)\) \{[\s\S]*?Tooltip\.hide\(\);[\s\S]*?return;/);
  assert.match(lookup[1], /const lookupId = Tooltip\.beginLookup\(e\.clientX, e\.clientY\);/);
  assert.match(lookup[1], /const data = await Dictionary\.lookup\(word\);/);
  assert.match(lookup[1], /await Tooltip\.show\(lookupId, e\.clientX, e\.clientY, data, isReviewWord\)/);
  assert.match(lookup[1], /if \(recordLookup && !this\.clickedWords\.some/);
  assert.match(source, /articleBody\.addEventListener\('click', e => lookupWord\(e, \{ allowSentenceAnalysis: true, recordLookup: true \}\)\);/);
  assert.doesNotMatch(source.match(/const titleLookupHandler = e => \{[\s\S]*?\n    \};/)?.[0] || '', /recordLookup|clickedWords/);
});
