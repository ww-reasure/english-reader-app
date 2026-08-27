import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AudioCache 使用真人双源解析器且没有 TTS 回退', async () => {
  const source = await readFile(new URL('../src/audio-cache.js', import.meta.url), 'utf8');

  assert.match(source, /pronunciation-resolver\.mjs/u);
  assert.match(source, /createPronunciationResolver/u);
  assert.match(source, /resolveWikimedia/u);
  assert.match(source, /fetchPronunciationResponse/u);
  assert.match(source, /暂无真人发音/u);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance|TtsBridge|TextToSpeech/u);
});
