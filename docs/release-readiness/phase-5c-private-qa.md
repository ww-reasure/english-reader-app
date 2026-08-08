# English I MVP Release Candidate Freeze

本文件只记录当前独立专属版本的 RC 冻结证据，不记录真实题干、答案、解析或原始来源内容。
该版本不与已发布版本或 `main` 工作树混用；`private-qa` 是唯一允许包含真实题包的授权内部构建。

## Freeze identity

- Frozen HEAD / commit SHA: `0525fba73da484821e66a048fc823c46cb08940e`
- Branch: `feat/english-practice-machine`
- RC worktree: `E:\play\claude\english-reader\mobile`
- Main worktree: `E:\play\claude\english-reader\mobile\.worktrees\main-development`
- Worktree state: dirty；保留现有 staged、unstaged 和 untracked 用户改动
- Freeze operation: 未提交、未 push、未创建 tag；本记录冻结的是上述 SHA 加当前受审计 dirty overlay

## Corrective rebuild

- User-reported symptom: 安装后显示旧版「对话/历史/词库/统计/设置」导航，主内容为空。
- Root cause: `releaseArtifactPlugin` 将 `public/index.html` 复制到 `www/index.html`，覆盖了 Vite 生成的当前应用入口。
- Fix: 私有/公开产物复制时跳过根目录 `public/index.html`；不改业务规则、不改 UI。
- Regression test: `tests/vite-release-entry.test.mjs` 先复现失败，修复后通过；APK 内入口已确认不含旧 `Bottom Tab Navigation` 和 `js/app.js`。
- Previous APK SHA-256 `DF31669005D96098ADB0D9788A1D9E0F25BFBDA2FF8A909727E1C3FD2186A721` 不再作为交付包使用。

## Dirty worktree audit

### 应纳入 English I MVP RC 的文件

Release hardening 与私有构建门禁：

- `.gitignore`
- `package.json`、`package-lock.json`
- `vite.config.js`
- `scripts/build-apk.js`
- `scripts/release-artifact.mjs`
- `scripts/verify-apk-artifact.mjs`
- `src/exam/home-visibility.mjs`
- `src/views/exam-home.js`
- `VERSIONING.md`
- `docs/release-readiness/phase-5c-private-qa.md`
- `tests/build-apk-script.test.mjs`
- `tests/dependency-audit-contract.test.mjs`
- `tests/exam-home-visibility.test.mjs`
- `tests/release-artifact.test.mjs`
- `tests/verify-apk-artifact.test.mjs`

English I MVP 业务基线：

- `src/exam/**`
- `src/views/exam-practice.js`、`src/views/exam-result.js`、`src/views/exam-review.js`
- `src/components/reading-word-lookup.js`、`src/components/word-point.js`
- `src/components/app-shell.js`、`src/components/chat-service.js`、`src/components/tooltip.js`
- `src/views/reading.js`、`src/router.js`、`src/db.js`、`css/style.css`
- 对应 `tests/exam-*.test.mjs`、`tests/translation-*.test.mjs`、reading/study contract tests 和 `tests/fixtures/exam-*.md`
- Android Capacitor sync 产生的当前构建输入；未发现独立业务语义变更

发布记录与交接文件（位于 mobile 工作树之外）：

- `E:\play\claude\PROJECT_STATUS.md`
- `E:\play\claude\EXAM_PRACTICE_HANDOFF.md`

### 明显不属于 RC 运行时交付的文件或输入

以下内容保留在工作树，不擅自删除；它们不进入 public 构建，也不作为 APK 运行时文件：

- `.codegraph/**`：工具生成的代码图元数据
- `scripts/convert-mineru-kaoyan-en1-2026.mjs`：私有题包来源转换工具，仅用于本地素材准备
- `docs/superpowers/plans/**`：历史阶段计划文档，仅作追溯记录
- `private_exam_sources/**`：原始私有来源，Git ignored，禁止进入 Git 或 APK
- `public/exam-packs/private/**`：本地私有题包输入，Git ignored；只在 `private-qa` 构建时复制，不能进入 public 构建或公开发布
- 根目录已有的 `E:\play\claude\english-reader\mobile\英语阅读助手.apk`：旧版/既有 APK，不是本 RC，不纳入本次交付

`docs/exam-md-v1.md`、`docs/exam-practice-audit.md` 和 pack 构建脚本属于审计/素材工具资料，继续保留但不计入 APK 内容。

## Release candidate

- Source revision: `0525fba73da484821e66a048fc823c46cb08940e`
- Working tree clean: 否；保留本轮及既有 Phase 5A dirty 文件，未提交
- Flavor: `private-qa`
- Version: `1.9.3`
- Version code: `37`
- APK path: `E:\play\claude\EnglishReader-private-qa-v1.9.3-37-debug.apk`
- APK SHA-256: `691BB375B33E3366EC3D11A6CA16CC7860BAFD77E88FB6990EDCAA3F57E3546E`
- Private pack SHA-256: `public/exam-packs/private/local.kaoyan.en1.json` → `C4A2F867C0FCF8F1496AD43FD5287BA13836C20A88D42C76411BA43CB63AADE6`
- Release manifest: `www/release-manifest.json`（`private-qa` / `internal-authorized`）

## Automated verification

- `node --test tests/*.test.mjs`: PASS；`746 / 746`
- `npm run security:audit`: PASS；production 与完整依赖审计均 `0 vulnerabilities`
- `npm run build` public release gate: PASS；manifest 为 `public`，无 `exam-packs/private/`
- `npm run build:private-qa` private-qa release gate: PASS；含 index、synthetic packs 和 `local.kaoyan.en1.json`
- `npx vite build --mode private-qa`: PASS；随后 Web release artifact gate PASS
- `npm run build:apk`: PASS；Gradle `BUILD SUCCESSFUL`
- APK entry regression gate: PASS；APK `assets/public/index.html` 保留当前 Vite 入口
- APK ZIP content check: PASS；manifest、私有 pack 存在，未发现 `private_exam_sources/` 或原始来源文件
- Version check: PASS；`package.json`、`version.json`、Android metadata、lock metadata 和 release manifest 均为 `1.9.3 / 37`
- `npm run track-baseline:verify`: PASS；目标 track disabled，禁止 track 检查通过
- `git diff --check`: PASS；无冲突标记

## Browser smoke

- 2026 Text 1 entry: PASS；`#/exam` 显示真实 QA 入口
- First-pass正文点词 Tooltip: PASS；显示阅读式释义、上下文义和学习详情入口
- Explanation/evidence 点词 Tooltip: PASS；提交后解析正文可复用同一查词弹层
- 选项不触发查词: PASS；点击选项只更新选择状态
- Ask AI / Exam Tutor: PASS；既有 Tutor 自动化测试通过，浏览器点击 AI 分析入口可打开 Exam Tutor；原生拖选手势未在本环境稳定复现
- Review Center objective transitions: PASS；Review Center 页面与现有复习卡片加载，状态迁移由全量测试覆盖
- Part C Q46–Q50 translation states: PASS；相关翻译状态与 due 测试通过
- Tooltip cleanup after navigation: PASS；关闭与路由切换后未见残留弹层

## Android smoke

- Manual Android smoke: PASS；按用户人工验收确认
- Cold start: PASS（用户人工验收）
- Offline start: PASS（用户人工验收）
- DB v17 migration: PASS（用户人工验收；自动化迁移测试通过）
- Private pack install: PASS（用户人工验收；APK 内 pack 校验通过）
- Point-word lookup: PASS（用户人工验收；Web smoke 通过）
- Submit and Explanation: PASS（用户人工验收；Web smoke 与自动化测试通过）
- Review Center: PASS（用户人工验收；Web smoke 与自动化测试通过）
- APK raw-source scan: PASS；ZIP 条目未发现 `private_exam_sources/` 或原始来源文件

## Verdict

- Release status: `FROZEN FOR INTERNAL ENGLISH I MVP QA`
- Distribution: 仅限当前独立专属 `private-qa` 版本；不与已发布版本或 `main` 工作树混用
- Remaining risks: 当前冻结记录基于 `0525fba...` 加 dirty overlay，未创建新的 clean commit；如需可复现的 Git-only RC，后续必须由用户明确授权整理并提交
