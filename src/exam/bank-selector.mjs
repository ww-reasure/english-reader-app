const BANK_DEFINITIONS = Object.freeze([
  {
    key: 'kaoyan_en1',
    label: '考研英语一',
    matches: bank => /kaoyan|en1|英语一|考研英语一/i.test(`${bank?.examId || ''} ${bank?.bankId || ''} ${bank?.displayName || ''} ${bank?.packageId || ''}`)
  },
  {
    key: 'cet4',
    label: '英语四级',
    matches: bank => /cet4|四级/i.test(`${bank?.examId || ''} ${bank?.bankId || ''} ${bank?.displayName || ''} ${bank?.packageId || ''}`)
  }
]);

function isSyntheticBank(bank) {
  return /synthetic|dev/i.test(`${bank?.bankId || ''} ${bank?.packageId || ''} ${bank?.displayName || ''}`);
}

function chooseInstalledBank(definition, installedBanks, visibleRecords) {
  const visibleBankIds = new Set((Array.isArray(visibleRecords) ? visibleRecords : []).map(record => record?.bankId).filter(Boolean));
  return (Array.isArray(installedBanks) ? installedBanks : [])
    .filter(bank => visibleBankIds.has(bank.bankId) && definition.matches(bank))
    .sort((left, right) => Number(isSyntheticBank(left)) - Number(isSyntheticBank(right)))[0]
    || (Array.isArray(visibleRecords) ? visibleRecords.find(record => visibleBankIds.has(record.bankId) && definition.matches(record)) : null)
    || null;
}

export function getExamBankOptions(installedBanks = [], visibleRecords = []) {
  return BANK_DEFINITIONS.map(definition => {
    const installed = chooseInstalledBank(definition, installedBanks, visibleRecords);
    return {
      key: definition.key,
      label: definition.label,
      bankId: installed?.bankId || (definition.key === 'kaoyan_en1' ? 'builtin_kaoyan_en1' : 'cet4'),
      installed: Boolean(installed),
      disabled: !installed
    };
  });
}

export function resolveExamBankId(options, requestedBankId = null) {
  const list = Array.isArray(options) ? options : [];
  const requested = list.find(option => option.bankId === requestedBankId && option.installed);
  return requested?.bankId || list.find(option => option.installed)?.bankId || '';
}
