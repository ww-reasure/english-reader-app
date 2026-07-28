import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all homepage generation paths append one final structured activity and expose a read-only activity tool', async () => {
  const source = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const agentStart = source.indexOf('async executeHomeTool');
  const agentEnd = source.indexOf('\n  buildGenerationContext(', agentStart);
  const directStart = source.indexOf('async handleGenerate');
  const directEnd = source.indexOf('publishReviewArticles', directStart);
  const reviewStart = source.indexOf('async generateReviewReadings');
  const reviewEnd = source.indexOf('// Handle review reading generation', reviewStart);

  assert.match(source, /get_recent_learning_activity/);
  assert.match(source, /conversationStore\.getRecentActivities\('home'/);
  assert.match(source, /recordHomeActivity\(/);
  assert.match(source, /conversationStore\.appendActivity\('home'/);
  assert.match(source, /session\.activities/);
  assert.match(source, /真实活动账本/);

  assert.match(source.slice(agentStart, agentEnd), /recordHomeActivity\(\{[\s\S]*?type: 'agent_generation'/);
  assert.match(source.slice(directStart, directEnd), /recordHomeActivity\(\{[\s\S]*?type: 'generation'/);
  assert.match(source.slice(reviewStart, reviewEnd), /recordHomeActivity\(\{[\s\S]*?type: 'review_generation'/);
});
