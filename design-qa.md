# Learning Notebook Design QA

## Comparison target

- Source visual truth: `C:\Users\a3284\.codex\generated_images\019f7f80-3063-7523-adce-7f078c753ce0\exec-83bef0f5-d4d9-4018-94a5-7ae935707635.png`
- Implementation screenshot: `design-audit/04-learning-notebook-home.png`
- Full-view comparison: `design-audit/07-learning-notebook-comparison.png`
- Supporting states: `design-audit/05-learning-notebook-drawer.png`, `design-audit/06-learning-notebook-history.png`
- Viewport: 390 × 844
- Theme and state: light theme; empty home conversation with the live welcome message. The source has a populated conversation and generated article, which cannot be reproduced without writing test data or invoking the configured AI provider.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the live empty-state home screen.
- The source’s populated message thread, vocabulary prompt, and generated reading preview are intentionally data-driven. The implementation keeps their existing live components and restyles the surrounding hierarchy; their exact populated layout still needs a real generated article to be compared one-to-one.

## Required fidelity surfaces

- **Fonts and typography:** Serif display treatment is retained for the main study prompt and generated article titles; compact monospaced labels distinguish the study context from body copy. Chinese body text remains readable at mobile size, with no clipping in the captured view.
- **Spacing and layout rhythm:** The fixed header, 48px study strip, introductory block, independently scrolling message area, single-line shortcut rail, and fixed composer fit the 390px frame. No document or composer horizontal overflow was detected.
- **Colors and visual tokens:** Warm paper, deep pine, muted moss, and restrained coral are mapped to existing semantic tokens. Coral is reserved for emphasis rather than becoming the default navigation color.
- **Image quality and asset fidelity:** The paper texture is a generated local raster asset at `assets/learning-paper-texture.png`, inspected before use. Interface icons use the packaged Font Awesome icon library; no hand-drawn SVG, emoji, or placeholder artwork was introduced in the redesigned header, drawer, composer, or shortcut rail.
- **Copy and content:** The static learning prompt uses product-appropriate copy: “从一个问题开始 / 对话、生成阅读与复习，都在同一条学习线里继续。” Existing user data and article content remain untouched.
- **Interaction and accessibility:** Header controls retain labels, the drawer has an explicit close control and Escape support, shortcut actions remain functional, and the composer retains its labelled text area and send button.

## Comparison history

1. **P2 — Drawer close affordance was not visible in the selected visual pass.**
   - Evidence: the first open-drawer capture only exposed the scrim close target; the header menu was behind the scrim.
   - Fix: added an explicit, labelled close control in the drawer header and kept the backdrop/Escape behavior.
   - Post-fix evidence: the drawer snapshot exposes the close control in its navigation region; the home route and shortcuts return after closing.

2. **Final comparison — passed.**
   - Evidence: `design-audit/07-learning-notebook-comparison.png` shows the same mobile scale, paper material, dark study anchor, editorial hierarchy, horizontally scrolling shortcuts, and fixed composer intent. The implementation appropriately omits the source’s fictional populated sample data.

## Validation

- Primary interactions checked: drawer open/close, topic shortcut prefilling the composer, fixed composer, horizontal shortcut rail.
- Browser checks: 390 × 844 viewport, no document overflow, no composer overflow, shortcut rail is horizontally scrollable, no console errors.
- Automated checks: all 20 Node regression tests passed; production build and Capacitor Android sync passed.

## Follow-up polish

- P3: once a real generated article is present in local data, capture that populated state and compare the article-card density against the selected reference.

final result: passed

---

# Flashcard Recall Design QA — 2026-07-22

## Comparison target

- Source visual truth: `D:\app\wechat\Document\xwechat_files\wxid_4nnc9rg1pden22_dcff\temp\RWTemp\2026-07\44973f6f44284e09330eaacfcd19a773\20996f2509b6c7caae10a79c6f388cb4.jpg` and `C:\Users\a3284\AppData\Local\Temp\codex-clipboard-0e1feadf-2541-4ba5-8161-9e961803fc8a.png`.
- Implementation route: `http://127.0.0.1:5173/#/flashcard` at a 360 × 800 CSS-pixel mobile viewport.
- Captured implementation state: live empty review state. The global header reads `ENGLISH LEARNING / 单词复习`; the primary `去阅读` action is coral with white text (`rgb(255, 255, 255)`), verified from the rendered page.
- Intended comparable state: recall scoring state with a due word. The live browser profile contains no due review words, so it cannot render the score-card state without writing test data into the user's app storage.

## Findings

- [P1] Comparable recall state unavailable for visual comparison.
  - Location: `/flashcard` live preview.
  - Evidence: the source is a recall card with the joined `认识 / 模糊 / 忘了` control; the rendered implementation is the legitimate empty-review state.
  - Impact: the exact visual match of word card height, score-control spacing, and dark-theme rendering cannot be judged from a same-state browser capture.
  - Fix: open the route with at least one due word in a non-user test profile, capture the recall state at 360 × 800, then compare it with the supplied source and record a follow-up result.

## Implemented checks

- The recall control now uses one joined three-column group, with Font Awesome smile, neutral, and frown icons; `跳过` is a centred secondary action, matching the reference hierarchy without adding custom-drawn assets.
- Internal refreshes render only inside the app shell outlet. This prevents the global `ENGLISH LEARNING / 单词复习` header from disappearing after revealing a meaning, rating, skipping, changing a tab, or moving to the next word.
- The empty-state primary action has an explicit semantic foreground color so the general empty-state link color cannot make the button label invisible.

## Required fidelity surfaces

- **Fonts and typography:** blocked for the recall card because no due-word state is available; the captured header uses the existing editorial serif hierarchy and is visible at 360px.
- **Spacing and layout rhythm:** blocked for the recall card; the grouped three-column control is covered by source and static regression checks, but not a same-state capture.
- **Colors and visual tokens:** verified on the empty state: coral primary background and white text have distinct rendered foreground/background values. Dark recall colors await a due-word capture.
- **Image quality and asset fidelity:** the score-state icons come from the bundled Font Awesome package; no substitute raster, emoji, CSS drawing, or custom SVG was added.
- **Copy and content:** source-aligned labels are `认识`、`模糊`、`忘了` and `跳过`; the live empty state copy remains product-specific.

## Validation

- Browser check: 360 × 800 rendered header text is `单词复习`; empty-state primary-action foreground is `rgb(255, 255, 255)` on `rgb(228, 87, 61)`.
- Automated checks: 46 Node tests passed, including the shell-preservation, segmented-scoring, and primary-action contrast regressions.
- Build check: Vite production build and Capacitor Android sync passed.

## Open questions

- A non-user test profile or a user profile with a due word is needed for final visual QA of the recall-card state. No application data was seeded or changed solely to create a screenshot.

final result: blocked

---

# Dossier Word Study Detail Design QA — 2026-07-28

## Comparison target

- Source visual truth: `C:\Users\a3284\.codex\generated_images\019fa68e-a619-7d03-85f5-d2d9fa9445db\exec-b9e09eac-2108-40c6-a04c-0b72e624e144.png`.
- Rendered implementation: `design-audit/10-dossier-final-390.png`.
- Full-view comparison: `design-audit/11-dossier-comparison-390.png` (source left, implementation right).
- Viewport: 390 × 844 CSS pixels, browser screenshot 390 × 844 pixels, device scale factor 1. The 854 × 1844 source was normalized to the same 390 × 844 comparison canvas; its 2-pixel aspect-ratio difference is immaterial to the mobile composition.
- State: light theme, reading route `#/reading/6`, `healthcare` opened through the existing compact Tooltip, full learning detail open on the `例句` tab.

## Findings

- No actionable P0, P1, or P2 differences remain.
- The source's small angled notches at the definition-band seam are a decorative illustration treatment. The implementation keeps a real, responsive semantic boundary instead of recreating that ornament with CSS art; this is an acceptable P3 difference.
- The visible focus ring around the close control in the automated capture is intentional keyboard accessibility feedback, not a default visual state.

## Required fidelity surfaces

- **Fonts and typography:** Both views use a high-contrast serif word display, compact monospaced `WORD NOTE` label, muted phonetic line, and more restrained serif examples. The implementation keeps Chinese definitions at a readable mobile scale without truncation.
- **Spacing and layout rhythm:** The 95dvh detail sheet preserves the large pine cover, a separate glossary band, a spacious numbered example field, and a persistent bottom index. The 320px capture showed no overlap; labels remain horizontally scrollable rather than compressed.
- **Colors and visual tokens:** Existing semantic pine, warm paper, moss, and coral tokens map directly to the selected design. Coral is limited to the note marker, example enumeration, and selected-tab underline; contrast stays readable on the pine cover and paper panel.
- **Image quality and asset fidelity:** The existing local `assets/learning-paper-texture.png` is reused as the cover texture. No new image substitutes, custom SVGs, emoji, or CSS illustrations were added.
- **Copy and content:** `WORD NOTE`, `例句 / 词根 / 同根词 / 词组 / 记忆法`, real dictionary definitions, and real examples are product content rather than mock filler.
- **Icons, states, and accessibility:** The close action remains a labelled 48px semantic button with focus feedback; phonetic and word remain playable controls. The tablist retains tab semantics and horizontal scrolling, while the material panel alone scrolls vertically.

## Comparison history

1. **P2 — The first dossier pass was too short and the examples lacked the source's numbered guideline.**
   - Evidence: `design-audit/09-dossier-implementation-390.png` showed a shorter cover and only a weak list rhythm.
   - Fix: increased the full-detail sheet to `95dvh`, increased cover/title spacing, and added the coral left guideline with numbered rows.
   - Post-fix evidence: `design-audit/10-dossier-final-390.png` and `design-audit/11-dossier-comparison-390.png` show the matching large pine cover, distinct glossary band, full three-example rhythm, and bottom tab rail.

2. **Final comparison — passed.**
   - The selected design's visual hierarchy is present in the rendered application without sacrificing the existing Tooltip entry point, five-tab interaction model, safe focus treatment, or narrow-screen horizontal tab scrolling.

## Validation

- Primary interaction checked: reading-word Tooltip opens; `查看学习详情` opens the complete detail sheet; existing word and phonetic playback controls remain semantic buttons; the five tabs are rendered as a labelled tablist.
- Browser checks: live in-app browser, 390 × 844 and 320 × 844 responsive passes; no console warnings or errors.
- Automated checks: `node --test tests/*.test.mjs` — 417 passed.
- Build check: `npm run build` passed, including Capacitor Android sync. The existing `udpipe-wasm` browser-compatibility warnings for `node:fs` and `node:crypto` remain non-blocking and unchanged.

## Follow-up polish

- P3: if a future visual reference makes the seam ornament a brand asset rather than a decorative treatment, add a supplied raster asset instead of approximating it in CSS.

final result: passed

---

# Shared Word Study Detail Design QA — 2026-07-28

## Comparison target

- Source visual truth: `E:\Download\Screenshot_20260728_102853.jpg` for the fixed study shell and tab rail; `E:\Download\Screenshot_20260728_103143.jpg` for the complete word-note content hierarchy.
- Implementation routes: `http://127.0.0.1:5175/#/learn-words`, `http://127.0.0.1:5175/#/vocab`, and the full-detail entry exposed by the reading Tooltip.
- Intended viewports: 320px and 390px mobile widths, light and dark themes.

## Implemented fidelity surfaces

- **Hierarchy:** fixed word head, independently scrolling learning-material panel, and fixed horizontally scrollable `例句 / 词根 / 同根词 / 词组 / 记忆法` rail.
- **Consistency:** learning vocabulary, saved vocabulary, and flashcard study reuse the same material renderer; source-specific SRS or reading-context metadata stays in the shared header.
- **Interaction:** every new word opens on `例句`; phrases load only when selected, cache locally, and reject fewer than three valid target-word phrases. Closing, switching words, routing away, or Android back invalidates late requests.
- **Typography and color:** the existing learning-notebook serif hierarchy, warm semantic paper surfaces, pine accent, safe-area spacing, and dark-theme tokens are reused instead of introducing a second visual language.
- **Accessibility:** the full detail uses a modal dialog, labelled close control, keyboard Escape handling, focus restoration, tab roles, and 48px close target.

## Validation

- Automated checks: all 416 Node regressions pass, including the final minimum-three-phrases assertion.
- Production build: Vite build and Capacitor Android sync passed. Existing `udpipe-wasm` browser-compatibility warnings remain non-blocking.
- Static overflow checks: the five tabs use intrinsic minimum widths and horizontal scrolling; the material panel owns vertical scrolling; the 320px rule stacks long related-word and phrase rows.

## Browser QA blocker

- The in-app browser tab was still on its generated connection-error `data:` page from before the local server started. Browser control correctly blocked navigation and DOM inspection from that untrusted error page.
- The local preview is now listening on port 5175, but no implementation screenshot was captured through an alternate browser or automation surface because the selected-browser policy forbids that workaround.
- Manual refresh of the user-visible tab is required before a same-state source/prototype screenshot comparison can be completed.

final result: blocked
