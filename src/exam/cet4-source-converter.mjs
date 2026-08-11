import { parseExamMarkdown } from './parser.mjs';
import { assertCanonicalPaper } from './schema.mjs';
import { assertUnitGate } from './source-production.mjs';

const CJK = /[\u3400-\u9fff]/u;
const RE_PRINT_HEADING = /^##\s*真题卷第(\d)套\((\d{4})-(\d{2})\)\s*•\s*(?:英语)?四级/mu;
const CLOZE_NUMBERS = Array.from({ length: 10 }, (_, index) => index + 26);

function textFromSource(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function englishBlocks(text) {
  return String(text || '')
    .split(/\n+/u)
    .map(line => {
      const firstCjk = line.search(CJK);
      return firstCjk < 0 ? line.trim() : line.slice(0, firstCjk).trim();
    })
    .filter(Boolean);
}

function chineseBlocks(text) {
  return String(text || '')
    .split(/\n+/u)
    .map(line => {
      const firstCjk = line.search(CJK);
      return firstCjk < 0 ? '' : line.slice(firstCjk).trim();
    })
    .filter(Boolean);
}

function code(value) {
  return `\`\`\`exam-item\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function documentHead(meta, section) {
  return `# ${meta.year} 英语四级\n\n\`\`\`exam-meta\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n## ${section}\n`;
}

function metaFor({ year, month, setNumber, packageVersion = '1.0.0' }) {
  const monthText = String(month).padStart(2, '0');
  return {
    schema: 'exam-md-v1',
    examId: 'cet4',
    bankId: 'builtin_cet4',
    packageId: 'local.cet4',
    packageVersion,
    paperKey: `cet4_${year}_${monthText}_${setNumber}`,
    year: Number(year),
    sourceType: 'past_exam'
  };
}

function unitResult(name, markdown, warnings = []) {
  try {
    const paper = parseExamMarkdown(markdown);
    assertCanonicalPaper(paper);
    const gate = assertUnitGate({ name, parse: 'PASS', validation: 'PASS', blockers: [] });
    return { name, markdown, paper, gate, warnings };
  } catch (error) {
    return {
      name,
      markdown,
      paper: null,
      gate: { name, status: 'FAIL', blockers: [error.message] },
      warnings: [...warnings, error.message]
    };
  }
}

function sectionSurface(source, headerPattern) {
  const startMatch = String(source || '').match(headerPattern);
  if (!startMatch) return null;
  const start = startMatch.index;
  const tail = source.slice(start);
  const reprint = tail.match(RE_PRINT_HEADING);
  if (!reprint) return null;
  const surfaceStart = start + reprint.index;
  const after = source.slice(surfaceStart + reprint[0].length);
  const nextAnalysis = after.search(/^## (?:选词填空|信息匹配题|阅读理解题|汉译英真题)/mu);
  const end = nextAnalysis < 0 ? source.length : surfaceStart + reprint[0].length + nextAnalysis;
  return source.slice(surfaceStart, end);
}

function originalReadingSurface(source) {
  const startMatch = String(source || '').match(/^##\s*Part\s+(?:Ⅲ|III)\s+Reading Comprehension[^\n]*/mu);
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  const tail = String(source || '').slice(start);
  const endOffsets = [
    tail.search(/^##\s*Part\s+IV\b/mu),
    tail.search(RE_PRINT_HEADING)
  ].filter(index => index >= 0);
  const end = endOffsets.length ? Math.min(...endOffsets) : tail.length;
  return tail.slice(0, end);
}

function sectionFromSurface(surface, headingPattern, nextPatterns = []) {
  const startMatch = String(surface || '').match(headingPattern);
  if (!startMatch) return null;
  const start = startMatch.index;
  const tail = String(surface || '').slice(start + startMatch[0].length);
  const endOffsets = nextPatterns
    .map(pattern => tail.search(pattern))
    .filter(index => index >= 0);
  const end = endOffsets.length ? Math.min(...endOffsets) : tail.length;
  return String(surface || '').slice(start, start + startMatch[0].length + end);
}

function splitEnglishAndChinese(line) {
  const text = String(line || '').trim();
  let parentheses = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(' || character === '（') parentheses += 1;
    if (character === ')' || character === '）') parentheses = Math.max(0, parentheses - 1);
    if (parentheses === 0 && CJK.test(character)) {
      return {
        english: text.slice(0, index).trim(),
        chinese: text.slice(index).trim()
      };
    }
  }
  return { english: text, chinese: '' };
}

function paragraphText(parts) {
  return textFromSource(parts.join(' '));
}

function parseLabeledBilingualParagraphs(source, { stopPattern = /^\d{2}\.\s/u } = {}) {
  const paragraphs = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const english = paragraphText(current.english);
    const chinese = paragraphText(current.chinese);
    if (english || chinese) paragraphs.push({ paragraphKey: current.key, english, chinese });
    current = null;
  };
  for (const line of String(source || '').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (stopPattern.test(trimmed)) break;
    const label = trimmed.match(/^([A-P])\)\s*(.*)$/u);
    if (label) {
      push();
      current = { key: label[1], english: [], chinese: [] };
      const parts = splitEnglishAndChinese(label[2]);
      if (parts.english) current.english.push(parts.english);
      if (parts.chinese) current.chinese.push(parts.chinese);
      continue;
    }
    if (!current || !trimmed || /^##\s/u.test(trimmed) || /^Directions:/iu.test(trimmed)) continue;
    const parts = splitEnglishAndChinese(trimmed);
    if (parts.english) current.english.push(parts.english);
    if (parts.chinese) current.chinese.push(parts.chinese);
  }
  push();
  return paragraphs;
}

function parseNumberedBilingualParagraphs(source, { stopPattern = /^\d{2}\.\s/u } = {}) {
  const paragraphs = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const english = paragraphText(current.english);
    const chinese = paragraphText(current.chinese);
    if (english || chinese) paragraphs.push({ paragraphKey: current.key, english, chinese });
    current = null;
  };
  for (const line of String(source || '').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (stopPattern.test(trimmed)) break;
    const label = trimmed.match(/^P(\d+)\s*(.*)$/u);
    if (label) {
      push();
      current = { key: `P${label[1]}`, english: [], chinese: [] };
      const parts = splitEnglishAndChinese(label[2]);
      if (parts.english) current.english.push(parts.english);
      if (parts.chinese) current.chinese.push(parts.chinese);
      continue;
    }
    if (!current || !trimmed || /^##\s/u.test(trimmed) || /^Directions:/iu.test(trimmed)) continue;
    const parts = splitEnglishAndChinese(trimmed);
    if (parts.english) current.english.push(parts.english);
    if (parts.chinese) current.chinese.push(parts.chinese);
  }
  push();
  return paragraphs;
}

function parsePlainParagraphs(source) {
  const paragraphs = [];
  let current = [];
  const push = () => {
    const text = paragraphText(current);
    if (text) paragraphs.push(text);
    current = [];
  };
  for (const line of String(source || '').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) { push(); continue; }
    if (/^##\s/u.test(trimmed) || /^Directions:/iu.test(trimmed) || /^Questions\s+/iu.test(trimmed)) continue;
    current.push(trimmed);
  }
  push();
  return paragraphs;
}

function clozeBody(surface) {
  const lines = String(surface || '').split(/\r?\n/u);
  const directionIndex = lines.findIndex(line => /^\s*Directions:/iu.test(line));
  const start = directionIndex < 0 ? 0 : directionIndex + 1;
  const stopIndex = lines.findIndex((line, index) => index >= start && (/^\s*26\.\s/u.test(line) || /^##\s*Section B\b/mu.test(line)));
  const end = stopIndex < 0 ? lines.length : stopIndex;
  return lines.slice(start, end)
    .filter(line => !/^\s*[A-P]\)\s+/u.test(line) && !/<(?:table|tr|td)[^>]*>[\s\S]*[A-P]\)\s*/iu.test(line))
    .join('\n');
}

function parseClozeBilingualPassage(surface) {
  const paragraphs = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const english = paragraphText(current.english);
    const chinese = paragraphText(current.chinese);
    if (english || chinese) paragraphs.push({ english, chinese });
    current = null;
  };
  let breakPending = false;
  for (const line of clozeBody(surface).split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) { breakPending = true; continue; }
    const parts = splitEnglishAndChinese(trimmed);
    if (parts.english) {
      if (!current || (breakPending && current.chinese.length)) {
        push();
        current = { english: [], chinese: [] };
      }
      current.english.push(parts.english);
      breakPending = false;
    }
    if (parts.chinese) {
      if (!current) current = { english: [], chinese: [] };
      current.chinese.push(parts.chinese);
      breakPending = false;
    }
  }
  push();
  return paragraphs;
}

function parseClozePlainPassage(surface) {
  return parsePlainParagraphs(clozeBody(surface));
}

function normalizedClozePassage(texts) {
  return texts.map((text, index) => ({ paragraphKey: `P${index + 1}`, text: textFromSource(text) }));
}

function hasAllClozeMarkers(passage) {
  const markers = passage.flatMap(item => [...item.text.matchAll(/\[(\d+)\]/gu)].map(match => Number(match[1])));
  return CLOZE_NUMBERS.every(number => markers.filter(item => item === number).length === 1);
}

function wordTokens(text) {
  return [...String(text || '').matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?|\d+/gu)].map(match => ({
    value: match[0].toLowerCase(),
    raw: match[0],
    start: match.index,
    end: match.index + match[0].length
  }));
}

function blankContext(stem, number) {
  const marker = String(stem || '').match(new RegExp(`\\(${number}\\)|（${number}）`, 'u'));
  if (!marker) return null;
  const before = wordTokens(String(stem || '').slice(0, marker.index).replace(/[_\\]+/gu, ' '));
  const after = wordTokens(String(stem || '').slice(marker.index + marker[0].length).replace(/[_\\]+/gu, ' '));
  return {
    before: before.slice(-6).map(item => item.value),
    after: after.slice(0, 6).map(item => item.value)
  };
}

function isClozeMarkerToken(token) {
  return CLOZE_NUMBERS.includes(Number(token?.raw));
}

function matchPrefixWithMarkers(tokens, start, expected) {
  let cursor = start;
  for (const word of expected) {
    while (isClozeMarkerToken(tokens[cursor])) cursor += 1;
    if (tokens[cursor]?.value !== word) return null;
    cursor += 1;
  }
  return { end: cursor };
}

function matchSuffixWithMarkers(tokens, start, expected) {
  let cursor = start;
  while (isClozeMarkerToken(tokens[cursor])) cursor += 1;
  const firstTextToken = cursor;
  for (const word of expected) {
    while (isClozeMarkerToken(tokens[cursor])) cursor += 1;
    if (tokens[cursor]?.value !== word) return null;
    cursor += 1;
  }
  return { firstTextToken, end: cursor };
}

function findClozeGap(text, context, number) {
  const tokens = wordTokens(text);
  const prefixLength = context.before.length;
  const suffixLength = context.after.length;
  const prefixStarts = prefixLength
    ? Array.from({ length: tokens.length }, (_, index) => index)
      .filter(index => matchPrefixWithMarkers(tokens, index, context.before))
    : [0];
  for (const prefixStart of prefixStarts) {
    const prefixEnd = matchPrefixWithMarkers(tokens, prefixStart, context.before)?.end ?? prefixStart;
    const maxSuffixStart = Math.min(tokens.length - suffixLength, prefixEnd + 4);
    for (let suffixStart = prefixEnd; suffixStart <= maxSuffixStart; suffixStart += 1) {
      const suffixMatch = suffixLength ? matchSuffixWithMarkers(tokens, suffixStart, context.after) : null;
      if (suffixLength && !suffixMatch) continue;
      const firstSuffixToken = suffixLength ? suffixMatch.firstTextToken : suffixStart;
      const gapTokens = tokens.slice(prefixEnd, firstSuffixToken);
      const target = gapTokens.find(token => token.raw === String(number));
      if (!suffixLength) {
        const trailingTarget = tokens.slice(prefixEnd, Math.min(tokens.length, prefixEnd + 4))
          .find(token => token.raw === String(number));
        if (trailingTarget) return { start: trailingTarget.start, end: trailingTarget.end };
      }
      const gapStart = prefixLength ? tokens[prefixEnd - 1].end : (tokens[suffixStart]?.start || 0);
      const gapEnd = suffixLength ? tokens[firstSuffixToken].start : (gapTokens[gapTokens.length - 1]?.end || gapStart);
      if (target) return { start: target.start, end: target.end };
      return { start: gapStart, end: gapStart };
    }
  }
  return null;
}

function stripOrphanClozeNumbers(text) {
  const value = String(text || '');
  const edits = [];
  for (const token of wordTokens(value)) {
    if (!CLOZE_NUMBERS.includes(Number(token.raw))) continue;
    if (value[token.start - 1] === '[' && value[token.end] === ']') continue;
    const before = value.slice(Math.max(0, token.start - 24), token.start);
    const after = value.slice(token.end, token.end + 24);
    if (/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*$/iu.test(before)) continue;
    if (/^\s*(?:years?|months?|weeks?|days?|percent|%)/iu.test(after)) continue;
    edits.push({ start: token.start, end: token.end });
  }
  return edits.sort((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + result.slice(edit.end), value);
}

function markClozePassage(texts, stems) {
  const values = texts.map(text => String(text || ''));
  const edits = [];
  const found = new Set();
  for (const number of CLOZE_NUMBERS) {
    const context = blankContext(stems.get(number), number);
    if (!context) continue;
    for (let passageIndex = 0; passageIndex < values.length; passageIndex += 1) {
      const gap = findClozeGap(values[passageIndex], context, number);
      if (!gap) continue;
      edits.push({ passageIndex, ...gap, replacement: `[${number}]` });
      found.add(number);
      break;
    }
  }
  for (const number of CLOZE_NUMBERS.filter(item => !found.has(item))) {
    const pattern = new RegExp(`(?<!\\[)${number}(?!\\d)`, 'u');
    for (let passageIndex = 0; passageIndex < values.length; passageIndex += 1) {
      const match = values[passageIndex].match(pattern);
      if (!match) continue;
      edits.push({ passageIndex, start: match.index, end: match.index + String(number).length, replacement: `[${number}]` });
      found.add(number);
      break;
    }
  }
  const grouped = new Map();
  for (const edit of edits) {
    if (!grouped.has(edit.passageIndex)) grouped.set(edit.passageIndex, []);
    grouped.get(edit.passageIndex).push(edit);
  }
  return values.map((value, passageIndex) => {
    const edited = [...(grouped.get(passageIndex) || [])]
      .sort((left, right) => right.start - left.start)
      .reduce((text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end), value);
    return stripOrphanClozeNumbers(edited);
  });
}

function cjkMarkerCount(text) {
  return (String(text || '').match(/[\u3400-\u9fff]/gu) || []).length;
}

function hasEmbeddedFullTranslation(text) {
  const value = String(text || '');
  const cjkCount = cjkMarkerCount(value);
  return cjkCount >= 8 && /[，。；：！？、]/u.test(value) && cjkCount > (value.match(/[A-Za-z]/gu) || []).length * 0.08;
}

function parseCandidates(source) {
  const lines = String(source || '').split(/\n/u);
  const map = new Map();
  let currentKey = null;
  let currentText = '';
  const push = () => {
    if (currentKey && currentText.trim()) map.set(currentKey, textFromSource(currentText));
  };
  const startCandidate = (key, text) => {
    push();
    currentKey = key;
    currentText = text;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const first = trimmed.match(/^([A-P])\)\s*([\s\S]*)$/u);
    if (first) {
      startCandidate(first[1], first[2]);
      const tail = first[2];
      const extra = [...tail.matchAll(/\s([A-P])\)\s*([^\n]*?)(?=\s[A-P]\)|$)/gu)];
      for (const match of extra) startCandidate(match[1], match[2]);
      continue;
    }
    if (/^\d{2}\.\s/u.test(trimmed) || /^## /u.test(trimmed) || /^【/u.test(trimmed) || /^答案/u.test(trimmed)) {
      push();
      currentKey = null;
      currentText = '';
      continue;
    }
    if (currentKey) currentText += ' ' + trimmed;
  }
  push();
  return [...map.entries()].map(([candidateKey, text]) => ({ candidateKey, text }));
}

function parseSlotQuestions(source, numbers) {
  const questions = [];
  for (const number of numbers) {
    const regex = new RegExp(`(?:^|\\n)\\s*${number}\\.\\s*([^\\n]*)`, 'u');
    const match = String(source || '').match(regex);
    if (!match) throw new Error(`缺少 ${number} 题题干`);
    questions.push({ number, stem: textFromSource(match[1]) });
  }
  return questions;
}

function parseWordBankCandidates(source) {
  const end = String(source || '').search(/^\s*26\.\s+/mu);
  const region = end < 0 ? String(source || '') : String(source || '').slice(0, end);
  const cleaned = region.replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/gu, ' ');
  const matches = [...cleaned.matchAll(/([A-P])\)\s*([^\s<]+)/gu)];
  const map = new Map();
  for (const match of matches) {
    if (!map.has(match[1])) map.set(match[1], match[2]);
  }
  return [...map.entries()].map(([candidateKey, text]) => ({ candidateKey, text }));
}

function blankStem(stem) {
  return textFromSource(String(stem || '')
    .replace(/_+\s*\(\s*(\d+)\s*\)\s*_+/gu, '____')
    .replace(/\(\s*(\d+)\s*\)/gu, '____'));
}

function answerFromBlock(block, pattern) {
  const match = String(block || '').match(pattern);
  return match ? match[1] : null;
}

function passageMarkdown(passage) {
  return passage.map(item => `##### ${item.paragraphKey}\n${item.text}\n`).join('\n');
}

function candidatesMarkdown(candidates) {
  return candidates.map(item => `#### Candidate ${item.candidateKey}\n${item.text}\n`).join('\n');
}

function matchingUnitMarkdown({ meta, unitKey, displayTitle, sectionLabel, sectionOrder, variant, slots, directions, passage = [], translation = [], candidates, questions, allowCandidateReuse = false, points = 1 }) {
  const lines = [
    documentHead(meta, sectionLabel),
    `### ${displayTitle}`, '',
    code({
      unitKey,
      type: 'matching',
      displayTitle,
      matchingVariant: variant,
      sectionLabel,
      sectionOrder,
      ...(allowCandidateReuse ? { allowCandidateReuse: true } : {}),
      slots
    }), '',
    '#### Directions', directions, '',
    ...(passage.length ? ['#### Passage', '', passageMarkdown(passage)] : []),
    ...(translation.length ? ['#### Passage Translation', '', passageMarkdown(translation)] : []),
    candidatesMarkdown(candidates),
    ...questions.flatMap(question => [
      '', `#### Slot ${question.number}`, '',
      code({ questionKey: question.questionKey, type: 'matching_slot', answer: question.answer, points }), '',
      question.stem
    ])
  ];
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n';
}

function buildSectionA({ source, meta }) {
  const name = 'section-a';
  const surface = sectionSurface(source, /^##\s*选词填空[^\n]*/mu);
  if (surface === null) return { unit: null, warnings: [], blockers: [`${name}: 未找到 Section A 卷面重印`] };
  const original = originalReadingSurface(source);
  const originalA = original?.match(/^[\s\S]*?(?=^##\s*Section B\b)/mu)?.[0] || '';
  const originalPassage = parseClozePlainPassage(originalA);
  const bilingualPassage = parseClozeBilingualPassage(surface);
  const numbers = CLOZE_NUMBERS;
  const stems = new Map(numbers.map(number => [number, analysisBlockFor(surface, number)?.stem || '']));
  const normalizedOriginal = normalizedClozePassage(markClozePassage(originalPassage, stems));
  const normalizedBilingual = normalizedClozePassage(markClozePassage(bilingualPassage.map(item => item.english).filter(Boolean), stems));
  const passage = hasAllClozeMarkers(normalizedOriginal) && (!bilingualPassage.length || normalizedOriginal.length === bilingualPassage.length)
    ? normalizedOriginal
    : normalizedBilingual;
  const markerMatches = passage.flatMap(item => [...item.text.matchAll(/\[(\d+)\]/gu)].map(match => Number(match[1])));
  const markerCounts = new Map(markerMatches.map(number => [number, markerMatches.filter(item => item === number).length]));
  const missingMarkers = CLOZE_NUMBERS.filter(number => markerCounts.get(number) !== 1);
  if (!passage.length) return { unit: null, warnings: [], blockers: [`${name}: 未找到选词填空文章`] };
  if (missingMarkers.length) return { unit: null, warnings: [], blockers: [`${name}: 文章缺少或重复空位 ${missingMarkers.join(', ')}`] };
  const translation = bilingualPassage
    .map((item, index) => ({ paragraphKey: `P${index + 1}`, text: item.chinese }))
    .filter(item => item.text);
  if (translation.length !== passage.length) {
    return { unit: null, warnings: [], blockers: [`${name}: 文章与全文翻译段落数量不一致 ${translation.length}/${passage.length}`] };
  }
  const candidates = parseWordBankCandidates(surface);
  if (candidates.length !== 15) return { unit: null, warnings: [], blockers: [`${name}: 候选词数量异常 ${candidates.length}/15`] };
  const questions = [];
  for (const number of numbers) {
    const block = analysisBlockFor(surface, number);
    const stem = blankStem(block?.stem);
    const answer = answerFromBlock(`${block?.block || ''} ${block?.stem || ''}`, /【答案】\s*\(?([A-P])\)?/u);
    if (!stem) return { unit: null, warnings: [], blockers: [`${name}: 第 ${number} 空缺少题干`] };
    if (!answer) return { unit: null, warnings: [], blockers: [`${name}: 第 ${number} 空缺少答案`] };
    questions.push({ number, stem, answer, questionKey: `${meta.paperKey}_section_a_q${number}` });
  }
  const markdown = matchingUnitMarkdown({
    meta,
    unitKey: `${meta.paperKey}_section_a_1`,
    displayTitle: '选词填空',
    sectionLabel: 'Section A · 选词填空',
    sectionOrder: 0,
    variant: 'banked_cloze',
    slots: numbers,
    directions: 'Read the following passage with ten blanks. Select one word for each blank from the word bank. Each choice in the bank is identified by a letter and may be used only once.',
    passage,
    translation,
    candidates,
    questions,
    points: 0.5
  });
  return { unit: unitResult(name, markdown), warnings: [], blockers: [] };
}

function analysisBlockFor(source, number) {
  const lines = String(source || '').split(/\n/u);
  const stemPattern = new RegExp(`^\\s*(?:##\\s+)?${number}\\.\\s+`);
  let startIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (stemPattern.test(lines[index])) { startIndex = index; break; }
  }
  if (startIndex < 0) return null;
  const stem = lines[startIndex].replace(stemPattern, '');
  const blockLines = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^\s*(?:##\s+)?\d{2}\.\s+/.test(lines[index])) break;
    blockLines.push(lines[index]);
  }
  return { stem, block: blockLines.join('\n') };
}

function buildSectionB({ source, meta }) {
  const name = 'section-b';
  const surface = sectionSurface(source, /^##\s*信息匹配题和解析[^\n]*/mu);
  if (surface === null) return { unit: null, warnings: [], blockers: [`${name}: 未找到 Section B 卷面重印`] };
  const original = originalReadingSurface(source);
  const originalSection = sectionFromSurface(original, /^##\s*Section B\b[^\n]*/mu, [/^##\s*Section C\b/mu]);
  const originalParagraphs = parseLabeledBilingualParagraphs(originalSection);
  const bilingualParagraphs = parseLabeledBilingualParagraphs(surface);
  const bilingualTranslations = bilingualParagraphs.filter(item => item.chinese);
  const activeParagraphs = originalParagraphs.length === bilingualTranslations.length
    ? originalParagraphs
    : bilingualParagraphs;
  const candidates = activeParagraphs
    .filter(item => item.paragraphKey >= 'A' && item.paragraphKey <= 'P')
    .map(item => ({ candidateKey: item.paragraphKey, text: item.english }));
  if (candidates.length < 5) return { unit: null, warnings: [], blockers: [`${name}: 段落候选数量异常 ${candidates.length}`] };
  const passage = candidates.map(item => ({ paragraphKey: item.candidateKey, text: item.text }));
  const translation = bilingualParagraphs
    .filter(item => item.paragraphKey >= 'A' && item.paragraphKey <= 'P' && item.chinese)
    .map(item => ({ paragraphKey: item.paragraphKey, text: item.chinese }));
  if (translation.length !== passage.length) {
    return { unit: null, warnings: [], blockers: [`${name}: 文章与全文翻译段落数量不一致 ${translation.length}/${passage.length}`] };
  }
  const answerMarker = surface.indexOf('## 答案与逐句解析');
  const answerRegion = answerMarker < 0 ? surface : surface.slice(answerMarker);
  const numbers = Array.from({ length: 10 }, (_, index) => index + 36);
  const questions = [];
  for (const number of numbers) {
    const block = analysisBlockFor(answerRegion, number);
    const stem = textFromSource(block?.stem || '');
    const combined = `${block?.block || ''} ${block?.stem || ''}`;
    const answer = answerFromBlock(combined, /【答案】\s*([A-P])\s*段/u)
      || answerFromBlock(combined, /段\s*（([A-P])）|（([A-P])）\s*段/u)
      || answerFromBlock(combined, /【定位】\s*([A-P])\s*段/u)
      || null;
    if (!stem) return { unit: null, warnings: [], blockers: [`${name}: 第 ${number} 句缺少题干`] };
    if (!answer) return { unit: null, warnings: [], blockers: [`${name}: 第 ${number} 句缺少答案`] };
    questions.push({ number, stem, answer, questionKey: `${meta.paperKey}_section_b_q${number}` });
  }
  const markdown = matchingUnitMarkdown({
    meta,
    unitKey: `${meta.paperKey}_section_b_1`,
    displayTitle: '长篇阅读',
    sectionLabel: 'Section B · 长篇阅读',
    sectionOrder: 1,
    variant: 'long_reading',
    slots: numbers,
    directions: 'Read the passage with ten statements attached to it. Each statement contains information given in one of the paragraphs. You may choose a paragraph more than once.',
    passage,
    translation,
    candidates,
    questions,
    allowCandidateReuse: true,
    points: 1
  });
  return { unit: unitResult(name, markdown), warnings: [], blockers: [] };
}

function parseMcqQuestions(source, numbers) {
  const text = String(source || '');
  const questions = [];
  for (const number of numbers) {
    const startMatch = text.match(new RegExp(`(?:^|\\n)\\s*${number}\\.\\s*`, 'u'));
    if (!startMatch) throw new Error(`缺少 ${number} 题`);
    const start = startMatch.index + startMatch[0].length;
    const nextMatch = text.slice(start).match(/(?:^|\n)\s*\d{2}\.\s*/u);
    const end = nextMatch ? start + nextMatch.index : text.length;
    const block = text.slice(start, end);
    const optionMarker = block.search(/\s[A-D]\)\s/u);
    const stem = textFromSource(optionMarker < 0 ? block : block.slice(0, optionMarker));
    const options = [];
    const optionRegex = /([A-D])\)\s*/gu;
    let match;
    let cursor = optionMarker < 0 ? 0 : optionMarker;
    const segmentStart = optionMarker < 0 ? 0 : optionMarker;
    while ((match = optionRegex.exec(block))) {
      if (match.index < segmentStart) continue;
      const optionText = block.slice(match.index + match[0].length, optionRegex.lastIndex > 0 ? block.length : block.length).trim();
      const nextMarker = block.slice(match.index + match[0].length).search(/\s[A-D]\)\s/u);
      const endIndex = nextMarker < 0 ? block.length : match.index + match[0].length + nextMarker;
      const textValue = textFromSource(block.slice(match.index + match[0].length, endIndex));
      if (textValue) options.push({ key: match[1], text: textValue });
      cursor = endIndex;
      if (match[1] === 'D') break;
    }
    if (options.length !== 4) throw new Error(`${number} 题选项数量异常 ${options.length}`);
    questions.push({ number, stem, options });
  }
  return questions;
}

function originalMcqPassage(section, first, last) {
  const questionHeader = String(section || '').match(new RegExp(`Questions\\s+${first}\\s+to\\s+${last}\\s+are based on the following passage\\.`, 'iu'));
  if (!questionHeader) return [];
  const afterHeader = String(section || '').slice(questionHeader.index + questionHeader[0].length);
  const firstQuestion = afterHeader.search(new RegExp(`^\\s*${first}\\.\\s`, 'mu'));
  const body = firstQuestion < 0 ? afterHeader : afterHeader.slice(0, firstQuestion);
  return parsePlainParagraphs(body);
}

function buildSectionC({ source, meta }) {
  const units = [];
  const warnings = [];
  const blockers = [];
  const ranges = [[46, 50, 'Passage One'], [51, 55, 'Passage Two']];
  for (const [first, last, title] of ranges) {
    const name = `section-c-${first === 46 ? 1 : 2}`;
    const surface = sectionSurface(source, new RegExp(`^##\\s*阅读理解题和解析[^\\n]*${first}[–-]${last}`, 'mu'));
    if (surface === null) { blockers.push(`${name}: 未找到 ${first}–${last} 题解析章节`); continue; }
    const numbers = Array.from({ length: 5 }, (_, index) => first + index);
    const analysisMatch = surface.match(/^##\s*答案与逐题解析/mu);
    if (!analysisMatch) { blockers.push(`${name}: 未找到答案与逐题解析`); continue; }
    const questionSurface = surface.slice(0, analysisMatch.index);
    let questions;
    try {
      questions = parseMcqQuestions(questionSurface, numbers);
    } catch (error) {
      blockers.push(`${name}: ${error.message}`);
      continue;
    }
    const analysis = surface.slice(analysisMatch.index);
    const answerRegion = analysis;
    let complete = true;
    questions = questions.map(question => {
      const block = analysisBlockFor(analysis, question.number);
      const answer = answerFromBlock(`${block?.block || ''} ${block?.stem || ''}`, /【答案】\s*\(?([A-D])\)?/u);
      const location = String(block?.block || '').match(/【定位】\s*(P\d+)/u)?.[1] || '';
      if (!answer) { complete = false; blockers.push(`${name}: 第 ${question.number} 题缺少答案`); }
      const optionAnalysis = [];
      const optionBlock = block?.block || '';
      const optionStart = optionBlock.search(/^#+\s*【选项】/mu);
      const optionAnalysisSource = optionStart < 0 ? '' : optionBlock.slice(optionStart);
      const optionPattern = /^#*\s*(?:【选项】\s*)?([A-D])\)?\s*([^\n]*)/gmu;
      let optionMatch;
      while ((optionMatch = optionPattern.exec(optionAnalysisSource))) {
        const text = textFromSource(optionMatch[2]);
        if (text) optionAnalysis.push({ key: optionMatch[1], text });
      }
      const explanationLines = (block?.block || '').split(/\n/u)
        .filter(line => !/^##\s*【答案】/u.test(line) && !/^##\s*【定位】/u.test(line) && !/^##\s*【选项】/u.test(line) && !/^【答案】/u.test(line) && !/^【定位】/u.test(line) && !/^【选项】/u.test(line))
        .map(line => line.trim())
        .filter(Boolean);
      return { ...question, answer, location, optionAnalysis, explanation: explanationLines.join('\n') };
    });
    if (!complete) continue;
    const original = originalReadingSurface(source);
    const originalSection = sectionFromSurface(original, /^##\s*Section C\b[^\n]*/mu, [/^##\s*Part\s+IV\b/mu]);
    const passageHeading = first === 46 ? /^##\s*Passage One\b[^\n]*/mu : /^##\s*Passage Two\b[^\n]*/mu;
    const originalPassageSection = sectionFromSurface(originalSection, passageHeading, [
      first === 46 ? /^##\s*Passage Two\b/mu : /^##\s*Part\s+IV\b/mu
    ]);
    const originalPassage = originalMcqPassage(originalPassageSection, first, last);
    const bilingualParagraphs = parseNumberedBilingualParagraphs(surface);
    const translation = bilingualParagraphs
      .map(item => ({ paragraphKey: item.paragraphKey, text: item.chinese }))
      .filter(item => item.text);
    const bilingualPassage = bilingualParagraphs.filter(item => item.english).map(item => ({ paragraphKey: item.paragraphKey, text: item.english }));
    const originalPassageItems = originalPassage.map((text, index) => ({ paragraphKey: `P${index + 1}`, text }));
    const passage = originalPassageItems.length === translation.length
      ? originalPassageItems
      : bilingualPassage;
    if (!passage.length) { blockers.push(`${name}: 未找到正文段落`); continue; }
    if (translation.length !== passage.length) {
      blockers.push(`${name}: 文章与全文翻译段落数量不一致 ${translation.length}/${passage.length}`);
      continue;
    }
    if (passage.some(item => hasEmbeddedFullTranslation(item.text))) {
      blockers.push(`${name}: 正文疑似混入全文中文翻译`);
      continue;
    }
    const lines = [
      documentHead(meta, `Section C · ${title}`),
      `### ${title}`, '',
      code({ unitKey: `${meta.paperKey}_section_c_${first === 46 ? 1 : 2}`, type: 'reading_mcq', displayTitle: title, sectionLabel: 'Section C · 仔细阅读', sectionOrder: 2 }), '',
      '#### Directions', 'Read the passages and answer the questions by choosing A, B, C or D.', '',
      '#### Passage', '', passageMarkdown(passage),
      ...(translation.length ? ['#### Passage Translation', '', passageMarkdown(translation)] : []),
      ...questions.flatMap(question => [
        '', `#### Q${question.number}`, '',
        code({ questionKey: `${meta.paperKey}_section_c_q${question.number}`, type: 'single_choice', answer: question.answer, points: 2 }), '',
        question.stem,
        ...question.options.map(option => `- ${option.key}. ${option.text}`),
        ...(question.location ? ['', '##### Location', question.location] : []),
        ...(question.explanation ? ['', '##### Explanation', question.explanation] : []),
        ...(question.optionAnalysis.length ? ['', '##### Option Analysis', ...question.optionAnalysis.map(option => `- ${option.key}: ${option.text}`)] : [])
      ])
    ];
    units.push(unitResult(name, lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n'));
  }
  return { units, warnings, blockers };
}

function buildTranslation({ source, meta }) {
  const name = 'translation';
  const headerMatch = String(source || '').match(/^##\s*汉译英真题[^\n]*/mu) || String(source || '').match(/^##\s*汉译英[^\n]*/mu);
  if (!headerMatch) return { unit: null, warnings: [], blockers: [`${name}: 未找到汉译英解析章节`] };
  const tail = source.slice(headerMatch.index);
  const analysisStart = tail.indexOf('## 逐句解析');
  const analysis = tail.slice(analysisStart < 0 ? 0 : analysisStart);
  const sentenceRegex = /(?:^|\n)\s*(?:##\s*)?(\d+)\.\s*([^\n]*)/gu;
  const matches = [...analysis.matchAll(sentenceRegex)];
  if (!matches.length) return { unit: null, warnings: [], blockers: [`${name}: 逐句解析无句子`] };
  const questions = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const number = Number(match[1]);
    const sourceText = textFromSource(match[2]);
    if (!sourceText) continue;
    const block = analysis.slice(match.index, matches[index + 1]?.index || analysis.length);
    const translationMatch = block.match(/【译文】\s*\n?([\s\S]*?)(?=\n\s*(?:##\s*)?\d+\.\s|\n(?:##\s*)?【|\n## |$)/u);
    const referenceTranslation = textFromSource(translationMatch?.[1] || '');
    const localAnalysis = textFromSource(block.replace(/【译文】[\s\S]*$/u, '').replace(new RegExp(`^\\s*(?:##\\s+)?${number}\\.\\s*[^\\n]*`), ''));
    if (!referenceTranslation) {
      return { unit: null, warnings: [], blockers: [`${name}: 第 ${number} 句缺少参考译文`] };
    }
    questions.push({
      number,
      sourceText,
      referenceTranslation,
      localAnalysis,
      questionKey: `${meta.paperKey}_translation_q${number}`,
      segmentKey: `T${number}`
    });
  }
  if (!questions.length) return { unit: null, warnings: [], blockers: [`${name}: 没有可导入的翻译句`] };
  let directionsIndex = String(source || '').search(/30 minutes to translate a passage/u);
  if (directionsIndex < 0) {
    const partFour = String(source || '').search(/^## Part IV Translation/mu);
    if (partFour >= 0) directionsIndex = partFour;
  }
  const passage = [];
  if (directionsIndex >= 0) {
    const passageSection = source.slice(directionsIndex);
    const nextHeading = passageSection.search(/^## /mu);
    const sectionText = nextHeading < 0 ? passageSection : passageSection.slice(0, nextHeading);
    const paragraphs = chineseBlocks(sectionText);
    paragraphs.forEach((text, index) => passage.push({ paragraphKey: `P${index + 1}`, text }));
  }
  if (!passage.length) {
    const fallback = chineseBlocks(String(source || '').slice(0, 8000));
    fallback.slice(0, 3).forEach((text, index) => passage.push({ paragraphKey: `P${index + 1}`, text }));
  }
  const lines = [
    documentHead(meta, 'Part IV · 汉译英'),
    '### 汉译英', '',
    code({ unitKey: `${meta.paperKey}_translation_1`, type: 'translation', displayTitle: '汉译英', direction: 'zh_to_en', sectionLabel: 'Part IV · 汉译英', sectionOrder: 3 }), '',
    '#### Directions', 'Translate the following passage from Chinese into English.', '',
    ...(passage.length ? ['#### Passage', '', passageMarkdown(passage)] : []),
    ...questions.flatMap(question => [
      '', `#### Q${question.number}`, '',
      code({ questionKey: question.questionKey, segmentKey: question.segmentKey, type: 'translation_segment', points: 2 }), '',
      '##### Source Text', question.sourceText, '',
      '##### Reference Translation', question.referenceTranslation, '',
      ...(question.localAnalysis ? ['##### Local Analysis', question.localAnalysis] : [])
    ])
  ];
  return { unit: unitResult(name, lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd() + '\n'), warnings: [], blockers: [] };
}

export function buildCET4Paper({ source, year, month, setNumber, packageVersion = '1.0.0' }) {
  const meta = metaFor({ year, month, setNumber, packageVersion });
  const units = [];
  const warnings = [];
  const blockers = [];

  const sectionA = buildSectionA({ source, meta });
  if (sectionA.unit) units.push(sectionA.unit);
  warnings.push(...sectionA.warnings);
  blockers.push(...sectionA.blockers);

  const sectionB = buildSectionB({ source, meta });
  if (sectionB.unit) units.push(sectionB.unit);
  warnings.push(...sectionB.warnings);
  blockers.push(...sectionB.blockers);

  const sectionC = buildSectionC({ source, meta });
  units.push(...sectionC.units);
  warnings.push(...sectionC.warnings);
  blockers.push(...sectionC.blockers);

  const translation = buildTranslation({ source, meta });
  if (translation.unit) units.push(translation.unit);
  warnings.push(...translation.warnings);
  blockers.push(...translation.blockers);

  for (const unit of units) {
    if (unit.gate.status !== 'PASS') blockers.push(...unit.gate.blockers);
  }
  return {
    meta,
    paperKey: meta.paperKey,
    units,
    unitResults: units,
    questionCount: units.reduce((total, unit) => total + (unit.paper?.units?.[0]?.questions?.length || 0), 0),
    warnings,
    blockers
  };
}

export { metaFor, unitResult, documentHead, code, textFromSource, englishBlocks, chineseBlocks, sectionSurface, parseCandidates, parseSlotQuestions, blankStem };
