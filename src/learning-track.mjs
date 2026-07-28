/**
 * The target exam is a user-owned setting.  It is intentionally separate from
 * the reader's current recommendation (support / standard / stretch).
 *
 * `graduate` is retained only so saved, pre-migration articles remain truthful
 * about how they were generated.  It is never offered as a new target.
 */
export const CURRENT_TARGET_TRACKS = Object.freeze(['cet4', 'cet6', 'kaoyan1', 'kaoyan2']);
export const LEGACY_TRACK = 'graduate';

const LABELS = Object.freeze({
  cet4: '四级',
  cet6: '六级',
  kaoyan1: '考研英语一',
  kaoyan2: '考研英语二',
  graduate: '考研（旧版）'
});

const DESCRIPTIONS = Object.freeze({
  cet4: '大学英语四级导向阅读',
  cet6: '大学英语六级导向阅读',
  kaoyan1: '考研英语一导向阅读',
  kaoyan2: '考研英语二导向阅读',
  graduate: '历史考研导向阅读（旧版）'
});

const canonical = value => String(value || '').trim().toLowerCase();

export function isSelectableTrack(value) {
  return CURRENT_TARGET_TRACKS.includes(canonical(value));
}

/** Returns null instead of silently relabelling an old target. */
export function normalizeSelectableTrack(value) {
  const track = canonical(value);
  return isSelectableTrack(track) ? track : null;
}

/**
 * A fresh install has no user-owned target.  Do not let fallback display values
 * (such as the CET-4 option shown in a select) become an implicit generation
 * choice.  Existing installations that already persisted one of the four
 * current targets remain valid unless an explicit migration flag says they
 * must choose again.
 */
export function requiresTargetTrackSelection(targetTrack, selectionRequired) {
  if (canonical(selectionRequired) === 'true') return true;
  return !isSelectableTrack(targetTrack);
}

/** For stored articles, preserve the old `graduate` tag rather than guessing I/II. */
export function normalizeStoredTrack(value, fallback = 'cet4') {
  const track = canonical(value);
  if (isSelectableTrack(track) || track === LEGACY_TRACK) return track;
  return normalizeSelectableTrack(fallback) || 'cet4';
}

export function getTrackLabel(value) {
  return LABELS[normalizeStoredTrack(value)] || LABELS.cet4;
}

export function getTrackDescription(value) {
  return DESCRIPTIONS[normalizeStoredTrack(value)] || DESCRIPTIONS.cet4;
}

export function listSelectableTracks() {
  return CURRENT_TARGET_TRACKS.map(id => ({ id, label: LABELS[id], description: DESCRIPTIONS[id] }));
}
