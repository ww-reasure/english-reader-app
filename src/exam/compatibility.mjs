import { hashPaper, hashQuestion } from './pack.mjs';
import { compareSourceToCanonicalPaper, summarizeSourceSections } from './source-production.mjs';

function flattenQuestions(paper) {
  return (paper?.units || []).flatMap(unit => unit.questions || []);
}

export async function build2026CompatibilityReport({ paper, rawMarkdown, canonicalQuestions = [], sourceMetadata = {} }) {
  const sourceSummary = summarizeSourceSections(rawMarkdown);
  const coverage = compareSourceToCanonicalPaper({ paper, sourceSummary });
  const paperQuestions = flattenQuestions(paper);
  const canonicalByKey = new Map(canonicalQuestions.map(question => [question.questionKey, question]));
  const paperByKey = new Map(paperQuestions.map(question => [question.questionKey, question]));
  const questionDifferences = [];
  const questionHashes = [];
  const allKeys = [...new Set([...paperByKey.keys(), ...canonicalByKey.keys()])].sort();
  for (const key of allKeys) {
    const paperQuestion = paperByKey.get(key);
    const canonicalQuestion = canonicalByKey.get(key);
    if (!paperQuestion || !canonicalQuestion) {
      questionDifferences.push(`questionKey mismatch: ${key}`);
      continue;
    }
    const [paperHash, canonicalHash] = await Promise.all([hashQuestion(paperQuestion), hashQuestion(canonicalQuestion)]);
    questionHashes.push({ questionKey: key, paperHash, canonicalHash });
    if (paperHash !== canonicalHash) questionDifferences.push(`questionHash mismatch: ${key}`);
  }

  const existingPaperHash = await hashPaper(paper);
  return {
    schemaVersion: 1,
    year: 2026,
    paperKey: paper?.paperKey || 'kaoyan_en1_2026',
    existingPaperHash,
    sourceMetadata,
    sourceSummary,
    coverage,
    questionHashCheck: {
      matches: questionDifferences.length === 0,
      questionCount: questionHashes.length,
      differences: questionDifferences,
      hashes: questionHashes
    },
    differences: [...coverage.differences, ...questionDifferences],
    warnings: [
      'raw 2026 MinerU MD/JSON 仅用于覆盖与兼容核对，不作为 canonical pack 输入。',
      '未使用 raw MinerU block id、页码或数组位置生成 question identity。'
    ],
    replacementPerformed: false
  };
}
