---
plan: backup-import
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: fix/backup-import
worktree: .claude/worktrees/backup-import
base: dev @ 85c4d20f (#719 merged; the drafts and round-1 audits read 48a97f4a, the same tree as f32b1e0a)
---

## Outcome

- **Date:** 2026-09-30. **Status:** closed, awaiting archive: built and pushed on
  `fix/backup-import` (merged with `dev` at `4387b112`), its PR #726. The owner delegated
  the open decisions to the driver on 2026-09-29, who decided them after a panel (§ P5), and the
  open's landing on 2026-09-30 after a capture (§ P6 step 8); the owner confirmed every call on
  2026-09-30 (§ P5).
- **Shipped** on `fix/backup-import`, P0 to P6:
  - B1: the import skips the protocol contracts and upstream's preloaded standard contracts, so a
    network whose slice holds only those is neither probed nor booted.
  - B2: one pipeline per network, each on its own clock inside the unchanged 45-second budget; a
    stalled network marks only itself.
  - B3, O1 (B): Retry on both pages' finished-with-errors screen replays the networks that ran out
    of time or could not be reached and swaps only their outcome rows. A new pick, a new import,
    Back, Continue and unmount drop it; Back is disabled while it runs, and Enter on a focused
    Retry runs only Retry (dev's page listener, merged, red first on the branch before it).
  - O2, name: the warning names those networks by their seeded names, in seed order, with "review
    the details" when another error remains; it scrolls into view as the screen opens and carries
    `role="alert"`. Where the popup's scroller can carry the hero's title under the compact bar,
    the open lands at its end (§ P6 step 8).
  - Tests: red-first unit and page cases in every phase; the Chrome-only network spec
    `backup-import-stalled-network.test.ts` (`CHROME_ONLY.hangingRequest`); the smoke spec
    `import-errors-scroll.test.ts` (both browsers) for the open's landing; the shared e2e helpers
    `rpc-stub.ts` and `backup-export.ts`; a `data-testid` on the data viewer, and on the collapsing
    hero's scroller, bar, title and accent bar.
  - From the codex loop: a new pick and Continue drop a running Retry; four narrating comments
    removed; `reveal`'s doc states its trailing-block constraint, and an impossible unit fixture
    fixed.
- **Gates at delivery:** P6's gate and its step 8 rerun (`lessons/phase-6.md`): lint,
  `typecheck:all`, `test:all`, `test:ci-gating`, the build and the plans gate exit 0; smoke green on
  Chrome and Firefox in three retry-0 shards each, with P4's skips; the network specs green on the
  browsers each supports. The stall spec, at retry 0: eleven greens in a row at P4, ten at the final
  gate, one more at P6. Codex: five rounds, approve in the third, nits in the fourth and fifth
  (`lessons/post-impl.md`); one finding rejected with reasons, then withdrawn.
- **Dropped:** the options not picked, O1 (A) without Retry, (C) and (D), and O2's keep. Only
  their captures were made, in the driver's scratch directory; the capture-only branches were never
  pushed.
- **Owner answers, 2026-09-29:** the owner's words, "any chance your resolve auditing with Codex and
  Opus5.5 subagents the open artifacts? Ask those subagents to be evaluators on the ux/ui/copies.
  Use your knowledge about my previous decisions too."; the driver's decisions with the panel's
  votes are in § P5. CLAUDE.md's sign-off wants the owner's own words naming each surface, and this
  record is a delegation: the owner's review of the PR and its captures is that step.
- **Open items:** none left here; `follow-ups.md` holds F-1 to F-3 (§ ux-feedback: technical), F-4
  to F-6 (§ ux-feedback: owner decisions) and F-7 (§ ux-feedback: taken by a follow-up plan, for
  copy-polish). `lessons.md` gains one entry in § Extension runtime, the deep-reactive proxies, and
  two older entries in § CI & gates are shortened so the file does not grow.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# Backup import: one slow public node cannot stall it

A full-backup import ends with a chain-sync tail that registers each network's saved contracts
and senders with that network's PXE. Today one registration call carries every network, on one
30-second clock, and the networks run one after another; one public node that stalls marks every
network "ran out of time", and the person lands on the errors screen even for networks that
restored. The fix, as one PR off `dev`:

- **B1** · The import skips the contracts every PXE registers by itself at boot (the protocol
  range, as today, plus upstream's preloaded standard contracts), so a network that holds only
  those is never probed and never booted.
- **B2** · Each network runs its own pipeline: its probe, then its registration call as soon as
  its probe answers, on its own clock inside today's 45-second budget; a stalled network marks
  only itself.
- **B3** · A **Retry** on the finished-with-errors screen re-runs the tail for the networks that
  ran out of time or could not be reached (recommended O1 (B), built so the owner sees it working;
  dropped if the owner picks otherwise).

It also answers the owner's two open questions from `implementations-plan/follow-ups.md`
§ ux-feedback: owner decisions ("should an import skip preloaded contracts as it skips protocol
ones, and should it wait on public networks at all?"), with each option pictured (§ UI asks).

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, not committed).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner's words that start and bound this work:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- The standing rule on realism, 2026-09-29: "Don't even care with a balance of 10 trillion tokens
  my friend. let's cover realistic scenarios lol."
- On decision pages, 2026-09-29: "for next documents please put how it's going to look on each
  choice you are giving me".

Recorded:

- **Scope**: B1, B2 and B3; the owner's two questions answered on a decision page with each option
  pictured; the stall reproduced in a unit test that fails on the base and in one committed
  two-network network e2e; the backup network e2e kept green with #719's filter.
- **Out**: the export side (what a backup writes: § Follow-ups, F-1); skipping the profile's own
  account contracts or Nulo's protocol sponsors (codex Ask C4, F-2); keeping the tail's per-network
  outcome across a popup close (F-3, an owner design); the errors screen's layout and its raw-JSON
  viewer; the older em-dash skip strings (`normalize.ts:39-41`, the 45-string follow-up owns them).
- **Constraints**: the trust-gate order and the backup-import migration stay as they are
  (`apps/extension/src/wallet/services/backup/README.md:16-17`); the slice is hostile in every new
  branch; pre-production, no migrations and no new persisted key; complexity budgets hold with no
  new acceptance; no new dependency; no new log line above `debug`; existing testids verbatim.
- **Tier**: `mid`, under the owner's standing cap "never blueprint more than mid, to keep our
  credits safe" (§ Phase 0.5).
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: lint, types, unit, CI-gating scripts, build; smoke e2e on Chrome and
  Firefox (the import composable and both import pages change); the network specs that import a
  full backup, each on the browsers it supports; one new Chrome-only network spec for the
  two-network stall; an uncommitted capture run for the owner's page.
- **Decisions**: UI and product asks go to the owner; technical asks are decided with
  `/codex high`. Each Ask carries a recommendation, a confidence and its label.
- **Delivery**: single arc, one PR off `dev` on `fix/backup-import`, plain `gh pr create` after
  the codex loop converges. The first commit adds `implementations-plan/backup-import/` and one
  line in `implementations-plan/index.md`. Merge: by the driver under the owner's standing
  authorization above, once every required check is green on the head, every UI surface carries
  the owner's quoted sign-off and the codex loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 1 | Every part extends a pattern in the tree: the protocol skip (`service.ts:475`), the tail's race (`importChainSync.ts:95-103`), the errors screen's buttons (`popup/pages/import.vue:270-285`) |
| Blast radius | 2 | The post-finalize tail of every full-backup import, on both import pages; the account-state normalizer both processes share |
| Irreversibility | 1 | Nothing is written that a later registration cannot write again: contract instances are keyed by address and senders deduplicate (Facts 24, 25) |
| Migration cost | 0 | Pre-production; no stored shape changes |
| External coupling | 2 | Upstream PXE's preloaded list (`@aztec/standard-contracts` 5.2.0); public dRPC nodes' behaviour |
| Security sensitivity | 2 | The account-state slice is attacker-controlled |

`mid`: bounded, in-pattern, with one external list pinned by a test. `deep` would buy nothing the
dual audit does not.

## Outcome & Quality Bar

For whom: a person restoring a full backup, usually on a new install from onboarding, at a moment
when one public node (Alpha or Testnet, both on dRPC) answers slowly or not at all. In production
the restored wallet opens on the backup's own active network (Fact 26), which for most people is
Alpha, a public network.

Excellent means:

1. **One stalled network costs only its own row.** With one network stalled and another healthy,
   the healthy network's registrations land (proven by a restored sender read back through the
   account-state reader before Continue, which no balance read can register, Fact 29) and appear
   nowhere in the errors, and the stalled network gets exactly one "ran out of time" record. A unit
   test and a committed Chrome network e2e both fail on the base and pass after.
2. **A network holding only what every PXE rebuilds dials nothing.** An item whose contracts are
   all protocol or preloaded standard contracts, with no sender, is neither probed nor booted and
   produces no error row. A unit test fails on the base; P4's capture run records the export's
   per-network classification (Inferences 0, 1, 9).
3. **The skip set is upstream's own list.** A pin test fails the day an `@aztec/*` bump changes
   what the PXE preloads, or moves a protocol address out of today's 0 to 6 rule.
4. **The screen's wait stays bounded as today.** No path keeps the import screen past today's
   45-second tail (`importChainSync.ts:29`); a fake-clock test asserts the tail settles by then
   with a probe that answers late and a registration that never settles. A registration already
   launched may still finish after the screen moved on (§ Non-obvious mechanics); it never adds a
   row.
5. **Retry replays safely.** A Retry that overlaps the first run's late completion leaves at most
   one row per network, and a network that answers clears its registration row; replaying a
   registration writes the same address-keyed instance and deduplicated sender (Facts 24, 25). A
   Retry never erases a normalization violation (entries the normalizer discarded stay discarded,
   Fact 28), so a network with one never completes the import by itself after a Retry.

Good enough: the worst case still waits up to about 45 seconds per run on a stalled node; a Retry
pressed while the first run's PXE boot is still waiting on the stalled node queues behind it and
usually runs out of time again (Fact 23, Inference 8); the errors screen's words stay as today
unless the owner picks otherwise (O2); what a network the person leaves unrestored held that
nothing rebuilds stays lost from this import (R1).

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Import tail on both import pages (popup `Importing…`, onboarding `Importing...` with spinner), one public node stalled | The button waits up to about 45 s, then every network with work is marked "ran out of time" → the same wait at most, but only the stalled network is marked; the others restore | signed, O1 (B) (§ P5); the owner, 2026-09-30 |
| 2 | The finished-with-errors screen and its viewer (popup `View Errors` → data viewer; onboarding `View errors` → the "Import completed with errors" notice) | Rows for every network with work, healthy ones included → one row, the stalled network's | signed, blanket (§ P5); the owner, 2026-09-30 |
| 3 | An import whose non-active slices hold only protocol and preloaded contracts, their node down | The probe dials the node, and a down node puts "couldn't reach the network" on the errors screen → nothing dials, no row; the import goes straight into the wallet when nothing else failed | signed, blanket (§ P5); the owner, 2026-09-30 |
| 4 | The finished-with-errors screen on both pages, when a network ran out of time or could not be reached | Continue and View Errors → a **Retry** button above them (`Retrying…` / `Retrying...` while it runs, Continue, View Errors and Back disabled meanwhile); when no error remains after a Retry, the page goes into the wallet as a clean import does | signed, O1 (B) (§ P5); the owner, 2026-09-30 |
| 5 | The wallet reopened after the toolbar popup closed during the tail | Unchanged: the wallet opens as if complete and nothing says a network was not restored (F-3) | signed, blanket, two to one (§ P5); the owner, 2026-09-30 |
| 6 | The warning on the finished-with-errors screen, both pages, when a network ran out of time or could not be reached | "Profile import completed with some errors. You can review the details or continue." → "Alpha V5 didn't answer in time, so what was saved for it may not be restored. You can retry or continue." (two or more: "Alpha V5 and Testnet … for them …"; with other errors too, the last sentence is "You can retry, review the details, or continue."); with no such network, unchanged | signed, O2 name (§ P5); the owner, 2026-09-30 |
| 7 | The finished-with-errors screen as it opens (popup at 360x600, onboarding) | The footer's three or four buttons leave the warning below the scroller's edge until the person scrolls → the warning scrolls into view as the screen opens, and a screen reader announces it (`role="alert"`); with four buttons the open lands at the scroller's end, the hero's title under the compact bar (§ P6 step 8) | signed, the look fix (§ P5), its landing decided at § P6 step 8; the owner, 2026-09-30 |

No other surface changes. New copy under rows 4 and 6: "Retry", its running label and the named
sentences; the three skip strings stay (`normalize.ts:39-41`). The data viewer popup gains a
`data-testid` on its root for the new e2e (no visible change). Wire-shaped fixtures: the tests feed real 32-byte addresses (the
upstream constants and `0x`-prefixed 64-hex values below the field modulus), never short friendly
values, for the classification cases.

### UI asks for the owner (every option pictured, § P5 capture list)

The page frames every option on the production shape: the restored wallet opens on the backup's
active network, usually Alpha, which is public (Fact 26). Every option skips what every PXE
rebuilds (B1): it removes dials and rows and costs nothing visible, and for a person who only uses
Alpha it ends a stalled Testnet's wait by itself (Inference 9).

- **O1 · When one public network stalls during a restore, what should the import do?**
  - **(A)** Wait on each network on its own clock (B2). Import screen: unchanged, at most about
    45 s. Result: today's warning ("Profile import completed with some errors. You can review the
    details or continue."), Continue and View Errors; the viewer lists only the stalled network.
    Nothing in the app restores that network's senders or dApp contracts later (R1).
  - **(B) Recommended, built.** A, plus **Retry** on the finished-with-errors screen for the
    networks that ran out of time or could not be reached: another bounded run; a network that
    answers clears its row, one that stalls again keeps exactly one row; with no error left, the
    page goes into the wallet. Costs one control, one re-run path, and replacing the retried
    networks' rows.
  - **(C)** Register only the backup's active network now (usually Alpha, so the import still
    waits on one public node); hold the others' slices until the person first switches to them.
    Costs a new persisted key holding hostile, multi-megabyte artifacts, a switch hook, purge and
    export handling for that key; a stall at switch time has no screen of its own.
  - **(D)** Don't wait on public networks at all: the import finishes when its storage stages
    finish, and the registrations run in the background with no report. Smallest code; a
    registration that never happened is never shown to anyone.
  - Recommendation: (B). What a stalled network loses is not dependably recovered anywhere else: a
    dApp's contract returns only when that dApp hands its artifact again, and a registered sender
    only when a person who knows its address re-adds it; until then, notes that sender delivered
    with address-derived tagging stay undiscovered, so that network's private balances can read low
    (Facts 22, 27). Retry is the only in-app recovery, and it replays safely (Facts 24, 25). Against
    it: a Retry pressed while the stalled boot is still waiting usually runs out of time again
    (Inference 8), and the loss needs registered senders or a dApp contract on the stalled network,
    which most people do not have (Fact 22). (C) keeps one public wait and adds a lifecycle; (D)
    hides the only record of a loss. Confidence: moderate.
- **O2 · The warning's words when a network ran out of time.** (keep) today's sentence, above;
  (name) "Alpha V5 didn't answer in time, so what was saved for it may not be restored. You can
  retry or continue." (under (A): "…You can continue."). Recommendation: keep: the rows already
  carry the reason, "may not" is needed because a late registration can still land (§ Non-obvious
  mechanics), and naming the network means passing the seeded names into the form (the rows hold
  only its id). Confidence: moderate.
- **Blanket sign-off**: UI impact rows 2, 3 and 5, and these residuals:
  - **R1** · With one network left unrestored, what nothing rebuilds on that network is missing
    until someone restores it: a dApp's own contract until that dApp registers it again (its notes
    then sync on its next call), and a registered sender until it is re-added in Settings →
    Advanced → Account State → Senders (notes it delivered with address-derived tagging stay
    undiscovered until then, so that network's private balance can read low). The original backup
    still lists them; re-importing it creates another profile rather than repairing this one.
  - **R2** · A "ran out of time" row can be stale: a registration the tail had already launched
    can still land after the screen moved on. A Retry finds it done and clears the row.
  - **R3** · Closing the popup during the tail (any click outside it) loses the tail's outcome: on
    reopening, the wallet looks complete (row 5). B2 dispatches each network's registration as soon
    as its own probe answers, so a close loses as little as this design allows. F-3 owns the fix.

## Architecture & Implementation

### What a network's slice holds, and what skipping it costs

The export writes one item per network whose node answered at export (`NodeStatus.Active`,
`account-state/service.ts:219-231`): its registered senders and every contract `getContracts`
lists, each with instance and artifact (`:158-194`). Registering an item boots that chain's PXE,
which dials the node before any registration (Fact 7); the registrations themselves are local
store writes (Fact 8).

| Entry in a network's slice | Rebuilt without the backup? | Evidence |
|---|---|---|
| Protocol contracts (addresses 1 to 3; today's skip covers ≤ 6) | yes, by every PXE boot | `@aztec/pxe@5.2.0 dest/pxe.js:140-142`, `:224-235`; `@aztec/protocol-contracts@5.2.0 dest/protocol_contract_data.js:16-20` |
| Upstream's preloaded standard contracts: MultiCallEntrypoint, AuthRegistry, HandshakeRegistry, HandshakeRegistry v5.0.1 | yes, by every PXE boot | `dest/pxe.js:142`, `:236-246`; `@aztec/standard-contracts@5.2.0 dest/preloaded/index.js:8-20`, `dest/handshake-registry/historical.js:36-38` |
| The profile's own account contracts | yes, before the first transaction (Inference 3) | `packages/aztec-runtime/src/account/nulo-account.ts:116-128`, `:169-170` |
| Nulo's protocol sponsors (PrivateFPC, SponsoredFPC) | yes, by fee discovery | `apps/extension/src/wallet/services/fpc/service.ts:163-173`, `:210-215` |
| Tokens of a compiled-in class | only when the token's interface is parsed (Inference 4) | `apps/extension/src/wallet/services/token/service.ts:657-678`; `packages/aztec-runtime/src/pxe/artifact-catalog.ts:35-83` |
| Contracts a dApp registered with its own artifact | no: gone until the dApp hands its artifact again; its notes sync on its next call after that (Fact 27) | `packages/aztec-runtime/src/pxe/artifact-registry.ts:44-49` |
| Registered senders | no: gone until a person re-adds the address; notes that sender delivered with address-derived tagging stay undiscovered until then (Fact 22) | `account-state/service.ts:111-120`; `@aztec/pxe@5.2.0 dest/logs/log_service.js:167-215` |

So B1 removes only rows 1 and 2, which every boot writes back. What B2 does not save on a stalled
network (rows 3 to 7) is what that network loses today too, without taking the healthy networks
with it; rows 6 and 7 are why O1 recommends Retry.

### B1 · Skip what every PXE boot registers

- **Where.** A leaf module, `apps/extension/src/wallet/services/account-state/pxe-provided.ts`,
  exports `isPxeProvidedAddress(value: bigint): boolean` (the protocol range 0 to 6, today's rule
  moved verbatim, or one of the preloaded addresses) and `isPxeProvidedContract(address: string)`,
  which parses with today's parse (`AztecAddress.fromStringUnsafe(address).toBigInt()`,
  `service.ts:471`) and returns false on a parse failure. The preloaded set is built once from
  upstream's address-only leaf exports: `STANDARD_MULTI_CALL_ENTRYPOINT_ADDRESS`,
  `STANDARD_AUTH_REGISTRY_ADDRESS`, `STANDARD_HANDSHAKE_REGISTRY_ADDRESS` and
  `HISTORICAL_STANDARD_HANDSHAKE_REGISTRY_ADDRESSES` (Fact 16). Nothing in it derives from slice
  content.
- **Two consumers.**
  - `registrableNetworkIds` (`normalize.ts:206-208`) counts a network only if it has a sender or a
    contract for which `isPxeProvidedContract` is false. A malformed address counts as work, as
    today. The popup's tail uses it for the probe and the call (`importChainSync.ts:62-63`, `:86`),
    so an Alpha-shaped item dials nothing.
  - `precheckContractAddress` (`service.ts:464-476`) keeps its network-first check and its own
    throwing parse, so a missing network still reports "Network not found" first
    (`service.test.ts:213-231`, address `0x2`) and a malformed address still gets its parse error
    without a launch; only the final comparison changes, to `isPxeProvidedAddress(addressNum)`,
    and the arm is renamed `"pxe-provided"`. A predicate-only rewrite of this function would admit
    malformed addresses (registration passes only `instance` and `artifact`, `service.ts:417`), so
    P1 pins it.
  - The normalizer does not drop the entries: dropping them there would change that precedence
    and the result shape for no gain (recon's first reading, superseded).
- **The comment at `normalize.ts:31-33`** ("Deduplicating or omitting re-registerable canonical
  contracts is the real fix …") is rewritten to the invariant that stays true: the export still
  writes these contracts, so they still count against the size cap. No follow-up id in the comment.
- **Why not a hand-kept list.** Upstream adds to its preloaded set (it added HandshakeRegistry,
  `normalize.ts:20-23`); a pin test compares the set with the addresses
  `getDefaultStandardPreloadedContracts()` returns, which reconstructs them without hashing
  (Fact 17), and asserts every `ProtocolContractAddress` value is ≤ 6, so a bump that changes
  either reds a test instead of silently dropping a contract.

### B2 · Each network on its own pipeline

`runImportChainSync` keeps its budgets (`importChainSync.ts:29-34`), its normalization and the
immediate record of normalizer violations (`:53-54`, now `deps.record(violations, "violations")`).
It then runs one pipeline per network with work, all at once, and records once when every
pipeline has settled:

```ts
// importChainSync.ts, sketch
const outcomes = await Promise.all(ids.map((id) => syncOneNetwork(deps, itemFor(id), known.has(id), clocks)))
const records = outcomes.flatMap((o) => o.records)
if (records.length) deps.record(records, "outcomes")
return outcomes.filter((o) => o.retryable).map((o) => o.item)

async function syncOneNetwork(deps, item, probeFirst, { preflightAt, deadlineAt }): Promise<NetworkOutcome> {
  if (probeFirst) {
    const verdict = (await preflightNetworkConnectivity({ networkIds: [item.networkId], probe: deps.probe, deadlineAt: preflightAt })).get(item.networkId)
    if (verdict !== "go") return skipOutcome(item.networkId, verdict) // unreachable → retryable; wrong-network → not
  }
  const remaining = Math.max(0, Math.min(IMPORT_REGISTRATION_BUDGET_MS, deadlineAt - Date.now()))
  if (remaining === 0) return deadlineOutcome(item.networkId)
  const outcome = await Promise.race([
    deps.restore([item], remaining).then((result) => ({ kind: "result" as const, result })).catch(() => ({ kind: "failed" as const })),
    realSleep(remaining).then(() => ({ kind: "timeout" as const })),
  ])
  return outcome.kind === "result" && Array.isArray(outcome.result) ? resultOutcome(item.networkId, outcome.result) : deadlineOutcome(item.networkId)
}
```

- **Dispatch per probe.** A network's registration call leaves as soon as its own probe answers
  "go", never after the slowest probe. The round-1 sketch waited for the whole preflight; this is
  the change that makes a popup close lose as little as the design allows (R3).
  `preflightNetworkConnectivity` is reused per network with one id; only created networks are
  probed (three seeds), so its three-worker cap is never the limit.
- **Key interfaces.** `ImportChainSyncDeps` changes in one place (`importChainSync.ts:35-46`):
  `record` takes a second argument, `"violations" | "outcomes"`, so B3 can keep the two apart.
  `restore` now receives a one-item array; `runImportChainSync` returns the retryable networks'
  normalized items for B3 (Decision ledger: items, not ids). `AccountStateService.restore` is unchanged apart from B1: it already accepts any subset
  and clamps its own copy per call (`service.ts:290-292`).
- **Which outcomes are retryable.** A deadline, a rejected call and an unreachable verdict are.
  So is a **resolved** result whose item says the network failed: the service catches each
  registration failure and resolves with it in the item (Fact 28), so a node that passes the probe
  and then refuses the boot resolves rather than rejects. `resultOutcome` marks the network
  retryable when its item's `restoreError` starts with `ACCOUNT_STATE_SKIP_DEADLINE`
  (`service.ts:446-448`) or any child's `restoreError` is `ACCOUNT_STATE_SKIP_UNREACHABLE` or
  passes `isConnectivityErrorMessage` (`normalize.ts:213-219`). A payload failure (a parse error,
  "Network not found", a rejected artifact) is not; nor is a wrong-network verdict or an unknown
  id.
- **Single record per tail run.** Every pipeline settles by `deadlineAt`; `record` runs once after
  all of them, on the settled outcomes (preflight skips and registration outcomes together); no
  pipeline touches the sink, and a late loser appends nothing (the invariant at
  `importChainSync.ts:9-14`, kept). Normalizer violations keep their own earlier record, tagged
  `"violations"`.
- **Zero-work items** (no sender, no non-provided contract) are no longer sent at all. Today they
  ride along "to keep the result shape complete" (`:80-82`), but the collector drops a clean item
  (`full-backup-helpers.ts:363`), so nothing a person sees depends on them.
- **Unknown network ids** (not created by this restore) still skip the probe and still reach
  registration, one call each, where they fail fast with "Network not found" (`service.ts:384`,
  `:470`). The normalizer caps networks at 8 (`normalize.ts:15`).
- **Concurrency below.** The SW and the offscreen document dispatch each request independently
  (`packages/extension-messaging/src/background/service.ts:67-72`, `offscreen/service.ts:60`); the
  PXE host serializes writes per (profile, chain), boot included, and shares only a per-profile
  read barrier (Facts 12, 23), so two chains' boots and registrations run side by side.
- **Complexity.** `runImportChainSync` loses its race (net shorter); `syncOneNetwork` is about 20
  lines, unexported (so the composables' auto-import declarations do not change). No function
  passes 80 lines or cognitive 15.

### B3 · Retry the networks that did not restore

- **What it re-runs.** `restoreAccountStateStage` (`full-backup-restore.ts:435-456`) keeps, for
  the page that ran it, the normalized items and the created networks, in memory only (never
  persisted; dropped on Continue, on a new import and on dispose), plus the retryable ids the tail
  returned. `retryAccountStateStage` in the same module runs `runImportChainSync` again over the
  retained items of those networks only, with fresh `AccountStateServiceClient` and
  `NetworkServiceClient` connections, disconnected when it settles. Already-normalized items
  produce no violation record the second time.
- **Rows.** The stage keeps the account-state rows as two lists, split by `record`'s tag:
  normalization-violation rows and registration-outcome rows. A Retry replaces only the retried
  networks' outcome rows, never a violation row: a Retry cannot bring back entries the normalizer
  discarded (Fact 28), and one concise code comment states that invariant where the rows are
  rebuilt. After the run settles, the account-state key is rebuilt in one assignment (violation
  rows, the outcome rows of networks not retried, the Retry's rows through the same collector), so
  the screen never flickers through an empty log, and it is deleted when empty, because
  `isRestoreHasErrors` counts keys (Fact 30); every other service's rows stay. A network that
  answers leaves no outcome row; one that stalls again leaves exactly one; a network with a
  violation keeps it, so the page does not complete on its own. The first run's late completion appends
  nothing (its race was lost), and a replayed registration writes the same address-keyed instance
  and returns early for a known sender (Facts 24, 25), so a registration that landed late cannot
  produce an error on replay.
- **The screen.** `useFullBackupImport` exposes `canRetryAccountState` and `retryAccountState`
  (and, as built, `isRetryingAccountState` and `dispose`, Decision ledger); `useProfileImportFlow`
  passes them through; both import pages render **Retry** (testid
  `import-full-backup-retry-btn`) above Continue when a retryable network exists, with its running
  label and Continue and View Errors disabled while it runs. A second press while running is a
  no-op. When no row remains after a Retry, the page calls `completeImport`, the same call as a
  clean import, so the screen never strands with no button (`isRestoreHasErrors` hides both of
  today's buttons, `popup/pages/import.vue:270-285`).
- **Bound.** Each Retry is one more tail run, at most about 45 s. A Retry pressed while the first
  run's boot for that chain still holds its write guard queues behind it (Fact 23); nothing here
  tries to cancel that boot.
- **If the owner picks (A)**: B3 lands in its own commits (P3), which are reverted, with their
  tests, before merge; B1 and B2 stand alone.

### Data and control flow (the critical path)

`restoreAccountStateStage` (after `finalizeRestore`, `useFullBackupImport.ts:545-562`, which has
already cleared the restore-pending marker, Fact 11) → `runImportChainSync`: normalize (B1's
predicate decides which networks have work) → per network with work, concurrently: probe if
created (≤ 21 s from the tail's start) → on "go", one `restore([item], remaining)` raced at
`remaining` (≤ 30 s, within the 45 s total) → one `record` of every outcome → the retryable ids
are kept → the page reads `hasErrors` (`useFullBackupImport.ts:717-731`): no errors → straight into
the wallet; errors → Retry (when retryable), Continue and View Errors. Retry → the same tail over
the retryable items → rows replaced → no errors left → into the wallet.

### File-level change map

| File | Change | Part |
|---|---|---|
| `apps/extension/src/wallet/services/account-state/pxe-provided.ts` | new: `isPxeProvidedAddress`, `isPxeProvidedContract` and the address set | B1 |
| `apps/extension/src/wallet/services/account-state/pxe-provided.test.ts` | new: classification cases, the upstream pin, the protocol ≤ 6 pin | B1 |
| `apps/extension/src/wallet/services/account-state/normalize.ts` | `registrableNetworkIds` uses the predicate; the `:31-33` comment rewritten | B1 |
| `apps/extension/src/wallet/services/account-state/normalize.test.ts` | a network holding only provided contracts has no work | B1 |
| `apps/extension/src/wallet/services/account-state/service.ts` | `precheckContractAddress` compares through `isPxeProvidedAddress`; its doc comment names both kinds; the "monolith" narration at `:313-318` and `:346-349` cut to the invariants it guards | B1 |
| `apps/extension/src/wallet/services/account-state/restore-surface.pins.test.ts` | a preloaded address is skipped like a protocol one; a malformed address on an existing network keeps its parse error and launches nothing | B1 |
| `apps/extension/src/composables/importChainSync.ts` | per-network pipelines, one record, `record`'s `"violations" \| "outcomes"` tag, retryable ids returned (resolved connectivity failures included); header comment updated | B2 |
| `apps/extension/src/composables/importChainSync.test.ts` | the two-network stall, a per-network rejection with a hostile message, resolved connectivity versus payload failures, the elapsed-bound and both-stalled guards, the Alpha-shaped item, dispatch before the slower probe settles | B1, B2 |
| `apps/extension/src/composables/full-backup-restore.ts` | the stage keeps its retry context; `retryAccountStateStage` | B3 |
| `apps/extension/src/composables/useFullBackupImport.ts` | the `Q-02` tag (`:678`) and `(P7)` (`:720`) removed from their comments, the invariants kept (P2) | B2 |
| `apps/extension/src/composables/useFullBackupImport.ts`, `useProfileImportFlow.ts` | `canRetryAccountState`, `retryAccountState`, row replacement that keeps violation rows | B3 |
| `apps/extension/src/composables/useFullBackupImport.test.ts` | `:944-971` asserts one call per network, each with its seeded id; the Retry cases, a kept violation among them | B2, B3 |
| `apps/extension/src/popup/pages/import.vue`, `apps/extension/src/onboarding/pages/import.vue` | the Retry button | B3 |
| `apps/extension/src/onboarding/pages/import.test.ts` | Continue and View errors disabled while Retry runs (the popup page's twin is asserted in the stall spec) | B3 |
| `apps/extension/src/popup/components/popups/DataViewerPopup.vue` | a `data-testid` on its root | e2e |
| `apps/extension/tests/e2e/helpers/rpc-stub.ts` | new: `startStub` and a chain-parameterized node-info answer, moved out of `import-dead-rpc.test.ts` | e2e |
| `apps/extension/tests/e2e/import-dead-rpc.test.ts` | imports the moved stub | e2e |
| `apps/extension/tests/e2e/helpers/backup-export.ts` | `sealPlainBackup`, the re-checksum the backup specs repeat; as built, also `exportPlainBackup` and `accountChainId` (Decision ledger) | e2e |
| `apps/extension/tests/e2e/network/backup-restore-integrity.test.ts`, `backup-migration-roundtrip.test.ts` | use `sealPlainBackup` (and, as built, the export helpers) | e2e |
| `apps/extension/tests/e2e/helpers/crash-truth.ts` | `exportFundedBackup` keeps only the funded chain's account-state (`keepChainAccountState`) and re-seals | e2e |
| `apps/extension/tests/e2e/network/backup-import-stalled-network.test.ts` | new, Chrome-only (`CHROME_ONLY.cdpFetch`): the two-network stall, stalled slice first, a restored sender read back | e2e |
| `apps/extension/tests/e2e/FIREFOX.md`, `CLAUDE.md`, `.claude/skills/e2e-testing/SKILL.md` | the Chrome-only file list gains the new spec | docs |
| `implementations-plan/follow-ups.md` | delete the § ux-feedback: owner decisions backup entry; add F-1, F-2, F-3 | close-out |

### Non-obvious mechanics

- **Why a stall marks everything today, and loses healthy work.** The service walks items in
  order (`service.ts:304-331`) and checks the deadline only before each launch; one hung launch (a
  PXE boot whose node calls each wait 60 s with three retries, `packages/aztec-runtime/src/utils/fetch.ts:18`,
  `:112-122`) holds the whole call, so the popup's single race fires and writes a deadline record
  for every network with work (`importChainSync.ts:105-109`), including networks the SW had already
  finished. A stalled network early in the item order also costs every later network its
  registrations: the SW blocks on the hung launch, then `expired()` skips the rest (`:410`).
- **The screen is bounded; the work is not cancelled.** The popup's race ends the wait, and the
  service stops launching new registrations past its clamp, but a launch already awaiting
  (`service.ts:322`) runs on, and the PXE host can finish booting and register after the screen
  moved on (`packages/aztec-runtime/src/pxe/service.ts:1010-1012`). Hence R2 and O2's "may not".
- **Why a quick Retry usually stalls again.** The PXE boot runs inside that chain's write guard
  (Fact 23), and a boot waiting on a blackholed node can hold it for minutes (four 60 s attempts
  per request). A Retry's registration for that chain waits behind it, so it runs out of its own
  clock unless the node answers meanwhile. A slow node that recovers is the case Retry wins.
- **Why skipping must happen before the probe.** The probe itself dials (the #719 negative control
  saw its first hit at 1.8 s, Fact 9), and `registrableNetworkIds` counts any contract, protocol
  ones included (`normalize.ts:207`). So the predicate lives in the shared normalizer's work test,
  not only in the service.

### Trade-offs and alternatives not taken

- **(b) Active network only, defer the rest** (O1 C): not recommended. A new persisted key would
  hold attacker-supplied artifacts of several megabytes, with a switch hook, a purge on profile
  and chain deletion, and a rule for exporting it again; and the active network is usually public,
  so one public wait remains.
- **Don't wait** (O1 D): not recommended; it removes the only report of a loss.
- **(A) without Retry**: the smaller change, kept as the owner's alternative; it leaves R1's loss
  with no in-app path back.
- **Drop provided contracts in the normalizer**: rejected; it changes the pinned
  "Network not found" precedence for no gain (§ B1).
- **One call, with per-network deadlines inside the SW** (`outline-alt.md`): rejected. To beat a
  hung launch the SW would need the same per-network race around `launch()`, with the popup's
  backstop still outside it: more code in a more delicate place, and one aggregate response still
  couples the networks' outcomes whenever the SW call itself outlives the popup's race.
- **Also skip the profile's account contracts and Nulo's sponsors**: deferred (codex C4, F-2);
  the evidence that nothing needs them before their own re-registration is weaker than for rows 1
  and 2.
- **Fix the export instead** (stop writing rebuilt contracts): kept for F-1; old backups carry them
  anyway, so the import side is needed first.

## Security & Adversarial Considerations

- **Threat model.** The attacker supplies the backup file (a "restore your wallet" lure) and fully
  controls the account-state slice, which is deliberately not registry-schema'd
  (`normalize.ts:1-9`). This plan adds three branches over that slice: the skip, the per-network
  fan-out and the replay.
- **The skip set.** An entry that claims a provided address is not registered. It can only remove
  its own entry: the PXE registers the genuine contract at every boot, and even today a different
  instance at a canonical address is refused, because the PXE host derives the address from the
  preimage and rejects a mismatch (`packages/aztec-runtime/src/pxe/service.ts:437-461`). The set is
  compiled in from upstream constants; nothing in the slice can extend it. The service keeps its
  own throwing parse, so a malformed address keeps today's error and launches nothing.
- **Fan-out.** Per-network pipelines are bounded by the normalizer's 8 networks
  (`normalize.ts:15`), and only networks this restore created are probed and booted (three seeds,
  `network/service.ts:97-124`); unknown ids fail without dialing. Every call carries the shared
  remainder and the service clamps it again (`service.ts:290-292`), so nothing extends the 45 s
  tail.
- **Replay.** Retry derives its network set only from the tail's own outcomes, never from the
  error rows or the slice, and replays only items the normalizer already bounded. The retained
  items live in the page's memory for the life of the errors screen and are never persisted or
  logged. Replay writes nothing a first run could not write (Facts 24, 25). A hostile artifact whose
  registration error reads like a connectivity failure only makes its own network retryable: one
  more bounded run. Normalization violations are never replaced, so no Retry can hide that the
  normalizer discarded entries.
- **Records and logs.** Deadline, unreachable and rejection records carry constant copy and the
  sanitized network id (`full-backup-helpers.ts:365-368`); a rejected call's message is dropped,
  and a unit case feeds a hostile message to pin it. Two existing warn lines already carry more:
  the service's registration failure line interpolates the truncated exception text
  (`service.ts:342`), and the sink warns with the projected records (`useFullBackupImport.ts:771`).
  This plan adds no field or line to either; any diagnostic it adds is `debug` only.
- **Least privilege.** No new permission, host or origin; B1 removes dials.
- **Cryptography.** None added.
- **Supply chain.** No new dependency: `@aztec/standard-contracts` and `@aztec/protocol-contracts`
  5.2.0 are already exact-pinned (`apps/extension/package.json:45`, `:49`) and bundled
  (`src/wallet/utils/auth-registry.ts:2`). The pin test turns an upstream list change into a red
  test at the bump.
- **Trust gates.** Checksum, compat epoch, version range and the backup-import migration run
  before this tail and are untouched (`backup/README.md:16-17`, `useFullBackupImport.ts:91-134`).
  Chain remapping ignores exported network ids (`full-backup-helpers.ts:448`) and registration uses
  the seeded networks (`full-backup-restore.ts:449`).
- **Frontend.** Retry renders constant copy; O2's named copy would render a seeded network name,
  never a backup string.

## Assumptions

### Facts (verified at `48a97f4a` by reading the file, unless stated; #719's files at `85c4d20f`)

1. The tail's budgets are 45 s total, 21 s preflight and 30 s registration
   (`apps/extension/src/composables/importChainSync.ts:29`, `:31`, `:34`). Registration is ONE
   `deps.restore(items, remaining)` raced against one timer (`:95-103`), sent after the whole
   preflight settles (`:66-71`); on a timeout, a rejection or a non-array result, every network with
   work gets `ACCOUNT_STATE_SKIP_DEADLINE` (`:105-109`).
2. The service registers items one after another (`account-state/service.ts:304-331`), checking
   the deadline only before each launch (`:378`, `:410`) and awaiting each launch uncancelled
   (`:322`); its clamp is 0 to 30 s from entry (`:290-292`).
3. `registrableNetworkIds` counts a network with any sender or any contract (`normalize.ts:206-208`);
   the tail probes only created networks with work (`importChainSync.ts:61-63`) and registers
   `goIds` (`:86`).
4. Protocol contracts (address ≤ 6) are skipped silently after the network check and the parse
   (`service.ts:404-405`, `:464-476`); `restore-surface.pins.test.ts:61-79` pins it;
   `service.test.ts:213-231` pins "Network not found" for a contract at `0x2` on a missing network.
5. Every PXE boot registers the protocol contracts and upstream's preloaded contracts
   (`@aztec/pxe@5.2.0 dest/pxe.js:140-142`, `:224-246`). Nulo calls the bundle's `createPXE`
   without a provider (`packages/aztec-runtime/src/pxe/chain-runtime.ts:231`, `:267`), so the
   default applies (`@aztec/pxe@5.2.0 dest/entrypoints/client/bundle/utils.js:53-55`).
6. The default preloaded list is MultiCallEntrypoint, AuthRegistry, HandshakeRegistry and the
   historical HandshakeRegistry deployments (`@aztec/standard-contracts@5.2.0 dest/preloaded/index.js:8-20`),
   today one, v5.0.1 (`dest/handshake-registry/historical.js:36-38`). The protocol contracts are
   addresses 1, 2 and 3 (`@aztec/protocol-contracts@5.2.0 dest/protocol_contract_data.js:16-20`).
7. A PXE boot dials the node before any registration: `getL1ContractAddresses`
   (`chain-runtime.ts:189`), `getNodeInfo` (`bundle/utils.js:24`), `getNodeInfo` and `getBlock(0)`
   (`dest/pxe.js:107`, `:114`). Each node request has a 60 s timeout and three retries
   (`packages/aztec-runtime/src/utils/fetch.ts:18`, `:112-122`).
8. `registerContractClass` and `registerContract` are local store writes
   (`dest/pxe.js:555-584`; the function-signature publish goes to an optional `nodeDebug`).
9. #719's probe (`implementations-plan/e2e-reliability-fixes/lessons/phase-5.md:38-43` at
   `85c4d20f`) found the export's items: chain 0, 10 contracts; Testnet, 9; Alpha V5, 7; no
   senders; its negative control's first public hit came at 1.8 s (Chrome, relabelled to Testnet)
   and 1.9 s (Firefox, relabelled to Alpha V5), from the preflight. The log gives counts, not
   addresses.
10. Three seeds exist in every profile: Alpha V5, the seed marked primary in production, and
    Testnet, primary only under the e2e flag, both on `https://lb.drpc.live`, plus Local
    (`network/service.ts:95-124`). Separately, the export writes an item for every network whose
    node answers at export time (`NodeStatus.Active`, `account-state/service.ts:219-231`), so a
    production backup carries a Testnet item whenever Testnet's node answered.
11. The tail runs after `finalizeRestore` (`useFullBackupImport.ts:545-562`), which clears the
    restore-pending marker on entry (`wallet/services/profile/service.ts:2671-2677`); the tail's
    rows live only in the page's `restoreErrorLog` ref (`useFullBackupImport.ts:746`, appended at
    `:763-774`). With no errors the page calls `completeImport`, otherwise it shows Continue
    (`:717-731`).
12. The PXE host takes a per-profile barrier read and a per-(profile, chain) write guard for every
    write (`packages/aztec-runtime/src/pxe/service.ts:189`, `:989-1013`).
13. The errors screen: the warning "Profile import completed with some errors. You can review the
    details or continue." (`components/composite/import/ImportFullBackupForm.vue:64-77`); popup
    Continue and View Errors (`popup/pages/import.vue:270-285`), View Errors opening the data
    viewer (`:123-128`); onboarding Continue and View errors (`onboarding/pages/import.vue:205-222`),
    View errors raising "Import completed with errors" … "Check the developer console for details."
    (`:91-101`). Both buttons are shown only while `isRestoreHasErrors`.
14. The collector drops an item with no child error and no item error
    (`utils/full-backup-helpers.ts:363`) and sanitizes the network id (`:365-368`).
15. `useFullBackupImport.test.ts:944-971` asserts one `restore` call carrying both networks' items.
16. `@aztec/standard-contracts` 5.2.0 exports address-only leaves for the three contracts
    (`package.json` exports `:11-14`), `handshake-registry/constants` re-exports the historical
    addresses; the extension declares it and `@aztec/protocol-contracts`
    (`apps/extension/package.json:45`, `:49`) and imports one leaf today
    (`src/wallet/utils/auth-registry.ts:2`).
17. `getDefaultStandardPreloadedContracts` reconstructs each contract "without performing any hash
    computations" (`@aztec/standard-contracts@5.2.0 dest/make_standard_contract.js:5-8`).
18. `network/backup-restore-sw-restart.test.ts` is `@requires-proverless` (`:36`), which
    `apps/extension/scripts/e2e/agent.sh:15-33` enforces with exit 2, and skips whole-file on
    Firefox (`:89`, `CHROME_ONLY.backgroundKillUnderPage`). Its scenario B holds the import at
    `"account-state"` (`:371-374`); the gate holds every call that reaches it
    (`src/e2e/chrome-storage-restore-gate.ts:39-56`). It exports the funded backup unfiltered
    (`tests/e2e/helpers/crash-truth.ts:113-136`), and scenario A's retry waits for the success
    route (`:336`).
19. `import-dead-rpc.test.ts` is Chrome-only (`:274`, `CHROME_ONLY.cdpFetch`); its STATEFUL case
    answers the probe from a local stub and blackholes the rest (`:306-330`), with `startStub` at
    `:172`. Firefox's `interceptRpc` can only refuse (`tests/e2e/FIREFOX.md:42`).
20. At `85c4d20f`, `keepChainAccountState` (`tests/e2e/helpers/backup-export.ts:53-63`) is called at
    `backup-restore-integrity.test.ts:153` and `backup-migration-roundtrip.test.ts:112`, each
    followed by the same two-line re-checksum; #719 changes no file under `apps/extension/src`
    this plan touches (`git diff --stat f32b1e0a 85c4d20f`).
21. `importChainSync.test.ts` holds 11 tests (source count); the fake-clock harness at `:44-47`
    only runs timers out, so no existing test bounds elapsed time.
22. Upstream PXE finds a recipient's tagged notes through secrets derived from its known senders
    and local accounts, plus registered shared secrets and app-supplied handshake secrets
    (`@aztec/pxe@5.2.0 dest/logs/log_service.js:145-215`); a sender is an `address-derived` source
    (`dest/pxe.js:424-428`). A note from an unregistered sender under address-derived tagging is
    not found. Nulo's Senders page says "Most transfers are detected automatically. Add a sender
    only for transfers delivered with address-derived tagging."
    (`popup/pages/settings/advanced/account-state/senders/index.vue:139`). Adding one clears the
    cache of synced contracts (`dest/pxe.js:421-423`); each contract then re-syncs against it on
    its next use, not at once (`dest/contract/contract_sync_service.js:36-46`).
23. The PXE host boots a chain's runtime inside that chain's write guard
    (`packages/aztec-runtime/src/pxe/service.ts:1002-1012`, `registry.ensure` under
    `chainGuard.write`).
24. Upstream stores a contract instance under its address with a plain `set`
    (`@aztec/pxe@5.2.0 dest/storage/contract_store/contract_store.js:102-105`) and an artifact
    under its class key (`:95-98`).
25. Upstream's `addSender` returns false for a known sender without writing
    (`dest/storage/tagging_store/tagging_secret_sources_store.js:25-32`); a local account is
    skipped (`dest/pxe.js:492-500`).
26. Restore sets the backup's `active-chain-id` as the new profile's active network when it names
    a seeded chain (`useFullBackupImport.ts:499`; `full-backup-restore.ts:285-300`).
27. Upstream syncs a contract's private state on demand, before a call into it
    (`@aztec/pxe@5.2.0 dest/contract/contract_sync_service.js:36-46`); the wallet resolves a
    non-bundled contract's artifact only from what a dApp passes
    (`packages/aztec-runtime/src/pxe/artifact-registry.ts:40-49`).
28. The normalizer records per-network violations for entries it discards: an item whose senders
    or contracts are not arrays (`normalize.ts:157-160`), a network over the network cap
    (`:181-182`), children over the per-network caps (`:185-198`); malformed items and children
    aggregate under `"(slice)"` (`:141-142`). No registration can bring those entries back. The
    service resolves, not rejects, on a registration failure: each is caught and stored on the
    child (`service.ts:321-326`, `:388`, `:423`), and a deadline lands on the item
    (`:446-448`).
29. A balance read registers what it needs by itself: `resolveBatchContracts` registers any
    contract the PXE lacks and the account (`execution/helpers/batched-view-simulation.ts:269-281`),
    and the standard token artifact is compiled in (`packages/aztec-runtime/src/pxe/artifact-catalog.ts:68`).
    So a fresh balance proves the network works, not that the import restored it. A sender is
    registered only by restore or by the Senders page (`account-state/service.ts:111-120`); adding a
    contact registers none (`tests/e2e/network/senders-advanced.test.ts:61-62`). The Senders page
    reads `getSenders` for the active network (`senders/index.vue:44`, `service.ts:70-76`).
30. `isRestoreHasErrors` is true while the error log has any key (`useFullBackupImport.ts:750`).
31. A preflight attempt is bounded at 5 s, with backoff waits of 2 s and 4 s between up to three
    attempts (`importPreflight.ts:17-18`, `:33-64`); a probe that answers after 5 s is timed out
    and retried.

### Inferences (unverified; audits attack these)

0. **Alpha's 7 exported contracts are exactly the 3 protocol and 4 preloaded ones** (Facts 5, 6,
   9): the count matches what every PXE registers at boot, and #719's funded account lives on the
   local chain. P4's capture run records the classification (kinds and counts, no addresses).
1. **In the e2e build, Testnet's two extra contracts** (Fact 9: 9 − 7) are the account contract
   and Nulo's PrivateFPC or a token, so Testnet still dials after B1 there. This is the e2e shape,
   where Testnet is primary; the same run records it.
2. **Two chains' registrations run concurrently end to end** (SW, offscreen transport, PXE host).
   The dispatch lines and Fact 12 support it; the committed stall spec proves it in Chrome: with
   the stalled slice first, the healthy chain's restored sender reads back before Continue while
   the other hangs (a balance read would not prove it, Fact 29). Firefox is not proven: its
   interception cannot hang a request (Fact 19).
3. **The account contract is re-registered before anything needs it.** The tx path does
   (`nulo-account.ts:169-170`); whether a note sync needs it earlier is not established. It bears
   on how much a stalled network loses, and so on O1.
4. **A compiled-in token is re-registered on its first interface parse**, its instance from the
   node through the PXE's cascade and its artifact from the catalog (`token/service.ts:657-678`).
6. **The popup bundle takes `handshake-registry/constants` without trouble** (it computes one
   `sha256ToField` at load); P1's build and the smoke run confirm it.
7. **`getDefaultStandardPreloadedContracts` runs under vitest on Bun.** If it does not, the pin
   runs in a `bun` subprocess, as `implementations-plan/lessons.md` § Tooling advises for
   `@aztec/*` under `bun test`.
8. **A Retry pressed right after a hard stall usually runs out of time again**, because it waits
   behind the first run's boot (Fact 23) for longer than its own clock. P4's capture run records
   what one immediate Retry does.
9. **In production, a person who uses only Alpha has a Testnet slice of the 7 rebuilt contracts**:
   its PXE is booted only by the export's own reads, so nothing else registers there. Then B1 alone
   ends that person's "Testnet stalled" wait. Not observable in the e2e build (Inference 1).

(Inference 5 of round 1 is now Fact 27.)

### Asks

**Owner**

- **O1 · When one public network stalls, what should the import do?** (A) wait per network,
  (B) A plus Retry, (C) active network only, defer the rest, (D) don't wait; B1 in every option.
  Recommendation: (B). Confidence: moderate. Pictures: § P5 capture list. (§ UI asks.)
- **O2 · The warning's words.** Keep today's, or name the stalled network. Recommendation: keep.
  Confidence: moderate. Pictures: § P5.
- **Blanket sign-off**: UI impact rows 2, 3 and 5, and R1 to R3 (§ UI asks).

**Codex** (round-1 and final-pass decisions recorded; all applied, none open)

- **C1 · Where the predicate lives.** A leaf module used by `registrableNetworkIds` and
  `precheckContractAddress`, entries kept in the normalizer's output. Round 1: **amend**, keep the
  service's network-first throwing parse. Applied (§ B1). Final: **approve**.
- **C2 · One call per network from the popup** versus one call with per-network deadlines in the
  SW (`outline-alt.md`). Round 1 and final: **approve**.
- **C3 · Commit a two-network stall regression?** Round 1 said no. Round 1: **amend**, keep one
  that asserts the healthy chain's registration and exactly one stalled record. Final: **amend**,
  prove the registration directly, since a balance read registers what it needs (Fact 29).
  Applied: `network/backup-import-stalled-network.test.ts` reads back a restored sender before
  Continue, with the stalled slice first and Alpha V5 set active (P4 step 5).
- **C4 · Widen the skip to the profile's own account contracts and Nulo's protocol sponsors?**
  Round 1 and final: **approve** the deferral (F-2).
- **C5 · Keep today's protocol rule (≤ 6) rather than upstream's three addresses?** Round 1 and
  final: **approve**; the pin test also asserts upstream's addresses stay inside it.

### Plan audit ledger

Round 1 ran in parallel; both legs saw this plan, `recon.md` and `outline-alt.md`, with the
adversarial, assumption-attack and implementation-critique asks.

- Opus 5.5 (same-family leg): **conditional approve**, conditions A1 to A3; no confidence stated.
- `/codex high` round 1 (GPT-6 Astra, session `01a0ede9-3668-7553-a25e-6465a92ddfaa`):
  **conditional approve**, confidence high, conditions 1 to 6.
- `/codex high` final fresh pass (GPT-6 Astra, session `01a0ee06-8e09-7cd0-bb47-32ee6c96c292`,
  fresh context with both ledgers): **conditional approve**, confidence high, conditions 1 to 6,
  all accepted (rows 16 to 21). It re-checked rows 1 to 15: all hold except row 5, whose proof
  row 18 repairs, and row 9, whose fixture row 18 corrects.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | Recovery of a stalled network's senders and dApp contracts is conditional, and the tail's outcome dies with the popup after the pending marker was cleared | accepted: slice table and R1 state it (Facts 22, 27); O1 re-weighed to (B) on the production shape; popup close is R3 with a picture (UI row 5) and F-3 |
| 2 | codex | major | The deadline bounds the wait, not the launched work, so a row can go stale | accepted: § Non-obvious mechanics, R2, O2's "may not"; single-record kept; fake-clock elapsed assertion added (P2 step 3); Retry overlap with a late completion tested (P3 step 2) |
| 3 | codex, Opus A1 | major | P3's browser matrix cannot run: sw-restart is proverless and Chrome-only, no results file is written, retry 0 is unset | accepted: P4 step 4 spells each run with `NULO_E2E_RETRY=0` and `NULO_E2E_RESULTS_FILE`; sw-restart on Chrome proverless alone; integrity and roundtrip on both browsers |
| 4 | codex | major | A predicate-only precheck would admit malformed addresses | accepted: the service keeps its throwing parse and compares the parsed value (§ B1); P1 step 1 pins a malformed address launching nothing |
| 5 | codex | major | No durable test of the actual two-network result | accepted: new committed Chrome spec asserting the healthy chain's fresh balance and exactly one stalled record (P4 step 5); both-stalled folded into the unit cases (P2 step 1) |
| 6 | codex, Opus A5 | minor, low | `recon.md` still recommends dropping entries in the normalizer | accepted: recon's rows 1 and 3 and its first convention marked superseded by § B1 |
| 7 | codex | minor | Recon says the warn lines carry only ids and counts; "no new log line" proves nothing about payloads | accepted: corrected in recon and § Security; a hostile rejection message is pinned out of the record (P2 step 2); diagnostics `debug` only |
| 8 | codex | minor | The ~35% export saving is unverified; it includes PrivateFPC, which B1 does not skip | accepted: figure dropped from F-1 |
| 9 | codex, Opus A3 | minor, medium | O1 (C) assumes Alpha is active; the page frames only the e2e shape; Fact 10 conflates primary with Active | accepted: Fact 10 reworded, Fact 26 added, Inferences 1 and 9 split e2e from production, O1 framed on the backup's active network with an Alpha-only capture |
| 10 | codex, Opus A6 | minor, low | P4 omits B's success picture and alternatives' running states; two captures duplicate others; throwaway builds are avoidable | amended: B is now built, so its states are captured from the build; C is mocked; D and B's "answered" reuse the landing capture, captioned; no throwaway builds (P5) |
| 11 | codex | minor | Comments narrate history at `service.ts:313-318`, `:346-349`; "record exactly once" overclaims | accepted: those comments cut to their invariants (file map); "single record" scoped to one tail run's pipelines, violations recorded apart (§ B2) |
| 12 | Opus A2 | medium | After #719 only sw-restart imports several networks, unfiltered, so a public stall reds P4's retry-0 gate | amended: `exportFundedBackup` applies #719's filter too; the multi-network run is the new deterministic stall spec, so no committed spec depends on public dRPC answering |
| 13 | Opus A4 | low | The pin misses the protocol ≤ 6 bound and needs a negative address that parses | accepted: P1 step 4 |
| 14 | Opus A7 | low | The `normalize.ts:31-33` rewrite carried "(F-1)" | accepted: the comment states the invariant only (§ B1) |
| 15 | Opus (critique) | note | A stalled early network also costs later networks their registrations today | accepted: one sentence in § Non-obvious mechanics |
| 16 | codex final 1 | major | Retry replaced every row of a retried network, erasing normalization violations for entries no registration can bring back, and could then complete the import | accepted: `record` is tagged `"violations" \| "outcomes"`; a Retry replaces only outcome rows, with a one-sentence invariant comment; P3 step 4 tests a violation plus a timeout, then a clean Retry: the violation stays and `completeImport` is not called (Fact 28) |
| 17 | codex final 2 | major | Retry eligibility left `resultOutcome` undefined, though the service resolves with registration failures in the result | accepted: § B2 "Which outcomes are retryable": a resolved deadline, unreachable or connectivity-class error is retryable, a payload failure is not; P2 step 2 adds the case beside the REJECTING test |
| 18 | codex final 3 | major | The spec's healthy-balance check can pass without restoration, because a balance read registers contracts and the account itself; the fixture's active network was left to the export | accepted: the healthy slice gains a valid non-local sender read back through the account-state reader before Continue; the stalled slice goes first; `active-chain-id` set to Alpha V5; Inference 2 and Outcome 1 corrected (Fact 29) |
| 19 | codex final 4 | minor | Two P2 cases already pass on the base; the delayed probe at 15 s would exhaust its 5 s attempt; P3 does not assert Continue and View Errors disabled during Retry | accepted: both labelled guards; the slow probe answers 4 s in and both registrations are asserted launched (Fact 31); disabled state asserted on onboarding's mount test and in the stall spec for the popup |
| 20 | codex final 5 | minor | The 40 MiB realism line dismissed a case an ordinary export nearly hits; Fact 22 overstated when a new sender re-syncs | accepted: realism line corrected (the existing cap and warning stay, no new work); Fact 22 now says the sync cache is cleared and each contract re-syncs on its next use |
| 21 | codex final 6 | minor | `useFullBackupImport.ts:678` carries `Q-02` and `:720` `(P7)` | accepted: both tags removed in P2 step 5, invariants kept (file map) |

### Decision ledger

- **Outline**: the main outline (one shared predicate; one pipeline per network from the popup)
  over `outline-alt.md` (per-network deadlines inside one SW call, plus the export omitting rebuilt
  contracts): both audits preferred it for blast radius and simplicity, codex C2 approved.
- **Rejected alternatives**: the alt's in-SW concurrency (aggregate coupling, § Trade-offs); drop in
  the normalizer (precedence); export-side omission now (F-1); O1 (C) and (D) as recommendations.
- **O1 re-weighed** (driver's call on codex 1 and Opus A3): with Facts 22 and 27, what a stalled
  network loses is not dependably recovered and can show a low private balance, a wrong-amount path;
  Retry is the only in-app recovery; recommendation moved from (A) to (B), confidence moderate.
- **B2 dispatch**: the driver's note read B2 as already dispatching per probe; the round-1 sketch
  did not (it awaited the whole preflight, as Fact 1 does today). Amended to per-network pipelines.
- **Realism triage** (the owner's rule: build, test and ask only what a real person hits):
  - One public node stalls during a restore: realistic (the recovery path; public nodes stall). B2,
    tested at unit and e2e.
  - Both public networks stall together: realistic, since both seeds share one provider
    (Fact 10). Each marks itself; one unit case.
  - The active network (Alpha) stalls while another answers: realistic, the production shape; the
    committed spec and the captures use it.
  - Registered senders or a dApp contract on the stalled network: realistic but uncommon, and a
    wrong-amount path (low private balance); R1, and the reason for (B).
  - A late registration lands after the screen moved on: realistic on a slow node; R2; Retry clears
    it, tested.
  - Retry pressed right after a hard stall: realistic; it usually stalls again (Inference 8); stated,
    no extra code.
  - Retry pressed twice: realistic; the second press is a no-op, one composable case.
  - The person closes the popup during the tail: realistic (any click outside closes it, and the
    tail can take about 45 s), pre-existing, out of scope: R3, UI row 5 pictured, F-3.
  - The person restores fully offline: realistic; unchanged (the preflight's unreachable path,
    `importChainSync.test.ts:94-102` and `import-dead-rpc`), now retryable.
  - A hostile backup puts a malicious entry at a provided address: realistic threat; skipped,
    registers nothing; the classification test.
  - A hostile backup spells a provided address in another case or with padding: the parse
    normalizes both; at worst it registers as today, and the host derives the address from the
    preimage. No test.
  - An `@aztec/*` bump changes the preloaded list: realistic (it happened with HandshakeRegistry);
    the pin test.
  - A hostile backup lists 8 networks or more than 8: bounded by the normalizer caps and the three
    seeds; unknown ids dial nothing; unrealistic for a real person. No work.
  - A slice near the 40 MiB cap: realistic, since an ordinary three-network export measured 33.8M
    (`normalize.ts:20-30`). The existing cap and its export-time warning at 80 % stay as they are;
    B1 leaves the export unchanged, F-1 shrinks it. No new work.
- **The tail returns items, not ids** (builder's call at P2): `runImportChainSync` resolves with
  the retryable networks' normalized items, so B3's stage keeps exactly what a Retry replays
  without normalizing a multi-megabyte slice a second time. The retry set is still derived only
  from the tail's own outcomes.
- **Two more composable members** (builder's call at P3): `isRetryingAccountState`, because the
  in-flight flag already lives in the composable for the no-op second press and both pages read it
  for the running label and the disabled buttons; `dispose`, called by `useProfileImportFlow`'s
  own, so a Retry still running when the page unmounts writes nothing and completes nothing. Back
  (`resetBackupState`) and a new import drop the retry context the same way; one composable case.
- **Outcome rows by identity** (builder's call at P3): the stage keeps the row objects its outcome
  record wrote and the composable compares them raw (the log is deep-reactive and reads back
  proxies). A violation row naming the same network, and the reseed stage's dropped-row records
  under the same key, are never replaced.
- **Enter waits for a Retry** (builder's call at P3): the popup's document-level Enter shortcut
  resolved to Continue on the errors screen even with Continue disabled; it now resolves to nothing
  while a Retry runs. The keyboard-guards plan rewrites that handler; whichever lands second keeps
  the rule.
- **Continue and a new pick end the Retry** (codex round 1, builder's call): Continue drops the
  Retry context before the completion handshake, so Retry leaves the screen as Continue is
  pressed and cannot complete the import a second time; picking another backup drops it too, so a
  late clean Retry cannot complete the first import from the new selection's form. The drop waits
  for the picker's answer (codex round 2's point, not taken): a Retry answering inside the
  sub-second decompression of the chosen file still completes the first, fully restored profile,
  while dropping it as the picker opens would lose the Retry on every cancelled pick, since
  `pickFile` never settles on a cancel.
- **Enter on a focused Retry** (builder's call at P4): until the keyboard-guards plan lands, that
  document-level shortcut also sees an Enter pressed on the focused Retry and runs Continue beside
  the Retry's own click (View Errors has the same gap on dev). That plan's root listener answers
  only an Enter in a field, which ends it for every button on the page, so it is not patched here.
- **Retry's look** (builder's call, pictured for the owner in P5): an outline button above
  Continue, so Continue stays the one filled button; while it runs it reads `Retrying…` (popup) or
  `Retrying...` with the spinner the onboarding Import button uses, and it is disabled. In the
  360x600 popup the fourth footer button covers the warning sentence until the page scrolls (the
  three-button footer of dev and (A) already covers its last line); both are pictured, unscrolled
  and scrolled, for the owner.
- **The export drive joins the seal in `backup-export.ts`** (builder's call at P4):
  `exportPlainBackup` and `accountChainId` sit beside `sealPlainBackup`, because the stall spec
  would have been the fourth copy of the export drive and of the funded-chain lookup; integrity,
  round-trip and crash-truth use them too.
- **The stall spec's Retry leg is its own commit** (builder's call at P4), so (A) reverts it with
  P3's commits. (A)'s revert keeps `4c0b26e1` (the tail's record kind back to an inline union):
  without it the build regenerates `auto-imports.d.ts` with the exported alias P2 left, as the
  P2 capture build did.
- **The stall spec reads the sender before judging the rows** (builder's call at P4): the sender
  check is soft and runs first, so a red run shows both symptoms (lessons/phase-4.md).
- **The balance check runs on a fresh popup page** (builder's call at P4): the import page's store
  does not follow a network switch made on another page, so it cannot be the page that reads the
  local balance after Continue.
- **A third Chrome-only file** (for the owner): the e2e-testing skill makes adding one the owner's
  call. The stall spec needs a request that hangs, which Firefox's interception cannot make; asked
  on the P5 page.
- **Retry keeps normalization violations** (final pass 1, driver's call): the row split is the
  smallest change that stops a clean Retry from completing an import whose normalizer discarded
  entries.
- **The popup-close limit stays explicit** (driver's call on the final pass): nothing in this
  plan claims a partial import cannot appear complete; a popup closed mid-tail reopens on a wallet
  that looks complete (UI impact row 5, R3, F-3).
- **The names follow seed order** (builder's call at P6): the Retry context's networks in the
  order `seedDefaultsForProfile` returned them (Alpha V5, Testnet, Local Network in production),
  not the slice's, so one failure always reads the same. Three names join with a serial comma, as
  the answer's "retry, review the details, or continue" does.
- **"Other errors" is any row a Retry cannot replace** (builder's call at P6): a normalization
  violation, a reseed-dropped row, a non-retryable network's row, or another service's row. The
  rows are compared raw, as the Retry's own replacement compares them, through the one shared
  `retryReplacedRows`.
- **The scroll and the alert live in the shared form** (builder's call at P6), so both pages get
  them. `block: "nearest"` moves nothing when the warning already shows, which is the onboarding
  page in any window tall enough; the scroll runs once per appearance, so a Retry's new words do
  not move the page (F-5 is the follow-up about showing that a Retry ran).
- **Enter on a focused Retry needed no product change** (builder's call at P6): the merge's root
  listener answers only an Enter in a field, so the red at `91378ecd` turns green on the merged
  head.
- **The open lands at the scroller's end, not at the title's clearance** (builder's call at P6
  step 8): the decision's four-line case wants the accent bar under the bar too, which only the
  end (116) reaches; the three-line end (102) is where its title clears (101.6). On this screen
  the end is always the warning plus its section's 20 px, so the end never scrolls past what the
  warning shows. The layout does the scrolling because it owns the scroller, the bar and the
  title; the form stays generic, and a page without the layout keeps `block: "nearest"`.
- **Disputed**: none. Round 1 left none open, and the final pass raised no point the plan
  contests: its six conditions are applied as it named them.
- **Brief items judged**: none dropped as unrealistic; the brief's option (b) is O1 (C), not
  recommended.

### Follow-ups

- **F-1 · The export writes contracts every PXE rebuilds.** They are duplicated once per network
  and count against the 40 MiB cap (`normalize.ts:20-23` names HandshakeRegistry, AuthRegistry and
  PrivateFPC as the dominant duplicates; only the first two are PXE-provided). Omitting the
  provided ones at export shrinks every backup; old backups still carry them, which B1 handles.
- **F-2 · Skip the profile's own account contracts and Nulo's protocol sponsors too** (codex C4),
  once it is shown that nothing needs them before they are re-registered (Inference 3). It would
  make an e2e-shaped Testnet slice dial nothing.
- **F-3 · Persist the import tail's per-network outcome and show a network that was not restored
  after a reopen (an owner design).** `finalizeRestore` clears the restore-pending marker before the
  tail (`wallet/services/profile/service.ts:2671-2677`), and the tail's rows live only in the page's
  ref (`useFullBackupImport.ts:746`), so a popup closed mid-tail reopens on a wallet that looks
  complete (R3, UI row 5).
- **F-4 · The light-theme warning reads at about 1.6:1.** The yellow `Warning` tag and sentence
  (`ImportFullBackupForm.vue`, `--yellow`) sit far under a readable contrast on the light
  background (§ P5, from the panel). A colour change is an owner call.
- **F-5 · A Retry that fails again returns a pixel-identical screen.** Nothing shows that it tried
  (§ P5): the same row, the same sentence, the Retry button back as it was.
- **F-6 · The error viewer and the onboarding notice do not name the networks.** The viewer's rows
  carry the network's id, and onboarding's `View errors` opens a notice that says "Check the
  developer console for details" (`onboarding/pages/import.vue`); only the warning names them
  (§ P5).
- **F-7 · The four skip strings join two clauses with an em dash** (`normalize.ts:39-41`, and the
  reseed stage's "Skipped — its network is not one of the built-in networks"). copy-polish takes
  them (its E25 to E28).

## Approval

Technical: the final fresh codex pass is a conditional approve, all six conditions applied (Plan
audit ledger rows 16 to 21). The build runs as recommended (A's parts, then B3 in its own
commits); the owner's page comes after P4 (P5). Answered 2026-09-29 by the driver under the
owner's delegation (§ P5); P6 builds the answers. The owner confirmed them on 2026-09-30 (§ P5).

**Delivery boundary** (the same rule in P5 and Delivery): the PR opens and CI runs while the
owner's answers are pending, but it does not merge until O1, O2 and the blanket sign-off are
quoted in this plan.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/backup-import/lessons/phase-N.md`. Unit commands run from
`apps/extension`. Every phase writes its failing test first and records the red run in its lessons
file before the fix. Start from `dev` at `85c4d20f` or later.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/backup-import/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`:
   `- [backup-import](backup-import/plan.md) — building — a full-backup import that one slow public node cannot stall: skip what every PXE rebuilds, one clock per network, retry`.

Validation gate:
- Commands: `bun run lint`; `bun scripts/ci-cd/plans/check.ts`.
- Pass: both exit 0.
- Layers: lint, CI-gating (plans).

### P1 · Skip what every PXE boot registers (B1) ✓

Assumptions: Facts 3 to 6, 16, 17; Inferences 6, 7.

1. Red, in `restore-surface.pins.test.ts`: an item with `STANDARD_AUTH_REGISTRY_ADDRESS` and a real
   `0x`-prefixed 64-hex address: `registerContract` runs once, the result lists only the real one
   (red on the base: two launches). Guard, green before and after: an item on an existing network
   with a malformed address gets its parse error and launches nothing.
2. Red, in `normalize.test.ts`: `registrableNetworkIds` of an item whose contracts are the 3
   protocol and 4 preloaded addresses, no senders, is `[]`.
3. Red, in `importChainSync.test.ts`: the same Alpha-shaped item on a created network: no probe,
   no `restore` call, no record (red on the base: one probe).
4. `pxe-provided.ts` and `pxe-provided.test.ts`: the protocol range, each preloaded address (one
   lower-case and one upper-case spelling), a sub-modulus 64-hex negative (`0x07…07`, which parses),
   a malformed string (false); the pin: the set equals the addresses
   `getDefaultStandardPreloadedContracts()` returns, and every `ProtocolContractAddress` value is
   ≤ 6.
5. Wire the predicate into `registrableNetworkIds` and the parsed comparison into
   `precheckContractAddress`; rewrite the `normalize.ts:31-33` comment; cut the "monolith"
   narration at `service.ts:313-318` and `:346-349` to the invariants (the lazy guard sampling, the
   single await). `service.test.ts:213-231` stays green unchanged.
6. Build once: the popup bundle takes the constants (Inference 6), and the generated declarations
   show no diff.

Validation gate:
- Commands: `bun --bun vitest run src/wallet/services/account-state/ src/composables/importChainSync.test.ts`;
  `bun run lint`; `bun run typecheck:all`; `bun run build`.
- Pass: all exit 0; the three red runs recorded in `lessons/phase-1.md`; `git status` shows no
  change under `apps/extension/src/types/` after the build.
- Layers: lint, types, unit, build.

### P2 · Each network on its own pipeline (B2) ✓

Assumptions: Facts 1, 2, 11, 12, 14, 15, 21, 28, 31; Inference 2.

Red means it fails on the base; a guard is green before and after and says so in its lessons line.

1. Red, in `importChainSync.test.ts` (fake timers): n1 and n2 both go; `restoreImpl` resolves n1's
   item at once and never settles n2's. The records hold n1's result and a single deadline record
   for n2, nothing for n1 (red on the base: one call, both deadline). Red: n1's probe answers at
   once while n2's answers 4 s in (inside its 5 s attempt, Fact 31): n1's `restore` call is made
   before 4 s of fake time, and n2's call is made too, after its probe answered (red on the base: it
   waits for the whole preflight). Guard: both never settle → exactly one deadline record each
   (today's aggregate timeout already records both).
2. Red: n1's call rejects with `Error("<script>0xdeadbeef")` and n2's resolves: only n1 gets a
   record, and it equals `skippedNetworkRecord("n1", ACCOUNT_STATE_SKIP_DEADLINE)` exactly. Beside
   it, next to the REJECTING case (`importChainSync.test.ts:156`): n1's call **resolves** with a
   child whose `restoreError` is `"Error fetching from host http://x: TypeError: fetch failed"` →
   n1 is among the returned retryable ids; n2's resolves with `"Invalid artifact: missing function
   abi"` → n2 is not.
3. Guard (green on the base, which already clamps registration to the remaining total,
   `importChainSync.ts:89-103`): n1's probe answers Active on its third attempt, 4 s in (20 s of
   fake time), and its `restore` never settles; the tail's promise settles at a `Date.now()` no more
   than `IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS` after its start, read in a `.then` on the tail, not
   after `runAllTimersAsync`; the late resolution then appends nothing.
4. The existing HANGING case (`importChainSync.test.ts:139-155`) keeps its no-late-append check,
   now per network; `runImportChainSync` returns the retryable ids (deadline, rejected,
   unreachable, a resolved connectivity failure; not a payload failure, not wrong-network, not
   unknown), and tags its two `record` calls.
5. Implement `syncOneNetwork`, `resultOutcome` and the one `record`; update the header comment to
   the per-network rule. In `useFullBackupImport.ts`, drop the `Q-02` tag (`:678`) and `(P7)`
   (`:720`) from their comments, keeping the trust-order and completion-error invariants.
6. `useFullBackupImport.test.ts:944-971`: two calls, each with its one item under its seeded id.

Validation gate:
- Commands: `bun --bun vitest run src/composables/importChainSync.test.ts src/composables/importPreflight.test.ts src/composables/useFullBackupImport.test.ts src/composables/useFullBackupImport.stages.test.ts src/wallet/services/account-state/`;
  `bun run lint`; `bun run typecheck:all`.
- Pass: all exit 0; the red runs recorded in `lessons/phase-2.md`; `bun run lint` reports no
  complexity finding in `importChainSync.ts`. Commit, and note the SHA in lessons: P5 captures
  option (A) at it.
- Layers: lint, types, unit.

### P3 · Retry the networks that did not restore (B3, recommended O1 (B)) ✓

Assumptions: Facts 11, 13, 23 to 25, 28, 30.

1. Red, in `useFullBackupImport.test.ts`: after a tail where n2 ran out of time, `canRetryAccountState`
   is true; `retryAccountState()` calls `restore` once, with n2's item only, and no violation is
   recorded again; when that call resolves clean, the account-state rows hold nothing for n2, other
   services' rows are untouched, and `completeImport` is called once if no row remains.
2. Red: retry overlapping a late completion: n2's first-run `restore` resolves after the retry
   started, the retry's own call resolves too; the log holds at most one row for n2 (none here), and
   the first run's resolution appends nothing. Retry stalls again → exactly one n2 row.
3. Red: a second `retryAccountState()` while one runs makes no call.
4. Red: n2 carries a normalization violation (senders over `maxSendersPerNetwork`) and its call
   runs out of time; `retryAccountState()` resolves clean for n2: n2's violation row is still in
   the log, its deadline row is gone, `canRetryAccountState` is false, and `completeImport` is not
   called.
5. Implement `retryAccountStateStage`, the retained context, the row replacement (violation rows
   kept, with its one-sentence comment; an emptied key deleted), the two composable members and
   their pass-through in `useProfileImportFlow`; add the Retry button to both pages (Continue and
   View Errors disabled while it runs).
6. `useProfileImportFlow.test.ts` passes the two members through (extend its existing
   pass-through case). Red, in `onboarding/pages/import.test.ts` (its mount harness): while
   `retryAccountState` is pending, Retry shows `Retrying...` and `import-full-backup-continue-btn`
   and `import-full-backup-view-errors-btn` are disabled. The popup page has no mount harness; its
   twin assertion runs in P4's stall spec, whose Retry waits on the blackholed node.

Validation gate:
- Commands: `bun --bun vitest run src/composables/ src/wallet/services/account-state/ src/onboarding/pages/import.test.ts`; `bun run lint`;
  `bun run typecheck:all`; `bun run build`.
- Pass: all exit 0; the red runs recorded in `lessons/phase-3.md`; no complexity finding; the
  generated component and auto-import declarations change only by what the new members need.
- Layers: lint, types, unit, build.

### P4 · Browser proof and the arc gate ✓

Assumptions: Facts 18 to 20, 26, 29; Inferences 0 to 2, 8, 9.

1. Every local gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`.
2. Smoke on Chrome and Firefox (the migration-fixture build per browser, then
   `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`); `import-dead-rpc`'s stub
   cases run on Chrome there, on the moved `rpc-stub` helper.
3. Test-side edits: `sealPlainBackup` in `helpers/backup-export.ts`, used by integrity, roundtrip,
   `crash-truth.ts` and the new spec; `exportFundedBackup` applies `keepChainAccountState` for the
   funded chain; a `data-testid` on the data viewer popup's root.
4. Network e2e, from the repo root, one `e2e:agent` at a time. Before each run remove its report;
   after it, `jq -e '.numTotalTests > 0 and .numPassedTests == .numTotalTests' <report>` exits 0 (a
   skip fails it). Each run is
   `NULO_E2E_BROWSER=<b> NULO_E2E_RETRY=0 NULO_E2E_RESULTS_FILE="$PWD/apps/extension/.e2e-state/report-<name>-<b>.json" NODE_OPTIONS=--dns-result-order=ipv4first [NULO_E2E_PROVERLESS=1] bun run e2e:agent <file>`:

   | File | Browser | Prover |
   |---|---|---|
   | `tests/e2e/network/backup-restore-integrity.test.ts` | chrome | on |
   | the same | firefox | `NULO_E2E_PROVERLESS=1` |
   | `tests/e2e/network/backup-migration-roundtrip.test.ts` | chrome | on |
   | the same | firefox | `NULO_E2E_PROVERLESS=1` |
   | `tests/e2e/network/backup-restore-sw-restart.test.ts` | chrome only (whole-file Chrome-only) | `NULO_E2E_PROVERLESS=1` (required) |
   | `tests/e2e/network/backup-import-stalled-network.test.ts` | chrome only (`CHROME_ONLY.cdpFetch`) | on |

5. The new spec, `network/backup-import-stalled-network.test.ts`: the funded wallet exports a
   backup; keep the funded chain's item (`keepChainAccountState`) and add one valid, non-local
   sender to it (a fresh `AztecAddress.random()`, as `senders-advanced.test.ts` makes one); put a
   copy relabelled to Alpha V5's chain id **first** in the slice; set the backup's
   `active-chain-id` to Alpha V5's chain id explicitly (restore honours it on its own, Fact 26);
   re-seal. In a fresh extension redirect `https://lb.drpc.live` to the `rpc-stub` answering
   `aztec_getNodeInfo` as Alpha V5 (its `l1ChainId` and a `rollupVersion` whose composite is
   `CHAIN_IDS.MAINNET`) and blackholing the rest; import. Assert: the errors screen appears; View
   Errors lists exactly one account-state record, Alpha V5's, with the deadline copy. **Before
   Continue**, a second popup page switches to the local network and opens Settings → Advanced →
   Account State → Senders, which reads the account-state service (Fact 29): the row
   `sender-row[data-sender-address=<the sender>]` is present. Nothing but the restore registers a
   sender, so this is the proof of the healthy network's restoration (Inference 2). While (B)
   stands, the import page then presses Retry once: while `Retrying…` shows, its Continue and View
   Errors are disabled; afterwards the one Alpha V5 record remains. After Continue, the funded token
   on the local network reads a fresh balance row (`waitForFreshBalanceRow` past the imported
   baseline), which shows the wallet works there, not that the import restored it. Red first: on the
   base the local network is recorded too and its sender is missing. Flake bar: the file ten times in a row,
   retry 0, all green, before the PR opens; the ten results in `lessons/phase-4.md`.
6. The capture run, Chrome, never committed: the new spec's harness plus an export read that
   records the kinds and counts of contracts per exported network (Inferences 0, 1; no addresses
   in the log), one immediate Retry's outcome (Inference 8), and the P5 captures, including a
   popup closed during the tail and reopened.
7. `bun run e2e:reap`.

Validation gate:
- Commands: steps 1 to 7 as written.
- Pass: every command exits 0; every report passes step 4's check; the new spec's red run and ten
  greens recorded; the capture run's results in `lessons/phase-4.md`.
- Layers: lint, types, unit, CI-gating, build, smoke e2e, e2e-live-network (Chrome and Firefox,
  each file on the browsers it supports).

### P5 · The owner's sign-off ✓

1. Captures, Chrome, popup at 360 px, onboarding at its page width. "Built at P2" means a capture
   worktree at P2's SHA (commit before switching, never undo a probe with `git checkout`); "built"
   means the branch head.

   | Option | State | Surface | Theme | Source |
   |---|---|---|---|---|
   | A | the tail running, Alpha V5 stalled | popup import, `Importing…` | light and dark | built at P2 |
   | A | finished, Alpha V5 stalled | popup: warning, Continue, View Errors | light and dark | built at P2 |
   | A | View Errors open | popup data viewer with one Alpha V5 row | light | built at P2 |
   | A | finished, Alpha V5 stalled | onboarding import with its notice open | light | built at P2 |
   | all | Alpha-only shape: Testnet holds only rebuilt contracts, its node down | popup lands in the wallet, no errors screen | light | built |
   | B | finished, Alpha V5 stalled | popup: warning, Retry, Continue, View Errors | light and dark | built |
   | B | Retry running | popup `Retrying…`, Continue and View Errors disabled | light | built |
   | B | Retry ran out of time again | the finished screen, one Alpha V5 row | light | built (captioned reuse of B row 1 if identical) |
   | B | Retry answered | lands in the wallet | light | the Alpha-only landing capture, captioned |
   | B | finished, Alpha V5 stalled | onboarding with Retry | light | built |
   | C | the import waiting on the active network, then finished | popup import, then the wallet | light | faithful mock at 360 px, Space Grotesk |
   | C | first switch to Testnet | the network switch with its registration running | light | faithful mock |
   | D | Alpha V5 stalled | lands in the wallet at once, work pending | light | the Alpha-only landing capture, captioned |
   | O2 keep | finished, Alpha V5 stalled | the warning block | light | built (= B row 1) |
   | O2 name | finished, Alpha V5 stalled | the warning block with the named sentence, (A) and (B) wording | light | faithful mock at 360 px |
   | blanket row 5 | popup closed during the tail, reopened | the wallet's Home | light | built |
   | blanket rows 2, 3 | as A rows 3 and the Alpha-only row | as above | light | reused |

2. Hand the captures to the driver, who publishes one private Artifact: O1 and O2 with their
   pictures, and one blanket sign-off for UI impact rows 2, 3 and 5 and R1 to R3.
3. Record the answers here, quoted. (A): revert P3's commits and their tests, rerun P3's and P4's
   gates. (C) or (D), or O2 name: a new phase with its failing-first tests, P4's gates again, new
   captures.

Validation gate:
- Commands: none beyond the Artifact publish.
- Pass: the Artifact URL printed; O1, O2 and the blanket quoted here with their dates.
- Layers: owner sign-off. The delivery boundary (§ Approval) applies.

**Answers, 2026-09-29.** The owner delegated the open decision pages to the driver: "any chance
your resolve auditing with Codex and Opus5.5 subagents the open artifacts? Ask those subagents to be
evaluators on the ux/ui/copies. Use your knowledge about my previous decisions too." A panel of two
Opus 5.5 evaluators (one on interaction, one on copy and visuals) and codex (session
`01a0ef40-44c7-7670-84fe-ff8adffa9f01`) read `captures/index.md`, its pictures and this plan, and
the driver decided:

- **O1 → (B)**, unanimous. Three conditions before merge: merge `dev` (keyboard-guards, #720,
  landed as `4387b112`) with a signed merge commit; prove, red first, that Enter on a focused
  Retry runs only Retry (on this branch before that merge it also ran Continue); disable Back
  while a Retry runs, as it is while importing.
- **O2 → name the network**, unanimous, by the networks' display names, not their ids, on both
  pages:
  - one network: "Alpha V5 didn't answer in time, so what was saved for it may not be restored.
    You can retry or continue.";
  - two or more: "Alpha V5 and Testnet didn't answer in time, so what was saved for them may not
    be restored. You can retry or continue.";
  - when other, non-network errors remain too, the last sentence becomes "You can retry, review
    the details, or continue.";
  - with no network that timed out or could not be reached (other errors only), today's sentence
    stays.
- **Retry's look → fix**, unanimous, as the smallest change: when the errors screen opens, the
  warning scrolls into view, so its sentence shows without the person scrolling; the warning gets
  `role="alert"`; the three-button case (no Retry) is checked too.
- **Blanket → signed** (rows 2, 3 and 5, R1 to R3), two to one. The dissent: codex would block
  row 5 and R3, today's behaviour, where a popup closed during the tail reopens on a wallet that
  looks complete; F-3 stays its fix.
- **A third Chrome-only e2e file → accepted**, its reason in `CHROME_ONLY`: the stall needs a
  request that hangs, which Firefox's interception cannot make.
- **Follow-ups** (F-4 to F-7): the light-theme warning's contrast (about 1.6:1); a failed Retry
  returns a pixel-identical screen, so show that it tried again; the networks' names in the error
  viewer and the onboarding notice (which says "Check the developer console"); the skip strings'
  em dash is copy-polish's.

No Artifact was published for this page: the panel read the captures in the driver's scratch
directory. CLAUDE.md asks for a sign-off in the owner's own words naming the surface; this record
is the owner's delegation and the driver's decisions, quoted as the driver relayed them.

**The owner's sign-off, 2026-09-30.** The driver then published the decision page, every option
and § P6 step 8's landing pictured as built (https://claude.ai/artifact/CRRjSDLKZwcg8osNf4BQ1x).
In its `answers` db the owner answered `o1`: **"o1-b"**, `o2`: **"o2-name"**, `look`:
**"look-fix"** and the blanket `rest`: **"signed"**, then wrote: "Okei, ive answered everything
on the artifacts." Every row of § UI impact now carries the owner's own answer.

### P6 · The owner's calls: the warning names the networks and opens in view; Back and Enter wait for a Retry ✓

The answers above. O2 (name) and the look fix change what the screen shows; O1's conditions change
the keyboard and Back.

1. Merge `origin/dev` (keyboard-guards, `4387b112`) with a signed merge commit. Its popup page test
   mocks the flow: the mock gains the Retry members, and its "does not continue" cases assert on
   the flow's `continueImport`, which Continue calls since codex round 1.
2. Red first, each run recorded in `lessons/phase-6.md`, then the change:
   - Enter on a focused Retry runs only Retry (`popup/pages/import.test.ts`, `pressOn`): red at
     `91378ecd`, where the page's document listener also ran Continue; green after the merge,
     whose root listener answers only an Enter in a field.
   - Back is disabled while a Retry runs, on both pages (`popup/pages/import.test.ts`,
     `onboarding/pages/import.test.ts`).
   - The sentence: `components/composite/import/restore-warning.ts`, beside the form and outside
     the auto-import directories, builds it (one network, two or three, with other
     errors, none); the composable adds `unrestoredNetworkNames` (the seeded names of the networks
     a Retry replays, in seed order) and `hasOtherRestoreErrors` (a row no Retry replaces); the
     form takes both, and both pages pass them.
   - The warning scrolls into view once, as it appears (`block: "nearest"`), and carries
     `role="alert"` (`ImportFullBackupForm.test.ts`).
3. `CHROME_ONLY.hangingRequest` carries the stall spec's reason; FIREFOX.md, CLAUDE.md and the
   e2e-testing skill say which file skips for which reason.
4. F-4 to F-7 into `implementations-plan/follow-ups.md`.
5. P4's gates on the head: its steps 1, 2 (three shards per browser) and 4 (its three
   invocations).
6. Captures (Chrome, never committed): the finished screen as it opens, light and dark; onboarding
   finished; the plural case; the three-button case; a stall with another error beside it.
7. One codex round on the diff since `91378ecd`, the merge's conflict resolution included.
8. **Where the open lands.** The step 6 captures showed the popup's four-button screen opening at
   scroll 82 of its 102, with the hero's second line, "PROFILE", cut in half under the compact
   bar. Measured at 360x600, the same on Chrome and Firefox: the title's box clears the bar at
   101.6, its accent bar at 113.6 and the whole hero block at 133.6; a four-line warning makes the
   maximum 116; the three-button screen's maximum is 34, and onboarding has no hero and does not
   scroll. Decided 2026-09-30: the scroll lands the title under the compact bar where the scroller
   allows it; decided by the driver under the owner's delegation after the capture showed a
   half-cut title. No layout change: the 32 px of room the whole block needs was declined, and so
   was moving the warning into the footer. Built as the scroller's end wherever that end clears
   the title, and today's nearest scroll everywhere else: `CollapsingHeroLayout` provides
   `reveal` (`components/composite/collapsing-hero.ts`) and the form hands it the warning. Red
   first: `tests/e2e/import-errors-scroll.test.ts` on the previous code landed at 82, not 102, and
   put a four-line warning's title bottom at 61.6 against the bar's 56. Then step 6's captures
   again under the same names, plus the three-line screen on Firefox, the gates the change
   touches, and one codex round on it (round 5).

Validation gate:
- Commands: steps 2 to 8, then `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
  `bun run test:ci-gating`, `bun run build` and `bun scripts/ci-cd/plans/check.ts`.
- Pass: every command exits 0; the red runs recorded; the smoke and network reports pass with no
  skip beyond P4's; the captures listed in `captures/index.md`.
- Layers: lint, types, unit, CI-gating, build, smoke e2e, e2e-live-network, owner sign-off (§ P5).

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P4 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the
   supply-chain / crypto / least-privilege weaknesses?"), and these two rules, verbatim in the
   first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/post-impl.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. A fix that changes a captured surface re-captures it and asks the owner again.
5. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `fix/backup-import`, one PR off `dev`, plain `gh pr create` after the
  loop converges; then `gh pr checks --watch`.
- Title: `fix(backup): one import clock per network, skip what every pxe rebuilds, retry a stalled one`
  (92 characters; a `(#NNN)` suffix keeps the squash subject at 99).
- Commits: conventional, lower-case, signed; at least one per phase, B3 in its own commits, fixes
  separate.
- PR body: summary, the UI impact table, O1, O2 and the blanket as **pending** (or the owner's
  quoted answers), the red-before-green evidence per phase, the new spec's ten runs, the capture
  run's results, e2e counts.
- **Overlap.** Starts from `dev` at `85c4d20f`; #719's backup-test filter stays and extends to
  `crash-truth.ts` (Fact 20). The shared file is `implementations-plan/follow-ups.md`: this PR
  deletes only its own § ux-feedback: owner decisions entry and adds F-1 to F-3 under § ux-feedback:
  technical; reconcile against trunk right before delivery.
- **Merge**: by the driver under the owner's standing authorization, once every required check is
  green on the head, O1, O2 and the blanket are quoted in this plan (§ Approval), and the codex
  loop has converged. Never `--admin`.
- Closing the plan in the same PR: the `## Outcome` block after the front matter, lessons
  promoted, F-1 to F-3 moved to `implementations-plan/follow-ups.md`.

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/backup-import/plan.md. Done when the transcript shows every phase ✓ in plan.md with its validation gate reported passing, the red run recorded before each fix in P1 to P3, LESSONS_FILE=implementations-plan/backup-import/lessons/phase-N.md printed per phase, P4's e2e reports passing with no skip on each file's supported browsers, the new stalled-network spec's red run and ten retry-0 greens recorded, the owner's O1, O2 and blanket answers quoted in P5, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. UI questions go to the owner, technical ones to /codex high. Merge only under the plan's merge rule; never --admin.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/backup-import/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing test first and record the red run; after each edit run bun run lint and the phase's vitest command from apps/extension; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner's page in P5. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skipped network spec is not a pass; one e2e:agent at a time; bun run e2e:reap after the last. All phases ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Merge only under the plan's merge rule; hard limits stay hard.
```

Use exactly one per session.
