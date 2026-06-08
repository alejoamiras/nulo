# IncomingTransfer trust-state-machine refactor — main agent plan

Replace the ad-hoc per-writer race guards in `IncomingTransferService` with a per-`(profileId, networkId, contract)` Lock from `Map<key, Lock>` that gates every write path. Eliminates the residual race codex audit-6 identified (scanContract's stale local `trustState` clobbering a concurrent `setTrustAllow`). One-PR big-bang.

## 1. Goal + success criteria

**Goal**: every mutation of either `nulo:core:incoming-trust` or `nulo:core:incoming-transfers` (across the 8 writer entry points) acquires a per-`(profileId, networkId, contract)` Lock before reading state and releases AFTER all dependent writes + emits complete. The local `trustState` snapshot in `scanContract` is removed in favour of a fresh `repo.getTrust` read inside the per-note critical section.

**Done when**:
- All 8 writer methods (`scanContract`, `setTrustState`, `setTrustAllow`, `setTrustReject`, `onTokenDeleted`, `onTransactionAdded`, `clearProfile`, `clearChain`) wrap their critical section in `withTripleLock`.
- `scanGenerations` Map is removed (Lock subsumes its role).
- `txDeleteInflight` Set is removed (Lock subsumes its role).
- `polling` Set stays (it's per-scheduler-key, not per-triple; different concern).
- `isUnwatched`/`isStale` callsites removed from `scanContract`.
- A NEW deterministic test reproduces the residual race (parked `getBlockTimestamp` + concurrent `setTrustAllow` writer → final state `hidden: false`) and PASSES.
- All 60+ existing tests in `service.scenarios.test.ts` still pass with mechanical rewrites where they relied on the ad-hoc guards.
- `bun run audit:vue` green (typecheck + units + lint + build).
- No deadlock under any test combination (`bun run audit:vue` passes; new tests cover the deadlock-attempt cases).
- `bun run e2e:agent` green on the merge candidate (incoming-trust C2 test re-seeded with a token registration so it actually exercises its path — separately tracked).

## 2. Scope — files and surface per phase

Single PR; **phases below are commit-shape, not separate PRs**. Each phase produces a green local CI; bisectable on revert.

### Phase 1 — Add `withTripleLock` helper (no behaviour change)

`packages/extension/src/wallet/services/incoming-transfer/service.ts`:
- Add `private readonly tripleLocks: Map<string, Lock> = new Map()` field
- Add `private tripleLockKey(profileId, networkId, contract): string` returning `${profileId}|${networkId}|${contract}`
- Add `private async withTripleLock<T>(profileId, networkId, contract, fn: () => Promise<T>): Promise<T>` that acquires-or-creates the Lock, calls `enter()`, runs `fn()`, ensures `leave()` in finally
- Add `private evictTripleLockIfIdle(profileId, networkId, contract)` for the cleanup hook (called from `onTokenDeleted` AFTER the lock's critical section exits)

No writer migration yet. Existing race guards stay in place. Tests stay green. **First commit**.

### Phase 2 — Migrate `setTrustAllow`, `setTrustReject`, `setTrustState`

These are the simplest single-triple writers. Migrate first to validate the pattern.

For each:
- Wrap the entire body (including the pre-existing stale-popup guards) in `withTripleLock(profileId, networkId, contract, async () => { ... })`
- Remove the compensating-action `setTrustState(..., "unknown")` reverts (no longer needed — the lock prevents the race between the upfront `isTokenStillRegistered` check and the writes)
- Remove the per-iteration `repo.getRecord` re-check in `setTrustAllow`'s records loop (lock prevents the snapshot-vs-mutate race)
- Keep `isTokenStillRegistered` — the lock guards against concurrent service-internal writers, but `onTokenDeleted` is upstream of our service (fired by `TokenService.onTokenDeleted`); the token can be gone at acquire-time

Tests stay mostly mechanical; race-simulation tests that exercised the compensating-action paths need rewrites (now: pre-acquire the lock to simulate contention, assert second writer blocks).

**Second commit**.

### Phase 3 — Migrate `scanContract`

The big one. Restructure the per-note loop:

```ts
for (const note of notes) {
    if (!note.siloedNullifier) continue
    await this.withTripleLock(profileId, networkId, contract, async () => {
        // Existing-record branch: backfill blockTimestamp if missing
        const existing = await this.repo.getRecord(note.siloedNullifier)
        if (existing) {
            if (existing.blockTimestamp === undefined) {
                const ts = await blockTimestampFor(note.l2BlockNumber)
                if (ts !== undefined) {
                    await this.repo.upsertRecord({ ...existing, blockTimestamp: ts })
                }
            }
            return  // continue to next note
        }

        // Dedup checks
        if (outgoingTxHashes.has(note.txHash)) return
        if (inflightTxHashes.has(note.txHash)) return
        const amountRaw = parseNoteAmount(note)
        if (amountRaw === null) return

        // Read trust FRESH inside the lock (no more local snapshot)
        const liveTrust = (await this.repo.getTrust(profileId, networkId, contract))?.state ?? "unknown"

        // Token may have been deleted while we were enqueued for the lock; bail.
        const tokens = await this.tokenService.getTokensRaw(profileId)
        const token = tokens.find((t) => t.contract === contract && t.chainId === network.chainId)
        if (!token) return

        // Unknown → pending transition (now atomic with the record write below)
        let trustState = liveTrust
        if (trustState === "unknown") {
            const updated = await this.repo.setTrust(profileId, networkId, contract, "pending")
            this.emit("onIncomingTrustChanged", updated)
            trustState = "pending"
            if (await this.isVisibilityEnabled()) {
                this.emit("onIncomingTransferPending", { ... })
            }
        }

        // Record persist
        const blockTimestamp = await blockTimestampFor(note.l2BlockNumber)
        const record = this.buildRecord({ note, profileId, networkId, accountAddress, token, amountRaw, trustState, blockTimestamp })
        await this.repo.upsertRecord(record)

        if (trustState === "trusted" && (await this.isVisibilityEnabled())) {
            this.emit("onIncomingTransferAdded", record)
        }
    })
}
```

Per-note lock means scanContract releases between notes — other writers can intervene. That's the desired semantic: each note's `(read trust, decide transition, write record)` is atomic; the user's Allow click between two notes correctly sees the FIRST note as `pending` (already persisted) and the SECOND note's iteration reads the updated `trusted` state.

Remove:
- `scanGenerations` Map field + `genKey` helper + `bumpGeneration` method
- `isStale` closure inside scanContract
- The bumps in `onTokenAdded`, `onTokenDeleted`, `hydrateSchedulers`

Keep:
- `polling` Set (per-scheduler-key singleflight; orthogonal to the per-triple lock)
- Per-scan `blockTimestampCache` Map (per-scan PXE memoization; orthogonal)

**Third commit**.

### Phase 4 — Migrate `onTokenDeleted`

```ts
private onTokenDeleted = async (token: TokenInfo): Promise<void> => {
    const profile = await this.profileService.getActiveProfile()
    if (!profile) return
    const network = await this.resolveNetworkByChainId(token.chainId)
    if (!network) return
    const accounts = await this.accountService.getAccounts(profile.id, network.chainId)

    // Per-account scheduler teardown stays OUTSIDE the lock (no row-level mutations)
    for (const account of accounts) {
        const key = this.schedulerKey(network.id, account.address)
        const contracts = this.watchedContracts.get(key)
        if (!contracts) continue
        contracts.delete(token.contract)
        if (contracts.size === 0) {
            const interval = this.schedulers.get(key)
            if (interval) clearInterval(interval)
            this.schedulers.delete(key)
            this.watchedContracts.delete(key)
        }
    }

    // Records-wipe + trust-reset inside the triple lock (atomic)
    await this.withTripleLock(profile.id, network.id, token.contract, async () => {
        const records = await this.repo.listByContract(profile.id, network.id, token.contract)
        for (const record of records) {
            await this.repo.deleteRecord(record.siloedNullifier)
            this.emit("onIncomingTransferDeleted", record)
        }
        const trustRecord = await this.repo.getTrust(profile.id, network.id, token.contract)
        if (trustRecord) {
            const updated = await this.repo.setTrust(profile.id, network.id, token.contract, "unknown")
            this.emit("onIncomingTrustChanged", updated)
        }
    })

    // Lock entry is now safe to evict — no one's holding it.
    this.evictTripleLockIfIdle(profile.id, network.id, token.contract)
}
```

**Fourth commit**.

### Phase 5 — Migrate `onTransactionAdded`

Records keyed by tx hash can span multiple contracts. Group by contract, acquire each contract's lock in turn.

```ts
private onTransactionAdded = async (tx: Tx): Promise<void> => {
    const profile = await this.profileService.getActiveProfile()
    if (!profile) return
    const network = await this.resolveNetworkByChainId(tx.chainId)
    if (!network) return

    const matches = await this.repo.listByTxHash(profile.id, network.id, tx.hash)
    // Filter for THIS tx's account (same-hash collisions across accounts under split-fee).
    const eligible = matches.filter((r) => r.accountAddress === tx.account)
    if (eligible.length === 0) return

    // Group by contract — each contract gets its own triple-lock acquisition.
    const byContract = new Map<string, IncomingTransferRecord[]>()
    for (const record of eligible) {
        const list = byContract.get(record.contract) ?? []
        list.push(record)
        byContract.set(record.contract, list)
    }

    for (const [contract, records] of byContract) {
        await this.withTripleLock(profile.id, network.id, contract, async () => {
            for (const record of records) {
                // Re-check existence (a concurrent onTokenDeleted may have wiped already)
                const stillThere = await this.repo.getRecord(record.siloedNullifier)
                if (!stillThere) continue
                await this.repo.deleteRecord(record.siloedNullifier)
                this.emit("onIncomingTransferDeleted", record)
            }
        })
    }
}
```

Remove `txDeleteInflight` Set — the lock + per-record re-check supersede it.

**Fifth commit**.

### Phase 6 — Migrate `clearProfile` + `clearChain`

These wipe many triples. Pattern: list all (network, contract) tuples in scope, iterate, acquire each triple lock, wipe its rows.

```ts
public async clearProfile(profileId: string): Promise<void> {
    await this.ensureInitialized()
    // Gather targets BEFORE wiping (the lock-per-triple sequence acquires each in turn)
    const trustRows = (await this.repo.listTrust()).filter((t) => t.profileId === profileId)
    for (const trust of trustRows) {
        await this.withTripleLock(trust.profileId, trust.networkId, trust.contract, async () => {
            const records = await this.repo.listByContract(trust.profileId, trust.networkId, trust.contract)
            for (const record of records) {
                await this.repo.deleteRecord(record.siloedNullifier)
                this.emit("onIncomingTransferDeleted", record)
            }
            // Trust row deletion (not transition to unknown — full wipe semantics)
            await this.repo.clearProfile(profileId)  // Repo-level: full clear
        })
    }
    // ... + hydrate
}
```

(Note: this needs a per-row `repo.deleteTrust(profileId, networkId, contract)` rather than the existing `repo.clearProfile(profileId)`. The repo may need a small addition.)

`clearChain` is the same shape, scoped tighter.

**Sixth commit**.

### Phase 7 — Test suite rewrite

`service.scenarios.test.ts` 60+ tests. Most stay green unchanged. Targeted edits:

- The 5 generation-counter race tests (`(Audit-3 High)*`) get replaced by Lock-acquisition race tests: pre-`await lock.enter()` from outside, fire the writer, assert it blocks (e.g. via a 100ms timeout race).
- The 3 compensating-action revert tests (`(Audit-5 High) setTrust* reverts to unknown`) get removed — the behaviour they test no longer exists (no compensating revert; the lock prevents the race that needed it).
- The per-record-loop-skip test (`(Audit-5 High) setTrustAllow skips per-record upsert when record was deleted mid-loop`) gets removed for the same reason; replaced by a lock-contention test.
- Add a NEW test pinning the residual race fix: parked `getBlockTimestamp` + concurrent `setTrustAllow`; final record state `hidden: false`.
- Add a lock-eviction test: `onTokenDeleted` followed by `tripleLocks.size === 0` (the Map doesn't accumulate forever).
- Add a re-entry test: a writer that internally calls another writer for the same triple MUST self-deadlock (Lock is non-reentrant; this is the design constraint we enforce).

**Seventh commit**.

### Phase 8 — Codex post-impl audit + fix loop

`/code-review max --fix` on the full diff → commit applied fixes → `/codex xhigh` post-impl review with adversarial / security ask → address findings.

## 3. Security & Adversarial Considerations

### Threat model

The attacker is a malicious dApp that has registered itself with the wallet via `register_token`. The attacker's goal is to either (a) prompt-flood the user, (b) impersonate a known contract on a different network, (c) get the wallet into a stuck state where trust is inconsistent with records, (d) exhaust storage.

### Token-impersonation (cross-network)

The triple key is `${profileId}|${networkId}|${contract}`. Two networks with the SAME contract address get DISTINCT lock entries → distinct trust rows → no cross-contamination. **Mitigated by triple-key dedup**, which the PopupManager queue already enforces at the UI layer (`service.scenarios.test.ts` pins the case "same contract on DIFFERENT networks: BOTH surface (triple-key dedup, not bare-contract)"). Refactor does NOT change this property.

### Prompt-flooding

A malicious dApp could `register_token` + `register_token` again for many distinct contract addresses. Each triggers a Pending emit on first-receive. The PopupManager queue dedups by triple, so duplicates collapse. Many UNIQUE contracts = many queued prompts (no cap today). Refactor does not change this; **flagged as a follow-up: add a per-session cap on pending-prompt count**. Not blocking.

### State-machine soundness

The 4-state FSM (`unknown → pending → trusted | blocked`) has clear transitions. The lock ensures only one transition per triple is in flight. Test pin: every state x every writer enumerated. Specifically dangerous edges to enumerate in tests:
- `trusted → unknown` via `onTokenDeleted` (existing; preserve)
- `pending → unknown` via `onTokenDeleted` (existing; preserve)
- `blocked → unknown` via `onTokenDeleted` (existing; preserve — re-add re-prompts)
- `pending → trusted` via `setTrustAllow` (existing)
- `pending → blocked` via `setTrustReject` (existing)
- `unknown → pending` via `scanContract` first-receive (existing)

### Concurrency invariants

The per-triple lock guarantees no two writers see the same row in flight. But the lock does NOT prevent ITSELF from re-entry. Constraint: **no writer may call another writer for the same triple inside its critical section**. Enforced by:
- Code review (every writer's body is small, easy to scan)
- A unit test that synthetically attempts re-entry and asserts the Lock's force-release timer fires (existing `Lock` primitive has a 5-min hold cap; re-entry would deadlock until that fires)

### Storage exhaustion

Per-contract records have no cap. A trusted contract minting many small notes could fill `chrome.storage.local`. Refactor does NOT introduce or fix a cap. **Flagged as a follow-up**.

### Lock-Map leak

`tripleLocks: Map<key, Lock>` could grow unboundedly if entries are never evicted. Mitigation:
- Phase 4: `onTokenDeleted` calls `evictTripleLockIfIdle` AFTER its critical section
- Phase 6: `clearProfile` / `clearChain` evict all locks in scope after their wipes
- Lock primitive's 5-min force-release timer bounds the worst case (a stuck-holder Lock self-releases; we can evict it later)

Test pin: bulk add 100 contracts, delete all, assert `tripleLocks.size === 0`.

### Supply chain

No new external dependencies. Uses existing `Lock` from `@nulo/wallet-core/utils/lock.ts` (in-tree). No npm-level supply chain delta.

## 4. Assumptions

### Facts (verified)

- `Lock` primitive exists at `packages/wallet-core/src/utils/lock.ts`. Non-reentrant. FIFO microtask queue. 5-min force-release timeout (`MAX_HOLD_MS = 300_000`). Used as a global singleton in 11+ services.
- `IncomingTransferService` has 8 distinct writer methods (verified via the research-phase mapping).
- The `account/service.ts` `tupleLocks: Map<key, Promise<unknown>>` pattern exists as a per-key precedent in the monorepo.
- The repo layer (`IncomingTransferRepository`) is last-write-wins (no CAS); per `repository.ts`.
- The 4 architecture decisions are user-locked.

### Inferences (deduced, label clearly)

- Per-note lock acquire/release in `scanContract` is CHEAPER than holding the lock for the whole scan iteration, AND gives correct UX (a user's Allow click between two notes correctly affects subsequent iterations). **Confidence: high.** The Lock primitive's microtask queue is lightweight; the dominant cost is the PXE round-trip, which the lock can't help.
- Removing `scanGenerations` + `txDeleteInflight` is safe because the lock subsumes their roles. **Confidence: high.** Both were ad-hoc mitigations for races the lock now eliminates; tests will verify no regression.
- Lock-eviction strategy (evict on `onTokenDeleted` + on `clearProfile`/`clearChain`) is sufficient. **Confidence: medium.** A token that's never deleted but accumulates many same-triple records will keep its Lock alive — that's fine; the Map entry is a constant-size pointer per triple.
- The Lock primitive's 5-min force-release timer is generous enough that a stuck writer is not a practical concern. **Confidence: high.** The longest critical section is `scanContract`'s per-note loop body (~PXE round-trip = sub-second); 5 min is 300x that.

### Asks (decisions for the user)

Only ONE remains since you locked 4 of 5 architecture decisions:

- **Lock-eviction policy at idle**: should the Map evict entries when their underlying Lock has been unused for N minutes? Currently the plan evicts only on natural cleanup hooks (token delete, clear). A user who registers many tokens but never deletes them keeps locks forever (constant memory cost per triple). Recommend: no LRU eviction for v1 (keep it simple); revisit if memory profiling surfaces it. **Default: no eviction beyond natural hooks.**

## 5. Phase ordering rationale + revert safety

Within-PR commit shape supports `git bisect` across the 8 commits:

- Phase 1 (helper only) → if buggy, no behavior impact, revert costs nothing
- Phase 2 (3 trust writers) → smallest writer surface; failures here don't touch scan
- Phase 3 (scanContract) → biggest writer; if regressions, revert isolated
- Phase 4 (onTokenDeleted) → wipe + reset; revert leaves Phase 1-3 lock + writers intact
- Phase 5 (onTransactionAdded) → late-delete; orthogonal to user-facing flows
- Phase 6 (clearProfile/clearChain) → admin paths; least user-visible
- Phase 7 (test rewrites) → tests-only; revert restores prior assertion set
- Phase 8 (code-review + codex audit fixes) → post-impl polish

Each commit's diff is auditable independently. If `git bisect` fingers a specific commit as the regression, the change set is narrow.

## 6. Test plan

### Unit pins (per writer)

Each writer gets a test that:
1. Pre-`await lock.enter()` on the triple from OUTSIDE the service.
2. Invoke the writer.
3. `await Promise.race([writerPromise, sleep(100)])` — assert writer hasn't completed (it's blocked on the lock).
4. `lock.leave()` — assert writer completes.
5. Verify final state matches expectation.

For `scanContract` specifically: a test that exercises the RESIDUAL RACE PIN.
- Setup: pending trust row, hidden record absent.
- Mock `getBlockTimestamp` with a deferred resolver.
- Start `scanContract` for one note.
- While scanContract is parked on `getBlockTimestamp`, call `setTrustAllow` from OUTSIDE.
- Assert `setTrustAllow` BLOCKS until scanContract's per-note critical section releases.
- Once scanContract's note is persisted (with `hidden: true` per the prior trustState read), `setTrustAllow` acquires the lock and flips the record to `hidden: false`.
- Verify final state: `hidden: false` (the lock made the writes serial; the record was correctly flipped).

This test fails on `dev` HEAD pre-refactor (the residual race is open). It passes after the refactor lands.

### Race scenarios

- Two `scanContract` calls on the same triple, different notes (concurrent polls) → serialized; no double-write.
- `setTrustAllow` + concurrent `onTokenDeleted` → user clicks Allow as another writer deletes; final state coherent.
- `clearProfile` + concurrent `scanContract` on different triples within the profile → both writers proceed independently.

### Invariant violations

- Re-entry attempt: a writer that calls another writer for the same triple → assert Lock force-release timer fires (5-min, faked via `vi.useFakeTimers`).
- Lock-Map leak check: bulk add/delete 100 contracts → `tripleLocks.size === 0`.

### Quality gates

`bun run audit:vue` (typecheck → unit + component → lint → build).
`bun run test:e2e` for the smoke surface (after the local e2e suite is fixed).
`bun run e2e:agent` on the merge candidate.

## 7. Quality gates

Local (before PR):
- `bun run lint`
- `bun run typecheck`
- `bun run audit:vue`
- New + existing test suites under `service.scenarios.test.ts` green
- Manual smoke: register a token, receive a fake note, click Allow, verify activity card appears, remove token, re-add, verify chain ordering preserved.

CI (PR-gate):
- `Quality / Status` (required check on dev)
- `Smoke e2e / Status` (advisory)
- `Network e2e / Status` (advisory on dev, required on main)
- Add `e2e:network` label to force network suite

## 8. Rollback / risk

- Single-PR revert via `git revert <merge-sha>` (squash-merge produces one commit). Restores the merged-arc state including all the audit-fix patches.
- If issues surface only on production traffic: there's no flag; the revert is the only path. Mitigated by the test surface above.

## 9. Open questions (post-audit, surface to user)

1. After the refactor, the `(Audit-5 High) setTrust* reverts to unknown` tests get DELETED — their compensating-action behaviour is gone (the lock prevents the race that needed the revert). Do we want to keep them as `.skip` to document the behaviour change, or delete outright? Recommend: delete; the lock-based replacement tests cover the same surface and the deleted tests would be misleading.
2. Should we extract the `Map<key, Lock>` + `withLockKeyed` pattern into a shared `KeyedLockMap` utility in `wallet-core/utils/`? Useful if other services need per-key serialization later. Not strictly required for this refactor; can extract in a follow-up PR if the pattern repeats.

## 10. Branch + commits + PR shape

- Branch: `refactor/incoming-transfer-trust-lock`
- Commit prefixes per phase:
  - `refactor(incoming-transfer): add withTripleLock helper (no behavior change)`
  - `refactor(incoming-transfer): migrate setTrust*/setTrustAllow/Reject under per-triple lock`
  - `refactor(incoming-transfer): migrate scanContract per-note under per-triple lock + drop scanGenerations`
  - `refactor(incoming-transfer): migrate onTokenDeleted under per-triple lock + drop scanGenerations bump`
  - `refactor(incoming-transfer): migrate onTransactionAdded under per-triple lock + drop txDeleteInflight`
  - `refactor(incoming-transfer): migrate clearProfile/clearChain under per-triple lock`
  - `test(incoming-transfer): rewrite race pins around lock-based contention`
  - `fix(incoming-transfer): post-impl audit findings`
- PR title: `refactor(incoming-transfer): per-triple Lock-per-Map for race-free trust state machine`
- PR body: link this plan, list the 8 phases, summarize the residual race that's closed, link the codex audit-6 conversation.

## 11. Implementation discipline

- Logger: `this.logDebug` / `this.logWarn` / `this.logError` — never `console.*`.
- Error messages: include the lock key triple in any timeout/force-release path.
- No emojis in code or comments.
- No comments narrating the change ("now using lock", "previously had generation counter"). Comments only for WHY, not WHAT.
- File the lessons log entries under `implementations-plan/incoming-trust-state-machine-refactor/lessons/phase-N.md` as each phase completes.

## 12. `/goal` and `/loop` seeds

### `/goal` (primary)

```
/goal All 8 phases marked ✓ in implementations-plan/incoming-trust-state-machine-refactor/plan.md; for each phase the agent has printed `LESSONS_FILE=implementations-plan/incoming-trust-state-machine-refactor/lessons/phase-N.md` in the transcript; the new residual-race-pin test passes (parked getBlockTimestamp + concurrent setTrustAllow → final hidden=false); all 60+ existing service.scenarios.test.ts tests pass (modulo the deleted compensating-action tests); `/code-review max --fix` complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; `bun run audit:vue` and `bun run test:e2e` both report exit 0 in the transcript.
```

### `/loop` (fallback)

```
/loop Each turn, in priority order:
1. **Inspect** (no blocking): read implementations-plan/incoming-trust-state-machine-refactor/plan.md and lessons/ as source-of-truth for phase status; run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch). If pushed without a PR but CI is configured, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **CI in flight on HEAD SHA?** Stream with `gh run watch <run-id>` for up to 10 minutes. If queued or stuck past that, inspect logs and report blocked.
3. **Failed check or local run?** Triage and fix; call `/codex xhigh` if the fix isn't obvious or the decision is non-trivial. Commit (small, conventional) and push. After 5 failures on the same step, stop and reassess.
4. **In-flight phase green?** Mark it ✓ in plan.md, file the lessons log entry, print `LESSONS_FILE=implementations-plan/incoming-trust-state-machine-refactor/lessons/phase-N.md` in the transcript, then advance to the next pending phase.
5. **Nothing in flight?** Pick the next pending step from plan.md and execute it (edit → `bun run lint` → `bun run test` → commit → push).
6. **All phases ✓ in plan.md?** Run the post-impl sequence: `/code-review max --fix` → skim applied fixes → commit → codex post-impl audit (`/codex xhigh`) with adversarial / security ask → address any high/critical findings (further loop iterations if needed). Once both reviews are clean, stop and surface to me.

Discipline: repo artifacts (plan.md, lessons/, git) are authoritative, not the chat ASCII checklist. Call codex on any architecture / scope / risk decision. Never merge to main or release branches; never publish or deploy. Stop when all phases ✓ in plan.md, `/code-review max --fix` applied and committed, codex post-impl audit clean. If merge is the next step, surface and stop.
```
