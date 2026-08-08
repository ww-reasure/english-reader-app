import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertCanonicalPaper } from '../src/exam/schema.mjs';
import { createAttempt, createResponse, submitAttempt } from '../src/exam/attempt-state.mjs';
import { indexedDB } from 'fake-indexeddb';
import { installExamPack } from '../src/exam/pack-installer.mjs';
import { buildExamPackFromMarkdown } from '../src/exam/pack.mjs';
import { ExamRepository } from '../src/exam/repository.mjs';
import { ExamStateRepository } from '../src/exam/state-repository.mjs';
import { ExamPracticeService } from '../src/exam/practice-service.mjs';

const fixture = new URL('./fixtures/exam-md-translation-minimal.md', import.meta.url);

test('parses and validates translation unit with independent segments and optional analysis', async () => {
  const paper = parseExamMarkdown(await readFile(fixture, 'utf8'));
  const unit = paper.units[0];
  assert.equal(unit.type, 'translation');
  assert.equal(unit.questions.length, 2);
  assert.equal(unit.questions[0].type, 'translation_segment');
  assert.equal(unit.questions[0].segmentKey, 'S46');
  assert.equal(unit.questions[0].sourceText.startsWith('Tracing'), true);
  assert.equal(unit.questions[0].referenceTranslation.startsWith('追溯'), true);
  assert.equal(unit.questions[0].localAnalysis, '注意分词短语和宾语从句。');
  assert.doesNotThrow(() => assertCanonicalPaper(paper));
});

test('translation response uses value text and does not create objective correctness', () => {
  const attempt = createAttempt({
    examId: 'kaoyan_en1', bankId: 'b', packageId: 'p', paperKey: 'paper', unitKey: 'unit',
    questionKeys: ['q46'], optionOrders: null, packVersion: '1', contentHashSnapshot: 'sha256:' + 'a'.repeat(64)
  });
  const response = createResponse(attempt, 'q46', { value: { text: '我的译文' } });
  const result = submitAttempt({
    attempt,
    responses: [response],
    questions: [{ questionKey: 'q46', type: 'translation_segment', points: 2, sourceText: 'Source' }],
    activeDurationMs: 100
  });
  assert.deepEqual(result.responses[0].value, { text: '我的译文' });
  assert.equal(result.responses[0].correct, null);
  assert.equal(result.responses[0].pointsEarned, null);
  assert.equal('correctOptionKeyAtSubmit' in result.responses[0], false);
  assert.equal(result.attempt.status, 'submitted');
});

test('translation practice autosaves free text, submits immutable snapshots, and stores independent review state', async () => {
  globalThis.indexedDB = indexedDB;
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const adapted = source.replace("import { getStemForm } from './helpers.js';", "const getStemForm = word => String(word || '').trim().toLowerCase();").replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`);
  const dbModule = await import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
  dbModule.DB.DB_NAME = `EnglishReaderTranslation-${process.pid}-${Date.now()}`;
  const db = await dbModule.DB.open();
  const openDb = () => Promise.resolve(db);
  const contentRepository = new ExamRepository({ openDb });
  const stateRepository = new ExamStateRepository({ openDb });
  const practiceService = new ExamPracticeService({ contentRepository, stateRepository, openDb });
  const markdown = await readFile(fixture, 'utf8');
  await installExamPack(openDb, await buildExamPackFromMarkdown(markdown, { generatedAt: '2026-08-08T00:00:00.000Z', displayName: 'Synthetic Translation' }));
  const request = { examId: 'kaoyan_en1', bankId: 'synthetic_translation_bank', packageId: 'synthetic.translation.en1', paperKey: 'synthetic_translation_2026', unitKey: 'synthetic_translation_2026_part_c' };
  const attempt = await practiceService.startAttempt(request);
  const practice = await practiceService.getPractice({ examId: request.examId, attemptId: attempt.attemptId });
  const responses = practice.questions.map(question => createResponse(attempt, question.questionKey, { value: { text: question.questionKey.endsWith('q46') ? '我的译文' : '' } }));
  await practiceService.autosave({ examId: request.examId, attempt, responses, activeDurationMs: 321 });
  const resumed = await practiceService.getPractice({ examId: request.examId, attemptId: attempt.attemptId });
  assert.equal(resumed.responses.find(response => response.questionKey.endsWith('q46')).value.text, '我的译文');
  const submitted = await practiceService.submit({ examId: request.examId, attemptId: attempt.attemptId, responses, activeDurationMs: 654 });
  assert.equal(submitted.responses.every(response => response.correct === null && response.pointsEarned === null), true);
  assert.equal(submitted.responses.some(response => 'correctOptionKeyAtSubmit' in response), false);
  assert.deepEqual(await practiceService.wrongQuestionKeys({ examId: request.examId, attemptId: attempt.attemptId }), []);
  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  await practiceService.setTranslationReview({ examId: request.examId, attemptId: attempt.attemptId, questionKey: practice.questions[0].questionKey, status: 'needs_review' });
  const firstReview = await stateRepository.getTranslationReview({ examId: request.examId, bankId: attempt.bankId, questionKey: practice.questions[0].questionKey });
  Date.now = () => 1_700_000_001_000;
  await practiceService.setTranslationReview({ examId: request.examId, attemptId: attempt.attemptId, questionKey: practice.questions[0].questionKey, status: 'mostly_mastered' });
  const secondReview = await stateRepository.getTranslationReview({ examId: request.examId, bankId: attempt.bankId, questionKey: practice.questions[0].questionKey });
  Date.now = originalNow;
  assert.equal(firstReview.status, 'needs_review');
  assert.equal(secondReview.status, 'mostly_mastered');
  assert.equal(secondReview.createdAt, firstReview.createdAt);
  assert.equal(secondReview.firstMarkedAt, firstReview.firstMarkedAt);
  assert.equal(secondReview.nextDueAt, 1_700_000_001_000 + 7 * 24 * 60 * 60 * 1000);
  const redo = await practiceService.startAttempt(request);
  assert.notEqual(redo.attemptId, attempt.attemptId);
  db.close();
});
