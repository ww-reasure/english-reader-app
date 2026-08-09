import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  convertYearSource,
  normalizeClozeBlankMarkers,
  parsePartBAnswerSequence,
  extractTranslationSegments
} from '../src/exam/source-converter.mjs';

test('normalizeClozeBlankMarkers turns source-provided numbered blanks into canonical markers', () => {
  assert.equal(
    normalizeClozeBlankMarkers('A 1 to earthquakes. The city more2 than 3,000 years ago.2 3', [1, 2, 3]),
    'A [1] to earthquakes. The city more[2] than 3,000 years ago.2 [3]'
  );
});

test('parsePartBAnswerSequence preserves fixed candidates and stable slot answers', () => {
  const result = parsePartBAnswerSequence('## 正确顺序 41 D → 42 G → 预给 C → 43 B → 预给 H → 44 E → 预给 A → 45 F');
  assert.deepEqual(result.answerSequence, ['D', 'G', 'C', 'B', 'H', 'E', 'A', 'F']);
  assert.deepEqual(result.fixedPlacements, [
    { position: 2, candidateKey: 'C' },
    { position: 4, candidateKey: 'H' },
    { position: 6, candidateKey: 'A' }
  ]);
  assert.deepEqual(result.slotAnswers, new Map([[41, 'D'], [42, 'G'], [43, 'B'], [44, 'E'], [45, 'F']]));
});

test('extractTranslationSegments reads source text and reference translation from analysis headings', () => {
  const result = extractTranslationSegments([
    '## 逐句解析',
    '(46) Recent decades have seen science move.',
    '## 难点',
    'analysis',
    '## 【译文】',
    '近几十年来科学发生了变化。',
    '(50) They pool resources and collaborate.',
    '## 【译文】',
    '他们汇集资源并协作。'
  ].join('\n'));
  assert.deepEqual(result.map(item => item.questionKey), ['kaoyan_en1_2025_part_c_q46', 'kaoyan_en1_2025_part_c_q50']);
  assert.equal(result[0].sourceText, 'Recent decades have seen science move.');
  assert.equal(result[1].referenceTranslation, '他们汇集资源并协作。');
});

test('2025 source conversion passes all seven unit gates when the locked source directory is available', { skip: !existsSync('D:/资料/english/md/考研英语一2025年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2025年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2025, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  assert.deepEqual(result.sourceSummary.writing.questionNumbers, [51, 52]);
  assert.equal(result.importedWriting, false);
  assert.equal(result.fieldCoverage.questionCount, 50);
  assert.equal(result.schemaGaps.length, 1);
  assert.deepEqual(result.rendererGaps, []);
  const text4 = result.unitResults.find(unit => unit.name === 'part-a-text-4');
  assert.equal(text4.markdown.includes('写作题和范文'), false);
  assert.ok(text4.markdown.length < 50000);
});

test('2024 source conversion imports six supported units and records unsupported Part B without blocking the paper', { skip: !existsSync('D:/资料/english/md/考研英语一2024年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2024年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2024, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  const partB = result.unitResults.find(unit => unit.name === 'part-b');
  assert.equal(partB.gate.reason, 'UNSUPPORTED_PART_B_VARIANT');
  assert.equal(partB.paper, null);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
  assert.equal(result.paper.units.length, 6);
  assert.equal(result.rendererGaps.length, 1);
  assert.match(result.rendererGaps[0], /UNSUPPORTED_PART_B_VARIANT/);
});

test('2023 source conversion handles inline cloze option blocks and a missing Text 2 heading', { skip: !existsSync('D:/资料/english/md/考研英语一2023年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2023年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2023, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  assert.equal(result.paper.units.find(unit => unit.unitKey === 'kaoyan_en1_2023_part_a_text_2')?.questions.length, 5);
});

test('2022 source conversion keeps English from mixed bilingual cloze blocks and skips unsupported Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2022年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2022年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2022, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  const cloze = result.paper.units.find(unit => unit.type === 'cloze_choice');
  assert.equal(cloze.questions.length, 20);
  assert.equal(cloze.passage.reduce((total, paragraph) => total + (paragraph.text.match(/\[\d+\]/gu) || []).length, 0), 20);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
});

test('2019 source conversion accepts the seven-candidate paragraph ordering variant', { skip: !existsSync('D:/资料/english/md/考研英语一2019年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2019年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2019, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  const partB = result.paper.units.find(unit => unit.type === 'paragraph_ordering');
  assert.equal(partB.candidates.length, 7);
  assert.equal(partB.fixedPlacements.length, 2);
  assert.equal(partB.questions.length, 5);
});

test('2018 source conversion accepts the seven-candidate paragraph ordering variant', { skip: !existsSync('D:/资料/english/md/考研英语一2018年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2018年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2018, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  const partB = result.paper.units.find(unit => unit.type === 'paragraph_ordering');
  assert.equal(partB.candidates.length, 7);
  assert.equal(partB.fixedPlacements.length, 2);
});

test('2017 source conversion imports the supported units and seven-candidate Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2017年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2017年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2017, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  const partB = result.paper.units.find(unit => unit.type === 'paragraph_ordering');
  assert.equal(partB.candidates.length, 7);
  assert.equal(partB.fixedPlacements.length, 2);
});

test('2016 source conversion imports supported units and skips unsupported Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2016年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2016年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2016, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
});

test('2015 source conversion imports supported units and skips unsupported Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2015年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2015年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2015, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
});

test('2014 source conversion imports the seven-candidate paragraph ordering unit', { skip: !existsSync('D:/资料/english/md/考研英语一2014年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2014年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2014, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  const partB = result.paper.units.find(unit => unit.type === 'paragraph_ordering');
  assert.equal(partB.candidates.length, 7);
  assert.equal(partB.fixedPlacements.length, 2);
});

test('2013 source conversion imports supported units and skips unsupported Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2013年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2013年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2013, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
});

test('2012 source conversion imports supported units and skips unsupported Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2012年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2012年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2012, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
});

test('2011 source conversion imports the supported seven-candidate Part B and Part C', { skip: !existsSync('D:/资料/english/md/考研英语一2011年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2011年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2011, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  const partB = result.paper.units.find(unit => unit.type === 'paragraph_ordering');
  assert.equal(partB.candidates.length, 7);
  assert.equal(partB.fixedPlacements.length, 2);
});

test('2010 source conversion imports supported units and skips unsupported Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2010年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2010年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2010, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 45);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS']);
  assert.equal(result.sourceSummary.partB.variant, 'unsupported_matching');
});
