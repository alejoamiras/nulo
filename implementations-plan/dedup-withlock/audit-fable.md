# Fable plan audit (dual-audit leg 2)

Audit complete. I read the lock primitive, all 14 in-scope files (every distinctive frame shape plus spot-reads of the long-gap pairs), re-derived the site inventory by grep, and checked the plan's gates and conventions against the repo. One process note up front: the worktree already carries uncommitted Phase-1 work (`lock.ts` +16, `lock.test.ts` +67) matching the plan — the plan is being executed while under audit.

## Findings

### Blocker

**B1 — Step-3 recipe for the token `holdsLock` sites moves the journal "failed" transition OUTSIDE the lock (reachable behavior change).**
Evidence: plan.md:46 prescribes "outer `try/catch` (journal-failure reporting) stays OUTSIDE `withLock`". Today, at `apps/extension/src/wallet/services/token/service.ts:258-266` (and :342-350), a body failure runs `await this.journal.transitionOperation(..., { stage: "failed" }, ...)` in the catch **while the token lock is held** (`holdsLock=true`, the `finally` hasn't run yet). Under the plan's recipe, `withLock`'s `finally` releases first, then the outer catch performs the awaited journal write — the failed-transition leaves the critical section, the lock hold window shrinks on a reachable path (metadata-fetch failures are real), and a queued token op can interleave with it. That violates the stated hard constraint verbatim ("lock hold windows ... and token/service.ts's journal-transition-on-catch behavior all preserved exactly").
The faithful recipe is the opposite placement: keep the `try/catch` **inside** the `withLock` closure. Its only delta is the enter-rejection path (today enter-rejection lands in the catch and transitions the journal; catch-inside would not) — and `enter()` cannot reject in the current class, so that delta is unobservable.
Compounding this: **plan.md:65 states the invariant backwards** — "a lock-acquisition failure must still NOT transition the journal (catch outside withLock preserves this exactly)". Both halves are wrong against the real code at token/service.ts:218-267: today a lock-acquisition failure WOULD transition the journal, and catch-outside preserves that (it is catch-inside that doesn't). The plan's prose describes catch-inside while its recipe prescribes catch-outside; an implementer or test author following line 65 literally would pin the wrong behavior. (Q-01.md's step-3 justification has the same inversion; its instruction happened to be behavior-preserving only on the unreachable path.)

### High

**H1 — `updateToken` is misclassified as one of "token's 3 plain sites" (plan.md:45); it has the same catch-under-lock property as B1.**
`apps/extension/src/wallet/services/token/service.ts:365-408`: `try { enter; ...; task.complete(); return } catch { task.fail(error); throw } finally { leave }` — the catch shares the try with the finally-leave, so `task.fail` runs under the lock today. A mechanical wrap (`try { await withLock(body) } catch { task.fail; throw }`) releases the lock before `task.fail`; a freed waiter's continuation is scheduled during `leave()` and runs before the outer catch resumes, so a waiter can execute while the task is not yet failed — an ordering impossible today, and tasks are load-bearing (parent-task completion gating, see auth-registry/service.ts:352-354). This site must join the individual-care bucket with catch-inside-closure treatment. I verified the other in-frame catches are all safe **nested** inner try/catch blocks, exactly preserved by the recipe: network/service.ts:232 (seed loop), fpc/service.ts:212, fpc/service.ts:463 (via `restoreRows`), transaction/service.ts:547, auth-registry/service.ts:463.

### Medium

**M1 — Fact 3 (plan.md:12) misquotes `runExclusive`, papering over the enter-inside-try delta class.**
Profile's body is `try { await this.lock.enter(); return await fn() } finally { this.lock.leave() }` (`profile/service.ts:169-176`) — `enter()` INSIDE the try, unlike incoming-transfer's (`incoming-transfer/service.ts:208-215`), which matches `withLock` exactly. The same enter-inside-try shape dominates the mechanical sites (network:212-246, dapp-session:298-311, token:431-442, etc.; transaction:172/519 and queued-journal:156 are the enter-outside minority). For every enter-inside-try site, migration changes the enter-rejection path from "leave() anyway" to "no leave()". `enter()` has no rejection path today except a throwing `ILogger.log` (only 5 of 15 Lock instances even carry a logger), so no observable delta — but the plan claims byte-equivalence off a misquoted shape. Worst theoretical corner: if the post-acquisition log threw (lock.ts:31-33), `enter()` rejects with the lock HELD and the force-release timer NOT yet armed (armed at lock.ts:37, after logging) — hand-rolled frames recover via their finally; `withLock` would hold forever. Direction of the delta is otherwise the safer one, and `profile/service.ts:1466-1469` documents that the leave-without-enter class has bitten this codebase before. The plan should state the delta, not deny it.

**M2 — A 15th real site exists outside the audit's grep scope.** `apps/extension/src/wallet/config/store.ts:60-70` (`ConfigStore.set`, same wallet-core `Lock` via the `@/wallet/utils` barrel, early `return` at :63, enter-inside-try). Q-01 grepped `wallet/services/**` only; the plan inherits the miss while claiming "the release-on-every-path contract becomes unforgettable at every site" (plan.md:50). Migrate it or scope it out explicitly. My full grep of `apps/extension/src` + `packages` (comments excluded) found no other missed sites; the 68-pair table itself reproduced exactly.

**M3 — fpc `getFpcs` is the hardest "mechanical" site and deserves a named call-out.** `fpc/service.ts:152-220`: lock-held early `return result.map(decorate)` at :167, a **different** post-finally `return result.map(decorate)` at :220, and `result` mutated under the lock (:161). A naive result-discarding wrap either changes which return fires or moves `decorate` across the release boundary. The plan's generic hand-review rule covers it; naming the worst instance would de-risk phase 2.

### Low

- **L1** — Fact 5 (plan.md:14) misdescribes `isExpired`: the `return true` is AFTER the try/finally inside the `if` (`dapp-session/service.ts:314-330`), not "in the try body". `await this.lock.withLock(...); return true` is the smaller, exactly-shape-preserving migration; the plan's move-into-closure variant is also behaviorally fine.
- **L2** — `withLock` releases one microtask later than an inline finally (fn's promise must settle before the wrapper's finally). FIFO order and timer interplay unchanged; no load-bearing site found. Worth one clause in the plan's zero-behavior definition.
- **L3** — Arithmetic: 68 − 2 wrappers − 2 holdsLock − 1 conditional − 2 striped = 61 mechanical sites, not "~55" (plan.md:45, inherited from Q-01).
- **L4** — The phase 2/3 split leaves token/service.ts mixed-mode (3 `withLock` + 2 raw sites on one lock) between commits. Same queue, semantically sound — deserves the same PR-reviewer note the striped variant gets.

## Adversarial questions, answered from code

- **Can `enter()` throw/reject?** No path in the current class rejects: the internal promise only resolves (lock.ts:25-28); the sole theoretical rejection is a throwing logger call (lock.ts:22-24, :29-35). Covered under M1.
- **Timer fires mid-section; is withLock's finally identical?** Yes — genuinely zero delta. Both today's hand-rolled finally and `withLock`'s call `leave()` unconditionally after the body; in the timer-fired scenario both perform the same late `leave()`, which clears the NEXT holder's timer and double-releases (lock.ts:37-44, :63-77). That hazard is pre-existing and untouched; it should be pinned (T1 below), not fixed, per CLAUDE.md:169's bug-pin convention.
- **Fairness/ordering?** FIFO queue untouched; no acquisition-order change. Only L2's microtask note.
- **I1** — confirmed; the implemented `return await fn()` (not `return fn()`) is the correct form. **I3** — verified: per-file enter/leave line numbers strictly alternate with equal counts in all 15 files, and every frame I read (12+ across 9 files) is a same-scope try/finally; no cross-method handoff exists. **I2** — sound; note `runExclusive`'s doc comment (profile/service.ts:157-168) carries a load-bearing self-deadlock warning that must survive the delegation. **I4** — sound, and matches in-repo precedent (below).

## Outline A vs B

**A, decisively** — and on stronger grounds than the plan gives itself. The sibling primitive in the same directory, `packages/wallet-core/src/utils/rw-guard.ts:31-44`, already exposes exactly Outline A's shape: callback-scoped instance methods (`read(fn)`, `write(fn)`) plus public `enterWrite()`/`leaveWrite()` kept for genuine split holds. Outline B would make the repo's two concurrency primitives read differently for zero gain. B's striped-lock edge is nil (`this.lockFor(map, key).withLock(fn)` reads fine and is what the plan prescribes anyway). One correction to the plan's B analysis (plan.md:53): the barrel `export * from "./lock"` (wallet-core/src/utils/index.ts:5) would carry a free function automatically, so B costs one named import per file, not two — still strictly worse than A's zero. No concrete failure mode for A found.

## Missing tests

The plan's phase-1 list is good and already materialized in lock.test.ts (all six named tests present, including the subclass-simulated enter-rejection pin). Missing for a refactor of this exact primitive:

1. **T1 (should-add): force-release interplay** — fn outlives MAX_HOLD_MS, timer force-releases, a second holder enters, then fn completes and `withLock`'s finally `leave()` releases the second holder. Pins that the wrapper is byte-equivalent to hand-rolled frames in the one scenario where `leave()` runs without ownership (fake timers make it deterministic).
2. **T2 (should-add): synchronous throw** — `withLock(() => { throw e })` rejects with `e` and releases; current tests cover only async throw and sync return.
3. **T3 (recommended): mixed-mode FIFO** — raw `enter()` waiters and `withLock` waiters interleaved on one instance keep enqueue order; the tree is mixed-mode mid-migration (L4).
4. **T4 (phase 3, guards the B1 fix): token failure-path ordering** — the journal "failed" transition completes before the token lock releases.
5. **T5 (optional): non-reentrancy pin** — nested `withLock` on one lock deadlocks until force-release; documents the invariant profile/service.ts:157-168 depends on.

## Conventions

Conforms. The withLock doc comment (lock.ts:47-53) is full-sentence, invariant-bearing, milestone-tag-free (CLAUDE.md:330-342); tests are co-located per repo convention; every gate command named in the plan exists (`package.json:17/19/22/35`; wallet-core `package.json:19` `vitest run`); `audit:vue` composition matches CLAUDE.md:34; phase sequencing mirrors Q-01's risk ordering.

## Verdict

**conditional approve** — conditions: (1) rewrite plan step 3 (plan.md:46) to keep the try/catch INSIDE the `withLock` closure for token/service.ts:218-267 and :312-351, and correct the inverted invariant at plan.md:65 (B1); (2) reclassify `updateToken` (token/service.ts:365-408) into the individual-care bucket with the same catch-inside treatment (H1); (3) migrate or explicitly scope out config/store.ts:60-70 (M2); (4) correct Facts 3/5 and state the enter-rejection delta class instead of claiming byte-equivalence (M1, L1); (5) add tests T1 and T2 (T3/T4 recommended). Absent conditions (1)-(2) the plan as written changes reachable lock-window behavior at exactly the sites it promises to treat most carefully, and I would reject.

### Critical Files for Implementation
- packages/wallet-core/src/utils/lock.ts
- packages/wallet-core/src/utils/lock.test.ts
- apps/extension/src/wallet/services/token/service.ts
- apps/extension/src/wallet/services/fpc/service.ts
- apps/extension/src/wallet/config/store.ts
