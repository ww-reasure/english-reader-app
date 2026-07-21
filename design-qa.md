# Design QA — unified mobile learning workspace

**Source visual truth**

- `E:/Download/Screenshot_20260721_104235.jpg` — the user-provided mobile chat reference, used for the minimal header, horizontal quick-action rail, and fixed rounded composer.

**Implementation evidence**

- Browser-rendered capture of `http://127.0.0.1:5173/#/chat`, taken at 460 × 1024 on 2026-07-21. The reference and implementation were opened in the same comparison input during QA.
- State: returning learner on the default learning-chat mode, no provider configured, empty composer.
- Primary interactions checked: opening and tapping outside the unified drawer, scrolling the quick-action rail, switching/retaining chat mode, opening the API setup gate on send, and dismissing it.
- Console errors: none.

**Comparison scope**

- The reference is an empty general-chat screen; the implementation is an English-learning workspace with an intentional welcome prompt and a separate generation-mode control. The comparison therefore focuses on the shared mobile shell and lower interaction region rather than copying unavailable reference actions such as calls, camera, or microphone.
- Full-view comparison confirmed a minimal header, deliberate vertical whitespace, a lower horizontal action rail, and a rounded fixed composer.
- Focused lower-region comparison was required and performed because the rail/composer spacing, horizontal overflow behavior, and control reachability are the fidelity-critical surfaces.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- [P3] The implementation keeps a compact “对话 / 生成阅读” switch above the composer. This is an intentional product-specific addition so article generation remains discoverable without adding unimplemented reference actions.

**Required fidelity surfaces**

- Fonts and typography: the app retains its editorial serif title treatment and compact sans-serif control text; text wraps within the 460px mobile viewport without truncating the persistent controls.
- Spacing and layout rhythm: header, content scroller, quick rail, and composer are separate regions. The composer uses safe-area padding and remains fully reachable.
- Colors and visual tokens: the reference's light, low-noise background is adapted to the app's existing cream paper surface, charcoal ink, and coral learning accent.
- Image quality and asset fidelity: neither comparison state contains product imagery. The implementation adds no substitute imagery or decorative image assets.
- Copy and app-specific content: first-use and returning-user messages now describe asking learning questions first and explicitly point to “生成阅读” only when article creation is needed.

**Comparison history**

1. [P1] Narrow mobile widths previously allowed the chat grid's composer to exceed the viewport (the 390px check measured a 640px composer track). Fixed by constraining the chat grid to `minmax(0, 1fr)`. Post-fix checks confirmed the page outlet and composer fit at 320, 360, 390, 412, and 430px widths.
2. [P2] The initial onboarding and shortcuts read like the old generation panel and used decorative glyphs. Fixed by moving to direct learning-chat copy and text-first quick actions. The final browser capture is the post-fix evidence.

**Implementation checklist**

- [x] Use the shared drawer instead of the legacy bottom dock on every route.
- [x] Lock the viewport to prevent pinch zoom and add safe-area-aware fixed controls.
- [x] Keep the chat rail horizontally scrollable and the composer fixed.
- [x] Preserve an explicit route to article-generation settings.
- [x] Verify no console errors, production build, Android sync, and Debug APK build.

**Follow-up polish**

- If a future icon package is adopted across the app, replace the existing text glyphs in the header/composer consistently; this is visual polish rather than a core-flow blocker.

final result: passed
