export function mulberry32(seed) {
  let value = Number(seed) >>> 0;
  return function random() {
    value |= 0;
    value = (value + 0x6D2B79F5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createShuffleSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}

export function createOptionOrder(options, seed) {
  const keys = (Array.isArray(options) ? options : []).map(option => option.key);
  if (seed === null || seed === undefined) return keys;
  const order = [...keys];
  const random = mulberry32(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

export function buildOptionOrders(questions, seed) {
  return Object.fromEntries(
    questions.map(question => [question.questionKey, createOptionOrder(question.options, seed)])
  );
}

export function buildCandidateOrder(candidates, seed) {
  const keys = (Array.isArray(candidates) ? candidates : []).map(candidate => ({ key: candidate.candidateKey }));
  return createOptionOrder(keys, seed);
}

export function gradeSingleChoice(question, answer) {
  const unanswered = answer === null || answer === undefined || answer === '';
  const correct = !unanswered && answer === question.answer;
  return {
    correct,
    pointsEarned: correct ? question.points : 0,
    unanswered
  };
}

export function assertOrderingResponses(unit, responses) {
  const fixedKeys = new Set((unit.fixedPlacements || []).map(item => item.candidateKey));
  const candidateKeys = new Set((unit.candidates || []).map(candidate => candidate.candidateKey));
  const allowReuse = Boolean(unit.allowCandidateReuse);
  const used = new Map();
  for (const response of responses || []) {
    if (response.answer === null || response.answer === undefined || response.answer === '') continue;
    if (!candidateKeys.has(response.answer)) throw new Error(`未知候选段落：${response.answer}`);
    if (fixedKeys.has(response.answer)) throw new Error(`固定段落不能用于待填位置：${response.answer}`);
    if (!allowReuse && used.has(response.answer)) {
      throw new Error(`候选段落 ${response.answer} 重复使用`);
    }
    used.set(response.answer, response.questionKey);
  }
}
