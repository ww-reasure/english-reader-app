export const DEFAULT_THEME_ID = 'light';

export const THEME_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'light', label: '浅色', colorScheme: 'light' }),
  Object.freeze({ id: 'dark', label: '暗色', colorScheme: 'dark' })
]);

const THEME_IDS = new Set(THEME_DEFINITIONS.map(theme => theme.id));

export function resolveThemeId(themeId) {
  const normalized = String(themeId || '').trim().toLowerCase();
  return THEME_IDS.has(normalized) ? normalized : DEFAULT_THEME_ID;
}
