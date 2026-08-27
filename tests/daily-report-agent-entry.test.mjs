import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { classifyHomeLearningRequest } from '../src/components/home-guided-learning.mjs';

const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const start = chatSource.indexOf(startMarker);
  const end = chatSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source end marker: ${endMarker}`);
  return chatSource.slice(start, end);
}

test('the daily report button delegates to the normal composer and guards duplicate clicks', () => {
  assert.match(chatSource, /data-action="daily-report"/);
  const handler = section('  async handleDailyReport()', '  async executeHomeTool');
  assert.match(handler, /_dailyReportRequestPending/);
  assert.match(handler, /if\s*\(this\._dailyReportRequestPending\)\s*return/);
  assert.match(handler, /this\.submitComposer\s*\(\{[\s\S]*explicitText\s*:\s*'给我今日日报'[\s\S]*consumeComposer\s*:\s*false[\s\S]*\}\)/);
  assert.doesNotMatch(handler, /input\.value\s*=|imageDraftGroupId\s*=|activeImageGroupId\s*=|clearChatFollowUp\(/);
  assert.doesNotMatch(handler, /getOrCreate|publishDailyReport|dailyReportAnalyzer|DailyReportAnalyzer/);
});

test('explicit daily report requests leave input, image, and quote state untouched', () => {
  const submitter = section('  async submitComposer', '  async handleDailyReport');
  assert.match(submitter, /async submitComposer\(\{\s*explicitText\s*=\s*null\s*,\s*consumeComposer\s*=\s*true\s*\}\s*=\s*\{\}\)/);
  assert.match(submitter, /const value = explicitText == null/);
  assert.match(submitter, /const draftGroupId = consumeComposer\s*\?\s*this\.imageDraftGroupId\s*:\s*null/);
  assert.match(submitter, /const activeImageGroupId = consumeComposer\s*\?\s*this\.activeImageGroupId\s*:\s*null/);
  assert.match(submitter, /const selectedExcerpt = consumeComposer\s*\?\s*normalizeSelectedExcerpt\(this\._chatFollowUpExcerpt\)\s*:\s*''/);
  assert.match(submitter, /if\s*\(consumeComposer && input\)\s*input\.value\s*=\s*''/);
  assert.match(submitter, /const guidedReplyTarget = consumeComposer/);
});

test('daily report submission uses the same Main Agent request and publish path', () => {
  const submitter = section('  async submitComposer', '  async handleDailyReport');
  assert.match(submitter, /this\.appendConversation\s*\(/);
  assert.match(submitter, /chatService\.ask\s*\(/);
  assert.equal((submitter.match(/chatService\.ask\s*\(/g) || []).length, 1);
  assert.match(submitter, /tools:\s*HOME_LEARNING_TOOLS/);
  assert.match(submitter, /executeTool:\s*\(name, args, context\) => this\.executeHomeTool/);
  assert.match(submitter, /publishHomeAgentReply\(reply/);
});

test('the daily report request stays on tool_choice auto instead of bypassing the harness', () => {
  const toolBranch = section("    if (name === 'get_today_learning_report')", "    if (name === 'list_recent_learning_reports'");
  assert.match(toolBranch, /learningAgent\.execute\(name, args\)/);
  assert.match(toolBranch, /toDailyReportToolResult\(report\)/);
  assert.match(toolBranch, /dailyReportArtifactOf\(report\)/);
  const submitter = section('  async submitComposer', '  async handleDailyReport');
  assert.match(submitter, /tools:\s*HOME_LEARNING_TOOLS/);
  assert.match(submitter, /executeTool:/);
});

test('the normal publish path emits the agent reply and one daily report artifact', () => {
  const publisher = section('  async publishHomeAgentReply(', '  async publishDailyReportArtifact');
  assert.match(publisher, /this\.appendConversation\(\{ role: 'assistant'/);
  assert.match(publisher, /for \(const artifact of reply\?\.artifacts \|\| \[\]\)/);
  assert.match(publisher, /publishDailyReportArtifact\(artifact\)/);
  const reportPublisher = section('  publishDailyReport(report, artifact = null)', '  createGenerationFailure');
  assert.match(reportPublisher, /existingReference/);
  assert.match(reportPublisher, /existingElement/);
});

test('manual input for today report remains an ordinary home request', () => {
  const request = classifyHomeLearningRequest('给我今日日报', 'balanced');
  assert.equal(request.route, 'normal');
});
