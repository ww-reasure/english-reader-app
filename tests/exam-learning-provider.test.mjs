import assert from 'node:assert/strict';
import test from 'node:test';

import { createExamLearningOverviewProvider } from '../src/exam/learning-overview-provider.mjs';

test('loads exam state read-only and prefers real papers over synthetic QA content', async () => {
  const calls = [];
  const attempts = [
    { attemptId: 'real', bankId: 'real-bank', paperKey: 'real-paper', unitKey: 'u1', status: 'submitted', practiceOrigin: 'normal', submittedAt: 10, updatedAt: 10 },
    { attemptId: 'synthetic', bankId: 'synthetic-bank', paperKey: 'synthetic-paper', unitKey: 'u2', status: 'submitted', practiceOrigin: 'normal', submittedAt: 20, updatedAt: 20 }
  ];
  const services = {
    contentRepository: {
      listPapers: async input => {
        calls.push(['listPapers', input]);
        return [
          { bankId: 'real-bank', paperKey: 'real-paper', year: 2026, sourceType: 'past_exam', packageId: 'local.kaoyan.en1', content: { bankId: 'real-bank', paperKey: 'real-paper', year: 2026, units: [{ unitKey: 'u1', type: 'reading_mcq', questions: [{ questionKey: 'q1' }] }] } },
          { bankId: 'synthetic-bank', paperKey: 'synthetic-paper', year: 2026, sourceType: 'synthetic', packageId: 'synthetic.kaoyan.en1', content: { bankId: 'synthetic-bank', paperKey: 'synthetic-paper', year: 2026, units: [{ unitKey: 'u2', type: 'reading_mcq', questions: [{ questionKey: 'q2' }] }] } }
        ];
      }
    },
    stateRepository: {
      listAttempts: async input => { calls.push(['listAttempts', input]); return input.examId === 'kaoyan_en1' ? attempts : []; },
      getResponses: async ({ attemptId }) => [{ questionKey: attemptId === 'real' ? 'q1' : 'q2', unitKey: attemptId === 'real' ? 'u1' : 'u2', correct: true }],
      listWrongStates: async input => { calls.push(['listWrongStates', input]); return []; },
      listTranslationReviews: async input => { calls.push(['listTranslationReviews', input]); return []; }
    }
  };
  const provider = createExamLearningOverviewProvider({ services, now: () => 100 });
  const result = await provider.getOverview();

  assert.equal(result.totals.completedAttempts, 1);
  assert.equal(result.recentAttempts[0].attemptId, 'real');
  assert.deepEqual(calls.filter(([name]) => name !== 'getResponses').filter(([, input]) => input.examId === 'kaoyan_en1'), [
    ['listPapers', { examId: 'kaoyan_en1' }],
    ['listAttempts', { examId: 'kaoyan_en1' }],
    ['listWrongStates', { examId: 'kaoyan_en1' }],
    ['listTranslationReviews', { examId: 'kaoyan_en1' }]
  ]);
  assert.ok(calls.some(([name, input]) => name === 'listPapers' && input.examId === 'cet4'));
});

test('forwards an explicit year without installing or mutating exam content', async () => {
  const services = {
    contentRepository: { listPapers: async () => [{ bankId: 'builtin_kaoyan_en1', paperKey: 'p', year: 2025, content: { bankId: 'builtin_kaoyan_en1', paperKey: 'p', year: 2025, units: [] } }] },
    stateRepository: {
      listAttempts: async () => [],
      getResponses: async () => [],
      listWrongStates: async () => [],
      listTranslationReviews: async () => []
    }
  };
  const provider = createExamLearningOverviewProvider({ services });
  const result = await provider.getOverview({ year: 2024 });
  assert.equal(result.status, 'year_unavailable');
  assert.deepEqual(result.scope, { examIds: ['kaoyan_en1'], year: 2024 });
  assert.equal('openDb' in services, false);
});

test('scopes overview by bank id without mutating state', async () => {
  const calls = [];
  const services = {
    contentRepository: {
      listPapers: async input => {
        calls.push(['listPapers', input]);
        if (input.examId === 'cet4') return [{ bankId: 'builtin_cet4', paperKey: 'cet4-2025', year: 2025, sourceType: 'past_exam', packageId: 'local.cet4', content: { bankId: 'builtin_cet4', paperKey: 'cet4-2025', year: 2025, units: [{ unitKey: 'u1', type: 'matching', matchingVariant: 'long_reading', questions: [{ questionKey: 'q1' }] }] } }];
        return [{ bankId: 'builtin_kaoyan_en1', paperKey: 'kaoyan-2025', year: 2025, sourceType: 'past_exam', packageId: 'local.kaoyan.en1', content: { bankId: 'builtin_kaoyan_en1', paperKey: 'kaoyan-2025', year: 2025, units: [{ unitKey: 'u2', type: 'reading_mcq', questions: [{ questionKey: 'q2' }] }] } }];
      }
    },
    stateRepository: {
      listAttempts: async input => {
        calls.push(['listAttempts', input]);
        return input.examId === 'cet4'
          ? [{ attemptId: 'cet4-attempt', examId: 'cet4', bankId: 'builtin_cet4', paperKey: 'cet4-2025', unitKey: 'u1', status: 'submitted', practiceOrigin: 'normal', submittedAt: 10, updatedAt: 10 }]
          : [{ attemptId: 'kaoyan-attempt', examId: 'kaoyan_en1', bankId: 'builtin_kaoyan_en1', paperKey: 'kaoyan-2025', unitKey: 'u2', status: 'submitted', practiceOrigin: 'normal', submittedAt: 20, updatedAt: 20 }];
      },
      getResponses: async ({ attemptId }) => attemptId === 'cet4-attempt'
        ? [{ questionKey: 'q1', unitKey: 'u1', correct: true }]
        : [{ questionKey: 'q2', unitKey: 'u2', correct: false }],
      listWrongStates: async input => { calls.push(['listWrongStates', input]); return []; },
      listTranslationReviews: async input => { calls.push(['listTranslationReviews', input]); return []; }
    }
  };
  const provider = createExamLearningOverviewProvider({ services, now: () => 100 });
  const result = await provider.getOverview({ bankId: 'builtin_cet4' });
  assert.equal(result.totals.completedAttempts, 1);
  assert.equal(result.recentAttempts[0].attemptId, 'cet4-attempt');
  assert.deepEqual(result.scope.examIds, ['cet4']);
  assert.equal(result.byType[0].label, '长篇阅读');
  assert.ok(!calls.some(([name, input]) => name === 'listAttempts' && input.examId === 'kaoyan_en1'));
});
