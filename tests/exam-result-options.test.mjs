import assert from 'node:assert/strict';
import test from 'node:test';
import { renderResultDetail } from '../src/exam/renderers/result-detail.mjs';

test('result detail renders original options with user and correct answer markers', () => {
  const html = renderResultDetail({
    questionKey: 'q1',
    type: 'single_choice',
    points: 1,
    stem: 'Which answer?',
    answer: 'B',
    options: [
      { key: 'A', text: 'first' },
      { key: 'B', text: 'second' },
      { key: 'C', text: 'third' }
    ]
  }, { answer: 'A', correctOptionKeyAtSubmit: 'B' }, {
    optionOrder: ['C', 'A', 'B']
  });

  assert.match(html, /原选项/);
  assert.match(html, /data-option-key="C"/);
  assert.match(html, /data-option-key="A"/);
  assert.match(html, /data-option-key="B"/);
  assert.match(html, /我的答案/);
  assert.match(html, /正确答案/);
  assert.match(html, /second/);
});
