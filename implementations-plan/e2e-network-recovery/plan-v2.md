# E2E Network Suite Recovery — Plan v2 (post-audit)

Supersedes [plan.md (v1)](./plan.md). Tier A. Consolidates [audit-codex.md](./audit-codex.md) + [audit-opus.md](./audit-opus.md) + the **prior phase-0 investigation** at [`implementations-plan/network-test-triage/`](../network-test-triage/) which already root-caused the dominant failure cluster.

## What changed from v1

| Section | v1 said | v2 says | Source |
|---|---|---|---|
| Triage model | 5 buckets (A wiring / B timing / C fixture / D real bug / E patch-induced) | **Implement the prior phase-0 fix surface directly.** Existing triage already root-caused the dominant cluster. New work batches by *mechanism*, not test. | Codex critique #1; opus critique #1 |
| Quarantine unit | per-test (30min budget) | **per-mechanism 90min root-cause budget**, batch-fix or batch-quarantine the cluster together | Opus critique #2 |
| Product code changes | "no rewriting product code to make tests pass" | **In-scope when ≥3 quarantined tests would unlock**; precedent: `background/client.ts:77-83` (RPC-abort-on-disconnect) from prior audit | Codex critique #5; opus critique #4 |
| Skip semantics | `describe.skipIf(...)` | **`test.skip("reason")`** for honest vitest counts. Track retried-passes as separate state. | Opus critique #5 |
| Setup failure mode | Implicit | **Add Phase 0.5: fail-loud `global-setup.ts`** so silent-skip can never regress again | Codex critique #3; opus critique #3 |
| Validation gates | `audit:vue` after every group | `audit:vue` at checkpoints; isolated per-file vitest during triage | Codex critique #5 |
| Bucket E (patch-induced) | Phase 5 | **Moved to P0** — gate, not late phase | Codex critique #2 |

## 0. Context (unchanged, recap for completeness)

Commit `418ece9` strips `module` field from `@aztec/noir-noirc_abi@4.2.0` + `@aztec/noir-acvm_js@4.2.0` via `bun patch`. Without this, Vite's ESM resolver picked the web bundle whose `__wbg_init` called `fetch(file://...)` → Node's undici returns `makeNetworkError("not implemented... yet...")` → `WASMSimulator.init` throws → `global-setup`'s `deployContractsAndProvide` caught silently → `aztecTestConfig: undefined` → all 61 tests `describe.skipIf(!config)` skipped → exit 0 → CI showed pass-by-skip the entire post-OSS history.

After commit 1, tests **actually run**. Baseline: `41 failed / 4 skipped / 53 tests failed / 8 skipped`. Recovery starts here.

## 1. Goals (unchanged)

- `bun run e2e:agent` exits 0 with zero unexpected failures.
- `Network e2e / Status` CI check goes from pass-by-skip to **real run** OR **explicit, tracked quarantine**.
- Net test count (passing + intentionally skipped + quarantined with `test.skip("reason")`) = 61.
- Smoke e2e (`bun run test:e2e`) continues to pass.
- `bun run audit:vue` continues to pass.

## 2. Non-goals (slightly revised per critiques)

- No new tests.
- No infra rewrite EXCEPT the fail-loud setup change in P0.5.
- Product code changes ARE in scope when justified (≥3 quarantined unlocks). Default lean: test-side first; product-side when the root cause is on the product side AND fix is well-scoped.
- No PXE-guard serialization refactor (deferred per prior audit; not the blocker).
- No LMDB workaround (sporadic per prior audit; rerun-on-failure).
- No dependency bumps, no Cloudflare flake work, no orthogonal infra.

## 3. The fix surface (from prior phase-0 + audits)

Phase 0 of the prior `network-test-triage` work identified **one unifying root cause**: `switchToLocalNetwork` doesn't wait for popup account state to populate. This cascades through:

- **Cluster A** (~11 tests): `NewTokenPopup.handleAddToken` reads `appStore.account.address` while `account` is `undefined` → swallowed catch → toast never fires → 60s helper timeout
- **Cluster B** (~3 tests): `feeJuiceImported` fixture's 30s `waitForFunction` on `nulo:ui:activeAccount` never settles
- **Cluster D** (~1 test): contact-row renders but sender chip depends on active-network senders list which depends on `account` being set
- **Cluster E** (~1 test, plausibly): `dappConnectedExtension` likely same root

Plus **one secondary product bug**: `background/client.ts:69-87`'s `disconnect()` rejects pending RPCs, killing fire-and-forget side effects when popups close mid-RPC. Not the blocker but real.

### Prescribed fixes (drawn from prior phase-0 + verified by codex/opus)

Numbered as `F<n>` for traceability in commit subjects.

**Wallet fixes** (`packages/extension/src/...`)

- **F1** — `popup/app.vue:131-150` network watcher: call `ensureDefaultAccount` after re-fetching accounts when `appStore.accounts.length === 0`. Guarded against the initAccount race per the existing comment.
- **F2** — `popup/components/popups/NewTokenPopup.vue` `handleAddToken`: guard `appStore.account?.address`; if missing, set inline error + return. Plus disable submit when `!appStore.account`.
- **F3** — `popup/components/popups/NewContactPopup.vue` `handleAddContact`: same guard pattern as F2 for the addSender branch.
- **F4** — `popup/components/popups/EditContactPopup.vue` `handleUpdateContact`: same guard pattern.
- **F5** — `packages/extension-messaging/src/background/client.ts:69-87`: change `disconnect()` to NOT reject pending requests; let them resolve naturally via the existing `onMessage` handler. (Crosses package boundary — a flag for codex to verify the disconnect contract isn't load-bearing elsewhere.)

**Test-helper fixes** (`packages/extension/tests/e2e/fixtures/`)

- **F6** — `extension.ts` `switchToLocalNetwork`: after click + closeStuckPopup, wait for `nulo:ui:activeAccount` to be populated (existing pattern at lines 489-518 already does similar; extend if needed).
- **F7** — `extension.ts` `addContact` helper: when `registerAsSender: true`, ALSO wait for the sender chip on the row (stronger signal than just the row).
- **F8** — `extension.ts` `closeStuckPopup`: best-effort wait for `accountStateService` / `contactService` to have no pending requests. **Skip if F5 lands cleanly** — F5 makes disconnect non-cancelling so this becomes redundant.

**Tight-timeout bumps** (narrow, per-file)

- **F9** — `tests/e2e/network/contacts-sender.test.ts` test 1 chip wait: 10s → 30s.
- **F10** — `tests/e2e/network/data-registerSender.test.ts` `waitForPgResult`: verify 30s vs latency in baseline; bump to 60s if needed.

### Phase 0.5 — Fail-loud `global-setup`

Currently `global-setup.ts:426-428` catches deploy failure and provides `aztecTestConfig: undefined`. Combined with `describe.skipIf(!config)`, this is the silent-pass-by-skip mechanism that hid the whole suite for weeks.

Change: when `deployContractsAndProvide` fails, write a sentinel marker that ALL tests will read in their `beforeAll` and throw a loud error. Or: set `aztecTestConfig: { __setupFailed: true }` and have tests assert against it. Result: future deploy failures fail loudly with N×"setup failed" instead of N×skipped.

Implementation note: keep the existing `describe.skipIf(!config)` for legit skip cases (e.g. when network sandbox isn't available locally), but distinguish "setup never tried" from "setup tried and failed".

## 4. Phase plan

### P0 — Patch already landed (commit `418ece9`)
✓ Done. Patches commit-1.

### P0.5 — Fail-loud setup change
- Edit `tests/e2e/global-setup.ts:426-428` to provide `{ __setupFailed: true, error: msg }` instead of `undefined`.
- Edit a small fixture or shared helper that ALL network tests use to surface the failure as a loud assertion.
- Commit: `fix(e2e): fail loud when network global-setup deploy fails`
- Validation: run a single network test file in isolation; confirm if setup is fine it passes through; force a setup failure (temporary edit) and confirm tests fail loud instead of skip.

### P1 — Run focused baseline + verify cluster hypothesis
- `bun run e2e:agent` (full run). Capture to `/tmp/e2e-baseline-v2-$$.log`.
- Compare failure list against prior phase-0 cluster mapping. If failures cluster around the 4 hypothesized mechanisms (token-add, fee-juice-import, contact-sender-chip, dapp-registerSender), prior analysis stands → proceed to fixes.
- If failures are mostly OUTSIDE these clusters (e.g., new failures from passes that have regressed since prior phase-0), revisit cluster mapping.
- Output: `triage.md` table (failure-mode → cluster → fix-ID).

### P2 — Wallet fixes (F1, F2, F3, F4)
- Each fix per its own commit OR batched if same file.
- After F1+F2 (the most-broadly-applicable pair), run **representative cluster A test** (e.g. `transfers.test.ts`) in isolation: `bun run --cwd packages/extension vitest run --config vitest.e2e.network.config.ts tests/e2e/network/transfers.test.ts`.
- After F3+F4, run **cluster D test** (`contacts-sender.test.ts`).
- Smoke e2e re-run after this batch: `bun run test:e2e` — gate against regression.

### P3 — Background client RPC fix (F5)
- Modify `disconnect()` to not reject pending.
- This crosses package boundary (`@nulo/extension-messaging` consumed by `@nulo/extension`).
- Validation: run cluster C tests; confirm closeStuckPopup-during-RPC no longer kills the request.
- **Bun run test** (full): make sure no unit/component test depends on the cancellation behavior.

### P4 — Test-helper fixes (F6, F7, F8?)
- F6 (`switchToLocalNetwork` wait): if F1 landed cleanly, this may be a no-op (since the wallet-side fix obviates the need). But still useful for defensive timing.
- F7 (`addContact` chip wait): stronger signal.
- F8 (`closeStuckPopup` await pending): skip if F5 landed cleanly (made redundant).

### P5 — Tight timeout bumps (F9, F10)
- Last because they're surgical and only help once root causes are addressed.

### P6 — Full e2e:agent re-run
- Capture full output. Compare to baseline:
  - **Pass count**: target ≥ smoke-suite-equivalent ratio (~50/61). If less, more triage needed.
  - **Quarantined**: must have `test.skip("reason: <one line>")` with a link to a follow-up issue/path.
- Document remaining failures in `quarantine.md`.

### P7 — Final validation
- `bun run audit:vue` (typecheck → test → lint → build).
- `bun run test:e2e` (smoke).
- `bun run e2e:agent` (network).
- All three must exit 0.

### P8 — Push branch, NO MERGE
- Push.
- Open draft PR titled `fix(e2e): restore network suite — patches + targeted fixes + helper hardening`.
- Body summarizes commit list + quarantine list with rationale.
- **Do NOT merge** (user explicit directive while AFK).

## 5. Implementation constraints

- **Commit signing disabled** (user-authorized via `git -c commit.gpgsign=false commit ...`).
- **Conservative on cross-package changes**: F5 touches `extension-messaging`. Verify carefully that no other consumer relies on the reject-on-disconnect behavior.
- **Each commit independently reviewable**. No omnibus commit.
- **3-failure stop rule per fix**: if a fix attempt fails 3 times, log to `lessons/phase-N.md`, move on. Revisit at end if time.
- **Lessons logging**: `lessons/<phase>-<topic>.md` per protocol.
- **No new dependencies, no version bumps**.

## 6. Security & adversarial considerations

- **F5 changes RPC client contract**: cancellation-on-disconnect IS a real semantic. If a caller depends on it (e.g., to abort an in-flight transaction signing on user-cancel), this change is a regression. **Mitigation**: grep for callers that rely on disconnect-as-cancel before changing. If found, make F5 opt-in via param instead of unconditional.
- **F1 changes wallet auto-account-creation triggers**: extending `ensureDefaultAccount` to fire from the network watcher could create an account on a network where the user didn't intend. **Mitigation**: only fire when `appStore.accounts.length === 0` AND the network is the LOCAL_NETWORK fixture (gated). For mainnet/testnet networks, do NOT auto-create.
- **F2/F3/F4 guards prevent silent failures**: defensive coding. Low risk.
- **Patches in repo**: `patches/@aztec%2F*` are content-addressable + version-pinned. On next `@aztec` bump, patches need re-evaluation (will likely fail to apply). Plan: when 4.3.x lands, re-apply patches or verify upstream packaging fixed.
- **Fail-loud setup**: removes a safety net (silent skip on infra failure). Trade-off: real failures get attention vs. CI being noisier on local-dev when setup is flaky. Mitigation: keep `describe.skipIf(!config)` for legit case (no sandbox); only fail-loud when deploy was *attempted* and failed.

## 7. Trade-offs

- **Wallet-side fixes vs test-side fixes**: prior phase-0 strongly recommends wallet-side. Test-side is fallback.
- **Per-mechanism vs per-test commits**: per-mechanism wins for review-ability. Per-test risks 50 commits.
- **Final-codex-pass requirement vs implementation velocity**: user is AFK; protocol says final pass; deferring final pass risks shipping broken plan. **Decision: ONE final codex pass on plan v2 (this doc), then implement without further gates.**

## 8. Rollout

Single branch `fix/e2e-network-suite-recovery`. Multiple commits per phase. Draft PR at end. NO merge (user AFK directive).

## 9. Audit history

| Version | Date | Codex | Opus | Status |
|---|---|---|---|---|
| v1 | 2026-05-21 | Critique: 5 buckets symptom-shaped; missed prior art; reword non-goals; fail-loud setup; 30min quarantine too aggressive | Critique: missing buckets F/G; per-mechanism budget; phase 0.5 fail-loud; carve out product fixes; test.skip not skipIf | Both: deltas required |
| v2 | 2026-05-22 | (pending — final pass) | (incorporated) | Awaiting final codex pass |

## 10. Files to touch (concrete list, from F1-F10)

| Fix | File | Lines (approx) | Type |
|---|---|---|---|
| F1 | `packages/extension/src/popup/app.vue` | 131-150 | wallet |
| F2 | `packages/extension/src/popup/components/popups/NewTokenPopup.vue` | handleAddToken | wallet |
| F3 | `packages/extension/src/popup/components/popups/NewContactPopup.vue` | handleAddContact | wallet |
| F4 | `packages/extension/src/popup/components/popups/EditContactPopup.vue` | handleUpdateContact | wallet |
| F5 | `packages/extension-messaging/src/background/client.ts` | 69-87 | wallet (cross-package) |
| F6 | `packages/extension/tests/e2e/fixtures/extension.ts` | switchToLocalNetwork | test-helper |
| F7 | `packages/extension/tests/e2e/fixtures/extension.ts` | addContact | test-helper |
| F8 | `packages/extension/tests/e2e/fixtures/extension.ts` | closeStuckPopup | test-helper (skip if F5) |
| F9 | `packages/extension/tests/e2e/network/contacts-sender.test.ts` | test 1 chip wait | test |
| F10 | `packages/extension/tests/e2e/network/data-registerSender.test.ts` | waitForPgResult | test |
| P0.5 | `packages/extension/tests/e2e/global-setup.ts` | 426-428 + fixture/helper | test-infra |

## 11. Next step

Send this plan v2 to codex for final critical pass. After codex's reply, implement directly without further user gate (user is AFK; explicit directive: "go solo").
