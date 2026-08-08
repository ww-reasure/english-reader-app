import { createReadStream, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const MANIFEST_PATH = 'assets/public/release-manifest.json';
const PRIVATE_PREFIX = 'assets/public/exam-packs/private/';
const REQUIRED_PRIVATE_PACK = `${PRIVATE_PREFIX}local.kaoyan.en1.json`;

function fail(message) {
  throw new Error(`APK artifact invalid: ${message}`);
}

export function assertApkEntries({ entries, releaseManifest, flavor, expectedVersion, expectedVersionCode }) {
  if (!releaseManifest || releaseManifest.flavor !== flavor) fail('manifest flavor does not match requested flavor');
  if (String(releaseManifest.version) !== String(expectedVersion)) fail('manifest version does not match requested version');
  if (Number(releaseManifest.versionCode) !== Number(expectedVersionCode)) fail('manifest versionCode does not match requested versionCode');
  if (!entries.includes(MANIFEST_PATH)) fail('release-manifest.json is missing');

  const rawPrivate = entries.find(entry => (
    entry.includes('private_exam_sources/')
    || (entry.startsWith(PRIVATE_PREFIX) && /\.(md|markdown|pdf)$/i.test(entry))
  ));
  if (rawPrivate) fail(`raw private source is present: ${rawPrivate}`);

  const privateEntries = entries.filter(entry => entry.startsWith(PRIVATE_PREFIX));
  if (flavor === 'public' && privateEntries.length) fail('private exam pack is present in public APK');
  if (flavor === 'private-qa') {
    if (!releaseManifest.privateExamPacksIncluded || !privateEntries.includes(`${PRIVATE_PREFIX}index.json`)) {
      fail('private QA APK is missing private pack index');
    }
    if (!privateEntries.includes(REQUIRED_PRIVATE_PACK)) fail('private QA APK is missing local.kaoyan.en1.json');
  }

  return { flavor, version: String(releaseManifest.version), versionCode: Number(releaseManifest.versionCode) };
}

function readEntries(apkPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(apkPath, { lazyEntries: true }, (error, zipfile) => {
      if (error) return reject(error);
      const entries = [];
      const chunks = [];
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        entries.push(entry.fileName);
        if (entry.fileName === MANIFEST_PATH) {
          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError) return reject(streamError);
            const pieces = [];
            stream.on('data', chunk => pieces.push(chunk));
            stream.on('end', () => {
              chunks.push(Buffer.concat(pieces).toString('utf8'));
              zipfile.readEntry();
            });
            stream.on('error', reject);
          });
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve({ entries, releaseManifest: chunks[0] ? JSON.parse(chunks[0]) : null }));
      zipfile.on('error', reject);
    });
  });
}

async function verifyApk(apkPath, flavor, expectedVersion, expectedVersionCode) {
  const { entries, releaseManifest } = await readEntries(apkPath);
  return assertApkEntries({ entries, releaseManifest, flavor, expectedVersion, expectedVersionCode });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const apkPath = process.argv[process.argv.indexOf('--apk') + 1];
  const flavor = process.argv[process.argv.indexOf('--flavor') + 1] || 'private-qa';
  const version = process.argv[process.argv.indexOf('--version') + 1];
  const versionCode = Number(process.argv[process.argv.indexOf('--version-code') + 1]);
  verifyApk(apkPath, flavor, version, versionCode)
    .then(result => process.stdout.write(`APK artifact PASS: ${JSON.stringify(result)}\n`))
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

export { MANIFEST_PATH, PRIVATE_PREFIX, REQUIRED_PRIVATE_PACK, readEntries, verifyApk };
