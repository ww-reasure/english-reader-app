import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOME_LEARNING_RESPONSE_MODES,
  classifyHomeLearningRequest,
  normalizeGuidedLearningSession,
  normalizeHomeLearningResponseMode,
  advanceGuidedLearning,
  recordGuidedChoice,
  recordGuidedFreeResponse,
  setGuidedLearningStatus,
  setGuidedLearningStep,
  toggleGuidedLearningHint
} from '../src/components/home-guided-learning.mjs';

test('首页学习回答设置默认并回退到每次询问', () => {
  assert.equal(normalizeHomeLearningResponseMode(), HOME_LEARNING_RESPONSE_MODES.ASK);
  assert.equal(normalizeHomeLearningResponseMode('unknown'), HOME_LEARNING_RESPONSE_MODES.ASK);
  assert.equal(normalizeHomeLearningResponseMode('detailed'), HOME_LEARNING_RESPONSE_MODES.DETAILED);
  assert.equal(normalizeHomeLearningResponseMode('guided'), HOME_LEARNING_RESPONSE_MODES.GUIDED);
});

test('明确教学、详细解析和直接回答指令优先于默认设置', () => {
  assert.deepEqual(
    classifyHomeLearningRequest('请一步一步教我学会这个句子：Although it was late, we stayed.', 'detailed'),
    { route: 'guided', reason: 'explicit_guided' }
  );
  assert.deepEqual(
    classifyHomeLearningRequest('请详细解析 Although it was late, we stayed.', 'guided'),
    { route: 'detailed', reason: 'explicit_detailed' }
  );
  assert.deepEqual(
    classifyHomeLearningRequest('只翻译 Although it was late, we stayed.', 'guided'),
    { route: 'normal', reason: 'explicit_direct' }
  );
});

test('裸英文词句按设置选择详细解析、互动教学或询问', () => {
  const sentence = 'Although it was late, we stayed to finish the work.';
  assert.deepEqual(classifyHomeLearningRequest(sentence, 'ask'), { route: 'choose', reason: 'bare_english' });
  assert.deepEqual(classifyHomeLearningRequest(sentence, 'detailed'), { route: 'detailed', reason: 'bare_english' });
  assert.deepEqual(classifyHomeLearningRequest(sentence, 'guided'), { route: 'guided', reason: 'bare_english' });
  assert.deepEqual(classifyHomeLearningRequest('inevitable', 'ask'), { route: 'choose', reason: 'bare_english' });
});

test('模糊学习请求可触发设置但正常首页对话不受影响', () => {
  assert.deepEqual(
    classifyHomeLearningRequest('帮我看看这个：Although it was late, we stayed.', 'guided'),
    { route: 'guided', reason: 'ambiguous_learning' }
  );
  assert.deepEqual(
    classifyHomeLearningRequest('帮我解答这个句子：Although it was late, we stayed.', 'ask'),
    { route: 'choose', reason: 'ambiguous_learning' }
  );
  assert.deepEqual(
    classifyHomeLearningRequest('帮我总结今天的学习情况', 'guided'),
    { route: 'normal', reason: 'ordinary_chat' }
  );
  assert.deepEqual(
    classifyHomeLearningRequest('生成一篇关于人工智能的英语阅读', 'guided'),
    { route: 'normal', reason: 'ordinary_chat' }
  );
});

const validLesson = () => ({
  id: 'lesson-1',
  sourceMessageId: 'message-1',
  target: { type: 'sentence', title: '让步与转折', text: 'Although it was late, we stayed.' },
  steps: [
    { id: 'step-1', kind: 'explain', title: '先看整体关系', content: 'Although 引出让步。' },
    {
      id: 'step-2',
      kind: 'choice',
      title: '检查理解',
      content: '判断真正结果。',
      prompt: '作者最后做了什么？',
      choices: [
        { id: 'a', text: '离开' },
        { id: 'b', text: '留下' }
      ],
      correctChoiceId: 'b',
      hint: '看逗号后的主句。'
    }
  ],
  closingSummary: 'Although 表示让步，主句承载最终结果。'
});

test('教学会话归一化为可持久化的版本化状态', () => {
  const session = normalizeGuidedLearningSession(validLesson());
  assert.equal(session.schemaVersion, 1);
  assert.equal(session.status, 'active');
  assert.equal(session.currentStepIndex, 0);
  assert.equal(session.revision, 0);
  assert.deepEqual(session.answers, {});
  assert.equal(session.steps.length, 2);
});

test('教学会话拒绝不足步骤、非法交互和重复步骤 ID', () => {
  assert.equal(normalizeGuidedLearningSession({ ...validLesson(), steps: [validLesson().steps[0]] }), null);
  assert.equal(normalizeGuidedLearningSession({
    ...validLesson(),
    steps: [validLesson().steps[0], { ...validLesson().steps[1], kind: 'video' }]
  }), null);
  assert.equal(normalizeGuidedLearningSession({
    ...validLesson(),
    steps: [validLesson().steps[0], { ...validLesson().steps[1], id: 'step-1' }]
  }), null);
});

test('本地翻页、提示和单选答案只更新当前教学卡状态', () => {
  const session = normalizeGuidedLearningSession(validLesson());
  const second = setGuidedLearningStep(session, 1);
  assert.equal(second.currentStepIndex, 1);
  assert.equal(second.revision, 1);

  const hinted = toggleGuidedLearningHint(second, 'step-2', true);
  assert.deepEqual(hinted.hints, { 'step-2': true });
  assert.equal(hinted.revision, 2);

  const answered = recordGuidedChoice(hinted, { stepId: 'step-2', choiceId: 'b' });
  assert.deepEqual(answered.answers['step-2'], { type: 'choice', value: 'b', correct: true });
  assert.equal(answered.revision, 3);
  assert.deepEqual(session.answers, {});
});

test('自由回答反馈可重试或进入下一步，最后一步完成教学', () => {
  const lesson = normalizeGuidedLearningSession({
    ...validLesson(),
    steps: [
      validLesson().steps[0],
      {
        id: 'step-2', kind: 'free_response', title: '自己表达', content: '用自己的话说明关系。',
        prompt: 'Although 在这里表达什么关系？', hint: '关注预期与实际结果。'
      }
    ],
    currentStepIndex: 1
  });
  const retried = recordGuidedFreeResponse(lesson, {
    stepId: 'step-2', value: '表示因为', outcome: 'incorrect', feedback: '再想想预期与实际结果的反差。'
  });
  assert.equal(retried.currentStepIndex, 1);
  assert.equal(retried.status, 'active');
  assert.equal(retried.answers['step-2'].correct, false);

  const completed = advanceGuidedLearning(recordGuidedFreeResponse(retried, {
    stepId: 'step-2', value: '表示让步', outcome: 'correct', feedback: '对，主句结果仍然发生。'
  }));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentStepIndex, 1);
});

test('教学会话可暂停和恢复且保留进度', () => {
  const session = normalizeGuidedLearningSession({ ...validLesson(), currentStepIndex: 1 });
  const paused = setGuidedLearningStatus(session, 'paused');
  assert.equal(paused.status, 'paused');
  assert.equal(paused.currentStepIndex, 1);
  assert.equal(setGuidedLearningStatus(paused, 'active').status, 'active');
});
