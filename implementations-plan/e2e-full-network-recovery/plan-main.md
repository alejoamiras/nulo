# E2E Full Network Recovery — Plan (main, v1)

> Independent draft by main agent. Will be consolidated with codex's plan + opus's plan per Tier A protocol.

## 1. Context

### 1.1 Where we are
- Builds on branch `fix/e2e-network-suite-recovery` (PR #46, draft, **DO NOT MERGE** today).
- Current state of `e2e:agent` on this branch:
  ```
  Test Files  29 failed | 12 passed | 4 skipped (45)
  Tests       36 failed | 17 passed | 8 skipped (61)
  ```
- The infrastructure-side recovery (Bun patches v2 + `E2E_REQUIRE_SETUP=1` fail-loud) is done. What remains is product-side.
- 4 test files are intentionally `test.skip(...)`-quarantined and out of the headline counts: `data-registerSender`, `connect-locked-queue`, `fee-methods`, `token-management`.

### 1.2 Goal
**All 61 tests passing locally on `bun run e2e:agent`.** Re-enable the 4 quarantined files. Stretch: `bun run test:e2e` (smoke) also green with no new regressions.

### 1.3 Constraints (from user)
- Probe-first for cluster A (no jump-to-fix).
- Real fix for cluster B, NOT a timeout bump (PXE first-switch slowness is also a real user UX bug).
- One PR — phased commits on top of `fix/e2e-network-suite-recovery`. PR #46 stays open as the umbrella.
- Interactive mode — user gates each major decision.
- No merge today.

### 1.4 Prior art
- `implementations-plan/network-test-triage/` — popup-side bugs fixed (F1/F2/F3 around `app.vue` network watcher + popup account guards). Those landed on `dev`. They cover popup-driven failure modes; the current 36 failures are mostly dApp-driven (different surface).
- `implementations-plan/e2e-network-recovery/` — the recovery branch's own plan + quarantine doc.

## 2. Failure cluster breakdown (current state)

| Cluster | # files | Symptom | Primary surface |
|---|---|---|---|
| A | ~22 | `waitForPgResult` times out at 30s on 2nd+ dApp RPC after connect handshake succeeds | wallet-sdk encrypted channel → SW dispatcher → wallet-bridge → ExecutionService |
| B | 4 | First `switchToLocalNetwork` takes ~30s (subsequent switches are fast) | offscreen iframe PXE cold-init |
| C | 1 | `send-amount-clamp` fails at 35s | Cascade victim of A or B (uses `tokenReadyExtension`) |
| D | 1 | `session-reconnect (alwaysTrust=false)` fails at 71s with retry x1 | Possibly a real bug, possibly pre-existing flake |

## 3. Strategy

### 3.1 Probe-first
The current quarantine doc names a symptom. We need the **mechanism** before fixing — otherwise we'd be guessing at one of:

- The MV3 service worker goes idle between connect handshake and the 2nd RPC, and the 2nd message doesn't wake it correctly
- The wallet-sdk encrypted channel session gets garbage-collected
- The content script's port to SW closes
- The wallet-bridge `WalletSdkDispatcher` rejects/drops the 2nd message
- The `ExecutionService` handler hangs
- The response goes back but the playground's wallet-sdk receiver doesn't update the DOM

All 6 are plausible. Probes will disambiguate.

### 3.2 Phased commit structure
On `fix/e2e-network-suite-recovery`:
1. Phase A — Probes added (revertible, test-only commit)
2. Phase B — Probes for cluster B (offscreen PXE init)
3. Phase C — Probe-run + findings doc
4. Phase D — Cluster A fix(es) based on findings
5. Phase E — Cluster B fix
6. Phase F — Cluster C+D follow-up
7. Phase G — Re-enable 4 quarantined files
8. Phase H — Strip probes, full-suite validation, update PR body

## 4. Phase A — Cluster A diagnostic probes

Add `[PROBE:CLA:*]` console.log at 5 boundaries:

### A.1 Playground side
- `packages/playground/src/lib/wallet.ts` — before/after `wallet.requestCapabilities(manifest)` (and any other 2nd-RPC call)
- Log: `[PROBE:CLA:PG-OUT] method={name} ts={Date.now()}`
- Log: `[PROBE:CLA:PG-IN] method={name} ts={Date.now()} status={ok|throw}`

### A.2 Wallet-bridge dispatcher
- `packages/wallet-bridge/src/dispatcher.ts` — `WalletSdkDispatcher.dispatch()` entry + exit
- Log: `[PROBE:CLA:WB-IN] method={type} sessionId={sid} ts={ts}`
- Log: `[PROBE:CLA:WB-OUT] method={type} elapsed={ms} status={ok|throw}`

### A.3 BackgroundConnectionHandler
- `packages/extension/src/wallet/...` — wherever the SW connection handler receives `WalletMessage` events from the wallet-sdk channel
- Log: `[PROBE:CLA:BCH-RECV] method ts`
- Log: `[PROBE:CLA:BCH-SEND] method elapsed status`

### A.4 ExecutionService
- Wherever `executeOperations` is called
- Log: `[PROBE:CLA:EXEC-IN/OUT]`

### A.5 SW liveness
- `packages/extension/src/wallet/runtime.ts` near the `nulo:liveness` write
- Log: `[PROBE:CLA:SW-ALIVE] ts={ts}` every 5s on a setInterval (only when E2E_PROBE=1)

### A.6 Probe enable mechanism
Gate everything on `E2E_PROBE=1` env at build time (Vite `define`) so probes don't ship to prod. Add `E2E_PROBE=1` to `scripts/e2e/agent.sh` only.

## 5. Phase B — Cluster B diagnostic probes

### B.1 Offscreen lifecycle
- `packages/extension/src/wallet/offscreen/index.ts` — module load, PXE init begin/end, ChainRuntime init begin/end

### B.2 Network switch handler
- The SW handler for "switch active network" — log handler entry, awaited dependencies, exit

### B.3 First-switch instrumentation
- Run `networks.test.ts > switch to Local Network` (the failing one) in isolation with probes on

## 6. Phase C — Probe-run + findings

Three runs:

| # | Tests | Expected output |
|---|---|---|
| 1 | `sim-methods.test.ts > sim-simulateTx` + `meta-getChainInfo.test.ts` + `cap-request-basic.test.ts` | Sequence of A.* timestamps → where the call gets stuck |
| 2 | `networks.test.ts` (4 tests, file-scope) | First-switch timing breakdown |
| 3 | `session-reconnect (alwaysTrust=false)` | Cluster D mechanism |

Save findings to `implementations-plan/e2e-full-network-recovery/findings.md`.

After this phase, we plan the actual fixes with concrete data.

## 7. Phase D — Cluster A fix (hypothetical, refined post-probe)

Candidates pending probe data:

- **D.1** If SW idle between handshake + 2nd RPC: pin SW alive via `chrome.alarms.create("keepalive", { periodInMinutes: 0.4 })` + heartbeat handler. The wallet-sdk handshake establishes a long-lived port; if the port drops we need to re-establish. Easier: ensure the port stays open by sending periodic noop messages from the dApp.
- **D.2** If wallet-bridge dispatcher hangs: trace the specific method's path. Most likely a missing case in the dispatch switch or an unawaited promise.
- **D.3** If ExecutionService hangs: same trace.
- **D.4** If response postMessage drops: check the chrome.runtime.Port reconnect logic.
- **D.5** If the wallet-sdk channel session GC's after a timeout: extend its lifetime.

## 8. Phase E — Cluster B fix (PXE perf, not timeout)

Candidates pending probe data:

- **E.1** Lazy PXE init — defer the heavy import/init until first method call instead of doing it during network switch.
- **E.2** Pre-warm PXE — start PXE init the moment the wallet boots (during SW startup), so by the time the user switches network, PXE is already ready.
- **E.3** Parallelize PXE init with ChainRuntime startup so they're not sequential.

Real user impact: every user who first connects to Local Network sees a 30s delay. Worth fixing.

## 9. Phase F — Cluster C + D

- **C** (1 file): Re-run after A is fixed. Likely cascade victim. If still failing, separate probe.
- **D** (1 test): The `alwaysTrust=false` reconnect flow. Possibly a real session-resumption bug. Read the test, understand what `alwaysTrust=false` means in this context, check the SW's session restore path.

## 10. Phase G — Re-enable 4 quarantined files

Each in isolation:

| File | Hypothesis | Fix path |
|---|---|---|
| `data-registerSender.test.ts` | Cluster A victim (dApp RPC test) | Should pass after Phase D |
| `connect-locked-queue.test.ts` | Cluster A victim | Should pass after Phase D |
| `fee-methods.test.ts` | Cluster B cascade (uses `feeJuiceImported` fixture which calls `switchToLocalNetwork`) | Should pass after Phase E |
| `token-management.test.ts` | Mixed — needs investigation | TBD |

Remove `test.skip(...)`, run each in isolation, fix what breaks.

## 11. Phase H — Strip probes + full-suite validation

- Delete all `[PROBE:CLA:*]` console.log lines (commit "test(e2e): remove diagnostic probes")
- Three consecutive `e2e:agent` runs
- Pass criterion: 61/61 in at least 2 of 3 runs, with the 1 known D flake allowance
- Update PR #46 body with the new totals + cluster breakdown closure

## 12. Test plan

- Each probe commit adds **only** instrumentation; existing tests must still pass.
- Each fix commit must include a single-test repro that exercises the fixed path. Inline test where possible (e.g., a new `dispatcher.test.ts` case for wallet-bridge if D.2 lands).
- Full-suite `e2e:agent` is the gate. Don't trust file-level passes — file-scope fixtures can cascade.

## 13. Security & Adversarial Considerations

### 13.1 Probe leakage
- Gate ALL probes on `E2E_PROBE=1` env (Vite `define`). Without this, probes are dead code (tree-shaken in prod build).
- **Threat**: a forgotten probe in a prod release leaks internal RPC method names + session IDs to the browser console. An attacker reading the page console (or a malicious extension reading via `chrome.devtools`) sees the protocol.
- **Mitigation**: a pre-merge check — `grep -r "PROBE:CLA:" packages/extension/src` must return zero.

### 13.2 SW keepalive (if Phase D.1 lands)
- **Threat**: pinning the SW alive past its intended lifetime leaks active session data into a long-lived process. If the user closes the dApp tab but the SW stays alive, capability grants persist longer than expected.
- **Mitigation**: keepalive should be SCOPED to active dApp sessions, NOT global. When all sessions close, keepalive stops. Add a counter — only schedule alarms while >=1 active session.

### 13.3 PXE pre-warm (if Phase E.2 lands)
- **Threat**: pre-fetching PXE state for a network the user hasn't explicitly chosen could exfiltrate the user's account address to that network's RPC provider (privacy leak).
- **Mitigation**: pre-warm should be lazy at the offscreen-import level (load the WASM, init the in-memory PXE), NOT at the RPC level (don't actually contact any network until the user switches). PXE init should be network-agnostic.

### 13.4 wallet-sdk encrypted channel
- **Threat**: if Phase D.5 lands (channel session lifetime extension), we extend the window for replay attacks against the encrypted channel. The wallet-sdk has its own nonce/seq, but our session-restore path is custom.
- **Mitigation**: confirm the wallet-sdk's session resumption protocol (read `@aztec/wallet-sdk` source) — if it uses a fresh nonce on resume, we're fine. If it reuses a nonce, do NOT extend lifetime.

### 13.5 Test isolation
- Probes write timestamps. If a probe accidentally includes user-data (account address, balance), that's PII in a CI log.
- **Mitigation**: probe payloads contain ONLY method name, sessionId-hash, timestamp, elapsed ms. No addresses, no amounts.

### 13.6 Supply chain (no change vs. baseline)
- This work touches no dependencies. The Bun patches from PR #46 stay.

### 13.7 Adversarial test cases to add (post-fix)
- A test that simulates a slow dApp (delay between connect and 2nd RPC by >60s) — confirms our fix doesn't introduce a regression on slow dApps.
- A test that simulates a fast-disconnect dApp (close tab during 2nd RPC) — confirms the response-relay doesn't leak handler state.

## 14. File catalog (best-guess pre-probe)

### 14.1 Likely touch points (Cluster A)
- `packages/wallet-bridge/src/dispatcher.ts` — main dispatch logic
- `packages/extension-messaging/src/background/service.ts` — generic SW Service base class
- `packages/extension/src/wallet/runtime.ts` — wallet runtime + nulo:liveness
- `packages/extension/src/wallet/background/main.ts` (or wherever SW entry is)
- `packages/playground/src/lib/wallet.ts` — probe injection point

### 14.2 Likely touch points (Cluster B)
- `packages/extension/src/wallet/offscreen/index.ts` — offscreen entry
- `packages/aztec-runtime/src/pxe/service.ts` — PXE service (mentioned in old triage as PXE-guard serialization point)
- `packages/extension/src/wallet/runtime.ts` — chain runtime startup

### 14.3 Test-side touch points
- `packages/extension/tests/e2e/fixtures/extension.ts` — fixture setup (the 30s liveness wait at line 70-80)
- `packages/extension/tests/e2e/fixtures/playground.ts` — `waitForPgResult` (we own this — could add tighter diagnostics)
- `packages/extension/scripts/e2e/agent.sh` — env wiring for `E2E_PROBE=1`

## 15. Open questions

1. **SW keepalive** — does the wallet already use `chrome.alarms` or a heartbeat? Need to grep before designing D.1.
2. **wallet-sdk session lifetime** — what is the default? Where does it GC?
3. **PXE init timing** — is it eager (on offscreen-iframe load) or lazy (on first PXE call)? Need to read offscreen/index.ts.
4. **Cluster D's `alwaysTrust=false`** — what's the semantic difference vs. `alwaysTrust=true`? Why does this one flake? Worth understanding before treating as "pre-existing".

## 16. Rejected/deferred from this plan

- **No retry wrappers around `waitForPgResult`**. Hides bugs.
- **No `test.skip` to mute failing tests**. Hides bugs.
- **No timeout bumps (Cluster B). User explicitly chose real fix only.**
- **No bisect against last-known-good.** Bisecting against the open-source initial-import commit isn't useful — pre-import history isn't here.

## 17. Phase ordering

```
[ ] Phase A — Probes for Cluster A (commit "test(e2e): add cluster A diagnostic probes")
[ ] Phase B — Probes for Cluster B (commit "test(e2e): add cluster B PXE init probes")
[ ] Phase C — Probe-run + findings.md (no commit; doc commit at end)
[ ] Phase D — Cluster A fix (multiple commits per finding)
[ ] Phase E — Cluster B fix
[ ] Phase F — Cluster C + D investigation/fix
[ ] Phase G — Re-enable 4 quarantined files
[ ] Phase H — Strip probes + validation + PR body update
```

## 18. Done definition

- `bun run e2e:agent` exits 0 with 61/61 passing (allowing 1 retry on D's flake)
- `bun run test:e2e` smoke passing (1 pre-existing security flake allowance)
- `bun run audit:vue` green
- 4 quarantined files re-enabled and passing
- Zero `[PROBE:CLA:*]` strings in source tree
- PR #46 body updated to reflect final state
- This plan + findings + lessons committed under `implementations-plan/e2e-full-network-recovery/`
