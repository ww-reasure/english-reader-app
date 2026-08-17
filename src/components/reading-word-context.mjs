import { getRangeAtPoint } from './word-point.mjs';
import { findSentenceOffsets } from './sentence-selection.mjs';

const normalizeSentence = value => String(value || '').replace(/\s+/g, ' ').trim();

export function getContextSentenceAtPoint(event, root = document) {
  const range = getRangeAtPoint(event);
  const pointNode = range?.startContainer;
  const textNodeType = globalThis.Node?.TEXT_NODE || 3;
  const element = pointNode?.nodeType === textNodeType ? pointNode.parentElement : pointNode;
  const wrappedSentence = element?.closest?.('.reading-sentence');
  if (wrappedSentence && (wrappedSentence.dataset?.sentenceText || wrappedSentence.classList?.contains?.('reading-sentence')) && root?.contains?.(wrappedSentence)) {
    return normalizeSentence(wrappedSentence.dataset?.sentenceText || wrappedSentence.textContent);
  }
  const block = element?.closest?.('.en-paragraph, p, [data-selection-source]');
  if (!block || !pointNode || pointNode.nodeType !== textNodeType || !root?.contains?.(block)) return '';

  const walker = document.createTreeWalker(block, globalThis.NodeFilter?.SHOW_TEXT || 4);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  const pointIndex = nodes.indexOf(pointNode);
  if (pointIndex < 0) return normalizeSentence(block.textContent);

  const offset = nodes.slice(0, pointIndex).reduce((total, item) => total + item.textContent.length, 0) + range.startOffset;
  const text = block.textContent || '';
  if (offset < 0 || offset > text.length) return '';
  const boundaries = findSentenceOffsets(text, offset);
  return normalizeSentence(boundaries ? text.slice(boundaries.start, boundaries.end) : text);
}
