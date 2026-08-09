import { createExamServices } from '../exam/create-services.js';
import { buildExamCatalog, selectRandomPaper, selectRandomUnit } from '../exam/catalog.mjs';
import { filterVisibleExamPapers, isSyntheticExamPaper, shouldInstallPrivateExamPacks } from '../exam/home-visibility.mjs';
import { getExamBankOptions, resolveExamBankId } from '../exam/bank-selector.mjs';
import { installExamPack } from '../exam/pack-installer.mjs';
import { esc } from '../helpers.js';

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

function unitHtml(unit, progressByUnit) {
  const progress = progressByUnit.get(unitProgressKey(unit)) || { answered: 0, total: unit.questions.length, percent: 0, status: '未开始' };
  const progressIcon = progress.percent ? 'fa-solid fa-circle-notch is-progress' : 'fa-regular fa-circle';
  return `<button type="button" class="exam-catalog-unit" data-paper="${esc(unit.paperKey)}" data-bank="${esc(unit.bankId || '')}" data-unit="${esc(unit.unitKey)}"><i class="fa-regular fa-file-lines exam-catalog-unit-icon" aria-hidden="true"></i><span><strong>${esc(unitLabel(unit))}</strong></span><em>${unit.questions.length} 题</em><i class="${progressIcon} exam-catalog-unit-progress" aria-label="${esc(progress.status)} ${progress.answered}/${progress.total}" aria-hidden="true"></i><i class="fa-solid fa-chevron-right exam-card-arrow" aria-hidden="true"></i></button>`;
}

function fullPaperUnitLabel(unit) {
  if (unit.type === 'cloze_choice') return 'Section I · 完形填空';
  if (unit.type === 'paragraph_ordering') return 'Section II Part B · 段落排序';
  if (unit.type === 'translation') return 'Section II Part C · 翻译';
  return `Section II · ${unit.displayTitle || '阅读理解'}`;
}

function fullPaperUnitHtml(unit) {
  return `<div class="exam-catalog-unit exam-catalog-unit--summary"><i class="fa-regular fa-file-lines exam-catalog-unit-icon" aria-hidden="true"></i><span><strong>${esc(fullPaperUnitLabel(unit))}</strong></span></div>`;
}

function yearGroupHtml(group, { fullPaper = false, progressByUnit = new Map() } = {}) {
  const units = group.units.map(unit => fullPaper ? fullPaperUnitHtml(unit) : unitHtml(unit, progressByUnit)).join('');
  const directLabel = fullPaper ? '整卷' : '练习';
  if (group.directStart) {
    if (fullPaper) {
      return `<button type="button" class="exam-year-direct-button exam-year-group" data-paper-start="${esc(group.paperKey)}" data-bank="${esc(group.bankId || '')}" aria-label="开始 ${esc(group.year)} 年${directLabel}"><strong>${esc(group.year)}</strong><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`;
    }
    const unit = group.units[0];
    return `<button type="button" class="exam-year-direct-button exam-year-group" data-paper="${esc(unit.paperKey)}" data-bank="${esc(unit.bankId || '')}" data-unit="${esc(unit.unitKey)}" aria-label="开始 ${esc(group.year)} 年${directLabel}"><strong>${esc(group.year)}</strong><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`;
  }
  const expanded = fullPaper
    ? `<div class="exam-paper-start-row"><div><strong>${esc(group.year)} 整卷练习</strong><small>完整试卷</small></div><button type="button" class="exam-paper-start-button" data-paper-start="${esc(group.paperKey)}" data-bank="${esc(group.bankId || '')}">开始练习</button></div><div class="exam-year-units exam-year-paper-units">${units}</div>`
    : `<div class="exam-year-units">${units}</div>`;
  return `<details class="exam-year-group"><summary data-year="${esc(group.year)}"><span><strong>${esc(group.year)}</strong></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>${expanded}</details>`;
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
    const fullPaper = unitType === 'full_paper';
    const catalog = buildExamCatalog(papers, { unitType: fullPaper ? null : unitType, kind: fullPaper ? 'full_paper' : 'unit' });
    const units = catalog.flatMap(group => group.units);
    const progressByUnit = new Map(units.map(unit => [unitProgressKey(unit), getUnitProgress(unit, attemptRows)]));
    container.innerHTML = `
      <div class="exam-catalog exam-catalog-screen">
        <p class="exam-catalog-hint exam-catalog-intro">${fullPaper ? '选择年份查看整卷内容' : '选择年份查看题目'}</p>
        <div class="exam-catalog-years">
          ${catalog.length ? catalog.map(group => yearGroupHtml(group, { fullPaper, progressByUnit })).join('') : '<div class="empty-state">暂无可用题组</div>'}
        </div>
        <button type="button" class="exam-random-entry" data-random="true"><i class="fa-solid fa-shuffle" aria-hidden="true"></i>${fullPaper ? '随机整卷' : '随机训练 · 从当前题型随机开始'}</button>
        <p class="exam-catalog-hint">${fullPaper ? '展开年份后开始整卷练习' : '单个题组会直接进入练习'}</p>
      </div>`;

    const handlers = [];
    const add = (target, event, handler) => { target?.addEventListener(event, handler); if (target) handlers.push(() => target.removeEventListener(event, handler)); };
    const startUnit = async unit => {
      const attempt = await services.practiceService.startAttempt({
        examId: 'kaoyan_en1', bankId: unit.bankId, packageId: unit.packageId, paperKey: unit.paperKey, unitKey: unit.unitKey
      });
      location.hash = `#/exam/practice/${attempt.attemptId}`;
    };
    const startPaper = async paper => {
      const attempt = await services.practiceService.startFullPaperAttempt({
        examId: 'kaoyan_en1', bankId: paper.bankId, packageId: paper.packageId, paperKey: paper.paperKey
      });
      location.hash = `#/exam/practice/${attempt.attemptId}`;
    };
    add(container.querySelector('[data-random]'), 'click', async () => {
      if (fullPaper) {
        const completePapers = papers.filter(paper => !isSyntheticExamPaper(paper) && paper.units?.length > 1);
        const selected = selectRandomPaper(completePapers.length ? completePapers : papers);
        if (selected) await startPaper(selected);
        return;
      }
      const unit = selectRandomUnit(catalog);
      if (unit) await startUnit(unit);
    });
    container.querySelectorAll('[data-unit]').forEach(button => add(button, 'click', async () => {
      const unit = units.find(item => item.paperKey === button.dataset.paper && item.unitKey === button.dataset.unit && (item.bankId || '') === button.dataset.bank);
      if (unit) await startUnit(unit);
    }));
    container.querySelectorAll('[data-paper-start]').forEach(button => add(button, 'click', async () => {
      const paper = papers.find(item => item.paperKey === button.dataset.paperStart && (item.bankId || '') === button.dataset.bank);
      if (paper) await startPaper(paper);
    }));
    this._cleanupHandlers = handlers;
  }
};
