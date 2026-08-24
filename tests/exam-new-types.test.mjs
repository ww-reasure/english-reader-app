import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { indexedDB } from 'fake-indexeddb';
import { createResponse } from '../src/exam/attempt-state.mjs';
import { buildExamPackFromMarkdown } from '../src/exam/pack.mjs';
import { installExamPack } from '../src/exam/pack-installer.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { getExamRenderer } from '../src/exam/renderers/registry.mjs';
import { assertCanonicalPaper } from '../src/exam/schema.mjs';
import { ExamPracticeService } from '../src/exam/practice-service.mjs';
import { ExamRepository } from '../src/exam/repository.mjs';
import { ExamStateRepository } from '../src/exam/state-repository.mjs';
import { assertOrderingResponses } from '../src/exam/grading.mjs';

function matchingPaper(variant = 'sentence_insertion') {
  const questions = Array.from({ length: 5 }, (_, index) => ({
    questionKey: `matching_q${41 + index}`,
    type: 'matching_slot',
    points: 2,
    answer: String.fromCharCode(65 + index),
    stem: '',
    options: [],
    slotNumber: 41 + index
  }));
  return {
    schemaVersion: 1,
    examId: 'kaoyan_en1', bankId: 'matching_bank', packageId: 'matching.pack', packageVersion: '1.0.0',
    paperKey: 'matching_2024', year: 2024, title: 'Matching', sourceType: 'past_exam',
    units: [{
      unitKey: 'matching_unit', type: 'matching', displayTitle: 'Part B', matchingVariant: variant,
      passage: questions.map((question, index) => ({ paragraphKey: `P${index + 1}`, text: `Target ${index + 1} [${question.slotNumber}]` })),
      translation: [],
      candidates: Array.from({ length: 7 }, (_, index) => ({ candidateKey: String.fromCharCode(65 + index), text: `Candidate ${index + 1}` })),
      slots: questions.map((question, index) => ({ slotNumber: question.slotNumber, position: index, questionKey: question.questionKey })),
      questions
    }]
  };
}

test('matching schema accepts five unique slots and seven candidates', () => {
  assert.doesNotThrow(() => assertCanonicalPaper(matchingPaper()));
  assert.equal(getExamRenderer('matching').unitType, 'matching');
});

test('matching schema rejects duplicate answers and missing slot markers', () => {
  const duplicate = matchingPaper();
  duplicate.units[0].questions[1].answer = 'A';
  assert.throws(() => assertCanonicalPaper(duplicate), /重复使用/);
  const missing = matchingPaper();
  missing.units[0].passage[0].text = 'Target without marker';
  assert.throws(() => assertCanonicalPaper(missing), /占位标记/);
});

const clozeUrl = new URL('./fixtures/exam-md-cloze-minimal.md', import.meta.url);
const orderingUrl = new URL('./fixtures/exam-md-ordering-minimal.md', import.meta.url);
const generatedAt = '2026-08-07T00:00:00.000Z';
let sequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const learningDayUrl = new URL('../src/learning-day.mjs', import.meta.url).href;
  const learningActivityUrl = new URL('../src/learning-activity.mjs', import.meta.url).href;
  const externalSchedulerUrl = new URL('../src/external-review-scheduler.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createServices(markdown) {
  globalThis.indexedDB = indexedDB;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamNewTypes-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const contentRepository = new ExamRepository({ openDb });
  const stateRepository = new ExamStateRepository({ openDb });
  const practiceService = new ExamPracticeService({ contentRepository, stateRepository, openDb });
  await installExamPack(openDb, await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' }));
  return { db, openDb, contentRepository, stateRepository, practiceService };
}

test('parses synthetic cloze fixture with stable blanks', async () => {
  const paper = parseExamMarkdown(await readFile(clozeUrl, 'utf8'));
  const unit = paper.units[0];
  assert.equal(unit.type, 'cloze_choice');
  assert.deepEqual(unit.questions.map(question => question.blankNumber), [1, 2, 3]);
  assert.equal(unit.passage[0].text.includes('[1]'), true);
  assert.equal(unit.passage[0].text.includes('[3]'), true);
});

test('cloze validator rejects duplicate blanks and missing markers', async () => {
  const paper = structuredClone(parseExamMarkdown(await readFile(clozeUrl, 'utf8')));
  paper.units[0].questions[1].blankNumber = 1;
  assert.throws(() => assertCanonicalPaper(paper), /blankNumber 重复/);

  const missing = structuredClone(parseExamMarkdown(await readFile(clozeUrl, 'utf8')));
  missing.units[0].passage[0].text = missing.units[0].passage[0].text.replace('[1]', '1');
  assert.throws(() => assertCanonicalPaper(missing), /blank 标记数量|缺少占位标记/);
});

test('parses synthetic ordering fixture with fixed placements', async () => {
  const paper = parseExamMarkdown(await readFile(orderingUrl, 'utf8'));
  const unit = paper.units[0];
  assert.equal(unit.type, 'paragraph_ordering');
  assert.deepEqual(unit.candidates.map(candidate => candidate.candidateKey), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(unit.slots.length, 3);
  assert.equal(unit.fixedPlacements[0].position, 0);
  assert.deepEqual(unit.answerSequence, ['A', 'B', 'C', 'D', 'E']);
});

test('parses optional partial candidate translations for ordering units', async () => {
  const source = await readFile(orderingUrl, 'utf8');
  const markdown = source.replace(
    '#### Candidate A',
    '#### Candidate Translations\n- A: 候选段 A 的中文译文\n- C: 候选段 C 的中文译文\n\n#### Candidate A'
  );
  const paper = parseExamMarkdown(markdown);
  assert.deepEqual(paper.units[0].candidateTranslations, [
    { key: 'A', text: '候选段 A 的中文译文' },
    { key: 'C', text: '候选段 C 的中文译文' }
  ]);
  assert.doesNotThrow(() => assertCanonicalPaper(paper));
});

test('ordering validator rejects unknown and duplicate candidate translation keys', async () => {
  const paper = structuredClone(parseExamMarkdown(await readFile(orderingUrl, 'utf8')));
  paper.units[0].candidateTranslations = [{ key: 'Z', text: '未知候选段' }];
  assert.throws(() => assertCanonicalPaper(paper), /candidateTranslations\.key 不在 candidates 中/);

  paper.units[0].candidateTranslations = [
    { key: 'A', text: '第一份译文' },
    { key: 'A', text: '重复译文' }
  ];
  assert.throws(() => assertCanonicalPaper(paper), /candidateTranslations\.key 重复/);
});

test('ordering validator rejects duplicate candidates and fixed conflicts', async () => {
  const duplicate = structuredClone(parseExamMarkdown(await readFile(orderingUrl, 'utf8')));
  duplicate.units[0].candidates.push(structuredClone(duplicate.units[0].candidates[0]));
  assert.throws(() => assertCanonicalPaper(duplicate), /candidateKey 重复/);

  const conflict = structuredClone(parseExamMarkdown(await readFile(orderingUrl, 'utf8')));
  conflict.units[0].slots[0].position = 0;
  assert.throws(() => assertCanonicalPaper(conflict), /与 fixedPlacements 冲突/);
});

test('cloze practice loop preserves option order snapshot and grades by stable key', async () => {
  const services = await createServices(await readFile(clozeUrl, 'utf8'));
  const request = {
    examId: 'kaoyan_en1',
    bankId: 'synthetic_kaoyan_cloze_bank',
    packageId: 'synthetic.kaoyan.cloze',
    paperKey: 'synthetic_kaoyan_2026_cloze',
    unitKey: 'synthetic_kaoyan_2026_cloze_1'
  };
  const attempt = await services.practiceService.startAttempt(request);
  const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: attempt.attemptId });
  const q1 = practice.questions.find(question => question.questionKey === 'synthetic_kaoyan_2026_cloze_q1');
  const responses = practice.questions.map(question =>
    question.questionKey === q1.questionKey
      ? createResponse(attempt, question.questionKey, { answer: 'B' })
      : createResponse(attempt, question.questionKey, { answer: question.answer })
  );
  await services.practiceService.autosave({ examId: request.examId, attempt, responses, activeDurationMs: 300 });
  const resumed = await services.practiceService.getPractice({ examId: request.examId, attemptId: attempt.attemptId });
  assert.deepEqual(resumed.attempt.optionOrders, attempt.optionOrders);
  assert.equal(resumed.responses.find(item => item.questionKey === q1.questionKey).answer, 'B');
  const submitted = await services.practiceService.submit({ examId: request.examId, attemptId: attempt.attemptId, responses, activeDurationMs: 400 });
  assert.equal(submitted.responses.find(item => item.questionKey === q1.questionKey).correct, true);
  assert.equal(submitted.responses.find(item => item.questionKey === q1.questionKey).correctOptionKeyAtSubmit, 'B');
  services.db.close();
});

test('ordering practice loop preserves candidate order and rejects duplicate placement', async () => {
  const services = await createServices(await readFile(orderingUrl, 'utf8'));
  const request = {
    examId: 'kaoyan_en1',
    bankId: 'synthetic_kaoyan_ordering_bank',
    packageId: 'synthetic.kaoyan.ordering',
    paperKey: 'synthetic_kaoyan_2026_part_b',
    unitKey: 'synthetic_kaoyan_2026_part_b_1'
  };
  const attempt = await services.practiceService.startAttempt(request);
  assert.equal(attempt.candidateOrder.length, 5);
  const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: attempt.attemptId });
  assert.deepEqual(practice.attempt.candidateOrder, attempt.candidateOrder);

  const duplicateResponses = practice.questions.map((question, index) =>
    createResponse(attempt, question.questionKey, { answer: index === 0 ? 'B' : 'B' })
  );
  assert.throws(() => assertOrderingResponses(practice.unit, duplicateResponses), /重复使用/);
  await assert.rejects(
    services.practiceService.submit({ examId: request.examId, attemptId: attempt.attemptId, responses: duplicateResponses, activeDurationMs: 100 }),
    /重复使用/
  );

  const correctResponses = practice.questions.map(question =>
    createResponse(attempt, question.questionKey, { answer: question.answer })
  );
  const submitted = await services.practiceService.submit({ examId: request.examId, attemptId: attempt.attemptId, responses: correctResponses, activeDurationMs: 200 });
  assert.equal(submitted.responses.every(response => response.correct), true);
  assert.equal(submitted.responses[0].correctOptionKeyAtSubmit, 'B');
  services.db.close();
});

test('renderer registry exposes article and question bodies for cloze and ordering', async () => {
  const cloze = getExamRenderer('cloze_choice');
  const clozePaper = parseExamMarkdown(await readFile(clozeUrl, 'utf8'));
  assert.match(cloze.renderArticle(clozePaper.units[0], { responses: new Map(), currentQuestionKey: null }), /data-blank/);
  const clozeQuestion = cloze.renderQuestion(clozePaper.units[0].questions[0], { response: null, optionOrder: ['A', 'B', 'C', 'D'] });
  assert.match(clozeQuestion, /exam-cloze-options/);
  assert.match(clozeQuestion, /data-key/);

  const ordering = getExamRenderer('paragraph_ordering');
  const orderingPaper = parseExamMarkdown(await readFile(orderingUrl, 'utf8'));
  assert.match(ordering.renderArticle(orderingPaper.units[0], { responses: new Map(), currentQuestionKey: null }), /data-slot/);
  assert.match(ordering.renderQuestion(orderingPaper.units[0].questions[0], {
    response: null,
    unit: orderingPaper.units[0],
    responses: new Map(),
    candidateOrder: ['A', 'B', 'C', 'D', 'E']
  }), /data-key/);
});

test('reading result labels retain the stable source question number', () => {
  const reading = getExamRenderer('reading_mcq');
  assert.equal(reading.questionLabel({ questionKey: 'kaoyan_en1_2026_q22' }, 1), 'Q22');
});

test('reading explanation renders one paragraph translation control per passage paragraph', async () => {
  const reading = getExamRenderer('reading_mcq');
  const paper = parseExamMarkdown(await readFile(new URL('./fixtures/exam-md-minimal.md', import.meta.url), 'utf8'));
  const unit = paper.units[0];
  const draft = reading.renderArticle(unit, { resultMode: false });
  assert.doesNotMatch(draft, /data-paragraph-translation-toggle/);

  const explanation = reading.renderArticle(unit, { resultMode: true });
  assert.equal((explanation.match(/data-paragraph-translation-toggle/gu) || []).length, unit.passage.length);
  assert.match(explanation, /data-paragraph-key="P1"/);
  assert.match(explanation, /一个小型工程师团队构建了用于自动化测试的合成阅读文章/u);
});

test('result renderers preserve submit snapshots and hide absent optional explanation sections', async () => {
  const reading = getExamRenderer('reading_mcq');
  const readingPaper = parseExamMarkdown(await readFile(new URL('./fixtures/exam-md-minimal.md', import.meta.url), 'utf8'));
  const question = structuredClone(readingPaper.units[0].questions[0]);
  question.stemAnalysis = '判型：细节题\n\n拆句：题干结构。';
  question.evidenceTranslation = '定位句中文译文。';
  question.optionTranslations = [{ key: 'A', text: '选项 A 译文。' }];
  question.optionAnalysis = [{ key: 'D', text: '✓ 正确' }];
  const detail = reading.resultDetailHtml(question, {
    answer: 'B',
    correctOptionKeyAtSubmit: 'D',
    uncertain: true
  });
  assert.match(detail, /我的答案/);
  assert.match(detail, /正确答案/);
  assert.match(detail, /D/);
  assert.match(detail, /题干翻译/);
  assert.match(detail, /Stem Analysis/);
  assert.match(detail, /Evidence Translation/);
  assert.match(detail, /选项翻译/);
  assert.match(detail, /作答时标记为不确定/);
  assert.doesNotMatch(detail, /✓<\/b> ✓ 正确/);
  assert.match(detail, /在原文中查看/);

  const summaryDetail = reading.resultDetailHtml(question, { answer: 'B', correctOptionKeyAtSubmit: 'D' }, {
    unit: readingPaper.units[0],
    showEvidenceNavigation: false
  });
  assert.doesNotMatch(summaryDetail, /在原文中查看/);

  delete question.evidenceTranslation;
  delete question.optionTranslations;
  const partial = reading.resultDetailHtml(question, { answer: 'B', correctOptionKeyAtSubmit: 'D' });
  assert.doesNotMatch(partial, /Evidence Translation/);
  assert.doesNotMatch(partial, /选项翻译/);
  assert.doesNotMatch(partial, /undefined/);
});

test('ordering result renderer exposes per-slot snapshot answers and candidate translations', async () => {
  const ordering = getExamRenderer('paragraph_ordering');
  const paper = parseExamMarkdown(await readFile(orderingUrl, 'utf8'));
  const unit = structuredClone(paper.units[0]);
  unit.candidateTranslations = [
    { key: 'B', text: '候选段 B 的中文译文。' },
    { key: 'D', text: '候选段 D 的中文译文。' }
  ];
  const question = unit.questions[0];
  const html = ordering.resultDetailHtml(question, {
    answer: 'D',
    correctOptionKeyAtSubmit: 'B'
  }, { unit });
  assert.match(html, /我的答案/);
  assert.match(html, /正确答案/);
  assert.match(html, /候选段中文翻译/);
  assert.match(html, /候选段 B 的中文译文/);
  assert.match(html, /候选段 D 的中文译文/);
  assert.match(html, /我的候选段/);
  assert.match(html, /正确候选段/);
});
