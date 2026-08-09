import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareSourceToCanonicalPaper,
  detectPartBVariant,
  stableQuestionKey,
  summarizeSourceSections,
  assertUnitGate
} from '../src/exam/source-production.mjs';

test('stableQuestionKey follows section-specific identity rules', () => {
  assert.equal(stableQuestionKey({ year: 2025, section: 'cloze', number: 1 }), 'kaoyan_en1_2025_cloze_q1');
  assert.equal(stableQuestionKey({ year: 2025, section: 'reading', number: 21 }), 'kaoyan_en1_2025_q21');
  assert.equal(stableQuestionKey({ year: 2025, section: 'part_b', number: 41 }), 'kaoyan_en1_2025_part_b_q41');
  assert.equal(stableQuestionKey({ year: 2025, section: 'part_c', number: 46 }), 'kaoyan_en1_2025_part_c_q46');
  assert.throws(() => stableQuestionKey({ year: 2025, section: 'reading', number: 1 }), /范围/);
});

test('detectPartBVariant recognizes all supported Part B variants', () => {
  assert.equal(detectPartBVariant('The following paragraphs are given in a wrong order. Choose from A-H.'), 'paragraph_ordering');
  assert.equal(detectPartBVariant('choose the best statement from the list A-G to summarize each comment'), 'statement_matching');
  assert.equal(detectPartBVariant('choose the most suitable one from the list A-G to fit into each of the numbered blanks'), 'sentence_insertion');
  assert.equal(detectPartBVariant('Match each paragraph with the correct heading A-H.'), 'heading_matching');
  assert.equal(detectPartBVariant('choose the most suitable subheading from the list A-G for each numbered paragraph'), 'heading_matching');
  assert.equal(detectPartBVariant('choose the most suitable paragraphs from the list A-G and fill them into the numbered boxes to form a coherent text. Paragraph E has been correctly placed.'), 'paragraph_ordering');
  assert.equal(detectPartBVariant('Section II Part B'), 'unknown');
});

test('summarizeSourceSections detects four readings, Part B, Part C and writing inventory without importing writing', () => {
  const summary = summarizeSourceSections([
    '## Section I',
    '## Section II Reading Comprehension',
    '## Text 1',
    '21. Question',
    '## Text 2',
    '26. Question',
    '31. Question',
    '## Text 4',
    '36. Question',
    '## Part B',
    'The following paragraphs are given in a wrong order.',
    '## Part C',
    '(46) Translation (47) (48) (49) (50)',
    '## Section III',
    '## Part A',
    '## 51. Directions:',
    '## Part B',
    '## 52. Directions:'
  ].join('\n'));

  assert.deepEqual(summary.readingQuestionRanges, [[21, 25], [26, 30], [31, 35], [36, 40]]);
  assert.equal(summary.partB.variant, 'paragraph_ordering');
  assert.equal(summary.partC.questionCount, 5);
  assert.deepEqual(summary.writing.questionNumbers, [51, 52]);
  assert.equal(summary.writing.imported, false);
});

test('assertUnitGate rejects parse, validation, or blocker failures', () => {
  assert.deepEqual(assertUnitGate({ name: 'Text 1', parse: 'PASS', validation: 'PASS', blockers: [] }), {
    name: 'Text 1',
    status: 'PASS',
    blockers: []
  });
  assert.throws(() => assertUnitGate({ name: 'Text 1', parse: 'FAIL', validation: 'PASS', blockers: [] }), /parse/);
  assert.throws(() => assertUnitGate({ name: 'Text 1', parse: 'PASS', validation: 'FAIL', blockers: [] }), /validator/);
  assert.throws(() => assertUnitGate({ name: 'Text 1', parse: 'PASS', validation: 'PASS', blockers: ['missing answer'] }), /BLOCKERS/);
});

test('compareSourceToCanonicalPaper reports 2026 coverage differences without rewriting the paper', () => {
  const paper = {
    paperKey: 'kaoyan_en1_2026',
    units: [
      { type: 'cloze_choice', questions: Array.from({ length: 20 }, (_, index) => ({ questionKey: `kaoyan_en1_2026_cloze_q${index + 1}` })) },
      ...Array.from({ length: 4 }, (_, textIndex) => ({
        type: 'reading_mcq',
        questions: Array.from({ length: 5 }, (_, index) => ({ questionKey: `kaoyan_en1_2026_q${21 + textIndex * 5 + index}` }))
      })),
      { type: 'paragraph_ordering', questions: Array.from({ length: 5 }, (_, index) => ({ questionKey: `kaoyan_en1_2026_part_b_q${41 + index}` })) },
      { type: 'translation', questions: Array.from({ length: 5 }, (_, index) => ({ questionKey: `kaoyan_en1_2026_part_c_q${46 + index}` })) }
    ]
  };
  const sourceSummary = {
    readingQuestionRanges: [[21, 25], [26, 30], [31, 35], [36, 40]],
    partB: { variant: 'paragraph_ordering' },
    partC: { questionCount: 5 },
    writing: { imported: false }
  };
  assert.deepEqual(compareSourceToCanonicalPaper({ paper, sourceSummary }), { matches: true, differences: [] });
});

test('compareSourceToCanonicalPaper accepts an explicitly unsupported Part B when no Part B unit is imported', () => {
  const paper = {
    paperKey: 'kaoyan_en1_2024',
    units: [
      { type: 'cloze_choice', questions: Array.from({ length: 20 }, (_, index) => ({ questionKey: `kaoyan_en1_2024_cloze_q${index + 1}` })) },
      ...Array.from({ length: 4 }, (_, textIndex) => ({
        type: 'reading_mcq',
        questions: Array.from({ length: 5 }, (_, index) => ({ questionKey: `kaoyan_en1_2024_q${21 + textIndex * 5 + index}` }))
      })),
      { type: 'translation', questions: Array.from({ length: 5 }, (_, index) => ({ questionKey: `kaoyan_en1_2024_part_c_q${46 + index}` })) }
    ]
  };
  const sourceSummary = {
    readingQuestionRanges: [[21, 25], [26, 30], [31, 35], [36, 40]],
    partB: { variant: 'unsupported_matching', candidateKeys: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
    partC: { questionCount: 5 },
    writing: { imported: false }
  };
  assert.deepEqual(compareSourceToCanonicalPaper({ paper, sourceSummary }), { matches: true, differences: [] });
});
