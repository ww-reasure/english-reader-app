import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertExamFocusArtifact } from '../src/exam-focus.mjs';

const COMMIT = '8814e02b40f69a2a6e016dbde087010304fcedfc';
const GENERATED_AT = '2026-07-27T00:00:00.000Z';
const SOURCE_ID = 'kylebing-english-vocabulary-cet';
const SOURCE_ROOT = `https://raw.githubusercontent.com/KyleBing/english-vocabulary/${COMMIT}`;
const TRACK_SOURCES = Object.freeze({
  cet4: {
    url: `${SOURCE_ROOT}/3%20%E5%9B%9B%E7%BA%A7-%E4%B9%B1%E5%BA%8F.txt`,
    commit: COMMIT,
    sha256: 'b6ef93b392837bfad92467ed6a8b3f22da6caf07fcfe8858c4f9eccb72069835',
    byteSize: 293401,
    rawRecordCount: 7508,
    normalizedWordCount: 4543
  },
  cet6: {
    url: `${SOURCE_ROOT}/4%20%E5%85%AD%E7%BA%A7-%E4%B9%B1%E5%BA%8F.txt`,
    commit: COMMIT,
    sha256: '4a938c26f5732194330c5453a7fe28d65cf3fd7009fcdfb5bea4517b8ce48ddb',
    byteSize: 231996,
    rawRecordCount: 5651,
    normalizedWordCount: 3991
  }
});

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeFocusWord(value) {
  const word = String(value || '').trim().toLocaleLowerCase('en-US');
  return /^[a-z]+(?:[-'][a-z]+)*$/.test(word) ? word : '';
}

export function parseFocusWordlist(text) {
  return [...new Set(String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map(line => normalizeFocusWord(line.split('\t', 1)[0]))
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function buildExamFocusArtifact({ sources = TRACK_SOURCES, payloads, generatedAt = GENERATED_AT } = {}) {
  const tracks = {};
  for (const track of ['cet4', 'cet6']) {
    const bytes = payloads?.[track];
    const source = sources?.[track];
    if (!Buffer.isBuffer(bytes)) throw new TypeError(`缺少 ${track} 词表字节`);
    if (digest(bytes) !== source.sha256) throw new Error(`${track} 词表 SHA-256 不匹配`);
    if (bytes.byteLength !== source.byteSize) throw new Error(`${track} 词表字节数不匹配`);
    const words = parseFocusWordlist(bytes.toString('utf8'));
    if (words.length !== source.normalizedWordCount) throw new Error(`${track} 词表规范化数量不匹配`);
    tracks[track] = words;
  }
  const artifact = {
    schemaVersion: 1,
    focusVersion: '2026.07.27-kylebing-cet.1',
    generatedAt,
    source: {
      id: SOURCE_ID,
      title: 'KyleBing English Vocabulary CET-4/CET-6 public wordlists',
      repositoryUrl: 'https://github.com/KyleBing/english-vocabulary',
      sourceType: 'public-wordlist',
      useBoundary: 'exam-direction-only-not-official-truth',
      attribution: 'Public CET-4/CET-6 wordlists from KyleBing/english-vocabulary, pinned to commit 8814e02b40f69a2a6e016dbde087010304fcedfc. The source does not state an explicit license; this app uses the list under the product owner\'s authorization and never presents it as an official syllabus.',
      tracks: sources
    },
    tracks
  };
  return assertExamFocusArtifact(artifact);
}

export async function fetchPinnedFocusSources({ sources = TRACK_SOURCES, fetchFn = globalThis.fetch } = {}) {
  const payloads = {};
  for (const track of ['cet4', 'cet6']) {
    const response = await fetchFn(sources[track].url);
    if (!response?.ok || typeof response.arrayBuffer !== 'function') {
      throw new Error(`下载 ${track} 公开词表失败（HTTP ${response?.status || '未知'}）`);
    }
    payloads[track] = Buffer.from(await response.arrayBuffer());
  }
  return payloads;
}

async function runCli() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const artifact = buildExamFocusArtifact({ payloads: await fetchPinnedFocusSources() });
  const outputPath = resolve(root, 'public', 'data', 'exam-focus.json');
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(`已构建四、六级重点词表：四级 ${artifact.tracks.cet4.length}，六级 ${artifact.tracks.cet6.length}。\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
