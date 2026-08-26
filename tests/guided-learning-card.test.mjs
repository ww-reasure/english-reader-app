import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderGuidedLearningCard,
  renderGuidedLearningFailureCard,
  renderLearningModeChoiceCard
} from '../src/components/guided-learning-card.mjs';

const lesson = {
  id: 'lesson-1', sourceMessageId: 'message-1', status: 'active', revision: 2,
  target: { type: 'sentence', title: '理解让步句', text: 'Although it was late, we stayed.' },
  steps: [
    { id: 'first', kind: 'explain', title: '先看关系', content: 'Although 引出让步。', hint: '先不逐词翻译。' },
    {
      id: 'second', kind: 'choice', title: '检查理解', content: '选择实际结果。', prompt: '实际发生了什么？',
      choices: [{ id: 'left', text: '离开' }, { id: 'stay', text: '留下' }], correctChoiceId: 'stay'
    }
  ],
  currentStepIndex: 0, answers: {}, hints: {}, closingSummary: '让步从句与实际结果形成反差。'
};

test('ask mode renders only the two learning choices and keeps its source identity', () => {
  const html = renderLearningModeChoiceCard({ id: 'choice-1', sourceMessageId: 'message-1', status: 'pending' });
  assert.match(html, /data-learning-mode="detailed"/);
  assert.match(html, /data-learning-mode="guided"/);
  assert.match(html, /data-source-message-id="message-1"/);
  assert.doesNotMatch(html, /只翻译/);
});

test('guided card exposes one current step, progress and accessible local actions', () => {
  const html = renderGuidedLearningCard(lesson);
  assert.match(html, /1\s*\/\s*2/);
  assert.match(html, /先看关系/);
  assert.doesNotMatch(html, /检查理解/);
  assert.match(html, /data-guided-action="hint"/);
  assert.match(html, /data-guided-action="next"/);
  assert.match(html, /data-guided-action="detailed"/);
});

test('choice step renders options while keeping the correct answer out of data attributes', () => {
  const html = renderGuidedLearningCard({ ...lesson, currentStepIndex: 1 });
  assert.match(html, /data-guided-choice="left"/);
  assert.match(html, /data-guided-choice="stay"/);
  assert.doesNotMatch(html, /correctChoiceId/);
  assert.doesNotMatch(html, /data-correct/);
});

test('failure card provides retry and detailed-analysis recovery actions', () => {
  const html = renderGuidedLearningFailureCard({ message: '暂时失败' }, { sourceMessageId: 'message-1' });
  assert.match(html, /data-guided-failure-action="retry"/);
  assert.match(html, /data-guided-failure-action="detailed"/);
});
