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
// 相邻 token 之间只允许空白/撇号/连字符连接（不跨句读，也禁止逗号与 &）。
const PHRASE_TOKEN_GAP_PATTERN = /^[\s'’\-]*$/;

// 词组资料里的占位符（sth/sb/one's/do 等）：非首位的 token 匹配任意单个词。
// 注意：'a'/'b' 不作通配（"many a"、"a range of sth" 的 a 是实义冠词）；
// 首位 token 也永远按字面处理——资料里 "do good"、"anything like" 的
// do/anything 是实义词，首词通配会把 "feels good"、"just like" 误判成词组。
const PHRASE_WILDCARD_TOKENS = new Set([
  'sth', 'sb', 'somebody', 'someone', 'something', 'anything', 'anyone',
  "one's", 'ones', 'do'
]);

function phraseWildcardToken(normalized) {
  return PHRASE_WILDCARD_TOKENS.has(normalized);
}

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

// -s 兜底折叠的例外：这些词去掉 s 会变成另一个实义词（news→new、means→mean）。
const NON_FOLDING_S_FORMS = new Set(['news', 'lens', 'means', 'summons']);

/**
 * 一个表面 token 可能对应的基础形集合。词组匹配时两侧都折到基础形：
 * 表面侧折（looks → look），词组侧存的就是基础形。
 */
function foldTokenMatchKeys(token) {
  const key = stripPossessive(normalizeSurface(token).replace(/[’]/gu, "'"));
  const keys = new Set([key]);
  const push = value => { if (value) keys.add(value); };
  if (/ies$/u.test(key)) push(`${key.slice(0, -3)}y`);
  if (/(?:ches|shes|sses|xes|zes|oes)$/u.test(key)) {
    push(key.slice(0, -2));
    // sizes/shoes/toes 这类以不发音 e 结尾的基词，-s 兜底才是正确折叠。
    push(key.slice(0, -1));
  } else if (/s$/u.test(key) && !/ss$/u.test(key) && key.length > 3 && !NON_FOLDING_S_FORMS.has(key)) {
    push(key.slice(0, -1));
  }
  if (/ied$/u.test(key)) push(`${key.slice(0, -3)}y`);
  // 长度下限放到 4/3：used/going/doing/died 这类短变形同样要折回基词；
  // 更短的词（red/sing/ring/king）保持不折叠，避免 sing→s 类误折。
  if (/ing$/u.test(key) && key.length > 4) {
    const stem = key.slice(0, -3);
    push(stem);
    push(`${stem}e`);
    push(unwrapDoubledConsonant(stem));
  }
  if (/ed$/u.test(key) && key.length > 3) {
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
 * 占位符 token（sth/sb/one's/do...）在非首位记为通配位，首位永远按字面入桶。
 * 词组内 token 间隙含省略号（.../…）时标记 skipBefore：匹配时允许跨过任意词语。
 * 返回 { byFirst: Map<首token基础形, 候选[]>, byId, size }，
 * 桶内按 token 数降序，配合匹配端的"取最长命中"保证最长匹配优先。
 */
export function buildKeyPhraseMatcherIndex(phrases) {
  const byFirst = new Map();
  const byId = new Map();
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    const text = normalizePhraseText(phrase?.phrase ?? phrase?.p);
    if (!text) continue;
    const id = normalizePhraseText(phrase?.id) || text;
    if (byId.has(id)) continue;
    const rawTokens = [...text.matchAll(TOKEN_PATTERN)];
    const tokens = [];
    const skipBefore = [];
    let previousEnd = -1;
    rawTokens.forEach((match, tokenIndex) => {
      const gap = previousEnd >= 0 ? text.slice(previousEnd, match.index) : '';
      skipBefore.push(/\.{3,}|…/u.test(gap));
      const normalized = normalizeSurface(match[0]).replace(/[’]/gu, "'");
      tokens.push(tokenIndex > 0 && phraseWildcardToken(normalized) ? null : stripPossessive(normalized));
      previousEnd = match.index + match[0].length;
    });
    if (!tokens.some(token => token !== null)) continue;
    const entry = { id, phrase: text, glossZh: String(phrase?.glossZh ?? phrase?.g ?? '') };
    const record = { id, entry, tokens, skipBefore };
    const bucket = byFirst.get(tokens[0]);
    if (bucket) bucket.push(record);
    else byFirst.set(tokens[0], [record]);
    byId.set(id, entry);
  }
  for (const bucket of byFirst.values()) bucket.sort((left, right) => right.tokens.length - left.tokens.length);
  return { byFirst, byId, size: byId.size };
}

/**
 * 从 matches[index] 起尝试词组匹配，取 token 数最多的命中。
 * 返回 { id, entry, tokenCount } 或 null；tokenCount 是实际消耗的连续 token 数
 * （省略号跨词时大于词组自身的 token 数），渲染层据此取词组 span 的结束位置。
 * 通配位匹配任意单个词（首位 token 除外，见 buildKeyPhraseMatcherIndex）。
 */
export function matchKeyPhraseAt(matcher, matches, index, source) {
  if (!matcher || !matcher.size) return null;
  const first = matches[index];
  if (!first) return null;
  const text = String(source || '');
  const foldCache = new Map();
  const foldOf = offset => {
    let keys = foldCache.get(offset);
    if (!keys) {
      keys = foldTokenMatchKeys(matches[offset][0]);
      foldCache.set(offset, keys);
    }
    return keys;
  };
  let best = null;
  const consider = candidate => {
    if (best && best.tokenCount >= candidate.tokens.length) return;
    if (index + candidate.tokens.length > matches.length) return;
    let cursor = index;
    for (let step = 1; step < candidate.tokens.length; step += 1) {
      const expected = candidate.tokens[step];
      const skipAllowed = Boolean(candidate.skipBefore?.[step]);
      const previous = matches[cursor];
      let found = -1;
      for (let next = cursor + 1; next < matches.length; next += 1) {
        const gap = text.slice(previous.index + previous[0].length, matches[next].index);
        if (skipAllowed) {
          // 词组自己的省略号代表"此处隔任意内容"；文本侧只拒绝真正的句读。
          if (/[.!?;。]/u.test(gap.replace(/\.{3,}|…/gu, ' '))) return;
        } else if (!PHRASE_TOKEN_GAP_PATTERN.test(gap)) {
          return;
        }
        if (expected === null || foldOf(next).has(expected)) {
          found = next;
          break;
        }
        if (!skipAllowed) return;
      }
      if (found === -1) return;
      cursor = found;
    }
    best = { id: candidate.id, entry: candidate.entry, tokenCount: cursor - index + 1 };
  };

  for (const key of foldOf(index)) {
    const bucket = matcher.byFirst.get(key);
    if (bucket) bucket.forEach(consider);
  }
  return best;
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
