# Phase 4 lessons — service threading, fingerprint, backup carriage

- **Gate GREEN**: `bun run audit:vue` exit 0 (typecheck 0 · 4443 tests · lint 0 · build), with the
  plan's named criteria (a)–(j) landed as 13 dedicated tests in a new
  `imported-keys DEK lifecycle` describe block + 4 account-side rewrap tests.
- **Rider (codex xhigh, blocking) round 1: FAIL — one real HIGH the tests missed.**
  `finalizeRestore`'s password branch unsealed the DEK and opened a **bearer-backed** session
  WITHOUT re-verifying MAC v2 — so a tamper landing in the window BETWEEN `restore()` and
  `finalizeRestore()` yielded a fully non-degraded session. Every OTHER open ran the state machine;
  this one path was inconsistent, which is exactly the shape a reviewer catches and a test suite
  doesn't (the tests exercised unlock and bearer-restore, never the finalize seam). Also MEDIUM:
  `deleteProfile` zeroized only `pending.secret`, leaving `pending.dek` + both rewrap-context DEKs
  resident until the lazy TTL sweep. Both fixed (15eab09b) with the rider's prescribed tests
  (tamper-between-restore-and-finalize → derived-only + no bearer; delete → context gone).
  **Re-verdict: PASS.** Sibling isolation, clone rewrapping, password resealing, account paths and
  the duplicate guards all checked out on the first pass.
- **The audits' round-1 catches paid off exactly as predicted**: `createPasskeyProfile` (fable's
  HIGH-1 "sixth site") and `restore()`'s error-flattening (fable's HIGH-2) were both real — the
  DEK/fingerprint stamping and the `DuplicateWalletError` rethrow would have shipped broken
  otherwise. The final-audit's clone-divergence blocker drove the whole source→destination rewrap
  design, which the account-layer tests now pin (a rewrapped row's ciphertext must DIFFER from the
  backup's).
- **Test-fixture blast radius is the real cost of a row-shape change**: 49 failures across 3 files,
  all mechanical (Profile fixtures needing `dekSealed`/`walletFingerprint`, `RestoreSecret`
  carriers, bearer `v: 1`→`2`, fake credentials needing `deriveDekWrapKey`). Worth noting for
  future shape changes: the fakes that return a CONSTANT master (FakePasskeyService) make
  same-master collisions endemic, so sweep-mechanics tests need `allowDuplicate: true` once a
  duplicate guard exists.
- **An unhandled-rejection failure is not a test failure**: the gate went red with 4443/4443
  PASSING because a pre-existing race test attached its `.catch` several ticks late, and the new
  DEK awaits shifted the timing so the rejection surfaced first. Fixed by attaching the settle
  handler synchronously at promise creation (identical assertion, no unhandled window) — not by
  weakening the race assertion.
- **Harness ops**: long-running validations (audit:vue ≈ minutes, codex xhigh ≈ many minutes) get
  killed by the background-task timeout. Same pattern as P2: run them `nohup`-detached to a
  real-disk log with an exit marker, then poll the marker in a bounded FOREGROUND loop (a
  background watcher gets killed just as readily as the work did).

LESSONS_FILE=implementations-plan/key-model-v2-hardening/lessons/phase-4.md
