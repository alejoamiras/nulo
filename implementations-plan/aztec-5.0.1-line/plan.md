# aztec-5.0.1-line — plan (v3 — mega-PR restructure + double-audit round folded)

Deep-tier blueprint. Legs archived (`leg-main.md`, `leg-codex.md`, `leg-fable-summary.md`);
contradiction round folded in v2; double audit folded here (`audit-codex-r1.md` reject → all
critical/high addressed; `audit-fable-r1.md` conditional-approve → all findings addressed).
Final fresh-context codex pass pends; then the approval gate.

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
P0  pin + baseline        (~half day)   P4  standards + FPC identity + Noir   (~1 day)
P1  client 5.0.1 bump     (~half day)   P5  deploy-tooling hardening          (~1 day)
P2  lock/emit redesign    (~1-2 days)   P6  live redeploy + promotion         (~half day live)
P3  fence + #281 items    (~1-2 days)   P7  delivery: gates, audits, merge    (~1 day)
                                        R   release + public acceptance       (~half day)
```

---

### P0 — Reproduce + pin (pre-fix code; before ANY dep movement)
Local repro of the node-free smoke (`backup-roundtrip.test.ts`) with the SW/offscreen console
tap; targeted network pair under the proverless double-opt-in (`VITE_NULO_E2E_PROVERLESS` build
flag + runtime flag) for fast loops. Deliver a dep-light `*.composition.test.ts` pin (shallow
PXE, bb-free per COMPOSITION-TESTS.md) that drives restore → finalize → an active-profile
listener requiring the missing-key→provision→retry round-trip — **must FAIL on the pre-fix code**
for the localized mechanism (facade-lock re-entry). Write the proven chain to
`lessons/phase-p0.md`.
**Gate**: repro observed red; pin red for the same mechanism. No repro → STOP and re-aim.

### P1 — Client 5.0.1 bump (identity-preserving; deployment untouched)
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
- Re-confirm P0's pin still fails for the SAME mechanism post-bump (causal chain preserved).
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
artifacts still 5.0.0-compiled — the live deployment is untouched by this phase); P0 pin still
red; smokes that don't touch the restore path green.

### P2 — Emits after lock release (the deadlock-class fix)
Design per v2 (D2 resolved: typed transition results; SessionManager `onChange` removed; facade
emits post-release UNIFORMLY across all ops incl. TTL/`applyTtlChange`; ordering contract
**state → release → emit** only — listeners re-enter as normal waiters). Store-key provider →
lock-free `peekProfileSecretForStoreKey` (single-shot; mutators-under-lock invariant documented;
fail-closed undefined). Eager provisioning on session open with the LIVENESS fast-path (no-op
when offscreen holds the current `{generation, key}`; WRITE barrier only on rotation).
Lock hardening: ticketed ownership on BOTH `Lock` and `ReadWriteGuard`; force-release
**diagnostic-only on both** (never mutates ownership; a >5-min hold logs loudly).
**Gate**: P0 pin GREEN; profile unit+integration suites; the v2 test list (listener re-entry
completes; finalizeRestore+listener; open/close/open ordering; silent restore; delete-listener
observations; pre-commit error emits nothing); rw-guard/Lock suites (no negative counts;
late-finally no-op; writer-after-release exactly-once).

### P3 — Deletion fence + remaining #281
Per v2 with the audit folds:
- **Persisted ≥128-bit (Web-Crypto) `pxeGeneration`** on Profile rows + tombstone carry; requests
  capture under the facade lock and carry in transient NetworkInfo; retry REUSES the capture. SW
  numeric deletion-epoch fence for leaf services PRESERVED (incarnation is the offscreen fence).
- Offscreen lifecycle `unseen → live(gen) → deleting(gen) → deleted(gen)`; ops verify inside the
  barrier; provision under the WRITE barrier rejects `deleting` AND `deleted` (audit: was
  unspecified); **provision-on-`unseen` consults the DURABLE tombstone rows directly via a
  chrome.storage read from the offscreen** (no ProfileService RPC — respects the lock order) and
  rejects tombstoned ids/generations — closing the stale-provision-after-offscreen-restart
  resurrection window (both audits). `clearProfileState` marks `deleting` synchronously; failure
  retains state+barrier; same-gen retry idempotent; late old-gen clear can never erase a live
  successor; barriers/guards never deleted.
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

### P4 — Identity generation: standards swap + fee-payment 5.0.1 + Noir
- Standards swap: **trust STOP-gate first** (audit-hardened): npm provenance attestation whose
  subject binds `AztecProtocol/aztec-standards` @ the `v5.0.1` peeled commit — **absent
  attestation = STOP and surface to the user** (conditional Ask); reverse anchor: the repo's
  `package.json` at the tag must declare the `@aztec-foundation/aztec-standards` name; layout
  diff vs the old package; NO install scripts; tag peel recorded (later movement fails the
  build). Scope legitimacy itself is covered by the user's explicit instruction to adopt this
  package + the technical binding above. Then: swap the 5 package.json + ~22 import sites +
  `renovate.json`; excludes updated; zero-`@alejoamiras/aztec-standards` sweep (archived
  reference/ untouched); suggest `npm deprecate` to the user (their auth).
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

### P5 — Deploy-tooling hardening (before any live use)
Per v2/audits: strict-zod intent; signer re-validation REQUIRED (absent key = fail); exact-file
operational allowlist; **network-identity pinning** (audit): the intent build compares
node-claimed L1 addresses against the COMMITTED previous-arc values (no-reset ⇒ must be
byte-equal; mismatch = STOP) in addition to code-presence corroboration; second Aztec endpoint
attempted via `INTENT_SECOND_AZTEC_RPC`, single-node posture documented if absent (per the 5.0.0
arc's accepted pattern — conditional Ask ONLY if the posture itself changes); FPC digest
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

### P6 — Live redeploy (intent-gated, candidate-first)
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

### P7 — Delivery (single squash-merge of #282)
Docs: UPDATE.md (line 5.0.1; new couplings: compat map, refuse-and-preserve stamp, incarnation
fence, transition-result emits); aztec-update skill (bump-first rationale, drift-triggered
worked example, @aztec-foundation verification procedure, portal preflight, reuse-token mode);
index.md; stale-5.0.0-ref sweep (live refs only). Full gates: `audit:vue` + `audit:faucet` +
`test:all` + lint + builds + `test:e2e` + `e2e:agent` (incl. the three restore tests + a full
REAL prove on the accelerator path). `/code-review max --fix` (separate commits) → codex
post-impl audit (gpt-5.6-sol xhigh; targeted: lock/emit redesign, incarnation fence, FPC compat
map + source binding, promote path, reuse-token mode, trust gates) → high/critical addressed.
PR #282 body rewritten for the full arc (`Closes #281`); labels `e2e:network`+`e2e:smoke`; all
three aggregators green on the head → squash-merge → dev CI green. Min-age-exclude removal
follow-up filed (~07-23).
**Gate**: merged; dev green.

### R — Release (standing authorization)
R1 promote PR (merge-commit) → R2 release PR merge; `AUTO_UNSTICK_ENABLED` on; publish chain
watched; assets verified. **Staged-rollout flip** (audit + runbook due): add `verify-live` to the
`status` aggregator in `release.yml` as part of this arc (v0.24.0 was its clean observation
release); the draft-release-until-green redesign is filed as a follow-up, not done in-arc.
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
**Inferences** (verified at their gates): deadlock mechanism (P0 proves); PXE_DATA_SCHEMA_VERSION
locatable (P1); accelerator 5.0.0-server compat if no new binary (P1/P7 full-prove e2e verifies,
not just preflight); reuse-token mode feasible against the live L1 set (P5 unit + P6 preflight).
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
