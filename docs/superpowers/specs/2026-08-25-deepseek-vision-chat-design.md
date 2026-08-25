# 首页 DeepSeek 视觉对话与图片上下文设计

- 日期：2026-08-25
- 状态：已与用户逐节确认
- 目标基线：`feat/english-practice-machine`
- 推荐实现分支：`feat/deepseek-vision-chat`
- 作用范围：首页对话框 `#/chat`

## 1. 背景

首页对话框当前的“+”按钮打开文章难度与主题设置，但用户通常会直接用自然语言要求生成某类文章，因此该入口利用率低。与此同时，DeepSeek 已于 2026-08-21 发布实验视觉模型 `deepseek-v4-flash-vision-exp`，可在现有 OpenAI 兼容 Chat Completions、Responses API、Tool Calls 和 Files API 链路中接收图片。

用户希望把首页“+”改为图片入口，使内部学习 Agent 能处理拍摄或相册中的英语文章、真题、笔记、图表，也能根据图片生成学习材料。图片应像正常多模态对话一样进入当前上下文，但切换到普通话题后不能持续干扰或反复消耗图片输入。

当前实现的重要边界：

- 首页 Agent 经 `ChatService`、`ContextBuilder`、`API.chatCompletion` 或 Responses API 工作；
- 日报、学习数据、联网搜索、文章生成等能力共用同一工具循环；
- `ConversationStore v5` 把轻量对话元数据保存在 `localStorage`；
- 首页最多保留 50 轮显示记录，其中最近 24 轮进入完整模型上下文；
- IndexedDB 当前版本为 18，尚无聊天附件存储；
- `API.fetch` 当前默认固定读取 `Config.model`，没有请求级模型覆盖；
- 对话内容当前按字符串构建，不能直接承载图片块。

因此本功能必须扩展现有聊天系统，而不是复制一套“看图聊天”。

## 2. 已确认的产品决策

1. 首页“+”仅保留“拍照”和“从相册选择”。
2. 删除“+”中的文章难度与主题设置。
3. 生成文章的难度读取设置页现有全局目标难度；主题由用户消息决定，未指定时由 Agent 选择。
4. 每条消息最多 12 张图片。
5. 图片选中后先进入输入框，可继续输入要求；只发图片时自动使用默认学习讲解请求。
6. 图片跟随当前对话保存；清理上下文时一起删除。
7. 图片本地存储独立上限为 200 MiB，超限时清理最早的非保护图片。
8. 图片首次发送后支持连续追问。
9. 退出图片话题后，普通聊天不重复提交原图；再次提到或引用图片时按需激活。
10. 默认模型改为 `deepseek-v4-flash-vision-exp`；普通文字也直接使用视觉版。
11. 保留 Flash、Pro 与自定义模型选项。
12. 图片保留缩略图和历史记录；原图因容量释放后保留文字结果和明确占位。

## 3. 官方能力与工程安全线

官方文档：

- Vision：<https://api-docs.deepseek.com/guides/vision/>
- Files API：<https://api-docs.deepseek.com/guides/files_api>
- Models & Pricing：<https://api-docs.deepseek.com/quick_start/pricing/>
- Change Log：<https://api-docs.deepseek.com/updates/>

截至设计日期，官方约束为：

- 模型 ID：`deepseek-v4-flash-vision-exp`；
- 图片格式：JPEG、PNG、GIF、WebP；
- 单次最多 600 张，本产品收紧为 12 张；
- inline/URL 单张最多 32 MiB；Files API 单张最多 64 MiB；
- inline JSON 请求体最多 48 MiB；
- 不含 file ID 时图片总量最多 64 MiB；含 file ID 时总量最多 200 MiB；
- 12 张以内单边最大 8192px；
- 每张图片最多约 384 个图片 token；
- 视觉版文字价格与普通 Flash 相同，图片 token 按输入 token 计费；
- Files API `POST /files` 使用 `multipart/form-data`，`purpose=user_data`；
- Files API 支持 `DELETE /files/{file_id}`；
- 文件可以设置 1 小时至 30 天有效期，也可以永久保存。

产品内部采用更保守的安全线：

- 12 张上限；
- 单张处理后目标不超过 4 MiB；
- inline 降级的二进制总量不超过 32 MiB，估算后的 JSON 请求体不超过 44 MiB；
- Files API 上传统一设置 30 天有效期，过期后从本地按需重传；
- 本地完整图片总量 200 MiB；
- 不依赖 DeepSeek 服务端保存对话，因为 API 是无状态的。

## 4. 总体架构

采用“本地保存 + Files API + 文字视觉摘要 + 按需激活”的混合方案。

```text
首页 +
  -> 拍照 / 相册（最多 12 张）
  -> 格式、方向、尺寸和容量校验
  -> 清除 EXIF、生成优化图与缩略图
  -> IndexedDB 保存草稿
  -> Files API 上传（30 天有效）
  -> Vision Exp + 现有 Agent 工具循环
  -> 保存用户消息、AI 回答与视觉摘要
  -> 普通后续消息只携带摘要
  -> 图片相关追问按需重新引用 file_id
  -> file_id 过期则从 IndexedDB 自动重传
  -> 清理上下文时清理本地数据并删除远程文件
```

不采用：

- 每轮重复发送 Base64：移动端上传慢，容易撞 48 MiB 请求体限制；
- 每轮无条件带上所有 file ID：会重复处理旧图片、增加延迟和 token，并干扰新话题；
- 仅保存首次回答、不保留图片：无法准确追问遗漏的细节；
- 独立视觉聊天页：会割裂首页 Agent、学习工具和对话历史。

## 5. 模型目录与迁移

建立一个模型目录作为唯一事实源，消除 `config.js`、`index.html`、`settings.js` 与 `modal.js` 中重复的硬编码模型列表。

```js
{
  id: 'deepseek-v4-flash-vision-exp',
  label: 'DeepSeek V4 Flash Vision Exp（默认·视觉）',
  provider: 'deepseek',
  inputModalities: ['text', 'image'],
  supportsFiles: true,
  supportsTools: true,
  supportsResponses: true,
  experimental: true
}
```

迁移规则：

- 新安装默认视觉版；
- 旧用户仍为历史默认 `deepseek-v4-flash` 且没有“用户明确选模”标记时，升级一次到视觉版；
- 用户明确选择过 Flash、Pro 或自定义模型时不覆盖；
- 设置页重新选择模型后写入显式选择标记；
- 官方 DeepSeek 地址下，非视觉模型发送图片时可仅本轮临时使用 Vision Exp；
- 自定义地址或自定义模型不能自动把图片发送到官方 DeepSeek，避免跨服务泄露；未声明视觉能力时显示错误；
- 视觉版纯文字请求失败时可回退普通 Flash；带图片请求不得伪装成成功的文字回退。

## 6. 图片选择与处理

### 6.1 入口

“+”打开底部动作菜单：

- 拍照；
- 从相册选择。

优先使用 Android WebView 兼容的系统文件选择器：相机入口使用 `accept="image/*"` 与 `capture="environment"`，相册入口允许多选。仅在目标设备验证证明 WebView 方案不可靠时引入 Capacitor Camera 插件，避免无必要原生依赖。

### 6.2 草稿交互

- 最多 12 张；第 13 张立即给出明确提示；
- 缩略图按顺序编号；
- 支持删除、全屏预览和拖动排序；
- 显示“正在处理 n/总数”；
- 全部处理完成前禁用发送；
- App 意外退出后恢复未发送草稿；
- 发送失败保留文字与图片，不要求重新选择。

### 6.3 图片处理

对每张静态图片：

1. 解码实际文件内容，不信任扩展名；
2. 根据图像方向正确旋转；
3. 重新编码以清除 EXIF、GPS 和设备信息；
4. 保留适合放大查看和小字识别的优化图；
5. 生成约 320px 的缩略图；
6. 计算 SHA-256，用于同一草稿内去重和完整性校验；
7. 记录宽、高、MIME、字节数。

默认输出 JPEG 或 WebP；需要透明背景时保留 PNG。GIF 在 V1 中作为静态首帧处理，避免动画在历史缩略图与重传中产生不可控行为，UI 明确提示“已按静态图片处理”。

## 7. 数据模型

### 7.1 IndexedDB v19

新增对象存储 `chatImageAttachments`，不修改文章、词库、真题和学习数据表。

```js
{
  id: 'img_<uuid>',
  groupId: 'imggrp_<uuid>',
  conversationKey: 'home',
  messageId: 'msg_<uuid>' | null,
  order: 0,
  status: 'draft' | 'ready' | 'uploading' | 'sent' | 'released' | 'delete_pending',
  source: 'camera' | 'gallery',
  blob: Blob | null,
  thumbnailBlob: Blob | null,
  mimeType: 'image/jpeg',
  filename: 'image-01.jpg',
  width: 2048,
  height: 1536,
  sizeBytes: 1200000,
  sha256: '<hex>',
  remoteFileId: 'file-api-...' | null,
  remoteExpiresAt: 1789999999999 | null,
  uploadError: '' | '<safe message>',
  visualSummary: '',
  detached: false,
  contextArchived: false,
  createdAt: 1787600000000,
  updatedAt: 1787600000000,
  lastAccessedAt: 1787600000000,
  protected: false
}
```

索引：

- `groupId`；
- `conversationKey`；
- `status`；
- `createdAt`；
- `lastAccessedAt`。

### 7.2 对话消息

图片 Blob 永远不进入 localStorage。用户消息仍使用 `kind: 'text'`，保持当前轮次统计兼容，并增加轻量字段：

```js
{
  id: 'msg_<uuid>',
  role: 'user',
  kind: 'text',
  content: '请讲解这些题目',
  imageGroup: {
    groupId: 'imggrp_<uuid>',
    attachmentIds: ['img_1', 'img_2'],
    count: 2,
    state: 'available' | 'released',
    visualSummary: '用户发送两张英语阅读题……'
  },
  createdAt: 1787600000000
}
```

`visualSummary` 是首次用户要求、图片数量、AI 回答关键内容的确定性压缩，不为它额外调用一次模型。需要精确视觉细节时重新激活原图。

## 8. 200 MiB 容量管理

容量只统计完整优化图片 Blob，不把文章、词库、真题、学习记录算入图片额度。

保护项：

- 当前未发送草稿；
- 正在处理、上传或分析的图片；
- 当前激活图片组。

清理顺序：

1. 已进入上下文归档且最早访问的完整图片；
2. 已退出图片话题且最早访问的完整图片；
3. 其他非保护历史图片。

释放时：

- 删除完整 Blob 与可失效远程引用；
- 保留消息、AI 回答、视觉摘要和 `released` 占位；
- 缩略图可以保留在一个小型独立预算内；若总存储仍紧张则一起释放；
- 不删除当前草稿来给新选择让路；若无法腾出安全空间则要求用户分批发送。

对话压缩或消息裁剪后执行孤儿清理：没有任何消息、草稿或待删除任务引用的附件才能删除。

## 9. 图片上下文与话题切换

必须区分“图片仍保存在对话中”和“本轮请求需要重新看原图”。

### 9.1 当前图片组

发送后输入框上方显示：

```text
当前图片 · 12张  ×
```

- `×` 仅退出当前图片话题，不删除历史图片；
- 点击历史图片或“继续询问这组图片”重新设为当前组；
- 普通新话题仍保留视觉摘要，但不提交 file ID。

### 9.2 自动激活

多模态上下文选择器读取：

- 当前输入中的显式图片附件；
- 用户手动引用的历史图片组；
- 最新消息是否明确指向“刚才的图、第二张、图片里、这道拍下来的题”等；
- 当前图片组的摘要与时间位置。

只有明确相关或用户手动激活时才附带原图。无法可靠判断时使用摘要回答，并提示用户点击历史图片重新引用，不静默猜错图片组。

### 9.3 归档

当前 `ConversationStore` 在超过 24 个活跃用户轮次后会把旧轮次写入 `contextSummary`。图片轮次归档时加入：

- 图片组编号和数量；
- 用户原始要求；
- AI 回答摘要；
- 原图是否仍可重新激活。

历史图片仍可在 UI 查看，直到清理上下文或容量释放。

## 10. DeepSeek Files API 生命周期

### 10.1 上传

使用：

```text
POST /files
Content-Type: multipart/form-data
purpose=user_data
expires_after[anchor]=created_at
expires_after[seconds]=2592000
```

30 天过期可以降低远程孤儿风险；本地图片存在时，过期 file ID 在用户重新引用时自动重传。

### 10.2 删除

清理上下文或释放图片时调用：

```text
DELETE /files/{file_id}
```

- 本地上下文立即清除，不依赖远程删除成功；
- 网络失败时保留最小 tombstone：仅 `file_id`、重试次数和下次重试时间；
- 后续联网时指数退避重试；
- 404 视为已删除；
- tombstone 不保存图片、API Key 或用户文字。

### 10.3 inline 降级

Files API 上传失败时，仅当：

- 单张小于 32 MiB；
- 二进制总量不超过 32 MiB；
- 估算 JSON 请求体不超过 44 MiB；

才使用 Base64 `image_url` 降级。否则保留草稿并提示重试或分批发送。

## 11. 请求与 Agent 工具循环

### 11.1 模型覆盖

`API.fetch`、`chatCompletion`、`responsesCompletion` 增加请求级 `modelOverride`，但默认行为不变。图片请求由模型能力解析器选择视觉版，不能全局临时修改 `Config.model`，避免并发请求串模。

### 11.2 多模态组装

`ContextBuilder`继续构建纯文字学习上下文。新的多模态组装器在最终请求前把当前用户消息转换为：

```js
{
  role: 'user',
  content: [
    { type: 'text', text: '请讲解这些题目' },
    { type: 'file', file_id: 'file-api-1' },
    { type: 'file', file_id: 'file-api-2' }
  ]
}
```

Responses API 转换为 `input_text` 与 `input_image/file_id` 对应结构。纯文字消息保持字符串，避免无关回归。

### 11.3 工具循环

图片消息继续走现有 `ChatService`：

- 日报、学习数据、联网搜索和文章生成工具保持可用；
- 模型返回 tool call 后，下一轮 transcript 必须保留最初的图片用户消息；
- 工具结果只能返回现有受控数据，不能把本地图片路径或 Blob 暴露给模型；
- 图片提取出的单词可以展示，但写入词库仍需用户明确确认；
- 图片不能绕过现有“生成文章必须由当前用户明确授权”规则；
- 自定义模型不支持 tools 时保留现有无工具降级。

## 12. 首页 UI

### 12.1 输入区

- “+”按钮 aria-label 改为“添加图片”；
- 底部动作菜单可键盘和读屏访问；
- 图片草稿区位于引用上一条回复卡片与文本输入之间；
- 12 张缩略图横向滚动但页面本身不横向溢出；
- 拖动排序同时提供“前移/后移”无障碍操作；
- 处理、上传、重试和发送状态有文字，不只用转圈图标；
- 用户输入文字和已选图片至少存在一项时才允许发送。

### 12.2 消息气泡

- 最多直接显示 4 张缩略图；
- 更多显示 `+n`；
- 点击进入全屏图片查看器，可缩放和左右切换；
- 查看器提供“继续询问这组图片”；
- 图片已释放时显示具体占位，不显示破图；
- AI 回答继续使用现有 Markdown、复制和引用功能。

### 12.3 默认提示

用户只发图片时使用：

> 请识别这些图片的内容，并结合我当前的英语学习目标进行讲解。若包含文章或题目，请按图片顺序说明重点、答案依据、易错点和值得学习的词汇；看不清的地方请明确指出，不要猜测。

## 13. 清理与隐私

- 图片只在用户明确选择并发送后上传；
- 重新编码清除 EXIF、GPS 和设备信息；
- 图片不进入日报、学习档案、云同步或导出；
- 日报最多记录“使用过图片学习”这类非内容事件时，也不得包含 OCR 原文、图片摘要或 file ID；本期默认不新增该统计；
- API Key 不写入图片、消息或删除 tombstone；
- “清理上下文”二次确认后删除：对话消息、视觉摘要、本地附件、草稿和远程 file ID；
- 已保存阅读文章和正式学习数据不受影响；
- 远程删除失败不会阻塞本地清理；
- 自定义 Base URL 下不向官方 DeepSeek 自动发送图片。

## 14. 错误与恢复

- 相机/相册取消：不显示错误；
- 权限拒绝：显示系统设置指导；
- 不支持格式：指出具体文件；
- 第 13 张：保留前 12 张并提示上限；
- 压缩失败：保留其他成功图片，可移除失败项；
- 上传失败：保留草稿并支持单张或整组重试；
- AI 失败：消息和图片保留，可“重新分析”；
- App 退出：恢复草稿、处理结果和已上传 file ID；
- file ID 过期：本地存在时自动重传；本地已释放时使用摘要并说明限制；
- 清理过程中断：下次启动继续孤儿检查与远程 tombstone 重试；
- 纯文字视觉模型不可用：官方 DeepSeek 地址下回退普通 Flash，并显示一次非阻塞提示；
- 图片视觉模型不可用：不回退到文字模型，不声称已看到图片。

## 15. 可访问性与响应式

- 手机、平板竖屏和横屏均不产生页面级横向滚动；
- 底部动作菜单符合现有 App modal/sheet 视觉；
- 缩略图删除、排序、查看、重新引用都有可读标签；
- 拖动排序不是唯一排序方式；
- 处理进度使用 `aria-live`；
- 错误与恢复按钮可键盘操作；
- 图片查看器支持返回键关闭；
- 不降低现有输入框最小触控尺寸。

## 16. 测试与验收

### 模型与 API

1. 新安装默认视觉版。
2. 未显式选模的旧 Flash 用户迁移一次。
3. 显式 Pro、自定义和显式 Flash 不被覆盖。
4. 纯文字视觉失败可回退普通 Flash。
5. 图片请求不会回退到不支持图片的模型。
6. 自定义地址不会自动跨服务发送图片。
7. Files API 上传字段、30 天过期、查询和删除请求正确。
8. 404 删除按成功处理。
9. inline 降级严格遵守安全总量。
10. Chat Completions 和 Responses 都能转换图片内容块。

### 图片与存储

11. 1 张和 12 张成功，第 13 张被拒绝。
12. JPEG、PNG、WebP 可处理，GIF 按静态图提示。
13. 手机旋转方向正确。
14. EXIF/GPS 不进入输出 Blob。
15. 同一草稿重复图片按哈希去重。
16. 图片 Blob 不进入 localStorage。
17. 草稿在重启后恢复。
18. 200 MiB 清理顺序正确。
19. 当前草稿、上传和激活组不被清理。
20. 消息裁剪后孤儿附件被回收。
21. 清理上下文删除本地附件并创建必要 tombstone。
22. file ID 过期后自动重传。

### 对话与 UI

23. 图片加文字、只发图片和重新分析正常。
24. 缩略图删除、预览、排序和编号正常。
25. 图片消息显示前 4 张和 `+n`。
26. 普通新话题不重新提交原图。
27. “刚才第二张图”等请求正确激活对应组。
28. 点击 `×` 退出图片话题但不删除历史。
29. 点击历史图片可重新激活。
30. 原图释放时只使用摘要且明确提示。
31. 清理上下文后文字、图片、摘要全部消失。
32. 手机和平板无横向溢出。

### 回归

33. 日报工具保持只读且不包含图片内容。
34. 联网搜索工具在图片会话中仍可工作。
35. 文章生成仍要求当前用户明确授权，并读取设置页难度。
36. 图片提词不会未经确认写入词库。
37. 普通文字聊天、复制、引用、取消请求和错误重试不变。
38. 50 轮显示、24 轮上下文归档继续工作。
39. 全量 Node 测试零失败。
40. 私有 QA Web 构建与 Android APK 通过，手机完成拍照/相册/弱网冒烟。

## 17. 非目标

本期不做：

- PDF、Word、音频或视频上传；
- 图片生成、编辑或标注；
- 在真题辅导弹窗或阅读页增加图片；
- 独立 OCR 引擎或批量扫描归档；
- 图片云同步；
- 从图片自动写入词库、错题本或学习档案；
- 永久依赖 DeepSeek 远程文件保存；
- 修改真题包、SRS、日报统计口径或统一词库设计；
- 合并、推送或修改 `main`。

## 18. 交付边界

实现必须从 `feat/english-practice-machine` 的设计文档提交创建独立 worktree 和功能分支。采用测试先行和小提交；保留现有私有题包但不得改写。完成后运行聚焦测试、全量测试、私有 QA 构建、Android APK 构建和手机冒烟。最终只交付功能分支、提交序列、测试证据、APK 与 SHA-256；不自动合并或推送。
