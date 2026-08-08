import assert from 'node:assert/strict';
import test from 'node:test';
import { ExamTutorContextBuilder } from '../src/exam/exam-tutor-context.mjs';
import { ExamTutorMessageBuilder, ExamTutorService } from '../src/exam/exam-tutor-service.mjs';

class MemoryConversationStore {
  constructor() {
    this.sessions = new Map();
  }

  getSession(key) {
    return this.sessions.get(key) || { summary: '', messages: [], activities: [] };
  }

  append(key, message) {
    const session = this.getSession(key);
    this.sessions.set(key, { ...session, messages: [...session.messages, message] });
  }
}

function input({ attemptId = 'attempt-1', selected = 'B', correct = 'D' } = {}) {
  return {
    attempt: {
      attemptId,
      examId: 'kaoyan_en1',
      bankId: 'builtin_kaoyan_en1',
      packageId: 'local.kaoyan.en1',
      paperKey: 'kaoyan_en1_2026',
      unitKey: 'kaoyan_en1_2026_part_a_text_1',
      packageVersionAtStart: 'v1',
      paperHashAtStart: 'paper-old'
    },
    response: {
      questionKey: 'kaoyan_en1_2026_q22',
      answer: selected,
      uncertain: true,
      correct: selected === correct,
      pointsEarned: selected === correct ? 1 : 0,
      correctOptionKeyAtSubmit: correct,
      questionHashAtSubmit: 'question-old'
    },
    question: {
      questionKey: 'kaoyan_en1_2026_q22',
      stem: 'What does the passage suggest?',
      answer: 'A',
      options: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }, { key: 'D', text: 'Option D' }],
      directions: 'Read and answer.',
      questionTranslation: '题干翻译。',
      optionTranslations: [{ key: 'A', text: '选项 A 翻译。' }],
      questionType: '推断题',
      stemAnalysis: '判型：推断题\n拆句：What does…',
      location: 'P2',
      evidence: 'Evidence sentence.',
      evidenceTranslation: '定位句翻译。',
      optionAnalysis: [{ key: 'B', text: '干扰项。' }],
      explanation: '本地解析。'
    },
    unit: {
      unitKey: 'kaoyan_en1_2026_part_a_text_1',
      type: 'reading_mcq',
      directions: 'Read and answer.',
      passage: [{ key: 'P1', text: 'Passage.' }],
      translation: [{ key: 'P1', text: '译文。' }]
    }
  };
}

function createHarness(reply = 'AI reply') {
  const calls = [];
  const chatService = {
    ask: async request => {
      calls.push(request);
      return { content: typeof reply === 'function' ? reply(calls.length) : reply };
    }
  };
  const conversationStore = new MemoryConversationStore();
  return {
    calls,
    chatService,
    conversationStore,
    service: new ExamTutorService({
      chatService,
      conversationStore,
      contextBuilder: new ExamTutorContextBuilder()
    })
  };
}

test('forwards Phase 3A submitted context and stable conversation key to ChatService', async () => {
  const harness = createHarness();
  const source = input();
  const result = await harness.service.ask({ ...source, userMessage: '请解释我为什么错。' });

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].sessionKey, 'exam:attempt-1:question:kaoyan_en1_2026_q22');
  assert.equal(harness.calls[0].kind, 'exam');
  assert.deepEqual(harness.calls[0].pageContext, result.tutorContext.pageContext);
  assert.equal(harness.calls[0].pageContext.exam.answer.selectedOptionKey, 'B');
  assert.equal(harness.calls[0].pageContext.exam.answer.correctOptionKey, 'D');
  assert.equal(harness.calls[0].pageContext.exam.answer.uncertain, true);
  assert.equal(harness.calls[0].pageContext.exam.question.evidence, 'Evidence sentence.');
  assert.deepEqual(harness.calls[0].pageContext.exam.question.optionAnalysis, [{ key: 'B', text: '干扰项。' }]);
  assert.deepEqual(harness.calls[0].pageContext.exam.passage.paragraphs, [{ key: 'P1', text: 'Passage.' }]);
  assert.deepEqual(harness.calls[0].pageContext.exam.passage.translations, [{ key: 'P1', text: '译文。' }]);
  assert.equal(harness.calls[0].tools.length, 0);
});

test('exam message builder states read-only tutoring rules and includes the complete local context', () => {
  const pageContext = {
    exam: {
      answer: { selectedOptionKey: 'B', correctOptionKey: 'D', uncertain: true },
      question: { stem: 'Stem', evidence: 'Evidence', optionAnalysis: [{ key: 'B', text: '误区' }] },
      passage: { directions: 'Directions', paragraphs: [{ key: 'P1', text: 'Passage' }], translations: [{ key: 'P1', text: '译文' }] }
    }
  };
  const messages = new ExamTutorMessageBuilder().build({ pageContext, userMessage: '为什么？' });
  assert.match(messages[0].content, /只读事实/);
  assert.match(messages[0].content, /不要编造/);
  assert.match(messages[1].content, /Evidence/);
  assert.match(messages[1].content, /Directions/);
  assert.match(messages[1].content, /误区/);
  assert.equal(messages.at(-1).role, 'user');
  assert.equal(messages.at(-1).content, '为什么？');
});

test('same attempt and question restores one conversation and follow-ups use its history', async () => {
  const harness = createHarness(index => `reply-${index}`);
  const source = input();
  await harness.service.ask({ ...source, userMessage: '第一问' });

  const reopened = new ExamTutorService({
    chatService: harness.chatService,
    conversationStore: harness.conversationStore,
    contextBuilder: new ExamTutorContextBuilder()
  });
  await reopened.ask({ ...source, userMessage: '追问' });

  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].sessionKey, harness.calls[0].sessionKey);
  assert.deepEqual(harness.calls[1].session.messages.map(message => message.content), ['第一问', 'reply-1']);
  assert.deepEqual(harness.conversationStore.getSession(harness.calls[0].sessionKey).messages.map(message => message.content), ['第一问', 'reply-1', '追问', 'reply-2']);
});

test('different attempts never share a question conversation', async () => {
  const harness = createHarness();
  await harness.service.ask({ ...input({ attemptId: 'attempt-old' }), userMessage: '旧 attempt' });
  await harness.service.ask({ ...input({ attemptId: 'attempt-new' }), userMessage: '新 attempt' });

  assert.notEqual(harness.calls[0].sessionKey, harness.calls[1].sessionKey);
  assert.deepEqual(harness.calls[0].session.messages, []);
  assert.deepEqual(harness.calls[1].session.messages, []);
});

test('historical submit answer wins over the current question answer', async () => {
  const harness = createHarness();
  const source = input({ attemptId: 'attempt-history', correct: 'D' });
  source.question.answer = 'A';
  const result = await harness.service.ask({ ...source, userMessage: '历史解析' });

  assert.equal(result.tutorContext.pageContext.exam.answer.correctOptionKey, 'D');
  assert.equal('answer' in result.tutorContext.pageContext.exam.question, false);
});

test('API failure leaves the result conversation unchanged and can be retried', async () => {
  let attempts = 0;
  const conversationStore = new MemoryConversationStore();
  const calls = [];
  const chatService = {
    ask: async request => {
      calls.push(request);
      attempts += 1;
      if (attempts === 1) throw new Error('network down');
      return { content: 'retry reply' };
    }
  };
  const service = new ExamTutorService({ chatService, conversationStore, contextBuilder: new ExamTutorContextBuilder() });
  const source = input({ attemptId: 'attempt-retry' });

  await assert.rejects(service.ask({ ...source, userMessage: '请重试' }), /network down/);
  assert.deepEqual(conversationStore.getSession('exam:attempt-retry:question:kaoyan_en1_2026_q22').messages, []);
  await service.ask({ ...source, userMessage: '请重试' });
  assert.equal(calls.length, 2);
  assert.deepEqual(conversationStore.getSession('exam:attempt-retry:question:kaoyan_en1_2026_q22').messages.map(message => message.content), ['请重试', 'retry reply']);
});
