import assert from 'node:assert/strict';
import test from 'node:test';

import { createGenerationFailure, safeGenerationFailureMessage } from '../src/components/generation-failure.mjs';

test('presents a lightweight admission failure as a retryable, specific generation failure', () => {
  const error = Object.assign(new Error('内容不完整'), {
    code: 'ARTICLE_ADMISSION_FAILED',
    summary: '文章内容未达到可保存条件：英文正文不完整。已自动重试一次，请重新生成。'
  });
  const generation = { request: '生成一篇科技阅读', difficulty: 'cet4', challenge: 'support', wordCount: 300 };

  const failure = createGenerationFailure(error, generation, '科技');

  assert.equal(failure.reason, 'validation_failed');
  assert.equal(failure.message, error.summary);
  assert.equal(safeGenerationFailureMessage(error), error.summary);
});
