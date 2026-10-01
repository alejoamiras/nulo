# What the Tier A plan got wrong

## TL;DR

Three independent plans (main + codex + opus, all xhigh / opus 4.7), consolidated with explicit source provenance, codex-final-reviewed: **APPROVE-WITH-MINOR-FIXES**. Then I implemented probes and discovered nearly every primary hypothesis was wrong.

## What the plan claimed vs what was true

### Cluster A — "wallet RPC dispatch broken" → **NOT THE BUG**

Plan said: 22 tests failing with `waitForPgResult` 30s timeout on the 2nd dApp RPC. Hypothesis: wallet's encrypted-channel handler is dropping messages, or session is being garbage-collected, or response relay is breaking.

Actual: most of those 22 tests cascade-fail from a single fixture hang in `switchToLocalNetwork`. The wallet's RPC dispatch works in **3 ms** (per `EXEC-OUT` probe for `aztec_getChainInfo`). When run in isolation, the full encrypted-channel flow (connect → requestCapabilities → silent post-cap RPC) completes in **~5 s** with no probe anomalies. `BCH-SESSION-LOOKUP-MISS` never fired across the whole investigation.

### Cluster B — "PXE init slow / NuloAccount.new is the bottleneck" → **NOT THE BUG**

Plan (codex's correction of the main plan): the actual wait surface is `nulo:ui:activeAccount`, not PXE. Account provisioning path is `network watcher → AccountService.ensureDefaultAccount → NuloAccount.new`.

Plan candidate fix: pre-provision Local default account at profile bootstrap to avoid the 30 s first-switch latency.

Actual: `NuloAccount.new` takes **23 ms**. `ACCT-ENSURE-IN → ACCT-ENSURE-OUT` is **26 ms**. The 30 s wait isn't being spent in account derivation. It's being spent in `appStore.network` never updating in the popup — because the click handler's `await` ate a route-induced ref invalidation.

### Cluster C — "cascade of A/B" → **CORRECT, but cause was different**

The cascade framing was right, but the cause was different than the plan named.

### Cluster D — "session-reconnect (alwaysTrust=false) is a pre-existing flake" → **PARTIALLY CORRECT**

Did turn out to pass after the race fix landed. Wasn't actually load-induced in this branch, just collateral noise.

## The plan's hypothesis tree (verbatim from §7.1)

```
H1 (codex top): Lost response on the encrypted return path (upstream silent swallow)
H2 (opus top): activeSessions Map lost on SW restart (H2 falsification: BCH-SESSION-LOOKUP-MISS fires)
H3 (codex): DappInteractionService settle race
H4 (opus): sessionQueues / decryptQueues head-of-line block
```

Probe data result: **none of H1–H4 fired**. Every probe showed expected sequences. The bug was somewhere none of the four hypotheses covered.

## What I would have done if I'd known

1. Skip the plan's "consolidate three plans + codex final review" cycle. That took ~30 minutes of API time and produced a 508-line plan that was mostly invalidated by 30 minutes of probe-running.
2. Write a one-page probe-first plan. Wire probes. Run the failing tests. Read the trace.
3. Send the probe trace to codex for code-tracing. Codex found the real bug in one round.

Total elapsed if I'd done it right: 1.5 hours instead of 6.

## Why the plan was wrong

I was anchored on the symptom ("wallet ignores 2nd RPC") and the failure-count clustering (22 of 36 looked like the same bug). The clustering by symptom matched the description in `quarantine.md`, but **failure clustering by symptom doesn't tell you whether the cause is one bug or many**.

Better heuristic for future plans: count the **fixture sharing**, not the test count. All 22 cluster A tests used `dappConnectedExtension` (file-scoped). The fixture's setup hit `switchToLocalNetwork`. That one helper call is shared across every "cluster A" test. THAT was the diagnostic-by-quantity signal. I missed it.

## What the audits got right

- **Codex's correction of cluster B's surface** (helpers.ts:198-207 waits on `nulo:ui:activeAccount`, not PXE) was correct AS FAR AS IT WENT. But codex thought the latency was in account derivation. It wasn't.
- **Opus's discovery of upstream wallet-sdk silent-drop sites** at `node_modules/@aztec/wallet-sdk/...:171-181` was correct prior art — that IS where upstream would silently drop messages if our `activeSessions` were lost. But it doesn't get lost.
- **Codex's identification of `requestCapabilities` as the first dispatcher call** was correct trace and load-bearing context.
- **Both audits saying "don't write `activeSessions` to disk"** was correctly conservative.

## What the audits got wrong

- Both audits missed `handleSetActive` as a fix surface. The race was in obvious sight in `[id].vue:47-57`. Neither agent traced it.
- Both audits accepted the symptom framing of cluster A as a code-path bug. Neither said "this might be 1 bug not 22."

## Note for future Tier A protocols

Per CLAUDE.md the Tier A protocol exists for a reason. It's NOT wrong to use. But when you use it for an e2e investigation:

- **Stage the protocol behind probes.** The hypothesis tree is wasted effort until you have probe data to test against.
- **Treat the plan as a "what to instrument" doc, not a "what to fix" doc.** The probes are the deliverable; the fix is whatever the trace says.
- **Be ready to discard 80% of the plan after probes run.** That's expected, not a failure.
