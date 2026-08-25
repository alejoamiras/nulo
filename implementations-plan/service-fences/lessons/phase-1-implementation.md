# Phase 1 — implementation + review arc

## Environment findings

- bb.js WASM does not run in the extension's vitest env (`std::bad_cast`) — the N-03 pins mock `deriveAccountSeed`/`NuloAccount.new` (the fence's subject is ORDERING, not crypto; the real derivation is covered by the aztec-runtime KATs + network e2e).
- Making `getGeneration` REQUIRED (codex plan round 1) forced 22 test constructions to declare it — exactly the omission-is-a-type-error property the requirement buys.
- Six pre-existing test files stubbed ProfileService without `getDeletionState`; the fences surfaced every one at typecheck/run time. A fence that widens a service's dependency surface widens every stub of that service.

## Max review — REQUEST-CHANGES, 2 substantive findings, both adopted

1. **MAJOR (empirically proven by the reviewer): the entry captures dereferenced raw rows without a null guard at 5 sites.** Backup slices are attacker-controlled and `normalizeAllIds` deliberately preserves non-object elements — a single crafted `null` row TypeErrored the whole `.map()` BEFORE `restoreRows`, converting the documented per-row `restoreError` contract into a whole-import abort + rollback. Fix: the null-safe `(r as {...} | null)?.profileId` form (the diff already used it at the network site). **Lesson: hardening code sits at the SAME trust boundary as the code it guards — an entry capture over hostile rows must be exactly as hostile-input-tolerant as the row loop it protects. Probe new pre-loop code with a `null` element as a matter of course.**
2. **The entry-capture property itself was unpinned**: every N-14 pin used `beginDeletion` WITHOUT `release`, so the rejected lazy-capture design would still pass them (row 2 sees the profile reserved → same `/deleted/` error). The plan mandated an entry-race case; it hadn't shipped. Fix: begin+RELEASE variants on the two structural shapes (contact = locked `restoreRows`, network = hand-rolled) — after release the profile is unreserved and the epoch settled, so ONLY an entry-captured epoch still rejects. Both probed red under a simulated lazy capture (`assertRestoreEpoch(deletion, captureRestoreEpochs(deletion, [pid]), pid)` at the write). **Lesson: when a review overturns a design (lazy → entry capture), the pin must discriminate the OVERTURNED design, not just any deletion — `beginDeletion` without `release` tests the reservation, not the capture point.**
3. Nit adopted: reverted a sed-collateral fixture drift (`userHandle` "src-profile-id" → "new-id") — an overly-broad global replace during test updates; targeted seds only.

Verified-clean for the record: all fence placements (no await between assert and write anywhere), the threaded-profileId RPC arity end-to-end (wrapParams preserves positional arity; `definePassthroughsExhaustive` cannot clobber the typed overrides — `restore` is not a Methods key), hostile-input aiming (normalizeAllIds forces every row to the created id), and the single production BalanceJobQueue wiring.

## Codex final-diff round 1 — CHANGES ×2, both adopted

1. Contact's e2e hold gate (`restoreGate.waitAt`) sat BEFORE the epoch capture — an injected park lets a deletion begin AND release, then the capture reads the settled epoch and writes land. I had noticed this ordering during implementation and dismissed it as "test-only path"; codex correctly refused the dismissal — the fence's own rule is capture-at-earliest, and a hold point is exactly the park the fence exists for. Reordered (init → capture → gate) + a controllable-gate pin, probed red with a pre-capture wait re-added. **Lesson: "only e2e can trigger this window" is not an exemption — a hold point is a first-class park.**
2. The account collision precheck (`hasIntersectionByKeys`) dereferenced raw rows — a hostile null still aborted the whole slice AFTER the entry-capture null fix. Same lesson as the max review's finding 1, one call further down: EVERY pre-`restoreRows` pass over raw rows must be null-tolerant, not just the one that was flagged. Filter for the precheck only; original array to restoreRows; per-row pin probed.

## Mid-batch dev merge + smoke triage

- The owner merged the bun-1.4 line into dev mid-batch (bun-runtime vitest #459, isolated linker + v2 lockfile #455, +2). Merged dev into the branch (clean, `merge-tree` pre-verified), reinstalled, re-validated — the fence suites pass unchanged under the bun-runtime vitest (e2e configs don't use it).
- Smoke then failed 3× consecutively — but the failures ROTATED within the SW-restart family (`sw-restart-network` / `sw-resilience`), always 29 s timeouts, and targeted runs of the same tests always passed in ~7 s. Isolation: full smoke on CLEAN origin/dev → green; full smoke on my tree minutes later → green (112 passed both). Verdict: host-load flake in the known-flaky family, not the diff. **Lesson: when full-suite reds rotate within one family while targeted runs pass, discriminate with a clean-baseline + own-tree pair under the same host conditions before touching code — three same-family reds can still be pure load.**

## Codex final-diff round 2 — SIGN-OFF

Verified at `807c7e20` ("capture precedes the gate with a discriminating begin+release pin; null-safe precheck with the original array still reaching per-row handling; assertions flush against writes"). No remaining fence, contract, pin-vacuity, or hostile-row issue; PR gated only on the battery.
