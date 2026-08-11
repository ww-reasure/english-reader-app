import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCET4Paper, metaFor } from '../src/exam/cet4-source-converter.mjs';

const YEAR = 2023;
const MONTH = 6;
const SET = 1;

function reprint(set = SET) {
  return `## 真题卷第${set}套(${YEAR}-${String(MONTH).padStart(2, '0')}) • 四级`;
}

function analysisHeader(title, range) {
  return `## ${title} · ${range} 题`;
}

function buildSectionA() {
  const candidates = ['A) adequate I) natural', 'B) admiring J) potential', 'C) contains K) released', 'D) defending L) revealing', 'E) exact M) sealed', 'F) instant N) solves', 'G) liquid O) substance', 'H) modified'];
  const blanks = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35].map((number, index) => {
    const key = String.fromCharCode(65 + index);
    return `${number}. Sentence context \\_\\_(${number})\\_\\_ more text. 【答案】 ${key}) word${index} 动词`;
  });
  const bilingualPassage = [
    'Psychologists study complex self-presentation behaviour. New findings suggest it appears earlier than previously known.',
    'Research shows children want to be accepted by people they admire. Experiences teach what constitutes a good reputation and help with building it.',
    'Children vary their behaviour for key audiences. Researchers ask where they understand the process and where they struggle.',
    'Children do not suddenly develop a reputation. Researchers ask what happens earlier.'
  ];
  return [
    analysisHeader('选词填空题和解析', '26–35'),
    '本页说明。',
    '## 英语四级 2023年6月·第1套 · 全卷构成',
    '<table><tr><td>Part III Section A</td><td>本题</td></tr></table>',
    reprint(),
    'Part Ⅲ Section A',
    'Directions: In this section, there is a passage with ten blanks.',
    ...bilingualPassage.flatMap((text, index) => [text, `第${index + 1}段中文翻译。`, '']),
    candidates.join('\n'),
    ...blanks
  ].join('\n');
}

function buildSectionB() {
  const paragraphs = ['A', 'B', 'C', 'D', 'E'].flatMap(key => [`${key}) Paragraph ${key} text for matching.`, `段落 ${key} 中文翻译。`]);
  const statements = Array.from({ length: 10 }, (_, index) => `${36 + index}. Statement ${36 + index} about a paragraph.`);
  const answers = Array.from({ length: 10 }, (_, index) => `${36 + index}. 第 ${36 + index} 句的中文题干 【答案】 ${String.fromCharCode(65 + (index % 5))} 段（强锚点）`);
  return [
    analysisHeader('信息匹配题和解析', '36–45'),
    '本页说明。',
    '## 英语四级 2023年6月·第1套 · 全卷构成',
    '<table><tr><td>Part III Section B</td><td>本题</td></tr></table>',
    reprint(),
    '## The spoken web',
    ...paragraphs,
    ...statements,
    '## 答案与逐句解析',
    ...answers
  ].join('\n');
}

function buildOriginalReading() {
  return [
    '## Part Ⅲ Reading Comprehension (40 minutes)',
    'Directions: Read the following passages and answer the questions.',
    'Psychologists study self26 presentation behaviour. New findings appear earlier than 27 known.',
    '',
    'Children want to be accepted by people they admire. Experiences teach what 28 a reputation and help with 29 it 30.',
    '',
    'Children will 31 their behaviour for key 32. Researchers ask where in this 33 process they succeed and where they 34.',
    '',
    'Children do not just have reputation pop 35 into existence.',
    '',
    'A) accepted I) natural',
    'B) admiring J) potential',
    'C) contains K) released',
    'D) defending L) revealing',
    'E) exact M) sealed',
    'F) instant N) solves',
    'G) liquid O) substance',
    'H) modified',
    '',
    '## Section B',
    'Directions: Match each statement to a paragraph.',
    '## Original matching passage',
    'A) Original paragraph A without a translation.',
    'B) Original paragraph B without a translation.',
    'C) Original paragraph C without a translation.',
    'D) Original paragraph D without a translation.',
    'E) Original paragraph E without a translation.',
    '36. Original statement.',
    '',
    '## Section C',
    'Directions: Choose the best answer.',
    '## Passage One',
    'Questions 46 to 50 are based on the following passage.',
    'Original detailed-reading paragraph one.',
    '',
    'Original detailed-reading paragraph two.',
    '',
    '46. Original question?',
    'A) Original option A',
    'B) Original option B',
    'C) Original option C',
    'D) Original option D',
    '',
    '## Passage Two',
    'Questions 51 to 55 are based on the following passage.',
    'Original second passage paragraph one.',
    '',
    'Original second passage paragraph two.',
    '',
    '51. Original question?',
    'A) Original option A',
    'B) Original option B',
    'C) Original option C',
    'D) Original option D',
    '',
    '## Part IV Translation (30 minutes)',
    'Directions: Translate the passage.'
  ].join('\n');
}

function buildSectionC(first, last, title, base) {
  const questions = Array.from({ length: 5 }, (_, index) => {
    const number = first + index;
    return `${number}. Question stem ${number}?\nA) Option A\nB) Option B\nC) Option C\nD) Option D`;
  });
  const analysis = Array.from({ length: 5 }, (_, index) => {
    const number = first + index;
    return `${number}. 第 ${number} 题中文题干\n\n【答案】 ${String.fromCharCode(65 + (index % 4))} （细节题）\n\n## 【定位】 P${index + 1}\nEvidence sentence ${number}.\n证据中文。\n\n## 【选项】 A) 偷换概念\n## B) ✓ 正确\n## C) 无中生有\n## D) 答非所问`;
  });
  return [
    analysisHeader('阅读理解题和解析', `${first}–${last}`),
    '本页说明。',
    '## 英语四级 2023年6月·第1套 · 全卷构成',
    '<table><tr><td>Part III Section C</td><td>本题</td></tr></table>',
    reprint(),
    `## ${title}`,
    'Questions 46 to 50 are based on the following passage.',
    `P1 Paragraph ${base} one. 第一段中文。`,
    `P2 Paragraph ${base} two. 第二段中文。`,
    ...questions,
    '## 答案与逐题解析',
    ...analysis
  ].join('\n');
}

function buildTranslation() {
  return [
    analysisHeader('汉译英真题、参考译文与逐句解析', ''),
    '本页说明。',
    '## 英语四级 2023年6月·第1套 · 全卷构成',
    '<table><tr><td>Part IV</td><td>汉译英</td></tr></table>',
    reprint(),
    '## Part IV Translation (30 minutes)',
    'Directions: For this part, you are allowed 30 minutes to translate a passage from Chinese into English.',
    '中国越来越重视终身教育，发展继续教育是构建终身教育体系的有效途径。',
    '## 逐句解析',
    '1. 中国越来越重视终身教育，发展继续教育是构建终身教育体系的有效途径。',
    '【译文】 China attaches increasing importance to lifelong education, and developing continuing education is an effective way.',
    '【主干】 以 China 为主语。'
  ].join('\n');
}

function syntheticSource() {
  return [
    `## 四级 · 真题卷第${SET}套 · 2023年6月`,
    buildOriginalReading(),
    buildSectionA(),
    buildSectionB(),
    buildSectionC(46, 50, 'Passage One', 'alpha'),
    buildSectionC(51, 55, 'Passage Two', 'beta'),
    buildTranslation()
  ].join('\n\n');
}

test('metaFor builds stable CET4 paper identity', () => {
  assert.deepEqual(metaFor({ year: 2023, month: 6, setNumber: 1 }), {
    schema: 'exam-md-v1',
    examId: 'cet4',
    bankId: 'builtin_cet4',
    packageId: 'local.cet4',
    packageVersion: '1.0.0',
    paperKey: 'cet4_2023_06_1',
    year: 2023,
    sourceType: 'past_exam'
  });
});

test('converts a synthetic CET4 paper into five passing units', () => {
  const result = buildCET4Paper({ source: syntheticSource(), year: YEAR, month: MONTH, setNumber: SET });
  assert.deepEqual(result.blockers, []);
  const byName = new Map(result.unitResults.map(unit => [unit.name, unit]));
  for (const name of ['section-a', 'section-b', 'section-c-1', 'section-c-2', 'translation']) {
    const unit = byName.get(name);
    assert.ok(unit, `missing unit ${name}`);
    assert.equal(unit.gate.status, 'PASS', `${name} gate failed: ${unit.gate.blockers[0]}`);
  }
  const sectionA = byName.get('section-a').paper.units[0];
  assert.equal(sectionA.matchingVariant, 'banked_cloze');
  assert.equal(sectionA.candidates.length, 15);
  assert.equal(sectionA.questions.length, 10);
  assert.equal(sectionA.passage.length, 4);
  assert.deepEqual(
    [...new Set(sectionA.passage.flatMap(item => [...item.text.matchAll(/\[(\d+)\]/gu)].map(match => Number(match[1]))))].sort((a, b) => a - b),
    [26, 27, 28, 29, 30, 31, 32, 33, 34, 35]
  );
  assert.deepEqual(sectionA.translation.map(item => item.paragraphKey), ['P1', 'P2', 'P3', 'P4']);
  const sectionB = byName.get('section-b').paper.units[0];
  assert.equal(sectionB.matchingVariant, 'long_reading');
  assert.equal(sectionB.allowCandidateReuse, true);
  assert.equal(sectionB.questions.length, 10);
  assert.equal(sectionB.translation.length, 5);
  assert.ok(sectionB.passage.every(item => !/[\u3400-\u9fff]/u.test(item.text)));
  for (const unit of [byName.get('section-c-1').paper.units[0], byName.get('section-c-2').paper.units[0]]) {
    assert.ok(unit.passage.every(item => !/[\u3400-\u9fff]/u.test(item.text)));
    assert.equal(unit.translation.length, unit.passage.length);
    assert.ok(unit.questions.every(question => question.options.every(option => (
      !/[\u3400-\u9fff]/u.test(option.text)
      && !/答案与逐题解析|【选项】/u.test(option.text)
    ))));
  }
  const translation = byName.get('translation').paper.units[0];
  assert.equal(translation.direction, 'zh_to_en');
  assert.equal(translation.questions[0].referenceTranslation, 'China attaches increasing importance to lifelong education, and developing continuing education is an effective way.');
  assert.equal(result.questionCount, 31);
});
