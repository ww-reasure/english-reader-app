import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const planSource = await readFile(new URL('../src/components/word-import-plan-tool.js', import.meta.url), 'utf8');
const { PREPARE_WORD_IMPORT_TOOL, WordImportPlanTool } = await import(
  `data:text/javascript;base64,${Buffer.from(planSource).toString('base64')}`
);

const serviceWith = planResult => ({
  async createPlan(text, options) {
    this.calls = this.calls || [];
    this.calls.push({ text, options });
    return typeof planResult === 'function' ? planResult(text, options) : planResult;
  }
});

test('tool definition asks for a word list and honest confirmation semantics', () => {
  assert.equal(PREPARE_WORD_IMPORT_TOOL.function.name, 'prepare_word_import');
  assert.deepEqual(PREPARE_WORD_IMPORT_TOOL.function.parameters.required, ['words']);
  assert.match(PREPARE_WORD_IMPORT_TOOL.function.description, /确认/);
});

test('returns a plan_ready artifact with counts and categories', async () => {
  const service = serviceWith({
    batchId: 'import-batch-1',
    wordLimit: 200,
    truncated: false,
    limitExceeded: false,
    words: ['amble', 'quest'],
    categories: { new: ['amble'], externalReview: ['quest'], todayIgnored: [], invalid: [], failed: [] },
    counts: { recognized: 2, new: 1, externalReview: 1, todayIgnored: 0, invalid: 0 }
  });
  const tool = new WordImportPlanTool({ service });
  const handled = await tool.execute({ words: 'Amble, quest' });

  assert.deepEqual(handled.result, {
    status: 'plan_ready',
    counts: { recognized: 2, new: 1, externalReview: 1, todayIgnored: 0, invalid: 0 },
    words: ['amble', 'quest']
  });
  assert.equal(handled.artifact.type, 'word_import_plan');
  assert.equal(handled.artifact.wordsText, 'Amble, quest');
  assert.deepEqual(handled.artifact.categories.new, ['amble']);
  assert.deepEqual(service.calls[0].options, { source: 'chat' });
});

test('reports oversized batches without producing a confirm card', async () => {
  const service = serviceWith({ wordLimit: 200, truncated: true, limitExceeded: true });
  const tool = new WordImportPlanTool({ service });
  const handled = await tool.execute({ words: 'a, b, c' });
  assert.equal(handled.result.status, 'too_many_words');
  assert.equal(handled.artifact, undefined);
});

test('reports empty and unrecognizable requests without producing a confirm card', async () => {
  const empty = new WordImportPlanTool({ service: serviceWith({}) });
  assert.equal((await empty.execute({ words: '   ' })).result.status, 'empty_words');

  const none = new WordImportPlanTool({
    service: serviceWith({
      truncated: false,
      limitExceeded: false,
      words: [],
      counts: { recognized: 0, new: 0, externalReview: 0, todayIgnored: 0, invalid: 2 }
    })
  });
  const handled = await none.execute({ words: '123 456' });
  assert.equal(handled.result.status, 'no_valid_words');
  assert.equal(handled.artifact, undefined);
});
