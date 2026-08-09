export const EXAM_MD_SCHEMA = 'exam-md-v1';
export const EXAM_CANONICAL_SCHEMA_VERSION = 1;
export const EXAM_PACK_SCHEMA_VERSION = 1;

export const SUPPORTED_EXAM_IDS = Object.freeze(['kaoyan_en1', 'cet4']);
export const SUPPORTED_SOURCE_TYPES = Object.freeze(['past_exam', 'synthetic', 'simulation', 'practice']);
export const SUPPORTED_UNIT_TYPES = Object.freeze(['reading_mcq', 'cloze_choice', 'paragraph_ordering', 'matching', 'translation']);
export const SUPPORTED_QUESTION_TYPES = Object.freeze(['single_choice', 'cloze_choice', 'paragraph_ordering_slot', 'matching_slot', 'translation_segment']);

export const STABLE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
export const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

// bankId is a globally unique semantic scope: it must never be reused across
// different exams or unrelated banks. packageId is only delivery provenance.

export const EXAM_STORES_V14 = Object.freeze([
  'examPackMeta',
  'examBanks',
  'examPapers',
  'examUnits',
  'examQuestions'
]);
