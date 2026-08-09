# Phase 6A：考研英语一 2010–2026 题库导入与兼容验证

本文件只记录路径、哈希、数量和验证结果，不记录真实题干、答案、解析或原始来源内容。
当前版本是独立维护的 English I 专属 `private-qa` 版本，不与已发布版本或 `main` 工作树混用。

## 范围与来源 inventory

- Source root：`D:\资料\english`（只读）
- Inventory：`private_exam_sources/source-manifests/kaoyan-en1/inventory.json`（Git ignored）
- 文件总数：711
- 类型统计：PDF 16、MD 17、JSON 17、JPG 661
- 标准 English I：2010–2025，每年 PDF/MD/JSON 各一份
- 2026：MinerU 候选 MD/JSON 各一份；源目录无 2026 PDF
- `DUPLICATE_CONTENT`：134 个图片文件
- `NEEDS_HUMAN_REVIEW`：0
- inventory warnings：0
- Section III Part A/B 写作：仅盘点，不进入题包

2026 候选文件只用于兼容核对，不替换当前已验收的 2026 paper、attempt、response、Review Center、翻译复习、收藏或 Tutor 历史。

## 导入结果

稳定身份规则保持不变：`examId=kaoyan_en1`、`bankId=builtin_kaoyan_en1`、`packageId=local.kaoyan.en1`、`paperKey=kaoyan_en1_<year>`。

| 年份 | 导入 unit | 题数 | Part B | Gate / blockers |
|---:|---:|---:|---|---|
| 2026 | 7 | 50 | paragraph_ordering | PASS / 0（既有 paper） |
| 2025 | 7 | 50 | paragraph_ordering | 7 PASS / 0 |
| 2024 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2023 | 7 | 50 | paragraph_ordering | 7 PASS / 0 |
| 2022 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2021 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2020 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2019 | 7 | 50 | paragraph_ordering，7 candidates / 2 fixed | 7 PASS / 0 |
| 2018 | 7 | 50 | paragraph_ordering，7 candidates / 2 fixed | 7 PASS / 0 |
| 2017 | 7 | 50 | paragraph_ordering，7 candidates / 2 fixed | 7 PASS / 0 |
| 2016 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2015 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2014 | 7 | 50 | paragraph_ordering，7 candidates / 2 fixed | 7 PASS / 0 |
| 2013 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2012 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |
| 2011 | 7 | 50 | paragraph_ordering，7 candidates / 2 fixed | 7 PASS / 0 |
| 2010 | 6 | 45 | `UNSUPPORTED_PART_B_VARIANT`（matching） | 6 PASS + 1 SKIPPED / 0 |

合并后：17 papers、110 units、805 questions。所有正式导入年份均使用年份 + section + 题号生成 stable question key；全 pack question key 无重复。

## QA、覆盖与已知边界

- 2010–2025 转换总 warnings：87；BLOCKERS：0。
- 2010–2025 转换字段覆盖基数：755 questions。
- 主要覆盖统计（present / total）：`answer 675/755`、`stem 320/755`、`options 640/755`、`explanation 344/755`、`location 345/755`、`evidence 265/755`、`evidenceTranslation 265/755`、`optionAnalysis 640/755`、`referenceTranslation 80/755`、`localAnalysis 62/755`。
- 缺失字段主要来自题型本身：翻译题没有 objective answer/stem/options；段落排序 slot 没有选择题 stem/options；来源解析不完整只保留可核对字段，不猜测补写。
- normalization 仅做来源可证明的 section boundary、断行/混合双语清理、题号标记、候选段切分、公式答案序列解析和 stable identity；不使用数组位置、页码或 MinerU block id 生成 identity。
- schema gap：写作不进入 `exam-md-v1` canonical unit。
- renderer gap：matching 型 Part B 当前 renderer 不支持，9 个年份显式 SKIPPED；未映射到其他题型。

## 2026 历史兼容

- Existing 2026 paper hash：`sha256:9254af2d2267f38987c5c0a74ec65d5dbb4eeb1f5ef770d6681576922e581b28`
- `questionHashMatches=true`
- `coverageMatches=true`
- `differences=0`
- `replacementPerformed=false`
- 2025/2024 paper hash 仍分别为：
  - 2025：`sha256:e00e8b12a9552f6860f7ca653a4eccc6bf4c82f953936936648e4deb73d73070`
  - 2024：`sha256:763b0a70c47b5885f6e7885e50f73ba32f60b1eda14faa34ae42da0793075c8e`

## 验证记录

- Source conversion：2010–2025 全部逐年执行，所有非 unsupported unit gate PASS，blockers=0
- Pack validation：manifest、paper hash、package contentHash、stable identity 全部 PASS
- `node --test tests/*.test.mjs`：PASS，798 / 798
- `npm run track-baseline:verify`：PASS；target-track disabled，raw exam text/answers/options 不进入 published artifact
- `npx vite build --mode public`：PASS
- public release gate：PASS；`privateExamPacksIncluded=false`，不存在 `exam-packs/private/`
- `npx vite build --mode private-qa`：PASS
- private-qa release gate：PASS；包含 `local.kaoyan.en1` 与 synthetic packs
- `git diff --check`：PASS；仅有既有 LF/CRLF 提示，无冲突标记
- 不生成 APK；本阶段不改 DB v17、grading、attempt lifecycle 或 UI

## 浏览器 smoke

- `http://127.0.0.1:4174/#/exam`：PASS；题库选择器显示考研英语一，英语四级显示为暂未安装；底部三项导航保留
- 完形目录：PASS；2010–2026 年份入口均可见，单 unit 年份直接进入
- 阅读目录：PASS；点击 2026 后展开 Text 1–4
- 整卷目录：PASS；点击年份后展开该年份可用题型内容
- 段落排序目录：PASS；仅显示有 renderer 支持的年份，matching 年份未伪装成排序入口
- 2010 完形练习：PASS；正文、20 个空、题目面板和选项正常加载
- smoke 结束后页面留在 `#/exam`

## 当前工作树与下一步

- HEAD：`897892a1c819ed857ebc7e25c8dd2ba9928995d4`
- Branch：`feat/english-practice-machine`
- Worktree：dirty；不擅自删除已有 staged、unstaged、untracked 或 Git ignored 私有资料
- 私有 pack：`public/exam-packs/private/local.kaoyan.en1.json`
- 私有 pack SHA-256：`07A9F70D6C103B24549AE5722B52CDB93EE70CA110F6232A95D0547953F7C5B5`
- packageVersion：`1.1.0`
- DB：v17

2010–2026 已完成。本轮停止，不继续推测或导入 inventory 之外的更早年份；如需 2009 或 matching Part B renderer，等待新的源文件和明确授权。
