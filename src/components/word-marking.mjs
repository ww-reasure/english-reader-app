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

// 词组高亮：跨 token 的最长匹配优先，单词标记作为回退。
// 词组内部只允许空白和连字符类连接符，禁止跨句号等句子标点。
const PHRASE_TOKEN_GAP_PATTERN = /^[\s'’\-,&]*$/;

function normalizePhraseText(value) {
  return String(value || '')
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function stripPossessive(value) {
  return value.replace(/['’]s$/u, '');
}

function unwrapDoubledConsonant(stem) {
  return /(?:bb|dd|gg|ll|mm|nn|pp|rr|tt)$/u.test(stem) ? stem.slice(0, -1) : '';
}

/**
 * 一个表面 token 可能对应的基础形集合。词组匹配时两侧都折到基础形：
 * 表面侧折（looks → look），词组侧存的就是基础形。
 */
function foldTokenMatchKeys(token) {
  const key = stripPossessive(normalizeSurface(token).replace(/[’]/gu, "'"));
  const keys = new Set([key]);
  const push = value => { if (value) keys.add(value); };
  if (/ies$/u.test(key)) push(`${key.slice(0, -3)}y`);
  if (/(?:ches|shes|sses|xes|zes|oes)$/u.test(key)) push(key.slice(0, -2));
  else if (/s$/u.test(key) && !/ss$/u.test(key) && key.length > 3) push(key.slice(0, -1));
  if (/ied$/u.test(key)) push(`${key.slice(0, -3)}y`);
  if (/ing$/u.test(key) && key.length > 5) {
    const stem = key.slice(0, -3);
    push(stem);
    push(`${stem}e`);
    push(unwrapDoubledConsonant(stem));
  }
  if (/ed$/u.test(key) && key.length > 4) {
    const stem = key.slice(0, -2);
    push(stem);
    push(key.slice(0, -1));
    push(`${stem}e`);
    push(unwrapDoubledConsonant(stem));
  }
  keys.delete('');
  return keys;
}

/**
 * phrases: [{ id?, phrase | p, glossZh? | g }]。id 缺省用规范化词组文本。
 * 返回 { byFirst: Map<首token基础形, 候选[]>, byId: Map<id, entry>, size }，
 * 候选按 token 数降序，保证最长匹配优先。
 */
export function buildKeyPhraseMatcherIndex(phrases) {
  const byFirst = new Map();
  const byId = new Map();
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    const text = normalizePhraseText(phrase?.phrase ?? phrase?.p);
    if (!text) continue;
    const id = normalizePhraseText(phrase?.id) || text;
    if (byId.has(id)) continue;
    const tokens = (text.match(TOKEN_PATTERN) || [])
      .map(token => stripPossessive(normalizeSurface(token)))
      .filter(Boolean);
    if (!tokens.length) continue;
    const entry = { id, phrase: text, glossZh: String(phrase?.glossZh ?? phrase?.g ?? '') };
    const record = { id, entry, tokens };
    const bucket = byFirst.get(tokens[0]);
    if (bucket) bucket.push(record);
    else byFirst.set(tokens[0], [record]);
    byId.set(id, entry);
  }
  for (const bucket of byFirst.values()) bucket.sort((left, right) => right.tokens.length - left.tokens.length);
  return { byFirst, byId, size: byId.size };
}

/**
 * 从 matches[index] 起尝试词组匹配。返回 { id, entry, tokenCount } 或 null。
 * 相邻 token 之间的间隙只允许空白/连字符/逗号类连接符（不跨句）。
 */
export function matchKeyPhraseAt(matcher, matches, index, source) {
  if (!matcher || !matcher.size) return null;
  const first = matches[index];
  if (!first) return null;
  let candidates = null;
  for (const key of foldTokenMatchKeys(first[0])) {
    const bucket = matcher.byFirst.get(key);
    if (!bucket) continue;
    candidates = candidates ? candidates.concat(bucket) : bucket.slice();
  }
  if (!candidates) return null;
  candidates.sort((left, right) => right.tokens.length - left.tokens.length);
  const text = String(source || '');
  for (const candidate of candidates) {
    const lastIndex = index + candidate.tokens.length - 1;
    if (lastIndex >= matches.length) continue;
    let matched = true;
    for (let step = 1; step < candidate.tokens.length; step += 1) {
      const previous = matches[index + step - 1];
      const gapStart = previous.index + previous[0].length;
      const gap = text.slice(gapStart, matches[index + step].index);
      if (!PHRASE_TOKEN_GAP_PATTERN.test(gap)
        || !foldTokenMatchKeys(matches[index + step][0]).has(candidate.tokens[step])) {
        matched = false;
        break;
      }
    }
    if (matched) return { id: candidate.id, entry: candidate.entry, tokenCount: candidate.tokens.length };
  }
  return null;
}

/**
 * 词组感知的组合渲染：命中词组 → <span class="key-phrase">（内部原样保留）；
 * 未命中 → 有 wordIndex 时按 renderExactWordMarking 规则输出 <mark>，否则纯转义。
 */
export function renderPhraseAwareMarking(text, matcher, {
  wordIndex = null,
  className = 'learning-word',
  isActive = () => true
} = {}) {
  const source = String(text || '');
  if (!matcher || !matcher.size) {
    if (wordIndex && wordIndex.size) return renderExactWordMarking(source, wordIndex, className, isActive);
    return escapeHtml(source);
  }
  const matches = [...source.matchAll(TOKEN_PATTERN)];
  let cursor = 0;
  let output = '';
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? cursor;
    output += escapeHtml(source.slice(cursor, start));
    const hit = matchKeyPhraseAt(matcher, matches, index, source);
    if (hit) {
      const last = matches[index + hit.tokenCount - 1];
      const end = last.index + last[0].length;
      const gloss = hit.entry?.glossZh || '';
      output += `<span class="key-phrase" data-key-phrase-id="${escapeHtml(hit.id)}"${gloss ? ` title="${escapeHtml(gloss)}"` : ''}>${escapeHtml(source.slice(start, end))}</span>`;
      cursor = end;
      index += hit.tokenCount - 1;
      continue;
    }
    const word = wordIndex && wordIndex.size ? lookupIndex(wordIndex, match[0]) : null;
    if (word && isActive(word)) {
      const stem = word.stem || word.word || word.lemma || match[0];
      const resolvedClassName = typeof className === 'function' ? className(word) : className;
      output += `<mark class="${escapeHtml(resolvedClassName || 'learning-word')}" data-stem="${escapeHtml(stem)}">${escapeHtml(match[0])}</mark>`;
    } else {
      output += escapeHtml(match[0]);
    }
    cursor = start + match[0].length;
  }
  return output + escapeHtml(source.slice(cursor));
}
