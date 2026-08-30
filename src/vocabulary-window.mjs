export const VOCABULARY_WINDOW_MAX_ROWS = 120;
export const VOCABULARY_WINDOW_MIN_ROWS = 60;
export const VOCABULARY_ESTIMATED_ROW_HEIGHT = 104;

export function createVocabularyWindow(rows = [], {
  scrollTop = 0,
  viewportHeight = 720,
  estimatedRowHeight = VOCABULARY_ESTIMATED_ROW_HEIGHT,
  overscanRows = 30
} = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const rowHeight = Math.max(1, Number(estimatedRowHeight) || VOCABULARY_ESTIMATED_ROW_HEIGHT);
  const visibleRows = Math.max(1, Math.ceil(Math.max(0, Number(viewportHeight) || 0) / rowHeight));
  const windowSize = Math.min(
    VOCABULARY_WINDOW_MAX_ROWS,
    Math.max(VOCABULARY_WINDOW_MIN_ROWS, visibleRows + Math.max(0, Number(overscanRows) || 0) * 2)
  );
  const centerStart = Math.floor(Math.max(0, Number(scrollTop) || 0) / rowHeight);
  const start = Math.max(0, Math.min(source.length, centerStart - Math.max(0, Number(overscanRows) || 0)));
  const end = Math.min(source.length, start + windowSize);
  return {
    start,
    end,
    rows: source.slice(start, end),
    topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, source.length - end) * rowHeight,
    estimatedRowHeight: rowHeight,
    totalCount: source.length
  };
}
