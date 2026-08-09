import { createExamServices } from '../exam/create-services.js';
import { bindReadingStyleWordLookup } from '../components/reading-word-lookup.js';
import { esc } from '../helpers.js';
import { renderExamBottomNav } from '../exam/bottom-nav.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function unitTitle(unit) {
  if (unit.type === 'cloze_choice') return '完形填空';
  if (unit.type === 'paragraph_ordering') return 'Part B · 段落排序';
  if (unit.type === 'matching') return `Part B · ${{ sentence_insertion: '句子插入', heading_matching: '小标题匹配', statement_matching: '观点匹配' }[unit.matchingVariant] || '匹配题'}`;
  if (unit.type === 'translation') return 'Part C · 翻译';
  return `阅读 ${unit.displayTitle || ''}`.trim();
}

function questionLabel(unit, question, index) {
  if (unit.type === 'cloze_choice') return `${question.blankNumber || index + 1}`;
  if (['paragraph_ordering', 'matching'].includes(unit.type)) return `Q${question.slotNumber || index + 1}`;
  if (unit.type === 'translation') return `Q${String(question.segmentKey || '').replace(/^S/i, '') || index + 1}`;
  const sourceNumber = String(question.questionKey || '').match(/_q(\d+)$/i)?.[1];
  return `Q${sourceNumber || question.number || index + 1}`;
}

function lastReviewedAt(state) {
  return Number(state.lastReviewedAt || state.firstAddedAt || state.firstMarkedAt || state.createdAt || state.updatedAt || 0);
}

function ageDays(state, now) {
  return Math.max(0, Math.floor((now - lastReviewedAt(state)) / DAY_MS));
}

function ageCopy(state, now) {
  const days = ageDays(state, now);
  if (!state.lastReviewedAt) return days ? `${days} 天未复习` : '尚未复习';
  if (!days) return '今天复习过';
  return `${days} 天未复习`;
}

async function enrichState(services, state) {
  const paper = await services.contentRepository.getFullPaper({ examId: state.examId, bankId: state.bankId, paperKey: state.paperKey });
  const unit = paper?.units.find(item => item.unitKey === state.unitKey);
  const question = unit?.questions.find(item => item.questionKey === state.questionKey);
  return { state, paper, unit, question };
}

function passageHtml(unit) {
  const paragraphs = Array.isArray(unit.passage) ? unit.passage : [];
  if (!paragraphs.length) return '';
  return `<section class="exam-review-detail-passage" data-selection-source="passage"><h3>相关正文</h3>${paragraphs.map(item => `<p>${esc(item.text || '')}</p>`).join('')}</section>`;
}

function questionDetailHtml(entry, index, latestAttempt) {
  const { unit, question, state } = entry;
  const label = questionLabel(unit, question, index);
  const options = (question.options || []).map(option => `<li data-selection-source="question"><b>${esc(option.key)}</b><span>${esc(option.text)}</span></li>`).join('');
  const canonicalExplanation = esc(question.explanation || question.localAnalysis || '当前题包暂未提供文字解析。');
  return `<section class="exam-review-question-detail" data-review-question-detail="${esc(question.questionKey)}" hidden>
    <button type="button" class="exam-review-detail-back" data-review-detail-back>← 返回题目列表</button>
    ${passageHtml(unit)}
    <div class="exam-review-detail-question">
      <p class="exam-review-detail-label">${esc(label)}</p>
      <h3 data-selection-source="question">${esc(question.stem || question.sourceText || '原题')}</h3>
      ${options ? `<ol class="exam-review-detail-options">${options}</ol>` : ''}
    </div>
    <button type="button" class="btn btn-outline" data-review-explanation="${esc(latestAttempt?.attemptId || '')}">查看解析</button>
    <div class="exam-review-canonical-explanation" data-canonical-explanation hidden><small>${latestAttempt ? '最近一次作答解析' : '当前题包解析'}</small><p>${canonicalExplanation}</p></div>
  </section>`;
}

function objectiveGroups(entries, attempts, now) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.paper || !entry.unit || !entry.question) continue;
    const key = `${entry.state.bankId}:${entry.state.paperKey}:${entry.state.unitKey}`;
    if (!groups.has(key)) groups.set(key, { ...entry, entries: [], questionKeys: [] });
    groups.get(key).entries.push(entry);
    groups.get(key).questionKeys.push(entry.question.questionKey);
  }
  return [...groups.values()].map(group => {
    const groupKey = `${group.state.bankId}:${group.state.paperKey}:${group.state.unitKey}`;
    const completed = attempts.filter(attempt => attempt.status === 'submitted'
      && ['review_center_manual', 'review_center_due'].includes(attempt.practiceOrigin)
      && attempt.bankId === group.state.bankId
      && attempt.paperKey === group.state.paperKey
      && (attempt.questionOrder || []).some(key => group.questionKeys.includes(key))).length;
    const oldest = Math.min(...group.entries.map(entry => lastReviewedAt(entry.state)));
    const mostUnreviewed = Math.max(...group.entries.map(entry => ageDays(entry.state, now)));
    const rows = group.entries.map((entry, index) => {
      const unitIndex = group.unit.questions.findIndex(item => item.questionKey === entry.question.questionKey);
      return `<button type="button" class="exam-review-question-row" data-review-question-open="${esc(entry.question.questionKey)}"><strong>${esc(questionLabel(group.unit, entry.question, unitIndex))}</strong><span>${esc(entry.question.stem || entry.question.sourceText || '查看完整题目')}</span><small>${Number(entry.state.reviewCount) || 0} 次 · ${esc(ageCopy(entry.state, now))}</small></button>`;
    }).join('');
    const details = group.entries.map(entry => {
      const index = group.unit.questions.findIndex(item => item.questionKey === entry.question.questionKey);
      const latestAttempt = attempts.filter(attempt => attempt.status === 'submitted' && (attempt.questionOrder || []).includes(entry.question.questionKey)).sort((a, b) => Number(b.submittedAt || 0) - Number(a.submittedAt || 0))[0];
      return questionDetailHtml(entry, index, latestAttempt);
    }).join('');
    return `<article class="exam-review-card" data-oldest="${oldest}" data-completions="${completed}">
      <div class="exam-review-card-head"><div><p class="exam-review-kicker">${esc(String(group.paper.year || ''))} · ${esc(unitTitle(group.unit))}</p><strong class="exam-review-count">${group.entries.length}</strong><span>题</span></div><span class="exam-review-status">${mostUnreviewed ? `${mostUnreviewed} 天未复习` : '可随时复习'}</span></div>
      <p class="exam-review-meta">累计完整作答 ${completed} 次 · 连续答对两次后移入已掌握</p>
      <div class="exam-review-card-actions"><button type="button" class="btn btn-outline btn-sm" data-review-details="${esc(groupKey)}">查看题目</button><button type="button" class="btn btn-primary btn-sm" data-review-start="${esc(group.state.bankId)}" data-paper="${esc(group.state.paperKey)}" data-unit="${esc(group.state.unitKey)}" data-keys="${esc(group.questionKeys.join('|'))}">开始复习 <span aria-hidden="true">→</span></button></div>
      <dialog class="exam-review-dialog" data-review-dialog="${esc(groupKey)}"><div class="exam-review-dialog-card"><header><div><p class="exam-review-kicker">${esc(String(group.paper.year || ''))} · ${esc(unitTitle(group.unit))}</p><h2>错题详情</h2></div><button type="button" class="app-icon-button" data-review-dialog-close aria-label="关闭题目详情">×</button></header><div class="exam-review-question-list">${rows}</div>${details}</div></dialog>
    </article>`;
  }).join('');
}

function translationCards(entries, now) {
  return entries.filter(entry => entry.paper && entry.unit && entry.question).map(entry => {
    const index = entry.unit.questions.findIndex(item => item.questionKey === entry.question.questionKey);
    return `<article class="exam-review-card" data-oldest="${lastReviewedAt(entry.state)}" data-completions="${Number(entry.state.reviewCount) || 0}"><div class="exam-review-card-head"><div><p class="exam-review-kicker">${esc(String(entry.paper.year || ''))} · ${esc(unitTitle(entry.unit))}</p><h2>${esc(questionLabel(entry.unit, entry.question, index))}</h2></div><span class="exam-review-status">${esc(ageCopy(entry.state, now))}</span></div><p class="exam-review-copy" data-selection-source="passage">${esc(entry.question.sourceText || '')}</p><div class="exam-review-actions">${entry.state.sourceAttemptId ? `<button type="button" class="btn btn-outline btn-sm" data-translation-explanation="${esc(entry.state.sourceAttemptId)}">查看解析</button>` : ''}<button type="button" class="btn btn-primary btn-sm" data-translation-redo="${esc(entry.state.bankId)}" data-paper="${esc(entry.state.paperKey)}" data-unit="${esc(entry.state.unitKey)}">重新练习 Part C</button></div></article>`;
  }).join('');
}

export const ExamReviewView = {
  cleanup() { this._cleanupHandlers?.forEach(remove => remove()); this._cleanupHandlers = []; this._wordLookupCleanup?.(); this._wordLookupCleanup = null; },

  async render(container) {
    this.cleanup();
    const services = createExamServices();
    const examId = 'kaoyan_en1';
    const now = Date.now();
    const [allWrong, allTranslations, attempts] = await Promise.all([
      services.stateRepository.listWrongStates({ examId }),
      services.stateRepository.listTranslationReviews({ examId }),
      services.stateRepository.listAttempts({ examId })
    ]);
    const [activeEntries, masteredEntries, translationEntries] = await Promise.all([
      Promise.all(allWrong.filter(state => state.status === 'active').map(state => enrichState(services, state))),
      Promise.all(allWrong.filter(state => state.status === 'mastered').map(state => enrichState(services, state))),
      Promise.all(allTranslations.map(state => enrichState(services, state)))
    ]);
    const activeTranslations = translationEntries.filter(entry => entry.state.status !== 'mastered');
    const masteredTranslations = translationEntries.filter(entry => entry.state.status === 'mastered');
    const oldest = [...activeEntries, ...activeTranslations].reduce((value, entry) => Math.max(value, ageDays(entry.state, now)), 0);
    const totalReviews = allWrong.reduce((sum, state) => sum + (Number(state.reviewCount) || 0), 0);
    const masteredCount = masteredEntries.length + masteredTranslations.length;
    const panel = (name, content) => `<section class="exam-review-panel" data-review-panel="${name}" ${name === 'wrong' ? '' : 'hidden'}>${content || '<div class="empty-state">这里暂时没有内容</div>'}</section>`;
    container.innerHTML = `<div class="exam-review"><header class="exam-review-header"><p class="page-eyebrow">REVIEW CENTER</p><h1>错题复习</h1><div class="exam-review-metrics"><div><strong>${activeEntries.length}</strong><span>当前错题数</span></div><div><strong>${oldest}</strong><span>最长未复习/天</span></div><div><strong>${masteredCount}</strong><span>已掌握</span></div></div><p class="exam-review-summary">累计完成 ${totalReviews} 次自主复习，所有错题均可随时开始。</p></header>
      <div class="exam-review-toolbar"><div class="exam-review-tabs" role="tablist" aria-label="复习筛选"><button type="button" class="btn btn-sm is-active" data-review-tab="wrong">错题本</button><button type="button" class="btn btn-sm" data-review-tab="translation">翻译</button><button type="button" class="btn btn-sm" data-review-tab="mastered">已掌握</button></div><label class="exam-review-sort">排序<select data-review-sort><option value="oldest">未复习最久优先</option><option value="recent">最近复习优先</option><option value="most">完成次数最多</option><option value="least">完成次数最少</option></select></label></div>
      ${panel('wrong', objectiveGroups(activeEntries, attempts, now))}${panel('translation', translationCards(activeTranslations, now))}${panel('mastered', `${objectiveGroups(masteredEntries, attempts, now)}${translationCards(masteredTranslations, now)}`)}${renderExamBottomNav('review')}</div>`;

    const handlers = [];
    const add = (target, type, handler) => { if (!target) return; target.addEventListener(type, handler); handlers.push(() => target.removeEventListener(type, handler)); };
    this._cleanupHandlers = handlers;
    const sortPanels = mode => container.querySelectorAll('[data-review-panel]').forEach(panelNode => {
      [...panelNode.querySelectorAll(':scope > .exam-review-card')].sort((a, b) => mode === 'oldest' ? Number(a.dataset.oldest) - Number(b.dataset.oldest) : mode === 'recent' ? Number(b.dataset.oldest) - Number(a.dataset.oldest) : mode === 'most' ? Number(b.dataset.completions) - Number(a.dataset.completions) : Number(a.dataset.completions) - Number(b.dataset.completions)).forEach(card => panelNode.append(card));
    });
    add(container.querySelector('[data-review-sort]'), 'change', event => sortPanels(event.target.value));
    container.querySelectorAll('[data-review-tab]').forEach(button => add(button, 'click', () => { const tab = button.dataset.reviewTab; container.querySelectorAll('[data-review-tab]').forEach(item => item.classList.toggle('is-active', item === button)); container.querySelectorAll('[data-review-panel]').forEach(panelNode => { panelNode.hidden = panelNode.dataset.reviewPanel !== tab; }); }));
    container.querySelectorAll('[data-review-details]').forEach(button => add(button, 'click', () => container.querySelector(`[data-review-dialog="${CSS.escape(button.dataset.reviewDetails)}"]`)?.showModal()));
    container.querySelectorAll('[data-review-dialog-close]').forEach(button => add(button, 'click', () => button.closest('dialog')?.close()));
    container.querySelectorAll('[data-review-question-open]').forEach(button => add(button, 'click', () => { const dialog = button.closest('dialog'); dialog.querySelector('.exam-review-question-list').hidden = true; dialog.querySelectorAll('[data-review-question-detail]').forEach(detail => { detail.hidden = detail.dataset.reviewQuestionDetail !== button.dataset.reviewQuestionOpen; }); }));
    container.querySelectorAll('[data-review-detail-back]').forEach(button => add(button, 'click', () => { const dialog = button.closest('dialog'); dialog.querySelector('.exam-review-question-list').hidden = false; dialog.querySelectorAll('[data-review-question-detail]').forEach(detail => { detail.hidden = true; }); }));
    container.querySelectorAll('[data-review-explanation]').forEach(button => add(button, 'click', () => { if (button.dataset.reviewExplanation) location.hash = `#/exam/practice/${button.dataset.reviewExplanation}/explanation`; else { const panelNode = button.nextElementSibling; panelNode.hidden = !panelNode.hidden; } }));
    container.querySelectorAll('[data-review-start]').forEach(button => add(button, 'click', async () => { try { const attempt = await services.practiceService.startReviewCenterAttempt({ examId, bankId: button.dataset.reviewStart, paperKey: button.dataset.paper, unitKey: button.dataset.unit, questionKeys: button.dataset.keys.split('|').filter(Boolean) }); location.hash = `#/exam/practice/${attempt.attemptId}`; } catch { await this.render(container); } }));
    container.querySelectorAll('[data-translation-explanation]').forEach(button => add(button, 'click', () => { location.hash = `#/exam/practice/${button.dataset.translationExplanation}/explanation`; }));
    container.querySelectorAll('[data-translation-redo]').forEach(button => add(button, 'click', async () => { const attempt = await services.practiceService.startAttempt({ examId, bankId: button.dataset.translationRedo, paperKey: button.dataset.paper, unitKey: button.dataset.unit, practiceOrigin: 'review_center_manual' }); location.hash = `#/exam/practice/${attempt.attemptId}`; }));
    this._wordLookupCleanup = bindReadingStyleWordLookup({ root: container, shouldIgnoreClick: event => Boolean(event.target.closest('[data-word-lookup="disabled"]')) });
  }
};
