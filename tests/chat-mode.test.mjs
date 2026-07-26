import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('chat view uses one composer for learning chat and article generation', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /chat-mode-switch/);
  assert.match(source, /classifyComposerIntent/);
  assert.match(source, /buildGenerationContext/);
  assert.match(source, /问问题，或说“生成一篇/);
  assert.match(source, /ChatService/);
  assert.match(source, /import \{ LEARNING_TOOLS, LearningAgent \} from '\.\.\/components\/learning-agent\.js';/);
  assert.match(source, /appClearContextBtn/);
  assert.match(source, /conversationStore\.clear\('home'\)/);
  assert.match(source, /resetGenerateButton\(\)/);
  assert.match(source, /文章定制中/);
  assert.match(source, /article-generation-status/);
  assert.match(source, /HOME_LEARNING_TOOLS/);
});

test('chat generation uses the resolved request and renders retryable validation failures', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ resolveGenerationRequest \} from '\.\.\/components\/generation-request\.js';/);
  assert.match(source, /legacyLevel:\s*Config\.get\('level'\)/);
  assert.match(source, /providedGeneration/);
  assert.match(source, /onProgress:/);
  assert.match(source, /generation_failure/);
  assert.match(source, /addGenerationFailure/);
  assert.match(source, /alreadyAdded:\s*true/);
});

test('validation failure cards keep a dedicated retry affordance', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /generation-failure-card/);
  assert.match(source, /generation-retry-btn/);
  assert.match(css, /\.generation-failure-card/);
  assert.match(css, /\.generation-retry-btn/);
});

test('retrying a failed generation replaces its persisted failure card instead of appending another one', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(source, /retryFailureId/);
  assert.match(source, /replaceGenerationFailure\(retryFailureId,/);
  assert.match(source, /removeGenerationFailure\(retryFailureId\)/);
  assert.match(source, /conversationStore\.replaceMessage\('home'/);
  assert.match(source, /conversationStore\.removeMessages\('home'/);
  assert.match(source, /\.finally\(\(\) => this\.setGenerationFailureRetryState\(stableId, false\)\)/);
});

test('chat invalidates stale home requests and resolves controlled agent generation preferences', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ HomeRequestGate \} from '\.\.\/components\/home-request-gate\.mjs';/);
  assert.match(source, /homeRequestGate\.begin\(\)/);
  assert.match(source, /homeRequestGate\.isCurrent\(/);
  assert.match(source, /toolDifficulty:\s*args\.difficulty/);
  assert.match(source, /toolWordCount:\s*args\.wordCount/);
  assert.match(source, /generation-failure\.mjs/);
});

test('chat supersession clears stale UI and keeps agent failure retries safe', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const begin = source.match(/beginHomeRequest\(\) \{([\s\S]*?)\n  \},\n\n  isHomeRequestActive/);

  assert.ok(begin, 'beginHomeRequest should remain a distinct request-boundary helper');
  assert.match(begin[1], /chatService\.cancel\('home'\)/);
  assert.match(begin[1], /resetGenerateButton\(\)/);
  assert.match(begin[1], /removeThinking\(\)/);
  assert.match(begin[1], /removeArticleGenerationStatus\(\)/);
  assert.match(source, /normalizeGenerationFailure\(artifact\.failure, value\)/);
  assert.match(source, /normalizeGenerationFailure as hydrateGenerationFailure/);
  assert.match(source, /homeRequestGate\.invalidate\(\)/);
  assert.match(source, /if \(!this\.isHomeRequestActive\(epoch, requestVersion\) \|\| signal\?\.aborted\)/);
});

test('cancelled multi-part review generation removes unpublished saved articles', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(source, /discardReviewArticles\(articles\)/);
  assert.match(source, /const isCurrentReviewSession = isReviewSessionActive\(\);[\s\S]*?if \(!isCurrentReviewSession && articles\.length\) await this\.discardReviewArticles\(articles\)/);
  assert.match(source, /DB\.deleteArticle/);
});
