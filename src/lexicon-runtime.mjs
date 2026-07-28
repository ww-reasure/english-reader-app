import { assertCoreLexiconArtifact, assertLexiconManifest } from './lexicon.mjs';
import {
  assertExamFocusArtifact,
  createExamFocusIndex,
  createFocusOnlyEntry,
  mergeExamFocusIntoEntry
} from './exam-focus.mjs';

// The core can legitimately contain a standalone limited lemma alongside a
// reviewed entry that explicitly declares the same surface form (for example
// `could` and the reviewed `can -> could`).  Keep every candidate and choose
// by this documented order instead of relying on artifact iteration order.
const ENTRY_QUALITY_PRIORITY = Object.freeze({
  high: 3,
  screened: 2,
  limited: 1,
  rejected: 0
});

function normalizeLookupForm(value) {
  return String(value || '').trim().toLowerCase();
}

function hasOfflineChineseSense(entry) {
  return ['high', 'screened'].includes(entry?.quality)
    && (entry.senses || []).some((sense) => sense?.quality === entry.quality && String(sense?.glossZh || '').trim());
}

function hasAuditedFormProvenance(entry, lookupForm) {
  return (entry?.formProvenance || []).some((provenance) => {
    if (normalizeLookupForm(provenance?.form) !== lookupForm) return false;
    if (provenance?.kind === 'declared-inflection') return true;
    return provenance?.kind === 'generated-inflection'
      && provenance?.policy === 'conservative-english-inflection-v1'
      && provenance?.rule === 'audited-irregular';
  });
}

function compareLookupCandidates(left, right, lookupForm) {
  const qualityDifference = (ENTRY_QUALITY_PRIORITY[right?.quality] || 0)
    - (ENTRY_QUALITY_PRIORITY[left?.quality] || 0);
  if (qualityDifference) return qualityDifference;

  const offlineSenseDifference = Number(hasOfflineChineseSense(right)) - Number(hasOfflineChineseSense(left));
  if (offlineSenseDifference) return offlineSenseDifference;

  // A same-quality standalone word can share a surface form with an
  // audited inflection (for example, `its` and `it -> its`). Prefer the
  // recorded inflection only when the build artifact carries its provenance.
  const auditedFormDifference = Number(hasAuditedFormProvenance(right, lookupForm))
    - Number(hasAuditedFormProvenance(left, lookupForm));
  if (auditedFormDifference) return auditedFormDifference;

  const leftIsLemma = Number(normalizeLookupForm(left?.lemma) === lookupForm);
  const rightIsLemma = Number(normalizeLookupForm(right?.lemma) === lookupForm);
  if (rightIsLemma !== leftIsLemma) return rightIsLemma - leftIsLemma;

  const lemmaDifference = normalizeLookupForm(left?.lemma).localeCompare(normalizeLookupForm(right?.lemma));
  if (lemmaDifference) return lemmaDifference;

  return (left?.sourceRefs || []).join('|').localeCompare((right?.sourceRefs || []).join('|'));
}

export function selectLexiconLookupCandidate(candidates, form) {
  const lookupForm = normalizeLookupForm(form);
  const usableCandidates = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!lookupForm || !usableCandidates.length) return null;
  return [...usableCandidates].sort((left, right) => compareLookupCandidates(left, right, lookupForm))[0] || null;
}

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response?.ok) {
    throw new Error(`词库资源加载失败：${url}`);
  }
  return response.json();
}

export function createLexiconLoader({ fetchFn = globalThis.fetch, dataUrl = '/data' } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('词库加载器需要 fetchFn');

  const baseUrl = dataUrl.replace(/\/$/, '');
  let manifestPromise;
  let corePromise;
  let entryIndexPromise;
  let examFocusPromise;
  let examFocusIndexPromise;

  async function loadManifest() {
    manifestPromise ||= fetchJson(fetchFn, `${baseUrl}/lexicon-manifest.json`).then((manifest) => {
      assertLexiconManifest(manifest);
      return manifest;
    });
    return manifestPromise;
  }

  async function loadCore() {
    corePromise ||= Promise.all([
      loadManifest(),
      fetchJson(fetchFn, `${baseUrl}/lexicon-core.json`)
    ]).then(([manifest, core]) => {
      assertCoreLexiconArtifact(core, manifest);
      return core;
    });
    return corePromise;
  }

  async function loadExamFocus() {
    examFocusPromise ||= fetchJson(fetchFn, `${baseUrl}/exam-focus.json`).then((artifact) => {
      assertExamFocusArtifact(artifact);
      return artifact;
    });
    return examFocusPromise;
  }

  async function getExamFocusIndex() {
    examFocusIndexPromise ||= loadExamFocus().then(createExamFocusIndex);
    return examFocusIndexPromise;
  }

  async function getEntryIndex() {
    entryIndexPromise ||= loadCore().then((core) => {
      const index = new Map();
      for (const entry of core.entries) {
        for (const form of new Set([entry.lemma, ...(entry.forms || [])])) {
          const normalized = normalizeLookupForm(form);
          if (!normalized) continue;
          const candidates = index.get(normalized) || [];
          candidates.push(entry);
          index.set(normalized, candidates);
        }
      }
      return index;
    });
    return entryIndexPromise;
  }

  return {
    loadManifest,
    loadCore,
    loadExamFocus,
    async lookup(form) {
      const normalized = normalizeLookupForm(form);
      const entry = selectLexiconLookupCandidate((await getEntryIndex()).get(normalized), normalized);

      // The public CET lists are a separate exam-direction layer.  They must
      // never mutate the versioned frequency/definition core or make a failed
      // focus download block normal lookup.
      try {
        const [artifact, index] = await Promise.all([loadExamFocus(), getExamFocusIndex()]);
        const tracks = [...new Set([
          ...index.lookup(normalized),
          ...(entry ? index.lookup(entry.lemma) : [])
        ])].sort();
        if (!tracks.length) return entry;
        return entry
          ? mergeExamFocusIntoEntry(entry, tracks, artifact)
          : createFocusOnlyEntry(normalized, tracks, artifact);
      } catch {
        return entry;
      }
    }
  };
}
