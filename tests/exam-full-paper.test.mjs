import assert from 'node:assert/strict';
import test from 'node:test';
import { ExamPracticeService } from '../src/exam/practice-service.mjs';

const paper = {
  paperKey: 'paper-2026',
  year: 2026,
  packageId: 'pack.2026',
  packageVersion: '1.0.0',
  contentHash: 'sha256:paper',
  units: [
    {
      unitKey: 'cloze-1',
      type: 'cloze_choice',
      displayTitle: '完形填空',
      questions: [{
        questionKey: 'cloze-1-q1',
        type: 'cloze_choice',
        points: 1,
        blankNumber: 1,
        answer: 'B',
        options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }]
      }]
    },
    {
      unitKey: 'reading-1',
      type: 'reading_mcq',
      displayTitle: 'Text 1',
      passage: [{ paragraphKey: 'p1', text: 'A passage.' }],
      questions: [{
        questionKey: 'reading-1-q1',
        type: 'single_choice',
        points: 2,
        stem: 'Question?',
        answer: 'A',
        options: [{ key: 'A', text: 'yes' }, { key: 'B', text: 'no' }]
      }]
    }
  ]
};

function createService() {
  let savedAttempt = null;
  const stateRepository = {
    async listAttempts() { return []; },
    async saveAttempt({ attempt }) { savedAttempt = structuredClone(attempt); },
    async getAttempt() { return savedAttempt; },
    async getResponses() { return []; }
  };
  const contentRepository = {
    async getFullPaper() { return paper; }
  };
  return {
    service: new ExamPracticeService({ contentRepository, stateRepository, openDb: () => null }),
    getSavedAttempt: () => savedAttempt
  };
}

test('full paper attempt flattens all units while preserving unit order and metadata', async () => {
  const { service, getSavedAttempt } = createService();
  const attempt = await service.startFullPaperAttempt({
    examId: 'kaoyan_en1',
    bankId: 'bank.kaoyan.en1',
    packageId: 'pack.2026',
    paperKey: 'paper-2026'
  });

  assert.equal(attempt.practiceKind, 'full_paper');
  assert.deepEqual(attempt.unitKeys, ['cloze-1', 'reading-1']);
  assert.deepEqual(attempt.questionOrder, ['cloze-1-q1', 'reading-1-q1']);
  assert.equal(attempt.currentUnitKey, 'cloze-1');
  assert.equal(attempt.currentUnitIndex, 0);
  assert.deepEqual(getSavedAttempt(), attempt);
});

test('full paper practice returns the current unit and all units for cross-type navigation', async () => {
  const { service } = createService();
  const attempt = await service.startFullPaperAttempt({
    examId: 'kaoyan_en1',
    bankId: 'bank.kaoyan.en1',
    packageId: 'pack.2026',
    paperKey: 'paper-2026'
  });

  const practice = await service.getPractice({ examId: 'kaoyan_en1', attemptId: attempt.attemptId });
  assert.equal(practice.practiceKind, 'full_paper');
  assert.deepEqual(practice.units.map(unit => unit.unitKey), ['cloze-1', 'reading-1']);
  assert.equal(practice.unit.unitKey, 'cloze-1');
  assert.equal(practice.questions.length, 2);
});
