# Cluster P1 — wallet-core primitives + aztec-runtime account adapter

> Scanner: general agent, 2026-08-22.

## P1-1 — `Lock` force-release hands ownership to next waiter, then stalled holder's late `leave()` releases THAT owner's lock (double-release watchdog theft)

**Severity:** Medium | **Repro confidence:** high | **Type:** concurrency / mutex-ownership violation

**Failing path:** lock.ts:63-68 (watchdog calls this.leave()), :92-106 (leave() has NO owner check), :83-90 (withLock finally always leaves).

**Counter-example (deterministic):**
1. H1 enters (watchdog T1 armed). H1's op wedges >5 min.
2. T1 fires: locked===true → leave() → locked=false, dispatch() grants queued W2; W2's enter() resumes and arms its own watchdog T2.
3. H1's op eventually settles → withLock finally runs leave(). It CLEARS T2 (stealing W2's safety net), sets locked=false, dispatch() grants W3.
4. W2 and W3 now execute concurrently inside a mutex everyone believes exclusive — e.g. two journal transitions, two profile-row mutations. W2 also runs permanently watchdog-less; each stolen release can cascade.

Even without third waiter: H1's late leave() frees the lock while W2 holds it, letting any new caller in.

**Violated invariant:** mutual exclusion after force-release; "a holder's leave releases its own hold, and only its own."

**Smallest safe fix:** mint owner token (Symbol) per successful acquisition returned from enter()/held by withLock; leave(token) no-ops unless token === currentOwner. Watchdog force-release swaps currentOwner to granted waiter's token. ~10 lines.

**Instances:** every default-watchdog instantiation — profile, transaction, token, contact, auth-registry, dapp-session, dapp-interaction, fpc, network, config store, operation-journal transitionLock, account restoreLock, queuedCreationLock, incoming-transfer serviceLock + KeyedLock default (keyed-lock.ts:67). execution-mutex.ts already rejects this primitive citing the watchdog — this is the residual hazard it couldn't name precisely.

**Caveat (honesty):** pinned as known-and-deferred — lock.test.ts:249-287 ("pre-existing double-release hazard… deliberately NOT fixed in this arc"). Reported anyway: blast radius spans ~14 production locks. NOTE for adjudication: interacts with C4-2's concrete resurrection counter-example — the theft is not just theoretical there.

## P1-2 — First-tx initialization decision trusts single possibly-stale node answer → guaranteed-failing duplicate-init tx (fee burn); also two-writer TOCTOU

**Severity:** Medium-Low | **Repro confidence:** moderate | **Type:** protocol-state race / error-path UX with fund cost

**Failing path:** aztec-runtime/src/account/nulo-account.ts:170-175 (getNullifierMembershipWitness("latest") → undefined ⇒ buildWithInitialization wraps ctor again), same oracle reused at :184-188, consumed at execution/view-executor.ts:249. No secondary confirmation anywhere (verified: only call sites).

**Counter-examples:**
- Stale node: account deployed from device 1 minutes ago; device 2 (restored seed) sends first tx through load-balanced/lagging RPC. Endpoint hasn't indexed deployment nullifier → witness undefined → ctor wrapped → sequencer rejects duplicate private initialization nullifier. User pays fee, gets opaque failure. Normal for public endpoints.
- TOCTOU: two devices/contexts send first tx near-simultaneously; both observe no witness; both build init txs; one lands, other fails at inclusion with fee burned.

**Violated invariant:** "absence of membership witness ⇒ account uninitialized." Actual: absence means "this node can't prove initialized" — conflates not-initialized with not-yet-synced.

**Smallest safe fix:** before wrapping, cross-check chain existence of account class/instance (node.getContract(this.address) or archived-instance lookup); treat "instance publicly exists" as initialized regardless of witness availability; alternatively classify duplicate-nullifier inclusion failure as distinct typed error so UI doesn't present generic send failure.

## P1-3 — ServiceCollection.start() mid-phase failure abandons in-flight sibling starts: successes stay live against "failed" boot; failures become unhandled rejections; nothing stopped

**Severity:** Low | **Repro confidence:** high mechanics | **Type:** startup lifecycle
base/index.ts:65-70 Promise.all(phase.map(start)) reject-fast, no settling siblings, no stop hook on IService. Phase 0 holds most dependency-less services: A rejects t=0, B resolves t=2s → start() rejected at t=0 but B's RPC handlers went live during its own start() → popups get live responses from a wallet whose boot failed (deletion coordinator/reaper/GC/SDK handler absent). Inverse: B rejects t=2s → unhandled rejection noise. Restart-after-veto permanent for SW lifetime documented; un-settled siblings not handled anywhere.
**Fix:** Promise.allSettled + aggregate first-error + surface sibling outcomes; optionally gate handler registration behind collection-level started ack.

## Verified clean

- rw-guard.ts: per-token reader expiry, re-arm arithmetic, condition-variable re-checks, writer FIFO priority, baton handoffs sound; force-release overlap-with-live-reader is documented debuggability contract. (Doc nit: header comment says "35 minutes" at rw-guard.ts:53 vs 90-min constant.)
- fsm.ts: covers all 8 JobStage values incl. terminal emptiness; unknown-stage TypeError unreachable (zod-guarded spec.ts:180-188).
- topology.ts/ServiceCollection: duplicate names rejected, self-deps/cycles named errors, unknown deps validated upfront.
- entity_storage/value-storage keep-on-malformed contract, @-delimiter prevents cross-root bleed, raw surfaces consistent with purge second-pass.
- mnemonic utilities standard BIP-39 bit math correct, KAT-pinned.
- alarm-dispatcher, keyed-lock, queue, event-handler, arrays, encoding, serialization: no reachable defect under normal operation.
- nulo-account chunking: APP_MAX_CALLS=5 ⇒ wrap reduces length 4/iter terminates; authwits/capsules preserved top-level (PXE registers request-wide); per-layer outer-authwit hashes + nonces correct; fee-payload top-level via inner EXTERNAL; derivation-vs-ctor-call descriptor fields match exactly.
- pxe wiring: epoch fences both-end bumps, generation fences incl. deleted-other-gen fall-through, provision atomicity, missing-key retry-once with capture-equality guard.
- bridge-core fee-juice: worst-case component-wise max true upper bound; -32601-only fallback predicate correct; budget multiplication guarded.
- schema-patch: import-time throw on drift is designed tripwire; idempotency via reference equality sound.
