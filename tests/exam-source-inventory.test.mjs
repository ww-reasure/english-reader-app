import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySourceFile,
  createInventoryFromRecords,
  scanSourceDirectory
} from '../src/exam/source-inventory.mjs';

test('classifySourceFile identifies standard year sources and MinerU candidates', () => {
  assert.deepEqual(classifySourceFile('1/考研英语一2025年真题及答案解析（整卷）.pdf'), {
    extension: '.pdf',
    year: 2025,
    month: null,
    setNumber: null,
    sourceRole: 'standard_exam_pdf',
    flags: []
  });
  assert.deepEqual(classifySourceFile('md/MinerU_markdown_考研英语一2026年真题及答案解析（整卷）.md'), {
    extension: '.md',
    year: 2026,
    month: null,
    setNumber: null,
    sourceRole: 'mineru_candidate_markdown',
    flags: []
  });
  assert.deepEqual(classifySourceFile('json/MinerU_考研英语一2026年真题及答案解析（整卷）__20260807151332.json'), {
    extension: '.json',
    year: 2026,
    month: null,
    setNumber: null,
    sourceRole: 'mineru_candidate_json',
    flags: []
  });
  assert.deepEqual(classifySourceFile('CET4/md/英语四级2023年6月第1套真题及答案解析（整卷）.md'), {
    extension: '.md',
    year: 2023,
    month: 6,
    setNumber: 1,
    sourceRole: 'standard_exam_markdown',
    flags: []
  });
  assert.deepEqual(classifySourceFile('CET4/pdf/英语四级2020年9月第2套真题及答案解析（整卷）.pdf'), {
    extension: '.pdf',
    year: 2020,
    month: 9,
    setNumber: 2,
    sourceRole: 'standard_exam_pdf',
    flags: []
  });
});

test('createInventoryFromRecords records only metadata and flags duplicates or review items', () => {
  const inventory = createInventoryFromRecords({
    sourceRoot: 'D:/资料/english',
    records: [
      { relativePath: '1/2025.pdf', sizeBytes: 10, sha256: 'sha256:a', pageCount: 12 },
      { relativePath: 'md/2025.md', sizeBytes: 20, sha256: 'sha256:b', pageCount: null },
      { relativePath: 'md/2025-copy.md', sizeBytes: 20, sha256: 'sha256:b', pageCount: null },
      { relativePath: 'notes/unknown.bin', sizeBytes: 3, sha256: 'sha256:c', pageCount: null }
    ]
  });

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.sourceRoot, 'D:/资料/english');
  assert.equal(inventory.files.length, 4);
  assert.equal(inventory.files.some(file => file.flags.includes('DUPLICATE_CONTENT')), true);
  assert.equal(inventory.files.some(file => file.flags.includes('NEEDS_HUMAN_REVIEW')), true);
  assert.equal(inventory.files.every(file => !('content' in file)), true);
  assert.deepEqual(inventory.summary.years, [2025]);
});

test('scanSourceDirectory can produce a metadata-only inventory from a fixture tree', async () => {
  const inventory = await scanSourceDirectory({ rootDir: 'tests/fixtures/source-inventory' });
  assert.equal(inventory.files.length, 3);
  assert.equal(inventory.files.every(file => typeof file.sha256 === 'string' && file.sha256.startsWith('sha256:')), true);
  assert.equal(inventory.files.every(file => !('content' in file)), true);
});
