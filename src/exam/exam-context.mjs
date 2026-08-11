import { SUPPORTED_EXAM_IDS } from './constants.mjs';

const MATCHING_VARIANT_LABELS = Object.freeze({
  sentence_insertion: '句子插入',
  heading_matching: '小标题匹配',
  statement_matching: '观点匹配',
  banked_cloze: '选词填空',
  long_reading: '长篇阅读'
});

function examKeyOf(context) {
  const value = context || {};
  return `${value.examId || ''} ${value.bankId || ''}`;
}

export function isCet4Context(context) {
  return /cet4|四级/i.test(examKeyOf(context));
}

export function matchingVariantLabel(unit) {
  return MATCHING_VARIANT_LABELS[unit?.matchingVariant] || '匹配题';
}

export function unitLabel(unit, context = {}) {
  if (!unit) return '真题练习';
  if (unit.type === 'cloze_choice') return '完形填空';
  if (unit.type === 'paragraph_ordering') return '段落排序';
  if (unit.type === 'matching') return matchingVariantLabel(unit);
  if (unit.type === 'translation') return isCet4Context(context) ? '汉译英' : '翻译';
  if (unit.type === 'reading_mcq') {
    const title = unit.displayTitle ? ` · ${unit.displayTitle}` : '';
    return isCet4Context(context) ? `仔细阅读${title}` : `阅读理解${title}`;
  }
  return unit.displayTitle || '真题训练';
}

export function sectionLabelOf(unit, context = {}) {
  if (unit?.sectionLabel) return unit.sectionLabel;
  const cet4 = isCet4Context(context);
  if (unit?.type === 'cloze_choice') return 'Section I';
  if (unit?.type === 'reading_mcq') return cet4 ? 'Section C' : 'Section II Part A';
  if (['paragraph_ordering', 'matching'].includes(unit?.type)) {
    if (cet4) return unit?.matchingVariant === 'banked_cloze' ? 'Section A' : 'Section B';
    return 'Section II Part B';
  }
  if (unit?.type === 'translation') return cet4 ? 'Part IV' : 'Section II Part C';
  return '';
}

export function examDisplayName(examId, bankId) {
  if (/cet4|四级/i.test(`${examId || ''} ${bankId || ''}`)) return '英语四级';
  return '考研英语一';
}

export function resolveExamIdForBank(bankId) {
  const text = String(bankId || '');
  if (/cet4|四级/i.test(text)) return 'cet4';
  if (/kaoyan|en1|英语一/i.test(text)) return 'kaoyan_en1';
  return null;
}

const ACTIVE_BANK_KEY = 'exam_active_bank_id';

export function persistActiveBankId(bankId) {
  try {
    localStorage.setItem(ACTIVE_BANK_KEY, String(bankId || ''));
  } catch {}
}

export function readActiveBankId() {
  try {
    return String(localStorage.getItem(ACTIVE_BANK_KEY) || '');
  } catch {
    return '';
  }
}

export async function resolveAttemptExam(services, attemptId) {
  for (const examId of SUPPORTED_EXAM_IDS) {
    try {
      const attempt = await services.stateRepository.getAttempt({ examId, attemptId });
      if (attempt) return examId;
    } catch {}
  }
  return null;
}

export function listAcrossExams(fn, examIds = SUPPORTED_EXAM_IDS) {
  return Promise.all([...examIds].map(examId => fn(examId).catch(() => [])))
    .then(groups => groups.flat());
}
