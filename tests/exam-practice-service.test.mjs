import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { createResponse } from '../src/exam/attempt-state.mjs';
import { buildExamPackFromMarkdown, createExamPack } from '../src/exam/pack.mjs';
import { installExamPack } from '../src/exam/pack-installer.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { ExamRepository } from '../src/exam/repository.mjs';
import { ExamStateRepository } from '../src/exam/state-repository.mjs';
import { ExamPracticeService } from '../src/exam/practice-service.mjs';

const fixtureUrl = new URL('./fixtures/exam-md-minimal.md', import.meta.url);
const generatedAt = '2026-08-07T00:00:00.000Z';
let sequence = 0;

async function loadDatabaseModule() {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const metadataUrl = new URL('../src/cloud-article-metadata.mjs', import.meta.url).href;
  const learningDayUrl = new URL('../src/learning-day.mjs', import.meta.url).href;
  const learningActivityUrl = new URL('../src/learning-activity.mjs', import.meta.url).href;
  const externalSchedulerUrl = new URL('../src/external-review-scheduler.mjs', import.meta.url).href;
  const recoverySchedulerUrl = new URL('../src/recovery-scheduler.mjs', import.meta.url).href;
  const vocabularyLibraryUrl = new URL('../src/vocabulary-library.mjs', import.meta.url).href;
  const adapted = source
    .replace(
      "import { getStemForm } from './helpers.js';",
      "const getStemForm = word => String(word || '').trim().toLowerCase();"
    )
    .replace("from './cloud-article-metadata.mjs'", `from '${metadataUrl}'`)
    .replace("from './learning-day.mjs'", `from '${learningDayUrl}'`)
    .replace("from './learning-activity.mjs'", `from '${learningActivityUrl}'`)
    .replace("from './external-review-scheduler.mjs'", `from '${externalSchedulerUrl}'`)
    .replace("from './recovery-scheduler.mjs'", `from '${recoverySchedulerUrl}'`)
    .replace("from './vocabulary-library.mjs'", `from '${vocabularyLibraryUrl}'`);
  return import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
}

async function createServices() {
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  const module = await loadDatabaseModule();
  module.DB.DB_NAME = `EnglishReaderExamPracticeService-${process.pid}-${sequence++}`;
  const db = await module.DB.open();
  const openDb = () => Promise.resolve(db);
  const contentRepository = new ExamRepository({ openDb });
  const stateRepository = new ExamStateRepository({ openDb });
  const practiceService = new ExamPracticeService({ contentRepository, stateRepository, openDb });
  const markdown = await readFile(fixtureUrl, 'utf8');
  await installExamPack(openDb, await buildExamPackFromMarkdown(markdown, { generatedAt, displayName: 'Synthetic' }));
  return { db, openDb, contentRepository, stateRepository, practiceService };
}

const request = {
  examId: 'kaoyan_en1',
  bankId: 'synthetic_kaoyan_bank',
  packageId: 'synthetic.kaoyan.en1',
  paperKey: 'synthetic_kaoyan_2026',
  unitKey: 'synthetic_kaoyan_2026_text_1'
};

test('first attempt keeps original options; retry shuffles; grading uses stable keys', async () => {
  const services = await createServices();
  const first = await services.practiceService.startAttempt(request);
  assert.equal(first.optionShuffleSeed, null);
  assert.deepEqual(first.optionOrders.synthetic_kaoyan_2026_q21, ['A', 'B', 'C', 'D']);

  const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: first.attemptId });
  const responseB = createResponse(first, practice.questions[0].questionKey, { answer: 'B' });
  const responses = practice.questions.map(question => {
    const existing = question.questionKey === practice.questions[0].questionKey ? responseB : createResponse(first, question.questionKey);
    return existing;
  });
  await services.practiceService.autosave({
    examId: request.examId,
    attempt: first,
    responses,
    activeDurationMs: 1500
  });
  const resumed = await services.practiceService.getPractice({ examId: request.examId, attemptId: first.attemptId });
  assert.equal(resumed.responses.find(item => item.questionKey === practice.questions[0].questionKey).answer, 'B');
  assert.equal(resumed.attempt.activeDurationMs, 1500);

  const submitted = await services.practiceService.submit({
    examId: request.examId,
    attemptId: first.attemptId,
    responses,
    activeDurationMs: 1600
  });
  assert.equal(submitted.attempt.status, 'submitted');
  assert.equal(submitted.attempt.activeDurationMs, 1600);
  assert.equal(submitted.responses[0].correct, true);
  assert.equal(submitted.attempt.packageVersionAtStart, '1.0.0');
  assert.match(submitted.attempt.paperHashAtStart, /^sha256:/);
  assert.equal(submitted.responses[0].correctOptionKeyAtSubmit, 'B');
  assert.match(submitted.responses[0].questionHashAtSubmit, /^sha256:/);
  await assert.rejects(
    services.practiceService.submit({ examId: request.examId, attemptId: first.attemptId, responses, activeDurationMs: 100 }),
    /不可修改|只有进行中/
  );
  await assert.rejects(
    services.practiceService.autosave({ examId: request.examId, attempt: first, responses, activeDurationMs: 999 }),
    /已提交/
  );

  const second = await services.practiceService.startAttempt(request);
  assert.notEqual(second.optionShuffleSeed, null);
  const order = second.optionOrders.synthetic_kaoyan_2026_q21;
  assert.deepEqual([...order].sort(), ['A', 'B', 'C', 'D']);
  services.db.close();
});

test('wrong states are only created on explicit user action', async () => {
  const services = await createServices();
  const attempt = await services.practiceService.startAttempt(request);
  const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: attempt.attemptId });
  const q21 = practice.questions.find(question => question.questionKey === 'synthetic_kaoyan_2026_q21');
  const q22 = practice.questions.find(question => question.questionKey === 'synthetic_kaoyan_2026_q22');
  const responses = [
    createResponse(attempt, q21.questionKey, { answer: 'A' }),
    createResponse(attempt, q22.questionKey, { answer: 'A' })
  ];
  await services.practiceService.submit({
    examId: request.examId,
    attemptId: attempt.attemptId,
    responses,
    activeDurationMs: 500
  });
  assert.equal((await services.stateRepository.listWrongStates({ examId: request.examId })).length, 0);
  const wrong = await services.practiceService.wrongQuestionKeys({ examId: request.examId, attemptId: attempt.attemptId });
  assert.deepEqual(wrong, ['synthetic_kaoyan_2026_q21']);
  await services.practiceService.addAllWrongFromAttempt({ examId: request.examId, attemptId: attempt.attemptId });
  assert.equal((await services.stateRepository.listWrongStates({ examId: request.examId })).length, 1);
  services.db.close();
});

test('redo wrong creates a new attempt scoped to this attempt wrong keys', async () => {
  const services = await createServices();
  const first = await services.practiceService.startAttempt(request);
  const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: first.attemptId });
  const q21 = practice.questions.find(question => question.questionKey === 'synthetic_kaoyan_2026_q21');
  const responses = practice.questions.map(question =>
    question.questionKey === q21.questionKey
      ? createResponse(first, question.questionKey, { answer: 'A' })
      : createResponse(first, question.questionKey, { answer: 'A' })
  );
  await services.practiceService.submit({ examId: request.examId, attemptId: first.attemptId, responses, activeDurationMs: 200 });
  const wrong = await services.practiceService.wrongQuestionKeys({ examId: request.examId, attemptId: first.attemptId });
  const redo = await services.practiceService.startAttempt({
    ...request,
    mode: 'wrong_review',
    scopeQuestionKeys: wrong,
    forceShuffle: true
  });
  assert.equal(redo.mode, 'wrong_review');
  assert.deepEqual(redo.questionOrder, wrong);
  assert.notEqual(redo.optionShuffleSeed, null);
  const resumedRedo = await services.practiceService.getPractice({ examId: request.examId, attemptId: redo.attemptId });
  assert.deepEqual(resumedRedo.attempt.optionOrders, redo.optionOrders);
  services.db.close();
});

test('Review Center starts any active wrong question immediately with manual review metadata', async () => {
  const services = await createServices();
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  try {
    Date.now = () => now;
    const first = await services.practiceService.startAttempt(request);
    const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: first.attemptId });
    const wrong = practice.questions.map(question => createResponse(first, question.questionKey, { answer: question.questionKey.endsWith('q21') ? 'A' : 'A' }));
    await services.practiceService.submit({ examId: request.examId, attemptId: first.attemptId, responses: wrong, activeDurationMs: 100 });
    await services.practiceService.addWrongQuestions({ examId: request.examId, attemptId: first.attemptId, questionKeys: ['synthetic_kaoyan_2026_q21'] });

    const review = await services.practiceService.startReviewCenterAttempt({
      ...request,
      questionKeys: ['synthetic_kaoyan_2026_q21']
    });
    assert.equal(review.mode, 'wrong_review');
    assert.equal(review.practiceOrigin, 'review_center_manual');
    assert.deepEqual(review.reviewEligibleQuestionKeys, ['synthetic_kaoyan_2026_q21']);
  } finally {
    Date.now = originalNow;
    services.db.close();
  }
});

test('each submitted manual Review Center answer advances mastery and a later wrong reactivates the tracked state', async () => {
  const services = await createServices();
  const start = 1_700_000_000_000;
  const originalNow = Date.now;
  const q21Key = 'synthetic_kaoyan_2026_q21';
  const answer = async (attempt, key) => services.practiceService.submit({
    examId: request.examId,
    attemptId: attempt.attemptId,
    responses: [createResponse(attempt, q21Key, { answer: key })],
    activeDurationMs: 100
  });
  try {
    Date.now = () => start;
    const initial = await services.practiceService.startAttempt(request);
    await answer(initial, 'A');
    await services.practiceService.addWrongQuestions({ examId: request.examId, attemptId: initial.attemptId, questionKeys: [q21Key] });

    const firstDue = await services.practiceService.startReviewCenterAttempt({ ...request, questionKeys: [q21Key] });
    await answer(firstDue, 'B');
    let state = await services.stateRepository.getWrongState({ examId: request.examId, bankId: request.bankId, questionKey: q21Key });
    assert.equal(state.independentCorrectStreak, 1);
    assert.equal(state.reviewCount, 1);
    assert.equal(state.nextDueAt, null);

    const ordinary = await services.practiceService.startAttempt(request);
    await answer(ordinary, 'B');
    state = await services.stateRepository.getWrongState({ examId: request.examId, bankId: request.bankId, questionKey: q21Key });
    assert.equal(state.independentCorrectStreak, 1);

    Date.now = () => start + 1;
    const secondDue = await services.practiceService.startReviewCenterAttempt({ ...request, questionKeys: [q21Key] });
    await answer(secondDue, 'B');
    state = await services.stateRepository.getWrongState({ examId: request.examId, bankId: request.bankId, questionKey: q21Key });
    assert.equal(state.status, 'mastered');
    assert.equal(state.nextDueAt, null);

    Date.now = () => start + 5 * 24 * 60 * 60 * 1000;
    const normalWrong = await services.practiceService.startAttempt(request);
    await answer(normalWrong, 'A');
    state = await services.stateRepository.getWrongState({ examId: request.examId, bankId: request.bankId, questionKey: q21Key });
    assert.equal(state.status, 'active');
    assert.equal(state.independentCorrectStreak, 0);
    assert.equal(state.masteredAt, null);
    assert.equal(state.nextDueAt, null);
  } finally {
    Date.now = originalNow;
    services.db.close();
  }
});

test('old attempt grading snapshot stays stable after a later answer revision', async () => {
  const services = await createServices();
  const first = await services.practiceService.startAttempt(request);
  const practice = await services.practiceService.getPractice({ examId: request.examId, attemptId: first.attemptId });
  const q21Key = 'synthetic_kaoyan_2026_q21';
  const responses = practice.questions.map(question =>
    createResponse(first, question.questionKey, { answer: question.questionKey === q21Key ? 'B' : 'A' })
  );
  const submitted = await services.practiceService.submit({
    examId: request.examId,
    attemptId: first.attemptId,
    responses,
    activeDurationMs: 300
  });
  const oldResponse = submitted.responses.find(response => response.questionKey === q21Key);
  const oldQuestionHash = oldResponse.questionHashAtSubmit;
  const oldPaperHash = submitted.attempt.paperHashAtStart;
  assert.equal(oldResponse.correct, true);
  assert.equal(oldResponse.correctOptionKeyAtSubmit, 'B');

  const markdown = await readFile(fixtureUrl, 'utf8');
  const revisedPaper = structuredClone(parseExamMarkdown(markdown));
  revisedPaper.units[0].questions[0].answer = 'C';
  const revisedPack = await createExamPack({
    meta: {
      packageId: 'synthetic.kaoyan.en1.v2',
      packageVersion: '1.1.0',
      examId: 'kaoyan_en1',
      bankId: 'synthetic_kaoyan_bank',
      displayName: 'Synthetic'
    },
    papers: [revisedPaper],
    generatedAt
  });
  await installExamPack(services.openDb, revisedPack);

  const oldPractice = await services.practiceService.getPractice({ examId: request.examId, attemptId: first.attemptId });
  const storedOldResponse = oldPractice.responses.find(response => response.questionKey === q21Key);
  assert.equal(storedOldResponse.correct, true);
  assert.equal(storedOldResponse.correctOptionKeyAtSubmit, 'B');
  assert.equal(storedOldResponse.questionHashAtSubmit, oldQuestionHash);
  assert.equal(oldPractice.attempt.packageVersionAtStart, '1.0.0');
  assert.equal(oldPractice.attempt.paperHashAtStart, oldPaperHash);

  const second = await services.practiceService.startAttempt({
    ...request,
    packageId: 'synthetic.kaoyan.en1.v2'
  });
  const secondPractice = await services.practiceService.getPractice({ examId: request.examId, attemptId: second.attemptId });
  const secondResponses = secondPractice.questions.map(question =>
    createResponse(second, question.questionKey, { answer: question.questionKey === q21Key ? 'B' : 'A' })
  );
  const secondSubmitted = await services.practiceService.submit({
    examId: request.examId,
    attemptId: second.attemptId,
    responses: secondResponses,
    activeDurationMs: 400
  });
  const revisedResponse = secondSubmitted.responses.find(response => response.questionKey === q21Key);
  assert.equal(revisedResponse.correct, false);
  assert.equal(revisedResponse.correctOptionKeyAtSubmit, 'C');
  assert.notEqual(revisedResponse.questionHashAtSubmit, oldQuestionHash);
  services.db.close();
});
