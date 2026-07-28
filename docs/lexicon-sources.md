# 可追溯离线词库：来源、范围与构建规则

`public/data/lexicon-manifest.json` 是覆盖率/难度核心的来源登记册；`public/data/oewn-artifact-manifest.json` 是独立英文义项派生产物的来源登记册；`public/data/exam-focus.json` 是独立的四、六级公开词表产物。核心来源缺少不可变 URL、版本、许可证及其 URL、获取日期、SHA-256、字节数、用途、署名、快照路径或状态时，相应构建会拒绝使用；考试重点包额外固定每条公开词表的 Git 提交、SHA-256、字节数和规范化数量。

状态决定数据能否影响当前产品：

- `active-core`：允许进入当前核心词库，并可作为当前覆盖率/质量报告的来源。
- `reserved-not-core`：快照仍保留、下载和校验，以便未来可审计接入；它**不会**进入 `lexicon-core.json`、词典质量判断、CEFR 指标或任何当前难度报告。
- `derived-core-definitions-only`：独立 OEWN 派生产物只提供 exact lemma/POS 的英文义项结构；它不进入 `lexicon-core.json`，不提供中文释义，也绝不参与词频、CEFR、目标考试或难度判断。

## 当前激活的核心来源（2026.07.27-core.6）

| ID | 数据职责 | 固定快照与许可证 | 本次实际量 |
| --- | --- | --- | --- |
| `ngsl-1.2-stats` | 通用高频层和六档频率带 | 官方 NGSL 1.2 statistics 静态 Squarespace asset，CC BY-SA 4.0 | 2,809 条，62,566 B |
| `nawl-1.2-research` | 学术词层 | 官方 NAWL 1.2 research CSV 静态 Squarespace asset，CC BY-SA 4.0 | 959 个不同 lemma，25,980 B；逗号后的观察变体不作为默认词形 |
| `wordfreq-3.2.0-en` | 查词候选与常用度补充层 | wordfreq 固定 commit `912caf…`，数据 CC BY-SA 4.0 | 321,180 原始 token 记录，1,494,836 B；只使用前 25,000 个规范化单 token |
| `ecdict-2025-full` | 中文学习义与可靠词形候选 | ECDICT GitHub 固定 commit `bc015ed…`，MIT | 770,611 记录，65,933,428 B；仅输出人工审核义和自动筛选通过的紧凑学习义 |

NGSL 官方页面称 1.2 为 2,809-word list；NAWL 官方页面称 1.2 为 957-word list。固定的 NAWL research CSV 实测为 959 个不同 lemma，构建保留全部 959 行，而不会为了迎合页面文案悄悄删除两项。完整 URL、SHA-256、字节数、署名文本和许可证链接均在 manifest 中；文档中的数字仅作本次构建报告。

## 已固定、但当前预留的核心快照

| ID | 当前状态 | 保留原因 | 当前边界 |
| --- | --- | --- | --- |
| `oewn-2025-entries-a` | `reserved-not-core` | 局部 YAML 词元快照 | 不能进入核心、提供中文释义或影响难度。 |
| `oewn-2025-verb-possession` | `reserved-not-core` | 局部 YAML 义项快照 | 同上。 |
| `cefrj-vocabulary-profile-1.5` | `reserved-not-core` | 固定 README 允许研究/商业使用并要求引用，但未明确授予再分发或 APK 派生层分发权限 | 不进入核心、不输出 CEFR-J 层、不影响当前难度报告；取得权利人明确书面许可前不得重新激活。 |

这些局部快照的 URL、许可证、获取日期、SHA-256、字节数和 `snapshotPath` 保留在核心 manifest，因而后续接入仍可追溯。它们不能因独立 OEWN 义项产物已启用就自动进入 `active-core`。

## 独立 OEWN 英文义项产物

官方 `2025-edition` JSON release 被固定在 `oewn-artifact-manifest.json`：ZIP 为 **9,986,555 B**，SHA-256 为 `7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51`。`node scripts/fetch-oewn-source.mjs` 先校验该 ZIP，再由 `node scripts/build-oewn-artifact.mjs` 产生 `public/data/oewn-core-2025.json`。

当前派生产物包含 **5,619 个** exact active-core lemma/POS 英文义项组合（约 4.33 MB 原始 JSON）。它只保留 sense ID、synset ID 和英文 definition；运行时仅在受限词条需要英文结构提示时懒加载，并要求产物的 `coreLexiconVersion` 与当前核心一致。它不会写入中文释义、频率层、CEFR 层、目标重点词层或个人画像。

## 独立四、六级公开重点词表

`public/data/exam-focus.json` 固定使用 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) 的 commit `8814e02b40f69a2a6e016dbde087010304fcedfc`：原始四级文件 7,508 条记录，规范化为 **4,543** 个单词；原始六级文件 5,651 条记录，规范化为 **3,991** 个单词。每次 `npm run exam-focus:verify` 都重新下载该 commit 的两份文本并校验 SHA-256、字节数、记录数与排序后的输出。

该仓库没有声明明确许可证；本产品按所有者授权使用，来源与边界写入 `lexicon-source-catalog.json` 和产物元数据。它是常见公开学习词表，不是 NEEA 官方词表、考试原文语料或“真题词频”统计。审计时还与 `Bogger111/Vocabulary_Reciting` 和 `CanFlyhang/CET-MASTER` 对照：四级分别为 3,301 与 3,301 个单词，且后两者完全重合，字段格式也高度一致，不能把三份列表误称为三份独立证据；六级列表差异更大。因此当前选择固定主来源并保留“公开导向、非官方真值”标签，而不是虚构精确性。

运行时会把该包作为 `examFocus` 附加层：词典可显示“四级/六级”标签，文章质量报告可统计重点词出现次数。它**不会**改写 `lexicon-core.json`、NGSL/NAWL 频率带、离线中文释义、个人掌握证据、覆盖率通过条件或 UDPipe 句法阈值；词表外单词也绝不被判定为“不考”。

## 产物和质量层

`node scripts/fetch-lexicon-sources.mjs` 下载**所有已声明**来源到 `data/lexicon-sources/`，先验 SHA-256 和字节数，再写入本地缓存。缓存被 `.gitignore` 排除，也不会进入 APK。

`node scripts/build-lexicon.mjs` 会再次验证所有声明快照的 SHA-256 和字节数，但只消费 `active-core` 来源，然后：

1. 从 NGSL 生成每个 lemma 的 `frequency-only`、`limited` 词条及 `ngsl-1` 到 `ngsl-6` 频率带；
2. 从 NAWL 生成每个 headword 的 `academic-only`、`limited` 词条；CSV 逗号后的观察变体不会自动扩大默认词形；
3. 从 wordfreq cBpack 解码并按 Zipf 值选出前 25,000 个单 token，仅加入 `lookupFrequency` 层；
4. 合并重合 lemma，并将公开四、六级导向词仅作为 ECDICT 筛选候选补充，不写入难度层；
5. 对候选集逐条匹配 ECDICT，仅保留有中文常用义、可识别词性、无领域标签/缩略语/专名优先标记的记录，标为 `screened`；
6. 用 `lexicon-core.seed.json` 中审核通过的中文常用义覆盖为 `high`，并流式核验每个 `ecdict.csv:<lemma>` 审核记录存在于已固定的完整 CSV；
7. 输出随 APK 发布的 `public/data/lexicon-core.json`。

本次输出为 **25,910 条**：**68 条高可信中文学习义**、**14,730 条离线筛选学习义**和 **11,112 条受限词条**。数量由 `lexicon-core.json` 的 `entryCount` 与 `quality` 字段在每次可复现构建后确定。受 ECDICT 明确词形映射归并影响，部分复数/时态以基础词的 `forms` 入口查到，而不把曲折形式伪装成独立学习词。它刻意不把旧 `dict-5000.json`、旧 `exam-words.json`、旧 `exam-frequency.json`、CEFR-J 或 OEWN 数据带入新难度模型。独立 OEWN 产物只能补充受限词的英文结构；独立 `exam-focus.json` 继续提供公开四、六级导向标签，并在构建期只扩大 ECDICT 筛选候选集合，不改变频率层、覆盖率通过条件或文章质量阈值。未知词必须由调用方保守视为未掌握，而不是被旧词典的错误释义伪装成已知词。

高可信词条包括初测所需的 24 条以上常用学习义，并覆盖高频回归词：`the`、`be`、`of`、`can`、`may`、`a/an`、`do`、`have`、`will`。这些词的 `glossZh` 经人工筛选；禁止出现 `[医]`、`[法]`、`[化]`、`[计]`、`[经]`、`[地名]` 或 `[网络]` 领域标签。`a`/`an` 共享同一词元记录，以保证词形查找不会回落到旧词典的错误缩写义。

**词典接入边界（供后续 `dictionary.js` 改造遵守）：**`quality: "high"` 和 `quality: "screened"` 且有 `glossZh` 的 core 词义都可作为离线中文默认释义，界面必须显式区分二者；`limited` 条目只可用于词汇/学术层、覆盖率和英文结构提示，中文应走在线或 AI 回退。绝不允许把 `dict-5000.json` 作为上述高频词的中文回退真值。

## 固定但未激活的候选来源

`public/data/lexicon-source-catalog.json` 记录尚未能够形成可审计核心层的候选：

- `ecdict-mini-2025`：已固定 GitHub commit、MIT、SHA-256 和 4,204 B/53 记录，但该 mini CSV 主要是词缀、短语、专名和领域词；过滤后无法提供初测要求的 24 条独立常用学习义，故保持 `blocked-sample-not-learning-ready`。
- 四条 `target-focus-*`：尚无已授权、可审计的历年阅读语料及派生统计，全部维持 `blocked-corpus-provenance`。原始真题不会被放入 APK，也不能据此宣称存在“官方精确词表”。

## 复现与验收

```powershell
npm run lexicon:fetch
npm run lexicon:build
npm run exam-focus:verify
node --test tests/lexicon-contract.test.mjs tests/lexicon-build.test.mjs tests/lexicon-source-pins.test.mjs tests/lexicon-runtime.test.mjs
```

构建和测试会检查：来源字段、许可证/署名、可再分发证据、CC BY-SA 派生产物的变更声明、快照 SHA-256、字节数、路径越界、预留来源不得进入核心、NGSL/NAWL 合并、审核释义、领域标签回归、高频词回归和「mini 不能冒充通用词典」边界。
