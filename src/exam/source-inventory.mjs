import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';

const YEAR_PATTERN = /(20\d{2})/u;
const CET4_SET_PATTERN = /(20\d{2})年(\d{1,2})月第(\d)套/u;

function normalizeRelativePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//u, '');
}

function fileExtension(relativePath) {
  const extension = extname(relativePath).toLowerCase();
  return extension || '';
}

function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(`sha256:${hash.digest('hex')}`));
  });
}

async function pdfPageCount(path) {
  const buffer = await readFile(path);
  const source = buffer.toString('latin1');
  const count = (source.match(/\/Type\s*\/Page\b/gu) || []).length;
  return count > 0 ? count : null;
}

export function classifySourceFile(inputPath) {
  const relativePath = normalizeRelativePath(inputPath);
  const extension = fileExtension(relativePath);
  const parts = relativePath.split('/');
  const root = parts[0] || '';
  const subfolder = parts[1] || '';
  const filename = parts.at(-1) || '';
  const detectedYear = Number(filename.match(YEAR_PATTERN)?.[1] || relativePath.match(YEAR_PATTERN)?.[1]) || null;
  const isMinerU = /mineru/i.test(filename);
  const isCET4Root = root === 'CET4' || (['md', 'json', 'pdf'].includes(root) && /英语四级/.test(filename));
  let sourceRole = 'unknown';

  if (extension === '.pdf' && (root === '1' || (isCET4Root && (subfolder === 'pdf' || root === 'pdf')))) sourceRole = 'standard_exam_pdf';
  else if (extension === '.md' && ((root === 'md' && !isCET4Root) || (isCET4Root && (subfolder === 'md' || root === 'md'))) && !isMinerU) sourceRole = 'standard_exam_markdown';
  else if (extension === '.json' && ((root === 'json' && !isCET4Root) || (isCET4Root && (subfolder === 'json' || root === 'json'))) && !isMinerU) sourceRole = 'standard_exam_json';
  else if (extension === '.md' && root === 'md' && isMinerU) sourceRole = 'mineru_candidate_markdown';
  else if (extension === '.json' && root === 'json' && isMinerU) sourceRole = 'mineru_candidate_json';
  else if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') sourceRole = 'supporting_image';

  const year = sourceRole.startsWith('standard_exam_') || sourceRole.startsWith('mineru_candidate_') ? detectedYear : null;
  const setMatch = isCET4Root ? filename.match(CET4_SET_PATTERN) : null;
  const month = setMatch ? Number(setMatch[2]) : null;
  const setNumber = setMatch ? Number(setMatch[3]) : null;
  const flags = [];
  if (sourceRole === 'unknown' || (sourceRole !== 'supporting_image' && !year)) flags.push('NEEDS_HUMAN_REVIEW');

  return { extension, year, sourceRole, month, setNumber, flags };
}

function metadataRecord(record) {
  const relativePath = normalizeRelativePath(record.relativePath);
  const classification = classifySourceFile(relativePath);
  return {
    relativePath,
    extension: classification.extension,
    year: classification.year,
    month: classification.month,
    setNumber: classification.setNumber,
    sourceRole: classification.sourceRole,
    sizeBytes: Number.isSafeInteger(record.sizeBytes) ? record.sizeBytes : null,
    sha256: record.sha256 || null,
    pageCount: Number.isSafeInteger(record.pageCount) ? record.pageCount : null,
    isEnglishI: classification.sourceRole === 'unknown' ? null : true,
    isCET4: relativePath.startsWith('CET4/'),
    isPdf: classification.extension === '.pdf',
    isMarkdown: classification.extension === '.md',
    isJson: classification.extension === '.json',
    isImage: ['.jpg', '.jpeg', '.png'].includes(classification.extension),
    flags: [...classification.flags]
  };
}

function addGroupFlag(files, predicate, flag) {
  const groups = new Map();
  for (const file of files) {
    const key = predicate(file);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(file);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      if (!file.flags.includes(flag)) file.flags.push(flag);
    }
  }
  return groups;
}

export function createInventoryFromRecords({ sourceRoot, records }) {
  const files = (Array.isArray(records) ? records : [])
    .map(metadataRecord)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const contentGroups = addGroupFlag(files, file => file.sha256, 'DUPLICATE_CONTENT');
  const versionGroups = addGroupFlag(files, file => file.year && `${file.year}:${file.extension}:${file.sourceRole}`, 'MULTIPLE_SOURCE_VERSIONS');
  const byExtension = {};
  const byYear = {};
  const byRole = {};
  for (const file of files) {
    byExtension[file.extension || '<none>'] = (byExtension[file.extension || '<none>'] || 0) + 1;
    if (file.year) byYear[file.year] = (byYear[file.year] || 0) + 1;
    byRole[file.sourceRole] = (byRole[file.sourceRole] || 0) + 1;
  }

  const needsHumanReview = files.filter(file => file.flags.includes('NEEDS_HUMAN_REVIEW')).map(file => file.relativePath);
  const duplicateContentGroups = [...contentGroups.values()]
    .filter(group => group.length > 1)
    .map(group => group.map(file => file.relativePath));
  const multipleSourceVersionGroups = [...versionGroups.values()]
    .filter(group => group.length > 1)
    .map(group => group.map(file => file.relativePath));

  return {
    schemaVersion: 1,
    sourceRoot: String(sourceRoot || ''),
    files,
    summary: {
      fileCount: files.length,
      years: Object.keys(byYear).map(Number).sort((left, right) => left - right),
      byExtension,
      byYear,
      byRole,
      standardYearCoverage: Object.fromEntries(
        [...new Set(files.filter(file => file.sourceRole.startsWith('standard_exam_') && file.year).map(file => file.year))]
          .sort((left, right) => left - right)
          .map(year => [year, files.filter(file => file.year === year && file.sourceRole.startsWith('standard_exam_')).map(file => file.sourceRole)])
      ),
      duplicateContentGroups,
      multipleSourceVersionGroups,
      needsHumanReview
    },
    warnings: [
      ...files.filter(file => file.isPdf && file.pageCount === null).map(file => `PDF_PAGE_COUNT_UNAVAILABLE:${file.relativePath}`),
      ...needsHumanReview.map(path => `NEEDS_HUMAN_REVIEW:${path}`)
    ]
  };
}

async function collectFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = resolve(currentDir, entry.name);
    if (entry.isDirectory()) {
      records.push(...await collectFiles(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = normalizeRelativePath(relative(rootDir, absolutePath));
    const fileStat = await stat(absolutePath);
    const classification = classifySourceFile(relativePath);
    records.push({
      relativePath,
      sizeBytes: fileStat.size,
      sha256: await hashFile(absolutePath),
      pageCount: classification.extension === '.pdf' ? await pdfPageCount(absolutePath) : null
    });
  }
  return records;
}

export async function scanSourceDirectory({ rootDir }) {
  const resolvedRoot = resolve(rootDir);
  const records = await collectFiles(resolvedRoot);
  return createInventoryFromRecords({ sourceRoot: rootDir, records });
}

export async function writeInventory({ rootDir, outputPath }) {
  const inventory = await scanSourceDirectory({ rootDir });
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  return inventory;
}

export async function readMetadataOnlyInventory(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
