const TEXT_NODE = 3;
const SHOW_TEXT = 4;

function containsPoint(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function rangeContainsPoint(range, x, y) {
  return Array.from(range?.getClientRects?.() || []).some(rect => containsPoint(rect, x, y));
}

export function getRangeAtPoint(event) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || typeof document === 'undefined') return null;

  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.setEnd(position.offsetNode, position.offset);
    }
  }
  if (range?.startContainer?.nodeType === TEXT_NODE) return range;

  const hitElement = document.elementFromPoint?.(x, y);
  if (!hitElement || hitElement.closest?.('button, a, input, textarea, select, [role="button"]')) return null;
  const container = hitElement.closest?.('.en-paragraph, .reading-title, p, [data-selection-source]') || hitElement;
  const walker = document.createTreeWalker?.(container, SHOW_TEXT);
  if (!walker) return null;

  let node;
  while ((node = walker.nextNode())) {
    for (let offset = 0; offset < (node.textContent || '').length; offset += 1) {
      const charRange = document.createRange();
      charRange.setStart(node, offset);
      charRange.setEnd(node, offset + 1);
      if (rangeContainsPoint(charRange, x, y)) return charRange;
    }
  }
  return null;
}
