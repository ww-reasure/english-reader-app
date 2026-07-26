/**
 * AI Analysis Component
 * Handles sentence analysis with AI, including long-press auto-select
 */

import { Tooltip } from './tooltip.js';
import { API } from '../api.js';
import { Dictionary } from '../dictionary.js';
import { esc, debounce } from '../helpers.js';
import { SentenceAnalysisCache } from './sentence-analysis-cache.js';
import { Config } from '../config.js';
import { Modal } from './modal.js';
import { ConversationStore } from './conversation-store.js';
import { LearningAgent } from './learning-agent.js';
import { ContextBuilder } from './context-builder.js';
import { ChatService } from './chat-service.js';
import { DB } from '../db.js';
import { SpacedRepetition } from '../spaced-repetition.js';
import { renderLearningMarkdown } from './rich-text.js';

const conversationStore = new ConversationStore();
const chatService = new ChatService({
  api: API,
  agent: new LearningAgent({ db: DB, srs: SpacedRepetition }),
  builder: new ContextBuilder()
});

const MAX_SELECTED_EXCERPT_LENGTH = 600;
const normalizeSelectedExcerpt = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTED_EXCERPT_LENGTH);

export const AIAnalysis = {
  currentText: '',
  longPressTimer: null,
  isLongPress: false,
  ignoreNextArticleClick: false,
  analysisCache: new SentenceAnalysisCache(),
  articleContext: null,
  _outsideClickHandler: null,
  analysisRequestId: 0,
  activeFollowupKey: null,
  selectedDetailExcerpt: '',
  _detailSelectionChangeHandler: null,
  _detailSelectionAction: null,
  _detailSelectionModal: null,
  _followUpController: null,

  setArticleContext(article, paragraph = '') {
    this.articleContext = {
      id: article?.id,
      title: article?.title || '当前文章',
      paragraph: String(paragraph || '')
    };
  },

  clearArticleContext() {
    this.closeResultModal();
    this.articleContext = null;
    this.hideButton();
    this._removeOutsideClickHandler();
  },

  getParagraphFromNode(node) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    return element?.closest?.('.paragraph-pair')?.querySelector('.en-paragraph')?.textContent?.trim() || '';
  },

  updateParagraphContext(node) {
    if (!this.articleContext || !node) return;
    const paragraph = this.getParagraphFromNode(node);
    if (paragraph) this.articleContext.paragraph = paragraph;
  },

  createAnalysisContextSnapshot(node = null) {
    if (!this.articleContext || this.articleContext.id == null) return null;
    return {
      id: this.articleContext.id,
      title: this.articleContext.title || '当前文章',
      paragraph: this.getParagraphFromNode(node) || this.articleContext.paragraph || ''
    };
  },

  invalidateAnalysisRequest() {
    this.analysisRequestId += 1;
    return this.analysisRequestId;
  },

  isCurrentAnalysisRequest(requestId) {
    return requestId === this.analysisRequestId;
  },

  _removeResultModal() {
    this.clearDetailSelection();
    Tooltip.hide();
    const existing = document.getElementById('aiResultModal');
    if (existing) existing.remove();
    this._followUpController = null;
  },

  closeResultModal() {
    this.invalidateAnalysisRequest();
    if (this.activeFollowupKey) chatService.cancel(this.activeFollowupKey);
    this.activeFollowupKey = null;
    this._removeResultModal();
  },

  _removeOutsideClickHandler() {
    if (this._outsideClickHandler) document.removeEventListener('click', this._outsideClickHandler);
    this._outsideClickHandler = null;
  },

  // Show "Ask AI" button at position
  showButton(x, y, text) {
    this.hideButton();
    this.currentText = text;

    const btn = document.createElement('button');
    btn.id = 'aiAnalyzeBtn';
    btn.className = 'ai-analyze-btn';
    btn.textContent = '问 AI';
    btn.onclick = (e) => {
      e.stopPropagation();
      this.analyze(text);
    };

    let left = x - 30;
    let top = y + 8;
    if (left < 10) left = 10;
    if (top + 40 > window.innerHeight) top = y - 40;

    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
    document.body.appendChild(btn);
  },

  // Hide "Ask AI" button
  hideButton() {
    const btn = document.getElementById('aiAnalyzeBtn');
    if (btn) btn.remove();
  },

  // Analyze sentence with AI
  async analyze(sentence) {
    this.hideButton();
    Tooltip.hide();
    if (this.activeFollowupKey) chatService.cancel(this.activeFollowupKey);
    this.activeFollowupKey = null;
    const requestId = this.invalidateAnalysisRequest();
    const analysisContext = this.createAnalysisContextSnapshot();
    const cached = this.analysisCache.get(sentence);
    const isResolved = typeof cached === 'string';
    this.showResult(sentence, isResolved ? cached : '正在分析...', !isResolved, analysisContext);

    try {
      const result = await this.analysisCache.getOrCreate(sentence, () => API.analyzeSentence(sentence));
      if (this.isCurrentAnalysisRequest(requestId)) this.showResult(sentence, result, false, analysisContext);
    } catch (err) {
      if (this.isCurrentAnalysisRequest(requestId)) this.showResult(sentence, `分析失败：${err.message}`, false, analysisContext);
    }
  },

  // Show analysis result in modal
  showResult(sentence, content, isLoading, analysisContext = this.createAnalysisContextSnapshot()) {
    this._removeResultModal();

    const overlay = document.createElement('div');
    overlay.id = 'aiResultModal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeResultModal(); };

    const modal = document.createElement('div');
    modal.className = 'modal modal-wide';
    modal.innerHTML = `
      <h2>AI 句子分析</h2>
      <div class="ai-original-sentence ai-lookup-sentence" title="轻点英文单词查看释义">${esc(sentence)}</div>
      <p class="ai-lookup-hint">轻点上面的英文单词可查看释义</p>
      <div class="${isLoading ? 'ai-loading' : 'ai-result-content'}">
        ${isLoading ? '正在分析，请稍候...' : this.formatResult(content)}
      </div>
      ${!isLoading && analysisContext?.id != null ? `
      <section class="ai-followup" aria-label="继续追问">
        <button id="aiFollowupToggle" class="btn btn-outline btn-sm" type="button">继续追问</button>
        <div id="aiFollowupPanel" class="ai-followup-panel" hidden>
          <div id="aiFollowupExcerpt" class="ai-followup-excerpt" hidden>
            <span class="ai-followup-excerpt-label">追问引用</span>
            <p id="aiFollowupExcerptText"></p>
          </div>
          <div id="aiFollowupMessages" class="ai-followup-messages" aria-live="polite"></div>
          <div class="ai-followup-composer">
            <textarea id="aiFollowupInput" rows="2" placeholder="继续问这句话的语法、词义或表达…" aria-label="继续追问"></textarea>
            <button id="aiFollowupSend" class="btn btn-primary btn-sm" type="button">发送</button>
          </div>
        </div>
      </section>` : ''}
      <div class="modal-actions">
        <button id="aiResultClose" class="btn" type="button">关闭</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modal.querySelector('#aiResultClose')?.addEventListener('click', () => this.closeResultModal());
    this.bindWordLookup(modal);
    this.bindFollowUp(modal, sentence, content, analysisContext);
    this.bindDetailSelection(modal, analysisContext);
  },

  // Reuse the reading-page dictionary card inside the analysis modal.
  bindWordLookup(modal) {
    const lookupTargets = modal.querySelectorAll('.ai-lookup-sentence, .ai-result-content');
    lookupTargets.forEach(target => {
      target.addEventListener('click', async (e) => {
        // A native text selection is an intentional follow-up action, never a word lookup.
        if (this.getSelectedDetailExcerpt(modal)) {
          e.stopPropagation();
          return;
        }
        if (Tooltip.isVisible()) {
          e.stopPropagation();
          Tooltip.hide();
          return;
        }

        const word = Tooltip.getWordAtPoint(e);
        if (!word) return;

        e.stopPropagation();
        const lookupId = Tooltip.beginLookup(e.clientX, e.clientY);
        try {
          const data = await Dictionary.lookup(word);
          await Tooltip.show(lookupId, e.clientX, e.clientY, data);
        } catch {
          if (Tooltip.isCurrent(lookupId)) Tooltip.hide();
        }
      });
    });
  },

  getSelectedDetailExcerpt(modal) {
    const detail = modal.querySelector('.ai-result-content');
    const selection = window.getSelection?.();
    if (!detail || !selection || selection.isCollapsed || !selection.rangeCount) return '';
    try {
      const range = selection.getRangeAt(0);
      const belongsToDetail = node => {
        const element = node?.nodeType === 3 ? node.parentElement : node;
        return !!element && (element === detail || detail.contains(element));
      };
      if (!belongsToDetail(range.startContainer) || !belongsToDetail(range.endContainer)) return '';
      return normalizeSelectedExcerpt(selection.toString());
    } catch {
      return '';
    }
  },

  clearDetailSelection() {
    if (this._detailSelectionChangeHandler) document.removeEventListener('selectionchange', this._detailSelectionChangeHandler);
    this._detailSelectionChangeHandler = null;
    this._detailSelectionModal = null;
    this._detailSelectionAction?.remove();
    this._detailSelectionAction = null;
    this.selectedDetailExcerpt = '';
  },

  showDetailSelectionAction(modal, excerpt) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect?.();
    if (!rect) return;

    this._detailSelectionAction?.remove();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-detail-selection-btn';
    button.textContent = '追问所选内容';
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.openFollowUpPanel(modal, excerpt);
      this._detailSelectionAction?.remove();
      this._detailSelectionAction = null;
      window.getSelection?.().removeAllRanges?.();
    });

    const buttonTop = rect.bottom + 8 > window.innerHeight - 48
      ? Math.max(12, rect.top - 46)
      : Math.max(12, rect.bottom + 8);
    button.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 148)) + 'px';
    button.style.top = buttonTop + 'px';
    document.body.appendChild(button);
    this._detailSelectionAction = button;
  },

  bindDetailSelection(modal, analysisContext) {
    const detail = modal.querySelector('.ai-result-content');
    if (!detail || analysisContext?.id == null) return;
    this.clearDetailSelection();
    this._detailSelectionModal = modal;
    const updateSelection = () => {
      if (this._detailSelectionModal !== modal) return;
      const excerpt = this.getSelectedDetailExcerpt(modal);
      if (!excerpt) {
        this._detailSelectionAction?.remove();
        this._detailSelectionAction = null;
        return;
      }
      this.selectedDetailExcerpt = excerpt;
      this.showDetailSelectionAction(modal, excerpt);
    };
    const scheduleSelectionUpdate = () => setTimeout(updateSelection, 0);
    this._detailSelectionChangeHandler = updateSelection;
    document.addEventListener('selectionchange', updateSelection);
    detail.addEventListener('mouseup', scheduleSelectionUpdate);
    detail.addEventListener('touchend', scheduleSelectionUpdate, { passive: true });
  },

  openFollowUpPanel(modal, excerpt = '') {
    const controller = this._followUpController;
    if (!controller || controller.modal !== modal) return;
    const selectedExcerpt = normalizeSelectedExcerpt(excerpt || this.selectedDetailExcerpt);
    if (selectedExcerpt) {
      this.selectedDetailExcerpt = selectedExcerpt;
      controller.excerpt.hidden = false;
      controller.excerptText.textContent = selectedExcerpt;
    }
    controller.panel.hidden = false;
    controller.renderHistory();
    controller.input.focus();
  },

  bindFollowUp(modal, sentence, analysis, analysisContext) {
    const toggle = modal.querySelector('#aiFollowupToggle');
    const panel = modal.querySelector('#aiFollowupPanel');
    const input = modal.querySelector('#aiFollowupInput');
    const send = modal.querySelector('#aiFollowupSend');
    const excerpt = modal.querySelector('#aiFollowupExcerpt');
    const excerptText = modal.querySelector('#aiFollowupExcerptText');
    if (!toggle || !panel || !input || !send || !excerpt || !excerptText || analysisContext?.id == null) return;

    const normalizedSentence = String(sentence || '').trim().replace(/\s+/g, ' ').slice(0, 260);
    const key = 'reading:' + analysisContext.id + ':' + encodeURIComponent(normalizedSentence);
    this.activeFollowupKey = key;
    const renderHistory = () => {
      const list = modal.querySelector('#aiFollowupMessages');
      if (!list) return;
      list.innerHTML = '';
      conversationStore.getSession(key).messages.forEach(message => {
        if (message.kind !== 'text') return;
        this.addFollowUpBubble(list, message.role, message.content);
      });
    };

    this._followUpController = { modal, panel, input, excerpt, excerptText, renderHistory };
    toggle.addEventListener('click', () => {
      if (panel.hidden) this.openFollowUpPanel(modal);
      else panel.hidden = true;
    });

    const submit = async () => {
      const question = input.value.trim();
      if (!question || send.disabled) return;
      if (!Config.hasApiKey()) {
        Modal.showApiSettings();
        return;
      }

      const list = modal.querySelector('#aiFollowupMessages');
      const context = analysisContext;
      const selectedExcerpt = this.selectedDetailExcerpt;
      const session = conversationStore.getSession(key);
      input.value = '';
      send.disabled = true;
      this.addFollowUpBubble(list, 'user', question);
      this.addFollowUpBubble(list, 'assistant', '正在回答…', true);

      try {
        const reply = await chatService.ask({
          sessionKey: key,
          session,
          userMessage: question,
          kind: 'reading',
          pageContext: { article: { id: context.id, title: context.title }, sentence, paragraph: context.paragraph, analysis, selectedExcerpt }
        });
        list.querySelector('.ai-followup-thinking')?.remove();
        conversationStore.append(key, { role: 'user', kind: 'text', content: question, selectedExcerpt });
        conversationStore.append(key, { role: 'assistant', kind: 'text', content: reply.content });
        conversationStore.compact(key, 8);
        this.addFollowUpBubble(list, 'assistant', reply.content);
      } catch (error) {
        list.querySelector('.ai-followup-thinking')?.remove();
        this.addFollowUpBubble(list, 'assistant', '暂时无法回答：' + error.message);
      } finally {
        send.disabled = false;
        list.scrollTop = list.scrollHeight;
      }
    };

    send.addEventListener('click', submit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
  },

  addFollowUpBubble(container, role, content, isThinking = false) {
    if (!container) return;
    const bubble = document.createElement('div');
    bubble.className = 'ai-followup-bubble ' + (role === 'user' ? 'user-message' : 'ai-message') + (isThinking ? ' ai-followup-thinking' : '');
    if (role === 'assistant' && !isThinking) bubble.innerHTML = renderLearningMarkdown(content);
    else bubble.textContent = content;
    container.appendChild(bubble);
  },

  // Format result with basic markdown support (XSS-safe)
  formatResult(text) {
    return renderLearningMarkdown(text);
  },

  // Find sentence boundaries from a text node and offset
  findSentenceBoundaries(node, offset) {
    const text = node.textContent;
    if (!text) return null;

    // Sentence ending pattern: .!? followed by space, newline, or end of text
    // Exclude common abbreviations: Mr. Mrs. Dr. U.S. U.K. etc.
    const sentenceEnders = /[.!?]/;
    const abbreviations = /(?:Mr|Mrs|Dr|Ms|Prof|Sr|Jr|St|vs|etc|inc|Ltd|Corp|Jr|Sr|U\.S|U\.K|e\.g|i\.e|a\.m|p\.m)\.$/;

    // Find start of sentence (go backward)
    let start = offset;
    while (start > 0) {
      // Check if current position is a sentence ender
      if (sentenceEnders.test(text[start - 1])) {
        // Check if it's an abbreviation
        const before = text.substring(Math.max(0, start - 10), start);
        if (abbreviations.test(before)) {
          start -= 2; // Skip the abbreviation period
          continue;
        }
        // Check if followed by space or newline (true sentence end)
        if (start < text.length && /[\s\n]/.test(text[start])) {
          break;
        }
        // Period at end of text node
        if (start === text.length) {
          break;
        }
      }
      start--;
    }

    // Skip leading whitespace
    while (start < text.length && /[\s\n]/.test(text[start])) {
      start++;
    }

    // Find end of sentence (go forward)
    let end = offset;
    while (end < text.length) {
      if (sentenceEnders.test(text[end])) {
        // Check if it's an abbreviation
        const before = text.substring(Math.max(0, end - 10), end + 1);
        if (abbreviations.test(before + '.')) {
          end++;
          continue;
        }
        // Include the punctuation
        end++;
        break;
      }
      end++;
    }

    // If we reached end of text without finding sentence end, use end
    if (end >= text.length) {
      end = text.length;
    }

    // Trim trailing whitespace
    while (end > start && /[\s\n]/.test(text[end - 1])) {
      end--;
    }

    if (end <= start) return null;

    return { start, end };
  },

  // Auto-select sentence on long press
  handleLongPress(e) {
    const touch = e.touches[0];
    if (!touch) return;

    // Get the text node at touch position
    let range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(touch.clientX, touch.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(touch.clientX, touch.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range) return;

    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    this.updateParagraphContext(node);

    const offset = range.startOffset;
    const boundaries = this.findSentenceBoundaries(node, offset);

    if (!boundaries) return;

    // Select the sentence
    const selection = window.getSelection();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStart(node, boundaries.start);
    newRange.setEnd(node, boundaries.end);
    selection.addRange(newRange);

    // Show "Ask AI" button
    const selectedText = selection.toString().trim();
    if (selectedText.length > 3) {
      const rect = newRange.getBoundingClientRect();
      this.showButton(rect.left + rect.width / 2, rect.bottom, selectedText);
    }

    this.isLongPress = true;
    this.ignoreNextArticleClick = true;
  },

  // Initialize long-press and selection detection for reading view
  initSelectionDetection(articleBody) {
    const LONG_PRESS_DURATION = 500; // ms

    // Long press detection for touch devices
    articleBody.addEventListener('touchstart', (e) => {
      this.isLongPress = false;
      this.longPressTimer = setTimeout(() => {
        this.handleLongPress(e);
      }, LONG_PRESS_DURATION);
    }, { passive: true });

    articleBody.addEventListener('touchmove', () => {
      clearTimeout(this.longPressTimer);
    }, { passive: true });

    articleBody.addEventListener('touchend', (e) => {
      clearTimeout(this.longPressTimer);

      // If it was a long press, prevent the click event. 保留一次性 guard，
      // 由阅读页 click handler 消费，避免 synthetic click 立即隐藏“问 AI”按钮。
      if (this.isLongPress) {
        e.preventDefault();
        this.isLongPress = false;
      }
    });

    // Manual selection detection for desktop (mouseup)
    const checkSelection = debounce(() => {
      if (this.isLongPress) return;

      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length > 3 && /[a-zA-Z]/.test(text)) {
        try {
          const range = selection.getRangeAt(0);
          this.updateParagraphContext(range.startContainer);
          const rect = range.getBoundingClientRect();
          this.showButton(rect.left + rect.width / 2, rect.bottom, text);
        } catch {
          this.hideButton();
        }
      } else {
        this.hideButton();
      }
    }, 200);

    articleBody.addEventListener('mouseup', checkSelection);

    // Close button when clicking elsewhere
    this._removeOutsideClickHandler();
    this._outsideClickHandler = (e) => {
      if (e.target.id !== 'aiAnalyzeBtn' && !e.target.closest('.modal-overlay')) {
        this.hideButton();
      }
    };
    document.addEventListener('click', this._outsideClickHandler);
  }
};

window.AIAnalysis = AIAnalysis;
