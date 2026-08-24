import { createExamServices } from '../exam/create-services.js';
import { filterVisibleExamPapers, shouldInstallPrivateExamPacks } from '../exam/home-visibility.mjs';
import { getExamBankOptions, resolveExamBankId } from '../exam/bank-selector.mjs';
import { installPrivateExamPacks } from '../exam/private-pack-loader.mjs';
import { renderExamBottomNav } from '../exam/bottom-nav.mjs';
import { SUPPORTED_EXAM_IDS } from '../exam/constants.mjs';
import { examDisplayName, listAcrossExams, persistActiveBankId, readActiveBankId, resolveExamIdForBank, unitLabel } from '../exam/exam-context.mjs';
import { esc } from '../helpers.js';

const TYPE_CARDS_BY_EXAM = {
  kaoyan_en1: [
    { type: 'cloze_choice', title: '完形填空', subtitle: 'Section I', icon: 'fa-solid fa-puzzle-piece' },
    { type: 'reading_mcq', title: '阅读理解', subtitle: 'Section II Part A', icon: 'fa-solid fa-book-open' },
    { type: 'part_b', title: '阅读新题型 Part B', subtitle: '排序 · 插入 · 匹配', icon: 'fa-solid fa-list' },
    { type: 'translation', title: '翻译', subtitle: 'Section II Part C', icon: 'fa-solid fa-language' }
  ],
  cet4: [
    { type: 'banked_cloze', title: '选词填空', subtitle: 'Section A · 15 选 10', icon: 'fa-solid fa-puzzle-piece' },
    { type: 'long_reading', title: '长篇阅读', subtitle: 'Section B · 信息匹配', icon: 'fa-solid fa-list' },
    { type: 'section_c', title: '仔细阅读', subtitle: 'Section C · 四选一', icon: 'fa-solid fa-book-open' },
    { type: 'translation', title: '翻译', subtitle: 'Part IV · 汉译英', icon: 'fa-solid fa-language' }
  ]
};

async function loadVisiblePapers(services, records) {
  return Promise.all(records.map(async record => {
    const examId = resolveExamIdForBank(record.bankId) || 'kaoyan_en1';
    return {
      ...await services.contentRepository.getFullPaper({ examId, bankId: record.bankId, paperKey: record.paperKey }),
      bankId: record.bankId,
      packageId: record.packageId,
      packageVersion: record.packageVersion,
      sourceType: record.sourceType
    };
  }));
}

function isAnswered(response) {
  return Boolean(response?.value?.text?.trim() || response?.answer);
}

async function getAttemptProgress(stateRepository, attempt) {
  const examId = attempt.examId || resolveExamIdForBank(attempt.bankId) || 'kaoyan_en1';
  const responses = await stateRepository.getResponses({ examId, attemptId: attempt.attemptId });
  const total = Math.max(1, (attempt.questionOrder || []).length);
  const answered = responses.filter(isAnswered).length;
  return {
    answered: Math.min(answered, total),
    total,
    percent: attempt.status === 'submitted' ? 100 : Math.round(answered / total * 100)
  };
}

export const ExamHomeView = {
  cleanup() {
    this._cleanupHandlers?.forEach(remove => remove());
    this._cleanupHandlers = [];
  },

  async render(container, bankId = null) {
    this.cleanup();
    container.innerHTML = '<div class="exam-loading-state" role="status"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>正在准备真题…</span></div>';
    const services = createExamServices();
    const packLoad = shouldInstallPrivateExamPacks(import.meta.env.MODE)
      ? await installPrivateExamPacks({ openDb: services.openDb })
      : { installed: [], failures: [] };
    const [records, banks, attempts] = await Promise.all([
      listAcrossExams(examId => services.contentRepository.listPapers({ examId })),
      listAcrossExams(examId => services.contentRepository.listBanks({ examId })),
      listAcrossExams(examId => services.stateRepository.listAttempts({ examId }))
    ]);
    const visibleRecords = filterVisibleExamPapers(records, { isProduction: import.meta.env.MODE === 'public' });
    const bankOptions = getExamBankOptions(banks, visibleRecords);
    const requestedBank = bankId || readActiveBankId();
    const activeBankId = resolveExamBankId(bankOptions, requestedBank);
    const activeOption = bankOptions.find(option => option.bankId === activeBankId);
    const activeBankLabel = String(activeOption?.label || '考研英语一');
    const activeExamId = resolveExamIdForBank(activeBankId) || 'kaoyan_en1';
    const papers = await loadVisiblePapers(services, visibleRecords.filter(record => !activeBankId || record.bankId === activeBankId));
    const now = Date.now();
    const dueRows = await listAcrossExams(examId => Promise.all([
      services.stateRepository.listDueWrongStates({ examId, now }),
      services.stateRepository.listDueTranslationReviews({ examId, now })
    ]).then(([wrong, translations]) => [...wrong, ...translations]));
    const dueCount = dueRows.filter(state => !activeBankId || state.bankId === activeBankId).length;
    const resumable = attempts
      .filter(attempt => attempt.status === 'in_progress' && (!activeBankId || attempt.bankId === activeBankId))
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 3);
    const resolveAttempt = async attempt => {
      const paper = papers.find(item => item.paperKey === attempt.paperKey && item.bankId === attempt.bankId);
      if (!paper) return { attempt, label: '未知练习' };
      const unit = paper.units.find(item => item.unitKey === (attempt.currentUnitKey || attempt.unitKey));
      const examId = attempt.examId || resolveExamIdForBank(attempt.bankId) || 'kaoyan_en1';
      const label = attempt.practiceKind === 'full_paper' ? `${paper.year} · 整卷练习` : `${paper.year} · ${unitLabel(unit, { examId })}`;
      return { attempt, paper, unit, label, progress: await getAttemptProgress(services.stateRepository, attempt) };
    };
    const resumableWithLabels = (await Promise.all(resumable.map(resolveAttempt))).filter(item => item.paper);
    const primaryResume = resumableWithLabels[0] || null;
    const recentPaper = primaryResume?.paper || papers[0];
    const recentUnit = primaryResume?.unit || recentPaper?.units.find(item => item.type === 'reading_mcq') || recentPaper?.units[0];
    const recentLabel = primaryResume?.label || (recentPaper ? `${recentPaper.year} · ${unitLabel(recentUnit, { examId: activeExamId })}` : '还没有练习记录');
    const typeCards = TYPE_CARDS_BY_EXAM[activeExamId] || TYPE_CARDS_BY_EXAM.kaoyan_en1;

    container.innerHTML = `
      <div class="exam-home exam-dashboard">
        <label class="exam-bank-switcher exam-bank-picker-source" title="切换题库">
          <i class="fa-solid fa-book-open exam-bank-switcher-icon" aria-hidden="true"></i>
          <span class="exam-bank-switcher-copy"><small>题库</small><strong class="exam-bank-switcher-value">${esc(activeBankLabel)}</strong></span>
          <i class="fa-solid fa-chevron-down exam-bank-switcher-chevron" aria-hidden="true"></i>
          <select id="examBankPicker" aria-label="选择题库">${bankOptions.map(option => `<option value="${esc(option.bankId)}" ${option.bankId === activeBankId ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${esc(option.label)}${option.disabled ? '（暂未安装）' : ''}</option>`).join('')}</select>
        </label>
        <section class="exam-dashboard-hero">
          <h1>${esc(examDisplayName(activeExamId, activeBankId))}</h1>
          <p>最近练习 <strong>${esc(recentLabel)}</strong></p>
        </section>
        ${packLoad.failures.length ? `<p class="exam-pack-warning" role="status">部分真题包未更新，仍可使用已安装内容。<button class="btn btn-outline btn-sm" type="button" data-retry-private-packs>重试</button></p>` : ''}
        ${primaryResume ? `<button class="exam-resume-card" type="button" data-resume="${esc(primaryResume.attempt.attemptId)}"><span class="exam-progress-ring" aria-label="已完成 ${primaryResume.progress.percent}%"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><b>${primaryResume.progress.percent}%</b></span><span class="exam-resume-copy"><strong>继续练习</strong><small>${esc(primaryResume.unit ? unitLabel(primaryResume.unit, { examId: activeExamId }) : '整卷练习')}</small></span><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></button>` : ''}
        <a class="exam-full-paper-card" href="#/exam/catalog/full_paper"><i class="fa-regular fa-file-lines exam-card-icon" aria-hidden="true"></i><span><strong>整卷练习</strong><small>全真模拟，完整体验考试节奏</small></span><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></a>
        <section class="exam-special-section">
          <h2>专项训练</h2>
          <div class="exam-special-list">${typeCards.map(card => `<a class="exam-special-card" href="#/exam/catalog/${card.type}"><i class="${esc(card.icon)} exam-special-icon" aria-hidden="true"></i><span><strong>${card.title}</strong><small>${card.subtitle}</small></span><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></a>`).join('')}</div>
        </section>
        <a class="exam-review-card" href="#/exam/review"><i class="fa-solid fa-clipboard-list exam-special-icon" aria-hidden="true"></i><span><strong>错题本</strong><small>巩固薄弱，精准提分</small></span><em>${dueCount ? `待复习 <b>${dueCount}</b>` : '查看待复习题'} </em><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></a>
         ${renderExamBottomNav('exam')}
      </div>`;

    const handlers = [];
    const add = (target, event, handler) => { target?.addEventListener(event, handler); if (target) handlers.push(() => target.removeEventListener(event, handler)); };
    const bankPicker = container.querySelector('#examBankPicker');
    const headerActions = document.querySelector('.app-header-actions');
    if (bankPicker && headerActions) {
      headerActions.removeAttribute('aria-hidden');
      headerActions.replaceChildren(bankPicker.closest('label') || bankPicker);
    }
    container.querySelectorAll('[data-resume]').forEach(button => add(button, 'click', () => { location.hash = `#/exam/practice/${button.dataset.resume}`; }));
    add(container.querySelector('[data-retry-private-packs]'), 'click', () => this.render(container, bankId));
    add(bankPicker, 'change', event => { persistActiveBankId(event.target.value); this.render(container, event.target.value); });
    this._cleanupHandlers = handlers;
  }
};
