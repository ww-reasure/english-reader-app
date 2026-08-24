const SENTENCE_INSIGHTS = /(?:#{1,6}\s*|```(?:txt)?\s*)?(?:S\s*E\s*N\s*T\s*E\s*N\s*C\s*E\s+I\s*N\s*S\s*I\s*G\s*H\s*T\s*S|Sentence\s+Insights)(?=\s*(?:[·•]|句子精讲|##|```|$))/iu;
const HIGH_FREQUENCY = /(?:#{1,6}\s*|```(?:txt)?\s*)?(?:H\s*I\s*G\s*H\s*-?\s*F\s*R\s*E\s*Q\s*U\s*E\s*N\s*C\s*Y|High\s*-?\s*Frequency)(?=\s*(?:[·•]|真题高频词|##|```|$))/iu;
const OTHER_APPENDIX = /(?:#{1,6}\s*|```(?:txt)?\s*)?(?:V\s*O\s*C\s*A\s*B\s*U\s*L\s*A\s*R\s*Y\s*[·•]\s*词汇难度分布|(?:\d{4}\s*年)?考研英语一(?:阅读理解|选句填空|段落排序|英译汉|写作)|(?:阅读理解|选句填空|段落排序|英译汉|写作)(?:题和解析|真题|参考译文|题和范文))/iu;
const UNLABELED_SENTENCE_INSIGHTS = /```(?:txt)?\s*[\s\S]{0,800}?第\d+段[，,]第\d+句[\s\S]{0,1000}?```\s*##\s*\d+句真题句逐层精讲/iu;

function normalized(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function questionTypeOf(question) {
  return question?.type || question?.meta?.type || '';
}

export function teachingAppendixBoundaryIndex(value) {
  const source = String(value || '');
  const boundaries = [SENTENCE_INSIGHTS, HIGH_FREQUENCY, OTHER_APPENDIX, UNLABELED_SENTENCE_INSIGHTS]
    .map(pattern => pattern.exec(source)?.index)
    .filter(index => Number.isInteger(index));
  return boundaries.length ? Math.min(...boundaries) : -1;
}

export function hasTeachingAppendixMarker(value) {
  return teachingAppendixBoundaryIndex(value) >= 0;
}

export function trimOptionAnalysisTail(value) {
  const source = String(value || '');
  const boundary = teachingAppendixBoundaryIndex(source);
  return boundary >= 0 ? source.slice(0, boundary).trimEnd() : source.trim();
}

export function sanitizeOptionAnalysisItems(items, { label = '选项解析' } = {}) {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    const text = trimOptionAnalysisTail(item?.text);
    if (!text) throw new Error(`${label} 无法在教学附录前保留有效内容`);
    if (hasTeachingAppendixMarker(text)) throw new Error(`${label} 仍包含教学附录标记`);
    return { ...item, text };
  });
}

export function sanitizeReadingQuestionAnalyses(question, { label = '阅读题解析' } = {}) {
  if (question?.readingUnit !== true && questionTypeOf(question) !== 'reading_mcq') return question;
  const { readingUnit, ...result } = question;
  for (const field of ['stemAnalysis', 'explanation', 'evidence', 'evidenceTranslation']) {
    if (typeof result[field] !== 'string' || !hasTeachingAppendixMarker(result[field])) continue;
    const text = trimOptionAnalysisTail(result[field]);
    if (!text) throw new Error(`${label}.${field} 无法在教学附录前保留有效内容`);
    result[field] = text;
  }
  if (Array.isArray(result.optionAnalysis) && result.optionAnalysis.length) {
    result.optionAnalysis = sanitizeOptionAnalysisItems(result.optionAnalysis, { label: `${label}.optionAnalysis` });
  }
  return result;
}

export function sanitizeReadingUnitAnalyses(unit, { label = '阅读单元解析' } = {}) {
  if (unit?.type !== 'reading_mcq') return unit;
  return {
    ...unit,
    questions: (unit.questions || []).map(question => sanitizeReadingQuestionAnalyses({ ...question, readingUnit: true }, { label }))
  };
}
