# Plan v1 — Group A (popup-readiness) + Group B (wire-shape) fixes

> Status: **draft for audit**. Two parallel audits next: Codex `xhigh` + Claude general-purpose. Iterate, then present to user for approval. Not committed.

## Goal

Un-skip 10 of the 12 remaining skipped network tests:
- **Group A** (7 cases) — popup-readiness flakes
- **Group B** (3 cases) — wire-shape mismatches

User's directive: **don't assume tests are right**. For each test, the failure could be either:
- (a) Test wrong — wrong selector, racy assertion, wrong opts shape, etc.
- (b) Implementation wrong — actual bug in wallet/dispatcher/popup that the test happens to surface
- (c) Both — test was written speculatively against an unfinished implementation

Plan structure: **investigate-then-fix per test**, not blanket "apply readiness helper everywhere".

---

## Recon already done (v1)

### `cap-rerequested-badge` premise IS valid
- Testid exists: `capabilities/index.vue:489` (`<span v-if="cap.reRequested" data-testid="cap-rerequested-badge">`)
- Dispatcher tracks rejections + computes `reRequested` correctly: `dispatcher.ts:386-477`
- `cap-reject-btn` exists: `capabilities/index.vue:577`
- So the premise of `cap-request-rerequest` is sound. Failure must be timing.

### Group A test fixture pattern
All 7 use `dappConnectedExtension(PerTest)` (login → switch to Local → connect). The cap-grant flow uses `approveCapabilities()` helper which already waits for `cap-item OR cap-account-item`. The `clickByTestId` helper (post-WS3) catches Target-detach errors via cause-walking.

### Group B existing patterns
- `authwit.ts:45-86`: playground builds `intent` with `caller`/`functionCall` (callIntent) or `caller`/`consumer`/`innerHash` (innerHash). Hand-built `FunctionCall`-shaped object — no use of `FunctionCall.from()`.
- `simulation.ts:65-108`: simulateTx uses `{from, skipFeeEnforcement, skipTxValidation}`; profileTx uses `{from, profileMode, skipProofGeneration} as any`; executeUtility uses `{scopes, authWitnesses, capsules, extraHashedArgs} as any` (the one that PASSES per audit).

---

## Phase 0 — Reconnaissance run (~30 min, NEW)

Before fixing anything, observe actual failure modes.

1. Branch off master.
2. Un-skip ALL 10 tests at once.
3. Run each individually (with `pkill -9 chrome` between) against fresh sandbox.
4. Capture per-test:
   - Failure mode (timeout? assertion? selector miss?)
   - Where in the test it fails (line number)
   - Pass rate (run 3x for flake characterization)
5. **Decision tree per test:**
   - **Path P (passes 3/3)**: stale TODO; commit un-skip.
   - **Path F-readiness (timeout on selector)**: Group A — needs targeted readiness fix.
   - **Path F-assertion (selector found, value wrong)**: implementation bug OR test assertion wrong — needs investigation.
   - **Path F-throws (test code throws)**: bug in test logic.

This data then drives Phase 1 + Phase 2.

---

## Phase 1 — Group A fixes (~2-3 hr)

### Sub-step layout (after Phase 0 data)

#### A1 — Capability popup readiness (cap-request-basic, cap-request-reject)
- **Hypothesis**: Click on `cap-approve-btn`/`cap-reject-btn` races with popup auto-close on resolveInteraction. We thought clickByTestId cause-walking fixed this in WS3 but the basic/reject tests still flake.
- **Investigation**: log the exact error and the popup's open/close timestamps. If clickByTestId already swallows the detach error, the assertion AFTER the click is the culprit (e.g., `waitForPgResult` racing with popup close → SW disconnect → seq counter not incremented).
- **Likely fix**: extend `callExpectingNoPopup` / `waitForPgResult` to retry on transient SW disconnect, OR add a small explicit wait for the result-feed update before resolving.

#### A2 — `cap-request-rerequest` (the user's specific concern)
- **Premise verified**: testids and dispatcher logic correct.
- **Investigation**: trace the second popup's `init()` lifecycle. The popup queries `payload.session.capabilityRejections` to compute `cap.reRequested`. If the rejections list is written asynchronously after the first popup closes, the second popup's `init()` may race.
- **Possible bugs to surface**:
  - Bug 1: Dispatcher's reject path doesn't await the rejection-write before resolving the dApp's `requestCapabilities` rejection (similar to the WS1 bug premise we already disproved for grants — but verify for rejects).
  - Bug 2: Second popup loads stale data because the cap-rejection persistence happens after the popup's payload is built.
- **Investigation steps**:
  1. Run the test with logging at: dispatcher reject path, capabilityRejections write, popup's init payload read.
  2. If race confirmed: add `await` to the persistence write before resolving.
  3. If no race but flake: add poll for `cap-rerequested-badge` to render before reading items.

#### A3 — Silent-path tests (data-privateEvents, contracts-register, sim-executeUtility, authwit-innerHash)
- All use `callExpectingNoPopup(extension, page, method, clickFn)`.
- **Investigation**: read `callExpectingNoPopup`'s implementation. Does it:
  - Wait for the result-feed `pg-result` row to settle to `ok`/`error`?
  - Snapshot `browser.targets()` before/after to confirm no popup opened?
  - Have a configurable timeout that's tight for these methods?
- **Likely fix**: tighten the seq-result wait pattern; add an explicit polling loop with longer timeout for execute-utility-class methods (which do real PXE simulation).

### Group A risks
- **Risk**: Some tests may surface real bugs (Path F-assertion) that need bridge-side or popup-side fixes — not just test-side. Cap WS at 3 hr; if a real bug surfaces, scope it as a follow-up rather than blocking the rest.
- **Risk**: Adding a longer wait may convert "fast flake" into "slow flake". Fix should be deterministic, not time-based.

---

## Phase 2 — Group B fixes (~1.5 hr)

### B1 — `authwit-callIntent`
- **Investigation**:
  1. Read `wallet-bridge/src/scope-enforcement.ts:241-287` (the dispatcher's `createAuthWit` handler).
  2. Read `aztec-fee-payment/src/ts/fee-payment-methods/private.ts:105` (the canonical `FunctionCall.from(...)` pattern Codex flagged).
  3. Compare with playground's hand-built stub at `authwit.ts:54-66`.
- **Likely fix**: replace the hand-built FunctionCall in the playground with `await FunctionCall.from({...})` per the canonical pattern.

### B2 — `sim-simulateTx` + `sim-profileTx`
- **Investigation**:
  1. Read `wallet-bridge/src/dispatcher.ts:handleSimulateTx` and `handleProfileTx`.
  2. Find the canonical opts shape per the wallet-sdk skill (`wallet-sdk.md` simulateTx + profileTx sections).
  3. Compare with playground's calls at `simulation.ts:69-85`.
- **Hypothesis from TODO**: "simulateTx/profileTx fail with executeUtility-style scopes/options shape mismatch". Possibilities:
  - Dispatcher REQUIRES `scopes` for simulateTx/profileTx but playground doesn't send it
  - Playground sends fields dispatcher doesn't expect
  - Token contract is unregistered in the extension's PXE → simulation can't resolve `transfer_public_to_public`
- **Likely fix**: align playground's opts to whatever the dispatcher expects + ensure the token contract is registered (might need an explicit `registerContract` capability grant before sim).

---

## Phase 3 — Validate

- Run each fixed test individually (pkill chrome between runs)
- Run full `fee-methods.test.ts` suite (no impact, just regression-check)
- Run full smoke (`bun run test:e2e`)
- Run full network suite (deferred — only if all individual passes)

Per the user's iterative-validation feedback memory: validate per test, not per phase. No batching.

---

## Investigation tooling

For each Phase 0 or Phase 1 investigation:
- Use `HEADLESS=0` to observe popups visually if needed
- Use `console.log` at key dispatcher / popup sites (revert before commit)
- Use `chrome.storage.local.get(null)` snapshot before/after key operations to verify writes
- Use `browser.targets()` snapshots to characterize popup lifecycle

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Real bug surfaces in dispatcher reject path | M | Scope as follow-up; don't block other fixes |
| `callExpectingNoPopup` needs deeper rewrite | M | Time-box at 1 hr; if not done, defer that test |
| Popup-readiness fix breaks already-passing tests | M | Run smoke + tx-sendTx tests after each helper change |
| Wire-shape mismatch is a real bridge bug, not playground | L | Audit confirms direction before code changes |
| Chrome process flake masks real issues | L | Aggressive pkill between runs; characterize over 3+ runs |

---

## Time estimates

- Phase 0 (recon): 30 min
- Phase 1 (Group A): 2-3 hr (bimodal: 1 hr if mostly readiness; 4 hr if real bugs)
- Phase 2 (Group B): 1-1.5 hr
- Phase 3 (validate): 30 min
- **Total: 4-5.5 hr realistic**

---

## Open questions for audits

1. **`cap-request-rerequest`**: does the dispatcher's reject path AWAIT the `capabilityRejections` write before resolving the dApp's promise? If not, the second popup may load stale state. Trace `dispatcher.ts:handleRequestCapabilities` reject branch + the persistence write order.
2. **`cap-request-basic` Target-closed**: did the WS3 cause-walking fix in `clickByTestId` actually resolve this? Or is there a NEW failure mode after that fix? Run the test at master HEAD and report.
3. **`callExpectingNoPopup`**: does it correctly wait for the result-feed row to settle, or is there a return-before-settle race? Read the helper's implementation.
4. **`sim-simulateTx`/`profileTx`**: trace the dispatcher's required opts shape. If `scopes` is required, the playground must send them. If NOT required, why does the test fail today? Dig into the actual dispatched call.
5. **`authwit-callIntent`**: is the playground's hand-built `FunctionCall` stub valid per the wallet-sdk type contract, or does it need `FunctionCall.from(...)`? Compare to `private_fee_payment_method.ts:105`.
6. **Cross-cutting `chrome.runtime.connect` race**: could popups be loading before the background port is ready? If yes, early clicks no-op. Investigate the `nulo:liveness` heartbeat timing and whether the popup has a "background-connected" sentinel we should also wait for.
7. **Ordering**: Phase 0 before Phase 1/2, then 1 then 2. Should Phase 0 be split (recon Group A first, then Group B)? Or all at once?

---

## Decision points for user approval

- [ ] **Investigate-then-fix approach OK?** Plan invests 30 min of recon BEFORE any fix. User's directive supports this.
- [ ] **Phase 0 runs all 10 tests at once for characterization** — OK?
- [ ] **PR strategy**: 1 PR for Group A + 1 PR for Group B (clean separation). Or 1 bundled PR?
- [ ] **If a real bug surfaces (not test-only)**: file a follow-up issue + skip the test; don't block other fixes. OK?

---

**End of plan v1. Audits next.**
