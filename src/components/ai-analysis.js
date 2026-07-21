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

export const AIAnalysis = {
  currentText: '',
  longPressTimer: null,
  isLongPress: false,
  ignoreNextArticleClick: false,
  analysisCache: new SentenceAnalysisCache(),
  articleContext: null,
  _outsideClickHandler: null,

  setArticleContext(article, paragraph = '') {
    this.articleContext = {
      id: article?.id,
      title: article?.title || '当前文章',
      paragraph: String(paragraph || '')
    };
  },

  clearArticleContext() {
    if (this.activeFollowupKey) chatService.cancel(this.activeFollowupKey);
    this.activeFollowupKey = null;
    this.articleContext = null;
    this.hideButton();
    this._removeOutsideClickHandler();
  },

  updateParagraphContext(node) {
    if (!this.articleContext || !node) return;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const paragraph = element?.closest('.paragraph-pair')?.querySelector('.en-paragraph')?.textContent?.trim();
    if (paragraph) this.articleContext.paragraph = paragraph;
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
    const cached = this.analysisCache.get(sentence);
    const isResolved = typeof cached === 'string';
    this.showResult(sentence, isResolved ? cached : '正在分析...', !isResolved);

    try {
      const result = await this.analysisCache.getOrCreate(sentence, () => API.analyzeSentence(sentence));
      this.showResult(sentence, result, false);
    } catch (err) {
      this.showResult(sentence, `分析失败：${err.message}`, false);
    }
  },

  // Show analysis result in modal
  showResult(sentence, content, isLoading) {
    const existing = document.getElementById('aiResultModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aiResultModal';
    overlay.className = 'modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.className = 'modal modal-wide';
    modal.innerHTML = `
      <h2>AI 句子分析</h2>
      <div class="ai-original-sentence ai-lookup-sentence" title="轻点英文单词查看释义">${esc(sentence)}</div>
      <p class="ai-lookup-hint">轻点上面的英文单词可查看释义</p>
      <div class="${isLoading ? 'ai-loading' : 'ai-result-content'}">
        ${isLoading ? '正在分析，请稍候...' : this.formatResult(content)}
      </div>
      ${!isLoading && this.articleContext?.id != null ? `
      <section class="ai-followup" aria-label="继续追问">
        <button id="aiFollowupToggle" class="btn btn-outline btn-sm" type="button">继续追问</button>
        <div id="aiFollowupPanel" class="ai-followup-panel" hidden>
          <div id="aiFollowupMessages" class="ai-followup-messages" aria-live="polite"></div>
          <div class="ai-followup-composer">
            <textarea id="aiFollowupInput" rows="2" placeholder="继续问这句话的语法、词义或表达…" aria-label="继续追问"></textarea>
            <button id="aiFollowupSend" class="btn btn-primary btn-sm" type="button">发送</button>
          </div>
        </div>
      </section>` : ''}
      <div class="modal-actions">
        <button class="btn" onclick="document.getElementById('aiResultModal').remove()">关闭</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this.bindWordLookup(modal);
    this.bindFollowUp(modal, sentence, content);
  },

  // Reuse the reading-page dictionary card inside the analysis modal.
  bindWordLookup(modal) {
    const sentence = modal.querySelector('.ai-lookup-sentence');
    if (!sentence) return;

    sentence.addEventListener('click', async (e) => {
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
  },

  bindFollowUp(modal, sentence, analysis) {
    const toggle = modal.querySelector('#aiFollowupToggle');
    const panel = modal.querySelector('#aiFollowupPanel');
    const input = modal.querySelector('#aiFollowupInput');
    const send = modal.querySelector('#aiFollowupSend');
    if (!toggle || !panel || !input || !send || this.articleContext?.id == null) return;

    const normalizedSentence = String(sentence || '').trim().replace(/\s+/g, ' ').slice(0, 260);
    const key = 'reading:' + this.articleContext.id + ':' + encodeURIComponent(normalizedSentence);
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

    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        renderHistory();
        input.focus();
      }
    });

    const submit = async () => {
      const question = input.value.trim();
      if (!question || send.disabled) return;
      if (!Config.hasApiKey()) {
        Modal.showApiSettings();
        return;
      }

      const list = modal.querySelector('#aiFollowupMessages');
      const context = this.articleContext;
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
          pageContext: { article: { id: context.id, title: context.title }, sentence, paragraph: context.paragraph, analysis }
        });
        list.querySelector('.ai-followup-thinking')?.remove();
        conversationStore.append(key, { role: 'user', kind: 'text', content: question });
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
          this.updateParagraphContext(range.commonAncestorContainer);
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
