import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_THEME_ID, THEME_DEFINITIONS, resolveThemeId } from '../src/theme-contract.mjs';

test('theme registry keeps light and dark stable while rejecting unknown appearance ids', () => {
  assert.equal(DEFAULT_THEME_ID, 'light');
  assert.deepEqual(THEME_DEFINITIONS.map(theme => theme.id), ['light', 'dark']);
  assert.equal(resolveThemeId('dark'), 'dark');
  assert.equal(resolveThemeId('light'), 'light');
  assert.equal(resolveThemeId('future-theme'), DEFAULT_THEME_ID);
  assert.equal(resolveThemeId(''), DEFAULT_THEME_ID);
});
