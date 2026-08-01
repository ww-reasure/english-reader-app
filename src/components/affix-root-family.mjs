const ROOT_TEXT = /^[a-z]+(?:\s*\/\s*[a-z]+)*$/iu;

const escapeHtml = value => String(value ?? '')
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;')
  .replace(/'/gu, '&#39;');

const normalizeLetters = value => String(value || '').trim().toLocaleLowerCase('en-US').replace(/[^a-z]/gu, '');

export function normalizeRootFamily(value) {
  if (!value || typeof value !== 'object') return null;
  const label = String(value.label || '').trim();
  const meaningZh = String(value.meaningZh || '').trim();
  const forms = [...new Set((Array.isArray(value.forms) ? value.forms : [])
    .map(normalizeLetters)
    .filter(form => form.length >= 2))];
  if (!label || !meaningZh || !forms.length || !ROOT_TEXT.test(label)) return null;
  return { label, meaningZh, forms };
}

export function normalizeRelatedRootWord(value, family = null) {
  const word = String(value?.word || '').trim().toLocaleLowerCase('en-US');
  const translation = String(value?.translation || '').trim();
  if (!word) return null;
  const requested = normalizeLetters(value?.rootForm);
  const candidates = family?.forms || [];
  const rootForm = requested && candidates.includes(requested) && word.includes(requested)
    ? requested
    : candidates.find(form => word.includes(form)) || '';
  return { word, translation, rootForm };
}

export function renderRootHighlightedWord(word, rootForm, escape = escapeHtml) {
  const text = String(word || '');
  const root = normalizeLetters(rootForm);
  const index = root ? text.toLocaleLowerCase('en-US').indexOf(root) : -1;
  if (index < 0) return escape(text);
  return `${escape(text.slice(0, index))}<mark class="word-study-root-highlight">${escape(text.slice(index, index + root.length))}</mark>${escape(text.slice(index + root.length))}`;
}
