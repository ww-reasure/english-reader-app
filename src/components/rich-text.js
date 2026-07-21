const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const inline = value => escapeHtml(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const listMatch = line => line.match(/^\s*([-*])\s+(.+)$/) || line.match(/^\s*(\d+)\.\s+(.+)$/);

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

  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.+)$/);
    const item = listMatch(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
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
