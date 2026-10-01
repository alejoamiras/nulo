# Phase 3 · Browser proof

## The unfixed build

The red runs load a smoke build (the P3 build flags) of this branch with `seed.vue` and `create.vue`
replaced by their `85c4d20f` copies, plus the one `inputTestid` line the create case selects on. The
fixed files were copied to the scratch directory first and copied back afterwards, and
`git diff --quiet HEAD -- apps/extension/src` held before the fixed builds.

## Red runs (`--retry=0`, `tests/e2e/keyboard-guards.test.ts` alone)

- First design (the plan's), Chrome: both cases failed.
  - Retrieve recorded `press, click, repeat, click`: two activations of the button.
  - Create recorded the press and the repeat with no click and no `submit`. The document handler
    created the wallet: the hash reached `#/onboarding/learn` and one profile, `Main`, was stored.
- As built, Chrome and Firefox: both cases failed on both browsers.
  - Retrieve recorded `press, click, repeat, click` with the wrong password. So Firefox's native
    button activates on a repeat Enter too, the question `lessons.md` § E2E left unprobed.
  - Create recorded no activation of Create on either browser.

## What changed from the plan's design, and why

- **Create asserts one activation of Create, not one `submit`.** Implicit submission fires a click
  at the form's default button. Create's own click handler latches and disables the button, and
  Vue's render in the microtask after that listener lands before the button's activation behaviour,
  which then finds it disabled. So no `submit` event fires, before or after the fix, on either
  browser; the fixed builds record `press, click on onboarding-submit-create, repeat`. The case is
  red on `85c4d20f`, not green before and after as the plan expected: there the document handler
  created the wallet first, and implicit submission then found the default button disabled.
- **Retrieve holds Enter with a wrong password first.** With the right one, Firefox reveals the
  phrase before its driver delivers the repeat. In two diagnostic runs the repeat landed 48 and 42 ms
  after the press, on `BODY`, with the phrase already shown. The plan's recorded-list check caught
  this, as designed, so the plan's case could never pass on Firefox. A failed retrieval leaves Retrieve on the page, so the repeat lands on it however fast
  the retrieval ends. The case then types the right password and presses Enter once, and the phrase
  shows. It keeps the plan's assertions: the press and the repeat recorded on `unlock-submit-btn`,
  one click on the button, and `reveal-content` shown.
- The diagnostic runs added timestamps and targets to the record in the working copy only. The test
  was restored from its scratch copy before the as-built version was written.

## Gate

- Builds, each with `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet
  VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1`: `build:chrome` exit 0,
  `build:firefox` exit 0, both after the fixed pages were back and matched `HEAD`.
- Smoke, Chrome (`NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`): exit 0.
  39 files passed and 3 skipped (42); 159 tests passed and 7 skipped (166). The skipped files are
  `_probe-console-capture`, `action-popup-layout` and `store-captures`; `sw-resilience` and
  `appearance` skip one case each. Both `keyboard-guards` cases and `backup-roundtrip` passed.
- Smoke, Firefox (`NULO_E2E_BROWSER=firefox NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`): exit 0.
  40 files passed and 2 skipped (42); 155 tests passed and 11 skipped (166). The skipped files are
  `_probe-console-capture` and `store-captures`; `import-dead-rpc` skips its four Chrome-only cases,
  `sw-resilience` two and `appearance` one. Both `keyboard-guards` cases and `backup-roundtrip`
  passed.
- The session paused on an API spend limit after the Firefox smoke had finished (18:10) and before
  the flake bar started. No run was cut off, so nothing was reaped or rerun for it.
- Flake bar (`NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e
  tests/e2e/keyboard-guards.test.ts tests/e2e/backup-roundtrip.test.ts --retry=0
  --reporter=verbose`): three consecutive runs per browser, each exit 0 with 3 of 3 passed. Every
  run's verbose output lists both `keyboard-guards` cases and `backup-roundtrip` as passed, none
  skipped.
- `bun run e2e:reap`: exit 0, nothing to reap.
