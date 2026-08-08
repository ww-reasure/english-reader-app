import { createExamServices } from '../exam/create-services.js';
import { esc } from '../helpers.js';
import { renderExamBottomNav } from '../exam/bottom-nav.mjs';

function unitTitle(unit) {
  if (unit.type === 'cloze_choice') return '完形填空';
  if (unit.type === 'paragraph_ordering') return 'Part B · 段落排序';
  if (unit.type === 'translation') return 'Part C · 翻译';
  return `阅读 ${unit.displayTitle || ''}`.trim();
}

function questionLabel(unit, question, index) {
  if (unit.type === 'cloze_choice') return `第 ${question.blankNumber || index + 1} 空`;
  if (unit.type === 'paragraph_ordering') return `${question.slotNumber || index + 1} 号位置`;
  if (unit.type === 'translation') return `Q${String(question.segmentKey || '').replace(/^S/i, '') || index + 1}`;
  if (unit.type === 'reading_mcq') {
    const sourceNumber = String(question.questionKey || '').match(/_q(\d+)$/i)?.[1];
    return `Q${sourceNumber || question.number || index + 1}`;
  }
  return `Q${question.number || index + 1}`;
}

function dueCopy(state, now) {
  if (state.nextDueAt != null && state.nextDueAt <= now) return '今天待复习';
  if (state.status === 'mastered') return '已掌握';
  return '学习中';
}

async function enrichState(services, state) {
  const paper = await services.contentRepository.getFullPaper({
    examId: state.examId,
    bankId: state.bankId,
    paperKey: state.paperKey
  });
  const unit = paper?.units.find(item => item.unitKey === state.unitKey);
  const question = unit?.questions.find(item => item.questionKey === state.questionKey);
  return { state, paper, unit, question };
}

function objectiveGroups(entries, now) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.paper || !entry.unit || !entry.question) continue;
    const key = `${entry.state.bankId}:${entry.state.paperKey}:${entry.state.unitKey}`;
    if (!groups.has(key)) groups.set(key, { ...entry, entries: [], questionKeys: [] });
    const group = groups.get(key);
    group.entries.push(entry);
    group.questionKeys.push(entry.question.questionKey);
  }
  return [...groups.values()].map(group => {
    const labels = group.entries.map(entry => questionLabel(
      group.unit,
      entry.question,
      group.unit.questions.findIndex(item => item.questionKey === entry.question.questionKey)
    ));
    const detail = group.entries.map(entry => entry.question.stem || '').filter(Boolean).join(' · ');
    return `
      <article class="exam-review-card">
        <p class="exam-review-kicker">${esc(String(group.paper.year || ''))} · ${esc(unitTitle(group.unit))}</p>
        <h2>${esc(labels.join('、'))}</h2>
        ${detail ? `<p class="exam-review-copy">${esc(detail)}</p>` : ''}
        <p class="exam-review-meta">${group.entries.length} 道${group.entries.some(entry => dueCopy(entry.state, now) === '今天待复习') ? ' · 今天待复习' : ' · 学习中'}</p>
        <button type="button" class="btn btn-primary btn-sm" data-review-start="${esc(group.state.bankId)}" data-paper="${esc(group.state.paperKey)}" data-unit="${esc(group.state.unitKey)}" data-keys="${esc(group.questionKeys.join('|'))}">开始复习</button>
      </article>`;
  }).join('');
}

function translationCards(entries, now) {
  return entries.filter(entry => entry.paper && entry.unit && entry.question).map(entry => {
    const index = entry.unit.questions.findIndex(item => item.questionKey === entry.question.questionKey);
    const label = questionLabel(entry.unit, entry.question, index);
    return `
      <article class="exam-review-card">
        <p class="exam-review-kicker">${esc(String(entry.paper.year || ''))} · ${esc(unitTitle(entry.unit))}</p>
        <h2>${esc(label)} · ${esc(dueCopy(entry.state, now))}</h2>
        <p class="exam-review-copy">${esc(entry.question.sourceText || '')}</p>
        <div class="exam-review-actions">
          ${entry.state.sourceAttemptId ? `<button type="button" class="btn btn-outline btn-sm" data-translation-explanation="${esc(entry.state.sourceAttemptId)}">查看解析</button>` : ''}
          <button type="button" class="btn btn-outline btn-sm" data-translation-redo="${esc(entry.state.bankId)}" data-paper="${esc(entry.state.paperKey)}" data-unit="${esc(entry.state.unitKey)}">重新练习 Part C</button>
        </div>
      </article>`;
  }).join('');
}

export const ExamReviewView = {
  cleanup() {
    this._cleanupHandlers?.forEach(remove => remove());
    this._cleanupHandlers = [];
  },

  async render(container) {
    this.cleanup();
    const services = createExamServices();
    const examId = 'kaoyan_en1';
    const now = Date.now();
    const [dueWrong, allWrong, dueTranslations, allTranslations] = await Promise.all([
      services.stateRepository.listDueWrongStates({ examId, now }),
      services.stateRepository.listWrongStates({ examId }),
      services.stateRepository.listDueTranslationReviews({ examId, now }),
      services.stateRepository.listTranslationReviews({ examId })
    ]);
    const [dueObjectiveEntries, activeObjectiveEntries, masteredObjectiveEntries, dueTranslationEntries, allTranslationEntries] = await Promise.all([
      Promise.all(dueWrong.map(state => enrichState(services, state))),
      Promise.all(allWrong.filter(state => state.status === 'active').map(state => enrichState(services, state))),
      Promise.all(allWrong.filter(state => state.status === 'mastered').map(state => enrichState(services, state))),
      Promise.all(dueTranslations.map(state => enrichState(services, state))),
      Promise.all(allTranslations.map(state => enrichState(services, state)))
    ]);
    const masteredTranslations = allTranslationEntries.filter(entry => entry.state.status === 'mastered');
    const learningCount = allWrong.filter(state => state.status === 'active' && state.nextDueAt > now).length
      + allTranslations.filter(state => state.status !== 'mastered' && state.nextDueAt > now).length;
    const masteredCount = masteredObjectiveEntries.length + masteredTranslations.length;
    const todayCount = dueObjectiveEntries.length + dueTranslationEntries.length;

    const panel = (name, content) => `<section class="exam-review-panel" data-review-panel="${name}" ${name === 'due' ? '' : 'hidden'}>${content || '<div class="empty-state">这里暂时没有内容</div>'}</section>`;
    container.innerHTML = `
      <div class="exam-review">
        <header class="exam-review-header">
          <p class="page-eyebrow">REVIEW CENTER</p>
          <h1>错题复习</h1>
          <div class="exam-review-metrics">
            <div><strong>${todayCount}</strong><span>今日待复习</span></div>
            <div><strong>${learningCount}</strong><span>学习中</span></div>
            <div><strong>${masteredCount}</strong><span>已掌握</span></div>
          </div>
        </header>
        <div class="exam-review-tabs" role="tablist" aria-label="复习筛选">
          <button type="button" class="btn btn-sm is-active" data-review-tab="due">今日待复习</button>
          <button type="button" class="btn btn-sm" data-review-tab="wrong">错题本</button>
          <button type="button" class="btn btn-sm" data-review-tab="translation">翻译</button>
          <button type="button" class="btn btn-sm" data-review-tab="mastered">已掌握</button>
        </div>
        ${panel('due', `${objectiveGroups(dueObjectiveEntries, now)}${translationCards(dueTranslationEntries, now)}`)}
        ${panel('wrong', objectiveGroups(activeObjectiveEntries, now))}
        ${panel('translation', translationCards(allTranslationEntries, now))}
        ${panel('mastered', `${objectiveGroups(masteredObjectiveEntries, now)}${translationCards(masteredTranslations, now)}`)}
        ${renderExamBottomNav('review')}
      </div>`;

    const handlers = [];
    const add = (target, type, handler) => {
      target.addEventListener(type, handler);
      handlers.push(() => target.removeEventListener(type, handler));
    };
    this._cleanupHandlers = handlers;
    container.querySelectorAll('[data-review-tab]').forEach(button => add(button, 'click', () => {
      const tab = button.dataset.reviewTab;
      container.querySelectorAll('[data-review-tab]').forEach(item => item.classList.toggle('is-active', item === button));
      container.querySelectorAll('[data-review-panel]').forEach(panelNode => { panelNode.hidden = panelNode.dataset.reviewPanel !== tab; });
    }));
    container.querySelectorAll('[data-review-start]').forEach(button => add(button, 'click', async () => {
      const reviewEligibleQuestionKeys = button.dataset.keys.split('|').filter(Boolean);
      try {
        const attempt = await services.practiceService.startReviewCenterAttempt({
          examId,
          bankId: button.dataset.reviewStart,
          paperKey: button.dataset.paper,
          unitKey: button.dataset.unit,
          questionKeys: reviewEligibleQuestionKeys
        });
        location.hash = `#/exam/practice/${attempt.attemptId}`;
      } catch (error) {
        window.alert(error.message || '待复习队列已更新，请刷新后重试');
      }
    }));
    container.querySelectorAll('[data-translation-explanation]').forEach(button => add(button, 'click', () => {
      location.hash = `#/exam/practice/${button.dataset.translationExplanation}/explanation`;
    }));
    container.querySelectorAll('[data-translation-redo]').forEach(button => add(button, 'click', async () => {
      const attempt = await services.practiceService.startAttempt({
        examId,
        bankId: button.dataset.translationRedo,
        paperKey: button.dataset.paper,
        unitKey: button.dataset.unit,
        practiceOrigin: 'normal'
      });
      location.hash = `#/exam/practice/${attempt.attemptId}`;
    }));
  }
};
