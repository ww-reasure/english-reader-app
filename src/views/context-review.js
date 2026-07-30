import { API } from '../api.js';
import { ContextReview } from '../components/context-review.js';
import { ContextReviewResult, scheduleContextReview } from '../context-review-scheduler.mjs';
import { DB } from '../db.js';
import { Dictionary } from '../dictionary.js';
import { formatPartOfSpeech, getDefinitionSenses, getSavableTranslation } from '../components/definition-trust.mjs';
import { esc, escAttr, getStemForm } from '../helpers.js';
import { ReviewQueue } from '../review-queue.js';
import { Tooltip } from '../components/tooltip.js';
import { WordStudyDetail } from '../components/word-study-detail.js';
import { Config } from '../config.js';
import { createLexiconLoader } from '../lexicon-runtime.mjs';
import { createKnowledgeEvidenceBridge } from '../components/knowledge-evidence-bridge.mjs';

const ACTIVE_SESSION_ID = 'context-review-active';
const TODAY_KEY = 'todayReviewedWords';
const RESULT_LABELS = { known: '认识', uncertain: '模糊', unknown: '不认识' };
const RESULT_QUALITY = { known: 5, uncertain: 3, unknown: 1 };
const knowledgeEvidenceBridge = createKnowledgeEvidenceBridge({ lexiconLoader: createLexiconLoader(), storage: DB });

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function rememberToday(word, result, attemptId = '') {
  let rows = [];
  try {
    const stored = JSON.parse(localStorage.getItem(TODAY_KEY));
    if (stored?.date === todayKey() && Array.isArray(stored.words)) rows = stored.words;
  } catch {}
  const item = {
    word: word.word,
    translation: getSavableTranslation(word),
    quality: RESULT_QUALITY[result],
    reviewMode: 'context',
    attemptId
  };
  const index = rows.findIndex(row => row.word === item.word);
  if (index >= 0) rows[index] = { ...rows[index], ...item };
  else rows.push(item);
  localStorage.setItem(TODAY_KEY, JSON.stringify({ date: todayKey(), words: rows }));
}

function wordTokens(sentence, item, answered) {
  const targetStem = getStemForm(item.lemma);
  return String(sentence || '').split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g).map((part, index) => {
    if (!/^[A-Za-z]/.test(part)) return esc(part);
    const protectedWord = getStemForm(part) === targetStem || part.toLocaleLowerCase('en-US') === item.targetForm;
    if (protectedWord) {
      if (!answered) {
        return `<button class="context-review-word context-review-target" type="button" data-context-target="true">${esc(part)}</button>`;
      }
      return `<button class="context-review-word context-review-target context-review-answered-word" type="button" data-context-word="${escAttr(part)}" data-context-target="true" data-token-index="${index}">${esc(part)}</button>`;
    }
    return `<button class="context-review-word" type="button" data-context-word="${escAttr(part)}" data-token-index="${index}">${esc(part)}</button>`;
  }).join('');
}

function renderDefinition(item) {
  const senses = getDefinitionSenses(item.word);
  const contextual = Number.isInteger(item.senseIndex) ? senses[item.senseIndex] : null;
  const line = contextual || senses[0];
  if (!line) return '<p class="context-review-answer-missing">本句义暂无法可靠判断</p>';
  return `<p class="context-review-sense"><span>${esc(formatPartOfSpeech(line.pos) || '词性待确认')}</span><strong>${esc(line.glossZh)}</strong></p>`;
}

function renderContextSource(item) {
  const labels = {
    'exam-passage': '真题正文',
    'exam-question': '真题题干',
    article: '我的书架',
    example: '既有例句',
    ai: 'AI 定制例句',
    cache: '本地语境缓存'
  };
  const detail = [item.paperLabel, item.positionLabel].filter(Boolean).join(' · ');
  return `来源：${esc(labels[item.source] || labels.cache)}${detail ? `<small>${esc(detail)}</small>` : ''}`;
}

export const ContextReviewView = {
  container: null,
  session: null,
  currentIndex: 0,
  answered: null,
  assistedLookupCount: 0,
  counts: { known: 0, uncertain: 0, unknown: 0, skipped: 0 },
  notice: '',
  translationLoading: false,
  controller: null,
  _clickHandler: null,
  _tooltipDismissCleanup: null,
  correctionBaseline: null,
  correctionAttemptId: '',
  correctionDone: false,
  pendingEvidence: null,
  tooltipWord: '',

  async render(container) {
    this.cleanup();
    this.container = container;
    this.session = null;
    this.currentIndex = 0;
    this.answered = null;
    this.assistedLookupCount = 0;
    this.counts = { known: 0, uncertain: 0, unknown: 0, skipped: 0 };
    this.notice = '';
    this.pendingEvidence = null;
    this.controller = new AbortController();
    container.innerHTML = '<main class="app-standard-page context-review-page"><div class="context-review-loading"><span></span><p>正在准备语境句子…</p><small>优先使用目标考试真题正文、书架与既有例句</small></div></main>';
    try {
      const restored = await DB.getContextReviewSession(ACTIVE_SESSION_ID);
      if (restored?.items?.length) {
        this.session = restored;
        this.currentIndex = Math.max(0, Number(restored.currentIndex) || 0);
        this.counts = { ...this.counts, ...(restored.counts || {}) };
        this.pendingEvidence = restored.pendingEvidence || null;
      } else {
        const words = await ReviewQueue.getDueWords({ limit: 10 });
        this.session = await ContextReview.prepare({
          words,
          limit: 10,
          targetTrack: Config.get('exam_level') || 'general',
          signal: this.controller.signal
        });
        if (words.length && !this.session.items.length) {
          throw new Error('没有可用的本地语境句子，在线生成也未完成');
        }
        this.session.id = ACTIVE_SESSION_ID;
        this.currentIndex = 0;
        await this.persistSession();
      }
      await this.showCurrent();
    } catch (error) {
      if (error?.name === 'AbortError' || !this.container) return;
      this.renderPrepareError(error);
    }
  },

  async showCurrent() {
    this.hideTooltip();
    while (this.currentIndex < (this.session?.items?.length || 0)) {
      const item = this.session.items[this.currentIndex];
      const checked = await ReviewQueue.revalidate({ id: item.wordId, expectedRevision: item.expectedRevision });
      if (checked.current) {
        item.word = checked.word;
        item.lastUsedAt = Date.now();
        void DB.saveContextReviewSentences([item]).catch(() => {});
        break;
      }
      this.commitPendingKnowledgeEvidence();
      this.currentIndex += 1;
    }
    if (!this.container) return;
    if (this.currentIndex >= (this.session?.items?.length || 0)) {
      await DB.deleteContextReviewSession(ACTIVE_SESSION_ID);
      this.renderResult();
      return;
    }
    this.answered = null;
    this.assistedLookupCount = 0;
    this.notice = '';
    this.translationLoading = false;
    this.correctionBaseline = null;
    this.correctionAttemptId = '';
    this.correctionDone = false;
    this.pendingEvidence = null;
    await this.persistSession();
    this.renderCard();
  },

  renderCard() {
    this.unbindInteractions();
    const item = this.session.items[this.currentIndex];
    const answered = Boolean(this.answered);
    const progress = Math.round((this.currentIndex / this.session.items.length) * 100);
    this.container.innerHTML = `
      <main class="app-standard-page context-review-page" aria-labelledby="contextReviewTitle">
        <div id="wordTooltip" class="word-tooltip" style="display:none"></div>
        <header class="context-review-progress">
          <a href="#/flashcard" class="context-review-back" aria-label="返回复习方式"><i class="fa-solid fa-arrow-left"></i></a>
          <div><p class="page-eyebrow">CONTEXT REVIEW</p><h2 id="contextReviewTitle">语境识词</h2></div>
          <span>${this.currentIndex + 1} / ${this.session.items.length}</span>
        </header>
        <div class="context-review-progress-track"><i style="width:${progress}%"></i></div>
        <section class="context-review-sheet ${answered ? 'is-answered' : ''}">
          <p class="context-review-instruction">${answered ? `你的判断：${RESULT_LABELS[this.answered]}` : '读句子，判断高亮单词在这里是否认识'}</p>
          <p class="context-review-sentence">${wordTokens(item.sentence, item, answered)}</p>
          ${answered ? `<div class="context-review-answer" aria-live="polite">
            <div class="context-review-answer-label">本句义</div>
            ${renderDefinition(item)}
            <div class="context-review-answer-label">整句翻译</div>
            <p class="context-review-translation">${item.translationZh ? esc(item.translationZh) : (this.translationLoading ? '正在补充翻译…' : '中文翻译暂不可用')}</p>
            ${!item.translationZh && !this.translationLoading ? '<button class="context-review-translation-retry" type="button" data-context-translation-retry>重试翻译</button>' : ''}
            <p class="context-review-source">${renderContextSource(item)}</p>
          </div>` : `<p class="context-review-help">可点击其他英文词查释义；目标词会保持隐藏，查词不会直接影响本题评分。</p>`}
        </section>
        ${this.notice ? `<p class="context-review-notice" role="status">${esc(this.notice)}</p>` : ''}
        ${answered ? `<div class="context-review-after-actions">
          <button class="btn btn-outline" type="button" data-context-detail>完整学习详情</button>
          <button class="btn btn-primary" type="button" data-context-next>下一句</button>
          ${this.answered === ContextReviewResult.KNOWN && !this.correctionDone ? '<button class="context-review-correct" type="button" data-context-correct>记错了</button>' : ''}
        </div>` : `<div class="context-review-rating" aria-label="语境判断">
          <button type="button" data-context-result="known"><i class="fa-regular fa-face-smile"></i><span>认识</span></button>
          <button type="button" data-context-result="uncertain"><i class="fa-regular fa-face-meh"></i><span>模糊</span></button>
          <button type="button" data-context-result="unknown"><i class="fa-regular fa-face-frown"></i><span>不认识</span></button>
          <button class="context-review-skip" type="button" data-context-result="skipped">跳过</button>
        </div>`}
      </main>`;
    this.bindInteractions();
  },

  bindInteractions() {
    this._clickHandler = event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const result = target.closest('[data-context-result]')?.dataset.contextResult;
      if (result) return void this.submit(result);
      if (target.closest('[data-context-next]')) return void this.next();
      if (target.closest('[data-context-detail]')) return this.openDetail();
      if (target.closest('[data-context-correct]')) return void this.correctMistake();
      if (target.closest('[data-context-translation-retry]')) return void this.loadTranslation(this.session.items[this.currentIndex]);
      if (target.closest('[data-context-target]')) {
        if (!this.answered) {
          this.notice = '这是本句复习词，请先作答';
          this.renderCard();
          return;
        }
      }
      const wordButton = target.closest('[data-context-word]');
      if (wordButton) void this.lookupWord(event, wordButton.dataset.contextWord);
    };
    this.container.addEventListener('click', this._clickHandler);
    this._tooltipDismissCleanup = Tooltip.attachAutoDismiss();
  },

  unbindInteractions() {
    if (this.container && this._clickHandler) this.container.removeEventListener('click', this._clickHandler);
    this._clickHandler = null;
    this._tooltipDismissCleanup?.();
    this._tooltipDismissCleanup = null;
  },

  async lookupWord(event, word) {
    if (!word) return;
    if (Tooltip.isVisible()) {
      if (this.tooltipWord === word) {
        Tooltip.hide();
        this.tooltipWord = '';
        return;
      }
      Tooltip.hide();
    }
    if (!this.answered) this.assistedLookupCount += 1;
    this.tooltipWord = word;
    const lookupId = Tooltip.beginLookup(event.clientX, event.clientY);
    try {
      const data = await Dictionary.lookup(word);
      await Tooltip.show(lookupId, event.clientX, event.clientY, data, false, {
        contextSentence: this.session.items[this.currentIndex].sentence,
        targetTrack: this.session.targetTrack
      });
    } catch {
      if (Tooltip.isCurrent(lookupId)) {
        Tooltip.hide();
        this.tooltipWord = '';
      }
    }
  },

  async submit(result) {
    if (this.answered || !Object.values(ContextReviewResult).includes(result)) return;
    if (result === ContextReviewResult.SKIPPED) {
      this.counts.skipped += 1;
      this.currentIndex += 1;
      await this.persistSession();
      await this.showCurrent();
      return;
    }
    const item = this.session.items[this.currentIndex];
    this.correctionBaseline = { ...item.word };
    this.notice = '正在保存本次判断…';
    this.renderCard();
    try {
      const saved = await ContextReview.submit({ item, result, assistedLookupCount: this.assistedLookupCount });
      if (!saved.accepted) {
        this.notice = ['revision-mismatch', 'reviewed-elsewhere', 'no-longer-due'].includes(saved.reason)
          ? '这个词已在另一种复习方式中完成，已自动跳过。'
          : '本次未计分。';
        this.currentIndex += 1;
        await this.persistSession();
        await this.showCurrent();
        return;
      }
      item.word = saved.word;
      item.expectedRevision = saved.word.reviewRevision;
      this.correctionAttemptId = saved.word.attemptId || '';
      this.pendingEvidence = {
        word: saved.word.word,
        result,
        assistedLookupCount: this.assistedLookupCount,
        attemptId: this.correctionAttemptId,
        contextId: `context-review:${item.wordId}:${String(item.sentence).slice(0, 80)}`,
        source: 'context-review'
      };
      this.answered = result;
      this.counts[result] += 1;
      rememberToday(saved.word, result, this.correctionAttemptId);
      this.notice = this.assistedLookupCount ? `本题查询了 ${this.assistedLookupCount} 个辅助词，目标词评分不受直接影响。` : '';
      await this.persistSession();
      this.renderCard();
      if (!item.translationZh) void this.loadTranslation(item);
    } catch (error) {
      this.notice = String(error?.message || '').includes('另一种复习方式')
        ? '这个词刚刚已在另一种复习方式完成，已自动跳过。'
        : '保存失败，请重新选择。';
      if (String(error?.message || '').includes('另一种复习方式')) {
        this.currentIndex += 1;
        await this.showCurrent();
      } else {
        this.renderCard();
      }
    }
  },

  async loadTranslation(item) {
    this.translationLoading = true;
    this.renderCard();
    const translated = await API.translateSentence(item.sentence).catch(() => '');
    const translation = /\p{Script=Han}/u.test(String(translated || '')) ? String(translated).trim() : '';
    if (!this.container || this.session.items[this.currentIndex] !== item || !this.answered) return;
    this.translationLoading = false;
    if (translation) {
      item.translationZh = translation;
      await DB.saveContextReviewSentences([{ ...item, key: item.key || `context-v1:${item.wordId}:${item.sentence.toLowerCase()}`, lastUsedAt: Date.now() }]).catch(() => {});
    }
    this.renderCard();
  },

  openDetail() {
    const item = this.session.items[this.currentIndex];
    WordStudyDetail.open({
      word: item.word.word,
      definition: item.word,
      sourceMeta: {
        eyebrow: 'CONTEXT REVIEW',
        contextSentence: item.sentence,
        targetTrack: this.session.targetTrack
      }
    });
  },

  async correctMistake() {
    if (this.answered !== ContextReviewResult.KNOWN || this.correctionDone || !this.correctionAttemptId) return;
    const item = this.session.items[this.currentIndex];
    try {
      const corrected = scheduleContextReview(this.correctionBaseline, ContextReviewResult.UNKNOWN, Date.now());
      const updated = await DB.correctLearnWordReview(item.wordId, corrected, {
        attemptId: this.correctionAttemptId,
        sawAnswer: true,
        correctionReason: 'mistaken-context-known'
      });
      item.word = updated;
      this.counts.known = Math.max(0, this.counts.known - 1);
      this.counts.unknown += 1;
      this.answered = ContextReviewResult.UNKNOWN;
      this.correctionDone = true;
      if (this.pendingEvidence) this.pendingEvidence = { ...this.pendingEvidence, result: ContextReviewResult.UNKNOWN };
      rememberToday(updated, ContextReviewResult.UNKNOWN, this.correctionAttemptId);
      this.notice = '已更正为不认识，将在短时复习中再次出现。';
      await this.persistSession();
    } catch {
      this.notice = '更正失败，请重试。';
    }
    this.renderCard();
  },

  async next() {
    if (!this.answered) return;
    this.commitPendingKnowledgeEvidence();
    this.currentIndex += 1;
    await this.persistSession();
    await this.showCurrent();
  },

  commitPendingKnowledgeEvidence() {
    const evidence = this.pendingEvidence;
    this.pendingEvidence = null;
    if (evidence) void knowledgeEvidenceBridge.recordContextReview(evidence);
  },

  async persistSession() {
    if (!this.session) return;
    await DB.saveContextReviewSession({
      ...this.session,
      id: ACTIVE_SESSION_ID,
      currentIndex: this.currentIndex,
      counts: this.counts,
      pendingEvidence: this.pendingEvidence,
      updatedAt: Date.now()
    });
  },

  renderResult() {
    const completed = this.counts.known + this.counts.uncertain + this.counts.unknown;
    this.container.innerHTML = `
      <main class="app-standard-page context-review-page context-review-result-page">
        <section class="flashcard-result-sheet context-review-result">
          <p class="page-eyebrow">CONTEXT REVIEW / DONE</p>
          <h2>语境复习完成</h2>
          <p>本轮完成 ${completed} 个词。结果已进入共同排期，不需要再去单词回忆里重复完成。${this.session?.missingCount ? `另有 ${this.session.missingCount} 个词暂时没有可靠语境句，未计分。` : ''}</p>
          <div class="context-review-result-grid">
            <div><strong>${this.counts.known}</strong><span>认识</span></div>
            <div><strong>${this.counts.uncertain}</strong><span>模糊</span></div>
            <div><strong>${this.counts.unknown}</strong><span>不认识</span></div>
          </div>
          <div class="context-review-result-actions"><a class="btn btn-primary" href="#/flashcard">选择其他方式</a><a class="btn btn-outline" href="#/learn-words">查看学习词库</a></div>
        </section>
      </main>`;
  },

  renderPrepareError() {
    this.container.innerHTML = `<main class="app-standard-page context-review-page"><section class="flashcard-empty-sheet"><h2>暂时没有可用的语境句子</h2><p>离线候选不足或网络生成未完成。不会改动任何复习排期。</p><button class="btn btn-primary" type="button" onclick="ContextReviewView.render(ContextReviewView.container)">重新准备</button><a class="btn btn-outline" href="#/flashcard/recall">改用单词回忆</a></section></main>`;
  },

  hideTooltip() {
    Tooltip.hide();
    this.tooltipWord = '';
  },

  cleanup() {
    this.commitPendingKnowledgeEvidence();
    if (this.session && this.currentIndex < (this.session.items?.length || 0)) {
      void this.persistSession().catch(() => {});
    }
    this.controller?.abort();
    this.controller = null;
    this.unbindInteractions();
    this.hideTooltip();
    WordStudyDetail.close();
    this.container = null;
  }
};

window.ContextReviewView = ContextReviewView;
