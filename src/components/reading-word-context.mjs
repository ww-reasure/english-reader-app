import { getRangeAtPoint } from './word-point.mjs';
import { findSentenceOffsets } from './sentence-selection.mjs';

const normalizeSentence = value => String(value || '').replace(/\s+/gu, ' ').trim();
const BLOCK_SELECTOR = [
  '.en-paragraph',
  '.exam-question-stem',
  '.exam-option-text',
  '.sentence-guide-source',
  'p',
  '[data-selection-source]'
].join(', ');

export function getContextSentenceAtPoint(event, root = globalThis.document) {
  const directTarget = event?.target?.nodeType === 3 ? event.target.parentElement : event?.target;
  const directSentence = directTarget?.closest?.('.reading-sentence');
  if (directSentence && root?.contains?.(directSentence)) {
    return normalizeSentence(directSentence.dataset?.sentenceText || directSentence.textContent);
  }

  const range = getRangeAtPoint(event);
  const pointNode = range?.startContainer;
  const textNodeType = globalThis.Node?.TEXT_NODE || 3;
  const element = pointNode?.nodeType === textNodeType ? pointNode.parentElement : pointNode;
  const wrappedSentence = element?.closest?.('.reading-sentence');
  if (wrappedSentence && root?.contains?.(wrappedSentence)) {
    return normalizeSentence(wrappedSentence.dataset?.sentenceText || wrappedSentence.textContent);
  }
  const block = element?.closest?.(BLOCK_SELECTOR);
  if (!block || !pointNode || pointNode.nodeType !== textNodeType || !root?.contains?.(block)) return '';

  const walker = globalThis.document?.createTreeWalker?.(block, globalThis.NodeFilter?.SHOW_TEXT || 4);
  if (!walker) return normalizeSentence(block.textContent);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  const pointIndex = nodes.indexOf(pointNode);
  if (pointIndex < 0) return normalizeSentence(block.textContent);
  const precedingLength = nodes.slice(0, pointIndex).reduce((total, item) => total + String(item.textContent || '').length, 0);
  const offset = precedingLength + Math.max(0, Number(range.startOffset) || 0);
  const text = String(block.textContent || '');
  if (offset > text.length) return '';
  const boundaries = findSentenceOffsets(text, offset);
  return normalizeSentence(boundaries ? text.slice(boundaries.start, boundaries.end) : text);
}

export const READING_WORD_CONTEXT_BLOCK_SELECTOR = BLOCK_SELECTOR;
