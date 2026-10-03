---
plan: harden-dedupe / incoming-arms (arc 14 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/14-incoming-arms, stacked on harden-dedupe
---

# incoming-arms: one trust promotion, one prompt payload, one scope clear

Findings Q-18 and Q-27 (l), from `audit/quality/2026-09-30-dedup-high/`. `IncomingTransferService` discovers receipts from two sources, private notes and public `Transfer` events, and runs each through a hand-copied arm. Its scope clears and its repository's purge inventory are also written twice. Q-27 (l) is the public-event cursor comparator, defined once in `aztec-runtime` and again in the extension.

This batch consolidates only what can move without changing a single await, epoch re-check, write, emit or payload byte. The two arms disagree on where they re-check the service epoch, so the commit pipelines, record builders and dedupe stay as they are; the panel kept that disagreement as it is and routed it to follow-ups (see § Decisions).

## Outcome & Quality Bar

- **For whom:** the next person who changes the first-receive prompt, adds a trust state or adds a sixth incoming-transfer store. Today the prompt payload is written three times, the unknown→pending promotion twice, and the five-store inventory twice.
- **Excellent:**
  - The pending-prompt payload, the trust promotion, the note-scheduler teardown, the scope-clear scaffold, the repository's purge inventory and the cursor comparator each have one definition.
  - Every epoch re-check sits after the same await as today. A permanent interleaving matrix, asserting each bumped row's ordered call log as well as its outcome, fails if a check is dropped, moved or added. A redundant synchronous duplicate of an existing check is not observable there; it is a source-review item.
  - A temporary microtask fingerprint of each touched critical section and each real repository clear is byte-identical before and after Phase 2; the counts are logged, then the fingerprints are removed.
- **Good enough:** the record builders, both commit functions and both dedupe sequences stay per arm. Each one's await order, re-check placement or persisted key order differs today (see § What stays).

## Architecture & Implementation

Read on `harden-dedupe` at `7450928c`. All paths are under `apps/extension/src/wallet/services/incoming-transfer/` unless noted. `service.ts` is 2,464 lines.

### The concurrency model this arc must not disturb

- **The epoch is a plain counter.** `serviceEpoch` lives at `service.ts:227` and is bumped by `bumpServiceEpoch` at `:271-273`. Each critical section captures `epochAtStart` before its first await and compares it later.
- **Bumps can land at any await, not only on lock handoff.** `hydrateSchedulers` bumps at its entry (`:916-917`). Its event-driven callers, `onActiveProfileChanged`, `onAccountAdded` (`:403`), `onTokenAdded` and `rebuildAfterDelete`, call it OFF the lock, so a bump can arrive at any microtask boundary while a critical section holds `serviceLock`. `init` (`:353`) also calls it, before any scan, and `clearProfile` and `clearChain` call it inside their lock.
- **Destructive bumpers hold the lock.** These are `clearProfile`, `clearChain`, `onTokenDeleted`, `onAccountDeleted`, and `onAccountAdded`'s cursor reset (`:388`). They interleave with a parked critical section only through the lock's 5-minute watchdog (`packages/wallet-core/src/utils/lock.ts:4`, force-release in `dispatch`).
- **So what matters is the sequence of synchronous segments between awaits.** A check and the write it guards must stay in one segment. A helper that adds an async frame adds microtasks. Those do not change the set of possible interleavings, but they do change which one a deterministic test or a microtask-scheduled bumper produces. This arc therefore adds no async frame anywhere: every extracted helper is either synchronous, or an async function that replaces exactly one async function with the identical await sequence.

### Await and re-check map, today

**Note arm.** `commitScannedNote` (`:1383-1413`) and its callees run under the lock, once per note:

| # | await | re-check after it |
|---|---|---|
| N0 | (entry) | `:1386` epoch |
| N1 | `tokenService.getTokensRaw` `:1389` | none |
| N2 | `collectOutgoingTxHashes` `:1396` | none |
| N3 | `collectInflightTxHashes` `:1397` (always read) | none |
| N4 | `repo.getRecord` `:1400` | none |
| N4b | existing record: `blockTimestampFor` `:1420` | `:1421` epoch, before the backfill upsert |
| N5 | `repo.getTrust` `:1435` | none |
| N6 | `repo.setTrust("pending")` `:1437` | none; `onIncomingTrustChanged` emits in the same segment |
| N7 | `isVisibilityEnabled` `:1439` | none; `onIncomingTransferPending` emits in the same segment |
| N8 | `blockTimestampFor` `:1469` | `:1470` epoch |
| N9 | `markBalanceDirty` `:1481` | none |
| N10 | `repo.upsertRecord` `:1482` | none |
| N11 | `isVisibilityEnabled`, trusted only, `:1484` | none; `onIncomingTransferAdded` emits |

**Public arm.** `commitPublicEventLocked` (`:2076-2108`) and its callees, under the lock, once per event:

| # | await | re-check after it |
|---|---|---|
| P0 | (entry) | `:2078` epoch |
| P1 | `tokenService.getTokensRaw` `:2079` | `:2080` epoch |
| P2 | `repo.getRecord` `:2085` | `:2086` epoch; an existing record with `reconcile` is upserted, with no further check |
| P3 | `collectOutgoingTxHashes` `:2115` | a hit stands down at once, without reading the journal |
| P4 | `collectInflightTxHashes` `:2117` | `:2119` epoch |
| P5 | `repo.getTrust` `:2132` | `:2133` epoch, before the `unknown` test, returning `undefined` |
| P6 | `repo.setTrust("pending")` `:2135` | none; `onIncomingTrustChanged` emits |
| P7 | `isVisibilityEnabled` `:2137` | none; `onIncomingTransferPending` emits; the caller re-checks at `:2106` |
| P8 | `markBalanceDirty` `:2165` | `:2166` epoch |
| P9 | `repo.upsertRecord` `:2168` | none |
| P10 | `isVisibilityEnabled`, trusted only, `:2169` | `:2169` epoch, in the same expression, before `onIncomingTransferAdded` |

**After the change.**

- N5–N7 and P5–P7 run inside one method with the identical await sequence.
- The public arm's P5 check runs in that method at the same point: right after `getTrust` resumes, before the `unknown` test. It reads `serviceEpoch` live through a stand-down predicate the public caller passes. The note caller passes none, so the note arm still has no check there.
- Every other row is in code this arc does not touch.

### What changes

1. **The pending-prompt payload: one synchronous builder.** Today it is written at `:1440-1449` (note), `:2138-2147` (public) and `:1547-1556` (replay).
   - A module-level `pendingEvent(scope, token, amountRaw): IncomingTransferPending` returns the eight fields, explicitly and in today's key order: `profileId`, `networkId`, `accountAddress`, `contract`, `tokenId`, `tokenSymbol`, `tokenDecimals`, `amountRaw`.
   - It never spreads `scope`. The note arm passes its `NoteScanContext`, which carries `blockTimestampFor` and `epochAtStart`.
   - Replay calls it in the same emit expression as today, with `{ profileId, networkId, accountAddress, contract: trust.contract }` and `first.amountRaw`.
2. **The trust promotion: one method.** `resolveNoteTrust` (`:1433-1452`) and `resolvePublicTrust` (`:2126-2150`) become `resolveReceiptTrust(scope: TrustScope, token, amountRaw, standDown?)`.
   - Its body: `getTrust`, then `if (standDown?.()) return undefined`, then the `unknown` early return, `setTrust("pending")`, the `onIncomingTrustChanged` emit, the visibility await, the `pendingEvent` emit, and `return "pending"`.
   - Two TypeScript overloads give the note caller `Promise<IncomingTrustState>` without a runtime branch, and the public caller `Promise<IncomingTrustState | undefined>`.
   - The public caller passes `{ profileId, networkId, accountAddress: ctx.account, contract }`, `ev.amountRaw` and `() => this.serviceEpoch !== epochAtStart`.
   - `ev.amountRaw` is now read at call time, not after two awaits. `ev` is a schema-parsed event that the scan owns and nothing mutates (Fact 6), so the value is the same.
   - `TrustScope` is `{ profileId; networkId; accountAddress; contract }`.
   - Its doc states two invariants only: the trust write succeeds before its emit, and the stand-down is read right after the trust read, before the `unknown` test, and only the public caller supplies it.
3. **Note-scheduler teardown.** A private, synchronous `stopNoteScheduler(key)` holds the three statements copied at `:447-451` and `:1226-1229`, mirroring `stopPublicScheduler` (`:1039-1045`). Each site keeps its condition: the active-profile test at `:446`, and the emptied-set test at `:1225`.
4. **Token lookup.** A module-level `findToken(tokens, contract, chainId)` replaces the `.find` at `:1390`, `:2081` and `:1541`, and the `.some` at `:693` as `findToken(...) !== undefined`, with the predicate written `(t) => t.contract === contract && t.chainId === chainId` as today. Replay's and `isTokenStillRegistered`'s arguments (`trust.contract`, `network.chainId`, `contract`) are now read once rather than per element; they are plain decoded rows or strings, so the reads have no side effects. Tokens are objects, so `.find(...) !== undefined` and `.some(...)` agree.
5. **The scope-clear scaffold.** `clearProfile` (`:702-729`) and `clearChain` (`:731-755`) keep their `ensureInitialized` and lock acquisition. Each passes `() => this.clearScopeLocked(scopeFor)`, a non-async arrow, to `withServiceLock`.
   - `clearScopeLocked` runs: `bumpServiceEpoch()`; `const scope = scopeFor()`; `dropEpisodes(scope.dropsEpisode)`; `scope.evictFees()`; then `try { await scope.wipe(); await this.hydrateSchedulers() } finally { scope.evictFees() }`.
   - `scopeFor` is called after the bump because `clearChain` evaluates `scanEpisodeNetworkPrefix` eagerly after the bump today (`:742`). Phase 1 observes that call and asserts the epoch it sees.
   - `wipe` is a non-async arrow (`() => this.repo.clearChain(profileId, networkId)`), so it awaits the same promise as today.
   - The two rationale comments merge into one on the helper, without the `codex R2 H1` tag.
6. **The repository inventory.** `repository.ts:221-231` and `:234-244` become non-async methods that return `this.clearScope(\`${profileId}|\`)` and `this.clearScope(\`${profileId}|${networkId}|\`)`.
   - The private async `clearScope(prefix: string)` makes the five `deleteKeysWhere` calls in today's table order (records, trust, cursors, outbox, arrivals). The records predicate is `key.startsWith(\`note:${prefix}\`) || key.startsWith(\`pub:${prefix}\`)`; the other four use `key.startsWith(prefix)`.
   - Each public method builds its own prefix from the parts it takes today, so `clearChain(p, undefined)` still matches only `p|undefined|`. The arguments are strings at every caller, so building the prefix once instead of per key produces the same strings.
   - The public methods have no async frame of their own; a temporary fingerprint around each real clear proves the caller resumes at the same tick.
   - `deleteKeysWhere` (`:252-256`) is unchanged.
7. **The cursor comparator (Q-27 l).** `packages/aztec-runtime/src/pxe/public-events.ts:193-197` `comparePositions` is renamed and exported as `comparePublicPositions`, with its body and parameter names `a` and `b` byte-identical; its one call site is `:352`. `public-event-indexer.ts:50-55` deletes its copy, imports the export for its call at `:106`, and re-exports it under the same name, so its test's import is untouched.
   - The audit's suggested new leaf module is rejected. The extension already value-imports this module (`spec.ts:35` `PublicEventCursorSchema`, `utils/received-display.ts:9`), so a leaf would keep no code from loading. Exporting is the smaller change and adds no exports-map entry.

### What stays, and why

- **The record builders** (`buildRecord` `:2346-2378`, `buildPublicRecord` `:2174-2202`) stay separate. Their shared fields interleave differently: the note record places `owner` and `noteHash` between them. A shared spread would reorder the keys of a persisted row and of the `onIncomingTransferAdded` payload.
- **The commit functions** (`commitDiscoveredNote` `:1461-1488`, `commitPublicRecord` `:2158-2172`) stay separate.
  - The note arm builds the record, taking `discoveredAt = Date.now()`, before `markBalanceDirty`; the public arm builds after it.
  - The two arms re-check at different points (N8 versus P8 and P10).
  - Sharing them needs a hook object larger than the six lines it would save, or a behaviour change.
- **Dedupe** stays per arm. The note arm reads both sets eagerly, before `getRecord`. The public arm reads the journal only on a miss, after `getRecord`, then re-checks. Merging them changes which collaborators are called, and the `getTransactions failed` / `getOperations failed` warnings an existing note record produces.
- **Reusing `_setTrustStateLocked` (`:605-615`) for the promotion**, as the audit suggests, is rejected. It wraps `setTrust` in another async frame, which delays the visibility read and every later step by at least one microtask.

8. **Comments made accurate, in 2a, with no behaviour change.**
   - `:2071-2075` drops the false "the note arm's own" attribution and "originally lacked": every awaited read can park across a watchdog handoff that admits a wipe, and the epoch is re-checked after each read block, before any write.
   - `:1454-1460` stops dismissing the storage and config awaits: the note arm deliberately re-checks only at N0, N4b and N8; the other windows exist and are reachable only through the watchdog.
   - `:1427-1432` and `:2122-2125` lose "one sync pair" (an awaited write separates them) and keep "the write succeeds before the emit"; both are replaced by the merged doc of item 2.

### Guard set per site (identical after the change)

| site | guards today, in order | after |
|---|---|---|
| note promotion (`commitScannedNote` → trust) | lock; epoch at entry; live token re-read; three-source dedupe; amount parse; `unknown`-only transition; write-then-emit pair; visibility-gated prompt | same; no stand-down passed |
| public promotion | lock; epoch at P0, P1, P2 and P4; live token re-read; dedupe; stand-down after the trust read; `unknown`-only; write-then-emit; visibility gate; caller re-check `:2106` | same; the stand-down runs in the shared method at the same point |
| replay prompt (`:1513-1559`) | visibility gate `:1521`; lock per pending row; account-scoped records non-empty; live token re-read; live trust still `pending` | same; only the payload literal moves |
| account-delete teardown (`:446-452`) | lock; only when the active profile owns the account | same; condition at the call site |
| token-delete teardown (`:1218-1232`) | lock; only when the contract set empties | same |
| `clearProfile` / `clearChain` | `ensureInitialized`; lock; bump first; episodes dropped; fees evicted; wipe; hydrate under lock; re-evict in `finally` | same order, same segment boundaries |
| repository clears | key-prefix deletion, never by value; five tables in order; `note:` / `pub:` record prefixes; `\|` boundary | same |
| comparator call sites | page dropped on `<= 0` (`public-events.ts:352`); scan stopped on `<= 0` (`public-event-indexer.ts:106`) | same body, same call expressions |

### Microtask equivalence

Each swap replaces one async frame with one of the same await shape: the two trust methods; an async lock callback against a non-async one returning `clearScopeLocked(...)`; an async repository method against a non-async one returning `clearScope(...)`. A scratch probe on Bun 1.4.2 and Node 24 stamped a same-shape swap identically. Moving a span into an awaited helper added 1 tick with `return await` and 2 with `return promise`, which is what an `async` `wipe` arrow would cost.

### Complexity and neighbours

Every new function is a few flat lines, well under 15; no accepted function is touched. Phase 1 must not repeat the line `clearChain: async (p: string, n: string) => {`, the unique anchor of an accepted directive (`service.scenarios.test.ts:126`). Neighbouring arcs touch nearby hunks only: network-endpoints `getReceiptFee` (`service.ts:531-538`), row-lifecycle possibly the account-scope types at `:406` and `:438`.

## Security & Adversarial Considerations

- **Who can reach it.**
  - Note contents and public `Transfer` events are attacker-authored: anyone can send any token to the user's address, and a hostile node can shape pages. Pages are schema-parsed (`packages/aztec-runtime/src/pxe/client.ts:351-352`) and order-validated (`public-events.ts:334-363`).
  - The trust promotion is the anti-spam gate: a receipt from an unknown contract is stored hidden and only prompts.
  - `clearProfile` and `clearChain` are reachable from the profile-deletion coordinator (`profile-deletion/coordinator.ts:127`), from the chain-purge subscriber (`service.ts:342-344`), and as extension-internal RPC with no in-tree caller.
- **What the consolidation could widen, and how each risk is shut.**
  - A dropped stand-down would let a stale public critical section write trust and prompt; one passed by the note caller would add a refusal. The matrix pins both directions.
  - A payload built by spreading `NoteScanContext` would put a function and the epoch into a port event; the builder lists its eight fields.
  - A clear helper keyed on an optional `networkId` would turn `clearChain(p, undefined)` into a profile-wide wipe; today it matches `p|undefined|` and deletes nothing real. Each clear therefore builds its own scope string from today's parts.
  - Key-prefix deletion (it reaches codec-invalid rows past the profile-privacy boundary), bump-before-evict, wipe-and-hydrate under one lock and the `finally` re-eviction are unchanged and pinned.
- **The lock surface is unchanged.** Every helper runs in the critical section its code runs in today. No `isCurrent` read, fence or epoch capture moves.
- **Hostile cursors.** The comparator body is byte-identical, including the parameter names `a` and `b`. A malformed position therefore raises the same engine-generated `TypeError` text on Bun, Chrome and Firefox. No module enters any bundle: the extension already loads `public-events.ts`.
- **Scope arguments.** Every caller passes strings, and `scanEpisodeNetworkPrefix` is a pure template, so building each scope string once produces today's strings. The service keeps building its clear strategy after the bump.
- **Logging and layering.** No log line is added or changed. The extension may import `aztec-runtime`. `aztec-runtime` gains one export; it is a private package and not staged for npm.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `7450928c`):

1. Every await and re-check in the two maps above is at the cited line.
2. `hydrateSchedulers` bumps the epoch before any await and outside the lock (`service.ts:916-918`). Destructive bumpers bump inside the lock: `:708`, `:736`, `:1188`, and `:431` after its wipe.
3. The three prompt payloads list the same eight keys in the same order (`:1440-1449`, `:2138-2147`, `:1547-1556`).
4. `PopupManager.vue:105-118` drops a Pending payload whose profile, network or account is not the live one.
5. The scenarios suite mocks the repository with an in-memory object (`service.scenarios.test.ts:70-155`). It already has `holdCall` (`:5030-5055`) and `deferred` (`:4764-4770`). Its header at `:4137-4141` wrongly says the note arm re-checks after every parked await.
6. Public events reach the service through `PublicTransferPageSchema.parseAsync` (`packages/aztec-runtime/src/pxe/client.ts:351-352`), and the scan never mutates them.
7. `comparePositions` (`public-events.ts:193-197`) and `comparePublicPositions` (`public-event-indexer.ts:51-55`) have identical bodies and parameter names.
8. The probe numbers under § Microtask equivalence come from a scratch script, since deleted.
9. `@webext-core/fake-browser` backs `FakeBrowserApi` storage (`packages/wallet-core/src/testing/fake-browser-api.ts:41-75`); the repository fingerprints confirm it settles on microtasks.

**Inferences:**

- The production callers of both clears pass strings; the RPC surface has no in-tree caller.
- Moving a synchronous property read (`ev.amountRaw`, `trust.contract`, `network.chainId`, `contract`) earlier within one critical section is unobservable, because the objects are parse results that the critical section owns.

**Asks:** none open. Both were answered by the plan audit (§ Decisions).

## Phases

### Phase 1: pin today's interleavings, payloads and order (test only)

All tests are table-driven, with expected values written as literals and never derived from production code. No test uses timer fakes.

- **`service.scenarios.test.ts`, the epoch re-check matrix (permanent).**
  - For each row of both maps, `holdCall(..., "after")` holds that await's collaborator: the repository mock, or the token, transaction, journal, note or config stubs. While it is held, the test bumps `serviceEpoch`, then releases.
  - Each row asserts six flags (trust written, `onIncomingTrustChanged`, `onIncomingTransferPending`, outbox written, record written, `onIncomingTransferAdded`) AND the ordered log of collaborator calls and emits, with a marker where the bump landed. The log is what catches a removed check that a later check would mask: without `:2080`, P1's flags stay all-false because P2 stops execution, but the log gains `getRecord`.
  - `holdCall(..., "after")` runs the collaborator before holding it, so the fake's effect precedes the bump marker: at N6 and P6 the fake trust write, at N7 and P7 the write and the `onIncomingTrustChanged` emit. The log records that order; it says nothing about production write timing, since `repository.setTrust` awaits its own read first (`repository.ts:131`).
  - Fixtures: unknown trust (N1–N10, P1–P9); seeded trusted (N9–N11, P8–P10); an existing record without a timestamp (N4b); an existing public record whose block moved, scanned with `reconcile` (P2). Each has an unbumped control row, and N0 and P0 each have a stale-entry control (the epoch bumped before the critical section starts: no collaborator inside it is called).
  - The rows that pin a post-bump continuation preserved from today (N1–N7 promotion, N9–N11 record and `Added`, P6–P7 promotion) are titled `(DRIFT PIN)`. Each row's call log says which writes or emits land after the bump marker; at N6, N7, P6 and P7 the fake trust write itself precedes it.
  - A redundant synchronous duplicate of an existing check is not observable here; that stays a source-review item.
- **Dedupe call order (permanent).** On an outgoing hit, the note arm calls `getTransactions`, `getOperations`, `getRecord`; the public arm calls `getRecord`, `getTransactions` and never `getOperations`.
- **Microtask fingerprints (temporary proof).**
  - A `queueMicrotask` spinner with an explicit cap runs alongside the operation and stops in `finally`. The operation must complete before the cap; exhausting it fails the test explicitly, and the spinner count at the last stamp must be below the cap.
  - Boot polls (`startPollScheduler`'s immediate first poll, `:1020`, for both arms) and any import- or timer-driven setup are settled before the spinner starts.
  - Every collaborator call and emit inside the critical section is stamped with the spinner count, relative to the first in-section stamp, filtered by arguments or scope where a collaborator is shared (`getTokensRaw`, `getTrust`, `getValue`). The final stamp is the caller's resumption.
  - Seven service fingerprints (the note critical section with unknown and with trusted trust, the public one with unknown and with trusted, one replay emit, `clearProfile`, `clearChain`) and two in `repository.test.ts` around each REAL repository clear, measured to the caller's resumption. Running them first confirms `FakeBrowserApi` storage settles on microtasks alone.
  - They stay through Phase 2, the green Phase 2 counts are logged in this arc's lessons file, and a final test-only commit removes them. Extra ticks can change how these races interleave, and the matrices do not catch every added async wrapper. Removal is still acceptable for this verified refactor: the comparison of base and implementation was complete, and the harness and its results stay recoverable from history (the Phase 1 commit and this arc's lessons file).
- **Payloads (permanent).** Each of the three prompt emits is deep-equal to a literal, and `Object.keys` equals the eight-key order. The values are wire-shaped: `0x` plus 64-hex addresses and contract, a u128 decimal `amountRaw`, `tokenDecimals: 18`.
- **Clears (permanent).** For both methods, with an announced stall seeded so `dropEpisodes` emits:
  - an order log: the epoch already bumped at the health emit, then the fee eviction, then the wipe called with the bumped epoch, then hydration's first read, then the final eviction;
  - for `clearChain`, `scanEpisodeNetworkPrefix` (wrapped pass-through by a partial `vi.mock` of `./scan-episodes`) is first called inside the clear with the epoch already bumped;
  - a wipe that rejects: the call rejects with that error, the cache is evicted after, there is no hydration, and the epoch advanced by exactly 1; on success, by 2.
- **Teardown (permanent).** Only what the existing suites lack: deleting an active-profile account stops its interval and drops both map entries; an inactive profile's account leaves them; a two-contract set keeps its scheduler, a one-contract set stops it.
- **`repository.test.ts` (permanent).** Each scope clear empties all five tables, including a codec-invalid row in each; keeps `p11` and `n11` neighbours and a record key with an unknown kind prefix; and removes keys through `storage.local` in today's table order.
- **The comparator (permanent).** `public-event-indexer.test.ts`: rows for the block, tx and log branches with exact return values, and equality. `packages/aztec-runtime/src/pxe/public-events.test.ts`: one two-log page per branch; equal positions and a log-index-only decrease are dropped, a log-index-only increase is kept.
- **Comment fix.** The false header at `service.scenarios.test.ts:4137-4141` now names the note arm's actual checks (N0, N4b, N8).

The phase is green against the unchanged code, in its own commit, so the test files are frozen before Phase 2.

**Mutation check** (scratch, reverted from copies, logged in this arc's lessons file):

- P1's `:2080` check removed; P4's `:2119` check removed: their call-log rows red.
- The public stand-down dropped: P5 red. A stand-down passed by the note caller: N5 red.
- The P8 check moved before `markBalanceDirty`: P8 red.
- `pendingEvent` spreading its scope: the key-order rows red.
- `return await` inside the trust method, or an `async` `wipe` arrow: the service fingerprints red.
- `async clearX() { return this.clearScope(...) }`, or `return await this.clearScope(...)`, in the repository: the repository fingerprints red.
- `scopeFor` called before the bump: the `scanEpisodeNetworkPrefix` epoch row red.
- The table order swapped in `clearScope`: the removal-order row red.
- `<` for `<=` at either comparator call: the equality rows red.

### Phase 2: consolidate, tests frozen

Four commits, each green on the frozen tests: 2a `pendingEvent`, `TrustScope`, `resolveReceiptTrust` and the comment fixes of item 8; 2b `stopNoteScheduler` and `findToken`; 2c `clearScopeLocked` and the repository's `clearScope`; 2d the comparator. Then 2e, test-only: remove the fingerprints after logging their green counts.

**Validation gate (after each phase):**

- **Commands:**
  - `bun run --cwd apps/extension test src/wallet/services/incoming-transfer`, three times in a row, then `bun run --cwd packages/aztec-runtime test src/pxe`;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - `bun run build`, then `git diff --exit-code apps/extension/src/types/`.
- **Pass criteria:** every command exits 0; the declaration files are unchanged; 2a–2d's `git diff --stat` lists no test file.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** unit and lint locally. In CI, the network suites' `incoming-transfers`, `incoming-public-transfers` and `incoming-arrival` run both arms against a real node on Chrome and Firefox, per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, plus an independent Opus pass, as a MID batch requires. Each gets the adversarial, assumption-attack and implementation-critique asks. Both must confirm the await map, the guard table and the microtask argument line by line. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the gh stack, then add both e2e labels. When the program gates are green on the head SHA, with the run attempt and the shards that ran recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/14-incoming-arms`. The driver sets its parent at delivery. Code review: off.

## UI impact

None. No `.vue` or CSS file changes and no copy changes. Every event payload and persisted row is byte-identical, which the Phase 1 payload pins and the temporary fingerprints prove.

## Drift kept as today (routed to follow-ups)

Nothing here is user-visible, so nothing goes to the alignment arc. Items 1 to 3 are preserved unchanged and go to `implementations-plan/follow-ups.md` at close-out.

1. **Epoch discipline differs between the arms**, and this is a security follow-up. The note arm has no re-check after its token, record, dedupe or trust reads, after `markBalanceDirty`, or before `Added`; the public arm has these. A note continuation parked in `markBalanceDirty` can resume after a watchdog-admitted wipe and insert its built record (`:1482`), and a trust continuation can recreate pending trust: post-purge resurrection, a deletion and privacy violation, not a cross-account one. Adding the public arm's checks (A, B, C) would not fence `repository.setTrust`'s own internal await, so it is not complete revocation protection either.
2. **Dedupe order and call counts differ** (§ What stays), including the warnings an existing note record can log. Residual: reconsider merging the commits and dedupe after alignment, not a commitment.
3. **Record timing differs:** the note arm takes `discoveredAt` before `dirtyAt`, the public arm after.
4. **The contradicting comments** are fixed in 2a (item 8); no behaviour changes.

## Decisions (delegated)

### Plan audit, Codex round 1 (GPT-6 Astra, xhigh): REVISE, high confidence. Opus panelist: APPROVE

Both legs confirmed the production design: the await shape matches through caller resumption (Codex probed the extracted originals against the replacements in memory), every guard position is intact, and the eight-key payload, the repository's per-key prefixes and table order and the comparator export and re-export are correct. Every finding was adopted:

1. **Blocker (Codex): six flags miss removed guards.** Removing `:2080` still yields six false flags because P2 stops execution, and removing `:2119` because P5 does. Adopted: bumped rows assert the ordered call log too; both removal mutants, stale-entry controls for N0 and P0, and the moved-P8 mutant are in the mutation list. The claim is narrowed: a redundant synchronous duplicate check is a source-review item.
2. **Repository timing (both legs).** The scenarios suite fakes the repository, so the repository's frame count was unproven. Adopted: a fingerprint around each real repository clear, measured through caller resumption, after confirming `FakeBrowserApi` settles on microtasks; the async-wrapper and `return await` mutants must fail it.
3. **Spinner specification (both legs).** Adopted: completion before the cap, explicit failure on exhaustion, stop in `finally`, boot polls and setup settled first, stamps filtered by arguments or scope, the last stamp below the cap, no timer fakes.
4. **Fingerprints are proof, not permanent pins (Opus; Codex no objection).** Codex saw 1,000 stable repetitions on Bun 1.4.2, and every later edit to `service.ts` would re-record them. Adopted: kept through Phase 2, counts logged, removed in 2e; the matrix and call logs stay. Extra ticks can affect these races and the matrices do not catch every added async wrapper, so the removal rests on code review round 1, not on this audit: its complete base-versus-implementation comparison found no difference, and the harness and results stay recoverable from history.
5. **The scope-construction mutant had no observer (Codex).** Adopted: the `scanEpisodeNetworkPrefix` call is observed and its epoch asserted; bump-before-scope stays.
6. **Comments fixed now (both legs).** Adopted as item 8, in 2a, with the merged doc limited to two invariants.
7. **Late effects labelled accurately (Codex).** Adopted: the call log marks the bump; the plan no longer infers production write timing from the fake.
8. **`clearScope(prefix: string)` (Opus).** Adopted: arguments are strings and `scanEpisodeNetworkPrefix` is pure; each method keeps its own prefix, so `clearChain(p, undefined)` still matches only `p|undefined|`.
9. **`findToken` covers the fourth copy at `:693`.** Adopted, as `findToken(...) !== undefined`.
10. **Concurrency model text (Opus).** Adopted: the in-lock bump in `onAccountAdded` (`:388`), and `init` and the two clears as callers of `hydrateSchedulers`.
11. **Drift routing (Opus).** Adopted: nothing is user-visible, so the section is retitled; drifts 1 to 3 go to follow-ups at close-out, drift 4 is fixed now.

### Ask calls

1. **Ask 1, the Q-18 epoch points (A) after the trust read, (B) after `markBalanceDirty`, (C) before `Added`:** both legs adopt none. A security follow-up records the resurrection path above, and the program report carries it. Phase 3 is dropped.
2. **Ask 2, partial close of Q-18:** both legs accept. Commits and dedupe become a residual follow-up to reconsider after alignment, not a commitment. The record builders close as won't-dedupe: two record variants, and a shared spread would reorder persisted keys.
