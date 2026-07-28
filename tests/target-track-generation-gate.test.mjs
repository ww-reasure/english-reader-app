import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const VIEW_CASES = [
  {
    file: '../src/views/chat.js',
    entries: ['async executeHomeTool', 'async handleGenerate', 'async handleReviewGenerate']
  },
  {
    file: '../src/views/flashcard.js',
    entries: ['async generateReviewArticle']
  },
  {
    file: '../src/views/reading.js',
    entries: ['async generateReview']
  }
];

test('every article-writing entry point routes an unselected target through calibration', async () => {
  for (const view of VIEW_CASES) {
    const source = await readFile(new URL(view.file, import.meta.url), 'utf8');
    assert.match(source, /requiresTargetTrackSelection/, `${view.file} must import the shared target gate`);
    assert.match(source, /ensureTargetTrackBeforeGeneration\(\) \{[\s\S]*?requiresTargetTrackSelection/, `${view.file} must derive its gate from persisted configuration`);

    for (const entry of view.entries) {
      const start = source.indexOf(entry);
      assert.ok(start >= 0, `${view.file} must keep ${entry} as a distinct generation entry point`);
      const entryBody = source.slice(start, start + 4000);
      const gateIndex = entryBody.indexOf('ensureTargetTrackBeforeGeneration()');
      assert.ok(gateIndex >= 0, `${entry} must gate before any article write`);

      if (view.file.endsWith('/chat.js') && ['async executeHomeTool', 'async handleGenerate'].includes(entry)) {
        const resolutionIndex = entryBody.indexOf('this.resolveDirectGenerationRequest');
        const writeIndex = entryBody.indexOf('articleGenerationTool.execute');
        assert.ok(resolutionIndex >= 0 && resolutionIndex < gateIndex, `${entry} must resolve a direct user target before the gate`);
        assert.ok(writeIndex >= 0 && gateIndex < writeIndex, `${entry} must still gate before article persistence`);
      } else {
        assert.ok(gateIndex < 700, `${entry} must gate before generation work starts`);
      }
    }
  }
});

test('agent generation treats a missing target as a terminal blocked artifact rather than asking the model to continue', async () => {
  const source = await readFile(new URL('../src/components/chat-service.js', import.meta.url), 'utf8');

  assert.match(source, /generation_blocked/);
  assert.match(source, /artifacts\.some\(item => item\.type === 'generation_blocked'\)/);
});
