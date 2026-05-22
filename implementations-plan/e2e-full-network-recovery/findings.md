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
