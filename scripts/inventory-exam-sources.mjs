import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeInventory } from '../src/exam/source-inventory.mjs';

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

export async function runInventoryCli({ rootDir, outputPath } = {}) {
  const inventory = await writeInventory({
    rootDir: rootDir || readArg('root') || 'D:/资料/english',
    outputPath: outputPath || readArg('output') || 'private_exam_sources/source-manifests/kaoyan-en1/inventory.json'
  });
  process.stdout.write(JSON.stringify({
    sourceRoot: inventory.sourceRoot,
    fileCount: inventory.summary.fileCount,
    years: inventory.summary.years,
    byExtension: inventory.summary.byExtension,
    needsHumanReview: inventory.summary.needsHumanReview.length,
    duplicateContentGroups: inventory.summary.duplicateContentGroups.length
  }, null, 2) + '\n');
  return inventory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runInventoryCli().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
