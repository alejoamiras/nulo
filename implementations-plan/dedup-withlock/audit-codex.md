Blocking behavioral deltas exist.

- `enter()` can reject. `ILogger.log()` has no no-throw contract: the waiting log occurs before enqueue; the acquired log occurs after `locked = true`. The latter can reject after ownership transferred, causing proposed `withLock()` to skip `leave()` and strand the mutex. `setTimeout()` can likewise throw after acquisition. The force-release logger can throw before its `leave()`, preventing release.
- The plan misclassifies existing frames. 52/68 put `enter()` inside `try`; only 16 put it before `try`. Thus most currently call `leave()` if `enter()` rejects, whereas `withLock()` would not. In the pre-enqueue logger-failure case, today they can even release another holder—bad, but observable behavior. The proposed “no-release-if-enter-rejects” test codifies a change, not universal parity.
- I1 is therefore unsafe: “await resolved” is not equivalent to “ownership transferred,” and it matches the two `holdsLock` sites but not most existing frames.
- I2 is partly unsafe. `incoming-transfer` is exact delegation; [profile/service.ts](apps/extension/src/wallet/services/profile/service.ts:169) has `enter()` inside `try`, so delegation changes rejection behavior.
- I3 is supported: all 68 pairs are same-scope; no cross-method handoff exists.
- I4 is safe and necessary for API compatibility, although “future handoff” is speculative.

Two further site-level blockers:

- At token lines 217–266 and 311–350, current `catch` transitions the journal while the token lock remains held; `finally` releases afterward. An outer catch around `withLock()` runs after the wrapper has released, reversing that ordering. The plan also incorrectly says acquisition failure must not transition: current code does transition it. `updateToken()` similarly calls `task.fail()` before release and is not a “plain” site.
- [dapp-interaction/service.ts](apps/extension/src/wallet/services/dapp-interaction/service.ts:286) returns a long-lived popup promise from `try`; today `finally` releases immediately before promise adoption. Returning it from the callback makes `withLock()` hold the lock until user interaction completes. It needs promise capture with a non-promise callback result.
- Moving `isExpired`’s `return true` inside the callback unnecessarily extends the hold. More generally, callback settlement adds a microtask before release at raw sites; strict timing-identical hold windows are impossible without relaxing the constraint.

The five primitive tests are insufficient. Add real pre-/post-acquisition logger-failure tests, force-release plus late-holder completion characterization, pending-promise callback behavior, and service tests pinning token journal/task ordering and immediate dapp-interaction release. The late post-timeout `leave()` is indeed today’s behavior; it can release a newer holder and clear its timer, so the existing “double leave idempotent” claim is misleading, though the wrapper adds no delta.

Outline A is preferable to B: mutex protocol belongs on `Lock`, avoids imports, and B fixes none of these semantics. File-by-file commits are review-friendly, but sequencing must separate enter-before-try sites, enter-inside-try sites, catch-before-release sites, and promise-return sites; activity’s existing domain wrappers can delegate early.

**VERDICT: reject (with blocking findings: acquisition-failure parity, token catch/release ordering, and dapp-interaction promise hold).**
---

## Post-implementation diff review (fresh codex session, xhigh)

Blocker: None.

High: None.

Medium:

- [token/service.composition.test.ts:260](apps/extension/src/wallet/services/token/service.composition.test.ts:260) — The ordering pin is non-discriminating. It records `journal:failed` synchronously when the failed transition is invoked, but records the waiter only after `restore([])` fully settles. Moving the catch outside `withLock()` still produces the expected order; I reproduced this scheduling. Use a deferred failed transition and assert the queued operation cannot enter until that deferred transition completes.

Low: None.

The implementation itself preserves all reviewed hold windows and special recipes. All 69 sites across 15 files migrated; no production raw `enter()`/`leave()` remains; FPC, popup promise capture, `isExpired`, token catches, and wrapper/striped delegation are correct. The 12 lock tests match the plan, and no import or layer-boundary delta exists.

Verdict: fix requiredNo new material findings. The gated failed transition makes the mid-flight assertion genuinely discriminating, and the commit changes only that test.

converged