const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));
import { renderResultDetail } from './result-detail.mjs';

function candidateText(unit, key) {
  return unit.candidates?.find(candidate => candidate.candidateKey === key)?.text || '';
}

function preview(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 56 ? `${clean.slice(0, 56)}…` : clean;
}

export const paragraphOrderingRenderer = {
  unitType: 'paragraph_ordering',

  renderArticle(unit, { responses, currentQuestionKey, resultMode = false }) {
    const byPosition = new Map();
    for (const fixed of unit.fixedPlacements || []) {
      byPosition.set(fixed.position, { fixed: true, candidateKey: fixed.candidateKey });
    }
    for (const slot of unit.slots || []) {
      byPosition.set(slot.position, { slot });
    }
    let html = '<div class="exam-ordering-sequence">';
    for (let position = 0; position < (unit.answerSequence || []).length; position += 1) {
      const entry = byPosition.get(position);
      if (entry?.fixed) {
        html += `<div class="exam-ordering-fixed" data-selection-source="passage">
          <span class="exam-ordering-position">${esc(entry.candidateKey)}</span>
          <p>${esc(candidateText(unit, entry.candidateKey))}</p>
        </div>`;
      } else if (entry?.slot) {
        const response = responses.get(entry.slot.questionKey);
        const answer = response?.answer ? ` · ${response.answer}` : '';
        const state = resultMode && response?.answer ? (response.correct ? 'is-correct' : 'is-wrong') : '';
        html += `<button type="button" class="exam-ordering-slot ${state} ${currentQuestionKey === entry.slot.questionKey ? 'is-current' : ''}" data-slot="${esc(entry.slot.questionKey)}" data-selection-source="passage">
          <span class="exam-ordering-position">${entry.slot.slotNumber}</span>
          <span>${answer ? `已选 ${answer}` : '待选择'}</span>
        </button>`;
      } else {
        html += `<div class="exam-ordering-gap"></div>`;
      }
    }
    html += '</div>';
    return html;
  },

  renderQuestion(question, { response, unit, responses, candidateOrder }) {
    const order = candidateOrder || (unit.candidates || []).map(candidate => candidate.candidateKey);
    const usedBy = new Map();
    for (const [key, value] of responses) {
      if (value?.answer && key !== question.questionKey) usedBy.set(value.answer, key);
    }
    const fixedKeys = new Set((unit.fixedPlacements || []).map(item => item.candidateKey));
    return `
      <div class="exam-ordering-candidates">
        ${order.map(key => {
          const candidate = unit.candidates?.find(item => item.candidateKey === key);
          const usedQuestionKey = usedBy.get(key);
          const usedLabel = usedQuestionKey
            ? `已用于 ${unit.slots?.find(slot => slot.questionKey === usedQuestionKey)?.slotNumber || '其他位置'}`
            : '';
          const disabled = Boolean(usedLabel) || fixedKeys.has(key);
          return `<details class="exam-ordering-candidate">
            <summary><b>${key}</b> ${esc(preview(candidate?.text))}</summary>
            <div class="exam-ordering-candidate-body">
              <p>${esc(candidate?.text)}</p>
              <button type="button" class="btn btn-outline btn-sm" data-key="${key}" ${disabled ? 'disabled' : ''}>
                ${usedLabel ? usedLabel : fixedKeys.has(key) ? '固定段落' : '选择此段'}
              </button>
            </div>
          </details>`;
        }).join('')}
      </div>`;
  },

  questionLabel(question) {
    return `${question.slotNumber}`;
  },

  resultDetailHtml(question, response, context) {
    return renderResultDetail(question, response, context);
  }
};
