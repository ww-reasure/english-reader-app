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

test('reading title and body delegate to the shared Tooltip and Dictionary lookup with close-first behavior', async () => {
  const [source, lookupSource] = await Promise.all([
    readSource(),
    readFile(new URL('../src/components/reading-word-lookup.js', import.meta.url), 'utf8')
  ]);

  assert.match(source, /id="readingTitleLookup"/);
  assert.match(source, /const titleLookupHost = document\.getElementById\('readingTitleLookup'\);/);
  assert.match(source, /bindLearningTextLookup\(\{/);
  assert.match(source, /getContextSentence: event => this\.getLookupSentence\(event\) \|\| \(event\.target\.closest\?\.\('#readingTitleLookup'/);
  assert.match(source, /getTargetTrack: \(\) => articleTrack\.targetTrack/);
  assert.match(lookupSource, /if \((?:Tooltip|tooltipApi)\.isVisible\(\)\) \{[\s\S]*?hide\(\);[\s\S]*?return;/);
  assert.match(lookupSource, /const lookupId = (?:Tooltip|tooltipApi)\.beginLookup\(x, y\);/);
  assert.match(lookupSource, /const data = await (?:Dictionary|dictionary)\.lookup\(word\);/);
  assert.match(lookupSource, /(?:Tooltip|tooltipApi)\.show\(lookupId, x, y, data, reviewWord/);
  assert.match(lookupSource, /contextSentence/);
  assert.match(lookupSource, /targetTrack/);
  assert.match(source, /onShown: \(\{ event, word, data, reviewWord, lookupId \}\)/);
  assert.match(source, /knowledgeEvidenceBridge\.recordLookup/);
});
