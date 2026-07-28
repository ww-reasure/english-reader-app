/** Download the pinned English UDPipe model and refuse any checksum drift. */
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODEL_URL = 'https://raw.githubusercontent.com/bnosac/udpipe.models.ud/master/models/english-ud-2.1-20180111.udpipe';
export const MODEL_SHA256 = '20432A6F87B1F258927207B8FBD2DC21EBFF9722B381B7A36CEF34C8C9A380DC';
export const MODEL_BYTES = 16368326;
export const OUTPUT_PATH = resolve('public/models/grammar/english-ud-2.1-20180111.udpipe');

export async function fetchPinnedGrammarModel({ fetchImpl = fetch, outputPath = OUTPUT_PATH } = {}) {
  const response = await fetchImpl(MODEL_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`无法下载 UDPipe 英文模型：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (bytes.length !== MODEL_BYTES || digest !== MODEL_SHA256) {
    throw new Error(`UDPipe 英文模型校验失败：收到 ${bytes.length} bytes / ${digest}`);
  }
  const resolved = resolve(outputPath);
  const temporary = `${resolved}.download`;
  await mkdir(dirname(resolved), { recursive: true });
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, resolved);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { outputPath: resolved, bytes: bytes.length, sha256: digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  fetchPinnedGrammarModel().then(result => {
    console.log(`已验证并写入 UDPipe 英文模型：${result.bytes} bytes`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
