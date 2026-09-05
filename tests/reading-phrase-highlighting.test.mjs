import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('word lookup binding prefers key phrases over single-word lookup', async () => {
  const source = await read('../src/components/reading-word-lookup.js');

  assert.match(source, /resolveKeyPhrase = null/);
  // 词组分支必须出现在单词解析之前，并走 tooltip 的 showPhrase 通道。
  const phraseBranchAt = source.indexOf("target.closest?.('[data-key-phrase-id]')");
  const wordResolutionAt = source.indexOf("const word = String(tokenTarget?.dataset?.wordLookupToken");
  assert.ok(phraseBranchAt > -1, 'missing key-phrase branch');
  assert.ok(wordResolutionAt > phraseBranchAt, 'key-phrase branch must precede word resolution');
  assert.match(source, /showPhrase\(phraseLookupId, x, y, \{/);
  // 词组解析失败（未加载/无条目）时回落单词查词，不能 return。
  assert.match(source, /if \(phraseData\) \{[\s\S]*?return;\s*\}\s*\}\s*\}\s*\n\n?\s*const word = /);
});

test('tooltip exposes a phrase card reusing the word-card chrome', async () => {
  const source = await read('../src/components/tooltip.js');
  assert.match(source, /showPhrase\(lookupId, x, y, \{ phrase, glossZh = '', tracks = \[\] \} = \{\}\)/);
  assert.match(source, /tooltip-key-phrase/);
  assert.match(source, /key-phrase-track-badge/);
  assert.match(source, /TRACK_LABELS/);
  assert.match(source, /this\.bindCloseButton\(tooltip\);/);
});

test('config persists the phrase highlighting switch', async () => {
  const [defaults, storageKeys] = await Promise.all([
    read('../src/config.js'),
    read('../src/config-storage.mjs')
  ]);
  assert.match(defaults, /reading_phrase_highlighting: 'true'/);
  assert.match(storageKeys, /'reading_phrase_highlighting'/);
});

test('reading view wires phrase marking into title, body, guide and the actions menu', async () => {
  const source = await read('../src/views/reading.js');

  assert.match(source, /import \{ KeyPhraseLibrary \} from '\.\.\/key-phrase-library\.mjs';/);
  assert.match(source, /renderPhraseAwareMarking, matchKeyPhraseAt/);
  assert.match(source, /phraseHighlightingEnabled = Config\.get\('reading_phrase_highlighting'\) === 'true'/);
  assert.match(source, /KeyPhraseLibrary\.getMatcher\(\{\s*targetTrack: resolveArticleTrack\(article\)\.targetTrack\s*\}\)/);
  assert.match(source, /_applyPhraseMarkingToTitle\(article\)/);
  assert.match(source, /id="phraseHighlightBtn"/);
  assert.match(source, /async togglePhraseHighlighting\(\)/);
  assert.match(source, /Config\.set\('reading_phrase_highlighting', /);
  // 正文与导读绑定都接了词组释义解析。
  assert.equal(source.match(/resolveKeyPhrase: phraseId => KeyPhraseLibrary\.getPhraseById/g)?.length, 2);
  // 词组加载失败静默降级。
  assert.match(source, /reading\.key_phrase_load_failed/);
});

test('phrase spans stay inside the sentence spans that reading progress depends on', async () => {
  const source = await read('../src/views/reading.js');
  // 续读定位依赖 .reading-sentence 的 data-sentence-* 结构：
  // 句子 span 在词组 span 之外由 _renderParagraphContent 生成，词组渲染只发生在句内文本上。
  const paragraphRenderer = source.match(/_renderParagraphContent\(paragraphIndex\) \{[\s\S]*?\n  \},/);
  assert.ok(paragraphRenderer, 'paragraph renderer not found');
  assert.match(paragraphRenderer[0], /data-sentence-index=/);
  assert.match(paragraphRenderer[0], /this\._renderMarkedText\(segment\.text\)/);
});

test('post-paint enhancements survive background-tab rAF freezing via timeout fallback', async () => {
  const [source, scheduler] = await Promise.all([
    read('../src/views/reading.js'),
    read('../src/first-paint-scheduler.mjs')
  ]);
  // reading.js 委托独立模块；超时兜底与防重入行为由 first-paint-scheduler.test.mjs 行为验证。
  assert.match(source, /_scheduleAfterFirstPaint\(callback\) \{\s*scheduleAfterFirstPaint\(callback\);?\s*\}/);
  assert.match(scheduler, /setTimeoutFn\?\.\(run, fallbackDelay\)/);
  assert.match(scheduler, /started = true/);
});

test('togglePhraseHighlighting guards against article switches while loading', async () => {
  const source = await read('../src/views/reading.js');
  const toggle = source.match(/async togglePhraseHighlighting\(\) \{[\s\S]*?\n  \},/);
  assert.ok(toggle, 'toggle not found');
  assert.match(toggle[0], /const session = this\.wordMarkingSession;/);
  assert.match(toggle[0], /session !== this\.wordMarkingSession/);
});
