const TITLE_ABBREVIATION_AT_END = /(?:Mr|Mrs|Dr|Ms|Prof|Sr|Jr|St)\.$/i;
const CONTINUING_ABBREVIATION_AT_END = /(?:vs|e\.g|i\.e)\.$/i;
const GENERAL_ABBREVIATION_AT_END = /(?:etc|inc|Ltd|Corp|No|Fig|Vol|pp|U\.S|U\.K|a\.m|p\.m)\.$/i;
const CLOSING_SENTENCE_CHARACTERS = /["'\u2019\u201d\u00bb\u300d\u300f\u3011)\]}]/u;

function nextNonSpace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
  return cursor < text.length ? text[cursor] : '';
}

function isInitialAtEnd(text, index) {
  const fragment = text.slice(Math.max(0, index - 4), index + 1);
  return /(?:^|[^A-Za-z])[A-Z]\.$/u.test(fragment);
}

export function isSentenceEnd(text, index) {
  const value = String(text || '');
  const character = value[index];
  if (!/[.!?]/u.test(character)) return false;
  if (character === '.' && /\d/u.test(value[index - 1] || '') && /\d/u.test(value[index + 1] || '')) return false;
  const following = value[index + 1] || '';
  if (following && !/[\s.!?"'\u2019\u201d\u00bb\u300d\u300f\u3011)\]}]/u.test(following)) return false;
  if (character !== '.') return true;

  const fragment = value.slice(Math.max(0, index - 18), index + 1);
  const next = nextNonSpace(value, index + 1);
  if ((TITLE_ABBREVIATION_AT_END.test(fragment) || isInitialAtEnd(value, index)) && next) return false;
  if (CONTINUING_ABBREVIATION_AT_END.test(fragment) && next) return false;
  if (GENERAL_ABBREVIATION_AT_END.test(fragment) && next && !/[A-Z\u201c"'(\[]/u.test(next)) return false;
  return true;
}

function sentenceEndWithClosers(text, punctuationIndex) {
  let end = punctuationIndex + 1;
  while (end < text.length && /[.!?]/u.test(text[end])) end += 1;
  while (end < text.length && CLOSING_SENTENCE_CHARACTERS.test(text[end])) end += 1;
  return end;
}

function trimSentenceRange(text, start, end) {
  let trimmedStart = Math.max(0, start);
  let trimmedEnd = Math.min(text.length, end);
  while (trimmedStart < trimmedEnd && /\s/u.test(text[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
  return {
    start: trimmedStart,
    end: trimmedEnd,
    sourceStart: trimmedStart,
    sourceEnd: trimmedEnd,
    text: text.slice(trimmedStart, trimmedEnd)
  };
}

export function splitSentences(text) {
  const value = String(text ?? '');
  if (!value) return [];
  const segments = [];
  let segmentStart = 0;

  for (let index = 0; index < value.length; index += 1) {
    const paragraphBreak = value.slice(index).match(/^\r?\n(?:[ \t]*\r?\n)+/u);
    if (paragraphBreak) {
      const segment = trimSentenceRange(value, segmentStart, index);
      if (segment.text) segments.push(segment);
      segmentStart = index + paragraphBreak[0].length;
      index = segmentStart - 1;
      continue;
    }
    if (!isSentenceEnd(value, index)) continue;
    const end = sentenceEndWithClosers(value, index);
    const segment = trimSentenceRange(value, segmentStart, end);
    if (segment.text) segments.push(segment);
    segmentStart = end;
    index = end - 1;
  }

  const tail = trimSentenceRange(value, segmentStart, value.length);
  if (tail.text) segments.push(tail);
  return segments;
}

export function findSentenceOffsets(text, pointOffset) {
  const value = String(text || '');
  if (!value) return null;
  const offset = Math.max(0, Math.min(Number(pointOffset) || 0, value.length));
  const segments = splitSentences(value);
  const containing = segments.find(segment => offset >= segment.start && offset <= segment.end);
  if (containing) return { start: containing.start, end: containing.end };
  const selected = segments.find(segment => segment.start > offset) || segments.at(-1);
  return selected ? { start: selected.start, end: selected.end } : null;
}

function findTextPosition(textNodes, absoluteOffset, preferPrevious) {
  const nodes = textNodes.filter(node => String(node?.textContent || '').length > 0);
  const totalLength = nodes.reduce((total, node) => total + node.textContent.length, 0);
  const target = Math.max(0, Math.min(absoluteOffset, totalLength));
  let cursor = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const next = cursor + node.textContent.length;
    if (target < next || (preferPrevious && target === next) || index === nodes.length - 1) {
      return { node, offset: Math.max(0, Math.min(target - cursor, node.textContent.length)) };
    }
    cursor = next;
  }
  return null;
}

export function createSentenceRangeForTextNodes({ textNodes, pointNode, pointOffset, createRange }) {
  const nodes = Array.isArray(textNodes) ? textNodes.filter(node => node?.nodeType === 3) : [];
  const pointIndex = nodes.indexOf(pointNode);
  if (pointIndex < 0 || typeof createRange !== 'function') return null;

  const precedingLength = nodes.slice(0, pointIndex).reduce((total, node) => total + node.textContent.length, 0);
  const allText = nodes.map(node => node.textContent).join('');
  const boundaries = findSentenceOffsets(allText, precedingLength + (Number(pointOffset) || 0));
  if (!boundaries) return null;

  const start = findTextPosition(nodes, boundaries.start, false);
  const end = findTextPosition(nodes, boundaries.end, true);
  if (!start || !end) return null;

  const range = createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return { range, text: allText.slice(boundaries.start, boundaries.end), boundaries };
}
