import { renderResultDetail } from './result-detail.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function renderMarkedText(text, currentQuestionKey, unit) {
  return esc(text).replace(/\[(4[1-5])\]/g, (_, number) => {
    const slot = unit.slots?.find(item => item.slotNumber === Number(number));
    return `<button type="button" class="exam-matching-slot ${slot?.questionKey === currentQuestionKey ? 'is-current' : ''}" data-slot="${esc(slot?.questionKey)}">${number}</button>`;
  });
}

export const matchingRenderer = {
  unitType: 'matching',
  renderArticle(unit, { currentQuestionKey }) {
    return `<div class="exam-matching-passage">${(unit.passage || []).map(item => `<p data-selection-source="passage">${renderMarkedText(item.text, currentQuestionKey, unit)}</p>`).join('')}</div>`;
  },
  renderQuestion(question, { response, unit, responses, candidateOrder }) {
    const used = new Map([...responses].filter(([, value]) => value?.answer).map(([key, value]) => [value.answer, key]));
    const order = candidateOrder || (unit.candidates || []).map(item => item.candidateKey);
    return `<div class="exam-matching-candidates">${order.map(key => {
      const candidate = unit.candidates.find(item => item.candidateKey === key);
      const owner = used.get(key);
      const disabled = owner && owner !== question.questionKey;
      return `<button type="button" class="exam-option" data-key="${key}" ${disabled ? 'disabled' : ''}><b>${key}</b><span>${esc(candidate?.text)}</span>${disabled ? `<small>已用于 ${esc(owner.match(/q(\d+)$/)?.[1] || '其他题')}</small>` : ''}</button>`;
    }).join('')}</div>`;
  },
  questionLabel(question) { return `Q${question.slotNumber}`; },
  resultDetailHtml(question, response, context) { return renderResultDetail(question, response, context); }
};
