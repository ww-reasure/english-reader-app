import { renderLearningMarkdown } from '../components/rich-text.js';
import { esc } from '../helpers.js';
import { EXAM_TUTOR_INITIAL_PROMPT } from './exam-tutor-service.mjs';
import { SelectableTextActions } from './selectable-text-actions.mjs';

export class ExamTutorDialog {
  constructor({ tutorService }) {
    this.tutorService = tutorService;
    this.overlay = null;
    this.pendingMessage = '';
    this.loading = false;
    this.quote = null;
    this.isTranslation = false;
  }

  renderHistory() {
    const list = this.overlay?.querySelector('#examTutorMessages');
    if (!list || !this.input) return;
    const session = this.tutorService.getConversation(this.input).session;
    list.innerHTML = session.messages
      .filter(message => message?.kind === 'text' || message?.kind === 'translation_training_feedback')
      .map(message => {
        const isFeedback = message?.kind === 'translation_training_feedback';
        const source = isFeedback ? 'ai_feedback' : message.role === 'assistant' ? 'ai_message' : 'question';
        return `<div data-selection-source="${source}" class="exam-tutor-message is-${message.role === 'user' ? 'user' : 'assistant'}">${message.role === 'assistant' ? renderLearningMarkdown(message.content) : `<p>${esc(message.content)}</p>`}</div>`;
      })
      .join('');
    list.scrollTop = list.scrollHeight;
  }

  open(input) {
    if (this.overlay) {
      this.setQuote(input?.quote);
      this.input = { ...this.input, ...input, quote: input?.quote || this.quote };
      this.isTranslation = this.input?.unit?.type === 'translation' || this.input?.question?.type === 'translation_segment';
      return;
    }
    if (!input?.question) return;
    this.input = input;
    this.quote = input.quote || null;
    this.isTranslation = input?.unit?.type === 'translation' || input?.question?.type === 'translation_segment';
    const conversation = this.tutorService.getConversation(input);
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay exam-tutor-overlay';
    this.overlay.innerHTML = `
      <div class="modal exam-tutor-modal" role="dialog" aria-modal="true" aria-labelledby="examTutorTitle">
        <div class="exam-tutor-modal-header"><div><p class="page-eyebrow">EXAM TUTOR</p><h2 id="examTutorTitle">${this.isTranslation ? '这段翻译的学习辅导' : '这道题的学习辅导'}</h2></div><button id="examTutorClose" class="app-icon-button" type="button" aria-label="关闭">×</button></div>
        <div id="examTutorQuote" class="exam-tutor-quote" hidden><span>引用：</span><q id="examTutorQuoteText"></q></div>
        <div id="examTutorMessages" class="exam-tutor-messages" aria-live="polite"></div>
        <p id="examTutorError" class="exam-tutor-error" hidden></p>
        <div class="exam-tutor-compose"><textarea id="examTutorInput" rows="2" placeholder="${this.isTranslation ? '关于这段内容，你想问什么？' : '继续追问这道题…'}"></textarea><button id="examTutorSend" class="btn btn-primary" type="button">发送</button></div>
        <button id="examTutorRetry" class="btn btn-outline btn-sm exam-tutor-retry" type="button" hidden>重新发送</button>
      </div>`;
    document.body.appendChild(this.overlay);
    this.selectionActions = new SelectableTextActions({
      root: this.overlay,
      onAskAI: quote => this.setQuote(quote)
    });
    this.selectionActions.bind();
    this.overlay.querySelector('#examTutorClose').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', event => {
      if (event.target === this.overlay) this.close();
    });
    this.overlay.querySelector('#examTutorSend').addEventListener('click', () => {
      this.send(this.overlay.querySelector('#examTutorInput').value);
    });
    this.overlay.querySelector('#examTutorInput').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.send(event.currentTarget.value);
      }
    });
    this.overlay.querySelector('#examTutorRetry').addEventListener('click', () => this.send(this.pendingMessage));
    this.renderHistory();
    this.setQuote(this.quote);
    const hasMessages = conversation.session.messages.some(message => message?.kind === 'text' || message?.kind === 'translation_training_feedback');
    if (!hasMessages && !this.isTranslation) this.send(EXAM_TUTOR_INITIAL_PROMPT);
  }

  close() {
    this.selectionActions?.destroy();
    this.selectionActions = null;
    this.overlay?.remove();
    this.overlay = null;
    this.pendingMessage = '';
    this.quote = null;
    this.isTranslation = false;
  }

  destroy() {
    this.close();
    this.input = null;
  }

  setQuote(quote) {
    const selectedText = String(quote?.selectedText || '').trim();
    this.quote = selectedText ? { selectedText, selectedSource: String(quote?.selectedSource || 'question') } : null;
    const block = this.overlay?.querySelector('#examTutorQuote');
    const text = this.overlay?.querySelector('#examTutorQuoteText');
    if (!block || !text) return;
    text.textContent = this.quote?.selectedText || '';
    block.hidden = !this.quote;
  }

  async send(message) {
    const text = String(message || '').trim();
    if (!text || !this.overlay || this.loading) return;
    const input = this.overlay.querySelector('#examTutorInput');
    const send = this.overlay.querySelector('#examTutorSend');
    const retry = this.overlay.querySelector('#examTutorRetry');
    const error = this.overlay.querySelector('#examTutorError');
    const list = this.overlay.querySelector('#examTutorMessages');
    this.loading = true;
    this.pendingMessage = text;
    input.value = '';
    input.disabled = true;
    send.disabled = true;
    retry.hidden = true;
    error.hidden = true;
    list.insertAdjacentHTML('beforeend', '<div class="exam-tutor-loading" aria-label="正在生成">正在分析这道题…</div>');
    list.scrollTop = list.scrollHeight;
    try {
      await this.tutorService.ask({ ...this.input, userMessage: text, quote: this.quote });
      this.renderHistory();
      this.pendingMessage = '';
      this.setQuote(null);
    } catch (requestError) {
      error.textContent = `暂时无法回答：${requestError.message || '请求失败'}`;
      error.hidden = false;
      retry.hidden = false;
      input.value = text;
    } finally {
      list.querySelector('.exam-tutor-loading')?.remove();
      this.loading = false;
      input.disabled = false;
      send.disabled = false;
      if (!error.hidden) retry.hidden = false;
      input.focus();
    }
  }
}
