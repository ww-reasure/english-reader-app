# 音频缓存系统实施计划

> 日期：2026-06-07
> 目标：删除 TTS 模块，用 Cache API 实现离线音频缓存
> 流程：superpowers Phase 2 → Phase 3

## 设计决策

- **缓存方案**：Cache API（浏览器/WebView 原生支持，无大小限制）
- **音频源**：Free Dictionary API（真人发音，免费）
- **去重**：词根还原（getStemForm）
- **并发控制**：每批 5 个，避免限流
- **失败策略**：静默跳过，不阻塞用户

## 任务清单

### Task 1: 新建 `js/audio-cache.js` 模块
- Cache API 封装（get/set/has/clear/size）
- `getAudio(word)` — 缓存优先播放
- `preloadWords(words)` — 批量预加载（去重+并发控制）
- `getCacheSize()` — 返回缓存大小
- `clearCache()` — 清除所有缓存
- 预计：50-80 行

### Task 2: 删除 `js/tts.js`
- 删除文件
- `index.html` 移除 `<script src="js/tts.js">`
- `index.html` 添加 `<script src="js/audio-cache.js">`
- 预计：3 处改动

### Task 3: 改造 `js/components/tooltip.js`
- 发音按钮改用 `AudioCache.getAudio(word)`
- 移除 TTS 相关调用
- 预计：5 行改动

### Task 4: 改造 `js/views/reading.js`
- 页面加载时调用 `AudioCache.preloadWords(article)`
- 预计：5 行改动

### Task 5: 改造 `js/views/chat.js`
- 文章生成完成后调用 `AudioCache.preloadWords(article)`
- 显示预加载进度
- 预计：10 行改动

### Task 6: 改造 `js/views/settings.js`
- 添加「发音缓存」区域
- 显示缓存大小
- 清除缓存按钮
- 预计：20 行改动

### Task 7: 改造 `js/components/tooltip.js` — 移除 TTS 引用
- 移除 `TTS.setAudioUrl` 调用
- 移除 `TTS.speak` 调用
- 预计：5 行改动

### Task 8: CSS 更新
- 预加载进度条样式
- 缓存管理样式
- 预计：15 行

### Task 9: 验证
- Web 版本测试（有网络/无网络）
- APK 打包测试
- Git 提交

## 执行顺序

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9

## 风险

| 风险 | 应对 |
|------|------|
| Cache API 在旧 WebView 不支持 | 降级到在线播放（已有 fallback） |
| Free Dictionary API 限流 | 并发控制 5 个 + 失败静默 |
| 缓存占用过多空间 | 设置页面可手动清理 |
