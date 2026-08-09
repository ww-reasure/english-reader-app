const SECTION_RANGES = Object.freeze({
  cloze: [1, 20],
  reading: [21, 40],
  part_b: [41, 45],
  part_c: [46, 50]
});

function sourceLines(markdown) {
  return String(markdown || '').split(/\r?\n/u);
}

function sectionSlice(markdown, startHeading, endHeadings = []) {
  const source = String(markdown || '');
  const start = source.indexOf(startHeading);
  if (start < 0) return '';
  const endPositions = endHeadings
    .map(heading => source.indexOf(heading, start + startHeading.length))
    .filter(position => position >= 0);
  const end = endPositions.length ? Math.min(...endPositions) : source.length;
  return source.slice(start, end);
}

export function stableQuestionKey({ year, section, number }) {
  const numericYear = Number(year);
  const numericNumber = Number(number);
  const range = SECTION_RANGES[section];
  if (!Number.isInteger(numericYear) || !/^20\d{2}$/u.test(String(numericYear))) {
    throw new Error('year 必须是四位年份');
  }
  if (!range || !Number.isInteger(numericNumber) || numericNumber < range[0] || numericNumber > range[1]) {
    throw new Error(`${section} 题号超出范围`);
  }
  const suffix = section === 'cloze' ? `cloze_q${numericNumber}`
    : section === 'reading' ? `q${numericNumber}`
      : `${section}_q${numericNumber}`;
  return `kaoyan_en1_${numericYear}_${suffix}`;
}

export function detectPartBVariant(markdown) {
  const source = String(markdown || '');
  const candidateKeys = [...source.matchAll(/^\[\s*([A-H])\s*\]/gmu)].map(match => match[1]);
  const partB = source.includes('## Part B')
    ? sectionSlice(source, '## Part B', ['## Part C', '## Section III'])
    : source;
  if (/paragraphs?\s+are\s+given\s+in\s+a\s+wrong\s+order/iu.test(partB)
    || /reorgan(?:i|z)e\s+these\s+paragraphs/iu.test(partB)
    || /段落排序/u.test(partB)) {
    return 'paragraph_ordering';
  }
  if (/match(?:ing)?\s+(?:each|the)\s+paragraph|correct\s+heading/iu.test(partB)
    || /匹配|小标题|7\s*选\s*5/u.test(partB)
    || candidateKeys.length === 7) {
    return 'unsupported_matching';
  }
  return 'unknown';
}

function uniqueNumbersInRange(source, min, max) {
  const result = new Set();
  for (const line of sourceLines(source)) {
    const match = line.match(/^\s*(\d+)\.\s+/u);
    if (!match) continue;
    const number = Number(match[1]);
    if (number >= min && number <= max) result.add(number);
  }
  return [...result].sort((left, right) => left - right);
}

export function summarizeSourceSections(markdown) {
  const source = String(markdown || '');
  const clozeSource = sectionSlice(source, '## Section I', ['## Section II Reading Comprehension']);
  const clozeQuestionNumbers = [...new Set([...clozeSource.matchAll(/^\s*(\d+)\.\s*\[\s*A\s*\]/gmu)].map(match => Number(match[1])))].sort((left, right) => left - right);
  const readingSource = sectionSlice(source, '## Section II Reading Comprehension', ['## Part B', '## Section III']);
  const readingNumbers = uniqueNumbersInRange(readingSource, 21, 40);
  const readingQuestionRanges = [];
  for (let start = 21; start <= 36; start += 5) {
    if (readingNumbers.some(number => number >= start && number <= start + 4)) {
      readingQuestionRanges.push([start, start + 4]);
    }
  }

  const partBSource = sectionSlice(source, '## Part B', ['## Part C', '## Section III']);
  const partCSource = sectionSlice(source, '## Part C', ['## Section III']);
  const partCNumbers = [...new Set([...partCSource.matchAll(/\((4[6-9]|50)\)/gu)].map(match => Number(match[1])))].sort((left, right) => left - right);
  const writingSource = sectionSlice(source, '## Section III');
  const writingQuestionNumbers = [...new Set([...writingSource.matchAll(/^##\s+(5[12])\./gmu)].map(match => Number(match[1])))].sort((left, right) => left - right);

  return {
    cloze: {
      questionNumbers: clozeQuestionNumbers,
      questionCount: clozeQuestionNumbers.length
    },
    readingQuestionRanges,
    partB: {
      variant: detectPartBVariant(partBSource),
      candidateKeys: [...new Set([...partBSource.matchAll(/^\[\s*([A-H])\s*\]/gmu)].map(match => match[1]))].sort()
    },
    partC: {
      questionNumbers: partCNumbers,
      questionCount: partCNumbers.length
    },
    writing: {
      questionNumbers: writingQuestionNumbers,
      imported: false
    }
  };
}

export function assertUnitGate({ name, parse, validation, blockers }) {
  if (parse !== 'PASS') throw new Error(`${name} parse gate 必须 PASS，实际为 ${parse}`);
  if (validation !== 'PASS') throw new Error(`${name} validator gate 必须 PASS，实际为 ${validation}`);
  if (!Array.isArray(blockers) || blockers.length) {
    throw new Error(`${name} BLOCKERS 必须为 0`);
  }
  return { name, status: 'PASS', blockers: [] };
}

function questionNumber(question) {
  const match = String(question?.questionKey || '').match(/(?:_q)(\d+)$/u);
  return match ? Number(match[1]) : null;
}

export function compareSourceToCanonicalPaper({ paper, sourceSummary }) {
  const differences = [];
  const cloze = (paper?.units || []).find(unit => unit.type === 'cloze_choice');
  const clozeCount = cloze?.questions?.length || 0;
  if (Number(sourceSummary?.cloze?.questionCount || 0) && clozeCount !== Number(sourceSummary.cloze.questionCount)) {
    differences.push(`cloze question count mismatch: paper=${clozeCount} source=${sourceSummary.cloze.questionCount}`);
  }
  const readingRanges = (paper?.units || [])
    .filter(unit => unit.type === 'reading_mcq')
    .map(unit => {
      const numbers = unit.questions.map(questionNumber).filter(Number.isInteger).sort((left, right) => left - right);
      return numbers.length ? [numbers[0], numbers.at(-1)] : null;
    })
    .filter(Boolean);
  if (JSON.stringify(readingRanges) !== JSON.stringify(sourceSummary?.readingQuestionRanges || [])) {
    differences.push(`reading ranges mismatch: paper=${JSON.stringify(readingRanges)} source=${JSON.stringify(sourceSummary?.readingQuestionRanges || [])}`);
  }

  const partB = (paper?.units || []).find(unit => unit.type === 'paragraph_ordering');
  const sourcePartBVariant = sourceSummary?.partB?.variant || 'unknown';
  if (sourcePartBVariant.startsWith('unsupported_')) {
    if (partB) differences.push(`Part B unsupported variant must not be imported: ${sourcePartBVariant}`);
  } else {
    const partBVariant = partB ? 'paragraph_ordering' : 'unknown';
    if (partBVariant !== sourcePartBVariant) {
      differences.push(`Part B variant mismatch: paper=${partBVariant} source=${sourcePartBVariant}`);
    }
    const paperCandidateCount = partB?.candidates?.length || 0;
    const sourceCandidateCount = sourceSummary?.partB?.candidateKeys?.length || 0;
    if (sourceCandidateCount && paperCandidateCount !== sourceCandidateCount) {
      differences.push(`Part B candidate count mismatch: paper=${paperCandidateCount} source=${sourceCandidateCount}`);
    }
  }

  const partC = (paper?.units || []).find(unit => unit.type === 'translation');
  const partCCount = partC?.questions?.length || 0;
  if (partCCount !== Number(sourceSummary?.partC?.questionCount || 0)) {
    differences.push(`Part C question count mismatch: paper=${partCCount} source=${sourceSummary?.partC?.questionCount || 0}`);
  }

  if (sourceSummary?.writing?.imported) differences.push('writing must remain inventory-only');
  return { matches: differences.length === 0, differences };
}

export function examMetaForYear(year, packageVersion = '1.1.0') {
  const numericYear = Number(year);
  return {
    schema: 'exam-md-v1',
    examId: 'kaoyan_en1',
    bankId: 'builtin_kaoyan_en1',
    packageId: 'local.kaoyan.en1',
    packageVersion,
    paperKey: `kaoyan_en1_${numericYear}`,
    year: numericYear,
    sourceType: 'past_exam'
  };
}

export function normalizeSourceText(value) {
  return String(value || '')
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
}

export function textFromSource(value) {
  return normalizeSourceText(value).replace(/\n+/gu, ' ').trim();
}

export { SECTION_RANGES };
