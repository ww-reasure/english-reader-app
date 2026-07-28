import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl');

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

export const OEWN_ARTIFACT_SCHEMA_VERSION = 1;
export const OEWN_SOURCE_ID = 'oewn-2025-json';
export const DEFAULT_OEWN_MANIFEST_PATH = resolve(projectRoot, 'public', 'data', 'oewn-artifact-manifest.json');
export const DEFAULT_CORE_ARTIFACT_PATH = resolve(projectRoot, 'public', 'data', 'lexicon-core.json');
export const DEFAULT_SOURCE_DIRECTORY = resolve(projectRoot, 'data', 'lexicon-sources');
export const DEFAULT_OEWN_ARTIFACT_PATH = resolve(projectRoot, 'public', 'data', 'oewn-core-2025.json');

const POS_BY_OEWN_CODE = Object.freeze({
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  s: 'adjective',
  r: 'adverb'
});

function isAbsoluteWebUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isInside(root, target) {
  const relativePath = relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeLemma(value) {
  return String(value || '').trim().toLowerCase();
}

function readDefinition(synset) {
  const definitions = Array.isArray(synset?.definition) ? synset.definition : [synset?.definition];
  return definitions
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function sourceSummary(source) {
  return {
    id: source.id,
    url: source.url,
    version: source.version,
    license: source.license,
    licenseUrl: source.licenseUrl,
    retrievedAt: source.retrievedAt,
    sha256: source.sha256.toLowerCase(),
    byteSize: source.byteSize,
    attribution: source.attribution
  };
}

/**
 * Keeps the OEWN source contract independent from the active Chinese/coverage
 * lexicon. This artifact is English sense structure only, and cannot become a
 * difficulty or Chinese-gloss input merely by changing a JSON flag.
 */
export function assertOewnArtifactSource(source) {
  const requiredStrings = [
    'id', 'title', 'url', 'version', 'license', 'licenseUrl', 'retrievedAt',
    'sha256', 'purpose', 'attribution', 'snapshotPath', 'status'
  ];
  const errors = [];

  if (!source || typeof source !== 'object') errors.push('OEWN 来源必须是对象');
  for (const field of requiredStrings) {
    if (typeof source?.[field] !== 'string' || !source[field].trim()) {
      errors.push(`OEWN 来源缺少 ${field}`);
    }
  }
  if (source?.id !== OEWN_SOURCE_ID) errors.push(`OEWN 来源 id 必须为 ${OEWN_SOURCE_ID}`);
  if (source?.purpose !== 'english-definition-structure') {
    errors.push('OEWN 来源只能用于英文义项结构');
  }
  if (source?.status !== 'derived-core-definitions-only') {
    errors.push('OEWN 来源必须限制为派生核心英文定义');
  }
  if (!isAbsoluteWebUrl(source?.url)) errors.push('OEWN 来源 url 必须是绝对 HTTP(S) URL');
  if (!isAbsoluteWebUrl(source?.licenseUrl)) errors.push('OEWN 来源 licenseUrl 必须是绝对 HTTP(S) URL');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(source?.retrievedAt || ''))) {
    errors.push('OEWN 来源 retrievedAt 必须为 YYYY-MM-DD');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(source?.sha256 || ''))) errors.push('OEWN 来源 sha256 无效');
  if (!Number.isSafeInteger(source?.byteSize) || source.byteSize <= 0) errors.push('OEWN 来源 byteSize 无效');
  if (!/\.zip$/i.test(String(source?.snapshotPath || ''))) errors.push('OEWN 来源必须是固定 ZIP 快照');

  if (errors.length) throw new Error(`OEWN 来源清单无效：${errors.join('；')}`);
  return source;
}

function assertSourceBytes(source, sourceBytes) {
  const bytes = Buffer.from(sourceBytes || []);
  const actual = digest(bytes);
  if (actual !== source.sha256.toLowerCase()) {
    throw new Error(`OEWN 来源校验和不匹配：期望 ${source.sha256.toLowerCase()}，实际 ${actual}`);
  }
  if (bytes.byteLength !== source.byteSize) {
    throw new Error(`OEWN 来源字节数不匹配：期望 ${source.byteSize}，实际 ${bytes.byteLength}`);
  }
  return bytes;
}

function collectActiveCoreLemmas(coreArtifact) {
  if (!coreArtifact || typeof coreArtifact !== 'object' || !Array.isArray(coreArtifact.entries)) {
    throw new Error('OEWN 构建需要有效的 active-core 词库产物');
  }
  if (typeof coreArtifact.lexiconVersion !== 'string' || !coreArtifact.lexiconVersion.trim()) {
    throw new Error('OEWN 构建需要 active-core 词库版本');
  }

  return new Set(coreArtifact.entries
    .map((entry) => normalizeLemma(entry?.lemma))
    .filter((lemma) => /^[a-z]+$/.test(lemma)));
}

function indexSynsets(synsetMaps = []) {
  const definitions = new Map();
  for (const synsetMap of synsetMaps) {
    if (!synsetMap || typeof synsetMap !== 'object' || Array.isArray(synsetMap)) continue;
    for (const [synsetId, synset] of Object.entries(synsetMap)) {
      const definitionEn = readDefinition(synset);
      if (!definitionEn || definitions.has(synsetId)) continue;
      definitions.set(synsetId, definitionEn);
    }
  }
  return definitions;
}

function sortedSenses(senses) {
  return [...senses].sort((left, right) => {
    const leftKey = `${left.synsetId}\u0000${left.id}`;
    const rightKey = `${right.synsetId}\u0000${right.id}`;
    return leftKey.localeCompare(rightKey);
  });
}

/**
 * Pure derivation step. `entryMaps` and `synsetMaps` use OEWN's released JSON
 * files exactly: an entries-*.json object maps lemma -> POS -> sense[], and
 * each synset file maps synset id -> { definition: string[] }.
 */
export function buildOewnCoreArtifact({
  source,
  sourceBytes,
  coreArtifact,
  entryMaps,
  synsetMaps,
  generatedAt
} = {}) {
  assertOewnArtifactSource(source);
  assertSourceBytes(source, sourceBytes);
  const activeLemmas = collectActiveCoreLemmas(coreArtifact);
  const definitionBySynset = indexSynsets(synsetMaps);
  const groups = new Map();

  for (const entryMap of entryMaps || []) {
    if (!entryMap || typeof entryMap !== 'object' || Array.isArray(entryMap)) continue;
    for (const [rawLemma, posMap] of Object.entries(entryMap)) {
      const lemma = normalizeLemma(rawLemma);
      // Exact lemma matching is intentional. Core inflections such as
      // "recorded" must never make a non-core OEWN lexical entry eligible.
      if (!activeLemmas.has(lemma) || !/^[a-z]+$/.test(lemma)) continue;
      if (!posMap || typeof posMap !== 'object' || Array.isArray(posMap)) continue;

      for (const [oewnPos, lexicalEntry] of Object.entries(posMap)) {
        const pos = POS_BY_OEWN_CODE[oewnPos];
        if (!pos) continue;
        const groupKey = `${lemma}\u0000${pos}`;
        const senses = Array.isArray(lexicalEntry?.sense) ? lexicalEntry.sense : [];
        if (!groups.has(groupKey)) groups.set(groupKey, { lemma, pos, senses: new Map() });
        const group = groups.get(groupKey);

        for (const sense of senses) {
          const id = String(sense?.id || '').trim();
          const synsetId = String(sense?.synset || '').trim();
          const definitionEn = definitionBySynset.get(synsetId);
          if (!id || !synsetId || !definitionEn) continue;
          const senseKey = `${id}\u0000${synsetId}`;
          if (!group.senses.has(senseKey)) {
            group.senses.set(senseKey, { id, synsetId, definitionEn });
          }
        }
      }
    }
  }

  const entries = [...groups.values()]
    .map((group) => ({
      lemma: group.lemma,
      pos: group.pos,
      senses: sortedSenses(group.senses.values())
    }))
    .filter((entry) => entry.senses.length > 0)
    .sort((left, right) => `${left.lemma}\u0000${left.pos}`.localeCompare(`${right.lemma}\u0000${right.pos}`));

  return {
    schemaVersion: OEWN_ARTIFACT_SCHEMA_VERSION,
    artifactVersion: 'oewn-core-definitions-v1',
    generatedAt,
    coreLexiconVersion: coreArtifact.lexiconVersion,
    source: sourceSummary(source),
    entryCount: entries.length,
    entries
  };
}

function isEntryFile(fileName) {
  return /^entries-(?:0|[a-z])\.json$/i.test(fileName);
}

function isSynsetFile(fileName) {
  return fileName.endsWith('.json') && !isEntryFile(fileName) && fileName !== 'frames.json';
}

function readZipJsonMaps(archivePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError) {
        rejectPromise(new Error(`无法打开 OEWN ZIP 快照：${openError.message}`));
        return;
      }

      const entryMaps = [];
      const synsetMaps = [];
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch {}
        rejectPromise(error);
      };

      zip.on('error', fail);
      zip.on('entry', (entry) => {
        const kind = isEntryFile(entry.fileName) ? 'entry' : (isSynsetFile(entry.fileName) ? 'synset' : null);
        if (!kind || /\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(new Error(`无法读取 OEWN ZIP 条目 ${entry.fileName}：${streamError.message}`));
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('顶层不是对象');
              }
              (kind === 'entry' ? entryMaps : synsetMaps).push(parsed);
              zip.readEntry();
            } catch (error) {
              fail(new Error(`OEWN ZIP 条目 ${entry.fileName} 不是可用 JSON：${error.message}`));
            }
          });
        });
      });
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolvePromise({ entryMaps, synsetMaps });
      });
      zip.readEntry();
    });
  });
}

export async function buildOewnCoreArtifactFromArchive({
  source,
  archivePath,
  coreArtifact,
  generatedAt
} = {}) {
  assertOewnArtifactSource(source);
  const sourceBytes = await readFile(archivePath);
  assertSourceBytes(source, sourceBytes);
  const { entryMaps, synsetMaps } = await readZipJsonMaps(archivePath);
  if (!entryMaps.length || !synsetMaps.length) {
    throw new Error('OEWN ZIP 缺少 entries 或 synset JSON，不能生成英文义项产物');
  }
  return buildOewnCoreArtifact({
    source,
    sourceBytes,
    coreArtifact,
    entryMaps,
    synsetMaps,
    generatedAt
  });
}

function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? resolve(args[index + 1]) : fallback;
}

async function runCli() {
  const args = process.argv.slice(2);
  const manifestPath = argumentValue(args, '--manifest', DEFAULT_OEWN_MANIFEST_PATH);
  const corePath = argumentValue(args, '--core', DEFAULT_CORE_ARTIFACT_PATH);
  const sourceDir = argumentValue(args, '--source-dir', DEFAULT_SOURCE_DIRECTORY);
  const outputPath = argumentValue(args, '--output', DEFAULT_OEWN_ARTIFACT_PATH);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const source = manifest?.source;
  assertOewnArtifactSource(source);
  const archivePath = resolve(sourceDir, source.snapshotPath);
  if (!isInside(sourceDir, archivePath)) throw new Error('OEWN 来源 snapshotPath 超出来源目录');
  const coreArtifact = JSON.parse(await readFile(corePath, 'utf8'));
  const artifact = await buildOewnCoreArtifactFromArchive({
    source,
    archivePath,
    coreArtifact,
    generatedAt: new Date().toISOString()
  });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, entryCount: artifact.entryCount, coreLexiconVersion: artifact.coreLexiconVersion, source: artifact.source }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
