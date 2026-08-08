import { createAttempt, createResponse, submitAttempt } from './attempt-state.mjs';
import { assertOrderingResponses, buildCandidateOrder, buildOptionOrders, createShuffleSeed } from './grading.mjs';
import { hashQuestion } from './pack.mjs';
import { addWrongState, readdMasteredWrongState, scheduleTranslationReview } from './review-scheduler.mjs';

export class ExamPracticeService {
  constructor({ contentRepository, stateRepository, openDb }) {
    this.contentRepository = contentRepository;
    this.stateRepository = stateRepository;
    this.openDb = openDb;
  }

  async startAttempt({
    examId,
    bankId,
    packageId,
    paperKey,
    unitKey,
    mode = 'normal',
    practiceOrigin = mode === 'wrong_review' ? 'result_retry' : 'normal',
    scopeQuestionKeys = null,
    reviewEligibleQuestionKeys = null,
    forceShuffle = false
  }) {
    if (!['normal', 'result_retry', 'review_center_due'].includes(practiceOrigin)) {
      throw new Error('practiceOrigin 无效');
    }
    const paper = await this.contentRepository.getFullPaper({ examId, bankId, paperKey });
    if (!paper) throw new Error('paper 不存在');
    const unit = paper.units.find(item => item.unitKey === unitKey);
    if (!unit) throw new Error(`unit 不存在：${unitKey}`);

    const questionKeys = mode === 'wrong_review'
      ? scopeQuestionKeys || []
      : unit.questions.map(question => question.questionKey);
    const uniqueKeys = [...new Set(questionKeys)];
    const selected = unit.questions.filter(question => uniqueKeys.includes(question.questionKey));
    if (!selected.length) throw new Error('没有可练习的题目');
    if (selected.length !== uniqueKeys.length) throw new Error('scopeQuestionKeys 包含未知题目');

    const priorSubmitted = await this.stateRepository.listAttempts({
      examId,
      bankId,
      paperKey,
      unitKey,
      status: 'submitted'
    });
    const shouldShuffle = forceShuffle || mode === 'wrong_review' || priorSubmitted.length > 0;
    const optionShuffleSeed = shouldShuffle ? createShuffleSeed() : null;
    const optionOrders = unit.type === 'paragraph_ordering' ? null : buildOptionOrders(selected, optionShuffleSeed);
    const candidateOrder = unit.type === 'paragraph_ordering'
      ? buildCandidateOrder(unit.candidates, optionShuffleSeed)
      : null;
    const attempt = createAttempt({
      examId,
      bankId,
      packageId: packageId || paper.packageId,
      paperKey,
      unitKey,
      mode,
      practiceOrigin,
      scopeQuestionKeys: mode === 'wrong_review' ? uniqueKeys : null,
      reviewEligibleQuestionKeys: practiceOrigin === 'review_center_due' ? uniqueKeys : reviewEligibleQuestionKeys,
      questionKeys: uniqueKeys,
      optionOrders,
      candidateOrder,
      optionShuffleSeed,
      packVersion: paper.packageVersion,
      contentHashSnapshot: paper.contentHash
    });
    await this.stateRepository.saveAttempt({ examId, attempt });
    return attempt;
  }

  async startFullPaperAttempt({
    examId,
    bankId,
    packageId,
    paperKey,
    forceShuffle = false
  }) {
    const paper = await this.contentRepository.getFullPaper({ examId, bankId, paperKey });
    if (!paper) throw new Error('paper 不存在');
    const typeOrder = new Map([
      ['cloze_choice', 0],
      ['reading_mcq', 1],
      ['paragraph_ordering', 2],
      ['translation', 3]
    ]);
    const units = (paper.units || [])
      .filter(unit => Array.isArray(unit.questions) && unit.questions.length)
      .map((unit, index) => ({ unit, index }))
      .sort((left, right) => (typeOrder.get(left.unit.type) ?? 99) - (typeOrder.get(right.unit.type) ?? 99) || left.index - right.index)
      .map(item => item.unit);
    if (!units.length) throw new Error('paper 没有可练习的题目');

    const previous = await this.stateRepository.listAttempts({
      examId,
      bankId,
      paperKey,
      status: 'submitted'
    });
    const shouldShuffle = forceShuffle || previous.length > 0;
    const optionShuffleSeed = shouldShuffle ? createShuffleSeed() : null;
    const optionOrders = {};
    const candidateOrders = {};
    const passageScrollAnchors = {};
    for (const unit of units) {
      const selected = unit.questions;
      if (unit.type === 'paragraph_ordering') {
        candidateOrders[unit.unitKey] = buildCandidateOrder(unit.candidates, optionShuffleSeed);
      } else {
        Object.assign(optionOrders, buildOptionOrders(selected, optionShuffleSeed));
      }
      passageScrollAnchors[unit.unitKey] = 0;
    }
    const unitKeys = units.map(unit => unit.unitKey);
    const questionKeys = units.flatMap(unit => unit.questions.map(question => question.questionKey));
    const attempt = createAttempt({
      examId,
      bankId,
      packageId: packageId || paper.packageId,
      paperKey,
      unitKey: unitKeys[0],
      mode: 'normal',
      practiceOrigin: 'normal',
      questionKeys,
      optionOrders,
      candidateOrder: candidateOrders[unitKeys[0]] || null,
      candidateOrders,
      passageScrollAnchors,
      practiceKind: 'full_paper',
      unitKeys,
      unitOrder: unitKeys,
      currentUnitKey: unitKeys[0],
      currentUnitIndex: 0,
      optionShuffleSeed,
      packVersion: paper.packageVersion,
      contentHashSnapshot: paper.contentHash
    });
    await this.stateRepository.saveAttempt({ examId, attempt });
    return attempt;
  }

  async startReviewCenterAttempt({ examId, bankId, packageId, paperKey, unitKey, questionKeys, now = Date.now() }) {
    const dueStates = await this.stateRepository.listDueWrongStates({ examId, bankId, now });
    const dueByKey = new Map(dueStates
      .filter(state => state.paperKey === paperKey && state.unitKey === unitKey)
      .map(state => [state.questionKey, state]));
    const uniqueKeys = [...new Set(questionKeys || [])];
    if (!uniqueKeys.length || uniqueKeys.some(questionKey => !dueByKey.has(questionKey))) {
      throw new Error('选中的题目已不在待复习队列');
    }
    return this.startAttempt({
      examId,
      bankId,
      packageId,
      paperKey,
      unitKey,
      mode: 'wrong_review',
      practiceOrigin: 'review_center_due',
      scopeQuestionKeys: uniqueKeys,
      reviewEligibleQuestionKeys: uniqueKeys,
      forceShuffle: true
    });
  }

  async getPractice({ examId, attemptId }) {
    const attempt = await this.stateRepository.getAttempt({ examId, attemptId });
    if (!attempt) throw new Error(`attempt 不存在：${attemptId}`);
    const paper = await this.contentRepository.getFullPaper({
      examId,
      bankId: attempt.bankId,
      paperKey: attempt.paperKey
    });
    const fullPaper = attempt.practiceKind === 'full_paper';
    const unitKeys = fullPaper ? (attempt.unitKeys || attempt.unitOrder || []) : [attempt.unitKey];
    const units = (paper?.units || []).filter(item => unitKeys.includes(item.unitKey));
    const unit = units.find(item => item.unitKey === (attempt.currentUnitKey || attempt.unitKey)) || units[0];
    if (!unit) throw new Error('attempt 对应的 unit 不存在');
    const responses = await this.stateRepository.getResponses({ examId, attemptId });
    const questionSet = new Set(attempt.questionOrder || []);
    const questions = fullPaper
      ? unitKeys.flatMap(key => units.find(item => item.unitKey === key)?.questions || []).filter(question => !questionSet.size || questionSet.has(question.questionKey))
      : unit.questions;
    return {
      attempt,
      practiceKind: attempt.practiceKind || 'unit',
      paper,
      unit,
      units: fullPaper ? units : [unit],
      responses,
      questions,
      currentQuestions: unit.questions
    };
  }

  async autosave({ examId, attempt, responses, activeDurationMs }) {
    if (attempt.status !== 'in_progress') return attempt;
    const next = {
      ...attempt,
      activeDurationMs: Number(activeDurationMs) || 0,
      updatedAt: Date.now()
    };
    await this.stateRepository.saveAttemptAndResponses({ examId, attempt: next, responses });
    return next;
  }

  async submit({ examId, attemptId, responses, activeDurationMs }) {
    const current = await this.stateRepository.getAttempt({ examId, attemptId });
    if (!current) throw new Error(`attempt 不存在：${attemptId}`);
    if (current.status !== 'in_progress') throw new Error('只有进行中的 attempt 可以提交');
    const practice = await this.getPractice({ examId, attemptId });
    const { unit, units } = practice;
    const unitByQuestion = new Map();
    for (const candidateUnit of units) {
      for (const question of candidateUnit.questions) unitByQuestion.set(question.questionKey, candidateUnit);
    }
    const questionByKey = new Map(practice.questions.map(question => [question.questionKey, question]));
    const responsesWithSnapshots = [];
    for (const response of responses) {
      const question = questionByKey.get(response.questionKey);
      if (!question) throw new Error(`提交包含未知 questionKey：${response.questionKey}`);
      responsesWithSnapshots.push(question.type === 'translation_segment'
        ? { ...response, questionHashAtSubmit: await hashQuestion(question) }
        : {
            ...response,
            correctOptionKeyAtSubmit: question.answer,
            questionHashAtSubmit: await hashQuestion(question)
          });
    }
    for (const candidateUnit of units) {
      if (candidateUnit.type === 'paragraph_ordering') {
        assertOrderingResponses(candidateUnit, responsesWithSnapshots.filter(response => unitByQuestion.get(response.questionKey)?.unitKey === candidateUnit.unitKey));
      }
    }
    const result = submitAttempt({
      attempt: current,
      responses: responsesWithSnapshots,
      questions: practice.questions,
      activeDurationMs
    });
    await this.stateRepository.submitAttemptAtomically({
      examId,
      attempt: result.attempt,
      responses: result.responses
    });
    return result;
  }

  async wrongQuestionKeys({ examId, attemptId }) {
    const responses = await this.stateRepository.getResponses({ examId, attemptId });
    return responses
      .filter(response => response.correct === false && !response.unanswered)
      .map(response => response.questionKey);
  }

  async addWrongQuestions({ examId, attemptId, questionKeys }) {
    const attempt = await this.stateRepository.getAttempt({ examId, attemptId });
    if (!attempt) throw new Error(`attempt 不存在：${attemptId}`);
    const existing = await this.stateRepository.listWrongStates({ examId, bankId: attempt.bankId });
    const responses = await this.stateRepository.getResponses({ examId, attemptId });
    const responseByKey = new Map(responses.map(response => [response.questionKey, response]));
    const existingKeys = new Set(existing.map(item => item.questionKey));
    const now = Date.now();
    for (const questionKey of new Set(questionKeys)) {
      const existingState = existing.find(item => item.questionKey === questionKey);
      if (existingState?.status === 'active') continue;
      const wrongState = existingState
        ? readdMasteredWrongState({ state: existingState, now })
        : addWrongState({ now, attempt: { ...attempt, unitKey: responseByKey.get(questionKey)?.unitKey || attempt.unitKey }, questionKey });
      await this.stateRepository.saveWrongState({ examId, wrongState });
      existingKeys.add(questionKey);
    }
  }

  async addAllWrongFromAttempt({ examId, attemptId }) {
    const wrong = await this.wrongQuestionKeys({ examId, attemptId });
    await this.addWrongQuestions({ examId, attemptId, questionKeys: wrong });
    return wrong;
  }

  async setTranslationReview({ examId, attemptId, questionKey, status }) {
    const attempt = await this.stateRepository.getAttempt({ examId, attemptId });
    if (!attempt) throw new Error(`attempt 不存在：${attemptId}`);
    if (attempt.status !== 'submitted') throw new Error('翻译复习状态只能在提交后设置');
    const practice = await this.getPractice({ examId, attemptId });
    const question = practice.questions.find(item => item.questionKey === questionKey);
    if (!question || question.type !== 'translation_segment') throw new Error('只能为翻译 segment 设置复习状态');
    const existing = await this.stateRepository.getTranslationReview({ examId, bankId: attempt.bankId, questionKey });
    const response = (await this.stateRepository.getResponses({ examId, attemptId })).find(item => item.questionKey === questionKey);
    const review = scheduleTranslationReview({ existing, attempt: { ...attempt, unitKey: response?.unitKey || attempt.unitKey }, questionKey, status, now: Date.now() });
    return this.stateRepository.saveTranslationReview({ examId, review });
  }

  async toggleBookmark({ examId, attempt, questionKey, unitKey = null }) {
    const existing = await this.stateRepository.getBookmark({
      examId,
      bankId: attempt.bankId,
      questionKey
    });
    if (existing) {
      await this.stateRepository.removeBookmark({ examId, bankId: attempt.bankId, questionKey });
      return false;
    }
    const now = Date.now();
    await this.stateRepository.saveBookmark({
      examId,
      bookmark: {
        key: `${attempt.bankId}:${questionKey}`,
        examId,
        bankId: attempt.bankId,
        packageId: attempt.packageId,
        paperKey: attempt.paperKey,
        unitKey: unitKey || attempt.currentUnitKey || attempt.unitKey,
        questionKey,
        createdAt: now,
        updatedAt: now
      }
    });
    return true;
  }

  async listResumableAttempts({ examId }) {
    return this.stateRepository.listAttempts({ examId, status: 'in_progress' });
  }
}

export { createResponse };
