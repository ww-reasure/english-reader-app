import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterVisibleExamPapers,
  RELEASE_FLAVORS,
  shouldInstallPrivateExamPacks
} from '../src/exam/home-visibility.mjs';

test('release flavors are explicit and private packs load only for private QA', () => {
  assert.deepEqual(RELEASE_FLAVORS, ['public', 'private-qa']);
  assert.equal(shouldInstallPrivateExamPacks('private-qa'), true);
  assert.equal(shouldInstallPrivateExamPacks('public'), false);
  assert.equal(shouldInstallPrivateExamPacks('production'), false);
});

const productionPaper = { paperKey: '2026', sourceType: 'past_exam', packageId: 'local.kaoyan.en1' };
const syntheticPaper = { paperKey: 'fixture', sourceType: 'synthetic', packageId: 'synthetic.kaoyan.en1' };
const devPackagePaper = { paperKey: 'dev', sourceType: 'past_exam', packageId: 'dev.kaoyan.en1' };

test('production exam home hides synthetic and development packs', () => {
  assert.deepEqual(
    filterVisibleExamPapers([productionPaper, syntheticPaper, devPackagePaper], { isProduction: true }),
    [productionPaper]
  );
});

test('development exam home keeps synthetic fixtures visible', () => {
  assert.deepEqual(
    filterVisibleExamPapers([productionPaper, syntheticPaper, devPackagePaper], { isProduction: false }),
    [productionPaper, syntheticPaper, devPackagePaper]
  );
});
