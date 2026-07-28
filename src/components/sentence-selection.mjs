const ABBREVIATION_AT_END = /(?:Mr|Mrs|Dr|Ms|Prof|Sr|Jr|St|vs|etc|inc|Ltd|Corp|U\.S|U\.K|e\.g|i\.e|a\.m|p\.m)\.$/i;

function isSentenceEnd(text, index) {
  const character = text[index];
  if (!/[.!?]/.test(character)) return false;
  if (character === '.' && ABBREVIATION_AT_END.test(text.slice(Math.max(0, index - 14), index + 1))) return false;
  const following = text[index + 1] || '';
  return !following || /[\s\"')\]\}]/.test(following);
}

export function findSentenceOffsets(text, pointOffset) {
  const value = String(text || '');
  if (!value) return null;
  const offset = Math.max(0, Math.min(Number(pointOffset) || 0, value.length));

  let start = 0;
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (isSentenceEnd(value, index)) {
      start = index + 1;
      break;
    }
  }
  while (start < value.length && /\s/.test(value[start])) start += 1;

  let end = value.length;
  for (let index = offset; index < value.length; index += 1) {
    if (isSentenceEnd(value, index)) {
      end = index + 1;
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
