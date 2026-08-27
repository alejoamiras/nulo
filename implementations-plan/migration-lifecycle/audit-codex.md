# Codex audits — migration-lifecycle

Session `01a03509-127b-7063-95aa-e1697f662cfc`, xhigh, read-only, cwd = this worktree. Dispositions in plan.md's ledger.

## Round 1 — on revision 1

Verdict: **conditional approve** (conditions: fix fail-closed/terminal handling, stale-key validation, deterministic gesture activation, backstop terminalization, exact-once N-18 accounting, real runtime-layer regression coverage).

- Adversarial: pre-check widens nothing (config/BB/services stay behind the throw, runtime.ts:125). Retry key is not an authz boundary — validate shape, consume before execution, clear stale on healthy/no-blocked/terminal paths. **Fail-open is unsafe**: a gate-read fault while terminal exists lets the engine run; repeated read faults keep burning N-02 — fail closed per boot on read/removal failure. Persisted blocked data needs runtime validation (missing/invalid terminal, NaN/future timestamps must neither bypass nor wedge).
- Assumption attack: **30-min math wrong** — initial failure is attempt 1; backstops at ~30/60 min → terminal ≈60 min, still ambient-terminalizing → reserve the final attempt for a gesture. **"Armed journal ⇒ killed up()" too strong** — includes the post-`bumpAttempts` pre-removal window (migrator.ts:205 region): resume bump would double-count one thrown attempt. Barrier can write storage, but popup close doesn't kill the SW — the single-flight memo is sticky (single-flight-start.ts:17): "reopen to retry" is nondeterministic → deterministic restart/wake needed. runtime tests mock `Migrator` — the real-engine harness is unproven. `lastAttemptAt` needs a tolerant optional decoder (non-terminal blocked records can already exist from storage failures). "Asks: none" premature (backstop terminalization + deterministic activation need adjudication).
- Implementation: A over B correct ("restores user control; B merely delays the burn"). `"up"` semantic better than alternatives, but needs an attempt ticket/stage so catch and resume count exactly once. Regression belongs at runtime with a REAL Migrator + shared durable store + fresh runtimes, not mocked counts. Prefers rewriting/retiring the knowingly-red engine proof (→ resolved conservatively against the runbook's audit/-untouched contract; disagreement logged in the ledger). N-27: the storage PORT lacks `getBytesInUse` (storage-port.ts:18) — extend or narrow the claim to the journal count.

All conditions adopted in revision 2 (ledger).

## Final fresh-context pass — round 1 (NEW session, dir codex-lCYhzZ93)

Verdict: **reject** (blocking: autonomous terminalization remains possible; the version stamp cannot detect code-only fixes; backstop/marker durability does not establish the claimed bound or exactly-once accounting).

- B1: gesture-only terminalization false — attempt 1 fails; a GESTURE attempt is killed; the sole backstop resumes it, bumps to 2, returns `undefined`, and the SAME `run()` executes another `up()` which can fail at 3 → autonomous terminal. Fix: stop with a retryable blocked result after counting a resumed interruption (one actual `up()` per authorization); pin the exact sequence.
- B2: `backstopRuns` must be durably claimed BEFORE `Migrator.run()` and preserved through every blocked-status rewrite — else a kill pre-persist leaves 0 and permits repeats.
- B3: registry `maxVersion` is not a code-version stamp (a code-only hotfix to migration v2 leaves it unchanged → terminal survives the fixed code). Use build/manifest version.
- Exactly-once: marker-first + separate counter is at-most-once; kills in the gap undercount per-cycle. Alternating restore/up failures perpetually reset the phase-scoped counter (`:356`) — convergence not airtight. Resume-restore-throw path not told to set `counted`.
- Assumption attack: exclusivity claim STILL listed as a Fact despite the ledger; cap inference disproved; "Asks: none" therefore false; `getBytesInUse` definitively stripped by the adapter.
- Contradictions: a stale fail-open line survived in Algorithms; whole-blob tolerant decode lets a malformed timestamp void a valid terminal flag.
- Otherwise reasonable: Outline A, deterministic reload, runtime-layer real-engine testing, the logged proof disagreement.

All findings adopted in revision 3 (plan ledger).

## Post-implementation audit — session `01a03576-e50f-7d41-9659-44379e25c297` (fresh; a first attempt died mid-run on a transient CLI failure — logged, retried)

**Round 1: reject** — (B1) `spentAttempt:false` unsound: a throw can escape AFTER a successful bump (journal clear), the host then resets the budget and an ambient wake can terminalize — track whether any bump landed; (B2) the ordinary up-failure path bumps with the journal retained-but-unmarked (a failed clear → resume double-counts) and the swallowing marker write permits false doubles — mark first, non-swallowing; (M3) a gesture spent on a free failure strands (gestureRuns>0 disables the backstop, token consumed) — re-arm the token; (S4) the barrier treats a future claimedAt as on-cooldown forever — clamp age ≥ 0. Verified-correct: degraded-budget clear, token hygiene, invalid-token consumption, corrupt-count reset.

**Round 2 (on the fix commit): conditional approve** — one regression: `attemptRecorded` documented per-run but instance-scoped; reset at `run()` entry + same-instance pin.

**Round 3 (on HEAD): approve.** Loop converged (2 fix rounds). This approve doubles as the pre-merge final-diff sign-off.

## Final pass — round 2 (resumed, on revision 3)

Verdict: **conditional approve** (conditions: resolve the remaining executable-plan ambiguities). "The core blockers are resolved: stand-down prevents resume-plus-rerun terminalization; the backstop is durably preclaimed and carried forward; manifest-version invalidation covers code-only fixes; per-version accounting removes phase-reset evasion. The accepted marker-gap undercount favors avoiding false terminalization and is adequately disclosed/testable. … With those textual/execution details normalized, the implementation shape is sound and no new architectural blocker is evident."

Conditions + resolutions (revision 4): `BrowserApi.runtime` exposes no `getManifest` → `manifestVersion` injected via `WalletRuntimeDeps` from `index.ts`; malformed/missing `atExtensionVersion` beside `terminal:true` → deterministic MISMATCH precedence (invalidate, one run, rewrite valid); N-27/Assumptions/file-map stale text normalized; superseded ledger rows marked. **GATE PASSED.**
