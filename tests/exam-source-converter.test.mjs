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

test('parsePartBAnswerSequence allows one unused candidate in the 2010 ordering variant', () => {
  const result = parsePartBAnswerSequence('## 正确顺序 41 A → 42 B → 预给 E → 43 C → 44 D → 45 F', { candidateKeys: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
  assert.deepEqual(result.answerSequence, ['A', 'B', 'E', 'C', 'D', 'F']);
  assert.equal(result.fixedPlacements.length, 1);
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

for (const [year, variant] of [[2021, 'sentence_insertion'], [2020, 'heading_matching']]) {
  const path = `D:/资料/english/md/考研英语一${year}年真题及答案解析（整卷）.md`;
  test(`${year} source conversion imports ${variant} Part B`, { skip: !existsSync(path) }, async () => {
    const result = convertYearSource({ source: await readFile(path, 'utf8'), year, packageVersion: '1.1.2' });
    const unit = result.paper.units.find(item => item.type === 'matching');
    assert.equal(result.blockers.length, 0);
    assert.equal(unit.matchingVariant, variant);
    assert.equal(unit.questions.length, 5);
    assert.equal(unit.candidates.length, 7);
  });
}

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

test('2024 source conversion imports statement matching Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2024年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2024年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2024, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'statement_matching');
  assert.equal(result.paper.units.find(unit => unit.type === 'matching')?.matchingVariant, 'statement_matching');
  assert.deepEqual(result.rendererGaps, []);
});

test('2023 source conversion handles inline cloze option blocks and a missing Text 2 heading', { skip: !existsSync('D:/资料/english/md/考研英语一2023年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2023年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2023, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
  assert.equal(result.paper.units.find(unit => unit.unitKey === 'kaoyan_en1_2023_part_a_text_2')?.questions.length, 5);
  const question30 = result.paper.units
    .find(unit => unit.unitKey === 'kaoyan_en1_2023_part_a_text_2')
    ?.questions.find(question => question.questionKey === 'kaoyan_en1_2023_q30');
  assert.equal(question30?.options.find(option => option.key === 'D')?.text, 'an inadequate solution.');
  assert.doesNotMatch(JSON.stringify(question30?.options), /##\s*Text\s*3/iu);
});

test('the installed English I pack contains no next-passage material inside answer options', { skip: !existsSync('public/exam-packs/private/local.kaoyan.en1.json') }, async () => {
  const pack = JSON.parse(await readFile('public/exam-packs/private/local.kaoyan.en1.json', 'utf8'));
  const polluted = pack.papers.flatMap(paper => paper.units.flatMap(unit => unit.questions.flatMap(question =>
    (question.options || [])
      .filter(option => /(?:^|\s)##\s*Text\s*[1-4]\b|\bDirections:\s*Read the following/iu.test(option.text))
      .map(option => `${paper.paperKey}:${question.questionKey}:${option.key}`)
  )));
  assert.deepEqual(polluted, []);
});

test('2022 source conversion keeps English from mixed bilingual cloze blocks and imports statement matching', { skip: !existsSync('D:/资料/english/md/考研英语一2022年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2022年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2022, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  const cloze = result.paper.units.find(unit => unit.type === 'cloze_choice');
  assert.equal(cloze.questions.length, 20);
  assert.equal(cloze.passage.reduce((total, paragraph) => total + (paragraph.text.match(/\[\d+\]/gu) || []).length, 0), 20);
  assert.equal(result.sourceSummary.partB.variant, 'statement_matching');
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

test('2016 source conversion imports heading matching Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2016年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2016年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2016, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'heading_matching');
});

test('2015 source conversion imports sentence insertion Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2015年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2015年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2015, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'sentence_insertion');
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

test('2013 source conversion imports sentence insertion Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2013年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2013年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2013, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'sentence_insertion');
});

test('2012 source conversion imports sentence insertion Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2012年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2012年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2012, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'sentence_insertion');
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

test('2010 source conversion recognizes and imports paragraph ordering Part B', { skip: !existsSync('D:/资料/english/md/考研英语一2010年真题及答案解析（整卷）.md') }, async () => {
  const source = await readFile('D:/资料/english/md/考研英语一2010年真题及答案解析（整卷）.md', 'utf8');
  const result = convertYearSource({ source, year: 2010, packageVersion: '1.1.0' });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.questionCount, 50);
  assert.deepEqual(result.unitResults.map(unit => unit.gate.status), Array(7).fill('PASS'));
  assert.equal(result.sourceSummary.partB.variant, 'paragraph_ordering');
});
