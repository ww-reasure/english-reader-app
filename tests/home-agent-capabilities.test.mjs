import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

test('home agent receives a stable capability index and read/display tools', async () => {
  const [chat, builder, capabilities] = await Promise.all([
    read('../src/views/chat.js'),
    read('../src/components/context-builder.js'),
    read('../src/components/app-capabilities.mjs')
  ]);

  assert.match(capabilities, /get_app_capabilities/);
  assert.match(capabilities, /offer_app_actions/);
  assert.match(chat, /APP_CAPABILITY_TOOLS/);
  assert.match(chat, /createCapabilityActionArtifact/);
  assert.match(chat, /capabilityIndex:\s*AppCapabilityRegistry\.compactIndex\(\)/);
  assert.match(builder, /this\.capabilityIndex/);
  assert.match(builder, /制定学习计划时/);
});

test('capability action artifacts are persisted and rendered as user-clicked links', async () => {
  const chat = await read('../src/views/chat.js');

  assert.match(chat, /artifact\.type === 'app_actions'/);
  assert.match(chat, /kind:\s*'app_actions'/);
  assert.match(chat, /addAppActionsToDOM/);
  assert.match(chat, /href="\$\{esc\(action\.route\)\}"/);
  assert.doesNotMatch(chat, /location\.hash\s*=\s*action\.route/);
});

test('home append path keeps fifty visible rounds and uses the bounded context session', async () => {
  const chat = await read('../src/views/chat.js');

  assert.match(chat, /conversationStore\.maintainHomeConversation\(\)/);
  assert.match(chat, /conversationStore\.getContextSession\('home'\)/);
  assert.doesNotMatch(chat, /appendConversation\(message\)[\s\S]{0,180}conversationStore\.compact\('home', 16\)/);
});
