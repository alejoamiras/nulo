# deflake-round-4 — crash-truth fixes (fix-plan, deep tier)

> **MID-ARC UPSTREAM COLLISION RE-SCOPE (2026-08-18, codex-agreed ×3).** While
> this plan was in audit, a parallel remediation campaign moved dev (#391-#399):
> BUG-FENCE was independently found via a USER REPORT and fixed with the
> fall-through variant + its own regression e2e
> (`network/profile-reimport-matrix.test.ts`); the composable was restructured
> and its rollback became B-24's bounded `rollbackCreatedProfile` helper with a
> "cleanup pending" UX. Codex-agreed re-scopes: **PR-2** adopts dev's
> fall-through fence verbatim and becomes the DEFENSE-IN-DEPTH delta only
> (capture-conditional equality guard, readiness-once + already-ready-send
> authority closure, key zeroization, pins); the planned control e2e is DROPPED
> in favor of upstream's matrix test (+ a cheap generation-change assertion
> folded there), which also becomes the certification prover-ON leg. **PR-3**'s
> liveness gate now COMPOSES with B-24 (disconnect-classified → await liveness
> advance → the bounded helper runs against a live worker; ceiling skips the
> helper → `rollback-failed`; classification covers isClientDisconnectRejection
> AND RpcDisconnectedError). Sections below predate the collision where they
> reference the control file or a fence-side marker split; the decision ledger
> rows 13-15 record the supersessions.

Fix the two product bugs the round-4 evidence campaign confirmed (see
`lessons/phase-1.md` — 7 instrumented runs + codex review) and land the
crash-truth suite fully green, as a 4-PR `gh stack` into dev off
`deflake-r4/crash-truth`. Supersedes `plan.md`'s Delivery section (which
predates the findings and says "one PR").

- **BUG-FENCE (HIGH)**: `assertGenerationCurrent`
  (`packages/aztec-runtime/src/pxe/service.ts:797`) collapses every non-`live`
  lifecycle state into a marker-less rejection, so a same-id re-imported
  profile (fresh generation, minted at `profile/service.ts:1398/1486`) can
  never trigger the client's provisioning retry (`pxe/client.ts:158`) — even
  though `provisionChainStoreKey` (service.ts:725) explicitly permits
  `deleted(different-gen)` installs. Recovered wallet is sync-dead for the
  offscreen document's lifetime. Reproduced with no crash.
- **BUG-TRANSPORT (moderate-high)**: `ServiceClient`
  (`packages/extension-messaging/src/background/client.ts`) treats a
  synchronously-returned doomed Port as `Connected` during the MV3 SW respawn
  gap; `rejectAllPending` kills calls issued in the gap in <1s. The crash
  rollback's `deleteProfile` structurally cannot run.

Tier: deep (blast radius + security sensitivity HIGH — the fence is the D4
resurrection control; the transport is every surface's wire). Three
independent plans (main / codex `01a01507-0073-7df1-bfb3-0d9af3c49374` /
fable subagent) consolidated below; recon in `recon-fixes.md`.
`eli5_mode: artifact`.

## Decisions (the goal's five open asks + two sub-forks)

1. **Transport fork → liveness-gated single-shot rollback (codex's design;
   caller-level, transport untouched).** On a disconnect-classified
   pre-finalize failure (`isClientDisconnectRejection` /
   `RpcDisconnectedError`), the composable's catch: (a) awaits a **new**
   `nulo:liveness` write — the causal "runtime fully wired" signal, written by
   the SW ONLY, immediately after `services.start()` + SDK handler
   (`runtime.ts:302-314`; sole writer verified; lives in
   `chrome.storage.session`, so the pre-kill value persists for a
   strictly-later comparison); (b) `disconnect()` + `connect()` the
   composable-local profile client (fresh port, deterministic); (c) calls
   `deleteProfile(createdProfileId)` **exactly once**. Ceiling only to surface
   `rollback-failed` — never the success mechanism. Non-disconnect failures
   keep today's immediate single-shot path.
   - Liveness ⇒ deletion delegate wired (the coordinator wires it inside
     `services.start()`, which completes before the liveness write) — this
     dodges the "deletion coordinator not ready" boot race fable identified,
     by design rather than by code change. Wording precision (final fresh
     pass): liveness proves ITS WRITER completed startup — a VALIDATED
     INFERENCE that the subsequently-connected Port reaches that worker, not
     a Port-level handshake; the post-liveness delete-rejection path stays
     fail-closed (pinned) for the pathological mismatch.
   - No replay ambiguity: the gap-issued call never reached a worker (churn
     continued through the rejection window — lessons run-7); the single
     post-liveness call is a fresh, first send.

2. **Fence fix → offscreen-only, direct-throw with the marker (codex+fable
   over main's fall-through).** `assertGenerationCurrent` splits its
   rejection: `deleted` + `gen !== captured` → throw an error CONTAINING
   `PXE_STORE_KEY_MISSING` ("generation mismatch under a deleted lifecycle —
   provisioning required"; NEUTRAL wording — generations are unordered, so a
   different gen is not necessarily a successor); everything else stays
   marker-less and unchanged: `deleted(same-gen)` (D4 — dead forever),
   `deleting(any)`, `live(gen mismatch)`. The client's existing once-only
   retry then routes authority through the SW's durable-row provider
   (`runtime.ts:214-229`, HKDF + post-derive generation re-read) →
   `provisionChainStoreKey` hits its already-written `deleted(different-gen):
   install` branch → `live(G2)` → retried op (original capture, stamp-once)
   passes. `provisionChainStoreKey` itself is untouched.
   - Direct-throw over fall-through: the provisioning signal must not depend
     on the sibling invariant that `clearProfileState` erased the store key —
     the fence emits it deterministically.
   - **Client equality guard, capture-conditional** (codex+fable; scoped by
     codex's contradiction round): in the retry, WHEN the op carries a
     capture, `provision.generation !== captured` → rethrow the ORIGINAL
     error without provisioning — a doomed op's error path must not
     side-effect-install a newer key, and unrelated provisioning can never
     rescue a stale capture. When the op is UNCAPTURED (documented contract:
     absent captures pass — test fakes, store-key fail-close), the guard does
     not apply and missing-key recovery keeps working; pinned.
   - **Generations are UNORDERED** (codex contradiction find): an
     inverse-stale capture — `deleted(G2)` + delayed G1 op — also matches
     `gen !== captured` and RECEIVES the marker. The marker is an authority
     REQUEST, not proof of succession: recovery still requires the SW
     provider (durable row gone or returning a different generation → no
     provisioning, guard refuses) — so the stale op still dies, D4 intact.
     Pinned explicitly.
   - No SW-side eager provisioning: lazy provisioning is the designed channel
     (zero proactive call sites — recon C); the fix makes it reachable.
   - **Provision-authority hardening (codex double-audit CRITICAL; ordering
     tightened in the fold re-review):** the provision SEND can be
     arbitrarily delayed by the offscreen client's `onReady` — which may
     detect an unhealthy offscreen and RECREATE it, resetting the in-memory
     lifecycle map (the pre-existing residual of concurrency audit HIGH #1).
     A concurrent delete + offscreen recreation could then let a stale
     provision land on `unseen`. Closure, in the retry path: (1) `await`
     offscreen readiness ONCE, explicitly (the same single-flight
     `ensureOffscreenRunning` that `onReady` uses); (2) invoke the
     generation/store-key provider ONCE (never derive twice); (3) send the
     provision AND the retried op via an **already-ready send path that
     cannot re-invoke `onReady`**. **The atomic boundary, stated precisely
     (final fresh-pass correction): readiness does NOT make recreation
     impossible — `ensureOffscreenRunning` can resolve while a
     create-replace is still in flight (the documented benign race). The
     enforced invariant is NO SUSPENSION from the provider's post-generation
     read through the `sendMessage` invocation** — with zero awaits in that
     span, authority cannot go stale between validation and wire; whatever
     offscreen receives the message either has its lifecycle map intact
     (provision matrix rejects stale installs) or the send fails. A
     provision/retry send failure PROPAGATES AS ITSELF (the current, more
     diagnostic behavior — pxe/client.ts:161-167 — deliberately preserved;
     it is NOT swapped for the original marker error).
     **Concurrency-safety of the bypass (final fresh-pass HIGH)**: the
     already-ready mechanism must be a synchronous ONE-CALL bypass reset
     before the request promise escapes (or a factored correlator core) — a
     flag held across the promise would let concurrent ordinary RPCs skip
     readiness. Pins: the wire is invoked without a microtask between
     authority read and send, AND a concurrent normal request during the
     recovery sequence still calls `onReady`.
     Abort-on-generation-change stays. **Key
     ownership**: the provider-returned store key is caller-owned and
     zeroized in `finally` — including generation-mismatch aborts and after
     base64 encoding for the wire. The equality comparison snapshots the
     capture from the POST-STAMP `args[0].pxeGeneration` (request()
     auto-stamps the mutated arg — client.ts:133-152), never a pre-stamp
     copy.

3. **Scenario-A designed-retry contract → strict clean import** (unanimous).
   Post-`rolled-back` the store is provably empty; with the fence fixed the
   provisioning retry is intra-op and transparent. A skip-errors summary on
   the retry = residue = red. **The no-crash control goes strict too**
   (codex over fable): run-7's summary was fence-rejected account-state ops;
   post-fix a clean-system re-import must be clean — tolerance was a
   diagnostic-era shape. If a summary still appears, that is a NEW finding to
   surface, never to tolerate.

4. **consoleErrors CDP blind spot → ledger** (unanimous): OPEN flake-ledger
   entry + a warning comment at the fixture's `consoleErrors` declaration.
   None of this arc's gates rely on console capture.

5. **Respawn-behavior tests → package unit tests** (unanimous; composition
   layer is the wrong home per COMPOSITION-TESTS.md). With the transport
   untouched, no doomed-port harness work is needed; one characterization pin
   in `client.test.ts` documents sent-call fail-fast + never-resent.

## Architecture & Implementation

**Components touched**
- `packages/aztec-runtime/src/pxe/service.ts` — `assertGenerationCurrent`
  three-way split + doc comment (service.ts:789-796) update. ~10 lines.
- `packages/aztec-runtime/src/pxe/client.ts` — the hardened retry sequence
  (readiness once → provider once → already-ready sends) + the
  capture-conditional equality guard.
- `packages/extension-messaging/src/offscreen/client.ts` (+ its unit test) —
  the already-ready send primitive: a PROTECTED/internal request variant
  that reuses the complete request machinery (correlation, pending cleanup,
  timeouts, serialization, telemetry, send-error settlement) but performs NO
  await and NO `onReady` before wire dispatch. Never exposed as a generic
  public readiness bypass (codex condition).
- `apps/extension/src/utils/background-liveness.ts` (NEW, ~40 lines) —
  `awaitLivenessAdvance(baseline, ceilingMs)`: read current `nulo:liveness`,
  subscribe via `chrome.storage.session.onChanged`, re-read to close the
  subscribe race, resolve only on a strictly-later value; ceiling rejection
  carries the last-seen value. **Self-healing property** (fable
  contradiction-check): the SW heartbeat rewrites `nulo:liveness` every 10s
  (runtime.ts:318-322), so even if the new worker's FIRST write lands before
  the catch's baseline read, a strictly-later value arrives ≤10s later — the
  baseline race cannot deadlock. Ceiling = 60s (structural: heartbeat 10s ×
  margin; 60s ceiling + 60s delete RPC ceiling stays under the test's
  ROLLBACK_BUDGET_MS = 150s). Liveness is `clock.now()` wall-clock: a clock
  step-back stalls "strictly-later" until real time recovers → ceiling →
  fail-closed; tolerated, documented in the util (fable fresh-audit).
- `apps/extension/src/composables/useFullBackupImport.ts` — the catch's
  rollback leg: disconnect-classified → baseline = value read at catch entry
  (which may already BE the new worker's first write — that is fine: the
  await is for the NEXT successful strictly-later write, whoever wrote the
  baseline; the 10s heartbeat or the next boot's immediate write supplies
  it, or the ceiling fails closed) → await advance → reconnect client →
  single `deleteProfile`. Stage semantics unchanged (`rolling-back` →
  `rolled-back` | `rollback-failed`).
- `apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts` —
  PR-1: `@requires-proverless` marker, scenario-A skip, control extracted
  OUT; PR-3: un-skip A.
- `apps/extension/tests/e2e/network/pxe-fence-reimport.test.ts` (NEW, PR-1)
  — the no-crash control + its own no-false-skip contract assertion;
  skipped in PR-1, un-skipped + strict terminal in PR-2.
- `apps/extension/tests/e2e/helpers/<shared module>` (NEW, PR-1) — the
  extracted shared machinery (exportFundedBackup, budgets, readProfileGen,
  completeResetRitual, reimportToTerminal).
- Ledger/docs files per Phase 4.

**Critical flow (post-fix crash path)**: kill → in-flight restore RPC rejects
("Client disconnected") → catch classifies disconnect → `rolling-back` →
await liveness advance (new worker boots off the ambient reconnect churn;
writes liveness after full wiring) → reconnect profile client →
`deleteProfile` (delegate guaranteed wired) → purge incl. offscreen
`clearProfileState` → `rolled-back` → page returns to fresh import → designed
retry → fence marker → provision(G2) → clean import → convergence.

**Trade-offs & alternatives not taken** — see Decision ledger.

## Phases = PRs (stack: PR-1→dev, each later PR on its predecessor)

**Phase 1 / PR-1 `test(e2e)` — land the suite, findings ledgered.**
**Split the no-crash control into its own file**
(`tests/e2e/network/pxe-fence-reimport.test.ts`) — it uses no rendezvous gate
and must be runnable prover-ON, where it becomes the fence fix's prover-ON
regression leg (codex contradiction find: the crash file's rendezvous exists
only in proverless builds, so a prover-ON pass of THAT file is structurally
impossible). Mark `backup-restore-sw-restart.test.ts` with the runner's file-level
`@requires-proverless` marker (VERIFIED: `apps/extension/scripts/e2e/agent.sh`
greps invocation targets for the marker and refuses prover-ON runs with exit
2 before any build — the crash file currently lacks it, a pre-existing hang
trap this closes). The new control file carries NO marker (prover-capable). Then convert scenario A (crash file) + the control
(new file) to `test.skip` with `// SKIP —` blocks per repo convention
(sw-resilience.test.ts:169 model), each citing BOTH
`implementations-plan/deflake-round-4/lessons/phase-1.md` and the new
flake-ledger OPEN entries (added in this PR: BUG-FENCE, BUG-TRANSPORT —
dated deflake-round-4 section). Scenario B + agent-contract stay active. The
control file gets its OWN agent-runner no-false-skip contract assertion
(mirroring the crash file's), and the shared machinery (exportFundedBackup,
budget constants, readProfileGen, completeResetRitual, reimportToTerminal)
is EXTRACTED to a shared e2e helper module (`tests/e2e/helpers/` per repo
layout) — never cross-imported from a test module, never duplicated. Add
deflake-round-4 to `implementations-plan/index.md`; pointer note in old
`plan.md` (Delivery superseded). `gh stack init --adopt deflake-r4/crash-truth`,
`gh stack submit --draft --auto`.
FILE MAP: backup-restore-sw-restart.test.ts (marker + A skip + control
extraction), pxe-fence-reimport.test.ts (NEW — control + no-false-skip
assert, skipped), tests/e2e/helpers/<shared module> (NEW), flake-ledger.md,
index.md, plan.md.
GATE: `bun run lint` + `bun run typecheck:all` + `bun run test` (units) +
solo `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent
tests/e2e/network/backup-restore-sw-restart.test.ts
tests/e2e/network/pxe-fence-reimport.test.ts` → B green, A skipped, control
skipped, zero failures; PR checks (quality/smoke/network) green.

**Phase 2 / PR-2 `fix(aztec-runtime)` — the fence.**
Mechanics per Decision 2. Unit pins (incarnation-fence.test.ts fixtures
reused): (1) deleted(G1)+capture(G2) → rejects WITH marker; (2)
deleted(G1)+capture(G1) → marker-less (extends :175-191 — G1 executing is a
release blocker); (3) deleting(any) → marker-less; (4) live(G3)+capture(G2) →
marker-less; (5) lifecycle loop: provision(G1) → clear(G1) → op(G2) marker →
provision(G2) → op(G2) passes; (6) INVERSE-STALE: deleted(G2) + capture(G1)
→ marker thrown, but provisioning refused (provider absent or returns
different gen) → op fails, never executes — D4 intact with the marker as
request-not-proof; (6b) CRASH-ON-RETRY EDGE (fable fresh-audit find, pinned
as-is): map `deleted(G1)`, incoming `clearProfileState(G2)` → REFUSED
(service.ts:667-671 different-gen guard) — so a crash after the retry mints
G2 but before provisioning leaves a state whose delete fails closed to the
torn backstop until the offscreen restarts. Behavior PINNED, not changed
(clear-supersede surgery is fence-adjacent and out of audited scope);
ledgered for the transport-hardening follow-up. Post-fix the window narrows
to crash-before-provision only (a provisioned G2 is `live(G2)` and clears
normally). client-capture.test.ts: (7) provider gen ≠ captured → NO
provision RPC, original error propagates — pinned via AUTO-STAMPED capture
(the guard reads post-stamp `args[0].pxeGeneration`), asserting no provision
AND no second original RPC; (8) provider gen == captured → provision +
single retry succeeds; (9) UNCAPTURED op + missing-key error → retry still
provisions (guard is capture-conditional; documented contract preserved);
(10) AUTHORITY RACE (codex critical): ordering pin — the harness COUNTS
readiness invocations and asserts the exact sequence `ready → provider →
provision-wire → retry-wire` with NO second readiness event between the
provider call and the wire AND no microtask suspension between the authority
read and the send; a provider returning a CHANGED generation after readiness
→ retry ABORTS, no provision sent, original error propagates (models delete
+ offscreen reset + stale retry) — "readiness once" means once in the
RECOVERY sequence (the original failed RPC's own readiness does not count);
(10b) BYPASS CONCURRENCY (final fresh-pass): a concurrent ORDINARY request
issued during the recovery sequence still invokes `onReady` — the bypass is
one-call, synchronously reset before the request promise escapes; (10c)
provision/retry SEND failure propagates as itself, not as the original
marker error (current diagnostic behavior pinned); (11) key hygiene: the provider-returned key is zeroized in
`finally` — on success, on the generation-mismatch abort, AND when the
provision/retry send REJECTS (the failure path most likely to escape a
mis-scoped finally); the base64 wire string cannot practically be zeroized —
acknowledged, JS strings are immutable. Un-skip the control (its own file), strict terminal (no
summary). Evidence: solo retry=0 proverless run of BOTH files — control
GREEN, B green, A still skipped; PLUS one prover-ON run of the control file
(the fence fix's prover-ON regression leg).
GATE: `bun run --cwd packages/aztec-runtime test` + `bun run typecheck:all` +
`bun run lint` + the solo file run + PR checks green.

**Phase 3 / PR-3 `fix(extension)` — the rollback.**
Mechanics per Decision 1. The liveness util runs event + poll CONCURRENTLY
(codex double-audit, adopted over probe-then-choose): subscribe via the
existing `StorageArea.onChange` abstraction, re-read to close the subscribe
race, AND poll the key at 1s — whichever observes a strictly-later value
resolves. Both legs are causal (the signal is the VALUE advancing); the
concurrent shape removes the environment-dependence of onChanged delivery
entirely, so the disposable probe step is DROPPED.
Unit pins: background-liveness.test.ts (baseline / advance / subscribe-race
/ ceiling / CLEANUP — both resolution AND ceiling remove the
`StorageArea.onChange` listener and clear the poll + ceiling timers; the
dual-observer shape must not leak work); useFullBackupImport.test.ts extends the
existing suite: (1) disconnect-classified failure → liveness awaited →
reconnect → exactly one deleteProfile → `rolled-back`; (2) non-disconnect
pre-finalize failure → immediate single-shot (no liveness wait); (3) liveness
ceiling expiry → `rollback-failed`; (4) post-liveness delete rejection →
`rollback-failed`, no second call (send-count pin); (5) post-finalize failure
→ no rollback machinery at all. client.test.ts characterization pin:
sent-call rejects on disconnect, never resent. **Scope boundary (fable
fresh-audit, stated not fixed)**: the composable's two INNER deleteProfile
legs (useFullBackupImport.ts:438 duplicate-branch, :570 duplicate-retry) are
NOT liveness-gated — they run mid-restore with a live worker; a kill landing
exactly there retains today's behavior + torn backstop. Ledgered. Un-skip
scenario A. Evidence:
solo retry=0 proverless run of BOTH files — A green end-to-end (rolled-back
→ strict clean retry → convergence), control + B green.
GATE: `bun run --cwd packages/extension-messaging test` + extension unit
suite (`bun run test`) + `bun run typecheck:all` + `bun run lint` + the solo
two-file run + PR checks green.

**Phase 4 / PR-4 `docs` — close-out.**
flake-ledger: close BUG-FENCE + BUG-TRANSPORT entries (PR links + evidence);
reshape the importFullBackup-300s OPEN pair (:349,:351-369 — restoreStage
observability SHIPPED in PR-1; record what remains of the staged-deadline
design, if anything); drop this test from the broken-primitive entry
(:394-399; frozen-account-canary stage 5 remains); NEW OPEN entry:
consoleErrors CDP blind spot (+ fixture warning comment). e2e-testing skill:
dated `## Deflake-round-4 lessons` section (kill-primitive truth, rendezvous
pattern, repeat-switch misdetection, fence lesson). index.md status update.
GATE: `bun run lint` + `bun run typecheck:all` + PR checks green.

## Delivery

Multi-arc: 4 stacked PRs via `gh stack` (extension v0.1.0 installed; repo
precedent fee-estimation-speedup/lessons/phase-0.md). PR-1 targets dev.
Submit drafts early (`gh stack submit --draft --auto`); `gh stack sync` after
trunk moves or lower-arc fixes; conventional-commit titles ≤93 chars. Merge
bottom-up only after the Post-implementation section converges; per the
active /goal, merging each green+approved PR and `gh stack merge` at the top
(entire stack + certification green) is authorized.

## Post-implementation (self-contained)

1. `/code-review max --fix` on the full stack diff (`git diff dev...HEAD` at
   stack top); skim; commit fixes separately on the arc branch they belong to
   (`gh stack down`/`up`); `gh stack sync`.
2. Codex post-impl audit (`/codex xhigh`, NEW session): net diff from the
   plan baseline + code-review commit summary + this file + decision ledger +
   adversarial/security ask + verbatim: "Report bugs and small, targeted
   improvements only. Do not propose speculative abstractions, extra
   configuration surface, new layers, or rewrites — the smallest change that
   fixes each real problem. If code works and is clear, leave it alone."
3. Iterative fix loop: verify claims against the repo → apply accepted fixes
   → commit → RESUME the same codex session with the fix diff → repeat until
   no new material findings (>3 rounds = surface and stop).
4. Certification at stack top, frozen tree (POST-COLLISION command set —
   the control's role passed to upstream's matrix test, ledger row 14):
   3× consecutive solo `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run
   e2e:agent tests/e2e/network/backup-restore-sw-restart.test.ts
   tests/e2e/network/profile-reimport-matrix.test.ts` — attempt-1 green,
   zero retries, zero exit-86; then ONE prover-ON pass (`NULO_E2E_RETRY=0
   bun run e2e:agent tests/e2e/network/profile-reimport-matrix.test.ts`) —
   the matrix IS the goal's prover-ON leg: the crash file's rendezvous is
   proverless-only by construction (statically tree-shaken; the runner
   refuses it prover-ON via the marker), so the matrix carries the prover-ON
   coverage of the shipped fixes.
5. Mark PRs ready bottom-up; merge per authority; owner report (shipped /
   consults / decisions / open items).

## Security & Adversarial Considerations

- **The fence is the D4 resurrection control.** Post-fix invariants, each
  pinned by a unit test: an erased-incarnation capture NEVER EXECUTES —
  same-gen replays rejected marker-less; inverse-stale captures (generations
  are unordered — deleted(G2) + delayed G1 op) DO receive the marker but die
  at the authority step (durable row gone or different generation → no
  provisioning; capture-conditional equality guard refuses); `deleting`
  fenced; live-mismatch fenced. A stale capture EXECUTING is the release
  blocker — the marker itself is not a security boundary.
- **The marker is an authority REQUEST, not proof of succession** — recovery
  requires the SW provider: fresh durable-row read under the facade lock,
  HKDF from the master secret, post-derive generation re-read
  (runtime.ts:214-229). The capture-conditional equality guard stops a
  doomed op from side-effect-installing a newer key. Web content cannot
  reach offscreen RPCs (F-09 trusted-sender gate).
- **Rollback fails closed**: no generic RPC replay (the gap call never
  reached a worker; the post-liveness call is a first send, exactly once);
  ceiling → `rollback-failed` → the existing torn-marker + RestoreTornError
  machinery stays authoritative (unchanged for the browser-dies-mid-catch
  window).
- **Untouched**: account-address freeze, deletion epochs, chain purge
  epochs, storage schemas, wire protocol, dApp error envelope
  (RPC_DISCONNECTED stays transient/retry-safe).
- Supply chain: no new dependencies.

## Assumptions

**Facts** (verified; anchors in recon-fixes.md): fence one-sided
(service.ts:797-807; deleted(gen) retained forever :705-710); provision
matrix correct (:725-756); client retry once-only, stamp-once capture
(pxe/client.ts:124-168; client-capture.test.ts:63-79); store key
crypto-erased inside the clear's try block (:686 — a dispose throw before it
leaves the map at `deleting`, which fences anyway); SW is nulo:liveness's ONLY writer, written
after full wiring (runtime.ts:302-322); provider double-read
(runtime.ts:214-229); provisioning fully lazy (zero proactive call sites);
deletion delegate wired inside services.start() (coordinator last-phase);
fast-rejection constituency documented (recon B); profile client is
composable-local (useFullBackupImport.ts:345); branch = 22 commits over dev
at plan freeze (recon's 17 + plan-doc commits), clean.

**Inferences** (each validated by a named gate): SW respawn + liveness write
lands within seconds while a page churns (B's 20s green runs) — validated by
PR-3's evidence run; post-both-fixes the designed retry AND the control
re-import are clean — validated by PR-2/PR-3 evidence runs (a persisting
summary = new finding, surface); `chrome.storage.session.onChanged` fires in
the popup for SW writes (session storage is trusted-context shared — the e2e
restore gate already relies on popup-side session storage) — validated by
background-liveness unit test + PR-3 evidence run.

**Asks**: none unresolved. (Merge authority granted by the active /goal.
No user-visible contract changes: both fixes restore designed behavior; torn
machinery unchanged. Fable's ask about 60s-timeout-instead-of-fast-fail is
moot — transport untouched.)

## Decision ledger

| # | Decision | Chosen | Rejected (why) | Source |
|---|---|---|---|---|
| 1 | Transport fork | Liveness-gated single-shot rollback (causal signal, exactly-once, caller-level) | (i) fable's Ready-handshake transport rework — architecturally complete but reworks the wire every surface depends on, +1 RTT on first call, protocol change, large blast radius vs ONE proven victim; LEDGERED as the follow-up transport-hardening design with fable's full mechanics (MessageType.Ready, sent-flag, arm-before-ready, F-09-gated ack, backoff, harness, AND the `chrome.runtime.lastError` read in onDisconnect that silences the per-respawn unchecked-lastError console churn — which the chosen fix deliberately does not touch). (iii-main) bounded retry loop — the banned bound-as-fix shape; codex+fable both rejected. (ii) boot-time auto-delete — user-visible contract change + destructive-on-boot; its machinery already exists as the torn-marker backstop. Fable's contradiction-check re-attacked and CONCEDED this row (no failure mode justifies pulling the rework forward) | codex primary; fable challenge recorded + conceded |
| 2 | Fence signal | Direct-throw WITH marker at the fence | Fall-through to ensure()'s natural miss (main+recon) — fewer lines but the signal depends on the sibling invariant that clear erased the key; determinism wins 2-1 | codex+fable |
| 3 | Client equality guard | Adopt (provision.generation === captured) | Omit-as-redundant (main/recon: stamp-once + live-mismatch already reject the raced op) — true, but the guard also stops side-effect provisioning from a doomed op's error path; cheap defense-in-depth | codex+fable |
| 4 | SW-side eager provisioning | None | Rejected by all three: lazy provisioning is the designed channel; eagerness = second mechanism to keep correct | unanimous |
| 5 | Control terminal post-fix | Strict (no summary) | fable's keep-tolerant (evidence capture) — tolerance was diagnostic-era; post-fix a summary is a finding | codex |
| 6 | Boot race (delegate not ready) | Covered by design (liveness ⇒ wired) | fable's awaitInitialized wait in deleteProfile — correct under (i), unnecessary under the chosen design; note kept for the transport-hardening follow-up | main |
| 7 | consoleErrors blind spot | Ledger + fixture comment | Fixing CDP capture this arc — own infra arc | unanimous |
| 8 | Skip mechanism | `test.skip` + `// SKIP —` block, dual citation (lessons + ledger) | fable's skipIf — repo convention reserves skipIf for environment booleans | recon D |
| 9 | Control file placement | Own file (`pxe-fence-reimport.test.ts`), prover-capable; crash file marked proverless-required | Keeping the control in the crash file (original shape) — made the goal's prover-ON leg structurally impossible and left prover-ON invocations hanging at the held-wait | codex contradiction round |
| 10 | Stack-top full local suite | Per-PR CI (network-e2e-status shards + quality-status units) + the 2-file cert campaign + prover-ON control run | codex's local `bun run test:all` + full local network-suite run at stack top — duplicates what CI enforces per PR at 30-45 min for marginal signal; objection RECORDED (codex rates the substitution moderate) | main; codex objection ledgered |
| 11 | Provision-authority race (pre-existing HIGH #1 residual) | CLOSED in PR-2: readiness-await → provider re-read → abort-on-change → send; pin 10 | Leaving it ledgered-only — rejected: the plan's own "stale capture never executes" release invariant cannot coexist with a known open path to it | codex double-audit (critical) |
| 12 | Liveness util shape | Concurrent event (`StorageArea.onChange` + re-read) AND 1s value-poll; first strictly-later value wins | Probe-then-choose (fable contradiction round) — environment-dependent code shape; probe step dropped | codex double-audit |
| 13 | Fence mechanism (SUPERSEDES row 2) | Adopt dev's shipped fall-through fence verbatim (user-validated + own regression e2e) | Overturning a just-shipped fix for the audited direct-throw variant — churn; the determinism objection (signal depends on the erased-key sibling invariant) recorded as theoretical | upstream collision; codex agree |
| 14 | Control e2e | DROPPED for upstream's `profile-reimport-matrix` (same-offscreen tombstone-collision matrix, read+write op health) + a generation-change assertion folded there; matrix = the certification prover-ON leg | Keeping a duplicate control (balance-freshness variant) — parked as optional coverage | codex collision consult |
| 15 | PR-3 rollback call shape (REFINES row 1) | Liveness gate composes with upstream B-24: disconnect-classified → await advance → `rollbackCreatedProfile` (bounded retries against a LIVE worker); ceiling skips the helper → rollback-failed; both error shapes classified | Replacing B-24's helper with exactly-once (relitigates shipped+audited behavior); B-24's retries target live-worker failures, a different class than the respawn gap | codex collision consult |

**Double-audit outcomes**: fable (fresh context) — **conditional approve**;
all three conditions folded: (1) crash-on-retry clearProfileState edge →
pin 6b + follow-up ledger; (2) inner-rollback-leg scope boundary stated in
PR-3; (3) stale commit-count Fact corrected. Low observations adopted:
clock-step-back comment in the util. codex — **reject**, all findings
FOLDED: Critical provision-authority race → readiness-then-re-read closure
in Decision 2 + pin 10 (ledger row 11); High control-split incompleteness →
PR-1 file map/helper extraction/no-false-skip assert + two-file gates in
PR-1/PR-2/PR-3; Medium capture-guard snapshot → post-stamp `args[0]`
comparison + auto-stamped pin; assumption fixes (baseline wording,
crypto-erase nuance, neutral fence message); Phase-3 util fork resolved to
CONCURRENT event+poll via `StorageArea.onChange` (probe step dropped —
supersedes fable's probe-then-choose, which fable listed as fine-to-keep;
recorded here as the final shape). Codex re-review of the folds: see
audit-codex.md (iterate-until-approve).

**Contradiction-check outcomes** (both rounds complete): fable —
no-contradictions (3 folds applied: heartbeat self-heal doc, onChanged probe
step, lastError note in row 1). codex — 2 HIGH folded (inverse-stale marker
pin + security rewording; capture-conditional equality guard), 1 HIGH folded
(prover-ON impossibility → control file split, row 9), 1 MODERATE not
adopted (reopen Ready-handshake — every enumerated failure mode fails CLOSED
to the torn backstop, and fable's independent enumeration of the same modes
conceded the deferral; recorded in row 1), 1 MODERATE ledgered (row 10).

## Seeds

The arc runs under the ALREADY-ACTIVE /goal (set 2026-08-18, full text in the
session transcript; SUCCESS(1)-(7) = this plan's gates + certification). No
new seed needed; a fresh session resumes via `agent-worktree resume
deflake-round-4` and re-reads this plan + the goal.

ELI5 companion: published as a Claude Artifact (source: `eli5.html` in this
directory) — https://claude.ai/code/artifact/27bcd142-ce4e-42af-aea9-2254515aabb7
