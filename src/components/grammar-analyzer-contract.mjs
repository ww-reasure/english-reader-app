export const GRAMMAR_ANALYSIS_VERSION = 1;

const CLAUSE_RELATIONS = new Set(['acl', 'acl:relcl', 'advcl', 'ccomp', 'csubj', 'xcomp']);
const NON_FINITE_RELATIONS = new Set(['acl', 'acl:relcl', 'xcomp']);
const PASSIVE_SUBJECT_RELATIONS = new Set(['nsubj:pass', 'csubj:pass']);

export function createUnavailableGrammarAnalysis(reason = 'LOCAL_RUNTIME_UNAVAILABLE') {
  return {
    status: 'unavailable',
    source: 'local',
    reason: normalizeReason(reason),
    metrics: null,
  };
}

export function validateLocalGrammarManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    return createUnavailableGrammarAnalysis('INVALID_MANIFEST');
  }

  const runtime = manifest.runtime;
  if (!isRecord(runtime) || runtime.status !== 'bundled') {
    return createUnavailableGrammarAnalysis('RUNTIME_NOT_BUNDLED');
  }
  const usesBundledModule = hasIdentifier(runtime.moduleId);
  if (!usesBundledModule && (!hasUrl(runtime.loaderUrl) || !hasUrl(runtime.wasmUrl))) {
    return createUnavailableGrammarAnalysis('RUNTIME_ASSET_UNCONFIGURED');
  }

  const model = manifest.model;
  if (!isRecord(model) || model.status !== 'bundled') {
    return createUnavailableGrammarAnalysis('MODEL_NOT_BUNDLED');
  }
  if (!hasUrl(model.url)) {
    return createUnavailableGrammarAnalysis('MODEL_ASSET_UNCONFIGURED');
  }

  return { status: 'eligible', source: 'local' };
}

export function analyzeDependencyDocument(document) {
  const sentences = document?.sentences;
  if (!Array.isArray(sentences)) return createUnavailableGrammarAnalysis('INVALID_DEPENDENCY_DOCUMENT');

  const relationCounts = new Map();
  let tokenCount = 0;
  let clauseRelationCount = 0;
  let nonFiniteRelationCount = 0;
  let passivePredicateCount = 0;
  let maxDependencyDepth = 0;
  const lexicalTokens = [];
  let lexicalTokenizationAvailable = true;

  for (const sentence of sentences) {
    const tokens = sentence?.tokens;
    if (!Array.isArray(tokens)) return createUnavailableGrammarAnalysis('INVALID_DEPENDENCY_DOCUMENT');
    const normalizedTokens = normalizeSentenceTokens(tokens);
    if (!normalizedTokens) return createUnavailableGrammarAnalysis('INVALID_DEPENDENCY_DOCUMENT');

    const tokenMap = new Map(normalizedTokens.map(token => [token.id, token]));
    const passiveHeads = new Set();
    for (const token of normalizedTokens) {
      tokenCount += 1;
      relationCounts.set(token.deprel, (relationCounts.get(token.deprel) || 0) + 1);
      if (CLAUSE_RELATIONS.has(token.deprel)) clauseRelationCount += 1;
      if (NON_FINITE_RELATIONS.has(token.deprel)) nonFiniteRelationCount += 1;
      if (PASSIVE_SUBJECT_RELATIONS.has(token.deprel) || token.deprel === 'aux:pass') passiveHeads.add(token.head);
      const depth = getDependencyDepth(token, tokenMap);
      if (depth === null) return createUnavailableGrammarAnalysis('INVALID_DEPENDENCY_DOCUMENT');
      maxDependencyDepth = Math.max(maxDependencyDepth, depth);
      if (token.lexical) lexicalTokens.push(token.lexical);
      else lexicalTokenizationAvailable = false;
    }
    passivePredicateCount += passiveHeads.size;
  }

  return {
    status: 'available',
    source: 'local',
    metrics: {
      sentenceCount: sentences.length,
      tokenCount,
      clauseRelationCount,
      passivePredicateCount,
      nonFiniteRelationCount,
      maxDependencyDepth,
      relations: Object.fromEntries([...relationCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    },
    // A complete parser-supplied lemma/POS stream lets downstream lexical
    // matching avoid mistaking students/met/Alice for three unrelated words.
    // Grammar-only documents remain valid, but explicitly carry no lexical
    // evidence instead of inventing a lemma with a stemmer.
    lexicalTokens: lexicalTokenizationAvailable ? lexicalTokens : null,
  };
}

function normalizeSentenceTokens(tokens) {
  const seen = new Set();
  const normalized = [];
  for (const token of tokens) {
    if (!isRecord(token)) return null;
    const id = Number(token.id);
    const head = Number(token.head);
    const deprel = typeof token.deprel === 'string' ? token.deprel.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !Number.isInteger(head) || head < 0 || !deprel) return null;
    seen.add(id);
    normalized.push({
      id,
      head,
      deprel,
      lexical: normalizeLexicalToken(token)
    });
  }
  const ids = new Set(normalized.map(token => token.id));
  return normalized.every(token => token.head === 0 || ids.has(token.head)) ? normalized : null;
}

function normalizeLexicalToken(token) {
  const form = typeof token.form === 'string' ? token.form.trim() : '';
  const lemma = typeof token.lemma === 'string' ? token.lemma.trim() : '';
  const upos = typeof token.upos === 'string' ? token.upos.trim().toUpperCase() : '';
  if (!form || !lemma || !/^[A-Z]+$/.test(upos)) return null;
  return { form, lemma, upos };
}

function getDependencyDepth(token, tokenMap) {
  const visited = new Set();
  let depth = 1;
  let current = token;
  while (current.head !== 0) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = tokenMap.get(current.head);
    if (!parent) return null;
    depth += 1;
    current = parent;
  }
  return depth;
}

function normalizeReason(reason) {
  const value = String(reason || '').trim().toUpperCase();
  return /^[A-Z0-9_:-]+$/.test(value) ? value : 'LOCAL_RUNTIME_UNAVAILABLE';
}

function hasUrl(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasIdentifier(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
