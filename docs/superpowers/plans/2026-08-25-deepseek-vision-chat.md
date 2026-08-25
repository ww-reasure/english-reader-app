# DeepSeek Vision Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage generation-settings “+” menu with a durable camera/gallery attachment flow, make `deepseek-v4-flash-vision-exp` the safe default, and preserve image-aware follow-up without repeatedly sending irrelevant images.

**Architecture:** Keep the existing `ChatService`, `ContextBuilder`, Agent tools, and `ConversationStore` as the single conversation system. Store optimized image blobs in a new IndexedDB v19 store, keep only lightweight attachment references in localStorage, upload images to DeepSeek Files API with 30-day expiry, and assemble multimodal content only for the current or explicitly referenced image group. Ordinary follow-ups use a deterministic visual summary; exact image follow-ups reattach file IDs or re-upload the local blob when the remote file expires.

**Tech Stack:** Vanilla ES modules, IndexedDB, browser File/Blob/Canvas/Crypto APIs, DeepSeek OpenAI-compatible Chat Completions/Responses/Files APIs, Vite, Capacitor Android, CSS, Node.js built-in test runner.

---

## Execution guardrails

- Read `docs/superpowers/specs/2026-08-25-deepseek-vision-chat-design.md` completely before editing.
- Create an isolated worktree from the source commit containing this plan. Recommended branch: `feat/deepseek-vision-chat`.
- Do not implement in the active `feat/english-practice-machine` checkout.
- Do not merge, push, tag, edit `main`, rewrite private exam packs, change SRS, or change daily-report facts.
- Preserve the existing home Agent tool loop, native web search, article-generation authorization, report cards, copy, selected-reply quoting, cancellation, and usage telemetry.
- Use TDD: run every stated RED test before production edits, then the stated GREEN tests.
- Use `apply_patch` for source/test/document edits. Formatting or generated build outputs may use their normal commands.
- Never persist Base64 or Blob data in `ConversationStore`/localStorage.
- Never send an image from a custom base URL configuration to official DeepSeek without explicit user configuration.
- Image extraction may suggest vocabulary, but must not write vocabulary, wrong-book, article, or report data without existing explicit confirmation flows.

## Target file map

### New production files

- `src/components/deepseek-model-catalog.mjs`: one model registry, capability resolution, and pure default-migration policy.
- `src/components/chat-image-policy.mjs`: limits, batch validation, inline safety calculation, deterministic eviction ordering, and image-reference intent.
- `src/components/chat-image-processor.js`: injected browser decode/re-encode/thumbnail/hash pipeline that strips metadata.
- `src/components/chat-image-service.js`: draft persistence, Files API lifecycle, retry, remote expiry, capacity pruning, and context cleanup orchestration.
- `src/components/multimodal-context.mjs`: convert text transcripts plus selected attachment groups into Chat Completions and Responses image blocks.

### Modified production files

- `src/config.js`: default Vision Exp model and one-time legacy-default migration.
- `index.html`: remove static duplicate preset assumptions and keep a model-select mount target.
- `src/views/settings.js`: render the shared model catalog and mark explicit model choices.
- `src/components/modal.js`: render the shared model catalog in API settings.
- `src/db.js`: IndexedDB v19 `chatImageAttachments` store and bounded CRUD helpers.
- `src/api.js`: request-level model selection, DeepSeek Files API upload/delete, inline image fallback, and multimodal completion options.
- `src/components/conversation-store.js`: versioned lightweight `imageGroup` metadata, image-aware summaries, and safe normalization.
- `src/components/context-builder.js`: include visual summaries as text while never receiving blobs.
- `src/components/chat-service.js`: preserve multimodal user content through the existing three-round tool loop.
- `src/components/deepseek-responses.mjs`: map multimodal Chat Completions content into Responses `input_text`/`input_image` items.
- `src/views/chat.js`: attachment sheet, camera/gallery inputs, draft strip, send/restore/retry, message gallery, active-image chip, and clear-context cleanup.
- `css/style.css`: responsive attachment sheet, thumbnail strip, message gallery, viewer, progress, error, and accessible focus states.

### New tests

- `tests/deepseek-model-catalog.test.mjs`
- `tests/chat-image-policy.test.mjs`
- `tests/db-chat-images.test.mjs`
- `tests/chat-image-processor.test.mjs`
- `tests/deepseek-files-api.test.mjs`
- `tests/chat-image-service.test.mjs`
- `tests/conversation-store-images.test.mjs`
- `tests/multimodal-context.test.mjs`
- `tests/chat-service-multimodal.test.mjs`
- `tests/chat-vision-view.test.mjs`
- `tests/chat-vision-style-contract.test.mjs`

### Existing tests to update or run

- `tests/conversation-store.test.mjs`
- `tests/context-builder.test.mjs`
- `tests/chat-service.test.mjs`
- `tests/chat-service-agent-tool.test.mjs`
- `tests/deepseek-responses.test.mjs`
- `tests/api-model-compat.test.mjs`
- `tests/app-shell.test.mjs`
- all `tests/*.test.mjs`

---

### Task 0: Create the isolated worktree and establish a clean baseline

**Files:**
- No tracked source changes.

- [ ] **Step 1: Confirm the source checkout and plan commit**

```powershell
$source = 'E:\play\claude\english-reader\mobile'
git -C $source rev-parse --show-toplevel
git -C $source status --short --branch
git -C $source log -1 --oneline
git -C $source ls-tree -r --name-only HEAD -- docs/superpowers/specs/2026-08-25-deepseek-vision-chat-design.md docs/superpowers/plans/2026-08-25-deepseek-vision-chat.md
```

Expected: source branch is `feat/english-practice-machine`, status is clean, and both design/plan paths are present in `HEAD`.

- [ ] **Step 2: Create the feature worktree**

```powershell
$source = 'E:\play\claude\english-reader\mobile'
$target = 'E:\play\claude\english-reader\mobile\.worktrees\deepseek-vision-chat'
git -C $source worktree add $target -b feat/deepseek-vision-chat HEAD
git -C $target status --short --branch
```

Expected: clean `feat/deepseek-vision-chat` worktree.

- [ ] **Step 3: Copy ignored private QA packs without tracking them**

```powershell
$sourcePacks = 'E:\play\claude\english-reader\mobile\public\exam-packs\private'
$targetPacks = 'E:\play\claude\english-reader\mobile\.worktrees\deepseek-vision-chat\public\exam-packs\private'
if (Test-Path -LiteralPath $sourcePacks) {
  New-Item -ItemType Directory -Force -Path $targetPacks | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourcePacks 'index.json') -Destination $targetPacks -Force
  Get-ChildItem -LiteralPath $sourcePacks -Filter '*.json' | Where-Object Name -ne 'index.json' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $targetPacks -Force
  }
}
git -C $target status --short
```

Expected: copied resources remain ignored and status stays empty.

- [ ] **Step 4: Run the complete baseline suite**

```powershell
Set-Location 'E:\play\claude\english-reader\mobile\.worktrees\deepseek-vision-chat'
node --test tests/*.test.mjs
```

Expected: 0 failures. Record actual totals. If an unrelated baseline failure occurs, compare the same test in the source checkout and report evidence before continuing; missing ignored private resources may be copied, but production behavior must not be weakened to mask a failure.

---

### Task 1: Centralize the DeepSeek model catalog and migrate only the old implicit default

**Files:**
- Create: `src/components/deepseek-model-catalog.mjs`
- Create: `tests/deepseek-model-catalog.test.mjs`
- Modify: `src/config.js`
- Modify: `index.html`
- Modify: `src/views/settings.js`
- Modify: `src/components/modal.js`
- Modify: `src/api.js`
- Test: `tests/api-model-compat.test.mjs`

- [ ] **Step 1: Write failing catalog, capability, and migration tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_MODEL_IDS,
  listDeepSeekModelPresets,
  modelCapabilities,
  resolveModelForRequest,
  resolveVisionDefaultMigration
} from '../src/components/deepseek-model-catalog.mjs';

test('Vision Exp is the default and is the only built-in image model', () => {
  assert.equal(DEFAULT_DEEPSEEK_MODEL, 'deepseek-v4-flash-vision-exp');
  assert.deepEqual(DEEPSEEK_MODEL_IDS, [
    'deepseek-v4-flash-vision-exp',
    'deepseek-v4-flash',
    'deepseek-v4-pro'
  ]);
  assert.equal(modelCapabilities('deepseek-v4-flash-vision-exp').images, true);
  assert.equal(modelCapabilities('deepseek-v4-flash').images, false);
  assert.equal(listDeepSeekModelPresets()[0].experimental, true);
});

test('only the old implicit Flash default migrates', () => {
  assert.equal(resolveVisionDefaultMigration({
    model: 'deepseek-v4-flash', explicitSelection: false, migrated: false
  }).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(resolveVisionDefaultMigration({
    model: 'deepseek-v4-flash', explicitSelection: true, migrated: false
  }).model, 'deepseek-v4-flash');
  assert.equal(resolveVisionDefaultMigration({
    model: 'deepseek-v4-pro', explicitSelection: false, migrated: false
  }).model, 'deepseek-v4-pro');
});

test('official DeepSeek may override a text model for one image turn but custom endpoints may not', () => {
  assert.equal(resolveModelForRequest({
    baseUrl: 'https://api.deepseek.com/v1', selectedModel: 'deepseek-v4-pro', hasImages: true
  }).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(resolveModelForRequest({
    baseUrl: 'https://gateway.example/v1', selectedModel: 'custom-model', hasImages: true
  }).error, 'custom_model_image_capability_unknown');
});
```

- [ ] **Step 2: Run the catalog tests and verify RED**

```powershell
node --test tests/deepseek-model-catalog.test.mjs tests/api-model-compat.test.mjs
```

Expected: FAIL because the shared catalog does not exist and Vision Exp is not the default.

- [ ] **Step 3: Implement the pure catalog contract**

Create these exports and keep labels in this order:

```js
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash-vision-exp';
export const DEEPSEEK_MODEL_IDS = [
  DEFAULT_DEEPSEEK_MODEL,
  'deepseek-v4-flash',
  'deepseek-v4-pro'
];

const PRESETS = [
  { id: DEFAULT_DEEPSEEK_MODEL, label: 'DeepSeek V4 Flash Vision Exp（默认·视觉）', images: true, files: true, tools: true, responses: true, experimental: true },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（快速）', images: false, files: false, tools: true, responses: true, experimental: false },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（高质量）', images: false, files: false, tools: true, responses: true, experimental: false }
];
```

`resolveModelForRequest` must return `{ model, temporaryOverride, capabilities }` for supported requests and `{ error }` for a custom endpoint whose image capability is unknown. Official URL matching must parse the URL hostname and accept only `api.deepseek.com`; do not use substring matching.

- [ ] **Step 4: Wire Config migration without overwriting explicit choices**

Use these persisted keys:

```js
model: DEFAULT_DEEPSEEK_MODEL,
model_selection_explicit: 'false',
vision_default_migration: '0'
```

At Config initialization, call the pure migration once. If the stored model is old implicit Flash, write Vision Exp and `vision_default_migration='1'`. Model controls in Settings/API modal write `model_selection_explicit='true'` only after a user change event, not while rendering defaults.

- [ ] **Step 5: Replace all duplicate preset rendering**

Render `listDeepSeekModelPresets()` in Settings and API modal, followed by “自定义模型”. Remove hard-coded Flash/Pro comparisons in `modal.js`; use catalog IDs and capability lookup. `index.html` should contain an empty/select fallback mount that JavaScript hydrates, not a second authoritative model list.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
node --test tests/deepseek-model-catalog.test.mjs tests/api-model-compat.test.mjs tests/settings-models.test.mjs tests/modal-api-settings.test.mjs
```

Expected: all selected tests pass, 0 fail. If the last two test files do not exist in the baseline, add equivalent assertions to `tests/deepseek-model-catalog.test.mjs` by reading the relevant source and checking it imports the shared catalog; do not create redundant production behavior.

- [ ] **Step 7: Commit**

```powershell
git add src/components/deepseek-model-catalog.mjs src/config.js index.html src/views/settings.js src/components/modal.js src/api.js tests/deepseek-model-catalog.test.mjs tests/api-model-compat.test.mjs tests/settings-models.test.mjs tests/modal-api-settings.test.mjs
git commit -m "feat(ai): default to DeepSeek vision model"
```

If optional baseline test paths do not exist, omit only those nonexistent paths from `git add`.

---

### Task 2: Define image limits, inline safety, eviction, and reference intent as pure logic

**Files:**
- Create: `src/components/chat-image-policy.mjs`
- Create: `src/components/multimodal-context.mjs`
- Create: `tests/chat-image-policy.test.mjs`
- Create: `tests/multimodal-context.test.mjs`

- [ ] **Step 1: Write failing policy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_IMAGE_LIMITS,
  validateImageBatch,
  canInlineImageBatch,
  selectCapacityEvictions,
  inferImageReference
} from '../src/components/chat-image-policy.mjs';

test('accepts twelve supported images and rejects the thirteenth', () => {
  const twelve = Array.from({ length: 12 }, (_, index) => ({ id: String(index), mimeType: 'image/jpeg', sizeBytes: 1000 }));
  assert.equal(validateImageBatch(twelve).ok, true);
  assert.equal(validateImageBatch([...twelve, { id: '13', mimeType: 'image/png', sizeBytes: 1000 }]).code, 'too_many_images');
});

test('inline fallback is bounded below DeepSeek request limits', () => {
  assert.equal(canInlineImageBatch([{ sizeBytes: 30 * 1024 * 1024 }]).ok, true);
  assert.equal(canInlineImageBatch([
    { sizeBytes: 17 * 1024 * 1024 },
    { sizeBytes: 16 * 1024 * 1024 }
  ]).code, 'inline_total_too_large');
  assert.equal(CHAT_IMAGE_LIMITS.inlineRawTotalBytes, 32 * 1024 * 1024);
});

test('capacity pruning never evicts protected attachments', () => {
  const records = [
    { id: 'active', sizeBytes: 80, protected: true, contextArchived: false, lastAccessedAt: 1 },
    { id: 'archived-old', sizeBytes: 70, protected: false, contextArchived: true, lastAccessedAt: 2 },
    { id: 'detached', sizeBytes: 60, protected: false, contextArchived: false, detached: true, lastAccessedAt: 3 }
  ];
  assert.deepEqual(selectCapacityEvictions(records, { currentBytes: 210, incomingBytes: 30, limitBytes: 200 }).map(row => row.id), ['archived-old']);
});

test('ordinary new topics do not reactivate raw images', () => {
  assert.equal(inferImageReference('帮我生成一篇四级阅读').kind, 'none');
  assert.equal(inferImageReference('继续讲刚才第二张图里的第三题').kind, 'current');
});
```

- [ ] **Step 2: Write failing multimodal assembly tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleChatMessages, messagesToVisionResponseItems } from '../src/components/multimodal-context.mjs';

test('replaces only the current user turn with text plus ordered file blocks', () => {
  const result = assembleChatMessages({
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: '讲解图片' }
    ],
    attachmentGroup: {
      prompt: '讲解图片',
      attachments: [
        { order: 1, remoteFileId: 'file-api-b' },
        { order: 0, remoteFileId: 'file-api-a' }
      ]
    }
  });
  assert.deepEqual(result.at(-1).content, [
    { type: 'text', text: '讲解图片' },
    { type: 'file', file_id: 'file-api-a' },
    { type: 'file', file_id: 'file-api-b' }
  ]);
});

test('Responses conversion preserves file IDs as input images', () => {
  assert.deepEqual(messagesToVisionResponseItems([{
    role: 'user',
    content: [{ type: 'text', text: 'read' }, { type: 'file', file_id: 'file-api-a' }]
  }])[0].content, [
    { type: 'input_text', text: 'read' },
    { type: 'input_image', file_id: 'file-api-a', detail: 'original' }
  ]);
});
```

- [ ] **Step 3: Run pure tests and verify RED**

```powershell
node --test tests/chat-image-policy.test.mjs tests/multimodal-context.test.mjs
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement exact limits and deterministic decisions**

Export this frozen limit object:

```js
export const CHAT_IMAGE_LIMITS = Object.freeze({
  maxImagesPerMessage: 12,
  targetBytesPerImage: 4 * 1024 * 1024,
  inlineSingleImageBytes: 32 * 1024 * 1024,
  inlineRawTotalBytes: 32 * 1024 * 1024,
  inlineEstimatedJsonBytes: 44 * 1024 * 1024,
  localFullBlobBytes: 200 * 1024 * 1024,
  maxDimension: 8192,
  remoteExpirySeconds: 2592000
});
```

Supported MIME values are exactly `image/jpeg`, `image/png`, `image/gif`, and `image/webp`. Base64 JSON estimation must use `Math.ceil(rawBytes / 3) * 4` plus a fixed 64 KiB envelope. Evictions sort archived first, then detached, then remaining eligible records; within a tier use `lastAccessedAt`, `createdAt`, and `id` ascending. Reference intent recognizes explicit image nouns/ordinals but returns `none` for independent generation/report/vocabulary requests.

- [ ] **Step 5: Implement format-neutral multimodal assembly**

`assembleChatMessages` must clone inputs, sort attachments by `order`, use `file` blocks when `remoteFileId` exists, use `image_url` data URLs only when `inlineDataUrl` was explicitly prepared by the service, and throw `image_payload_unavailable` if neither exists. `messagesToVisionResponseItems` must preserve system/developer/assistant text and only create image parts on user messages.

- [ ] **Step 6: Run pure tests and verify GREEN**

```powershell
node --test tests/chat-image-policy.test.mjs tests/multimodal-context.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/components/chat-image-policy.mjs src/components/multimodal-context.mjs tests/chat-image-policy.test.mjs tests/multimodal-context.test.mjs
git commit -m "feat(chat): define image attachment policy"
```

---

### Task 3: Add the IndexedDB v19 attachment store and bounded persistence

**Files:**
- Modify: `src/db.js`
- Create: `tests/db-chat-images.test.mjs`
- Modify: `tests/exam-db-migration.test.mjs`

- [ ] **Step 1: Write failing migration and CRUD tests**

Use the existing fake IndexedDB helpers from DB tests and assert:

```js
test('v19 creates chatImageAttachments without rewriting learning stores', async () => {
  const db = await DB.open();
  assert.equal(db.version, 19);
  assert.equal(db.objectStoreNames.contains('chatImageAttachments'), true);
  const tx = db.transaction('chatImageAttachments', 'readonly');
  const store = tx.objectStore('chatImageAttachments');
  for (const index of ['groupId', 'conversationKey', 'status', 'createdAt', 'lastAccessedAt']) {
    assert.equal(store.indexNames.contains(index), true);
  }
});

test('attachment blobs round trip while group order remains stable', async () => {
  const blob = new Blob(['image'], { type: 'image/jpeg' });
  await DB.putChatImageAttachment({
    id: 'img-1', groupId: 'group-1', conversationKey: 'home', order: 1,
    status: 'draft', blob, thumbnailBlob: blob, sizeBytes: blob.size,
    createdAt: 10, updatedAt: 10, lastAccessedAt: 10
  });
  await DB.putChatImageAttachment({
    id: 'img-0', groupId: 'group-1', conversationKey: 'home', order: 0,
    status: 'draft', blob, thumbnailBlob: blob, sizeBytes: blob.size,
    createdAt: 9, updatedAt: 9, lastAccessedAt: 9
  });
  assert.deepEqual((await DB.getChatImageGroup('group-1')).map(row => row.id), ['img-0', 'img-1']);
});

test('release removes full blob but keeps a safe placeholder and remote tombstone', async () => {
  await DB.releaseChatImageAttachment('img-1', { remoteDeletePending: true });
  const row = await DB.getChatImageAttachment('img-1');
  assert.equal(row.blob, null);
  assert.equal(row.status, 'delete_pending');
  assert.equal(row.remoteFileId, 'file-api-1');
});
```

- [ ] **Step 2: Run DB tests and verify RED**

```powershell
node --test tests/db-chat-images.test.mjs tests/exam-db-migration.test.mjs tests/knowledge-profile-db.test.mjs
```

Expected: FAIL because DB v19 and attachment methods do not exist.

- [ ] **Step 3: Add the v19 store**

Set `DB_VERSION: 19` and add only this store during upgrade:

```js
if (!db.objectStoreNames.contains('chatImageAttachments')) {
  const store = db.createObjectStore('chatImageAttachments', { keyPath: 'id' });
  store.createIndex('groupId', 'groupId');
  store.createIndex('conversationKey', 'conversationKey');
  store.createIndex('status', 'status');
  store.createIndex('createdAt', 'createdAt');
  store.createIndex('lastAccessedAt', 'lastAccessedAt');
}
```

Do not scan or rewrite existing records during upgrade.

- [ ] **Step 4: Add exact DB methods**

Implement:

```js
putChatImageAttachment(record)
getChatImageAttachment(id)
getChatImageGroup(groupId)
listChatImageAttachments({ conversationKey, statuses } = {})
updateChatImageAttachment(id, fields)
deleteChatImageAttachment(id)
releaseChatImageAttachment(id, { remoteDeletePending = false } = {})
deleteChatImageGroup(groupId)
getChatImageStorageBytes()
```

`releaseChatImageAttachment` sets `blob:null`, `sizeBytes:0`, `status:'released'` unless a remote deletion is pending, preserves the thumbnail until service policy removes it, and never touches conversation localStorage. `getChatImageGroup` sorts by numeric `order`, then ID.

- [ ] **Step 5: Run DB tests and verify GREEN**

```powershell
node --test tests/db-chat-images.test.mjs tests/exam-db-migration.test.mjs tests/knowledge-profile-db.test.mjs tests/article-catalog-db.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/db.js tests/db-chat-images.test.mjs tests/exam-db-migration.test.mjs
git commit -m "feat(chat): persist image attachments in IndexedDB"
```

Omit unchanged test paths from the commit.

---

### Task 4: Build the metadata-stripping browser image processor

**Files:**
- Create: `src/components/chat-image-processor.js`
- Create: `tests/chat-image-processor.test.mjs`

- [ ] **Step 1: Write failing injected-pipeline tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatImageProcessor } from '../src/components/chat-image-processor.js';

test('re-encodes, hashes, thumbnails, and reports actual output metadata', async () => {
  const calls = [];
  const processor = createChatImageProcessor({
    decode: async file => ({ bitmap: { close() {} }, width: 4032, height: 3024, orientation: 6, file }),
    encode: async input => (calls.push(input), new Blob(['clean'], { type: 'image/jpeg' })),
    makeThumbnail: async () => new Blob(['thumb'], { type: 'image/jpeg' }),
    digestHex: async () => 'abc123'
  });
  const result = await processor.process(new Blob(['exif-and-pixels'], { type: 'image/jpeg' }), { source: 'camera', filename: 'photo.jpg' });
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.sha256, 'abc123');
  assert.equal(result.sizeBytes, 5);
  assert.equal(result.thumbnailBlob.size, 5);
  assert.equal(calls[0].stripMetadata, true);
});

test('GIF is handled as a static first frame with a visible warning', async () => {
  const processor = createChatImageProcessor({
    decode: async file => ({ bitmap: { close() {} }, width: 640, height: 480, orientation: 1, file }),
    encode: async () => new Blob(['still'], { type: 'image/jpeg' }),
    makeThumbnail: async () => new Blob(['thumb'], { type: 'image/jpeg' }),
    digestHex: async () => 'gif-hash'
  });
  const result = await processor.process(new Blob(['gif'], { type: 'image/gif' }), { filename: 'scan.gif' });
  assert.equal(result.warning, 'animated_image_flattened');
  assert.equal(result.mimeType, 'image/jpeg');
});
```

- [ ] **Step 2: Run processor tests and verify RED**

```powershell
node --test tests/chat-image-processor.test.mjs
```

Expected: FAIL because the processor does not exist.

- [ ] **Step 3: Implement an injected, testable processor**

The public factory is:

```js
export function createChatImageProcessor({
  decode = decodeBrowserImage,
  encode = encodeBrowserImage,
  makeThumbnail = makeBrowserThumbnail,
  digestHex = sha256Hex
} = {}) {
  return { async process(file, options = {}) { /* complete pipeline */ } };
}
```

The browser implementation must draw decoded pixels onto a new canvas before encoding, which strips EXIF. Correct orientation before resizing. Preserve transparency as PNG; otherwise use JPEG/WebP quality steps `[0.9, 0.84, 0.78, 0.7]` until under the 4 MiB target or dimensions reach a readable floor. Never upscale. Cap each side at 8192px. Create a 320px thumbnail. Close `ImageBitmap` in `finally`.

- [ ] **Step 4: Add deterministic errors**

Use error codes:

```text
unsupported_image_type
image_decode_failed
image_encode_failed
image_dimension_exceeded
processed_image_too_large
```

Do not include local filesystem paths, Base64, EXIF, or API keys in error messages.

- [ ] **Step 5: Run processor tests and verify GREEN**

```powershell
node --test tests/chat-image-processor.test.mjs tests/chat-image-policy.test.mjs
```

Expected: all tests pass, 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/components/chat-image-processor.js tests/chat-image-processor.test.mjs
git commit -m "feat(chat): process private image drafts safely"
```

---

### Task 5: Add DeepSeek Files API lifecycle and request-level visual model routing

**Files:**
- Modify: `src/api.js`
- Create: `tests/deepseek-files-api.test.mjs`
- Modify: `tests/api-model-compat.test.mjs`

- [ ] **Step 1: Write failing Files API request tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { API } from '../src/api.js';
import { Config } from '../src/config.js';

const originalFetch = globalThis.fetch;
const fetchCalls = [];
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  async json() { return payload; },
  async text() { return JSON.stringify(payload); }
});
const installFetchRecorder = (payload, status = 200) => {
  fetchCalls.length = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return jsonResponse(payload, status);
  };
  return fetchCalls;
};
const installFetchSequence = responses => {
  fetchCalls.length = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    const next = responses.shift();
    return jsonResponse(JSON.parse(next.body || '{}'), next.status);
  };
};

test.beforeEach(() => {
  Config.set('base_url', 'https://api.deepseek.com/v1');
  Config.set('api_key', 'test-key');
  Config.set('model', 'deepseek-v4-pro');
});
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('uploadVisionFile uses user_data and a 30 day expiry', async () => {
  const calls = installFetchRecorder({ id: 'file-api-1', bytes: 5, created_at: 100 });
  const result = await API.uploadVisionFile(new Blob(['image'], { type: 'image/jpeg' }), 'image-01.jpg');
  assert.equal(result.id, 'file-api-1');
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/files');
  const form = calls[0].options.body;
  assert.equal(form.get('purpose'), 'user_data');
  assert.equal(form.get('expires_after[anchor]'), 'created_at');
  assert.equal(form.get('expires_after[seconds]'), '2592000');
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
});

test('deleteVisionFile treats missing remote files as success', async () => {
  installFetchSequence([{ status: 404, body: '{}' }]);
  assert.deepEqual(await API.deleteVisionFile('file-api-missing'), { deleted: true, alreadyMissing: true });
});

test('chatCompletion can override the model for one image request', async () => {
  const calls = installFetchRecorder({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  await API.chatCompletion([{ role: 'user', content: 'hi' }], { modelOverride: 'deepseek-v4-flash-vision-exp' });
  assert.equal(JSON.parse(calls[0].options.body).model, 'deepseek-v4-flash-vision-exp');
  assert.equal(Config.get('model'), 'deepseek-v4-pro');
});
```

- [ ] **Step 2: Run API tests and verify RED**

```powershell
node --test tests/deepseek-files-api.test.mjs tests/api-model-compat.test.mjs
```

Expected: FAIL because Files API methods and request-level override are absent.

- [ ] **Step 3: Implement multipart upload and DELETE**

Add:

```js
async uploadVisionFile(blob, filename, { signal = null } = {})
async deleteVisionFile(fileId, { signal = null } = {})
```

Upload uses the configured DeepSeek API key and configured official DeepSeek base URL, `FormData`, no manual multipart `Content-Type`, and a 10-minute request timeout. Delete URL-encodes `fileId`, accepts 2xx and 404, and rejects malformed IDs that do not match `/^file-api-[A-Za-z0-9_-]+$/`.

- [ ] **Step 4: Add request-level model override without global mutation**

Extend completion options:

```js
chatCompletion(messages, { tools = [], signal = null, temperature = 0.45, responseFormat = null, modelOverride = null } = {})
responsesCompletion(items, { tools = [], signal = null, temperature = 0.45, toolChoice = 'auto', modelOverride = null } = {})
```

Pass the selected model in the request body. Resolve DeepSeek thinking controls from the effective model. Do not write `Config.model` during a request.

- [ ] **Step 5: Add pure-text fallback only**

Expose a helper used by ChatService:

```js
isVisionModelUnavailable(error)
```

It matches official 400/404 model-unavailable responses but not image decode, authentication, quota, timeout, or safety errors. ChatService may retry pure text once with `deepseek-v4-flash`; requests containing images never use this fallback.

- [ ] **Step 6: Run API tests and verify GREEN**

```powershell
node --test tests/deepseek-files-api.test.mjs tests/api-model-compat.test.mjs tests/deepseek-responses.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/api.js tests/deepseek-files-api.test.mjs tests/api-model-compat.test.mjs tests/deepseek-responses.test.mjs
git commit -m "feat(ai): add DeepSeek vision file transport"
```

---

### Task 6: Orchestrate drafts, upload reuse, expiry recovery, capacity, and remote cleanup

**Files:**
- Create: `src/components/chat-image-service.js`
- Create: `tests/chat-image-service.test.mjs`
- Modify: `src/db.js` only if a missing atomic helper is exposed by the RED test.

- [ ] **Step 1: Write failing service tests with injected DB/API/clock**

```js
import { ChatImageService } from '../src/components/chat-image-service.js';
import * as policy from '../src/components/chat-image-policy.mjs';

const file = name => {
  const value = new Blob([name], { type: 'image/jpeg' });
  Object.defineProperty(value, 'name', { value: `${name}.jpg` });
  return value;
};

const attachment = (overrides = {}) => ({
  id: 'img-1', groupId: 'group-1', conversationKey: 'home', order: 0,
  status: 'sent', source: 'gallery', blob: file('stored'), thumbnailBlob: file('thumb'),
  mimeType: 'image/jpeg', filename: 'stored.jpg', width: 800, height: 600,
  sizeBytes: 6, sha256: 'hash-1', remoteFileId: null, remoteExpiresAt: null,
  visualSummary: '一张英语阅读题', createdAt: 10, updatedAt: 10, lastAccessedAt: 10,
  ...overrides
});

const createFixture = ({ now = 200, records = [], deleteFailure = false } = {}) => {
  const rows = records.map(row => ({ ...row }));
  const db = {
    records: rows,
    async putChatImageAttachment(row) {
      const index = rows.findIndex(item => item.id === row.id);
      if (index >= 0) rows[index] = { ...row }; else rows.push({ ...row });
      return row;
    },
    async getChatImageAttachment(id) { return rows.find(row => row.id === id) || null; },
    async getChatImageGroup(groupId) { return rows.filter(row => row.groupId === groupId).sort((a, b) => a.order - b.order); },
    async listChatImageAttachments({ conversationKey } = {}) { return rows.filter(row => !conversationKey || row.conversationKey === conversationKey); },
    async updateChatImageAttachment(id, fields) {
      const row = rows.find(item => item.id === id);
      Object.assign(row, fields);
      return row;
    },
    async releaseChatImageAttachment(id, { remoteDeletePending = false } = {}) {
      const row = rows.find(item => item.id === id);
      Object.assign(row, { blob: null, sizeBytes: 0, status: remoteDeletePending ? 'delete_pending' : 'released' });
      return row;
    },
    async deleteChatImageAttachment(id) {
      const index = rows.findIndex(row => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async getChatImageStorageBytes() { return rows.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0); }
  };
  let uploadIndex = 0;
  const api = {
    uploadCalls: [],
    deleteCalls: [],
    async uploadVisionFile(blob, filename) {
      this.uploadCalls.push({ blob, filename });
      uploadIndex += 1;
      return { id: uploadIndex === 1 && records.length ? 'file-api-new' : `file-api-${uploadIndex}` };
    },
    async deleteVisionFile(fileId) {
      this.deleteCalls.push(fileId);
      if (deleteFailure) throw new Error('offline');
      return { deleted: true };
    }
  };
  let idIndex = 0;
  const processor = {
    async process(blob, { filename, source }) {
      idIndex += 1;
      return {
        blob, thumbnailBlob: blob, filename, source, mimeType: 'image/jpeg',
        width: 800, height: 600, sizeBytes: blob.size, sha256: `hash-${idIndex}`
      };
    }
  };
  const service = new ChatImageService({
    db, api, processor, policy, now: () => now,
    createId: prefix => `${prefix}-${++idIndex}`
  });
  return { service, db, api };
};

test('creates a recoverable ordered draft and uploads each image once', async () => {
  const { service, db, api } = createFixture();
  const group = await service.createDraft([file('a'), file('b')], { conversationKey: 'home', source: 'gallery' });
  assert.equal(group.attachments.length, 2);
  const ready = await service.prepareForSend(group.groupId);
  assert.deepEqual(ready.attachments.map(row => row.remoteFileId), ['file-api-1', 'file-api-2']);
  assert.equal(api.uploadCalls.length, 2);
  assert.equal((await service.restoreDraft('home')).groupId, group.groupId);
  assert.equal(db.records.every(row => row.blob instanceof Blob), true);
});

test('expired file IDs are re-uploaded from the local blob', async () => {
  const { service, api } = createFixture({ now: 200, records: [attachment({ remoteFileId: 'file-api-old', remoteExpiresAt: 100 })] });
  const group = await service.prepareForSend('group-1');
  assert.equal(group.attachments[0].remoteFileId, 'file-api-new');
  assert.equal(api.uploadCalls.length, 1);
});

test('ordinary follow-up can use summary without uploading or attaching raw images', async () => {
  const { service, api } = createFixture({ records: [attachment({ status: 'sent' })] });
  const result = await service.resolveContext({ groupId: 'group-1', mode: 'summary' });
  assert.equal(result.attachments.length, 0);
  assert.match(result.visualSummary, /英语阅读题/);
  assert.equal(api.uploadCalls.length, 0);
});

test('clear context deletes local content immediately and queues failed remote deletion', async () => {
  const { service, db } = createFixture({ deleteFailure: true, records: [attachment({ remoteFileId: 'file-api-1' })] });
  await service.clearConversation('home');
  const row = db.records[0];
  assert.equal(row.blob, null);
  assert.equal(row.status, 'delete_pending');
});
```

- [ ] **Step 2: Run service tests and verify RED**

```powershell
node --test tests/chat-image-service.test.mjs tests/db-chat-images.test.mjs
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service interface**

```js
export class ChatImageService {
  constructor({ db, api, processor, policy, now = () => Date.now(), createId = defaultId }) {}
  async createDraft(files, { conversationKey = 'home', source = 'gallery' } = {}) {}
  async restoreDraft(conversationKey = 'home') {}
  async reorderDraft(groupId, orderedIds) {}
  async removeDraftImage(id) {}
  async prepareForSend(groupId, { signal = null } = {}) {}
  async markSent(groupId, { messageId, visualSummary }) {}
  async resolveContext({ groupId, mode = 'auto', userMessage = '', signal = null } = {}) {}
  async detachGroup(groupId) {}
  async enforceCapacity({ incomingBytes = 0, protectedIds = [] } = {}) {}
  async clearConversation(conversationKey = 'home') {}
  async retryRemoteDeletes({ limit = 20 } = {}) {}
  async collectOrphans(referencedAttachmentIds) {}
}
```

`prepareForSend` uploads only absent/expired file IDs, writes `uploading` before network work, restores `ready` with a safe error on failure, and applies inline fallback only through `canInlineImageBatch`. Upload expiry is `now + 2592000*1000` with a five-minute safety margin when checking reuse.

- [ ] **Step 4: Implement capacity and delete semantics**

`enforceCapacity` asks the pure policy for candidates and releases them in one deterministic sequence. It never releases current draft/uploading/current active IDs. `clearConversation` first removes content visibility and blobs locally, then attempts remote deletion; failures become `delete_pending` rows with `retryCount`, `nextRetryAt`, and no user content. Retry delays are 1 minute, 5 minutes, 30 minutes, 6 hours, then 24 hours capped.

- [ ] **Step 5: Run service tests and verify GREEN**

```powershell
node --test tests/chat-image-service.test.mjs tests/db-chat-images.test.mjs tests/chat-image-policy.test.mjs tests/chat-image-processor.test.mjs tests/deepseek-files-api.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 6: Commit**

```powershell
git add src/components/chat-image-service.js src/db.js tests/chat-image-service.test.mjs tests/db-chat-images.test.mjs
git commit -m "feat(chat): manage durable image context"
```

---

### Task 7: Extend ConversationStore and ContextBuilder with lightweight visual memory

**Files:**
- Modify: `src/components/conversation-store.js`
- Modify: `src/components/context-builder.js`
- Create: `tests/conversation-store-images.test.mjs`
- Modify: `tests/conversation-store.test.mjs`
- Modify: `tests/context-builder.test.mjs`

- [ ] **Step 1: Write failing normalization, archive, and context tests**

```js
import { ConversationStore } from '../src/components/conversation-store.js';
import { ContextBuilder } from '../src/components/context-builder.js';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
};

const seededImageConversation = count => {
  let now = 100;
  const store = new ConversationStore(memoryStorage(), () => ++now);
  for (let index = 0; index < count; index += 1) {
    store.append('home', {
      id: `user-${index}`, role: 'user', kind: 'text', content: `讲解图片 ${index}`,
      imageGroup: {
        groupId: `group-${index}`, attachmentIds: [`img-${index}`], count: 1,
        state: 'available', visualSummary: `第 ${index} 组英语阅读题`
      }
    });
    store.append('home', { id: `assistant-${index}`, role: 'assistant', kind: 'text', content: `讲解 ${index}` });
  }
  return store;
};

test('image messages keep references but reject blobs and data URLs', () => {
  const store = new ConversationStore(memoryStorage(), () => 100);
  store.append('home', {
    id: 'msg-1', role: 'user', kind: 'text', content: '讲解图片',
    imageGroup: {
      groupId: 'group-1', attachmentIds: ['img-1'], count: 1,
      state: 'available', visualSummary: '一张英语阅读题截图'
    }
  });
  const raw = store.storage.getItem('learningConversationsV2');
  assert.match(raw, /group-1/);
  assert.doesNotMatch(raw, /data:image|base64|Blob/);
});

test('archived image rounds contribute a bounded visual summary', () => {
  const store = seededImageConversation(30);
  store.maintainHomeConversation({ contextMaxRounds: 24, batchRounds: 8 });
  const session = store.getContextSession('home');
  assert.match(session.contextSummary, /图片组/);
  assert.match(session.contextSummary, /英语阅读题/);
  assert.equal(session.contextSummary.length <= 6000, true);
});

test('ContextBuilder includes summaries as text and never image storage fields', () => {
  const builder = new ContextBuilder();
  const messages = builder.build({
    kind: 'home', userMessage: '换个话题',
    messages: [{ role: 'user', kind: 'text', content: '图片问题', imageGroup: {
      groupId: 'group-1', attachmentIds: ['img-1'], visualSummary: '图片是一道阅读题'
    }}]
  });
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /图片是一道阅读题/);
  assert.doesNotMatch(serialized, /attachmentIds|remoteFileId|data:image/);
});
```

- [ ] **Step 2: Run conversation tests and verify RED**

```powershell
node --test tests/conversation-store-images.test.mjs tests/conversation-store.test.mjs tests/context-builder.test.mjs
```

Expected: FAIL because image-group normalization and summary formatting are absent.

- [ ] **Step 3: Upgrade ConversationStore state to version 6**

Allow versions 2–5 to migrate. Normalize `imageGroup` to only:

```js
{
  groupId: safeId,
  attachmentIds: safeIds.slice(0, 12),
  count: Math.min(12, safeIds.length),
  state: state === 'released' ? 'released' : 'available',
  visualSummary: clip(summary, 1600)
}
```

Reject properties named `blob`, `thumbnailBlob`, `inlineDataUrl`, `fileData`, `remoteFileId`, or values beginning `data:image`. Preserve `kind:'text'` so existing round counting remains correct.

- [ ] **Step 4: Add image-aware summary lines**

`summaryLineFor` emits one line in this shape:

```text
图片组（2张，可重新引用）：用户要求“讲解这两道题”；视觉摘要：两张英语阅读选择题，AI解释了定位依据与易错项。
```

Use “原图已释放” when state is `released`. Clip user text and summary before joining, then retain the existing global 6000-character cap.

- [ ] **Step 5: Keep ContextBuilder text-only**

When formatting a user text message with an image group, append a safe block:

```text
[历史图片摘要｜不是新上传图片]
图片组：group-1；数量：2；状态：可重新引用
摘要：...
```

Do not include attachment IDs, file IDs, local paths, Blob sizes, or storage state. The current raw attachments are added later by `multimodal-context.mjs`.

- [ ] **Step 6: Run conversation tests and verify GREEN**

```powershell
node --test tests/conversation-store-images.test.mjs tests/conversation-store.test.mjs tests/context-builder.test.mjs tests/context-builder-selected-excerpt.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/components/conversation-store.js src/components/context-builder.js tests/conversation-store-images.test.mjs tests/conversation-store.test.mjs tests/context-builder.test.mjs
git commit -m "feat(chat): preserve bounded visual memory"
```

---

### Task 8: Preserve images through ChatService tools and Responses conversion

**Files:**
- Modify: `src/components/chat-service.js`
- Modify: `src/components/deepseek-responses.mjs`
- Modify: `src/api.js`
- Create: `tests/chat-service-multimodal.test.mjs`
- Modify: `tests/chat-service.test.mjs`
- Modify: `tests/chat-service-agent-tool.test.mjs`
- Modify: `tests/deepseek-responses.test.mjs`

- [ ] **Step 1: Write failing multimodal tool-loop tests**

```js
import { ChatService } from '../src/components/chat-service.js';

const emptySession = () => ({ summary: '', messages: [], activities: [] });
const createService = api => new ChatService({
  api,
  builder: {
    build: ({ userMessage, toolResults = [] }) => [
      { role: 'system', content: 'system' },
      { role: 'user', content: userMessage },
      ...toolResults.map(result => ({ role: 'system', content: JSON.stringify(result) }))
    ]
  },
  agent: {
    async execute(name) { return { tool: name, status: 'ok' }; },
    async getLearningOverview() { return { status: 'ok' }; }
  },
  webResearch: { resolve: () => ({ native: false, tavily: true }) }
});

const createVisionUnavailableFixture = () => {
  const models = [];
  const error = Object.assign(new Error('API error: 404 - model not found'), { status: 404 });
  const api = {
    isVisionModelUnavailable: () => true,
    async chatCompletion(_messages, options) {
      models.push(options.modelOverride);
      if (options.modelOverride === 'deepseek-v4-flash') {
        return { message: { role: 'assistant', content: 'text fallback' } };
      }
      throw error;
    }
  };
  const shared = {
    sessionKey: 'home', kind: 'home', session: emptySession(),
    userMessage: '普通问题', modelOverride: 'deepseek-v4-flash-vision-exp'
  };
  return {
    service: createService(api),
    models,
    textInput: shared,
    imageInput: {
      ...shared,
      userMessage: '讲解图片',
      attachmentGroup: { prompt: '讲解图片', attachments: [{ order: 0, remoteFileId: 'file-api-1' }] }
    }
  };
};

test('image blocks survive an Agent tool call and the final round', async () => {
  const calls = [];
  const api = {
    async chatCompletion(messages, options) {
      calls.push(structuredClone({ messages, options }));
      if (calls.length === 1) return { message: {
        role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_learning_overview', arguments: '{}' } }]
      }};
      return { message: { role: 'assistant', content: '结合你的学习记录，这张图...' } };
    }
  };
  const service = createService(api);
  await service.ask({
    sessionKey: 'home', kind: 'home', session: emptySession(), userMessage: '结合我的情况讲解',
    attachmentGroup: { prompt: '结合我的情况讲解', attachments: [{ order: 0, remoteFileId: 'file-api-1' }] },
    modelOverride: 'deepseek-v4-flash-vision-exp'
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages.at(-1).content[1].file_id, 'file-api-1');
  assert.equal(calls[1].messages.some(message => Array.isArray(message.content) && message.content.some(part => part.file_id === 'file-api-1')), true);
});

test('pure text Vision Exp failure retries Flash once, image failure does not', async () => {
  const pure = createVisionUnavailableFixture();
  await pure.service.ask(pure.textInput);
  assert.deepEqual(pure.models, ['deepseek-v4-flash-vision-exp', 'deepseek-v4-flash']);
  const image = createVisionUnavailableFixture();
  await assert.rejects(() => image.service.ask(image.imageInput));
  assert.deepEqual(image.models, ['deepseek-v4-flash-vision-exp']);
});
```

- [ ] **Step 2: Run ChatService tests and verify RED**

```powershell
node --test tests/chat-service-multimodal.test.mjs tests/chat-service.test.mjs tests/chat-service-agent-tool.test.mjs tests/deepseek-responses.test.mjs
```

Expected: FAIL because `ask` cannot accept attachment groups or model overrides.

- [ ] **Step 3: Extend the `ask` contract**

Add optional fields without changing existing callers:

```js
async ask({
  sessionKey, session, userMessage, kind, pageContext = null,
  tools = LEARNING_TOOLS, executeTool = null, responseFormat = null,
  temperature = null, attachmentGroup = null, modelOverride = null
})
```

Build the normal transcript first, then call `assembleChatMessages({ messages: transcript, attachmentGroup })`. Preserve this assembled initial user message when appending assistant tool calls and tool results. Never insert image blocks into system, assistant, or tool messages.

- [ ] **Step 4: Pass the effective model through both transports**

`chatCompletion` and `responsesCompletion` receive `modelOverride`. Native web-search mode uses the updated Responses converter for `input_image/file_id`. If a custom gateway does not support function tools, retain the existing overview fallback but do not drop images; if it cannot accept images, propagate the capability error before the request.

- [ ] **Step 5: Keep authorization and telemetry unchanged**

The image message is still the current `userMessage` for `isGenerationAuthorized`. A photo does not authorize article generation by itself. Usage telemetry records returned usage normally but never stores file IDs or visual summaries.

- [ ] **Step 6: Run ChatService tests and verify GREEN**

```powershell
node --test tests/chat-service-multimodal.test.mjs tests/chat-service.test.mjs tests/chat-service-agent-tool.test.mjs tests/deepseek-responses.test.mjs tests/context-builder.test.mjs tests/generation-authorization.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 7: Commit**

```powershell
git add src/components/chat-service.js src/components/deepseek-responses.mjs src/api.js tests/chat-service-multimodal.test.mjs tests/chat-service.test.mjs tests/chat-service-agent-tool.test.mjs tests/deepseek-responses.test.mjs
git commit -m "feat(agent): support multimodal learning turns"
```

---

### Task 9: Replace the homepage “+” with camera/gallery UI and durable image messages

**Files:**
- Modify: `src/views/chat.js`
- Modify: `css/style.css`
- Create: `tests/chat-vision-view.test.mjs`
- Create: `tests/chat-vision-style-contract.test.mjs`
- Modify: `tests/app-shell.test.mjs`

- [ ] **Step 1: Write failing source/DOM contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chatSource = await readFile(new URL('../src/views/chat.js', import.meta.url), 'utf8');

test('homepage plus opens image actions and no longer renders generation settings', async () => {
  assert.match(chatSource, /aria-label="添加图片"/);
  assert.match(chatSource, /data-image-action="camera"/);
  assert.match(chatSource, /data-image-action="gallery"/);
  assert.doesNotMatch(chatSource, /id="difficultySelect"/);
  assert.doesNotMatch(chatSource, /id="topicSelect"/);
});

test('draft UI exposes ordered removal, retry, preview, and accessible progress contracts', () => {
  assert.match(chatSource, /data-chat-image-draft-id/);
  assert.match(chatSource, /data-image-order/);
  assert.match(chatSource, /data-chat-image-remove/);
  assert.match(chatSource, /data-chat-image-retry/);
  assert.match(chatSource, /data-chat-image-preview/);
  assert.match(chatSource, /aria-live/);
  assert.match(chatSource, /maxImagesPerMessage/);
});

test('only-image send uses the approved default instruction', () => {
  assert.match(chatSource, /DEFAULT_IMAGE_LEARNING_PROMPT/);
  assert.match(chatSource, /结合我当前的英语学习目标/);
  assert.match(chatSource, /按图片顺序/);
  assert.match(chatSource, /看不清的地方请明确指出/);
});

test('clearing context clears ConversationStore and image service together', () => {
  assert.match(chatSource, /conversationStore\.clear\(['"]home['"]\)/);
  assert.match(chatSource, /imageService\.clearConversation\(['"]home['"]\)/);
  assert.match(chatSource, /clearHistoryConfirmed/);
});
```

- [ ] **Step 2: Write failing style contracts**

```js
test('image UI is bounded and keyboard focus is visible', () => {
  for (const selector of ['.chat-image-draft-strip', '.chat-image-message-grid', '.chat-image-viewer', '.chat-image-action-sheet']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /\.chat-image-draft-strip[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.chat-container[\s\S]*overflow-x:\s*(?:clip|hidden)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\([^)]*min-width:\s*840px/);
});
```

- [ ] **Step 3: Run view/style tests and verify RED**

```powershell
node --test tests/chat-vision-view.test.mjs tests/chat-vision-style-contract.test.mjs tests/app-shell.test.mjs
```

Expected: FAIL because the current plus opens generation settings.

- [ ] **Step 4: Replace composer markup**

Remove `composerOptions`, `difficultySelect`, `topicSelect`, `topicInput`, and their event handlers. Keep quick-action topics and natural-language generation. Add:

```html
<button id="composerImageBtn" class="composer-icon-btn" type="button" aria-label="添加图片" aria-expanded="false">
  <i class="fa-solid fa-plus" aria-hidden="true"></i>
</button>
<input id="chatCameraInput" type="file" accept="image/*" capture="environment" hidden>
<input id="chatGalleryInput" type="file" accept="image/*" multiple hidden>
```

Render a bottom sheet with “拍照”“从相册选择”“取消”. Prevent more than 12 accepted images. File-picker cancellation is silent.

- [ ] **Step 5: Add ChatView image state and lifecycle**

Use this state contract:

```js
imageDraftGroupId: null,
activeImageGroupId: null,
imageDraftState: 'idle',
imageService: null,
_imageDraftObjectUrls: new Map(),
_imageActionCleanup: null,
_imageViewerCleanup: null
```

Instantiate `ChatImageService` once with existing `DB`, `API`, and processor. On render: retry bounded remote deletes, restore the home draft, render history, then run orphan collection using all message attachment IDs. On cleanup: revoke object URLs and remove listeners, but do not delete the durable draft.

- [ ] **Step 6: Render the draft strip and accessible ordering**

Each thumbnail has order number, remove, previous, next, and preview actions. Pointer drag may call the same `reorderDraft` method, but previous/next buttons are mandatory. Display processing/upload status through `aria-live`. Disable send while any item is processing/uploading or failed without a retry/removal decision.

- [ ] **Step 7: Send and persist a multimodal message atomically from the UI perspective**

Send sequence:

1. prepare group and obtain file IDs/inline payloads;
2. append/render the user message with a stable message ID and lightweight group refs;
3. call `chatService.ask` with `attachmentGroup` and request-level visual model;
4. append/render the assistant answer;
5. derive `visualSummary` from clipped user request + assistant answer and call `markSent`;
6. update the stored user message with the summary;
7. clear only the draft pointer, keep the sent group as `activeImageGroupId`;
8. on failure, keep draft/group data and show “重新分析”.

The approved default prompt is exactly:

```text
请识别这些图片的内容，并结合我当前的英语学习目标进行讲解。若包含文章或题目，请按图片顺序说明重点、答案依据、易错点和值得学习的词汇；看不清的地方请明确指出，不要猜测。
```

- [ ] **Step 8: Render sent image messages and current-image chip**

- Display up to four thumbnails, then `+n`.
- Open an in-app viewer with next/previous, zoom, close, and “继续询问这组图片”.
- Show `当前图片 · n张 ×` above the composer for the active group.
- `×` calls `detachGroup` and removes only the active pointer.
- “继续询问” restores the active pointer without duplicating a message.
- Released images show “原图片已因空间清理；仍可查看当时的文字回答”.

- [ ] **Step 9: Integrate topic switching and history reference**

Before each text-only send, call `inferImageReference`. Explicit image references resolve the current group; independent requests send only textual context. If the user mentions an old non-current group ambiguously, present a small “请选择要引用的图片组” action rather than sending every group.

- [ ] **Step 10: Integrate context clearing**

Convert `clearHistory` into an async confirmed path. Cancel active requests first, clear ConversationStore and legacy `ChatHistory`, await local `imageService.clearConversation('home')`, reset active/draft IDs, revoke previews, and render the existing fresh-conversation message. Remote delete failures remain background tombstones and do not keep old messages visible.

- [ ] **Step 11: Add responsive styles**

Requirements:

```css
.chat-container,
.chat-composer,
.chat-image-draft-strip,
.chat-image-message-grid { min-width: 0; }

.chat-container { overflow-x: clip; }
.chat-image-draft-strip { display: flex; overflow-x: auto; overscroll-behavior-inline: contain; }
.chat-image-message-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.chat-image-thumb img { width: 100%; height: 100%; object-fit: cover; }
```

At 840px and above, keep the existing tablet shell and cap thumbnail sizes; do not turn the homepage into a separate two-column product. The viewer may use the full content area. Every interactive control has `:focus-visible` and a minimum 44px touch target where it is not a compact thumbnail affordance.

- [ ] **Step 12: Run view/style tests and verify GREEN**

```powershell
node --test tests/chat-vision-view.test.mjs tests/chat-vision-style-contract.test.mjs tests/app-shell.test.mjs tests/conversation-store-images.test.mjs tests/chat-service-multimodal.test.mjs
```

Expected: all selected tests pass, 0 fail.

- [ ] **Step 13: Commit**

```powershell
git add src/views/chat.js css/style.css tests/chat-vision-view.test.mjs tests/chat-vision-style-contract.test.mjs tests/app-shell.test.mjs
git commit -m "feat(chat): add camera and gallery conversations"
```

---

### Task 10: Close regressions, build private QA, and verify Android behavior

**Files:**
- Modify only files required by scoped verification failures.
- Modify version metadata only in the final APK step, incrementing the current Android `versionCode` exactly once.

- [ ] **Step 1: Run all focused visual-chat tests together**

```powershell
node --test tests/deepseek-model-catalog.test.mjs tests/chat-image-policy.test.mjs tests/db-chat-images.test.mjs tests/chat-image-processor.test.mjs tests/deepseek-files-api.test.mjs tests/chat-image-service.test.mjs tests/conversation-store-images.test.mjs tests/multimodal-context.test.mjs tests/chat-service-multimodal.test.mjs tests/chat-vision-view.test.mjs tests/chat-vision-style-contract.test.mjs tests/conversation-store.test.mjs tests/context-builder.test.mjs tests/chat-service.test.mjs tests/chat-service-agent-tool.test.mjs tests/deepseek-responses.test.mjs tests/api-model-compat.test.mjs tests/app-shell.test.mjs
```

Expected: 0 failures.

- [ ] **Step 2: Run the complete regression suite**

```powershell
node --test tests/*.test.mjs
```

Expected: 0 failures. Record totals rather than copying an older baseline count.

- [ ] **Step 3: Run a source-level privacy audit**

```powershell
rg -n "data:image|base64|remoteFileId|thumbnailBlob|\bblob\b" src/components/conversation-store.js src/components/context-builder.js src/views/chat.js
rg -n "api_key|Authorization" src/components/chat-image-service.js src/components/chat-image-policy.mjs src/components/multimodal-context.mjs
```

Expected:

- ConversationStore/ContextBuilder contain no persisted Base64/Blob/file ID path.
- UI may create temporary object URLs but does not append them to ConversationStore.
- image service never persists API keys or Authorization values.

- [ ] **Step 4: Build the private QA web artifact**

```powershell
npm run build:private-qa
```

Expected: private pack validation, Vite build, and Capacitor sync exit 0; generated `www` contains the new visual-chat assets.

- [ ] **Step 5: Run desktop/mobile browser smoke tests**

Use the local Vite app and verify at approximately 390×844 and tablet rail width:

1. “+” opens camera/gallery actions, not generation settings.
2. Settings difficulty still controls generated article difficulty.
3. 12 selected images render in order; the 13th is rejected.
4. Remove, reorder, preview, cancel, send, retry, and draft restore work.
5. Only-image request uses the approved default prompt.
6. Sent messages show four thumbnails plus `+n`.
7. An unrelated text request does not resend images.
8. “回到刚才第二张图” and manual “继续询问” reactivate the correct group.
9. Closing the active-image chip preserves history.
10. Clearing context removes messages and local images while saved articles/learning records remain.
11. Long filenames, Chinese/English text, 12 thumbnails, and errors cause no page-level horizontal scroll.
12. Daily report, native web search, article generation, copy, quote, and cancellation still work.

- [ ] **Step 6: Increment Android versionCode once and build the private QA APK**

The plan baseline is semantic version `2.0.0`, Android `versionCode 42`. Verify it first:

```powershell
Get-Content -LiteralPath package.json -Raw
rg -n "versionCode|versionName" android package.json version.json 2>$null
```

Expected: `version.json` and `android/app/build.gradle` both report `2.0.0` / `42`. Use `apply_patch` to change only Android `versionCode` to `43` in both files and update `version.json.buildDate` to the actual build date. Keep `package.json`, `package-lock.json`, and Android `versionName` at `2.0.0`. Then run:

```powershell
npm run build:apk
```

Expected: Gradle debug APK build exits 0.

- [ ] **Step 7: Verify the build script output and SHA-256**

`scripts/build-apk.js` copies the verified APK to the shared root using the established name. Verify that exact output:

```powershell
$destination = 'E:\play\claude\EnglishReader-private-qa-v2.0.0-43-debug.apk'
if (-not (Test-Path -LiteralPath $destination)) { throw 'Expected private QA APK not found' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash
$hashFile = "$destination.sha256"
if (-not (Test-Path -LiteralPath $hashFile)) {
  Set-Content -LiteralPath $hashFile -Value "$hash  $([IO.Path]::GetFileName($destination))" -Encoding ascii
}
Write-Output $destination
Write-Output $hash
```

Expected: APK filename contains `v2.0.0-43`, and the sidecar SHA-256 value matches `Get-FileHash`.

- [ ] **Step 8: Install on an Android phone and run hardware smoke tests**

Verify:

1. Camera opens from the “拍照” action and returns a correctly oriented image.
2. Gallery supports selecting multiple images up to 12.
3. Denied permission shows a recoverable message.
4. Backgrounding during upload and reopening restores the draft/status.
5. Weak network failure keeps all selected images and supports retry.
6. Image text remains readable enough for article/question analysis.
7. Clearing context removes local image history after returning to the page.
8. Existing true-exam, vocabulary, review, report, and reading routes still open.

- [ ] **Step 9: Audit the approved design line by line**

Confirm explicitly:

- Vision Exp is default without overwriting explicit choices.
- plus menu is camera/gallery only.
- global Settings difficulty remains the generation source.
- maximum is 12 images.
- local image budget is 200 MiB.
- localStorage contains references/summaries only.
- Files API uses `purpose=user_data`, 30-day expiry, and delete cleanup.
- ordinary topics do not resend raw images.
- exact follow-up can reload file ID or local blob.
- custom endpoints never leak images to official DeepSeek.
- Agent tools and article authorization remain intact.
- no automatic vocabulary/report writes were added.
- no `main`, private-pack content, SRS, or exam data changes occurred.

- [ ] **Step 10: Commit verification/version changes**

If version metadata or scoped fixes changed tracked files:

```powershell
git status --short
git add version.json android/app/build.gradle
git add src/components/deepseek-model-catalog.mjs src/components/chat-image-policy.mjs src/components/chat-image-processor.js src/components/chat-image-service.js src/components/multimodal-context.mjs src/config.js index.html src/views/settings.js src/components/modal.js src/db.js src/api.js src/components/conversation-store.js src/components/context-builder.js src/components/chat-service.js src/components/deepseek-responses.mjs src/views/chat.js css/style.css
git add tests/deepseek-model-catalog.test.mjs tests/chat-image-policy.test.mjs tests/db-chat-images.test.mjs tests/chat-image-processor.test.mjs tests/deepseek-files-api.test.mjs tests/chat-image-service.test.mjs tests/conversation-store-images.test.mjs tests/multimodal-context.test.mjs tests/chat-service-multimodal.test.mjs tests/chat-vision-view.test.mjs tests/chat-vision-style-contract.test.mjs tests/conversation-store.test.mjs tests/context-builder.test.mjs tests/chat-service.test.mjs tests/chat-service-agent-tool.test.mjs tests/deepseek-responses.test.mjs tests/api-model-compat.test.mjs tests/app-shell.test.mjs tests/exam-db-migration.test.mjs
git commit -m "chore(android): prepare vision chat qa build"
```

Omit nonexistent and unchanged paths from `git add`. Before committing, inspect `git diff --cached --name-only` and remove any path outside the reviewed list. Do not create an empty commit. Do not add `www`, Gradle build directories, APKs, private exam packs, or local test artifacts unless they are already intentionally tracked by the repository.

- [ ] **Step 11: Return handoff evidence**

Report:

- branch and worktree path;
- complete commit hashes and subjects;
- focused and full test totals;
- private QA web build result;
- phone and tablet browser observations;
- Android hardware smoke observations;
- APK path, byte size, versionName, versionCode, and SHA-256;
- `git status --short --branch`;
- explicit statement that no merge, push, tag, `main`, SRS, report-fact, or private-pack content change occurred.

---

## Expected commit sequence

1. `feat(ai): default to DeepSeek vision model`
2. `feat(chat): define image attachment policy`
3. `feat(chat): persist image attachments in IndexedDB`
4. `feat(chat): process private image drafts safely`
5. `feat(ai): add DeepSeek vision file transport`
6. `feat(chat): manage durable image context`
7. `feat(chat): preserve bounded visual memory`
8. `feat(agent): support multimodal learning turns`
9. `feat(chat): add camera and gallery conversations`
10. `chore(android): prepare vision chat qa build`

The final commit is required only when version metadata or verification fixes are tracked. No empty commits.
