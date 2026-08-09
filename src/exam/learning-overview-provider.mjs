import { isSyntheticExamPaper } from './home-visibility.mjs';
import { buildExamLearningAnalytics } from './learning-analytics.mjs';

const EXAM_ID = 'kaoyan_en1';
const identity = value => `${value?.bankId || ''}:${value?.paperKey || ''}`;

function selectLearningPapers(records) {
  const rows = Array.isArray(records) ? records : [];
  const real = rows.filter(record => !isSyntheticExamPaper(record));
  return real.length ? real : rows;
}

export function createExamLearningOverviewProvider({ services, now = () => Date.now() } = {}) {
  if (!services?.contentRepository || !services?.stateRepository) {
    throw new TypeError('真题学习概览需要 contentRepository 和 stateRepository');
  }
  return Object.freeze({
    async getOverview({ year = null, recentLimit = 5, wrongLimit = 5 } = {}) {
      const [allPapers, allAttempts, allWrongStates, allTranslationReviews] = await Promise.all([
        services.contentRepository.listPapers({ examId: EXAM_ID }),
        services.stateRepository.listAttempts({ examId: EXAM_ID }),
        services.stateRepository.listWrongStates({ examId: EXAM_ID }),
        services.stateRepository.listTranslationReviews({ examId: EXAM_ID })
      ]);
      const papers = selectLearningPapers(allPapers);
      const visiblePaperKeys = new Set(papers.map(identity));
      const attempts = allAttempts.filter(item => visiblePaperKeys.has(identity(item)));
      const wrongStates = allWrongStates.filter(item => visiblePaperKeys.has(identity(item)));
      const translationReviews = allTranslationReviews.filter(item => visiblePaperKeys.has(identity(item)));
      const responseRows = await Promise.all(attempts.map(async attempt => [
        attempt.attemptId,
        await services.stateRepository.getResponses({ examId: EXAM_ID, attemptId: attempt.attemptId })
      ]));
      return buildExamLearningAnalytics({
        papers,
        attempts,
        responsesByAttempt: Object.fromEntries(responseRows),
        wrongStates,
        translationReviews,
        now: now(),
        year,
        recentLimit,
        wrongLimit
      });
    }
  });
}
