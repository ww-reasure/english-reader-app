/**
 * Strict, explicitly labelled AI fallback for dependency-metric review.
 *
 * It is intentionally an adapter rather than part of the local parser. The
 * quality validator may call it only after the on-device UDPipe path reports
 * unavailable; no response from this module is ever labelled `local`.
 */

import { createUnavailableGrammarAnalysis } from './grammar-analyzer-contract.mjs';

const MAX_ARTICLE_CHARS = 18_000;
const METRIC_FIELDS = [
  'tokenCount',
  'sentenceCount',
  'clauseRelationCount',
  'passivePredicateCount',
  'nonFiniteRelationCount',
  'maxDependencyDepth'
];

const SYSTEM_PROMPT = `You validate English reading passages after a local dependency parser failed. Return JSON only, with this exact shape:
{
  "metrics": {
    "tokenCount": integer,
    "sentenceCount": integer,
    "clauseRelationCount": integer,
    "passivePredicateCount": integer,
    "nonFiniteRelationCount": integer,
    "maxDependencyDepth": integer
  }
}
Count only the provided article. Do not add commentary, fields, or an exam-equivalence claim. A clause relation is acl, acl:relcl, advcl, ccomp, csubj, or xcomp; a non-finite relation is acl, acl:relcl, or xcomp; a passive predicate is counted once per passive predicate.`;

export function createAiGrammarFallback({ api } = {}) {
  if (!api || typeof api.chat !== 'function') throw new TypeError('AI 语法降级需要 chat API');

  return async function aiFallback(text, { signal } = {}) {
    const article = String(text || '').trim();
    if (!article) return createUnavailableGrammarAnalysis('EMPTY_TEXT');

    try {
      const message = await api.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: article.slice(0, MAX_ARTICLE_CHARS) }
      ], {
        signal,
        temperature: 0,
        responseFormat: { type: 'json_object' }
      });
      const payload = parsePayload(message?.content);
      const metrics = normalizeMetrics(payload?.metrics);
      if (!metrics) return unavailable('AI_GRAMMAR_RESPONSE_INVALID');
      return { status: 'available', source: 'ai_fallback', metrics };
    } catch (error) {
      // Cancellation must remain visible to the generation request gate. A
      // network/schema error becomes a labelled failed fallback instead.
      if (signal?.aborted) throw error;
      return unavailable('AI_GRAMMAR_REQUEST_FAILED');
    }
  };
}

function parsePayload(content) {
  if (content && typeof content === 'object') return content;
  if (typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function normalizeMetrics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metrics = {};
  for (const field of METRIC_FIELDS) {
    const number = Number(value[field]);
    if (!Number.isSafeInteger(number) || number < 0) return null;
    metrics[field] = number;
  }
  if (metrics.tokenCount < 1 || metrics.sentenceCount < 1 || metrics.maxDependencyDepth < 1) return null;
  if (metrics.clauseRelationCount > metrics.tokenCount
    || metrics.nonFiniteRelationCount > metrics.tokenCount
    || metrics.passivePredicateCount > metrics.sentenceCount
    || metrics.maxDependencyDepth > metrics.tokenCount) return null;
  return metrics;
}

function unavailable(reason) {
  return {
    ...createUnavailableGrammarAnalysis(reason),
    source: 'ai_fallback'
  };
}
