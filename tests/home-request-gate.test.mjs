import assert from 'node:assert/strict';
import test from 'node:test';

test('only the newest home request remains active after a later request begins or clears the session', async () => {
  const { HomeRequestGate } = await import(new URL('../src/components/home-request-gate.mjs', import.meta.url));
  const gate = new HomeRequestGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(second), false);
});
