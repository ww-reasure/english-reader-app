import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all homepage generation paths append one final structured activity and expose a read-only activity tool', async () => {
  const source = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const singleStart = source.indexOf('async executeSingleGenerationJob');
  const singleEnd = source.indexOf('async executeReviewGenerationJob', singleStart);
  const reviewStart = source.indexOf('async executeReviewGenerationJob');
  const reviewEnd = source.indexOf('async executeHomeGenerationJob', reviewStart);

  assert.match(source, /get_recent_learning_activity/);
  assert.match(source, /conversationStore\.getRecentActivities\('home'/);
  assert.match(source, /recordHomeActivity\(/);
  assert.match(source, /conversationStore\.appendActivity\('home'/);
  assert.match(source, /session\.activities/);
  assert.match(source, /真实活动账本/);

  assert.match(source.slice(singleStart, singleEnd), /recordHomeActivity\(\{[\s\S]*?type: job\.kind === 'agent' \? 'agent_generation' : 'generation'/);
  assert.match(source.slice(reviewStart, reviewEnd), /recordHomeActivity\(\{[\s\S]*?type: 'review_generation'/);
  assert.match(source, /startHomeGenerationJob\(\{[\s\S]*?kind: 'agent'/);
  assert.match(source, /startHomeGenerationJob\(\{[\s\S]*?kind: 'direct'/);
  assert.match(source, /startHomeGenerationJob\(\{[\s\S]*?kind: 'review'/);
});
