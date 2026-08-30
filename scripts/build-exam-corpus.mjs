import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertExamCorpusIndexManifest,
  assertExamCorpusTrackArtifact,
  calculateTrackPriorities,
  ExamCorpusTracks
} from '../src/exam-corpus.mjs';

const SOURCE_ID = 'lazynote-exam-corpus';
const SOURCE_URL = 'https://english-exam.lazynote.cn/exam-words/';
const TERMS_URL = 'https://english-exam.lazynote.cn/terms/';
const USAGE = 'non-commercial-personal-learning';
const WORD_PATTERN = /^[a-z]+(?:[-'][a-z]+)*$/;
const TARGET_FORM_PATTERN = /^(?:[a-z]+(?:[-'][a-z]+)*'?|'[a-z]+)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SOURCE_KINDS = new Set(['passage', 'question', 'listening', 'other']);
const EXAM_TRACKS = new Set(['cet4', 'cet6', 'kaoyan1', 'kaoyan2']);
const SYLLABUS_STATUSES = new Set(['in_syllabus', 'over_syllabus', 'uncovered', 'unknown']);
const CORPUS_TRACK_SET = new Set(ExamCorpusTracks);
const CJK = /[\u3400-\u9fff]/u;

const text = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeWord = value => text(value).toLocaleLowerCase('en-US');
const normalizeTargetForm = value => {
  let form = normalizeWord(value);
  if (/^'[a-z]+$/.test(form)) return form;
  if (/^'[a-z][a-z'-]*'$/.test(form)) form = form.slice(1, -1);
  return form.replace(/^[^a-z]+|[^a-z']+$/g, '');
};
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const containsTarget = (sentence, target) => new RegExp(`(?<![A-Za-z])${escapeRegExp(target)}(?![A-Za-z])`, 'iu').test(sentence);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const finiteCount = value => Number.isSafeInteger(value) && value >= 0;

export function deriveStableExampleId(value = {}) {
  const identity = [
    text(value.statsTrack).toLocaleLowerCase('en-US'),
    text(value.examTrack).toLocaleLowerCase('en-US'),
    normalizeWord(value.lemma),
    text(value.paperId).toLocaleLowerCase('en-US'),
    text(value.questionType).toLocaleLowerCase('en-US'),
    text(value.positionLabel).toLocaleLowerCase('en-US'),
    text(value.sentenceEn).toLocaleLowerCase('en-US')
  ].join('|');
  return digest(Buffer.from(identity, 'utf8')).slice(0, 24);
}

function stableCompare(left, right) {
  return (Number(right.year) || 0) - (Number(left.year) || 0)
    || text(left.paperId).localeCompare(text(right.paperId))
    || text(left.id).localeCompare(text(right.id));
}

function parseYearCount(range) {
  const match = String(range || '').match(/(\d{4})\s*-\s*(\d{4})/);
  if (!match) return 0;
  return Math.max(0, Number(match[2]) - Number(match[1]) + 1);
}

function shardBucket(lemma) {
  const initial = normalizeWord(lemma)[0];
  return /[a-z]/.test(initial || '') ? initial : 'other';
}

function expectedExampleTrack(statsTrack, examTrack) {
  if (statsTrack === 'cet4') return examTrack === 'cet4';
  if (statsTrack === 'cet6') return examTrack === 'cet6';
  return statsTrack === 'kaoyan-general' && ['kaoyan1', 'kaoyan2'].includes(examTrack);
}

function normalizeCounts(value) {
  const counts = {};
  for (const field of ['sentenceTotal', 'passage', 'questionStem', 'other', 'papers', 'years']) {
    const count = Number(value?.[field]);
    if (!finiteCount(count)) return null;
    counts[field] = count;
  }
  if (counts.sentenceTotal !== counts.passage + counts.questionStem + counts.other) return null;
  return counts;
}

export function normalizeExamWordRecord(value = {}) {
  const lemma = normalizeWord(value.lemma);
  const track = text(value.track).toLocaleLowerCase('en-US');
  const counts = normalizeCounts(value.counts);
  const rank = Number(value.rank);
  const syllabusStatus = text(value.syllabusStatus).toLocaleLowerCase('en-US');
  const cefrReported = text(value.cefrReported).toUpperCase();
  if (!WORD_PATTERN.test(lemma) || !CORPUS_TRACK_SET.has(track) || !counts) return null;
  if (!Number.isSafeInteger(rank) || rank <= 0 || !SYLLABUS_STATUSES.has(syllabusStatus)) return null;
  if (counts.sentenceTotal === 0 && syllabusStatus !== 'uncovered') return null;
  if (counts.sentenceTotal > 0 && syllabusStatus === 'uncovered') return null;
  return {
    lemma,
    track,
    rank,
    cefrReported: /^(?:A1|A2|B1|B2|C1|C2)$/.test(cefrReported) ? cefrReported : null,
    syllabusStatus,
    counts,
    questionTypeCounts: value.questionTypeCounts && typeof value.questionTypeCounts === 'object'
      ? Object.fromEntries(Object.entries(value.questionTypeCounts)
        .filter(([, count]) => finiteCount(Number(count)))
        .map(([key, count]) => [key, Number(count)]))
      : {},
    sourceUrl: text(value.sourceUrl)
  };
}

export function normalizeExamExample(value = {}, { enforceLength = true } = {}) {
  const sourceRecordId = text(value.sourceRecordId || value.id);
  const lemma = normalizeWord(value.lemma);
  const statsTrack = text(value.statsTrack).toLocaleLowerCase('en-US');
  const examTrack = text(value.examTrack).toLocaleLowerCase('en-US');
  const targetForm = normalizeTargetForm(value.targetForm || lemma);
  const sentenceEn = text(value.sentenceEn);
  const translationZh = text(value.translationZh);
  const sourceKind = text(value.sourceKind).toLocaleLowerCase('en-US');
  const year = Number(value.year);
  if (!sourceRecordId || !WORD_PATTERN.test(lemma) || !TARGET_FORM_PATTERN.test(targetForm)) return null;
  if (!CORPUS_TRACK_SET.has(statsTrack) || !EXAM_TRACKS.has(examTrack) || !expectedExampleTrack(statsTrack, examTrack)) return null;
  if (!SOURCE_KINDS.has(sourceKind) || !Number.isSafeInteger(year) || year < 1900 || year > 2100) return null;
  if (!containsTarget(sentenceEn, targetForm) || !CJK.test(translationZh)) return null;
  const englishWords = sentenceEn.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  if (enforceLength && (englishWords.length < 4 || englishWords.length > 80)) return null;
  if (/<[^>]+>/.test(sentenceEn) || /<[^>]+>/.test(translationZh)) return null;
  return {
    id: deriveStableExampleId({ ...value, lemma, statsTrack, examTrack, sentenceEn }),
    sourceRecordId,
    lemma,
    statsTrack,
    examTrack,
    targetForm,
    sentenceEn,
    translationZh,
    year,
    paperId: text(value.paperId),
    paperLabel: text(value.paperLabel),
    questionType: text(value.questionType),
    sourceKind,
    positionLabel: text(value.positionLabel),
    cefrReported: /^(?:A1|A2|B1|B2|C1|C2)$/i.test(text(value.cefrReported))
      ? text(value.cefrReported).toUpperCase()
      : null,
    sourceUrl: text(value.sourceUrl)
  };
}

export function selectRepresentativeExamples(rows = [], limit = 6) {
  const normalized = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = normalizeExamExample(row);
    if (!value) continue;
    const key = value.sentenceEn.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  const maximum = Math.max(0, Math.min(6, Number.parseInt(limit, 10) || 0));
  if (!maximum) return [];
  const byKind = kind => normalized.filter(row => row.sourceKind === kind).sort(stableCompare);
  const selected = [];
  const selectedIds = new Set();
  const take = (rowsToTake, count) => {
    for (const row of rowsToTake) {
      if (selected.length >= maximum || count <= 0) break;
      if (selectedIds.has(row.id)) continue;
      selected.push(row);
      selectedIds.add(row.id);
      count -= 1;
    }
  };

  take(byKind('passage'), Math.min(4, maximum));
  take(byKind('question'), Math.min(1, maximum - selected.length));
  take([...byKind('listening'), ...byKind('other')], Math.min(1, maximum - selected.length));
  // Spare slots may be filled by additional article sentences only. Keeping
  // question stems and other material capped prevents vocabulary study from
  // turning into a collection of test prompts.
  take(byKind('passage'), maximum - selected.length);
  return selected.sort((left, right) => {
    const kindOrder = { passage: 0, question: 1, listening: 2, other: 3 };
    return kindOrder[left.sourceKind] - kindOrder[right.sourceKind] || stableCompare(left, right);
  });
}

function assertSourceManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (!text(manifest?.datasetVersion)) errors.push('datasetVersion 缺失');
  if (manifest?.source?.url !== SOURCE_URL) errors.push('source.url 不匹配');
  if (manifest?.source?.termsUrl !== TERMS_URL) errors.push('source.termsUrl 必须指向 /terms/');
  if (manifest?.usage !== USAGE) errors.push('usage 不匹配');
  for (const track of ExamCorpusTracks) {
    const meta = manifest?.coverage?.tracks?.[track];
    if (!meta || !finiteCount(Number(meta.papers)) || !finiteCount(Number(meta.wordCount))) {
      errors.push(`coverage.tracks.${track} 无效`);
    }
  }
  for (const file of ['words.jsonl.gz', 'examples.jsonl.gz']) {
    const meta = manifest?.files?.[file];
    if (!meta || !finiteCount(Number(meta.records)) || !SHA256_PATTERN.test(text(meta.sha256))) {
      errors.push(`files.${file} 无效`);
    }
  }
  if (errors.length) throw new Error(`真题语料来源清单无效：${errors.join('；')}`);
  return manifest;
}

export function buildExamCorpusArtifacts({ manifest, manifestSha256, wordRecords = [], exampleRecords = [] } = {}) {
  assertSourceManifest(manifest);
  if (!SHA256_PATTERN.test(text(manifestSha256))) throw new Error('来源 manifest SHA-256 无效');
  const words = [];
  const wordKeys = new Set();
  for (const raw of wordRecords) {
    const record = normalizeExamWordRecord(raw);
    if (!record) throw new Error(`真题词频记录无效：${text(raw?.track)}:${text(raw?.lemma)}`);
    const key = `${record.track}:${record.lemma}`;
    if (wordKeys.has(key)) throw new Error(`真题词频记录重复：${key}`);
    wordKeys.add(key);
    words.push(record);
  }
  for (const track of ExamCorpusTracks) {
    const actual = words.filter(record => record.track === track).length;
    if (actual !== Number(manifest.coverage.tracks[track].wordCount)) {
      throw new Error(`${track} 词条数量不匹配：期望 ${manifest.coverage.tracks[track].wordCount}，实际 ${actual}`);
    }
  }

  const examplesByWord = new Map();
  const sourceIds = new Map();
  const contentKeys = new Set();
  const exampleAudit = {
    inputRecords: exampleRecords.length,
    acceptedRecords: 0,
    filteredShort: 0,
    filteredLong: 0,
    duplicateContent: 0,
    sourceIdCollisions: 0,
    selectedRecords: 0
  };
  for (const raw of exampleRecords) {
    const example = normalizeExamExample(raw, { enforceLength: false });
    if (!example) throw new Error(`真题例句记录无效：${text(raw?.id) || 'unknown'}`);
    const englishWordCount = example.sentenceEn.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0;
    if (englishWordCount < 4) {
      exampleAudit.filteredShort += 1;
      continue;
    }
    if (englishWordCount > 80) {
      exampleAudit.filteredLong += 1;
      continue;
    }
    const priorStableId = sourceIds.get(example.sourceRecordId);
    if (priorStableId && priorStableId !== example.id) exampleAudit.sourceIdCollisions += 1;
    else if (!priorStableId) sourceIds.set(example.sourceRecordId, example.id);
    const contentKey = [
      example.statsTrack,
      example.examTrack,
      example.lemma,
      example.paperId,
      example.sentenceEn.toLocaleLowerCase('en-US')
    ].join('|');
    if (contentKeys.has(contentKey)) {
      exampleAudit.duplicateContent += 1;
      continue;
    }
    contentKeys.add(contentKey);
    exampleAudit.acceptedRecords += 1;
    const key = `${example.statsTrack}:${example.lemma}`;
    const rows = examplesByWord.get(key) || [];
    rows.push(example);
    examplesByWord.set(key, rows);
  }

  const selectedExamples = new Map();
  for (const [key, rows] of examplesByWord) selectedExamples.set(key, selectRepresentativeExamples(rows));
  exampleAudit.selectedRecords = [...selectedExamples.values()].reduce((total, rows) => total + rows.length, 0);
  const shards = {};
  for (const [key, rows] of selectedExamples) {
    if (!rows.length) continue;
    const [track, lemma] = key.split(':');
    const bucket = shardBucket(lemma);
    const shardKey = `${track}-${bucket}`;
    const shard = shards[shardKey] ||= {
      schemaVersion: 1,
      corpusVersion: `${manifest.datasetVersion}.app.1`,
      track,
      bucket,
      items: {}
    };
    shard.items[lemma] = rows;
  }

  const wordOutput = Object.fromEntries(ExamCorpusTracks.map(track => [track, {}]));
  const trackOutput = {};
  for (const track of ExamCorpusTracks) {
    const trackWords = words.filter(record => record.track === track);
    const priorities = calculateTrackPriorities(trackWords);
    for (const record of trackWords.sort((left, right) => left.lemma.localeCompare(right.lemma))) {
      const priority = priorities.get(record.lemma);
      const shardKey = `${track}-${shardBucket(record.lemma)}`;
      wordOutput[track][record.lemma] = {
        ...priority,
        rank: record.rank,
        syllabusStatus: record.syllabusStatus,
        cefrReported: record.cefrReported,
        counts: record.counts,
        questionTypeCounts: record.questionTypeCounts,
        sourceUrl: record.sourceUrl,
        ...(shards[shardKey]?.items?.[record.lemma]?.length ? { exampleShard: shardKey } : {})
      };
    }
    const sourceTrack = manifest.coverage.tracks[track];
    trackOutput[track] = {
      wordCount: trackWords.length,
      paperCount: Number(sourceTrack.papers),
      yearCount: parseYearCount(sourceTrack.years),
      yearRange: text(sourceTrack.years)
    };
  }

  const corpusVersion = `${manifest.datasetVersion}.app.1`;
  const trackArtifacts = {};
  for (const track of ExamCorpusTracks) {
    const artifact = {
      schemaVersion: 1,
      corpusVersion,
      track,
      words: wordOutput[track]
    };
    assertExamCorpusTrackArtifact(artifact, {
      corpusVersion,
      track,
      wordCount: trackOutput[track].wordCount
    });
    const bytes = Buffer.from(`${JSON.stringify(artifact)}\n`, 'utf8');
    trackArtifacts[track] = artifact;
    trackOutput[track] = {
      ...trackOutput[track],
      path: `exam-corpus-tracks/${track}.json`,
      sha256: digest(bytes),
      byteSize: bytes.byteLength
    };
  }

  const indexArtifact = {
    schemaVersion: 2,
    corpusVersion,
    generatedAt: new Date(manifest.generatedAt).toISOString(),
    source: {
      id: SOURCE_ID,
      url: manifest.source.url,
      termsUrl: manifest.source.termsUrl,
      usage: manifest.usage,
      sourceVersion: manifest.datasetVersion,
      manifestSha256: text(manifestSha256).toLocaleLowerCase('en-US')
    },
    scoring: {
      passageWeight: 1,
      questionStemWeight: 0.2,
      components: { weightedFrequency: 0.65, paperCoverage: 0.2, yearCoverage: 0.15 }
    },
    tracks: trackOutput
  };
  assertExamCorpusIndexManifest(indexArtifact);

  const shardMeta = {};
  for (const [key, shard] of Object.entries(shards)) {
    shardMeta[key] = {
      path: `${key}.json`,
      recordCount: Object.values(shard.items).reduce((total, rows) => total + rows.length, 0)
    };
  }
  const exampleManifest = {
    schemaVersion: 1,
    corpusVersion: indexArtifact.corpusVersion,
    source: indexArtifact.source,
    inputRecordCount: exampleRecords.length,
    audit: exampleAudit,
    selectedRecordCount: Object.values(shardMeta).reduce((total, row) => total + row.recordCount, 0),
    shards: shardMeta
  };
  return { indexArtifact, trackArtifacts, exampleManifest, shards, exampleAudit };
}

async function readGzipJsonLines(path) {
  const rows = [];
  const input = createReadStream(path).pipe(createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function buildExamCorpusFromDirectory({ sourceDir, outputDir } = {}) {
  const manifestPath = resolve(sourceDir, 'manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assertSourceManifest(manifest);
  for (const file of ['words.jsonl.gz', 'examples.jsonl.gz']) {
    const bytes = await readFile(resolve(sourceDir, file));
    if (digest(bytes) !== manifest.files[file].sha256) throw new Error(`${file} SHA-256 不匹配`);
  }
  const [wordRecords, exampleRecords] = await Promise.all([
    readGzipJsonLines(resolve(sourceDir, 'words.jsonl.gz')),
    readGzipJsonLines(resolve(sourceDir, 'examples.jsonl.gz'))
  ]);
  if (wordRecords.length !== manifest.files['words.jsonl.gz'].records) throw new Error('words.jsonl.gz 记录数不匹配');
  if (exampleRecords.length !== manifest.files['examples.jsonl.gz'].records) throw new Error('examples.jsonl.gz 记录数不匹配');
  const built = buildExamCorpusArtifacts({
    manifest,
    manifestSha256: digest(manifestBytes),
    wordRecords,
    exampleRecords
  });
  const exampleDir = resolve(outputDir, 'exam-examples');
  const trackDir = resolve(outputDir, 'exam-corpus-tracks');
  await mkdir(exampleDir, { recursive: true });
  await mkdir(trackDir, { recursive: true });
  for (const [track, artifact] of Object.entries(built.trackArtifacts)) {
    await writeJson(resolve(trackDir, `${track}.json`), artifact);
  }
  await writeJson(resolve(outputDir, 'exam-corpus-index.json'), built.indexArtifact);
  for (const [key, shard] of Object.entries(built.shards)) {
    const bytes = Buffer.from(`${JSON.stringify(shard)}\n`, 'utf8');
    built.exampleManifest.shards[key].sha256 = digest(bytes);
    built.exampleManifest.shards[key].byteSize = bytes.byteLength;
    await writeFile(resolve(exampleDir, `${key}.json`), bytes);
  }
  await writeJson(resolve(exampleDir, 'manifest.json'), built.exampleManifest);
  return built;
}

async function runCli() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const sourceDir = resolve(process.argv[2] || resolve(root, 'data', 'sources', 'lazynote-exam-corpus-v1'));
  const outputDir = resolve(root, 'public', 'data');
  const built = await buildExamCorpusFromDirectory({ sourceDir, outputDir });
  process.stdout.write(`已构建国内真题权重层：${Object.values(built.indexArtifact.tracks).reduce((sum, track) => sum + track.wordCount, 0)} 个轨道词条，${built.exampleManifest.selectedRecordCount} 条代表例句。\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
