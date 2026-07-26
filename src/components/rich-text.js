const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const inline = value => {
  const codeSpans = [];
  const placeholder = code => {
    codeSpans.push('<code>' + code + '</code>');
    return '\u0000code-' + (codeSpans.length - 1) + '\u0000';
  };
  const formatted = escapeHtml(value)
    .replace(/`([^`]+)`/g, (_, code) => placeholder(code))
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=$|[^\w*])/g, '$1<em>$2</em>');

  return formatted.replace(/\u0000code-(\d+)\u0000/g, (_, index) => codeSpans[Number(index)]);
};

const listMatch = line => line.match(/^\s*([-*])\s+(.+)$/) || line.match(/^\s*(\d+)\.\s+(.+)$/);

const tableCells = line => {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('|')) return null;
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = withoutOuterPipes.split('|').map(cell => cell.trim());
  return cells.length > 1 ? cells : null;
};

const isTableSeparator = cells => Array.isArray(cells) && cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));

const renderTable = (header, rows) => '<div class="rich-table-scroll"><table><thead><tr>'
  + header.map(cell => '<th>' + inline(cell) + '</th>').join('')
  + '</tr></thead><tbody>'
  + rows.map(row => '<tr>' + row.map(cell => '<td>' + inline(cell) + '</td>').join('') + '</tr>').join('')
  + '</tbody></table></div>';

export function renderLearningMarkdown(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push('<' + list.type + '>' + list.items.map(item => '<li>' + inline(item) + '</li>').join('') + '</' + list.type + '>');
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headerCells = tableCells(line);
    const separatorCells = tableCells(lines[index + 1]);
    if (headerCells && separatorCells && headerCells.length === separatorCells.length && isTableSeparator(separatorCells)) {
      flushParagraph();
      flushList();
      const rows = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length) {
        const rowCells = tableCells(lines[rowIndex]);
        if (!rowCells || rowCells.length !== headerCells.length) break;
        rows.push(rowCells);
        rowIndex += 1;
      }
      blocks.push(renderTable(headerCells, rows));
      index = rowIndex - 1;
      continue;
    }
    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.+)$/);
    const item = listMatch(line);
    const rule = /^\s{0,3}(?:\*\s*){3,}$/.test(line) || /^\s{0,3}(?:-\s*){3,}$/.test(line) || /^\s{0,3}(?:_\s*){3,}$/.test(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (rule) {
      flushParagraph();
      flushList();
      blocks.push('<hr>');
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
    } else if (quote) {
      flushParagraph();
      flushList();
      blocks.push('<blockquote>' + inline(quote[1]) + '</blockquote>');
    } else if (item) {
      flushParagraph();
      const type = /^\d+$/.test(item[1]) ? 'ol' : 'ul';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(item[2]);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return '<div class="rich-content">' + blocks.join('') + '</div>';
}
