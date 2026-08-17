const ABBREVIATION_AT_END = /(?:Mr|Mrs|Dr|Ms|Prof|Sr|Jr|St|vs|etc|inc|Ltd|Corp|U\.S|U\.K|e\.g|i\.e|a\.m|p\.m)\.$/i;
const CLOSING_SENTENCE_CHARACTERS = /[\"'\u2019\u201d\u00bb\u300d\u300f\u3011\)\]\}]/;

export function isSentenceEnd(text, index) {
  const character = text[index];
  if (!/[.!?]/.test(character)) return false;
  if (character === '.' && ABBREVIATION_AT_END.test(text.slice(Math.max(0, index - 14), index + 1))) return false;
  const following = text[index + 1] || '';
  return !following || /[\s\"'\u2019\u201d\u00bb\u300d\u300f\u3011)\]}]/.test(following);
}

function sentenceEndWithClosingCharacters(text, punctuationIndex) {
  let end = punctuationIndex + 1;
  while (end < text.length && CLOSING_SENTENCE_CHARACTERS.test(text[end])) end += 1;
  return end;
}

function trimRange(text, start, end) {
  let trimmedStart = Math.max(0, start);
  let trimmedEnd = Math.min(text.length, end);
  while (trimmedStart < trimmedEnd && /\s/.test(text[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
  return {
    start: trimmedStart,
    end: trimmedEnd,
    sourceStart: trimmedStart,
    sourceEnd: trimmedEnd,
    range: { start: trimmedStart, end: trimmedEnd },
    text: text.slice(trimmedStart, trimmedEnd)
  };
}

/**
 * Split source text using the same abbreviation-aware boundary rules used by
 * long-press selection. Ranges point back into the original string so callers
 * can wrap a sentence without changing whitespace, punctuation, or quotes.
 */
export function splitSentences(text) {
  const value = String(text ?? '');
  if (!value) return [];

  const segments = [];
  let segmentStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const paragraphBreak = value.slice(index).match(/^\r?\n(?:[ \t]*\r?\n)+/);
    if (paragraphBreak) {
      const paragraph = trimRange(value, segmentStart, index);
      if (paragraph.text) segments.push(paragraph);
      segmentStart = index + paragraphBreak[0].length;
      index = segmentStart - 1;
      continue;
    }
    if (!isSentenceEnd(value, index)) continue;
    const end = sentenceEndWithClosingCharacters(value, index);
    const segment = trimRange(value, segmentStart, end);
    if (segment.text) segments.push(segment);
    segmentStart = end;
    while (segmentStart < value.length && /\s/.test(value[segmentStart])) segmentStart += 1;
    index = end - 1;
  }

  const tail = trimRange(value, segmentStart, value.length);
  if (tail.text) segments.push(tail);
  return segments;
}

// Explicit aliases make the shared contract discoverable to older callers.
export const segmentSentences = splitSentences;
export const findSentenceSegments = splitSentences;

export function findSentenceOffsets(text, pointOffset) {
  const value = String(text || '');
  if (!value) return null;
  const offset = Math.max(0, Math.min(Number(pointOffset) || 0, value.length));

  let start = 0;
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (isSentenceEnd(value, index)) {
      start = sentenceEndWithClosingCharacters(value, index);
      break;
    }
  }
  while (start < value.length && /\s/.test(value[start])) start += 1;

  let end = value.length;
  for (let index = offset; index < value.length; index += 1) {
    if (isSentenceEnd(value, index)) {
      end = sentenceEndWithClosingCharacters(value, index);
      break;
    }
  }
  while (end > start && /\s/.test(value[end - 1])) end -= 1;

  return end > start ? { start, end } : null;
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
