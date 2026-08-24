import { createExamServices } from '../exam/create-services.js';
import { filterVisibleExamPapers, isSyntheticExamPaper, shouldInstallPrivateExamPacks } from '../exam/home-visibility.mjs';
import { installPrivateExamPacks } from '../exam/private-pack-loader.mjs';
import { esc } from '../helpers.js';
import { renderExamBottomNav } from '../exam/bottom-nav.mjs';
import { listAcrossExams, unitLabel } from '../exam/exam-context.mjs';

function formatDuration(value) {
  const seconds = Math.round((Number(value) || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const ExamHistoryView = {
  cleanup() {
    this._cleanupHandlers?.forEach(remove => remove());
    this._cleanupHandlers = [];
  },

  async render(container) {
    this.cleanup();
    container.innerHTML = '<div class="exam-loading-state" role="status"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>正在准备真题…</span></div>';
    const services = createExamServices();
    const packLoad = shouldInstallPrivateExamPacks(import.meta.env.MODE)
      ? await installPrivateExamPacks({ openDb: services.openDb })
      : { installed: [], failures: [] };
    const [attempts, records] = await Promise.all([
      listAcrossExams(examId => services.stateRepository.listAttempts({ examId })),
      listAcrossExams(examId => services.contentRepository.listPapers({ examId }))
    ]);
    const isPublicBuild = import.meta.env.MODE === 'public';
    const visibleRecords = filterVisibleExamPapers(records, { isProduction: isPublicBuild });
    const recordByKey = new Map(visibleRecords.map(record => [`${record.bankId}:${record.paperKey}`, record]));
    const rows = [];
    for (const attempt of attempts) {
      const record = recordByKey.get(`${attempt.bankId}:${attempt.paperKey}`);
      if (!record) continue;
      const paper = await services.contentRepository.getFullPaper({ examId: attempt.examId, bankId: attempt.bankId, paperKey: attempt.paperKey });
      if (!paper || (isPublicBuild && isSyntheticExamPaper(paper))) continue;
      const unit = paper.units.find(item => item.unitKey === (attempt.currentUnitKey || attempt.unitKey));
      const responses = await services.stateRepository.getResponses({ examId: attempt.examId, attemptId: attempt.attemptId });
      const objective = responses.filter(response => response.correct !== null && response.correct !== undefined);
      rows.push({ attempt, paper, unit, responses, accuracy: objective.length ? Math.round(objective.filter(response => response.correct).length / objective.length * 100) : null });
    }
    container.innerHTML = `
      <div class="exam-history">
        <header class="exam-catalog-head"><div><p class="page-eyebrow">LEARNING RECORD</p><h1 class="reading-title">学习记录</h1><p class="text-muted">最近完成、暂停和继续中的真题练习。</p></div></header>
        ${packLoad.failures.length ? '<p class="exam-pack-warning" role="status">部分真题包未更新，仍可使用已安装内容。<button class="btn btn-outline btn-sm" type="button" data-retry-private-packs>重试</button></p>' : ''}
        <div class="exam-history-list">
          ${rows.length ? rows.map(({ attempt, paper, unit, responses, accuracy }) => {
            const isFull = attempt.practiceKind === 'full_paper';
            const state = attempt.status === 'in_progress' ? '进行中' : attempt.status === 'submitted' ? '已完成' : '已放弃';
            const action = attempt.status === 'in_progress' ? `<button class="btn btn-outline btn-sm" data-resume="${esc(attempt.attemptId)}">继续</button>` : attempt.status === 'submitted' ? `<a class="btn btn-outline btn-sm" href="#/exam/result/${esc(attempt.attemptId)}">查看结果</a>` : '';
            const unitTitle = unit ? unitLabel(unit, { examId: attempt.examId }) : '真题练习';
            return `<article class="exam-history-row"><div><strong>${esc(isFull ? `${paper.year} · 整卷练习` : `${paper.year} · ${unitTitle}`)}</strong><span>${state} · ${accuracy == null ? '未提交' : `${accuracy}%`} · ${formatDuration(attempt.activeDurationMs)} · ${responses.length} 条记录</span></div>${action}</article>`;
          }).join('') : '<div class="empty-state">还没有练习记录</div>'}
        </div>
        ${renderExamBottomNav('history')}
      </div>`;
    const handlers = [];
    const retry = container.querySelector('[data-retry-private-packs]');
    if (retry) {
      const handler = () => this.render(container);
      retry.addEventListener('click', handler);
      handlers.push(() => retry.removeEventListener('click', handler));
    }
    container.querySelectorAll('[data-resume]').forEach(button => {
      const handler = () => { location.hash = `#/exam/practice/${button.dataset.resume}`; };
      button.addEventListener('click', handler);
      handlers.push(() => button.removeEventListener('click', handler));
    });
    this._cleanupHandlers = handlers;
  }
};
