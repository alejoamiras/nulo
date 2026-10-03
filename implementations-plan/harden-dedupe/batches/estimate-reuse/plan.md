---
plan: harden-dedupe / estimate-reuse (arc 11 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/11-estimate-reuse, stacked on hd/09-network-endpoints
---

# estimate-reuse: one snapshot vocabulary for both reuse caches, one tx-record shape, and B-08

Findings Q-05 (c), the reuse half of Q-05 (b), Q-10 and Q-04 (a)'s four execution sites, from `audit/quality/2026-09-30-dedup-high/`, plus bug B-08 from `audit/bugs/2026-09-30-ext-high/`.

- The two estimate-reuse caches capture and re-check the same facts (the built fee, the primary endpoint, the priority multiplier). Their producers and ladders spell each fact by hand, and `fingerprintBaseFee` and the TTL live in the transfer module.
- Every sent transaction is recorded through a 12-argument positional `addTransaction`.
- The four execution sites still find the primary endpoint by hand.

This batch states each fact once. Each ladder keeps its own step order, reject reasons and error policy, and no `await` is added anywhere. The one behaviour change is B-08, in its own commit: a dApp confirm whose fee read fails now rebuilds instead of failing the send.

Paths are under `apps/extension/src/wallet/services/` unless they start with `packages/`, `apps/` or `implementations-plan/`.

## Outcome & Quality Bar

- **For whom:** the next person who adds a snapshot fact, changes the fee basis, or adds a field to the activity record. Today each of those means synchronized edits to two producers, two ladders, or three record producers plus four positional projections. A mismatch fails silently: reuse always misses as "base fee drift", or two same-typed strings swap in a persisted row.
- **Excellent:**
  - The shared snapshot facts are declared once, with one producer helper and one endpoint predicate that both caches use.
  - Each ladder's ordered collaborator calls, reject reasons and throws are pinned by literal values, including the unknown-priority drift. The pins must keep holding through the B-08 fix.
  - `addTransaction` takes one named object, and every producer's record is pinned field by field, together with the persisted row's key order.
  - B-08 lands red, then green, and its effect gets one line in the PR body.
- **Good enough:** the live-handle re-resolution, the `NO_WAIT` tail and the NO_FROM recorder stay duplicated, because each one would add an `await` (§ Deferred).

## Architecture & Implementation

Read on `hd/09-network-endpoints` at `aec0fae0`, which contains `harden-dedupe` at `2adab99d`. Line numbers differ from recon's in `dapp-send-executor.ts` (producer `:446-519`, recorder `:524-550`) and `execution/service.ts` (the priority ternary is `:1089`).

### Sites

**Snapshot producers (Q-05 (c), Q-04 (a))**

- **PT:** `execution/transfer-executor.ts:373-420` (`estimateFee`):
  - primary lookup `:377`;
  - built fee `:383-387`;
  - `requireActiveProfile` `:388`;
  - pending hashes `:389`;
  - stash literal `:391-412`.
- **PO:** `execution/dapp-send-executor.ts:446-519` (`stashOperationEstimate`):
  - primary lookup `:469`, on `built.network`;
  - `getActiveProfile` `:471`;
  - FPC read `:475`;
  - built fee `:484`;
  - stash literal `:486-512`, which reads pending hashes at `:502`, after the FPC read.

**Ladders (Q-05 (c), the reuse half of (b), Q-04 (a))**

- **VT:** `execution/transfer-estimate-reuse.ts:151-223`:
  - primary lookup `:181`;
  - fee step `:195-211`, inside a `try` that re-wraps `GasFees`.
- **VO:** `execution/operation-estimate-reuse.ts:124-166`:
  - primary lookup `:141`;
  - fee step `:159-164`, outside any `try`.
- `fingerprintBaseFee` sits at `transfer-estimate-reuse.ts:44` and `ESTIMATE_REUSE_TTL_MS` at `:39`. Both are imported by `operation-estimate-reuse.ts:39`, `dapp-send-executor.ts:56`, `transfer-executor.ts:44` and `preview-snapshots.ts:14`.

**Tx records (Q-10)**

- The declaration, `transaction/service.ts:155-221`.
- Producers:
  - **RT:** `execution/transfer-executor.ts:181-214`;
  - **RS:** `sentTxRecorder`, `execution/dapp-send-executor.ts:524-550`, used at `:621` and `:739`;
  - **RN:** the NO_FROM recorder, `:917-931`.
- Positional projections: `SentTx` at `dapp-send-executor.ts:124-138`.
- Forwarding adapters: `execution/service.ts:352` and `:421`. Each is a rest-spread, so neither changes.
- The other Q-10 duplicates:
  - the `getCalls` thunks at `dapp-send-executor.ts:676-682` and `:873-879`;
  - `wantOffchainOutput` at `:735-738` and `:913-916`;
  - the signal-form cancel checks at `:294-296` and `:368-370`, `transfer-executor.ts:350-352`, and `discovery-aware-estimator.ts:128`.

### Guard set per site (identical after the change, except VO's B-08 exit)

| site | guards, in order |
|---|---|
| PT | Eligible only for the `fj` and `fpc` kinds. Everything sits inside a best-effort `try`, where any throw gives no `estimateId` and the debug line `estimateTransferFee: cache write skipped`. The primary endpoint is the row `primaryEndpointId` names, with no fallback; when none matches, nothing is stashed. The profile comes from `requireActiveProfile(…, "Wallet locked")`, never the fence; a throw skips the stash. Pending hashes are read **after** the profile read. The fee fingerprint comes from the built request's `maxFeesPerGas`, never a refetch. The estimate's last cancel checkpoint (`:364`) runs before any of this. |
| PO | Eligible only for `aztec_sendTx` outside `default_entrypoint`, with no `embeddedFeePayment`, no dApp `maxFeesPerGas`, and the `fj` or `fpc` kind. A null fingerprint means no stash. The primary endpoint follows the same rule as PT. A missing active profile means no stash, with no log. An `fpc` entry reads the FPC row. `chainIdentity` is the builder's asserted pair. Pending hashes are read **after** the FPC read, and the fee comes from the built request. Everything sits inside a best-effort `try`. |
| VT | Consume first (single-shot), then: TTL; the seven-field input match; profile ≠ fence throws `SessionEndedError`; the network by `inputs.networkId`; no primary rejects `no primary endpoint`; a moved id or URL rejects `primary endpoint changed`; `getNode`, outside the `try`. Inside the `try`: the read, the multiplier, the re-wrap, `.mul`, then the compare. A mismatch rejects `base fee changed`; any throw rejects `base fee fetch failed: <message>`. Last, the pending set. Every reason carries the `estimateId`. |
| VO | Consume first, then: TTL (`entry expired`); the fingerprint, null or different; profile throws `SessionEndedError`; the network by `entry.networkId`; no primary, or a moved one, rejects `primary endpoint changed`; the pending set; the chain identity (a throw or mismatch rejects); FPC identity, for `fpc` entries; `getNode`, which propagates a throw; the multiplier; the read and `.mul`, either of which propagates a throw; a mismatch rejects `base fee drift`. |
| executor binding | Unchanged. `assertEstimateBinding` runs, then `takeStandardPreview`, then `tryConsume` (`dapp-send-executor.ts:700-717`). A reuse id exists only for a `found` preview. The reuse arm re-resolves its live handles, then `assertFence`, then `assertLive`. The rebuilt arm is held to the preview by `assertWithinPreview` (`:718`). |
| RT / RS / RN | RT records the transfer-only call shape, `networkId: network.id`, and the endpoint URL captured before the prove. RS computes the account string and the endpoint URL at record time, takes `networkId` from `op.networkId`, awaits `addTransaction`, then writes the pending authwits only when there are some, scoped to `fence.profileId`. RN uses nonce `Fr.ZERO` and `EXTERNAL`, writes no authwits, and returns `addTransaction`'s promise directly. |
| `addTransaction` | Under the tx lock: when a fence is present, `assertCurrent(profileId, epoch)`, then the owner lookup by the captured profile (`stale execution owner — account no longer exists`); then the duplicate hash (`duplicated hash`); the `Tx` literal in today's key order; `set`, then `emit`, then `pending.set`. |

### What changes

1. **`execution/estimate-reuse-shared.ts`** gains these; each runtime helper is synchronous and pure:
   - `ESTIMATE_REUSE_TTL_MS` and `fingerprintBaseFee`, moved verbatim with their byte-stability comment;
   - `type ReuseEntryBase`, the ten fields both entry types declare today: `profileId`, `baseFeeFingerprint`, `primaryEndpointId`, `primaryEndpointUrl`, `pendingHashes`, `txRequest`, `initializesAccount`, `nonce`, `feePaymentMethod` and `builtAt`. Each keeps one copy of its comment. `TransferEstimateReuseEntry` and `OperationEstimateReuseEntry` become `ReuseEntryBase & { …their own fields }`;
   - `builtReuseSnapshot(primary, txRequest)`, which returns `{ baseFeeFingerprint, primaryEndpointId, primaryEndpointUrl }` from the built request's `maxFeesPerGas` and the primary row. Its parameters are named `primary` and `txRequest`, as at PT;
   - `primaryEndpointMoved(primary: NetworkEndpoint | undefined, snap)`, which is `!primary || primary.id !== snap.primaryEndpointId || primary.rpcUrl !== snap.primaryEndpointUrl`;
   - `reuseFeeMultiplier(priority)`, which is `priority ? PRIORITY_MULTIPLIERS[priority] : DEFAULT_FEE_MULTIPLIER`. The lookup is indexed exactly as today, so an unknown or prototype-named priority yields what it yields today.
   - The header's `Q-10:` tag goes.
2. **The producers.**
   - PT: `findPrimaryEndpoint(network)`. Then `...builtReuseSnapshot(primary, txRequest)` in the stash literal, where the three keys sit today, after the profile and pending reads.
   - PO: `findPrimaryEndpoint(built.network)`, and the same spread in its literal at the same keys. Pending hashes stay in the literal, after the FPC read.
   - So no pending, profile or FPC read moves. Only PT's fee read moves later across its profile `await`, on `txRequest`, a fresh build that nothing else holds.
3. **The ladders.**
   - **VT:** `findPrimaryEndpoint(network)`. Its separate `!primary` reject stays, then `if (primaryEndpointMoved(primary, entry))`. Inside the existing `try`, at the ternary's position after the read, `const multiplier = reuseFeeMultiplier(inputs.feeSettings.priorityLevel)`. The re-wrap and its comment stay.
   - **VO:** `findPrimaryEndpoint(network)`; `if (primaryEndpointMoved(primary, entry))`; and the multiplier ternary becomes `reuseFeeMultiplier(entry.feeSettings.priorityLevel)` at the same position, after `getNode`. The composition line stays byte-identical until Phase 3.
   - Each argument expression stays at its call site. The ternary read `priorityLevel` twice; the helper reads it once. Both read plain data, a port-deserialized request or the stashed entry, with no getters.
4. **`transaction/service.ts`** exports `type AddTransactionInput`, the twelve fields with today's names and optionality; the `networkId` doc comment moves onto its field.
   - `addTransaction(input: AddTransactionInput)` destructures `input` on its first line, so every value is fixed at the call, as positional arguments are. The rest of the body, including `return await this.lock.withLock(…)` and the `Tx` literal, is byte-identical.
   - RT, RS and RN pass object literals whose keys follow today's positional order, so the arguments evaluate in the same order.
   - `SentTx` types its fields as `AddTransactionInput["origin" | "calls" | "feePaymentMethod" | "networkId"]`.
5. **`execution/rpc-cancel.ts`** gains `throwIfAborted(signal)`: `if (signal?.aborted) throw new JobCancelledSentinel("")`.
   - The three closures and the inline check at `discovery-aware-estimator.ts:128` call it at the same checkpoints, and the closures are deleted.
   - The controller-form checks (`transfer-executor.ts:131-133`, `dapp-send-executor.ts:254-256`) differ (journal id, controller) and stay.
6. **`dapp-send-executor.ts`** gains two module-level synchronous functions:
   - `primaryMethodCalls(op)` replaces both `getCalls` bodies; its parameter is `op`, and the comment appears once;
   - `offchainOutputOf(provedTx)` is passed as `wantOffchainOutput` at both sites; its parameter is `provedTx`.
7. **Comments.** In the files this arc edits, provenance tags are removed and the substance kept:
   - "plan decision #16";
   - "Codex audit BLOCKING #1";
   - "(codex audit SHOULD-FIX #3)";
   - "(codex audit SHOULD-FIX #2 partial)";
   - "(plan architecture §2)" and "audit-pinned".
   The operation header's `assertChainIdentity` becomes the real dependency name, `getLiveChainIdentity`.

### B-08 (Phase 3, its own commits)

VO's fee step becomes:

```ts
const node = await this.deps.getNode(network.chainId)
const multiplier = reuseFeeMultiplier(entry.feeSettings.priorityLevel)
let current: GasFees
try {
	current = (await predictedWorstMinFees(node)).mul(multiplier)
} catch (error) {
	return this.feeReadFailed(error, multiplier)
}
if (fingerprintBaseFee(current) !== entry.baseFeeFingerprint) return this.reject("base fee drift")
```

The new method is synchronous:

```ts
/** A failed fee read rebuilds; an unknown priority keeps the throw it has always had. */
private feeReadFailed(error: unknown, multiplier: unknown): undefined {
	if (typeof multiplier !== "number") throw error
	return this.reject("base fee fetch failed")
}
```

- **What changes.** With a known multiplier, two outcomes that used to escape `tryConsume` now reject, so the caller rebuilds: a rejected fee read (`predictedWorstMinFees` rethrows transient errors such as "block not found", `packages/aztec-runtime/src/fee-juice.ts:26-32`), and a null-like min-fee reply. The JSON-RPC client returns `undefined` for those (lessons, Aztec), and `.mul` on `undefined` throws `TypeError`. The debug line names a fixed category, never the node's message (lessons, Extension runtime).
- **What stays.**
  - `getNode` stays outside the `try`, as in the transfer twin.
  - Every non-numeric multiplier (an unknown string, or a prototype key such as `constructor`, whose lookup yields a function) rethrows the same error object in the same continuation. So the unknown-priority drift is exact even when the read also fails.
  - The composition expression stays inline and unchanged. A null reply under an unknown priority therefore still throws today's engine text.
- **Rejected alternative.** A `try` around the read alone would change the thrown text on a null reply. Bun reads `evaluating 'basis.mul'` instead of `'(await predictedWorstMinFees(node)).mul'`; V8 prints the same text for both. It would also make an unknown priority with a failed read rebuild.
- **PR-body line:** "Behaviour change (B-08): when a dApp `aztec_sendTx` is confirmed with a still-valid estimate and the node's min-fee read fails or answers null, the wallet now rebuilds the transaction instead of failing the send. An unknown priority level fails the send as before."

### What stays

Each ladder's step order, its reasons, and `SessionEndedError` before any network read. VT's re-wrap and its message-bearing reason. `fingerprintFeeSettings`, which only the transfer side uses. `execution/service.ts`, unchanged, including `:1089`: its else-arm is `undefined`, so each strategy applies its own default, and it is not the ladders' ternary. The reuse arms' live-handle sequences, both `NO_WAIT` tails, RN's inline recorder, the strategies and `fee/*` (arc 10's), and every `await`.

### Alternatives not taken

- *One shared ladder with a step strategy.* Step orders, reasons and throw policies all differ, and each is pinned. A strategy object would hide that, not remove it.
- *`pendingHashes` inside `builtReuseSnapshot`.* PT reads them after a profile `await` and PO after an FPC `await`; hoisting the read would change what a pending tx racing that `await` does.
- *Re-exporting the moved names from `transfer-estimate-reuse.ts`.* Five test files would stay untouched, but at the cost of a permanent alias; the import lines change instead.

### Engine text and await shape

- **No added `await` or microtask.** Every new helper is synchronous. B-08's `catch` calls a synchronous method, so a rethrow settles `tryConsume` in the continuation where today's throw did. `addTransaction` keeps its `return await`.
- **Moved expressions and who can reach them:**
  - `network.endpoints.find`: three sites name `network`, so the text is identical (arc 9 probed this shape on three engines). PO named `built.network`, but its read sits inside the best-effort `try`, which logs at debug, and the builder's row is codec-validated (`network/spec.ts:73`).
  - `txRequest.txContext.gasSettings.maxFeesPerGas`: PT names `txRequest`; PO's `built.txRequest` sits inside the same `try`, on a request the builder made.
  - `primary.id` / `primary.rpcUrl`: `primary` is past its guard. `snap` is the consumed entry, which is never nullish.
  - The priority read stays at the call site.
  - `addTransaction`'s values are evaluated in the producers' literals.
  - `throwIfAborted` uses optional chaining, so it raises no `TypeError`.
  - `primaryMethodCalls` and `offchainOutputOf` keep the parameter names `op` and `provedTx`.

### Complexity

- `OperationEstimateReuse.tryConsume` scores exactly 15 today: a probe adding one `if` reads 16 on Biome 2.5.13.
- B-08 adds a `catch` (+1); the multiplier helper (−1) and the endpoint predicate (−1) bring it to 14. A probe of the fix without the predicate read 15.
- `TransferEstimateReuse.tryConsume` drops by 2. No touched function is in `scripts/complexity-baseline/manifest.json`, and no new acceptance is allowed.

### Coupling with neighbouring arcs

- **network-endpoints (arc 9, #771, the base).** `findPrimaryEndpoint` (`network/spec.ts:112`) is adopted as it is. If arc 9 changes in review, this arc restacks with `git rebase --onto`.
- **fee-strategies (arc 10, in review).** Its diff touches `fee/*` and `FeeSettingsCard`; this arc touches neither, and only imports `DEFAULT_FEE_MULTIPLIER`.
  - Arc 10's deferrals (`withEstimateTask`, `committedMaxFees`, the probe fold and `finishFpcEstimate`) stay deferred here. Both ladders' compositions stay inline for the same engine-text reason.
  - Its Drift 1 (unknown priority) is preserved and pinned here, as it asks.
- **row-lifecycle (arc 12, in review).** It edits `transaction/service.ts`'s import line and `restore` (`:530-536`); this arc edits `addTransaction` (`:155-221`). The rebase is mechanical.
- **Every other open arc** (15, 15b, 17, 18, 19, 20–24): no shared file, checked against each branch's diff.

## Security & Adversarial Considerations

- **The surface.**
  - The reuse caches hold signed `TxExecutionRequest`s for up to 120 s. A popup transfer reaches VT.
  - A dApp's `aztec_sendTx` reaches PO at estimate time and VO at confirm. The dApp controls the operation (and so its fingerprint), its fee options and the `estimateId`/`previewId` pair the popup echoes. A forged pairing is refused before the cache is touched (`dapp-send-executor.ts:402-405`, `:700`).
  - The endpoint controls the min-fee and chain-identity replies.
- **What a consolidation could widen,** each pinned:
  - a lookup falling back to `endpoints[0]`, which would sign against an endpoint the user never made primary;
  - a merged ladder losing VO's chain-pair or FPC step;
  - a profile check that rebuilds instead of throwing;
  - a snapshot read hoisted over an `await`;
  - a multiplier that absorbs the unknown priority.
  The post-change guard set is the table above, per site.
- **B-08 never makes a hit.** It turns a terminal failure into a miss. A miss runs the fresh path with all its guards: the builder's live-chain assert, discovery, and `assertWithinPreview` against the popup's snapshot. A rebuilt send is still held to what the user saw. `SessionEndedError` still precedes the fee step. `getNode`, which requires an active profile, stays outside the `catch`, so a locked wallet fails as today. The catch's only inputs are the fee read and `.mul` on a numeric multiplier.
- **Persisted rows.** `addTransaction` writes `Tx` rows through `EntityStorage`. The literal keeps its key order, so the persisted bytes are the same, and Phase 1 pins them. The recorded `submittedEndpointUrl` stays the submitting network's, never the active profile's: the cross-profile receipt-routing guard (`transaction/service.ts:191-198`), pinned per producer. The D13 fence order inside the lock is unchanged.
- **Logging.** One new debug line with a fixed category. Existing lines are unchanged, including VT's message-bearing reason (§ Drift).
- **npm, layering, freeze:** no published entry is touched. `estimate-reuse-shared.ts` imports `@nulo/wallet-bridge`, `./fee/fee-strategy` and `network/spec`, which the ladders already import. The account freeze is untouched.

## Assumptions

**Facts** (read 2026-10-03 at `aec0fae0`):

1. The sites and lines are as listed above. `findPrimaryEndpoint` is `network.endpoints.find((e) => e.id === network.primaryEndpointId)` (`network/spec.ts:112-114`).
2. `EntityStorage.get` decodes a fresh object on every read (`packages/wallet-core/src/storage/entity_storage.ts:182-186`), so the network rows the producers read are local.
3. `GasFees.mul` sends a non-integer scalar to `bigintMulCeil`, whose `BigInt(Math.round(scalar * 1e12))` throws `RangeError` for `undefined` or a function. Bun says "Not an integer"; Node says "The number NaN cannot be converted to a BigInt because it is not an integer" (`@aztec-labs/stdlib/dest/gas/gas_fees.js:10-14`, `:43-54`; probed).
4. `PRIORITY_MULTIPLIERS` is `{ normal: 2, fast: 3, urgent: 5 }` (`packages/wallet-bridge/src/fee.ts:25-29`). `DEFAULT_FEE_MULTIPLIER` is 2 unless `VITE_NULO_FEE_MULTIPLIER` sets it (`fee/fee-strategy.ts:65-66`), so the tests mock it to a distinct value.
5. `ExecutionCoordinator.proveAndSend` awaits `recordTransaction` and ignores its value (`execution/execution-coordinator.ts:135`, `:355`). `addTransaction` is not an RPC method (`transaction/service.ts:59`).
6. In production `getLiveChainIdentity` calls `networkService.getNode` inside VO's chain `try`, so VO's later `getNode` is normally a cache hit (`execution/service.ts:293-298`, `network/service.ts:770-785`).
7. Existing pins cover the ladders' orders and most exits, the transfer and dApp record positions 2–7, the estimate cancel checkpoints and the preview binding. Nothing pins: the reason texts, the dangling-primary rows, the producers' read order across their `await`s, `profileId`'s source, the default multiplier as distinct from `normal`, the unknown-priority outcome, the full record per producer, or the persisted key order.

**Inferences:**

- The production bundle may rename identifiers, so engine text is pinned at the source level, as the program does. Firefox (SpiderMonkey) is probed at build time through the Puppeteer-installed Firefox; this box has no system Firefox.

**Asks** (for the panel):

1. **Does B-08 include a null-like min-fee reply?** Recommended yes, the design above: it is a failed fee read, and the rebuild re-reads. The alternative is the read-only `try`, rejected above.
2. **The new reject line's wording.** Recommended: the fixed category `base fee fetch failed`, against VT's `: <message>`. The lesson rules out logging a node message.
3. **Scope.** B-08's audit entry also names VT's `getNetwork`/`getNode` and VO's `getNode` as "same shape, lower likelihood". Recommended: out of scope. They depend on the session, a rebuild would hit the same failure, and the program scopes B-08 to the fee read.

## Phases

### Phase 1: pin today's behaviour (test only)

Expected values are literals. Every fake records its calls into one ordered `calls` array. The ladder test files mock `./fee/fee-strategy` so that `DEFAULT_FEE_MULTIPLIER` is 7.

- **Ladders** (`operation-estimate-reuse.test.ts`, `transfer-estimate-reuse.test.ts`):
  - The ordered collaborator calls on a hit, and on each exit. VO: `getNetwork, getPendingForAccount, getLiveChainIdentity, getFpcInfo, getNode, predictedWorstMinFees`. VT: `getNetwork, getNode, predictedWorstMinFees, getPendingForAccount`. Each exit's exact debug text, and the entry consumed afterwards.
  - The primary endpoint as the second row: accepted. A dangling `primaryEndpointId`: VT rejects `no primary endpoint`, VO `primary endpoint changed`.
  - Priority × product, over basis `(2,3)`: `undefined` and `""` give `14:21`; `normal` `4:6`; `fast` `6:9`; `urgent` `10:15`.
  - **The drift (stays green through Phase 3):**
    - VO with priority `"bogus"` and the read resolving: rejects `RangeError`, with the message of the reference `new GasFees(2n, 3n).mul(undefined)`.
    - VO with `"bogus"` and the read rejecting `E`: rejects with `E` itself (`toBe`).
    - VO with `"constructor"`: rejects with the reference error.
    - VO with `"bogus"` and a null reply: rejects `TypeError`.
    - VT with `"bogus"`: a miss whose reason is `base fee fetch failed: ` plus the reference message.
  - VO with `getNode` rejecting: rejects with that error, and no fee read runs.
- **Producers** (`transfer-executor.test.ts`, `dapp-send-executor.test.ts`), with built `maxFeesPerGas` `(7n, 11n)` and a node whose prediction differs:
  - The full stashed entry, by `toStrictEqual`: `baseFeeFingerprint` `"7:11"`; primary `e2` of `[e1, e2]`; `builtAt` from fake timers.
  - A dangling primary or an absent array: no `estimateId`, and the fee result still returns.
  - A pending tx inserted during the profile read (PT) or the FPC read (PO) is in the snapshot.
  - `profileId` is the active profile at stash time, not the fence's.
  - PT locked: the skip line carries `Error("Wallet locked")`. PO with no profile: no stash and no log.
- **Records:**
  - Each executor test file gains one local accessor, `recordedTx(deps)`, which projects `addTransaction`'s call into the twelve named fields; existing `txArgs[n]` reads move onto it.
  - Each producer gets one row pinning all twelve fields, with distinct literals: RT fresh, RT reuse, RS through `send_transaction`, RS standard fresh, RS reuse hit, RN.
  - RS awaits `addTransaction` before `recordPendingAuthwits` starts. RN's recorder resolves to `addTransaction`'s resolved value, RS's to `undefined`.
  - `transaction/service.test.ts`: `JSON.stringify` of the emitted and stored `Tx` equals one literal string.
- **Tails:**
  - `claimOrCreateJournal` receives `[{ method }]` or `undefined` on both aztec paths: no calls array, an empty one, and a claim-led list.
  - `wantOffchainOutput` passes the anchor timestamp as a `bigint` on both paths.
  - At each estimate checkpoint, an abort rejects with a `JobCancelledSentinel` whose journal id is `""`, and nothing is stashed. That covers transfer and operation estimates, the NO_FROM preview, and the discovery estimator.

Green on unchanged code, in its own commit.

### Phase 2: the refactor

Items 1–7, in two commits: first the snapshot vocabulary (1–3, 7), then the records and tails (4–6).

Test files change only in:
- import specifiers for the two moved names;
- the two `recordedTx` bodies;
- the two `add` helpers in `transaction/service.test.ts` and `service.dropped.test.ts`.

No expectation changes.

### Phase 3: B-08

- **3a, test only:** red at the Phase 2 head.
  - VO with known priorities and the default: the read rejecting `Error("block not found")`, and a null reply. Each misses with `operation estimate reuse rejected: base fee fetch failed` and consumes the entry.
  - `dapp-send-executor.test.ts`: a real `OperationEstimateReuse` whose node's `getPredictedMinFees` rejects. The confirm rebuilds through discovery, is held to the preview, and sends. The red output goes in the arc's lessons log.
- **3b:** the fix above. It turns 3a green, with every Phase 1 file untouched.

### Validation gate (after each phase)

- **Commands:**
  - `bun run --cwd apps/extension test -- src/wallet/services/execution src/wallet/services/transaction`;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - at the head, `bun run build`, with the generated declaration files unchanged.
- **Pass criteria:**
  - Every command exits 0.
  - Phase 2's test diff is only the edits listed.
  - Phase 3b's diff touches `operation-estimate-reuse.ts` alone, and its composition line is byte-identical to Phase 2's.
- **Mutation check.** Each mutant is applied alone to a scratch copy and restored from it, never with git. A kill is a test that ran and failed. A survivor is either given a test or shown equivalent by a probe; it is never assumed equivalent.
  1. `?? endpoints[0]` at each of the four sites.
  2. PT's pending read hoisted above the profile read; PO's above the FPC read.
  3. The fingerprint from `predictedWorstMinFees`.
  4. `profileId` from the fence.
  5. In `reuseFeeMultiplier`: `PRIORITY_MULTIPLIERS[p] ?? DEFAULT`, and `normal` as the default.
  6. In `primaryEndpointMoved`: each clause dropped in turn.
  7. VO's chain or FPC step skipped.
  8. In `feeReadFailed`: the guard deleted, or changed to `=== undefined`; `getNode` moved inside the `try`.
  9. Two same-typed record fields swapped (`estimatedFee` and `submittedEndpointUrl`, `nonce` and `hash`); `networkId` from the fence.
  10. The `Tx` literal's keys reordered.
  11. `throwIfAborted` with a non-empty id.
  12. The thunk reading `op.exec.calls[0]`.
- **Screenshots:** none; no `.vue` or CSS file changes.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."). An independent Opus pass runs in parallel.
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's lessons file, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its stack parent with the B-08 line in the body, then add both e2e labels. When the program gates are green, with the shards that ran recorded in the lessons log, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/11-estimate-reuse`, stacked on `hd/09-network-endpoints` (#771); the driver sets the parent at delivery. Code review: off.

## UI impact

None. No `.vue`, CSS or copy changes. B-08 changes an operation's outcome, not a screen: a send that used to fail now completes.

## Deferred (program follow-ups)

1. **`resolveLiveHandles`** (`transfer-executor.ts:299-305`, `dapp-send-executor.ts:798-804`). Awaiting a helper adds a tick before each arm returns; making it tick-neutral would mean restructuring `resolveStandardBuild`.
2. **The `NO_WAIT` tail** (`dapp-send-executor.ts:753-757`, `:934-938`). An async helper adds ticks before `runInSlot`'s `finally` releases the slot.
3. **RN as a `sentTxRecorder` variant.** It would wrap RN in an `async` closure, adding an `await` and changing the resolved value.
4. **The ladders' fee compositions** stay inline, for arc 10's `committedMaxFees` reason. VT's re-wrap is a real difference.

## Drift left for the alignment arc

1. **An unknown `priorityLevel` (an owner lead, from arc 10).** VO throws: `RangeError` from `.mul`, or the read's own error. VT misses and rebuilds at the default. The path is reachable through unvalidated internal popup RPC input, not through a dApp. Pinned, not fixed.
2. **The producers stamp the active profile at stash time,** not the estimate's fence, and both differ in how they skip (PT logs, PO does not).
3. **RT records `network.id`; RS and RN record `op.networkId`.**
4. **The reasons differ.** VT carries the `estimateId` and splits the no-primary case; VO's new fee line is a fixed category while VT's logs the node message. The latter is a logging follow-up.
5. **The ladders' step orders differ,** and only VT re-wraps `GasFees`.
6. **RN resolves to the `Tx`; RS resolves to `undefined`** after its authwit write.

## Decisions (delegated)
