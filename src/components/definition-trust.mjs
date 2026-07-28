/**
 * Compact, user-facing provenance for a dictionary result. It intentionally
 * distinguishes reviewed offline learning senses from online temporary text
 * without exposing implementation source identifiers in the card.
 */
const CHINESE_TEXT = /[\u3400-\u9fff]/u;
const NON_GLOSS_DISPLAYS = /^(?:英文释义[：:]|暂时无法获取可靠释义$|中文释义暂不可用$)/u;
const POS_LABELS = Object.freeze({
  n: 'n.',
  noun: 'n.',
  v: 'v.',
  vt: 'v.',
  vi: 'v.',
  verb: 'v.',
  adjective: 'adj.',
  adj: 'adj.',
  a: 'adj.',
  adverb: 'adv.',
  adv: 'adv.',
  ad: 'adv.',
  modal: 'modal v.',
  'modal-auxiliary': 'modal v.',
  preposition: 'prep.',
  prep: 'prep.',
  pronoun: 'pron.',
  pron: 'pron.',
  conjunction: 'conj.',
  conj: 'conj.',
  determiner: 'det.',
  article: 'art.',
  number: 'num.',
  num: 'num.',
  interjection: 'int.',
  int: 'int.'
});

const text = value => String(value || '').trim();

export function formatPartOfSpeech(value) {
  const normalized = text(value).toLowerCase().replace(/\.$/u, '');
  return POS_LABELS[normalized] || '';
}

export function formatPhonetic(value) {
  const phonetic = text(value)
    .replace(/^[\[/]+/u, '')
    .replace(/[\]/]+$/u, '')
    .trim();
  return phonetic ? `/${phonetic}/` : '';
}

export function getSavableTranslation(data = {}) {
  const translation = String(data?.translation || '').trim();
  return CHINESE_TEXT.test(translation) && !NON_GLOSS_DISPLAYS.test(translation) ? translation : '';
}

export function getDefinitionSenses(data = {}) {
  const seen = new Set();
  const senses = [];
  const rawSenses = Array.isArray(data?.definitionSenses)
    ? data.definitionSenses
    : Array.isArray(data?.senses) ? data.senses : [];

  for (const sense of rawSenses) {
    const pos = text(sense?.pos);
    const glossZh = text(sense?.glossZh);
    if (!glossZh || !CHINESE_TEXT.test(glossZh)) continue;
    const key = `${pos}\u0000${glossZh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    senses.push({ pos, glossZh });
  }

  if (senses.length) return senses;
  const translation = getSavableTranslation(data);
  return translation ? [{ pos: text(data?.pos), glossZh: translation }] : [];
}

export function getDefinitionDisplayLines(data = {}) {
  return getDefinitionSenses(data).map((sense) => ({
    label: formatPartOfSpeech(sense.pos) || '词性待确认',
    glossZh: sense.glossZh
  }));
}

export function getDefinitionPreview(data = {}, visibleCount = 2) {
  const lines = getDefinitionDisplayLines(data);
  const count = Math.max(1, Number.parseInt(visibleCount, 10) || 2);
  return {
    visibleLines: lines.slice(0, count),
    additionalLines: lines.slice(count),
    total: lines.length
  };
}

export function definitionTrustLabel(data = {}) {
  const quality = String(data?.definitionQuality || '').trim().toLowerCase();
  const source = String(data?.source || '').trim().toLowerCase();
  if (quality === 'high') return '离线高可信学习义';
  if (quality === 'screened') return '离线筛选学习义';
  if (quality === 'limited') {
    return source === 'lexicon-limited'
      ? '受限词条：英文结构提示'
      : '受限词条：在线临时释义';
  }
  if (quality === 'unavailable') {
    return source === 'ai' || source === 'api'
      ? '在线临时释义'
      : '暂未取得可靠释义';
  }
  if (source === 'ai' || source === 'api') return '在线临时释义';
  return '';
}
