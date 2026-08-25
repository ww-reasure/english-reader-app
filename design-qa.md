# Exam bank switcher design QA

## Visual truth

- Home source: `D:\app\wechat\Document\xwechat_files\wxid_4nnc9rg1pden22_dcff\temp\RWTemp\2026-08\9e20f478899dc29eb19741386f9343c8\a8d751e1cbdd4d53b99279b1d18aa988.jpg`
- Catalog source: `D:\app\wechat\Document\xwechat_files\wxid_4nnc9rg1pden22_dcff\temp\RWTemp\2026-08\9e20f478899dc29eb19741386f9343c8\52a83474f3287893734007d392f85b84.jpg`
- Home implementation: `E:\play\claude\english-reader\mobile\design-qa-exam-home.png`
- Catalog implementation: `E:\play\claude\english-reader\mobile\design-qa-exam-catalog.png`
- Side-by-side evidence: `design-qa-exam-home-comparison.png`, `design-qa-exam-catalog-comparison.png`

## Normalization

- Source pixels: 900 x 2048, treated as 2x mobile density.
- Source normalized size: 450 x 1024.
- Browser implementation: 450 x 1024 CSS pixels at device scale 1.
- State: private-qa exam home and cloze year catalog.
- Android status/navigation chrome in the source is device-owned and excluded from app-layout findings.

## Evidence

- Home header: compact switcher is 104 x 44 CSS pixels and has an 8 px measured gap from the title block; overlap is false.
- Home selector: selected option is 考研英语一; 英语四级 remains present and disabled as 暂未安装.
- Catalog header: bank switcher count is 0, action children count is 0, and the title center is 225 px in a 450 px viewport.
- Navigation: catalog back action returns to `#/exam` and the home switcher remains visible and enabled.
- Console: no browser console errors during the checked flow.

## Fidelity surfaces

- Fonts and typography: existing serif display hierarchy is preserved; the switcher uses compact sans-serif UI text with clear 题库 / 英语一 hierarchy.
- Spacing and layout rhythm: 44 px touch target, 8 px header separation, centered catalog title, and no horizontal overflow.
- Colors and visual tokens: the switcher reuses the existing moss, warm paper, muted text, and border tokens without introducing a competing accent.
- Image and icon quality: the existing Font Awesome book and chevron glyphs are used at native vector quality; no replacement raster or custom-drawn icon was introduced.
- Copy and content: the visible compact label is 英语一 while the native menu retains the full 考研英语一 and disabled 英语四级（暂未安装）labels.

## Comparison history

- Pass 1: no actionable P0, P1, or P2 findings. The old oversized form-field treatment is replaced by a compact, page-native switcher; the catalog overlap is removed entirely.
- Remaining P3: none required for this scope.

## Primary interactions tested

- Home switcher is visible and enabled.
- Home to cloze catalog navigation works.
- Catalog back navigation works.
- Catalog contains no bank switcher.

final result: passed

---

# Tablet shell and learning-profile QA

## Responsive evidence

- 360 x 800: phone shell remains drawer-based; learning-profile metrics use a 2 x 2 grid and the page has no horizontal overflow.
- 768 x 1024: persistent rail is active; the compact-tablet content column uses a 2 x 2 overview so `WPM` and duration values remain intact.
- 1024 x 768: persistent rail, Reading / Exam tabs, year filter, four-column exam overview, trend and section cards all fit without horizontal overflow.
- 1280 x 800: exam result uses the focus shell without a duplicate rail and retains a comfortable centered reading width.

## Interaction and information architecture

- Reading / Exam is an accessible tablist; switching panels does not navigate away and the selected panel is retained.
- Exam data keeps translation completion separate from objective accuracy and exposes recent results or resumable attempts through the existing routes.
- Rail pages use one persistent global navigation on tablets; exam practice and result pages use the focus shell.
- Mobile behavior remains compatible, while tablet exam navigation is presented inside the content instead of duplicating a bottom bar.

## Visual findings

- Pass 1 P2: at 768 px the four overview metrics were compressed by the persistent rail and `WPM` wrapped vertically. The compact-tablet overview now stays 2 x 2; four columns begin at 840 px.
- Pass 2: no horizontal overflow or navigation overlap at the checked sizes. Paper, moss, typography, borders and surfaces continue to use the shared theme tokens.

final result: passed

---

# Review Center compact-card redesign QA

## Visual truth

- Source state: `C:\Users\a3284\AppData\Local\Temp\codex-clipboard-d80c884c-5211-4312-8d4d-80690ddb1d9b.png`
- Final summary implementation: `E:\play\claude\english-reader\mobile\artifacts\design-qa\exam-review-summary-final.png`
- Detail-dialog implementation: `E:\play\claude\english-reader\mobile\artifacts\design-qa\exam-review-detail-dialog.png`

## Normalization

- Source pixels: 713 x 1180; browser implementation: 489 x 792 CSS pixels at device scale 1.
- State: private-qa Review Center, `错题本` tab, one active 2026 cloze question.
- The comparison judges the requested hierarchy change rather than pixel fidelity to the rejected source card.

## Evidence and findings

- Full-view comparison: the source squeezes metadata, question number, long copy, status, and CTA into five horizontal columns. The final card keeps one vertical summary flow with year/type, numeric count, status, short scheduling copy, and two balanced actions.
- Focused-region comparison: question text no longer consumes the list card. `查看题目` opens a centered secondary card with a dimmed backdrop, clear heading, scrollable question rows, and a 48 px close target.
- Fonts and typography: serif display hierarchy and compact sans-serif metadata remain consistent; the count is a standalone number as requested.
- Spacing and layout rhythm: card padding, 18 px radius, two-button grid, and modal spacing are balanced at the captured mobile viewport; no horizontal text column remains.
- Colors and visual tokens: all new surfaces, borders, status pills, backdrop, focus states, and shadows use semantic exam/theme tokens.
- Image and icon quality: no new image asset is required; existing text controls and the app's close-button primitive are used.
- Copy and content: removed `1 道错题`; the summary shows only `1`. Full question labels and content remain available in the detail dialog.

## Comparison history

- Pass 1 P0: runtime `key is not defined` stopped Review Center rendering. Added a scoped group identifier and a regression contract; browser rendering recovered.
- Pass 1 P2: global red focus outline competed with the moss Review Center palette. Scoped Review Center focus indication to the exam accent.
- Pass 2: no actionable P0, P1, or P2 findings remain.

## Primary interactions tested

- Switching to `错题本` displays the compact summary card.
- `查看题目` opens the native detail dialog.
- The close action dismisses the dialog and restores focus.
- Browser console was checked; the discovered runtime error was fixed before the final capture.

final result: passed

---

# Unified Vocabulary Library — Design QA

## Evidence

- Source visual truth: `C:\Users\a3284\AppData\Local\Temp\codex-clipboard-442a7c8a-33aa-4135-b112-c0eff804c2dd.png` (853 × 1844 px; approximately 2× density, normalized to 427 × 922 CSS px).
- Implementation screenshot: `E:\play\claude\qa-artifacts\unified-vocabulary-library\implementation-final-viewport.png` (427 × 922 px, DPR 1).
- Side-by-side comparison: `E:\play\claude\qa-artifacts\unified-vocabulary-library\comparison-final.jpg`.
- Preview URL: `http://127.0.0.1:4174/#/vocab`.
- Compared state: vocabulary home, `全部` source filter, empty search, closed filter panel, no modal/drawer, four locally imported sample rows.

## Full comparison

- Header: warm paper background, orange circular menu action, green monospace kicker, serif Chinese title, tagline, and rule are aligned to the reference structure. The menu/text horizontal rhythm follows the reference while retaining the existing app drawer behavior.
- Content hierarchy: `全部单词`, count, outlined import action, search/filter control, three source tabs, and the green active underline are present and aligned at the reference viewport.
- Review strip: the two metrics and compact green `开始复习` action use the reference spacing and proportions.
- Word list: four bordered rows use the reference hierarchy—serif word, phonetic/audio line, definition, green source label, and right chevron. Rows are 112 CSS px high; the list begins at approximately y=422 CSS px, matching the reference.
- Footer: the management bar is fully visible at y≈871–911 CSS px, leaving the same small bottom paper margin. The existing `选词复习` action remains visible as a deliberate functional addition so专项复习 is not removed from the unified library.

## Focused comparison and responsive checks

- Reference viewport 427 × 922: no horizontal or vertical document overflow (`scrollWidth = clientWidth = 427`, `scrollHeight = 922`).
- Narrow mobile 390 × 844: no horizontal overflow; all four rows remain renderable.
- Tablet 1024 × 768: no horizontal overflow; the standard app shell and vocabulary page remain in the responsive layout.
- Interaction smoke: search narrows the list and clears, filter panel opens/closes, source tabs switch and return to `全部`, and no browser warning/error logs were emitted.
- Existing Font Awesome icons are reused for upload, search, filter, audio, sliders, and chevron affordances; no new image or hand-drawn SVG asset was introduced.

## Findings and history

- P0/P1/P2 findings: none.
- P3 intentional difference: the reference sample shows 326 mixed-source words, while this local QA state contains four imported words; source labels therefore differ by data state. The `选词复习` affordance is retained for existing专项复习 behavior even though it is not shown in the reference image.
- Earlier visual pass had oversized controls, loose 157 px rows, and a visible scrollbar. The final pass tightened the control stack, set rows to 112 px, brought the management bar into the first viewport, and reduced route padding so the page fits without overflow.

final result: passed
