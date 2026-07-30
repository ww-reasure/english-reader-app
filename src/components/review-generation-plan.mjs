const normalizeWords = words => {
  const selected = [];
  const seen = new Set();
  for (const value of Array.isArray(words) ? words : []) {
    const word = String(value || '').trim();
    const key = word.toLocaleLowerCase('en-US');
    if (word && !seen.has(key)) {
      seen.add(key);
      selected.push(word);
    }
  }
  return selected;
};

const startOfLocalDay = timestamp => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const splitIntoBatches = (words, { batchSize, batchCharBudget = 220, maxBatches }) => {
  if (Number.isFinite(Number(batchSize)) && Number(batchSize) > 0) {
    const normalizedBatchSize = Math.max(1, Math.floor(Number(batchSize)));
    const batches = [];
    for (let index = 0; index < words.length && batches.length < maxBatches; index += normalizedBatchSize) {
      batches.push(words.slice(index, index + normalizedBatchSize));
    }
    return batches;
  }
  const batches = [];
  const budget = Math.max(40, Math.floor(Number(batchCharBudget) || 220));
  let current = [];
  let currentLength = 0;
  for (const word of words) {
    const nextLength = currentLength + word.length + 2;
    if (current.length && nextLength > budget && batches.length < maxBatches - 1) {
      batches.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(word);
    currentLength += word.length + 2;
  }
  if (current.length && batches.length < maxBatches) {
    batches.push(current);
  }
  return batches;
};

/**
 * Derives a deterministic daily review plan from persisted successful review
 * articles. Failed or cancelled requests leave no saved article and are thus
 * naturally retried next time without maintaining a fragile failure cache.
 */
export function planReviewBatches({ words = [], articles = [], now = Date.now(), batchSize, batchCharBudget = 220, maxArticles = 4 } = {}) {
  const normalizedMaxArticles = Math.max(1, Math.floor(Number(maxArticles) || 4));
  const todayStart = startOfLocalDay(now);
  const coveredWords = new Set();

  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article?.reviewMode || Number(article.createdAt) < todayStart) continue;
    for (const word of normalizeWords(article.usedWords)) {
      coveredWords.add(word.toLocaleLowerCase('en-US'));
    }
  }

  const eligibleWords = normalizeWords(words)
    .filter(word => !coveredWords.has(word.toLocaleLowerCase('en-US')));
  const batches = splitIntoBatches(eligibleWords, { batchSize, batchCharBudget, maxBatches: normalizedMaxArticles });
  const selectedWords = batches.flat();

  return {
    batches,
    selectedWords,
    remainingWords: eligibleWords.slice(selectedWords.length),
    coveredWords: [...coveredWords]
  };
}
