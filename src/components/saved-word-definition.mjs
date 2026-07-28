import { getDefinitionSenses, getSavableTranslation } from './definition-trust.mjs';

export const DEFINITION_SCHEMA_VERSION = 1;

const text = value => String(value || '').trim();

export async function ensureSavedWordDefinition(record, { lookup, update } = {}) {
  if (!record || record.definitionSchemaVersion === DEFINITION_SCHEMA_VERSION) return record;
  if (typeof lookup !== 'function' || typeof update !== 'function') return record;

  let result;
  try {
    result = await lookup(record.word);
  } catch {
    return record;
  }

  const existingTranslation = getSavableTranslation(record);
  const dictionaryTranslation = getSavableTranslation(result);
  const fields = {
    translation: existingTranslation || dictionaryTranslation,
    phonetic: text(record.phonetic) || text(result?.phonetic),
    pos: text(record.pos) || text(result?.pos),
    definitionSenses: getDefinitionSenses(result).length
      ? getDefinitionSenses(result)
      : getDefinitionSenses(record),
    definitionSchemaVersion: DEFINITION_SCHEMA_VERSION,
    ...(text(result?.lexiconVersion) ? { definitionLexiconVersion: text(result.lexiconVersion) } : {})
  };

  await update(record.id, fields);
  return { ...record, ...fields };
}
