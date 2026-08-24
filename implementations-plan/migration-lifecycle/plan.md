# migration-lifecycle — batch 2 of audit-448-remediation

Fixes **N-02 (Major, first-migration-blocking)** — ambient MV3 wakes burn the durable migration retry budget, auto-escalating recoverable blocks to terminal "Reinstall" — **N-18** — a SW kill during `up()` bypasses the attempt bound via the resume-restore path (infinite crash-boot loop, no recovery surface) — and **N-27** — the boot storage probe counts journal rows in the wrong storage area. Spec: `implementations-plan/audit-448-remediation/runbook.md`; verdicts: `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; recon: [recon.md](./recon.md). Base: dev `85460d83`. Tier: **mid** (rubric: blast-radius HIGH once armed — every update-shipping user hits this machinery; irreversibility HIGH for the false-terminal outcome → 2 high would argue deep, but the surface is two files + one component with a 642-line engine suite already standing; runbook sets mid and the codex round can escalate).

**Success criterion:** with a transiently-failing migration, arbitrary ambient wake traffic can never flip a recoverable block to terminal — the budget is spent only by user-meaningful retry gestures (plus a slow autonomous backstop); a SW kill mid-`up()` is COUNTED so kill-loops bound out to the recovery screen instead of looping forever; the barrier's copy matches the real retry mechanics; the probe reports the journal's real storage area; the adopted regression pins are green with the fix; `bun run audit:vue` + `bun run test:e2e` green; PR squash-merged to dev.

**Scope:** N-02 + N-18 + N-27 per the runbook. All three are latent today (`realMigrations` is empty — recon batch-1 era) — this batch defuses them BEFORE the first real migration ships, per the adjudication's "first migration = launch" timing. OUT: any change to migration authoring/DSL, the degraded path, backup-import migration, alarms machinery.

**eli5_mode:** Artifact — published at https://claude.ai/code/artifact/f2c2edff-355c-4ace-a4d9-0fc8d11352d3 (source: `implementations-plan/migration-lifecycle/eli5.html`).

---

## Architecture & Implementation

### N-02 — chosen: Outline A, gesture-gated retry over the barrier's existing raw-storage channel (+ slow cool-down backstop)

The trap (adjudicated + recon-confirmed): a bare short-circuit kills automatic retry and falsifies the barrier's "close and reopen to retry" copy; a cool-down ALONE only slows the burn (the price alarm's ~3-min cadence still exhausts 3 attempts in ~3 windows). The barrier already owns an allowlisted RAW `chrome.storage.local` read + `onChanged` channel (recon §barrier) — a retry BUTTON writing a one-shot key through that same channel gives a true user-gesture signal with ZERO new RPC plumbing:

1. **New key** (extension layer, beside the blocked/degraded keys in `apps/extension/src/wallet/storage/migrations/index.ts`): `SCHEMA_RETRY_REQUESTED_KEY = "nulo:schema:retry-requested"` holding `{ requestedAt: number }`. Shape-validated on read; consumed (removed) on EVERY resolution path — before an engine run, on the terminal branch, and on healthy/no-blocked boots (stale-key hygiene, both audits).
2. **`runtime.ts` `doStart()` pre-check** (before the `Migrator` construction at `:143`): read `[SCHEMA_BLOCKED_KEY, SCHEMA_RETRY_REQUESTED_KEY]`.
   - **Fail CLOSED** (codex R1): a gate read failure → `retrySafe = false` + throw "migration gate unreadable" WITHOUT running the engine this boot (the next wake retries the read; repeated read faults can no longer burn attempts). A retry-key REMOVAL failure likewise skips the run (the tap is spent on a later wake — still one run per tap).
   - **Per-FIELD tolerant status decode** (codex R1 + final-pass correction): `terminal: true` (boolean) governs on its own — a malformed timestamp or counter can never void a valid terminal verdict. Malformed non-terminal fields degrade individually (`lastAttemptAt` invalid → treated as epoch 0, i.e. backstop-age-eligible, still capped by `backstopRuns`; `backstopRuns` invalid → treated as already-spent, the conservative direction). Only a blob with no decodable `terminal` at all is treated as absent (engine runs and rewrites).
   - **Version-stamp invalidation** (fable H1, corrected by the final pass): the stamp is `atExtensionVersion` — the MANIFEST version, **injected as a new `manifestVersion: string` field on `WalletRuntimeDeps`, wired from `chrome.runtime.getManifest().version` at the `index.ts` construction site** (final-pass r2: `BrowserApi.runtime` does not expose `getManifest`; injection beats a port extension on diff size) — NOT the migration registry's `maxVersion`, which is blind to code-only hotfixes. Pre-check mismatch ⇒ an update shipped since the block: the stale status (terminal INCLUDED) is invalidated and the engine runs once under the new code. **Stamp-corruption precedence** (final-pass r2): an undecodable/missing `atExtensionVersion` — even beside a valid `terminal: true` — is treated as MISMATCH (we cannot prove the verdict matches this build → invalidate, run once, rewrite valid); recovery-over-wedging, while decodable same-version terminal stays sticky.
   - No blocked status (or invalidated) → run the engine as today.
   - Blocked **terminal** (valid, same version) → consume any lingering retry key, rethrow immediately — no engine run.
   - Blocked **non-terminal**: run the engine ONLY IF (a) a valid retry request is present — consume first, one tap = one durable attempt (an ambient wake may be the one that spends it: the run is gesture-AUTHORIZED regardless of executor); or (b) the autonomous backstop: `clock.now() - blocked.lastAttemptAt >= MIGRATION_RETRY_BACKSTOP_MS` (30 min) AND `blocked.backstopRuns < 1`. **Backstop claim is durable and ordered** (final pass B2): `backstopRuns + 1` is persisted onto the blocked status BEFORE `Migrator.run()` — a kill mid-run cannot reset the claim — and every subsequent blocked-status rewrite CARRIES the counter forward (cleared only on success or version-stamp invalidation). Otherwise **short-circuit**: `retrySafe = false` + rethrow WITHOUT constructing the Migrator.
   - **One authorization = at most one `up()` execution** (final pass B1): the engine change in §N-18 makes a counted resume STAND DOWN (needs-recovery, retryable below the bound) instead of falling through into another `up()` in the same run — without this, a killed GESTURE attempt resumed by the single backstop wake would bump-then-rerun and could terminalize autonomously. With B1+B2+the cap, the terminalizing attempt provably requires a gesture: ambient traffic contributes at most the initial failure + one backstop-authorized event.
   - `MigrationBlockedStatus` gains `lastAttemptAt: number`, `backstopRuns: number`, `atExtensionVersion: string` (stamped from `deps.clock` + manifest; carried forward per B2; reset on clear/invalidation). Extension-layer shape change; pre-production, per-field tolerant decoder, no migration.
3. **`MigrationBarrier.vue`**: non-terminal blocked state gains a `Retry update` button (`data-testid="migration-retry-btn"`): writes `SCHEMA_RETRY_REQUESTED_KEY` via the component's existing raw-storage exception, then calls `chrome.runtime.reload()` — a DETERMINISTIC restart (codex R1: popup close does NOT guarantee SW death; the single-flight memo is sticky within a lifetime, so "close and reopen" was nondeterministic). Copy: "Your funds are safe. Tap Retry update — the wallet restarts and retries." Terminal copy unchanged (no button). The storage-facade ban is storage-specific and the component is path-allowlisted; `runtime.reload` availability from an extension page verified at impl.
4. **Engine untouched for N-02** — the burn is a runtime-invocation problem; `migrator.ts` keeps its per-run counting semantics (a run IS an attempt).

### N-18 — count interrupted `up()`s on the resume path, EXACTLY once (engine, `migrator.ts`)

Both audits disproved the draft's exclusivity claim: an armed journal survives not only kills mid-`up()` but also (a) same-boot restore-THROW boots, which deliberately keep the journal (`:236-241`) after already bumping `"restore"`, and (b) the window after `applyOne`'s `bumpAttempts` but before journal removal (codex: a resume bump there double-counts one thrown attempt). Exactly-once design:

- **Per-VERSION attempt counter** (final pass: the per-`(version, phase)` reset at `:358` lets alternating restore/up failures perpetually reset each other — convergence wasn't airtight). `AttemptRecord` identity becomes the VERSION alone; `phase` stays as an informational field recording the LAST failure's kind. All existing bump sites keep their call shapes; any engine tests pinning the phase-mismatch reset are updated DELIBERATELY (documented semantic change: attempts now accumulate per version across failure kinds; reset only on version change or success-clear).
- The journal/backup record gains a `counted: true` marker, set BEFORE `bumpAttempts` on EVERY path that bumps while the journal is retained: `applyOne`'s restore-throw path (`:236` — which today keeps the journal) AND `resumeIfInterrupted`'s restore-throw path (`:326`). Marker-first ordering: a kill inside the marker→bump gap under-counts that incident (per-cycle in the worst crafted case — final-pass note, accepted: the bias is never-falsely-terminalize, and each undercount requires a kill inside a milliseconds window).
- `resumeIfInterrupted`, after a SUCCESSFUL restore of an UNcounted journal: set `counted`, bump, then **STAND DOWN** (final pass B1): return `{ kind: "needs-recovery", reason: "migration interrupted mid-write", retryable: attempts < this.maxRetries }` — never fall through into another `up()` in the same run; one boot's authorization covers at most one `up()`. A `counted` journal resumes silently with NO bump and DOES fall through (its incident is already counted; the fall-through IS this authorization's one `up()`).
- UX consequence, accepted deliberately: a single innocent kill (browser shutdown mid-update) now surfaces the retryable barrier on next boot instead of silently self-healing — honest ("the update WAS interrupted"), and the Retry button/backstop recovers it.
- The stamped-clear path (`:317-321` — completed-migration debris) explicitly never bumps (fable).
- Engine's "never throw" contract preserved; success (`:175-176`) clears attempts as today.

### N-27 — probe rewrite, count-only (`runtime.ts:338-348`)

The probe becomes COUNT-ONLY against `browserApi.storage.local` (the journal's real area): the `getBytesInUse` cast and its bytes half are REMOVED entirely (the adapter definitively strips the method — port type `storage-port.ts:18`; no port extension, out of minimal scope); the single `.get()` read swaps session → local; log reads "local storage: N journal records". The liveness heartbeat's legitimate `storage.session` use (`:365-374`) untouched.

### Data & control flow (blocked-regime wake, after fix)

Ambient wake → module eval → `start()` → doStart pre-check reads blocked+retry keys → non-terminal, no request, backstop not elapsed → rethrow without engine → SW idles out. User taps Retry → barrier writes the key → user reopens → next boot consumes the key → ONE engine run → success clears blocked/attempts; failure re-persists blocked with fresh `lastAttemptAt`. Kill-loop: each armed-journal resume bumps `up` → third kill → `needs-recovery, retryable:false` → runtime persists terminal blocked → barrier shows the terminal copy.

### File-level change map

| File | Change |
|---|---|
| `packages/wallet-core/src/migration/migrator.ts` | N-18 bump + bound-check on resume-success |
| `packages/wallet-core/src/migration/migrator.test.ts` | N-18 pins: kill→resume cycles bound out at maxRetries (crash-safe-journal describe); first resume stays silent; counter shared with up-throws; success clears |
| `apps/extension/src/wallet/storage/migrations/index.ts` | `SCHEMA_RETRY_REQUESTED_KEY`; `MigrationBlockedStatus` + `lastAttemptAt`/`backstopRuns`/`atExtensionVersion` + per-field tolerant decoder |
| `apps/extension/src/wallet/runtime.ts` | doStart pre-check (fail-closed gate / version invalidation / consume-retry / durable backstop claim / short-circuit); status stamping + carry-forward; N-27 count-only probe |
| `apps/extension/src/wallet/index.ts` | wire `manifestVersion` into `WalletRuntimeDeps` |
| `apps/extension/src/wallet/runtime.migration-gate.test.ts` (NEW sibling — `runtime.test.ts` file-wide-mocks the Migrator and stays untouched) | the adopted c3-1 invariant with a REAL engine + shared durable store + fresh runtime instances, plus the Phase-2 gate list |
| `apps/extension/src/components/MigrationBarrier.vue` + `.test.ts` | Retry button + key write + copy updates; tests for button-writes-key, requested-state copy, terminal-has-no-button |

### Algorithms / non-obvious mechanics

- The pre-check FAILS CLOSED on read errors (superseding an earlier fail-open draft — ledger): a gate-read or key-removal failure means no engine this boot; the wake throws and the next wake retries the read. Repeated read faults can neither burn attempts nor bypass a terminal verdict.
- One-shot consume: remove the retry key BEFORE `Migrator.run()` so a mid-run kill can't replay the gesture (the armed journal + N-18 handles that regime).
- The adopted proof changes LAYER, not substance: the audit's c3-1 pins "3 ambient boots must not reach terminal" — at the engine layer that's unfixable-by-design (a run is an attempt); the fix moves the invariant to the runtime layer, so the colocated pin drives the runtime with a real Migrator over a `FlakySetStore`-style failing migration and asserts non-terminal persistence across ≥3 simulated wakes. The `audit/` proof copy stays untouched (still RED at engine layer by design — noted in the PR body so nobody "fixes" it).

### Trade-offs & alternatives not taken

- **Outline B (competing): pure cool-down, no button** — smallest diff (runtime-only), but the barrier's copy becomes dishonest-by-omission ("reopen to retry" would mostly hit the short-circuit; only every 30th minute reopens actually retry) and recovery latency is backstop-bound instead of user-controlled. Rejected as primary; the backstop half is INCLUDED in A (its interval doing double duty for users who never find the button).
- Popup→SW retry RPC (a proper service method): rejected — new plumbing the barrier deliberately avoids (it renders pre-service-boot, while the wallet runtime is failing; a service round-trip during a blocked boot is exactly what can't be relied on).
- Counting resume-restores under `"restore"` phase (N-18): rejected — isolating the counter would let alternating kill/throw sequences each stay below bound indefinitely (2 kills + 2 throws = 4 failures, neither counter at 3).
- Distinct backstop key vs `lastAttemptAt` on the blocked status: the field rides the status blob — one write, one read, no key sprawl.

## Security & Adversarial Considerations

- **Threat model**: the blocked regime is a trust-boundary state — storage may be mid-transform. The pre-check must not widen what runs while blocked (it only DECIDES whether the engine runs; no service registration happens on any blocked path — unchanged `throw` semantics). The retry key is attacker-writable only by extension-context code (same trust domain as the storage it would "protect"); a hostile write causes at most one engine run — the engine's own crash-safety + attempt bound govern from there.
- **Fail-closed preserved**: terminal stays terminal (no button, no backstop); corrupt-marker/invalid-journal paths (`retryable:false`) are untouched and now ALSO stop burning wakes.
- **No new deps, no crypto, no token changes.** The engine's "never throw" contract preserved (N-18 returns a result, never throws).
- **DoS-ish consideration**: the 30-min backstop bounds worst-case engine work under machine-driven wakes to 2 runs/hour — strictly less work than today's every-wake behavior.

## Assumptions

**Facts (verified; recon.md cites):** module-top-level `start()` per SW respawn (`index.ts:82,101-111`) + alarm shim (`:91-99`); `retrySafe` module-lifetime (`runtime.ts:107-123,:172,:378`); attempt/terminal mechanics (`migrator.ts:236,:246,:254,:326,:356-361`); blocked keys extension-layer (`migrations/index.ts:45-55`; written `runtime.ts:157-186`); resume-success bumps nothing (`:330-334`); armed journals arise from kills mid-`up()` AND from restore-throw boots that deliberately retain the journal (`:236-241`) AND from the post-bump pre-removal window — NOT exclusively kills (the draft's exclusivity claim was false; both audits); barrier has no affordances + raw-storage allowlisted channel (`MigrationBarrier.vue:6-10,:21-32,:41-61`); `clock: ClockPort` already in runtime deps (`:70`); probe reads session for both calls (`:338-348`); journal lives in local (`operation-journal/service.ts:108-110`).
**Inferences (post-audit state):** (1) ~~90-min terminal~~ CORRECTED by codex (initial failure = attempt 1; uncapped ≈60 min) — resolved by the ≤1-autonomous-run cap: ambient traffic can never supply the terminalizing attempt. (2) Barrier's raw-storage WRITE passes the path-based allowlist — VERIFIED by fable (`storage-facade-ban.test.ts:18,:30`); `chrome.runtime.reload()` availability from the barrier page verified at impl. (3) ~~runtime.test.ts hosts the pin~~ CORRECTED: it file-wide-mocks the Migrator → sibling real-engine file. (4) `lastAttemptAt`/`backstopRuns`/`atExtensionVersion` need no migration — per-field tolerant decoder + pre-production rule (fable-confirmed for the barrier's `.terminal`-only read). (5) ~~adapter may not pass getBytesInUse~~ CORRECTED (final pass): definitively stripped → probe is count-only. (6) Manifest version is injected via `WalletRuntimeDeps.manifestVersion` from `index.ts` (BrowserApi.runtime exposes no getManifest — final-pass-verified).
**Asks:** none remaining — the two audit-flagged adjudications (backstop terminalization, deterministic gesture activation) are resolved in-plan (cap + `runtime.reload`), per the contract's codex-mediated mechanism.

## Phases

### Phase 1 ✓ — engine: N-18 resume accounting
_Gate passed: lint 0, vue-tsc clean, 47/47 engine tests (41 prior — 3 deliberately re-pinned to the stand-down contract — plus 6 new interruption-accounting pins incl. the B1 sequence)._
Implement §N-18. Tests in `migrator.test.ts` (existing fixtures): (a) kill→resume cycles — each uncounted resume bumps, STANDS DOWN retryable, and the third reports `retryable:false`; (b) a `counted` journal resumes silently, no bump, and falls through to the run's one `up()`; (c) mixed failures accumulate on the PER-VERSION counter (restore-throw + kill + up-throw → bound; the old phase-reset pins updated deliberately); (d) success clears the counter; (e) restore-throw sets `counted` before bumping (both sites); (f) stamped-clear path (`:317-321`) never bumps; (g) **the B1 sequence pin**: initial up-throw (1) → killed second attempt → single resume boot bumps (2) and stands down WITHOUT executing `up()` again — attempts stay at 2, not terminal; (h) existing crash-safe-journal describe green (updated pins called out individually).
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test packages/wallet-core/src/migration/migrator.test.ts` (adjust invocation to the repo's actual test-path form at impl). Pass: exit 0, new + existing cases green. Layers: lint/typecheck + unit.

### Phase 2 ✓ — runtime: N-02 gate + N-27 probe
_Gate passed: lint 0, vue-tsc clean, 60/60 (engine 47 + runtime 5 + new gate suite 8). Two implementation-level decisions for the post-impl codex review: (1) `gestureRuns` added to the status — the backstop is allowed only BEFORE any gesture, making "terminal only by gesture" airtight across killed-gesture interleavings (the plan's stated invariant, now actually delivered); (2) version invalidation ALSO clears the engine's `SCHEMA_ATTEMPTS_KEY` (newly exported) — a new build is a new episode with a fresh budget. One deviation: the N-27 probe pin is dropped — the probe is post-registration, unreachable without the full service graph; verified by inspection + smoke boot logs._
Implement §N-02 items 1-2 + §N-27. Runtime-layer tests in a NEW sibling `runtime.migration-gate.test.ts` (real engine + shared durable `MemoryStorageArea` + fresh runtime instances — `runtime.test.ts` file-wide-mocks the Migrator and stays untouched): ambient-cycle pin (≥3 fresh `start()` cycles against a persistently-failing migration → engine ran ≤ policy allowance AND the PERSISTED status stays non-terminal — the adopted c3-1 invariant); retry-consume runs exactly once + removes the key; terminal short-circuits engineless AND consumes a lingering key; manifest-version mismatch invalidates a terminal status and the engine runs; backstop (fake `ClockPort`) allows exactly ONE autonomous run per episode — claimed DURABLY before the run (a kill mid-run does not reset it; pin: kill-after-claim → next elapse short-circuits) and carried across blocked-status rewrites; a second elapse without a gesture short-circuits; gate-read failure fails CLOSED; per-field decode pins: malformed timestamp + valid `terminal:true` still gates terminal, malformed `backstopRuns` treated as spent, undecodable-terminal blob treated absent; probe logs the local-area journal COUNT (bytes half removed).
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test <runtime test path>`. Pass: exit 0. Layers: lint/typecheck + unit.

### Phase 3 — barrier UX + full battery
Implement §N-02 item 3. `MigrationBarrier.test.ts`: retry button renders ONLY for non-terminal blocked; click writes `SCHEMA_RETRY_REQUESTED_KEY` (storage spy) + flips to the requested copy; terminal renders no button; degraded path untouched. Then the batteries.
**Validation gate** — commands: `bun run audit:vue && bun run test:e2e`. Pass: both exit 0 (smoke covers the popup shell; no dApp/PXE surface → no network e2e). Layers: all except network.

## Post-implementation (self-contained — the implementing session runs THIS, in order)

1. `/code-review max --fix` on the implementation diff (autonomous form: independent max-effort Anthropic-family review agent; fixes applied and committed SEPARATELY).
2. Codex post-impl audit (`/codex xhigh`, fresh session): net diff from `85460d83`, code-review commit summary, this plan + ledger, adversarial ask, and verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. Iterative fix loop: verify claims against source; apply; commit; log in `lessons/`; RESUME the session with the fix diff; repeat until no new material findings (3+ churning rounds → park per runbook).
4. Delivery below; green checks + codex final-diff sign-off → squash-merge (`gh pr merge --squash --delete-branch`; never `--admin`).

## Delivery

**Single arc, one PR** to dev from `worktree-migration-lifecycle`: `fix(migration): gesture-gated retry budget + kill-loop bound + probe area` (69 chars). Squash on green + sign-off per the autonomy contract.

## Decision ledger

| Decision | Source | Disposition |
|---|---|---|
| Outline A (gesture button + backstop) over Outline B (pure cool-down) | recon + both audits ratified ("A restores user control; B merely delays the burn") | **chosen** |
| N-18 `"up"`-phase counter | recon; both audits ratified | **chosen** |
| Engine stays clock-free; gate at runtime with existing `ClockPort` | recon | **chosen** |
| c3-1 proof adopted at the RUNTIME layer, REAL engine + shared durable store + fresh runtimes (not mock counts); pin asserts PERSISTED non-terminal status | recon + fable ("legitimate, not a weakening") + codex ("belongs at runtime, real Migrator") | **chosen**; sibling test file (`runtime.migration-gate.test.ts`) since `runtime.test.ts` file-wide-mocks the Migrator (fable F4) |
| audit/ proof copy stays UNTOUCHED (runbook contract) vs codex's "rewrite/retire the knowingly-red proof" | codex R1 vs goal contract | **conservative option taken** (no audit/ edits): the layer move is documented in the PR body + lessons; DISAGREEMENT LOGGED — revisit only if the owner loosens the audit/-untouched rule |
| ~~Version-stamp (`atVersion` = registry maxVersion)~~ SUPERSEDED by the final pass's B3 row below (manifest version) | fable H1 | superseded |
| Backstop cap: ≤1 autonomous run per episode; terminalizing attempt is always gesture-initiated | fable H2 + codex corrected math (~60 min uncapped) | **adopted** |
| Fail CLOSED on gate-read / key-removal failure (no engine that boot) | codex R1 (fail-open lets read faults keep burning) — supersedes the draft's fail-open | **adopted** |
| Tolerant blocked-status decoder (malformed → absent → engine runs + rewrites) | codex R1 | **adopted** |
| Exactly-once N-18 accounting via journal `counted` marker, marker-first (undercount-never-double bias); no bump on stamped-clear path | codex R1 + fable c3 | **adopted** |
| Deterministic gesture: retry button writes key THEN `chrome.runtime.reload()` | codex R1 (sticky single-flight memo makes "reopen" nondeterministic) | **adopted** |
| Retry-key hygiene: shape-validated, consumed on run/terminal/healthy paths | both | **adopted** |
| Exclusivity claim corrected (armed journal ⇐ kills AND restore-throw retention AND post-bump window) | both | **adopted** — plan text fixed, pins added |

| Stand-down after a counted resume (one authorization = at most one `up()`); accepted UX cost: an innocent single kill surfaces the retryable barrier instead of silent self-heal | final pass B1 (killed-gesture + backstop autonomous-terminalization sequence) | **adopted** |
| Durable backstop claim BEFORE the run + carry-forward across rewrites | final pass B2 | **adopted** |
| Version stamp = MANIFEST version (`atExtensionVersion`), not registry maxVersion (blind to code-only hotfixes) | final pass B3 | **adopted** — supersedes the fable-H1 stamp choice |
| Per-VERSION attempt counter (phase informational; deliberate pin updates) | final pass (alternating-phase reset evasion) | **adopted** |
| `counted` set on BOTH restore-throw bump sites; marker-gap undercount accepted (never-falsely-terminalize bias, ms window) | final pass | **adopted** |
| Per-FIELD tolerant decode (valid `terminal:true` governs alone) | final pass (whole-blob decode could void terminal via a bad timestamp) | **adopted** |
| N-27 count-only (adapter strips `getBytesInUse` definitively) | final pass | **adopted** |
| Stale fail-open line in Algorithms | final pass (plan contradiction) | **fixed** |

Unresolved disputes: one, logged above (audit/-proof retirement) — resolved conservatively per the goal's tie-break rule.

## Audit verdicts

- Fable round 1: **conditional approve** (5 conditions) — all adopted (ledger).
- Codex round 1 (session `01a03509-127b-7063-95aa-e1697f662cfc`): **conditional approve** (6 conditions) — all adopted (ledger); "retire the red proof" resolved conservatively (logged).
- Final fresh-context codex pass round 1 (session `01a0351d-…` per audit-codex.md): **reject** — 3 blockers (autonomous terminalization via killed-gesture resume; registry-version stamp blind to hotfixes; backstop/marker durability) + contradictions. ALL adopted in revision 3 (rows above).
- Final pass round 2 (resumed, on revision 3): **conditional approve** — "the core blockers are resolved… no new architectural blocker is evident"; conditions were executable-plan hygiene (manifest-version injection decided: deps field from index.ts; stamp-corruption precedence defined: undecodable ⇒ mismatch; stale text normalized) — all folded into revision 4. **GATE PASSED** (approval delegated per the goal contract).

## Seeds

Not used by the active pipeline run (the parent `/goal` governs). Standalone re-run:

```
/goal All 3 phases marked ✓ in implementations-plan/migration-lifecycle/plan.md, each ✓ backed by its validation gate reported passing in the transcript; /code-review max --fix applied+committed; codex post-impl loop converged (quoted); PR to dev green (gh pr checks output in transcript); bun run audit:vue and bun run test:e2e both exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/migration-lifecycle forward per plan.md. Reality-check plan.md + lessons/ + git status; next pending phase step; validate with the phase's gate after each meaningful edit; ✓ only when the written gate passes; decisions via /codex xhigh; log consults in lessons/; after all phases ✓ run the plan's Post-implementation section verbatim.
```
