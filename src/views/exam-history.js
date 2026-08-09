import { createExamServices } from '../exam/create-services.js';
import { filterVisibleExamPapers, isSyntheticExamPaper, shouldInstallPrivateExamPacks } from '../exam/home-visibility.mjs';
import { installExamPack } from '../exam/pack-installer.mjs';
import { getExamPackInstallOptions } from '../exam/pack-install-policy.mjs';
import { esc } from '../helpers.js';
import { renderExamBottomNav } from '../exam/bottom-nav.mjs';

async function installPrivatePacks(services) {
  const response = await fetch('/exam-packs/private/index.json');
  if (!response.ok) return;
  const index = await response.json();
  for (const entry of index.packs || []) {
    const packResponse = await fetch(entry.path);
    if (!packResponse.ok) continue;
    const pack = await packResponse.json();
    await installExamPack(services.openDb, pack, getExamPackInstallOptions(pack));
  }
}

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
    const services = createExamServices();
    if (shouldInstallPrivateExamPacks(import.meta.env.MODE)) await installPrivatePacks(services);
    const [attempts, records] = await Promise.all([
      services.stateRepository.listAttempts({ examId: 'kaoyan_en1' }),
      services.contentRepository.listPapers({ examId: 'kaoyan_en1' })
    ]);
    const isPublicBuild = import.meta.env.MODE === 'public';
    const visibleRecords = filterVisibleExamPapers(records, { isProduction: isPublicBuild });
    const recordByKey = new Map(visibleRecords.map(record => [`${record.bankId}:${record.paperKey}`, record]));
    const rows = [];
    for (const attempt of attempts) {
      const record = recordByKey.get(`${attempt.bankId}:${attempt.paperKey}`);
      if (!record) continue;
      const paper = await services.contentRepository.getFullPaper({ examId: 'kaoyan_en1', bankId: attempt.bankId, paperKey: attempt.paperKey });
      if (!paper || (isPublicBuild && isSyntheticExamPaper(paper))) continue;
      const unit = paper.units.find(item => item.unitKey === (attempt.currentUnitKey || attempt.unitKey));
      const responses = await services.stateRepository.getResponses({ examId: 'kaoyan_en1', attemptId: attempt.attemptId });
      const objective = responses.filter(response => response.correct !== null && response.correct !== undefined);
      rows.push({ attempt, paper, unit, responses, accuracy: objective.length ? Math.round(objective.filter(response => response.correct).length / objective.length * 100) : null });
    }
    container.innerHTML = `
      <div class="exam-history">
        <header class="exam-catalog-head"><div><p class="page-eyebrow">LEARNING RECORD</p><h1 class="reading-title">学习记录</h1><p class="text-muted">最近完成、暂停和继续中的真题练习。</p></div></header>
        <div class="exam-history-list">
          ${rows.length ? rows.map(({ attempt, paper, unit, responses, accuracy }) => {
            const isFull = attempt.practiceKind === 'full_paper';
            const state = attempt.status === 'in_progress' ? '进行中' : attempt.status === 'submitted' ? '已完成' : '已放弃';
            const action = attempt.status === 'in_progress' ? `<button class="btn btn-outline btn-sm" data-resume="${esc(attempt.attemptId)}">继续</button>` : attempt.status === 'submitted' ? `<a class="btn btn-outline btn-sm" href="#/exam/result/${esc(attempt.attemptId)}">查看结果</a>` : '';
            return `<article class="exam-history-row"><div><strong>${esc(isFull ? `${paper.year} · 整卷练习` : `${paper.year} · ${unit?.displayTitle || '真题练习'}`)}</strong><span>${state} · ${accuracy == null ? '未提交' : `${accuracy}%`} · ${formatDuration(attempt.activeDurationMs)} · ${responses.length} 条记录</span></div>${action}</article>`;
          }).join('') : '<div class="empty-state">还没有练习记录</div>'}
        </div>
        ${renderExamBottomNav('history')}
      </div>`;
    const handlers = [];
    container.querySelectorAll('[data-resume]').forEach(button => {
      const handler = () => { location.hash = `#/exam/practice/${button.dataset.resume}`; };
      button.addEventListener('click', handler);
      handlers.push(() => button.removeEventListener('click', handler));
    });
    this._cleanupHandlers = handlers;
  }
};
