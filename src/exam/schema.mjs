import {
  EXAM_CANONICAL_SCHEMA_VERSION,
  EXAM_PACK_SCHEMA_VERSION,
  CONTENT_HASH_PATTERN,
  STABLE_ID_PATTERN,
  SUPPORTED_EXAM_IDS,
  SUPPORTED_QUESTION_TYPES,
  SUPPORTED_SOURCE_TYPES,
  SUPPORTED_UNIT_TYPES
} from './constants.mjs';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStableId(value) {
  return isNonEmptyString(value) && STABLE_ID_PATTERN.test(value);
}

function assertId(value, field, errors) {
  if (!isStableId(value)) errors.push(`${field} 必须是稳定 ID（字母/数字开头，仅含字母数字 . _ : -）`);
}

function assertOptionalString(value, field, errors) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    errors.push(`${field} 必须是字符串`);
  }
}

function assertOptionArray(options, field, errors) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 8) {
    errors.push(`${field} 必须是 2-8 项的数组`);
    return new Set();
  }
  const keys = new Set();
  options.forEach((option, index) => {
    if (!option || typeof option !== 'object') {
      errors.push(`${field}[${index}] 必须是对象`);
      return;
    }
    if (!/^[A-H]$/.test(String(option.key || ''))) {
      errors.push(`${field}[${index}].key 必须是 A-H`);
    } else if (keys.has(option.key)) {
      errors.push(`${field}.key 重复：${option.key}`);
    } else {
      keys.add(option.key);
    }
    if (!isNonEmptyString(option.text)) errors.push(`${field}[${index}].text 必须是非空字符串`);
  });
  return keys;
}

function assertOptionTranslations(translations, options, field, errors) {
  if (translations === undefined || translations === null) return;
  if (!Array.isArray(translations)) {
    errors.push(`${field} 必须是数组`);
    return;
  }
  const optionKeys = new Set((Array.isArray(options) ? options : []).map(option => option?.key));
  const translationKeys = new Set();
  translations.forEach((translation, index) => {
    if (!translation || typeof translation !== 'object') {
      errors.push(`${field}[${index}] 必须是对象`);
      return;
    }
    const key = String(translation.key || '');
    if (!isNonEmptyString(key)) {
      errors.push(`${field}[${index}].key 必须是非空字符串`);
    } else if (translationKeys.has(key)) {
      errors.push(`${field}.key 重复：${key}`);
    } else {
      translationKeys.add(key);
      if (!optionKeys.has(key)) {
        errors.push(`${field}.key 不在 options 中：${key}`);
      }
    }
    if (!isNonEmptyString(translation.text)) errors.push(`${field}[${index}].text 必须是非空字符串`);
  });
}

function assertCandidateTranslations(translations, candidates, field, errors) {
  if (translations === undefined || translations === null) return;
  if (!Array.isArray(translations)) {
    errors.push(`${field} 必须是数组`);
    return;
  }
  const candidateKeys = new Set((Array.isArray(candidates) ? candidates : []).map(candidate => candidate?.candidateKey));
  const translationKeys = new Set();
  translations.forEach((translation, index) => {
    if (!translation || typeof translation !== 'object') {
      errors.push(`${field}[${index}] 必须是对象`);
      return;
    }
    const key = String(translation.key || '');
    if (!isNonEmptyString(key)) {
      errors.push(`${field}[${index}].key 必须是非空字符串`);
    } else if (translationKeys.has(key)) {
      errors.push(`${field}.key 重复：${key}`);
    } else {
      translationKeys.add(key);
      if (!candidateKeys.has(key)) errors.push(`${field}.key 不在 candidates 中：${key}`);
    }
    if (!isNonEmptyString(translation.text)) errors.push(`${field}[${index}].text 必须是非空字符串`);
  });
}

function assertQuestion(question, errors) {
  if (!question || typeof question !== 'object') {
    errors.push('question 必须是对象');
    return;
  }
  const label = `question.${question.questionKey || '<missing>'}`;
  assertId(question.questionKey, `${label}.questionKey`, errors);
  if (!SUPPORTED_QUESTION_TYPES.includes(question.type)) {
    errors.push(`${label}.type 不支持：${question.type}`);
  }
  if (!Number.isFinite(question.points) || question.points <= 0) {
    errors.push(`${label}.points 必须是正数`);
  }
  if (question.type !== 'translation_segment' && !isNonEmptyString(question.answer)) {
    errors.push(`${label}.answer 必须是非空字符串`);
  }
  let optionKeys = new Set();

  if (question.type === 'translation_segment') {
    if (!isNonEmptyString(question.segmentKey)) errors.push(`${label}.segmentKey 必须是非空字符串`);
    if (!isNonEmptyString(question.sourceText)) errors.push(`${label}.sourceText 必须是非空字符串`);
    if (question.answer !== undefined && question.answer !== null) {
      errors.push(`${label}.answer 不适用于 translation_segment`);
    }
    if (question.options !== undefined && (!Array.isArray(question.options) || question.options.length !== 0)) {
      errors.push(`${label}.options 必须为空或省略`);
    }
    assertOptionalString(question.referenceTranslation, `${label}.referenceTranslation`, errors);
    assertOptionalString(question.localAnalysis, `${label}.localAnalysis`, errors);
  } else if (question.type === 'cloze_choice') {
    if (!Number.isSafeInteger(question.blankNumber) || question.blankNumber <= 0) {
      errors.push(`${label}.blankNumber 必须为正整数`);
    }
    if (question.stem !== undefined && question.stem !== null && typeof question.stem !== 'string') {
      errors.push(`${label}.stem 必须是字符串`);
    }
    optionKeys = assertOptionArray(question.options, `${label}.options`, errors);
    if (isNonEmptyString(question.answer) && optionKeys.size && !optionKeys.has(question.answer)) {
      errors.push(`${label}.answer 不在 options 中：${question.answer}`);
    }
  } else if (question.type === 'paragraph_ordering_slot') {
    if (!Number.isSafeInteger(question.slotNumber) || question.slotNumber <= 0) {
      errors.push(`${label}.slotNumber 必须为正整数`);
    }
    if (question.options !== undefined && (!Array.isArray(question.options) || question.options.length !== 0)) {
      errors.push(`${label}.options 必须为空或省略`);
    }
  } else {
    if (!isNonEmptyString(question.stem)) {
      errors.push(`${label}.stem 必须是非空字符串`);
    }
    optionKeys = assertOptionArray(question.options, `${label}.options`, errors);
    if (isNonEmptyString(question.answer) && optionKeys.size && !optionKeys.has(question.answer)) {
      errors.push(`${label}.answer 不在 options 中：${question.answer}`);
    }
  }

  assertOptionalString(question.questionTranslation, `${label}.questionTranslation`, errors);
  assertOptionalString(question.questionType, `${label}.questionType`, errors);
  assertOptionalString(question.stemAnalysis, `${label}.stemAnalysis`, errors);
  assertOptionalString(question.location, `${label}.location`, errors);
  assertOptionalString(question.evidence, `${label}.evidence`, errors);
  assertOptionalString(question.evidenceTranslation, `${label}.evidenceTranslation`, errors);
  assertOptionalString(question.explanation, `${label}.explanation`, errors);
  assertOptionTranslations(question.optionTranslations, question.options, `${label}.optionTranslations`, errors);
  if (question.optionAnalysis !== undefined && question.optionAnalysis !== null && question.optionAnalysis.length) {
    const analysisKeys = assertOptionArray(question.optionAnalysis, `${label}.optionAnalysis`, errors);
    for (const key of analysisKeys) {
      if (optionKeys.size && !optionKeys.has(key)) {
        errors.push(`${label}.optionAnalysis.key 不在 options 中：${key}`);
      }
    }
  } else if (question.optionAnalysis !== undefined && question.optionAnalysis !== null && !Array.isArray(question.optionAnalysis)) {
    errors.push(`${label}.optionAnalysis 必须是数组`);
  }
}

function assertParagraphArray(paragraphs, field, errors) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) {
    errors.push(`${field} 必须至少包含一个段落`);
    return;
  }
  const keys = new Set();
  paragraphs.forEach((paragraph, index) => {
    if (!paragraph || typeof paragraph !== 'object') {
      errors.push(`${field}[${index}] 必须是对象`);
      return;
    }
    if (!isNonEmptyString(paragraph.paragraphKey)) {
      errors.push(`${field}[${index}].paragraphKey 必须是非空字符串`);
    } else if (keys.has(paragraph.paragraphKey)) {
      errors.push(`${field}.paragraphKey 重复：${paragraph.paragraphKey}`);
    } else {
      keys.add(paragraph.paragraphKey);
    }
    if (!isNonEmptyString(paragraph.text)) {
      errors.push(`${field}[${index}].text 必须是非空字符串`);
    }
  });
  return keys;
}

function assertTranslationAlignment(unit, label, passageKeys, errors) {
  if (unit.translation !== undefined && unit.translation !== null && unit.translation.length) {
    const translationKeys = assertParagraphArray(unit.translation, `${label}.translation`, errors);
    for (const key of translationKeys) {
      if (passageKeys.size && !passageKeys.has(key)) {
        errors.push(`${label}.translation.paragraphKey 不在 passage 中：${key}`);
      }
    }
  } else if (unit.translation !== undefined && unit.translation !== null && !Array.isArray(unit.translation)) {
    errors.push(`${label}.translation 必须是数组`);
  }
}

function assertReadingMcqUnit(unit, errors) {
  const label = `unit.${unit.unitKey || '<missing>'}`;
  const passageKeys = assertParagraphArray(unit.passage, `${label}.passage`, errors);
  assertTranslationAlignment(unit, label, passageKeys, errors);
  if (!Array.isArray(unit.questions) || !unit.questions.length) {
    errors.push(`${label}.questions 必须至少包含一个题目`);
  } else {
    unit.questions.forEach(question => {
      assertQuestion(question, errors);
      if (question.type !== 'single_choice') errors.push(`${label}.questions 类型必须为 single_choice`);
    });
  }
}

function assertClozeUnit(unit, errors) {
  const label = `unit.${unit.unitKey || '<missing>'}`;
  const passageKeys = assertParagraphArray(unit.passage, `${label}.passage`, errors);
  assertTranslationAlignment(unit, label, passageKeys, errors);
  if (!Array.isArray(unit.questions) || !unit.questions.length) {
    errors.push(`${label}.questions 必须至少包含一个 blank`);
    return;
  }
  const blankNumbers = new Set();
  unit.questions.forEach(question => {
    assertQuestion(question, errors);
    if (question.type !== 'cloze_choice') errors.push(`${label}.questions 类型必须为 cloze_choice`);
    if (Number.isSafeInteger(question.blankNumber)) {
      if (blankNumbers.has(question.blankNumber)) errors.push(`${label}.blankNumber 重复：${question.blankNumber}`);
      blankNumbers.add(question.blankNumber);
    }
  });

  const markers = new Set();
  for (const paragraph of unit.passage || []) {
    const matches = String(paragraph.text || '').match(/\[(\d+)\]/g) || [];
    for (const match of matches) markers.add(Number(match.slice(1, -1)));
  }
  if (markers.size !== blankNumbers.size) {
    errors.push(`${label}.passage blank 标记数量与题目数量不一致`);
  }
  for (const marker of markers) {
    if (!blankNumbers.has(marker)) errors.push(`${label}.passage blank 标记 ${marker} 无对应题目`);
  }
  for (const blankNumber of blankNumbers) {
    if (!markers.has(blankNumber)) errors.push(`${label}.blank ${blankNumber} 在 passage 中缺少占位标记`);
  }
}

function assertOrderingUnit(unit, errors) {
  const label = `unit.${unit.unitKey || '<missing>'}`;
  const candidates = unit.candidates;
  if (!Array.isArray(candidates) || !candidates.length) {
    errors.push(`${label}.candidates 必须至少包含一个候选段落`);
  } else {
    const candidateKeys = new Set();
    candidates.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        errors.push(`${label}.candidates[${index}] 必须是对象`);
        return;
      }
      if (!/^[A-H]$/.test(String(candidate.candidateKey || ''))) {
        errors.push(`${label}.candidates[${index}].candidateKey 必须是 A-H`);
      } else if (candidateKeys.has(candidate.candidateKey)) {
        errors.push(`${label}.candidates.candidateKey 重复：${candidate.candidateKey}`);
      } else {
        candidateKeys.add(candidate.candidateKey);
      }
      if (!isNonEmptyString(candidate.text)) errors.push(`${label}.candidates[${index}].text 必须是非空字符串`);
    });
  }

  const answerSequence = unit.answerSequence;
  if (!Array.isArray(answerSequence) || !answerSequence.length) {
    errors.push(`${label}.answerSequence 必须至少包含一个位置`);
  } else if (new Set(answerSequence).size !== answerSequence.length) {
    errors.push(`${label}.answerSequence 候选段落不可重复`);
  } else if (Array.isArray(candidates) && candidates.length) {
    const candidateKeys = new Set(candidates.map(candidate => candidate.candidateKey));
    for (const key of answerSequence) {
      if (!candidateKeys.has(key)) errors.push(`${label}.answerSequence 包含未知候选段落：${key}`);
    }
  }

  const fixed = unit.fixedPlacements;
  const fixedPositions = new Set();
  if (!Array.isArray(fixed)) {
    if (fixed !== undefined && fixed !== null) errors.push(`${label}.fixedPlacements 必须是数组`);
  } else {
    fixed.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        errors.push(`${label}.fixedPlacements[${index}] 必须是对象`);
        return;
      }
      if (!Number.isSafeInteger(item.position) || item.position < 0 || item.position >= answerSequence.length) {
        errors.push(`${label}.fixedPlacements[${index}].position 必须在 answerSequence 范围内`);
      } else if (fixedPositions.has(item.position)) {
        errors.push(`${label}.fixedPlacements.position 重复：${item.position}`);
      } else {
        fixedPositions.add(item.position);
      }
      if (Array.isArray(answerSequence) && answerSequence[item.position] !== item.candidateKey) {
        errors.push(`${label}.fixedPlacements[${index}] 与 answerSequence 不一致`);
      }
    });
  }

  const slots = unit.slots;
  if (!Array.isArray(slots) || !slots.length) {
    errors.push(`${label}.slots 必须至少包含一个待填位置`);
  } else {
    const slotNumbers = new Set();
    const slotPositions = new Set();
    slots.forEach((slot, index) => {
      if (!slot || typeof slot !== 'object') {
        errors.push(`${label}.slots[${index}] 必须是对象`);
        return;
      }
      if (!Number.isSafeInteger(slot.slotNumber) || slot.slotNumber <= 0) {
        errors.push(`${label}.slots[${index}].slotNumber 必须为正整数`);
      } else if (slotNumbers.has(slot.slotNumber)) {
        errors.push(`${label}.slots.slotNumber 重复：${slot.slotNumber}`);
      } else {
        slotNumbers.add(slot.slotNumber);
      }
      if (!Number.isSafeInteger(slot.position) || slot.position < 0 || slot.position >= answerSequence.length) {
        errors.push(`${label}.slots[${index}].position 必须在 answerSequence 范围内`);
      } else if (slotPositions.has(slot.position)) {
        errors.push(`${label}.slots.position 重复：${slot.position}`);
      } else {
        slotPositions.add(slot.position);
      }
      if (fixedPositions.has(slot.position)) {
        errors.push(`${label}.slots.position 与 fixedPlacements 冲突：${slot.position}`);
      }
      assertId(slot.questionKey, `${label}.slots[${index}].questionKey`, errors);
    });
  }

  const questions = Array.isArray(unit.questions) ? unit.questions : [];
  const questionByKey = new Map(questions.map(question => [question.questionKey, question]));
  for (const slot of Array.isArray(slots) ? slots : []) {
    const question = questionByKey.get(slot.questionKey);
    if (!question) {
      errors.push(`${label}.slot ${slot.slotNumber} 缺少对应 question`);
      continue;
    }
    assertQuestion(question, errors);
    if (question.type !== 'paragraph_ordering_slot') {
      errors.push(`${label}.slot ${slot.slotNumber} 的 question 类型必须为 paragraph_ordering_slot`);
    }
    if (question.slotNumber !== slot.slotNumber) {
      errors.push(`${label}.slot ${slot.slotNumber} 的 question.slotNumber 不一致`);
    }
    if (Array.isArray(answerSequence) && question.answer !== answerSequence[slot.position]) {
      errors.push(`${label}.slot ${slot.slotNumber} answer 与 answerSequence 不一致`);
    }
  }
  for (const question of questions) {
    if (!Array.isArray(slots) || !slots.some(slot => slot.questionKey === question.questionKey)) {
      errors.push(`${label}.question ${question.questionKey} 未映射到 slot`);
    }
  }
}

function assertTranslationUnit(unit, errors) {
  const label = `unit.${unit.unitKey || '<missing>'}`;
  assertParagraphArray(unit.passage, `${label}.passage`, errors);
  assertTranslationAlignment(unit, label, new Set((unit.passage || []).map(item => item.paragraphKey)), errors);
  if (!Array.isArray(unit.questions) || !unit.questions.length) {
    errors.push(`${label}.questions 必须至少包含一个翻译 segment`);
    return;
  }
  const segmentKeys = new Set();
  for (const question of unit.questions) {
    assertQuestion(question, errors);
    if (question.type !== 'translation_segment') errors.push(`${label}.questions 类型必须为 translation_segment`);
    if (question.segmentKey) {
      if (segmentKeys.has(question.segmentKey)) errors.push(`${label}.segmentKey 重复：${question.segmentKey}`);
      segmentKeys.add(question.segmentKey);
    }
  }
}

function assertUnit(unit, errors) {
  if (!unit || typeof unit !== 'object') {
    errors.push('unit 必须是对象');
    return;
  }
  const label = `unit.${unit.unitKey || '<missing>'}`;
  assertId(unit.unitKey, `${label}.unitKey`, errors);
  if (!SUPPORTED_UNIT_TYPES.includes(unit.type)) {
    errors.push(`${label}.type 不支持：${unit.type}`);
  }
  if (!isNonEmptyString(unit.displayTitle)) errors.push(`${label}.displayTitle 必须是非空字符串`);
  assertOptionalString(unit.directions, `${label}.directions`, errors);
  assertCandidateTranslations(unit.candidateTranslations, unit.candidates, `${label}.candidateTranslations`, errors);

  if (unit.type === 'reading_mcq') assertReadingMcqUnit(unit, errors);
  else if (unit.type === 'cloze_choice') assertClozeUnit(unit, errors);
  else if (unit.type === 'paragraph_ordering') assertOrderingUnit(unit, errors);
  else if (unit.type === 'translation') assertTranslationUnit(unit, errors);
}

export function assertCanonicalPaper(paper) {
  const errors = [];
  if (!paper || typeof paper !== 'object') throw new Error('Canonical paper 必须是对象');
  if (paper.schemaVersion !== EXAM_CANONICAL_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${EXAM_CANONICAL_SCHEMA_VERSION}`);
  }
  assertId(paper.examId, 'examId', errors);
  if (!SUPPORTED_EXAM_IDS.includes(paper.examId)) errors.push(`examId 暂不支持：${paper.examId}`);
  assertId(paper.bankId, 'bankId', errors);
  assertId(paper.packageId, 'packageId', errors);
  assertId(paper.packageVersion, 'packageVersion', errors);
  assertId(paper.paperKey, 'paperKey', errors);
  if (!Number.isSafeInteger(paper.year) || paper.year < 1900 || paper.year > 2200) {
    errors.push('year 必须是 1900-2200 的整数');
  }
  if (!isNonEmptyString(paper.title)) errors.push('title 必须是非空字符串');
  if (!SUPPORTED_SOURCE_TYPES.includes(paper.sourceType)) {
    errors.push(`sourceType 不支持：${paper.sourceType}`);
  }

  if (!Array.isArray(paper.units) || !paper.units.length) {
    errors.push('units 必须至少包含一个 unit');
  } else {
    paper.units.forEach(unit => assertUnit(unit, errors));
  }

  const unitKeys = new Set();
  const questionKeys = new Set();
  for (const unit of paper.units || []) {
    if (unit?.unitKey) {
      if (unitKeys.has(unit.unitKey)) errors.push(`unitKey 重复：${unit.unitKey}`);
      unitKeys.add(unit.unitKey);
    }
    for (const question of unit?.questions || []) {
      if (question?.questionKey) {
        if (questionKeys.has(question.questionKey)) errors.push(`questionKey 重复：${question.questionKey}`);
        questionKeys.add(question.questionKey);
      }
    }
  }

  if (errors.length) throw new Error(`Canonical paper 无效：${errors.join('；')}`);
  return paper;
}

export function assertExamPackShape(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object') throw new Error('Exam Pack 必须是对象');
  const manifest = pack.manifest;
  if (!manifest || typeof manifest !== 'object') {
    errors.push('manifest 缺失');
  } else {
    if (manifest.schemaVersion !== EXAM_PACK_SCHEMA_VERSION) errors.push(`manifest.schemaVersion 必须为 ${EXAM_PACK_SCHEMA_VERSION}`);
    assertId(manifest.packageId, 'manifest.packageId', errors);
    assertId(manifest.packageVersion, 'manifest.packageVersion', errors);
    assertId(manifest.examId, 'manifest.examId', errors);
    assertId(manifest.bankId, 'manifest.bankId', errors);
    if (!isNonEmptyString(manifest.displayName)) errors.push('manifest.displayName 必须是非空字符串');
    if (!CONTENT_HASH_PATTERN.test(String(manifest.contentHash || ''))) {
      errors.push('manifest.contentHash 必须是 sha256:<64 hex>');
    }
    if (!Array.isArray(manifest.papers) || !manifest.papers.length) {
      errors.push('manifest.papers 必须至少包含一个 paper');
    } else {
      const keys = new Set();
      manifest.papers.forEach((paper, index) => {
        if (!paper || typeof paper !== 'object') {
          errors.push(`manifest.papers[${index}] 必须是对象`);
          return;
        }
        assertId(paper.paperKey, `manifest.papers[${index}].paperKey`, errors);
        if (paper.paperKey && keys.has(paper.paperKey)) errors.push(`manifest.papers.paperKey 重复：${paper.paperKey}`);
        if (paper.paperKey) keys.add(paper.paperKey);
        if (!Number.isSafeInteger(paper.year)) errors.push(`manifest.papers[${index}].year 必须是整数`);
        if (!isNonEmptyString(paper.path)) errors.push(`manifest.papers[${index}].path 必须是非空字符串`);
        if (!CONTENT_HASH_PATTERN.test(String(paper.contentHash || ''))) {
          errors.push(`manifest.papers[${index}].contentHash 必须是 sha256:<64 hex>`);
        }
        if (!Number.isSafeInteger(paper.unitCount) || paper.unitCount < 0) {
          errors.push(`manifest.papers[${index}].unitCount 必须是非负整数`);
        }
        if (!Number.isSafeInteger(paper.questionCount) || paper.questionCount < 0) {
          errors.push(`manifest.papers[${index}].questionCount 必须是非负整数`);
        }
      });
    }
  }

  if (!Array.isArray(pack.papers) || !pack.papers.length) {
    errors.push('pack.papers 必须至少包含一个 paper');
  } else {
    pack.papers.forEach(paper => {
      try {
        assertCanonicalPaper(paper);
      } catch (error) {
        errors.push(error.message);
      }
    });
    if (manifest && Array.isArray(manifest.papers) && manifest.papers.length !== pack.papers.length) {
      errors.push('manifest.papers 与 pack.papers 数量不一致');
    }
  }

  if (Array.isArray(pack.papers) && pack.papers.length) {
    const bankPaperKeys = new Map();
    const bankUnitKeys = new Map();
    const bankQuestionKeys = new Map();
    for (const paper of pack.papers) {
      if (manifest?.bankId && paper.bankId !== manifest.bankId) {
        errors.push(`paper ${paper.paperKey} 的 bankId 与 manifest.bankId 不一致`);
      }
      if (!bankPaperKeys.has(paper.bankId)) bankPaperKeys.set(paper.bankId, new Set());
      if (!bankUnitKeys.has(paper.bankId)) bankUnitKeys.set(paper.bankId, new Set());
      if (!bankQuestionKeys.has(paper.bankId)) bankQuestionKeys.set(paper.bankId, new Set());
      const paperKeys = bankPaperKeys.get(paper.bankId);
      if (paperKeys.has(paper.paperKey)) errors.push(`bank ${paper.bankId} 内 paperKey 重复：${paper.paperKey}`);
      paperKeys.add(paper.paperKey);
      for (const unit of paper.units || []) {
        const unitKeys = bankUnitKeys.get(paper.bankId);
        if (unitKeys.has(unit.unitKey)) errors.push(`bank ${paper.bankId} 内 unitKey 重复：${unit.unitKey}`);
        unitKeys.add(unit.unitKey);
        for (const question of unit.questions || []) {
          const questionKeys = bankQuestionKeys.get(paper.bankId);
          if (questionKeys.has(question.questionKey)) {
            errors.push(`bank ${paper.bankId} 内 questionKey 必须全局唯一，重复：${question.questionKey}`);
          }
          questionKeys.add(question.questionKey);
        }
      }
    }
  }

  if (errors.length) throw new Error(`Exam Pack 无效：${errors.join('；')}`);
  return pack;
}
