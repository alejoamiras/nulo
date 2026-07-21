# Codex audits — account-artifact-freeze (mid tier: r1 + final fresh-context pass)

Both sessions: gpt-5.6-sol @ xhigh, read-only sandbox, repo cwd at `dev` @ `cff0ba2`.

---

## Round 1 — fresh session, on draft v1 (session `019f80c5-efd9-7723-9cb1-d90db2285e05`)

### Verdict

`reject (with blocking findings: the rotation model is self-contradictory, old-artifact
compatibility is unproved, and the mismatch state is underspecified)`

### Response (verbatim)

#### (1) Adversarial/security

- A non-empty `ROTATION_ACK` is ceremonial: an attacker can update artifact, constants, vectors,
  and prose coherently. The real controls are immutable history, CODEOWNERS/review, and
  provenance. Make V5 manifests append-only; rotation adds V6 rather than editing V5. Editing the
  tuple contradicts "V6 is never an in-place upgrade."
- Vendoring the raw compiler JSON does not fully freeze its runtime meaning: current
  `loadContractArtifact`, class-id hashing, ABI encoding, and instance hashing still interpret
  it. Pin both raw provenance and the canonical loaded-artifact/class preimage.
- `@aztec/accounts` still feeds addresses through `deriveSecretKeyFromSigningKey`; Outline B also
  retains constructor construction, and both retain upstream Schnorr witness behavior. The "npm
  no longer feeds address derivation at all" claim is false.
- A green address KAT says nothing about executability. New entrypoint payloads, signature-limb
  encoding, simulator semantics, proving system/VKs, constructor handling, or node verification
  can reject the frozen bytecode while preserving the old address.
- "Funds are safe" and "seed still recovers" are too categorical. Recovery also requires an
  authentic V5 implementation and protocol compatibility. The UI must never solicit the seed,
  link to an import site, recommend deletion, or leak internal details to dApps.

#### (2) Assumption attack

**Facts**

- F1 omits the second upstream constructor-args read in `nulo-account.ts:206`. Phase 2 must
  replace both paths with one shared value.
- `getImmutablesHash()` currently merely inherits `undefined`, which stdlib converts to
  `Fr.ZERO`; there is no substantial immutable-construction algorithm to copy.
- F2's provenance documentation is inconsistent: the KAT comments and reference-project
  description say 5.0.0, while its pins, tarball digests, and vectors say 5.0.1. Fix this before
  treating it as authoritative.
- F3–F5 and F7 are substantially correct. F6 is only a superficial precedent:
  `IMPORT_BLOCKING_ACK` acknowledges migration versions, not consensus identity rotation.

**Inferences**

- I1 is unsafe: "node never re-derives the address" does not establish that current
  PXE/simulator/prover/node accepts old circuits and entrypoint semantics.
- I2 understates B's risk; a constructor-helper change defeats the goal even without a protocol
  reset.
- I3 needs measurement. Importing `SchnorrAccountContract` may retain the npm artifact too,
  producing duplicate bundle/startup cost.

**Asks**

- Define what "new V6 extension" operationally means: separate extension ID/store listing,
  coexistence, backup import, persisted regime, and recovery availability.
- Decide the mandatory response to compatibility failure: hold the Aztec bump or ship V6.
- Choose and document artifact provenance: npm integrity, upstream commit/tag, extraction
  procedure, and ideally reproducible build evidence.

#### (3) Outline A vs B

Choose revised A. The current frozen inputs are just constructor name, `[publicKey.x,
publicKey.y]`, and zero immutables. Implement one small local instantiation descriptor and reuse
its exact args for both address derivation and first-tx constructor execution. Do not create a
50-line shadow account class. B is tripwire-only and is not acceptable for the stated production
guarantee.

#### (4) Phases/gates

- Replace `bun run test` with `bun run test:all` or the aztec-runtime suite: the extension runner
  explicitly excludes `derivation-vectors.test.ts`; `audit:vue` therefore also misses the KAT.
- Add a required per-Aztec-bump network compatibility canary: frozen V5 stored address, current
  libraries/node, first-account initialization, simulation, real proof and node acceptance,
  subsequent transaction/auth witness, and restart/recovery.
- Phase 4 must cover RPC subclass reconstruction plus every consumer path. Mismatch can arise
  during fee estimation, send, dApp execution, and views; one component test does not prove a
  handled state. Prefer a centralized blocking state with sanitized dApp errors.
- Gate Chrome and Firefox builds and measure bundle duplication.

#### Looks fine

Vendoring, raw digest plus class-id plus KAT defense-in-depth, no automatic deletion, explicit
policy documentation, and build/smoke validation are all sound directions.

---

## Final fresh-context pass — new session, on consolidated v2 + decision ledger
(session `019f80d0-a7d2-7510-a2ab-c598da06f87d`)

### Verdict

`conditional approve (with conditions: add a dedicated execution canary, define atomic
integrity-state ownership and regime persistence, harden append-only enforcement, and correct the
gates)`

### Response (verbatim)

1. Phase 4 is still partly resolved in name only. `tx-sendTx-multicall` stops after entering
   proving; `authwit-variants` accepts either `ok` or `error`. Only `transfers` and
   `tx-sendTx-default` currently exercise real proof submission, and none explicitly establishes
   "initialization nullifier absent → frozen ctor executed → simulate → real prove → node
   acceptance → restart/recovery." Add a dedicated frozen-account canary with those assertions,
   including an authwit-consuming transaction. Run it prover-on for every Aztec bump. The CI path
   filter correctly includes Aztec-runtime source, manifests, and `bun.lock`.
2. Phase 5 needs an ownership/lifecycle design. Unlock currently opens the session before popup
   bootstrap, while `AccountService` depends on `ProfileService`; simply calling account
   integrity from unlock creates layering/cycle problems and a potential dApp execution window.
   Use a background-owned integrity coordinator/delegate that checks every stored account across
   networks before session activation, persists the blocking state across service-worker
   restarts, closes/withholds the session on failure, and sanitizes all dApp paths. The check is
   deterministic and PXE-independent, so transient PXE state should not cause false positives.
   Full-backup import must check only after account restoration and before `finalizeRestore`.
3. Regime rotation is underspecified. `REGIMES` omits the descriptor identity, although
   constructor name/arguments/salt/deployer/immutables are address inputs. Include a descriptor
   version/digest. Hardcoding only `nulo-v5` does not make later entries append-only;
   independently pin every historical entry and validate unique IDs, valid active pointer, and
   ACK-to-digest binding.
4. Moving `ACTIVE_REGIME` makes existing stored accounts ambiguous unless each account/backup
   records its regime. Either make each extension major compile-time single-regime and forbid an
   in-place pointer move, or persist `regimeId` and reconstruct old accounts through their
   recorded regime. A1 must define whether V5 backup accounts are preserved under V5 derivation
   or rebuilt from seed as V6 accounts.
5. The descriptor-consistency test should cover more than argument equality: both paths must use
   the descriptor's constructor name and all fixed fields, and the emitted constructor
   `FunctionCall` selector/arguments should correspond to the same initialization hash used for
   address derivation.
6. Gate contradictions remain: root `bun run typecheck` checks the extension, not all
   workspaces—use `typecheck:all`. Phase 7 requires Firefox but its command omits
   `build:firefox`. Also confirm required CODEOWNER review is enabled; the current default
   CODEOWNER already covers every file, so adding same-owner paths alone adds no enforcement.

Resolved properly: raw-artifact vendoring plus digest/class-ID/KAT tripwires; the dual-site
shared descriptor; separation of address drift from execution compatibility; typed, sanitized
mismatch handling without deletion or seed solicitation; and the corrected `test:all`/network-E2E
framing.

---

## Post-audit verification + disposition (by the drafting agent)

Checkable claims verified in-tree before adoption: the KAT's absence from root `test`/`audit:vue`
(root `test` is extension-only; the KAT rides `test:all`); the regime-b 5.0.0-prose/5.0.1-pins
drift; `typecheck:all` + `build:firefox` script names; raw `SchnorrAccount.json` in
`@aztec/accounts/artifacts/`; upstream ctor-args/immutables dist code. Disposition of every
finding is recorded in plan.md's Decision ledger; all r1 blocking findings and all six final-pass
conditions are folded into v3 (append-only one-regime-per-major record, dedicated Phase 4 canary,
background integrity coordinator, hardened consistency test, corrected gates).

---

## POST-IMPLEMENTATION audit (fresh codex session, gpt-5.6-sol xhigh, 2026-07-20)

Scope: the full net diff `6181c0d..HEAD` (9 commits) + lessons, after all 7 phases, the
code-review pass, and green gates. Verdict: **block** — 5 HIGH + 3 MEDIUM. Full response
preserved verbatim in this session's transcript; findings + dispositions:

- **[HIGH 1] Barrier bricks its own heal path** (overlay hides unlock; foreign-backup record
  bricks the whole wallet). → FIXED: the barrier is now profile-scoped (a record only overlays
  the profile the popup presents; corrupt records stay global fail-closed) and YIELDS on the
  auth/register routes so unlock — the verification retry vector — stays reachable; copy now
  says to unlock after installing a compatible build. Combined with HIGH-2's boot verify, a
  fixed build heals automatically. Barrier tests rewritten for the scoping semantics.
- **[HIGH 2] Silent SW rehydrate bypasses verification on the first boot of a drifted build.**
  → FIXED: `AccountIntegrityCoordinator.start()` re-verifies a rehydrated session ONCE per
  (profile, walletVersion) via a durable verified-stamp
  (`nulo:core:account-integrity-verified@<id>`); green stamps, mismatch persists the block +
  closes the session. Steady-state SW wakes stay free. 3 new coordinator tests.
- **[HIGH 3] Password-change re-open: a mismatch left the OLD session live.** → FIXED:
  `openSessionVerified` now closes a still-active session for the profile when verification
  throws. Pinned indirectly by the chokepoint tests (the close path is the same
  sessionManager.close the SW-restart test observes).
- **[HIGH 4] Runtime blocking wasn't durable (fire-and-forget before throw).** → FIXED: the
  mismatch report in `AccountService.getAccountContract` is now AWAITED before the typed error
  propagates (failures logged, never masking the error).
- **[HIGH 5] The canary wasn't in the prover-ON CI job** (PR CI could green it with fake
  proofs). → FIXED: `frozen-account-canary.test.ts` added to `network-e2e-canary`'s
  `test_files` and excluded from the proverless shard pool (`pr-network-e2e.yml`); actionlint
  green.
- **[MEDIUM 1] verify→open TOCTOU** (a row restored between snapshot and open escapes pre-open
  verification). → ACCEPTED RESIDUAL: narrow race; caught by the runtime typed-error path and
  the next unlock/boot verify. Documented here.
- **[MEDIUM 2] Canary SW-restart leg could false-green** (absent-target pass-through + a stale
  liveness stamp don't prove the worker actually restarted). → ACCEPTED RESIDUAL: the
  post-restart unlock + real proven tx require a functioning SW either way; the leg proves
  "operational after the kill attempt", which is the invariant the plan needs. Documented.
- **[MEDIUM 3] Descriptor digest binds the symbolic args claim, not the marshalling code.**
  → ACCEPTED RESIDUAL (explicit plan design: "values, not algorithms"); the
  descriptor-consistency test binds the EMITTED call's selector+args to the derived
  initializationHash for the KAT seeds, and the canary executes the real marshalling per bump.

Codex "verified sound" list: vendored bytes/provenance; lazy-wrapper safety (no
`getContractArtifact()` reachable); both frozen touchpoints; `unwrapParams` fix + bound;
fixture intent preserved (duplicate-rejection, migration); error reconstruction, dApp
sanitization, pending-secret zeroization, deletion-time cleanup.

Post-fix gates: lint 0 · typecheck:all 0 · test:all 0 · armed smoke re-run (see transcript) ·
actionlint 0.

### Post-fix validation addendum

The frozen-account canary was re-run at FINAL HEAD (all audit fixes in): **exit 0, 2/2 passed,
three fresh native `/prove` requests** (grant, consume, post-restart tx). Two extra findings from
the re-validation arc, both fixed:
- The boot verification was initially awaited inside `services.start()` — re-deriving with a cold
  bb WASM in the SW stalls ALL service RPCs past the popup's boot budget. It is now
  fire-and-forget (`bootVerification` promise observable for tests); the verdict still lands
  mid-flight (durable record + session close), keeping the exposed window bounded.
- The canary's post-restart assertion "presented account address === A" over-pinned UI behavior;
  which account the popup presents after a restart is UX, not a freeze invariant. It now asserts
  membership in the frozen-derived pair; the post-restart tx as A remains the re-derivation proof.
Environmental note for posterity: three intervening canary failures were traced to tmpfs
exhaustion (12 GB of leftover `/tmp/nulo-aztec-*` sandbox dirs starving RAM — verified
code-independent by a pre-audit-commit checkout failing identically); lesson routed to the
e2e-testing skill.

---

## SECOND post-impl audit pass (two fresh codex xhigh sessions, 2026-07-20)

Requested after implementation to de-risk a nervous merge. Two lenses, run independently.

### Session B — freeze / tests / CI / docs (verdict: low-to-moderate, no CRITICAL/HIGH)

Confirmed sound: lazy npm artifact unreachable from production account/PXE wiring; vendored-JSON
checkout + class-id hashing deterministic; `as const satisfies` type-sound; the canary's
pre-state/nullifier/mined sequence genuinely proves initialization execution; shard-exclusion ↔
canary-inclusion ↔ path-filter ↔ timeout budget all align; fixture changes preserve intent.
Findings + dispositions:
- **[MEDIUM] `V5_REGIME` is a paper binding** — the factory imports the frozen artifact/descriptor
  directly; the regime object only supplies labels. → FIXED (test-level binding): a new pin in
  `address-freeze.test.ts` asserts the live-derived account's class id + descriptor digest equal
  the `V5_REGIME` entry, converting the paper binding into a tested one without the larger
  "regime-as-factory" refactor (out of plan scope).
- **[MEDIUM] UPDATE.md self-contradiction** — old coupling-point 3 said "re-derive the account
  fixture" + `bun run test` (excludes the KAT), contradicting the new never-repin freeze rule.
  → FIXED: point 3 now excludes the frozen Nulo account artifact/addresses and points at
  `test:all`.
- **[LOW] native-prover command doesn't require the accelerator** — → FIXED: the skill/UPDATE
  steps now say to start accelerator-server + assert a `/prove` request (WASM fallback would
  otherwise masquerade as native validation).
- **[LOW] phase-5 lessons stale** (said fire-and-forget / no-reverify) — → FIXED to describe the
  awaited interactive check + bounded rehydration verify.

### Session A — runtime correctness of the coordinator/services (verdict: do not merge until the 2 HIGH + stamp race fixed)

RPC transport confirmed sound after enumerating 131 background methods + PXE + bridge dispatcher:
every real mid-hole call benefits, no load-bearing arity/default/zod/prototype/DoS regression.
Session zeroization, pending-secret consumption, TTL-lock direction sound; the export
`console.error` additions don't alter control flow or leak secrets. Findings + dispositions:
- **[HIGH] Startup fail-open window** — services accept RPCs from construction (`background/service.ts:34`
  attaches `onConnect` in the ctor) but the coordinator injects its delegate in a later phase; an
  unlock or a runtime mismatch in that window optional-chained to a no-op. → FIXED fail-closed:
  AccountService now writes the DURABLE block via its OWN repo (delegate-independent) on a runtime
  mismatch; `openSessionVerified` refuses the open when the delegate is absent AND a durable block
  exists. (A never-before-seen drift in the window is still caught by the immediately-following
  boot verify; the version-keyed stamp means a drift can't already carry a green stamp.)
- **[HIGH] Barrier substring pre-auth detection** — `#/popup/general?return=/popup/auth` suppressed
  the barrier. → FIXED: exact route-PATH comparison (strip `#`, split on `?`/`#`).
- **[MEDIUM] Stamp bound only to walletVersion, not the account set** — a row added after the green
  stamp could be skip-verified on a same-build boot. → FIXED: the coordinator clears the profile's
  stamp on every `onAccountAdded`/`onAccountDeleted`.
- **[MEDIUM] Mismatch closed whichever profile is active, not the mismatching one** — → FIXED:
  `lockProfileIfActive(profileId)` (isActive-guarded close under the facade lock) replaces
  `lockActiveProfile()`; the record's/verified profile id is passed through.
- **[MEDIUM] Slow verify inside the facade lock could exceed the 5-min force-release → open a
  deleted profile** — → FIXED (targeted): `openSessionVerified` re-checks `deletionState.isReserved`
  AFTER the verify, right before `sessionManager.open`. The wallet-core Lock's force-release +
  cross-holder-release is a PRE-EXISTING property left untouched (a redesign is out of scope; the
  verify is PXE-free and bounded by account count, so >5min is not reachable in practice).
- **[MEDIUM] Barrier fail-open on missing `lastActiveProfile`** — → FIXED: fail-closed — a block
  with an unresolved presented-profile identity shows the barrier.
- **[MEDIUM] Barrier `refresh()` out-of-order commit** — → FIXED: monotonic generation guard.
- **[MEDIUM] Profile mutation commits/emits before verify** — ANALYZED, no code change:
  create/import have ZERO accounts at open time (the default account is created later by the UI
  bootstrap), so `verifyBeforeSessionOpen` is vacuously green and cannot fail there; changePassword's
  verify runs over existing accounts but an address-drift block is orthogonal to the password change
  (which legitimately succeeded), so withholding the session is the correct handled state.
- **[LOW] Resume path cleared the tombstone but not block/stamp** — → FIXED: `resumePendingDeletions`
  now clears both idempotently, matching the live `deleteProfile` phase-1 block.

Post-fix gates: lint 0 · typecheck:all 0 · test:all 0 (incl. new coordinator/barrier/integration
tests for every fix) · armed smoke + canary re-run below.

### Convergence: iterative codex verify-loop (session A resumed, rounds 3–5, 2026-07-21)

At the maintainer's request ("keep auditing and fixing until stable"), the runtime-audit session
was resumed to VERIFY each round of fixes and re-attack them (fresh fixes are where regressions
hide). Trajectory:

- **Round 3 verify**: the round-2 fixes were 4 CORRECT / 4 CORRECT-BUT-INCOMPLETE / 1 REGRESSED.
  Fixed (commit `00d4da7`): the verified-stamp is now keyed by a STORAGE-DERIVED
  `accountSetDigest` (dropping the event-driven clear and its race gaps); the runtime mismatch
  closes the session DIRECTLY via `profileService.lockProfileIfActive` (the
  `AccountRuntimeIntegrityDelegate` is removed) + extracted `raiseRuntimeMismatch` with a unit
  test; `openSessionVerified` brackets the open with a post-open deletion re-check; the barrier
  reads the PRESENTED profile from the app store + `route.name` (fixing the stale-lastActive
  fail-open and the trailing-slash lockout); changePassword verifies before persist; the
  descriptor-binding test asserts live instance fields.
- **Round 4 verify**: 4 RESOLVED / 2 STILL-INCOMPLETE / 1 LOW. Fixed (commit `f8a2ffd`): the
  deletion bracket now uses the PERSISTENT deletion epoch (catches a delete that
  reserve→purge→released entirely during a force-released open); changePassword reports the
  password change as committed when only the RE-open hits an integrity block; the fail-closed test
  now genuinely fails the block persist.
- **Round 5 verify**: 3 RESOLVED / 1 NEW HIGH (self-introduced): the changePassword PRE-check threw
  on drift but left the active session open. Fixed (commit `62822c4`): the pre-check closes the
  matching active session before rethrowing.
- **Round 5 re-verify: RESOLVED, "No new defects found", "STABLE to merge to dev."**

Each round ran full `lint`/`typecheck:all`/`test:all` green with new tests for every fix. The
freeze artifact/descriptor/derivation + proving path were untouched by rounds 3–5 (all changes are
in the coordinator/barrier/session-open/changePassword surfaces); the frozen-account canary stayed
green with native proving across the arc. Total post-impl audit rounds: 1 (first codex block, 5
HIGH) + this verify-loop (5 rounds) = the coordinator/session surface was adversarially
re-attacked until an independent pass found nothing actionable.

### Fable dual-audit pass (2 parallel Fable subagents, fresh context, 2026-07-21)

The prior audit trail was codex-only (half of the blueprint's dual-audit protocol). Ran two
fresh-context Fable bug-hunters — one on runtime/concurrency, one on freeze/transport/tests — with
instructions to find NEW bugs, not re-confirm codex's.

**Freeze/transport/tests agent: no CRITICAL/HIGH/MEDIUM** (independently corroborates codex B).
Verified sound: `unwrapParams` DoS bound + gap-tolerance across the whole RPC surface; vendored-JSON
byte-determinism cross-OS (`.gitattributes` `eol=lf`, no CRLF/BOM); `accountSetDigest` injectivity;
canary as a real gate; fixture-intent preserved (duplicate-address rejection fires before the
integrity check). Actioned LOWs: (a) inline note that the KAT — not the descriptor digest — is the
real constructor-arg-marshalling pin (the digest is symbolic); (b) a mechanical CI test pinning the
proverless-exclusions == dedicated-jobs partition, so the mandatory canary can't silently fall out
of both pools. Accepted: canary Stage-5 SW-busy degradation (pre-existing pattern; the final tx
still fails-closed via getAccountContract).

**Runtime/concurrency agent: found a real MEDIUM that codex + 5 verify rounds MISSED** —
- **[MEDIUM] Orphan integrity-block for a deleted profile.** The two OFF-LOCK block writers
  (coordinator boot re-verify; `AccountService.raiseRuntimeMismatch`) could race `deleteProfile`'s
  under-lock block-CLEAR: a delete during the unlocked re-derivation is followed by the mismatch's
  block write → an unclearable record for a gone profile (permanent storage leak), which the
  barrier's `presentedProfileId===null → block` default surfaces as a spurious "verification
  failed" flash in the delete-and-reimport recovery flow. FIXED: both off-lock writes route through
  `ProfileService.persistIntegrityBlockIfLive` — a locked write that SKIPS if the profile is
  gone/reserved (deleteProfile's clear runs under the same lock, so the write lands-then-cleared or
  is skipped). The pre-open path (already under the lock) still writes directly. New tests:
  coordinator "no orphan if deleted during verify", integration "persistIntegrityBlockIfLive skips
  a deleted profile".
- **[LOW] boot-verify skipped the session close if the block persist threw** → folded into the fix:
  `verifyProfile` now try/catches the persist and ALWAYS throws the typed error, so the caller's
  close-on-mismatch runs regardless (mirrors raiseRuntimeMismatch).
- **[LOW dev-only] a "unknown" (no `__VERSION__`) stamp matched itself** → the boot skip now
  requires `walletVersion() !== "unknown"`, so dev builds always re-verify.
- Accepted (agent-flagged, not demanded): the pre-open verify runs under the facade lock (bounded;
  moving it out would REINTRODUCE the orphan race the agent found — explicitly not done); the
  transient master-secret `Fr` copy in `verifyBeforeSessionOpen` isn't zeroized (consistent with
  the codebase's existing unzeroized session `Fr`).

Gates after the fixes: lint/typecheck:all/test:all/ci-gating all 0.
