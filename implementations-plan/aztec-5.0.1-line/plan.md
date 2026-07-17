# aztec-5.0.1-line — consolidated plan (v2 — contradiction-check folded; in double audit)

Deep-tier blueprint: three independent legs (main / codex gpt-5.6-sol xhigh / fable) consolidated
here; legs archived as `leg-main.md`, `leg-codex.md`, `leg-fable-summary.md`. Ledger at the end.

## Summary

Three deliverables under standing authorization: **(PR-A)** fix the full-backup-restore boot
deadlock + implement issue #281 completely, turning PR #282 green and merging the whole 5.0.0 arc
to dev; **(PR-B)** bump `@aztec/*` + accelerator + fee-payment to 5.0.1, migrate
`@alejoamiras/aztec-standards` → `@aztec-foundation/aztec-standards@5.0.1`, absorb the 5.0.1
storage-semantics churn, re-pin the PrivateFPC on its 5.0.1 identity under a redesigned
compatibility gate, and execute the drift-triggered candidate-first testnet redeploy (protocol
FeeJuicePortal + AZLO + fuel/router/pools stay; app NuloTokenPortal + L2 set + faucet + FPC
redeploy); **(R)** promote dev→main, ship the stable extension release + faucet publish, and prove
the release through the PUBLIC surfaces.

## Locked decisions (Phase 0, user)

Two PRs · FPC bumps to 5.0.1 now · deep tier · **standing release authorization** (execute when
gates are green, no further ask).

## Verified probe base (2026-07-17; re-probed at every live gate)

Live node `nodeVersion 5.0.0`, `rollupVersion 1821665230` (NO reset; wallet chainId stays
`1816023401`); 5.0.1 is client-only and 5.0.0-network-compatible; all 5.0.1 packages published
07-15/16 (min-age excludes required, removal ~07-23); fee-payment 5.0.1 artifact digest changed
(`94fa4c71…` vs pinned `6c0cd8bc…`) ⇒ canonical FPC address moves; `@aztec-foundation/
aztec-standards@5.0.1` layout matches (`artifacts/src/artifacts/*`), repo
`AztecProtocol/aztec-standards` tag `v5.0.1`; 5.0.1 `createPXE` keeps `options.store`; upstream
kv-store adds `listStores/deleteStore/SqliteEncryptionError` and partitions its DEFAULT stores by
identity; our bridge Noir uses none of the renamed note-history helpers; **NuloTokenPortal is
init-once bound to the old L2 Bridge (`NuloTokenPortal.sol:49-56`) ⇒ must redeploy** (codex leg).

---

# PR-A — restore-boot deadlock + issue #281 (on PR #282, branch `worktree-aztec-5.0.0-stable`)

## Lock order (normative; documented in-code at both services)

```
SW:        ProfileService facade Lock → commit state → RELEASE → then emits / offscreen RPC
offscreen: profile barrier → chain guard → runtime registry → SQLite worker / OPFS SAH
```
Hard invariants: no emit, no cross-service call, no offscreen RPC while the facade lock is held;
no store-key derivation from a lock-held path; no read→write upgrade (release read, acquire write,
re-check); chain guard only inside its profile barrier; offscreen never calls back into
ProfileService FROM A GUARD-HELD REQUEST PATH (the deferred-init `sweepOrphanStores`/profile-
reader path is the one sanctioned exception — it runs off the init path, holds no guard, and is
documented at its site); barriers/guards are NEVER deleted while queued ops exist; every profile-scoped PXE
request carries a generation checked INSIDE the barrier (TOCTOU-proof).

### A0 — Reproduce + pin (no fixes yet)
Local repro of the node-free smoke (`backup-roundtrip.test.ts`) with the SW/offscreen console tap;
targeted network pair under the proverless double-opt-in (`VITE_NULO_E2E_PROVERLESS` at build + its runtime flag) for a fast loop. Write the proven wedge chain
to `lessons/phase-a0.md`. Deliver a `*.composition.test.ts` pin (per COMPOSITION-TESTS.md: shallow
PXE, bb-free) that drives restore → finalize → an active-profile listener needing the
missing-key→provision→retry round-trip — **must FAIL on head `03affd2`**.
**Gate**: repro observed; pin red on head for the same mechanism. If the smoke repro does NOT
reproduce locally → STOP, the localization is wrong, re-aim before touching locks.

### A1 — Emits after lock release, by construction
SessionManager's `onChange` callback is REMOVED; session operations return typed transition
results; the ProfileService facade emits AFTER `runExclusive` releases — uniformly across unlock/
lock/create/import/delete/passkey-recovery/restore/finalizeRestore (not just the restore path).
Out-of-band closes (TTL alarm, `applyTtlChange`) flow through the same post-release emit path —
this also retires the documented `sessionTtl` re-entrancy footgun. Silent restore stays silent;
`onProfileDeleted` publishes only after row+session are gone. Ordering contract: **state →
release → emit** ONLY — a listener that re-enters the facade queues as a NORMAL waiter (emission
never awaits or precedes waiter admission; the contradiction-check killed the stronger claim).
D2 is RESOLVED: typed transition results, not a deferred queue.
Store-key provider: replace the locked `getProfileSecret` call with a **lock-free
`peekProfileSecretForStoreKey`** (in-memory session read + reservation check; single-shot; stale
read degrades to undefined → fail-closed retry). Add **eager provisioning**: an SW-local
active-profile subscriber derives + `provisionChainStoreKey` on session open (post-release by
construction; the missing-key retry stays as the offscreen-restart fallback). LIVENESS RULE
(contradiction fix): provisioning FAST-PATHS to a no-op when the offscreen already holds the
current `{generation, key}` — the profile WRITE barrier is taken only on an actual generation
rotation, so a routine unlock can never queue as a writer behind a 30-min prove reader. The eager
path sources its generation from the same facade-locked capture as request-path provisioning.
**Gate**: A0's pin green; profile unit+integration suites green; new tests: listener-calls-
getProfileSecret completes; finalizeRestore+listener completes; open→close→open emits once each in
commit order; silent restore emits nothing; delete listeners observe no session/row; pre-commit
errors emit nothing.

### A2 — Deletion fence (D4) + offscreen lifecycle
**Persisted profile incarnation** (codex shape, fable's fail-closed semantics): a random ≥128-bit
`pxeGeneration` on stored Profile rows (internal; not in ProfileInfo/backups), assigned at
create/import/restore, backfilled for legacy rows at startup, carried into the durable deletion
tombstone (resumed purges send the original generation; a same-id successor ALWAYS differs).
Requests capture the generation under the facade lock and carry it in transient NetworkInfo; the
missing-key retry REUSES the captured generation (never recaptures). SCOPE (contradiction fix):
the incarnation is the OFFSCREEN fence; the existing numeric SW deletion-epoch fence for
leaf-service writes is PRESERVED unchanged — incarnation does not replace it.
Offscreen `PxeService` lifecycle per profile: `unseen → live(gen) → deleting(gen) → deleted(gen)`.
Ops verify `live(requestGen)` INSIDE the profile barrier; `provisionChainStoreKey(profileId, gen,
key)` runs under the profile WRITE barrier (not lock-free): rejects while `deleting`, drains+
disposes old-generation runtimes before rotating, zeroizes replaced keys, installs {gen,key}
atomically. `clearProfileState(profileId, gen)` marks `deleting` synchronously before its first
await; on failure retains `deleting` + the SAME barrier (fail-closed, D6); idempotent on
same-generation retry; a late old-generation clear can never erase a live successor. Barriers/
guards are never deleted from their maps.
**Gate**: the codex-leg test matrix (provision-vs-clear race; queued old-gen op dies typed;
failed purge retains barrier; same-gen retry; same-id successor; late old clear no-op; restart
unseen-accepts-current; key zeroization) + `test:all`.

### A3 — D3 rebind, D7, dispose, opfsRoot, D11
- **D3**: registry splits `peek` (chain read) from create/rebind (chain WRITE). `withPxeRead`:
  read → match → run; else release read, acquire write, re-check, init/rebind, release, retry
  under read (bounded). No dispose ever under read. Init promises keyed so a stale-URL init can't
  be inherited.
- **Dispose**: store close in `finally` after `pxe.stop`; propagate stop/close failures
  (AggregateError if both); registry marks poisoned entries, never deletes before dispose
  succeeds; `disposeProfile` via allSettled retains failures.
- **D7**: empty-profile-dir sweep removed from `removeChainStoreDir`; profile dirs removed only by
  profile-wide purge; post-purge positively confirms absence.
- **opfsRoot/purge errors**: absence = no OPFS API or `NotFoundError` on the `pxe` child ONLY;
  everything else propagates (a purge that can't enumerate is a FAILURE, not success). Tests for
  NotFound/NotAllowed/Unknown/enumeration/removal-failure.
- **D11**: rw-guard gains ticketed reader accounting (negative counts impossible; late finally
  after any release is a no-op); the 5-min force-release becomes **diagnostic-only** (logs reader
  count, never zeroes, never admits writers); writer preference retained; `clearProfileState`
  warns every 60s while waiting on long readers. The facade `Lock` gets the same ticketing AND
  its force-release is ALSO diagnostic-only (contradiction fix: both legs agree ticket
  invalidation still admits an overlapping holder — the exact corruption the security invariant
  forbids; a >5-min facade hold is a loud bug, not something to self-heal into overlap).
**Gate**: rw-guard suite (past-5-min reader + queued writer runs exactly once after release; no
negative counts; cycles stable) + aztec-runtime + extension pxe/profile/coordinator suites.

### A4 — Full validation + land #282
Three previously-red e2e first (smoke backup-roundtrip; network pair), then `audit:vue`,
`test:all`, lint, full `test:e2e` + `e2e:agent`, builds, `git diff --check`. Temp instrumentation
removed (the console tap stays, env-gated). PR body: `Closes #281`, lock order, fence invariants,
evidence. All three aggregators green on the head → squash-merge #282 → verify merge commit is
ancestor of dev.

---

# PR-B — 5.0.1 + standards migration + drift redeploy (fresh worktree `aztec-5.0.1-line` off dev)

### B0 — Worktree + volatile re-probes + supply-chain STOP-gate
`EnterWorktree` name `aztec-5.0.1-line` (native layout; manifest-register). Re-probe node identity
(expect 5.0.0/1821665230 — ANY movement = STOP + re-gate). New-scope gate for `@aztec-foundation`
(STOP on any miss): npm repository == `AztecProtocol/aztec-standards`; tag `v5.0.1` exists,
peeled commit recorded (fails later if the tag moves); `npm view … dist.signatures` +
`npm audit signatures` on a scratch install; tarball layout diff vs the old package (expected
artifact shape, NO install scripts); token-contract Nargo path verified at the tag (do not assume
`src/token_contract`). Deployer env presence (never create). Evidence → `lessons/phase-b0.md`.

### B1 — Pins + lockfile ritual
`@aztec/*` → exact 5.0.1 (viem independent); accelerator → 5.0.1 (check for a 5.0.1
accelerator-server binary; if present, re-pin the SHA-256 in `_network-e2e.yml` from release
assets; if not, the 5.0.0 server runs and CI's required-mode preflight is the compat detector);
fee-payment → 5.0.1; standards swap in the 5 package.json + ~22 TS/script import sites +
`renovate.json` (the archived `reference/regime-b` package is NOT rewritten). Noir patches renamed
to @5.0.1 + `patchedDependencies`; inspect hunks (suspicious offset/no-op = STOP). `bunfig.toml`
excludes: add the 5.0.1 names + `@aztec-foundation/aztec-standards`, drop
`@alejoamiras/aztec-standards`, date + removal follow-up (~07-23). Ritual: `rm bun.lock`,
`bun install --ignore-scripts` → `npm audit signatures` → `bun install` →
`bun install --frozen-lockfile`; allowlist-diff; sweeps assert zero old pins and zero
`@alejoamiras/aztec-standards` anywhere live.
**Gate**: `typecheck:all` + `test:all` + lint green; lock diff clean.

### B2 — 5.0.1 storage semantics + wallet-SDK boundary
**Decision D-B2 (divergent legs; contradiction-checked; decision STANDS with corrected
rationale)**: KEEP the wipe-on-mismatch stamp mirror (fable) rather than upstream 5.0.1's
refuse-and-preserve (codex). The original "finer partition" claim was WRONG (codex): XOR-derived
chainId omits rollupAddress/schema and can in principle collide across identities. Corrected
rationale: (a) the PXE store holds ONLY node-re-derivable chain state — a wipe costs a re-sync,
never data (user-authored data lives in chrome.storage); (b) the stamp DOES check rollupAddress +
schema, so a collision resolves as a wipe+re-sync, not silent corruption; (c) refusal would wedge
boot behind a manual clear — worse than a re-sync for a wallet; (d) our network set is curated
(collision probability negligible). Codex's objection + this trade are recorded in the module doc
(whose now-false "verbatim mirror of upstream" wording is rewritten as part of B2).
Verify `PXE_DATA_SCHEMA_VERSION` in installed 5.0.1 (drift test re-pointed if the constant moved;
pin bumped if the value did). Assert our pool-dir layout is untouched by upstream's new
`OPFS_POOL_DIR_PREFIX` convention (their `listStores/deleteStore` are NOT adopted — they
enumerate upstream's convention, not ours). Map `SqliteEncryptionError` to a typed wrong-key
error (never "corruption", never "absence"). Backup **compat-epoch stays 3** with tests: an
epoch-3 5.0.0-stamped backup imports under 5.0.1; export still stamps 3; account-state round-trip
survives; if a 5.0.1 change makes account-state slices undecodable this decision is FALSE — stop,
don't mask with an epoch bump. Wallet-SDK boundary: schema-patch first-import + apply.test +
dispatcher reachability re-verified.
**Gate**: aztec-runtime + schema-patch + wallet-bridge + bridge-core suites + typecheck:all.

### B3 — Noir surface
Nargo tags → `v5.0.1` (all three); token dep → `AztecProtocol/aztec-standards` tag `v5.0.1` at
the B0-verified path; `aztec-up install 5.0.1`; compile.sh → 5.0.1; recompile + commit targets
(no absolute paths in artifacts; `ulimit -s 65520` raw-nargo fallback for masked errors). Portal
fork: source unchanged ⇒ pins expected to hold — confirmed by the portal-artifact test, not
assumed. Record old/new class-id + address table (Proxy/Token/Bridge/Dripper/faucet tokens/FPC)
in lessons.
**Gate**: compile clean; keystone `nargo test`; `test:all` green; drift detectors now EXPECTED
red (verify:deployments + FPC tripwire) — that red is the redeploy's evidence, not a mergeable
state; anything ELSE red = STOP.

### B4 — FPC 5.0.1 identity + gate redesign + intent-tooling hardening
Recompute the 5.0.1 artifact digest + canonical address LOCALLY (never trust the probe);
descriptor + `PRIVATE_FPC_ADDRESS` + tripwire re-pinned in ONE commit (conscious re-pin; owes the
live re-canary). Salt-construction sweep (`new Fr(0)` near FPC artifacts — the 5.0.0 lesson).
**Gate policy (merged codex+fable)**: a committed compatibility map keyed by the EXACT artifact
digest, whose sole tuple binds installed version 5.0.1 == descriptor, full sha256, derived salt-1
address, live `nodeVersion` ∈ human-curated allowlist `["5.0.0","5.0.1"]` (NO semver rules), and
hard identity pins `l1ChainId 11155111` + `rollupVersion 1821665230`. Rejects: rc variants,
5.0.2, other rollups, other artifacts, descriptor drift, original OR current live-class mismatch.
Two modes: `--mode predeploy` (absence OK, existing must match) and `--mode require-deployed`
(absence RED — mandatory before any funding/canary/promotion).
**Intent tooling hardening** (before live use): strict-zod the intent; signer re-validation
REQUIRED (no PRIVATE_KEY = fail, not skip); narrow the operational allowlist to exact files (the
5.0.0 arc's lessons-dir allowlisting let the intent itself be dirty — fixed last arc for the
digest regime, now narrowed fully); FPC digest re-checked at every verify; Dripper + Token
artifact digests pinned alongside Noir targets; expected L2 class-ids pinned + candidate
addresses re-derived from artifacts/args/salts (self-consistency is not authentication); dual
candidate digests (bridge + faucet); a `promote` subcommand that re-verifies everything and
writes the live manifests atomically (no manual copy); zero-seed assertion (any WETH seed or
fuel/router deploy this arc is a hard failure). **NEW TOOLING REQUIRED (contradiction finding):
`deploy-bridge-testnet.ts` ALWAYS deploys a new L1 token (deploy-bridge-testnet.ts:170) — the
assumed reuse path does not exist. Build + unit-test an intent-pinned `reuse-token` mode
(existing AZLO address supplied + readback-verified; portal redeployed and initialized against
the new L2 bridge) BEFORE any B5 broadcast.** Also: faucet candidate-first support —
`deployments.candidate.json` + `--config` on `verify-deployments` and `drip-canary-testnet.ts`
(which currently hard-codes the live path) so no pre-promotion step can touch or read the live
manifest; `promote` alone replaces BOTH live manifests (D9 RESOLVED to explicit candidate files).
**Gate**: gate script green in `predeploy` vs the live 5.0.0 node; tripwire green on the new pin;
intent unit coverage; `test:all`.

### B5 — Live candidate redeploy (intent-gated, candidate-first)
Scope (settles the codex Ask): REUSE protocol FeeJuicePortal, AZLO L1, fuel/router/swap/pools;
REDEPLOY app NuloTokenPortal (init-once → must bind the NEW L2 bridge; preflight reads live
`l2Bridge()` and forbids reuse on mismatch), L2 Proxy/Token/Bridge, faucet Dripper/NULO/OLUN,
PrivateFPC at the 5.0.1 identity. Order: intent `build` (commit before first broadcast; pins
signer/caps/digests/zero-seed) → per-group `verify` → FPC (predeploy-gate → deploy →
require-deployed-gate) → bridge candidate (`testnet-bridge.candidate.json` only) → faucet deploy
(writes `deployments.candidate.json`; the drip canary + verify-deployments read it via
`--config` — the live manifest is untouched until `promote`) → candidate proofs: `verify-l1 --config` · candidate smoke · fueled smoke ·
`fuel-testnet PRIVATE_RUNS=1` (settle vs the NEW FPC; minFuelFj may only RAISE) · direct-FJ
canary · drip canary → `promote` (dual-digest verify) → post-promotion: `verify:deployments`
green · require-deployed FPC gate · drip · spend reconciliation within caps. Fix-forward
discipline; never promote over a partial landing; a mid-arc rollupVersion move is a hard stop.
**Gate**: all proofs + promotion + reconciliation green.

### B6 — PR-B delivery
Docs: UPDATE.md (line → 5.0.1, new couplings incl. the compat-map + mirror-divergence);
aztec-update skill (drift-triggered-redeploy worked example, FPC compat-map policy, @aztec-
foundation verification procedure, portal-preflight rule); index.md. Stale-5.0.0-ref sweep (live
refs only). Suggest `npm deprecate @alejoamiras/aztec-standards` to the user (their npm auth —
never run it). Full gates (`audit:vue`, `audit:faucet` — verify:deployments green post-promotion —
`test:all`, lint, builds, both e2e suites incl. the three restore tests re-run under 5.0.1). PR
to dev, labels `e2e:network`+`e2e:smoke`, title ≤93 chars; `/code-review max --fix`; codex
post-impl audit (targeted: lock/fence redesign, FPC compat map, intent promote path, portal
preflight); three aggregators green → squash-merge. Min-age-exclude removal follow-up issue filed.

---

# R — Release (standing authorization)

R1 promote `release: promote dev → main (aztec 5.0.1, standards migration, restore-boot fix)` —
merge-commit; main's checks + strict up-to-date. R2 release PR review + merge (merge-commit);
`AUTO_UNSTICK_ENABLED` confirmed on; watch the publish chain; assets = chrome zip + firefox zip +
SHASUMS256. A "refusing to re-point" auto-unstick red is fail-closed — investigate, never force.
R3 live acceptance: `verify-live` + independent `build.json`/`nulo-build` equality + chainId
1816023401 served + **two PUBLIC-surface flows with the released Chrome artifact in a clean
profile: one drip through faucet.nulo.sh, one minimum-amount public Fuel deposit→claim** (record
hashes + FJ delta; headless canaries are NOT a substitute); re-run the FPC require-deployed gate +
spend reconciliation after. Break-glass `refresh-landing.yml` if stale. R4 back-sync PR
**merge-commit** (never squash); confirm release commit in dev's ancestry + prerelease manifest
re-baselined. Post-release: remind about signing backfill for AFK commits.

---

# Security & Adversarial Considerations

- **Fund loss / FPC**: compatibility is an exact committed allowlist keyed by artifact digest +
  derived address + node-version allowlist + l1ChainId/rollupVersion pins + live original AND
  current class match; absence is red before funding; no semver logic anywhere in the gate. A
  lying RPC is mitigated by intent-verify's independent L1 corroboration + the canaries being the
  authoritative proof; the gate alone is never the last line.
- **Deploy-gate bypass**: candidate digests immutable from first verify; promotion only via the
  intent `promote` (no manual copies); fueled smoke mandatory; `verify:deployments` red stays red
  until promotion — evidence, never bypassed; `--admin` out of bounds.
- **Supply chain**: new-scope STOP-gate (repo binding, tag peel recorded, signatures, layout
  diff, no install scripts); `--ignore-scripts` first install + `npm audit signatures`; min-age
  excludes name-specific + dated + follow-up removal; accelerator binary SHA-256-pinned from
  release assets only; patch hunks reviewed (offset/no-op = STOP).
- **Lock redesign (self-inflicted risk)**: every fix lands with a test that fails on the old
  code; deferred emits pin the new ordering contract (state→release→emit) with cross-op tests;
  the lock-free peek documents its single-shot/mutators-under-L1 invariant; generation checks are
  authoritative INSIDE the offscreen barrier (SW-side checks are advisory — TOCTOU); barriers are
  never replaced; force-release never mutates ownership (corruption outranks liveness — a wedged
  deletion is visible and retryable, an overlapped purge is not).
- **Erasure integrity**: purge errors are loud (absence narrowed to NotFound); post-purge
  absence positively confirmed; crypto-erase (key drop) stays first; deletion claims are never
  reported on inference.
- **Backup import stays hostile input**: PR-A touches only the activation/locking seam — the
  trust-gate order (checksum → epoch → version) and provenance filters are untouched (asserted in
  review).
- **Release**: public-surface acceptance uses minimum amounts + throwaway accounts inside the
  intent caps; CI permissions unchanged; no marketplace publishing.

# Assumptions

**Facts** (file-cited or probe-dated; see legs for full line-cites): deadlock chain wiring
(service.ts:119/137-144/1284-1341, session-manager.ts:202-233, base-service.ts:128-132,
chain-runtime.ts:137-139, client.ts:88-108, runtime.ts:202-206, import.vue:65); #281 sites
(service.ts:558-602, chain-runtime.ts:286-289, opfs-store.ts:89-175, rw-guard.ts:132-147);
NuloTokenPortal init-once (NuloTokenPortal.sol:49-56, PortalReinit.t.sol); compat-epoch 3;
schema pin 13 + drift test; current pins/digests; probe base above; command surface (test:all,
audit:vue/faucet, e2e:agent, the script set).
**Inferences** (each verified at its phase gate): the deadlock mechanism (A0 proves before
fixing); deploy-bridge-testnet's reuse path covers portal-redeploy-with-L1-reuse (B5 preflight);
recomputed FPC digest/address (B4); PXE_DATA_SCHEMA_VERSION still 13/greppable (B2); 5.0.0
accelerator-server compatible if no 5.0.1 binary (CI preflight detects); old L2 deployments stay
reachable (backups referencing them import).
**Asks**: none open. Conditional re-gates that surface only if hit: rollupVersion moves mid-arc;
the supply-chain STOP-gate fails; the B5 preflight finds the L1 reuse path impossible as shaped.

# Decision ledger

| # | Decision | Source | Rejected alternative(s) |
|---|---|---|---|
| D1 | Two PRs; PR-A extends #282 | user | mega-PR |
| D2 | Emit-after-release via typed transition results, uniform across ALL profile ops; ordering contract state→release→emit only (listeners re-enter as normal waiters) | codex (shape); RESOLVED at contradiction-check | fable's deferred-emit queue |
| D3 | Lock-free peek + eager provisioning for store keys | fable | keeping locked getProfileSecret in the provider (deadlock class survives) |
| D4 | PERSISTED ≥128-bit profile incarnation + tombstone carry + offscreen lifecycle states, provisioning under WRITE barrier | codex | fable's in-memory monotonic generation (weaker across restarts/resumed purges) |
| D5 | rw-guard AND facade Lock: ticketed accounting + force-release diagnostic-only on BOTH (amended at contradiction-check — ticket invalidation alone still admits overlap) | fable+codex converged | raise-ceiling-and-clamp (main); Lock force-release w/ ticket invalidation (v1) |
| D6 | Barriers/guards never deleted; failed purge retains barrier + deleting state | all three | delete-on-finally (status quo) |
| D-B2 | KEEP wipe-on-mismatch stamp mirror (divergence from upstream 5.0.1 refuse-and-preserve, documented) | fable | codex's fail-closed refusal (wedges boot for re-syncable data); upstream partition layout (churn, no value pre-prod) |
| D7 | FPC gate: exact artifact-digest-keyed compat map + node-version allowlist + identity pins + two modes | codex (map) + fable (allowlist, no-semver) | main leg's WARN-on-patch-skew (too soft for a fund gate) |
| D8 | NuloTokenPortal REDEPLOYS; protocol portal/AZLO/fuel stay | codex (file evidence) | "L1 fully stays" (main+fable inference — WRONG for the app portal) |
| D9 | Faucet candidate = explicit `deployments.candidate.json` + `--config` on verify/canary; `promote` alone writes live manifests | codex; RESOLVED at contradiction-check (drip canary hard-codes the live path — on-disk-as-candidate defeated red-until-promotion) | v1's on-disk-uncommitted scheme |
| D10 | Intent hardening list incl. required signer, narrowed allowlist, dual digests, promote subcommand, class-id rederivation | codex | leaving the 5.0.0-arc tooling as-is |
| D11 | Compat-epoch stays 3 (with import/export round-trip tests; undecodable slice = STOP not epoch-mask) | all three | precautionary bump to 4 (destroys valid backups for nothing) |
| D12 | Public-surface release acceptance (2 real flows) mandatory, headless insufficient | codex | headless-only acceptance |

**Contradiction-check round (2026-07-17)**: both legs returned INCOHERENT (6 findings each, 9
unique) — ALL folded above: eager-provision liveness fast-path; D2/D9 resolved; facade Lock
force-release diagnostic-only; lock-order invariant narrowed for the sanctioned sweep exception;
VITE_NULO_E2E_PROVERLESS; D-B2 rationale corrected (decision stands); reuse-token deploy mode
added to B4; SW deletion-epoch fence explicitly preserved (incarnation offscreen-scoped).
**Nothing remains disputed.**
