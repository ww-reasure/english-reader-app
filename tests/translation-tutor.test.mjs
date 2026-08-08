import assert from 'node:assert/strict';
import test from 'node:test';

import { ExamTutorContextBuilder } from '../src/exam/exam-tutor-context.mjs';
import {
  ExamTutorMessageBuilder,
  ExamTutorService,
  findLatestTranslationTrainingFeedback,
  validateTranslationTrainingFeedback
} from '../src/exam/exam-tutor-service.mjs';

class MemoryConversationStore {
  constructor() { this.sessions = new Map(); }
  getSession(key) { return this.sessions.get(key) || { summary: '', messages: [], activities: [] }; }
  append(key, message) {
    const session = this.getSession(key);
    this.sessions.set(key, { ...session, messages: [...session.messages, { createdAt: 1, ...message }] });
  }
}

function translationInput({ attemptId = 'translation-attempt-1', questionKey = 'q46', text = '我的不完整译文' } = {}) {
  return {
    attempt: { attemptId, examId: 'kaoyan_en1', paperKey: 'kaoyan_en1_2026', unitKey: 'part_c', status: 'submitted' },
    response: { questionKey, value: { text } },
    question: {
      questionKey,
      type: 'translation_segment',
      segmentKey: `S${questionKey.slice(1)}`,
      sourceText: 'Tracing the roots of the debate, the team found a pattern.',
      referenceTranslation: '追溯争论的根源，该团队发现了一种模式。',
      localAnalysis: '注意现在分词短语作状语。',
      location: 'P3'
    },
    unit: { type: 'translation', unitKey: 'part_c', passage: [{ key: 'P1', text: 'Full source passage.' }] },
    translationReviewStatus: 'needs_review'
  };
}

function validFeedback(score = 7.5) {
  return {
    trainingScore: score,
    summary: '信息基本完整，但状语结构处理不够准确。',
    strengths: ['保留了争论的根源。'],
    issues: [{
      sourceFragment: 'Tracing the roots of the debate',
      userFragment: '追踪争论的根',
      type: '结构理解',
      explanation: '这里是现在分词短语作状语。',
      suggestion: '可译为“追溯争论的根源”。'
    }],
    improvedTranslation: '追溯争论的根源，该团队发现了一种模式。',
    studyAdvice: '先识别句首非谓语结构。'
  };
}

test('validates a structured 0–10 translation training feedback payload', () => {
  assert.deepEqual(validateTranslationTrainingFeedback(validFeedback()), validFeedback());
  assert.throws(() => validateTranslationTrainingFeedback(validFeedback(-0.1)), /0 到 10/);
  assert.throws(() => validateTranslationTrainingFeedback(validFeedback(10.1)), /0 到 10/);
  assert.throws(() => validateTranslationTrainingFeedback({ trainingScore: 7, summary: 'only' }), /字段/);
});

test('explicit translation scoring sends submitted context to ChatService and persists validated feedback only', async () => {
  const calls = [];
  const store = new MemoryConversationStore();
  const service = new ExamTutorService({
    contextBuilder: new ExamTutorContextBuilder(),
    conversationStore: store,
    chatService: {
      ask: async request => {
        calls.push(request);
        return { content: JSON.stringify(validFeedback()) };
      }
    }
  });
  const input = translationInput();
  const result = await service.scoreTranslation(input);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'translation_training_feedback');
  assert.deepEqual(calls[0].pageContext.exam.translation.userTranslationAtSubmit, '我的不完整译文');
  assert.deepEqual(calls[0].responseFormat, { type: 'json_object' });
  assert.equal(result.feedback.trainingScore, 7.5);
  assert.equal(findLatestTranslationTrainingFeedback(store.getSession(result.sessionKey)).trainingScore, 7.5);
  assert.deepEqual(store.getSession(result.sessionKey).messages.map(message => message.kind), ['text', 'translation_training_feedback']);
  assert.equal(input.question.referenceTranslation, '追溯争论的根源，该团队发现了一种模式。');
  assert.equal(input.response.value.text, '我的不完整译文');
  assert.equal(input.translationReviewStatus, 'needs_review');
});

test('translation scoring rejects blank and malformed model output without saving feedback', async () => {
  const store = new MemoryConversationStore();
  let calls = 0;
  const service = new ExamTutorService({
    contextBuilder: new ExamTutorContextBuilder(),
    conversationStore: store,
    chatService: { ask: async () => { calls += 1; return { content: '{"trainingScore": 11}' }; } }
  });
  const blank = translationInput({ text: '   ' });
  await assert.rejects(service.scoreTranslation(blank), /未填写译文/);
  assert.equal(calls, 0);
  const malformed = translationInput({ attemptId: 'translation-attempt-malformed' });
  await assert.rejects(service.scoreTranslation(malformed), /字段|0 到 10/);
  assert.equal(calls, 1);
  assert.deepEqual(store.getSession('exam:translation-attempt-malformed:question:q46').messages, []);
});

test('translation scoring handles non-JSON and API failures without corrupting the current translation session', async () => {
  const store = new MemoryConversationStore();
  let stage = 0;
  const service = new ExamTutorService({
    contextBuilder: new ExamTutorContextBuilder(),
    conversationStore: store,
    chatService: {
      ask: async () => {
        stage += 1;
        if (stage === 1) return { content: '这不是 JSON' };
        throw new Error('network down');
      }
    }
  });
  const input = translationInput({ attemptId: 'translation-attempt-safe-failure' });
  await assert.rejects(service.scoreTranslation(input), /格式无效/);
  await assert.rejects(service.scoreTranslation(input), /network down/);
  assert.deepEqual(store.getSession('exam:translation-attempt-safe-failure:question:q46').messages, []);
  assert.equal(input.response.value.text, '我的不完整译文');
  assert.equal(input.translationReviewStatus, 'needs_review');
});

test('quote follow-up stays in the translation thread without generating a training score', async () => {
  const calls = [];
  const store = new MemoryConversationStore();
  const service = new ExamTutorService({
    contextBuilder: new ExamTutorContextBuilder(),
    conversationStore: store,
    chatService: { ask: async request => { calls.push(request); return { content: '这是对引用的解释。' }; } }
  });
  const input = translationInput();
  await service.ask({
    ...input,
    userMessage: '这里为什么这样翻？',
    quote: { selectedText: 'Tracing the roots', selectedSource: 'translation_source' }
  });
  assert.equal(calls[0].kind, 'translation');
  assert.equal(findLatestTranslationTrainingFeedback(store.getSession('exam:translation-attempt-1:question:q46')), null);
  assert.deepEqual(store.getSession('exam:translation-attempt-1:question:q46').messages[0].quote, {
    selectedText: 'Tracing the roots', selectedSource: 'translation_source'
  });
});

test('translation feedback conversations isolate segments and historical attempts', async () => {
  const store = new MemoryConversationStore();
  const service = new ExamTutorService({
    contextBuilder: new ExamTutorContextBuilder(),
    conversationStore: store,
    chatService: { ask: async () => ({ content: JSON.stringify(validFeedback()) }) }
  });
  await service.scoreTranslation(translationInput({ attemptId: 'attempt-a', questionKey: 'q46' }));
  await service.scoreTranslation(translationInput({ attemptId: 'attempt-a', questionKey: 'q47' }));
  await service.scoreTranslation(translationInput({ attemptId: 'attempt-b', questionKey: 'q46' }));
  assert.equal(store.sessions.size, 3);
  assert.ok(store.sessions.has('exam:attempt-a:question:q46'));
  assert.ok(store.sessions.has('exam:attempt-a:question:q47'));
  assert.ok(store.sessions.has('exam:attempt-b:question:q46'));
});

test('reopened translation Tutor restores one validated feedback without a second scoring request', async () => {
  let calls = 0;
  const store = new MemoryConversationStore();
  const chatService = { ask: async () => { calls += 1; return { content: JSON.stringify(validFeedback()) }; } };
  const input = translationInput({ attemptId: 'translation-attempt-restored' });
  const first = new ExamTutorService({ chatService, conversationStore: store, contextBuilder: new ExamTutorContextBuilder() });
  await first.scoreTranslation(input);

  const reopened = new ExamTutorService({ chatService, conversationStore: store, contextBuilder: new ExamTutorContextBuilder() });
  const restored = reopened.getTranslationTrainingFeedback(input);
  const cached = await reopened.scoreTranslation(input);

  assert.equal(restored.feedback.trainingScore, 7.5);
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  assert.equal(store.getSession('exam:translation-attempt-restored:question:q46').messages.filter(message => message.kind === 'translation_training_feedback').length, 1);
});

test('translation training message builder requests JSON-only internal feedback without changing objective Tutor prompts', () => {
  const builder = new ExamTutorMessageBuilder();
  const translationMessages = builder.build({
    kind: 'translation_training_feedback',
    pageContext: { exam: { translation: { sourceText: 'Source', userTranslationAtSubmit: 'User text' } } },
    userMessage: '请评分'
  });
  const objectiveMessages = builder.build({
    kind: 'exam',
    pageContext: { exam: { answer: { correctOptionKey: 'D' } } },
    userMessage: '解释'
  });
  assert.match(translationMessages[0].content, /只返回一个合法 JSON/);
  assert.match(translationMessages[0].content, /不是官方考研评分/);
  assert.match(objectiveMessages[0].content, /客观题 Exam Tutor/);
});
