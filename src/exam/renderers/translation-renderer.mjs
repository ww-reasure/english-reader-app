const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function segmentNumber(question, index) {
  return String(question.segmentKey || '').replace(/^S/i, '') || String(index + 1);
}

function markSegments(text, questions, responses, currentQuestionKey, resultMode) {
  let html = esc(text);
  for (const [index, question] of questions.entries()) {
    const source = esc(question.sourceText);
    if (!source) continue;
    const response = responses?.get(question.questionKey);
    const state = resultMode && response?.value?.text?.trim() ? 'is-answered' : '';
    const button = `<button type="button" class="exam-translation-segment ${state} ${currentQuestionKey === question.questionKey ? 'is-current' : ''}" data-translation-segment="${esc(question.questionKey)}" data-selection-source="passage"><span class="exam-translation-segment-number">${segmentNumber(question, index)}</span>${source}</button>`;
    html = html.replace(source, button);
  }
  return html;
}

export const translationRenderer = {
  unitType: 'translation',

  renderArticle(unit, { responses = new Map(), currentQuestionKey, resultMode = false } = {}) {
    return (unit.passage || []).map(paragraph =>
      `<p class="exam-practice-paragraph" data-paragraph-key="${esc(paragraph.paragraphKey)}" data-selection-source="passage">${markSegments(paragraph.text, unit.questions || [], responses, currentQuestionKey, resultMode)}</p>`
    ).join('');
  },

  renderQuestion(question, { response } = {}) {
    const number = String(question.segmentKey || '').replace(/^S/i, '') || '';
    return `
      <div class="exam-translation-question">
        <div class="exam-question-head"><span class="exam-question-key">第 ${esc(number)} 处</span><span class="exam-question-points">${esc(question.points)} 分</span></div>
        <p class="exam-translation-source" data-selection-source="translation_source">${esc(question.sourceText)}</p>
        <label class="exam-translation-input-label" for="examTranslationInput">中文译文</label>
        <textarea id="examTranslationInput" class="exam-translation-input" data-translation-input rows="7" placeholder="请输入你的中文译文">${esc(response?.value?.text || '')}</textarea>
      </div>`;
  },

  questionLabel(question, index) {
    return `第 ${segmentNumber(question, index)} 处`;
  },

  resultDetailHtml(question, response) {
    const user = response?.value?.text?.trim() || '未填写';
    const fields = [];
    fields.push(`<section class="exam-translation-result-section" data-selection-source="translation_source"><h4>原文</h4><p>${esc(question.sourceText)}</p></section>`);
    fields.push(`<section class="exam-translation-result-section" data-selection-source="user_translation"><h4>我的译文</h4><p>${esc(user).replace(/\n/g, '<br>')}</p></section>`);
    if (question.referenceTranslation) fields.push(`<section class="exam-translation-result-section" data-selection-source="reference_translation"><h4>参考译文</h4><p>${esc(question.referenceTranslation).replace(/\n/g, '<br>')}</p></section>`);
    if (question.localAnalysis) fields.push(`<section class="exam-translation-result-section" data-selection-source="local_analysis"><h4>本地解析</h4><p>${esc(question.localAnalysis).replace(/\n/g, '<br>')}</p></section>`);
    return fields.join('');
  }
};
