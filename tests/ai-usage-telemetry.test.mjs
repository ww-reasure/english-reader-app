import assert from 'node:assert/strict';
import test from 'node:test';

import { createAIUsageTelemetry, normalizeAIUsage } from '../src/components/ai-usage-telemetry.mjs';

function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}

test('normalizes DeepSeek cache usage without retaining prompts or responses', () => {
  assert.deepEqual(normalizeAIUsage({
    prompt_tokens: 120,
    completion_tokens: 20,
    prompt_cache_hit_tokens: 80,
    prompt_cache_miss_tokens: 40
  }), { inputTokens: 120, outputTokens: 20, cacheHitTokens: 80, cacheMissTokens: 40 });
});

test('keeps only the latest fifty anonymous home request stages', () => {
  const telemetry = createAIUsageTelemetry({ storage: memory(), now: () => 99 });
  for (let index = 0; index < 53; index += 1) {
    telemetry.record({ requestId: `request-${index}`, phase: 'initial', usage: { prompt_tokens: index } });
  }
  const rows = telemetry.getRecent();
  assert.equal(rows.length, 50);
  assert.equal(rows[0].inputTokens, 3);
  assert.equal(rows.at(-1).inputTokens, 52);
  assert.equal(JSON.stringify(rows).includes('prompt'), false);
});
