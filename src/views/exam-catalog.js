import { createExamServices } from '../exam/create-services.js';
import { buildExamCatalog, selectRandomUnit } from '../exam/catalog.mjs';
import { filterVisibleExamPapers, shouldInstallPrivateExamPacks } from '../exam/home-visibility.mjs';
import { getExamBankOptions, resolveExamBankId } from '../exam/bank-selector.mjs';
import { installExamPack } from '../exam/pack-installer.mjs';
import { esc } from '../helpers.js';

const TYPE_META = {
  cloze_choice: { title: '完形填空', subtitle: 'Section I' },
  reading_mcq: { title: '阅读理解', subtitle: 'Section II Part A' },
  paragraph_ordering: { title: '段落排序', subtitle: 'Section II Part B' },
  translation: { title: '翻译', subtitle: 'Section II Part C' }
};

async function installPrivatePacks(services) {
  const response = await fetch('/exam-packs/private/index.json');
  if (!response.ok) return;
  const index = await response.json();
  for (const entry of index.packs || []) {
    const packResponse = await fetch(entry.path);
    if (!packResponse.ok) continue;
    await installExamPack(services.openDb, await packResponse.json());
  }
}

async function loadPapers(services) {
  if (shouldInstallPrivateExamPacks(import.meta.env.MODE)) await installPrivatePacks(services);
  const records = filterVisibleExamPapers(
    await services.contentRepository.listPapers({ examId: 'kaoyan_en1' }),
    { isProduction: import.meta.env.MODE === 'public' }
  );
  return Promise.all(records.map(async record => ({
    ...await services.contentRepository.getFullPaper({ examId: 'kaoyan_en1', bankId: record.bankId, paperKey: record.paperKey }),
    bankId: record.bankId,
    packageId: record.packageId,
    packageVersion: record.packageVersion,
    sourceType: record.sourceType
  })));
}

function unitLabel(unit) {
  if (unit.type === 'cloze_choice') return '完形填空';
  if (unit.type === 'paragraph_ordering') return '段落排序';
  if (unit.type === 'translation') return '翻译';
  return unit.displayTitle ? `阅读理解 ${unit.displayTitle}` : '阅读理解';
}

function unitProgressKey(unit) {
  return `${unit.bankId || ''}:${unit.paperKey}:${unit.unitKey}`;
}

function getUnitProgress(unit, attemptRows) {
  const candidates = attemptRows
    .filter(({ attempt }) => attempt.bankId === unit.bankId && attempt.paperKey === unit.paperKey)
    .map(row => {
      const unitResponses = row.responses.filter(response => (response.unitKey || row.attempt.unitKey) === unit.unitKey);
      const answered = unitResponses.filter(response => Boolean(response?.value?.text?.trim() || response?.answer)).length;
      const total = Math.max(1, unit.questions.length);
      return { ...row, answered: row.attempt.status === 'submitted' ? total : Math.min(answered, total), total };
    })
    .filter(row => row.answered > 0 || row.attempt.status === 'submitted')
    .sort((left, right) => Number(right.attempt.updatedAt || 0) - Number(left.attempt.updatedAt || 0));
  const current = candidates[0];
  if (!current) return { answered: 0, total: unit.questions.length, percent: 0, status: '未开始' };
  return { answered: current.answered, total: current.total, percent: Math.round(current.answered / current.total * 100), status: current.attempt.status === 'submitted' ? '已完成' : '进行中' };
}

function yearProgress(group, progressByUnit) {
  const totals = group.units.reduce((result, unit) => {
    const progress = progressByUnit.get(unitProgressKey(unit)) || { answered: 0, total: unit.questions.length };
    result.answered += progress.answered;
    result.total += progress.total;
    result.inProgress ||= progress.status === '进行中';
    return result;
  }, { answered: 0, total: 0, inProgress: false });
  return { ...totals, status: totals.inProgress ? '进行中' : totals.answered === totals.total && totals.total ? '已完成' : '未开始' };
}

function yearGroupHtml(group, isFirst = false, progressByUnit = new Map()) {
  const summary = yearProgress(group, progressByUnit);
  const units = group.units.map(unit => {
    const progress = progressByUnit.get(unitProgressKey(unit)) || { answered: 0, total: unit.questions.length, percent: 0, status: '未开始' };
    const progressIcon = progress.percent ? 'fa-solid fa-circle-notch is-progress' : 'fa-regular fa-circle';
    return `<button type="button" class="exam-catalog-unit" data-paper="${esc(unit.paperKey)}" data-bank="${esc(unit.bankId || '')}" data-unit="${esc(unit.unitKey)}"><i class="fa-regular fa-file-lines exam-catalog-unit-icon" aria-hidden="true"></i><span><strong>${esc(unitLabel(unit))}</strong></span><em>${unit.questions.length} 题</em><i class="${progressIcon} exam-catalog-unit-progress" aria-label="${esc(progress.status)} ${progress.answered}/${progress.total}" aria-hidden="true"></i><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></button>`;
  }).join('');
  if (group.directStart) {
    return `<section class="exam-year-group exam-year-direct"><div class="exam-year-summary"><strong>${esc(group.year)}</strong><span>${esc(summary.status)}</span><em>${summary.answered} / ${summary.total}</em><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></div><div class="exam-year-units">${units}</div></section>`;
  }
  return `<details class="exam-year-group" ${isFirst ? 'open' : ''}><summary><span><strong>${esc(group.year)}</strong>${summary.status !== '未开始' ? `<small>（${esc(summary.status)}）</small>` : ''}</span><em>${summary.answered} / ${summary.total}</em><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="exam-year-units">${units}</div></details>`;
}

export const ExamCatalogView = {
  cleanup() {
    this._cleanupHandlers?.forEach(remove => remove());
    this._cleanupHandlers = [];
  },

  async render(container, unitType = 'reading_mcq', bankId = null) {
    this.cleanup();
    const services = createExamServices();
    const allPapers = await loadPapers(services);
    const installedBanks = (await services.contentRepository.listBanks({ examId: 'kaoyan_en1' }).catch(() => []))
      .filter(bank => allPapers.some(paper => paper.bankId === bank.bankId));
    const bankOptions = getExamBankOptions(installedBanks, allPapers);
    const attempts = await services.stateRepository.listAttempts({ examId: 'kaoyan_en1' });
    const attemptRows = await Promise.all(attempts.map(async attempt => ({
      attempt,
      responses: await services.stateRepository.getResponses({ examId: 'kaoyan_en1', attemptId: attempt.attemptId })
    })));
    const activeBankId = resolveExamBankId(bankOptions, bankId);
    const papers = allPapers.filter(paper => !activeBankId || paper.bankId === activeBankId);
    const meta = TYPE_META[unitType] || TYPE_META.reading_mcq;
    const catalog = buildExamCatalog(papers, { unitType });
    const units = catalog.flatMap(group => group.units);
    const progressByUnit = new Map(units.map(unit => [unitProgressKey(unit), getUnitProgress(unit, attemptRows)]));
    const overall = catalog.reduce((result, group) => {
      const progress = yearProgress(group, progressByUnit);
      result.answered += progress.answered;
      result.total += progress.total;
      return result;
    }, { answered: 0, total: 0 });
    container.innerHTML = `
      <div class="exam-catalog exam-catalog-screen">
        <label class="exam-bank-picker exam-bank-picker-source"><span class="sr-only">选择题库</span><select id="examCatalogBankPicker" aria-label="选择题库">${bankOptions.map(option => `<option value="${esc(option.bankId)}" ${option.bankId === activeBankId ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${esc(option.label)}${option.disabled ? '（暂未安装）' : ''}</option>`).join('')}</select></label>
        <p class="exam-catalog-progress">已完成 <strong>${overall.answered}</strong> / ${overall.total}</p>
        <div class="exam-catalog-years">
          ${catalog.length ? catalog.map((group, index) => yearGroupHtml(group, index === 0, progressByUnit)).join('') : '<div class="empty-state">暂无可用题组</div>'}
        </div>
        <button type="button" class="exam-random-entry" data-random="true"><i class="fa-solid fa-shuffle" aria-hidden="true"></i>随机训练 · 从当前题型随机开始</button>
        <p class="exam-catalog-hint">点击题目后直接开始练习</p>
      </div>`;

    const handlers = [];
    const add = (target, event, handler) => { target?.addEventListener(event, handler); if (target) handlers.push(() => target.removeEventListener(event, handler)); };
    const startUnit = async unit => {
      const attempt = await services.practiceService.startAttempt({
        examId: 'kaoyan_en1', bankId: unit.bankId, packageId: unit.packageId, paperKey: unit.paperKey, unitKey: unit.unitKey
      });
      location.hash = `#/exam/practice/${attempt.attemptId}`;
    };
    add(container.querySelector('[data-random]'), 'click', async () => {
      const unit = selectRandomUnit(catalog);
      if (unit) await startUnit(unit);
    });
    container.querySelectorAll('[data-unit]').forEach(button => add(button, 'click', async () => {
      const unit = units.find(item => item.paperKey === button.dataset.paper && item.unitKey === button.dataset.unit && (item.bankId || '') === button.dataset.bank);
      if (unit) await startUnit(unit);
    }));
    const bankPicker = container.querySelector('#examCatalogBankPicker');
    const headerActions = document.querySelector('.app-header-actions');
    if (bankPicker && headerActions) {
      headerActions.removeAttribute('aria-hidden');
      headerActions.replaceChildren(bankPicker.closest('label') || bankPicker);
    }
    add(bankPicker, 'change', event => this.render(container, unitType, event.target.value));
    this._cleanupHandlers = handlers;
  }
};
