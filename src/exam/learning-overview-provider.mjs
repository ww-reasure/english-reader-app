import { isSyntheticExamPaper } from './home-visibility.mjs';
import { buildExamLearningAnalytics } from './learning-analytics.mjs';
import { SUPPORTED_EXAM_IDS } from './constants.mjs';
import { resolveExamIdForBank } from './exam-context.mjs';

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
    async getOverview({ year = null, bankId = null, recentLimit = 5, wrongLimit = 5 } = {}) {
      const scopedExamIds = bankId
        ? [resolveExamIdForBank(bankId) || 'kaoyan_en1']
        : [...SUPPORTED_EXAM_IDS];
      const [paperGroups, attemptGroups, wrongGroups, translationGroups] = await Promise.all([
        Promise.all(scopedExamIds.map(examId => services.contentRepository.listPapers({ examId }))),
        Promise.all(scopedExamIds.map(examId => services.stateRepository.listAttempts({ examId }))),
        Promise.all(scopedExamIds.map(examId => services.stateRepository.listWrongStates({ examId }))),
        Promise.all(scopedExamIds.map(examId => services.stateRepository.listTranslationReviews({ examId })))
      ]);
      const allPapers = paperGroups.flat();
      const papers = selectLearningPapers(allPapers).filter(paper => !bankId || paper.bankId === bankId);
      const visiblePaperKeys = new Set(papers.map(identity));
      const attempts = attemptGroups.flat().filter(item => visiblePaperKeys.has(identity(item)));
      const wrongStates = wrongGroups.flat().filter(item => visiblePaperKeys.has(identity(item)));
      const translationReviews = translationGroups.flat().filter(item => visiblePaperKeys.has(identity(item)));
      const responseRows = await Promise.all(attempts.map(async attempt => [
        attempt.attemptId,
        await services.stateRepository.getResponses({ examId: attempt.examId, attemptId: attempt.attemptId })
      ]));
      const presentExamIds = [...new Set(papers.map(paper => resolveExamIdForBank(paper.bankId)).filter(Boolean))];
      return buildExamLearningAnalytics({
        papers,
        attempts,
        responsesByAttempt: Object.fromEntries(responseRows),
        wrongStates,
        translationReviews,
        now: now(),
        year,
        examIds: presentExamIds.length ? presentExamIds : scopedExamIds,
        recentLimit,
        wrongLimit
      });
    }
  });
}
