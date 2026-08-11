import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExamCatalog,
  selectRandomPaper,
  selectRandomUnit
} from '../src/exam/catalog.mjs';

const papers = [
  {
    paperKey: 'paper-2026',
    year: 2026,
    units: [
      { unitKey: 'reading-1', type: 'reading_mcq', displayTitle: 'Text 1', questions: [{ questionKey: 'q1' }] },
      { unitKey: 'reading-2', type: 'reading_mcq', displayTitle: 'Text 2', questions: [{ questionKey: 'q2' }] },
      { unitKey: 'cloze-1', type: 'cloze_choice', displayTitle: '完形填空', questions: [{ questionKey: 'q3' }] }
    ]
  },
  {
    paperKey: 'paper-2025',
    year: 2025,
    units: [
      { unitKey: 'reading-1-2025', type: 'reading_mcq', displayTitle: 'Text 1', questions: [{ questionKey: 'q4' }] }
    ]
  }
];

test('exam catalog groups only the selected type by descending year', () => {
  const catalog = buildExamCatalog(papers, { unitType: 'reading_mcq' });

  assert.deepEqual(catalog.map(group => ({
    year: group.year,
    unitKeys: group.units.map(unit => unit.unitKey)
  })), [
    { year: 2026, unitKeys: ['reading-1', 'reading-2'] },
    { year: 2025, unitKeys: ['reading-1-2025'] }
  ]);
});

test('random selectors use an injected random value and never leave the visible pool', () => {
  assert.equal(selectRandomPaper(papers, () => 0.99).paperKey, 'paper-2025');
  const catalog = buildExamCatalog(papers, { unitType: 'reading_mcq' });
  assert.equal(selectRandomUnit(catalog, () => 0).unitKey, 'reading-1');
  assert.equal(selectRandomUnit(catalog, () => 0.99).unitKey, 'reading-1-2025');
});

test('a year with one unit is marked for direct entry', () => {
  const catalog = buildExamCatalog(papers, { unitType: 'reading_mcq' });
  assert.equal(catalog[1].units.length, 1);
  assert.equal(catalog[1].directStart, true);
  assert.equal(catalog[1].expandable, false);
  assert.equal(catalog[0].directStart, false);
  assert.equal(catalog[0].expandable, true);
});

test('Part B catalog includes ordering and matching units through one entry', () => {
  const catalog = buildExamCatalog([{
    paperKey: 'paper-2024', year: 2024, units: [
      { unitKey: 'ordering', type: 'paragraph_ordering', questions: [{}] },
      { unitKey: 'matching', type: 'matching', matchingVariant: 'statement_matching', questions: [{}] },
      { unitKey: 'reading', type: 'reading_mcq', questions: [{}] }
    ]
  }], { unitType: 'part_b' });
  assert.deepEqual(catalog[0].units.map(unit => unit.unitKey), ['ordering', 'matching']);
});

test('full-paper year selection keeps the paper together and expands multi-section years only', () => {
  const catalog = buildExamCatalog(papers, { kind: 'full_paper' });

  assert.deepEqual(catalog.map(group => ({
    year: group.year,
    paperKey: group.paperKey,
    unitKeys: group.units.map(unit => unit.unitKey),
    directStart: group.directStart,
    expandable: group.expandable
  })), [
    {
      year: 2026,
      paperKey: 'paper-2026',
      unitKeys: ['reading-1', 'reading-2', 'cloze-1'],
      directStart: false,
      expandable: true
    },
    {
      year: 2025,
      paperKey: 'paper-2025',
      unitKeys: ['reading-1-2025'],
      directStart: true,
      expandable: false
    }
  ]);
});

test('catalog filters CET4 variant and section keys without breaking kaoyan types', async () => {
  const { buildExamCatalog } = await import('../src/exam/catalog.mjs');
  const paper = {
    paperKey: 'cet4_2023_06_1',
    bankId: 'builtin_cet4',
    packageId: 'local.cet4',
    year: 2023,
    units: [
      { unitKey: 'u-a', type: 'matching', matchingVariant: 'banked_cloze', questions: [{ questionKey: 'q26' }] },
      { unitKey: 'u-b', type: 'matching', matchingVariant: 'long_reading', questions: [{ questionKey: 'q36' }] },
      { unitKey: 'u-c', type: 'reading_mcq', displayTitle: 'Passage One', questions: [{ questionKey: 'q46' }] },
      { unitKey: 'u-t', type: 'translation', questions: [{ questionKey: 'q1' }] }
    ]
  };
  const banked = buildExamCatalog([paper], { unitType: 'banked_cloze' });
  assert.deepEqual(banked[0].units.map(unit => unit.unitKey), ['u-a']);
  const longReading = buildExamCatalog([paper], { unitType: 'long_reading' });
  assert.deepEqual(longReading[0].units.map(unit => unit.unitKey), ['u-b']);
  const sectionC = buildExamCatalog([paper], { unitType: 'section_c' });
  assert.deepEqual(sectionC[0].units.map(unit => unit.unitKey), ['u-c']);
  const translation = buildExamCatalog([paper], { unitType: 'translation' });
  assert.deepEqual(translation[0].units.map(unit => unit.unitKey), ['u-t']);
});
