import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiGrammarFallback } from '../src/components/ai-grammar-fallback.mjs';

const validMetrics = {
  tokenCount: 40,
  sentenceCount: 3,
  clauseRelationCount: 5,
  passivePredicateCount: 1,
  nonFiniteRelationCount: 2,
  maxDependencyDepth: 5
};

test('uses JSON mode and labels an AI grammar fallback explicitly', async () => {
  let request;
  const fallback = createAiGrammarFallback({
    api: {
      async chat(messages, options) {
        request = { messages, options };
        return { content: JSON.stringify({ metrics: validMetrics }) };
      }
    }
  });

  const result = await fallback('A passage with several sentences.');

  assert.deepEqual(result, { status: 'available', source: 'ai_fallback', metrics: validMetrics });
  assert.deepEqual(request.options.responseFormat, { type: 'json_object' });
  assert.equal(request.options.temperature, 0);
  assert.match(request.messages[0].content, /Return JSON only/);
});

test('refuses malformed AI metrics rather than inventing a local parse', async () => {
  const fallback = createAiGrammarFallback({
    api: { async chat() { return { content: JSON.stringify({ metrics: { tokenCount: 3 } }) }; } }
  });

  const result = await fallback('A short passage.');

  assert.deepEqual(result, {
    status: 'unavailable',
    source: 'ai_fallback',
    reason: 'AI_GRAMMAR_RESPONSE_INVALID',
    metrics: null
  });
});

test('does not turn a cancelled fallback request into a successful or hidden result', async () => {
  const controller = new AbortController();
  controller.abort();
  const fallback = createAiGrammarFallback({
    api: { async chat() { throw new Error('cancelled'); } }
  });

  await assert.rejects(fallback('A passage.', { signal: controller.signal }), /cancelled/);
});
