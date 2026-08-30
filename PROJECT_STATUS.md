# English Reader 私人版项目交接

更新时间：2026-08-30（App 内统一点词与句子分析布局修复后）

## 当前状态

- 当前产品线：English Reader 私人版，代码根目录为 `E:\play\claude\english-reader\mobile`。
- 私人远程：`private` → `ww-reasure/english-reader-private`；`private/main` 是私人版正式主线。
- 公共远程：`origin` → 原公共产品线；本次交接不操作 `origin`。
- 当前工作分支：`feat/app-wide-word-lookup`；性能、复习可靠性和平板适配已形成本地基线提交 `fa02328`，本轮统一点词功能只保存在本地功能分支，未推送任何远程。
- 实施记录见 `docs/superpowers/plans/2026-08-29-app-performance-review-reliability.md` 与 `docs/superpowers/plans/2026-08-30-app-wide-word-lookup.md`。
- 应用版本：`2.0.0`，Android `versionCode=48`。

## 当前目标

继续维护与发布私人版 English Reader：

1. 保持阅读、词汇、复习、真题、学习档案和首页 Main Agent 之间的事实口径一致。
2. 保持正式复习的最终一致性、幂等性和可恢复性，不因 UI 优化丢评分或重复推进 SRS。
3. 保持阅读进度、阅读活动、日报和 Agent Tool 的本地事实链路可追踪。
4. 私人版独立维护、独立构建、独立发布；未经明确授权不向任何远程推送。
5. 以真实内容首帧而非 Loading 挂载为性能口径，保持常驻外壳、缓存优先、渐进增强和无阻塞评分。
6. 同一套页面同时适配手机、竖屏平板、横屏平板和短横屏，不以简单等比放大替代信息密度与交互布局调整。

## 已完成内容

### 产品与 Agent

- 首页 Main Agent 支持普通对话、文章生成、分步互动教学、图片上下文和联网研究能力。
- 首页快捷“今日日报”已统一走普通 Agent 请求链路：写入用户消息，由模型在 `tool_choice=auto` 下自主调用日报 Tool，再发布回复和 `daily_learning_report` artifact。
- 已提供今日/历史日报、近期学习活动、学习档案、真题学习概览、复习队列等只读 Agent Tools。
- Daily Report 已收口为本地事实优先：数据状态区分 `available`、`empty`、`partial`、`unavailable`；旧日报中的有界 `aiAnalysis` 仍可读取，但不再由旧 Analyzer 主动生成。
- `get_learner_profile()` 提供配置与有界能力证据；整体画像第一版只允许 `insufficient` / `provisional`，不把目标覆盖率、收藏词或加入词库当作实测掌握率。
- 首页会话保留既有轮次上限，并按稳定消息 identity 同步裁剪 DOM；历史图片 ObjectURL 在对应节点被移除时释放。

### 词汇、导入与发音

- 收藏词与导入词已统一投影到 canonical vocabulary library；来源可同时为“收藏”和“导入”，旧数据可兼容显示。
- 词库支持来源、学习状态、搜索和排序；默认按最近加入，管理/选词入口位于可见内容区域。
- 专项复习支持今日新增、最近 7 天新增和手动选词；练习评分只写 `practice-flashcard` 事件，不改变正式 SRS；进度按事件事实统计并支持中途恢复与跨日窗口。
- PDF/文本导入支持预览、重复词分类、可恢复批处理；PDF 唯一词上限为 5000，每批最多 200；批量预分析复用数据库连接，重复点击有并发锁。
- 发音优先使用免费真人录音来源，并保留缓存与多来源解析；当前不会把低质量 TTS 作为首选。
- 完整单词详情、词根/记忆、同根词、词组、近义词和例句使用共享学习资料层，远程资料按需加载并缓存。

### 正式复习与持久化

- 正式回忆复习和语境复习共用 `learnWords` / `ReviewQueue` 事实源；语境模式只额外筛掉没有可用语境的词，不从正式词库删除。
- 调度已拆为会话内重插、Recovery 和长期 SRS 三层：忘记/模糊按“隔若干其他词”重插，Recovery 不依赖用户必须在真实分钟数后回来。
- 正式复习使用 optimistic UI；评分先进入 localStorage durable journal，后台串行写 IndexedDB，失败可重试，应用重启可 replay。
- `attemptId` + `expectedRevision` 保证同一评分幂等并防止跨模式并发覆盖；结果页显示真实 queued/running/failed/saved 状态。
- 专项练习保持独立路径，不调用正式 SRS 写入。
- 诊断日志记录评分链路、数据库、网络和异常阶段；支持详细模式、应急环和用户主动导出，不自动上传敏感内容。

### 阅读与真题

- 阅读支持计时、跨日活动切片、持续阅读进度、逐句导读进度、review-reading 明确评分恢复、completionId 幂等和 cleanup retry。
- readingStats、qualified reading evidence、review-mode SRS/context exposure 使用同一阅读 cycle 的稳定 completionId；同一 cycle 重试不重复事实，新 cycle 可再次统计。
- 日报读取当天的阅读活动和 completion，不会因未来日期完成同一 cycle 而反向改写历史日报。
- 阅读页已改为专注阅读布局：顶部保留返回、收藏和更多操作；逐句导读为主操作，其余工具进入风格统一的 Bottom Sheet；不改阅读业务逻辑。
- 真题训练已接入私有题包、整卷/分类练习、答案解析、错题、翻译训练、学习统计和宽屏双栏布局；私有题包加载失败可降级，不阻断页面启动。
- 英语一解析转换与 schema 校验会拦截已确认的教学附录污染；CET4 历史解析不套用英语一清理规则。

### 无感切页与底层性能优化（2026-08-30）

- AppShell 现在常驻；路由在独立 staging outlet 中准备目标页，完成 DOM 提交后再原子切换，不再靠全屏通用 Loading 掩盖等待，也不会提前清空当前页。
- 保留导航 token、迟到 render 抑制、同视图串行化与 teardown 竞态防护；核心根页面支持 `activate/deactivate/dispose` 生命周期及最多 3 页的 Keep-Alive LRU，恢复 DOM、滚动和筛选状态。
- 路由支持模块/数据 Promise 去重预热：首帧后空闲预热高价值入口，菜单按下/聚焦时即时预热；阅读、闪卡和真题作答等重会话仍按需加载。
- 性能链路记录点击、路由、模块、缓存、DOM、双 `requestAnimationFrame` 内容首帧及可交互阶段；日志在首帧后合并写入，并监测超过 50 ms 的长任务。
- 词汇页改为 revision 内存快照、只读批量查询和约 120 行以内窗口化 DOM；搜索、筛选、菜单和选择只操作内存模型；闪卡按 ID 在一次只读事务中批量取词。
- 阅读正文先提交，词形、生词、进度、活动、音频等在首帧后渐进增强；历史、统计、书架和真题首页采用缓存先显示、后台刷新。
- IndexedDB 升至版本 23：增加一次性迁移标记、复合索引和轻量真题概览；完整试卷不再重复保存在概览记录中，升级迁移保留旧数据。
- 启动时同步挂载外壳，并行读取配置、预连接数据库和加载首路由；删除未使用的 Android TTS 初始化/插件/Manifest 查询，真人录音与 AudioCache 发音路径保持。
- 删除约 2 MB 全局纸张纹理并用小型 CSS 噪点替代；构建不再复制未使用的 `www/src`。WebView 异步预启动作为默认关闭的 A/B 实验，仅在同机中位数至少改善 5% 时保留。

### 平板适配（2026-08-30）

- AppShell 明确区分根页面 rail 模式和阅读、复习、真题作答等 focus 模式；focus 页面在平板上不再泄漏全局侧栏或侧栏遮罩，返回式 Header 使用完整可用宽度。
- 修复词汇、真题等根页面在 768–1024 px 下仍为隐藏菜单预留列而导致标题被压缩的问题；rail 宽度随视口自适应，根页面与返回页面分别使用正确的 Header 网格。
- 600–719 px 内容卡片保持单列，720–1199 px 使用双列，1200 px 起才扩展为三列；避免小平板过密和大平板空间浪费。
- 阅读操作、逐句导读等覆盖层在平板上改为右侧有界侧栏；普通模态框、单词详情和闪卡信息层保持居中有界，不再拉伸到整块屏幕。

### App 内统一点词与句子分析布局（2026-08-30）

- 新增共享 `bindLearningTextLookup()`：普通学习文本单击查词，真题英文选项仅长按查词；按钮、链接、输入区、代码块和显式禁用区域不会触发。
- 真题选项长按固定为 450 ms、移动阈值 12 px；成功长按只抑制紧随其后的一次答题点击，短按答题与阅读正文长按句子问 AI 保持原行为。
- 阅读标题/正文/导读、AI 分析结果、闪卡和单词详情例句/短语、语境复习、测评及真题正文/题干/解析/结果已接入统一委托；首页仅明确导学卡接入，普通聊天消息不接入。
- 释义卡支持 compact/full；统一点词默认 compact，本地释义先显示、语境义异步补充、更多释义按需展开，失败只显示短错误与显式重试，不自动让 AI 猜词。
- 收藏成员判断使用统一词库 revision 快照内存索引，同 revision 只构建一次，点词过程不再调用 `DB.getAllWords()` 全量扫描。
- AI 句子分析面板隔离通用 `.modal::before` 装饰，删除空 Footer，固定为 Header / 可滚动 Body / Composer 三段；标题使用不透明背景和独立层级，正文与追问输入不再互相覆盖。
- 首页导学查词模块只在导学内容真实出现时动态加载，避免普通首页启动为低频能力付出额外模块加载。
- 自动验证：1501 tests / 1484 pass / 0 fail / 17 skip；public/private-qa 双构建通过；入口 274.80 kB raw / 81.15 kB gzip；private-qa 包含 5 个授权/合成题包，public 不含私有题包。
- 交付产物：`E:\play\claude\EnglishReader-private-qa-v2.0.0-48-debug.apk`。最终 SHA-256 以功能提交后的重建结果为准。
- 当前 Codex 内置浏览器测量运行时因本机 kernel assets 路径错误不可用，因此 12 组真实矩形测量和手机/平板可视冒烟未伪造为完成；CSS 三段式不重叠契约已自动化，真实设备冒烟仍列为发布前检查。
- 针对高度不超过 700 px 的横屏/分屏场景压缩 Header、侧栏、操作行和复习卡间距；保留安全区、旋转、可调整窗口和触控尺寸约束。
- 已以 768×1024 竖屏、1024×640 横屏逐页截图核对词汇、阅读、闪卡和真题入口；Android Manifest 保持可旋转、可调整大小且包含屏幕尺寸变化处理。

## 关键技术决策与不可破坏约束

- 技术栈是无框架 ES Module SPA + Vite + Capacitor Android；`src/`、`css/`、`public/` 是源文件，`www/` 和 Android WebView assets 是构建产物，不手工编辑。
- IndexedDB 当前版本为 23，只做增量迁移；已有学习数据、用户答题记录、日报和 SRS 不清库、不批量重写。
- `learnWords` 是正式 SRS 唯一事实源；`vocabulary` 是词库来源/展示域，不能把收藏或导入直接解释为已掌握。
- 日报 Tool 只提供本地、有界事实；Main Agent 负责根据用户问题总结。不要重新引入独立日报 Analyzer 或硬编码 Intent Router。
- `tool_choice=auto` 保持不变。修改 Agent Tool 必须检查 definition → registration → model tools → dispatch → service → result → context/UI 完整链路。
- 正式评分必须保留 journal、`attemptId`、`expectedRevision` 和 review event 审计；不要把“进入 journal”称为“IndexedDB 已保存”。
- readingProgress 的 completion cleanup 与 completion facts 分阶段；cleanup 失败时保留可重试状态，重试不得重新写统计、evidence 或 SRS。
- 专项复习永远不修改 `nextReview`、`interval`、`state`、`easeFactor`、`reviewCount`、`reviewRevision`。
- 用户 API Key、请求正文、完整对话、文章全文、私有题包原始来源和个人数据不得写入日志、提交或发布包之外的公共远程。

## 核心文件与职责

| 领域 | 核心文件 | 后续修改提示 |
|---|---|---|
| 应用入口/路由 | `src/app.js`、`src/router.js`、`src/components/app-shell.js` | 启动、生命周期、Header 和 hash 路由的全局边界；不要在页面里复制 Shell 逻辑。 |
| 首页 Agent | `src/views/chat.js`、`src/components/chat-service.js`、`src/components/learning-agent.js`、`src/components/context-builder.js` | Tool 结果最终经 Main Agent 回到消息/ artifact；快捷入口必须复用普通发送链路。 |
| 日报/画像 | `src/daily-learning-report.mjs`、`src/daily-learning-report-service.mjs`、`src/learner-profile.mjs`、`src/knowledge-profile.mjs`、`src/components/daily-report-card.mjs` | 事实状态、有界输出和旧 saved analysis 兼容是边界。 |
| 数据库 | `src/db.js` | IndexedDB 版本 23；包含学习词、复习事件、阅读统计/进度、活动、日报、诊断和真题状态等存储。新增字段/索引须增量迁移。 |
| 复习 | `src/learning-scheduler.mjs`、`src/recovery-scheduler.mjs`、`src/review-queue.js`、`src/review-queue-coordinator.mjs`、`src/review-session.mjs`、`src/review-persistence.mjs`、`src/views/flashcard.js`、`src/views/context-review.js` | UI 不等待慢写入；最终一致性由 journal、事务和幂等键保证。 |
| 词库/导入 | `src/vocabulary-library.mjs`、`src/views/vocabulary.js`、`src/word-import-service.mjs`、`src/pdf-import.mjs` | canonical row/source projection 与批处理上限不可破坏。 |
| 阅读 | `src/views/reading.js`、`src/reading-progress.mjs`、`src/reading-activity.mjs`、`src/reading-analytics.mjs`、`src/components/sentence-guide.mjs` | completionId、progress cleanup、跨日 activity 和 guide resume 必须保持幂等。 |
| 诊断 | `src/diagnostic-logger.mjs`、`src/diagnostic-export.mjs`、`src/views/settings.js` | 日志失败不能阻塞业务；导出前继续统一脱敏。 |
| 真题 | `src/exam/private-pack-loader.mjs`、`src/exam/pack-installer.mjs`、`src/exam/repository.mjs`、`src/exam/state-repository.mjs`、`src/views/exam-*.js` | 私有题包与用户练习状态分离；公共构建不得包含私有题包。 |

## 已验证结果

### 2026-08-30 底层性能优化与平板适配（最新）

- `node --test tests/*.test.mjs`：1487 项，1470 通过、17 跳过、0 失败；17 项跳过仍全部为私有真题源目录条件跳过。
- 平板定向验证：Shell/响应式/真题答题卡相关 44/44 通过；新增覆盖 focus 页面隐藏侧栏、Header 宽度回收、侧栏式覆盖层、短横屏密度以及 1/2/3 列断点。
- 新增行为覆盖：真实内容首帧、原子切换、无通用 Loading、模块/数据预取去重、Keep-Alive 状态恢复与 LRU 释放、窗口化词表、内存搜索零读库、迁移一次性、批量取词单事务、阅读渐进显示、真题包安装去重、TTS 删除后真人录音路径。
- `npx vite build --mode public`：通过；入口 262.23 kB raw / 76.74 kB gzip，不含私有题包，也不再生成 `www/src`。
- `npm run build:private-qa`：通过；保留 index + 5 个私有/合成题包，Capacitor 同步后仅注册 Secure Storage、App、Filesystem、Share 四个插件。
- Android `versionCode 47` 默认版完成 Gradle 构建；默认产物明确为 `ENABLE_ASYNC_WEBVIEW_STARTUP=false`。
- `git diff --check`：退出码 0。
- 代码级功能、构建和产物校验已通过；`p95 ≤ 100 ms`、真机启动改善至少 25% 和 WebView 实验是否达到 5% 仍必须由同一台真机 A/B 测量，不能以桌面测试代替。

### 2026-08-30 收口轮验证（历史）

#### 自动化验证（含审查修复轮）

- `node --test tests/*.test.mjs`：1454 项，1437 通过、17 跳过、0 失败。较上一轮基线（1402/1385/17/0）新增 52 个测试（收口轮 47 + 审查修复轮 4 + 计数修正 1）。
- 17 项跳过全部为"私有真题源目录不可用"条件跳过（1 项 MinerU 2026 原文候选 + 16 项 2010–2025 真题源转换单元门），与历史基线一致。
- `npm run exam-corpus:verify`：通过（9184 个轨道词条、29456 条代表例句）。
- `npx vite build --mode public`：通过；public 构建不含 `exam-packs/private/`；入口 chunk 247.70 kB raw / 72.60 kB gzip（上一轮约 1.56 MB raw / 502 KB gzip）；主要页面均为独立 lazy chunk。
- `npm run build:private-qa`：通过；保留 index + 5 个私有/合成题包；Capacitor Android 同步完成，`android/app/src/main/assets/public/data/` 含语料清单与三个分片。
- `git diff --check`：退出码 0。
- 构建警告仅剩两类已知项：PDF.js direct eval（第三方）与 lazy reading chunk >500 kB；无循环依赖、missing chunk、dynamic import ineffective 告警。

#### 浏览器手动验证（ZCode 内置 Chromium，独立测试 profile，合成数据 qa01–qa25）

- 页面切换：7 跳序列 shell 挂载 0.4–2.6 ms/跳（门槛 ≤100 ms）；快速三连跳 A→B→A 仅最终导航生效，旧导航 superseded。
- 20 词混合轮（12 认识 + 4 模糊→认识 + 4 忘了→认识，28 次曝光）：结果页 20 总复习 / 12 认识 / 4 模糊 / 4 忘记 / 学会率 100%；进度分母恒 20、已学会单调 0→20；IndexedDB 复习事件 28 条且按词形状精确；今日累计 20 词唯一且弱评级保留。
- 评分反馈：认识点击 → 学习页 27.1 ms；2.5 s 慢写入注入下 45.3 ms（journal 先行、乐观切卡）。
- 失败恢复：慢写入期间显示保存中并自动归零；DB_BLOCKED 自动/手动重试后归零；损坏 journal 行保留为 DATA_CORRUPT 失败可见且重试不执行坏行；带未决 journal 刷新后有效评分恰好重放一次。
- 截图证据：20 词结果页（含"复习记录已全部保存"）与失败可重试状态横幅，存于 ZCode 会话 artifacts（sess_6d375c1c，call_0e425d301be4445da273d0ef / call_4ce46690726f42fba296b881）。

#### 本轮尚存限制

- Android 私有 QA APK（v2.0.0-46）已完成构建与产物校验；真机冒烟待用户安装测试。
- 慢网下 lazy chunk 场景未做浏览器网络节流（IAB 不支持），以"shell 先于模块加载"行为测试与 shell 挂载实测替代。
- `route-not-found` 页复用通用页面样式，未做专属视觉设计。

### 上一轮验证记录（2026-08-29 交接，历史事实）

- `node --test tests/*.test.mjs`：1402 项，1385 通过、17 跳过、0 失败；总耗时约 41 秒。
- `npm run build`：通过，生成 public Web 构建并完成 Capacitor 同步。
- `git diff --check`：通过。
- 构建过程中出现的提示均来自依赖/打包策略：PDF.js 使用 direct eval、存在大于 500 kB 的 chunk、部分动态 import 无法拆包；未导致构建失败。

### 最近私有 QA APK

- 稳定版文件：`E:\play\claude\EnglishReader-private-qa-v2.0.0-47-debug.apk`
- 版本：`2.0.0` / `versionCode 47`
- 大小：36,878,049 bytes
- SHA-256：`54AA7575D6EAC83502CF45DA28209BCD4DA5D7327943EF9D1A549E7CD6FA7416`
- 校验文件：`E:\play\claude\EnglishReader-private-qa-v2.0.0-47-debug.apk.sha256`
- WebView 启动实验版：`E:\play\claude\EnglishReader-private-qa-v2.0.0-46-webview-startup-experiment-debug.apk`
- 实验版 SHA-256：`B3E7EAE294B38820F483D9CDC03454CAB816D79A3823526870A3A297505F97C6`（仅用于同机启动 A/B，不作为默认版）
- QA 包已验证包含 5 个私有/合成题包：`synthetic.kaoyan.en1`、`synthetic.kaoyan.cloze`、`synthetic.kaoyan.ordering`、`local.cet4`、`local.kaoyan.en1`。
- APK 与 `.sha256` 是发布产物，不应加入源码提交；`.apk.sha256` 已由通用忽略规则处理。

## 审查修复轮（2026-08-30 第二轮）

审查 AI 反馈 4 个问题，全部按"先写稳定失败的 RED 行为测试 → 最小修复 → GREEN"处理（无子代理，未触碰用户原有文件）：

1. **单例页面旧 render 覆盖新状态**：控制器为每次 render 发放 `{ token, generation, isCurrent() }` 生命周期上下文（恒为尾参，忽略该参数的视图行为不变）；A→B→A 场景下第一次 render 的迟到回调可自证过期并抑制覆盖，新 shell 仍同步挂载、不等待旧 render。行为测试固化（含 generation 递增与迟到回调被抑制断言）。
2. **整段 journal 损坏误报已保存**：journal 不可解析/非数组时构造隔离证据行（`corruptRaw` 保留原始文本，DATA_CORRUPT 失败），不再读作空 journal；状态不可能显示"已全部保存"，flush/retry 不执行坏内容。
3. **journal 稳定标识严格校验**：ID 先 trim 再校验——operationId/attemptId 必须非空、wordId 必须为正安全整数；不满足保留为 DATA_CORRUPT 且 executeRating 零调用；合法带空格 ID 在 journal 层 trim，杜绝 DB 层 attemptId 被空串绕过幂等检查。
4. **专项复习续练统计**：练习模式结果页 metrics 改用本次实际展示词集初始化（续练 3 词 → 本轮总复习 3/认识 3/学会率 100%），整组完成进度仍按选词累计（4/4）；练习不修改正式 SRS 有逐词断言。

验证：定向 49/49；全量 1454/1437/17 skip/0 fail；`git diff --check` 0；public 构建入口 249.39 kB raw / 73.09 kB gzip 且不含私有题包；private-qa 构建保留 index+5 包，Android assets 齐全。详细 RED 原因与修复说明见计划文件"审查修复记录（2026-08-30 第二轮）"。

## 审查修复轮（2026-08-30 第三轮，待复核）

审查第二轮反馈 4 个问题，按"RED 行为测试 → 最小修复 → GREEN"处理（保留各 RED 实际失败输出；无子代理，未触碰用户原有文件）：

1. **路由参数契约回归（P1，修复上一轮引入的回归）**：生命周期对象改为不经 `view.render` 位置参数传递，`view.render(outlet, ...route.args)` 原签名恢复——`#/flashcard/recall` 的 `requestedScope` 回归空串，正式回忆不再被误判为无效专项练习；带业务参数的页面实参列表精确。
2. **单例旧 render 防护改由控制器执行**：上一轮依赖视图自觉检查上下文的方案作废。控制器新增同视图 render 串行化（pendingRenders）：被取代的 render 总在 live render 开始前完成，物理上消除并发覆盖；骨架仍同步挂载，页面切换不延迟，跨视图导航不受影响。行为测试的视图完全不感知生命周期信息（与生产页面一致），RED 时真实复现 `'stale' !== 'fresh'` 的共享状态覆盖。
3. **journal 数组中的非对象元素**：数字/字符串/null 等逐项转 DATA_CORRUPT 隔离行，不再 filter 丢弃，`[42, null, "bad"]` 不再误读为空 journal。
4. **enqueueRating wordId 边界**：与 journal 恢复边界统一为"正安全整数"，0/负数/小数/空串/非数字全部在入队时拒绝。

验证：审查指定 5 文件 53/53；全量 1458/1441/17 skip/0 fail；`git diff --check` 0；public 入口 249.51 kB raw / 73.12 kB gzip 且不含私有题包；private-qa 保留 index+5 包，Android assets 齐全。RED 失败输出与修复细节见计划文件"审查修复记录（2026-08-30 第三轮）"。

**状态：以上修复待审查 AI 复核，复核通过前不视为"全部问题已修复"。**

## 审查修复轮（2026-08-30 第四轮，同视图串行化遗留项，待复核）

审查第三轮反馈同视图 render 串行化的 2 个 P1 与 1 个 P2，按"RED 行为测试 → 最小修复 → GREEN"处理（保留 RED 实际失败输出；无子代理，未触碰用户原有文件）：

1. **等待旧 render 后 stale 导航仍执行（P1）**：`await priorRender` 之后、设置 `currentView` 与调用 `view.render` 之前重查 token；被 B 取代的排队导航直接返回 `stale: true`，零副作用。行为测试断言：被放弃的导航不再调用 render、`currentView` 保持 B、B 内容不变、离开 B 清理的是 B 且 A 的 cleanup 计数不被波及。
2. **旧 render 迟到资源无人清理（P1）**：控制器在旧 render 完成、stale 检查通过后，对同视图强制执行一次 teardown cleanup 再重查 token，live render 恒从干净状态启动。行为测试断言全局监听器只剩 `['a2-listener']`、cleanupCount 恰为 2、事件顺序精确为 `render-a1 → cleanup-1 → a1-late-bind → cleanup-2 → render-a2`；cleanup 抛错变体不阻断后续导航。骨架同步挂载与跨视图不等待的既有保证不变。
3. **pendingRenders 跟踪链永不删除（P2）**：跟踪链改为 `trackedRender` 自引用比较并删除；控制器新增可选 `pendingRenderTracker` 注入（生产默认 WeakMap，零行为变化）。行为测试断言 in-flight 时 size=1、正常完成与 rejected 后 size=0、后续进入已完成页面无陈旧 claim 等待。

验证：审查指定 5 文件 57/57；全量 1462/1445/17 skip/0 fail；`git diff --check` 0；public 入口 249.66 kB raw / 73.16 kB gzip 且不含私有题包；private-qa 保留 index+5 包，Android assets 齐全。RED 失败输出与修复细节见计划文件"审查修复记录（2026-08-30 第四轮）"。

**状态：以上修复待审查 AI 复核，复核通过前不视为"全部问题已修复"。**

## 审查包（2026-08-30 收口轮，交给审查 AI）

### 审查命令（按子系统）

```powershell
git status --short --branch
git diff --stat
git diff --check
git diff -- src/review-session-metrics.mjs src/views/flashcard.js
git diff -- src/review-persistence.mjs src/review-persistence-status.mjs src/db.js
git diff -- src/review-queue-coordinator.mjs src/views/review-mode.js src/exam-corpus.mjs src/exam-corpus-runtime.mjs scripts/build-exam-corpus.mjs
git diff -- src/router.js src/router-routes.mjs src/router-navigation.mjs
```

### 未跟踪新文件（git diff 不显示，需单独阅读）

- `src/review-session-metrics.mjs`（会话指标纯模型，含本轮 recordRating null 守卫最小修复）
- `src/router-navigation.mjs`（导航生命周期控制器 + 四阶段证据）
- `src/router-routes.mjs`（路由表 + safeDecode/stripQuery + not-found）
- `tests/review-session-metrics.test.mjs`、`tests/flashcard-session-behavior.test.mjs`（FlashcardView 行为测试，data-URL 装配真实视图）
- `tests/router-performance.test.mjs`（路由行为测试）
- `public/data/exam-corpus-tracks/{cet4,cet6,kaoyan-general}.json`（语料分片产物，确定性构建）
- `tests/reading-completion-recovery.test.mjs`、`PROJECT_STATUS.md`（用户原有文件，本轮未改动除本文件追加内容外部分）
- `docs/superpowers/plans/2026-08-29-app-performance-review-reliability.md`（本计划全文 + Task 0–7 执行记录）

### 用户原有变更（非本轮产生，已在 Task 0 冻结确认）

- `src/views/reading.js`（+17 行，冻结时已存在，本轮未触碰）
- `tests/reading-completion-recovery.test.mjs`（untracked，用户原有）

### 本轮代码修复摘要（按子系统）

1. 会话指标：`recordRating(null)` 安全拒绝（唯一模型修改）；FlashcardView 集成经审计与行为测试固化，未改业务。
2. 持久化：retry wake timer 记录 `retryTimerAt` 并在更早到期时重建；无稳定 ID 的 journal 行保留为 DATA_CORRUPT 而非静默丢弃；结果页渲染稳定 errorCodes。
3. 队列/词料：零源码修改（审计 + 入口 spy 测试固化单次读库、当前轨道预加载、分片确定性）。
4. 路由：参数路由 stripQuery→safeDecode、锚定匹配、缺 ID 落 not-found shell；新增 8 个行为竞态测试固化导航控制器（含单例重入等待、stale render/load、cleanup rejection）。
5. 证据：导航四阶段计时（隐私载荷）、retry 诊断事件、routeKey 化的 route.navigate 记录。
6. 构建产物：`public/data/exam-corpus-index.json`（1.2 KB 纯元数据）与三分片；`www/`、Android assets 为构建输出未提交。

### 偏离计划清单（累计）

1. Task 1：计划示例断言字段 `summary.fuzzy/forgotten/words` 以现有等价结构 `uncertain/unknown` + 逐词 `getWordResult` 断言（避免向 summary() 添加未消费字段）；跳过语义现场核实为"不计分、本轮不再出现"，与口径一致。
2. Task 2：failed>0 时优先显示"待同步"而非"保存中"（即使 running）——与计划措辞略有出入，符合产品意图，保留既有行为；errorCodes 徽标仅加在 FlashcardView（context-review 不在本 Task 文件范围）。
3. Task 3：track 分片自身不带 wordCount 字段，计数以清单为准并在加载时校验（可验证计数）。
4. Task 4：not-found 用 router-routes.mjs 内联 NotFoundView（无新文件）；exam-router.test.mjs 两处解码正则契约随实现同步更新。
5. Task 5：router.js 中 route.navigate 诊断记录由原始 hash 改为 routeKey（router.js 属 Task 4 文件清单，为满足 5.1 隐私口径的 1 行语义收窄，已声明）。
6. Task 6：慢网 lazy chunk、固定 20 分母专用截图、Android 真机三项未执行/受限（详见 Task 6 执行记录，相关检查项保持未勾选）。
7. Task 7：收口审查时 APK 构建尚未授权；现已按用户授权构建并校验 v2.0.0-46 私有 QA APK，真机冒烟待用户执行。

### 证据索引

- 全量测试：1450/1433/17 skip/0 fail（11.2 s）；17 skip 全部为私有真题源目录条件跳过。
- public/qa 双构建、公建排除私包、qa 保留 index+5 包、Android assets 齐全、告警仅两类已知项。
- 浏览器验收与时延数据、注入场景结果：见上文"2026-08-30 收口轮验证"与计划 Task 6 执行记录。

## 已知问题与注意事项

- 当前没有由本次验证发现的功能性测试失败。
- 全量测试有 17 项跳过；后续若修改相关领域，应先确认这些跳过项是否是环境依赖还是有意跳过，不要把“全绿”误读为所有场景均已运行。
- 构建仍有第三方 PDF.js direct-eval 与按需阅读 chunk 体积提示；目前不阻断发布，后续若继续拆分阅读模块必须单独验证首帧和业务回归。
- `docs/FEATURES.md`、`docs/DEVELOPMENT.md` 仍保留部分历史文件路径和早期功能描述；实际实现以 `package.json`、当前 `src/`、迁移代码和测试为准。文档更新应单独进行，避免和功能修复混杂。
- `npm run build` 是 public flavor；需要验证私人题包必须运行 `npm run build:private-qa` 或 `npm run build:apk`。不要用 public 构建结果判断私有题包是否存在。
- 浏览器/Android 的真实交互仍需在发布前手动冒烟，尤其是长时间首页、复习后台保存、阅读续读/完成 cleanup、PDF 大词表和真题启动失败降级。

## 已替换或失败的方案

- 已废除“忘记后 10 分钟、模糊后 30 分钟必须回来”的强制短时间调度；改为会话内按其他单词数重插，跨会话由 Recovery 优先级处理。
- 已废除日报 Tool 调用时主动触发 DailyReportAnalyzer 的入口；保留旧保存分析的读取兼容，不再缺分析就调用第二个 AI。
- 已废除首页“今日日报”绕过 Agent 直接调用日报服务的入口；统一为显式文本请求且不消费现有 composer 草稿、图片、引用和教学状态。
- 已废除复习评分“等 IndexedDB 和 session 保存完成后再切卡”的同步 UI 路径；改为 durable journal 后立即响应，后台写入和结果页状态追赶。
- 已废除通过每次重绘整个首页解决 DOM 累积的思路；现在按稳定 message identity 增量移除被 Store 裁掉的节点，并单独释放历史图片资源。
- 已废除真题题包单包失败阻断首页启动的路径；安装按包隔离，页面先呈现加载/错误状态并允许重试。
- 已废除把 CET4 历史解析按英语一污染规则校验的做法；污染边界规则只适用于 `kaoyan_en1` 的阅读选择题。

## 下一步顺序

1. 先在真实手机和平板安装 versionCode 48 私有 QA APK，覆盖统一点词、真题选项短按/长按、句子分析标题分隔、竖横屏旋转、系统分屏/自由窗口、软键盘遮挡、20 词复习和系统返回键；记录任何页面、方向和操作步骤明确的异常。
2. 再覆盖安装 WebView 实验版，重复同一启动样本；只有中位数至少改善 5% 且无兼容问题才把实验开关设为默认，否则保留关闭。
3. 在同一设备和数据集测试冷启动 10 次、热启动 10 次、六个核心页面首次/再次进入各 20 次，以及 5000 词搜索与滚动；从诊断导出核对真实内容首帧 p50/p95、超过 50 ms 的长任务和页面错误。
4. 真机重点回归复习后台保存/失败重试、专项练习不推进 SRS、阅读续读/完成 cleanup、真人录音、PDF 大词表和私有真题启动降级。
5. 新任务开始前先确认 `git rev-parse --show-toplevel`、当前分支、工作树、`private`/`origin` 远程和 worktree，保护现有用户修改。
6. 需要提交时只提交明确属于当前任务的文件；私人 QA APK、日志、校验文件、私有原始题包和个人数据不得提交到源码历史或 `origin`。
