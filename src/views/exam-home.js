import { createExamServices } from '../exam/create-services.js';
import { selectRandomPaper } from '../exam/catalog.mjs';
import { filterVisibleExamPapers, isSyntheticExamPaper, shouldInstallPrivateExamPacks } from '../exam/home-visibility.mjs';
import { getExamBankOptions, resolveExamBankId } from '../exam/bank-selector.mjs';
import { installExamPack } from '../exam/pack-installer.mjs';
import { renderExamBottomNav } from '../exam/bottom-nav.mjs';
import { esc } from '../helpers.js';

const EXAM_ID = 'kaoyan_en1';
const TYPE_CARDS = [
  { type: 'cloze_choice', title: '完形填空', subtitle: 'Section I', icon: 'fa-solid fa-puzzle-piece' },
  { type: 'reading_mcq', title: '阅读理解', subtitle: 'Section II Part A', icon: 'fa-solid fa-book-open' },
  { type: 'paragraph_ordering', title: '段落排序', subtitle: 'Section II Part B', icon: 'fa-solid fa-list' },
  { type: 'translation', title: '翻译', subtitle: 'Section II Part C', icon: 'fa-solid fa-language' }
];

async function installPrivatePacks(services) {
  const response = await fetch('/exam-packs/private/index.json');
  if (!response.ok) return [];
  const index = await response.json();
  const installed = [];
  for (const entry of index.packs || []) {
    const packResponse = await fetch(entry.path);
    if (!packResponse.ok) continue;
    installed.push(await installExamPack(services.openDb, await packResponse.json()));
  }
  return installed;
}

async function loadVisiblePapers(services, records) {
  return Promise.all(records.map(async record => ({
    ...await services.contentRepository.getFullPaper({ examId: EXAM_ID, bankId: record.bankId, paperKey: record.paperKey }),
    bankId: record.bankId,
    packageId: record.packageId,
    packageVersion: record.packageVersion,
    sourceType: record.sourceType
  })));
}

function unitTitle(unit) {
  if (unit?.type === 'cloze_choice') return '完形填空';
  if (unit?.type === 'paragraph_ordering') return '段落排序';
  if (unit?.type === 'translation') return '翻译';
  return unit?.displayTitle ? `阅读理解 ${unit.displayTitle}` : '阅读理解';
}

function isAnswered(response) {
  return Boolean(response?.value?.text?.trim() || response?.answer);
}

async function getAttemptProgress(stateRepository, attempt) {
  const responses = await stateRepository.getResponses({ examId: EXAM_ID, attemptId: attempt.attemptId });
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
    const services = createExamServices();
    if (shouldInstallPrivateExamPacks(import.meta.env.MODE)) await installPrivatePacks(services);
    const [records, banks, attempts] = await Promise.all([
      services.contentRepository.listPapers({ examId: EXAM_ID }),
      services.contentRepository.listBanks({ examId: EXAM_ID }).catch(() => []),
      services.stateRepository.listAttempts({ examId: EXAM_ID })
    ]);
    const visibleRecords = filterVisibleExamPapers(records, { isProduction: import.meta.env.MODE === 'public' });
    const bankOptions = getExamBankOptions(banks, visibleRecords);
    const activeBankId = resolveExamBankId(bankOptions, bankId);
    const papers = await loadVisiblePapers(services, visibleRecords.filter(record => !activeBankId || record.bankId === activeBankId));
    const now = Date.now();
    const [dueWrong, dueTranslations] = await Promise.all([
      services.stateRepository.listDueWrongStates({ examId: EXAM_ID, now }),
      services.stateRepository.listDueTranslationReviews({ examId: EXAM_ID, now })
    ]);
    const dueCount = dueWrong.length + dueTranslations.length;
    const resumable = attempts
      .filter(attempt => attempt.status === 'in_progress' && (!activeBankId || attempt.bankId === activeBankId))
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, 3);
    const paperQuestionCount = papers.reduce((total, paper) => total + paper.units.reduce((sum, unit) => sum + unit.questions.length, 0), 0);

    const resolveAttempt = async attempt => {
      const paper = papers.find(item => item.paperKey === attempt.paperKey && item.bankId === attempt.bankId);
      if (!paper) return { attempt, label: '未知练习' };
      const unit = paper.units.find(item => item.unitKey === (attempt.currentUnitKey || attempt.unitKey));
      return { attempt, paper, unit, label: attempt.practiceKind === 'full_paper' ? `${paper.year} · 整卷练习` : `${paper.year} · ${unitTitle(unit)}`, progress: await getAttemptProgress(services.stateRepository, attempt) };
    };
    const resumableWithLabels = (await Promise.all(resumable.map(resolveAttempt))).filter(item => item.paper);
    const primaryResume = resumableWithLabels[0] || null;
    const recentPaper = primaryResume?.paper || papers[0];
    const recentUnit = primaryResume?.unit || recentPaper?.units.find(item => item.type === 'reading_mcq') || recentPaper?.units[0];
    const recentLabel = primaryResume?.label || (recentPaper ? `${recentPaper.year} · ${unitTitle(recentUnit)}` : '还没有练习记录');

    container.innerHTML = `
      <div class="exam-home exam-dashboard">
        <label class="exam-bank-picker exam-bank-picker-source"><span class="sr-only">选择题库</span><select id="examBankPicker" aria-label="选择题库">${bankOptions.map(option => `<option value="${esc(option.bankId)}" ${option.bankId === activeBankId ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${esc(option.label)}${option.disabled ? '（暂未安装）' : ''}</option>`).join('')}</select></label>
        <section class="exam-dashboard-hero">
          <h1>考研英语一</h1>
          <p>最近练习 <strong>${esc(recentLabel)}</strong></p>
        </section>
        ${primaryResume ? `<button class="exam-resume-card" type="button" data-resume="${esc(primaryResume.attempt.attemptId)}"><span class="exam-progress-ring" aria-label="已完成 ${primaryResume.progress.percent}%"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><b>${primaryResume.progress.percent}%</b></span><span class="exam-resume-copy"><strong>继续练习</strong><small>${esc(primaryResume.unit ? unitTitle(primaryResume.unit).replace(/^阅读理解 /, '阅读理解 ') : '整卷练习')}</small></span><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></button>` : ''}
        <button id="examFullPaperStart" type="button" class="exam-full-paper-card"><i class="fa-regular fa-file-lines exam-card-icon" aria-hidden="true"></i><span><strong>整卷练习</strong><small>全真模拟，完整体验考试节奏</small></span><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></button>
        <section class="exam-special-section">
          <h2>专项训练</h2>
          <div class="exam-special-list">${TYPE_CARDS.map(card => `<a class="exam-special-card" href="#/exam/catalog/${card.type}"><i class="${esc(card.icon)} exam-special-icon" aria-hidden="true"></i><span><strong>${card.title}</strong><small>${card.subtitle}</small></span><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></a>`).join('')}</div>
        </section>
        <a class="exam-review-card" href="#/exam/review"><i class="fa-solid fa-clipboard-list exam-special-icon" aria-hidden="true"></i><span><strong>错题本</strong><small>巩固薄弱，精准提分</small></span><em>${dueCount ? `今日待复习 <b>${dueCount}</b>` : '查看待复习题'} </em><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></a>
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
    add(container.querySelector('#examFullPaperStart'), 'click', async () => {
      const completePapers = papers.filter(paper => !isSyntheticExamPaper(paper) && paper.units?.length > 1);
      const selected = selectRandomPaper(completePapers.length ? completePapers : papers);
      if (!selected) return;
      const attempt = await services.practiceService.startFullPaperAttempt({ examId: EXAM_ID, bankId: selected.bankId, packageId: selected.packageId, paperKey: selected.paperKey });
      location.hash = `#/exam/practice/${attempt.attemptId}`;
    });
    container.querySelectorAll('[data-resume]').forEach(button => add(button, 'click', () => { location.hash = `#/exam/practice/${button.dataset.resume}`; }));
    add(bankPicker, 'change', event => this.render(container, event.target.value));
    this._cleanupHandlers = handlers;
  }
};
