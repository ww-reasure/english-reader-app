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
