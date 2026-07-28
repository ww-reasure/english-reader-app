import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateTrackBaselineRegistry,
  validateTrackFocusCatalog
} from './track-baseline-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));

const [registry, catalog] = await Promise.all([
  readJson('public/data/track-baseline-registry.json'),
  readJson('public/data/lexicon-source-catalog.json')
]);

const registryReport = validateTrackBaselineRegistry(registry);
const catalogReport = validateTrackFocusCatalog(catalog, registry);
const reports = [registryReport, catalogReport];
const errors = reports.flatMap(report => report.errors || []);

if (errors.length) {
  console.error('Target-track provenance verification failed:');
  for (const error of errors) console.error(`- [${error.code}] ${error.path}: ${error.message}`);
  process.exitCode = 1;
} else {
  console.log(`Target-track baseline: ${registryReport.activationState}`);
  console.log(`Blocked target-focus tracks: ${catalogReport.blockedTracks.sort().join(', ') || 'none'}`);
  console.log('Raw exam text, answers, options, and recoverable n-gram tables are excluded from published artifacts.');
}
