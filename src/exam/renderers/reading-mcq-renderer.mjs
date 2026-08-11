const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));
import { renderResultDetail } from './result-detail.mjs';

function translationFor(unit, paragraphKey) {
  return (unit.translation || []).find(item => item.paragraphKey === paragraphKey)?.text || '';
}

function paragraphTranslationHtml(unit, paragraph, { resultMode = false, translationState = null } = {}) {
  if (!resultMode) return '';
  const state = translationState?.get?.(paragraph.paragraphKey) || {};
  const storedText = translationFor(unit, paragraph.paragraphKey);
  const translation = String(state.text ?? storedText ?? '').trim();
  const status = state.status || (translation ? 'ready' : 'idle');
  const expanded = translation && state.expanded !== false && status !== 'error';
  const label = status === 'loading' ? '…' : status === 'error' ? '重试' : '译';
  const translationId = `exam-paragraph-translation-${esc(paragraph.paragraphKey)}`;
  const body = translation
    ? `<span id="${translationId}" class="exam-paragraph-translation" data-paragraph-translation="${esc(paragraph.paragraphKey)}" data-word-lookup="disabled" ${expanded ? '' : 'hidden'}>${esc(translation)}</span>`
    : status === 'error'
      ? `<span id="${translationId}" class="exam-paragraph-translation is-error" data-paragraph-translation="${esc(paragraph.paragraphKey)}" data-word-lookup="disabled">暂时无法翻译，请重试</span>`
      : '';
  return `
    <button type="button" class="exam-paragraph-translation-toggle ${expanded ? 'is-expanded' : ''}" data-paragraph-translation-toggle data-paragraph-key="${esc(paragraph.paragraphKey)}" aria-controls="${translationId}" aria-expanded="${Boolean(expanded)}" ${status === 'loading' ? 'disabled' : ''}>${label}</button>
    ${body}`;
}

export const readingMcqRenderer = {
  unitType: 'reading_mcq',

  renderArticle(unit, { resultMode = false, paragraphTranslationState = null } = {}) {
    return (unit.passage || []).map(paragraph =>
      `<p class="exam-practice-paragraph" data-paragraph-key="${esc(paragraph.paragraphKey)}" data-selection-source="passage">${esc(paragraph.text)}${paragraphTranslationHtml(unit, paragraph, { resultMode, translationState: paragraphTranslationState })}</p>`
    ).join('');
  },

  renderQuestion(question, { response, optionOrder }) {
    const order = optionOrder || (question.options || []).map(option => option.key);
    return `
      <p class="exam-question-stem">${esc(question.stem)}</p>
      <div class="exam-options">
        ${order.map(key => {
          const option = question.options.find(item => item.key === key);
          return `<button type="button" class="exam-option ${response?.answer === key ? 'is-selected' : ''}" data-key="${key}">
            <span class="exam-option-key">${key}</span><span>${esc(option.text)}</span>
          </button>`;
        }).join('')}
      </div>`;
  },

  questionLabel(question, index) {
    const sourceNumber = String(question.questionKey || '').match(/_q(\d+)$/i)?.[1];
    return `Q${sourceNumber || index + 1}`;
  },

  resultDetailHtml(question, response, context) {
    return renderResultDetail(question, response, context);
  }
};
