import assert from 'node:assert/strict';
import test from 'node:test';
import { getExamBankOptions, resolveExamBankId } from '../src/exam/bank-selector.mjs';

test('exam bank selector exposes only English I and CET-4, without inventing an unavailable pack', () => {
  const options = getExamBankOptions([
    { examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', packageId: 'local.kaoyan.en1', displayName: '2026 考研英语一' },
    { examId: 'kaoyan_en1', bankId: 'synthetic_kaoyan_bank', packageId: 'synthetic.kaoyan.en1', displayName: 'Synthetic' }
  ], [
    { bankId: 'builtin_kaoyan_en1' },
    { bankId: 'synthetic_kaoyan_bank' }
  ]);

  assert.deepEqual(options.map(option => ({ key: option.key, label: option.label, bankId: option.bankId, installed: option.installed, disabled: option.disabled })), [
    { key: 'kaoyan_en1', label: '考研英语一', bankId: 'builtin_kaoyan_en1', installed: true, disabled: false },
    { key: 'cet4', label: '英语四级', bankId: 'cet4', installed: false, disabled: true }
  ]);
});

test('a real CET-4 pack becomes selectable while the selector still stays limited to two choices', () => {
  const options = getExamBankOptions([
    { examId: 'cet4', bankId: 'builtin_cet4', packageId: 'local.cet4', displayName: '英语四级' }
  ], [{ bankId: 'builtin_cet4' }]);

  assert.equal(options.length, 2);
  assert.equal(options[0].installed, false);
  assert.deepEqual(options[1], {
    key: 'cet4',
    label: '英语四级',
    bankId: 'builtin_cet4',
    installed: true,
    disabled: false
  });
  assert.equal(resolveExamBankId(options, 'builtin_cet4'), 'builtin_cet4');
  assert.equal(resolveExamBankId(options, 'missing'), 'builtin_cet4');
});
