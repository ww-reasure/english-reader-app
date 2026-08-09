import { resolveContextDifficultyProfile } from '../difficulty-profile.mjs';
import { validateGeneratedContextReviewSentence } from './context-review.mjs';

const normalize = value => String(value || '').trim().toLocaleLowerCase('en-US');
const safeJson = value => {
  try { return JSON.parse(value); } catch { return null; }
};

const CHALLENGE_LABELS = Object.freeze({
  support: '巩固',
  standard: '对标',
  stretch: '加压'
});

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function makeContextReviewCacheKey(item = {}) {
  const wordId = Math.max(0, Math.trunc(Number(item.wordId) || 0));
  const sourceTrack = normalize(item.sourceTrack || item.targetTrack || item.examTrack) || 'unscoped';
  const source = normalize(item.source) || 'cache';
  const profileScope = item.difficultyStatus === 'authentic'
    ? `authentic:${sourceTrack}`
    : normalize(item.difficultyProfileKey) || 'legacy';
  return `context-v3:${wordId}:${source}:${sourceTrack}:${profileScope}:${stableHash(normalize(item.sentence))}`;
}

function buildProfilePrompt(difficultyProfile) {
  const profile = difficultyProfile || resolveContextDifficultyProfile();
  const range = profile.sentenceRange;
  const syntax = profile.syntaxCaps;
  const challengeLabel = CHALLENGE_LABELS[profile.challenge] || profile.challenge;
  return [
    `训练方式：${challengeLabel}。`,
    `每句必须为 ${range.min}-${range.max} 词的一个自然英文句子。`,
    `目标词必须使用输入 lemma 原形；目标词不计入非目标词的词汇覆盖要求。`,
    `除目标词外优先使用目标覆盖率 ${profile.coverage}% 对应的常用词，避免罕见专名。`,
    `学术词方向：${profile.academicTarget}。`,
    `句法上限：从属标记不超过 ${syntax.subordinateMarkers} 个、被动结构不超过 ${syntax.passiveMarkers} 个、非谓语标记不超过 ${syntax.nonFiniteMarkers} 个。`,
    profile.promptGuidance
  ].join('');
}

export function createContextReviewGenerator({
  fetch = null,
  hasApiKey = () => false,
  getTranslation = () => ''
} = {}) {
  return async function generateBatch(words = [], { challenge = 'standard', coverage = undefined, difficultyProfile = null, signal = null } = {}) {
    if (!words.length || typeof fetch !== 'function' || !hasApiKey()) return [];
    const profile = difficultyProfile || resolveContextDifficultyProfile(challenge, coverage);
    const rows = words.map(word => ({
      wordId: word.id,
      lemma: normalize(word.word),
      senses: Array.isArray(word.definitionSenses)
        ? word.definitionSenses.slice(0, 6).map((sense, index) => ({ index, pos: sense.pos || '', glossZh: sense.glossZh || '' }))
        : [{ index: 0, pos: word.pos || '', glossZh: getTranslation(word) || '' }]
    }));
    const response = await fetch({
      messages: [
        {
          role: 'system',
          content: `你是英语语境复习材料编辑。仅返回 JSON {"items":[{"wordId":1,"lemma":"word","targetForm":"word","sentence":"...","translationZh":"...","senseIndex":0}]}。${buildProfilePrompt(profile)}不得在英文句中写中文、括号释义或直接解释目标词。translationZh 必须是自然中文整句翻译，senseIndex 只能选择给定候选索引。`
        },
        { role: 'user', content: JSON.stringify({ words: rows }) }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.55
    }, 60000, signal);
    const parsed = safeJson(response?.choices?.[0]?.message?.content);
    const requested = new Map(rows.map(item => [Number(item.wordId), item]));
    return (Array.isArray(parsed?.items) ? parsed.items : [])
      .map(item => validateGeneratedContextReviewSentence(item, requested.get(Number(item?.wordId)), profile))
      .filter(Boolean);
  };
}
