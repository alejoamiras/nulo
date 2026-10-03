---
plan: harden-dedupe / estimate-reuse (arc 11 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/11-estimate-reuse, stacked on harden-dedupe
---

# estimate-reuse: one snapshot vocabulary for both reuse caches, one tx-record shape, and B-08

Findings Q-05 (c), the reuse half of Q-05 (b), Q-10 and Q-04 (a)'s four execution sites, from `audit/quality/2026-09-30-dedup-high/`, plus bug B-08 from `audit/bugs/2026-09-30-ext-high/`.

- The two estimate-reuse caches re-check the same facts (the primary endpoint, the priority multiplier), and each ladder spells them by hand. `fingerprintBaseFee` and the TTL live in the transfer module.
- Every sent transaction is recorded through a 12-argument positional `addTransaction`.
- The four execution sites still find the primary endpoint by hand.

This batch states each shared fact once. Each ladder keeps its own step order, reject reasons and error policy. Each producer keeps every read where it is, and no `await` is added anywhere.

The one behaviour change is B-08, in its own commits. A dApp confirm whose fee read fails now attempts a fresh rebuild instead of failing the send; a persistent RPC failure still prevents completion.

Paths are under `apps/extension/src/wallet/services/` unless they start with `packages/`, `apps/` or `implementations-plan/`.

## Outcome & Quality Bar

- **For whom:** the next person who adds a snapshot fact, changes the fee basis, or adds a field to the activity record. Today those changes mean synchronized edits to two ladders, or to three record producers plus four positional projections. A mismatch fails silently: reuse always misses as "base fee drift", or two same-typed strings swap in a persisted row.
- **Excellent:**
  - The shared entry fields, the endpoint check and the multiplier are declared once, and both caches use them.
  - Each ladder's ordered collaborator calls, reject reasons and throws are pinned by literal values, one guarded field at a time. The pins include the unknown-priority drift with its exact messages, and they hold through the B-08 fix.
  - `addTransaction` takes one named object. Every producer's record is pinned field by field, along with the raw persisted bytes and the lock-ordered trace.
  - B-08 lands red, then green, with one line in the PR body.
- **Good enough:**
  - The producers' fee-fingerprint code stays per site (§ Decisions, blocker 1).
  - The live-handle re-resolution, the `NO_WAIT` tail and the NO_FROM recorder stay duplicated, because each would add an `await` (§ Deferred).

## Architecture & Implementation

Read on `harden-dedupe` at `fe9e6777`, which includes arcs 9, 17 and 18; none of them changes these files after arc 9. Line numbers differ from recon's in `dapp-send-executor.ts` (producer `:446-519`, recorder `:524-550`) and in `execution/service.ts` (the priority ternary is at `:1089`).

### Sites

**Snapshot producers (Q-04 (a); their fee reads stay in place)**

- **PT:** `execution/transfer-executor.ts:373-420` (`estimateFee`):
  - the primary lookup at `:377`;
  - the built fee read and fingerprint at `:383-387`, **before** `requireActiveProfile` at `:388`;
  - the pending hashes at `:389`;
  - the stash literal at `:391-412`.
- **PO:** `execution/dapp-send-executor.ts:446-519` (`stashOperationEstimate`):
  - the primary lookup at `:469`, on `built.network`;
  - `getActiveProfile` at `:471`;
  - the FPC read at `:475`;
  - `builtFees` at `:484`, **before** `crypto.randomUUID()` at `:485`;
  - the stash literal at `:486-512`. It fingerprints `builtFees` at `:496-499` and reads the pending hashes at `:502`, after the FPC read.

**Ladders (Q-05 (c), the reuse half of (b), Q-04 (a))**

- **VT:** `execution/transfer-estimate-reuse.ts:151-223`. The primary lookup is at `:181`; the fee step at `:195-211` sits inside a `try` and re-wraps `GasFees`.
- **VO:** `execution/operation-estimate-reuse.ts:124-166`. The primary lookup is at `:141`; the fee step at `:159-164` sits outside any `try`.
- `fingerprintBaseFee` (`transfer-estimate-reuse.ts:44`) and `ESTIMATE_REUSE_TTL_MS` (`:39`) are imported by `operation-estimate-reuse.ts:39`, `dapp-send-executor.ts:56`, `transfer-executor.ts:44` and `preview-snapshots.ts:14`.

**Tx records (Q-10)**

- The declaration: `transaction/service.ts:155-221`.
- The producers:
  - **RT:** `execution/transfer-executor.ts:181-214`;
  - **RS:** `sentTxRecorder`, `execution/dapp-send-executor.ts:524-550`, used at `:621` and `:739`;
  - **RN:** the NO_FROM recorder, `:917-931`.
- Positional projections: `SentTx` at `dapp-send-executor.ts:126-138`. The `AddTransactionArgs` alias at `:124` is dead once those projections go.
- Forwarding adapters: `execution/service.ts:352` and `:421`. Both are rest-spreads and stay unchanged.
- **The other Q-10 duplicates:**
  - the `getCalls` thunks at `dapp-send-executor.ts:676-682` and `:873-879`;
  - `wantOffchainOutput` at `:735-738` and `:913-916`;
  - the signal-form cancel checks at `:294-296` and `:368-370`, `transfer-executor.ts:350-352`, and `discovery-aware-estimator.ts:128`.

### Guard set per site (identical after the change, except VO's B-08 exit)

| site | guards, in order |
|---|---|
| PT | Eligible only for the `fj` and `fpc` kinds. Everything sits in a best-effort `try`: any throw means no `estimateId` and the debug line `estimateTransferFee: cache write skipped`. The primary endpoint is the row `primaryEndpointId` names, with no fallback; if there is none, nothing is stashed. The fee fingerprint comes from the built `maxFeesPerGas`, read before the profile `await`, never refetched. The profile comes from `requireActiveProfile(…, "Wallet locked")`, never the fence, and a throw skips the stash. Pending hashes are read after the profile read. The estimate's last cancel checkpoint (`:364`) runs before all of this. |
| PO | Eligible only for `aztec_sendTx` outside `default_entrypoint`, with no `embeddedFeePayment`, no dApp `maxFeesPerGas`, and the `fj` or `fpc` kind. A null fingerprint means no stash. The primary endpoint follows PT's rule. A missing active profile means no stash and no log. An `fpc` entry reads its FPC row. `builtFees` is read before `randomUUID`, and its fields inside the literal. `chainIdentity` is the builder's asserted pair. Pending hashes are read after the FPC read. Everything sits in a best-effort `try`. |
| VT | Consume first (single-shot), then: TTL; the seven-field input match; profile ≠ fence throws `SessionEndedError`; the network is fetched by `inputs.networkId`; no primary rejects `no primary endpoint`; a moved id or URL rejects `primary endpoint changed`; `getNode` runs outside the `try`. Inside the `try`: the read, the multiplier, the re-wrap, `.mul`, the compare. A mismatch rejects `base fee changed`; any throw rejects `base fee fetch failed: <message>`. The pending set comes last. Every reason carries the `estimateId`. VT has no chain-identity or FPC-identity step (Drift 7). |
| VO | Consume first, then: TTL (`entry expired`); a null or different fingerprint; profile throws `SessionEndedError`; the network is fetched by `entry.networkId`; no primary, or a moved one, rejects `primary endpoint changed`; the pending set; the chain identity, where a throw or a mismatch in either field rejects; FPC identity (`type`, `address`, `chainId`, `isProtocol`) for `fpc` entries; `getNode`, which propagates a throw; the multiplier; the read and `.mul`, which propagate; a mismatch rejects `base fee drift`. |
| executor binding | Unchanged: `assertEstimateBinding`, then `takeStandardPreview`, then `tryConsume` (`dapp-send-executor.ts:700-717`). A reuse id exists only for a `found` preview. The reuse arm re-resolves its live handles, then runs `assertFence`, then `assertLive`. The rebuilt arm is held to the preview by `assertWithinPreview` (`:718`). |
| RT / RS / RN | RT records the transfer-only call shape, `networkId: network.id`, and the endpoint URL captured before the prove. RS computes the account string and the endpoint URL at record time, takes `networkId` from `op.networkId`, and awaits `addTransaction`. Only then, and only when there are some, does it write the pending authwits, scoped to `fence.profileId`. RN uses nonce `Fr.ZERO` and `EXTERNAL`, uses the endpoint URL captured before the prove, writes no authwits, and returns `addTransaction`'s promise directly. |
| `addTransaction` | Under the tx lock. With a fence: `assertCurrent(profileId, epoch)`, then the owner lookup by the captured profile (`stale execution owner — account no longer exists`). Then the duplicate hash check (`duplicated hash`), the `Tx` literal in today's key order, and `set`, then `emit`, then `pending.set`. |

### What changes

1. **`execution/estimate-reuse-shared.ts`** gains the following. Every runtime helper is synchronous and pure.
   - `ESTIMATE_REUSE_TTL_MS` and `fingerprintBaseFee`, moved verbatim with their byte-stability comment.
   - `type ReuseEntryBase`: the ten fields both entry types declare today (`profileId`, `baseFeeFingerprint`, `primaryEndpointId`, `primaryEndpointUrl`, `pendingHashes`, `txRequest`, `initializesAccount`, `nonce`, `feePaymentMethod`, `builtAt`), each with one copy of its comment. `TransferEstimateReuseEntry` and `OperationEstimateReuseEntry` become `ReuseEntryBase & { …their own fields }`. This is a type only, so it moves no read.
   - `primaryEndpointMoved(primary: NetworkEndpoint | undefined, snap)`: `!primary || primary.id !== snap.primaryEndpointId || primary.rpcUrl !== snap.primaryEndpointUrl`.
   - `reuseFeeMultiplier(priority)`: `priority ? PRIORITY_MULTIPLIERS[priority] : DEFAULT_FEE_MULTIPLIER`. It indexes exactly as today, so an unknown or prototype-named priority yields what it yields today.
   - The header's `Q-10:` tag goes.
2. **The producers** swap only the lookup: PT uses `findPrimaryEndpoint(network)` and PO uses `findPrimaryEndpoint(built.network)`. Every other statement keeps its place, and `fingerprintBaseFee` is imported from the shared module.
3. **The ladders.**
   - **VT:** `findPrimaryEndpoint(network)`. Its separate `!primary` reject stays, followed by `if (primaryEndpointMoved(primary, entry))`. Inside the `try`, where the ternary is today (after the read), `const multiplier = reuseFeeMultiplier(inputs.feeSettings.priorityLevel)`. The re-wrap and its comment stay.
   - **VO:** `findPrimaryEndpoint(network)`, `if (primaryEndpointMoved(primary, entry))`, and `reuseFeeMultiplier(entry.feeSettings.priorityLevel)` in the ternary's place, after `getNode`. The composition expression stays byte-identical until Phase 3.
   - Each argument expression stays at its call site. The ternary read `priorityLevel` twice and the helper reads it once. Both read plain data (a port-deserialized request, or the stashed entry) with no getters.
4. **`transaction/service.ts`** exports `type AddTransactionInput`: the twelve fields with today's names and optionality. The `networkId` doc comment moves onto its field.
   - `addTransaction(input: AddTransactionInput)` destructures on its first line, so every value is fixed at the call, as positional arguments are.
   - The body stays byte-identical, including `return await this.lock.withLock(…)` and the `Tx` literal. The one exception is item 7's comment edit.
   - RT, RS and RN pass object literals keyed in today's positional order, so arguments evaluate in the same order.
   - `SentTx` types its fields as `AddTransactionInput["origin" | "calls" | "feePaymentMethod" | "networkId"]`, and the `AddTransactionArgs` alias is deleted.
5. **`execution/rpc-cancel.ts`** gains `throwIfAborted(signal)`: `if (signal?.aborted) throw new JobCancelledSentinel("")`.
   - The three closures and the inline check at `discovery-aware-estimator.ts:128` call it at the same checkpoints, and the closures are deleted.
   - The controller-form checks (`transfer-executor.ts:131-133`, `dapp-send-executor.ts:254-256`) carry a journal id, so they stay.
6. **`dapp-send-executor.ts`** gains two module-level synchronous functions:
   - `primaryMethodCalls(op)` replaces both `getCalls` bodies and keeps one copy of the comment. The thunks stay thunks (`getCalls: () => primaryMethodCalls(op)`), so it still runs after `acquireSlot`.
   - `offchainOutputOf(provedTx)` is passed as `wantOffchainOutput` at both sites.
7. **Comments.** Provenance tags go and the invariants they carry stay:
   - "plan decision #16";
   - "Codex audit BLOCKING #1";
   - "(codex audit SHOULD-FIX #3)";
   - "(codex audit SHOULD-FIX #2 partial)";
   - "(plan architecture §2)" and "audit-pinned";
   - "codex blocker", "finding D" and "D13" (`transaction/service.ts:172-175`);
   - "B-02:" (`dapp-send-executor.ts:566`);
   - "codex's v2 audit" (`rpc-cancel.ts:65-67`).
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

It calls one new synchronous method:

```ts
/** The priority lookup is unvalidated; a non-number multiplier is an unknown priority and must keep throwing. */
private feeReadFailed(error: unknown, multiplier: unknown): undefined {
	if (typeof multiplier !== "number") throw error
	return this.reject("base fee fetch failed")
}
```

- **What changes.** With a known multiplier, three outcomes that used to escape `tryConsume` now reject, so the caller attempts a fresh rebuild:
  - a rejected fee read, since `predictedWorstMinFees` rethrows transient errors such as "block not found" (`packages/aztec-runtime/src/fee-juice.ts:26-32`);
  - a null-like reply (`undefined` or `null`), which the JSON-RPC client returns for null-like results (lessons, Aztec) and on which `.mul` throws `TypeError`;
  - a bare-object reply with no `mul`.

  The rebuild re-reads the fee, so a persistent RPC failure still fails the send, now inside the build. The debug line names a fixed category, never the node's message (lessons, Extension runtime).
- **What stays.**
  - `getNode` stays outside the `try`, as in the transfer twin.
  - Every non-numeric multiplier (an unknown string, or a prototype key such as `constructor`, whose lookup yields a function) rethrows the same error object in the same continuation. So the unknown-priority drift stays exact, including when the read also fails.
  - The composition expression stays inline and unchanged, so a null-like reply under an unknown priority still throws today's engine text.
- **Rejected alternative.** A `try` around the read alone would change the thrown text on a null-like reply:
  - Bun: `evaluating 'basis.mul'` instead of `'(await predictedWorstMinFees(node)).mul'`;
  - Firefox 153: `can't access property "mul", basis is undefined` instead of `can't access property "mul" of undefined`;
  - V8 prints the same text for both.

  It would also turn an unknown priority with a failed read into a rebuild.
- **PR-body line:** "Behaviour change (B-08): when a dApp `aztec_sendTx` is confirmed with a still-valid estimate and the node's min-fee read fails or answers null, the wallet now attempts a fresh rebuild instead of failing the send; a persistent RPC failure still prevents completion. An unknown priority level fails the send as before."

### What stays

- Each ladder's step order and reasons, and `SessionEndedError` before any network read.
- VT's re-wrap and its message-bearing reason.
- Both producers' fee reads and fingerprints, in place.
- `fingerprintFeeSettings`, which only the transfer side uses.
- `execution/service.ts`, including `:1089`. Its else-arm is `undefined`, so each strategy applies its own default; it is not the ladders' ternary.
- The reuse arms' live-handle sequences, both `NO_WAIT` tails and RN's inline recorder.
- The strategies and `fee/*`, which are arc 10's.
- Every `await`.

### Alternatives not taken

- **One shared ladder with a step strategy.** Step orders, reasons and throw policies differ and are pinned; a strategy object would hide that, not remove it.
- **A combined snapshot producer, `builtReuseSnapshot`.** Merging the fee fingerprint with the endpoint fields moves a read in each producer (§ Decisions, blocker 1).
- **Re-exporting the moved names from `transfer-estimate-reuse.ts`.** That would add a permanent alias; the import lines change instead.

### Engine text and await shape

- **No added `await` or microtask.** Every new helper is synchronous. B-08's `catch` calls a synchronous method, so a rethrow settles `tryConsume` in the same continuation that today's throw does. `addTransaction` keeps its `return await`.
- **Moved expressions, and who can reach them:**
  - **`network.endpoints.find`.** Three sites name `network`, so the text is identical (arc 9 probed this on all three engines). PO named `built.network`, which Firefox reads as `built.network.endpoints is undefined` and the helper as `network.endpoints is undefined`. That text only reaches PO's best-effort `try`, which logs it at debug. The builder's row is codec-validated (`network/spec.ts:73`).
  - **`primary.id` / `primary.rpcUrl`.** `primary` is past its guard, and `snap` is the consumed entry, never nullish.
  - **The priority read** stays at the call site.
  - **`addTransaction`'s values** are evaluated in the producers' literals.
  - **`throwIfAborted`** uses optional chaining and cannot raise a `TypeError`.
  - **`primaryMethodCalls` and `offchainOutputOf`** keep the parameter names `op` and `provedTx`.

### Complexity

- `OperationEstimateReuse.tryConsume` scores exactly 15 today: a probe adding one `if` reads 16 on Biome 2.5.13.
- B-08's `catch` adds 1, and the multiplier helper and the endpoint predicate each remove 1, for 14. A probe of the fix without the predicate read 15.
- `TransferEstimateReuse.tryConsume` drops by 2.
- No touched function is in `scripts/complexity-baseline/manifest.json`, and no new acceptance is allowed.

### Coupling with neighbouring arcs

- **network-endpoints (arc 9, landed as #771).** `findPrimaryEndpoint` (`network/spec.ts:112`) is adopted as is.
- **fee-strategies (arc 10, in review).** It touches `fee/*` and `FeeSettingsCard`; this arc touches neither and only imports `DEFAULT_FEE_MULTIPLIER`. Arc 10's deferrals (`withEstimateTask`, `committedMaxFees`, the probe fold, `finishFpcEstimate`) stay deferred, and both ladders' compositions stay inline for the same engine-text reason. Its Drift 1 is preserved and pinned here.
- **row-lifecycle (arc 12, in review).** It edits the import line of `transaction/service.ts` and `restore` (`:530-536`); this arc edits `addTransaction` (`:155-221`). The rebase is mechanical.
- **Every other open arc** (15, 15b, 19, 20–24): no shared file, checked against each branch's diff.

## Security & Adversarial Considerations

- **The surface.**
  - The reuse caches hold signed `TxExecutionRequest`s for up to 120 s.
  - A popup transfer reaches VT. A dApp's `aztec_sendTx` reaches PO at estimate time and VO at confirm.
  - The dApp controls the operation (and so its fingerprint), its fee options, and the `estimateId`/`previewId` pair the popup echoes. A forged pairing is refused before the cache is touched (`dapp-send-executor.ts:402-405`, `:700`).
  - The endpoint controls the min-fee and chain-identity replies.
- **What a consolidation could widen.** Each of these is pinned one field at a time:
  - a lookup that falls back to `endpoints[0]`, signing against an endpoint the user never made primary;
  - a lost chain-pair field or FPC field;
  - a profile check that rebuilds instead of throwing;
  - a snapshot read that moves across an `await`;
  - a multiplier that absorbs the unknown priority;
  - a dropped executor binding or preview guard.

  The post-change guard set per site is the table above.
- **B-08 never makes a hit.** It turns a terminal failure into a miss, and a miss runs the fresh path with all its guards: the builder's live-chain assert, discovery, and `assertWithinPreview` against the popup's snapshot. A rebuilt send is still held to what the user saw.
  - `SessionEndedError` still precedes the fee step.
  - `getNode` stays outside the `catch`. It checks the active profile only on a cache miss (`network/service.ts:770-785`), and in production the chain step just warmed that cache. Either way its throw propagates as today.
  - The `catch` sees only the fee read and `.mul` on a numeric multiplier.
- **Persisted rows.** `addTransaction` writes `Tx` rows through `EntityStorage`. The literal keeps its key order, so the persisted bytes are unchanged. Phase 1 pins them from raw storage, because `TxSchema` decoding reorders properties.
  - The recorded `submittedEndpointUrl` stays the submitting network's, never the active profile's: that is the cross-profile receipt-routing guard (`transaction/service.ts:191-198`), pinned per producer.
  - The deletion-epoch check, the owner check and the duplicate check keep their order inside the lock, pinned by a trace.
- **Logging.** One new debug line with a fixed category. Existing lines are unchanged (§ Drift).
- **npm, layering, freeze.** No published entry is touched. `estimate-reuse-shared.ts` imports `@nulo/wallet-bridge`, `./fee/fee-strategy` and `network/spec`, all of which the ladders already import. The account freeze is untouched.

## Assumptions

**Facts** (read 2026-10-03 at `fe9e6777`):

1. The sites and line numbers are as listed above. `findPrimaryEndpoint` is `network.endpoints.find((e) => e.id === network.primaryEndpointId)` (`network/spec.ts:112-114`).
2. `GasFees.mul` passes a non-integer scalar to `bigintMulCeil`, which throws `RangeError` for `undefined` or a function. The text differs per engine: Bun "Not an integer", V8 "The number NaN cannot be converted to a BigInt because it is not an integer", Firefox "NaN can't be converted to BigInt because it isn't an integer" (`@aztec-labs/stdlib/dest/gas/gas_fees.js:10-14`, `:43-54`; probed on all three).
3. `PRIORITY_MULTIPLIERS` is `{ normal: 2, fast: 3, urgent: 5 }` (`packages/wallet-bridge/src/fee.ts:25-29`). `DEFAULT_FEE_MULTIPLIER` is 2 unless `VITE_NULO_FEE_MULTIPLIER` is set (`fee/fee-strategy.ts:65-66`), so the tests mock it to a distinct value.
4. `ExecutionCoordinator.proveAndSend` awaits `recordTransaction` and ignores its value (`execution/execution-coordinator.ts:135`, `:355`). `addTransaction` is not an RPC method (`transaction/service.ts:59`).
5. In production, `getLiveChainIdentity` calls `networkService.getNode` inside VO's chain `try` (`execution/service.ts:293-298`).
6. Existing pins cover the ladders' orders and most exits, record positions 2–7, the estimate cancel checkpoints and the preview binding. Nothing pins:
   - the reason texts;
   - the dangling-primary rows;
   - each guarded field on its own;
   - the TTL guard on an entry that ages after it is stashed;
   - `profileId`'s source;
   - the default multiplier as distinct from `normal`;
   - the unknown-priority outcome;
   - the full record per producer;
   - the persisted bytes or the lock order.

**Inferences:**

- The production bundle may rename identifiers, so engine text is pinned at the source level, as elsewhere in the program.
- Under vitest, JSC's text embeds the transformed source with vite's `__vite_ssr_import_N__` names. So a reference message for an expression that names an import is compared after normalizing that counter (arc 6's lesson).

**Asks:** none open. The panel agreed on all three (§ Decisions).

## Phases

### Phase 1: pin today's behaviour (test only)

Expected values are literals. Every fake records into one ordered `calls` array, and each refusal row also asserts that downstream calls stop at its boundary. The ladder test files mock `./fee/fee-strategy` so that `DEFAULT_FEE_MULTIPLIER` is 7.

**Ladders** (`operation-estimate-reuse.test.ts`, `transfer-estimate-reuse.test.ts`)

- **Order and reasons.** The ordered collaborator calls on a hit and on every exit:
  - VO: `getNetwork, getPendingForAccount, getLiveChainIdentity, getFpcInfo, getNode, predictedWorstMinFees`;
  - VT: `getNetwork, getNode, predictedWorstMinFees, getPendingForAccount`.

  Each exit pins its exact debug text, and the entry is consumed afterwards.
- **TTL.** A fresh entry is stashed, then aged past the TTL with `vi.setSystemTime`, with no eviction timer run. Both ladders reject on their own TTL guard.
- **One guarded field at a time**, each against a same-values control:
  - VO's chain pair: `l1ChainId` alone, `rollupVersion` alone;
  - VO's FPC fields: `type`, `address`, `chainId`, `isProtocol`;
  - VT's seven inputs;
  - the endpoint: `id` alone, `rpcUrl` alone, the primary as the second row (accepted), and a dangling `primaryEndpointId` (VT `no primary endpoint`, VO `primary endpoint changed`).
- **Priority × product** over basis `(2,3)`: `undefined` and `""` give `14:21`, `normal` `4:6`, `fast` `6:9`, `urgent` `10:15`.
- **The drift (stays green through Phase 3).** Every expected message is computed from a reference:
  - VO, priority `"bogus"`, read resolving: `RangeError` with the exact message of `new GasFees(2n, 3n).mul(undefined)`;
  - VO, `"constructor"`: the reference `new GasFees(2n, 3n).mul(PRIORITY_MULTIPLIERS["constructor"])`;
  - VO, `"bogus"`, read rejecting `E`: rejects with `E` itself (`toBe`);
  - VO, `"bogus"`, read resolving `undefined`, and again resolving `null`: `TypeError` with the exact message of a reference evaluating `(await predictedWorstMinFees(node)).mul` on the same value, vite import counter normalized;
  - VT, `"bogus"`: a miss whose reason is `base fee fetch failed: ` plus the RangeError reference message;
  - VT, read resolving `undefined` and again `null`: the reason carries the exact message of a reference evaluating `basis.feePerDaGas` on the same value.
- **`getNode` rejecting in VO:** rejects with that error, and no fee read runs.

**Producers** (`transfer-executor.test.ts`, `dapp-send-executor.test.ts`)

Built `maxFeesPerGas` is `(7n, 11n)`, and the node's prediction differs.

- The full stashed entry by `toStrictEqual`: `baseFeeFingerprint` `"7:11"`, primary `e2` of `[e1, e2]`, `builtAt` from fake timers.
- A dangling primary or an absent array: no `estimateId`, and the fee result still returns.
- A pending tx inserted during the profile read (PT) is in the snapshot. So is one inserted during the FPC read (PO, an `fpc`-kind entry).
- `profileId` is the active profile at stash time, not the fence's.
- PT locked: the skip line carries `Error("Wallet locked")`. PO with no profile: no stash and no log.
- PO eligibility, one clause at a time, each with a control that passes every other clause:
  - `send_transaction`;
  - `default_entrypoint`, with a NO_FROM fixture that is not also embedded;
  - an embedded fee;
  - a dApp `maxFeesPerGas`;
  - the `fjwc` and `embedded` kinds;
  - a null fingerprint.
- PT eligibility: `fjwc` and `embedded`.

**Records**

- Each executor test file gets one local accessor, `recordedTx(deps)`, that projects the `addTransaction` call into the twelve named fields. Existing `txArgs[n]` reads move onto it.
- One row per producer pins all twelve fields with distinct literals: RT fresh, RT reuse, RS via `send_transaction`, RS standard fresh, RS reuse hit, RN.
- RS: `recordPendingAuthwits` starts only after `addTransaction` resolves (a deferred promise). RN's recorder resolves to `addTransaction`'s value, RS's to `undefined`.
- `transaction/service.test.ts`:
  - The raw stored string for the row, read from the fake browser storage, equals one literal.
  - An ordered trace of `assertCurrent`, `getAccount`, the duplicate lookup, `set`, `emit` and `pending.set`.
  - A duplicate hash rejects `duplicated hash` with no second `set` or `emit`.

**Tails and binding**

- `claimOrCreateJournal` receives `[{ method }]` or `undefined` on both aztec paths, for no calls array, an empty one, and a claim-led list. The thunk runs after `acquireSlot` (call order).
- `wantOffchainOutput` passes the anchor timestamp as a `bigint` on both paths.
- At each estimate checkpoint (transfer, operation, NO_FROM preview, discovery estimator), an abort rejects with a `JobCancelledSentinel` whose journal id is `""`. Nothing past the checkpoint runs, and nothing is stashed.
- The binding: a forged `previewId` is refused before `tryConsume`, and a `missing` preview never consumes.

Phase 1 is green on unchanged code and lands in its own commit. A Firefox probe of every reference message is recorded in the lessons log.

### Phase 2: the refactor

Items 1–7 land in two commits: the reuse vocabulary (1–3, 7), then the records and tails (4–6).

Test files change only in:
- import specifiers for the two moved names;
- the two `recordedTx` bodies;
- the `add` helpers in `transaction/service.test.ts` and `service.dropped.test.ts`.

No expectation changes.

### Phase 3: B-08

- **3a, test only, red at the Phase 2 head.**
  - In VO, with known priorities and the default: the read rejects `Error("block not found")`, resolves `undefined`, resolves `null`, and resolves a bare object. Each misses with `operation estimate reuse rejected: base fee fetch failed` and consumes the entry.
  - In `dapp-send-executor.test.ts`, a real `OperationEstimateReuse` whose node's `getPredictedMinFees` rejects. The confirm rebuilds through discovery, is held to the preview, and sends.
  - The red output goes in the lessons log.
- **3b: the fix.** It turns 3a green, and every Phase 1 file stays untouched.

### Validation gate (after each phase)

- **Commands:**
  - `bun run --cwd apps/extension test -- src/wallet/services/execution src/wallet/services/transaction`;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - at the head, `bun run build`, with the generated declaration files unchanged.
- **Pass criteria:**
  - every command exits 0;
  - Phase 2's test diff contains only the listed edits;
  - Phase 3b's diff touches `operation-estimate-reuse.ts` alone, and its composition expression is byte-identical to Phase 2's.
- **Mutation check.** Each mutant is applied alone to a scratch copy and restored from it, never with git. A kill is a test that ran and failed. A survivor gets a test or a probe; it is never assumed equivalent.
  1. `?? endpoints[0]` at each of the four sites.
  2. PT's pending read hoisted above the profile read; PO's hoisted above the FPC read.
  3. The fingerprint taken from `predictedWorstMinFees`.
  4. `profileId` taken from the fence.
  5. `reuseFeeMultiplier` as `PRIORITY_MULTIPLIERS[p] ?? DEFAULT`; `normal` as the default.
  6. Each clause of `primaryEndpointMoved` dropped; VT's `!primary` reject dropped.
  7. Each chain-pair field, each FPC field, and each VT input dropped.
  8. Each ladder's TTL guard deleted.
  9. In `feeReadFailed`: the guard deleted; the guard as `=== undefined`; `getNode` moved inside the `try`.
  10. Each producer eligibility clause dropped.
  11. Two same-typed record fields swapped (`estimatedFee` with `submittedEndpointUrl`, `nonce` with `hash`); `networkId` taken from the fence.
  12. RS without the `await` before `addTransaction`.
  13. The `Tx` literal's keys reordered; the duplicate check deleted; the owner check moved after the duplicate check.
  14. Each cancellation checkpoint deleted; `throwIfAborted` with a non-empty id.
  15. `primaryMethodCalls` evaluated eagerly (before `acquireSlot`); the thunk reading `op.exec.calls[0]`.
  16. `offchainOutputOf` without `BigInt`.
  17. `assertEstimateBinding` deleted; `takeStandardPreview` accepting a foreign lookup; `assertWithinPreview` deleted on the rebuilt arm.
- **Screenshots:** none. No `.vue` or CSS file changes.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - Include the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Include the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop.** Triage each finding, fix it, commit, log the round in this arc's lessons file, and resume the same session. Stop when a round has no material finding; park the arc after 5 rounds.
3. **Delivery.** Push, open a ready PR against its stack parent with the B-08 line in the body, then add both e2e labels. When the program gates are green, with the shards that ran recorded in the lessons log, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/11-estimate-reuse`, stacked on `harden-dedupe`; the driver sets the parent at delivery. Code review: off.

## UI impact

None: no `.vue`, CSS or copy changes. B-08 changes an operation's outcome, not a screen.

## Deferred (program follow-ups)

1. **`resolveLiveHandles`** (`transfer-executor.ts:299-305`, `dapp-send-executor.ts:798-804`). Awaiting a helper adds a tick before each arm returns.
2. **The `NO_WAIT` tail** (`dapp-send-executor.ts:753-757`, `:934-938`). An async helper adds ticks before `runInSlot`'s `finally` releases the slot.
3. **RN as a `sentTxRecorder` variant.** It would add an `async` closure and change the resolved value.
4. **The ladders' fee compositions.** They stay inline for arc 10's `committedMaxFees` reason, and VT's re-wrap is a real difference.
5. **The producers' fee fingerprint.** It stays per site; a shared helper would move reads (blocker 1).

## Drift left for the alignment arc

1. **An unknown `priorityLevel`** (an owner lead, from arc 10). It is reachable through unvalidated internal popup RPC input, not by a dApp. Pinned, not fixed.
   - VO throws: `RangeError` from `.mul`, the read's own error, or a `TypeError` on a null-like reply.
   - VT misses and rebuilds at the default for an unknown string. For a prototype-key priority such as `"constructor"`, the rebuild's own `.mul` throws.
2. **Both producers stamp the active profile at stash time,** not the estimate's fence, and they skip differently: PT logs, PO does not.
3. **RT records `network.id`, while RS and RN record `op.networkId`.** RS reads the endpoint URL at record time; RT and RN capture it before proving.
4. **The reasons differ.**
   - VT carries the `estimateId` and splits the no-primary case.
   - VO embeds error messages in its chain and FPC reasons (`operation-estimate-reuse.ts:155`, `:174`).
   - VO's new fee line is a fixed category, while VT logs the node message.
5. **The ladders' step orders differ,** and only VT re-wraps `GasFees`.
6. **RN resolves to the `Tx`, and RS to `undefined`** after its authwit write.
7. **VT has no chain-identity or FPC-identity step; VO has both.** This is a security lead for follow-ups, not fixed here.

## Decisions (delegated)

### Plan audit (Codex GPT-6 Astra xhigh: REVISE, 1 blocker; Opus: REVISE, text changes only), 2026-10-03

**Blocker 1 (Codex): keep both producers' fee reads where they are. Adopted.**

- The draft moved PT's fee read after `requireActiveProfile` and folded PO's into a combined `builtReuseSnapshot`. Codex's controlled probes changed the snapshot and the failure path: a build mutated during the profile `await`, and a fee getter that fails on its third read.
- Why the move looked safe: Opus showed that no production route exists.
  - `EntityStorage.get` decodes a fresh row on every read (`packages/wallet-core/src/storage/entity_storage.ts:182-186`).
  - The built request is held only by the estimating frame.
  - `GasFees` has no getters.
- The program's precedent decides it. Arc 10 kept V2/V3's reads in place without a production route.
- So PT still fingerprints before `requireActiveProfile`, PO still reads `builtFees` before `randomUUID`, and `builtReuseSnapshot` is dropped. Every other helper stays.

**Characterization gaps (Codex). Adopted.** These are in Phase 1 and the mutant list:

- a TTL that ages a fresh entry without running eviction timers;
- one guarded field at a time (VO's chain pair, the FPC fields, VT's inputs, producer eligibility), each with a control, and a NO_FROM fixture that is not also embedded;
- downstream calls stopping at each boundary;
- mutants for the cancel checkpoints, an eager `primaryMethodCalls`, the binding and preview guards, and the transaction duplicate and order guards;
- an ordered transaction trace, and persisted bytes read from raw storage;
- exact reference messages for the unknown-priority and null cases, for both `undefined` and `null`.

**Opus nits. Adopted.**

- Three more mutants: VT's `!primary` reject, RS's `await` before `addTransaction`, and `offchainOutputOf` without `BigInt`.
- An `fpc`-kind PO row for the pending-tx race.
- The dead `AddTransactionArgs` alias is deleted.
- "Expression", not "line", for the composition.
- `feeReadFailed`'s doc states its invariant.
- The `getNode` security sentence is corrected: it checks the profile on a cache miss only.
- The bare-object reply is named.
- SpiderMonkey's text is added to the rejected alternative.

**Drift additions (both legs). Adopted** as Drift 1, 3, 4 and 7. B-08 is worded as "attempts a fresh rebuild; a persistent RPC failure still prevents completion".

**Provenance tags (both legs). Adopted.** The tags at `transaction/service.ts:172-175`, `dapp-send-executor.ts:566` and `rpc-cancel.ts:65-67` go. The `addTransaction` body is otherwise byte-identical.

**Asks (both legs agreed):**

1. B-08 includes null-like replies, tested with both `undefined` and `null`.
2. The new line uses the fixed category `base fee fetch failed`.
3. The same-shape `getNetwork`/`getNode` sites are deferred, and `getNode` stays outside the `try`.

**Rejected:** none.
