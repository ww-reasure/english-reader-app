import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREATE_GUIDED_LEARNING_TOOL,
  ADAPT_GUIDED_LEARNING_TOOL,
  createGuidedLearningArtifact,
  createGuidedLearningUpdateArtifact,
  guidedLearningSystemInstruction,
  parseGuidedLearningJson
} from '../src/components/guided-learning-tool.mjs';

const payload = {
  target: { type: 'sentence', title: '理解条件句', text: "I wouldn't do it unless it was necessary." },
  steps: [
    {
      id: 'notice-structure',
      kind: 'explain',
      title: '先看骨架',
      content: "先找到主句 I wouldn't do it，再看 unless 引导的条件。",
      hint: 'unless 可以先理解为 if ... not。'
    },
    {
      id: 'check-meaning',
      kind: 'choice',
      title: '判断含义',
      content: '现在只检查 unless 表达的逻辑。',
      prompt: '哪一个中文意思更接近原句？',
      choices: [
        { id: 'a', text: '除非有必要，否则我不会做。' },
        { id: 'b', text: '只要有必要，我就一定会做。' }
      ],
      correctChoiceId: 'a'
    }
  ],
  closingSummary: 'unless 表示“除非”，主句说明在条件不满足时不会发生。'
};

test('guided learning tool exposes a strict structured function schema', () => {
  assert.equal(CREATE_GUIDED_LEARNING_TOOL.type, 'function');
  assert.equal(CREATE_GUIDED_LEARNING_TOOL.function.name, 'create_guided_learning');
  assert.deepEqual(CREATE_GUIDED_LEARNING_TOOL.function.parameters.required, ['target', 'steps', 'closingSummary']);
  assert.equal(CREATE_GUIDED_LEARNING_TOOL.function.parameters.properties.steps.minItems, 2);
  assert.equal(CREATE_GUIDED_LEARNING_TOOL.function.parameters.properties.steps.maxItems, 7);
});

test('creates a normalized guided learning artifact with internal identity injected', () => {
  const artifact = createGuidedLearningArtifact(payload, {
    sessionId: 'lesson-42',
    sourceMessageId: 'message-9'
  });

  assert.equal(artifact.type, 'guided_learning');
  assert.equal(artifact.session.id, 'lesson-42');
  assert.equal(artifact.session.sourceMessageId, 'message-9');
  assert.equal(artifact.session.status, 'active');
  assert.equal(artifact.session.currentStepIndex, 0);
  assert.equal(artifact.session.steps.length, 2);
});

test('rejects malformed or undersized guided lessons instead of storing partial data', () => {
  assert.throws(() => createGuidedLearningArtifact({ ...payload, steps: payload.steps.slice(0, 1) }, {
    sessionId: 'lesson-42',
    sourceMessageId: 'message-9'
  }), /invalid guided learning/i);
});

test('system instruction enforces progressive teaching without exposing the full answer first', () => {
  const instruction = guidedLearningSystemInstruction({ level: 'kaoyan', difficulty: 'hard' });
  assert.match(instruction, /create_guided_learning/);
  assert.match(instruction, /一次只推进一个认知目标/);
  assert.match(instruction, /不要在第一步给出完整答案/);
  assert.match(instruction, /kaoyan/);
});

test('free-response adaptation is a bounded structured artifact', () => {
  assert.equal(ADAPT_GUIDED_LEARNING_TOOL.function.name, 'adapt_guided_learning');
  const artifact = createGuidedLearningUpdateArtifact({
    outcome: 'partial',
    feedback: '你已经找到让步关系，再说明主句结果仍然发生。',
    nextAction: 'retry',
    revisedHint: '可以用“虽然……但是……”组织答案。'
  }, { sessionId: 'lesson-42', expectedRevision: 3, stepId: 'check-meaning' });
  assert.deepEqual(artifact, {
    type: 'guided_learning_update',
    sessionId: 'lesson-42',
    expectedRevision: 3,
    stepId: 'check-meaning',
    outcome: 'partial',
    feedback: '你已经找到让步关系，再说明主句结果仍然发生。',
    nextAction: 'retry',
    revisedContent: '',
    revisedHint: '可以用“虽然……但是……”组织答案。'
  });
  assert.throws(() => createGuidedLearningUpdateArtifact({ outcome: 'unknown', feedback: '', nextAction: 'retry' }, {
    sessionId: 'lesson-42', expectedRevision: 3, stepId: 'check-meaning'
  }), /invalid guided learning update/i);
});

test('strict JSON fallback accepts fenced objects but rejects surrounding prose', () => {
  assert.deepEqual(parseGuidedLearningJson('```json\n{"target":{"type":"word"}}\n```'), { target: { type: 'word' } });
  assert.equal(parseGuidedLearningJson('这是结果：{"target":{"type":"word"}}'), null);
  assert.equal(parseGuidedLearningJson('{broken'), null);
});
