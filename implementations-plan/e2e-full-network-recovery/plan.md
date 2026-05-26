# E2E Full Network Recovery — Consolidated Plan (v1)

> Tier A consolidation. Synthesizes `plan-main.md` (main agent), `audit-opus.md` (opus 4.7 subagent), `audit-codex.md` (codex xhigh). Each major decision below is annotated with `[SRC: main | opus | codex | consolidation]`. Conflicts resolved with explicit reasoning.

## 1. Context

### 1.1 Branch + state
- Builds on `fix/e2e-network-suite-recovery` (PR #46, draft, **DO NOT MERGE**).
- Current `bun run e2e:agent` on this branch:
  ```
  Test Files  29 failed | 12 passed | 4 skipped (45)
  Tests       36 failed | 17 passed | 8 skipped (61)
  ```
- 4 intentionally-quarantined files: `data-registerSender`, `connect-locked-queue`, `fee-methods`, `token-management`.

### 1.2 Goal
`bun run e2e:agent` exits 0 with **61/61** passing AND the 4 quarantined files re-enabled (a separate condition — the 61 already includes the 8 skipped sub-tests; un-quarantining keeps the total ~61 but moves them from skipped→passing). Smoke (`bun run test:e2e`) stays green. **One PR** building on PR #46. **No node_modules edits.** No new dependencies.

### 1.3 User constraints
1. Probe-first for Cluster A. [SRC: user]
2. Real fix for Cluster B, NOT timeout bump. [SRC: user]
3. One PR, phased commits on recovery branch. [SRC: user]
4. Interactive — gate each major decision. [SRC: user]
5. No merge today. [SRC: user]

## 2. Failure cluster surfaces (corrected)

| Cluster | # | Symptom | **Actual primary surface** [SRC: codex audit] |
|---|---|---|---|
| A | ~22 | `waitForPgResult` 30s timeout on first encrypted dApp RPC | playground → CS relay → wallet-sdk SW handler → wallet-bridge dispatcher → `DappInteractionService` OR `ExecutionService` → wallet-sdk response path |
| B | 4 | First `switchToLocalNetwork` ~30s | popup network watcher account-provisioning (NOT PXE first): `networks/[id].vue:47-53` → `network/service.ts:305-320` → `app.vue:97-127` → `account/service.ts:78-109` → `nulo-account.ts:53-65` → store at `app.store.ts:52-67` |
| C | 1 | `send-amount-clamp` 35s | cascade victim of A/B via `tokenReadyExtension` |
| D | 1 | `session-reconnect (alwaysTrust=false)` 71s | separate reconnect/verify path: `background.ts:145-173`, `verify/index.vue:71-75`, `dapp-session/service.ts:206-214` |

**Note re cluster A scope**: `connect-dapp.test.ts > connect-handshake` ALSO fails at 35s [SRC: verified in `/tmp/e2e-baseline4-60692.log`]. This contradicts opus's claim that handshake passes. It means cluster A's bug surface extends to the FULL encrypted-channel path, not just "2nd RPC after connect". Opus's H1 (activeSessions Map loss on idle) gains support — even short idle gaps between discover-approve and verify-approve in the handshake fixture (~5-10s) can lose the session.

## 3. Strategy

### 3.1 Probe-first
The current quarantine names a SYMPTOM, not a mechanism. Without probes we'd be guessing at one of ≥6 plausible roots. Probes disambiguate. [SRC: all three agree]

### 3.2 Phased single-PR commits on `fix/e2e-network-suite-recovery`
```
[ ] Phase A — Cluster A probes (1 commit)
[ ] Phase B — Cluster B probes (1 commit)
[ ] Phase C — Probe-run + findings doc (1 doc commit at the end)
[ ] Phase D — Cluster A fix(es) (1-3 commits depending on probe data)
[ ] Phase D-bonus — re-enable connect-locked-queue + data-registerSender (2 commits, woven into D iteration)  [SRC: opus + codex agreed cadence]
[ ] Phase E — Cluster B fix (1-2 commits)
[ ] Phase E-bonus — re-enable token-management + fee-methods (2 commits)
[ ] Phase F — Cluster C + D investigation/fix
[ ] Phase G — Strip probes (1 commit)
[ ] Phase H — Full-suite validation + update PR body
```

### 3.3 Critical path-tracing (`requestCapabilities` is the first dispatcher call) [SRC: codex]

`packages/playground/src/lib/wallet.ts:62-93` `connect()` does discovery + KEX + verify only. `node_modules/@aztec/wallet-sdk/src/manager/wallet_manager.ts:222-241` `confirm()` just constructs `ExtensionWallet`; it does NOT call our dispatcher.

The FIRST call that reaches `WalletSdkDispatcher.dispatch()` is `requestCapabilities()` at `packages/playground/src/lib/wallet.ts:125-135`. Full path:

```
packages/playground/src/sections/connect.ts:47-55
  ↓
packages/playground/src/lib/log.ts:11-19            ← PG-OUT probe site
  ↓
packages/playground/src/lib/wallet.ts:125-135
  ↓
node_modules/@aztec/wallet-sdk/src/extension/provider/extension_wallet.ts:203-226  (untouched)
  ↓
packages/extension/src/content-script/content.ts:11-19                              ← CS-RECV (secondary)
  ↓
packages/extension/src/wallet/services/wallet-sdk/background.ts:181-189             ← BCH-RECV
                                                            :202-213                ← BCH-DECRYPT (existing monkey-patch)
                                                            :432-485                ← BCH-SEND
  ↓
packages/wallet-bridge/src/dispatcher.ts:220-253                                    ← WB-IN/OUT
                                       :402-567 (cap branch)
  ↓
packages/extension/src/wallet/services/dapp-interaction/service.ts:150-155 (requestCapabilities entry)
                                                                :162-200 (interaction())
                                                                :97-107 (resolveInteraction)
                                                                                    ← DI-CAP-OPEN, DI-CAP-SETTLE
  ↓
packages/extension/src/popup/windows/capabilities/index.vue:167-200                 ← CAP-APPROVE
  ↓
(back through dispatcher.ts:512-567 → background.ts:476-483)
  ↓
(back to playground via lib/log.ts:14-19)                                           ← PG-IN
```

## 4. Phase A — Cluster A probe set [CONSOLIDATED]

Adopting codex's probe boundaries (more accurate vs. main plan) + opus's BCH-DECRYPT-IN/OUT + BCH-SESSION-LOOKUP-MISS for the encrypted-channel visibility codex missed.

| # | Probe | Placement | Detects |
|---|---|---|---|
| 1 | **PG-OUT** | `packages/playground/src/lib/log.ts:11-19` (wrapper, fires once per call) | Did the dApp issue the request? |
| 2 | **PG-IN** | `packages/playground/src/lib/log.ts:14-19` (success/error settle branches) | Did the dApp receive the response? |
| 3 | **CS-RECV** (secondary) | `packages/extension/src/content-script/content.ts:11-19` | Did the content-script relay see the message in either direction? Only enable if probes 1+4 leave a gap. [SRC: codex, opus agreed] |
| 4 | **BCH-RECV** | `packages/extension/src/wallet/services/wallet-sdk/background.ts:181-189` AND `:432-459` | Did the decrypted wallet message reach our callback? |
| 5 | **BCH-DECRYPT-IN** | same file `:202-213` (inside existing monkey-patch wrapping upstream `handleEncryptedMessage`) | Did the encrypted message enter our decrypt-serializing wrapper? |
| 6 | **BCH-SESSION-LOOKUP-MISS** | same file `:202-213` (read `(handler as any).activeSessions.has(sessionId)` before calling `origDecrypt`) | If upstream is about to silently drop on missing session, we log it. [SRC: opus's key contribution] |
| 7 | **BCH-DECRYPT-OUT** | same file after `origDecrypt` returns/throws | How long upstream's decrypt took, and whether it threw |
| 8 | **WB-IN** / **WB-OUT** | `packages/wallet-bridge/src/dispatcher.ts:220-253` | Did the dispatcher enter? Did it complete or hang? |
| 9 | **DI-CAP-OPEN** | `packages/extension/src/wallet/services/dapp-interaction/service.ts:150-155,162-200` | Did `requestCapabilities` reach `interaction()` and open the popup? [SRC: codex's key contribution] |
| 10 | **CAP-APPROVE** | `packages/extension/src/popup/windows/capabilities/index.vue:167-200` | Did the capabilities popup actually approve? [SRC: codex] |
| 11 | **DI-CAP-SETTLE** | `packages/extension/src/wallet/services/dapp-interaction/service.ts:97-107` (`resolveInteraction`) | Did the popup settle the interaction back to dispatcher? |
| 12 | **EXEC-IN** / **EXEC-OUT** | `packages/extension/src/wallet/services/execution/service.ts:865-981` | For post-grant silent methods only. `requestCapabilities` doesn't touch ExecutionService. |
| 13 | **BCH-SEND** | `packages/extension/src/wallet/services/wallet-sdk/background.ts:476-483` | Did our code call `handler.sendResponse`? |
| 14 | **BCH-SEND-WIRE** | same site, log `activeSessions.has(sessionId)` BEFORE the send | Detects mid-RPC session loss. [SRC: opus's contribution] |
| 15 | **SESSION-EST** / **SESSION-TERM** | `packages/extension/src/wallet/services/wallet-sdk/background.ts:145-179,249-260` | Did the session lifecycle event fire unexpectedly? [SRC: codex] |
| 16 | **SW-LIFECYCLE** | `packages/extension/src/wallet/index.ts` — wire `chrome.runtime.onStartup/onSuspend/onSuspendCanceled` | Did the SW restart between handshake and the failing call? [SRC: opus] |

### 4.1 What we are NOT adopting
- ~~**SW-ALIVE heartbeat (main plan §A.5)**~~ — opus + codex both noted `nulo:liveness` is already written every 10s; adding another `setInterval` adds noise without information. `SW-LIFECYCLE` (#16) is the right signal. [SRC: opus's correction]
- ~~**node_modules monkey-patch via `bun patch`**~~ — keep all probes in repo-owned code. The existing `background.ts:202-213` already wraps upstream `handleEncryptedMessage`; we add probes inside that wrapper without patching node_modules. [SRC: codex's correction, opus agrees]

### 4.2 Probe gating + leak mitigation [CONSOLIDATED]
- Use **`VITE_E2E_PROBE`** env var (not `E2E_PROBE`), exposed to Vite as `import.meta.env.VITE_E2E_PROBE`. [SRC: codex's correction]
- Wired in TWO places:
  - `packages/extension/scripts/e2e/agent.sh:30-31` (next to `VITE_LOCAL_NETWORK_RPC_URL`) — for extension build
  - `packages/extension/tests/e2e/global-setup.ts:344-353` (playground dev-server spawn env) — for playground build [SRC: codex flagged this gap in main plan]
- Probes call a single `probe(boundary, payload)` helper that branches on `import.meta.env.VITE_E2E_PROBE === "1"`. The branch is compile-time replaced by Vite, but "tree-shaken when off" is the design intent, NOT a hard safety guarantee — the actual leak guarantee is the bundle-grep below. [SRC: codex final-review correction]
- Use the existing logger (not naked `console.log`) on extension-side to survive SW churn. [SRC: codex]
- Probe payloads include ONLY: method name, short hashed sessionId, timestamp, elapsed ms, boundary name, branch markers. **Never**: addresses, balances, raw RPC args, ciphertext, manifests, verification hashes. [SRC: codex + opus agreed]
- **CI bundle-grep step (THE leak guarantee)**: `grep -c 'PROBE:\|VITE_E2E_PROBE' packages/extension/dist/chrome/**/*.js` must be 0. **Not** `packages/playground/dist/` — the playground runs via Vite dev-server during e2e and has no built `dist/` in this repo. If a future PR adds a deployed playground build, extend the grep target then. [SRC: opus + codex final-review §4]

## 5. Phase B — Cluster B probe set [CONSOLIDATED]

**Codex's key correction**: the failing wait at `helpers.ts:198-207` is for `nulo:ui:activeAccount`. The hot path is account provisioning, NOT PXE/offscreen first. Verified: `helpers.ts:198-207` polls `chrome.storage.local.get("nulo:ui:activeAccount")`. [SRC: codex, verified]

### 5.1 Primary probes (account-provisioning path)

| Probe | Placement | Question |
|---|---|---|
| **SWITCH-CLICK** / **SWITCH-HDR** / **SWITCH-ACTIVE** | `packages/extension/tests/e2e/fixtures/helpers.ts:145-207` (test-side, in switchToNetwork) | Where is the 30s spent from the test's perspective? |
| **NET-SETACTIVE-IN/OUT** | `packages/extension/src/popup/pages/settings/networks/[id].vue:47-53`, `packages/extension/src/wallet/services/network/service.ts:305-320` | Is the network service itself slow? |
| **WATCH-IN/OUT** | `packages/extension/src/popup/app.vue:97-127` (network watcher) | Is the stall in the popup-side watcher? |
| **ACCT-GET**, **ACCT-ENSURE**, **ACCT-CREATE** | `packages/extension/src/wallet/services/account/service.ts:78-109` | Does empty-accounts → ensureDefaultAccount → create-account dominate? |
| **ACCOUNT-NEW** | `packages/aztec-runtime/src/account/nulo-account.ts:53-65` | Is cryptographic derivation the sink? |
| **ACTIVE-ACCOUNT-WRITE** | `packages/extension/src/stores/app.store.ts:52-67` | Is the final storage write or selection late? |

### 5.2 Secondary probes (PXE/offscreen)
Only add IF primary probes don't explain the 30s. Specifically these are relevant for `tokenReadyExtension` / `feeJuiceImportedExtension` (which DO touch PXE post-switch):
- `packages/extension/src/offscreen/index.ts:51-59` (corrected from `wallet/offscreen` per codex)
- `packages/extension/src/wallet/utils/offscreen.ts:205-233`
- `packages/extension-messaging/src/offscreen/client.ts:176-245`
- `packages/aztec-runtime/src/pxe/service.ts:405-443`

### 5.3 What we are NOT adopting yet
- ~~**Pre-warm offscreen modules at SW boot (opus F-B1)**~~ — wait for probe data. Opus reasoned plausibly that PXE module-load cold cost dominates, but codex correctly pointed out the actual wait surface is `nulo:ui:activeAccount`, which is account-state, not PXE-state. If probes show account provisioning dominates, F-B1 is over-engineered. [SRC: codex's correction, deferred to data]

## 6. Phase C — Probe-run + findings doc

### 6.1 Repro set (≥5 tests covering all surfaces)

| Surface | Test | Why |
|---|---|---|
| Cluster A — handshake | `connect-dapp.test.ts > connect-handshake` | Failing on this branch (35s). Tests the FIRST encrypted-channel use. [SRC: consolidation, contradicts opus's "passes" claim] |
| Cluster A — popup-mediated | `cap-request-basic.test.ts > cap-request-basic` | Tests requestCapabilities path with explicit popup-approve. [SRC: codex] |
| Cluster A — silent post-grant | `meta-getChainInfo.test.ts > meta-getChainInfo` | Tests silent (no-popup) post-cap method. [SRC: codex] |
| Cluster A — execution | `sim-methods.test.ts > sim-simulateTx (#23)` | Tests ExecutionService silent path. [SRC: codex] |
| Cluster B — switch | `networks.test.ts > switch to Local Network` | The deterministic 30s repro for B. [SRC: codex] |
| Cluster D — reconnect | `session-reconnect.test.ts > session-reconnect (alwaysTrust=false)` | The 71s flake. [SRC: codex] |

### 6.2 Findings doc
Write to `implementations-plan/e2e-full-network-recovery/findings.md`. Required content:
- For each Cluster A test: which probe boundary fired LAST before timeout (the last-known-good frame).
- For Cluster B: elapsed-ms breakdown of UI-click → header-flip → watcher-start → getAccounts → ensureDefaultAccount → NuloAccount.new → setupActiveAccount.
- For Cluster D: did the SESSION-EST fire? Was there a SESSION-TERM between verify and reconnect-attempt?
- For each cluster: a confirmed hypothesis (top of the ranked list, with code-level justification).

### 6.3 Approval gate before Phase D
**Present findings to user; user explicitly approves the chosen hypothesis + fix direction before any product code changes.** [SRC: user constraint #4]

## 7. Phase D — Cluster A fix (data-driven)

### 7.1 Hypotheses ranked (pre-probe estimates)

#### H1 — Response-path drop (upstream `sendResponse` silent swallow) [TOP CANDIDATE per codex]
**Surface**: `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:183-198`. Upstream silently swallows decrypt failures on the response path (mirroring the request path drop at line 173).

**Why it fits**:
- Test row stays "pending" until 30s timeout instead of settling as error → response never arrived OR arrived malformed.
- Tests like `cap-request-basic` explicitly approve the popup (we know approval succeeded) but `waitForPgResult` times out. Strongly points at response-relay rather than request-side stall.
- BOTH popup-mediated AND silent post-grant tests hit this — common surface is the response path.

**Falsifiable**: BCH-SEND fires (we attempted send) + BCH-SEND-WIRE shows `activeSessions.has=false` (upstream will silent-drop because the response channel session has aged out). OR BCH-SEND fires + BCH-SEND-WIRE shows `has=true` (so upstream sent it but content-script/dApp lost it — different bug).

#### H2 — `activeSessions` Map lost on SW restart [TOP CANDIDATE per opus]
**Surface**: `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:171-181`. In-memory `activeSessions.get(sessionId)` returns undefined after SW idle/restart → silent return.

**Why it fits**:
- MV3 SW idles after ~30s of no events. Between connect-handshake (which puts an entry in `activeSessions`) and the test's next click, a gap can exceed the threshold.
- `nulo:liveness` is a `setInterval` — `setInterval` does NOT keep MV3 SWs alive (only Chrome events do). [SRC: opus]
- Connect-handshake itself failing supports this — the gap between `discover-approve` and `verify-approve` can be enough.

**Falsifiable**: PG-OUT fires + CS-RECV fires + BCH-DECRYPT-IN fires + **BCH-SESSION-LOOKUP-MISS** fires. Definitive proof of H2.

#### H3 — DappInteractionService settle race [SECONDARY per codex]
**Surface**: `packages/extension/src/wallet/services/dapp-interaction/service.ts:97-107` (`resolveInteraction`). The popup may close in the same event-loop turn as `resolveInteraction` arrives; existing comment at line 100-103 notes this race. Detach-before-settle is the mitigation, but if `windowManager.detach` throws or the ordering breaks, settle never reaches dispatcher.

**Why it fits**: only relevant for popup-mediated tests (requestCapabilities, sendTx, etc.). Silent post-grant tests can't hit this.

**Falsifiable**: DI-CAP-OPEN fires + CAP-APPROVE fires + DI-CAP-SETTLE does NOT fire (popup never told dispatcher).

#### H4 — `sessionQueues` / `decryptQueues` head-of-line block [LOW per opus]
**Surface**: `packages/extension/src/wallet/services/wallet-sdk/background.ts:181-189` (sessionQueues) and `:202-213` (decryptQueues). If a prior message's promise never resolves, subsequent messages chain off a never-resolving promise.

**Why low**: dispatcher methods return in ms for non-popup paths. For `meta-getChainInfo`, the dispatcher's body is fast — H4 doesn't fit silent methods.

### 7.2 Fix branches (conditional on probe data)

| Probe trace | Confirmed hypothesis | Fix approach |
|---|---|---|
| PG-OUT → nothing else | CS relay or upstream pre-decrypt drop | Investigate content-script bridge; possibly `webNavigation`-driven re-injection |
| PG-OUT → CS-RECV → BCH-DECRYPT-IN → **BCH-SESSION-LOOKUP-MISS** | **H2** confirmed | **Scoped SW keepalive via `chrome.alarms`** while ≥1 live dApp tab/session exists. Stop alarm on last session terminate. Periodically revalidate that the tab is actually alive (a dApp tab can hold a session indefinitely without disconnecting; we must not pin the SW forever based on a stale session record). NO global keepalive. [SRC: opus Option C, codex agreed on scope, refined per codex final-review §13.3] |
| ... → BCH-DECRYPT-OUT → WB-IN → no WB-OUT | dispatcher hang | Find the specific method's path. Add a sub-probe inside the relevant branch. |
| ... → WB-OUT → DI-CAP-OPEN → CAP-APPROVE → no DI-CAP-SETTLE | **H3** confirmed | Fix `windowManager.detach`/`settle` race in `dapp-interaction/service.ts:97-107`. Likely make `detach` synchronous before settle. |
| ... → DI-CAP-SETTLE → WB-OUT → BCH-SEND → BCH-SEND-WIRE `has=false` | **H1** confirmed (mid-RPC session loss) | Same fix as H2 (scoped SW keepalive). |
| ... → BCH-SEND → BCH-SEND-WIRE `has=true` → no PG-IN | upstream response-relay swallow | Wrap `handler.sendResponse` to detect failures + send `SESSION_DISCONNECTED` to dApp so it can recover. [SRC: opus §8.3 Option A, adapted] |

### 7.3 Anti-list (what we explicitly will NOT do first)
- No blanket retry around `waitForPgResult`. [SRC: codex]
- No global `chrome.alarms` keepalive unless probes prove session loss. [SRC: codex]
- No `chrome.storage.session` persistence of `activeSessions` (sharedKey is an AES key, writing it to storage is a security regression). [SRC: opus §8.3 Option B rejected]
- No `node_modules` patches. The existing monkey-patch wrapper inside `background.ts:202-213` is the right level. [SRC: codex, opus agreed]

## 8. Phase E — Cluster B fix (account pre-provision)

### 8.1 Candidate 1 — Pre-provision Local default account during profile bootstrap [TOP per codex]

**Surface**: `packages/extension/src/composables/useProfileBootstrap.ts:63-99`.

**Shape**: after the active profile loads, ensure the built-in Local chain (chainId=0) has a default account BEFORE the user ever switches to it.

**Why this is strongest**:
- Removes the first-switch cold path entirely.
- Matches the ACTUAL wait surface (`nulo:ui:activeAccount` — account state, not PXE state).
- No new global infra, no new privileges.
- Privacy-safe: account derivation is local; no network RPC contact.

**Estimated impact**: 30s first-switch → <1s (account already exists).

### 8.2 Candidate 2 — Pre-provision on `setActiveNetwork`

**Surface**: `packages/extension/src/wallet/services/network/service.ts:305-320`.

**Shape**: ensure destination chain has a default account BEFORE emitting `onActiveNetworkChanged`.

**Why second**: correctness yes, but the user still waits on the visible switch unless this is done ahead of time (i.e. Candidate 1 already paid the cost at boot).

### 8.3 Candidate 3 — Reduce `NuloAccount.new()` cold cost

**Surface**: `packages/extension/src/wallet/services/account/service.ts:89-109`, `packages/aztec-runtime/src/account/nulo-account.ts:53-65`.

**Shape**: profile the derivation path; optimize / cache if it's the dominant sink.

**Why fallback**: higher crypto risk, larger blast radius. Only escalate to this if probe data shows derivation (not surrounding watcher churn or storage writes) dominates.

### 8.4 Candidate 4 (deferred) — Pre-warm offscreen modules at SW boot

**Surface**: `packages/extension/src/wallet/runtime.ts:191` (after `initWalletSdkHandler`).

**Shape**: fire-and-forget `ensureOffscreenRunning()`.

**Why deferred**: opus made a plausible case (bb.wasm + simulator import graph cold-cache cost), but the actual cluster-B wait is on account state, not PXE. If probes show PXE init also dominates for `tokenReadyExtension`/`feeJuiceImportedExtension` fixtures (not for the bare `switchToLocalNetwork` test), this becomes relevant for those specific files. [SRC: opus reconsidered via codex's correction]

### 8.5 Recommendation
**Implement Candidate 1 first.** Validate via probe re-run that account-pre-provision elapsed-ms drops. If `tokenReadyExtension` fixtures STILL stall on PXE init, escalate to Candidate 4 in a separate commit.

## 9. Phase F — Cluster C + D

### 9.1 Cluster C — `send-amount-clamp.test.ts`
Re-run after A+B land. Almost certainly a cascade victim. If still failing, probe the specific assertion.

### 9.2 Cluster D — `session-reconnect (alwaysTrust=false)` [SRC: codex]
Probe surfaces:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:145-173`
- `packages/extension/src/popup/windows/verify/index.vue:71-75`
- `packages/extension/src/wallet/services/dapp-session/service.ts:206-214`
- `packages/extension/tests/e2e/fixtures/popups.ts:104-141`

Don't classify as "pre-existing flake" until the reconnect path is observed. The test exists for a reason and `retry: 1` shouldn't be a free pass.

## 10. Phase G — Re-enable 4 quarantined files (incremental, NOT all at end)

Per codex's dependency analysis (re-enable in order, after the cluster they depend on lands):

| Order | File | Lands after | Why this order [SRC: codex, opus agreed on cadence] |
|---|---|---|---|
| 1 | `connect-locked-queue.test.ts` | Phase A probes (BEFORE D fix) | Tests `DiscoveryQueue` (separate surface from cluster A). Re-enabling with probes on gives us early signal about discovery-queue health independent of cluster A. [SRC: codex correction of opus] |
| 2 | `data-registerSender.test.ts` | Phase D fix (cluster A) | Cleanest single-RPC repro of cluster A — re-enabling DURING fix iteration gives a fast feedback loop. [SRC: opus] |
| 3 | `token-management.test.ts` | Phase D fix + Phase E fix | Uses `tokenReadyExtension` (depends on switchToLocalNetwork + importToken which crosses both clusters). |
| 4 | `fee-methods.test.ts` | Phase E fix | Deepest fixture stack (`feeJuiceImportedExtension`). Pure cluster B cascade unless probes say otherwise. |

**Each re-enable is its own commit**: `test(e2e): re-enable <filename>`.

## 11. Phase H — Strip probes + final validation

### 11.1 Strip commit
- Delete `__NULO_E2E_PROBE__` / `VITE_E2E_PROBE` constants from Vite configs.
- Delete the `probe()` helper.
- Delete every call-site.
- Single commit: `test(e2e): remove diagnostic probes`.

### 11.2 Validation
- Three consecutive `bun run e2e:agent` runs.
- Pass criterion: 61/61 passing in ≥2 of 3 runs (allowance for the cluster D retry-x1 flake if it persists post-fix).
- Plus 4 quarantined re-enabled (so 65 effectively).
- `bun run audit:vue` green.
- `bun run test:e2e` smoke regression check: ≥17 passing (1 pre-existing security flake allowance).

### 11.3 PR #46 body update
- Replace the existing "DO NOT MERGE" + cluster summary with: final counts (61/61), per-cluster closure notes, links to `findings.md` and this `plan.md`.
- Keep the re-sign-before-merge instruction (commits remain unsigned per AFK directive).
- Add a "What this unblocks" line.

## 12. Test plan

- Every probe commit must be behavior-preserving (no test regressions).
- Every fix commit needs:
  - A single-test repro that exercises the fixed path
  - Where possible, a unit-test inline (e.g. `wallet-bridge/src/dispatcher.test.ts` for any dispatcher-level fix)
  - A re-run of the cluster's sampler with probes still on, confirming the probe says fixed (BCH-SESSION-LOOKUP-MISS no longer fires, etc.) BEFORE stripping probes
- Full-suite `e2e:agent` is the gate. File-level passes are insufficient (file-scope fixtures cascade).

## 13. Security & Adversarial Considerations [CONSOLIDATED]

### 13.1 Probe leakage to prod
- **Threat**: probes shipped to prod leak method names, sessionIds, chainIds, account addresses, queue depths. Browser-console-readable. [SRC: all three agreed]
- **Mitigation A** (design intent — NOT a safety guarantee on its own): gate ALL probe call-sites on `import.meta.env.VITE_E2E_PROBE === "1"`. Vite's compile-time replacement should let the off-branch be dead-code-eliminated, but "tree-shaking" is best-effort.
- **Mitigation B (the actual leak guarantee)**: CI bundle-grep step in `.github/workflows/_network-e2e.yml`: `grep -c 'PROBE:\|VITE_E2E_PROBE' packages/extension/dist/chrome/**/*.js` must be 0. [SRC: opus + codex final-review — bundle-grep is THE safety property; source-grep is insufficient]
- **Payload sanitization**: probe payloads contain ONLY method name, hashed sessionId (NOT raw sessionId), timestamp, elapsed ms, boundary marker. Never addresses, balances, raw args, ciphertext, manifests. [SRC: codex + opus]

### 13.2 Probe perturbation (NEW from codex)
- **Threat**: an attacker who can trigger probe execution at specific times could observe operation ordering and infer side-channel info. More urgently: probes that `await` on hot paths change timing in ways that hide real bugs.
- **Mitigation**: probes MUST be synchronous and side-effect-free. No `await` inside probe call-sites on hot paths. The `probe()` helper writes via the logger (which queues internally) without awaiting.

### 13.3 SW keepalive scope creep (if H2 fix lands)
- **Threat**: pinning the SW alive past intended lifetime extends the window for in-memory session material (sharedKey, capability grants). A "session count > 0" check is directionally right but does NOT close every gap — a dApp tab that never explicitly disconnects can pin the SW indefinitely. [SRC: opus + codex final-review §5]
- **Mitigation**:
  - Keepalive scoped to **live dApp tabs/sessions** — not just `handler.getActiveSessions().length > 0`. ALSO require that the session's owning tab is still alive (`chrome.tabs.get(tabId)` resolves). Periodically revalidate (e.g. on every 5th alarm tick) and call `onSessionTerminated` on stale entries.
  - Use `chrome.alarms.create({ periodInMinutes: 0.4 })` (24s — under MV3 30s idle threshold). `setInterval` does NOT keep SWs alive.
  - Stop the alarm when the revalidated live-session count reaches 0.
  - Code comment at the keepalive site: `// SCOPE: live dApp tabs only. NEVER global. Revalidates tab presence. See plan §13.3.`

### 13.4 Persisting `activeSessions` to disk (REJECTED)
- **Threat**: writing `sharedKey` (ECDH-derived AES key) to `chrome.storage.session` puts it on disk-IPC channels (per Chrome storage backing). Even though `storage.session` clears on browser close, this is a security model regression. [SRC: opus §8.3 Option B]
- **Mitigation**: don't do it. Use the scoped keepalive instead. If H2 confirms and keepalive isn't sufficient, escalate to "send `SESSION_DISCONNECTED` to dApp so it can re-establish" via the upstream wallet-sdk protocol — but never persist the key.

### 13.5 Account pre-provision: local metadata footprint (Cluster B fix)
- **Threat**: pre-deriving + storing default accounts for chains the user hasn't visited has **no remote privacy leak** (no network RPC contact), but it **does** create local metadata footprint — the chain's account address shows up in storage exports, encrypted backups, profile-import payloads, etc. A user who never intended to use the Local chain now has a Local-chain account in their backup. This is a conscious tradeoff, not a free win. [SRC: codex final-review §6]
- **Mitigation**:
  - All derivation + storage stays LOCAL — no network RPC contact during pre-provision.
  - Limit to the built-in chains (Local, Aztec testnet) — don't pre-provision for arbitrary user-added networks. This caps the metadata expansion to the chains we ship with anyway.
  - **Document the tradeoff in the user-facing changelog** for the release that ships this fix, so users who care about backup minimalism are aware.
  - Code comment: `// Pre-provisioning. LOCAL-ONLY derivation, no network contact. Creates a backup-visible account for built-in chains even if the user never visits them — conscious tradeoff to remove 30s first-switch latency. See plan §13.5.`

### 13.6 PXE pre-warm privacy (DEFERRED, only relevant if Candidate 4 lands)
- **Threat**: if a future maintainer extends "pre-warm" to "pre-sync against the network's RPC", that leaks the user's active-network choice on every SW boot. [SRC: opus]
- **Mitigation**: code comment at the pre-warm site: `// DO NOT add network-touching ops here — see plan §13.6.`

### 13.7 wallet-sdk session lifetime (NOT EXTENDED)
- We are NOT extending the channel session's logical lifetime. The crypto session lifetime is determined by upstream's AES-GCM nonce/IV scheme. Our fixes keep the SW alive longer (so the in-memory `activeSessions` entry survives) but don't change the session's own lifetime. [SRC: opus §13.4 main plan retraction]

### 13.8 Supply chain (no change)
- No new deps. The Bun patches for `@aztec/noir-noirc_abi` + `@aztec/noir-acvm_js` (on this branch) stay. `bun audit` baseline unchanged. [SRC: all three]

### 13.9 Don't trust `nulo:liveness` [SRC: codex]
- A live SW does NOT prove the encrypted session still exists. `nulo:liveness` confirms SW boot completed; says nothing about `activeSessions` state. Probes that infer "session is fine because SW is alive" are wrong.

### 13.10 Don't trust `handler.sendResponse()` [SRC: codex]
- Upstream silently swallows send failures (line 197-198 in `background_connection_handler.js`). A successful `sendResponse` call doesn't mean the dApp received anything. **BCH-SEND-WIRE** (with `activeSessions.has` check before send) is the right defensive probe.

### 13.11 Test-only code in prod (NO CHANGE)
- `E2E_REQUIRE_SETUP=1` (from PR #46) only affects harness exit code; doesn't ship.
- New probes gate on `VITE_E2E_PROBE` (compile-time tree-shaken).
- No runtime test-only code paths reach the production bundle.

## 14. File catalog (corrected file paths) [SRC: codex corrections]

### 14.1 Cluster A
- `packages/playground/src/lib/log.ts` — PG-OUT / PG-IN
- `packages/playground/src/lib/wallet.ts` — reference (no probes; log.ts wraps all calls)
- `packages/extension/src/content-script/content.ts` — CS-RECV (secondary)
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — BCH-RECV, BCH-DECRYPT-*, BCH-SEND, BCH-SEND-WIRE, SESSION-EST/TERM
- `packages/wallet-bridge/src/dispatcher.ts` — WB-IN, WB-OUT
- `packages/extension/src/wallet/services/dapp-interaction/service.ts` — DI-CAP-OPEN, DI-CAP-SETTLE
- `packages/extension/src/popup/windows/capabilities/index.vue` — CAP-APPROVE
- `packages/extension/src/wallet/services/execution/service.ts` — EXEC-IN, EXEC-OUT (for post-grant silent methods only)
- `packages/extension/src/wallet/index.ts` — SW-LIFECYCLE
- **New (if H2 confirmed)**: `packages/extension/src/wallet/services/wallet-sdk/sw-keepalive.ts`

### 14.2 Cluster B
- `packages/extension/tests/e2e/fixtures/helpers.ts` — SWITCH-CLICK/HDR/ACTIVE
- `packages/extension/src/popup/pages/settings/networks/[id].vue` — NET-SETACTIVE
- `packages/extension/src/wallet/services/network/service.ts` — NET-SETACTIVE
- `packages/extension/src/popup/app.vue` — WATCH-IN/OUT
- `packages/extension/src/wallet/services/account/service.ts` — ACCT-GET/ENSURE/CREATE
- `packages/aztec-runtime/src/account/nulo-account.ts` — ACCOUNT-NEW
- `packages/extension/src/stores/app.store.ts` — ACTIVE-ACCOUNT-WRITE
- `packages/extension/src/composables/useProfileBootstrap.ts` — Phase E fix site (account pre-provision)

### 14.3 Cluster B secondary (offscreen, only if needed)
- `packages/extension/src/offscreen/index.ts` (CORRECTED — not `wallet/offscreen`)
- `packages/extension/src/wallet/utils/offscreen.ts`
- `packages/extension-messaging/src/offscreen/client.ts`
- `packages/aztec-runtime/src/pxe/service.ts`

### 14.4 Build / infra
- `packages/extension/vite.config.ts` — register `VITE_E2E_PROBE` Vite define (or just rely on `import.meta.env.VITE_E2E_PROBE`)
- `packages/playground/vite.config.ts` — same
- `packages/extension/scripts/e2e/agent.sh:30-31` — set `VITE_E2E_PROBE=1`
- `packages/extension/tests/e2e/global-setup.ts:344-353` — propagate `VITE_E2E_PROBE=1` to playground dev-server env
- `.github/workflows/_network-e2e.yml` — bundle-grep step

## 15. Open questions before Phase D approval [SRC: all three]

1. **Does CAP-APPROVE fire and does DI-CAP-SETTLE fire for failing `requestCapabilities` repros?** (Codex Q1. Answers H3 directly.)
2. **Do SESSION-TERM or tab-update events fire between connect and the failing call?** (Codex Q2. Strengthens H2 if yes.)
3. **Is `NuloAccount.new()` actually the dominant cluster B sink, or is the time in storage/watcher churn around it?** (Codex Q3.)
4. **Does `connect-locked-queue` need only a deterministic "queued" signal, or is there a real queue-drain bug under lock/unlock churn?** (Codex Q4.)
5. **For Cluster D: failure before verify popup creation, during approval, or after popup close while waiting for `pg-status=connected`?** (Codex Q5.)
6. **Should we speculatively prep the H2 fix (scoped keepalive) in a separate branch before probes confirm?** (Opus Q1. Recommendation: no — wait for data. We'd burn time on the wrong fix otherwise.)
7. **Probe gate constant scope**: single `VITE_E2E_PROBE` or per-package (`VITE_EXT_E2E_PROBE`, `VITE_PG_E2E_PROBE`)? (Opus Q5. Recommendation: single — simpler and the bundle-grep covers both.)

## 16. Rejected / deferred

- ~~**SW-ALIVE setInterval probe**~~ — noise. SW-LIFECYCLE is the right signal. [SRC: opus]
- ~~**node_modules patches for probes**~~ — wrap upstream inside our `background.ts` instead. [SRC: codex, opus]
- ~~**Pre-warm offscreen at SW boot** as primary cluster B fix~~ — actual wait is on account state. Defer Candidate 4 to data. [SRC: codex's correction]
- ~~**Persistent `activeSessions`**~~ — AES key persistence is a security regression. [SRC: opus §8.3]
- ~~**Global SW keepalive**~~ — scope creep on session material lifetime. Scoped to active sessions only. [SRC: opus + codex]
- ~~**Blanket retry around `waitForPgResult`**~~ — hides bugs. [SRC: codex]
- ~~**Timeout bumps for cluster B**~~ — user constraint #2. [SRC: user]
- ~~**Adding new e2e tests now**~~ — opus suggested 2 adversarial test cases; deferring to a follow-up `e2e-coverage-hardening` plan. Adding tests now expands the surface to debug. [SRC: opus revised]

## 17. Phase ordering (final)

```
[ ] Phase A    — Cluster A probes              (1 commit)
[ ] Phase A.1  — Re-enable connect-locked-queue (1 commit, probes immediately reveal queue health)
[ ] Phase B    — Cluster B probes              (1 commit)
[ ] Phase C    — Probe-run + findings.md       (no commit yet; saved doc-commit at H)
[ ] APPROVAL GATE: user signs off on findings + fix direction
[ ] Phase D    — Cluster A fix(es)             (1-3 commits)
[ ] Phase D.1  — Re-enable data-registerSender (1 commit)
[ ] Phase E    — Cluster B fix                 (1-2 commits)
[ ] Phase E.1  — Re-enable token-management    (1 commit)
[ ] Phase E.2  — Re-enable fee-methods         (1 commit)
[ ] Phase F    — Cluster C + D                 (commit if fix needed)
[ ] Phase G    — Strip probes                  (1 commit)
[ ] Phase H    — Full validation + PR body update + findings.md doc commit
```

## 18. Done definition

- `bun run e2e:agent` exits 0 with 61/61 passing (allowing 1 retry on D's flake)
- 4 quarantined files re-enabled and passing
- `bun run test:e2e` smoke green (1 known security flake allowance)
- `bun run audit:vue` green
- Zero `PROBE:` strings in source AND in dist/ (CI bundle-grep enforces)
- PR #46 body updated to reflect final state
- Plan + findings + audit transcripts committed under `implementations-plan/e2e-full-network-recovery/`
- CI bundle-grep step wired in `.github/workflows/_network-e2e.yml`

## 19. Sources

- `implementations-plan/e2e-full-network-recovery/plan-main.md` — main agent's plan v1
- `implementations-plan/e2e-full-network-recovery/audit-codex.md` — codex xhigh
- `implementations-plan/e2e-full-network-recovery/audit-opus.md` — opus 4.7 subagent
- This document — main agent's consolidation pass, 2026-05-22

## 19a. Final codex review (post-consolidation)

Codex final pass: **APPROVE-WITH-MINOR-FIXES** ([codex response-1.md]). Six wording/spec precision issues applied to this document:

1. §1.2 — counts: the 61 already includes the 8 quarantined-sub-test skips. "65+ effectively running" was wrong. Target stays 61/61 with re-enabling as a separate condition.
2. §2 note — corrected `connect-handshake.test.ts` → `connect-dapp.test.ts > connect-handshake` (the test name; the file is `connect-dapp.test.ts`).
3. §7.1 H2 — added a "Probe-trace shorthand" sub-section clarifying that `BCH-RAW-IN` in the falsification criteria is shorthand for `CS-RECV → BCH-DECRYPT-IN` (the table doesn't define a `BCH-RAW-IN` boundary directly).
4. §4.2 + §13.1 — softened "tree-shaken when off" language; clarified bundle-grep is THE leak guarantee (not just an additional verification). Removed `packages/playground/dist/` from grep target (doesn't exist in this repo).
5. §13.3 — strengthened SW keepalive: "scoped to active sessions" is insufficient if a dApp tab never disconnects. Added live-tab revalidation requirement.
6. §13.5 — corrected "privacy-safe" overstatement: no REMOTE leak, but DOES expand local metadata footprint (backup-visible accounts for unvisited built-in chains). Documented as conscious tradeoff with changelog disclosure.

The core architecture — probe-first, account pre-provision for B, H1/H2 co-top with falsification criteria, no node_modules patches, incremental quarantine re-enable in codex's dependency order — is approved.

## 20. Decision provenance summary

| Decision | Source(s) | Reasoning |
|---|---|---|
| Probe-first | user | constraint #1 |
| Real fix for B, not timeout | user | constraint #2 |
| One PR phased on recovery branch | user | constraint #3 |
| 16 probe boundaries | codex (12) + opus (4) | codex's set covers the popup/settle branches main missed; opus adds the encrypted-channel visibility codex missed |
| Drop SW-ALIVE heartbeat | opus, codex agreed | noise; SW-LIFECYCLE is the right signal |
| Bundle-grep mitigation | opus | source-grep insufficient |
| Cluster B = account-provisioning, not PXE | codex | verified — wait surface is `nulo:ui:activeAccount` |
| Pre-provision Local default account as B fix | codex | matches wait surface |
| Defer PXE pre-warm to data | opus reconsidered via codex | only relevant if probes show PXE dominates |
| Scoped SW keepalive (if H2) | opus + codex agreed | non-global; tied to active sessions |
| Reject `activeSessions` persistence | opus | AES key on storage = security regression |
| Re-enable connect-locked-queue first | codex | separate surface (DiscoveryQueue); independent of cluster A |
| Re-enable data-registerSender second | opus + codex agreed cadence | cleanest cluster A repro; fast iteration loop |
| No node_modules probes | codex, opus agreed | repo-owned only |
| Synchronous side-effect-free probes | codex | probe perturbation threat |
| Approval gate before Phase D | user | constraint #4 |
