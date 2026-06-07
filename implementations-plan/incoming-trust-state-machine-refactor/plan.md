# IncomingTransfer trust-state-machine refactor — consolidated plan

Iterated through two audit rounds (`audit-codex.md`, `audit-opus.md`, `audit-response-round1.md`, `audit-response-round2.md`). Round 2 surfaced a simpler architecture; the user pivoted from per-triple Map to a single global service Lock. This plan reflects that pivot.

## Locked decisions

1. **Single-PR big-bang switch.** All 8 writers move to the lock atomically across ordered commits.
2. **Single global service Lock.** One `Lock` instance per service. Using existing `wallet-core/utils/lock.ts`. (Originally proposed per-triple Map; Round 2 audits surfaced significant implementation complexity, user pivoted to global Lock.)
3. **Current 4-state FSM preserved.** `unknown → pending → trusted | blocked`. No new states.
4. **Actor-only — repo stays last-write-wins.** No CAS. The lock is the single source of mutual exclusion.

## 1. Goal + success criteria

### Goal

Linearize every mutation of `nulo:core:incoming-trust` and `nulo:core:incoming-transfers` behind one service-scoped lock. Remove correctness dependence on the ad-hoc patch stack accumulated over six prior codex audit cycles: `scanGenerations`, `txDeleteInflight`, compensating-action reverts, per-iteration `getRecord` re-check, `replayPendingPrompts` live re-checks. The external FSM, UI return contracts, and storage schema are byte-identical post-refactor.

### Done when

- Every writer path touching either storage table acquires the service lock before reading-then-writing.
- The concrete residual race called out in codex audit-6 is closed: if `setTrustAllow` lands while `scanContract` is parked before `buildRecord`, the final persisted record is NOT permanently hidden. New regression test pins this.
- `polling` Set stays (per-scheduler singleflight; orthogonal).
- `scanGenerations`, `txDeleteInflight`, `isStale`, `isUnwatched`, compensating reverts → all deleted.
- 4-state FSM preserved. Re-add still modeled as delete + rediscover.
- UI contracts unchanged: `setTrustAllow / setTrustReject` still return `boolean`; `IncomingTrustPopup` + `NewTokenPopup` need zero changes.
- Existing 60+ scenario tests pass with mechanical assertion rewrites where they relied on compensating-action behavior.
- `bun run audit:vue` (typecheck + unit + lint + build) green.
- `bun run e2e:agent` green for `incoming-transfers.test.ts`.
- No deadlock under any test combination.

### Measurable signals

| Signal | Pre | Post | Verification |
|---|---|---|---|
| `service.ts` LoC | 841 | ~550-600 | `wc -l` |
| Distinct race-guard primitives in `service.ts` | 3 sets/maps + 5 inline `isStale()` + 3 compensating reverts | 1 (`serviceLock`) | grep |
| Audit-3/4/5 race-fixture tests | Pass via ad-hoc guards | Pass via lock | `bun test` |
| New residual-race regression test (LR1) | n/a (race is OPEN) | Pass | new test |

## 2. Scope — files and phases

Single PR. Phases below are commit-shape, not separate PRs. Each commit produces green local CI; bisectable on revert.

### Phase -1 — Pin Lock primitive behavior (prerequisite)

`packages/wallet-core/src/utils/lock.test.ts` (NEW):
- Unit pins for FIFO ordering under contention.
- Force-release timer behavior (mock `setTimeout`; advance to `MAX_HOLD_MS`; verify `locked = false`).
- Double-`leave()` idempotent.
- `finally` release after async-throwing work.
- Log assertion: name + logger surface `Lock: waiting (queue: N)` debug log on contended acquire.

Why upstream first: the refactor makes the Lock primitive correctness-critical. Codex Round-1 flagged it has no test coverage. Add pins BEFORE the refactor depends on it. **First commit.**

### Phase 0 — Add lock seam scaffold + service epoch (no behavior change)

`packages/extension/src/wallet/services/incoming-transfer/service.ts`:
- Add `private readonly serviceLock = new Lock("incoming-transfer", this.logger)` field. One Lock per service. No Map, no eviction, no refCount.
- Add `private async withServiceLock<T>(fn: () => Promise<T>): Promise<T>` — wraps `serviceLock.enter()` / `try { fn() } finally { serviceLock.leave() }`.
- Add `private serviceEpoch = 0` field. Bumped by lifecycle events (`clearProfile`, `clearChain`, `onAccountDeleted`, `onTokenDeleted`) inside their critical sections. `scanContract` captures `epochAtStart` BEFORE PXE; inside each per-note CS, bails if `this.serviceEpoch !== epochAtStart`. Closes the lifecycle-cancel race the codex final audit identified (a scan parked on PXE before a clear/delete would otherwise resurrect records using stale PXE results).
- Add `private bumpServiceEpoch(): void { this.serviceEpoch += 1 }` helper.

No writer migration yet. Existing race guards stay. Tests stay green. **Second commit.**

### Phase 1 — Migrate `setTrustState` + `setTrustAllow` + `setTrustReject`

**Critical**: current code chains `setTrustAllow → setTrustState`; both would acquire the same non-reentrant lock and deadlock. Split into public wrapper + private locked helper.

**Also in this commit**: remove `setTrustState` from the public `Methods` interface (codex final-audit High). The method is exposed via IPC today; arbitrary callers can write any `state` including `blocked` directly, bypassing the FSM. Internal callers (`setTrustAllow`/`Reject`) call the private `_setTrustStateLocked` directly. Tests cast-access via `as never as { setTrustState: ... }`. Update `spec.ts` Methods + `client.ts` proxy (delete the public surface).

**Also in this commit (popup defensive fix, user-promoted from Ask A3)**: tighten `IncomingTrustPopup.vue`'s success-toast check from `if (ok !== false)` to `if (ok === true)`. The current `!== false` accepts `undefined`, which would show a success toast if the IPC layer ever drops the return value (boundary serialization edge case). `=== true` makes the popup show the success toast ONLY when the service explicitly returns true. False or undefined → no toast; user sees the popup close silently. Same one-line change in `handleAllow` and `handleReject`.

```ts
public async setTrustState(profileId, networkId, contract, state): Promise<void> {
    return this.withServiceLock(() => this._setTrustStateLocked(profileId, networkId, contract, state))
}

private async _setTrustStateLocked(profileId, networkId, contract, state): Promise<void> {
    await this.ensureInitialized()
    const record = await this.repo.setTrust(profileId, networkId, contract, state)
    this.emit("onIncomingTrustChanged", record)
}

public async setTrustAllow(profileId, networkId, contract): Promise<boolean> {
    return this.withServiceLock(async () => {
        if (!(await this.isTokenStillRegistered(profileId, networkId, contract))) return false
        await this._setTrustStateLocked(profileId, networkId, contract, "trusted")
        const visibilityEnabled = await this.isVisibilityEnabled()
        const records = await this.repo.listByContract(profileId, networkId, contract)
        for (const record of records) {
            if (!record.hidden) continue
            // Per-iteration getRecord re-check: tests may directly mutate the
            // records Map (bypassing the lock); the lock alone doesn't catch
            // those. Cheap (one repo read per record). Opus R1 H2.
            const stillThere = await this.repo.getRecord(record.siloedNullifier)
            if (!stillThere) continue
            const updated = { ...record, hidden: false }
            await this.repo.upsertRecord(updated)
            if (visibilityEnabled) this.emit("onIncomingTransferAdded", updated)
        }
        return true
    })
}
```

- Drop both compensating-action reverts in `setTrustAllow` (the lock prevents the race that needed them).
- Keep ONE upfront `isTokenStillRegistered` check, now inside the lock.
- `setTrustReject` mirrors but without the records loop.

Audit-5 tests at `service.scenarios.test.ts:1671-1729` updated to assert sequenced semantics ("delete is sequenced after Allow"). End state unchanged.

**Third commit.**

### Phase 2 — Migrate `replayPendingPrompts`

```ts
public async replayPendingPrompts(profileId, networkId, accountAddress): Promise<void> {
    await this.ensureInitialized()
    if (!(await this.isVisibilityEnabled())) return
    const trustRecords = await this.repo.listTrust()
    const pending = trustRecords.filter(t => t.profileId === profileId && t.networkId === networkId && t.state === "pending")
    if (pending.length === 0) return

    let network
    try { network = await this.networkService.getNetwork(networkId) } catch { return }

    for (const trust of pending) {
        await this.withServiceLock(async () => {
            const scoped = (await this.repo.listByContract(profileId, networkId, trust.contract))
                .filter(r => r.accountAddress === accountAddress)
            if (scoped.length === 0) return
            // Live re-reads inside the lock — token + trust may have changed since the outer snapshots.
            const tokens = await this.tokenService.getTokensRaw(profileId)
            const token = tokens.find(t => t.contract === trust.contract && t.chainId === network.chainId)
            if (!token) return
            const liveTrust = await this.repo.getTrust(profileId, networkId, trust.contract)
            if (liveTrust?.state !== "pending") return
            this.emit("onIncomingTransferPending", {
                profileId, networkId, accountAddress, contract: trust.contract,
                tokenId: token.id, tokenSymbol: token.symbol, tokenDecimals: token.decimals,
                amountRaw: scoped[0].amountRaw,
            })
        })
    }
}
```

Per-row lock acquire-release. Other writers can intervene between rows.

**Fourth commit.**

### Phase 3 — Migrate `onTokenDeleted`

```ts
private onTokenDeleted = async (token: TokenInfo): Promise<void> => {
    const profile = await this.profileService.getActiveProfile()
    if (!profile) return
    const network = await this.resolveNetworkByChainId(token.chainId)
    if (!network) return

    await this.withServiceLock(async () => {
        // Scheduler teardown + row mutations BOTH inside the lock so a concurrent
        // scan can't slip a row in between the teardown and the wipe.
        const accounts = await this.accountService.getAccounts(profile.id, network.chainId)
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
        // Invalidate any in-flight scans that fetched PXE notes before this delete.
        this.bumpServiceEpoch()
    })
}
```

Event order preserved: records deleted first, then `onIncomingTrustChanged → "unknown"`. PopupManager's close-handler relies on this.

**Fifth commit.**

### Phase 3.5 — Migrate `onAccountDeleted`

Round-1 + Round-2 audits flagged this: `onAccountDeleted` currently only tears down schedulers; records survive. After the refactor drops `scanGenerations` in Phase 4, an in-flight scan past PXE can persist rows for the deleted account.

Important fix from codex R2 H2: current `onAccountDeleted` iterates ALL networks matching the chain. Phase 3.5 must do the same.

```ts
private onAccountDeleted = async (account: { profileId; chainId; address }): Promise<void> => {
    await this.withServiceLock(async () => {
        const networks = await this.networkService.getNetworks(account.chainId)
        for (const network of networks) {
            // Scheduler teardown
            const key = this.schedulerKey(network.id, account.address)
            const interval = this.schedulers.get(key)
            if (interval) clearInterval(interval)
            this.schedulers.delete(key)
            this.watchedContracts.delete(key)

            // Record wipe per contract
            const contracts = new Set(
                (await this.repo.listForAccount(account.profileId, network.id, account.address))
                    .map((r) => r.contract),
            )
            for (const contract of contracts) {
                const records = (await this.repo.listByContract(account.profileId, network.id, contract))
                    .filter((r) => r.accountAddress === account.address)
                for (const record of records) {
                    await this.repo.deleteRecord(record.siloedNullifier)
                    this.emit("onIncomingTransferDeleted", record)
                }
                // Trust rows are contract-scoped, not account-scoped → survive.
            }
        }
        this.bumpServiceEpoch()
    })
}
```

**Sixth commit.**

### Phase 4 — Migrate `scanContract`

PXE I/O OUTSIDE the lock; state decisions INSIDE.

```ts
private async scanContract(profileId, networkId, accountAddress, contract): Promise<void> {
    // ── UNLOCKED discovery (PXE) ──
    let notes: RawNote[]
    try {
        notes = await this.noteService.getNotesRaw(networkId, accountAddress, contract)
    } catch (error) {
        this.logWarn(`getNotesRaw failed: ${getErrorMessage(error)}`)
        return
    }
    const network = await this.networkService.getNetwork(networkId)

    // Capture lifecycle epoch BEFORE PXE prefetch. If clear/account-delete
    // bumps the epoch during PXE I/O, every per-note CS below bails.
    // (Codex final-audit Critical: PXE outside lock means stale notes can
    // race with lifecycle events.)
    const epochAtStart = this.serviceEpoch

    // Prefetch block timestamps OUTSIDE the lock (PXE call per unique block).
    const blockTimestampCache = new Map<number, number | undefined>()
    const uniqueBlocks = new Set(notes.map(n => n.l2BlockNumber).filter(bn => Number.isFinite(bn)))
    for (const bn of uniqueBlocks) {
        blockTimestampCache.set(bn, await this.noteService.getBlockTimestamp(networkId, bn))
    }

    // ── LOCKED commit (per-note critical section) ──
    // Note: only the FIRST note that hits an `unknown` state in this poll
    // triggers the unknown→pending transition + Pending emit. Subsequent notes
    // find `pending` and skip the emit. Established first-receive semantic.
    for (const note of notes) {
        if (!note.siloedNullifier) continue
        await this.withServiceLock(async () => {
            // Lifecycle-cancel guard: clear/account-delete during this scan?
            if (this.serviceEpoch !== epochAtStart) return

            // Live re-reads INSIDE the lock (token, trust, tx-hash dedupe sets).
            const tokens = await this.tokenService.getTokensRaw(profileId)
            const token = tokens.find(t => t.contract === contract && t.chainId === network.chainId)
            if (!token) return  // Token deleted concurrently → bail.

            // Tx-suppression sets re-read live (codex R1 M1 / R2 confirmation).
            const outgoingTxHashes = await this.collectOutgoingTxHashes(network.chainId, accountAddress)
            const inflightTxHashes = await this.collectInflightTxHashes(profileId, networkId, accountAddress)

            // Existing-record branch: backfill blockTimestamp if missing
            const existing = await this.repo.getRecord(note.siloedNullifier)
            if (existing) {
                if (existing.blockTimestamp === undefined) {
                    const ts = blockTimestampCache.get(note.l2BlockNumber)
                    if (ts !== undefined) {
                        await this.repo.upsertRecord({ ...existing, blockTimestamp: ts })
                    }
                }
                return
            }

            if (outgoingTxHashes.has(note.txHash)) return
            if (inflightTxHashes.has(note.txHash)) return
            const amountRaw = parseNoteAmount(note)
            if (amountRaw === null) return

            // Read trust FRESH inside the lock — kills the residual race.
            const liveTrust = (await this.repo.getTrust(profileId, networkId, contract))?.state ?? "unknown"
            let trustState = liveTrust

            if (trustState === "unknown") {
                const updated = await this.repo.setTrust(profileId, networkId, contract, "pending")
                this.emit("onIncomingTrustChanged", updated)
                trustState = "pending"
                if (await this.isVisibilityEnabled()) {
                    this.emit("onIncomingTransferPending", {
                        profileId, networkId, accountAddress, contract,
                        tokenId: token.id, tokenSymbol: token.symbol, tokenDecimals: token.decimals,
                        amountRaw,
                    })
                }
            }

            const blockTimestamp = blockTimestampCache.get(note.l2BlockNumber)
            const record = this.buildRecord({ note, profileId, networkId, accountAddress, token, amountRaw, trustState, blockTimestamp })
            await this.repo.upsertRecord(record)

            if (trustState === "trusted" && (await this.isVisibilityEnabled())) {
                this.emit("onIncomingTransferAdded", record)
            }
        })
    }
}
```

Per-note lock acquire-release. Between iterations, other writers can intervene (correct UX: Allow click between notes affects subsequent iterations).

**Remove**: `scanGenerations` Map, `genKey`, `bumpGeneration` method + callsites in `onTokenAdded` / `onTokenDeleted` / `hydrateSchedulers`, `isStale` closure, all `if (isStale()) return` checks.

**Keep**: `polling` Set (per-scheduler singleflight; orthogonal). `watchedContracts` Map (scheduler bookkeeping).

**Seventh commit.**

### Phase 5 — Migrate `onTransactionAdded`

```ts
private onTransactionAdded = async (tx: Tx): Promise<void> => {
    const profile = await this.profileService.getActiveProfile()
    if (!profile) return
    const network = await this.resolveNetworkByChainId(tx.chainId)
    if (!network) return

    await this.withServiceLock(async () => {
        const matches = await this.repo.listByTxHash(profile.id, network.id, tx.hash)
        for (const record of matches) {
            if (record.accountAddress !== tx.account) continue  // split-fee scoping
            // Re-check existence — a concurrent onTokenDeleted may have wiped already (lock-internal too).
            const stillThere = await this.repo.getRecord(record.siloedNullifier)
            if (!stillThere) continue
            await this.repo.deleteRecord(record.siloedNullifier)
            this.emit("onIncomingTransferDeleted", record)
        }
    })
}
```

`txDeleteInflight` Set removed — the global lock serializes same-hash events (even across different contracts), so double-emit is impossible.

**Eighth commit.**

### Phase 6 — Migrate `clearProfile` + `clearChain`

Single global lock makes these trivial:

```ts
public async clearProfile(profileId: string): Promise<void> {
    await this.ensureInitialized()
    await this.withServiceLock(async () => {
        await this.repo.clearProfile(profileId)
        // Scheduler teardown happens via hydrateSchedulers; keep it inside the lock
        // so a queued poll can't fire between clear + rebuild (codex R2 H1).
        await this._hydrateSchedulersLocked()
        // Invalidate any in-flight scans that fetched PXE notes before this clear.
        this.bumpServiceEpoch()
    })
}

public async clearChain(profileId: string, networkId: string): Promise<void> {
    await this.ensureInitialized()
    await this.withServiceLock(async () => {
        await this.repo.clearChain(profileId, networkId)
        await this._hydrateSchedulersLocked()
        this.bumpServiceEpoch()
    })
}

// `hydrateSchedulers` now has a public lock-acquiring wrapper + a private
// `_hydrateSchedulersLocked` for callers that already hold the lock.
```

Emit semantics preserved: `clearProfile/clearChain` emit nothing per-triple (no behavioral change vs current). Consumers react via existing `onProfileDeleted` / chain-purge signals.

**Ninth commit.**

### Phase 7 — Test rewrites

`service.scenarios.test.ts` updates:
- Audit-3 generation-counter tests → rewrite to use lock pre-acquisition.
- Audit-5 compensating-revert tests → assert sequenced semantics.
- Audit-4 live-recheck tests → kept; live re-check now inside lock.

New file `service.lock-races.test.ts`:
- **LR1**: residual race fix (codex final-audit Medium clarification). Park scanContract's per-note critical section AFTER `liveTrust === "pending"` is read and BEFORE `repo.upsertRecord(record)`. Fire `setTrustAllow` concurrently. Under the lock's FIFO, setTrustAllow waits for the parked scan to complete (record persisted hidden), then runs (flips visible, emits Added). Final state: `hidden: false`. **This pins the bug codex audit-6 identified.** Without this exact parking point, the test trivially passes by ordering setTrustAllow first.
- **LR12 (new)**: lifecycle-cancel epoch test. scanContract parked between PXE prefetch and per-note lock; `clearChain` runs (bumps serviceEpoch); scan resumes, each per-note CS observes `serviceEpoch !== epochAtStart` and bails. No records persisted post-clear.
- **LR2**: concurrent setTrustAllow + onTokenDeleted → sequenced; coherent end state.
- **LR3**: concurrent scanContract for same triple → serialized.
- **LR4**: concurrent onTransactionAdded same hash → exactly one delete emit (replaces existing P5 reentrancy test).
- **LR7**: bulk clearChain vs concurrent scanContract → scan completes inside lock first, clear waits, executes after.
- **LR9**: reentrancy regression — setTrustAllow does NOT deadlock via the public-wrapper / locked-helper split.
- **LR10**: cross-account same-contract sequencing — two scans on the same contract for different accounts serialize.
- **LR11**: invariant — `record.hidden === (trust.state !== "trusted")` after a random sequence of writes.

(Dropped from earlier draft: LR5 cross-triple parallelism — no longer guaranteed under global lock; LR6 lock-map eviction — no map.)

**Tenth commit.**

### Phase 8 — Code-review pass + codex post-impl audit + fix loop

`/code-review max --fix` → commit applied fixes → `/codex xhigh` post-impl review → address findings.

## 3. Security & Adversarial Considerations

### Threat model

Malicious dApp registered via `register_token`. Goals: prompt-flood, impersonate cross-network, corrupt trust state, exhaust storage.

### Token-impersonation (cross-network + cross-profile)

Trust + lock key both scope by `(profileId, networkId, contract)`. Different networks or profiles → different rows. Refactor preserves. **Cross-profile**: trust rows are isolated by `profileId`. Refactor doesn't widen.

### Notification-flooding (churn)

A malicious dApp can `register_token → revoke → register_token` loop to repeatedly trigger Pending emits. PopupManager dedup is per-pending-cycle. **Threat acknowledged**; mitigation is product-scope (throttle/debounce same-triple emits or contract-trust-reset rate-limit). Filed as Open Question + deferred to follow-up PR.

### State-machine soundness

The lock prevents concurrency-induced illegality. Operator-induced illegality (a programmer wiring `setTrustState("blocked")` from `unknown` directly) is NOT prevented — UNLESS we remove `setTrustState` from public IPC (see Ask A1). Recommend: remove from IPC.

### Concurrency invariants

The global lock guarantees:
1. At most one writer's critical section runs at a time across the whole service.
2. Read-then-write atomicity within a critical section: writer reads + writes without any other writer intervening.
3. FIFO ordering: lock primitive guarantees.

The lock does NOT guarantee:
1. Eventual delivery of events. Emit inside the critical section; if a subscriber throws synchronously, EventHandler's per-subscriber try/catch swallows it. The writer's promise still resolves. (See F7.)
2. Cross-restart durability. SW restart kills the lock state; in-flight writes may leave inconsistent storage (e.g., trust=`pending` + no records). Documented residual; recovers on next scan.

### Deadlock surfaces

**D1. Re-entry.** Lock is non-reentrant. Public method that calls another lock-acquiring method = deadlock. Mitigation: split into public wrapper + private `_locked` helper (Phase 1, 6). Code review enforces no re-entry.

**D2. Force-release.** Lock force-releases at 5 min. If a critical section hangs (PXE inside the lock — which we avoid; getNotesRaw is OUTSIDE), the lock releases and the next caller runs while the hung caller is technically still inside its `try`. The hung caller's `finally lock.leave()` is idempotent (Lock primitive verifies). Documented residual.

### Memory growth

One Lock instance. No Map. Bounded by sizeof(Lock). No adversarial growth concern.

### Supply chain

No new external dependencies. Uses existing `Lock` from `@nulo/wallet-core/utils/lock.ts` (in-tree).

## 4. Assumptions

### Facts (verified)

- **F1.** `Lock` at `packages/wallet-core/src/utils/lock.ts`: non-reentrant, FIFO microtask queue, 5-min force-release. Used as global singleton in 11+ services.
- **F2.** Repo writes are last-write-wins; no CAS. `repository.ts:48-50`.
- **F3.** 8 distinct writers: `scanContract`, `setTrustState`, `setTrustAllow`, `setTrustReject`, `onTokenDeleted`, `onAccountDeleted`, `onTransactionAdded`, `clearProfile`, `clearChain`. (Plus `replayPendingPrompts` which writes nothing but emits events.)
- **F4.** UI consumers depend on the public Methods/Events interface byte-identically; the lock is purely internal.
- **F5.** Tests cast-access `scanContract` (private) and `repo` field via `as never as { ... }`. Must preserve.
- **F6.** `EventHandler.invoke` is **synchronous** — iterates subscribers, calls them, does not await async returns. Per-subscriber try/catch swallows sync throws. (`event-handler.ts:22-27`.) Reworded per codex R1 M3.
- **F7.** `scanContract` is called by the singleflight `poll` loop. The `polling` Set serializes contracts within one poll, but does NOT serialize against other writers.
- **F8.** `setTrustState` is exposed on the public `Methods` interface (`spec.ts:135`). IPC callers can invoke it with arbitrary `state`. Bypassable today. See Ask A1.

### Inferences (deduced, label clearly)

- **I1.** Per-note lock acquire/release in `scanContract` is cheap **enough**. **Confidence: medium.** Per-note locked work includes `tokenService.getTokensRaw` (storage scan), `collectOutgoingTxHashes` (`transactionService.getTransactions`, storage scan), `collectInflightTxHashes` (`operationJournalService.getOperations`, storage scan), `repo.getRecord`, conditional `repo.setTrust + emit + isVisibilityEnabled + emit`, `repo.upsertRecord + emit`. Several await chains; some are O(records) storage scans. **Real expected latency: 10-50ms per note** under typical wallet state. Worst case: 50 notes × 50ms = 2.5s lock-hold. Codex final-audit flagged the earlier "~5ms" claim as unsupported; this is more honest. Mitigation: measure during implementation; if hot, reduce by caching per-scan-batch within the lock (e.g., snapshot getTransactions once per scan, refresh only if epoch bumped). Filed as Open Question.
- **I2.** Removing `scanGenerations` + `txDeleteInflight` is safe — the global lock subsumes both. **Confidence: high.** Tests cover equivalent races.
- **I3.** Block-timestamp prefetch OUTSIDE the lock does not change semantics — same per-scan memoization. **Confidence: high.**
- **I4.** A single global lock is acceptable for incoming-transfer's throughput. **Confidence: medium** (downgraded per codex final-audit). Realistic concurrent writer count ≤ 4 (user click + scan + token-delete + tx-confirm). User-mediated writers (clicks) interleave with scans; scans hold the lock per-note for 10-50ms. Click latency under busy scan: up to ~50ms wait. Acceptable; not imperceptible but well within reasonable. Measurement to be added in Phase 7.

### Asks (decisions for user)

- **A2.** **Defer churn-flooding mitigation?** Throttle/debounce same-triple Pending emits. Product-scope. **Default if no input: defer to follow-up PR.**
(A1 — "remove `setTrustState` from public `Methods`" — was elevated from Ask to required after the codex final-audit. See Phase 1.)
(A3 — "popup `ok !== false` defensive tightening" — was elevated from Ask to required by user at approval gate. Folded into Phase 1 commit.)

## 5. Phase ordering rationale + revert safety

Each commit independently revertable. `git bisect` resolves to offending commit if a regression surfaces.

Highest-risk commit: Phase 4 (`scanContract`). Mitigated by: comprehensive test rewrite in Phase 7 + the new LR1 pin proving the residual race is closed.

## 6. Test plan

### Existing tests

60+ tests in `service.scenarios.test.ts`. Updates per phase commits. Major rewrites: audit-3 (generation counter), audit-5 (compensating reverts).

### New regression pins

11 LR tests in `service.lock-races.test.ts` per Phase 7.

### Quality gates

`bun run audit:vue` + `bun run e2e:agent` for `incoming-transfers.test.ts`.

## 7. Quality gates

Local: `bun run lint`, `bun run typecheck`, `bun run audit:vue`, manual smoke (register / receive / Allow / remove / re-add).
CI: `Quality / Status` (required on dev). PR labels: `e2e:network` for the full suite.

## 8. Rollback / risk

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Reentrancy (public method calls another public lock-holder) | L | H | Split into `_setTrustStateLocked` etc. LR9 pin. |
| Audit-5 fixtures fail post-refactor | M | M | Update assertions to sequenced semantics in same commit. |
| E2E `incoming-transfers.test.ts` regresses | L | H | Run before push. Public API byte-identical. |
| Lock contention degrades responsiveness | L | L | PXE is outside lock; locked CS sub-ms. Worst case sub-second. |
| Lock force-release leaves next holder writing on top | L | L | Documented residual matching rest of codebase. |

### Full-PR revert

`git revert -m 1 <merge-sha>` produces a clean revert.

## 9. Open questions

1. Should `setTrustState` be removed from public IPC? (Ask A1.)
2. Should churn-flooding mitigation be in scope? (Ask A2.)
3. Should the async-subscriber-throw popup misread be fixed in this PR or a follow-up? (Ask A3.)
4. Lock-hold latency telemetry? Lock primitive logs at >50ms wait / >100ms hold. Recommend rely on existing.

## 10. Branch + commits + PR shape

### Branch
`refactor/incoming-transfer-trust-lock` off `dev`.

### Commits (Conventional Commits, in order)

1. `test(wallet-core): pin Lock primitive behavior (FIFO, force-release, idempotent leave)`
2. `refactor(incoming-transfer): add serviceLock + withServiceLock helper`
3. `refactor(incoming-transfer): serialize setTrustState/Allow/Reject; drop compensating reverts`
4. `refactor(incoming-transfer): serialize replayPendingPrompts per-row; retire live-recheck blocks`
5. `refactor(incoming-transfer): serialize onTokenDeleted under serviceLock`
6. `refactor(incoming-transfer): serialize onAccountDeleted; iterate all matching networks`
7. `refactor(incoming-transfer): serialize scanContract per-note + retire scanGenerations + prefetch blockTimestamps`
8. `refactor(incoming-transfer): serialize onTransactionAdded; retire txDeleteInflight`
9. `refactor(incoming-transfer): serialize clearProfile/clearChain under serviceLock`
10. `test(incoming-transfer): lock-ordering scenarios + sequenced-semantics assertions`
11. `fix(incoming-transfer): post-impl audit findings`

### PR title

`refactor(incoming-transfer): global service Lock for race-free trust state machine`

### PR body skeleton

```
## Summary

Replaces three race-protection sets/maps + inline isStale() checks +
compensating-action reverts in IncomingTransferService with one global
service Lock serializing every writer. Closes the residual race codex
audit-6 identified. Public surface unchanged.

## Locked decisions

- Single-PR big-bang.
- Single global service Lock (was Map<triple, Lock>; pivoted Round 2 after
  audits surfaced significant complexity in the per-triple design).
- 4-state FSM preserved.
- Actor-only; repo stays last-write-wins.

## Test plan

- [ ] `bun run audit:vue` green
- [ ] `bun run test:e2e:network` green for `incoming-transfers`
- [ ] New `service.lock-races.test.ts` adds 8 race-ordering pins
- [ ] Audit-5 fixtures updated to sequenced-semantics assertions

🤖 Generated with Claude Code
```

## 11. Implementation discipline

- Logger: `this.logDebug` / `this.logWarn` / `this.logError` — never `console.*`.
- No emojis in code or comments.
- Comments narrate WHY, not WHAT.
- No `as never as { ... }` in production code (tests only).
- Lock acquisition site: always `withServiceLock(...)`. Never raw `serviceLock.enter()`.
- No new race-guard primitives in this PR. The lock is the only guard.
- File lessons log entries under `implementations-plan/incoming-trust-state-machine-refactor/lessons/phase-N.md`.

### Review checklist

- [ ] Every public method that mutates state acquires `withServiceLock`.
- [ ] No public method calls another lock-acquiring public method (deadlock).
- [ ] `try { } finally { lock.leave() }` — never swallow.
- [ ] Tests cast-access `scanContract` and `repo` still works.
- [ ] No new `as never as { ... }` casts in production code.

## 12. `/goal` and `/loop` seeds

### `/goal`

```
/goal All phases marked ✓ in implementations-plan/incoming-trust-state-machine-refactor/plan.md; for each phase the agent has printed `LESSONS_FILE=implementations-plan/incoming-trust-state-machine-refactor/lessons/phase-N.md` in the transcript; the new residual-race-pin test (LR1) passes (parked scanContract per-note + concurrent setTrustAllow → final hidden=false); existing service.scenarios.test.ts tests pass (modulo updated audit-3 + audit-5 assertions); new service.lock-races.test.ts adds 8 LR tests, all passing; `/code-review max --fix` complete with findings applied + committed; codex post-impl audit complete with high/critical findings addressed; `bun run audit:vue` and `bun run test:e2e:network -- --testNamePattern=incoming-transfers` both report exit 0 in the transcript.
```

### `/loop`

```
/loop Each turn, in priority order:
1. **Inspect**: read implementations-plan/incoming-trust-state-machine-refactor/plan.md and lessons/ as source-of-truth; run `git status` and `git log --oneline -5`. If PR exists, `gh pr view --json statusCheckRollup`.
2. **CI in flight on HEAD SHA?** Stream via `gh run watch <run-id>` up to 10 minutes.
3. **Failed check or local run?** Triage and fix; call `/codex xhigh` if non-trivial. Commit (small, conventional) and push. After 5 failures on same step, stop and reassess.
4. **In-flight phase green?** Mark ✓ in plan.md, file lessons log entry, print `LESSONS_FILE=...phase-N.md`, advance.
5. **Nothing in flight?** Pick next pending step from plan.md and execute (edit → `bun run lint` → `bun run test` → commit → push).
6. **All phases ✓?** Run post-impl: `/code-review max --fix` → commit → `/codex xhigh` post-impl audit with adversarial / security ask → address high/critical findings. Once both clean, stop and surface.

Discipline: repo artifacts (plan.md, lessons/, git) authoritative. Call codex on architecture / scope / risk decisions. Never merge to main or release branches; never publish or deploy. Stop when all phases ✓ in plan.md, `/code-review max --fix` applied + committed, codex post-impl audit clean.
```
