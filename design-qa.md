**Source visual truth**

- `C:\Users\a3284\.codex\generated_images\019fa68e-a619-7d03-85f5-d2d9fa9445db\call_f0vO5LvGlQJyTHO5YqUK17ps.png`
- Original pixels: `853 × 1844`
- Normalized comparison size: `390 × 844`

**Rendered implementation**

- Light: `E:\play\claude\english-reader\mobile\.worktrees\learning-loop-v1.9.2\design-qa-390x844-light-final.png`
- Dark: `E:\play\claude\english-reader\mobile\.worktrees\learning-loop-v1.9.2\design-qa-390x844-dark-v2.png`
- Narrow: `E:\play\claude\english-reader\mobile\.worktrees\learning-loop-v1.9.2\design-qa-320x700.png`
- Side-by-side comparison: `E:\play\claude\english-reader\mobile\.worktrees\learning-loop-v1.9.2\design-qa-comparison-final.png`
- CSS viewport: `390 × 844`
- Browser device pixel ratio: `1.5`
- Browser screenshot pixels: `390 × 844` (normalized to CSS pixels by the in-app browser)

**State**

- Traditional word review, post-rating study phase.
- First material tab active.
- One focused example visible; translation remains intentionally collapsed until the learner taps `译`.
- Light and dark themes verified. The source and implementation use different sample words, but the same interaction state and information hierarchy.

**Full-view comparison evidence**

- The final side-by-side comparison shows the same dominant hierarchy: global review title, slim progress line, large word masthead, phonetic and definition, low-emphasis information disclosure, five-tab material navigation, one centered example, pagination, all-examples entry, and fixed next/correction actions.
- The implementation keeps the App's existing global header and the explicit `03 / STUDY` progress label. This is an intentional product-shell constraint rather than visual drift.
- The implementation keeps the example translation hidden before request, preserving the established study behavior while retaining the reference's `译` affordance.

**Focused region comparison evidence**

- A separate crop was not required: each side of `design-qa-comparison-final.png` is a 1:1 `390 × 844` view, and the word masthead, tab states, example typography, pagination, and bottom dock remain legible in the combined image.
- The exam-information bottom sheet and dark-theme state were inspected separately in the browser. Both preserve 44px-class touch targets, readable contrast, and fixed bottom actions.

**Findings**

- No actionable P0/P1/P2 findings remain.
- Fonts and typography: the serif word and example hierarchy matches the selected direction; small utility text uses the existing monospace/sans system. Long example text scrolls inside the material stage rather than shrinking the full page.
- Spacing and layout rhythm: the material stage now owns the largest flexible region; the masthead, tabs, and bottom dock remain stable.
- Colors and visual tokens: the paper, pine, signal-red, and muted-rule palette follows the selected visual. Dark mode uses the semantic `--vocab-word` token to maintain contrast.
- Image quality and asset fidelity: the selected design contains no required photographic or illustrative asset. Existing paper texture and Font Awesome icons are retained; no placeholder or improvised image asset is used.
- Copy and content: study labels remain consistent with the App's current information architecture. `考试信息与复习间隔` is more explicit than the mock's shorter disclosure label.

**Comparison history**

1. Initial implementation:
   - P1: the active tab inherited the shared dark-green filled treatment instead of the selected red underline.
   - P2: the all-examples action read as a flat list row rather than a focused secondary control.
   - Fix: increased selector specificity, restored the signal-red underline, and introduced the centered outlined action.
2. Dark-theme pass:
   - P1: the word masthead used `--pine`, which had insufficient contrast on the dark paper.
   - Fix: switched the masthead to the existing semantic `--vocab-word` token and re-captured the dark state.
3. True-exam example pass:
   - P2: a very long first example consumed most of the visible material stage.
   - Fix: focused mode now prefers 6–28-word examples, with suitable true-exam examples first; all source examples remain available through `查看全部例句`.
4. Final pass:
   - Post-fix light, dark, 390px, and 320px evidence showed no remaining P0/P1/P2 issue.

**Primary interactions tested**

- Open and close exam-information sheet.
- Switch focused examples with pagination.
- Expand sentence translation.
- Open all examples and return to single-sentence study.
- Switch light/dark theme.
- 320px material scrolling and fixed next action.

**Console check**

- No application runtime error was observed.
- One expected browser autoplay warning appeared when automatic pronunciation was blocked before a user gesture; the review flow continued normally.

**Verification**

- `node --test tests/*.test.mjs`: `567/567` passed.
- `npm run build`: passed, including Android asset synchronization.

final result: passed
