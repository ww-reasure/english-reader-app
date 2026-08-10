import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readingUrl = new URL('../src/views/reading.js', import.meta.url);
const readSource = async () => (await readFile(readingUrl, 'utf8')).replace(/\r\n?/g, '\n');
const readLookup = async () => (await readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');

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

test('reading title and body use one close-first Tooltip and Dictionary lookup path', async () => {
  const [source, lookup] = await Promise.all([readSource(), readLookup()]);

  assert.match(source, /id="readingTitleLookup"/);
  assert.match(source, /const titleLookupHost = document\.getElementById\('readingTitleLookup'\);/);
  assert.match(source, /const lookupRoots = \[articleBody, titleLookupHost\]\.filter\(Boolean\);/);
  assert.match(source, /root: lookupRoot,/);
  assert.match(source, /getTargetTrack: \(\) => articleTrack\.targetTrack/);
  assert.match(source, /if \(!articleBody\?\.contains\(event\.target\) \|\| this\.clickedWords\.some/);
  assert.match(lookup, /if \(Tooltip\.isVisible\(\)\) \{[\s\S]*?hide\(\);[\s\S]*?return;/);
  assert.match(lookup, /const lookupId = Tooltip\.beginLookup\(x, y\);/);
  assert.match(lookup, /const data = await Dictionary\.lookup\(word\);/);
  assert.match(lookup, /await Tooltip\.show\(lookupId, x, y, data, reviewWord, \{ contextSentence, targetTrack \}\)/);
});
