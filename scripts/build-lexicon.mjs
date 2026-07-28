import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { gunzipSync } from 'node:zlib';

import { decode } from '@msgpack/msgpack';

import { assertLexiconManifest, assertLexiconReleaseManifest, buildCoreLexicon } from '../src/lexicon.mjs';

function isInside(root, target) {
  const relativePath = relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

export async function verifySourceSnapshots({ manifest, sourceDir }) {
  assertLexiconManifest(manifest);

  const root = resolve(sourceDir);
  const verified = [];

  for (const source of manifest.sources) {
    if (typeof source.snapshotPath !== 'string' || !source.snapshotPath.trim()) {
      throw new Error(`来源 ${source.id} 缺少 snapshotPath，无法验证校验和`);
    }

    const snapshotPath = resolve(root, source.snapshotPath);
    if (!isInside(root, snapshotPath)) {
      throw new Error(`来源 ${source.id} 的 snapshotPath 超出来源目录`);
    }

    const bytes = await readFile(snapshotPath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== source.sha256.toLowerCase()) {
      throw new Error(`来源 ${source.id} 的校验和不匹配`);
    }
    if (bytes.byteLength !== source.byteSize) {
      throw new Error(`来源 ${source.id} 的字节数不匹配：期望 ${source.byteSize}，实际 ${bytes.byteLength}`);
    }

    verified.push({
      id: source.id,
      sha256: actual,
      byteSize: bytes.byteLength,
      snapshotPath: source.snapshotPath
    });
  }

  return verified;
}

export async function buildLexiconArtifact({ manifest, entries, sourceDir, generatedAt }) {
  await verifySourceSnapshots({ manifest, sourceDir });
  return buildCoreLexicon({ manifest, entries, generatedAt });
}

const normalizeLemma = value => String(value || '').trim().toLowerCase();
const CEFRJ_SOURCE_ID = 'cefrj-vocabulary-profile-1.5';
const ECDICT_SOURCE_ID = 'ecdict-2025-full';
const WORDFREQ_SOURCE_ID = 'wordfreq-3.2.0-en';
const CEFRJ_LEVELS = new Set(['A1', 'A2', 'B1', 'B2']);
const CEFRJ_POS = new Set([
  'adjective', 'adverb', 'be-verb', 'conjunction', 'determiner', 'do-verb',
  'have-verb', 'infinitive-to', 'interjection', 'modal-auxiliary', 'noun',
  'number', 'preposition', 'pronoun', 'verb'
]);

function uniqueValues(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function parseCsvRecord(row) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error(`CSV 快照存在未闭合引号：${row}`);
  values.push(value);
  return values;
}

const SCREENED_LEMMA = /^[a-z]+$/;
const CHINESE_TEXT = /[\u3400-\u9fff]/u;
const DOMAIN_PREFIX = /^\s*\[[^\]]+\]/u;
const ABBREVIATION_PRIMARY = /^\s*(?:abbr|acronym|initialism)\./iu;
const PROPER_NAME_GLOSS = /(?:男子名|女子名|人名|地名|姓氏|品牌名)/u;
const ECDICT_FORM_POLICY_ID = 'ecdict-explicit-form-v1';
const MAX_SCREENED_SENSE_GROUPS = 4;
const MAX_SCREENED_GLOSS_PARTS = 3;
const ECDICT_POS = Object.freeze({
  n: 'noun', noun: 'noun',
  v: 'verb', vt: 'verb', vi: 'verb', verb: 'verb',
  a: 'adjective', adj: 'adjective', adjective: 'adjective',
  ad: 'adverb', adv: 'adverb', adverb: 'adverb',
  prep: 'preposition', conj: 'conjunction', pron: 'pronoun',
  num: 'number', art: 'determiner', int: 'interjection'
});

function compactEcdictGlossLine(value) {
  const line = String(value || '')
    .replace(/^\s*(?:[a-z]{1,5}\.)\s*/iu, '')
    .trim();
  if (!line || !CHINESE_TEXT.test(line) || /\[[^\]]+\]/u.test(line)) return '';
  const parts = line
    .split(/[，,；;、]/u)
    .map((part) => part.trim())
    .filter((part) => part && CHINESE_TEXT.test(part) && !/^[a-z.\s]+$/iu.test(part))
    .slice(0, MAX_SCREENED_GLOSS_PARTS);
  return parts.join('；');
}

function ecdictPartOfSpeech(value, translation = '') {
  const token = String(value || '').trim().toLowerCase().replace(/\.$/u, '');
  if (ECDICT_POS[token]) return ECDICT_POS[token];
  const match = /^\s*([a-z]{1,5})\./imu.exec(String(translation || ''));
  return match ? ECDICT_POS[match[1].toLowerCase()] || '' : '';
}

function screenedEcdictPhonetic(value) {
  const phonetic = String(value || '')
    .trim()
    .replace(/^[\[\/\s]+|[\]\/\s]+$/gu, '')
    .trim();
  return phonetic && phonetic.length <= 80 && !CHINESE_TEXT.test(phonetic) ? phonetic : '';
}

function screenedEcdictSenses(translation, fallbackPos) {
  const grouped = new Map();
  const lines = String(translation || '').replace(/\\n/g, '\n').split(/\r?\n/u);

  for (const rawLine of lines) {
    if (DOMAIN_PREFIX.test(rawLine)) continue;
    const pos = ecdictPartOfSpeech('', rawLine) || fallbackPos;
    const glossZh = compactEcdictGlossLine(rawLine);
    if (!pos || !glossZh) continue;

    const current = grouped.get(pos) || [];
    for (const part of glossZh.split('；')) {
      if (part && !current.includes(part) && current.length < MAX_SCREENED_GLOSS_PARTS) current.push(part);
    }
    if (current.length) grouped.set(pos, current);
  }

  return [...grouped]
    .slice(0, MAX_SCREENED_SENSE_GROUPS)
    .map(([pos, parts]) => ({ pos, glossZh: parts.join('；') }));
}

function parseEcdictExchange(exchange) {
  return String(exchange || '')
    .split(/[;/]/u)
    .map((segment) => /^\s*([a-z0-9]+):([a-z]+)\s*$/iu.exec(segment))
    .filter(Boolean)
    .map((match) => ({ rule: match[1].toLowerCase(), form: normalizeLemma(match[2]) }));
}

function ecdictCanonicalLemma(lemma, exchange) {
  const declaredBase = normalizeLemma(parseEcdictExchange(exchange).find((item) => item.rule === '0')?.form);
  return SCREENED_LEMMA.test(declaredBase) ? declaredBase : lemma;
}

function ecdictForms(lemma, exchange, surfaceForm = lemma) {
  const forms = new Set([lemma]);
  const formProvenance = [];
  const addDeclaredForm = (value, rule) => {
    const form = normalizeLemma(value);
    if (!SCREENED_LEMMA.test(form) || form === lemma) return;
    forms.add(form);
    formProvenance.push({
      form,
      kind: 'declared-inflection',
      policy: ECDICT_FORM_POLICY_ID,
      rule
    });
  };

  if (normalizeLemma(surfaceForm) !== lemma) addDeclaredForm(surfaceForm, 'declared-base-map');
  for (const { rule, form } of parseEcdictExchange(exchange)) {
    if (rule === '0' || rule === '1') continue;
    addDeclaredForm(form, rule || 'declared-form');
  }
  return {
    forms: [...forms].sort(),
    formProvenance: uniqueFormProvenance(formProvenance)
  };
}

function isRejectedEcdictLearningRecord({ translation, definition, tag }) {
  const primary = String(translation || '').trim();
  if (ABBREVIATION_PRIMARY.test(primary)) return true;
  if (PROPER_NAME_GLOSS.test(primary)) return true;
  const metadata = `${String(definition || '')}\n${String(tag || '')}`;
  return /\b(?:abbreviation|acronym|initialism|proper\s+name)\b/iu.test(metadata);
}

function mergeScreenedEcdictEntry(current, incoming, isDirectLemmaRecord) {
  if (!current) return { entry: incoming, isDirectLemmaRecord };
  const forms = uniqueValues([...(current.entry.forms || []), ...(incoming.forms || [])]).sort();
  if (isDirectLemmaRecord && !current.isDirectLemmaRecord) {
    return {
      entry: { ...incoming, forms },
      isDirectLemmaRecord
    };
  }
  return {
    entry: { ...current.entry, forms },
    isDirectLemmaRecord: current.isDirectLemmaRecord
  };
}

export function buildScreenedEcdictEntries({ csv, candidateLemmas, sourceId = ECDICT_SOURCE_ID } = {}) {
  const candidates = candidateLemmas instanceof Set
    ? candidateLemmas
    : new Set(Array.isArray(candidateLemmas) ? candidateLemmas : []);
  if (!candidates.size) return [];

  const rows = String(csv || '').replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const header = parseCsvRecord(rows.shift() || '').map((value) => value.trim());
  const columns = new Map(header.map((value, index) => [value, index]));
  for (const required of ['word', 'translation', 'pos', 'exchange']) {
    if (!columns.has(required)) throw new Error(`ECDICT 快照缺少 ${required} 列`);
  }

  const entries = new Map();
  for (const row of rows) {
    if (!row.trim()) continue;
    const values = parseCsvRecord(row);
    const surfaceLemma = normalizeLemma(values[columns.get('word')]);
    if (!SCREENED_LEMMA.test(surfaceLemma) || !candidates.has(surfaceLemma)) continue;
    const translation = values[columns.get('translation')];
    if (isRejectedEcdictLearningRecord({
      translation,
      definition: values[columns.get('definition')],
      tag: values[columns.get('tag')]
    })) continue;
    const pos = ecdictPartOfSpeech(values[columns.get('pos')], values[columns.get('translation')]);
    if (!pos) continue;
    const senses = screenedEcdictSenses(translation, pos);
    if (!senses.length) continue;
    const phonetic = screenedEcdictPhonetic(values[columns.get('phonetic')]);
    const exchange = values[columns.get('exchange')];
    const lemma = ecdictCanonicalLemma(surfaceLemma, exchange);
    const declaredForms = ecdictForms(lemma, exchange, surfaceLemma);
    const entry = {
      lemma,
      forms: declaredForms.forms,
      ...(declaredForms.formProvenance.length ? { formProvenance: declaredForms.formProvenance } : {}),
      ...(phonetic ? { phonetic } : {}),
      senses: senses.map((sense) => ({
        ...sense,
        quality: 'screened',
        sourceRecord: `ecdict.csv:${surfaceLemma}`,
        sourceRefs: [sourceId]
      })),
      layers: {},
      quality: 'screened',
      sourceRefs: [sourceId]
    };
    entries.set(lemma, mergeScreenedEcdictEntry(entries.get(lemma), entry, surfaceLemma === lemma));
  }
  return [...entries.values()]
    .map(value => value.entry)
    .sort((left, right) => left.lemma.localeCompare(right.lemma));
}

export function buildWordfreqCandidateEntries({ frequencies, sourceId, limit = 25000 } = {}) {
  const boundedLimit = Math.max(1, Number.parseInt(limit, 10) || 25000);
  const eligible = (Array.isArray(frequencies) ? frequencies : [])
    .map((item) => ({
      word: normalizeLemma(item?.word),
      zipf: Number(item?.zipf)
    }))
    .filter((item) => SCREENED_LEMMA.test(item.word) && Number.isFinite(item.zipf))
    .sort((left, right) => right.zipf - left.zipf || left.word.localeCompare(right.word))
    .slice(0, boundedLimit);

  return eligible.map((item, index) => ({
    lemma: item.word,
    forms: [item.word],
    senses: [],
    layers: {
      lookupFrequency: [{
        band: 'wordfreq-top-25000',
        rank: index + 1,
        zipf: item.zipf,
        sourceRef: sourceId
      }]
    },
    quality: 'limited',
    sourceRefs: [sourceId]
  }));
}

export function decodeWordfreqSnapshot(bytes) {
  let payload;
  try {
    payload = decode(gunzipSync(bytes));
  } catch {
    throw new Error('wordfreq 快照不是可读取的 gzip MessagePack 数据');
  }

  const header = Array.isArray(payload) ? payload[0] : null;
  if (!header || header.format !== 'cB' || header.version !== 1) {
    throw new Error('wordfreq 快照格式不是受支持的 cBpack v1');
  }

  const frequencies = [];
  for (let index = 1; index < payload.length; index += 1) {
    const bucket = payload[index];
    if (!Array.isArray(bucket)) {
      throw new Error(`wordfreq 快照的第 ${index} 个频率桶无效`);
    }
    const zipf = Number(((900 - (index - 1)) / 100).toFixed(2));
    for (const rawWord of bucket) {
      const word = normalizeLemma(rawWord);
      if (SCREENED_LEMMA.test(word)) frequencies.push({ word, zipf });
    }
  }
  return frequencies;
}

export function extractExamFocusCandidateLemmas(artifact) {
  const tracks = artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact.tracks
    : null;
  if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) return [];

  const candidates = new Set();
  for (const words of Object.values(tracks)) {
    if (!Array.isArray(words)) continue;
    for (const rawWord of words) {
      const lemma = normalizeLemma(rawWord);
      if (SCREENED_LEMMA.test(lemma)) candidates.add(lemma);
    }
  }
  return [...candidates];
}

// The NGSL statistics snapshot intentionally contains lemmas only.  These
// rules add a small, deterministic *inflection* layer; they never generate
// derivations (for example, happy -> happiness) or try to guess a new lemma.
// Every generated form is labelled in the published artifact so callers can
// distinguish it from a form explicitly supplied by NGSL, NAWL, or the
// reviewed seed.
const INFLECTION_POLICY_ID = 'conservative-english-inflection-v1';

// This deliberately short list covers frequent irregular forms that cannot be
// produced by the spelling rules below.  It is source-controlled and reviewed
// as part of the build policy, rather than silently imported from an
// unversioned stemmer or a legacy dictionary.
const AUDITED_IRREGULAR_FORMS = Object.freeze({
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  become: ['becomes', 'became', 'becoming'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  bring: ['brings', 'brought', 'bringing'],
  buy: ['buys', 'bought', 'buying'],
  child: ['children'],
  come: ['comes', 'came', 'coming'],
  do: ['does', 'did', 'done', 'doing'],
  drink: ['drinks', 'drank', 'drunk', 'drinking'],
  eat: ['eats', 'ate', 'eaten', 'eating'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  feel: ['feels', 'felt', 'feeling'],
  find: ['finds', 'found', 'finding'],
  foot: ['feet'],
  get: ['gets', 'got', 'gotten', 'getting'],
  give: ['gives', 'gave', 'given', 'giving'],
  go: ['goes', 'went', 'gone', 'going'],
  have: ['has', 'had', 'having'],
  it: ['its'],
  keep: ['keeps', 'kept', 'keeping'],
  know: ['knows', 'knew', 'known', 'knowing'],
  leave: ['leaves', 'left', 'leaving'],
  make: ['makes', 'made', 'making'],
  man: ['men'],
  meet: ['meets', 'met', 'meeting'],
  mouse: ['mice'],
  person: ['people'],
  read: ['reads', 'reading'],
  run: ['runs', 'ran', 'running'],
  say: ['says', 'said', 'saying'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  send: ['sends', 'sent', 'sending'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  take: ['takes', 'took', 'taken', 'taking'],
  teach: ['teaches', 'taught', 'teaching'],
  tell: ['tells', 'told', 'telling'],
  think: ['thinks', 'thought', 'thinking'],
  they: ['them', 'their', 'theirs'],
  tooth: ['teeth'],
  woman: ['women'],
  write: ['writes', 'wrote', 'written', 'writing']
});

// The statistics file does not expose POS.  Past/progressive forms are only
// generated for this compact, reviewed list of common regular verbs.  A wider
// list would turn noun/adjective guesses into false inflections; additions
// require an explicit review in this source file.
const AUDITED_REGULAR_VERB_LEMMAS = new Set([
  'accept', 'add', 'admit', 'advise', 'afford', 'agree', 'allow', 'answer',
  'appear', 'apply', 'argue', 'arrive', 'ask', 'avoid', 'believe', 'belong',
  'call', 'carry', 'cause', 'change', 'clean', 'clear', 'close', 'collect',
  'compare', 'complete', 'consider', 'continue', 'control', 'cook', 'cover',
  'create', 'cross', 'decide', 'deliver', 'depend', 'describe', 'design',
  'destroy', 'develop', 'die', 'discover', 'discuss', 'divide', 'enjoy',
  'explain', 'face', 'fail', 'fill', 'finish', 'follow', 'happen', 'help',
  'hope', 'improve', 'include', 'influence', 'introduce', 'invite', 'involve',
  'join', 'laugh', 'learn', 'like', 'listen', 'live', 'look', 'love', 'manage',
  'matter', 'move', 'need', 'offer', 'open', 'organize', 'own', 'pass', 'plan',
  'play', 'place', 'point', 'prefer', 'prepare', 'present', 'produce',
  'protect', 'provide', 'pull', 'push', 'reach', 'realize', 'receive',
  'record', 'reduce', 'remain', 'remember', 'remove', 'repeat', 'report',
  'return', 'save', 'seem', 'serve', 'share', 'smile', 'sound', 'start',
  'show', 'stay', 'stop', 'store', 'study', 'suggest', 'support', 'talk', 'test',
  'train', 'travel', 'treat', 'try', 'turn', 'use', 'visit', 'wait', 'walk',
  'want', 'watch', 'work', 'worry'
]);

// Lemma-only sources also cannot distinguish a noun from an adjective or a
// function word.  We therefore add a regular -s form only for this reviewed
// group of common count nouns (or for the reviewed verbs above), rather than
// applying -s across every NGSL lemma.
const AUDITED_REGULAR_NOMINAL_LEMMAS = new Set([
  'account', 'action', 'actor', 'address', 'advantage', 'age', 'agent', 'agreement',
  'airline', 'animal', 'area', 'article', 'audience', 'author', 'baby', 'bank',
  'base', 'beach', 'benefit', 'book', 'bottle', 'box', 'business', 'car', 'case',
  'center', 'chapter', 'class', 'city', 'community', 'company', 'container', 'country', 'course',
  'cup', 'customer', 'day', 'decision', 'development', 'difference', 'discussion',
  'doctor', 'education', 'effect', 'effort', 'example', 'experience', 'fact', 'family',
  'father', 'field', 'figure', 'film', 'food', 'friend', 'group', 'hand', 'health',
  'home', 'hour', 'idea', 'interest', 'job', 'kind', 'language', 'law', 'level', 'line',
  'list', 'market', 'member', 'method', 'minute', 'month', 'morning', 'name', 'number',
  'office', 'page', 'paper', 'parent', 'part', 'place', 'plan', 'plant', 'point',
  'policy', 'problem', 'process', 'product', 'program', 'project', 'question', 'reason',
  'record', 'report', 'research', 'result', 'river', 'road', 'room', 'school', 'science',
  'service', 'shop', 'side', 'situation', 'skill', 'solution', 'source', 'student',
  'station', 'study', 'system', 'teacher', 'team', 'test', 'thing', 'town', 'university', 'visitor',
  'way', 'week', 'weekend', 'word', 'world', 'year', 'resident'
]);

// Orthography alone cannot determine stress.  These manually reviewed verbs
// are the limited cases in the curated regular list that double the final
// consonant despite having more than one syllable.
const AUDITED_DOUBLE_FINAL_CONSONANT_VERBS = new Set([
  'admit', 'commit', 'control', 'occur', 'permit', 'prefer', 'refer', 'regret',
  'submit', 'transfer', 'plan', 'stop'
]);

function uniqueFormProvenance(values = []) {
  const seen = new Set();
  return values
    .filter((value) => value && typeof value.form === 'string' && typeof value.rule === 'string')
    .map((value) => ({
      form: normalizeLemma(value.form),
      kind: value.kind || 'generated-inflection',
      policy: value.policy || INFLECTION_POLICY_ID,
      rule: value.rule
    }))
    .filter((value) => {
      const key = `${value.form}\u0000${value.kind}\u0000${value.policy}\u0000${value.rule}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.form}\u0000${left.rule}`.localeCompare(`${right.form}\u0000${right.rule}`));
}

function regularSForm(lemma) {
  if (/(?:s|x|z|ch|sh)$/.test(lemma)) return `${lemma}es`;
  if (/[^aeiou]y$/.test(lemma)) return `${lemma.slice(0, -1)}ies`;
  return `${lemma}s`;
}

function doublesFinalConsonant(lemma) {
  return AUDITED_DOUBLE_FINAL_CONSONANT_VERBS.has(lemma);
}

function regularPastForm(lemma) {
  if (lemma.endsWith('ie')) return `${lemma.slice(0, -2)}ied`;
  if (lemma.endsWith('e')) return `${lemma}d`;
  if (lemma.endsWith('c')) return `${lemma}ked`;
  if (/[^aeiou]y$/.test(lemma)) return `${lemma.slice(0, -1)}ied`;
  if (doublesFinalConsonant(lemma)) return `${lemma}${lemma.at(-1)}ed`;
  return `${lemma}ed`;
}

function regularProgressiveForm(lemma) {
  if (lemma.endsWith('ie')) return `${lemma.slice(0, -2)}ying`;
  if (lemma.endsWith('e') && !lemma.endsWith('ee') && !lemma.endsWith('ye')) {
    return `${lemma.slice(0, -1)}ing`;
  }
  if (doublesFinalConsonant(lemma)) return `${lemma}${lemma.at(-1)}ing`;
  return `${lemma}ing`;
}

function canGenerateRegularS(lemma, isAuditedVerb) {
  return /^[a-z]{3,}$/.test(lemma)
    && !AUDITED_IRREGULAR_FORMS[lemma]
    && (isAuditedVerb || AUDITED_REGULAR_NOMINAL_LEMMAS.has(lemma));
}

function addGeneratedForm(forms, provenance, form, rule) {
  const normalized = normalizeLemma(form);
  if (!normalized || forms.has(normalized)) return;
  forms.add(normalized);
  provenance.push({
    form: normalized,
    kind: 'generated-inflection',
    policy: INFLECTION_POLICY_ID,
    rule
  });
}

function addConservativeInflections(entry) {
  const lemma = normalizeLemma(entry?.lemma);
  const forms = new Set(uniqueValues([lemma, ...(entry?.forms || [])]).map(normalizeLemma));
  const generated = [];
  const irregularForms = AUDITED_IRREGULAR_FORMS[lemma];
  const isAuditedVerb = AUDITED_REGULAR_VERB_LEMMAS.has(lemma);

  if (irregularForms) {
    for (const form of irregularForms) addGeneratedForm(forms, generated, form, 'audited-irregular');
  } else {
    if (canGenerateRegularS(lemma, isAuditedVerb)) {
      addGeneratedForm(forms, generated, regularSForm(lemma), 'regular-s');
    }
    if (isAuditedVerb) {
      addGeneratedForm(forms, generated, regularPastForm(lemma), 'regular-past');
      addGeneratedForm(forms, generated, regularProgressiveForm(lemma), 'regular-progressive');
    }
  }

  const formProvenance = uniqueFormProvenance([...(entry?.formProvenance || []), ...generated]);
  return {
    ...entry,
    lemma,
    forms: [...forms],
    ...(formProvenance.length ? { formProvenance } : {})
  };
}

function rankToBand(rank) {
  return `ngsl-${Math.max(1, Math.min(6, Math.ceil(Number(rank) / 500)))}`;
}

function parseNgslStatistics(csv, sourceId) {
  const rows = String(csv || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = parseCsvRecord(rows.shift() || '').map(value => value.trim());
  if (!header || header[0] !== 'Lemma' || header[1] !== 'SFI Rank') {
    throw new Error('NGSL 快照格式不符合 1.2 statistics 文件');
  }

  const entries = [];
  for (const row of rows) {
    const [rawLemma, rawRank] = parseCsvRecord(row);
    const lemma = normalizeLemma(rawLemma);
    const rank = Number.parseInt(rawRank, 10);
    if (!lemma || !Number.isInteger(rank) || rank < 1) {
      throw new Error(`NGSL 快照存在无法解析的词条：${row}`);
    }
    entries.push({
      lemma,
      forms: [lemma],
      senses: [],
      layers: {
        frequency: [{ band: rankToBand(rank), rank, sourceRef: sourceId }]
      },
      quality: 'limited',
      sourceRefs: [sourceId]
    });
  }
  return entries;
}

function parseNawlResearch(csv, sourceId) {
  const rows = String(csv || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const entries = [];
  for (const row of rows) {
    const [rawLemma] = parseCsvRecord(row);
    const lemma = normalizeLemma(rawLemma);
    if (!lemma) throw new Error(`NAWL 快照存在无法解析的词条：${row}`);
    entries.push({
      lemma,
      // The research export's trailing comma fields are observed variants, not
      // an audited inflection table. Treating them as default forms lets
      // malformed values such as "acidics" inflate coverage. The reviewed
      // inflection policy below is the only automatic form expansion.
      forms: [lemma],
      senses: [],
      layers: {
        academic: [{ membership: 'nawl-1.2', sourceRef: sourceId }]
      },
      quality: 'limited',
      sourceRefs: [sourceId]
    });
  }
  return entries;
}

function normalizeCefrPos(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function parseCefrVocabularyProfile(csv, sourceId) {
  const rows = String(csv || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = parseCsvRecord(rows.shift() || '').map(value => value.trim());
  const expectedHeader = ['headword', 'pos', 'CEFR', 'CoreInventory 1', 'CoreInventory 2', 'Threshold'];
  if (header.length !== expectedHeader.length || header.some((value, index) => value !== expectedHeader[index])) {
    throw new Error('CEFR-J 快照格式不符合 Vocabulary Profile 1.5 CSV');
  }

  const entries = [];
  for (const row of rows) {
    const columns = parseCsvRecord(row);
    if (columns.length !== header.length) {
      throw new Error(`CEFR-J 快照存在列数不匹配的词条：${row}`);
    }
    const [rawHeadword, rawPos, rawLevel] = columns;
    const lemma = normalizeLemma(rawHeadword);
    const pos = normalizeCefrPos(rawPos);
    const level = String(rawLevel || '').trim().toUpperCase();
    if (!lemma || !CEFRJ_POS.has(pos) || !CEFRJ_LEVELS.has(level)) {
      throw new Error(`CEFR-J 快照存在无法解析的词条：${row}`);
    }
    // The current core intentionally stores only normalized single-token
    // lemmas. We neither split slash aliases nor create phrase entries from a
    // CEFR reference row, so source records can never inflate coverage.
    if (!/^[a-z]+$/.test(lemma)) continue;
    entries.push({
      lemma,
      forms: [lemma],
      senses: [],
      layers: {
        cefr: [{ level, pos, sourceRef: sourceId }]
      },
      quality: 'limited',
      sourceRefs: [sourceId]
    });
  }
  return entries;
}

function auditedEcdictRecordLemmas(seed, sourceId) {
  const lemmas = new Set();
  for (const entry of seed?.entries || []) {
    if (entry?.quality !== 'high') continue;
    for (const sense of entry?.senses || []) {
      if (!Array.isArray(sense?.sourceRefs) || !sense.sourceRefs.includes(sourceId)) continue;
      const match = /^ecdict\.csv:([a-z]+)(?:;|$)/i.exec(String(sense?.sourceRecord || '').trim());
      if (!match) {
        throw new Error(`审核词条 ${entry?.lemma || '未知'} 缺少可验证的 ECDICT sourceRecord`);
      }
      const citedLemma = normalizeLemma(match[1]);
      if (citedLemma !== normalizeLemma(entry?.lemma)) {
        throw new Error(`审核词条 ${entry?.lemma || '未知'} 的 ECDICT sourceRecord 与 lemma 不一致`);
      }
      lemmas.add(citedLemma);
    }
  }
  return lemmas;
}

async function verifyAuditedEcdictRecords({ snapshotPath, requiredLemmas }) {
  if (!requiredLemmas.size) return;
  const found = new Set();
  const stream = createReadStream(snapshotPath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    const separator = line.indexOf(',');
    if (separator < 1) continue;
    const headword = normalizeLemma(line.slice(0, separator));
    if (!requiredLemmas.has(headword)) continue;
    found.add(headword);
    if (found.size === requiredLemmas.size) {
      stream.destroy();
      break;
    }
  }

  const missing = [...requiredLemmas].filter((lemma) => !found.has(lemma));
  if (missing.length) {
    throw new Error(`ECDICT 快照缺少审核词条引用的记录：${missing.join(', ')}`);
  }
}

function mergeLayerValues(left = {}, right = {}) {
  const layers = {};
  for (const layerName of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const values = [...(Array.isArray(left[layerName]) ? left[layerName] : [left[layerName]].filter(Boolean)),
      ...(Array.isArray(right[layerName]) ? right[layerName] : [right[layerName]].filter(Boolean))];
    const seen = new Set();
    layers[layerName] = values.filter((value) => {
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return layers;
}

function mergeGeneratedEntry(current, incoming) {
  if (!current) return {
    ...incoming,
    forms: uniqueValues(incoming.forms || []),
    sourceRefs: uniqueValues(incoming.sourceRefs || [])
  };
  return {
    ...current,
    ...incoming,
    forms: uniqueValues([...(current.forms || []), ...(incoming.forms || [])]),
    layers: mergeLayerValues(current.layers, incoming.layers),
    sourceRefs: uniqueValues([...(current.sourceRefs || []), ...(incoming.sourceRefs || [])])
  };
}

function resolveManifestSnapshot(sourceDir, source) {
  const root = resolve(sourceDir);
  const snapshotPath = resolve(root, source.snapshotPath || '');
  if (!isInside(root, snapshotPath)) {
    throw new Error(`来源 ${source.id} 的 snapshotPath 超出来源目录`);
  }
  return snapshotPath;
}

/**
 * Builds the conservative core used for coverage calculations: every NGSL and
 * NAWL record is retained as a limited entry, then the small human-reviewed
 * seed overlays high-confidence Chinese learning senses. No legacy app JSON is
 * read at any point in this path.
 */
export async function buildCoreLexiconFromSnapshots({
  manifest,
  seed,
  sourceDir,
  examFocusLemmas = [],
  generatedAt
}) {
  await verifySourceSnapshots({ manifest, sourceDir });
  const ngslSource = manifest.sources.find(source => source.id === 'ngsl-1.2-stats' && source.status === 'active-core');
  const nawlSource = manifest.sources.find(source => source.id === 'nawl-1.2-research' && source.status === 'active-core');
  const ecdictSource = manifest.sources.find(source => source.id === ECDICT_SOURCE_ID && source.status === 'active-core');
  const wordfreqSource = manifest.sources.find(source => source.id === WORDFREQ_SOURCE_ID && source.status === 'active-core');
  const activeCefrSources = manifest.sources.filter(source => source.status === 'active-core' && source.purpose === 'cefr');
  const cefrSource = activeCefrSources.find(source => source.id === CEFRJ_SOURCE_ID);
  if (!ngslSource || !nawlSource) {
    throw new Error('生成核心词库需要已固定的 NGSL 1.2 与 NAWL 1.2 快照');
  }
  if (activeCefrSources.length > (cefrSource ? 1 : 0)) {
    throw new Error('当前构建器仅支持已固定的 CEFR-J Vocabulary Profile 1.5 来源');
  }
  if (!Array.isArray(seed?.entries)) throw new Error('词库审核种子缺少 entries');
  const requiredEcdictRecords = auditedEcdictRecordLemmas(seed, ECDICT_SOURCE_ID);
  if (requiredEcdictRecords.size && !ecdictSource) {
    throw new Error('审核词条引用了 ECDICT，但 ECDICT 快照未激活');
  }

  const [ngslCsv, nawlCsv, cefrCsv, ecdictCsv, wordfreqBytes] = await Promise.all([
    readFile(resolveManifestSnapshot(sourceDir, ngslSource), 'utf8'),
    readFile(resolveManifestSnapshot(sourceDir, nawlSource), 'utf8'),
    cefrSource ? readFile(resolveManifestSnapshot(sourceDir, cefrSource), 'utf8') : Promise.resolve(null),
    ecdictSource ? readFile(resolveManifestSnapshot(sourceDir, ecdictSource), 'utf8') : Promise.resolve(null),
    wordfreqSource ? readFile(resolveManifestSnapshot(sourceDir, wordfreqSource)) : Promise.resolve(null)
  ]);
  if (ecdictSource) {
    await verifyAuditedEcdictRecords({
      snapshotPath: resolveManifestSnapshot(sourceDir, ecdictSource),
      requiredLemmas: requiredEcdictRecords
    });
  }
  const byLemma = new Map();
  const wordfreqEntries = wordfreqSource && wordfreqBytes
    ? buildWordfreqCandidateEntries({
      frequencies: decodeWordfreqSnapshot(wordfreqBytes),
      sourceId: wordfreqSource.id
    })
    : [];
  for (const entry of [
    ...parseNgslStatistics(ngslCsv, ngslSource.id),
    ...parseNawlResearch(nawlCsv, nawlSource.id),
    ...wordfreqEntries
  ]) {
    byLemma.set(entry.lemma, mergeGeneratedEntry(byLemma.get(entry.lemma), entry));
  }
  if (cefrSource && cefrCsv !== null) {
    for (const entry of parseCefrVocabularyProfile(cefrCsv, cefrSource.id)) {
      if (!byLemma.has(entry.lemma)) continue;
      byLemma.set(entry.lemma, mergeGeneratedEntry(byLemma.get(entry.lemma), entry));
    }
  }
  if (ecdictSource && ecdictCsv !== null) {
    const candidateLemmas = new Set([
      ...byLemma.keys(),
      ...(Array.isArray(examFocusLemmas) ? examFocusLemmas : [])
        .map(normalizeLemma)
        .filter((lemma) => SCREENED_LEMMA.test(lemma))
    ]);
    for (const entry of buildScreenedEcdictEntries({
      csv: ecdictCsv,
      candidateLemmas,
      sourceId: ecdictSource.id
    })) {
      byLemma.set(entry.lemma, mergeGeneratedEntry(byLemma.get(entry.lemma), entry));
    }
  }
  for (const entry of seed.entries) {
    const lemma = normalizeLemma(entry?.lemma);
    if (!lemma) throw new Error('审核词条缺少 lemma');
    byLemma.set(lemma, mergeGeneratedEntry(byLemma.get(lemma), { ...entry, lemma }));
  }

  return buildCoreLexicon({
    manifest,
    entries: [...byLemma.values()].map(addConservativeInflections),
    generatedAt
  });
}

export async function buildLexiconFile({ manifestPath, entriesPath, outputPath, sourceDir, generatedAt }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const seed = JSON.parse(await readFile(entriesPath, 'utf8'));
  const buildTime = generatedAt || manifest.generatedAt;

  if (typeof buildTime !== 'string' || !buildTime) {
    throw new Error('词库构建需要固定 generatedAt，以保证输出可复现');
  }

  const artifact = await buildLexiconArtifact({
    manifest,
    entries: seed.entries,
    sourceDir,
    generatedAt: buildTime
  });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

export async function buildGeneratedLexiconFile({
  manifestPath,
  entriesPath,
  outputPath,
  sourceDir,
  examFocusPath,
  generatedAt
}) {
  const [manifestText, seedText, examFocusText] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(entriesPath, 'utf8'),
    examFocusPath ? readFile(examFocusPath, 'utf8') : Promise.resolve(null)
  ]);
  const manifest = JSON.parse(manifestText);
  const seed = JSON.parse(seedText);
  const examFocusLemmas = examFocusText === null
    ? []
    : extractExamFocusCandidateLemmas(JSON.parse(examFocusText));
  const buildTime = generatedAt || manifest.generatedAt;
  if (typeof buildTime !== 'string' || !buildTime) {
    throw new Error('词库构建需要固定 generatedAt，以保证输出可复现');
  }
  const artifact = await buildCoreLexiconFromSnapshots({
    manifest,
    seed,
    sourceDir,
    examFocusLemmas,
    generatedAt: buildTime
  });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

async function runCli() {
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const manifestPath = resolve(projectRoot, 'public', 'data', 'lexicon-manifest.json');
  assertLexiconReleaseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const artifact = await buildGeneratedLexiconFile({
    manifestPath,
    entriesPath: resolve(projectRoot, 'public', 'data', 'lexicon-core.seed.json'),
    outputPath: resolve(projectRoot, 'public', 'data', 'lexicon-core.json'),
    sourceDir: resolve(projectRoot, 'data', 'lexicon-sources'),
    examFocusPath: resolve(projectRoot, 'public', 'data', 'exam-focus.json')
  });
  process.stdout.write(`已构建 ${artifact.entryCount} 条可追溯核心词条（${artifact.lexiconVersion}）。\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
