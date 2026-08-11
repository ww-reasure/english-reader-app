import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertCanonicalPaper } from '../src/exam/schema.mjs';
import { assertOrderingResponses } from '../src/exam/grading.mjs';

const META = `{
  "schema": "exam-md-v1",
  "examId": "cet4",
  "bankId": "builtin_cet4",
  "packageId": "local.cet4",
  "packageVersion": "1.0.0",
  "paperKey": "cet4_2023_06_1",
  "year": 2023,
  "sourceType": "past_exam"
}`;

function candidates(keys) {
  return keys.map(key => `#### Candidate ${key}\nCandidate text ${key}.`).join('\n\n');
}

function matchingPaper({ variant, candidateKeys, slotNumbers, answers, allowReuse = false, marker = true, passageOverride = null }) {
  const passage = passageOverride
    ? passageOverride.map(item => `##### ${item.paragraphKey}\n${item.text}`).join('\n\n')
    : marker
      ? slotNumbers.map(number => `##### P${number}\n[${number}] Paragraph ${number}`).join('\n\n')
      : slotNumbers.map(number => `##### P${number}\nParagraph ${number} text without marker.`).join('\n\n');
  const questions = slotNumbers.map((number, index) => `#### Slot ${number}

\`\`\`exam-item
{
  "questionKey": "cet4_2023_06_1_section_b_q${number}",
  "type": "matching_slot",
  "answer": "${answers[index]}",
  "points": 1
}
\`\`\`

Statement ${number} asks about a paragraph.
`).join('\n\n');
  return `# CET4 Sample

\`\`\`exam-meta
${META}
\`\`\`

## Section B

### Section B

\`\`\`exam-item
{
  "unitKey": "cet4_2023_06_1_section_b_1",
  "type": "matching",
  "displayTitle": "长篇阅读",
  "matchingVariant": "${variant}",
  "sectionLabel": "Section B · 长篇阅读",
  "sectionOrder": 1,
  ${allowReuse ? '"allowCandidateReuse": true,' : ''}
  "slots": [${slotNumbers.join(',')}]
}
\`\`\`

#### Directions
Match each statement to a paragraph.

#### Passage

${passage}

${candidates(candidateKeys)}

${questions}
`;
}

function translationPaper({ direction = 'zh_to_en' } = {}) {
  return `# CET4 Translation

\`\`\`exam-meta
${META}
\`\`\`

## Part IV

### 翻译

\`\`\`exam-item
{
  "unitKey": "cet4_2023_06_1_translation_1",
  "type": "translation",
  "displayTitle": "汉译英",
  "direction": "${direction}",
  "sectionLabel": "Part IV · 汉译英",
  "sectionOrder": 3
}
\`\`\`

#### Directions
Translate the passage from Chinese into English.

#### Passage

##### P1
中国越来越重视终身教育。

#### Q1

\`\`\`exam-item
{
  "questionKey": "cet4_2023_06_1_translation_q1",
  "segmentKey": "T1",
  "type": "translation_segment",
  "points": 2
}
\`\`\`

##### Source Text
中国越来越重视终身教育。

##### Reference Translation
China attaches increasing importance to lifelong education.

##### Local Analysis
以 China 为主语，一般现在时。
`;
}

test('parser carries section label, section order, matching variant and reuse flag', () => {
  const paper = parseExamMarkdown(matchingPaper({
    variant: 'long_reading',
    candidateKeys: ['A', 'B', 'C', 'D', 'E'],
    slotNumbers: [36, 37],
    answers: ['A', 'A'],
    allowReuse: true,
    marker: false
  }));
  const unit = paper.units[0];
  assert.equal(unit.matchingVariant, 'long_reading');
  assert.equal(unit.sectionLabel, 'Section B · 长篇阅读');
  assert.equal(unit.sectionOrder, 1);
  assert.equal(unit.allowCandidateReuse, true);
  assert.equal(unit.questions.length, 2);
  assert.equal(unit.questions[0].stem, 'Statement 36 asks about a paragraph.');
  assert.equal(unit.questions[1].answer, 'A');
  assert.doesNotThrow(() => assertCanonicalPaper(paper));
});

test('parser carries translation direction', () => {
  const paper = parseExamMarkdown(translationPaper());
  const unit = paper.units[0];
  assert.equal(unit.direction, 'zh_to_en');
  assert.equal(unit.sectionOrder, 3);
  assert.equal(unit.questions[0].sourceText, '中国越来越重视终身教育。');
  assert.equal(unit.questions[0].referenceTranslation, 'China attaches increasing importance to lifelong education.');
  assert.doesNotThrow(() => assertCanonicalPaper(paper));
});

test('schema accepts banked cloze with 15 unique candidates and 10 slots', () => {
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  const answers = keys.slice(0, 10);
  const paper = parseExamMarkdown(matchingPaper({
    variant: 'banked_cloze',
    candidateKeys: keys,
    slotNumbers: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
    answers,
    marker: true
  }));
  assert.doesNotThrow(() => assertCanonicalPaper(paper));
});

test('schema rejects banked cloze without a passage or blank markers', () => {
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  assert.throws(() => parseExamMarkdown(matchingPaper({
    variant: 'banked_cloze',
    candidateKeys: keys,
    slotNumbers: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
    answers: keys.slice(0, 10),
    marker: false
  })), /passage|占位标记/);
});

test('schema rejects banked cloze markers in the wrong reading order', () => {
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  const slotNumbers = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
  assert.throws(() => parseExamMarkdown(matchingPaper({
    variant: 'banked_cloze',
    candidateKeys: keys,
    slotNumbers,
    answers: keys.slice(0, 10),
    passageOverride: slotNumbers.map((number, index) => ({
      paragraphKey: `P${number}`,
      text: `[${index === 0 ? 27 : index === 1 ? 26 : number}] Paragraph ${number}`
    }))
  })), /占位标记/);
});

test('schema rejects banked cloze with reused candidates', () => {
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  assert.throws(() => parseExamMarkdown(matchingPaper({
    variant: 'banked_cloze',
    candidateKeys: keys,
    slotNumbers: [26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
    answers: ['A', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    marker: false
  })), /重复使用/);
});

test('schema rejects long reading reuse without the reuse flag and accepts it with the flag', () => {
  const keys = ['A', 'B', 'C', 'D', 'E'];
  const answers = ['A', 'A'];
  assert.throws(() => parseExamMarkdown(matchingPaper({
    variant: 'long_reading',
    candidateKeys: keys,
    slotNumbers: [36, 37],
    answers,
    allowReuse: false,
    marker: false
  })), /重复使用/);

  const allowed = parseExamMarkdown(matchingPaper({
    variant: 'long_reading',
    candidateKeys: keys,
    slotNumbers: [36, 37],
    answers,
    allowReuse: true,
    marker: false
  }));
  assert.doesNotThrow(() => assertCanonicalPaper(allowed));
});

test('schema rejects long-reading passage with an embedded full translation', () => {
  assert.throws(() => parseExamMarkdown(matchingPaper({
    variant: 'long_reading',
    candidateKeys: ['A', 'B', 'C', 'D', 'E'],
    slotNumbers: [36, 37],
    answers: ['A', 'B'],
    allowReuse: true,
    marker: false,
    passageOverride: [{ paragraphKey: 'P1', text: 'English source sentence. 这是一整段中文翻译，不能混在答题正文里。' }]
  })), /全文中文翻译/);
});

test('schema rejects reading options polluted by Chinese analysis text', async () => {
  const source = await import('node:fs/promises').then(module => module.readFile(new URL('./fixtures/exam-md-minimal.md', import.meta.url), 'utf8'));
  const paper = parseExamMarkdown(source);
  paper.units[0].questions[0].options[3].text += ' ## 答案与逐题解析 中文分析';
  assert.throws(() => assertCanonicalPaper(paper), /options.*中文|解析/u);
});

test('schema requires provided reading translations to use passage paragraph keys', async () => {
  const source = await import('node:fs/promises').then(module => module.readFile(new URL('./fixtures/exam-md-minimal.md', import.meta.url), 'utf8'));
  const paper = parseExamMarkdown(source);
  paper.units[0].translation.push({ paragraphKey: 'P99', text: '未知段落译文。' });
  assert.throws(() => assertCanonicalPaper(paper), /translation\.paragraphKey 不在 passage 中/);
});

test('schema rejects unknown matching variant and invalid translation direction', () => {
  assert.throws(() => parseExamMarkdown(matchingPaper({
    variant: 'unknown_variant',
    candidateKeys: ['A', 'B', 'C', 'D', 'E'],
    slotNumbers: [36, 37],
    answers: ['A', 'B'],
    marker: false
  })), /matchingVariant 无效/);

  assert.throws(() => parseExamMarkdown(translationPaper({ direction: 'sideways' })), /direction 无效/);
});

test('grading allows candidate reuse for long reading and still rejects unknown candidates', () => {
  const unit = {
    type: 'matching',
    matchingVariant: 'long_reading',
    allowCandidateReuse: true,
    candidates: ['A', 'B', 'C', 'D', 'E'].map(key => ({ candidateKey: key, text: key }))
  };
  assert.doesNotThrow(() => assertOrderingResponses(unit, [
    { questionKey: 'q36', answer: 'A' },
    { questionKey: 'q37', answer: 'A' }
  ]));
  assert.throws(() => assertOrderingResponses(unit, [
    { questionKey: 'q36', answer: 'Z' }
  ]), /未知候选段落/);
});
