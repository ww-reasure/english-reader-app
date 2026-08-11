import { renderResultDetail } from './result-detail.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function renderMarkedText(text, currentQuestionKey, unit) {
  return esc(text).replace(/\[(\d+)\]/g, (_, number) => {
    const slot = unit.slots?.find(item => item.slotNumber === Number(number));
    return `<button type="button" class="exam-matching-slot ${slot?.questionKey === currentQuestionKey ? 'is-current' : ''}" data-slot="${esc(slot?.questionKey)}">${number}</button>`;
  });
}

export const matchingRenderer = {
  unitType: 'matching',
  renderArticle(unit, { currentQuestionKey }) {
    const passages = (unit.passage || []).map(item => {
      const html = /\[\d+\]/.test(item.text || '') ? renderMarkedText(item.text, currentQuestionKey, unit) : esc(item.text);
      return `<p data-selection-source="passage">${html}</p>`;
    });
    return `<div class="exam-matching-passage">${passages.join('')}</div>`;
  },
  renderQuestion(question, { response, unit, responses, candidateOrder }) {
    const allowReuse = Boolean(unit?.allowCandidateReuse);
    const used = new Map([...responses].filter(([, value]) => value?.answer).map(([key, value]) => [value.answer, key]));
    const order = candidateOrder || (unit.candidates || []).map(item => item.candidateKey);
    const stem = question?.stem?.trim() ? `<p class="exam-question-stem">${esc(question.stem)}</p>` : '';
    return `${stem}<div class="exam-matching-candidates">${order.map(key => {
      const candidate = unit.candidates.find(item => item.candidateKey === key);
      const owner = used.get(key);
      const disabled = !allowReuse && owner && owner !== question.questionKey;
      return `<button type="button" class="exam-option ${disabled ? 'is-disabled' : ''}" data-key="${key}" ${disabled ? 'disabled' : ''}><b>${key}</b><span>${esc(candidate?.text)}</span>${disabled ? `<small>已用于 ${esc(owner.match(/q(\d+)$/)?.[1] || '其他题')}</small>` : ''}</button>`;
    }).join('')}</div>`;
  },
  questionLabel(question) { return `Q${question.slotNumber}`; },
  resultDetailHtml(question, response, context) { return renderResultDetail(question, response, context); }
};
