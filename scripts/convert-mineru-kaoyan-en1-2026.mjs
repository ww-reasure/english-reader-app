import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExamPack } from '../src/exam/pack.mjs';
import { parseExamMarkdown } from '../src/exam/parser.mjs';
import { assertCanonicalPaper } from '../src/exam/schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const rawPath = 'D:/download/MinerU_markdown_考研英语一2026年真题及答案解析（整卷）_2085746092190769152.md';
const outputDir = resolve(projectRoot, 'private_exam_sources/markdown/kaoyan-en1/2026');
const packPath = resolve(projectRoot, 'public/exam-packs/private/local.kaoyan.en1.json');

const meta = {
  schema: 'exam-md-v1',
  examId: 'kaoyan_en1',
  bankId: 'builtin_kaoyan_en1',
  packageId: 'local.kaoyan.en1',
  packageVersion: '1.0.0',
  paperKey: 'kaoyan_en1_2026',
  year: 2026,
  sourceType: 'past_exam'
};

const directions = 'Read the following four texts. Answer the questions after each text by choosing A, B, C or D. Mark your answers on the ANSWER SHEET. (40 points)';
const clozeDirections = 'Read the following text. Choose the best word(s) for each numbered blank and mark A, B, C or D on the ANSWER SHEET. (10 points)';

function normalizeChineseSpacing(value) {
  return String(value || '')
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function text(value) {
  return normalizeChineseSpacing(value).replace(/\n+/g, ' ').trim();
}

function code(value) {
  return `\`\`\`exam-item\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function documentHead(section) {
  return `# 2026 考研英语一\n\n\`\`\`exam-meta\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n## ${section}\n`;
}

function writeQuestion(question) {
  const parts = [
    `#### Q${question.number}`,
    '',
    code({ questionKey: question.questionKey, type: 'single_choice', answer: question.answer, points: 2 }),
    '',
    question.stem,
    '',
    ...question.options.map(option => `- ${option.key}. ${option.text}`)
  ];
  const fields = [
    ['Question Translation', question.questionTranslation],
    ['Option Translations', question.optionTranslations?.length ? question.optionTranslations.map(option => `- ${option.key}: ${option.text}`).join('\n') : ''],
    ['Question Type', question.questionType],
    ['Stem Analysis', question.stemAnalysis],
    ['Location', question.location],
    ['Evidence', question.evidence],
    ['Evidence Translation', question.evidenceTranslation],
    ['Explanation', question.explanation],
    ['Option Analysis', question.optionAnalysis?.length ? question.optionAnalysis.map(option => `- ${option.key}: ${option.text}`).join('\n') : '']
  ];
  for (const [heading, value] of fields) {
    if (!value) continue;
    parts.push('', `##### ${heading}`, value);
  }
  return parts.join('\n');
}

function sourceRange(raw, anchor, nextAnchor) {
  const startAnchor = raw.indexOf(anchor);
  if (startAnchor < 0) throw new Error(`未找到来源锚点：${anchor}`);
  const start = raw.indexOf('## Directions:', startAnchor);
  if (start < 0) throw new Error(`未找到 Directions：${anchor}`);
  const end = nextAnchor ? raw.indexOf(nextAnchor, start) : raw.length;
  if (end < 0) throw new Error(`未找到后续锚点：${nextAnchor}`);
  return raw.slice(start, end);
}

function splitBilingualParagraphs(source) {
  const result = [];
  const matches = [...source.matchAll(/^P(\d+)\s+([\s\S]*?)(?=^P\d+\s|^\d+\.\s|^## 答案与逐题解析)/gm)];
  for (const match of matches) {
    const body = match[2].trim();
    const index = body.search(/[\u3400-\u9fff]/u);
    if (index < 0) throw new Error(`P${match[1]} 未找到中文译文，不能无损映射`);
    result.push({
      paragraphKey: `P${match[1]}`,
      english: text(body.slice(0, index)),
      chinese: text(body.slice(index))
    });
  }
  return result;
}

function parseEnglishQuestions(source, first, last) {
  const beforeAnalysis = source.slice(0, source.indexOf('## 答案与逐题解析'));
  const pattern = new RegExp(`^(?:${Array.from({ length: last - first + 1 }, (_, i) => first + i).join('|')})\\. `, 'gm');
  const matches = [...beforeAnalysis.matchAll(pattern)];
  if (matches.length !== last - first + 1) throw new Error(`英文题干数量异常：期望 ${last - first + 1}，实际 ${matches.length}`);
  return matches.map((match, index) => {
    const number = first + index;
    const body = beforeAnalysis.slice(match.index + match[0].length, matches[index + 1]?.index).trim();
    const optionStart = body.indexOf('[ A ]');
    if (optionStart < 0) throw new Error(`Q${number} 缺少 A 选项`);
    const stem = text(body.slice(0, optionStart));
    const optionPart = body.slice(optionStart);
    const optionMatches = [...optionPart.matchAll(/\[ ([A-D]) \]\s*([\s\S]*?)(?=\s*\[ [A-D] \]|$)/g)];
    if (optionMatches.length !== 4) throw new Error(`Q${number} 英文选项数量异常：${optionMatches.length}`);
    return { number, stem, options: optionMatches.map(item => ({ key: item[1], text: text(item[2]) })) };
  });
}

function between(source, start, end) {
  const begin = source.search(start);
  if (begin < 0) return '';
  const afterStart = source.slice(begin).replace(start, '');
  const endIndex = afterStart.search(end);
  return text(endIndex < 0 ? afterStart : afterStart.slice(0, endIndex));
}

function parseOptionItems(source) {
  const normalized = source.replace(/^(## )?【选项】\s*/m, '');
  // A source option explanation often spans several paragraphs separated by
  // blank lines. In multiline mode `$` means end-of-line, not end-of-source;
  // use a true end-of-input lookahead so the prose remains attached to its
  // explicitly labelled A-D heading.
  const matches = [...normalized.matchAll(/^(?:##\s+)?([A-D])\)\s*([^\n]*)([\s\S]*?)(?=^(?:##\s+)?[A-D]\)\s|(?![\s\S]))/gm)];
  return matches.map(match => ({ key: match[1], text: text(`${match[2]} ${match[3]}`) })).filter(item => item.text);
}

function parseChineseOptions(source, questionNumber) {
  // Q26 places 【答案】 immediately after translated option D on the same
  // physical line. The marker itself is authoritative, independent of the
  // Markdown line break that MinerU happened to emit.
  const answerIndex = source.indexOf('【答案】');
  const beforeAnswer = answerIndex < 0 ? source : source.slice(0, answerIndex);
  // MinerU keeps some translated A-D options on one physical Markdown line.
  // The labels are still explicit and ordered, so whitespace (not only a
  // newline) is the verified separator for this source form.
  const labels = [...beforeAnswer.matchAll(/(?:^|\s)([A-D])\)\s*/gm)];
  if (labels.length !== 4) throw new Error(`Q${questionNumber} 中文选项数量异常：${labels.length}`);
  const questionTranslation = text(beforeAnswer.slice(0, labels[0].index).replace(new RegExp(`^(?:##\\s*)?${questionNumber}\\.\\s*`), ''));
  return {
    questionTranslation,
    optionTranslations: labels.map((label, index) => ({
      key: label[1],
      text: text(beforeAnswer.slice(label.index + label[0].length, labels[index + 1]?.index))
    }))
  };
}

function parseReadingAnalysis(source, first, last) {
  const analysisStart = source.indexOf('## 答案与逐题解析');
  const analysis = source.slice(analysisStart);
  const header = new RegExp(`^(?:##\\s*)?(${Array.from({ length: last - first + 1 }, (_, i) => first + i).join('|')})\\.`, 'gm');
  const matches = [...analysis.matchAll(header)];
  if (matches.length !== last - first + 1) throw new Error(`中文解析题目数量异常：期望 ${last - first + 1}，实际 ${matches.length}`);
  return matches.map((match, index) => {
    const number = Number(match[1]);
    const block = analysis.slice(match.index, matches[index + 1]?.index);
    const answerMatch = block.match(/【答案】\s*([A-D])\s*[（(]([^）)]+)[）)]/);
    if (!answerMatch) throw new Error(`Q${number} 缺少答案或题型`);
    const translations = parseChineseOptions(block, number);
    const type = text(answerMatch[2]);
    const criterion = between(block, /(?:^|\n)(?:##\s*)?【判型】\s*/m, /(?:^|\n)(?:##\s*)?【拆句】\s*/m);
    const stem = between(block, /(?:^|\n)(?:##\s*)?【拆句】\s*/m, /(?:^|\n)(?:##\s*)?【定位】\s*/m);
    const locationMatch = block.match(/(?:^|\n)(?:##\s*)?【定位】\s*(P\d+)/m);
    const evidenceBlock = locationMatch
      ? between(block, /(?:^|\n)(?:##\s*)?【定位】\s*P\d+\s*/m, /(?:^|\n)(?:##\s*)?【选项】/m)
      : '';
    const chineseStart = evidenceBlock.search(/[\u3400-\u9fff]/u);
    const optionStart = block.search(/(?:^|\n)(?:##\s*)?【选项】/m);
    const optionAnalysis = optionStart < 0 ? [] : parseOptionItems(block.slice(optionStart));
    const optionWarnings = [];
    // Q24's final source paragraph is visibly unheaded: it discusses Kreier,
    // which is option D's subject, but the raw Markdown supplies no “D)” marker.
    // Do not attach it to C (or infer a D record); keep it in the immutable raw
    // source and make the omission explicit in the QA audit.
    if (number === 24) {
      const c = optionAnalysis.find(item => item.key === 'C');
      const orphanAt = c?.text.indexOf('Kreier 是转述 Orlando 观点的记者');
      if (orphanAt >= 0) {
        c.text = c.text.slice(0, orphanAt).trim();
        optionWarnings.push('Q24 来源的 D 选项解析正文缺少 D) heading；未错误归入 C，也未补写 D。');
      }
    }
    return {
      number,
      answer: answerMatch[1],
      questionType: type,
      questionTranslation: translations.questionTranslation,
      optionTranslations: translations.optionTranslations,
      stemAnalysis: criterion && stem ? `判型：${criterion}\n\n拆句：${stem}` : '',
      location: locationMatch?.[1] || '',
      evidence: chineseStart >= 0 ? text(evidenceBlock.slice(0, chineseStart)) : '',
      evidenceTranslation: chineseStart >= 0 ? text(evidenceBlock.slice(chineseStart)) : '',
      optionAnalysis,
      warnings: [
        ...(locationMatch ? [] : [`Q${number} 来源解析缺少【定位】/Evidence/Evidence Translation；未补写。`]),
        ...(locationMatch && chineseStart < 0 ? [`Q${number} 的【定位】缺少可识别的中文译文；未补写。`] : []),
        ...optionWarnings
      ]
    };
  });
}

function makeReadingUnit(raw, descriptor) {
  const source = sourceRange(raw, descriptor.anchor, descriptor.nextAnchor);
  // Only the source page before its answer-analysis heading contains the
  // bilingual passage. Later option analysis can itself start a line with
  // “P3 …”, which is a location reference rather than a new paragraph.
  const questionSurface = source.slice(0, source.indexOf('## 答案与逐题解析'));
  const passages = splitBilingualParagraphs(questionSurface);
  if (passages.length !== descriptor.paragraphs) throw new Error(`${descriptor.file} 段落数量异常：${passages.length}`);
  const english = parseEnglishQuestions(source, descriptor.first, descriptor.last);
  const analysis = parseReadingAnalysis(source, descriptor.first, descriptor.last);
  const questions = english.map((question, index) => ({
    ...question,
    ...analysis[index],
    questionKey: `kaoyan_en1_2026_q${question.number}`
  }));
  const markdown = [
    documentHead('Section II Part A'),
    `### Text ${descriptor.textNumber}`,
    '',
    code({ unitKey: `kaoyan_en1_2026_part_a_text_${descriptor.textNumber}`, type: 'reading_mcq', displayTitle: `Text ${descriptor.textNumber}` }),
    '',
    '#### Directions',
    directions,
    '',
    '#### Passage',
    '',
    ...passages.flatMap(p => [`##### ${p.paragraphKey}`, p.english, '']),
    '#### Passage Translation',
    '',
    ...passages.flatMap(p => [`##### ${p.paragraphKey}`, p.chinese, '']),
    ...questions.flatMap(question => ['', writeQuestion(question)])
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { markdown, questions, passages, warnings: questions.flatMap(question => [
    ...(question.optionAnalysis.length === 4 ? [] : [`Q${question.number} optionAnalysis 不完整（${question.optionAnalysis.length}/4）`]),
    ...question.warnings
  ]) };
}

const clozePassages = [
  ['P1', 'Advances in artificial intelligence (AI) are rapidly changing every aspect of human life. The world of AI is buzzing with an exciting potential to improve and enrich our lives. [1], AI also has the potential hazard of [2] our experiences in ways we might find difficult to control. One such [3] is how we understand and experience beauty.', '人工智能（AI）的进步正在迅速改变人类生活的方方面面。人工智能世界充满了改善和丰富我们生活的激动人心的潜力。然而，人工智能也存在以我们可能难以控制的方式主导我们体验的潜在危险。其中一个领域就是我们如何理解和体验美。'],
  ['P2', 'AI can be a collaborative tool in a wide range of creative endeavors. [4] human creativity and AI algorithms can lead to unique artistic [5] that are beautiful to the human eye. These collaborations are likely to become increasingly common. [6], as convenient and provocative, AI enables virtual try-on experiences where you can virtually [7] makeup, hairstyles, clothing, and even cosmetic procedures [8] making any physical changes. Individuals can now experiment with different looks and [9] their preferences, potentially expanding the range of beauty ideals.', '人工智能可以成为广泛创意活动中的协作工具。将人类创造力与人工智能算法相结合，可以产生人眼所见的独特艺术成果。这些协作可能会变得越来越普遍。例如，作为便捷且具有启发性的工具，人工智能实现了虚拟试用体验，让你可以在进行任何实际改变之前虚拟测试化妆、发型、服装甚至整容手术。个人现在可以尝试不同的外观并探索自己的偏好，从而有可能扩大审美理想的范围。'],
  ['P3', 'AI algorithms can [10] facial features and skin conditions to provide personalized beauty recommendations. This approach aims to cater to individual preferences and enhance the concept of [11] beauty tailored to each person\'s unique characteristics. [12], AI can be a fun vehicle for self-discovery.', '人工智能算法可以分析面部特征和皮肤状况，以提供个性化的美容建议。这种定制化方法旨在迎合个人偏好，并增强为每个人的独特特征量身定制的美的概念。通过这种方式，人工智能可以成为自我发现的有趣工具。'],
  ['P4', 'While AI offers exciting possibilities, it also raises ethical [13]. There is a risk of deepening societal beauty [14] and perpetuating unattainable beauty standards. [15], AI-powered beauty filters and editing tools can lead to distorted self-perception and body dissatisfaction. As summarized in a recent [16] post on "The Hidden Dangers of Online Beauty Filters", [17] on this technology for social presentation can cause harm [18] body image issues, lower self-esteem, and social anxiety.', '虽然人工智能提供了令人兴奋的可能性，但它也引发了伦理问题。存在加深社会审美压力和延续难以企及的审美标准的风险。此外，由人工智能驱动的美颜滤镜和编辑工具可能导致扭曲的自我认知，并加剧身体不满。正如最近一篇关于“在线美颜滤镜的隐藏危险”的文章所总结的那样，依赖这项技术进行社交展示可能造成诸如身体形象问题、自尊心降低和社交焦虑等危害。'],
  ['P5', 'It\'s important to note that while AI can enhance our [19] of beauty, it should not [20] the genuine human experience and the emotional connections we derive from seeing the beauty in each other.', '重要的是要注意，虽然人工智能可以增强我们对美的欣赏，但它不应取代真正的人类体验以及我们从彼此身上看到美所获得的情感联系。']
];

function parseClozeOptions(source) {
  const sectionStart = source.indexOf('1. [ A ]');
  const sectionEnd = source.indexOf('## 1.', sectionStart);
  const section = source.slice(sectionStart, sectionEnd);
  const matches = [...section.matchAll(/(?:^|\n)(\d+)\. \[ A \]\s*([\s\S]*?)\s*\[ B \]\s*([\s\S]*?)\s*\[ C \]\s*([\s\S]*?)\s*\[ D \]\s*([\s\S]*?)(?=\n\s*\d+\. \[ A \]|$)/g)];
  if (matches.length !== 20) throw new Error(`完形选项数量异常：${matches.length}`);
  return new Map(matches.map(match => [Number(match[1]), ['A', 'B', 'C', 'D'].map((key, index) => ({ key, text: text(match[index + 2]) }))]));
}

function parseClozeAnalyses(source) {
  const analysis = source.slice(source.indexOf('## 1.'));
  // MinerU dropped the Markdown heading markers for blanks 16 and 18, while
  // retaining the standalone numbered lines and their answer blocks.  Accept
  // that verified layout variant; it cannot be mistaken for option content in
  // the answer-analysis section.
  const headers = [...analysis.matchAll(/^(?:##\s+)?(\d+)\.\s*$/gm)];
  if (headers.length !== 20) throw new Error(`完形解析数量异常：${headers.length}`);
  return new Map(headers.map((header, index) => {
    const number = Number(header[1]);
    const block = analysis.slice(header.index, headers[index + 1]?.index);
    const answer = block.match(/【答案】\s*\[\s*([A-D])\s*\]/)?.[1];
    if (!answer) throw new Error(`完形第 ${number} 空缺少答案`);
    const clue = between(block, /(?:^|\n)(?:##\s*)?【线索】\s*/m, /(?:^|\n)(?:##\s*)?【选项】/m);
    const verification = between(block, /(?:^|\n)【验证】\s*/m, /\s*$/m);
    const optionStart = block.search(/(?:^|\n)(?:##\s*)?【选项】/m);
    const optionAnalysis = optionStart < 0 ? [] : parseOptionItems(block.slice(optionStart));
    return [number, { answer, explanation: [clue && `线索：${clue}`, verification && `验证：${verification}`].filter(Boolean).join('\n\n'), optionAnalysis }];
  }));
}

function makeClozeUnit(raw) {
  const source = sourceRange(raw, '2026年考研英语一完形填空（四选一）·1–20空答案与解析', '本页 21–25');
  const options = parseClozeOptions(source);
  const analyses = parseClozeAnalyses(source);
  const questions = Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const analysis = analyses.get(number);
    return { number, answer: analysis.answer, options: options.get(number), explanation: analysis.explanation, optionAnalysis: analysis.optionAnalysis };
  });
  const markdown = [
    documentHead('Section I'),
    '### Cloze Test',
    '',
    code({ unitKey: 'kaoyan_en1_2026_cloze_1', type: 'cloze_choice', displayTitle: '完形填空' }),
    '',
    '#### Directions', clozeDirections, '',
    '#### Passage', '',
    ...clozePassages.flatMap(([key, english]) => [`##### ${key}`, english, '']),
    '#### Passage Translation', '',
    ...clozePassages.flatMap(([key, , chinese]) => [`##### ${key}`, chinese, '']),
    ...questions.flatMap(question => [
      '', `#### Blank ${question.number}`, '',
      code({ questionKey: `kaoyan_en1_2026_cloze_q${question.number}`, type: 'cloze_choice', answer: question.answer, points: 0.5 }),
      '', ...question.options.map(option => `- ${option.key}. ${option.text}`),
      ...(question.explanation ? ['', '##### Explanation', question.explanation] : []),
      ...(question.optionAnalysis.length ? ['', '##### Option Analysis', ...question.optionAnalysis.map(option => `- ${option.key}: ${option.text}`)] : [])
    ])
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { markdown, questions, warnings: questions.flatMap(question => question.optionAnalysis.length === 4 ? [] : [`Blank ${question.number} optionAnalysis 不完整（${question.optionAnalysis.length}/4）`]) };
}

function splitCandidateText(body) {
  const chineseStart = body.search(/[\u3400-\u9fff]/u);
  if (chineseStart < 0) throw new Error('Part B candidate 缺少中文译文，不能确认原始双语边界');
  return { english: text(body.slice(0, chineseStart)), chinese: text(body.slice(chineseStart)) };
}

function makeOrderingUnit(raw) {
  const source = sourceRange(raw, '本页 41–45 题的正确段落顺序', 'O V E R V I E W · 通 读 建 境');
  const candidateStart = source.indexOf('[ C ]');
  const sequenceStart = source.indexOf('$$', candidateStart);
  const candidateSource = source.slice(candidateStart, sequenceStart);
  // The final alternative is the end of the candidate block, not the end of
  // every physical line. `$` with multiline mode previously cut B/E before
  // their translated paragraphs after blank lines.
  const candidateMatches = [...candidateSource.matchAll(/^\[ ([A-H]) \]\s*([\s\S]*?)(?=^\[ [A-H] \]|(?![\s\S]))/gm)];
  if (candidateMatches.length !== 8) throw new Error(`Part B candidates 数量异常：${candidateMatches.length}`);
  const candidates = candidateMatches.map(match => ({ candidateKey: match[1], ...splitCandidateText(match[2]) }));
  const slotAnswers = new Map([[41, 'B'], [42, 'E'], [43, 'A'], [44, 'G'], [45, 'D']]);
  const slotExplanations = [];
  const analysisStart = source.indexOf('## 41. 正确段 B');
  const analysis = source.slice(analysisStart);
  const headers = [...analysis.matchAll(/^##\s+(4[1-5])\.\s+正确段\s+([A-H])\s*$/gm)];
  if (headers.length !== 5) throw new Error(`Part B slot 解析数量异常：${headers.length}`);
  for (let index = 0; index < headers.length; index += 1) {
    const number = Number(headers[index][1]);
    const expected = slotAnswers.get(number);
    if (headers[index][2] !== expected) throw new Error(`Part B ${number} 答案与正确顺序冲突`);
    slotExplanations.push({ number, answer: expected, explanation: text(analysis.slice(headers[index].index + headers[index][0].length, headers[index + 1]?.index)) });
  }
  const markdown = [
    documentHead('Section II Part B'),
    '### Part B', '',
    code({
      unitKey: 'kaoyan_en1_2026_part_b_1', type: 'paragraph_ordering', displayTitle: 'Part B',
      slots: [41, 42, 43, 44, 45],
      fixed: [{ position: 0, candidateKey: 'F' }, { position: 3, candidateKey: 'H' }, { position: 5, candidateKey: 'C' }],
      answerSequence: ['F', 'B', 'E', 'H', 'A', 'C', 'G', 'D']
    }), '',
    '#### Directions', text(source.slice(source.indexOf('## Directions:') + '## Directions:'.length, candidateStart)), '',
    ...candidates.flatMap(candidate => [`#### Candidate ${candidate.candidateKey}`, candidate.english, '']),
    '#### Candidate Translations',
    ...candidates.map(candidate => `- ${candidate.candidateKey}: ${candidate.chinese}`),
    '',
    ...slotExplanations.flatMap(slot => [
      `#### Slot ${slot.number}`, '',
      code({ questionKey: `kaoyan_en1_2026_part_b_q${slot.number}`, type: 'paragraph_ordering_slot', answer: slot.answer, points: 2 }), '',
      '##### Explanation', slot.explanation, ''
    ])
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { markdown, candidates, questions: slotExplanations, warnings: [] };
}

function makeTranslationUnit(raw) {
  const source = raw.slice(raw.indexOf('## Directions:'), raw.indexOf('## 逐句解析'));
  const paragraphs = [
    ['P1', 'Science education today revolves around the idea of scientific literacy — the base-level knowledge about science that nonscientists require to effectively get on in the world. This concept has served as a central goal for curriculum developers, local school boards, business and community leaders, and policymakers ever since its introduction nearly 80 years ago.'],
    ['P2', 'Tracing the history of the term, we can see how the definition of scientific literacy has shifted over time, muddying the waters when it comes to determining the goals of science education. And that\'s a shame, because there is much to recommend in the idea of scientific literacy as it was originally articulated in 1945, a time when science appeared to be the key to progress and scientists seemingly held the fate of the world in their hands. A return to that version of scientific literacy, which focused more on teaching what science is and how it works and less on memorizing scientific facts, seems like something society today desperately needs.'],
    ['P3', 'In the United States, the desire to provide the public with a general, nontechnical education in science originated as far back as the late 1800s. Educators advanced the idea of having students complete detailed laboratory exercises in high schools in the belief that such work was beneficial primarily as a way to enhance logical reasoning and observational skills. The development in 1915 of the popular new subject "general science" was another effort to train students to apply the principles of science to everyday, nonscience problems.'],
    ['P4', 'Although these efforts were aimed at the nonscience-bound student, they never really made their way into mainstream thought and public discourse as a means to rally widespread support for the importance of science teaching in schools. It wasn\'t until the phrase "scientific literacy" came along in the 1940s that science had the formidable slogan it needed to command public attention and make improving science education an important national goal.'],
    ['P5', 'The intense focus on scientific literacy in the United States originally grew out of the critical role of science and technology during World War II, as well as the perceived deficiencies of American soldiers. As the war unfolded, science rapidly assumed a central role. Battles increasingly depended on new military technologies such as radar and the proximity fuze. Science-based analytical approaches proved remarkably successful in the hunt for German submarines in the Atlantic Ocean. And there was the (then-secret) work building the world\'s first atomic bomb. As a result, scientists — physicists in particular — found themselves in high demand.']
  ].map(([paragraphKey, text]) => ({ paragraphKey, text }));
  const translations = [
    '当今的科学教育围绕科学素养这一理念展开——即非科学家在世界上有效生活所需的关于科学的基础知识。自近80年前提出以来，这一概念一直是课程开发者、地方学校董事会、商业和社区领导者以及政策制定者的核心目标。',
    '追溯这一术语的历史，我们可以看到科学素养的定义如何随时间推移而变化，在确定科学教育目标时使情况变得模糊不清。这很遗憾，因为科学素养这一理念在1945年最初阐述时有很多值得推崇之处，那时科学似乎是进步的关键，科学家看似将世界的命运掌握在手中。回归那个版本的科学素养，它更侧重于教授什么是科学以及科学如何运作，而非死记硬背科学事实，似乎是当今社会迫切需要的。',
    '在美国，为公众提供科学方面的通识性、非技术性教育的愿望最早可追溯到19世纪末。教育工作者提出让学生在高中完成详细实验练习的想法，认为这类工作的益处主要在于增强逻辑推理和观察技能。1915年流行的新学科“普通科学”的发展是另一项努力，旨在训练学生将科学原理应用于日常的非科学问题。',
    '尽管这些努力针对的是非理科方向的学生，但它们从未真正进入主流思想和公共话语，成为广泛支持学校科学教学重要性的手段。直到20世纪40年代“科学素养”这一短语出现，科学才有了所需的有力口号来引起公众关注，并使改善科学教育成为重要的国家目标。',
    '美国对科学素养的高度关注最初源于科学技术在第二次世界大战中的关键作用，以及美国士兵被认为存在的不足。随着战争展开，科学迅速承担起核心角色。战斗越来越依赖雷达和近炸引信等新军事技术。基于科学的分析方法在大西洋猎杀德国潜艇的行动中被证明极为成功。还有制造世界上第一颗原子弹的（当时保密的）工作。因此，科学家——尤其是物理学家——发现自己需求量很大。'
  ];
  const segmentSources = [
    'Tracing the history of the term, we can see how the definition of scientific literacy has shifted over time, muddying the waters when it comes to determining the goals of science education.',
    'A return to that version of scientific literacy, which focused more on teaching what science is and how it works and less on memorizing scientific facts, seems like something society today desperately needs.',
    'Educators advanced the idea of having students complete detailed laboratory exercises in high schools in the belief that such work was beneficial primarily as a way to enhance logical reasoning and observational skills.',
    'It wasn\'t until the phrase "scientific literacy" came along in the 1940s that science had the formidable slogan it needed to command public attention and make improving science education an important national goal.',
    'The intense focus on scientific literacy in the United States originally grew out of the critical role of science and technology during World War II, as well as the perceived deficiencies of American soldiers.'
  ];
  const analyses = [
    '【意群】 Tracing the history of the term,（现在分词短语作时间状语）★采分；we can see how the definition of scientific literacy has shifted over time,（how 引导的宾语从句）；muddying the waters when it comes to determining the goals of science education.（现在分词作结果状语 + when 从句）',
    '【意群】 A return to that version of scientific literacy,（主语）；which focused more on teaching what science is and how it works and less on memorizing scientific facts,（非限定性定语从句）；seems like something society today desperately needs.（谓语 + 省略 that 的定语从句）',
    '【意群】 Educators advanced the idea of having students complete detailed laboratory exercises in high schools（主干 + of 动名词同位内容）；in the belief that such work was beneficial primarily as a way to enhance logical reasoning and observational skills.（同位语从句作状语）',
    '【意群】 It wasn\'t until the phrase "scientific literacy" came along in the 1940s（not until 强调句的状语部分）；that science had the formidable slogan it needed to command public attention and make improving science education an important national goal.（强调句主句 + 定语从句 + 不定式）',
    '【意群】 The intense focus on scientific literacy in the United States（主语）；originally grew out of the critical role of science and technology during World War II（谓语 + 时间状语）；as well as the perceived deficiencies of American soldiers.（并列成分）'
  ];
  const questions = segmentSources.map((sourceText, index) => ({ number: 46 + index, sourceText, referenceTranslation: [
    '追溯这一术语的历史，我们可以看到科学素养的定义如何随时间不断变化，而这就使得在确定科学教育的目标时变得愈发模糊不清。',
    '回归科学素养的那个（1945年）版本——它更注重教授科学是什么、如何运作，而不那么强调背诵科学事实——似乎正是当今社会迫切需要的东西。',
    '教育工作者提出，让高中生完成详尽的实验室练习；他们相信，这类练习之所以有益，主要是因为它是一种提升逻辑推理能力和观察能力的途径。',
    '直到20世纪40年代“科学素养”这一说法问世，科学才拥有了它所需要的那句强有力的口号——用以赢得公众的关注，并使改善科学教育成为一项重要的国家目标。',
    '美国之所以高度关注科学素养，最初源于二战期间科学技术所发挥的关键作用，以及人们所认为的美国士兵在这方面的不足。'
  ][index], localAnalysis: analyses[index], location: `P${index === 0 || index === 1 ? 2 : index === 2 ? 3 : index === 3 ? 4 : 5}` }));
  const markdown = [
    documentHead('Section II Part C'),
    '### Part C', '',
    code({ unitKey: 'kaoyan_en1_2026_part_c', type: 'translation', displayTitle: 'Part C 翻译' }), '',
    '#### Directions', 'Read the following text carefully and then translate the underlined segments into Chinese. Write your answers on the ANSWER SHEET. ( 10 points)', '',
    '#### Passage', '', ...paragraphs.flatMap(paragraph => [`##### ${paragraph.paragraphKey}`, paragraph.text, '']),
    '#### Passage Translation', '', ...paragraphs.map((paragraph, index) => `##### ${paragraph.paragraphKey}\n${translations[index]}\n`),
    ...questions.flatMap(question => ['', `#### Q${question.number}`, '', code({ questionKey: `kaoyan_en1_2026_part_c_q${question.number}`, segmentKey: `S${question.number}`, type: 'translation_segment', points: 2 }), '', '##### Source Text', question.sourceText, '', '##### Reference Translation', question.referenceTranslation, '', '##### Local Analysis', question.localAnalysis, '', '##### Location', question.location])
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { markdown, questions, warnings: ['raw.md/raw.json 均显示 Q46/Q48/Q50 附近存在 MinerU 跨栏串行伪影；使用 JSON 题号与逐句解析页中的完整句子恢复 segment 边界，未依据常识补写。'] };
}

function qaDocument(name, result, normalized, warnings = [], blockers = []) {
  return `# ${name} MinerU → exam-md-v1 QA\n\n## NORMALIZED\n\n${normalized.map(item => `- ${item}`).join('\n') || '- None.'}\n\n## WARNINGS\n\n${[...warnings, ...result.warnings].map(item => `- ${item}`).join('\n') || '- None.'}\n\n## BLOCKERS\n\n${blockers.map(item => `- ${item}`).join('\n') || '- None.'}\n`;
}

async function validateAndWrite(name, result, qa, papers) {
  const paper = parseExamMarkdown(result.markdown);
  assertCanonicalPaper(paper);
  const filename = `${name}.md`;
  await writeFile(resolve(outputDir, filename), result.markdown, 'utf8');
  await writeFile(resolve(outputDir, `${name}.qa.md`), qa, 'utf8');
  papers.push(paper);
  process.stdout.write(`PASS ${filename}: ${paper.units[0].questions.length} questions\n`);
}

async function main() {
  const raw = await readFile(rawPath, 'utf8');
  await mkdir(outputDir, { recursive: true });
  const papers = [];

  const cloze = makeClozeUnit(raw);
  await validateAndWrite('section1-cloze', cloze, qaDocument('Section I Cloze', cloze, [
    '将 MinerU 中漂移/粘连的 1–20 空号恢复为 canonical [1]–[20] 标记；位置以原始题干、逐空【线索】/【验证】和 JSON 选项序号共同核对。',
    '删除仅属于网页导航/词表的非题面内容；未改写题干、选项或答案。'
  ]), papers);

  const descriptors = [
    { file: 'part-a-text-1', textNumber: 1, first: 21, last: 25, paragraphs: 6, anchor: '本页 21–25 题的答案与逐题解析', nextAnchor: '本页 26–30 题的答案与逐题解析' },
    { file: 'part-a-text-2', textNumber: 2, first: 26, last: 30, paragraphs: 7, anchor: '本页 26–30 题的答案与逐题解析', nextAnchor: '本页 31–35 题的答案与逐题解析' },
    { file: 'part-a-text-3', textNumber: 3, first: 31, last: 35, paragraphs: 6, anchor: '本页 31–35 题的答案与逐题解析', nextAnchor: '本页 36–40 题的答案与逐题解析' },
    { file: 'part-a-text-4', textNumber: 4, first: 36, last: 40, paragraphs: 6, anchor: '本页 36–40 题的答案与逐题解析', nextAnchor: '本页 41–45 题的正确段落顺序' }
  ];
  for (const descriptor of descriptors) {
    const result = makeReadingUnit(raw, descriptor);
    await validateAndWrite(descriptor.file, result, qaDocument(`Part A Text ${descriptor.textNumber}`, result, [
      '将明确的 Markdown 行内断行、题干/选项换行和中文字符间空格收束为连续文本；未依据语言常识补写题面或解析。',
      '解析层严格使用 Markdown headings；fenced exam-item 仅保留机器字段。'
    ]), papers);
  }

  const ordering = makeOrderingUnit(raw);
  await validateAndWrite('part-b', ordering, qaDocument('Section II Part B', ordering, [
    '将 MinerU 中固定段、候选段、slot 链的版面序列映射为 stable candidate keys 和 fixed positions；未改写候选段英文。'
  ]), papers);

  const translation = makeTranslationUnit(raw);
  await validateAndWrite('part-c', translation, qaDocument('Section II Part C', translation, [
    '从 raw.md 的 Part C 正文、逐句解析和原始题号恢复 5 个 stable translation segments；将明确的跨栏断行与词粘连归位为可核对的完整句子。',
    '保留来源已有参考译文与逐句解析；没有调用 AI，也未增加来源不存在的评分或答案。'
  ]), papers);

  const merged = papers[0];
  merged.units = papers.flatMap(paper => paper.units);
  assertCanonicalPaper(merged);
  const pack = await createExamPack({
    meta: { packageId: meta.packageId, packageVersion: meta.packageVersion, examId: meta.examId, bankId: meta.bankId, displayName: '2026 考研英语一' },
    papers: [merged],
    generatedAt: new Date().toISOString()
  });
  await mkdir(dirname(packPath), { recursive: true });
  await writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  process.stdout.write(`PASS pack: ${pack.manifest.papers[0].unitCount} units, ${pack.manifest.papers[0].questionCount} questions\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
