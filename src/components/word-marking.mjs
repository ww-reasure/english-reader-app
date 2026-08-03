const TOKEN_PATTERN = /[A-Za-z]+(?:['’–-][A-Za-z]+)*/gu;

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function normalizeSurface(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function addIndexValue(index, form, word) {
  const key = normalizeSurface(form);
  if (!key || !word) return;
  const existing = index.get(key);
  if (existing === undefined) {
    index.set(key, word);
    return;
  }
  if (existing === null) return;
  const existingStem = normalizeSurface(existing.stem || existing.word || existing.lemma || '');
  const nextStem = normalizeSurface(word.stem || word.word || word.lemma || '');
  if (existingStem !== nextStem) index.set(key, null);
}

/**
 * Builds a conservative surface-form index. Only explicit dictionary forms
 * are accepted; a missing dictionary entry falls back to the saved surface
 * itself and never to a guessed stem prefix.
 */
export async function buildExactWordFormIndex(words, { loadCore } = {}) {
  const normalizedWords = (Array.isArray(words) ? words : [])
    .filter(word => String(word?.word || '').trim())
    .map(word => ({ ...word, word: String(word.word).trim() }));
  const index = new Map();
  let entries = [];
  if (typeof loadCore === 'function') {
    try {
      const core = await loadCore();
      entries = Array.isArray(core?.entries) ? core.entries : [];
    } catch {
      entries = [];
    }
  }

  const byForm = new Map();
  for (const entry of entries) {
    for (const form of [entry?.lemma, ...(Array.isArray(entry?.forms) ? entry.forms : [])]) {
      const key = normalizeSurface(form);
      if (!key) continue;
      const current = byForm.get(key);
      if (current === undefined) byForm.set(key, entry);
      else if (current?.lemma !== entry?.lemma) byForm.set(key, null);
    }
  }

  for (const word of normalizedWords) {
    const entry = byForm.get(normalizeSurface(word.word));
    const forms = new Set([word.word]);
    if (entry) {
      forms.add(entry.lemma);
      for (const form of entry.forms || []) forms.add(form);
    }
    for (const form of forms) addIndexValue(index, form, word);
  }
  return index;
}

function lookupIndex(index, token) {
  const key = normalizeSurface(token);
  const direct = index.get(key);
  if (direct !== undefined) return direct;
  // Possessive punctuation is an unambiguous surface use of an explicit base.
  if (/(?:['’]s)$/iu.test(key)) return index.get(key.replace(/(?:['’]s)$/iu, '')) ?? null;
  return null;
}

export function renderExactWordMarking(text, index, className = 'learning-word', isActive = () => true) {
  const source = String(text || '');
  if (!(index instanceof Map) || !index.size) return escapeHtml(source);
  let cursor = 0;
  let output = '';
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? cursor;
    output += escapeHtml(source.slice(cursor, start));
    const word = lookupIndex(index, token);
    if (word && isActive(word)) {
      const stem = word.stem || word.word || word.lemma || token;
      const resolvedClassName = typeof className === 'function' ? className(word) : className;
      output += `<mark class="${escapeHtml(resolvedClassName || 'learning-word')}" data-stem="${escapeHtml(stem)}">${escapeHtml(token)}</mark>`;
    } else {
      output += escapeHtml(token);
    }
    cursor = start + token.length;
  }
  return output + escapeHtml(source.slice(cursor));
}
