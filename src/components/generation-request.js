import { normalizeGenerationRequest } from '../difficulty-profile.mjs';

const DIFFICULTIES = new Set(['cet4', 'cet6', 'graduate']);
const DIFFICULTY_CUES = [
  { difficulty: 'cet4', pattern: /(?:四级|\bcet[\s-]?4\b)/i },
  { difficulty: 'cet6', pattern: /(?:六级|\bcet[\s-]?6\b)/i },
  { difficulty: 'graduate', pattern: /(?:考研|\bgraduate\b)/i }
];

function findExplicitDifficulty(request) {
  const matches = DIFFICULTY_CUES
    .map(cue => {
      const match = request.match(cue.pattern);
      return match ? { difficulty: cue.difficulty, index: match.index } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);

  return matches[0]?.difficulty;
}

function resolveChallenge(legacyLevel) {
  const level = String(legacyLevel || '').trim().toLowerCase();
  if (level === 'easy') return 'support';
  if (level === 'hard') return 'stretch';
  return 'standard';
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

export function resolveGenerationRequest({ request = '', selectedDifficulty = 'cet4', legacyLevel, toolDifficulty, toolWordCount } = {}) {
  const rawRequest = typeof request === 'string' ? request : String(request ?? '');
  const userDifficulty = findExplicitDifficulty(rawRequest);
  const userWordCount = findRequestedWordCount(rawRequest);
  const requestedWordCount = userWordCount ?? controlledWordCount(toolWordCount);
  const normalized = normalizeGenerationRequest({
    track: userDifficulty || controlledDifficulty(toolDifficulty) || controlledDifficulty(selectedDifficulty) || 'cet4',
    challenge: resolveChallenge(legacyLevel),
    wordCount: requestedWordCount
  });

  const result = {
    request: rawRequest,
    difficulty: normalized.track,
    challenge: normalized.challenge,
    profile: normalized.profile,
    wordCount: normalized.wordCount
  };

  if (requestedWordCount !== undefined && requestedWordCount !== normalized.wordCount) {
    result.adjustment = {
      requested: requestedWordCount,
      resolved: normalized.wordCount,
      range: { ...normalized.profile.wordRange }
    };
  }

  return result;
}
