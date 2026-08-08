import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSelectedText, isSingleEnglishWord, createSelectionQuote } from '../src/exam/selectable-text-actions.mjs';
import { ExamTutorContextBuilder } from '../src/exam/exam-tutor-context.mjs';
import { ExamTutorMessageBuilder, ExamTutorService } from '../src/exam/exam-tutor-service.mjs';

class MemoryConversationStore {
  constructor() { this.sessions = new Map(); }
  getSession(key) { return this.sessions.get(key) || { summary: '', messages: [], activities: [] }; }
  append(key, message) {
    const session = this.getSession(key);
    this.sessions.set(key, { ...session, messages: [...session.messages, message] });
  }
}

function source({ attemptId = 'attempt-1', questionKey = 'q21' } = {}) {
  return {
    attempt: { attemptId, status: 'submitted', examId: 'exam', unitKey: 'unit' },
    response: { questionKey, answer: 'B', correctOptionKeyAtSubmit: 'D', uncertain: false },
    question: { questionKey, stem: 'Stem', options: [{ key: 'A', text: 'A' }, { key: 'D', text: 'D' }], evidence: 'Evidence.' },
    unit: { type: 'reading_mcq', passage: [{ key: 'P1', text: 'Passage.' }] }
  };
}

test('selection helpers normalize excerpts and distinguish a single English word', () => {
  assert.equal(normalizeSelectedText('  has\n provided   strong support for  '), 'has provided strong support for');
  assert.equal(isSingleEnglishWord('support'), true);
  assert.equal(isSingleEnglishWord('support for'), false);
  assert.deepEqual(createSelectionQuote('has provided strong support for', 'evidence'), {
    selectedText: 'has provided strong support for', selectedSource: 'evidence'
  });
});

test('quote is added to the submitted context and persisted on the same conversation', async () => {
  const calls = [];
  const store = new MemoryConversationStore();
  const service = new ExamTutorService({
    chatService: { ask: async request => { calls.push(request); return { content: 'reply' }; } },
    conversationStore: store,
    contextBuilder: new ExamTutorContextBuilder()
  });
  const input = source();
  await service.ask({ ...input, userMessage: '为什么？', quote: createSelectionQuote('Evidence.', 'evidence') });
  assert.deepEqual(calls[0].pageContext.exam.quote, { selectedText: 'Evidence.', selectedSource: 'evidence' });
  assert.deepEqual(store.getSession('exam:attempt-1:question:q21').messages[0].quote, { selectedText: 'Evidence.', selectedSource: 'evidence' });
  assert.equal(input.question.evidence, 'Evidence.');
});

test('follow-up message builder includes quote as a local user-message supplement', () => {
  const messages = new ExamTutorMessageBuilder().build({
    pageContext: { exam: { quote: { selectedText: 'has provided strong support for', selectedSource: 'evidence' } } },
    messages: [{ role: 'user', kind: 'text', content: '为什么？', quote: { selectedText: 'has provided strong support for', selectedSource: 'evidence' } }],
    userMessage: '继续解释'
  });
  assert.match(messages[2].content, /引用（evidence）/);
  assert.match(messages[2].content, /has provided strong support for/);
});

test('different question or attempt gets an isolated conversation for a quote', async () => {
  const calls = [];
  const store = new MemoryConversationStore();
  const service = new ExamTutorService({
    chatService: { ask: async request => { calls.push(request); return { content: 'reply' }; } },
    conversationStore: store,
    contextBuilder: new ExamTutorContextBuilder()
  });
  await service.ask({ ...source(), userMessage: 'q1', quote: createSelectionQuote('one', 'question') });
  await service.ask({ ...source({ questionKey: 'q22' }), userMessage: 'q2', quote: createSelectionQuote('two', 'explanation') });
  await service.ask({ ...source({ attemptId: 'attempt-2' }), userMessage: 'q3', quote: createSelectionQuote('three', 'ai_message') });
  assert.deepEqual(calls.map(call => call.sessionKey), [
    'exam:attempt-1:question:q21', 'exam:attempt-1:question:q22', 'exam:attempt-2:question:q21'
  ]);
});
