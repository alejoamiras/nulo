# Plan v2.3 — Phase 2F follow-ups (WS1 + WS2 + WS3)

> Status: **APPROVED, ready to execute**. v2.2's "fee-methods via private-key import" idea was killed by audit-confirmed architectural blockers (private FJ requires `msg_sender == claimer` for `mint`; Nulo has no private cold-start fee strategy). User chose Path B: drop fee-methods from this round, defer to a separate cold-start product ticket. Old WS4 renumbered to WS3.

## Audit history
- **v1** drafted on 2026-04-27 with 3 hypotheses (H1/H2/H3) for the cap-account-item bug
- **v2** (post-Codex+Claude audit): all 3 hypotheses dropped (audits showed dispatcher already awaits all writes); WS3 reframed; order changed to WS1 Phase A first
- **v2.1** (user reframe): WS3 → "fee juice via private-key import"
- **v2.2** (post-recon): corrected private FJ mechanism (PrivateFPC, not shielding)
- **v2.3** (post-second audit): both auditors independently confirmed `PrivateFPC.mint` requires the claimer's signature → script-side pre-mint impossible. Codex additionally caught Nulo has no private cold-start integration. WS3-old dropped; renumbered.

## Goal

Resolve 3 of 5 Phase 2F follow-ups identified in `canonical-refactor-plan.md`. Independent workstreams.

---

## Critical context: WS1 bug is likely stale

Both audits independently traced the full code path and found:
- Dispatcher's `handleRequestCapabilities` fully `await`s every DappSession write before returning to dApp (`dispatcher.ts:457-488`).
- `resolveInteraction()` only settles the popup promise — persistence happens later in `handleRequestCapabilities` and IS awaited.
- `getAccounts` reads `dappSession.accounts`; `updateDappSession` writes to that exact field. Read/write paths align.
- `cap-request-accounts.test.ts` (un-skipped + passing in PR #2) exercises the **same** write path.

**Working assumption:** Phase A un-skip + run will pass. Plan structured around this most-likely outcome.

---

## Workstream 1 — `meta-getAccounts` (post-grant)

### Phase A — Reproduce (~15 min)

A1. Un-skip `meta-getAccounts.test.ts:19` (post-grant case): `test.skip` → `test.skipIf(!hasConfig)`.
A2. Run targeted: `bunx vitest run --config vitest.e2e.network.config.ts tests/e2e/network/meta-getAccounts.test.ts`
A3. **Decision point:**
   - **Path A — Passes** (likely): commit the un-skip with note about implicit fix from PR #2. Done.
   - **Path B — Fails**: capture error mode + extract `requestCapabilities` row JSON vs `getAccounts` row JSON to localize the gap. Move to Phase B.

### Phase B — Telemetry instrumentation (only if Phase A → Path B)

H1/H2/H3 from v1 dropped (audit-confirmed implausible). Replaced with **runtime instrumentation** at 5 sites to capture actual values:
1. `popup/windows/capabilities/index.vue:218` — log `selectedAccounts` after each `cap-account-item` click
2. `dispatcher.ts:457` — log `mergedAccounts` argument going into `updateDappSession`
3. `dapp-session/service.ts:131-154` — log `session.accounts` after persistence write
4. `dispatcher.ts:511-543` (`enrichGrantedCapabilities`) — log final `granted.accounts` returned to dApp
5. `dispatcher.ts:231-245` (`handleGetAccounts`) — log `dappSession.accounts` read on subsequent call

The values flowing through these 5 sites tell us exactly where the data drops.

### Phase C — Fix (only if Phase B reveals a real gap)

Plan the specific fix once root cause is known. Targeted PR. Logs reverted before commit.

### Phase D — Validate

- `meta-getAccounts.test.ts` (post-grant) → passes
- `cap-request-accounts.test.ts` → still passes (regression check)
- Smoke (`bun run test:e2e`) → 48/48
- `cap-request-rerequest.test.ts` may also unblock — check its TODO

### WS1 risk + estimate

- **Estimate:** Bimodal — 15 min (Path A, likely) or 1-3 hr (Path B). Cap at 3 hr; escalate if exceeding.

---

## Workstream 2 — `session-tabClose` / `session-tabNavigate` rewrite

### Status

Both tests skipped with stale TODOs. Wallet's actual behavior: tab close + cross-origin nav terminate only the **transport session**, not the persisted `DappSession`. Reconnect auto-approves at `background.ts:295-298` (origin + unlocked + non-expired). Verify pops on reconnect unless `trustedVerification=true`.

### Plan: reuse `session-reconnect.test.ts` as template

`session-reconnect.test.ts` (un-skipped + passing in PR #2) is the canonical pattern. Copy its structure.

#### Step 1 — Read template
`packages/extension/tests/e2e/network/session-reconnect.test.ts` — both `alwaysTrust=true/false` cases, `browser.targets().some(... discover ...) === false` assertion.

#### Step 2 — Adapt to tab-close lifecycle

`session-tabClose.test.ts`:
1. Connect via dappConnectedExtension (verify approved without `alwaysTrust=true` per current fixture)
2. Close the dApp tab
3. Re-open playground in a new tab
4. Click `pg-btn-connect`
5. **Assert no `/windows/discover` popup target appears** (auto-approved per `background.ts:295-298`)
6. **Assert verify popup DOES appear** (since `trustedVerification=false`)
7. Approve verify, expect `pg-status="connected"`

#### Step 3 — Adapt to cross-origin nav

`session-tabNavigate.test.ts`:
1. Connect
2. Navigate the dApp tab to a different origin (e.g., `about:blank`)
3. Navigate back to playground
4. Connect — same auto-approve + verify-pops assertion as Step 2

#### Step 4 — Un-skip + validate

Convert `test.skip` → `test.skipIf(!hasConfig)`. Run targeted.

### WS2 risk + estimate

- **Risk:** Cross-origin nav specifics (chrome.tabs.onUpdated semantics) might differ from tab close.
- **Estimate:** 30-45 min. Test-side rewrite, no production code changes, template proven.

---

## Workstream 3 — `tx-sendTx-feePayer` + `tx-sendTx-sponsoredFpc` (renumbered from old WS4)

### Status

Audits flagged these as separate fixable targets:
- `tx-sendTx-feePayer.test.ts` — TODO: feePayer set to recipient, not a valid FPC. **Not readiness — needs a real FPC address.** Already deployed in `global-setup.ts:aztecConfig.sponsoredFpcAddress`.
- `tx-sendTx-sponsoredFpc.test.ts` — TODO: two-step fee override race. `approveExecute` already does `waitForSelector` on `send-fee-method-{kind}`. Try adding `waitForExecuteContent` before the trigger click.

### Plan

#### W3.1 — `tx-sendTx-feePayer`
- Read test, locate `feePayer` assignment
- Replace with `AztecAddress.fromString(aztecConfig!.sponsoredFpcAddress)`
- Apply `waitForExecuteContent(execPopup)`
- Convert `test.skip` → `test.skipIf(!hasConfig)`
- Run targeted

#### W3.2 — `tx-sendTx-sponsoredFpc`
- Insert `await waitForExecuteContent(execPopup)` before `approveExecute({ feeMethod: "sponsored" })`
- Convert `test.skip` → `test.skipIf(!hasConfig)`
- Run targeted
- If still flaky after waitForExecuteContent, defer with sharper TODO

### WS3 risk + estimate

- **Risk:** sponsoredFpc may have a deeper race that the helper alone doesn't cover.
- **Estimate:** 30-45 min combined.

---

## Order of execution

**WS1 Phase A → WS3 → WS2 → (WS1 Phase B/C only if Phase A failed)**

1. **WS1 Phase A** (~15 min) — un-skip + run; likely passes, collapses WS1
2. **WS3** (~30-45 min) — quick tx-sendTx fixes
3. **WS2** (~30-45 min) — reuse `session-reconnect` template for tab-close + tab-navigate
4. **WS1 Phase B/C** (only if step 1 failed) — telemetry instrumentation, +1-3 hr

Best case: **~1.5 hr total** (Phase A passes, all green)
Worst case: **~5 hr total** (Phase A fails, full investigation cycle)

---

## Validation strategy

- Each workstream validated independently before moving to next
- Smoke + targeted e2e per workstream
- WS1 Phase B explicit: log values flow through 5 sites → diagnose → fix → smoke + targeted
- No batching across workstreams

---

## Manual checkpoints

- **After WS1 Phase A** (always): report path A vs path B + JSON if path B
- **After WS1 Phase C** (only if path B): user reviews fix before merge

---

## Decision points — RESOLVED

- [x] **Order**: WS1 Phase A → WS3 → WS2 → (WS1 B/C if needed). User-approved.
- [x] **WS1 Phase B telemetry**: instrument 5 sites, log, diagnose, revert before commit. User-approved.
- [x] **Drop old WS3 (fee-methods via private-key import)**: User-approved Path B from audit synthesis. Defer to a separate cold-start product ticket.
- [x] **WS3 (renumbered from old WS4)**: tx-sendTx-feePayer + tx-sendTx-sponsoredFpc small fixes. User-approved.
- [x] **PR strategy**: 3 separate small PRs (one per workstream). User-approved.
- [x] **Manual checkpoints**: after WS1 Phase A (always) + after WS1 Phase C (only if path B). User-approved.

---

## DEFERRED — fee-methods + private cold-start fee integration

The 2 currently-skipped fee-methods tests (`fee-methods.test.ts:62` "transfer with public Fee Juice"; `:126` "gas balance card non-zero FeeJuice") were dropped from this round because of architectural blockers found by both audits:

### Blocker 1: `PrivateFPC.mint` requires `msg_sender == claimer`
- Source: `aztec-fee-payment/src/nr/private_contract/src/main.nr:135` (`let claimer = self.msg_sender();`); canonical "wrong-claimer reverts" test at `aztec-fee-payment/src/ts/test/private.test.ts:208-244`.
- Implication: a test fixture cannot pre-mint private FJ on behalf of a yet-to-be-imported account. The mint must run inside the imported account's PXE.

### Blocker 2: Nulo has no private cold-start fee strategy
- Nulo's fee strategies only support public `claim_and_end_setup` (`fee-juice-with-claim-strategy.ts:21`) and generic FPC `pay_fee` (`fpc-strategy.ts:34`).
- @wonderland's `PrivateMintAndPayFeePaymentMethod` (`fee-payment-methods/private.ts:29`) bundles claim + mint + pay in a single setup phase, but **Nulo doesn't currently consume this**.
- Implication: a test that wants the imported account to perform private mint via cold-start would require a real product feature in Nulo's execution service — not a test-fixture tweak.

### Other risks for whoever picks this up later
- Identity model: `importPlain` takes a base64-encoded 32-byte profile master secret. The actual account secret is derived as `poseidon2Hash([master, chainId, AccountType.Nulo_v1, 0])`. Fixture must mirror `AccountService` + `NuloAccount.new`, not just `deriveSigningKey(secret)`.
- Accounts are **chain-scoped**: extension auto-creates a derived account per network. Switch to Local Network before asserting balances.
- PrivateFPC salt **must be `Fr.zero()`** for Nulo's `FpcService.getFpcs` auto-discovery (`fpc/service.ts:103-107`).
- `bridgeForMint` and `DOM_SEP__FPC_BRIDGE_SECRET` are test-internal in @wonderland (`dist/src/ts/index.d.ts:24-27`); must be ported from `harness.ts:145-148, 179-297`.

### Recommended scope for the deferred ticket
1. Add private cold-start fee strategy to Nulo's execution service (parallel to `FeeJuiceWithClaimStrategy`)
2. Build `feeJuiceImportedExtension` fixture that:
   - Pre-funds public FJ via existing `bridgeFeeJuice` + `claimFeeJuice` to the **derived** Local-Network account address (not the master secret directly)
   - Pre-funds private FJ via L1 deposit + leaves claim+mint to extension's first tx using cold-start strategy
3. Re-enable both `fee-methods.test.ts` skipped cases against the new fixture

Estimated effort for the deferred ticket: 8-12 hr (real product feature + fixture + tests).

---

**End of plan v2.3. Approved. Starting WS1 Phase A.**
