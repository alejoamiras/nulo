---
plan: tools-recovery
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
codex_effort: high
recon_budget: 2 agents (batched reuse sweep + journal mapper), default
status: draft v2 (2026-09-11) — codex round 1 reject (14) + fable conditional (4) folded; awaiting codex round 2, then the fresh final pass
worktree: .claude/worktrees/tools-recovery (branch worktree-tools-recovery, from origin/dev @ 62f3456a)
---

# tools-recovery — the three stuck-record recoveries, identity-bound

The tools dApp keeps a bridge journal of every deposit and exit. `tools-readiness` (#582 → #584)
pinned three rows the journal cannot finish today:

1. **Consumed**: a claim another submitter made first (a relayer, another tab). Today the record ends
   in an error ("already nullified") although the tokens arrived.
2. **Hash-less deposit**: the Ethereum wallet never answered the router transaction (or the page died
   before the hash was written). Today the row says "never confirmed on Ethereum" and offers only
   Discard, even when the deposit landed.
3. **Hash-less exit**: the wallet sent the burn but the page never learned the transaction id. Today
   the row says "The exit was interrupted" and offers only Discard, even though the funds are in the
   Outbox waiting to be finished.

Each fix ADDS a chain-proven fact to the record (done-by-another, `depositTxHash`, `exitTxHash`) and
then runs today's paths. None re-sends anything. Every decision fails closed: no fact is written from
an ambiguous match, and no prompt is ever raised except on the user's CLAIM/FINISH click.

## Owner answers (Phase 0, 2026-09-11)

- **Scope**: all three fixes, as three arcs of one stack.
- **Unseal rule**: the private deposit's secret is unsealed (one L1 signature) only on a CLAIM click —
  never in the background. A reloaded private record that was claimed elsewhere therefore finishes on
  the user's click, not on its own.
- **Gates**: unit tests per phase; each fix flips its pinned cell (24b → done, 26d → reconciled,
  31b → attached) inside its phase gate; the full tools suite in two local shards at each arc boundary;
  `test:all` + lint + `lint:actions` at the end. CI's six shards remain the last gate.
- **Bar**: production. `code_review: off`; codex at `high`; no `/harden` scheduled now — the bridge's
  pre-release `/harden security` pass covers the journal's recovery surface later.

## Scope

**In**
- A. `claimedByOther`: the token message is recomputed from the record's own facts and its nullifier
  read from the node; a nullified message finishes the deposit as done with a persisted fact — hub
  token sends only (public, and private on the CLAIM click that unseals the secret).
- B. Deposit reconcile: a hash-less hub token send finds its router transaction on L1 by its own
  secret hash inside a chain-time window, verified on calldata (entrypoint, token, portal, amounts,
  secret hashes, recipients, privacy) and on a canonical, successful receipt; exactly one match writes
  `depositTxHash`; the existing leg recovery then runs.
- C. Exit attach: a hash-less exit recomputes its L2→L1 message hash and scans the L2 blocks since
  the record's creation for the one transaction that emitted it; exactly one unclaimed match writes
  `exitTxHash`/`exitBlock` (re-keying the record as a live exit does); the existing consume tail runs.
- Card copy and action gating for the three shapes; the three cells flipped; unit tests for every
  helper and engine branch, including the ambiguity refusals.

**Out**
- Resubmitting anything from a record (the journal's standing rule).
- Background scans on reload: B and C run on the user's click only (a read, but a deliberate one —
  and `resumeActionFor` keeps skipping mid-flight shapes).
- A private-deposit variant of cell 24b in the browser (the relayer cannot claim a private deposit
  without the claim salt — the harness never has it): the private path is proven in unit tests
  against the derived secret.
- Fixing the readiness § 2 warts (`confirmReview` stand-downs, the SDK probe patch) — separate work.
- Any change under `apps/extension/**` or the wallet packages (two products, one repo).

## Architecture & Implementation

### Shape

Three pure "find the fact" helpers, three optional engine deps, one new branch per shape in the
journal engine, one new persisted fact, and the affordances that let a click reach the branch.

```
apps/tools/src/lib/message-nullifier.ts      A: nullifier from (messageHash, secret[, recipient])   [new, pure]
apps/tools/src/composables/deposit-reconcile.ts  B: L1 window + log scan + calldata match           [new]
apps/tools/src/composables/exit-attach.ts        C: L2→L1 hash recompute + block scan               [new]
apps/tools/src/composables/useBridgeJournal.ts   3 deps, 3 branches, the claimedByOther completion  [modified]
apps/tools/src/composables/useSend.ts            wires A + B deps (node + L1 public client)          [modified]
apps/tools/src/composables/useHubExit.ts         wires C dep (node)                                  [modified]
apps/tools/src/lib/record-policy.ts              CLAIM for a hash-less send, FINISH for a hash-less exit [modified]
apps/tools/src/components/BridgeJournalCard.vue  copy for the three shapes + done-by-another        [modified]
packages/bridge-core/src/journal.ts              DepositJournalRecord.claimedByOther?: true          [modified, additive]
apps/tools/tests/browser/{specs,fixtures}        cells 24b/26d/31b flipped; L1 fixture swallowNext   [modified]
```

### A — consumed → done, on the message's own nullifier

- **Scope**: hub token claims only (`claimsThroughHub(rec)`: a send record with intent `token` or
  `token+gas`, `useBridgeJournal.ts:860`). Gas-only sends and schema-1/2 records keep today's
  behaviour (their consumer is the Fee Juice contract / the legacy bridge — `useSend.ts:166-167,470-471`
  set `bridge` per intent — and their secret schemes differ; the dep answers `null` for them).
- **The message is recomputed, never trusted** (`message-nullifier.ts`): from validated record facts —
  `sender = L1Actor(rec.portal, rec.chainId)`, `recipient = L2Actor(rec.bridge, rollupVersion)`,
  `content = mintToPublicContentHash(rec.recipient, amount)` or `mintToPrivateContentHash(amount)`
  (`content-hash.ts:49-54`, the hub's `main.nr:243,264`), `secretHash = rec.secretHashHex`,
  `index = rec.leafIndex` — `new L1ToL2Message(...).hash()` (stdlib `l1_to_l2_message.d.ts:24-36`;
  aztec-nr `messaging.nr:15-27` uses exactly these seven inputs). The recomputed hash must equal
  `rec.messageHash`; a mismatch is a `"tampered"`-class refusal, never a lookup. For a private record
  the amount/recipient come from the OPENED envelope (the sealed truth), not the display fields.
- **Nullifier**: `siloNullifier(rec.bridge, computeFeeJuiceMessageNullifier(messageHash, secret))` with
  `secret` = the public secret, or `deriveTokenClaimSecret(salt, recipient)` for a private record
  (`main.nr:265-271`, `claim-secret.ts:46-47`). The formula is aztec-nr's
  `compute_l1_to_l2_message_nullifier` (`hash.nr:51-53`): poseidon2 over `[message_hash, secret]`
  with `DOM_SEP__MESSAGE_NULLIFIER`; siloed by the consuming contract (kernel-siloed in private,
  `private_context.nr:395`; AVM-siloed in public, `public_context.nr:257`). The leaf index is an input
  of the message hash, not of the nullifier.
- **Dep** `messageNullified?(rec: SendDepositRecord, material: { secretHex; envelope? }): Promise<boolean | null>`
  — the engine passes the material it already resolved (public: `publicClaimSecretOf`; private: the
  `secretCache` entry — the dep is wired outside the module and cannot read the cache). Then
  `node.getNullifierMembershipWitness("latest", n)`: a witness ⇒ `true`; `undefined` ⇒ `false`;
  missing material / `messageHash` / `leafIndex`, a recompute mismatch, or an RPC throw ⇒ `null`.
- **Engine, the read comes before any fee construction**: (1) `probeClaimedElsewhere(rec, material)`
  runs right after the material resolves and BEFORE `buildClaimHandles`: `true` ⇒
  `completeClaimedByOther(id)` (persist `claimedByOther: true`, `completeDeposit`) — no fee ladder, no
  simulate; `false`/`null` ⇒ continue as today. (2) `awaitConsumable` returns a tri-state
  `"ready" | "claimed-elsewhere" | "timeout"`: a consumed-shaped simulate error (both wordings —
  `isMsgConsumed` gains `L1-to-L2 message is already nullified`, `public_context.nr:259`) re-asks the
  dep; `true` ⇒ claimed elsewhere; otherwise today's error. (3) `recordMessageConsumed` (the probe after
  a success receipt on a resumed claim) reads the nullifier instead of rebuilding the fee-bearing claim.
  Extracted helpers: `classifyConsumable`, `probeClaimedElsewhere`, `completeClaimedByOther` — the
  runner functions gain one call each.
- **Fact + copy**: `claimedByOther?: boolean` on deposit records (additive, like `consumedByOther`;
  no migration — loaders never gate on it). Card: "Claimed by another submitter — your tokens
  arrived." Stage stays derived (`done`).
- **Prompts**: A adds none. The unseal stays where it is (the CLAIM click's
  `resolvePrivateClaimMaterial`); a non-interactive run with no cached secret makes the dep answer
  `null` and the record keeps today's note. (The pre-existing same-session resume — `resumeActionFor`
  only auto-continues what THIS page session started — is the journal's stated exception and is not
  widened.)

### B — reconcile a hash-less deposit from L1

- **Scope**: hub token send records (`claimsThroughHub`), `schema === 3`, no `depositTxHash`. Gas-only
  and legacy records keep today's Discard-only shape (`record-policy` gates the affordance on
  `schema === 3` and a token block, so no CLAIM appears that would always fail).
- **Helper** (`deposit-reconcile.ts`): `findDepositTx(rec, l1, gen, opts)` over a narrow client
  (`getBlock`, `getLogs`, `getTransaction`, `getTransactionReceipt`):
  1. **Window by chain time**: `createdAt/1000 − slack` (delegated: 10 min) → the first L1 block with
     `timestamp ≥ that` by binary search over `getBlock({ blockNumber })`; `toBlock` = latest. The window
     is capped (delegated: 50 000 blocks) and chunked for RPCs that cap `getLogs` ranges; a hit cap,
     missing history or a failed RPC read is **`"incomplete"`**, never `"none"`.
  2. **Candidates**: ONE event per call (viem drops `args` when `events` is used — `getLogs.js:35`):
     `getLogs({ address: gen.router, event: Bridge, fromBlock, toBlock })` for `intent === "token"`,
     `BridgeWithFuel` for `token+gas`. No recipient filter: a private token deposit publishes a ZERO
     recipient (`send-flow.ts:150-154`). Post-filter on the DECODED event args: `secretHash === rec.secretHashHex`
     (and `fuelSecretHash === rec.fuel.secretHashHex`).
  3. **Verify calldata** for each survivor: `getTransaction(hash)` → `decodeFunctionData(SWAP_BRIDGE_ROUTER_ABI, input)`;
     require `tx.to === router`, the entrypoint by intent (`sendEntrypoint`, `send-flow.ts:112-116`),
     `bridgeToken === rec.token.erc20`, `tokenPortal === rec.portal`, `isPrivate === rec.isPrivate`,
     the recipient(s) as the send wrote them (`witnessRecipient`, `:150-154`: zero for private), the
     amounts as the send wrote them (`bridge`: `amount === rec.amount`; `bridgeWithFuel`:
     `totalAmount === rec.amount + rec.fuel.amount`, `fuelAmount === rec.fuel.amount`,
     `minFuelOutput === rec.fuel.minOutput`), and the secret hash(es) again from calldata.
  4. **Canonical check**: `getTransactionReceipt(hash)` must be `success` and its `blockHash` must
     match `getBlock(receipt.blockNumber).hash` at the time of the write (a reorged tx is `"incomplete"`).
  5. **Result**: exactly one verified tx → `{ txHash }`; none → `"none"`; two or more → `"ambiguous"`
     (a wallet that replayed the router tx made two valid deposits with one secret — both need manual
     handling; the leaf index makes their messages distinct, `messaging.nr:19-27`).
- **Dep** `findDepositTx?(rec) → Promise<{ txHash } | "none" | "ambiguous" | "incomplete">`, wired in
  `useSend.ts` with the app's viem public client and `SEND_GENERATION`.
- **Engine**: `recoverLegIfNeeded`'s early bail becomes one call, `reconcileDepositLeg(rec, id)`:
  narrate "looking for the deposit on Ethereum"; on `{ txHash }` write it with
  `patchRecordWhen(id, (live) => !live.depositTxHash, { depositTxHash })` and continue into
  `attemptLegRecovery` on the re-read record (its receipt-log read then recovers the leaves as today);
  `"none"` → `attention: "error"`, "No deposit for this record was found on Ethereum since it was
  started. If you never confirmed it in your wallet, discard this record."; `"ambiguous"` →
  `attention: "unknown-outcome"`, "More than one matching deposit was found — not guessing. Check your
  wallet activity, then discard."; `"incomplete"` → `attention: "error"`, "Ethereum could not be
  searched far enough back — try again later."
- **Affordance**: `record-policy.ts` `depositLegRecoverable` = `depositing` && (`depositTxHash` ||
  (`schema === 3` && a token block)); the button stays CLAIM. Card copy for the hash-less shape: "The
  deposit was never confirmed here. Press CLAIM to look for it on Ethereum; discard if you never sent it."

### C — attach a hash-less exit by its recomputed commitment

- **Scope**: send exit records (`isSendRecord`, `stage === "exiting"`, no `exitTxHash`).
- **Helper** (`exit-attach.ts`): `findExitTx(rec, node, taken, opts)` over a narrow node interface
  (`getNodeInfo`, `getBlockNumber`, `getBlocks`, `getTxEffect`):
  1. **Message hash**: `computeL2ToL1MessageHash({ l2Sender: rec.bridge, l1Recipient: rec.token.portal, content: withdrawContentHash(rec.recipientL1, amount, ZERO_L1), rollupVersion, chainId })`
     — `rollupVersion`/`l1ChainId` from `getNodeInfo()`, asserted equal to the record's `chainId` and
     the build's `chain-constants`.
  2. **Window**: L2 blocks with `timestamp ≥ createdAt/1000 − slack`, located by binary search over
     block timestamps, read with `getBlocks(from, limit)` (batched; bodies included); capped; pruned or
     unreadable history ⇒ `"incomplete"`.
  3. **Scan**: a tx is a candidate only if `l2ToL1Msgs[0] === hash` — index zero, because every reader
     of the exit (`consumeWithdrawal` `flows.ts:222`, `expectedWitness` `useHubExit.ts:189`,
     `consumedElsewhere`) takes index zero; a match elsewhere in the tx is not this app's exit shape.
  4. **Attribution**: drop candidates whose hash is in `taken` (every `exitTxHash` and every record id
     the journal holds — an identical earlier exit this browser recorded). Exactly one left →
     `{ exitTxHash, exitBlock }`; none → `"none"`; more → `"ambiguous"`. Uniqueness inside the window is
     the best evidence available, not provenance: an identical exit from another device, or an earlier
     identical exit that was discarded, is indistinguishable. Accepted because the message pays
     `rec.recipientL1` whatever produced it (see Security) — one of the explicit approval decisions.
- **Dep** `findExitTx?(rec, taken: ReadonlySet<string>) → Promise<{ exitTxHash; exitBlock } | "none" | "ambiguous" | "incomplete">`,
  wired in `useHubExit.ts` with the node client.
- **Engine**: the dead `!rec.exitTxHash` branch in `runWithdrawConsumeLocked` becomes one call,
  `attachExit(rec, id)`, which RETURNS instead of continuing: on a match it re-verifies
  (`getTxEffect(exitTxHash).data.l2ToL1Msgs[0] === hash`), re-reads the live record (still present, still
  hash-less), refuses if a record with id `exitTxHash` already exists (`rekeyRecord` would overwrite it,
  `journal.ts:389-393`), then `rekeyJournalRecord(id, { ...live, id: exitTxHash, exitTxHash, exitBlock })`
  and returns `{ rekeyedTo: exitTxHash }`. `runWithdrawConsumeInner` releases the OLD id's lock and calls
  `runWithdrawConsume(rekeyedTo)` — the consume runs under the canonical id's lock, so runtime writes,
  `inFlight` and a second FINISH click all key on the live record (the live-path precedent:
  `useHubExit.ts:512-520` re-keys, then `runWithdrawConsume(finalId)`). `"none"` → `attention: "error"`,
  "No exit matching this record was found on Aztec since it was started. If your wallet never sent
  it, discard this record."; `"ambiguous"` → `attention: "unknown-outcome"`, "More than one matching
  exit was found — not guessing. Check your wallet activity, then discard."; `"incomplete"` →
  `attention: "error"`, "Aztec could not be searched far enough back — try again later."
- **Affordance**: `record-policy.ts` gains `exitAttachable = withdraw && stage === "exiting" && schema === 3 && actionable && !busy`,
  and `showFinish` includes it; the label stays FINISH. `resumeActionFor` keeps skipping hash-less
  exits (click-driven). Card copy: "The exit was interrupted. Press FINISH to look for it on Aztec;
  discard if your wallet never sent it."
- After attach, the existing tail handles "someone already finished it on L1" (`consumedElsewhere` →
  `consumedByOther`), now guaranteed to read the same index-zero message the attach verified.

### Data & control flow (critical paths)

```
A  CLAIM click → runDepositClaim(interactive) → resolvePrivateClaimMaterial (unseal on click)
     → probeClaimedElsewhere: recompute message hash == rec.messageHash → nullifier → witness?
     → yes ⇒ claimedByOther + completeDeposit (no fee build)   |  no/null ⇒ buildClaimHandles → gates
     → awaitConsumable: "already nullified" ⇒ re-ask ⇒ claimed-elsewhere | ready | timeout | error (as today)

B  CLAIM click → runDepositClaimLocked → recoverLegIfNeeded: no depositTxHash → reconcileDepositLeg
     → deps.findDepositTx(rec): window → getLogs(router, event) → secret-hash post-filter
     → getTransaction → decode → match calldata → receipt success + canonical block
     → one ⇒ patchRecordWhen(no hash yet, {depositTxHash}) → attemptLegRecovery (existing) → claim (existing)

C  FINISH click → runWithdrawConsumeLocked: no exitTxHash → attachExit
     → deps.findExitTx(rec, taken): message hash → block window → l2ToL1Msgs[0] scan → one unclaimed
     → re-verify effect, live record hash-less, destination id free → rekeyJournalRecord → return {rekeyedTo}
     → runWithdrawConsume(rekeyedTo) (new lock) → exitConsume (existing) → done / consumedByOther
```

### Interfaces (new)

```ts
// useBridgeJournal.ts — JournalEngineDeps additions
messageNullified?: (rec: SendDepositRecord, material: { secretHex: string; envelope?: DepositEnvelopeV2 }) => Promise<boolean | null>
findDepositTx?: (rec: SendDepositRecord) => Promise<{ txHash: string } | "none" | "ambiguous" | "incomplete">
findExitTx?: (rec: SendWithdrawRecord, taken: ReadonlySet<string>) => Promise<{ exitTxHash: string; exitBlock: number } | "none" | "ambiguous" | "incomplete">

// journal.ts (bridge-core) — additive fact
DepositJournalRecord.claimedByOther?: boolean

// lib/message-nullifier.ts (pure)
recomputeTokenMessageHash(i: { portal; chainId; hub; rollupVersion; recipient; amount; isPrivate; secretHashHex; leafIndex }): Promise<Fr>
tokenMessageNullifier(i: { consumer: string; messageHash: Fr; secretHex: string; isPrivate: boolean; recipient: string }): Promise<Fr>
```

### Algorithms / non-obvious mechanics

- **Block window by timestamp** (B and C): binary search `lo=0..hi=latest` on `getBlock(n).timestamp`
  for the first block ≥ `createdAt/1000 − slack`; O(log n) RPC reads; the scan cap bounds the
  worst case. Anvil/local networks mine sparsely; the search handles gaps by comparing timestamps only.
- **Ambiguity** (B): two router txs with identical calldata (same secret hash) ARE two valid deposits
  (the leaf index is part of each message hash, `messaging.nr:19-27`) claimable with one secret; the
  record can only ever be one of them — refuse as ambiguous, both need manual handling. (C): identical
  exits (same portal/recipient/amount) produce identical message hashes; the `taken` set removes exits
  this journal already owns; anything still plural is refused.
- **Search completeness** is its own outcome: a cap, pruned history or a failed read never reads as
  "nothing was sent".
- **Conditional writes**: all three writes happen after awaits; each re-reads the live record and
  applies only if the fact is still absent (`patchRecordWhen`) or, for the re-key, if the provisional
  record is still present and hash-less.
- **Gen bookkeeping**: the new branches run inside the existing `withRecordLock` + `bumpGen` owners;
  no new lanes.

### Trade-offs & alternatives not taken

- **Paste-a-hash instead of scanning** (competing outline below): cheaper, no window logic, but the
  user rarely has a hash, and the cells could only prove the verification, not the recovery.
- **Background reconciliation on reload**: rejected — the journal's prompt-free/session-scoped resume
  rules (`resumeActionFor`) exist so a reload never starts chain work the user did not ask for; a
  click is the consent for a scan as it is for an unseal.
- **Reusing the fee-bearing claim build as the consumed proof**: the wart codex found in
  tools-readiness (a consumed FUEL message reads as token consumed); rejected for the nullifier read.
- **Putting the helpers in `packages/bridge-core`**: they depend on viem/node clients the app already
  owns and on journal record shapes; kept in `apps/tools` with unit tests over fakes. `journal.ts`'s
  additive field is the only bridge-core change.

## Competing outline — "verify what the user pastes"

A stays as above (nothing to paste). B and C become input fields on the card: "Paste the transaction
hash" → the existing verifiers run: for a deposit `recoverDepositLeg` (receipt logs must decode to this
record's leaves — note `readSendReceiptLeaves` checks event structure only, `send-flow.ts:365-371`,
so the calldata check on (router, token, amounts, secret hashes, recipients) is the identity verifier) for an exit `expectedWitness` + a tx-effects check that the
recomputed message hash is in that tx. Pros: no block windows, no scans, no ambiguity logic, ~40%
of the code. Cons: users of a bridge UI do not have Aztec tx hashes at hand (the wallet that swallowed
the reply is the one that has it); the cells can only exercise the verifier with a hash the fixture
extracts; two identical exits are still ambiguous to the user. Verdict deferred to the audits; the
draft prefers the scan, and keeps the paste as a possible later fallback UI (out of scope here).

## Security & Adversarial Considerations

- **Threat model**: the journal (localStorage) and imported recovery files are attacker-influenced
  input; the L1 RPC and the Aztec node can be slow, stale, pruned or lying; a relayer, another tab or
  another device is a legitimate competing claimer/finisher; a re-org can orphan a just-found tx.
- **Trusted-node boundary (explicit decision)**: the app already decides every stage, claim and finish
  from `NODE_URL`'s answers (receipts, checkpoints, tx effects); A adds one more read of the same node.
  A node fabricating a nullifier witness could mark a claimable deposit done — the same node could
  already misreport a receipt as success. This plan keeps that boundary and does not add a second
  source; it is surfaced at the approval gate as a decision, not silently assumed.
- **A cannot mint "done" from journal data**: the message hash is recomputed from the record's facts
  (portal, chain, hub, version, recipient/amount from the envelope for private, secret hash, leaf
  index) and must equal the stored one; the nullifier is a function of that hash and the claim secret.
  A hostile record pairing another consumed message's hash and secret with different displayed facts
  fails the recompute; a record that carries a consumed message's true facts and secret was that
  deposit's bearer already. Gas-only and legacy records never reach the read (`null`). A consumed FUEL
  message cannot read as a consumed TOKEN message: the read is per message hash.
- **B cannot attach a foreign deposit**: the match binds the record's own secret hash(es) in the event
  and again in calldata, plus entrypoint, token, portal, recipients, all amounts (including
  `minFuelOutput`) and privacy; a copied public secret hash on another token or amount fails the
  calldata check. Knowing public calldata does not yield the secret; a record that copies every field
  of a public deposit including its secret is that deposit's bearer. The write happens only after a
  successful receipt on a canonical block; a re-orged tx reads as `"incomplete"`.
- **C cannot redirect funds**: the L2→L1 message commits to `rec.recipientL1` (caller `ZERO_L1`); a
  foreign exit with the same content pays the same recipient. Only index-zero matches count (the shape
  every reader of the exit assumes). **Attribution (explicit decision)**: two hash-less records, an
  identical exit discarded earlier, or an identical exit from another device cannot be told apart from
  chain data; `taken` removes what this journal owns, anything still plural is refused, and a single
  survivor is attached because the destination is the same either way. The residual is bookkeeping (a
  real exit left untracked while a twin is attached), not loss.
- **Re-key safety**: attach refuses when a record with id `exitTxHash` already exists (the primitive
  overwrites destinations), re-reads the live record before writing, and hands execution to the new
  id's lock; the old id's `inFlight` entry is released, so no duplicate runner and no permanently busy
  card.
- **No new prompts**: the only signature in any path stays the existing unseal on CLAIM; the
  same-session auto-resume that may raise a grant prompt (`resumeActionFor`) is pre-existing and not
  widened; the new branches have no prompting call and a unit test pins the non-interactive `null`.
- **Least privilege / supply chain**: no new dependencies; stdlib helpers already installed (7-day
  min-age unchanged); no CI/token changes.
- **Logging**: secrets and nullifiers never reach `log(...)`; ids, stages, hashes and block numbers only.
- **DoS / latency**: scans are bounded (block caps, chunked `getLogs`, one `getTransaction` per
  post-filtered candidate, batched `getBlocks`); a runaway RPC surfaces as `"incomplete"` with its own
  copy, never a hang.
- **Input validation**: every chain value is parsed through the existing hex/address validators
  before comparison; filters use the router address and the ABI event, never free text.

## Assumptions

**Facts (verified)**
1. Nullifier formula: aztec-nr v5.0.1 `hash.nr:51-53` and `private_context.nr:890-910`
   (`consume_l1_to_l2_message` → `process_l1_to_l2_message`, `messaging.nr:15-32`); public consumption
   asserts `"L1-to-L2 message is already nullified"` (`public_context.nr:259`); TS
   `computeFeeJuiceMessageNullifier` (`stdlib/messaging/l1_to_l2_message.js:74-79`) is the same
   poseidon2 with `DomainSeparator.MESSAGE_NULLIFIER = 3754509616`; `siloNullifier` at
   `stdlib/hash/hash.d.ts:46`; `getNullifierMembershipWitness` at `interfaces/aztec-node.d.ts:64`.
2. The message hash's seven inputs (`messaging.nr:19-27`): portal, chain id, consumer, version,
   content, secret hash, leaf index; TS `L1ToL2Message(sender: L1Actor, recipient: L2Actor, content,
   secretHash, index).hash()` (`l1_to_l2_message.d.ts:24-41`); contents `mintToPublicContentHash` /
   `mintToPrivateContentHash` (`content-hash.ts:49-54`, `main.nr:243,264`).
3. The hub consumes `[secret]` (`main.nr:244`) and, for private, `derive_claim_secret(claim_salt, recipient)`
   (`main.nr:264-271`), mirrored by `deriveTokenClaimSecret` (`claim-secret.ts:46-47`); the value the app
   hands the hub is the salt (`hub-l2.ts:218`, `deposit-flow.ts:350`; `useSend.ts:877-879`).
4. Today's consumed path: `awaitConsumable` rethrows (`useBridgeJournal.ts:1118`) → `surfaceRunFailure`
   (`:769-774`); `recordMessageConsumed` (`:1313-1329`) rebuilds the claim via `buildClaimHandles`;
   `isMsgConsumed` (`:63-64`) matches `No non-nullified L1 to L2 message found|message has already been nullified`
   and MISSES the public wording; `claimsThroughHub` at `:860`; `resumeActionFor` `:1440-1453`.
5. Router events omit token/portal (`SwapBridgeRouter.sol:84-97`); calldata carries them
   (`router-abi.ts:6-122`); the send publishes a ZERO recipient for private token deposits
   (`send-flow.ts:150-154`), `totalAmount = p.amount` with the journal's `amount = total − fuel`
   (`send-flow.ts:180`, `SendWizard.vue:890`), entrypoints per intent (`send-flow.ts:112-116`);
   `readSendReceiptLeaves` checks event structure only (`send-flow.ts:365-371`). Production precedent
   for `getTransaction` + `decodeFunctionData`: `useHubExit.ts:264-286`.
6. viem 2.55 drops `args` when `events` is passed (`getLogs.js:35`).
7. `recoverLegIfNeeded` bails without a hash (`useBridgeJournal.ts:937-940`); `record-policy.ts:92-94`
   hides CLAIM for that shape; the copy lives at `BridgeJournalCard.vue:172`; `recoverDepositLeg`
   refuses non-send records (`deposit-flow.ts:286`).
8. `computeL2ToL1MessageHash` (`stdlib/hash/hash.d.ts:121`) + `withdrawContentHash`
   (`content-hash.ts:58-61`, mirrors `main.nr:290,307`); the exit's caller is `ZERO_L1`
   (`useHubExit.ts:382-389`); every reader takes `l2ToL1Msgs[0]` (`flows.ts:222`, `useHubExit.ts:189`);
   `IndexedTxEffect.data.l2ToL1Msgs` (`tx_effect.d.ts:38`); `getBlocks(from, limit)`
   (`aztec-node.d.ts:186-189`); `NodeInfo.rollupVersion`/`l1ChainId` (`node-info.d.ts:17-19`).
9. A hash-less exit is `exiting`, FINISH hidden (`record-policy.ts:95`), the `unknown-outcome` branch
   at `useBridgeJournal.ts:1404-1410` is unreachable from the UI; a live exit is re-keyed to its hash
   then re-run under the new id (`useHubExit.ts:512-520`); `rekeyRecord` drops any record whose id
   equals the new id (`journal.ts:389-393`); `withRecordLock` keys `inFlight` by id (`useBridgeJournal.ts:625-642`).
10. Conditional-write primitive: `patchRecordWhen` (`journal.ts:373-386`), used at
    `useBridgeJournal.ts:1214-1234` and `:1242-1281`.
11. Deps wiring and fakes: `JournalEngineDeps` (`:138-219`), `ensureSendJournalDeps` (`useSend.ts:228-254`),
    `ensureHubExitDeps` (`useHubExit.ts:289-308`), `baseDeps`/`smartClaimFake`
    (`useBridgeJournal.test.ts:123-155`).
12. The pinned cells: 24b `recovery.spec.ts:117-172`, 26d `l1-wallet.spec.ts:14-59`, 31b
    `exits.spec.ts:123-172`; the L1 fixture's `holdNext` parks BEFORE sending
    (`fixtures/l1-wallet.ts:131-137`, `:165-178`); the test wallet's `swallowNext` runs the call and
    never answers (`test-wallet/main.ts:83-89`).
13. Real commands: `bun run --cwd apps/tools test`, `bun run --cwd packages/bridge-core test`,
    `bun run --cwd apps/tools typecheck`, `bun run e2e:tools -- [--shard=i/n | specs/<file>]` (retry 0
    by default: `NULO_E2E_RETRIES`), `bun run test:all`, `bun run lint`, `bun run lint:actions`.

**Inferences (unverified — the audits should attack)**
- The hub's siloed nullifier equals `siloNullifier(rec.bridge, poseidon2([messageHash, secret], MESSAGE_NULLIFIER))`
  in both the private and the public claim (fable verified the two contexts; cell 24b — a relayer's
  public claim, then the page's CLAIM → done — is the end-to-end proof at retry 0; a unit vector pins
  the formula).
- `getNullifierMembershipWitness("latest", …)` answers on the sandbox node through the app's node
  client (no PXE).
- viem `getLogs` with one `event` over the window sizes involved returns in one call on anvil;
  public testnet RPCs cap ranges (~10k blocks) — the helper chunks.
- `getBlocks(from, limit)` returns bodies with tx effects for a same-day window on the local
  network and on testnet nodes that keep history; a pruned node answers `"incomplete"`.
- Re-keying then re-running under the new id preserves the live path's card/foreground behaviour
  (`rekeyJournalRecord` carries runtime, session-live and the foreground id; the live exit does the
  same at `useHubExit.ts:512-520`).
- The L1 fixture's `swallowNext("transaction", { to })` can broadcast through viem while parking the
  page's promise (the transaction is sent, the page never hears back) — the twin of the L2 wallet's
  `swallowNext`; it is what makes 26d's flip a real reconcile.

**Asks** — two decisions the approval gate settles explicitly (both recommended "accept"):
- **Trusted node / finality**: A reads the nullifier at `latest` from the app's existing node; no
  second source, no finality wait (the app already trusts this node for receipts and stages).
- **Exit attribution**: a single surviving candidate is attached even though an identical exit from
  another device or a discarded twin is indistinguishable; the funds pay the same `recipientL1`.

Delegated to the implementer (logged codex consults): the window slack and caps; whether
"ambiguous" copy names the count; where the L1 `swallowNext` fixture lives.

## Phases

Three arcs, one per fix, stacked. Unit tests are inline with each change.

### Arc 1 — consumed → done (`worktree-tools-recovery`)

#### Phase 1: The nullifier helper, the dep, the two engine branches
- `apps/tools/src/lib/message-nullifier.ts` + test (public and private vectors; the private vector
  derives the secret; a wrong secret yields a different nullifier).
- `journal.ts`: `claimedByOther?: boolean` (+ the loader's schema test if one enumerates fields).
- `useBridgeJournal.ts`: `messageNullified` dep; `probeClaimedElsewhere` before `buildClaimHandles`;
  `classifyConsumable` split out of `awaitConsumable` (tri-state); `isMsgConsumed` gains the public
  wording; `recordMessageConsumed` reads the nullifier; `completeClaimedByOther`. Tests: (a) public
  claim, witness present ⇒ done with the fact, no fee build, no `claimTxHash`, `sendTx` never called;
  (b) private record, secret cached ⇒ the derived secret's nullifier, done; (c) witness absent ⇒ the
  claim proceeds as today; (d) the simulate throws either consumed wording, witness present ⇒ done;
  witness absent ⇒ error as today; (e) private, non-interactive, no cached secret ⇒ `null`, no prompt,
  today's note; (f) a token+gas record whose FUEL message is nullified but the TOKEN message is not ⇒
  not done (the readiness wart, pinned); (g) a record whose stored `messageHash` does not recompute
  from its facts ⇒ `null`, never a lookup; (h) gas-only and schema-2 records ⇒ `null`; (i) the resumed
  claim with a success receipt uses the nullifier, not the claim build (`smartClaimFake` re-pinned).
- `useSend.ts`: wire the dep (node client + hub address).
- **Validation gate**: `bun run --cwd apps/tools test -- src/lib/message-nullifier src/composables/useBridgeJournal`
  green; `bun run --cwd packages/bridge-core test -- src/journal` green; `bun run --cwd apps/tools typecheck`
  exit 0; `bun run lint` exit 0. Layers: lint · unit.

#### Phase 2: Card copy + cell 24b flipped
- `BridgeJournalCard.vue`: the done-by-another line; `record-policy` untouched for A.
- `recovery.spec.ts` 24b: title and assertions → after the relayer's claim, the reloaded record's
  CLAIM click ends `data-stage="done"`, `claimedByOther: true` in storage, `sendTx` count 0, credited
  exactly once; a `journalStep`/copy assertion for the done-by-another line.
- **Validation gate**: Phase 1 commands; `bun run e2e:tools -- specs/recovery.spec.ts` (own sandbox,
  retry 0) all cells green. Layers: lint · unit · e2e.
- **Arc boundary**: `bun run e2e:tools -- --shard=1/2` ∥ `--shard=2/2` (own sandboxes, retry 0) both
  exit 0; then the codex loop on the arc-1 diff; then `gh stack add tools-recovery/deposit-reconcile`.

### Arc 2 — reconcile a hash-less deposit (`tools-recovery/deposit-reconcile`)

#### Phase 3: The L1 finder
- `deposit-reconcile.ts`: `findDepositTx` over a narrow client interface (the fake encodes viem's real
  signatures: one `event` per `getLogs`, `getTransaction`, `getTransactionReceipt`, `getBlock`); tests:
  window search over sparse timestamps; a matching `bridge` tx; a `bridgeWithFuel` tx for a token+gas
  record (`totalAmount = amount + fuel`, `minFuelOutput`); a PRIVATE deposit (zero event recipient) found
  by its secret hash; a copied secret hash on another token or amount rejected at calldata; two
  matches ⇒ `"ambiguous"`; none ⇒ `"none"`; the cap, a failed read, or a non-canonical receipt ⇒
  `"incomplete"`.
- **Validation gate**: `bun run --cwd apps/tools test -- src/composables/deposit-reconcile` green;
  typecheck; lint. Layers: lint · unit.

#### Phase 4: Engine branch, affordance, copy, cell 26d flipped
- `useBridgeJournal.ts`: `findDepositTx` dep; `reconcileDepositLeg` from `recoverLegIfNeeded`;
  tests: found ⇒ hash written once (`patchRecordWhen`), then leg recovered and the claim proceeds;
  a record discarded meanwhile ⇒ no write; a hash written by another tab meanwhile ⇒ no overwrite;
  none / ambiguous / incomplete ⇒ their notes; a gas-only or schema-2 record ⇒ today's bail.
- `useSend.ts`: wire with the viem public client + `SEND_GENERATION`. `record-policy.ts`:
  `depositLegRecoverable` for hash-less `schema === 3` token records only (+ tests for both sides).
  Card copy.
- `fixtures/l1-wallet.ts`: `swallowNext("transaction", { to })` — the request is BROADCAST through
  viem and the page's promise parks (today's `takeHold` parks before sending); `holdsArmed` covers
  it; `calls`/`signatures` count it.
- `l1-wallet.spec.ts`: 26d → the router tx swallowed → reload → CLAIM finds it → claim lands → done;
  a 26e keeps today's Discard-only shape for a tx that was truly never sent (hold, no swallow):
  CLAIM → "not found" note → Discard.
- **Validation gate**: Phase 3 commands + `src/composables/useBridgeJournal src/lib/record-policy`;
  `bun run e2e:tools -- specs/l1-wallet.spec.ts` green at retry 0. Layers: lint · unit · e2e.
- **Arc boundary**: the two shards; codex loop on the arc-2 diff; `gh stack add tools-recovery/exit-attach`.

### Arc 3 — attach a hash-less exit (`tools-recovery/exit-attach`)

#### Phase 5: The L2 finder
- `exit-attach.ts`: `findExitTx` over a narrow node interface (`getNodeInfo`, `getBlockNumber`,
  `getBlocks`, `getTxEffect`); tests with a fake node: the recomputed hash equals a vector from
  `withdrawContentHash` + `computeL2ToL1MessageHash`; one index-zero match ⇒ `{ exitTxHash, exitBlock }`;
  a match at index 1 ignored; a taken hash excluded; two ⇒ `"ambiguous"`; none; the cap / a pruned
  block ⇒ `"incomplete"`; a chain-id/version mismatch ⇒ `"incomplete"`.
- **Validation gate**: `bun run --cwd apps/tools test -- src/composables/exit-attach`; typecheck; lint.

#### Phase 6: Engine branch, affordance, copy, cell 31b flipped
- `useBridgeJournal.ts`: `findExitTx` dep; `attachExit` replaces the dead `unknown-outcome` branch and
  returns `{ rekeyedTo }`; `runWithdrawConsumeInner` re-enters under the new id; tests: attached ⇒ the
  consume runs under the NEW id's lock ⇒ done, the old id holds no runtime/busy state; a second FINISH
  click during the consume is refused by the new id's lock; attached but already finished on L1 ⇒
  `consumedByOther`; none/ambiguous/incomplete notes; a record discarded meanwhile ⇒ no re-key; a
  record whose id equals the found hash already exists ⇒ refused; the re-verify of the tx effect
  failing ⇒ `"incomplete"`.
- `useHubExit.ts`: wire with the node client. `record-policy.ts`: `exitAttachable` → FINISH shown
  (+ test). Card copy.
- `exits.spec.ts`: 31b → the swallowed private exit → reload → FINISH → attached → consume → done;
  credit charged once; no second burn; `exitTxHash` in storage equals the burn the wallet reported
  (`walletCalls`/`submitted`).
- **Validation gate**: Phase 5 commands + the journal/policy tests; `bun run e2e:tools -- specs/exits.spec.ts`
  green at retry 0; then the FULL tools suite in two shards (retry 0); `bun run test:all` exit 0;
  `bun run lint && bun run lint:actions` exit 0. Layers: lint · unit · e2e.
- **Arc boundary**: codex loop on the arc-3 diff; then the cross-arc pass; then Delivery.

## Post-implementation (self-contained; executed by the implementing session)

`code_review: off` — `/code-review` is NOT run at any point.

For each arc, at its boundary (phases green, before `gh stack add` of the next arc):
1. **Codex audit** (`/codex high`, `~/.claude/skills/codex/scripts/run-codex.sh`, read-only): the
   arc's diff (`git diff <base>...<arc-branch>`), this plan + the decision ledger, the arc map ("arc N
   of 3; later arcs add …"), the adversarial/security ask (what could go wrong, what an attacker
   targets, what is trusted that should not be), and the two rules below verbatim.
2. **Iterative fix loop**: verify each finding against the repo, apply the accepted fixes, commit on
   the arc branch, log the round (consult + verdict) in `lessons/phase-N.md`, then RESUME the same
   session (`resume-codex.sh`) with the fix diff. Repeat until a round reports no new material
   findings. Still material after 3 rounds → stop and surface to the owner (log it; the owner decides
   whether to run on).
3. After all three arcs: one FRESH codex session over `git diff origin/dev...tools-recovery/exit-attach`
   asking for cross-arc issues (seams, duplication, drift from this plan) — same loop.
4. **Delivery** (below) — the first time any PR is opened.

Rules, verbatim in every codex prompt:
- No over-engineering: "Report bugs and small, targeted improvements only. Do not propose speculative
  abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes
  each real problem. If code works and is clear, leave it alone."
- Comment quality: "Audit the comments for value per character. Flag any comment that narrates what
  the code visibly does, restates its line, references implementation plans / phases / reviews, or
  spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future reader,
  human or LLM, pays to re-read: they must be few, dense, and exact."

Standing constraints for the implementing session: no wallet-sdk patches; nothing under
`apps/extension/**`; never `pkill -f anvil`; the tools suite runs on its own sandbox; commitlint
(≤100-char header, lower-case subject); trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`;
PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; hard limits:
never merge, publish, rewrite shared history, or add a resubmission path to any record.

## Delivery

Three stacked PRs via `gh stack` (installed):

| Arc | Branch | Phases | Stacks on | code_review |
|---|---|---|---|---|
| 1 consumed → done | `worktree-tools-recovery` | 1–2 | `dev` | off |
| 2 deposit reconcile | `tools-recovery/deposit-reconcile` | 3–4 | arc 1 | off |
| 3 exit attach | `tools-recovery/exit-attach` | 5–6 | arc 2 | off |

- `gh stack init --base dev worktree-tools-recovery` at the arc-1 boundary; `gh stack add <branch>` at
  each later boundary; PRs only after the cross-arc pass: `gh stack submit --auto`, then `gh pr ready`
  each (submit creates drafts), `gh pr edit` bodies, `gh pr checks --watch`. After any sync/rebase the
  affected arcs' local gates re-run on the new SHA. Merging is the owner's (`gh stack merge`), unless
  the owner instructs otherwise in the session.
- PR titles (≤ 93 chars, conventional): `feat(tools): a claim another submitter made finishes as done, proven by the message nullifier`
  / `feat(tools): reconcile a hash-less deposit from its router transaction` /
  `feat(tools): attach a hash-less exit by its recomputed l2→l1 message`.
- Close-out: `implementations-plan/index.md` row → merged; `tools-self-testing/readiness.md` § 4 rows
  → fixed; `agent-worktree done tools-recovery` after the merge.

## Autonomy

Decision points the implementer settles with a logged codex consult (no owner wait): window slack and
caps; the exact copy of the three notes; whether the L1 `swallowNext` fixture belongs in
`fixtures/l1-wallet.ts` or a sibling. Surface to the owner and hold: any change to the prompt rule, any
new persisted field beyond `claimedByOther`, any resubmission path, a third codex round still material.

## Audit verdicts

| Leg | Round | Verdict | Where |
|---|---|---|---|
| codex (Astra, high) | 1 on v1 | **reject** — 14 findings (5 High security, 2 Facts, 3 Inferences, 1 Ask, 3 Implementation) | `audit-codex.md` (transcript + triage: 12 adopted, 1 rejected as pre-existing by design, 1 partly) |
| fable (Plan subagent) | 1 on v1 | **conditional approve** — S1 silo/secret by record shape, S2 `getLogs` args, I1 re-key outside the old-id lock, fact corrections | `audit-fable.md` (all four conditions adopted) |
| codex | 2 on v2 | _pending_ | |
| codex (fresh session) | final on the consolidated plan + ledger | _pending_ | |

### Decision ledger

| Decision | Chosen | Rejected / alternatives | Why |
|---|---|---|---|
| B/C discovery | scan the chain from the record's own facts | paste-a-hash UI (competing outline); codex's hybrid "scan + verified-hash fallback" | users of a bridge UI rarely hold the hash; the cells prove the recovery only with the scan; the paste fallback stays a possible later UI (out of scope) — fable agrees, codex prefers the hybrid (recorded as the one open disagreement) |
| A's identity | recompute the message hash from record facts and require equality with the stored one | trust `rec.messageHash` (v1) | a hostile record could pair a foreign consumed message with different display facts (codex #1) |
| A's scope | hub token sends only; gas-only/legacy answer `null` | "all deposits" (v1) | their consumer and secret schemes differ (fable S1); fail closed |
| A's probe order | nullifier read BEFORE the fee build; the simulate error is the second chance | after the simulate only (v1) | fee construction can stop earlier and the public wording was missed (codex #9) |
| B's candidate filter | router + one event, post-filter on the secret hash | `aztecRecipient` arg (v1) | private deposits publish a zero recipient; viem drops `args` with `events` (codex #6/#8, fable S2) |
| Search outcomes | `none` / `ambiguous` / `incomplete` | `none` for caps and failures (v1) | "search incomplete" must never read as "nothing was sent" (codex #10) |
| C's match position | index zero only | anywhere in `l2ToL1Msgs` (v1) | every reader of the exit takes index zero (codex #2) |
| C's attribution | refuse anything plural; attach a single survivor; residual accepted | treat window uniqueness as provenance (v1 wording) | identical exits are indistinguishable; the destination is the same (codex #3, fable S3) → explicit approval decision |
| Attach + lock | `attachExit` returns `{ rekeyedTo }`; re-run under the new id | continue under the old id (v1) | `inFlight` and runtime keyed by the dead id; the live exit already re-keys then re-runs (codex #4, fable I1) |
| Trusted node | keep the app's existing single-node boundary; surface as a decision | a second source / finality wait | no second source exists in the app; a lying node already controls every stage (codex #11) |
| Prompt rule on same-session resume | leave as is (pre-existing, session-scoped by `resumeActionFor`) | gate `ensureTokenGrant`/`resolvePrivateClaimMaterial` on `interactive` everywhere (codex #5) | the journal's stated exception ("auto-continue ONLY what this page session initiated"); out of scope; the new branches add no prompt and a test pins the non-interactive `null` |

**Still disputed**: codex's hybrid (scan + verified-hash fallback) vs the plan's scan-only. The plan
ships scan-only; the owner can add the paste fallback as a follow-up.

## Seeds

_(drafts until approval; finalized after)_

```
/goal All 6 phases marked ✓ in implementations-plan/tools-recovery/plan.md (the per-phase headers — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript (each local suite run quoted with its retry-0 tally and the SHA it ran on); for each phase the agent has printed `LESSONS_FILE=implementations-plan/tools-recovery/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the codex fix loop converged for each of the three arcs at its boundary AND for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript), each PR's checks watched to a settled PASSING state with the result quoted, and after any sync or rebase the affected arcs' local gates re-run on the new SHA before the re-watch; `bun run test:all` and `bun run lint && bun run lint:actions` both report exit 0 in the transcript on the final SHA; implementations-plan/index.md's tools-recovery row reads "stack open"; every decision point was settled by a logged codex consult or surfaced per plan.md § Autonomy. Merging is the owner's and is not part of this goal.
```

```
/loop 15m Drive implementations-plan/tools-recovery forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/tools-recovery/plan.md and lessons/ (authoritative — not the chat); native task list empty? rebuild it from plan.md, one task per remaining step; `git status`, `git log --oneline -5`; if PRs exist, `gh stack view` and `gh pr checks <n>` (no --watch).
2. Waiting on CI is fine — confirm it progresses; use the wait to prep the next phase. Local suites: the tools suite on its own sandbox (`bun run e2e:tools -- …`), retry 0; shard the arc-boundary runs (`--shard=1/2` ∥ `--shard=2/2`); never `pkill -f anvil`.
3. No task in hand? Take the next pending phase from plan.md. After each meaningful edit run `bun run lint` and `bun run --cwd apps/tools test -- <touched files>`; commit (conventional, ≤100-char lower-case header, the Co-Authored-By trailer) → push (`gh stack push` once the stack exists).
4. Stuck or at a decision you'd bring to me? Call `/codex high` with full context, settle it, act, log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, publish, rewrite shared history, add a resubmission path, change the prompt rule, or touch apps/extension.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue on the agreed path.
6. Phase green = its validation gate in plan.md passes: run it, paste the tally + SHA, mark ✓ in plan.md, write lessons/phase-N.md, print `LESSONS_FILE=implementations-plan/tools-recovery/lessons/phase-N.md`. Arc boundary? codex loop on the arc diff (no /code-review) until a round yields nothing material (3 rounds still material → surface), THEN `gh stack add <next-arc-branch>`.
7. All 6 phases ✓? Final cross-arc codex pass (fresh session, net diff from origin/dev), then Delivery per plan.md: `gh stack submit --auto`, `gh pr ready` ×3, bodies, `gh pr checks --watch`; then the wrap-up report (what shipped, every contentious decision with ELI5 context, open items). Surface and stop. Merging is mine.
Keep the native task list current; plan.md stays the source of truth.
```
