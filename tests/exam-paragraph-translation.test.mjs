import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiCache } from '../src/components/ai-cache.mjs';
import {
  createParagraphTranslationCacheKey,
  createParagraphTranslationService
} from '../src/exam/paragraph-translation.mjs';

const context = {
  examId: 'kaoyan_en1',
  bankId: 'synthetic_kaoyan_bank',
  packageId: 'synthetic.kaoyan.en1',
  paperKey: 'synthetic_kaoyan_2026',
  unitKey: 'synthetic_kaoyan_2026_text_1',
  paragraphKey: 'P1'
};

test('paragraph translation uses stored text before calling AI', async () => {
  let calls = 0;
  const service = createParagraphTranslationService({
    cache: createAiCache(),
    translate: async () => { calls += 1; return '不应调用'; }
  });

  const result = await service.getOrTranslate({
    context,
    text: 'A source paragraph.',
    existingTranslation: '题库已有译文。'
  });

  assert.deepEqual(result, { text: '题库已有译文。', source: 'pack' });
  assert.equal(calls, 0);
});

test('paragraph translation deduplicates concurrent AI calls and caches valid Chinese', async () => {
  let calls = 0;
  const service = createParagraphTranslationService({
    cache: createAiCache(),
    translate: async text => {
      calls += 1;
      assert.equal(text, 'A source paragraph.');
      await new Promise(resolve => setTimeout(resolve, 5));
      return '这是段落译文。';
    }
  });

  const [first, second] = await Promise.all([
    service.getOrTranslate({ context, text: 'A source paragraph.' }),
    service.getOrTranslate({ context, text: 'A source paragraph.' })
  ]);
  const third = await service.getOrTranslate({ context, text: 'A source paragraph.' });

  assert.deepEqual(first, { text: '这是段落译文。', source: 'ai' });
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(calls, 1);
});

test('invalid AI output is not cached and can be retried', async () => {
  let calls = 0;
  const service = createParagraphTranslationService({
    cache: createAiCache(),
    translate: async () => {
      calls += 1;
      return calls === 1 ? 'English echo' : '第二次得到的中文译文。';
    }
  });

  await assert.rejects(
    service.getOrTranslate({ context, text: 'A source paragraph.' }),
    /中文翻译/
  );
  const retried = await service.getOrTranslate({ context, text: 'A source paragraph.' });
  assert.deepEqual(retried, { text: '第二次得到的中文译文。', source: 'ai' });
  assert.equal(calls, 2);
});

test('paragraph translation cache keys include the source text hash', () => {
  const first = createParagraphTranslationCacheKey({ ...context, text: 'A source paragraph.' });
  const second = createParagraphTranslationCacheKey({ ...context, text: 'A changed paragraph.' });
  assert.notEqual(first, second);
});
