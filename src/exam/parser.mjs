import { EXAM_CANONICAL_SCHEMA_VERSION, EXAM_MD_SCHEMA } from './constants.mjs';
import { assertCanonicalPaper } from './schema.mjs';

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const OPTION_PATTERN = /^[-*]\s*([A-H])([.):])\s+(.+)$/;
const QUESTION_HEADING_PATTERN = /^Q\d+$/;
const BLANK_HEADING_PATTERN = /^Blank\s+(\d+)$/;
const SLOT_HEADING_PATTERN = /^Slot\s+(\d+)$/;
const CANDIDATE_HEADING_PATTERN = /^Candidate\s+([A-P])$/;

const QUESTION_FIELDS = Object.freeze({
  'Question Translation': 'questionTranslation',
  'Question Type': 'questionType',
  'Stem Analysis': 'stemAnalysis',
  'Location': 'location',
  'Evidence': 'evidence',
  'Evidence Translation': 'evidenceTranslation',
  'Explanation': 'explanation',
  'Option Analysis': 'optionAnalysis',
  'Option Translations': 'optionTranslations'
});

function headingOf(line) {
  const match = HEADING_PATTERN.exec(line);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function appendText(existing, next, separator = ' ') {
  const clean = String(next || '').replace(/\s+/g, ' ').trim();
  if (!clean) return existing;
  return existing ? `${existing}${separator}${clean}` : clean;
}

function parseOptionLine(line) {
  const match = OPTION_PATTERN.exec(line);
  return match ? { key: match[1], text: match[3].trim() } : null;
}

function parseJsonBlock(lines, startIndex, label) {
  const blockLines = [];
  let index = startIndex + 1;
  while (index < lines.length && !lines[index].trimStart().startsWith('```')) {
    blockLines.push(lines[index]);
    index += 1;
  }
  try {
    return { value: JSON.parse(blockLines.join('\n')), endIndex: index };
  } catch (error) {
    throw new Error(`${label} JSON 解析失败：${error.message}`);
  }
}

function finalizeQuestion(state) {
  if (!state.currentQuestion) return;
  if (state.currentUnit) state.currentUnit.questions.push(state.currentQuestion);
  state.currentQuestion = null;
  state.questionField = null;
}

function finalizeUnit(state) {
  if (state.currentUnit) state.units.push(state.currentUnit);
  state.currentUnit = null;
  state.section = null;
  state.paragraphKey = null;
  state.unitField = null;
  state.questionField = null;
}

function startUnit(state, headingText) {
  finalizeQuestion(state);
  finalizeUnit(state);
  state.currentUnit = {
    displayTitle: headingText,
    meta: null,
    directions: '',
    passage: [],
    translation: [],
    candidates: [],
    candidateTranslations: [],
    questions: []
  };
  state.section = 'unit';
  state.unitField = null;
  state.paragraphKey = null;
}

function startQuestion(state, headingText) {
  finalizeQuestion(state);
  state.currentQuestion = {
    heading: headingText,
    meta: null,
    stem: '',
    sourceText: '',
    referenceTranslation: '',
    localAnalysis: '',
    stemAnalysis: '',
    options: [],
    questionTranslation: '',
    questionType: '',
    location: '',
    evidence: '',
    evidenceTranslation: '',
    explanation: '',
    optionAnalysis: [],
    optionTranslations: []
  };
  const blankMatch = BLANK_HEADING_PATTERN.exec(headingText);
  const slotMatch = SLOT_HEADING_PATTERN.exec(headingText);
  if (blankMatch) state.currentQuestion.blankNumber = Number(blankMatch[1]);
  if (slotMatch) state.currentQuestion.slotNumber = Number(slotMatch[1]);
  state.section = 'question';
  state.questionField = null;
}

function appendQuestionText(question, field, text) {
  if (field === 'optionAnalysis') {
    const option = parseOptionLine(text);
    if (!option) return;
    const existing = question.optionAnalysis.find(item => item.key === option.key);
    if (existing) existing.text = appendText(existing.text, option.text);
    else question.optionAnalysis.push({ key: option.key, text: option.text });
    return;
  }
  if (field === 'optionTranslations') {
    const option = parseOptionLine(text);
    if (!option) return;
    const existing = question.optionTranslations.find(item => item.key === option.key);
    if (existing) existing.text = appendText(existing.text, option.text);
    else question.optionTranslations.push({ key: option.key, text: option.text });
    return;
  }
  if (field) question[field] = appendText(question[field], text, '\n');
  else question.stem = appendText(question.stem, text);
}

function buildCanonicalPaper({ meta, title, units }) {
  if (!meta || typeof meta !== 'object') throw new Error('exam-meta 缺失');
  if (meta.schema !== EXAM_MD_SCHEMA) throw new Error(`exam-meta.schema 必须为 ${EXAM_MD_SCHEMA}`);
  if (!units.length) throw new Error('未找到任何 unit');

  const buildQuestion = question => {
      if (!question.meta || typeof question.meta !== 'object') {
      throw new Error(`question 缺少 exam-item 元数据：${question.heading}`);
    }
    if (question.meta.type === 'translation_segment') {
      const translationQuestion = {
        questionKey: question.meta.questionKey,
        segmentKey: question.meta.segmentKey,
        type: question.meta.type,
        points: Number(question.meta.points),
        sourceText: question.sourceText.trim(),
        location: question.location
      };
      if (question.referenceTranslation.trim()) translationQuestion.referenceTranslation = question.referenceTranslation.trim();
      if (question.localAnalysis.trim()) translationQuestion.localAnalysis = question.localAnalysis.trim();
      return translationQuestion;
    }
    const built = {
      questionKey: question.meta.questionKey,
      type: question.meta.type,
      points: Number(question.meta.points),
      answer: question.meta.answer,
      stem: question.stem.trim(),
      options: question.options,
      questionTranslation: question.questionTranslation,
      questionType: question.questionType,
      location: question.location,
      evidence: question.evidence,
      explanation: question.explanation,
      optionAnalysis: question.optionAnalysis,
      blankNumber: question.blankNumber || null,
      slotNumber: question.slotNumber || null
    };
    if (question.stemAnalysis.trim()) built.stemAnalysis = question.stemAnalysis.trim();
    if (question.evidenceTranslation.trim()) built.evidenceTranslation = question.evidenceTranslation.trim();
    if (question.optionTranslations.length) built.optionTranslations = question.optionTranslations;
    return built;
  };

  const carryUnitMeta = (target, meta) => {
    if (meta.sectionLabel !== undefined) target.sectionLabel = meta.sectionLabel;
    if (meta.sectionOrder !== undefined) target.sectionOrder = meta.sectionOrder;
    if (meta.direction !== undefined) target.direction = meta.direction;
    if (meta.allowCandidateReuse !== undefined) target.allowCandidateReuse = Boolean(meta.allowCandidateReuse);
    return target;
  };

  const buildOrderingUnit = unit => {
    const meta = unit.meta;
    const slotNumbers = Array.isArray(meta.slots) ? meta.slots : [];
    const fixedPlacements = Array.isArray(meta.fixed) ? meta.fixed : [];
    const answerSequence = Array.isArray(meta.answerSequence) ? meta.answerSequence : [];
    const fixedPositions = new Set(fixedPlacements.map(item => item.position));
    let cursor = 0;
    const slots = slotNumbers.map(slotNumber => {
      while (fixedPositions.has(cursor)) cursor += 1;
      const question = unit.questions.find(item => item.slotNumber === Number(slotNumber));
      const position = cursor;
      cursor += 1;
      return {
        slotNumber: Number(slotNumber),
        position,
        questionKey: question?.meta?.questionKey || null
      };
    });
    return carryUnitMeta({
      unitKey: meta.unitKey,
      type: meta.type,
      displayTitle: meta.displayTitle || unit.displayTitle,
      ...(unit.directions.trim() ? { directions: unit.directions.trim() } : {}),
      passage: unit.passage,
      translation: unit.translation,
      candidates: unit.candidates,
      ...(unit.candidateTranslations.length ? { candidateTranslations: unit.candidateTranslations } : {}),
      slots,
      fixedPlacements,
      answerSequence,
      questions: unit.questions.map(buildQuestion)
    }, meta);
  };

  const buildMatchingUnit = unit => carryUnitMeta({
    unitKey: unit.meta.unitKey,
    type: unit.meta.type,
    displayTitle: unit.meta.displayTitle || unit.displayTitle,
    matchingVariant: unit.meta.matchingVariant,
    ...(unit.directions.trim() ? { directions: unit.directions.trim() } : {}),
    passage: unit.passage,
    translation: unit.translation,
    candidates: unit.candidates,
    ...(unit.candidateTranslations.length ? { candidateTranslations: unit.candidateTranslations } : {}),
    slots: (unit.meta.slots || []).map((slotNumber, position) => {
      const question = unit.questions.find(item => item.slotNumber === Number(slotNumber));
      return { slotNumber: Number(slotNumber), position, questionKey: question?.meta?.questionKey || null };
    }),
    questions: unit.questions.map(buildQuestion)
  }, unit.meta);

  const paper = {
    schemaVersion: EXAM_CANONICAL_SCHEMA_VERSION,
    examId: meta.examId,
    bankId: meta.bankId,
    packageId: meta.packageId,
    packageVersion: meta.packageVersion,
    paperKey: meta.paperKey,
    year: Number(meta.year),
    title: title || meta.paperKey,
    sourceType: meta.sourceType,
    units: units.map(unit => {
      if (!unit.meta || typeof unit.meta !== 'object') {
        throw new Error(`unit 缺少 exam-item 元数据：${unit.displayTitle}`);
      }
      const base = carryUnitMeta({
        unitKey: unit.meta.unitKey,
        type: unit.meta.type,
        displayTitle: unit.meta.displayTitle || unit.displayTitle,
        passage: unit.passage,
        translation: unit.translation
      }, unit.meta);
      if (unit.directions.trim()) base.directions = unit.directions.trim();
      if (unit.candidateTranslations.length) base.candidateTranslations = unit.candidateTranslations;
      if (unit.meta.type === 'paragraph_ordering') return buildOrderingUnit(unit);
      if (unit.meta.type === 'matching') return buildMatchingUnit(unit);
      return {
        ...base,
        questions: unit.questions.map(buildQuestion)
      };
    })
  };
  return assertCanonicalPaper(paper);
}

export function parseExamMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const state = {
    meta: null,
    title: '',
    units: [],
    currentUnit: null,
    currentQuestion: null,
    section: null,
    paragraphKey: null,
    unitField: null,
    questionField: null
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      if (language === 'exam-meta' || language === 'exam-item') {
        const parsed = parseJsonBlock(lines, index, language);
        index = parsed.endIndex;
        if (language === 'exam-meta') {
          state.meta = parsed.value;
        } else if (parsed.value?.unitKey) {
          if (!state.currentUnit) throw new Error('exam-item unit 必须位于 ### unit heading 之后');
          state.currentUnit.meta = parsed.value;
        } else if (parsed.value?.questionKey) {
          if (!state.currentQuestion) throw new Error('exam-item question 必须位于 #### Qxx heading 之后');
          state.currentQuestion.meta = parsed.value;
        } else {
          throw new Error('exam-item 必须包含 unitKey 或 questionKey');
        }
      }
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      if (heading.level === 1) {
        state.title = heading.text;
      } else if (heading.level === 3) {
        startUnit(state, heading.text);
      } else if (heading.level === 4) {
        const text = heading.text;
        if (text === 'Passage') {
          state.section = 'passage';
          state.unitField = null;
          state.paragraphKey = null;
        } else if (text === 'Passage Translation') {
          state.section = 'translation';
          state.unitField = null;
          state.paragraphKey = null;
        } else if (text === 'Directions') {
          state.section = 'unit';
          state.unitField = 'directions';
          state.paragraphKey = null;
        } else if (text === 'Candidate Translations') {
          state.section = 'candidateTranslations';
          state.unitField = null;
          state.paragraphKey = null;
        } else if (BLANK_HEADING_PATTERN.test(text) || SLOT_HEADING_PATTERN.test(text) || QUESTION_HEADING_PATTERN.test(text)) {
          startQuestion(state, text);
        } else if (CANDIDATE_HEADING_PATTERN.test(text)) {
          state.section = 'candidate';
          state.paragraphKey = text;
          const match = CANDIDATE_HEADING_PATTERN.exec(text);
          if (state.currentUnit && !state.currentUnit.candidates.some(item => item.candidateKey === match[1])) {
            state.currentUnit.candidates.push({ candidateKey: match[1], text: '' });
          }
        }
      } else if (heading.level === 5) {
        const text = heading.text;
        if (state.section === 'passage' || state.section === 'translation') {
          state.paragraphKey = text;
        } else if (state.section === 'question' && QUESTION_FIELDS[text]) {
          state.questionField = QUESTION_FIELDS[text];
        } else if (state.section === 'question' && ['Source Text', 'Reference Translation', 'Local Analysis'].includes(text)) {
          state.questionField = text === 'Source Text' ? 'sourceText' : text === 'Reference Translation' ? 'referenceTranslation' : 'localAnalysis';
        }
      }
      continue;
    }

    const text = line.trim();
    if (!text) continue;
    if (state.section === 'unit' && state.currentUnit && state.unitField === 'directions') {
      state.currentUnit.directions = appendText(state.currentUnit.directions, text, '\n');
    } else if (state.section === 'passage' && state.currentUnit && state.paragraphKey) {
      const paragraph = state.currentUnit.passage.find(item => item.paragraphKey === state.paragraphKey);
      if (paragraph) paragraph.text = appendText(paragraph.text, text);
      else state.currentUnit.passage.push({ paragraphKey: state.paragraphKey, text });
    } else if (state.section === 'translation' && state.currentUnit && state.paragraphKey) {
      const paragraph = state.currentUnit.translation.find(item => item.paragraphKey === state.paragraphKey);
      if (paragraph) paragraph.text = appendText(paragraph.text, text);
      else state.currentUnit.translation.push({ paragraphKey: state.paragraphKey, text });
    } else if (state.section === 'candidate' && state.currentUnit && state.paragraphKey) {
      const match = CANDIDATE_HEADING_PATTERN.exec(state.paragraphKey);
      const candidate = state.currentUnit.candidates.find(item => item.candidateKey === match?.[1]);
      if (candidate) candidate.text = appendText(candidate.text, text);
    } else if (state.section === 'candidateTranslations' && state.currentUnit) {
      const translation = parseOptionLine(text);
      if (translation) state.currentUnit.candidateTranslations.push({ key: translation.key, text: translation.text });
    } else if (state.section === 'question' && state.currentQuestion) {
      const option = parseOptionLine(text);
      if (option && !state.questionField) {
        const existing = state.currentQuestion.options.find(item => item.key === option.key);
        if (existing) existing.text = appendText(existing.text, option.text);
        else state.currentQuestion.options.push({ key: option.key, text: option.text });
      } else {
        appendQuestionText(state.currentQuestion, state.questionField, text);
      }
    }
  }

  finalizeQuestion(state);
  finalizeUnit(state);
  return buildCanonicalPaper({
    meta: state.meta,
    title: state.title,
    units: state.units
  });
}
