import { createExamServices } from '../exam/create-services.js';
import { createExamTutorService } from '../exam/create-tutor-service.js';
import { ExamTutorDialog } from '../exam/exam-tutor-dialog.js';
import { getExamRenderer } from '../exam/renderers/registry.mjs';
import { SelectableTextActions } from '../exam/selectable-text-actions.mjs';
import { Tooltip } from '../components/tooltip.js';
import { Dictionary } from '../dictionary.js';
import { bindLearningTextLookup } from '../components/reading-word-lookup.js';
import { resolveAttemptExam } from '../exam/exam-context.mjs';
import { esc } from '../helpers.js';

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function markResultLearningTextSurfaces(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-selection-source="option_translations"], [data-selection-source="option_analysis"], [data-selection-source="question_translation"], [data-selection-source="evidence_translation"], [data-selection-source="user_translation"], [data-selection-source="reference_translation"]').forEach(node => node.setAttribute('data-word-lookup', 'disabled'));
  root.querySelectorAll('[data-selection-source="question"]:not(button), [data-selection-source="passage"]:not(button), [data-selection-source="translation_source"]:not(button), [data-selection-source="location"], [data-selection-source="evidence"], [data-selection-source="explanation"], [data-selection-source="local_analysis"]').forEach(node => node.setAttribute('data-learning-text', 'click'));
  root.querySelectorAll('.exam-original-options li').forEach(node => node.setAttribute('data-learning-text', 'longpress'));
}

export const ExamResultView = {
  async lookupSelection(text, rect) {
    const lookupId = Tooltip.beginLookup(rect?.left || 12, rect?.bottom || 12);
    try {
      const data = await Dictionary.lookup(text);
      await Tooltip.show(lookupId, rect?.left || 12, rect?.bottom || 12, data);
    } catch {
      if (Tooltip.isCurrent(lookupId)) Tooltip.hide();
    }
  },

  cleanup() {
    this._wordLookupCleanup?.();
    this._wordLookupCleanup = null;
    this.selectionActions?.destroy();
    this.selectionActions = null;
    this.examTutorDialog?.destroy();
    this.examTutorDialog = null;
    this.examTutor = null;
  },

  async render(container, attemptId) {
    this.cleanup();
    const services = createExamServices();
    const examId = await resolveAttemptExam(services, attemptId) || 'kaoyan_en1';
    const practice = await services.practiceService.getPractice({ examId, attemptId });
    const { attempt, unit, responses, questions } = practice;
    if (attempt.status !== 'submitted') {
      container.innerHTML = '<div class="empty-state">该练习尚未提交</div>';
      return;
    }

    if (attempt.practiceKind === 'full_paper') {
      await this.renderFullPaperResult(container, { services, ...practice });
      return;
    }

    if (unit.type === 'translation') {
      await this.renderTranslationResult(container, { services, attempt, unit, responses, questions });
      return;
    }

    const responseByKey = new Map(responses.map(response => [response.questionKey, response]));
    const wrongKeys = responses
      .filter(response => response.correct === false && !response.unanswered)
      .map(response => response.questionKey);
    const correctCount = responses.filter(response => response.correct).length;
    const total = attempt.questionOrder.length;
    const accuracy = total ? Math.round(correctCount / total * 100) : 0;
    const activeDuration = formatDuration(attempt.activeDurationMs);
    const renderer = getExamRenderer(unit.type);
    const trackedStates = await services.stateRepository.listWrongStates({ examId: attempt.examId, bankId: attempt.bankId });
    const trackedStateByKey = new Map(trackedStates.map(state => [state.questionKey, state]));
    const userChain = unit.type === 'paragraph_ordering'
      ? Array.from({ length: unit.answerSequence.length }, (_, position) => {
          const fixed = unit.fixedPlacements?.find(item => item.position === position);
          if (fixed) return fixed.candidateKey;
          const slot = unit.slots?.find(item => item.position === position);
          return slot ? (responseByKey.get(slot.questionKey)?.answer || '?') : '?';
        })
      : [];

    container.innerHTML = `
      <div class="exam-result">
        <header class="exam-result-summary">
          <p class="page-eyebrow">PRACTICE RESULT</p>
          <h1 class="reading-title">${esc(unit.displayTitle)}</h1>
          <div class="exam-result-metrics">
            <div><strong>${accuracy}%</strong><span>正确率</span></div>
            <div><strong>${correctCount}/${total}</strong><span>正确题数</span></div>
            <div><strong>${activeDuration}</strong><span>有效用时</span></div>
          </div>
          <div class="exam-result-actions">
            <button id="examRedoWhole" class="btn btn-primary" type="button">重做整篇</button>
            <button id="examOpenExplanations" class="btn btn-outline" type="button">查看解析</button>
            <button id="examRedoWrong" class="btn btn-outline" type="button" ${wrongKeys.length ? '' : 'disabled'}>只重做本次错题</button>
            <button id="examAddAllWrong" class="btn btn-outline" type="button" ${wrongKeys.length ? '' : 'disabled'}>将本次所有错题加入错题本</button>
          </div>
          ${unit.type === 'paragraph_ordering' ? `
            <div class="exam-ordering-chain">
              <div><span>你的顺序</span>${userChain.map(key => `<b>${key}</b>`).join('')}</div>
              <div><span>正确顺序</span>${unit.answerSequence.map(key => `<b>${key}</b>`).join('')}</div>
            </div>` : ''}
          ${unit.translation?.length ? `
            <details class="exam-passage-translation">
              <summary>全文翻译</summary>
              ${unit.translation.map(paragraph => `<p>${esc(paragraph.text)}</p>`).join('')}
            </details>` : ''}
        </header>
        <div class="exam-result-filter" role="group" aria-label="题目筛选">
          <button id="examFilterAll" class="btn btn-sm is-active" type="button">全部</button>
          <button id="examFilterWrong" class="btn btn-sm" type="button">错题</button>
        </div>
        <div class="exam-result-list" id="examResultList"></div>
      </div>`;

    this.services = services;
    this.attempt = attempt;
    this.container = container;
    this.responses = responses;
    this.responseByKey = responseByKey;
    this.questions = questions;
    this.renderer = renderer;
    this.wrongKeys = new Set(wrongKeys);
    this.filter = 'all';
    this.examTutor = createExamTutorService();
    this.examTutorDialog = new ExamTutorDialog({ tutorService: this.examTutor });

    const renderList = () => {
      const list = container.querySelector('#examResultList');
      const visible = this.questions.filter(question => {
        const response = responseByKey.get(question.questionKey);
        if (this.filter === 'wrong') return response?.correct === false && !response?.unanswered;
        return true;
      });
      list.innerHTML = visible.map((question, index) => {
        const response = responseByKey.get(question.questionKey);
        const isWrong = response?.correct === false && !response?.unanswered;
        const status = response?.unanswered ? '未答' : response?.correct ? '正确' : '错误';
        const detailId = `examDetail${question.questionKey}`;
        const label = renderer.questionLabel(question, index);
        const stem = ['paragraph_ordering', 'matching'].includes(unit.type)
          ? `${label} 号位置`
          : question.stem || `${label}`;
        const tutorLabel = response?.correct ? '✨ AI分析这道题' : '✨ AI分析我为什么会错';
        const tracked = trackedStateByKey.get(question.questionKey);
        const wrongAction = !isWrong ? '' : !tracked
          ? `<button type="button" class="btn btn-outline btn-sm exam-add-wrong" data-question="${question.questionKey}">加入错题本</button>`
          : tracked.status === 'mastered'
            ? `<button type="button" class="btn btn-outline btn-sm exam-add-wrong" data-question="${question.questionKey}">重新加入复习</button>`
            : '<button type="button" class="btn btn-outline btn-sm" disabled>已在复习</button>';
        return `
          <article class="exam-result-item" data-question="${esc(question.questionKey)}">
            <button type="button" class="exam-result-row" data-detail="${detailId}" aria-expanded="false">
              <span class="exam-result-status ${isWrong ? 'is-wrong' : response?.correct ? 'is-correct' : 'is-unanswered'}">${status}</span>
              <span class="exam-result-stem" data-selection-source="question">${esc(stem)}</span>
              <span class="exam-result-answer" data-selection-source="question">${response?.answer ? `${label} 作答 ${response.answer}` : `${label} 未作答`}</span>
            </button>
            <div class="exam-result-detail" id="${detailId}" hidden>
              ${renderer.resultDetailHtml(question, response, { unit, responses, optionOrder: attempt.optionOrders?.[question.questionKey], candidateOrder: attempt.candidateOrders?.[unit.unitKey] || attempt.candidateOrder, showEvidenceNavigation: false })}
              <button type="button" class="btn btn-outline btn-sm exam-tutor-open" data-question="${question.questionKey}">${tutorLabel}</button>
              ${wrongAction}
            </div>
          </article>`;
      }).join('');
      list.querySelectorAll('.exam-result-row').forEach(row => {
        row.addEventListener('click', () => {
          const detail = container.querySelector(`#${row.dataset.detail}`);
          const expanded = !detail.hidden;
          detail.hidden = expanded;
          row.setAttribute('aria-expanded', String(!expanded));
        });
      });
      list.querySelectorAll('.exam-add-wrong').forEach(button => {
        button.addEventListener('click', async () => {
          await this.services.practiceService.addWrongQuestions({
            examId: attempt.examId,
            attemptId: attempt.attemptId,
            questionKeys: [button.dataset.question]
          });
          const state = await this.services.stateRepository.getWrongState({ examId: attempt.examId, bankId: attempt.bankId, questionKey: button.dataset.question });
          if (state) trackedStateByKey.set(button.dataset.question, state);
          renderList();
        });
      });
      list.querySelectorAll('.exam-tutor-open').forEach(button => {
        button.addEventListener('click', () => {
          const question = this.questions.find(item => item.questionKey === button.dataset.question);
          const response = question ? responseByKey.get(question.questionKey) : null;
          if (question) this.examTutorDialog.open({ attempt, response, question, unit });
        });
      });
      markResultLearningTextSurfaces(list);
      this.selectionActions?.destroy();
      this.selectionActions = new SelectableTextActions({
        root: list,
        onLookup: (text, rect) => this.lookupSelection(text, rect),
        onAskAI: (quote, _rect, selected) => {
          const item = selected?.anchorElement?.closest?.('.exam-result-item');
          const question = item ? this.questions.find(entry => entry.questionKey === item.dataset.question) : null;
          const response = question ? responseByKey.get(question.questionKey) : null;
          if (question && quote) this.examTutorDialog.open({ attempt, response, question, unit, quote });
        }
      });
      this.selectionActions.bind();
    };
    renderList();
    this._wordLookupCleanup = bindLearningTextLookup({ root: container });

    container.querySelector('#examFilterAll').addEventListener('click', () => {
      this.filter = 'all';
      container.querySelector('#examFilterAll').classList.add('is-active');
      container.querySelector('#examFilterWrong').classList.remove('is-active');
      renderList();
    });
    container.querySelector('#examFilterWrong').addEventListener('click', () => {
      this.filter = 'wrong';
      container.querySelector('#examFilterWrong').classList.add('is-active');
      container.querySelector('#examFilterAll').classList.remove('is-active');
      renderList();
    });

    const startRedo = async (mode, scopeQuestionKeys = null) => {
      const newAttempt = await services.practiceService.startAttempt({
        examId: attempt.examId,
        bankId: attempt.bankId,
        packageId: attempt.packageId,
        paperKey: attempt.paperKey,
        unitKey: attempt.unitKey,
        mode,
        practiceOrigin: mode === 'wrong_review' ? 'result_retry' : 'normal',
        scopeQuestionKeys,
        forceShuffle: true
      });
      location.hash = `#/exam/practice/${newAttempt.attemptId}`;
    };
    container.querySelector('#examRedoWhole').addEventListener('click', () => startRedo('normal'));
    container.querySelector('#examOpenExplanations').addEventListener('click', () => {
      location.hash = `#/exam/practice/${attempt.attemptId}/explanation`;
    });
    container.querySelector('#examRedoWrong').addEventListener('click', () => startRedo('wrong_review', wrongKeys));
    container.querySelector('#examAddAllWrong').addEventListener('click', async () => {
      await services.practiceService.addAllWrongFromAttempt({ examId: attempt.examId, attemptId: attempt.attemptId });
      container.querySelector('#examAddAllWrong').disabled = true;
      container.querySelector('#examAddAllWrong').textContent = '已全部加入错题本';
      for (const questionKey of wrongKeys) {
        const state = await services.stateRepository.getWrongState({ examId: attempt.examId, bankId: attempt.bankId, questionKey });
        if (state) trackedStateByKey.set(questionKey, state);
      }
      renderList();
    });
  }
,

  async renderFullPaperResult(container, { services, attempt, paper, units, responses, questions }) {
    const responseByKey = new Map(responses.map(response => [response.questionKey, response]));
    const objective = responses.filter(response => response.correct !== null && response.correct !== undefined);
    const correctCount = objective.filter(response => response.correct).length;
    const wrongKeys = responses.filter(response => response.correct === false && !response.unanswered).map(response => response.questionKey);
    const accuracy = objective.length ? Math.round(correctCount / objective.length * 100) : 0;
    const translations = responses.filter(response => response.unitKey && units.find(unit => unit.unitKey === response.unitKey)?.type === 'translation');
    const trackedStates = await services.stateRepository.listWrongStates({ examId: attempt.examId, bankId: attempt.bankId });
    const trackedStateByKey = new Map(trackedStates.map(state => [state.questionKey, state]));
    const unitByQuestion = new Map(units.flatMap(unit => unit.questions.map(question => [question.questionKey, unit])));
    container.innerHTML = `
      <div class="exam-result exam-full-paper-result">
        <header class="exam-result-summary"><p class="page-eyebrow">FULL PAPER RESULT</p><h1 class="reading-title">${esc(paper.title || `${paper.year} 真题整卷`)}</h1>
          <div class="exam-result-metrics"><div><strong>${accuracy}%</strong><span>客观题正确率</span></div><div><strong>${correctCount}/${objective.length}</strong><span>客观题正确数</span></div><div><strong>${translations.filter(response => response.value?.text?.trim()).length}/${translations.length}</strong><span>翻译完成</span></div><div><strong>${formatDuration(attempt.activeDurationMs)}</strong><span>有效用时</span></div></div>
          <div class="exam-result-actions"><button id="examRedoWhole" class="btn btn-primary" type="button">重做整卷</button><button id="examOpenExplanations" class="btn btn-outline" type="button">查看解析</button><button id="examAddAllWrong" class="btn btn-outline" type="button" ${wrongKeys.length ? '' : 'disabled'}>将本次所有错题加入错题本</button></div>
        </header>
        <div class="exam-result-filter" role="group" aria-label="题目筛选"><button id="examFilterAll" class="btn btn-sm is-active" type="button">全部</button><button id="examFilterWrong" class="btn btn-sm" type="button">错题</button></div>
        <div class="exam-result-list" id="examResultList"></div>
      </div>`;
    this.services = services;
    this.attempt = attempt;
    this.container = container;
    this.questions = questions;
    this.responses = responses;
    this.filter = 'all';
    this.examTutor = createExamTutorService();
    this.examTutorDialog = new ExamTutorDialog({ tutorService: this.examTutor });
    const renderList = () => {
      const list = container.querySelector('#examResultList');
      const visible = questions.filter(question => {
        const response = responseByKey.get(question.questionKey);
        return this.filter !== 'wrong' || (response?.correct === false && !response?.unanswered);
      });
      let lastUnit = null;
      list.innerHTML = visible.map((question, index) => {
        const unit = unitByQuestion.get(question.questionKey);
        const response = responseByKey.get(question.questionKey);
        const renderer = getExamRenderer(unit.type);
        const isWrong = response?.correct === false && !response?.unanswered;
        const status = response?.unanswered ? '未答' : response?.correct ? '正确' : '错误';
        const detailId = `examFullDetail${question.questionKey}`;
        const label = renderer.questionLabel(question, index);
        const tracked = trackedStateByKey.get(question.questionKey);
        const wrongAction = !isWrong ? '' : !tracked
          ? `<button type="button" class="btn btn-outline btn-sm exam-add-wrong" data-question="${esc(question.questionKey)}">加入错题本</button>`
          : tracked.status === 'mastered' ? `<button type="button" class="btn btn-outline btn-sm exam-add-wrong" data-question="${esc(question.questionKey)}">重新加入复习</button>` : '<button type="button" class="btn btn-outline btn-sm" disabled>已在复习</button>';
        const heading = lastUnit !== unit.unitKey ? `<h2 class="exam-result-unit-heading">${esc(unit.displayTitle || unit.type)} · ${esc(paper.year)}</h2>` : '';
        lastUnit = unit.unitKey;
        return `${heading}<article class="exam-result-item" data-question="${esc(question.questionKey)}"><button type="button" class="exam-result-row" data-detail="${detailId}" aria-expanded="false"><span class="exam-result-status ${isWrong ? 'is-wrong' : response?.correct ? 'is-correct' : 'is-unanswered'}">${status}</span><span class="exam-result-stem" data-selection-source="question">${esc(question.stem || label)}</span><span class="exam-result-answer" data-selection-source="question">${response?.answer ? `${label} 作答 ${esc(response.answer)}` : `${label} 未作答`}</span></button><div class="exam-result-detail" id="${detailId}" hidden>${renderer.resultDetailHtml(question, response, { unit, responses, optionOrder: attempt.optionOrders?.[question.questionKey], candidateOrder: attempt.candidateOrders?.[unit.unitKey] || attempt.candidateOrder, showEvidenceNavigation: false })}<button type="button" class="btn btn-outline btn-sm exam-tutor-open" data-question="${esc(question.questionKey)}">✨ AI分析这道题</button>${wrongAction}</div></article>`;
      }).join('');
      list.querySelectorAll('.exam-result-row').forEach(row => row.addEventListener('click', () => {
        const detail = container.querySelector(`#${row.dataset.detail}`);
        const expanded = !detail.hidden;
        detail.hidden = expanded;
        row.setAttribute('aria-expanded', String(!expanded));
      }));
      list.querySelectorAll('.exam-add-wrong').forEach(button => button.addEventListener('click', async () => {
        await services.practiceService.addWrongQuestions({ examId: attempt.examId, attemptId: attempt.attemptId, questionKeys: [button.dataset.question] });
        const state = await services.stateRepository.getWrongState({ examId: attempt.examId, bankId: attempt.bankId, questionKey: button.dataset.question });
        if (state) trackedStateByKey.set(button.dataset.question, state);
        renderList();
      }));
      list.querySelectorAll('.exam-tutor-open').forEach(button => button.addEventListener('click', () => {
        const question = questions.find(item => item.questionKey === button.dataset.question);
        const unit = unitByQuestion.get(button.dataset.question);
        if (question) this.examTutorDialog.open({ attempt, response: responseByKey.get(question.questionKey), question, unit });
      }));
      markResultLearningTextSurfaces(list);
      this.selectionActions?.destroy();
      this.selectionActions = new SelectableTextActions({ root: list, onLookup: (text, rect) => this.lookupSelection(text, rect), onAskAI: (quote, _rect, selected) => {
        const key = selected?.anchorElement?.closest?.('.exam-result-item')?.dataset.question;
        const question = questions.find(item => item.questionKey === key);
        const unit = unitByQuestion.get(key);
        if (question && quote) this.examTutorDialog.open({ attempt, response: responseByKey.get(key), question, unit, quote });
      }});
      this.selectionActions.bind();
    };
    renderList();
    this._wordLookupCleanup = bindLearningTextLookup({ root: container });
    container.querySelector('#examFilterAll').addEventListener('click', () => { this.filter = 'all'; container.querySelector('#examFilterAll').classList.add('is-active'); container.querySelector('#examFilterWrong').classList.remove('is-active'); renderList(); });
    container.querySelector('#examFilterWrong').addEventListener('click', () => { this.filter = 'wrong'; container.querySelector('#examFilterWrong').classList.add('is-active'); container.querySelector('#examFilterAll').classList.remove('is-active'); renderList(); });
    container.querySelector('#examRedoWhole').addEventListener('click', async () => {
      const next = await services.practiceService.startFullPaperAttempt({ examId: attempt.examId, bankId: attempt.bankId, packageId: attempt.packageId, paperKey: attempt.paperKey, forceShuffle: true });
      location.hash = `#/exam/practice/${next.attemptId}`;
    });
    container.querySelector('#examOpenExplanations').addEventListener('click', () => { location.hash = `#/exam/practice/${attempt.attemptId}/explanation`; });
    container.querySelector('#examAddAllWrong').addEventListener('click', async () => { await services.practiceService.addAllWrongFromAttempt({ examId: attempt.examId, attemptId: attempt.attemptId }); renderList(); });
  },

  async renderTranslationResult(container, { services, attempt, unit, responses, questions }) {
    const responseByKey = new Map(responses.map(response => [response.questionKey, response]));
    const completed = questions.filter(question => responseByKey.get(question.questionKey)?.value?.text?.trim()).length;
    const activeDuration = formatDuration(attempt.activeDurationMs);
    container.innerHTML = `
      <div class="exam-result exam-translation-result">
        <header class="exam-result-summary">
          <p class="page-eyebrow">PRACTICE RESULT</p>
          <h1 class="reading-title">${esc(unit.displayTitle || '翻译')}</h1>
          <div class="exam-result-metrics">
            <div><strong>${completed}/${questions.length}</strong><span>已完成</span></div>
            <div><strong>${activeDuration}</strong><span>有效用时</span></div>
          </div>
          <div class="exam-result-actions">
            <button id="examRedoWhole" class="btn btn-primary" type="button">重做整篇</button>
            <button id="examOpenExplanations" class="btn btn-outline" type="button">查看翻译解析</button>
          </div>
          ${unit.translation?.length ? `<details class="exam-passage-translation"><summary>显示全文翻译</summary>${unit.translation.map(paragraph => `<p>${esc(paragraph.text)}</p>`).join('')}</details>` : ''}
        </header>
        <div class="exam-result-list" id="examResultList"></div>
      </div>`;
    const list = container.querySelector('#examResultList');
    list.innerHTML = questions.map((question, index) => {
      const response = responseByKey.get(question.questionKey);
      const label = `第 ${String(question.segmentKey || '').replace(/^S/i, '') || index + 1} 处`;
      return `<article class="exam-result-item" data-question="${esc(question.questionKey)}"><div class="exam-result-row"><span class="exam-result-status">${response?.value?.text?.trim() ? '已填写' : '未填写'}</span><span class="exam-result-stem">${esc(label)}</span></div><div class="exam-result-detail" data-learning-text="click">${esc(question.sourceText)}</div></article>`;
    }).join('');
    this.services = services;
    this.attempt = attempt;
    this.container = container;
    this._wordLookupCleanup = bindLearningTextLookup({ root: container });
    container.querySelector('#examRedoWhole').addEventListener('click', async () => {
      const next = await services.practiceService.startAttempt({ examId: attempt.examId, bankId: attempt.bankId, packageId: attempt.packageId, paperKey: attempt.paperKey, unitKey: attempt.unitKey, forceShuffle: true });
      location.hash = `#/exam/practice/${next.attemptId}`;
    });
    container.querySelector('#examOpenExplanations').addEventListener('click', () => {
      location.hash = `#/exam/practice/${attempt.attemptId}/explanation`;
    });
  }
};
