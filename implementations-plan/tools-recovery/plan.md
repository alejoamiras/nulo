---
plan: tools-recovery
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
codex_effort: high
recon_budget: 2 agents (batched reuse sweep + journal mapper), default
status: draft v1 (2026-09-11) — awaiting the dual audit
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
- A. `claimedByOther`: the token message's own nullifier read from the node; a nullified message
  finishes the deposit as done with a persisted fact, for public and (on click) private deposits.
- B. Deposit reconcile: a hash-less send record finds its router transaction on L1 by recipient,
  bounded by chain time, matched on calldata (function, token, portal, amounts, secret hashes,
  privacy); exactly one match writes `depositTxHash`; the existing leg recovery then runs.
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

- **Nullifier** (`message-nullifier.ts`): `tokenMessageNullifier({ hub, messageHash, secretHex, isPrivate, recipient })` →
  `siloNullifier(hub, computeFeeJuiceMessageNullifier(messageHash, secret))` where `secret` is the
  record's public secret, or `deriveTokenClaimSecret(salt, recipient)` for a private record (the salt
  is the envelope's `secret`; `claim_private` derives the consumed secret the same way — `main.nr:265-271`,
  `claim-secret.ts:46-47`). The formula is aztec-nr's `compute_l1_to_l2_message_nullifier`
  (`hash.nr:51-53`): poseidon2 over `[message_hash, secret]` with `DOM_SEP__MESSAGE_NULLIFIER`; the leaf
  index is not an input. The hub's nullifier is siloed by the hub address by the kernel, so the tree
  lookup uses the siloed value.
- **Dep** `messageNullified?(rec: ClaimRecord): Promise<boolean | null>`: builds the nullifier from
  `rec.messageHash` + the secret the engine already resolved (public: `publicClaimSecretOf`; private:
  `secretCache` — never `resolvePrivateSecret`), then `node.getNullifierMembershipWitness("latest", n)`:
  a witness ⇒ `true`; `undefined` ⇒ `false`; no secret / no `messageHash` / RPC throw ⇒ `null`.
  Token+gas sends check the TOKEN message only (`rec.messageHash`); the fuel message keeps its own
  path (`deposit-flow.ts` `fuelReceiptStatus`, `isMsgConsumed` on the fuel claim).
- **Engine**: (1) `awaitConsumable`'s rethrow becomes a classification: a consumed-shaped error asks
  `deps.messageNullified(rec)`; `true` → `completeClaimedByOther(id)` (persist `claimedByOther: true`,
  then `completeDeposit`); `false`/`null` → today's error path. (2) `recordMessageConsumed` (the
  resumed-claim probe after a success receipt) reads the nullifier instead of rebuilding the fee-bearing
  claim — same tri-state contract, no more "a consumed FUEL message reads as token consumed".
- **Fact + copy**: `claimedByOther?: true` on deposit records (additive, like `consumedByOther` on
  withdraws; no migration — the journal is versioned by `schema` and loaders never gate on this field).
  Card: "Claimed by another submitter — your tokens arrived." Stage stays derived (`done`).
- **Private + reload**: the card's CLAIM click unseals (existing `resolvePrivateClaimMaterial`), the
  claim build simulates, the consumed error routes through the nullifier with the now-cached secret.
  `resumeSessionWork` (non-interactive) leaves such a record as today until the click.

### B — reconcile a hash-less deposit from L1

- **Helper** (`deposit-reconcile.ts`): `findDepositTx(rec, l1, gen, opts)` over a narrow client
  interface (`getBlock`, `getLogs`, `getTransaction`):
  1. **Window by chain time**: the record's `createdAt` (wall-clock) minus a slack (10 min) is mapped
     to an L1 block number by a binary search over block timestamps (`getBlock({ blockNumber })`);
     `toBlock` = latest. The scan is capped (e.g. 50 000 blocks; beyond it the helper answers
     `"none"` with a "too old to search" reason).
  2. **Candidates**: `getLogs({ address: gen.router, events: [Bridge, BridgeWithFuel], args: { aztecRecipient: rec.recipient }, fromBlock, toBlock })`.
  3. **Verify each candidate's calldata**: `getTransaction(hash)` → `decodeFunctionData(SWAP_BRIDGE_ROUTER_ABI, input)`;
     require `tx.to === router`, the function that matches the intent (`bridge` for token / gas,
     `bridgeWithFuel` for token+gas), `bridgeToken === rec.token.erc20`, `tokenPortal === rec.portal`,
     the amount(s) equal to the record's (`amount`, `fuel.amount`), the secret hash(es) equal to the
     record's (`secretHashHex`, `fuel.secretHashHex`), and `isPrivate === rec.isPrivate`. The secret
     hash is the binder: it commits to this record's own random salt, so a copied hash on a different
     token or amount is rejected by the calldata fields the events omit.
  4. **Result**: exactly one verified tx → `{ txHash }`; none → `"none"`; two or more → `"ambiguous"`.
- **Dep** `findDepositTx?(rec) → Promise<{ txHash } | "none" | "ambiguous">`, wired in `useSend.ts`
  with the app's viem public client and `SEND_GENERATION`.
- **Engine**: `recoverLegIfNeeded`'s early bail (`!rec.depositTxHash`) becomes: if
  `deps.findDepositTx` and the record is a send record → `reconcileDepositLeg(rec, id)`: narrate
  "looking for the deposit on Ethereum"; on `{ txHash }` write it with
  `patchRecordWhen(id, (live) => !live.depositTxHash, { depositTxHash: txHash })` (another tab may have
  discarded or reconciled the record meanwhile) and continue into `attemptLegRecovery` with the
  re-read record; on `"none"` set `attention: "error"` + "No deposit from this record was found on
  Ethereum in the last N blocks. If you never confirmed it in your wallet, discard this record."; on
  `"ambiguous"` set `attention: "unknown-outcome"` + "More than one matching deposit was found — not
  guessing. Check your wallet activity, then discard."
- **Affordance**: `record-policy.ts` `depositLegRecoverable` becomes true for every send record in
  `depositing` (hash or not); the button stays CLAIM. Card copy for the hash-less shape: "The deposit
  was never confirmed here. Press CLAIM to look for it on Ethereum; discard if you never sent it."

### C — attach a hash-less exit by its recomputed commitment

- **Helper** (`exit-attach.ts`): `findExitTx(rec, node, opts)`:
  1. **Message hash**: `computeL2ToL1MessageHash({ l2Sender: rec.bridge (hub), l1Recipient: rec.token.portal, content: withdrawContentHash(rec.recipientL1, amount, ZERO_L1), rollupVersion, chainId })`
     with `rollupVersion`/`l1ChainId` from `node.getNodeInfo()` (asserted equal to the app's
     `chain-constants` for the build target).
  2. **Window**: L2 blocks whose timestamp ≥ `createdAt/1000 − slack`, found by a binary search over
     `getBlock(n).header.globalVariables.timestamp` between the block at creation and latest; capped.
  3. **Scan**: for each block, each tx effect's `l2ToL1Msgs` — a tx containing the message hash is a
     candidate `(txHash, blockNumber)`.
  4. **Disambiguate**: drop candidates whose `txHash` is already another journal record's
     `exitTxHash` (an identical earlier exit that was recorded). Exactly one left → `{ exitTxHash, exitBlock }`;
     none → `"none"`; more → `"ambiguous"`.
- **Dep** `findExitTx?(rec, taken: Set<string>) → …`, wired in `useHubExit.ts` with the node client;
  the engine passes the set of `exitTxHash`es it already holds.
- **Engine**: `runWithdrawConsumeLocked`'s `!rec.exitTxHash` branch becomes `attachExit(rec, id)`:
  narrate "looking for the exit on Aztec"; on a match `rekeyJournalRecord(id, { ...rec, id: exitTxHash, exitTxHash, exitBlock })`
  guarded by a fresh read (`patchRecordWhen`-style: the live record still has no `exitTxHash`), then
  continue into today's consume path on the re-keyed record; `"none"` → `attention: "error"` + "No exit
  matching this record was found on Aztec since it was started. If your wallet never sent it, discard
  this record."; `"ambiguous"` → `attention: "unknown-outcome"` + "More than one matching exit was
  found — not guessing. Check your wallet activity, then discard."
- **Affordance**: `record-policy.ts` gains `exitAttachable = withdraw && stage === "exiting" && isSendRecord && actionable && !busy`
  and `showFinish` includes it; the button label stays FINISH. `resumeActionFor` keeps skipping
  hash-less exits (click-driven). Card copy for the hash-less shape: "The exit was interrupted. Press
  FINISH to look for it on Aztec; discard if your wallet never sent it."
- After attach, the existing tail handles "someone already finished it on L1" (`consumedElsewhere`
  → `consumedByOther`).

### Data & control flow (critical paths)

```
A  CLAIM click → runDepositClaim(interactive) → resolvePrivateClaimMaterial (unseal on click)
     → buildClaimHandles → awaitConsumable: simulate throws "already nullified"
     → deps.messageNullified(rec) → node.getNullifierMembershipWitness(siloed)
     → witness ⇒ patchRecord({claimedByOther:true}) + completeDeposit   |  else surfaceRunFailure (as today)

B  CLAIM click → runDepositClaimLocked → recoverLegIfNeeded: no depositTxHash
     → deps.findDepositTx(rec): window → getLogs(recipient) → getTransaction → decode → match
     → one ⇒ patchRecordWhen(no hash yet, {depositTxHash}) → attemptLegRecovery (existing) → claim (existing)

C  FINISH click → runWithdrawConsumeLocked: no exitTxHash
     → deps.findExitTx(rec, taken): message hash → block window → tx effects scan → one unclaimed
     → rekeyJournalRecord(provisional → exitTxHash) → exitConsume (existing) → done / consumedByOther
```

### Interfaces (new)

```ts
// useBridgeJournal.ts — JournalEngineDeps additions
messageNullified?: (rec: ClaimRecord) => Promise<boolean | null>
findDepositTx?: (rec: SendDepositRecord) => Promise<{ txHash: string } | "none" | "ambiguous">
findExitTx?: (rec: SendWithdrawRecord, taken: ReadonlySet<string>) => Promise<{ exitTxHash: string; exitBlock: number } | "none" | "ambiguous">

// journal.ts (bridge-core) — additive fact
DepositJournalRecord.claimedByOther?: boolean

// lib/message-nullifier.ts
tokenMessageNullifier(i: { hub: string; messageHash: string; secretHex: string; isPrivate: boolean; recipient: string }): Promise<Fr>
```

### Algorithms / non-obvious mechanics

- **Block window by timestamp** (B and C): binary search `lo=0..hi=latest` on `getBlock(n).timestamp`
  for the first block ≥ `createdAt/1000 − slack`; O(log n) RPC reads; the scan cap bounds the
  worst case. Anvil/local networks mine sparsely; the search handles gaps by comparing timestamps only.
- **Ambiguity** (B): two router txs with identical calldata (same secret hash) cannot both be valid
  deposits — the Inbox would reject the second identical message only if the leaf collides; treat it
  as ambiguous and refuse. (C): identical exits (same portal/recipient/amount) produce identical message
  hashes; the `taken` set removes exits the journal already owns; anything still plural is refused.
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
record's leaves — `readSendReceiptLeaves` already fails a mismatch) after a calldata check on
(router, token, amounts, secret hash); for an exit `expectedWitness` + a tx-effects check that the
recomputed message hash is in that tx. Pros: no block windows, no scans, no ambiguity logic, ~40%
of the code. Cons: users of a bridge UI do not have Aztec tx hashes at hand (the wallet that swallowed
the reply is the one that has it); the cells can only exercise the verifier with a hash the fixture
extracts; two identical exits are still ambiguous to the user. Verdict deferred to the audits; the
draft prefers the scan, and keeps the paste as a possible later fallback UI (out of scope here).

## Security & Adversarial Considerations

- **Threat model**: the journal (localStorage) and imported recovery files are attacker-influenced
  input; RPCs (L1, node) can be slow, stale or lying; a relayer or another tab is a legitimate
  competing claimer.
- **A cannot mint a "done" from nothing**: the nullifier is a function of the record's own
  `messageHash` and the claim secret; without the secret no nullifier the tree contains can be
  produced, so a hostile record cannot be marked done unless its funds were in fact claimed. A lying
  node (witness for an unconsumed message) can at worst mark a claimable deposit done; the fail-closed
  default (`null`/`false` → today's error) covers an unreachable node.
- **B cannot attach a foreign deposit**: the match requires the record's own secret hash in the
  calldata plus token, portal, amounts, privacy and recipient; a copied public secret hash on another
  token fails the calldata check (the codex attack from tools-readiness). A record that copies ALL of
  another public deposit's fields already holds that deposit's secret — a bearer it had anyway.
- **C cannot redirect funds**: the message hash commits to `recipientL1`; a foreign exit with the same
  content pays the same recipient. Ambiguity refuses; the `taken` set prevents double-attaching one
  exit to two records.
- **No new prompts**: the only signature in any path is the existing unseal on CLAIM. Scans are reads.
- **Least privilege / supply chain**: no new dependencies; stdlib helpers already installed (7-day
  min-age unchanged); no CI/token changes.
- **Logging**: secrets and nullifiers never reach `log(...)`; ids, stages, hashes and block numbers only.
- **DoS/latency**: scans are bounded (block cap, one `getLogs` per window, one `getTransaction` per
  candidate); a runaway RPC surfaces as the existing error attention, never a hang (bounded loops).
- **Input validation**: every chain value is parsed through the existing hex/address validators
  before comparison; `getLogs` args are the record's recipient padded, never free text.

## Assumptions

**Facts (verified)**
1. Nullifier formula: aztec-nr v5.0.1 `hash.nr:51-53` and `private_context.nr:890-910`; TS
   `computeFeeJuiceMessageNullifier` (`stdlib/messaging/l1_to_l2_message.js:74-79`) is the same
   poseidon2 with `DomainSeparator.MESSAGE_NULLIFIER = 3754509616`; `siloNullifier` at
   `stdlib/hash/hash.d.ts:46`; `getNullifierMembershipWitness` at `interfaces/aztec-node.d.ts:64`.
2. The hub consumes `[secret]` (`main.nr:244`) and, for private, `derive_claim_secret(claim_salt, recipient)`
   (`main.nr:265-271`) — mirrored by `deriveTokenClaimSecret` (`claim-secret.ts:46-47`); the app's
   private send derives it the same way (`useSend.ts:877-879`).
3. Today's consumed path: `awaitConsumable` rethrows (`useBridgeJournal.ts:1117`) → `surfaceRunFailure`
   (`:769-774`); `recordMessageConsumed` (`:1313-1329`) rebuilds the claim via `buildClaimHandles`.
4. Router events omit token/portal (`SwapBridgeRouter.sol:84-97`); calldata carries them
   (`router-abi.ts:6-122`); the production precedent for `getTransaction` + `decodeFunctionData` is
   `useHubExit.ts:264-286`.
5. `recoverLegIfNeeded` bails without a hash (`useBridgeJournal.ts:937-940`); `record-policy.ts:92-94`
   hides CLAIM for that shape; the copy lives at `BridgeJournalCard.vue:172`.
6. `computeL2ToL1MessageHash` (`stdlib/hash/hash.d.ts:121`) + `withdrawContentHash`
   (`content-hash.ts:58-61`, mirrors `main.nr:290,307`); the exit's caller is `ZERO_L1`
   (`useHubExit.ts:382-389`); `IndexedTxEffect.data.l2ToL1Msgs` (`tx_effect.d.ts:38`);
   `NodeInfo.rollupVersion`/`l1ChainId` (`node-info.d.ts:17-19`).
7. A hash-less exit is `exiting`, FINISH hidden (`record-policy.ts:95`), the `unknown-outcome` branch
   at `useBridgeJournal.ts:1404-1410` is unreachable from the UI; a live exit is re-keyed to its hash
   (`useHubExit.ts:512-518`, `rekeyJournalRecord` `useBridgeJournal.ts:377-386`).
8. Conditional-write primitive: `patchRecordWhen` (`journal.ts:373-386`), used at
   `useBridgeJournal.ts:1214-1234` and `:1242-1281`.
9. Deps wiring and fakes: `JournalEngineDeps` (`:138-219`), `ensureSendJournalDeps` (`useSend.ts:228-254`),
   `ensureHubExitDeps` (`useHubExit.ts:289-308`), `baseDeps`/`smartClaimFake`
   (`useBridgeJournal.test.ts:123-155`).
10. The pinned cells: 24b `recovery.spec.ts:117-172`, 26d `l1-wallet.spec.ts:14-59`, 31b
    `exits.spec.ts:123-172`; the L1 fixture's `holdNext` parks forever (`fixtures/l1-wallet.ts:131-137`);
    the test wallet's `swallowNext` runs the call and never answers (`test-wallet/main.ts:83-89`).
11. Real commands: `bun run --cwd apps/tools test`, `bun run --cwd packages/bridge-core test`,
    `bun run --cwd apps/tools typecheck`, `bun run e2e:tools -- [--shard=i/n | specs/<file>]` (retry 0
    by default: `NULO_E2E_RETRIES`), `bun run test:all`, `bun run lint`, `bun run lint:actions`.

**Inferences (unverified — the audits should attack)**
- The siloed nullifier the kernel inserts for the hub's claim equals
  `siloNullifier(hub, poseidon2([messageHash, secret], MESSAGE_NULLIFIER))` — i.e. the hub follows
  the FeeJuice scheme exactly (the stdlib doc says "any consumer following the same scheme"; the
  aztec-nr call site is generic). Cell 24b (a relayer's public claim, then the page's CLAIM → done)
  is the end-to-end proof at retry 0; a unit test pins the formula against a vector computed from the
  Noir constants.
- `getNullifierMembershipWitness("latest", …)` answers on the sandbox node and through the app's node
  client (no PXE involvement).
- viem `getLogs` with an indexed `bytes32` `aztecRecipient` filter works against anvil in one call for
  the window sizes involved; the block-timestamp binary search needs ~15 `getBlock` reads.
- `getBlock(n)`/tx effects on the node expose `l2ToL1Msgs` per tx for a window of recent blocks
  (the local network keeps full history; testnet nodes keep enough for a same-day recovery).
- Re-keying a provisional exit record to its found hash preserves the card/foreground behaviour the
  live path relies on (`rekeyJournalRecord` carries runtime, session-live and the foreground id).

**Asks** — none open. (Phase 0 settled scope, the unseal rule, the gates and the bar. Two delegated
calls the implementer makes and logs: the slack/cap values for the windows; whether "ambiguous" copy
names the count.)

## Phases

Three arcs, one per fix, stacked. Unit tests are inline with each change.

### Arc 1 — consumed → done (`worktree-tools-recovery`)

#### Phase 1: The nullifier helper, the dep, the two engine branches
- `apps/tools/src/lib/message-nullifier.ts` + test (public and private vectors; the private vector
  derives the secret; a wrong secret yields a different nullifier).
- `journal.ts`: `claimedByOther?: boolean` (+ the loader's schema test if one enumerates fields).
- `useBridgeJournal.ts`: `messageNullified` dep; `classifyConsumable` split out of `awaitConsumable`
  (consumed → nullifier → `completeClaimedByOther` | error); `recordMessageConsumed` reads the
  nullifier; `completeClaimedByOther`. Tests: fresh claim consumed + witness ⇒ done with the fact,
  no `claimTxHash`, `sendTx` never called; consumed + no witness ⇒ error as before; consumed + no secret
  (private, non-interactive) ⇒ null ⇒ error note says to press CLAIM; resumed claim with a success
  receipt uses the nullifier not the claim build (the `smartClaimFake` scenario re-pinned).
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
- `deposit-reconcile.ts`: `findDepositTx` over a narrow client interface; tests with a fake client:
  window search over sparse timestamps; a matching `bridge` tx; a `bridgeWithFuel` tx for a
  token+gas record; a copied secret hash on another token rejected; two matches ⇒ `"ambiguous"`;
  none ⇒ `"none"`; the block cap ⇒ `"none"`.
- **Validation gate**: `bun run --cwd apps/tools test -- src/composables/deposit-reconcile` green;
  typecheck; lint. Layers: lint · unit.

#### Phase 4: Engine branch, affordance, copy, cell 26d flipped
- `useBridgeJournal.ts`: `findDepositTx` dep; `reconcileDepositLeg` from `recoverLegIfNeeded`;
  tests: found ⇒ hash written once (`patchRecordWhen`), then leg recovered and the claim proceeds;
  a record discarded meanwhile ⇒ no write; none ⇒ error note; ambiguous ⇒ unknown-outcome.
- `useSend.ts`: wire with the viem public client + `SEND_GENERATION`. `record-policy.ts`:
  `depositLegRecoverable` for hash-less send records (+ its test). Card copy.
- `fixtures/l1-wallet.ts`: `swallowNext("transaction", { to })` — the tx is sent, the page never
  hears back (the L2 test wallet's `swallowNext` twin); `holdsArmed` covers it.
- `l1-wallet.spec.ts`: 26d → the router tx swallowed → reload → CLAIM finds it → claim lands → done;
  a 26e keeps today's Discard-only shape for a tx that was truly never sent (hold, no swallow):
  CLAIM → "not found" note → Discard.
- **Validation gate**: Phase 3 commands + `src/composables/useBridgeJournal src/lib/record-policy`;
  `bun run e2e:tools -- specs/l1-wallet.spec.ts` green at retry 0. Layers: lint · unit · e2e.
- **Arc boundary**: the two shards; codex loop on the arc-2 diff; `gh stack add tools-recovery/exit-attach`.

### Arc 3 — attach a hash-less exit (`tools-recovery/exit-attach`)

#### Phase 5: The L2 finder
- `exit-attach.ts`: `findExitTx` over a narrow node interface (`getNodeInfo`, `getBlockNumber`,
  `getBlock`/tx effects); tests with a fake node: the recomputed hash equals a vector from
  `withdrawContentHash` + `computeL2ToL1MessageHash`; one match ⇒ `{ exitTxHash, exitBlock }`; a
  taken hash excluded; two ⇒ ambiguous; none; the cap.
- **Validation gate**: `bun run --cwd apps/tools test -- src/composables/exit-attach`; typecheck; lint.

#### Phase 6: Engine branch, affordance, copy, cell 31b flipped
- `useBridgeJournal.ts`: `findExitTx` dep; `attachExit` replaces the dead `unknown-outcome` branch;
  re-key + continue; tests: attached ⇒ consume runs on the re-keyed record ⇒ done; attached but already
  finished on L1 ⇒ `consumedByOther`; none/ambiguous notes; a record discarded meanwhile ⇒ no re-key.
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

_(filled by Phase 2–3 of the blueprint: codex round(s), fable verdict, decision ledger, final codex pass)_

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
