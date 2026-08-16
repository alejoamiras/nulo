# Plan — dedup-withlock (Arc 2 of audit 2026-08-14-dedup-mid) — POST-DUAL-AUDIT REVISION

**Tier**: `/blueprint mid` · **Branch**: `worktree-dedup-withlock` → PR into `dev`
**Scope**: finding Q-01 (verified table: `audit/quality/2026-08-14-dedup-mid/findings/verified/Q-01.md`) **plus one audit-discovered site** (`config/store.ts`, see F9) — 69 pairs / 15 files.
**Approval**: standing authorization via the owner's `/goal` (2026-08-16). ELI5 omitted (autonomous mode).
**Behavior constraint (refined by dual audit)**: no observable behavior change on any reachable path. Two explicitly-documented relaxations: (R1) release fires one microtask later than an inline `finally` at raw sites (no load-bearing site exists — fable L2/codex confirmed); (R2) `enter()` is HARDENED to never reject (logger-throw paths swallowed) — a change confined to today-unreachable error paths, adopted deliberately (see ledger D2).

## Assumptions

**Facts (dual-audit-verified against source)**
1. `Lock` (`packages/wallet-core/src/utils/lock.ts`) is a FIFO mutex; its internal promise only resolves; the ONLY theoretical rejection paths in `enter()` are a throwing `ILogger.log` (pre-enqueue "waiting" log, post-acquisition "acquired" log) or a throwing `setTimeout` — and a post-acquisition throw would reject AFTER ownership transferred with the force-release timer NOT yet armed (lock stranded). Only 5 of 15 Lock instances even carry a logger.
2. 68 verified pairs across 14 files + 1 audit-discovered site = 69 pairs / 15 files. Frame shapes are NOT uniform: 52 put `enter()` INSIDE `try` (today: `leave()` fires even on enter-rejection — which can release ANOTHER holder, a latent bug), 16 put it before (today: no leave on enter-rejection).
3. `profile/service.ts:169-176` `runExclusive` has `enter()` INSIDE its try (NOT identical to withLock); `incoming-transfer/service.ts:208-215` `withServiceLock` matches withLock exactly. Both delegate cleanly ONLY once `enter()` cannot reject (R2). `runExclusive`'s doc comment carries a load-bearing self-deadlock warning that must survive delegation.
4. `token/service.ts` has FOUR non-plain sites, not two: `:219/266` + `:313/350` (holdsLock; catch transitions the journal to "failed" WHILE the lock is held) and `:365-408` `updateToken` (catch calls `task.fail(error)` under the lock — fable H1) + one genuinely plain site. Task/journal transitions under-lock are load-bearing ordering (a freed waiter must not run before the failure is recorded).
5. `dapp-session/service.ts:314-330` `isExpired`: the `return true` sits AFTER the try/finally inside the `if` — the shape-preserving migration is `await this.lock.withLock(async () => { …body… }); return true`.
6. `dapp-interaction/service.ts:286` returns a LONG-LIVED popup promise from inside the frame; today the lock releases when the promise is CREATED, not when it settles. Naive `return await fn()` adoption would hold the lock through user interaction (codex blocker).
7. `activity-protocol/coordinator.ts` = striped `Map<string, Lock>` via `lockFor()`; `operation-journal` uses instance name `transitionLock`; `account/service.ts` `tupleLocks` (promise-chain mutex) is out of scope.
8. Force-release interplay: if the 5-min timer fires mid-section, BOTH today's hand-rolled `finally` and `withLock`'s call the same late `leave()` (which can double-release a newer holder — pre-existing hazard, pinned not fixed). Zero delta (fable-verified).
9. **15th site (fable M2)**: `apps/extension/src/wallet/config/store.ts:60-70` `ConfigStore.set` — same wallet-core `Lock` via the `@/wallet/utils` barrel, early `return` at `:63`, enter-inside-try. In scope.
10. In-repo precedent for the chosen shape: `rw-guard.ts:31-44` already exposes callback-scoped `read(fn)`/`write(fn)` + public split-hold methods — Outline A mirrors the sibling primitive.

**Inferences (resolved by the audits)**
- I1 (revised): with R2 in place, "`await enter()` resolved" ≡ "ownership transferred + timer armed" by construction, so `withLock`'s `leave-iff-entered` contract is exactly correct at ALL sites regardless of their historical frame shape. Without R2 this equivalence is false (codex blocker) — R2 is what makes the mechanical migration sound.
- I2: keep both domain wrappers as one-line delegations (names + ~45 callers untouched); safe under R2.
- I3 (verified by both audits): all 69 pairs are same-scope; no cross-method handoff exists.
- I4: `enter()`/`leave()` stay public (split-hold escape hatch; matches rw-guard precedent).

## Architecture & Implementation

### Primitive (phase 1 — implemented, audit-endorsed shape)
`Lock.withLock<T>(fn: () => Promise<T> | T): Promise<T>` — `await this.enter(); try { return await fn() } finally { this.leave() }`.

### Hardening (phase 1b — NEW, resolves the codex blocker; ledger D2)
`enter()` becomes non-throwing by construction: the two logger calls and the timer-arm are wrapped so no logger/setTimeout throw can (a) reject `enter()` after ownership transfer, (b) propagate into a hand-rolled frame's catch, or (c) block leave(). Precisely (final-pass corrected): the guaranteed equivalence is "resolved ⇒ ownership transferred" — what migration soundness needs; timer-arming is BEST-EFFORT (a throwing setTimeout is swallowed, leaving the lock untimed — accepted, strictly better than a rejected enter() while holding); Date.now()/clearTimeout are delimited as assumed-non-throwing platform built-ins. Characterization tests cover pre-enqueue and post-acquisition (>50ms contended) logger throws AND a throwing setTimeout. This also retires the latent "pre-enqueue logger throw → finally releases another holder" bug class in today's 52 enter-inside-try frames. Only 4 production Lock constructions carry a logger (corrected from 5). STATUS: phase 1b implemented at HEAD.

### Migration recipes (per-site classes)
1. **Wrapper delegation**: `runExclusive` / `withServiceLock` bodies → `return this.lock.withLock(fn)` (self-deadlock doc comment preserved).
2. **Mechanical (~61 sites incl. config/store.ts)**: body moves into the closure; early `return x` inside the old try becomes `return x` inside the closure with the outer statement `return await lock.withLock(...)`. Hand-reviewed per site. **fpc `getFpcs` exact shape (final-pass condition)**: `const early = await this.lock.withLock(async () => { …body…; if (cacheHit) return result.map(decorate); …rest…; return undefined }); if (early) return early; return result.map(decorate)` — the `:167` mapping stays under the lock, the `:220` mapping stays after release, `undefined` is the no-early-return sentinel (the mapped value is always an array, never falsy).
3. **Catch-under-lock sites (token ×3: addToken, addSeededToken, updateToken)**: the `try/catch` moves INSIDE the closure — `await lock.withLock(async () => { try { … } catch (e) { journal/task failure transition; throw } })` — so failure recording stays under the lock exactly as today; the `holdsLock` booleans disappear because withLock owns release. (Both audits: the previous "catch outside" recipe was inverted and would have shrunk the hold window on a reachable path.)
4. **Promise-creation site (dapp-interaction:286)**: assign-out shape — the closure CREATES the popup promise (including any `.finally(...)` chaining the site attaches) and assigns it to an outer local, RETURNING VOID (returning the promise from the closure would recreate the hold-through-interaction bug); the method returns the captured promise after `withLock` resolves. Lock releases at promise creation (one accepted microtask later — R1).
5. **Conditional site (isExpired)**: `withLock` call inside the `if`; `return true` stays outside (F5).
6. **Striped**: `this.lockFor(map, key).withLock(...)` (PR-reviewer note; also L4's transient mixed-mode note for token between commits).

### Tests (phase 1/1b additions beyond the 5 implemented)
- T1: force-release interplay — fn outlives MAX_HOLD_MS, timer force-releases, second holder enters, fn completes → late `leave()` releases the second holder (pins F8's zero-delta, fake timers).
- T2: synchronous throw inside fn → rejects with it + releases.
- T3: mixed-mode FIFO — raw `enter()` waiters and `withLock` waiters on one instance keep enqueue order (the tree is mixed-mode mid-migration).
- T5: nested `withLock` on one lock deadlocks until force-release (non-reentrancy pin backing profile's doc warning).
- Hardening characterization: throwing logger at both throw points → enter() still resolves, timer armed, no waiter released spuriously.
- T4 (phase 3, service-level): token failure path — journal "failed" transition completes BEFORE the token lock releases (pins recipe 3).

## Phases & validation gates
1. ✅ `withLock` + 5 tests (implemented; both audits endorse `return await fn()`).
1b. `enter()` hardening + T1/T2/T3/T5 + characterization tests. Gate: wallet-core suite.
2. Wrapper delegation + mechanical sites, file-per-commit. Gate per file: targeted vitest; full `bun run test` at end.
3. Special sites (token ×3 catch-inside + T4, dapp-interaction assign-out, isExpired, striped, config/store.ts). Gate: full unit + composition.
4. Whole-arc: `bun run audit:vue` + armed smoke + `bun run e2e:agent` SOLO.
5. Final fresh-context codex pass on plan+ledger (mid-tier step 5) happens BEFORE implementation of phases 2-3; post-impl: ONE codex xhigh diff pass → converged → PR → babysit → merge.

## Security & Adversarial Considerations
- Mutual exclusion is the security surface; FIFO order, timer arming, and failure-recording-under-lock are preserved by recipes 1-6; R2 strictly narrows failure modes (no spurious release, no stranded lock).
- The dangerous class is control-flow migration; mitigated by per-site classes above, file-per-commit review, T4, and the composition suite.

## Decision ledger
- **D1 (Outline A vs B)**: A (instance method) — both auditors, decisively; fable adds the `rw-guard.ts` in-repo precedent (callback-scoped methods + public split-hold). B rejected: reads worse, one extra import per file, no semantic advantage.
- **D2 (acquisition-failure parity — the codex blocker)**: three options considered. (i) enter-inside-try withLock: reintroduces the spurious-release bug the holdsLock sites defend against — rejected. (ii) per-shape dual recipes preserving each site's historical enter-rejection behavior: preserves a latent BUG (release-another-holder) at 52 sites and doubles migration complexity for an unreachable path — rejected. (iii) **CHOSEN**: harden `enter()` to non-throwing (R2), making the parity question moot and the single recipe sound everywhere. Deviation class: behavior change confined to logger-throw paths that are unreachable today (no production logger throws; 10 of 15 locks have no logger at all); direction strictly safer; characterization-tested. Codex's own framing ("await resolved is not equivalent to ownership transferred") is resolved by MAKING it equivalent rather than by inheriting the broken frames.
- **D3 (token catch placement)**: catch INSIDE the closure — unanimous across both audits; my original outside-catch recipe was inverted (would have moved failure-recording outside the lock on a reachable path). updateToken joins this class (fable H1).
- **D4 (dapp-interaction)**: assign-out promise capture (codex's requirement) over keeping a raw frame — keeps the invariant machinery at 15/15 files.
- **D5 (scope)**: +config/store.ts (fable M2). The verified table's 68 becomes 69; remediation.md will record the addition.
- **D6 (unresolved/accepted)**: R1 microtask-later release accepted (no observable consumer); the pre-existing late-`leave()` double-release hazard (F8) stays pinned-not-fixed per the bug-pin convention.

## Trade-offs / alternatives rejected
Inlining wrappers' ~45 callers (churn); sealing enter/leave (API narrowing out of scope); regex mass-replacement (control-flow variance); enter-inside-try wrapper + dual recipes (D2).
