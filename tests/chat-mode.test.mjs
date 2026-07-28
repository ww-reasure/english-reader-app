import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('chat view uses one composer for learning chat and article generation', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /chat-mode-switch/);
  assert.match(source, /isGenerationAuthorized/);
  assert.doesNotMatch(source, /if \(classifyComposerIntent\(value\) === 'generate'\)/);
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

test('chat only uses the legacy local generation classifier after tool support is unavailable', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const submitStart = source.indexOf('async submitComposer()');
  const submitEnd = source.indexOf('async executeHomeTool', submitStart);
  const submit = source.slice(submitStart, submitEnd);

  assert.ok(submitStart >= 0 && submitEnd > submitStart, 'submitComposer must remain a distinct agent entry point');
  assert.match(submit, /reply\.toolSupport === 'unsupported'/);
  assert.match(submit, /classifyComposerIntent\(value\) === 'generate'/);
  assert.ok(
    submit.indexOf("reply.toolSupport === 'unsupported'") < submit.indexOf("classifyComposerIntent(value) === 'generate'"),
    'the compatibility classifier must be gated behind a tool-support result'
  );
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

test('skipping calibration keeps a conservative uncalibrated profile instead of recording a fake completed assessment', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const skip = source.match(/skipAssessment\(\) \{([\s\S]*?)\r?\n  \},\r?\n\r?\n  \/\/ Clear chat history/);

  assert.ok(skip, 'skipAssessment should remain a focused configuration transition');
  assert.match(skip[1], /Config\.set\('assessment_done', 'false'\)/);
  assert.match(skip[1], /Config\.set\('calibration_status', 'skipped'\)/);
  assert.match(skip[1], /Config\.set\('reading_mode', 'support'\)/);
  assert.doesNotMatch(skip[1], /Config\.set\('assessment_done', 'true'\)/);
});

test('persists only a direct user target change and does not let an agent tool silently change the saved target', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(source, /commitGenerationTargetSelection\(generation\)/);
  assert.match(source, /targetSelectionRequested/);
  assert.match(source, /Config\.set\('exam_level', target\)/);
  assert.match(source, /Config\.set\('target_track_selection_required', 'false'\)/);
  assert.match(source, /difficultySelect\.addEventListener\('change'/);
});

test('an unselected target stays visibly unselected while direct user exam text is resolved before the generation gate', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const toolStart = source.indexOf('async executeHomeTool');
  const toolEnd = source.indexOf('buildGenerationContext()', toolStart);
  const directStart = source.indexOf('async handleGenerate');
  const directEnd = source.indexOf('publishReviewArticles', directStart);
  const toolEntry = source.slice(toolStart, toolEnd);
  const directEntry = source.slice(directStart, directEnd);

  assert.match(source, /<option value=""[^>]*>选择目标考试<\/option>/);
  assert.ok(toolStart >= 0 && toolEnd > toolStart, 'agent generation should keep its own entry point');
  assert.ok(directStart >= 0 && directEnd > directStart, 'direct generation should keep its own entry point');
  assert.match(toolEntry, /const directUserRequest = String\(userRequest \|\| ''\)\.trim\(\);/);
  assert.match(toolEntry, /allowExplicitUserTarget: Boolean\(directUserRequest\)/);
  assert.ok(
    toolEntry.indexOf('this.resolveDirectGenerationRequest') < toolEntry.indexOf('this.ensureTargetTrackBeforeGeneration()'),
    'explicit user target text must be resolved before the target gate'
  );
  assert.ok(
    directEntry.indexOf('this.resolveDirectGenerationRequest') < directEntry.indexOf('this.ensureTargetTrackBeforeGeneration()'),
    'direct article requests must resolve an explicit target before the target gate'
  );
});

test('chat generation entries preserve an unselected target instead of silently treating it as CET-4', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const entries = [
    ['async executeHomeTool', 'buildGenerationContext()'],
    ['async handleGenerate', 'publishReviewArticles']
  ];

  for (const [startMarker, endMarker] of entries) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    const entry = source.slice(start, end);
    assert.match(entry, /const selectedDifficulty = document\.getElementById\('difficultySelect'\)\?\.value \|\| Config\.get\('exam_level'\);/);
    assert.doesNotMatch(entry, /selectedDifficulty[^\n]*\|\| 'cet4'/);
  }
});

test('chat supersession clears stale UI and keeps agent failure retries safe', async () => {
  const source = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
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

test('cancelled review generation removes only an unpublished saved article', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

  assert.match(source, /await this\.discardReviewArticles\(\[result\.article\]\)/);
  assert.match(source, /DB\.deleteArticle/);
});

test('generation prompts keep prior article and failure facts while excluding the current duplicated request', async () => {
  const source = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');
  const start = source.indexOf('buildGenerationContext(');
  const end = source.indexOf('// Get selected topic', start);
  const implementation = source.slice(start, end);

  assert.match(implementation, /excludeUserMessage/);
  assert.match(implementation, /message\.kind === 'article'/);
  assert.match(implementation, /message\.kind === 'generation_failure'/);
  assert.match(source, /buildGenerationContext\(\{ excludeUserMessage: generation\.request \}\)/);
});

test('clearing or superseding the home request releases a review-generation lock', async () => {
  const source = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const begin = source.match(/beginHomeRequest\(\) \{([\s\S]*?)\n  \},\n\n  isHomeRequestActive/);

  assert.ok(begin, 'beginHomeRequest should remain the shared cancellation boundary');
  assert.match(begin[1], /this\.isReviewGenerating = false/);
});
