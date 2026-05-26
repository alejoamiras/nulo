The sandbox is read-only, so I could not write `implementations-plan/e2e-full-network-recovery/audit-codex.md` (`Operation not permitted`). Paste the following into that path unchanged.

APPROVE-WITH-DELTAS

1. Cluster B is mis-scoped in the main plan. The failing wait in `packages/extension/tests/e2e/fixtures/helpers.ts:198-207` is for `nulo:ui:activeAccount`, and the hot path is `popup/pages/settings/networks/[id].vue:47-53 -> wallet/services/network/service.ts:305-320 -> popup/app.vue:97-127 -> wallet/services/account/service.ts:78-109 -> aztec-runtime/src/account/nulo-account.ts:53-65`, not PXE/offscreen first.
2. Cluster A needs one more primary boundary than the main plan uses: the `requestCapabilities` popup/settle branch in `packages/extension/src/wallet/services/dapp-interaction/service.ts:150-155,162-200,97-107` plus `packages/extension/src/popup/windows/capabilities/index.vue:167-200`. `SW-ALIVE` is only a coarse correlation signal.
3. Do not rely on node_modules edits or a plain `E2E_PROBE=1`. Use repo-owned probes gated by `VITE_E2E_PROBE=1` in `packages/extension/scripts/e2e/agent.sh:30-31` and `packages/extension/tests/e2e/global-setup.ts:344-353`.
4. Re-enable `connect-locked-queue.test.ts` earlier than the other quarantined files. It exercises `DiscoveryQueue` (`packages/wallet-bridge/src/discovery-queue.ts:20-69`) and is not a B/PXE cascade victim.
5. Do not put global SW keepalive / `chrome.alarms` near the front of the fix tree. `packages/extension/src/wallet/runtime.ts:170-190` already writes immediate and interval liveness; the missing signal is session/response-path visibility, not another heartbeat.

# E2E Full Network Recovery — Plan (codex)

## 1. Context

### 1.1 Where we are
- Branch: `fix/e2e-network-suite-recovery` / PR #46 draft.
- Current state:
  - `Test Files 29 failed | 12 passed | 4 skipped (45)`
  - `Tests 36 failed | 17 passed | 8 skipped (61)`
- Infra recovery from silent skip is already landed. Remaining work is product-path correctness and performance.

### 1.2 Goal
- One PR on top of `fix/e2e-network-suite-recovery`.
- `bun run e2e:agent` green at `61/61`.
- Re-enable the 4 quarantined files.

### 1.3 Constraints
- Probe-first for Cluster A.
- Real fix for Cluster B, not timeout inflation.
- Interactive user-gated decisions.
- No merge today.

### 1.4 Prior art
- `implementations-plan/e2e-network-recovery/plan-v2.md` and `quarantine.md` explain how the suite was restored to actually run.
- `implementations-plan/e2e-network-recovery/lessons/phase-discovery.md` is load-bearing for bundle-resolution safety.
- `implementations-plan/network-test-triage/*` is useful background, but those popup guards are already on `dev`.
- This plan is intentionally not anchored on `implementations-plan/e2e-full-network-recovery/plan-main.md`; comparison comes later.

## 2. Failure Cluster Breakdown

| Cluster | Symptom | Actual primary surface |
|---|---|---|
| A | `waitForPgResult` 30s timeout after connect succeeds | first encrypted wallet method after handshake: playground -> content script relay -> wallet-sdk background -> wallet-bridge -> `DappInteractionService` or `ExecutionService` -> wallet-sdk response path |
| B | first `switchToLocalNetwork` takes ~30s | first Local-chain account provisioning in popup network watcher; PXE/offscreen is secondary unless probes disprove this |
| C | `send-amount-clamp` | cascade victim of A/B via `tokenReadyExtension` |
| D | `session-reconnect (alwaysTrust=false)` | separate reconnect / verify path |

## 3. Strategy

### 3.1 Treat `requestCapabilities` correctly
- `packages/playground/src/lib/wallet.ts:62-93` `connect()` does discovery + secure-channel confirm only.
- `node_modules/@aztec/wallet-sdk/src/manager/wallet_manager.ts:222-241` `confirm()` just constructs `ExtensionWallet`; it does not call the wallet bridge.
- The first call that reaches our dispatcher is `packages/playground/src/lib/wallet.ts:125-135` `requestCapabilities()`.
- Full path:
  - `packages/playground/src/sections/connect.ts:47-55`
  - `packages/playground/src/lib/log.ts:11-19`
  - `packages/playground/src/lib/wallet.ts:125-135`
  - `node_modules/@aztec/wallet-sdk/src/extension/provider/extension_wallet.ts:203-226`
  - `packages/extension/src/content-script/content.ts:11-19`
  - `packages/extension/src/wallet/services/wallet-sdk/background.ts:181-189,432-485`
  - `packages/wallet-bridge/src/dispatcher.ts:220-230`
  - `packages/wallet-bridge/src/dispatcher.ts:402-567`
  - `packages/extension/src/wallet/services/dapp-interaction/service.ts:150-155,162-200`
  - `packages/extension/src/popup/windows/capabilities/index.vue:167-200`
  - back through `dispatcher.ts:512-567`
  - `background.ts:476-483`
  - back to playground `log.ts:14-19`

### 3.2 Phased commit structure
1. Phase A: Cluster A probes.
2. Phase B: Cluster B probes.
3. Phase C: findings doc.
4. Phase D: Cluster A fixes.
5. Phase E: Cluster B fix.
6. Phase F: Cluster C + D.
7. Phase G: re-enable quarantined files in dependency order.
8. Phase H: strip probes, full-suite validation, PR update.

## 4. Phase A — Cluster A Diagnostic Probes

### 4.1 Primary boundaries
| Boundary | Placement | Why |
|---|---|---|
| `PG-OUT` / `PG-IN` | `packages/playground/src/lib/log.ts:11-19` | single wrapper for every dApp wallet call; higher leverage than instrumenting each section button |
| `BCH-RECV` | `packages/extension/src/wallet/services/wallet-sdk/background.ts:181-189` and `432-459` | proves decrypted wallet message reached our SW callback and entered dispatch |
| `WB-IN` / `WB-OUT` | `packages/wallet-bridge/src/dispatcher.ts:220-253` | distinguishes “dispatcher never entered” from “dispatcher entered and hung” |
| `DI-CAP-OPEN` / `DI-CAP-SETTLE` | `packages/extension/src/wallet/services/dapp-interaction/service.ts:150-155,162-200,97-107` | mandatory for `requestCapabilities`; the main plan misses this branch |
| `CAP-APPROVE` | `packages/extension/src/popup/windows/capabilities/index.vue:167-200` | proves the popup actually approved and sent `resolveInteraction` |
| `EXEC-IN` / `EXEC-OUT` | `packages/extension/src/wallet/services/execution/service.ts:865-981` | needed for post-grant silent methods; `requestCapabilities` never touches `ExecutionService` |
| `BCH-SEND` | `packages/extension/src/wallet/services/wallet-sdk/background.ts:476-483` | proves our code attempted the response |
| `SESSION-EST` / `SESSION-TERM` | `packages/extension/src/wallet/services/wallet-sdk/background.ts:145-179,249-260` | more useful than raw heartbeat for “did the encrypted session survive?” |

### 4.2 Secondary boundary
- Add `CS-TO-BG` / `CS-FROM-BG` at `packages/extension/src/content-script/content.ts:11-19` only if the primary probes leave a gap between `PG-OUT` and `BCH-RECV`, or between `BCH-SEND` and `PG-IN`.
- I would not patch node_modules for committed probes.

### 4.3 `SW-ALIVE`
- Keep `packages/extension/src/wallet/runtime.ts:170-190` as a coarse correlation signal only.
- Do not count it as one of the 5 primary boundaries. A live SW is not proof that the wallet-sdk session or response path is healthy.

### 4.4 Probe gating
- Extension bundle: add `VITE_E2E_PROBE=1` next to `VITE_LOCAL_NETWORK_RPC_URL` in `packages/extension/scripts/e2e/agent.sh:30-31`.
- Playground bundle: add `VITE_E2E_PROBE=1` to the dev-server env in `packages/extension/tests/e2e/global-setup.ts:344-353`.
- Extension-side probes should use the existing logger path, not naked `console.log`, to survive SW churn.
- Probe payloads should contain method name, short request/session ids, timestamps, elapsed ms, and branch markers only. No addresses, balances, manifests, or verification hashes.

## 5. Phase B — Cluster B Diagnostic Probes

### 5.1 Start with the real switch path
- `packages/extension/tests/e2e/fixtures/helpers.ts:145-207` already defines the wait contract:
  - header text changes first,
  - then `nulo:ui:activeAccount` changes.
- The code that makes that happen is:
  - `packages/extension/src/popup/pages/settings/networks/[id].vue:47-53`
  - `packages/extension/src/wallet/services/network/service.ts:305-320`
  - `packages/extension/src/popup/app.vue:97-127`
  - `packages/extension/src/wallet/services/account/service.ts:78-109`
  - `packages/aztec-runtime/src/account/nulo-account.ts:53-65`
  - `packages/extension/src/stores/app.store.ts:52-67`

### 5.2 Primary probes
| Probe | Placement | Question answered |
|---|---|---|
| `SWITCH-CLICK` / `SWITCH-HDR` / `SWITCH-ACTIVE` | `fixtures/helpers.ts:145-207` | where the 30s is actually spent from the test’s perspective |
| `NET-SETACTIVE-IN/OUT` | `networks/[id].vue:47-53` and `network/service.ts:305-320` | is the network service itself slow |
| `WATCH-IN/OUT` | `popup/app.vue:97-127` | is the stall in the popup watcher |
| `ACCT-GET`, `ACCT-ENSURE`, `ACCT-CREATE` | `account/service.ts:78-109` | does empty-list -> account creation dominate |
| `ACCOUNT-NEW` | `aztec-runtime/src/account/nulo-account.ts:53-65` | is cryptographic derivation the cold-path sink |
| `ACTIVE-ACCOUNT-WRITE` | `app.store.ts:52-67` | is the final storage write or account selection late |

### 5.3 Secondary PXE/offscreen probes
- Only if the primary probes do not explain the 30s:
  - `packages/extension/src/offscreen/index.ts:51-59`
  - `packages/extension/src/wallet/utils/offscreen.ts:205-233`
  - `packages/extension-messaging/src/offscreen/client.ts:176-245`
  - `packages/aztec-runtime/src/pxe/service.ts:405-443`
- Those are relevant for `tokenReadyExtension` / `feeJuiceImportedExtension`, but they are not where I would start for the raw `switchToLocalNetwork` timeout.

## 6. Phase C — Probe Runs + Findings

### 6.1 Required repro set
- `packages/extension/tests/e2e/network/cap-request-basic.test.ts:17-42`
- `packages/extension/tests/e2e/network/meta-getChainInfo.test.ts:22-27`
- `packages/extension/tests/e2e/network/sim-methods.test.ts:24-70`
- `packages/extension/tests/e2e/network/networks.test.ts:21-38`
- `packages/extension/tests/e2e/network/session-reconnect.test.ts:24-77`

### 6.2 Findings doc
- Write findings to `implementations-plan/e2e-full-network-recovery/findings.md`.
- For A, record the last boundary reached for each representative method.
- For B, record elapsed ms for:
  - UI click -> header flip
  - header flip -> watcher start
  - watcher start -> `getAccounts`
  - `ensureDefaultAccount`
  - `NuloAccount.new`
  - `setupActiveAccount`

## 7. Phase D — Cluster A Fix Plan

### 7.1 Hypotheses ranked
1. **Lost response on the encrypted return path or stale-session drop.**
   - Why: upstream wallet-sdk silently swallows both decrypt failures and response-send failures in `background_connection_handler.ts:323-353`, and the dApp silently swallows response-decrypt failures in `extension_wallet.ts:157-188`.
   - Why it fits: the dApp row stays pending until the 30s test timeout instead of settling as error.
2. **`requestCapabilities` interaction branch settles in the popup but does not make it back to the dispatcher/window handle.**
   - Why: `requestCapabilities` uniquely routes through `DappInteractionService.interaction()` and `resolveInteraction()`, unlike exempt silent methods.
   - Why it fits: this is the first bridge-dispatched wallet call after handshake.
3. **Post-grant silent methods stall inside `ExecutionService` or first PXE/offscreen work.**
   - Why: methods like `simulateTx`, `executeUtility`, `registerSender` route through `executeOperations()` and then `withPxeRead` / `withPxeWrite`.
   - Why it fits: several failing files are data/simulation surfaces, not just capability approval.

### 7.2 Fix branches
- If the gap is before `BCH-RECV`: fix session lifecycle or content-script relay. Prefer explicit stale-session rejection / reconnect over a new global keepalive.
- If the gap is inside `requestCapabilities`: fix the `DappInteractionService` open/settle path or popup resolve race.
- If the gap is after `EXEC-IN`: fix the exact method branch, offscreen bootstrap, or PXE serialization path implicated by the probes.

### 7.3 What I would not do first
- No blanket retry around `waitForPgResult`.
- No new global `chrome.alarms` keepalive until a session-loss mechanism is proven.

## 8. Phase E — Cluster B Fix Candidates

### 8.1 Candidate 1: pre-provision the Local default account during profile bootstrap
- Surface: `packages/extension/src/composables/useProfileBootstrap.ts:63-99`.
- Shape: after the active profile is loaded, ensure the built-in Local chain already has a default account before the user ever clicks “Local Network”.
- Why this is strongest: it removes the first-switch cold path entirely and matches the actual wait surface.

### 8.2 Candidate 2: provision on active-network switch in the background service
- Surface: `packages/extension/src/wallet/services/network/service.ts:305-320`.
- Shape: ensure the destination chain has a default account before emitting `onActiveNetworkChanged`.
- Why this is weaker: correctness yes, but the user still waits on the first visible switch unless it is done ahead of time.

### 8.3 Candidate 3: reduce `NuloAccount.new()` cold cost
- Surface: `packages/extension/src/wallet/services/account/service.ts:89-109`, `packages/aztec-runtime/src/account/nulo-account.ts:53-65`.
- Shape: profile the derivation path and optimize or cache if it is the dominant sink.
- Why this is fallback: higher crypto risk, larger blast radius.

### 8.4 Most likely correct
- Candidate 1.
- Offscreen/PXE prewarm is not my default Cluster B fix because the raw failing wait is not on that path.

## 9. Phase F — Cluster C + D

### 9.1 Cluster C
- Re-run after A and B.
- Treat it as a cascade victim unless probes show a distinct send-flow bug.

### 9.2 Cluster D
- Probe:
  - `packages/extension/src/wallet/services/wallet-sdk/background.ts:145-173`
  - `packages/extension/src/popup/windows/verify/index.vue:71-75`
  - `packages/extension/src/wallet/services/dapp-session/service.ts:206-214`
  - `packages/extension/tests/e2e/fixtures/popups.ts:104-141`
- Do not assume “pre-existing flake” until the reconnect path is observed.

## 10. Phase G — Re-enable the 4 Quarantined Files

| Order | File | Why this order |
|---|---|---|
| 1 | `connect-locked-queue.test.ts` | separate discovery-queue surface; should move earlier once a deterministic “queued” signal exists |
| 2 | `data-registerSender.test.ts` | best sentinel for “post-grant silent PXE write” after A is fixed |
| 3 | `token-management.test.ts` | depends on `tokenReadyExtension`, so it waits on A plus the B/fixture path |
| 4 | `fee-methods.test.ts` | deepest fixture stack; uses `tokenReadyExtension` and `feeJuiceImportedExtension`; re-enable last |

### 10.1 Special note on `connect-locked-queue`
- The skip comment already says the problem is brittle test timing, not a proven product regression.
- Use `DiscoveryQueue` (`packages/wallet-bridge/src/discovery-queue.ts:20-69`) to expose a deterministic queued marker before unlock.

## 11. Phase H — Strip Probes + Validate

- Remove all `VITE_E2E_PROBE`-guarded instrumentation.
- Three `bun run e2e:agent` passes.
- No quarantines left.
- Update PR #46 body with findings and final cluster closures.

## 12. Test Plan

- Every probe commit must be behavior-preserving.
- Every fix commit needs one tight repro:
  - A branch: the specific failing e2e test plus, where possible, a smaller unit/integration test on the implicated service.
  - B branch: `networks.test.ts` first, then a fixture-backed test.
- Full-suite `e2e:agent` remains the gate. File-level passes are not enough.

## 13. Security & Adversarial Review

- **Probe leakage:** an attacker wants method names, origins, session ids, account ids, or verification hashes in logs. Log only method, short hashed ids, timestamps, and branch markers.
- **Probe perturbation:** an attacker benefits if probes change ordering. Keep probes side-effect-free and synchronous; do not add awaits on hot paths.
- **Do not trust `nulo:liveness`:** a live SW does not prove the encrypted session still exists.
- **Do not trust `handler.sendResponse()`:** upstream swallows failures; that is exactly why the response path needs probes.
- **No global keepalive scope creep:** pinning the SW globally widens the lifetime of in-memory session material. If keepalive is ever considered, it must be scoped to active sessions and justified by probe data.
- **Account pre-provision privacy:** deriving and storing default accounts for chains the user has not visited increases local metadata. It must stay local-only and must not contact RPC endpoints.
- **PXE prewarm privacy:** if a later follow-up uses offscreen/PXE prewarm, it must stop before network calls. No unsolicited RPC contact.
- **Crypto/session risk:** any “session lifetime” fix must not weaken fresh key exchange or enable replay of stale encrypted messages.
- **Supply chain:** do not land node_modules edits as either probes or fixes. Keep the PR in repo-owned code only.
- **Least privilege:** do not add new permissions just to debug or paper over this.

## 14. File Catalog

### 14.1 Cluster A
- `packages/playground/src/lib/log.ts`
- `packages/playground/src/lib/wallet.ts`
- `packages/extension/src/content-script/content.ts`
- `packages/extension/src/wallet/services/wallet-sdk/background.ts`
- `packages/wallet-bridge/src/dispatcher.ts`
- `packages/extension/src/wallet/services/dapp-interaction/service.ts`
- `packages/extension/src/popup/windows/capabilities/index.vue`
- `packages/extension/src/wallet/services/execution/service.ts`

### 14.2 Cluster B
- `packages/extension/tests/e2e/fixtures/helpers.ts`
- `packages/extension/src/popup/pages/settings/networks/[id].vue`
- `packages/extension/src/wallet/services/network/service.ts`
- `packages/extension/src/popup/app.vue`
- `packages/extension/src/wallet/services/account/service.ts`
- `packages/aztec-runtime/src/account/nulo-account.ts`
- `packages/extension/src/stores/app.store.ts`

### 14.3 Secondary offscreen/PXE
- `packages/extension/src/offscreen/index.ts`
- `packages/extension/src/wallet/utils/offscreen.ts`
- `packages/extension-messaging/src/offscreen/client.ts`
- `packages/aztec-runtime/src/pxe/service.ts`

## 15. What The Main Plan Got Wrong

- `implementations-plan/e2e-full-network-recovery/plan-main.md:35-37` says Cluster B’s primary surface is “offscreen iframe PXE cold-init”. The code path being waited on is account provisioning, not PXE.
- `plan-main.md:97-99` cites `packages/extension/src/wallet/offscreen/index.ts`. The file in this repo is `packages/extension/src/offscreen/index.ts`.
- `plan-main.md:70-87` treats the problem as generic “2nd RPC after connect”. In this codebase, `requestCapabilities()` is the first method that reaches `dispatcher.dispatch()`.
- `plan-main.md:84-87,120-128` overweights `ExecutionService` and keepalive hypotheses before probing the `requestCapabilities` popup/settle branch.
- `plan-main.md:88-94` proposes `E2E_PROBE=1` at build time, but the playground code only receives Vite-exposed env from the dev-server spawn in `global-setup.ts:344-353`.
- `plan-main.md:145-156` defers all quarantined files together. `connect-locked-queue.test.ts` should be handled earlier because it probes a separate discovery-queue surface.
- `plan-main.md:205-207` lists `packages/extension-messaging/src/background/service.ts` as a likely Cluster A touchpoint. That file is popup<->SW RPC infrastructure; it matters for `resolveInteraction`, not for the main encrypted dApp channel.

## 16. Open Questions Before Approval

1. In failing `requestCapabilities` repros, does `CAP-APPROVE` fire and does `DI-CAP-SETTLE` fire?
2. When a Cluster A call hangs, do `SESSION-TERM` or tab-update events fire between connect and the call?
3. Is `NuloAccount.new()` actually the dominant B sink, or is the time in secret derivation / storage / watcher churn around it?
4. Does `connect-locked-queue` need only a deterministic “queued” signal, or is there a real queue-drain bug under lock/unlock churn?
5. For Cluster D, is the failure before verify popup creation, during verify approval, or after popup close while waiting for `pg-status=connected`?

## 17. Rejected / Deferred

- No timeout bumps for Cluster B.
- No node_modules probe patches in the PR.
- No blanket retry wrappers around `waitForPgResult`.
- No global `chrome.alarms` keepalive as a speculative fix.
- No offscreen/PXE prewarm unless Cluster B probes point there.
- No new permissions.

## 18. Phase Ordering

- [ ] Phase A — repo-owned Cluster A probes
- [ ] Phase B — account-first Cluster B probes
- [ ] Phase C — findings doc
- [ ] Phase D1 — requestCapabilities / session / response-path fix
- [ ] Phase D2 — post-grant silent-method fix if still needed
- [ ] Phase E — Cluster B account pre-provision fix
- [ ] Phase F — Cluster C + Cluster D
- [ ] Phase G — re-enable quarantined files in dependency order
- [ ] Phase H — strip probes, full-suite validation, PR update

## 19. Done Definition

- `bun run e2e:agent` green at `61/61`.
- No quarantined network files remain skipped.
- Probe strings removed from source.
- PR #46 updated with findings, final fix summary, and validation results.
- No timeout-only “fixes”.
- No node_modules deltas required for the final state.