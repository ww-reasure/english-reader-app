# English Reader main 线交接（2026-08-30 功能移植 + 2026-08-31 统一点词合并 + 2026-09 词组高亮）

## 本轮结果

以开发线 `feat/english-practice-machine`（fa02328）为参考源，把全部非真题功能移植到 main 线。
main 从 1.9.4 前进到 **1.9.5（versionCode 41）**，共 9 个提交，工作树干净，未推送。

2026-08-31 又以真正的 git merge 把 `feat/app-wide-word-lookup`（fa02328 + `021cfcc` 全局取词功能）合并进 main：
历史统一，但按既定原则解决冲突——真题代码不落地，main 继续无真题。

2026-09-05 发布 **1.9.6（versionCode 42）**：重点词组高亮 + 等级释义卡 + 用户词组资料打包（详见下方专节）。

## 提交清单（自旧到新）

1. `0597d92` feat(infra)：诊断日志/导出、学习日与学习活动存储、学习计时器、发音解析、启动性能基线（TTS 延迟路径移除、fully drawn 桥）、v23 IndexedDB（完整迁移链，真题 store 保留空置以保证迁移连续）、平板 CSS 基线。
2. `e658dba` feat(router)：声明式路由表（无真题路由，#/learn-words 兼容重定向、not-found 壳）+ 导航生命周期控制器（骨架同步挂载、token 重查、同视图 render 串行化与代间 teardown、跟踪条目释放、四阶段隐私安全证据）。
3. `4435a09` feat(review)：durable journal 复习管线（损坏隔离、ID 严格校验、attemptId 幂等与 revision 重算）、最弱评级结果统计、V2 会话重插、专项练习（续练结果只计本次、整组进度累计）、结果页保存状态与重试、语境复习。含审查修复全部加固。
4. `2cfd9d1` feat(vocab)：统一词汇库、导入分析与恢复、PDF 导入、难度画像、词汇页重设计；learn-words.js 退役。
5. `9595185` feat(reading)：可恢复阅读进度、完成幂等与可重试清理、阅读活动统计（查词/收藏词）、导读与划词增强（真题选择器已清）。
6. `f6082ad` feat(agent)：多模态视觉聊天（图片持久化/预览）、分步互动教学、学习日报卡片与只读工具、学习者画像（provisional）、模型目录、composer 状态、资源压缩、联网研究。真题 provider 在 main 线为空存根（日报 exam 段恒空，schema 兼容）。
7. `bec1be5` test：移植实践线全部测试套件并裁剪真题断言（含 main 线发布工程契约裁剪说明）。
8. `4813508` feat(agent)：tooltip 与知识画像对齐收尾。
9. `faf9372` chore(release)：1.9.5 / versionCode 41。

## 2026-08-31 合并 `feat/app-wide-word-lookup`

- 合并内容：共享 `bindLearningTextLookup()` 全局取词（阅读标题/正文/导读、AI 分析、闪卡与单词详情例句、语境复习、测评、首页导学卡），compact 释义卡、词库 revision 快照成员索引、tooltip 成员缓存，AI 句子分析三段式布局修复。
- 冲突解决：与 fa02328 逐字节一致的 11 个文件取开发线版本；main 有意剥离过的 16 个文件保留 main 版；真题域新增（src/exam/**、exam 视图与测试、题包构建脚本、translation-tutor、私有包 loader/校验、release-artifact/verify-apk、source-inventory fixtures、verify-2026 兼容脚本等 129 个文件）不落地；`chat.js` 手工双面合并（main 无真题版 + 6 处取词增量）；surface 契约测试去掉两个 exam 用例；版本保持 1.9.5/41（开发线自己的 2.0.0/48 不带入）。
- 顺手修复移植期遗留：HEAD 的 package.json 构建链引用了不存在的 `scripts/release-artifact.mjs`（真题发布管线），`npm run build` 在合并前就已损坏；现已改为 `vite build --mode public && npx cap sync android`，并移除指向已删脚本的 `exam-pack:build`。`assets/learning-paper-texture.png` 随合并删除（全树无引用）。
- 合并后基线：`node --test tests/*.test.mjs` 1241/1241 通过；`npm run build`（public）通过；src/tests 中无已删真题模块引用。

## 验证基线（main 树实测）

- `node --test tests/*.test.mjs`：1241 项全部通过，0 失败，0 跳过。
- `npm run build`（public）：通过（vite 构建 + cap sync）。
- 真题残留：`src/`、`tests/` 中无 `views/exam-*`、`src/exam/*`、`exam-packs`、`exam-practice`、`exam-tutor`、`translation-tutor`、`private-pack` 引用；`css/style.css` 中遗留少量无 DOM 命中的真题样式块（死样式，无功能影响，可在后续清理）。
- `src/exam-corpus.mjs` / `exam-corpus-runtime.mjs` 保留 main 线旧版（单索引语料查询，供复习/词汇例句增强），并补了 `preload` 钩子。

## 2026-09-03 重点词组高亮（feature: key phrases）

- 功能：阅读页新增「重点词组」开关（右上角更多弹层，`role="switch"`，`reading_phrase_highlighting` 持久化，默认开）。开启后文章标题、正文段落、逐句导读英文原句中的词组以 moss 绿色块高亮；点击词组弹词组释义卡（Tooltip.showPhrase），非词组词仍走单词查词。
- 数据：`public/data/key-phrases/`（manifest + 按 track 分片，schemaVersion/packVersion 校验）。**2026-09-04 已导入用户资料**（`D:\资料\english\词组` 四份清单 CSV）：cet4 1510 条（四级核心+扩展）、kaoyan 1302 条（考研核心+扩展）、general 2104 条（并集兜底，cet6/未设目标时使用）。条目含来源类型前缀（usage./idm./phrv./collocation.）与中文释义。
- 实现：`src/components/word-marking.mjs` 新增词组最长匹配层（规范化 + 常规屈折折叠 + 连接符约束，`renderPhraseAwareMarking`/`matchKeyPhraseAt`/`buildKeyPhraseMatcherIndex`，单词标记签名不变）；`src/key-phrase-library.mjs` 词组库运行时（manifest 校验、track 解析 kaoyan1/2→kaoyan、未知 track 回落 general、memoize）；`reading-word-lookup.js` 词组优先分支（keydown 同步）；reading.js 首帧后惰性加载 matcher 并重渲染（`_scheduleAfterFirstPaint` 既有模式），词组 span 嵌在 `.reading-sentence` 内部、续读定位结构不变。
- 已知限制：不规则动词变形不折叠（如 made/went 无法命中 make a contribution）；跨句不匹配；词组只按表面序列完整匹配。
- 词组卡：点击词组弹卡片，显示词组、**等级徽章（四级/考研/两者都有）**与释义（目标 track 释义优先）。等级来自跨包索引：`getPhraseIndex` 加载全部非派生包建 id→tracks 映射（general 标记 `derivedFrom: ['cet4','kaoyan']` 不参与等级），阅读页首帧后预热。
- 通配符匹配：资料中约 1/3 条目含 sth/sb/one's/do 占位符，运行时将其记为通配位（匹配任意单个词），如 "respond to sth" 命中 "respond to the challenge"；通配开头条目按第二个词建桶索引（24k 字符渲染 ~5ms）。**'a'/'b' 不作通配**（"many a"、"a range of sth" 的 a 是冠词，通配会误吞跨词）。
- 后台标签页修复：`_scheduleAfterFirstPaint` 的双 rAF 在后台标签被冻结，首帧后增强（词汇索引+词组库）永不执行；已加 1.2s 超时兜底（前台行为不变， intensive-throttling 后台页在下一次定时器唤醒时补齐）。
- 顺手修正：`tests/build-apk-script.test.mjs` 的构建链断言仍是合并前旧值（上次合并验证时序缺口），已同步为无 release-artifact 的新链。
- 验证：`node --test tests/*.test.mjs` 1273/1273 通过；`npm run build` 通过。浏览器实测：词组高亮、等级卡（四级+考研双徽章）、释义显示全部正常。
- 发布：`npm run version:patch` 升至 **1.9.6 / versionCode 42**；`build-apk.js` 对已剥离 release-artifact/verify-apk 模块的引用改为 www 产物存在性检查；APK `EnglishReader-private-qa-v1.9.6-42-debug.apk`（SHA-256 见 .sha256 伴随文件）已复制到共享根 `E:\play\claude\`。
- Windows 本地浏览器版：沿用 v1.9.4 的 PowerShell 静态服务器方案（`EnglishReaderServer.psm1` + `Start-EnglishReader.cmd`，127.0.0.1:17841），`app/` 取自本次 www 构建（含词组分片）；烟测通过（index/词组清单/JS 资产 200）。产物 `E:\play\claude\EnglishReader-Windows-v1.9.6\` 与同名 zip（28 MB）。

## 范围与限制

- 真题训练（题包、练习、错题复习、翻译训练、真题学习概览、题包安装器与校验）按约定**不包含**；日报的 exam 事实段为恒空存根，schema 兼容。开发线 `feat/app-wide-word-lookup` 上的真题相关改动同样未带入。
- DB 迁移链 v14→v23 为代码级移植；老用户数据（v14）升级前建议先备份实测一次。
- 未做任何远程推送；main 领先 origin/main 的提交数随本轮继续增加。
- 版本 1.9.6/42（2026-09-05 发布）。
