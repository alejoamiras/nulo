# aztec-5.0.1-line — plan (v5 — APPROVED; P0 done, P2 re-aimed 2026-07-17)

> **P0 COMPLETE ✓ — P2 re-aimed, user re-approved 2026-07-17.** P0 disproved the plan's hypothesized
> lock/emit deadlock: the restore-boot bug is the IMPORT PAGE wedging when the MV3 worker restarts
> mid-bootstrap; the wallet + encrypted store are FINE (close+reopen the popup lands on
> `/popup/general` cleanly — verified, `lessons/phase-p0.md`). **P2 is now import-page recovery +
> realistic-recovery e2e** (the emit-after-release lock redesign is dropped → Appendix P2-OLD; its
> ticketed-guard/force-release-diagnostic piece survives independently in P3/#281-D11). P1, P3, and
> P4–R are unchanged. Ledger D26. Executing.


Deep-tier blueprint. Legs archived (`leg-main.md`, `leg-codex.md`, `leg-fable-summary.md`);
contradiction round folded in v2; double audit folded here (`audit-codex-r1.md` reject → all
critical/high addressed; `audit-fable-r1.md` conditional-approve → all findings addressed).
Final fresh-context codex pass: **conditional-approve** (`audit-codex-final.md`) — all six
conditions folded in this v4. **APPROVED by the user 2026-07-17** — standing authorization active through the release; three conditional asks stop the run if hit.

## Summary

ONE mega-PR (#282 grows — user decision 2026-07-17, superseding the earlier two-PR choice) followed
by the release: **bump-first** client migration to `@aztec/*` 5.0.1 + accelerator, then the
restore-boot-deadlock fix + full #281 on the 5.0.1 substrate, then the identity generation
(standards → `@aztec-foundation/aztec-standards@5.0.1`, fee-payment 5.0.1 ⇒ canonical PrivateFPC
moves, Noir recompile) with the drift-triggered candidate-first testnet redeploy, all landing as a
single squash into dev — then dev→main promote + stable extension release + faucet publish +
public-surface acceptance, under STANDING authorization.

Why bump-first (user + evidence): 5.0.1 fixed the exact store-lifecycle area #281 hardens
(browser SQLite handle-release #24647; partition semantics; `SqliteEncryptionError`); building the
lock/fence work on 5.0.0 would harden around bugs that vanish and be re-validated anyway.

## Locked decisions (user)

Mega-PR (one arc on `worktree-aztec-5.0.0-stable`, PR #282) · bump-first · FPC to 5.0.1 in-arc ·
deep tier · **standing release authorization**.

## Probe base (2026-07-17; volatile items re-probed at every live gate)

Live node 5.0.0 / rollupVersion `1821665230` (NO reset; wallet chainId `1816023401`); 5.0.1
client-only + 5.0.0-network-compatible; packages published 07-15/16 (min-age excludes; removal
~07-23); fee-payment 5.0.1 digest changed ⇒ FPC identity moves; `@aztec-foundation/
aztec-standards@5.0.1` layout matches, repo `AztecProtocol/aztec-standards` tag `v5.0.1`;
5.0.1 `createPXE` keeps `options.store`; bridge Noir unaffected by the note-helper renames;
**NuloTokenPortal is init-once ⇒ must redeploy** (`NuloTokenPortal.sol:49-56`);
**`deploy-bridge-testnet.ts:170` always deploys a new L1 token ⇒ a `reuse-token` mode must be
BUILT** (audit finding, previously assumed).

## Phase map (single PR; each phase gates before the next; sizing is coarse)

```
P0  repro + root-cause ✓  (DONE)        P4  standards + FPC identity + Noir   (~1 day)
P1  client 5.0.1 bump     (~half day)   P5  deploy-tooling hardening          (~1 day)
P2  import-page recovery  (~half-1 day) P6  live redeploy + promotion         (~half day live)
P3  fence + #281 items    (~1-2 days)   P7  delivery: gates, audits, merge    (~1 day)
                                        R   release + public acceptance       (~half day)
```
> **P2 was re-aimed after P0** (2026-07-17): P0 proved there is NO lock/emit deadlock — the restore
> bug is the IMPORT PAGE wedging when the MV3 worker restarts mid-bootstrap (the wallet itself
> recovers on popup reopen; verified `lessons/phase-p0.md`). So P2 shrank from a lock/emit/lifecycle
> redesign to import-page recovery + realistic-recovery e2e. The v3/v4 lock-redesign text is
> preserved as **Appendix P2-OLD** (superseded) for the audit trail.

---

### P0 ✓ — Reproduce + root-cause (DONE 2026-07-17 — `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p0.md`)
Instrumented the node-free smoke (`backup-roundtrip.test.ts`) at the four suspected wedge points +
an SW/offscreen console tap. **Result: the hypothesized lock/emit deadlock DOES NOT EXIST** — the
facade lock never contends; the emit is fire-and-forget for async listeners. The real mechanism
(pinned across three instrumented runs): a routine MV3 **worker restart** ~18 s into the restore
drops the in-memory master; in strict mode (default `true`, no persisted bearer) the encrypted
per-profile PXE store key is unrecoverable without re-unlock, so the PXE fail-closes on every
retry — but this is confined to the **stuck import page**: a verified (reverted) harness experiment
showed **close + reopen the popup lands on `/popup/general` cleanly** (`fresh-hash=#/popup/general`,
`recovery=HOLDS`), so the wallet + encrypted store are fine.
**Gate — MET**: repro observed; mechanism proven (and the plan's premise disproven → the STOP rule
fired correctly, re-aiming P2 below). The originally-planned `test.fails` composition pin is
SUPERSEDED by the P2 e2e that models real recovery (the composition layer can't reproduce a
cross-process SW-restart; the e2e is the honest harness). ✓

### P1 — Client 5.0.1 bump (identity-preserving; deployment untouched) ✓
> **✓ CLOSED.** All 20 `@aztec/*` + accelerator → 5.0.1; fee-payment/standards held at 5.0.0 (→ P4);
> Noir patches renamed + applied; biome pinned 2.5.1. The mid-phase KAT STOP (SchnorrAccount class-id
> shift `0x2fcf070c…`→`0x0db53983…`) was **overturned by the user**: 5.0.1 aztec-nr/aztec.js are
> compatible with a 5.0.0 node (the account address is a client-side derivation artifact the node
> never re-derives; pre-production ⇒ no stranded accounts). Regime-B vectors regenerated from the
> 5.0.1 published tarballs via **upstream's own oracle** (the designed update path, not
> self-reference) → KAT 6/6. Store-semantics flipped to refuse-and-preserve (D-B2v3): +5
> fails-on-old-code tests. Gates: typecheck:all 0, test:all 0 (aztec-runtime 62), lint 0,
> verify:deployments green. `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p1.md`.
- `@aztec/*` → exact 5.0.1 (viem independent); `@alejoamiras/aztec-accelerator` → 5.0.1
  (accelerator-server: if a 5.0.1 binary exists in its releases, re-pin the SHA-256 in
  `_network-e2e.yml` from release assets; else the 5.0.0 server + CI required-mode preflight is
  the detector, AND a full local prove via `e2e:agent` — not just the preflight — validates
  compat before P7). **fee-payment and standards do NOT move here** (identity-coupled → P4).
- Noir patches → `@5.0.1` names + `patchedDependencies`; inspect hunks (offset/no-op = STOP).
- `bunfig.toml` excludes: add the 5.0.1 names, dated, removal follow-up ~07-23.
- **Secret-free install** (audit): installs/builds run in a shell WITHOUT the deploy env sourced;
  `.env` is sourced only around explicit broadcast commands in P6.
- Ritual: `rm bun.lock` → `bun install --ignore-scripts` → signature/provenance verification via
  a SCRATCH npm project (`npm i --package-lock-only` over the same specs, then
  `npm audit signatures`; bun repos have no npm lockfile — audit fix) → `bun install` →
  `bun install --frozen-lockfile`; allowlist-diff; zero-old-pin sweeps.
- Re-confirm the restore hang still reproduces the SAME way post-bump (the P0 smoke repro; the
  causal chain must survive the 5.0.1 store-lifecycle changes — if 5.0.1's SQLite handle-release
  fix #24647 ALONE resolves the wedge, note it and P2 shrinks to just the e2e realism fix).
- 5.0.1 store-semantics absorption for OUR injected stores: verify `PXE_DATA_SCHEMA_VERSION`
  (pin/test re-point if moved); adopt `SqliteEncryptionError` (typed wrong-key ≠ corruption ≠
  absence); assert upstream's `OPFS_POOL_DIR_PREFIX` convention leaves our
  `pxe/<profile>/<chainId>` layout + registry untouched (their `listStores/deleteStore` NOT
  adopted); re-evaluate the 30s bounded-open + close-on-abandon workarounds against the
  handle-release fix (KEEP both unless a test proves them redundant).
- **D-B2 FLIPPED (audit round)**: the stamp mirror becomes **refuse-and-preserve** (upstream
  5.0.1 semantics) — on schema/rollup-stamp mismatch the store REFUSES to open (typed error
  surfaces as chain-init failure; pre-production remediation = profile purge), never wipes.
  Two audit facts killed the wipe: the PXE store holds USER state (added senders, registered
  contracts — backups of them are optional, not guaranteed), and the stamp's rollupAddress input
  is NODE-derived (`chain-runtime.ts:150`) so a lying RPC could wipe-loop stores (DoS). Refusal
  is immune to both. The module doc's "verbatim mirror" wording is rewritten accordingly.
- KATs: derivation vectors must stay byte-identical under 5.0.1 (any shift = STOP — protocol
  break, plan wrong). Backup compat-epoch stays 3 with round-trip tests (epoch-3 5.0.0-stamped
  backup imports under 5.0.1; export stamps 3; undecodable slice = STOP, never epoch-mask).
**Gate**: `typecheck:all` + `test:all` + lint green; `verify:deployments` GREEN (committed
artifacts still 5.0.0-compiled — the live deployment is untouched by this phase); the restore hang
still reproduces the SAME way post-bump (or is noted as resolved by 5.0.1 itself); smokes that
don't touch the restore path green. **`LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p1.md`.**

### P2 — Import-page recovery (the ACTUAL restore fix; re-aimed from P0) ✓ CI-GREEN
> **✅✅ DONE — network e2e FULLY GREEN on CI (run 29651144451, head `450ae47`): all 5 shards +
> real-proving canary + heavy jobs, restore trio included.** Two fixes got it there:
> 1. **The restore regression (`c7420f6`)**: under 5.0.1 the exported account-state includes the
>    account's own contract; restoring it pre-finalize called `registerContract` before the PXE
>    store key existed (`PXE_STORE_KEY_MISSING`) → "completed with errors" → no auto-advance.
>    Fixed by moving the account-state restore AFTER `finalizeRestore` opens the session. +1
>    ordering unit test; recovery orchestrator (`completeImportWithRecovery`, +7 tests); the 3
>    restore e2e rewritten to settle→recover.
> 2. **The suite-wide importToken failure (`450ae47`, diagnosed under P4)**: the 5.0.1 standards
>    artifact crate-prefixes AztecAddress struct paths; exact-path descriptor predicates resolved
>    zero candidates for 6/9 kinds → `isComplete: false` → silent popup error → no "Token added"
>    toast → every tokenReady-fixture test red. Fixed with `matchesStructPath` suffix tolerance +
>    a real-artifact pin test. (The long-blamed `Address already in use` line is BENIGN node
>    boot noise — the Q-06/07 "infra flake" taxonomy was a misread; see phase-p4 lessons.)
> typecheck:all 0, extension units 3129+36, lint 0, smoke-e2e ✓, network-e2e ✓.
> `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p2.md`.

<!-- superseded banner retained below for the diagnosis trail -->
### (diagnosis trail) P2 — earlier BLOCKED banner
> **◑ import-page recovery CODE done + unit-green; but the restore e2e is RED on CI — a real 5.0.1
> regression, NOT environmental (earlier "SW-eviction, CI-green" call CORRECTED).** New pure
> `completeImportWithRecovery` orchestrator (+7 unit tests); both import pages wired; the three restore
> e2e rewritten to settle→recover + a `reopenAndRecoverAfterImport` store-reopen assertion. Local
> gates green (typecheck:all 0, composable units 57, lint 0, build). **CI (PR #282) verdict:
> quality-status GREEN; smoke-e2e + network-e2e RED — `backup-roundtrip` + `backup-migration-roundtrip`
> fail because under 5.0.1 the exported account-state includes the account's own contract, and restore
> calls `registerContract` for it BEFORE `finalizeRestore` provisions the PXE store key →
> `PXE_STORE_KEY_MISSING` → "completed with errors" → no auto-advance.** dev (5.0.0) is green; the
> pristine P1 tree already fails it → the regression is P1 (the bump), surfaced by P2's honest
> assertions. The `tokens.test.ts` frame-detach + `Address already in use` network failures are
> documented flakes (Q-06/Q-07) that clear on re-run. **FIX REQUIRED (was mis-filed as a P3
> robustness item): provision the store key before account-state restore, or defer contract
> registration to post-finalize / next-unlock — delicate (restore ordering + session lifecycle;
> user-data path).** Not ✓ until that fix lands + the restore trio is green on CI.
> `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p2.md`.

The bug (P0-proven): the full-backup import page silently wedges when the MV3 service worker
restarts mid-bootstrap, because `completeImport` (`import.vue`) awaits `waitForProfileActive` on a
now-dead SW connection and neither completes nor routes anywhere for 30 s+. The wallet itself is
fine (reopen recovers). Fix the PAGE, not the lock/session/store subsystems.

1. **Detect the stuck/dead-SW state and recover in-page or route promptly.** `completeImport` must
   not present a silent 30 s+ "Finishing…" screen: on a bootstrap timeout OR a detectable SW
   disconnect, either (a) transparently re-derive state (re-open the popup connection / re-read the
   session so a still-valid session bootstraps to `/popup/general`), or (b) route to `/popup/auth`
   with a clear "reopen or unlock to finish" message. No dead-end wait. Tighten the timeout so the
   user reaches an actionable screen in seconds, not after 30 s.
2. **Make re-entry land on `/popup/general` with a live PXE.** After the recovery (reopen and/or
   unlock), the bootstrap must provision the store key and boot the chain runtime (the existing
   missing-key retry already does this once the session is active — confirm end-to-end, don't
   assume). If the profile is genuinely locked (strict + worker restart), the unlock path is the
   recovery and must re-provision + boot.
3. **Fix the three restore e2e to model reality.** `backup-roundtrip` (smoke) +
   `backup-restore-integrity` + `backup-migration-roundtrip` (network) currently assert a straight
   path to `/popup/general` with NO reopen — which the SW restart breaks. Update them to drive the
   realistic recovery (reopen and/or unlock) and then assert `/popup/general` + one PXE-dependent
   read (proving the store actually re-opened, not just the route). Keep them as the honest harness
   for this bug (the P0 composition pin is dropped — a cross-process SW restart is not reproducible
   at the shallow-PXE composition layer).
Out of scope for P2 (do NOT do here): the emit-after-release lock redesign (no deadlock exists —
Appendix P2-OLD), the `pxeGeneration` fence (that's P3/#281), and any change to the strict-mode
default or the F-11 bearer policy (surfaced as a separate follow-up — see Assumptions).
**Gate**: the three restore e2e GREEN under the realistic-recovery assertions (smoke via
`test:e2e`, network via `e2e:agent`); `test:all` + lint green; a manual reopen/unlock of a
restore-time-wedged profile reaches `/popup/general` with a working PXE read; no dead 30 s+ wait
remains on the import path. **`LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p2.md`.**

### P3 — Deletion fence + remaining #281 ✓ GATE GREEN
> **✅✅ DONE (5 commits: `08caf1f` D11, `58642ab` D7, `91dde16` D3, `8f82ed2` D4, `4956259`+`528e76d`
> P3.e).** All of #281 closed: D11 (35-min drain ceiling + skew-proof token-set readers), D7 (sweep
> removed; orphan removal whole-profile under positive absence), D3 (peekMatching/ensure split,
> rebind only under chain WRITE, no upgrade, bounded ×3), D4 (persisted 128-bit `pxeGeneration` on
> Profile rows + tombstone carry + facade-locked send-time derivation + op capture with retry-reuse
> + offscreen unseen→live→deleting→deleted lifecycle; provision/clear atomicity via
> run-to-completion instead of the write barrier — documented deviation, avoids stalling
> re-provision behind a 30-min prove). P3.e: deletion-wait UX (10s-delayed ~30-min hint) + the
> fold's SW-restart-mid-restore e2e (kill between profile-row-appears and success-nav; recovery
> reaches the synced 1,000 balance — mid-restore path exercised, no degenerate fallback).
> **Gate output**: matrix green (fence 8/8, capture 3/3, rw-guard 16/16, opfs 12/12, registries
> 21+15); `test:all` exit 0; the three previously-red e2e GREEN locally (smoke backup-roundtrip
> 1/1; network backup pair 4/4 via `e2e:agent`) + network-e2e CI green ×2 on the batch; lint green
> on CI (local worktree biome skew documented in lessons — pre-existing at HEAD).
> `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p3.md`.
> **NEW (from P2, 5.0.1 arc):** account-state `registerContract` runs DURING restore, BEFORE
> `finalizeRestore` opens the session + provisions the PXE store key — it leans on the
> `PXE_STORE_KEY_MISSING` provider→retry-once to provision from the available master. If the SW
> restarts mid-restore (production-plausible for MV3), that retry can't provision → contract
> registrations are silently lost from the restored profile (balances won't sync until re-registered).
> Fold into the store-key-provisioning/incarnation-fence work: either (a) provision the store key
> BEFORE the account-state restore step, or (b) make the retry survive a mid-restore SW restart, or
> (c) re-register-on-next-unlock. Add a test that restarts the SW mid-restore and asserts contracts
> survive. (Root-cause evidence + repro in `lessons/phase-p2.md`.)

Per v2 with the audit folds:
- **Persisted ≥128-bit (Web-Crypto) `pxeGeneration`** on Profile rows + tombstone carry; requests
  capture under the facade lock and carry in transient NetworkInfo; retry REUSES the capture. SW
  numeric deletion-epoch fence for leaf services PRESERVED (incarnation is the offscreen fence).
- Offscreen lifecycle `unseen → live(gen) → deleting(gen) → deleted(gen)`; ops verify inside the
  barrier; provision under the WRITE barrier rejects `deleting` AND `deleted`. **Restart fence
  (final-pass correction — the offscreen has NO chrome.storage access, `offscreen/index.ts:102`,
  so the v3 direct-tombstone-read mechanism was impossible)**: the fence is SW-AUTHORITATIVE —
  `provisionChainStoreKey`'s generation is derived FRESH under the facade lock at SEND time
  (never reused from an older capture; only request-path OP fencing reuses captures), and the SW
  validates row-exists + not-reserved + gen-is-current immediately before sending. Offscreen-side,
  provision installs only from `unseen` or same-gen `live`. Cross-restart stale DELIVERY is
  transport-impossible (the port and its queue die with the offscreen document) — asserted by a
  test rather than assumed; same-id re-import is fenced by the fresh random generation (no
  tombstone dependency — tombstones clear after successful purge, `service.ts:731`). Test matrix
  adds: successful purge → offscreen restart → stale-shaped provision replay is rejected.
  `clearProfileState` marks `deleting` synchronously; failure retains state+barrier; same-gen
  retry idempotent; late old-gen clear can never erase a live successor; barriers/guards never
  deleted.
- D3 rebind under chain WRITE (peek/create split; no read→write upgrade; bounded retry);
  dispose propagates stop/close failures (AggregateError; poisoned entries; allSettled profile
  dispose); D7 sweep removed (profile dirs only via profile purge + positive absence check);
  opfsRoot absence = missing API or NotFound ONLY, all else propagates.
- **Deletion-wait UX** (audit): the deletion flow surfaces a visible "waiting for an in-flight
  operation (can take up to ~30 min during proving)" state — a wedged-looking silent wait is not
  acceptable even pre-production.
**Gate**: full v2+audit test matrix (incl. stale-first-after-restart-of-tombstoned-profile) +
`test:all` + lint; the three previously-red e2e GREEN locally (smoke backup-roundtrip; network
backup pair via `e2e:agent`).

### P4 — Identity generation: standards swap + fee-payment 5.0.1 + Noir ✓ GATE GREEN
> **✅✅ DONE.** Standards swap (trust-gate cleared; `@aztec-foundation/aztec-standards@5.0.1`
> across 5 package.json + 33 sites; the descriptor-path fix `450ae47` made it land) — network e2e
> CI green ×2 on it. fee-payment 5.0.1 re-pinned (`0x1a6d21ce`, digest `94fa4c71…`) with **source
> binding PROVEN**: publish tag = `ecosystem-tooling@v5.0.1` (pkg byte-match), canonical json
> identical tarball↔tags↔our descriptor, and a fresh toolchain rebuild's core digest
> (sans file_map) EQUALS the published artifact's. **FPC gate redesigned (`25de2d0`)**:
> digest-keyed human-curated `compatibleNodeVersions` (`94fa4c71… → ["5.0.0","5.0.1"]`), hard
> l1ChainId=11155111 + rollupVersion=1821665230 pins, REQUIRED `--mode predeploy|require-deployed`
> (absence red under require-deployed — mandatory pre-funding/canary/promotion), `rpcOptional`
> for the live node's omitted-result absence encoding. Verified LIVE: predeploy GREEN,
> require-deployed RED (not yet deployed), no-mode RED. **Noir (`616ecc6`)**: aztec-packages tags
> → v5.0.1 ×3 (peeled `b97ff8c3…`), token dep → `AztecProtocol/aztec-standards@v5.0.1` (peeled
> `c74541f7…`, path API-verified), compile.sh → 5.0.1, all three compile clean + path-scrubbed,
> keystone byte-identical + `nargo test` 3/3; class-id table in lessons. **Gate**: tripwire 8/8
> (+ compat coherence pins), bridge-core 136/136, `test:all` rc=0, drift detectors EXPECTED red
> (verify:deployments — the redeploy's evidence, P6). Deploy-script 5-arg arity stays P6-coupled.
> `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p4.md`.
- Standards swap: **trust STOP-gate first** (audit-hardened): npm provenance attestation whose
  subject binds `AztecProtocol/aztec-standards` @ the `v5.0.1` peeled commit — **absent
  attestation = STOP and surface to the user** (conditional Ask); reverse anchor: the repo's
  `package.json` at the tag must declare the `@aztec-foundation/aztec-standards` name; layout
  diff vs the old package; NO install scripts; tag peel recorded (later movement fails the
  build). Scope legitimacy itself is covered by the user's explicit instruction to adopt this
  package + the technical binding above. Then: swap the 5 package.json + ~22 import sites +
  `renovate.json`; excludes updated; zero-`@alejoamiras/aztec-standards` sweep (archived
  reference/ untouched); suggest `npm deprecate` to the user (their auth). **The FULL P1 install
  ritual REPEATS here for the identity deps** (final-pass condition: no dep enters outside the
  ritual): secret-free shell, fresh lock, `--ignore-scripts` first install, scratch-npm
  `npm audit signatures`, integrity-set comparison of the lock delta, allowlist diff. Noir deps
  pinned by TAG + PEELED COMMIT (both recorded; movement fails).
- fee-payment → 5.0.1: recompute digest + canonical address LOCALLY; descriptor +
  `PRIVATE_FPC_ADDRESS` + tripwire re-pinned in ONE commit; salt-construction sweep. **Source
  binding** (audit): diff the published 5.0.1 tarball against the fee-payment source repo at its
  matching tag before adopting (it is our own fork — the diff is the review); the committed
  descriptor pins the digest OUTSIDE the package thereafter. Fund-moving scripts keep their
  internal address+class asserts (rebuild-and-compare before any deposit — verified present in
  fuel-testnet/canaries; extend where missing).
- FPC gate redesign per v2: digest-keyed compat map; human-curated `compatibleNodeVersions`
  `["5.0.0","5.0.1"]`; hard `l1ChainId`+`rollupVersion` pins; live original AND current class
  check; `--mode predeploy|require-deployed`; require-deployed is mandatory before ANY
  funding/canary/promotion, and the deploy script's already-exists path validates classes too.
- Noir: tags → `v5.0.1` ×3; token dep → `AztecProtocol/aztec-standards` @ `v5.0.1` (path
  verified at the tag via API before edit); `aztec-up install 5.0.1`; compile.sh → 5.0.1;
  recompile + commit (no abs paths); portal-fork pins re-verified by test. Record the old/new
  class-id + address table in lessons.
**Gate**: trust gates green (or STOPPED on the conditional Ask); FPC gate green in `predeploy`
vs the live node; tripwire green on the new pin; compile clean + keystone `nargo test`;
`test:all` green; drift detectors now EXPECTED red (verify:deployments + instance re-derive) —
recorded as the redeploy's evidence; anything else red = STOP.

### P5 — Deploy-tooling hardening (before any live use) ✓ GATE GREEN
> **✅ DONE (4 commits).** `c3062d7` intent identity pinning: build compares every node-claimed L1
> address + l1ChainId/rollupVersion against the COMMITTED 5.0.0-arc intent (byte-equal or STOP) on
> top of the existing eth_getCode corroboration; second-endpoint DISAGREEMENT was already an
> unconditional STOP and absence the documented capped-risk posture. `561a16a` faucet
> candidate-first: 5-arg token deploys (auth_contract=ZERO), records carry `authContract`, deploy
> writes `deployments.candidate.json` by default; record-parameterized rebuilds power
> `verify-deployments --config` + `drip-canary --config`; pre-5.0.1 records fail targeted.
> `be438b1` `live-intent.ts promote`: verify → symlink-reject → read-once validated buffers →
> zero-seed assertion (l1.fuel byte-carried) → temp+rename → re-hash → strict re-parse + real
> verify-deployments re-proof → receipt; never git-commits (no partially-promoted COMMITTED
> state); allowlist gains the faucet candidate + 5.0.1 lessons dir. `5db0076` `--reuse-token`
> (readback-verified AZLO; malformed flag hard-stops) + portal-init preflight (live `l2Bridge()`
> must be ZERO — portal reuse forbidden). **Gate**: +14 unit tests over the new modes/promote
> (bridge-core 148/148, faucet 428/428), `test:all` rc=0; lint green on CI (worktree biome skew
> documented in p3 lessons). `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p5.md`.
Per v2/audits: strict-zod intent; signer re-validation REQUIRED (absent key = fail); exact-file
operational allowlist; **network-identity pinning** (audit): the intent build compares
node-claimed L1 addresses against the COMMITTED previous-arc values (no-reset ⇒ must be
byte-equal; mismatch = STOP) in addition to code-presence corroboration; second Aztec endpoint
attempted via `INTENT_SECOND_AZTEC_RPC`; **endpoint DISAGREEMENT = unconditional STOP** (never
an ask); ABSENCE of a second endpoint = the intent-documented capped-risk acceptance (the 5.0.0
arc's accepted posture, exposure bounded by the caps) — final-pass flip of the v3 ask polarity; FPC digest
re-check at every verify; Dripper/Token digests + expected L2 class-ids pinned; candidate
addresses re-derived (self-consistency ≠ authentication).
**`reuse-token` mode built + unit-tested** in `deploy-bridge-testnet.ts` (existing AZLO supplied
+ readback-verified; NEW NuloTokenPortal deployed + initialized once against the new L2 bridge;
preflight reads live `l2Bridge()` and forbids portal reuse on mismatch).
**Faucet candidate-first**: `deployments.candidate.json` + `--config` on `verify-deployments` +
`drip-canary-testnet.ts` (currently hard-coded to the live path).
**`promote` subcommand** with the audit's real invariant (read candidates ONCE into validated
buffers; reject symlinks; temp-write + rename; re-hash both outputs; emit a committed promotion
receipt; verify → write → re-verify → commit; a crash mid-promote leaves no partially-promoted
COMMITTED state). Zero-seed assertion (any WETH seed or fuel/router deploy = hard fail).
**Gate**: unit coverage over the new modes + promote path; `test:all` + lint.

### P6 — Live redeploy (intent-gated, candidate-first) ✓ DONE — PROMOTED LIVE
> **✅✅ EXECUTED LIVE (user-driven, 2026-07-18).** Full intent-gated candidate-first redeploy to
> the live Sepolia v5 testnet. **PrivateFPC 5.0.1 deployed at the pinned `0x1a6d21ce`** (class
> `0x032bc73c`, sponsored, address-verified; the old 5.0.0 `0x257aa870` confirmed ABSENT on-chain).
> Bridge candidate via `--reuse-token` (AZLO readback-verified; NuloTokenPortal `0x6d614378`;
> 8 L1 readbacks + Etherscan-verified; the `l2Bridge()==ZERO` portal-init preflight passed). Faucet
> candidate: Dripper `0x064399d4`, NULO `0x0262b24b`, OLUN `0x14e0a251` (5-arg). **`verify` green
> before every broadcast group; the completed 5.0.0 journal was archived for a clean generation.**
> **Six canaries GREEN**: verify-l1, candidate smoke (deposit→claim), fueled smoke (swap→self-pay),
> **PrivateFPC settle (private `pay_fee` SETTLED through `0x1a6d21ce`, fee 1.85/2.8 FJ)**, direct-FJ,
> drip. **`promote` (receipted)**: candidate digests bound (bridge `910421`, faucet `52a2c870`),
> require-deployed gate + faucet-derivation re-proven, zero-seed confirmed, atomic flip. **Post-
> promotion**: `verify:deployments` GREEN on live (the CI Build Faucet gate now passes), live drip
> ✅, **caps reconciliation 0.0032/0.5 ETH**. Committed `30963e0`. 5.0.1 artifacts against the
> compatible live 5.0.0 node (per the compat map + owner ruling). `LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p6.md`.

Scope: REUSE protocol FeeJuicePortal, AZLO L1, fuel/router/swap/pools; REDEPLOY app
NuloTokenPortal + L2 Proxy/Token/Bridge (via `reuse-token` mode) + faucet Dripper/NULO/OLUN
(candidate file) + PrivateFPC at the 5.0.1 identity. Order: intent `build` (committed before
first broadcast; pins signer/caps/digests/zero-seed/L1-address-equality) → per-group `verify` →
FPC predeploy-gate → FPC deploy → require-deployed gate → bridge candidate → faucet candidate →
candidate proofs: `verify-l1 --config` · candidate smoke · fueled smoke · settle canary
(`PRIVATE_RUNS=1`, new FPC; minFuelFj raise-only) · direct-FJ canary · drip canary (candidate
config) → `promote` (dual-digest, receipt) → post-promotion: `verify:deployments` GREEN ·
require-deployed gate · drip · spend reconciliation within caps (≤0.5 ETH; expected ≪0.1 — L1
mostly reused). Fix-forward; never promote over a partial landing; mid-arc rollupVersion move =
hard stop. Every command in the execution ledger form (cwd + env-prefix + exact args + expected
output + exit gate) — written into `lessons/phase-p6.md` as run.
**Gate**: all proofs + promotion + reconciliation green.

### P7 ✓ — Delivery DONE 2026-07-18 (#282 squash-merged as `f9f28cf`; dev green)
Docs: UPDATE.md (line 5.0.1; new couplings: compat map, refuse-and-preserve stamp, incarnation
fence, transition-result emits); aztec-update skill (bump-first rationale, drift-triggered
worked example, @aztec-foundation verification procedure, portal preflight, reuse-token mode);
index.md; stale-5.0.0-ref sweep (live refs only). Full gates: `audit:vue` + `audit:faucet` +
`test:all` + lint + builds + `test:e2e` + `e2e:agent` (incl. the three restore tests + a full
REAL prove on the accelerator path). `/code-review max --fix` (separate commits) → codex
post-impl audit (gpt-5.6-sol xhigh; targeted: lock/emit redesign, incarnation fence, FPC compat
map + source binding, promote path, reuse-token mode, trust gates) → high/critical addressed.
**Post-live source-mutation stop rule** (final-pass condition): after the P6 intent is built,
every subsequent commit (review fixes included) classifies its files — deploy-affecting
(bridge-core src/scripts, contracts/, faucet deploy surface, canary scripts) vs client-only/docs.
A deploy-affecting change invalidates the intent → new intent revision + re-run of the impacted
P6 proofs before merge; client-only changes re-run the standard suites only. The classification
is recorded per-commit in lessons.
PR #282 body rewritten for the full arc (`Closes #281`); labels `e2e:network`+`e2e:smoke`; all
three aggregators green on the head → squash-merge → dev CI green. Min-age-exclude removal
follow-up filed (~07-23).
**Gate**: merged; dev green.

### R — Release (standing authorization)
R1 promote PR (merge-commit) → R2 release PR merge; `AUTO_UNSTICK_ENABLED` on; publish chain
watched; assets verified. **Release-gating folds (final-pass, partial adopt)**: (a) `verify-live`
→ required in the `status` aggregator (staged-rollout flip, due); (b) a release.yml pre-flight
asserts the faucet deploy hook secret IS wired (absent hook = early red, not silent fallback);
(c) **rollback defined**: if post-public acceptance fails — re-fire `refresh-landing.yml`
(break-glass) for deploy-staleness; for a genuinely bad build, land a revert PR on main via the
normal promote path (the release tag is never deleted; the landing re-points at the next good
release). The full draft-release-until-green redesign is REJECTED for this arc with reason
(release-pipeline redesign is its own epic; testnet-only blast radius; the three folds above
cover the realistic failure = stale/mismatched deploy) and filed as a follow-up issue.
R3 live acceptance: build-id equality + chainId 1816023401 served + **two PUBLIC-surface flows
with the released artifact** (drip; minimum public Fuel deposit→claim; hashes + FJ delta
recorded) + require-deployed FPC gate + spend reconciliation. R4 back-sync merge-commit;
prerelease manifest re-baselined; signing-backfill reminder.
**Gate**: acceptance green end-to-end.

## Security & Adversarial Considerations
(v2 carried forward, plus the audit folds)
- **FPC/fund loss**: digest-keyed compat map + identity pins + live dual-class check + canary
  authority; artifact SOURCE-bound by tarball-vs-repo diff at bump time + digest pinned in-repo
  thereafter; require-deployed invoked inside every funding path.
- **Network identity**: node claims checked for CODE and for EQUALITY with committed prior-arc
  addresses; second-endpoint attempted; single-node posture documented if unavailable.
- **Supply chain**: provenance-attestation STOP-gate (subject binds repo@peeled-commit; absent =
  surface, conditional Ask) + reverse anchor + no-install-scripts + scratch-npm signature audit +
  secret-free installs + dated excludes + SHA-pinned accelerator binary + patch-hunk review.
- **Lock/fence**: every fix lands with a fails-on-old-code test; ordering contract pinned;
  provision fenced by durable tombstones across offscreen restarts; force-release never mutates
  ownership anywhere; deletion-wait is VISIBLE.
- **Erasure**: refuse-and-preserve replaces wipes (user PXE state exists; lying-RPC wipe-DoS
  closed); purge errors loud; positive absence checks.
- **Promotion**: read-once buffers, symlink rejection, temp+rename, output re-hash, committed
  receipt; no partial committed state.
- **Release**: verify-live becomes required in-arc; public acceptance manual-mandatory; caps
  bound all live spend; `--admin` out of bounds.

## Assumptions
**Facts**: as v2's cited base plus: `deploy-bridge-testnet.ts:170` unconditional token deploy;
drip canary's hard-coded live path; PXE store carries user-added senders/registered contracts;
node-derived stamp input at `chain-runtime.ts:150`; facade-lock non-reentrancy + emit wiring
(all audit-verified against source).
**Inferences** (verified at their gates): restore-boot mechanism = import-page wedge on worker
restart (**P0 PROVED this, replacing the deadlock inference**); PXE_DATA_SCHEMA_VERSION locatable
(P1); accelerator 5.0.0-server compat if no new binary (P1/P7 full-prove e2e verifies, not just
preflight); reuse-token mode feasible against the live L1 set (P5 unit + P6 preflight); the P2
recovery reaches `/popup/general` with a LIVE PXE (P0 confirmed the ROUTE recovers; P2 confirms the
PXE op).
**Follow-up filed (NOT in this arc)**: strict mode defaults to `true` (`config/config.ts:26`), so a
routine MV3 worker restart forces a re-unlock in normal use too. The UX mitigation (a short-lived
strict-compatible recovery bearer that survives a worker cycle within the session TTL) touches the
security-sensitive F-11 bearer policy and deserves its own audited change — filed as an issue at
P7, not folded into P2.
**Asks — none open; three CONDITIONAL asks surface only if hit**: (1) provenance attestation
absent on `@aztec-foundation/aztec-standards@5.0.1`; (2) the single-Aztec-RPC posture becomes
untenable for this arc (a second endpoint exists but disagrees); (3) any probe contradiction
(rollupVersion moves; reuse-token preflight impossible as shaped).

## Decision ledger (v3 deltas on top of v2's ledger)
| # | Decision | Source |
|---|---|---|
| D13 | ONE mega-PR (#282 grows); bump-first inside it | user (2026-07-17; supersedes two-PR + fix-first) |
| D14 | fee-payment + standards move in P4 (identity phase), NOT P1 — P1 keeps verify:deployments green | consolidation (bisectability) |
| D-B2v3 | Stamp mirror = REFUSE-AND-PRESERVE (flip of v2's wipe) | codex #8 (user PXE state exists) + fable #4 (node-derived input = wipe-DoS) — both wipe rationales falsified |
| D15 | Trust gate = provenance-attestation STOP + reverse anchor + conditional Ask | fable #1 + codex #5 |
| D16 | Provision fenced by DURABLE tombstones readable from offscreen; reject in `deleted` | fable #2 + codex #6 |
| D17 | Secret-free installs; signer only around explicit broadcasts | codex #7 |
| D18 | Promote = read-once/symlink-reject/temp-rename/re-hash/receipt (real invariant, not "atomic") | codex #3 + fable #6 |
| D19 | verify-live → required in-arc (staged-rollout flip due); draft-release redesign = follow-up | codex #4 (partial adopt) |
| D20 | Deletion-wait UX surfaced as work | fable #7 |
| D21 | Intent pins L1 addresses against committed prior-arc values; dual-L1-RPC = attempt, not requirement | codex #2 (adopted core) |
| D22 | P0 pin lands `test.fails`, flips at P2 | final-pass #3 |
| D16v4 | Restart fence is SW-authoritative (fresh-gen-at-send + transport-death assertion); offscreen storage read was IMPOSSIBLE | final-pass #1 (corrects v3's D16) |
| D23 | P4 repeats the full install ritual; Noir deps tag+peeled-commit pinned | final-pass #4 |
| D24 | Post-intent source-mutation stop rule (classify → re-intent → re-proof) | final-pass #5 |
| D25 | RPC polarity: disagreement = STOP; absence = intent-documented capped acceptance | final-pass #6 |
| D19v4 | verify-live required + hook-wired preflight + defined rollback; draft-release redesign REJECTED-with-reason for this arc (filed follow-up) | final-pass #2 (partial adopt, documented) |
| D15v4 | If attestation absent: the resolution path is reproducible-build/diff-vs-repo binding (a concrete alternative, not a waiver), user-approved via the conditional ask | final-pass (decision-trail note) |
| **D26** | **P2 RE-AIMED: import-page recovery, NOT the emit-after-release lock redesign** — P0 empirically disproved the deadlock; the wallet recovers on popup reopen (verified). P2-OLD lock text preserved as an appendix; the `pxeGeneration` fence stays in P3. Strict-mode/F-11 bearer = separate filed follow-up. | **P0 result + user go (2026-07-17)** |

---

## Appendix P2-OLD (SUPERSEDED by D26 — kept for the audit trail)
The pre-P0 P2 assumed an emit-under-lock deadlock and prescribed: typed transition results
(SessionManager `onChange` removed; facade emits post-release uniformly; ordering state→release→emit);
a lock-free `peekProfileSecretForStoreKey`; eager provisioning with a liveness fast-path; ticketed
ownership on `Lock` + `ReadWriteGuard` with force-release diagnostic-only. **P0 proved no deadlock
exists**, so none of this ships as the restore fix. NOTE: the ticketed-`ReadWriteGuard` /
force-release-diagnostic-only hardening was ALSO an independent #281 (D11) item — it survives THERE,
in P3, on its own merits (the 5-min force-release vs 30-min proves is real regardless of the restore
bug). Only the emit-after-release + lock-free-peek + eager-provision pieces are dropped.
