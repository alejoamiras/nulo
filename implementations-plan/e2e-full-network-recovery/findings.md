# Phase C — Probe Run Findings (preliminary)

## Setup

- Probes from commits `6787d6b` + `45e75f4` + `0a403ee` + `5fec8e0` + a few helper commits
- Storage-based capture (commit pending): every probe writes to `chrome.storage.local["nulo:probe:*"]` with a unique key; `dumpProbes(page)` reads all keys and writes one JSONL record per probe to `/var/folders/.../nulo-probes-<runId>.jsonl`
- Diagnostic test: `tests/e2e/network/_diag-cluster-a.test.ts` — drives the dApp flow manually so probes dump even when intermediate steps fail
- First trace dump: 2026-05-22T14:28:16Z, 49 probe records

## Surprise #1 — Cluster B's "crypto derivation is slow" hypothesis is FALSIFIED

From the trace:
```
{"b":"ACCT-ENSURE-IN","chainId":4138294185,...}      t=1779460093716
{"b":"ACCT-ENSURE-CREATE",...}                       t=1779460093717  (Δ=1ms)
{"b":"ACCOUNT-NEW-IN",...}                           t=1779460093719  (Δ=2ms)
{"b":"ACCOUNT-NEW-OUT","elapsedMs":21,...}           t=1779460093740  (Δ=21ms)
{"b":"ACCT-ENSURE-OUT","elapsedMs":24,...}           t=1779460093740
```

- `NuloAccount.new()` for a fresh chain account: **21ms**, not 30s.
- `ACCT-ENSURE-IN → ACCT-ENSURE-OUT`: **24ms** end-to-end.
- This **falsifies** codex's primary cluster B hypothesis (`packages/aztec-runtime/src/account/nulo-account.ts:53-65` as the dominant sink) and main plan's secondary hypothesis (PXE init slow).
- Whatever causes the 30s wait on first `switchToLocalNetwork`, it is **not** account derivation.

## Surprise #2 — Cluster A's bug isn't reproducing in isolation

The diagnostic test (manual: connect → requestCapabilities → getChainInfo) **PASSES** with full probe coverage:

```
SESSION-EST            (handshake successful)
BCH-DECRYPT-IN         hasSession=true
BCH-RECV               method=requestCapabilities, queueDepth=0
BCH-DECRYPT-OUT        elapsedMs=0
DI-CAP-OPEN            type=capabilities
DI-CAP-SETTLE          hasHandle=true
CAP-APPROVE
BCH-SEND-WIRE          hasSession=true, isError=false
BCH-SEND               status=ok

BCH-DECRYPT-IN         hasSession=true (2nd RPC arrives)
BCH-RECV               method=getChainInfo, queueDepth=1
BCH-DECRYPT-OUT        elapsedMs=1
EXEC-IN                kind=aztec_getChainInfo
EXEC-OUT               elapsedMs=3, status=ok
BCH-SEND-WIRE          hasSession=true
BCH-SEND               status=ok
```

- **`BCH-SESSION-LOOKUP-MISS` never fired.** H2 (activeSessions Map lost on SW restart) is **not** the bug for an isolated test.
- All boundaries fired in the right order. No silent drops.
- `EXEC-IN → EXEC-OUT` for `aztec_getChainInfo` was 3ms.

## What this means

The plan was built on the assumption that the bugs reproduce when the code paths are exercised. That's not what the data shows for cluster A — when exercised in isolation, the same path works.

Hypotheses now ranked differently:

### H-new-1 — Suite-level state corruption [TOP — needs full-suite confirmation]

Tests fail when the suite is run back-to-back; pass when run in isolation. Possible mechanisms:
- File-scope fixtures leak state into later test files (browser tabs, SW state, IDB, anvil chain state)
- Aztec sandbox accumulates state that slows later tests past the 30s wait
- `fileParallelism: false` + accumulating session/decrypt queue depth across files

This is consistent with `network-test-triage/full-suite-findings.md` (committed in open-source initial import) which noted "load-induced flakes" — but cluster A's 22 deterministically-failing files in our last baseline doesn't fit the "rotating flake" pattern that doc described.

### H-new-2 — File-scope `dappConnectedExtension` keeps a stale handshake across tests

`dappConnectedExtension` is **file-scoped**. If one test in a file mutates a session in a way that subsequent tests can't recover from (e.g., session-terminated after one test, but the next test still uses the cached `playgroundPage` reference), every subsequent dApp RPC fails.

This would explain why `cap-request-basic` (single test in its file) was failing originally — but the diagnostic test (different fixture, manual flow) passes.

### H-new-3 — Vitest worker pool retains a tab/SW with bad state across tests

`vitest.e2e.network.config.ts` has `fileParallelism: false`, but within a worker the same Chrome browser persists across files. State accumulation in the global setup's anvil/aztec/playground processes.

### What I no longer trust

- **The 36-failures baseline from PR #46's quarantine.md** may itself be a moving target. Each `e2e:agent` run draws different test outcomes depending on suite-level state. The "22 cluster A files" might be 5-8 deterministic + 14-17 cascade.

## Required next step

Re-run the FULL suite with probes on. Compare per-file:
- Which probes fired before the failure
- Whether `BCH-SESSION-LOOKUP-MISS` fires for any of the failures (would confirm H2 at suite-load)
- Whether the WATCH-* sequence fires for cluster B failures (would tell us if the network-switch event even reaches the popup)

Full-suite run started in the background: `/tmp/probe-full-*.log` + dump file under `/var/folders/.../nulo-probes-full-<ts>.jsonl`.

## Plan adjustment needed (post full-suite results)

The current plan's hypothesis tree (§7.1 of `plan.md`) assumes the bugs reproduce per-test. The diagnostic shows that's not true in isolation. We need to:

1. Get the full-suite probe trace (running now)
2. Identify which tests / files fail deterministically vs which were flakes
3. For the deterministic failures, examine the probe sequence at the failure point
4. Revise the fix candidates accordingly

The current §8 cluster B "pre-provision Local default account at boot" is **still the right intervention** — but the *justification* changes. Not "to avoid the 30s NuloAccount.new" (which is 21ms) but "to avoid the popup network-watcher having to run the full chain-switch flow under suite-load when something around it is slow/contended."

## Open: Why is the bug intermittent?

The previous baseline had `connect-handshake` failing at 35s — but our diagnostic with the same handshake passes. Either:
- The probes themselves changed timing enough to mask the bug (probe overhead would be load-bearing — bad)
- The previous baseline run had an unfavorable seed of suite state
- Something else we don't see yet

The full-suite probe run will tell us which.

---

## 2nd update — pool/isolate fix + on-failure dump

User noticed the network vitest config was missing the `pool: "forks"` + `isolate: true` that smoke config has carried since the open-source initial import. Comment in `vitest.e2e.config.ts:29-32` references the vitest 4 migration of `poolOptions.forks.{singleFork,isolate}` to the new schema; smoke was migrated, network was forgotten.

**Applied fix**: commit `a104133` — `pool: "forks"` + `isolate: true` in `vitest.e2e.network.config.ts`. This gives each test file its own forked worker process so puppeteer browser + chrome.storage state from earlier files cannot leak.

**Result**: NOT sufficient on its own. cap-request-basic.test.ts still fails when run in a multi-file batch (passes when run alone).

### The decisive probe trace (commit `a444ee2`)

Added on-failure `dumpProbes` to `switchToNetwork`. 3-file batch (`connect-dapp` + `cap-request-basic` + `meta-getChainInfo`) triggered 2 dumps. Both dumps end identically:

```
SW-LIFECYCLE event=boot                     t=63138
WATCH-IN chainId=4138294185                 t=64789  (popup mount, network watcher fires)
WATCH-AFTER-GET accountCount=0
ACCT-ENSURE-IN type=0
WATCH-ENSURE
ACCT-ENSURE-CREATE
ACCOUNT-NEW-IN
ACCOUNT-NEW-OUT elapsedMs=23                ← derivation 23ms
ACCT-ENSURE-OUT elapsedMs=26
ACCT-ENSURE-HIT existingCount=1
ACCT-ENSURE-OUT elapsedMs=27
WATCH-IN chainId=4138294185                 t=65459  (watcher re-fires after account create)
ACCT-ENSURE-IN
WATCH-AFTER-GET accountCount=1
ACCT-ENSURE-HIT existingCount=1
ACCT-ENSURE-OUT elapsedMs=1
WATCH-OUT elapsedMs=84                      t=65543  (initial watcher done)

← 30 SECONDS OF SILENCE — NO MORE PROBES FIRE ←

(Test gives up at the 30s waitForFunction for `[data-testid="network-button"]` text === "Local Network")
```

### What this trace tells us

1. **The popup mount and initial network watcher work correctly** — accountCount=0 detected, ensureDefaultAccount fires, NuloAccount.new takes 23ms, watcher exits in 84ms total.
2. **The popup is on chainId 4138294185** from the moment the watcher first fires. Same chainId as in the passing diagnostic test. This appears to be Local Network's chainId (NOT 0 as the fixture comment suggests).
3. **When the test clicks "Set as active" on Local Network, NOTHING ELSE FIRES** in the wallet-side probes. The popup's `appStore.network` watcher does NOT re-fire. No new WATCH-IN. No further account churn.
4. **The bug is in the click-to-watch-fire path**, not in the network-watcher logic itself (which we confirmed works for the initial popup mount).

### Revised hypothesis ranking

#### H-new-4 (PRIMARY) — Popup's `appStore.network` doesn't update when "Set as active" is clicked, in suite-load conditions

The "Set as active" click should:
- (a) Call `NetworkServiceClient.setActiveNetwork(networkId)` → SW updates active network in storage → SW emits `onActiveNetworkChanged` event
- (b) Popup's `NetworkServiceClient` instance receives the event → updates `appStore.network` → `app.vue`'s watch re-fires

Either (a) or (b) is not happening in suite-load conditions. The lack of a 2nd `WATCH-IN` probe firing after the click confirms `appStore.network` doesn't update.

But: the same flow works in isolation. So the breakdown is suite-state-induced.

#### H-new-5 — No-op switch is being treated as a hang

If the popup is ALREADY on Local Network (per the chainId 4138294185 probe), the click is a no-op. `appStore.network` doesn't change → watcher doesn't fire → header is already "Local Network" → test wait should pass instantly.

But test fails at 30s, so the header is NOT showing "Local Network" at test-wait time. The popup mount probe shows chainId 4138294185, but the chip text might be showing something else.

### Why the previous baseline was misleading

When we ran `bun run e2e:agent` in baseline #4 (the 36-failure log), most failures were file-fixture cascades. Each "failing test" was actually `dappConnectedExtension` fixture hanging at the **switch** — the test itself never ran. So the failures were ALL the same cluster B bug, surfacing through dApp tests that share the fixture.

This means our cluster classification was wrong:
- "Cluster A — 22 dApp tests failing with `waitForPgResult` 30s timeout" → actually 22 dApp tests cascading off the cluster B fixture hang
- The real cluster A surface (RPC dispatch bug, session loss, etc.) might be **much smaller** than 22 files, possibly zero

### Updated cluster picture

| Cluster | What we thought | What we now know |
|---|---|---|
| A (22 files) | Wallet-side RPC dispatch broken | Likely 0 — cascade victims of the fixture hang |
| B (4+ files) | First switchToLocalNetwork slow (PXE init) | Confirmed: switchToLocalNetwork in suite-load hangs at 30s — but the wallet-side switch code path WORKS (probes prove it). Bug is between click and popup state update. |
| C (1 file) | Cascade victim of A/B | Confirmed cascade of B |
| D (1 test) | Pre-existing flake | Unchanged |

### What's needed next

- Find why `appStore.network` doesn't reflect the SW's active-network change under suite-load
- Possible surfaces: NetworkServiceClient event subscription state, chrome.runtime.Port connection lifecycle across fixture-fork boundaries, popup-side reactive ordering
- The bug is real and product-level but **scoped much smaller than the plan assumed** — likely 1 popup-eventing bug that masquerades as 22+ "test failures"

### Plan revision required

The consolidated plan's cluster A fix branches (SW keepalive, encrypted-channel session, response-relay drop) are likely all wrong — there's no encrypted-channel bug to fix. The cluster B fix (account pre-provision) is also misdirected — account provisioning works in 23ms.

The real fix is whatever makes the popup's `appStore.network` update reliably after a "Set as active" click in suite-load conditions. This needs its own diagnostic phase.
