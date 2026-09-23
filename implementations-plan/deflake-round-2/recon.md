# Recon — deflake-round-2 (4 read-only explorers, base = dev @ 3eb6e83)

## A1 — appearance.test.ts retry-masked flake

> **SUPERSEDED IN PART**: the rAF/polling theory in "Terrain" below was REFUTED by the
> empirical repro (§ "A1 — EMPIRICAL REPRO" at the end of this file) — `patchPagePolling`
> already injects `polling: 200` page-wide. Kept for the audit trail.

**CI forensics (primary evidence, from the certification campaign's saved logs):** vitest's
default reporter SWALLOWS the first-attempt error on an eventual retry-pass — the log carries
only `(retry x1)`. Durations discriminate: "animations toggle persists" totaled 6.3s over two
attempts (first attempt failed FAST ~2-3s → an assertion failure, not a hung wait);
"cycle theme" totaled 19.1s (first attempt burned ~13s → wait timeouts).

**Terrain (explorer, file:line):**
- Test A (theme cycle): each step's ONLY gate is `setTheme` (`fixtures/helpers.ts:929-945`) —
  `waitForFunction` on `html[theme]`, timeout 2_000, **NO `polling` option → Puppeteer default
  `'raf'`**. The codebase already documents that rAF polling throttles in unfocused/offscreen
  tabs and fixes it with `polling: 200` in `waitForHash` (`fixtures/extension.ts:1129-1139`) —
  `setTheme` and `navigateByHash` (`helpers.ts:1010`) never got the hardening. Divergent
  hardening for the same class of check.
- Test B (animations persist): a **fixed 150ms sleep** (`appearance.test.ts:40`) races the full
  causal chain click → appearance.vue `updateSetting` → ConfigService RPC → SW `config.set`
  (broadcast fires BEFORE the storage write, `wallet/config/store.ts:66-67`) → self-broadcast
  back on appearance.vue's OWN port mutates the model ref → Toggle re-render. The before/after/
  persisted reads are unsynchronized `className.includes("active")` on a CSS-module-mangled
  class; the stable signal `data-toggle-active="true|false"` (`design/src/ui/Toggle.vue:26`)
  already has a hardened gated-wait idiom in `togglePrivacySetting` (`helpers.ts:947-970`,
  `polling: 50`).
- Two independent `ConfigServiceClient` ports (appearance.vue:21, app.vue:46): `setValue`'s
  response resolves on ONE port while the `html[theme]` mutation is applied by the OTHER port's
  listener — awaiting setValue never proves the DOM applied. (setTheme polls the right signal;
  its polling mode is the hazard.)

**Hypotheses to CONFIRM empirically (goal requires reproduced evidence):** Test B's fast-fail =
150ms sleep losing the round-trip race under load; Test A's slow-fail = rAF-starved 2s waits in
an unfocused CI page. Repro plan: surface first-attempt errors (vitest retry-error reporting —
also a permanent observability win) + repeated local runs under parallel CPU load and/or an
unfocused page.

**Reuse:** `togglePrivacySetting`'s gated `data-toggle-active` wait; `waitForHash`'s
`polling: 200` + doc comment; `navigateToSettings`'s render-gated wait + diagnostics dump.
**Collisions:** don't add a second wait idiom beside `setTheme` — harden the ONE helper; fix
`navigateByHash` in lockstep with `waitForHash`'s documented rationale.

## A2 — pg-result mismatch observability

- `waitForPgResult` (`fixtures/playground.ts:68-107`): DOM-polled `[data-testid="pg-result"]`
  rows; `PgResult = {seq, method, status, resultJson?|errorJson?}` — resultJson on ok,
  errorJson on error, never both.
- ~35 call sites assert `status` bare (table in the explorer report; representative:
  frozen-account-canary.test.ts:163-166 — the observed blind failure).
- TWO ad-hoc dump idioms already exist: `tx-sendTx-delegated-authwit.test.ts:142-148` (BUG:
  dumps `resultJson` in the error branch where only `errorJson` is populated) and the canary's
  own error sentinel (`frozen-account-canary.test.ts:274-283`). `waitForPgResults` (plural)
  dumps only on TIMEOUT, not on settled-wrong-status.
- Payload safety: grant error payload = `{message: string}` via dispatcher `unwrapOperationResult`
  (`wallet-bridge/src/dispatcher.ts:146-157`); no key/witness material in the traced path;
  per-row JSON is NOT size-bounded playground-side (`playground/src/main.ts:64` caps row count
  only) → the dump helper must truncate.
- `waitForToast` (`helpers.ts:873-879`) has NO dump and no structured result — a body-text
  snapshot idiom (à la `collectParkedState`, `sendTransfer`'s snapshot at helpers.ts:715-730)
  applies there, NOT the pg dump. transfers.test.ts drives the extension UI, not the playground.
- **Shape:** one shared `expectPgOk(result, page, label)`-style helper IN playground.ts
  (bounded stringify of the CORRECT branch field), adopted at the canary + delegated-authwit
  sites (fixing the errorJson bug); plus vitest retry-error surfacing (feeds A1).

## A3 — body-text scan sweep

- Confirmed digit-class scans: `transfers.test.ts:45` (`waitForBalance "1,000"`),
  `account-switch-isolation.test.ts:325` (same), `receive-unregistered.test.ts:102` (the
  "1,025" loop — the file's core ship-gate pin), plus two same-class sites beyond the named
  list: `backup-migration-roundtrip.test.ts:135-158` (raw scans + waitForBalance) and
  `send-amount-clamp.test.ts:32` (readiness gate). `waitForBalance` itself is in the collision
  class.
- Non-targets (exempt): non-numeric needles (transfers:79 "Priv", :158 "No available tokens",
  receive-unregistered:37 error-string); account-switch-isolation:62 is a FILE content check;
  toast asserts (none in the target files).
- **Vocabulary hole:** `waitForFreshBalanceRow` (`helpers.ts:1196-1300`) proves PUBLIC raw only —
  receive-unregistered's 1,025 (private 0→25) and transfers' 950/50 detail checks need an
  `expectedPrivateRaw` extension (or sibling). transfers:128-139 detail-page asserts also need
  digit-boundary tightening (`toContain("50")` matches "950"/"150").
- **Fixture loops** (`extension.ts` tokenReady/feeJuiceReady/feeJuiceImported ~658-908): inputs
  all present BUT swapping is a fail-SOFT→fail-HARD behavior change with suite-wide blast
  radius — separate high-scrutiny step. gas-balance checks there are already scoped+pattern-based
  (different semantic, exempt).
- Reference implementations to copy: `backup-restore-integrity.test.ts:181-208`,
  `backup-restore-sw-restart.test.ts:458-466` (already swept — do not re-touch).

## A4 — cancel race

- `DappCancelledOverlay.vue` (composite, 48 lines): NO testid anywhere; rendered by
  discover/capabilities/execute windows.
- The window: `execute/index.vue:341` `approve()` guard `if (isInteractionCancelled || isLoading)
  return` — SILENT. The overlay covers buttons only VISUALLY; `execute-confirm-btn`'s disabled
  binding (line 524) does NOT include `isInteractionCancelled` — and our fixtures click
  programmatically, bypassing the overlay. A race-losing approve produces NO observable failure
  signal (popup just never closes).
- **Driver gap:** `DappInteractionService.cancelInteraction` (service.ts:176-181) has NO in-repo
  caller — the dApp-side cancel path (cancellationToken via wallet-bridge `execute(params,
  cancellationToken, hooks)`) is designed but never driven by product, playground, or tests. The
  race test needs a driver (playground cancel action, or direct service-client invocation with a
  known token).
- Signals available: overlay DOM (needs testid), `stripStatus === "cancelled"` (not
  testid-exposed), popup-not-closing (absence — unusable as a causal wait).
- cancel-mid-prove.test.ts is a DIFFERENT cancel (journal-level, post-approve) — not this race.

## A5 — feeMethod re-key

- Dead mapping in TWO helpers: `approveExecute` (`fixtures/popups.ts:319-344`) and
  `pickFeeAndSubmitAuthwitPopup` (`popups.ts:351-375`) — both interpolate `"fj"|"fpc"` straight
  into `send-fee-method-${x}` selectors that never render (30s selector timeout if used).
- Real testids (pinned by `FeeMethodSelector.test.ts:55-58`): `send-fee-method-{public|private|
  sponsored}` (+ a disabled "coming soon" entry) from `FeeMethodSelector.vue:42`
  (`method.subtitle`-driven).
- All current feeMethod call sites use `"sponsored"` only (3 files); `fee-methods.test.ts`
  exercises public/private via the SEND-flow helper `selectFeeMethod` (`helpers.ts:834`), not
  the execute-popup param. Exercising public/private submits in the EXECUTE flow implies real
  fee-juice funding; the cheap honest exercise = select + assert the trigger's
  `data-fee-method` attr, then reject (no funded submit).

## B7 — exit-86 setup coverage (evidence for the design decision)

- Mechanism: `agent.sh:179-202` classifies via sentinel markers (`sentinel.ts:79-83` — 86 iff
  boot-started ∧ ¬boot-ready ∧ ¬tests-started); `_network-e2e.yml:238-284` retries the WHOLE
  agent once on 86.
- Outside the retry: checkout, setup-bun, setup-aztec (incl. snappy pin + preflight),
  setup-puppeteer, setup-accelerator-server, accelerator start + its 30s readiness poll. No
  composite action has step-level retry.
- Evidence check: neither observed setup incident would have been saved by a step retry —
  snappy 7.4.0 was DETERMINISTIC; the noirup 503s already had an inner 3× retry that failed
  through a sustained outage. Working thesis for the decision: fail-loud + targeted
  load-check pins > blanket setup retries.

## A1 — EMPIRICAL REPRO (2026-08-13, local, retry=0)

Baseline 10× no-load: 10/10 pass. Load batch 1 (nproc-2 CPU hogs) 10×: **1 failure — the
theme-cycle test, 17s**, failing waiter identified: `clickByTestId("theme-dark-btn")` 10s
timeout via `setTheme` (helpers.ts:938), NOT the html[theme] wait. Stack shows
`patchPagePolling` (extension.ts:938-953) already injects `polling: 200` into every
waitForFunction — the rAF/polling hypothesis is REFUTED (codex plan-audit Critical 1 concurs;
Chrome also launches with anti-throttling flags and pages are brought to front).
**Actual mechanism (source-confirmed):** `setTheme`'s ONE-SHOT `offsetParent` visibility
sample (helpers.ts:933-936) races DropdownRoot's close `<Transition>` (DropdownRoot.vue:254-256
— leaving items stay visible mid-close; no state attribute exposes `isOpen`): sample catches
the closing menu from the PREVIOUS selection → trigger click skipped → option gone when the
click-wait polls → 10s timeout. Load stretches the close animation, widening the window.
Load batch 2 (20×): 0 failures — the window is narrow; the animations-test fast-fail signature
(CI: ~2-3s first-attempt fail) remains UNREPRODUCED; plan: measure the click→class-flip
latency distribution under load (p99 vs the 150ms sleep) as the evidence vehicle instead of
waiting for a lottery hit.
