# tools-recovery — fable audit (Claude leg, Plan subagent on `fable`)

## Round 1 — on plan v1 + the competing outline (2026-09-11)

**Verdict: conditional approve** (conditions: S1 silo/secret by record shape, S2 viem `getLogs` args, I1 re-key handoff outside the old-id lock, plus the fact corrections below).

### Security

- **S1 (HIGH)** `message-nullifier.ts` silos by `hub` and derives with `deriveTokenClaimSecret`; both are wrong for a gas-only send and for schema-1/2 records. `useSend.ts:166-167,470-471` set `bridge = feeJuiceAddress` for `intent === "gas"`; the consumer contract (the silo, `hash.d.ts:46`) is `rec.bridge`, never a constant. A private gas-only record's consumed secret is `deriveBridgeSecret(fuelSalt, recipient)` (`useSend.ts:864`, `private-fuel.ts:160`) and its message hash is `rec.fuel.messageHash`, not `rec.messageHash` (`deposit-flow.ts:254-263`). Change: `tokenMessageNullifier({ consumer: rec.bridge, … })`, and `messageNullified` returns `null` unless `claimsThroughHub(rec)` (`useBridgeJournal.ts:860`) — fail-closed for everything else. The plan's "public and private deposits" claim is over-broad.
- **S2 (MEDIUM)** a single `getLogs({ events: [Bridge, BridgeWithFuel], args: { aztecRecipient } })` silently drops the filter (viem 2.55 `getLogs.js:35`: `args: events_ ? undefined : args`). Correctness survives (calldata binds), the cost claim fails and a busy router floods `getTransaction`. Change: two `event:` calls (or post-filter `topics[1]`).
- **S3 (LOW)** C's `taken` set only covers this browser's journal: an identical exit from another device is one unclaimed candidate and gets attached; the real exit stays untracked. Funds still pay `recipientL1` — a bookkeeping residual, state it as accepted.
- **S4 (LOW)** B's "the Inbox would reject the second identical message" is false (the leaf includes the index, `messaging.nr:19-27`): a replayed router tx is two valid deposits with one secret. Refusing as ambiguous is still right; fix the rationale, note both need manual handling.
- Prompts: none outside the click — A reads `secretCache` only, B/C are reads.

### Assumptions

- Facts: F1 (`main.nr:264-271`, the claim value reaching the hub is the salt — `hub-l2.ts:218`, `deposit-flow.ts:350`), F3 (`:1118` in this tree), F5/F7/F8/F9 confirmed. **Misstated (competing outline)**: "`readSendReceiptLeaves` already fails a mismatch" — `readLeaves`/`recoverSendLeg` (`send-flow.ts:339-354`, `deposit-flow.ts:249-272`) never compare the event's `secretHash` to `rec.secretHashHex`; only a missing index/key throws. The calldata match is the only binder. F6: `node.getBlock(n, { includeTransactions: true })` gives `body` (`block_response.d.ts:52-53`); `getBlocks(from, limit)` exists (`aztec-node.d.ts:189`) — use it, not per-block reads.
- Inferences: hub nullifier = FeeJuice scheme **verified** in both contexts (`messaging.nr:29`, private kernel-siloed via `push_nullifier_unsafe` `private_context.nr:395`; `public_context.nr:257` AVM `nullifier_exists_unsafe(nullifier, this_address)`; `DOM_SEP__MESSAGE_NULLIFIER = 3754509616`, `constants.nr:740`). `getNullifierMembershipWitness` via the node client: safe. viem `getLogs`: **unsafe as written** (S2); public RPCs cap ranges (~10k blocks) → chunk on testnet (delegated decision). `l2ToL1Msgs` for a window: safe locally; a pruned testnet node returns `undefined` bodies → read as `"none"` ("too old"), never throw. Re-key: see I1.
- Asks (silently assumed): the L1 `swallowNext` fixture must actually broadcast while parking the page (`takeHold` parks BEFORE sending, `fixtures/l1-wallet.ts:131-137`); `record-policy.ts` has no deps visibility — `depositLegRecoverable` must gate on `schema === 3`, or schema-1/2 hash-less rows grow a CLAIM that always fails (`deposit-flow.ts:286`).

### Implementation

- **I1 (MEDIUM)** attach must not continue under the old-id lock: `runWithdrawConsumeInner` (`:1341`) locks `id`; after `rekeyJournalRecord` every `setRuntime(id)`/`patchRecord(id)` targets the dead provisional id and `inFlight` no longer covers the new id (a second FINISH click can enter). Mirror `useHubExit.ts:512-520`: the locked fn returns `{ rekeyedTo }` and `runWithdrawConsumeInner` calls `runWithdrawConsume(newId)`.
- **I2 (LOW)** structure is right; the scan should ship; keep paste out. Boundary correct; `patchRecordWhen`, `recoverDepositLeg`, `consumedElsewhere`, `rekeyJournalRecord` reused; `expectedWitness` correctly not needed pre-attach. Nit: `findExitTx`'s node interface should be `getNodeInfo`/`getBlockNumber`/`getBlocks`.
- **I3 (LOW)** complexity: replace the `!rec.exitTxHash` block with one helper call; `classifyConsumable` split is required; `runDepositClaimLocked` unchanged; no `biome-ignore` in the file today — keep it so.
- **I4 (LOW)** gates real; add to Phase 1's unit gate: a token+gas record whose FUEL message is nullified but TOKEN is not ⇒ `false` ⇒ error (the readiness wart, pinned).

**Confirmed sound:** nullifier formula and siloing for hub claims, click-only prompts, calldata as B's binder, conditional writes via `patchRecordWhen`, the arc split and its reuse map.
