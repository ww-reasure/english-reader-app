import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadSession() {
  const sourceUrl = new URL('../src/components/tooltip-session.js', import.meta.url);
  const source = await readFile(sourceUrl, 'utf8');
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(dataUrl);
}

test('dismissal invalidates the active lookup session', async () => {
  const { TooltipSession } = await loadSession();
  const session = new TooltipSession();
  const lookupId = session.begin();

  assert.equal(session.isCurrent(lookupId), true);
  session.dismiss();
  assert.equal(session.isCurrent(lookupId), false);
});

test('starting another lookup invalidates the previous lookup session', async () => {
  const { TooltipSession } = await loadSession();
  const session = new TooltipSession();
  const firstLookupId = session.begin();
  const secondLookupId = session.begin();

  assert.equal(session.isCurrent(firstLookupId), false);
  assert.equal(session.isCurrent(secondLookupId), true);
});
