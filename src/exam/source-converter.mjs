import { assertCanonicalPaper } from './schema.mjs';
import { parseExamMarkdown } from './parser.mjs';
import { sanitizeOptionAnalysisItems } from './option-analysis-sanitizer.mjs';
import {
  assertUnitGate,
  detectPartBVariant,
  examMetaForYear,
  normalizeSourceText,
  stableQuestionKey,
  summarizeSourceSections,
  textFromSource
} from './source-production.mjs';

const READING_DESCRIPTORS = Object.freeze([
  { name: 'part-a-text-1', textNumber: 1, first: 21, last: 25, title: 'Text 1' },
  { name: 'part-a-text-2', textNumber: 2, first: 26, last: 30, title: 'Text 2' },
  { name: 'part-a-text-3', textNumber: 3, first: 31, last: 35, title: 'Text 3' },
  { name: 'part-a-text-4', textNumber: 4, first: 36, last: 40, title: 'Text 4' }
]);

const READING_DIRECTIONS = 'Read the following four texts. Answer the questions after each text by choosing A, B, C or D. Mark your answers on the ANSWER SHEET. (40 points)';
const CLOZE_DIRECTIONS = 'Read the following text. Choose the best word(s) for each numbered blank and mark A, B, C or D on the ANSWER SHEET. (10 points)';
const TRANSLATION_DIRECTIONS = 'Read the following text carefully and then translate the underlined segments into Chinese. Write your answers on the ANSWER SHEET. (10 points)';
const UNSUPPORTED_PART_B_VARIANT = 'UNSUPPORTED_PART_B_VARIANT';

function code(value) {
  return `\`\`\`exam-item\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function documentHead(meta, section) {
  return `# ${meta.year} 考研英语一\n\n\`\`\`exam-meta\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n## ${section}\n`;
}

function splitBlocks(value) {
  return String(value || '')
    .split(/\n\s*\n/u)
    .map(block => block.trim())
    .filter(Boolean);
}

function between(source, start, end) {
  const startIndex = typeof start === 'string' ? source.indexOf(start) : source.search(start);
  if (startIndex < 0) return '';
  const startText = typeof start === 'string' ? start : source.slice(startIndex).match(start)?.[0] || '';
  const contentStart = startIndex + startText.length;
  const remaining = source.slice(contentStart);
  const endIndex = typeof end === 'string' ? remaining.indexOf(end) : remaining.search(end);
  return textFromSource(endIndex < 0 ? remaining : remaining.slice(0, endIndex));
}

function sectionSlice(source, startHeading, endHeadings = []) {
  const start = source.indexOf(startHeading);
  if (start < 0) return '';
  const endPositions = endHeadings
    .map(heading => source.indexOf(heading, start + startHeading.length))
    .filter(position => position >= 0);
  return source.slice(start, endPositions.length ? Math.min(...endPositions) : source.length);
}

function stripHeadingAndDirections(value) {
  return splitBlocks(value)
    .filter(block => !/^#{1,6}\s/u.test(block))
    .filter(block => !/^Read the following/iu.test(block))
    .map(textFromSource)
    .filter(Boolean);
}

function extractEnglishPassageBlocks(blocks) {
  return blocks
    .map(block => {
      const hasChinese = /[\u3400-\u9fff]/u.test(block);
      const cleaned = block
        .replace(/[\u3400-\u9fff]+/gu, ' ')
        .replace(/[，。；：？！、（）“”‘’《》【】]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      const letterCount = (cleaned.match(/[A-Za-z]/gu) || []).length;
      const hasBlankCandidate = /(?<!\d)(?:[1-9]|1\d|20)(?![\d,])/u.test(cleaned);
      return !hasChinese || letterCount >= 30 || hasBlankCandidate ? cleaned : '';
    })
    .filter(Boolean);
}

export function normalizeClozeBlankMarkers(value, blankNumbers = Array.from({ length: 20 }, (_, index) => index + 1)) {
  let output = String(value || '');
  let cursor = 0;
  for (const number of blankNumbers) {
    const pattern = new RegExp(`(?<!\\d)${number}(?![\\d,])`, 'u');
    const suffix = output.slice(cursor);
    const match = pattern.exec(suffix) || new RegExp(`${number}(?![\\d,])`, 'u').exec(suffix);
    if (!match) throw new Error(`来源缺少完形空号 ${number}`);
    const index = cursor + match.index;
    output = `${output.slice(0, index)}[${number}]${output.slice(index + match[0].length)}`;
    cursor = index + String(number).length + 2;
  }
  return output;
}

function parseClozeOptions(source) {
  const firstOption = source.search(/(?<!\S)1\.\s*\[\s*A\s*\]/u);
  if (firstOption < 0) throw new Error('完形来源缺少第 1 题选项');
  const analysisStart = source.indexOf('## 1.', firstOption);
  const surface = source.slice(firstOption, analysisStart < 0 ? source.length : analysisStart);
  const normalizedSurface = surface.replace(/<[^>]+>/gu, ' ');
  const matches = [...normalizedSurface.matchAll(/(?<!\S)(\d+)\.\s*\[\s*A\s*\]\s*([\s\S]*?)\s*\[\s*B\s*\]\s*([\s\S]*?)\s*\[\s*C\s*\]\s*([\s\S]*?)\s*\[\s*D\s*\]\s*([\s\S]*?)(?=\s+\d+\.\s*\[\s*A\s*\]|$)/gu)];
  if (matches.length !== 20) throw new Error(`完形选项数量异常：${matches.length}`);
  return new Map(matches.map(match => [Number(match[1]), ['A', 'B', 'C', 'D'].map((key, index) => ({ key, text: textFromSource(match[index + 2]) }))]));
}

function parseOptionItems(source) {
  const normalized = String(source || '').replace(/^(?:##\s*)?【选项】\s*/mu, '');
  const matches = [...normalized.matchAll(/(?:^|\n)(?:##\s*)?([A-D])\)\s*([\s\S]*?)(?=(?:\n(?:##\s*)?[A-D]\)\s)|(?:\s+[A-D]\)\s)|$)/gu)];
  return sanitizeOptionAnalysisItems(matches
    .map(match => ({ key: match[1], text: textFromSource(match[2]) }))
    .filter(item => item.text), { label: '来源选项解析' });
}

export { trimOptionAnalysisTail } from './option-analysis-sanitizer.mjs';

function findClozeAnalysisStart(source, fromIndex = 0) {
  const match = String(source || '').slice(fromIndex).match(/^(?:##\s+)?1\.\s*$/mu);
  return match ? fromIndex + match.index : -1;
}

function parseClozeAnalyses(source) {
  const analysisAnchor = source.indexOf('## 完形填空题和解析');
  const analysisStart = findClozeAnalysisStart(source, analysisAnchor < 0 ? 0 : analysisAnchor);
  const analysisEnd = source.indexOf('## 阅读理解题和解析', analysisStart + 1);
  const analysis = source.slice(analysisStart, analysisEnd < 0 ? source.length : analysisEnd);
  const headers = [...analysis.matchAll(/^(?:##\s+)?(\d+)\.\s*$/gmu)];
  if (headers.length !== 20) throw new Error(`完形解析数量异常：${headers.length}`);
  return new Map(headers.map((header, index) => {
    const number = Number(header[1]);
    const block = analysis.slice(header.index, headers[index + 1]?.index);
    const answer = block.match(/【答案】\s*\[?\s*([A-D])\s*\]?/u)?.[1];
    if (!answer) throw new Error(`完形第 ${number} 空缺少答案`);
    const clue = between(block, /(?:^|\n)(?:##\s*)?【线索】\s*/mu, /(?:^|\n)(?:##\s*)?【选项】/mu);
    const verification = between(block, /(?:^|\n)【验证】\s*/mu, /\s*$/u);
    const optionStart = block.search(/(?:^|\n)(?:##\s*)?【选项】/mu);
    const optionAnalysis = optionStart < 0 ? [] : parseOptionItems(block.slice(optionStart));
    return [number, {
      answer,
      explanation: [clue && `线索：${clue}`, verification && `验证：${verification}`].filter(Boolean).join('\n\n'),
      optionAnalysis
    }];
  }));
}

function clozeSourceRange(source) {
  const analysisAnchor = source.indexOf('## 完形填空题和解析');
  const duplicateStart = source.indexOf('## 英语一真题', analysisAnchor);
  if (duplicateStart < 0) throw new Error('未找到 2025 完形双语来源段');
  const end = findClozeAnalysisStart(source, duplicateStart);
  if (end < 0) throw new Error('未找到 2025 完形解析起点');
  return source.slice(duplicateStart, end);
}

function makeClozeUnit(source, meta) {
  const raw = clozeSourceRange(source);
  const firstOption = raw.search(/(?:^|\n)\s*1\.\s*\[\s*A\s*\]/u);
  const passageSurface = raw.slice(raw.indexOf('## Directions:'), firstOption);
  const blocks = stripHeadingAndDirections(passageSurface);
  const english = extractEnglishPassageBlocks(blocks);
  const chinese = blocks.filter(block => /[\u3400-\u9fff]/u.test(block));
  const normalizedEnglish = normalizeClozeBlankMarkers(english.join('\n\n'));
  const passage = splitBlocks(normalizedEnglish).map((text, index) => ({ paragraphKey: `P${index + 1}`, text }));
  const translation = chinese.map((text, index) => ({ paragraphKey: `P${index + 1}`, text }));
  if (!passage.length || passage.reduce((total, paragraph) => total + (paragraph.text.match(/\[\d+\]/gu) || []).length, 0) !== 20) {
    throw new Error('完形正文空号标记数量异常');
  }
  const options = parseClozeOptions(raw);
  const analyses = parseClozeAnalyses(source);
  const questions = Array.from({ length: 20 }, (_, index) => {
    const blankNumber = index + 1;
    const analysis = analyses.get(blankNumber);
    return {
      blankNumber,
      questionKey: stableQuestionKey({ year: meta.year, section: 'cloze', number: blankNumber }),
      answer: analysis.answer,
      options: options.get(blankNumber),
      explanation: analysis.explanation,
      optionAnalysis: analysis.optionAnalysis
    };
  });
  const lines = [
    documentHead(meta, 'Section I'),
    '### Cloze Test', '',
    code({ unitKey: `kaoyan_en1_${meta.year}_cloze_1`, type: 'cloze_choice', displayTitle: '完形填空' }), '',
    '#### Directions', CLOZE_DIRECTIONS, '',
    '#### Passage', '',
    ...passage.flatMap(item => [`##### ${item.paragraphKey}`, item.text, '']),
    ...(translation.length ? ['#### Passage Translation', '', ...translation.flatMap(item => [`##### ${item.paragraphKey}`, item.text, ''])] : []),
    ...questions.flatMap(question => [
      '', `#### Blank ${question.blankNumber}`, '',
      code({ questionKey: question.questionKey, type: 'cloze_choice', answer: question.answer, points: 0.5, blankNumber: question.blankNumber }), '',
      ...question.options.map(option => `- ${option.key}. ${option.text}`),
      ...(question.explanation ? ['', '##### Explanation', question.explanation] : []),
      ...(question.optionAnalysis.length ? ['', '##### Option Analysis', ...question.optionAnalysis.map(option => `- ${option.key}: ${option.text}`)] : [])
    ])
  ];
  return { name: 'section1-cloze', markdown: lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n', warnings: [] };
}

function findReadingQuestionMatches(source) {
  return [...source.matchAll(/^\s*(2[1-9]|3[0-9]|40)\.\s+/gmu)].map(match => ({ number: Number(match[1]), index: match.index }));
}

function endOfQuestionBlock(source, start, end) {
  const block = source.slice(start, end);
  const optionEnds = [...block.matchAll(/\[\s*D\s*\][^\n]*/gu)];
  if (!optionEnds.length) return start;
  const last = optionEnds.at(-1);
  const lineEnd = block.indexOf('\n', last.index);
  return start + (lineEnd < 0 ? block.length : lineEnd + 1);
}

function extractReadingDescriptorSurface(readingSource, descriptor) {
  const matches = findReadingQuestionMatches(readingSource);
  const firstQuestion = matches.find(match => match.number === descriptor.first);
  const nextQuestion = matches.find(match => match.number === descriptor.last + 1);
  if (!firstQuestion) throw new Error(`${descriptor.title} 缺少第 ${descriptor.first} 题`);
  const questionEnd = nextQuestion?.index || readingSource.length;
  let passageStart = readingSource.indexOf(`## Text ${descriptor.textNumber}`);
  if (descriptor.textNumber === 3) {
    const previous = matches.find(match => match.number === 30);
    passageStart = previous ? endOfQuestionBlock(readingSource, previous.index, firstQuestion.index) : firstQuestion.index;
  } else if (passageStart >= 0) {
    passageStart += `## Text ${descriptor.textNumber}`.length;
  } else {
    const previous = matches.find(match => match.number === descriptor.first - 1);
    if (previous) passageStart = endOfQuestionBlock(readingSource, previous.index, firstQuestion.index);
    else {
      const partAHeading = readingSource.indexOf('## Part A');
      passageStart = partAHeading >= 0 ? partAHeading : 0;
    }
  }
  if (passageStart < 0 || passageStart >= firstQuestion.index) throw new Error(`${descriptor.title} 缺少正文边界`);
  return {
    passage: stripHeadingAndDirections(readingSource.slice(passageStart, firstQuestion.index)).map((text, index) => ({ paragraphKey: `P${index + 1}`, text })),
    questionSurface: readingSource.slice(firstQuestion.index, questionEnd)
  };
}

function parseReadingQuestions(source, first, last) {
  const allMatches = [...source.matchAll(/^\s*(2[1-9]|3[0-9]|40)\.\s+/gmu)];
  const matches = allMatches.filter(match => Number(match[1]) >= first && Number(match[1]) <= last);
  if (matches.length !== last - first + 1) throw new Error(`阅读题干数量异常：${matches.length}`);
  return matches.map(match => {
    const number = Number(match[1]);
    const start = match.index + match[0].length;
    const globalIndex = allMatches.findIndex(candidate => candidate.index === match.index);
    const nextQuestionIndex = allMatches[globalIndex + 1]?.index ?? source.length;
    const end = endOfQuestionBlock(source, start, nextQuestionIndex);
    const body = source.slice(start, end).trim();
    const optionStart = body.search(/\[\s*A\s*\]/u);
    if (optionStart < 0) throw new Error(`Q${number} 缺少 A 选项`);
    const stem = textFromSource(body.slice(0, optionStart));
    const optionPart = body.slice(optionStart);
    const optionMatches = [...optionPart.matchAll(/\[\s*([A-D])\s*\]\s*([\s\S]*?)(?=\s*\[\s*[A-D]\s*\]\s*|$)/gu)];
    if (optionMatches.length !== 4) throw new Error(`Q${number} 选项数量异常：${optionMatches.length}`);
    const options = optionMatches.map(item => ({ key: item[1], text: textFromSource(item[2]) }));
    for (const option of options) {
      if (/#{1,6}\s|\bText\s+[1-4]\b|\bDirections:\s*Read the following/iu.test(option.text) || option.text.length > 800) {
        throw new Error(`Q${number} 选项 ${option.key} 包含越界正文`);
      }
    }
    return { number, stem, options };
  });
}

function readingAnalysisSlice(source, first, last) {
  const anchor = `## 阅读理解题和解析 · ${first}–${last} 题`;
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error(`未找到阅读解析锚点：${anchor}`);
  const nextPositions = [
    '## 阅读理解题和解析',
    '## 段落排序题和解析',
    '## 英译汉真题',
    '## 写作题和范文'
  ]
    .map(nextAnchor => source.indexOf(nextAnchor, start + anchor.length))
    .filter(position => position >= 0);
  return source.slice(start, nextPositions.length ? Math.min(...nextPositions) : source.length);
}

function parseReadingAnalysis(source, first, last) {
  const analysisStart = source.indexOf('## 答案与逐题解析');
  if (analysisStart < 0) throw new Error(`阅读 ${first}-${last} 缺少答案解析区`);
  const analysis = source.slice(analysisStart);
  const numbers = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const header = new RegExp(`^(?:##\\s*)?(${numbers.join('|')})\\.\\s*.*$`, 'gmu');
  const matches = [...analysis.matchAll(header)];
  if (matches.length !== numbers.length) throw new Error(`中文解析题目数量异常：${matches.length}`);
  return matches.map((match, index) => {
    const number = Number(match[1]);
    const block = analysis.slice(match.index, matches[index + 1]?.index);
    const answerMatch = block.match(/【答案】\s*\[?\s*([A-D])\s*\]?\s*[（(]([^）)]+)[）)]/u) || block.match(/【答案】\s*([A-D])\b/u);
    if (!answerMatch) throw new Error(`Q${number} 缺少答案`);
    const locationMatch = block.match(/(?:^|\n)(?:##\s*)?【定位】\s*(P\d+)/mu);
    const evidenceBlock = locationMatch
      ? between(block, new RegExp(`(?:^|\\n)(?:##\\s*)?【定位】\\s*${locationMatch[1]}\\s*`, 'mu'), /(?:^|\n)(?:##\s*)?【选项】/mu)
      : '';
    const chineseStart = evidenceBlock.search(/[\u3400-\u9fff]/u);
    const optionStart = block.search(/(?:^|\n)(?:##\s*)?【选项】/mu);
    const optionAnalysis = optionStart < 0 ? [] : parseOptionItems(block.slice(optionStart));
    const criterion = between(block, /(?:^|\n)(?:##\s*)?【判型】\s*/mu, /(?:^|\n)(?:##\s*)?【拆句】/mu);
    const stemAnalysis = between(block, /(?:^|\n)(?:##\s*)?【拆句】\s*/mu, /(?:^|\n)(?:##\s*)?【定位】/mu);
    const warnings = [];
    if (!locationMatch) warnings.push(`Q${number} 来源解析缺少定位`);
    if (locationMatch && chineseStart < 0) warnings.push(`Q${number} 定位缺少中文译文`);
    if (optionAnalysis.length !== 4) warnings.push(`Q${number} optionAnalysis 不完整（${optionAnalysis.length}/4）`);
    return {
      number,
      answer: answerMatch[1],
      questionType: answerMatch[2] ? textFromSource(answerMatch[2]) : '',
      stemAnalysis: criterion && stemAnalysis ? `判型：${criterion}\n\n拆句：${stemAnalysis}` : '',
      location: locationMatch?.[1] || '',
      evidence: chineseStart >= 0 ? textFromSource(evidenceBlock.slice(0, chineseStart)) : textFromSource(evidenceBlock),
      evidenceTranslation: chineseStart >= 0 ? textFromSource(evidenceBlock.slice(chineseStart)) : '',
      optionAnalysis,
      warnings
    };
  });
}

function makeReadingUnit(source, meta, descriptor) {
  const readingSource = sectionSlice(source, '## Section II Reading Comprehension', ['## Part B', '## Section III']);
  const surface = extractReadingDescriptorSurface(readingSource, descriptor);
  const questions = parseReadingQuestions(surface.questionSurface, descriptor.first, descriptor.last);
  const analysis = parseReadingAnalysis(readingAnalysisSlice(source, descriptor.first, descriptor.last), descriptor.first, descriptor.last);
  const mergedQuestions = questions.map((question, index) => ({
    ...question,
    ...analysis[index],
    questionKey: stableQuestionKey({ year: meta.year, section: 'reading', number: question.number })
  }));
  const lines = [
    documentHead(meta, 'Section II Part A'),
    `### ${descriptor.title}`, '',
    code({ unitKey: `kaoyan_en1_${meta.year}_part_a_text_${descriptor.textNumber}`, type: 'reading_mcq', displayTitle: descriptor.title }), '',
    '#### Directions', READING_DIRECTIONS, '',
    '#### Passage', '',
    ...surface.passage.flatMap(item => [`##### ${item.paragraphKey}`, item.text, '']),
    ...mergedQuestions.flatMap(question => [
      '', `#### Q${question.number}`, '',
      code({ questionKey: question.questionKey, type: 'single_choice', answer: question.answer, points: 2 }), '',
      question.stem, '',
      ...question.options.map(option => `- ${option.key}. ${option.text}`),
      ...(question.stemAnalysis ? ['', '##### Stem Analysis', question.stemAnalysis] : []),
      ...(question.location ? ['', '##### Location', question.location] : []),
      ...(question.evidence ? ['', '##### Evidence', question.evidence] : []),
      ...(question.evidenceTranslation ? ['', '##### Evidence Translation', question.evidenceTranslation] : []),
      ...(question.optionAnalysis.length ? ['', '##### Option Analysis', ...question.optionAnalysis.map(option => `- ${option.key}: ${option.text}`)] : [])
    ])
  ];
  return {
    name: descriptor.name,
    markdown: lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n',
    warnings: analysis.flatMap(item => item.warnings)
  };
}

function parsePartBSequenceTokens(source) {
  const rawSource = String(source || '');
  const explicitLine = rawSource.match(/^(?:#{1,6}\s*)?正确顺序[ \t]+([^\n]+)/mu)?.[1];
  if (explicitLine) {
    return [...explicitLine.matchAll(/(?:\b(4[1-5])\s+([A-H])|预给\s*([A-H]))/gu)];
  }

  const formula = [...rawSource.matchAll(/\$\$([\s\S]*?)\$\$/gu)]
    .map(match => match[1])
    .find(block => (block.match(/4\s*[1-5]/gu) || []).length >= 5);
  if (!formula) return [];

  const normalized = formula
    .replace(/\\boxed\s*\{\s*4\s*([1-5])\s*\.\s*\}/gu, ' SLOT$1 ')
    .replace(/4\s*([1-5])\s*\./gu, ' SLOT$1 ')
    .replace(/\\(?:mathrm|text)\s*\{\s*([A-H])\s*\}/gu, ' $1 ');
  return [...normalized.matchAll(/(?:\bSLOT([1-5])\b|(?<![A-Z])([A-H])(?![A-Z]))/gu)]
    .map(token => token[1]
      ? { 1: `4${token[1]}`, 2: undefined, 3: undefined }
      : { 1: undefined, 2: undefined, 3: token[2] });
}

export function parsePartBAnswerSequence(source, { candidateKeys = null } = {}) {
  const tokens = parsePartBSequenceTokens(source);
  const answerSequence = tokens.map(token => token[2] || token[3]);
  const fixedPlacements = [];
  const slotAnswers = new Map();
  tokens.forEach((token, position) => {
    if (token[1]) slotAnswers.set(Number(token[1]), token[2]);
    else fixedPlacements.push({ position, candidateKey: token[3] });
  });
  const expectedCandidateKeys = candidateKeys ? new Set(candidateKeys) : null;
  const actualCandidateKeys = new Set(answerSequence);
  const sequenceIsUnique = actualCandidateKeys.size === answerSequence.length;
  const sequenceUsesKnownCandidates = !expectedCandidateKeys
    || [...actualCandidateKeys].every(key => expectedCandidateKeys.has(key));
  const sequenceFitsCandidatePool = !expectedCandidateKeys
    || answerSequence.length <= expectedCandidateKeys.size;
  if (slotAnswers.size !== 5
    || fixedPlacements.length < 1
    || answerSequence.length !== slotAnswers.size + fixedPlacements.length
    || !sequenceIsUnique
    || !sequenceUsesKnownCandidates
    || !sequenceFitsCandidatePool) {
    throw new Error('Part B 正确顺序数量异常');
  }
  return { answerSequence, fixedPlacements, slotAnswers };
}

function parsePartBExplanations(source) {
  const start = source.indexOf('## 段落排序题和解析');
  const analysis = source.slice(start < 0 ? 0 : start);
  const headers = [...analysis.matchAll(/^##\s+(4[1-5])\.\s+正确段\s+([A-H])\s*$/gmu)];
  return new Map(headers.map((header, index) => [Number(header[1]), {
    answer: header[2],
    explanation: textFromSource(analysis.slice(header.index + header[0].length, headers[index + 1]?.index))
  }]));
}

function parsePartBCandidates(partB, candidateStart) {
  const surface = partB.slice(candidateStart);
  const headers = [...surface.matchAll(/^\[\s*([A-H])\s*\]\s*/gmu)];
  return headers.map((header, index) => {
    let text = surface.slice(header.index + header[0].length, headers[index + 1]?.index ?? surface.length);
    const endMarker = text.search(/^(?:\$\$|!\[[^\n]*\]\([^\n]+\))\s*$/mu);
    if (endMarker >= 0) text = text.slice(0, endMarker);
    return { candidateKey: header[1], text: textFromSource(text) };
  });
}

function parseMatchingAnswers(source) {
  const answers = [...String(source || '').matchAll(/【答案】\s*\[\s*([A-G])\s*\]/gu)].map(match => match[1]).slice(-5);
  if (answers.length !== 5 || new Set(answers).size !== 5) throw new Error(`Part B matching 答案数量异常：${answers.length}`);
  return new Map(answers.map((answer, index) => [41 + index, answer]));
}

function matchingPassage(partB, candidateStart) {
  const body = partB.slice(0, candidateStart);
  const blocks = splitBlocks(body)
    .filter(block => !/^#{1,6}\s/u.test(block))
    .filter(block => !/(?:Questions?\s*41\s*[-–]\s*45|Questions?\s*41-45).*(?:list|A\s*[-–]\s*G)/isu.test(block));
  const english = extractEnglishPassageBlocks(blocks)
    .map(block => block.replace(/\(\s*(4[1-5])\s*\)/gu, '[$1]'));
  const combined = english.join('\n\n');
  return splitBlocks(combined).map((text, index) => ({ paragraphKey: `P${index + 1}`, text }));
}

function makeMatchingUnit(source, meta, matchingVariant) {
  const partB = sectionSlice(source, '## Part B', ['## Part C', '## Section III']);
  const candidateStart = partB.search(/^\[\s*[A-G]\s*\]/mu);
  if (candidateStart < 0) throw new Error('Part B matching 缺少候选项');
  const candidates = parsePartBCandidates(partB, candidateStart).map(candidate => ({
    ...candidate,
    text: extractEnglishPassageBlocks([candidate.text]).join(' ') || candidate.text
  }));
  if (candidates.length !== 7) throw new Error(`Part B matching candidates 数量异常：${candidates.length}`);
  const answers = parseMatchingAnswers(source);
  const passage = matchingPassage(partB, candidateStart);
  const questions = [41, 42, 43, 44, 45].map(number => ({
    number,
    questionKey: stableQuestionKey({ year: meta.year, section: 'part_b', number }),
    answer: answers.get(number)
  }));
  const lines = [
    documentHead(meta, 'Section II Part B'),
    '### Part B', '',
    code({
      unitKey: `kaoyan_en1_${meta.year}_part_b_1`, type: 'matching', displayTitle: 'Part B',
      matchingVariant, slots: [41, 42, 43, 44, 45]
    }), '',
    '#### Directions', textFromSource(partB.slice(partB.indexOf('## Directions:') + '## Directions:'.length, partB.indexOf('\n\n', partB.indexOf('## Directions:') + 20))), '',
    '#### Passage', '',
    ...passage.flatMap(item => [`##### ${item.paragraphKey}`, item.text, '']),
    ...candidates.flatMap(candidate => [`#### Candidate ${candidate.candidateKey}`, candidate.text, '']),
    ...questions.flatMap(question => ['', `#### Slot ${question.number}`, '', code({
      questionKey: question.questionKey, type: 'matching_slot', answer: question.answer, points: 2, slotNumber: question.number
    }), ''])
  ];
  return { name: 'part-b', markdown: lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n', warnings: [] };
}

function makePartBUnit(source, meta) {
  const partB = sectionSlice(source, '## Part B', ['## Part C', '## Section III']);
  const candidateStart = partB.search(/^\[\s*[A-H]\s*\]/mu);
  if (candidateStart < 0) throw new Error('Part B 缺少候选段');
  const candidates = parsePartBCandidates(partB, candidateStart);
  if (candidates.length < 6) throw new Error(`Part B candidates 数量异常：${candidates.length}`);
  const sequenceAnchor = source.indexOf('## 段落排序题和解析');
  const sequenceSource = sequenceAnchor >= 0 ? source.slice(sequenceAnchor) : source;
  const sequence = parsePartBAnswerSequence(sequenceSource, { candidateKeys: candidates.map(candidate => candidate.candidateKey) });
  const explanations = parsePartBExplanations(source);
  const questions = [41, 42, 43, 44, 45].map(number => ({
    number,
    questionKey: stableQuestionKey({ year: meta.year, section: 'part_b', number }),
    answer: sequence.slotAnswers.get(number),
    explanation: explanations.get(number)?.explanation || ''
  }));
  const fixed = sequence.fixedPlacements;
  const lines = [
    documentHead(meta, 'Section II Part B'),
    '### Part B', '',
    code({
      unitKey: `kaoyan_en1_${meta.year}_part_b_1`,
      type: 'paragraph_ordering',
      displayTitle: 'Part B',
      slots: [41, 42, 43, 44, 45],
      fixed,
      answerSequence: sequence.answerSequence
    }), '',
    '#### Directions', textFromSource(partB.slice(partB.indexOf('## Directions:') + '## Directions:'.length, candidateStart)), '',
    ...candidates.flatMap(candidate => [`#### Candidate ${candidate.candidateKey}`, candidate.text, '']),
    ...questions.flatMap(question => [
      '', `#### Slot ${question.number}`, '',
      code({ questionKey: question.questionKey, type: 'paragraph_ordering_slot', answer: question.answer, points: 2, slotNumber: question.number }), '',
      ...(question.explanation ? ['##### Explanation', question.explanation] : [])
    ])
  ];
  return { name: 'part-b', markdown: lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n', warnings: [] };
}

export function extractTranslationSegments(source, year = 2025) {
  const start = String(source || '').indexOf('## 逐句解析');
  const analysis = String(source || '').slice(start < 0 ? 0 : start);
  const matches = [...analysis.matchAll(/^(?:##\s*)?\((4[6-9]|50)\)\s*([^\n]*)/gmu)];
  return matches.map((match, index) => {
    const block = analysis.slice(match.index, matches[index + 1]?.index);
    const translationMatch = block.match(/(?:^|\n)(?:##\s*)?【译文】\s*\n?([\s\S]*?)(?=\n##|$)/mu);
    const sourceText = textFromSource(match[2]);
    const referenceTranslation = textFromSource(translationMatch?.[1] || '');
    return {
      number: Number(match[1]),
      questionKey: stableQuestionKey({ year, section: 'part_c', number: Number(match[1]) }),
      segmentKey: `S${match[1]}`,
      sourceText,
      referenceTranslation,
      localAnalysis: textFromSource(block.slice(match[0].length, translationMatch?.index || block.length))
    };
  });
}

function makePartCUnit(source, meta) {
  const partC = sectionSlice(source, '## Part C', ['## Section III']);
  const firstParagraph = partC.search(/\nInnovation and research/iu);
  const passageSurface = firstParagraph >= 0 ? partC.slice(firstParagraph) : partC;
  const passage = stripHeadingAndDirections(passageSurface).map((text, index) => ({ paragraphKey: `P${index + 1}`, text }));
  const analysisStart = source.indexOf('## 逐句解析', source.indexOf('2025年考研英语一 英译汉'));
  const questions = extractTranslationSegments(source.slice(analysisStart < 0 ? 0 : analysisStart), meta.year);
  if (questions.length !== 5) throw new Error(`Part C 翻译题数量异常：${questions.length}`);
  const lines = [
    documentHead(meta, 'Section II Part C'),
    '### Part C', '',
    code({ unitKey: `kaoyan_en1_${meta.year}_part_c`, type: 'translation', displayTitle: 'Part C 翻译' }), '',
    '#### Directions', TRANSLATION_DIRECTIONS, '',
    '#### Passage', '',
    ...passage.flatMap(item => [`##### ${item.paragraphKey}`, item.text, '']),
    ...questions.flatMap(question => [
      '', `#### Q${question.number}`, '',
      code({ questionKey: question.questionKey, segmentKey: question.segmentKey, type: 'translation_segment', points: 2 }), '',
      '##### Source Text', question.sourceText, '',
      ...(question.referenceTranslation ? ['##### Reference Translation', question.referenceTranslation, ''] : []),
      ...(question.localAnalysis ? ['##### Local Analysis', question.localAnalysis] : []),
      `##### Location`, `P${Math.min(6, Math.max(1, question.number - 45))}`
    ])
  ];
  return {
    name: 'part-c',
    markdown: lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n',
    warnings: ['Part C 原始 MD 存在跨栏串行文本；保留来源可核对文本，未依据常识补写正文。']
  };
}

function unitDocumentResult(meta, result) {
  try {
    const paper = parseExamMarkdown(result.markdown);
    assertCanonicalPaper(paper);
    const gate = assertUnitGate({ name: result.name, parse: 'PASS', validation: 'PASS', blockers: [] });
    return { ...result, paper, gate };
  } catch (error) {
    return {
      ...result,
      paper: null,
      gate: { name: result.name, status: 'FAIL', blockers: [error.message] },
      warnings: [...(result.warnings || []), error.message]
    };
  }
}

function fieldCoverage(paper) {
  const questions = paper?.units?.flatMap(unit => unit.questions || []) || [];
  const fields = ['answer', 'stem', 'options', 'explanation', 'location', 'evidence', 'evidenceTranslation', 'optionAnalysis', 'referenceTranslation', 'localAnalysis'];
  const present = Object.fromEntries(fields.map(field => [field, questions.filter(question => {
    const value = question[field];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
  }).length]));
  return {
    questionCount: questions.length,
    present,
    missing: Object.fromEntries(fields.map(field => [field, questions.length - present[field]]))
  };
}

export function convertYearSource({ source, year = 2025, packageVersion = '1.1.0' }) {
  const meta = examMetaForYear(year, packageVersion);
  const sourceSummary = summarizeSourceSections(source);
  const unsupportedPartB = sourceSummary.partB.variant === 'unknown';
  const results = [];
  const builders = [
    () => makeClozeUnit(source, meta),
    ...READING_DESCRIPTORS.map(descriptor => () => makeReadingUnit(source, meta, descriptor)),
    () => unsupportedPartB
      ? {
        name: 'part-b',
        markdown: '',
        paper: null,
        gate: { name: 'part-b', status: 'SKIPPED', blockers: [], reason: UNSUPPORTED_PART_B_VARIANT, variant: sourceSummary.partB.variant },
        warnings: [`${UNSUPPORTED_PART_B_VARIANT}: ${sourceSummary.partB.variant}`]
      }
      : sourceSummary.partB.variant === 'paragraph_ordering'
        ? makePartBUnit(source, meta)
        : makeMatchingUnit(source, meta, sourceSummary.partB.variant),
    () => makePartCUnit(source, meta)
  ];
  for (const build of builders) {
    try {
      const built = build();
      results.push(built.gate?.status === 'SKIPPED' ? built : unitDocumentResult(meta, built));
    } catch (error) {
      const name = results.length === 0 ? 'section1-cloze' : results.length <= 4 ? READING_DESCRIPTORS[results.length - 1].name : results.length === 5 ? 'part-b' : 'part-c';
      results.push({ name, markdown: '', paper: null, gate: { name, status: 'FAIL', blockers: [error.message] }, warnings: [error.message] });
    }
  }
  const blockers = results.flatMap(result => result.gate.status === 'FAIL' ? result.gate.blockers.map(blocker => `${result.name}: ${blocker}`) : []);
  const papers = results.filter(result => result.paper).map(result => result.paper);
  const paper = papers.length && !blockers.length
    ? assertCanonicalPaper({ ...papers[0], packageVersion, units: papers.flatMap(item => item.units) })
    : null;
  const warnings = results.flatMap(result => result.warnings || []);
  return {
    meta,
    sourceSummary,
    unitResults: results,
    paper,
    blockers,
    warnings,
    importedWriting: false,
    questionCount: paper?.units.reduce((total, unit) => total + unit.questions.length, 0) || 0,
    fieldCoverage: fieldCoverage(paper),
    schemaGaps: ['Section III Part A/B writing is intentionally inventory-only and has no imported unit schema.'],
    rendererGaps: results.some(result => result.name === 'part-b' && result.gate.reason === UNSUPPORTED_PART_B_VARIANT)
      ? [`${UNSUPPORTED_PART_B_VARIANT}: Part B variant is not supported by the current renderer.`]
      : []
  };
}

export function renderQaDocument({ name, normalized = [], warnings = [], blockers = [], gate }) {
  return [
    `# ${name} source → exam-md-v1 QA`,
    '',
    '## GATE',
    '',
    `- status: ${gate?.status || 'UNKNOWN'}`,
    `- parse: ${gate?.status === 'PASS' ? 'PASS' : 'FAIL'}`,
    `- validator: ${gate?.status === 'PASS' ? 'PASS' : 'FAIL'}`,
    '',
    '## NORMALIZED', '', normalized.length ? normalized.map(item => `- ${item}`).join('\n') : '- None.',
    '',
    '## WARNINGS', '', warnings.length ? warnings.map(item => `- ${item}`).join('\n') : '- None.',
    '',
    '## BLOCKERS', '', blockers.length ? blockers.map(item => `- ${item}`).join('\n') : '- None.'
  ].join('\n') + '\n';
}
