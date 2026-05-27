# Opus 4.7 adversarial audit — fast-path-internal-views

Session: spawned via Agent tool (subagent_type=general-purpose, model=opus). Read-only.

---

# Verdict: **needs-rework**

The plan has a **critical concurrency BLOCKER** (both arms route through the same write lock — serialized, not parallel — and the `unpack` indexing math is wrong as written), plus several HIGH issues around fallback policy and origin-shape edge cases. The high-level design is sound, but the implementation sketch will not deliver the claimed parallelism and will silently mis-index returns.

---

## BLOCKER findings

### B1. The "parallelism" doesn't exist — both arms go through `withPxeWrite` and serialize on the same `ReadWriteGuard.write` lock.

The plan asserts (§3) "Both tx arms run in `Promise.all` parallel" and (§6, "PXE write-lock starvation reduction") that the fast arm "bypasses `pxe/service.ts:330-345`'s `ReadWriteGuard`."

This is **false** as written. Read `packages/aztec-runtime/src/pxe/service.ts:282-374` and the helper's `deps.pxe`:

- `deps.pxe` is a `PXEProxy` wrapping `PxeServiceClient` (the SW-side RPC). When the helper's slow arm calls `pxe.simulateTx(...)`, that ends up in `PxeService.simulateTx` (`service.ts:282`), which acquires `chainGuard.write()`.
- The plan's fast arm calls `pxe.getSyncedBlockHeader()` (line 372-374 — `withPxeRead`) and then `simulateViaNode(deps.node, ...)`. `deps.node` is the *raw* `AztecNode` returned by `services.networks.getNode(chainId)` (`get-view-simulation-deps.ts:38`) — yes, that bypasses the PXE lock. Fine so far.
- **But** the slow arm's `pxe.simulateTx` takes `chainGuard.write()`. Inside the `Promise.all`, the fast arm awaits `simulateViaNode` (no lock) and the slow arm sits behind the write lock waiting for any other in-flight write (e.g. a prove). `Promise.all` resolves when *both* settle — so total wall-clock is `max(fast, slow_after_lock)`, not `max(fast, slow_inline)`.

Worse: the plan claims (§6 "PXE write-lock starvation reduction → POSITIVE") that fast-path balance reads bypass the lock. But **only the pure-public-static batches actually skip the lock**. Mixed batches (PUBLIC+PRIVATE) still pay the full write-lock cost on the slow arm, *plus* now an extra `getSyncedBlockHeader` read-lock (line 372-374 takes `withPxeRead → barrier.read → chainGuard.read`) before either arm starts. For balance-projector with mixed token shapes, **the optimization may make the common case slower** by serializing an extra acquire-release cycle.

**Required fixes:**
- Stop claiming `getSyncedBlockHeader` is "free" — it goes through `withPxeRead`, which respects the chain-guard read-write semantics. If a `proveTx` is mid-flight (writer), every fast-arm prep blocks just as long as today's balance refresh.
- The pure-public-static optimization is the real win. Acknowledge that **mixed batches do NOT get the prove-time parallelism win** — they're still gated on the write lock for the slow arm.
- Either lift the slow arm out of `withPxeWrite` for view-only `simulateTx` (a meaningful refactor inside `PxeService.simulateTx`), or downgrade the §6 claim from "POSITIVE" to "NEUTRAL for mixed, POSITIVE for pure-static."

### B2. Per-tuple unpack math is wrong — `fastResults.flatMap(...)` is recomputed for every tuple AND uses the wrong index.

The plan's unpack at §4 file-by-file:

> `encoded[i] = fastResults.flatMap(r => r.publicOutput?.publicReturnValues ?? [])[fastSlotIndex]`

Two bugs:

1. **`fastSlotIndex` is not defined anywhere in the plan.** The current classification loop (lines 122-131) maintains `publicCallIndex` and `privateCallIndex` shared across slow+fast txCalls because today they're all in one `payload`. Once you partition, the fast arm has its own indexing (0..N-1, where N = `fastTxCalls.length`), and the slow arm has its own re-numbered `publicCallIndex` / `privateCallIndex`. The plan never says you must rewrite the classification loop to produce two separate index spaces. As written, you'd reuse the merged `j` from the existing code and index out-of-bounds on at least one arm.
2. **`flatMap` rebuilds the merged array N times** (once per fast tuple). Should be hoisted out of the loop.

Fix: explicitly partition first, then re-number `publicCallIndex/privateCallIndex` separately for each arm. This is the kind of off-by-one that would pass every unit test using single-shape batches (all-public-static or all-private) and **silently swap two tokens' balances** when both shapes mix in the same chunk. Balance-projector batches are inherently mixed — this is the production hot path.

---

## HIGH findings

### H1. The "silent full fallback" on generic errors is unsafe — `simulateViaNode` failure can mask real contract bugs.

Plan §3, "Failure modes" #4: any non-`SimulationError` throw → silent fallback to standard. But `simulateViaNode` throws plain `Error` for many situations that **are** real contract issues, not infra:
- A `PublicCallRequest` whose `publicFunctionCalldata` references a contract class the node doesn't have → upstream throws a plain `Error` from `generateSimulatedProvingResult` (`utils.ts:127-134`).
- Contract not registered on the node side → `Error`, not `SimulationError`.
- The `publicOutput.revertReason` path (`utils.ts:147`) re-throws the `revertReason` as-is. If `revertReason` is a generic `Error` (not all reverts wrap to `SimulationError`), the plan silently swallows it and replays through the slow path.

Result: user sees "balance loaded ok" on the slow arm even when the public-static read genuinely failed, hiding regressions. At minimum, log at WARN with the contract address + selector AND a counter so we can see fallback churn in the wild.

Also: the slow-arm fallback **re-runs the entire batch including the originally-fast calls**, doubling kernel cost when partial failures happen. The plan doesn't gate on this — a transient transport flake makes every balance refresh pay 2× cost until the node recovers.

### H2. Block-header anchor is not actually consistent between arms.

Plan §6 claims "Both arms anchor at the same `BlockHeader`." Read `PxeService.simulateTx` (`service.ts:282-337`): the slow arm calls `pxe.simulateTx(txRequest, opts)` with no `blockHeader` parameter. Internally, the underlying upstream PXE pulls its own current synced state at the moment of simulation. Between `getBlockHeaderAnchor` and the slow arm's actual execution, PXE may have advanced (background sync). The fast arm is pinned to the snapshot, the slow arm is at PXE's current tip. **Different state.**

For balance reads this is usually benign (balances don't decrease), but on PRIVATE calls that read a note set, the slow arm could see a note the fast arm's snapshot doesn't reflect (or vice-versa). The plan should either explicitly accept this race ("balance refresh may see a one-block skew between public and private values — same skew exists today between balance-projector chunks") or pass `blockHeader` to the slow arm too. The latter isn't possible with `pxe.simulateTx`'s current signature.

Downgrade the §6 risk table entry from "Document in helper docstring" to "Documented as a known behavioral race; pinned by a unit test that proves we DO NOT claim atomicity in the helper's JSDoc."

### H3. `getPrivateReturnValues().nested[1].nested` path is dead for the fast arm — verify partition preserves origin-equality for slow arm.

The helper's existing slow-arm unpack (lines 158-160) branches on `txRequest.origin.toString() === account.address.toString()`. After partition, if ALL public-static calls move to the fast arm and ONLY private calls remain on the slow arm, the slow arm's `txRequest.origin` semantics may change relative to what `account.buildTxExecutionRequest` historically produced.

Today, the `ExecutionPayload` always contains the full batch (mixed types). After partition, you'd build a payload with only the private/non-static calls. Does `account.buildTxExecutionRequest` produce the same `origin` for a payload with 3 private calls as it did for a payload with 3 private + 5 public-static calls? If the entrypoint hop differs (e.g. `DefaultAccountEntrypoint` vs a multicall path for size), `origin` flips and `nested[1].nested` becomes the wrong path.

The plan never addresses this. Add a unit test pinning the slow-arm origin-equality branch under the new partition.

### H4. `pxe.executeUtility` shares the same write lock as `simulateTx` — utility "parallelism" is also serialized.

Look at `service.ts:339-346`: `executeUtility` uses `withPxeWrite`. Today's "eagerly launched utility" doesn't actually run in parallel with `simulateTx` if both target the same `(profileId, chainId)`. Both serialize on `chainGuard.write()`. The "concurrency invariant preserved" claim (§3) was already false **before** this PR; the plan doesn't catch it. This means PR #56 already shipped a comment ("simulateTx and executeUtility run in parallel kernel-side", `batched-view-simulation.ts:14-15`) that doesn't match reality.

Not a new bug — but the plan's tests pin a contract the production code doesn't actually deliver. Suggest:
- Either downgrade `executeUtility` to `withPxeRead` (utility calls are stateless on PXE state per upstream — verify), or
- Update the helper's JSDoc to drop the "in parallel" claim and the plan's "concurrency invariant" assertion (§3, last paragraph).

---

## MEDIUM findings

### M1. `simulateViaNode` does NOT skip the kernel — it builds a synthetic kernel input and calls `node.simulatePublicCalls`.

Plan §6 ("Least-privilege bypass via kernel skip") claims fast path "bypasses kernel." Read `utils.ts:69-155`:
- Lines 103-110: builds `PrivateCircuitPublicInputs` with `anchorBlockHeader`, `txContext`, `publicCallRequests` — this **is** the kernel input shape.
- Line 127: wraps into `PrivateExecutionResult`.
- Lines 129-134: calls `generateSimulatedProvingResult` — this **runs the kernel** with a synthetic empty private trace.
- Line 145: `node.simulatePublicCalls(tx, skipFeeEnforcement)`.

What's actually skipped: the *real* private execution + the wallet entrypoint hop. The kernel itself **runs**, just on a synthetic input. So the "kernel-side authz isn't executed" claim is wrong. Adjust §6 wording.

This matters for the threat model: static-public functions can still emit log events that the kernel processes, can still trigger constraints. Don't claim "kernel bypass" when it's "private-execution + entrypoint bypass."

### M2. `MAX_ENQUEUED_CALLS_PER_CALL = 16` vs balance-projector `BATCH_SIZE = 12`.

Under limit. simulateViaNode auto-chunks if exceeded. No action needed; document in plan as "verified."

However: this means the 12-token chunk now produces **two** PXE round-trips minimum (fast arm node call + slow arm `simulateTx` call) where today there's one `simulateTx`. Net effect on RTT depends on whether the parallelism saves more than 1 RTT. For sandbox local (~1ms RTT) it's pure overhead. For testnet (~150ms RTT) it's a wash. Mention this in the plan or run a quick measurement.

### M3. Tests miss a critical case: chunk where ALL calls are public-static utility.

The 4-arm decision matrix (§5 test plan) doesn't include "all-public-static + zero-private + utility calls also queued" — the dominant balance-projector case when tokens use utility-based `balance_of_private`. With this shape, the slow arm has 0 calls (returns `Promise.resolve(null)`), the fast arm runs alone, and utility queue runs in parallel. Verify the unpack doesn't crash on zero-tx-call payload (the existing code at line 136 guards on `if (txCalls.length)`, but partition adds new branches).

### M4. Plan §6 misses one risk class — token contracts the user added that **lie about isStatic**.

Threat: user imports a malicious token from a dApp. The artifact's `isStatic: true` is honored by the helper, but the actual Noir code mutates state through a publicly-callable sidechannel. Routing this through `simulateViaNode` skips the entrypoint authz check.

Counter-argument: this is a view simulation, not a state-change tx. The "attack" returns wrong balance to the user — annoying but not financially material. Still worth a one-line acknowledgement in the threat-model section.

---

## NIT findings

### N1. Plan §4 NEW file `block-header-anchor.ts` — the test case wording is contradictory.

> "PXE throws + node throws → throws (caller treats as 'no anchor → fall back')"
>
> Then: "Actually: spec for the helper is 'returns undefined on no anchor available'. Throw from node should be caught too and return undefined. Pinned in test."

Pick one — currently both. The "return undefined" version matches `runFastPath`'s `if (!blockHeader) return null` guard better.

### N2. Plan claims `getContractName: async () => undefined` is "only used for error-message strings."

True. But the broader fast path passes it through `simulateViaNode → simulateBatchViaNode`, and `displayDebugLogs` calls `getContractName` once per debug log line. With a hardcoded undefined, the logs become anonymous `<contract>` strings. Not a bug, but if you ever need to debug a balance-projector regression, you've removed the only context. Consider plumbing a thin name resolver later.

### N3. The plan's §2 verified-facts row "`simulateViaNode` returns `TxSimulationResult[]` (one per batch)" is correct but underspecified.

Since we feed it max 12, you get exactly 1 result. The plan's unpack assumes this implicitly. Make the assumption explicit: "We never exceed 16, so `fastResults.length === 1` always; the `flatMap` is defensive." Otherwise a future bumper to BATCH_SIZE=20 silently breaks unpack ordering across inner-batch boundaries.

---

## ADOPT (concrete plan changes)

1. **Rewrite §4's unpack pseudocode** to make the dual indexing explicit (B2). Pin with a unit test using a 3-public-static + 2-private batch and assert per-token-id balance correctness.
2. **Add B1 as an explicit "Out of scope, known limitation"** in §1: "Mixed batches still serialize on the chain write lock for the slow arm. Net win is for pure-public-static batches (gas-balance public, all-utility-private tokens)."
3. **Strengthen H1 fallback policy**: log fast-arm fallbacks with `(chainId, contractAddress, selector)` and a `LogLevel.Warn`. Add a counter test pinning that we don't silently fall back on every call.
4. **H2: drop the §6 "Both arms anchor at the same `BlockHeader`" claim.** Replace with "Fast arm pins to a snapshot; slow arm advances with PXE sync. One-block skew is accepted as the existing inter-chunk behavior."
5. **H3: add unit test pinning origin-equality** on partitioned-private-only slow arm. If it breaks, that's a real bug.
6. **H4: drop the "concurrency invariant preserved" claim** OR refactor `executeUtility` to `withPxeRead`.
7. **M1: rewrite §6 "Least-privilege bypass via kernel skip"** to reflect what's actually skipped (private execution + entrypoint), not what isn't (kernel).
8. **M2: add expected-perf note**: pure-public-static fast batches save ~1 PXE write-lock acquire; mixed batches add 1 extra read-lock acquire. Net measurement TBD.
9. **M4: acknowledge** the malicious-artifact `isStatic` lie as a known low-severity threat (balance display only, no financial impact).
10. **§3 test #5**: also test "all-public-static + utility queued" (M3).
11. **N1**: pick one spec for double-throw in `getBlockHeaderAnchor`.

## REJECT (defend these)

- **Plan's choice to not refactor `runFastPath` to partition-style** (§7 q3) — correct. `runFastPath` is bound to upstream's prefix-based `buildMergedSimulationResult`; the helper has its own per-tuple unpack. Different contracts. Don't unify.
- **Plan's choice to keep `chainInfo` resolution per-fast-arm-invocation** (§7 q2) — correct for v1. `node.getNodeInfo()` is cached aggressively in most node clients; hoisting to deps is a profile-driven optimization, not a correctness one.
- **`SimulationError` re-throw, not silent fallback** (§3 mode #3) — defensible. A contract revert IS the real outcome; replaying through PXE wastes 3-5s for the same revert.
- **Block-header anchor extraction to a shared helper** — clean refactor, correctly reduces drift. Keep it.
- **Test design comparing fast-arm output to slow-arm output for parity** — gas-used WILL differ (fast arm gas tracking is different) but `publicReturnValues` for static functions must be byte-identical. Plan's framing ("compare Fr arrays") correctly scopes this. Defend against over-zealous reviewers who'd demand full result equality.
