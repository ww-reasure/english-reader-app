export const LIBRARY_SOURCE_VERSION = 1;

const SOURCE_KEYS = ['reading', 'import'];
const TRUSTED_DEFINITION_FIELDS = [
  'translation',
  'phonetic',
  'pos',
  'definitionSenses',
  'definitionSchemaVersion',
  'definitionLexiconVersion'
];

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultNormalizeLemma(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLemma(value, normalize) {
  return String(normalize(value) || '').trim().toLowerCase();
}

function validTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sourceAt(occurredAt) {
  const time = validTime(occurredAt);
  return {
    active: true,
    firstAddedAt: time,
    lastAddedAt: time
  };
}

function inactiveSource() {
  return { active: false, firstAddedAt: null, lastAddedAt: null };
}

function sourceWithTimes(firstAddedAt, lastAddedAt) {
  return {
    active: true,
    firstAddedAt: validTime(firstAddedAt),
    lastAddedAt: validTime(lastAddedAt)
  };
}

function normalizeSource(source) {
  if (!source?.active) return inactiveSource();
  return sourceWithTimes(source.firstAddedAt, source.lastAddedAt);
}

function sourceKeysOf(record) {
  if (record?.librarySources) {
    return SOURCE_KEYS.filter(source => record.librarySources[source]?.active === true);
  }
  return SOURCE_KEYS.filter(source => Array.isArray(record?.sourceKeys) && record.sourceKeys.includes(source));
}

function sourceLabelOf(sourceKeys) {
  if (sourceKeys.includes('reading') && sourceKeys.includes('import')) return '收藏·导入';
  if (sourceKeys.includes('reading')) return '收藏';
  if (sourceKeys.includes('import')) return '导入';
  return '';
}

function timeOfRow(row) {
  return validTime(row?.createdAt) ?? validTime(row?.libraryAddedAt) ?? validTime(row?.occurredAt);
}

function firstAndLastTimes(rows) {
  const times = rows.map(timeOfRow).filter(time => time !== null);
  if (!times.length) return { first: null, last: null };
  return { first: Math.min(...times), last: Math.max(...times) };
}

function statusOf(row) {
  if (row?.state === 'mastered') return 'stable';
  if (row?.state === 'relearning') return 'relearning';
  if (row?.state === 'learning' || (!row?.reviewCount && row?.nextReview)) return 'learning';
  if (!row?.reviewCount) return 'new';
  if (Number(row?.interval) >= 21) return 'stable';
  return 'review';
}

function isDueOf(row, now = Date.now()) {
  if (typeof row?.isDue === 'boolean') return row.isDue;
  return !row?.nextReview || Number(row.nextReview) <= Number(now);
}

export function createLibrarySources({ readingAt = null, importAt = null } = {}) {
  return {
    reading: readingAt == null ? inactiveSource() : sourceAt(readingAt),
    import: importAt == null ? inactiveSource() : sourceAt(importAt)
  };
}

export function activateLibrarySource(record, source, occurredAt) {
  if (!SOURCE_KEYS.includes(source)) throw new TypeError('Unsupported vocabulary source');
  const sources = {
    reading: normalizeSource(record?.librarySources?.reading),
    import: normalizeSource(record?.librarySources?.import)
  };
  const previous = sources[source];
  const time = validTime(occurredAt);
  sources[source] = {
    active: true,
    firstAddedAt: previous.firstAddedAt ?? time,
    lastAddedAt: time ?? previous.lastAddedAt
  };
  return {
    ...clone(record),
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: sources,
    libraryAddedAt: validTime(record?.libraryAddedAt) ?? validTime(record?.createdAt) ?? time,
    archivedAt: null
  };
}

export function deactivateLibrarySource(record, source, occurredAt) {
  if (!SOURCE_KEYS.includes(source)) throw new TypeError('Unsupported vocabulary source');
  const sources = {
    reading: normalizeSource(record?.librarySources?.reading),
    import: normalizeSource(record?.librarySources?.import)
  };
  sources[source] = { ...sources[source], active: false };
  const hasActiveSource = SOURCE_KEYS.some(key => sources[key].active);
  return {
    ...clone(record),
    librarySourceVersion: LIBRARY_SOURCE_VERSION,
    librarySources: sources,
    archivedAt: hasActiveSource ? null : validTime(occurredAt)
  };
}

function buildLegacySources(source, times) {
  return {
    reading: source === 'reading' ? sourceWithTimes(times.first, times.last) : inactiveSource(),
    import: source === 'import' ? sourceWithTimes(times.first, times.last) : inactiveSource()
  };
}

function trustedDefinitionFields(savedRow) {
  const fields = {};
  for (const field of TRUSTED_DEFINITION_FIELDS) {
    if (savedRow?.[field] !== undefined) fields[field] = clone(savedRow[field]);
  }
  return fields;
}

export function planLegacyVocabularyMigration({
  learnWords = [],
  vocabulary = [],
  normalizeLemma: normalize = defaultNormalizeLemma
} = {}) {
  const savedByLemma = new Map();
  for (const savedRow of Array.isArray(vocabulary) ? vocabulary : []) {
    const lemma = normalizeLemma(savedRow?.word, normalize);
    if (!lemma) continue;
    if (!savedByLemma.has(lemma)) savedByLemma.set(lemma, []);
    savedByLemma.get(lemma).push(savedRow);
  }

  const updates = [];
  const canonicalLemmas = new Set();
  for (const original of Array.isArray(learnWords) ? learnWords : []) {
    if (!original || original.librarySourceVersion === LIBRARY_SOURCE_VERSION) continue;
    const row = clone(original);
    const lemma = normalizeLemma(row.word, normalize);
    if (!lemma) continue;
    canonicalLemmas.add(lemma);
    const matchingSaved = savedByLemma.get(lemma) || [];
    const times = firstAndLastTimes(matchingSaved);
    const source = matchingSaved.length ? 'reading' : 'import';
    const fallbackTime = validTime(row.libraryAddedAt) ?? validTime(row.createdAt) ?? times.first;
    updates.push({
      ...row,
      librarySourceVersion: LIBRARY_SOURCE_VERSION,
      librarySources: buildLegacySources(source, {
        first: times.first ?? fallbackTime,
        last: times.last ?? fallbackTime
      }),
      libraryAddedAt: validTime(row.libraryAddedAt) ?? validTime(row.createdAt) ?? times.first,
      archivedAt: row.archivedAt ?? null
    });
  }

  const inserts = [];
  for (const [lemma, matchingSaved] of savedByLemma.entries()) {
    if (canonicalLemmas.has(lemma) || !matchingSaved.length) continue;
    const ordered = matchingSaved
      .map((row, index) => ({ row, index, time: timeOfRow(row) }))
      .sort((left, right) => (right.time ?? -Infinity) - (left.time ?? -Infinity) || right.index - left.index);
    const newest = ordered[0].row;
    const times = firstAndLastTimes(matchingSaved);
    const createdAt = times.first;
    inserts.push({
      word: newest.word,
      ...trustedDefinitionFields(newest),
      ...(createdAt === null ? {} : { createdAt, libraryAddedAt: createdAt }),
      librarySourceVersion: LIBRARY_SOURCE_VERSION,
      librarySources: {
        reading: sourceWithTimes(times.first, times.last),
        import: inactiveSource()
      },
      ...(createdAt === null ? { libraryAddedAt: null } : {}),
      archivedAt: null
    });
  }

  return { updates, inserts };
}

export function projectUnifiedVocabulary({
  learnWords = [],
  vocabulary = [],
  normalizeLemma: normalize = defaultNormalizeLemma,
  now = Date.now()
} = {}) {
  const savedRows = Array.isArray(vocabulary) ? vocabulary : [];
  const seenIds = new Set();
  return (Array.isArray(learnWords) ? learnWords : [])
    .filter(row => row && row.archivedAt == null)
    .filter(row => {
      const key = row.id ?? normalizeLemma(row.word, normalize);
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    })
    .map(row => {
      const lemma = normalizeLemma(row.word, normalize);
      const sourceKeys = sourceKeysOf(row);
      const savedContexts = savedRows
        .filter(saved => normalizeLemma(saved?.word, normalize) === lemma)
        .map(saved => clone(saved));
      return {
        ...clone(row),
        sourceKeys,
        sourceLabel: sourceLabelOf(sourceKeys),
        savedContexts,
        isDue: isDueOf(row, now),
        status: row.status || statusOf(row),
        libraryAddedAt: validTime(row.libraryAddedAt) ?? validTime(row.createdAt) ?? 0
      };
    });
}

function searchTextFor(row) {
  const contexts = (row.savedContexts || []).flatMap(saved => [
    saved?.word,
    saved?.translation,
    saved?.phonetic,
    saved?.contextSentence,
    saved?.definition
  ]);
  return [row.word, row.phonetic, row.translation, row.definition, ...contexts]
    .filter(value => value != null)
    .join(' ')
    .toLocaleLowerCase();
}

function recentTime(row) {
  return validTime(row?.libraryAddedAt) ?? validTime(row?.createdAt) ?? 0;
}

function dueRank(row) {
  return row?.isDue || row?.status === 'relearning' || Number(row?.recoveryStage) > 0 ? 0 : 1;
}

export function selectUnifiedVocabulary(rows = [], {
  query = '',
  source = 'all',
  status = 'all',
  sort = 'recent'
} = {}) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const selected = (Array.isArray(rows) ? rows : [])
    .filter(row => row && row.archivedAt == null)
    .filter(row => source === 'all' || row.sourceKeys?.includes(source))
    .filter(row => status === 'all' || row.status === status)
    .filter(row => !normalizedQuery || searchTextFor(row).includes(normalizedQuery));

  return [...selected].sort((left, right) => {
    if (sort === 'alpha') {
      const lemmaOrder = String(left.word || '').toLocaleLowerCase().localeCompare(String(right.word || '').toLocaleLowerCase());
      return lemmaOrder || Number(left.id) - Number(right.id);
    }
    if (sort === 'due') {
      const dueOrder = dueRank(left) - dueRank(right);
      if (dueOrder) return dueOrder;
    }
    return recentTime(right) - recentTime(left) || Number(right.id) - Number(left.id);
  });
}
