export const RELEASE_FLAVORS = Object.freeze(['public', 'private-qa']);

export function shouldInstallPrivateExamPacks(mode) {
  return mode === 'private-qa';
}

export function isSyntheticExamPaper(paper) {
  return paper?.sourceType === 'synthetic' || /synthetic|dev/i.test(String(paper?.packageId || ''));
}

export function filterVisibleExamPapers(papers, { isProduction = false } = {}) {
  const list = Array.isArray(papers) ? papers : [];
  return isProduction ? list.filter(paper => !isSyntheticExamPaper(paper)) : list;
}
