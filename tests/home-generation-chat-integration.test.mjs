import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('chat generation is owned by the route-independent coordinator', async () => {
  const source = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const cleanup = source.match(/cleanup\(\) \{([\s\S]*?)\n  \}\n\};/);

  assert.match(source, /import \{ HomeGenerationCoordinator \} from '\.\.\/components\/home-generation-coordinator\.mjs';/);
  assert.match(source, /const homeGenerationCoordinator = new HomeGenerationCoordinator/);
  assert.match(source, /executeHomeGenerationJob\(job,/);
  assert.match(source, /homeGenerationCoordinator\.start\(/);
  assert.match(source, /homeGenerationCoordinator\.resumePending\(\)/);
  assert.match(source, /beginHomeRequest\(\{ cancelGeneration: true, cancelReason: 'clear_context' \}\)/);
  assert.match(source, /homeGenerationCoordinator\?\.cancel\(cancelReason\)/);
  assert.match(source, /generationJobId:\s*job\.id/);
  assert.ok(cleanup, 'ChatView cleanup must stay inspectable');
  assert.doesNotMatch(cleanup[1], /homeGenerationCoordinator\.cancel/);
  assert.doesNotMatch(cleanup[1], /_generationController\?\.abort/);
});

test('agent tool execution uses the generation coordinator instead of the chat request signal', async () => {
  const source = (await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
  const start = source.indexOf('async executeHomeTool(');
  const end = source.indexOf('buildGenerationContext(', start);
  const implementation = source.slice(start, end);
  const coordinatorStart = source.match(/startHomeGenerationJob\(\{ kind, payload, cancelExisting = true \}\) \{([\s\S]*?)\n  \},\n\n  async publishHomeGenerationArticle/);

  assert.match(implementation, /startHomeGenerationJob\(/);
  assert.ok(coordinatorStart, 'generation start helper must stay inspectable');
  assert.match(coordinatorStart[1], /homeGenerationCoordinator\.start\(/);
  assert.doesNotMatch(implementation, /articleGenerationTool\.execute\(/);
  assert.doesNotMatch(implementation, /signal:\s*signal/);
});
