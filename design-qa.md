# English I 真题训练界面视觉 QA

## Findings

- 无 P0/P1/P2 阻断项。
- [P3] 用户提供的截图是外部设计参考，不是严格的手机原生截屏；本轮按用户要求只吸收米白纸张、深绿色主色、卡片层级、紧凑导航和返回式页面结构，不做像素比例对照。
- [P3] 当前本地数据包含已完成、进行中和历史 attempt，因此进度数字、复习数量和学习记录数量会随 IndexedDB 状态变化；这属于真实数据状态，不是视觉回归。

## Comparison history

- Initial browser pass found one P2 interaction-state mismatch: the non-final practice question had `hidden=true` on the submit button, but the generic `.btn` display rule still rendered it in the header.
- Fix applied: `.exam-sheet-header-actions .btn[hidden] { display:none; }` in `css/style.css`.
- Post-fix evidence: the first-question, final-question and `peek` captures show the intended states; the first-question button is absent, the final-question button is in the header, and `peek` retains only the handle/progress/navigation row.

## Source and implementation evidence

- Source visual direction: `C:\Users\a3284\AppData\Local\Temp\codex-clipboard-d59c0f41-0991-4b7a-ac31-fda3d5117254.png` (`669 x 910` pixels). It was used as a qualitative style reference only; no density or pixel normalization was applied.
- Browser implementation viewport: `816 x 618` CSS pixels. The exam shell constrains its content to `608` pixels at wide widths and uses the existing `@media (max-width: 480px)` rules for phone widths.
- Current implementation captures, all `816 x 618` pixels from the in-app browser:
  - `E:\play\claude\english-reader\mobile\design-qa-exam-home-current.png` — `#/exam`
  - `E:\play\claude\english-reader\mobile\design-qa-exam-catalog-current.png` — `#/exam/catalog/reading_mcq`
  - `E:\play\claude\english-reader\mobile\design-qa-exam-review-current.png` — `#/exam/review`
  - `E:\play\claude\english-reader\mobile\design-qa-exam-history-current.png` — `#/exam/history`
  - `E:\play\claude\english-reader\mobile\design-qa-settings-current.png` — `#/settings`
  - `E:\play\claude\english-reader\mobile\design-qa-exam-practice-first-current.png` — practice before the final question
  - `E:\play\claude\english-reader\mobile\design-qa-exam-practice-final-current.png` — practice on the final question
  - `E:\play\claude\english-reader\mobile\design-qa-exam-practice-peek-current.png` — practice at the new peek snap
  - `E:\play\claude\english-reader\mobile\design-qa-exam-result-current.png` — submitted result
  - `E:\play\claude\english-reader\mobile\design-qa-exam-explanation-current.png` — submitted explanation

## Actual-render review

- Home: the top-right selector contains only `考研英语一` and `英语四级`; the latter is visibly disabled until a real CET-4 pack is installed. The green resume card, outlined full-paper card, specialty list, wrong-book card and fixed compact bottom navigation share one paper/green visual language.
- Catalog: the global drawer is absent, the back button is visible, the title and bank selector are aligned in one compact header, and years/units use the same cream surface, green progress state and quiet borders.
- Review Center: metrics, tabs and review cards use the same surface tokens; hidden tab panels remain hidden after the CSS override.
- Learning history: rows use the same restrained borders, serif heading hierarchy and compact mobile spacing as the desktop/catalog surfaces.
- Practice: the split article/sheet remains functional, the header uses return navigation, the global settings page owns the word-lookup switch, and the submit action is absent before the final question and visible in the sheet header only on the final question.
- Explanation: the return header has no local word-lookup switch, the sheet controls use the same green primary treatment, and the reading-style Tooltip/Dictionary path remains available by default without changing Ask AI or Tutor behavior.
- Result: summary metrics, filters, grouped question cards, original options and user/correct-answer states use the same paper cards and green action hierarchy.

Full-view comparison used the home, review, history, practice and explanation captures to check hierarchy and density. Focused regions covered the bank selector, fixed bottom navigation, settings switch, practice sheet header and `peek` state; exact pixel comparison was intentionally not used because the supplied reference was not a phone capture and the user asked to judge the product proportions directly.

## Required fidelity surfaces

- Fonts and typography: exam headings use the existing serif editorial hierarchy; supporting labels use the existing sans/monospace tokens; practice text keeps readable line height.
- Spacing and layout rhythm: all non-practice exam pages use a shared `608px` mobile-like column, consistent 18–26px page padding, 10–12px card gaps and compact headers. Home navigation is fixed to the viewport bottom with safe-area padding and dashboard bottom space reserved beneath it.
- Colors and visual tokens: cream paper, near-white surfaces, muted olive text and deep green primary actions are scoped to the exam shell; wrong/error states remain semantically distinct.
- Image and asset fidelity: no new decorative image was introduced; existing FontAwesome icons are used for the selector, cards, navigation, progress and return affordances.
- Copy/content: the selector exposes exactly the two requested choices, unavailable CET-4 content is not fabricated, and existing exam labels remain intact.
- Accessibility: selector and settings switch retain labels, return/menu controls retain accessible names, the sheet handle remains a keyboard slider, buttons keep focus-visible outlines, and the fixed nav includes safe-area padding.

## Interaction and console checks

- `#/exam`: hamburger opens the existing drawer; bottom navigation stays fixed and compact.
- Catalog: back navigation works, no global drawer is rendered, year/unit rows and random entry remain available.
- Settings: the “做题时点词翻译” switch is persisted immediately and its copy states that it only affects the answering phase.
- Practice: return navigation keeps the exit-confirmation flow; the word-lookup switch is not duplicated locally, the first question has no submit action, and the final question shows submit in the header.
- Explanation: Ask AI and Exam Tutor remain present; the explanation route has no switch and always keeps word lookup available.
- Sheet: dragging the handle reaches the `peek` snap, hiding body and footer while retaining progress and previous/next controls.
- Result: `查看解析` opens the shared explanation route; result cards remain expandable.
- Browser console checked after home, catalog, review, history, practice, result and explanation routes; no new runtime errors were observed.

## Verification

- Full tests: `762` passed, `0` failed.
- `npx vite build --mode public`: passed.
- `npx vite build --mode private-qa`: passed.
- Browser console warnings/errors: none observed after the final route pass.
- `git diff --check`: passed; only existing line-ending warnings were reported.

## Follow-up polish

- After the next real-device install, only safe-area and native font rendering may need minor tuning; no known P0/P1/P2 visual issue remains in the browser-rendered exam flow. The current pass intentionally did not generate an APK.

final result: passed
