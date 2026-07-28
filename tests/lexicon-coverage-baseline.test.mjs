import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CALIBRATION_SHORT_READING } from '../src/calibration-content.mjs';

const WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

test('the shipped core covers the high-frequency inflected forms in the first-run calibration reading', async () => {
  const core = JSON.parse(await readFile(new URL('../public/data/lexicon-core.json', import.meta.url), 'utf8'));
  const forms = new Set();
  for (const entry of core.entries) {
    for (const form of [entry.lemma, ...(entry.forms || [])]) forms.add(String(form).toLocaleLowerCase('en-US'));
  }

  const tokens = CALIBRATION_SHORT_READING.content.match(WORD_PATTERN).map(token => token.toLocaleLowerCase('en-US'));
  const unknown = tokens.filter(token => !forms.has(token));

  assert.equal(tokens.length, 100);
  assert.ok(unknown.length <= 6, `短校准阅读中不应有超过 6 个未覆盖词次：${[...new Set(unknown)].join(', ')}`);
  const container = core.entries.find(entry => entry.lemma === 'container');
  assert.ok(container, 'NAWL 中的 container 应保留为受限学术词条');
  assert.equal(container.forms.includes('containers'), true, '校准短阅读中的标准复数应通过审核词形规则覆盖');
  assert.ok(container.formProvenance?.some(form => form.form === 'containers'
    && ((form.kind === 'generated-inflection' && form.rule === 'regular-s')
      || (form.kind === 'declared-inflection' && form.policy === 'ecdict-explicit-form-v1' && form.rule === 's'))),
  'containers 必须带有审核生成或 ECDICT 声明的词形来源，而非恢复不受控的 NAWL 逗号变体');
  for (const form of ['students', 'treated', 'visitors', 'weekends', 'records', 'showed', 'stations', 'residents', 'its', 'their']) {
    assert.equal(forms.has(form), true, `${form} 应由可追溯的词条或审核词形覆盖`);
  }
});
