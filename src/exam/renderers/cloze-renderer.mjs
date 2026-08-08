const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));
import { renderResultDetail } from './result-detail.mjs';

const BLANK_MARKER = /\[(\d+)\]/g;

function renderParagraph(paragraph, questions, responses, currentQuestionKey, resultMode = false) {
  const byBlank = new Map(questions.map(question => [question.blankNumber, question]));
  const parts = String(paragraph.text || '').split(BLANK_MARKER);
  let html = '';
  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 0) {
      html += esc(parts[index]);
      continue;
    }
    const blankNumber = Number(parts[index]);
    const question = byBlank.get(blankNumber);
    if (!question) {
      html += `[${blankNumber}]`;
      continue;
    }
    const response = responses.get(question.questionKey);
    const label = response?.answer ? `[${blankNumber} · ${response.answer}]` : `[${blankNumber}]`;
    const stateClass = response?.answer
      ? resultMode ? (response.correct ? 'is-correct' : 'is-wrong') : 'is-answered'
      : 'is-unanswered';
    html += `<button type="button" class="exam-cloze-blank ${stateClass} ${currentQuestionKey === question.questionKey ? 'is-current' : ''}" data-blank="${esc(question.questionKey)}">${label}</button>`;
  }
  return html;
}

export const clozeRenderer = {
  unitType: 'cloze_choice',

  renderArticle(unit, { responses, currentQuestionKey, resultMode = false }) {
    return (unit.passage || []).map(paragraph =>
      `<p class="exam-practice-paragraph" data-paragraph-key="${esc(paragraph.paragraphKey)}" data-selection-source="passage">${renderParagraph(paragraph, unit.questions, responses, currentQuestionKey, resultMode)}</p>`
    ).join('');
  },

  renderQuestion(question, { response, optionOrder }) {
    const order = optionOrder || (question.options || []).map(option => option.key);
    return `
      <div class="exam-question-head">
        <span class="exam-question-key">第 ${question.blankNumber} 空</span>
        <span class="exam-question-points">${question.points} 分</span>
      </div>
      <div class="exam-options exam-cloze-options">
        ${order.map(key => {
          const option = question.options.find(item => item.key === key);
          return `<button type="button" class="exam-option ${response?.answer === key ? 'is-selected' : ''}" data-key="${key}">
            <span class="exam-option-key">${key}</span><span>${esc(option.text)}</span>
          </button>`;
        }).join('')}
      </div>`;
  },

  questionLabel(question) {
    return `第 ${question.blankNumber} 空`;
  },

  resultDetailHtml(question, response, context) {
    return renderResultDetail(question, response, context);
  }
};
