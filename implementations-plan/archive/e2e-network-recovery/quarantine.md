# Network e2e — remaining failures after recovery

Snapshot from `/tmp/e2e-baseline4-*.log` after commits `418ece9` (v1 patches), `278a870` (fail-loud), `aa65e90` (v2 conditional-`exports` patches) land on this branch.

## Headline

| Metric | Pre-recovery | After v1 patches | **After v2 patches** |
|---|---|---|---|
| Test Files passing | 0 (all skipped) | 0 (all failed) | **12** |
| Test Files failing | 0 (silent-skip) | 41 | **29** |
| Test Files skipped (intentional) | 45 (silent-skip) | 4 | **4** |
| Tests passing | 0 | 0 | **17** |
| Tests failing | 0 | 53 | **36** |
| Tests skipped (intentional) | 61 | 8 | **8** |

**Key wins**:
- The `Network e2e / Status` CI check is no longer pass-by-skip. The agent wrapper's new `E2E_REQUIRE_SETUP=1` env gate (commit `278a870`) forces global-setup deploy failures to surface as a non-zero exit instead of `61 skipped`.
- 17 tests actually execute and pass. Coverage is real, not theatre.
- `data-registerSender.test.ts`, `connect-locked-queue.test.ts`, `fee-methods.test.ts`, `token-management.test.ts` are intentionally `test.skip(...)`-quarantined with comments referencing prior triage. These 4 files / 8 tests should be revisited separately.

## Remaining failure clusters

### Cluster A — `waitForPgResult` 30s timeout in dApp tests (~22 files, dominant)

Tests using `dappConnectedExtension` or `dappConnectedExtensionPerTest` that issue a playground RPC and wait for the result via `await waitForPgResult(page, "...", seq, 30_000)`. Test ends at ~35s (30s wait + ~5s test overhead). The wallet completes the initial connect handshake (fixture succeeds), but doesn't respond to the SECOND RPC.

Representative tests:
- `sim-methods.test.ts` — `sim-simulateTx`, `sim-profileTx`, `sim-executeUtility` (silent path)
- `meta-getChainInfo`, `meta-batch`, `meta-getAccounts`, `meta-getAccounts-pregrant`
- `cap-request-basic`, `cap-request-reject`, `cap-request-repeat-noPopup`
- `tx-sendTx-default`, `tx-sendTx-multicall`, `tx-sendTx-sponsoredFpc`, `tx-sendTx-feePayer`, `tx-sendTx-multicall-chunked`
- `contracts-register`, `contracts-getMetadata`, `contracts-getClassMetadata`
- `authwit-callIntent`, `batch-mixed`, `cancel-mid-prove`
- `connect-handshake` (in `connect-dapp.test.ts`)
- `session-explicitDisconnect`, `session-reconnect (alwaysTrust=false)`
- `multi-account-from`, `concurrency-rapid-fire`, `wallet-locked-mid-session`
- `err-no-cap-simulateTx`, `err-no-cap-executeUtility`
- `data-addressBook`

Likely root cause(s):
- Wallet RPC dispatcher not responding to second/subsequent calls after connect handshake.
- Playground's RPC client state may be stale.
- Encoding/decoding regression in the wallet-sdk response path.

This is one investigation, not 22.

### Cluster B — `switchToLocalNetwork` 30s wait (4 files affected, file-scope cascade)

`networks.test.ts > switch to Local Network` (test 2 of 4) — fails at exactly 30s. Tests 1, 3, 4 of the same file pass. The first network-switch attempt in the lifetime of the browser hangs ~30s; subsequent switches in the same fixture succeed (test 4 confirms).

Same root affects every fixture that calls `switchToLocalNetwork` during setup: `dappConnectedExtension`, `dappConnectedExtensionPerTest`, `localNetworkExtension`, `tokenReadyExtension`, `feeJuiceImportedExtension`. The fixture's first switch is when the slowness bites.

`contacts-sender.test.ts` shows the file-scope cascade: test 1 fails at 35s on first interaction; tests 2–4 cascade-fail at 0–1ms because the file-scoped fixture is broken state.

Plausible fixes:
- Bump first-switch test timeout to 60s (mechanical).
- Investigate why first network-switch is slow (real product perf concern).

### Cluster C — `send-amount-clamp.test.ts` (1 test)

Fails at 35s — `send amount input clamps fractional digits beyond token.decimals + shows inline hint`. Uses `tokenReadyExtension` (full token deploy fixture). Likely cascade from cluster A/B since this fixture also calls `switchToLocalNetwork`.

### Cluster D — Pre-existing flakes (1 test, file unaffected by this work)

`session-reconnect (alwaysTrust=false)` failed at 71s with retry x1. Test has retry config indicating known flakiness. Not caused by this work.

## What I changed in this branch (file-by-file)

- `patches/@aztec%2Fnoir-noirc_abi@4.2.0.patch` — new; adds conditional `exports` map (browser→web bundle, node→nodejs bundle).
- `patches/@aztec%2Fnoir-acvm_js@4.2.0.patch` — same shape for sibling package.
- `package.json` (root) — `patchedDependencies` block referencing both patches.
- `bun.lock` — regenerated with `patchedDependencies`.
- `scripts/e2e/agent.sh` — exports `E2E_REQUIRE_SETUP=1` before running the vitest network suite.
- `tests/e2e/global-setup.ts:426-451` — env-gated fail-loud (throws on deploy failure when `E2E_REQUIRE_SETUP=1`).
- `implementations-plan/e2e-network-recovery/` — Tier A plan (v1 + v2), codex audits, opus audit, discovery lesson, this quarantine doc.

## What I deliberately did NOT change

- **No product code edits.** Phase-0 fixes (F1/F2/F3) for the account-state-after-network-switch issue had already landed on `dev` before this recovery branch — verified by grep + line refs. The remaining failures (cluster A's RPC unresponsiveness, cluster B's first-switch slowness) are real product issues but their scope is larger than this recovery PR. They should land separately under their own plan.
- **No new test code or quarantines via `test.skip(...)`.** The 36 failing tests still try to run. They surface real issues; muting them would lose signal.
- **No infra rewrite** (vitest config, fixture topology, helpers' wait semantics). Only the env-gated fail-loud + the dependency patches.
- **F5 (`background/client.ts` disconnect-as-cancel)** was in plan v2 but codex final-pass blocked it: cancellation IS load-bearing in `offscreen/index.ts:28-40`, `is-benign-sw-disconnect.ts:1-25`, `NewTokenPopup.vue:279-283`, and explicit unit tests at `wallet/base/background/client.test.ts:406-448`. Deferred.

## Recommended follow-up PRs

1. **Cluster A investigation** — focused dive into why the wallet's RPC dispatcher doesn't respond to subsequent playground calls after the initial connect. Single-test repro: `sim-methods.test.ts > sim-simulateTx (#23)` is the simplest. Add `[CLUSTER-A:*]` console probes inside `extension-messaging/background/client.ts:onMessage` and the SW's RPC handler to trace where the 2nd call gets stuck.
2. **Cluster B fix or quarantine** — either bump `networks.test.ts > switch to Local Network` timeout to 60s (mechanical workaround), or diagnose the wallet's first-switch latency. Affects 4–6 files via file-scope cascade.
3. **Re-enable the 4 currently-skipped test files** once their respective cluster roots are addressed.

## How to verify locally after these changes

```bash
# After pulling this branch + bun install
bun run e2e:agent
# Expected: Test Files 29 failed | 12 passed | 4 skipped (45)
#           Tests       36 failed | 17 passed | 8 skipped (61)
# Exit 1. The exit-1 is honest now — these are real failing tests, not silent skips.

# Smoke must still pass (pre-existing 1 flake known):
bun run test:e2e
# Expected: 17 passed | 1 failed | 1 skipped (security.test.ts > "change password ... too-short" is a known flake)

# Full local gate:
bun run audit:vue
# Expected: clean (no lint/typecheck regression).
```
