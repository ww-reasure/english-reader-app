import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTooltipWordBadges } from '../src/components/tooltip-metadata.mjs';

test('places exam and frequency markers beside the word instead of below the definitions', () => {
  const markup = renderTooltipWordBadges({
    examLevels: ['cet4'],
    freqLevel: 'high'
  }, value => String(value));

  assert.match(markup, /^<span class="tooltip-word-badge tooltip-word-badge--exam exam-cet4">四级<\/span><span class="tooltip-word-badge tooltip-word-badge--freq freq-high">高频<\/span>$/);
  assert.doesNotMatch(markup, /离线筛选学习义|离线高可信学习义|在线临时释义/);
});

test('does not add a low-value marker when the frequency band is unknown', () => {
  const markup = renderTooltipWordBadges({
    examLevels: ['kaoyan1'],
    freqLevel: 'unknown'
  }, value => String(value));

  assert.match(markup, /英一/);
  assert.doesNotMatch(markup, /频率待定/);
});
