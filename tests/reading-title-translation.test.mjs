import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readingUrl = new URL('../src/views/reading.js', import.meta.url);
const readSource = async () => (await readFile(readingUrl, 'utf8')).replace(/\r\n?/g, '\n');

test('reading title exposes a collapsed cloud translation only when titleZh is available', async () => {
  const source = await readSource();

  assert.match(source, /_renderArticleTitle\(article\)/);
  assert.match(source, /const titleZh = String\(article\.titleZh \|\| ''\)\.trim\(\);/);
  assert.match(
    source,
    /\$\{titleZh \? `[^`]*reading-title-translate[^`]*style="display:none"[^`]*` : ''\}/s
  );
  assert.doesNotMatch(source, /translateWord/);
});

test('reading title uses the shared Tooltip and Dictionary lookup with close-first behavior', async () => {
  const source = await readSource();

  assert.match(source, /id="readingTitleLookup"/);
  assert.match(source, /const titleLookupHost = document\.getElementById\('readingTitleLookup'\);/);
  assert.match(source, /const titleLookupHandler = e => \{\s*e\.stopPropagation\(\);\s*lookupWord\(e\);\s*\};/);
  assert.match(source, /titleLookupHost\?\.addEventListener\('click', titleLookupHandler\);/);

  const lookup = source.match(/const lookupWord = async \(e, \{ allowSentenceAnalysis = false, recordLookup = false \} = \{\}\) => \{([\s\S]*?)\n    \};/);
  assert.ok(lookup, 'shared title/body word lookup handler should exist');
  assert.match(lookup[1], /if \(Tooltip\.isVisible\(\)\) \{[\s\S]*?Tooltip\.hide\(\);[\s\S]*?return;/);
  assert.match(lookup[1], /const lookupId = Tooltip\.beginLookup\(e\.clientX, e\.clientY\);/);
  assert.match(lookup[1], /const data = await Dictionary\.lookup\(word\);/);
  const interactions = source.match(/initInteractions\(\) \{([\s\S]*?)\n  \},\n\n  getLookupSentence/s);
  assert.ok(interactions, 'reading interactions block should be present');
  assert.match(interactions[1], /const articleTrack = resolveArticleTrack\(this\.articleData \|\| \{\}\);/);
  assert.match(lookup[1], /await Tooltip\.show\(lookupId, e\.clientX, e\.clientY, data, isReviewWord,\s*\{\s*contextSentence,\s*targetTrack: articleTrack\.targetTrack\s*\}\)/);
  assert.match(lookup[1], /if \(recordLookup && !this\.clickedWords\.some/);
  assert.match(source, /articleBody\.addEventListener\('click', e => lookupWord\(e, \{ allowSentenceAnalysis: true, recordLookup: true \}\)\);/);
  assert.doesNotMatch(source.match(/const titleLookupHandler = e => \{[\s\S]*?\n    \};/)?.[0] || '', /recordLookup|clickedWords/);
});
