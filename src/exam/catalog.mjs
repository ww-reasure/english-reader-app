/**
 * Pure helpers for the year/type catalogue used by the exam desktop.
 * Keeping this data shaping separate from the view also makes random entry
 * deterministic in tests and prevents unavailable packs from being invented.
 */

function asUnits(paper, unitType) {
  return (paper?.units || [])
    .filter(unit => !unitType || unit.type === unitType)
    .filter(unit => Array.isArray(unit.questions) && unit.questions.length)
    .map(unit => ({
      ...unit,
      paperKey: paper.paperKey,
      bankId: paper.bankId,
      packageId: paper.packageId,
      paper
    }));
}

export function buildExamCatalog(papers, { unitType = null, kind = 'unit' } = {}) {
  if (kind === 'full_paper') {
    return (Array.isArray(papers) ? papers : [])
      .map(paper => ({
        year: Number(paper.year) || paper.year || '未知年份',
        paperKey: paper.paperKey,
        bankId: paper.bankId,
        packageId: paper.packageId,
        paper,
        units: asUnits(paper)
      }))
      .filter(group => group.units.length)
      .map(group => ({
        ...group,
        directStart: group.units.length === 1,
        expandable: group.units.length > 1
      }))
      .sort((left, right) => Number(right.year) - Number(left.year));
  }
  const groups = new Map();
  for (const paper of Array.isArray(papers) ? papers : []) {
    const units = asUnits(paper, unitType);
    if (!units.length) continue;
    const year = Number(paper.year) || paper.year || '未知年份';
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(...units);
  }
  return [...groups.entries()]
    .sort((left, right) => Number(right[0]) - Number(left[0]))
    .map(([year, units]) => ({
      year,
      units,
      directStart: units.length === 1,
      expandable: units.length > 1
    }));
}

function pick(list, random = Math.random) {
  if (!list.length) return null;
  const value = Number(random());
  const index = Math.min(list.length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * list.length)));
  return list[index];
}

export function selectRandomPaper(papers, random = Math.random) {
  return pick((Array.isArray(papers) ? papers : []).filter(paper => (paper?.units || []).some(unit => unit.questions?.length)), random);
}

export function selectRandomUnit(catalog, random = Math.random) {
  const units = (Array.isArray(catalog) ? catalog : []).flatMap(group => group.units || []);
  return pick(units, random);
}
