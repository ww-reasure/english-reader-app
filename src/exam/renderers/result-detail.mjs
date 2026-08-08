const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

function section(title, body, field) {
  if (!body) return '';
  const source = ({ 'Stem Analysis': 'stem_analysis', 'Option Translations': 'option_translations', 'Option Analysis': 'option_analysis', Evidence: 'evidence', 'Evidence Translation': 'evidence_translation', Explanation: 'explanation' })[field] || field?.toLowerCase().replace(/\s+/g, '_');
  return `<section class="exam-explanation-section"${field ? ` data-field="${field}"` : ''}${source ? ` data-selection-source="${source}"` : ''}><h4>${title}</h4>${body}</section>`;
}

function candidateTranslationDetail(unit, key, label) {
  const translation = unit?.candidateTranslations?.find(item => item.key === key);
  if (!translation) return '';
  return `<details class="exam-candidate-translation"><summary>${esc(label)}中文翻译 · ${esc(key)}</summary><p>${esc(translation.text)}</p></details>`;
}

function orderingSequence(unit, responses) {
  const responseByKey = new Map((responses || []).map(response => [response.questionKey, response]));
  return (unit?.answerSequence || []).map(position => {
    const fixed = unit.fixedPlacements?.find(item => item.position === position);
    if (fixed) return fixed.candidateKey;
    const slot = unit.slots?.find(item => item.position === position);
    return slot ? (responseByKey.get(slot.questionKey)?.answer || '?') : '?';
  });
}

export function renderResultDetail(question, response, { unit = null, optionOrder = null, candidateOrder = null, responses = null, includeSummary = true, showEvidenceNavigation = true } = {}) {
  const userAnswer = response?.answer || '未作答';
  const correctAnswer = response?.correctOptionKeyAtSubmit || question.answer || '—';
  const questionType = question.questionType ? `<p>${esc(question.questionType)}</p>` : '';
  const stemAnalysis = question.stemAnalysis ? `<p>${esc(question.stemAnalysis).replace(/\n/g, '<br>')}</p>` : '';
  const location = question.location ? `<p>${esc(question.location)}</p>` : '';
  const evidence = question.evidence ? `<p>${esc(question.evidence)}</p>` : '';
  const evidenceTranslation = question.evidenceTranslation ? `<p>${esc(question.evidenceTranslation)}</p>` : '';
  const optionTranslations = Array.isArray(question.optionTranslations) && question.optionTranslations.length
    ? `<ul>${question.optionTranslations.map(item => `<li><b>${esc(item.key)}</b> ${esc(item.text)}</li>`).join('')}</ul>`
    : '';
  const optionAnalysis = Array.isArray(question.optionAnalysis) && question.optionAnalysis.length
    ? `<ul class="exam-option-analysis">${question.optionAnalysis.map(item => {
      const isCorrect = item.key === correctAnswer;
      const isUserAnswer = item.key === response?.answer;
      const state = isCorrect ? 'is-correct' : isUserAnswer ? 'is-user-answer' : '';
      const correctMark = isCorrect && !String(item.text || '').trim().startsWith('✓') ? ' ✓' : '';
      return `<li class="${state}"><b>${esc(item.key)}${correctMark}</b> ${esc(item.text)}</li>`;
    }).join('')}</ul>`
    : '';
  const originalOptions = Array.isArray(question.options) && question.options.length
    ? `<section class="exam-original-options" data-selection-source="option_original"><h4>原选项</h4><ul>${(optionOrder || question.options.map(option => option.key)).map(key => {
      const option = question.options.find(item => item.key === key);
      if (!option) return '';
      const isCorrect = key === correctAnswer;
      const isUserAnswer = key === response?.answer;
      const state = isCorrect ? 'is-correct' : isUserAnswer ? 'is-user-answer' : '';
      const marks = [isUserAnswer ? '我的答案' : '', isCorrect ? '正确答案' : ''].filter(Boolean).join(' · ');
      return `<li class="${state}" data-option-key="${esc(key)}"><b>${esc(key)}</b> ${esc(option.text)}${marks ? ` <span class="exam-option-marker">（${esc(marks)}）</span>` : ''}</li>`;
    }).join('')}</ul></section>`
    : '';
  const candidateTranslationHtml = unit?.type === 'paragraph_ordering'
    ? `${candidateTranslationDetail(unit, userAnswer, userAnswer === correctAnswer ? '候选段' : '我的候选段')}${userAnswer !== correctAnswer ? candidateTranslationDetail(unit, correctAnswer, '正确候选段') : ''}`
    : '';
  const candidateOrderHtml = unit?.type === 'paragraph_ordering' && Array.isArray(unit.candidates)
    ? `<section class="exam-original-options exam-original-candidates"><h4>原候选段</h4><p><strong>我的顺序：</strong>${esc(orderingSequence(unit, responses || [response]).join(' → '))}</p><p><strong>正确顺序：</strong>${esc(unit.answerSequence?.join(' → ') || '')}</p><ul>${(candidateOrder || unit.candidates.map(candidate => candidate.candidateKey)).map(key => {
      const candidate = unit.candidates.find(item => item.candidateKey === key);
      return `<li data-candidate-key="${esc(key)}"><b>${esc(key)}</b> ${esc(candidate?.text || '')}</li>`;
    }).join('')}</ul></section>`
    : '';

  return `
    ${includeSummary ? `<div class="exam-explanation-summary">
      <p><strong>我的答案：</strong>${esc(userAnswer)}</p>
      <p><strong>正确答案：</strong>${esc(correctAnswer)}</p>
      ${question.questionType ? `<p><strong>题型：</strong>${esc(question.questionType)}</p>` : ''}
      ${response?.uncertain ? '<p class="exam-uncertain-note">? 作答时标记为不确定</p>' : ''}
    </div>` : ''}
    <div class="exam-explanation-sections">
      ${section('题干翻译', question.questionTranslation ? `<p data-selection-source="question_translation">${esc(question.questionTranslation)}</p>` : '')}
      ${originalOptions}
      ${candidateOrderHtml}
      ${questionType || stemAnalysis ? section('解题分析', `${questionType}${stemAnalysis ? `<div data-field="Stem Analysis">${stemAnalysis}</div>` : ''}`) : ''}
      ${location || evidence || evidenceTranslation ? section('定位原文', `${location ? `<div data-field="Location" data-selection-source="location"><h5>Location</h5>${location}</div>` : ''}${evidence ? `<div data-field="Evidence" data-selection-source="evidence"><h5>Evidence</h5>${evidence}</div>` : ''}${evidenceTranslation ? `<div data-field="Evidence Translation" data-selection-source="evidence_translation"><h5>Evidence Translation</h5>${evidenceTranslation}</div>` : ''}${showEvidenceNavigation && question.location ? `<button type="button" class="btn btn-outline btn-sm exam-jump-evidence" data-location="${esc(question.location)}">在原文中查看</button>` : ''}`, 'Location') : ''}
      ${optionTranslations ? section('选项翻译', optionTranslations, 'Option Translations') : ''}
      ${optionAnalysis ? section('选项分析', optionAnalysis, 'Option Analysis') : ''}
      ${section('解析', question.explanation ? `<p>${esc(question.explanation)}</p>` : '', 'Explanation')}
      ${candidateTranslationHtml}
    </div>`;
}
