import { getRangeAtPoint } from './word-point.mjs';

const normalizeSentence = value => String(value || '').replace(/\s+/g, ' ').trim();

export function getContextSentenceAtPoint(event, root = document) {
  const range = getRangeAtPoint(event);
  const pointNode = range?.startContainer;
  const textNodeType = globalThis.Node?.TEXT_NODE || 3;
  const element = pointNode?.nodeType === textNodeType ? pointNode.parentElement : pointNode;
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
  const before = text.slice(0, offset);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
  const after = text.slice(offset);
  const boundary = after.search(/[.!?](?=\s|$)/);
  const end = boundary === -1 ? text.length : offset + boundary + 1;
  return normalizeSentence(text.slice(start, end));
}
