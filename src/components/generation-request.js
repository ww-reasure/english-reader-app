import { normalizeGenerationRequest } from '../difficulty-profile.mjs';

const DIFFICULTIES = new Set(['cet4', 'cet6', 'kaoyan1', 'kaoyan2', 'graduate']);
const DIFFICULTY_CUES = [
  { difficulty: 'cet4', pattern: /(?:四级|\bcet[\s-]?4\b)/i },
  { difficulty: 'cet6', pattern: /(?:六级|\bcet[\s-]?6\b)/i },
  { difficulty: 'kaoyan1', pattern: /(?:考研\s*英语?\s*一|英语?\s*一\s*(?:阅读|真题)?|\b(?:kaoyan|graduate)\s*(?:english\s*)?(?:i|1)\b)/i },
  { difficulty: 'kaoyan2', pattern: /(?:考研\s*英语?\s*二|英语?\s*二\s*(?:阅读|真题)?|\b(?:kaoyan|graduate)\s*(?:english\s*)?(?:ii|2)\b)/i },
  { difficulty: 'graduate', genericGraduate: true, pattern: /(?:考研|\bgraduate\b)/i }
];

const CURRENT_TARGETS = new Set(['cet4', 'cet6', 'kaoyan1', 'kaoyan2']);
const ARTICLE_GENERATION_INTENT = /(?:\b(?:generate|write|create|make)\b[\s\S]{0,40}\b(?:article|reading|passage|practice)\b|\b(?:give\s+me|help\s+me)\b[\s\S]{0,40}\b(?:article|reading|passage|practice)\b|(?:来|出|生成|写|撰写|定制|制作)\s*(?:一篇|篇)|给我\s*(?:一篇|篇)|(?:生成|写|撰写|定制|制作|出|来|给我|帮我|想读|想看|需要)[\s\S]{0,24}(?:文章|阅读|练习)|(?:文章|阅读|练习)[\s\S]{0,24}(?:生成|写|撰写|定制|制作|出|来))/i;
const TARGET_CONSULTATION_CONTEXT = /(?:怎么|如何|为什么|为何|是否|能否|可不可以|比较|对比|区别|差异|哪个更|解释)/;

function findExplicitDifficulty(request, selectedDifficulty) {
  if (TARGET_CONSULTATION_CONTEXT.test(request)) return undefined;
  if (!ARTICLE_GENERATION_INTENT.test(request)) return undefined;
  const matches = DIFFICULTY_CUES
    .map(cue => {
      const match = request.match(cue.pattern);
      return match ? { difficulty: cue.difficulty, index: match.index, length: match[0].length } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);

  const concreteMatches = matches.filter(match => match.difficulty !== 'graduate');
  const concreteTargets = [...new Set(concreteMatches.map(match => match.difficulty))];
  const hasStandaloneGraduateCue = matches
    .filter(match => match.difficulty === 'graduate')
    .some(generic => !concreteMatches.some(concrete =>
      generic.index < concrete.index + concrete.length
      && concrete.index < generic.index + generic.length
    ));
  if (concreteTargets.length > 1 || (concreteTargets.length === 1 && hasStandaloneGraduateCue)) return undefined;
  if (concreteTargets.length === 1) return concreteTargets[0];
  if (!hasStandaloneGraduateCue) return undefined;
  // A generic "考研" request never chooses a new target on the user's behalf.
  // It preserves an explicit English I/II choice and keeps a legacy graduate
  // caller compatible; any other fixed target remains unchanged.
  const selected = controlledDifficulty(selectedDifficulty);
  return ['kaoyan1', 'kaoyan2', 'graduate'].includes(selected) ? selected : undefined;
}

function resolveChallenge(legacyLevel) {
  const level = String(legacyLevel || '').trim().toLowerCase();
  if (level === 'easy') return 'support';
  if (level === 'hard') return 'stretch';
  return 'standard';
}

function controlledChallenge(value) {
  const challenge = String(value || '').trim().toLowerCase();
  return ['support', 'standard', 'stretch'].includes(challenge) ? challenge : undefined;
}

function findRequestedWordCount(request) {
  const match = request.match(/(\d+)\s*(?:(?:个\s*)?(?:单词|词)|words?\b)/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function controlledDifficulty(value) {
  const difficulty = String(value || '').trim().toLowerCase();
  return DIFFICULTIES.has(difficulty) ? difficulty : undefined;
}

function controlledWordCount(value) {
  const wordCount = Number(value);
  return Number.isInteger(wordCount) && wordCount > 0 ? wordCount : undefined;
}

export function resolveGenerationRequest({
  request = '',
  selectedDifficulty = 'cet4',
  selectedChallenge,
  legacyLevel,
  toolDifficulty,
  toolWordCount,
  allowExplicitUserTarget = true
} = {}) {
  const rawRequest = typeof request === 'string' ? request : String(request ?? '');
  const persistedTrack = controlledDifficulty(selectedDifficulty);
  const userDifficulty = allowExplicitUserTarget ? findExplicitDifficulty(rawRequest, selectedDifficulty) : undefined;
  const userWordCount = findRequestedWordCount(rawRequest);
  const requestedWordCount = userWordCount ?? controlledWordCount(toolWordCount);
  const selectedTrack = persistedTrack || 'cet4';
  const normalized = normalizeGenerationRequest({
    // Agent tool arguments may request a length, but cannot silently rewrite
    // the learner-owned target exam. A direct user cue is surfaced below so
    // the caller can persist that explicit change before saving an article.
    track: userDifficulty || selectedTrack,
    challenge: controlledChallenge(selectedChallenge) || resolveChallenge(legacyLevel),
    wordCount: requestedWordCount
  });

  const result = {
    request: rawRequest,
    difficulty: normalized.track,
    challenge: normalized.challenge,
    profile: normalized.profile,
    wordCount: normalized.wordCount
  };

  // A direct article request may establish a target exactly once. Afterwards
  // a named level applies only to that article; persistent target changes stay
  // in the explicit selector/settings controls.
  if (userDifficulty && userDifficulty !== 'graduate' && !CURRENT_TARGETS.has(persistedTrack)) {
    result.targetSelectionRequested = userDifficulty;
  }

  if (requestedWordCount !== undefined && requestedWordCount !== normalized.wordCount) {
    result.adjustment = {
      requested: requestedWordCount,
      resolved: normalized.wordCount,
      range: { ...normalized.profile.wordRange }
    };
  }

  return result;
}
