const CORPUS_TRACKS = Object.freeze(['cet4', 'cet6', 'kaoyan-general']);
const TARGET_TRACK_MAP = Object.freeze({
  cet4: 'cet4',
  cet6: 'cet6',
  kaoyan1: 'kaoyan-general',
  kaoyan2: 'kaoyan-general',
  graduate: 'kaoyan-general',
  'kaoyan-general': 'kaoyan-general'
});
const PRIORITY_LABELS = Object.freeze({
  core: '真题高频核心',
  frequent: '真题常考',
  appeared: '真题出现',
  uncovered: '考纲未见'
});
const WORD_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const text = value => String(value || '').trim();
const normalizeWord = value => text(value).toLocaleLowerCase('en-US');
const finiteCount = value => Number.isSafeInteger(value) && value >= 0;

function percentileRanks(values) {
  const sorted = [...values].sort((left, right) => left.value - right.value || left.lemma.localeCompare(right.lemma));
  const ranks = new Map();
  if (!sorted.length) return ranks;
  if (sorted.length === 1) {
    ranks.set(sorted[0].lemma, 100);
    return ranks;
  }
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[index].value) end += 1;
    const midpoint = (index + end) / 2;
    const percentile = (midpoint / (sorted.length - 1)) * 100;
    for (let cursor = index; cursor <= end; cursor += 1) ranks.set(sorted[cursor].lemma, percentile);
    index = end + 1;
  }
  return ranks;
}

export function corpusTrackForTarget(track) {
  return TARGET_TRACK_MAP[text(track).toLocaleLowerCase('en-US')] || null;
}

export function weightedExamOccurrences(record) {
  const passage = Math.max(0, Number(record?.counts?.passage) || 0);
  const questionStem = Math.max(0, Number(record?.counts?.questionStem) || 0);
  return Math.round((passage + questionStem * 0.2) * 10) / 10;
}

export function priorityTierForScore(score, observed = true) {
  if (!observed) return 'uncovered';
  if (score >= 80) return 'core';
  if (score >= 50) return 'frequent';
  return 'appeared';
}

export function calculateTrackPriorities(records = []) {
  const normalized = (Array.isArray(records) ? records : []).map(record => ({
    record,
    lemma: normalizeWord(record?.lemma),
    weightedFrequency: weightedExamOccurrences(record),
    papers: Math.max(0, Number(record?.counts?.papers) || 0),
    years: Math.max(0, Number(record?.counts?.years) || 0),
    observed: Number(record?.counts?.sentenceTotal) > 0
  })).filter(item => WORD_PATTERN.test(item.lemma));
  const observed = normalized.filter(item => item.observed);
  const frequencyRanks = percentileRanks(observed.map(item => ({ lemma: item.lemma, value: item.weightedFrequency })));
  const paperRanks = percentileRanks(observed.map(item => ({ lemma: item.lemma, value: item.papers })));
  const yearRanks = percentileRanks(observed.map(item => ({ lemma: item.lemma, value: item.years })));
  const priorities = new Map();

  for (const item of normalized) {
    const priorityScore = item.observed
      ? Math.round(
        (frequencyRanks.get(item.lemma) || 0) * 0.65
        + (paperRanks.get(item.lemma) || 0) * 0.2
        + (yearRanks.get(item.lemma) || 0) * 0.15
      )
      : 0;
    const priorityTier = priorityTierForScore(priorityScore, item.observed);
    priorities.set(item.lemma, {
      priorityScore,
      priorityTier,
      priorityLabel: PRIORITY_LABELS[priorityTier],
      weightedFrequency: item.weightedFrequency
    });
  }
  return priorities;
}

function assertSource(source, errors) {
  if (!source || typeof source !== 'object') {
    errors.push('source 缺失');
    return;
  }
  for (const field of ['id', 'url', 'termsUrl', 'usage', 'sourceVersion', 'manifestSha256']) {
    if (!text(source[field])) errors.push(`source.${field} 缺失`);
  }
  try {
    const terms = new URL(source.termsUrl);
    if (terms.pathname.replace(/\/+$/, '') !== '/terms') errors.push('source.termsUrl 必须指向 /terms/');
  } catch {
    errors.push('source.termsUrl 必须是有效 URL');
  }
  if (!SHA256_PATTERN.test(text(source.manifestSha256))) errors.push('source.manifestSha256 必须是 SHA-256');
}

function assertCounts(counts, path, errors) {
  const fields = ['sentenceTotal', 'passage', 'questionStem', 'other', 'papers', 'years'];
  for (const field of fields) {
    if (!finiteCount(counts?.[field])) errors.push(`${path}.${field} 必须是非负整数`);
  }
  if (fields.every(field => finiteCount(counts?.[field]))
    && counts.sentenceTotal !== counts.passage + counts.questionStem + counts.other) {
    errors.push(`${path}.sentenceTotal 与位置计数不一致`);
  }
}

export function assertExamCorpusIndexArtifact(artifact) {
  const errors = [];
  if (!artifact || typeof artifact !== 'object') errors.push('真题语料索引必须是对象');
  if (artifact?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!text(artifact?.corpusVersion)) errors.push('corpusVersion 缺失');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(artifact?.generatedAt))) errors.push('generatedAt 必须是 ISO 时间');
  assertSource(artifact?.source, errors);

  for (const track of CORPUS_TRACKS) {
    const meta = artifact?.tracks?.[track];
    const words = artifact?.words?.[track];
    if (!meta || typeof meta !== 'object') errors.push(`tracks.${track} 缺失`);
    if (!words || typeof words !== 'object' || Array.isArray(words)) errors.push(`words.${track} 缺失`);
    if (meta && !finiteCount(meta.wordCount)) errors.push(`tracks.${track}.wordCount 必须是非负整数`);
    if (words && meta?.wordCount !== Object.keys(words).length) errors.push(`tracks.${track}.wordCount 与词条数量不一致`);
    for (const [lemma, record] of Object.entries(words || {})) {
      if (!WORD_PATTERN.test(lemma) || normalizeWord(lemma) !== lemma) errors.push(`words.${track}.${lemma} 词元无效`);
      if (!['core', 'frequent', 'appeared', 'uncovered'].includes(record?.priorityTier)) {
        errors.push(`words.${track}.${lemma}.priorityTier 无效`);
      }
      if (!finiteCount(record?.priorityScore) || record.priorityScore > 100) {
        errors.push(`words.${track}.${lemma}.priorityScore 必须为 0-100`);
      }
      assertCounts(record?.counts, `words.${track}.${lemma}.counts`, errors);
    }
  }
  if (errors.length) throw new Error(`真题语料索引无效：${errors.join('；')}`);
  return artifact;
}

export function createExamCorpusIndex(artifact) {
  assertExamCorpusIndexArtifact(artifact);
  return Object.freeze({
    corpusVersion: artifact.corpusVersion,
    source: artifact.source,
    lookup(word, targetTrack) {
      const track = corpusTrackForTarget(targetTrack);
      const lemma = normalizeWord(word);
      return track && lemma ? artifact.words[track]?.[lemma] || null : null;
    }
  });
}

export const ExamCorpusTracks = CORPUS_TRACKS;
