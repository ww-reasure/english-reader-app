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
