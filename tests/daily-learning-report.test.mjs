import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyLearningReport,
  buildDailyLearningTrends,
  formatDailyLearningReportMarkdown,
  toDailyReportAgentSummary
} from '../src/daily-learning-report.mjs';

const DATE_KEY = '2026-08-24';
const NOW = new Date(2026, 7, 24, 23, 30).getTime();
const at = (hour, minute = 0) => new Date(2026, 7, 24, hour, minute).getTime();

const cet4Paper = {
  bankId: 'builtin_cet4',
  paperKey: 'cet4-2024',
  year: 2024,
  title: '2024 年 6 月四级',
  examId: 'cet4',
  units: [
    {
      unitKey: 'cloze',
      type: 'matching',
      matchingVariant: 'banked_cloze',
      displayTitle: '选词填空',
      questions: Array.from({ length: 10 }, (_, index) => ({ questionKey: `cloze-${index + 1}`, blankNumber: index + 1 }))
    },
    {
      unitKey: 'long-reading',
      type: 'matching',
      matchingVariant: 'long_reading',
      displayTitle: '长篇阅读',
      questions: [{ questionKey: 'long-1', slotNumber: 1 }]
    },
    {
      unitKey: 'careful-reading',
      type: 'reading_mcq',
      displayTitle: '仔细阅读',
      questions: [{ questionKey: 'careful-1' }]
    },
    {
      unitKey: 'translation',
      type: 'translation',
      displayTitle: '翻译',
      questions: [{ questionKey: 'translation-1', segmentKey: '1' }]
    }
  ]
};

const englishOnePaper = {
  bankId: 'builtin_kaoyan_en1',
  paperKey: 'en1-2024',
  year: 2024,
  title: '2024 英语一',
  examId: 'kaoyan_en1',
  units: [{
    unitKey: 'reading',
    type: 'reading_mcq',
    displayTitle: '阅读理解',
    questions: [{ questionKey: 'en1-1' }]
  }]
};

const attempts = [{
  attemptId: 'cet4-attempt',
  bankId: cet4Paper.bankId,
  paperKey: cet4Paper.paperKey,
  unitKey: 'cloze',
  practiceKind: 'full_paper',
  practiceOrigin: 'normal',
  status: 'submitted',
  submittedAt: at(21)
}, {
  attemptId: 'wrong-review',
  bankId: englishOnePaper.bankId,
  paperKey: englishOnePaper.paperKey,
  unitKey: 'reading',
  practiceKind: 'unit',
  practiceOrigin: 'review_center_due',
  status: 'submitted',
  submittedAt: at(22)
}];

const responsesByAttempt = {
  'cet4-attempt': [
    ...Array.from({ length: 10 }, (_, index) => ({
      questionKey: `cloze-${index + 1}`,
      unitKey: 'cloze',
      correct: index < 7,
      answer: index < 7 ? 'A' : 'B',
      unanswered: false
    })),
    { questionKey: 'long-1', unitKey: 'long-reading', correct: true, answer: 'A', unanswered: false },
    { questionKey: 'careful-1', unitKey: 'careful-reading', correct: false, answer: 'C', unanswered: false },
    { questionKey: 'translation-1', unitKey: 'translation', correct: null, value: { text: '一段译文' }, unanswered: false }
  ],
  'wrong-review': [{ questionKey: 'en1-1', unitKey: 'reading', correct: true, answer: 'A', unanswered: false }]
};

const activities = [
  {
    id: 'import-pdf-new',
    type: 'word_import_daily',
    occurredAt: at(8),
    dayKey: DATE_KEY,
    dedupeKey: 'import-word:2026-08-24:pdfword',
    payload: { lemma: 'pdfword', status: 'new', source: 'pdf' }
  },
  {
    id: 'import-external-1',
    type: 'word_import_daily',
    occurredAt: at(8, 5),
    dayKey: DATE_KEY,
    dedupeKey: 'import-word:2026-08-24:externalone',
    payload: { lemma: 'externalone', status: 'external_review', source: 'pdf', scheduleChanged: true }
  },
  {
    id: 'import-external-2',
    type: 'word_import_daily',
    occurredAt: at(8, 6),
    dayKey: DATE_KEY,
    dedupeKey: 'import-word:2026-08-24:externaltwo',
    payload: { lemma: 'externaltwo', status: 'external_review', source: 'pdf', scheduleChanged: false }
  },
  {
    id: 'import-ignored',
    type: 'word_import_daily',
    occurredAt: at(8, 7),
    dayKey: DATE_KEY,
    dedupeKey: 'import-word:2026-08-24:ignored',
    payload: { lemma: 'ignored', status: 'today_ignored', source: 'pdf' }
  },
  {
    id: 'reading-save',
    type: 'reading_word_saved',
    occurredAt: at(9),
    dayKey: DATE_KEY,
    payload: { lemma: 'readingword', createdLearnWord: true, source: 'reading', articleId: 'article-1' }
  },
  {
    id: 'lookup-1',
    type: 'reading_word_lookup',
    occurredAt: at(9, 1),
    dayKey: DATE_KEY,
    payload: { lemma: 'alpha', articleId: 'article-1', articleTitle: '第一篇' }
  },
  {
    id: 'lookup-2',
    type: 'reading_word_lookup',
    occurredAt: at(9, 2),
    dayKey: DATE_KEY,
    payload: { lemma: 'beta', articleId: 'article-1', articleTitle: '第一篇' }
  },
  {
    id: 'lookup-3',
    type: 'reading_word_lookup',
    occurredAt: at(9, 3),
    dayKey: DATE_KEY,
    payload: { lemma: 'beta', articleId: 'article-1', articleTitle: '第一篇' }
  },
  {
    id: 'reading-session',
    type: 'review_session_summary',
    occurredAt: at(10),
    dayKey: DATE_KEY,
    sessionId: 'flashcard-session',
    dedupeKey: 'review-summary:flashcard-session',
    payload: {
      mode: 'flashcard',
      scope: 'scheduled',
      status: 'completed',
      durationMs: 20 * 60_000,
      counts: { known: 3, uncertain: 1, unknown: 0, skipped: 0 },
      completedWordIds: [1, 2, 3, 4]
    }
  },
  {
    id: 'practice-session',
    type: 'review_session_summary',
    occurredAt: at(11),
    dayKey: DATE_KEY,
    sessionId: 'practice-session',
    dedupeKey: 'review-summary:practice-session',
    payload: {
      mode: 'practice',
      scope: 'targeted',
      status: 'completed',
      durationMs: 10 * 60_000,
      counts: { known: 1, uncertain: 0, unknown: 1, skipped: 0 },
      completedWordIds: [5, 6]
    }
  },
  {
    id: 'exam-slice',
    type: 'exam_active_slice',
    occurredAt: at(21, 10),
    dayKey: DATE_KEY,
    sessionId: 'exam-session',
    payload: {
      attemptId: 'cet4-attempt',
      bankId: cet4Paper.bankId,
      paperKey: cet4Paper.paperKey,
      unitKey: 'cloze',
      type: 'matching',
      matchingVariant: 'banked_cloze',
      practiceKind: 'full_paper',
      practiceOrigin: 'normal',
      startedAt: at(21),
      endedAt: at(21, 12),
      durationMs: 12 * 60_000,
      contextKey: 'matching:banked_cloze'
    }
  }
];

const fixture = {
  dateKey: DATE_KEY,
  articles: [{ id: 'article-1', title: '第一篇', targetTrack: 'cet4' }],
  readingStats: [
    {
      id: 'effective-reading',
      articleId: 'article-1',
      qualificationVersion: 2,
      completed: true,
      wordCount: 500,
      activeSeconds: 30 * 60,
      wpm: 100,
      createdAt: at(7),
      articleSnapshot: { title: '第一篇', targetTrack: 'cet4' }
    },
    {
      id: 'incomplete-reading',
      articleId: 'article-2',
      qualificationVersion: 2,
      completed: false,
      wordCount: 300,
      activeSeconds: 60,
      createdAt: at(6),
      articleSnapshot: { title: '未完成篇' }
    }
  ],
  learnWords: [
    { id: 1, word: 'pdfword', source: 'pdf', createdAt: at(8) },
    { id: 2, word: 'readingword', source: 'reading', createdAt: at(9) }
  ],
  reviewEvents: [
    { id: 'external-event-1', wordId: 3, source: 'external-import', reviewedAt: at(8, 5), reason: 'normal' },
    { id: 'external-event-2', wordId: 4, source: 'external-import', reviewedAt: at(8, 6), reason: 'existing_schedule_later' }
  ],
  activities,
  papers: [cet4Paper, englishOnePaper],
  attempts,
  responsesByAttempt,
  wrongStates: [{ attemptId: 'wrong-review', status: 'active', bankId: englishOnePaper.bankId, paperKey: englishOnePaper.paperKey }],
  translationReviews: [],
  recentReports: [],
  now: NOW
};

const report = buildDailyLearningReport(fixture);

test('aggregates one deterministic local-day report without double counting', () => {
  assert.equal(report.vocabulary.newUnique, 2);
  assert.deepEqual(report.vocabulary.newBySource, { pdf: 1, reading: 1 });
  assert.equal(report.vocabulary.externalReviewed, 2);
  assert.equal(report.vocabulary.lookupCount, 3);
  assert.equal(report.vocabulary.distinctLookups, 2);
  assert.equal(report.reading.completedCount, 1);
  assert.equal(report.coreStudyDurationMs, 72 * 60_000);
});

test('exam breakdown exposes every real type and keeps translation non-objective', () => {
  const types = report.exam.papers.flatMap(paper => paper.types);
  assert.deepEqual(types.map(item => item.key), ['matching:banked_cloze', 'matching:long_reading', 'reading_mcq', 'translation']);
  assert.equal(types[0].accuracy, 70);
  assert.equal(types.at(-1).accuracy, null);
});

test('markdown lists at most one hundred words and states the remainder', () => {
  const reportWithWords = {
    ...report,
    vocabulary: {
      ...report.vocabulary,
      newWords: Array.from({ length: 104 }, (_, index) => `word-${String(index + 1).padStart(3, '0')}`)
    }
  };
  const markdown = formatDailyLearningReportMarkdown(reportWithWords);
  assert.match(markdown, /其余 4 个词未展开/);
  assert.equal((markdown.match(/word-\d{3}/g) || []).length, 100);
});

test('trends keep missing local dates explicit and agent summary bounded', () => {
  const trends = buildDailyLearningTrends([report], { todayKey: DATE_KEY });
  assert.equal(trends.sevenDay.availableDays, 1);
  assert.equal(trends.sevenDay.missingDays.length, 6);
  assert.equal(trends.thirtyDay.length, 30);
  assert.equal(trends.thirtyDay.at(-1).dateKey, DATE_KEY);
  assert.equal(trends.thirtyDay.at(-2).available, false);

  const summary = toDailyReportAgentSummary(report);
  assert.equal(summary.dateKey, DATE_KEY);
  assert.equal(summary.vocabulary.newWords.length <= 100, true);
  assert.doesNotMatch(JSON.stringify(summary), /第一篇|一段译文|question|answer/i);
});

test('markdown uses the fixed seven-section headings and local fallback sentence', () => {
  const markdown = formatDailyLearningReportMarkdown(report);
  assert.match(markdown, /# 英语学习日报｜2026-08-24/);
  for (const heading of ['今日概览', '词汇', '阅读', '单词复习', '真题训练', '近期趋势', '总结与明日建议']) {
    assert.match(markdown, new RegExp(`## ${heading}`));
  }
  assert.match(markdown, /智能分析暂不可用；以上数据由本地学习记录生成。/);
});
