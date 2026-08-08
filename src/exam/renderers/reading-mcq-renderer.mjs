const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));
import { renderResultDetail } from './result-detail.mjs';

export const readingMcqRenderer = {
  unitType: 'reading_mcq',

  renderArticle(unit) {
    return (unit.passage || []).map(paragraph =>
      `<p class="exam-practice-paragraph" data-paragraph-key="${esc(paragraph.paragraphKey)}" data-selection-source="passage">${esc(paragraph.text)}</p>`
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
