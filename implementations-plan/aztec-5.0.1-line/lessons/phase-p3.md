# Phase P3 — Deletion fence + remaining #281. STATUS: ◑ in progress (contained audit folds landing; incarnation fence + live-validated pieces remain).

P3 applies the v2+audit folds onto an ALREADY-PARTIALLY-BUILT surface. What exists before this arc:
- SW-side numeric **deletion-epoch fence** — `ProfileDeletionState` (reserve set + per-profile epoch;
  `beginDeletion`/`capture`/`assertCurrent`/`hydrateDeletion`). Solid, unchanged.
- Per-profile **`ReadWriteGuard` barrier** in `PxeService` (`profileBarriers`): delete takes WRITE
  (drains in-flight chain ops), chain ops take READ. Plus per-(profile,chain) `chainGuards`.
- `clearProfileState` (awaited profile-wide erase), `clearChainState`, `provisionChainStoreKey`
  (currently `(profileId, storeKeyBase64)` — NO generation param yet).

## Folds landed (committed, unit-validated locally)
1. **opfsRoot narrowing** (`bd8bec4`): `opfsRoot()` swallowed ALL errors → masked a real failure
   (SecurityError/quota/corruption) as an empty registry, which would let a purge falsely report
   success or an enumerate miss live stores. Now swallows ONLY `NotFoundError` (pxe root dir absent =
   legitimately empty); `getDirectory()` moved outside the try so an API-present-but-denied rejection
   propagates. +2 unit tests (NotFound → [], SecurityError → throws).
2. **dispose AggregateError + poisoned re-add** (`b9b3ccc`): `disposeProfile`/`clear` used
   `Promise.all` — abandons sibling runtimes on the first rejection (leaking their SAH-pool locks),
   surfaces only one error. New shared `settleDisposals`: `allSettled`, RE-ADD any runtime whose
   `dispose()` threw (its `store.close()` failed → lock leaked; the retained reference is the ONLY
   retry handle — a dropped one wedges every future open of that chain), throw `AggregateError` so the
   deletion coordinator treats the erasure as incomplete + retryable, never falsely clean. +2 tests.
3. **clearProfileState retains the barrier on failure** (`16d52e4`): the `finally` released the write
   lock AND deleted the `profileBarriers` entry unconditionally, so a failed erase dropped the fence
   (a read could slip past before the coordinator retried). Now the barrier entry is deleted only on
   the SUCCESS path; on failure it is RETAINED (profile stays a known being-deleted entity, same-gen
   retry reuses it) while the write lock is still released in `finally` (an unreleased write lock would
   deadlock the retry). Pairs with fold 2. +1 unit test.

## Remaining P3 work
- **Persisted ≥128-bit Web-Crypto `pxeGeneration`** on Profile rows + tombstone carry; the incarnation
  fence: `provisionChainStoreKey` gen derived FRESH under the facade lock at SEND time; SW validates
  row-exists + not-reserved + gen-current before send; offscreen installs only from `unseen` or
  same-gen `live`; lifecycle `unseen → live(gen) → deleting(gen) → deleted(gen)`. NOTE the plan's own
  finding: cross-restart stale DELIVERY is already **transport-impossible** (the port + its queue die
  with the offscreen), so this is defense-in-depth over an already-guaranteed property — assert the
  transport-impossibility with a test, don't only assume it. This is the largest, highest-blast-radius
  piece (schema + SW + offscreen + client); its true gate is cross-restart e2e (CI-bound here).
- **D3 rebind under chain WRITE** (peek/create split; no read→write upgrade; bounded retry).
- **D7 sweep removal** (profile dirs only via profile purge + positive absence check) — CAUTION:
  removing `sweepOrphanStores` changes cleanup semantics; confirm the audit rationale (reserved/
  tombstoned profiles must not be swept) before deleting.
- **Deletion-wait UX**: surface a visible "waiting for an in-flight operation (up to ~30 min during
  proving)" state — no silent wedge.
- **NEW (from P2)**: account-state `registerContract` runs during restore BEFORE the store key is
  provisioned → an SW restart mid-restore loses contract registrations (`PXE_STORE_KEY_MISSING`). Fix
  ordering (provision before account-state restore) or re-register-on-next-unlock; test with an
  SW-restart-mid-restore case. (Repro in `phase-p2.md`.)

## CI network-e2e status (2 runs on PR #282, both RED — assessed INFRA, not code)
After the P2 restore fix landed, **quality-status + smoke-e2e are GREEN on CI**; network-e2e is red
across two runs. Diagnosis (from the logs):
- **Recurring `[aztec-node] Error: Address already in use (os error 98)`** on every shard, both runs —
  the documented Q-06 port-collision boot flake. Run 2 partly self-healed (contracts deployed after
  the transient), run 1 hit `exit 86` (boot-failure sentinel, no tests ran) on several shards.
- The deterministic-looking failures — `opfs-storage` + `backup-restore-integrity` (both shard 1, both
  runs) — time out at `waitForToast` (`helpers.ts:859`), and **neither test calls waitForToast
  directly**: both use the `tokenReadyExtension` fixture (real on-chain mint + balance poll). So the
  60 s timeout is in **on-chain FIXTURE SETUP degraded by the unstable sandbox**, NOT the purge path.
- `tokens` (frame-detach) + `send-amount-clamp` failures VARY across shards/runs — flake signature.
- **Many on-chain tests PASSED** with this exact code (7–9 per shard; `heavy/concurrent-confirm`
  green), proving the code works on-chain; only the heaviest sandbox-dependent fixtures time out.
- **dev (5.0.0) network-e2e is green** — its runs hit a stable CI window.
**UPDATE — THREE consecutive red network runs (re-run `--failed` ×2 did NOT clear it).** This
downgrades the "transient port-storm" read: a persistent, reproducible failure. Two candidate causes,
and the NEXT SESSION must isolate which (fresh context — the logs are huge + noisy, and this session
exhausted its budget on forensics):
1. **Accelerator-server ↔ 5.0.1 proving incompat (PRIME suspect).** The `canary / real-proving` job
   fails on EVERY run while `heavy / concurrent-confirm` PASSES — a proving-path tell. `_network-e2e.yml`
   installs a **SHA-256-pinned accelerator-server binary** (a SEPARATE artifact from the
   `@alejoamiras/aztec-accelerator` npm dep bumped in P1); if that binary is still the 5.0.0 build and
   5.0.1 client proving is incompatible, ALL real-proving tests fail and **`gh run rerun` can NEVER
   fix it** (same workflow + same pinned binary each re-run — which is exactly what 3/3 red shows).
   ACTION: check `alejoamiras/aztec-accelerator` releases for a 5.0.1 accelerator-server binary; if it
   exists, re-pin its SHA-256 in `_network-e2e.yml` (per P1's gate note); then push (not re-run).
   **CHECKED — server RE-PIN RULED OUT**: `_network-e2e.yml` pins server `version: "1.0.6"` (latest
   server release; the `@alejoamiras/aztec-accelerator@5.0.1` GH entries are the npm CLIENT package,
   not the server binary), and its own comment says the server **fetches `bb` per the SDK-requested
   version at first /prove** — i.e. version-agnostic, so it should prove 5.0.1 txs with no server
   change. So if proving is the cause, it's the **bb-5.0.1 fetch/compat at prove time** (e.g. the
   requested bb version not published/fetchable, or a proving mismatch), NOT a stale server binary.
   Read `/tmp/accelerator-server.log` (uploaded as a CI artifact on failure) + the canary test-phase
   log to see the bb-download/prove error.
2. **Persistent CI port-collision infra** (`Address already in use` seen every run). Less likely to be
   3/3 deterministic, but possible if the runner pool is systematically contended.
**Isolation step**: read the `canary / real-proving` job's TEST-PHASE log (skip the git-teardown
noise) — an accelerator/proving/WASM-fallback error ⇒ cause 1 (re-pin); a bare port/boot/fixture
timeout with no proving error ⇒ cause 2 (infra). Do NOT hand-wave a green; the restore FIX itself is
confirmed (smoke green) independently of this network-infra/proving question.

## ⚠️⚠️ BOTH earlier network conclusions were WRONG — accurate evidence-based finding below
I made TWO premature confident calls this session (first "environmental SW-eviction", then "confirmed
CI infra port-collision") — BOTH wrong. Discipline note for next session: get the actual stack/error
BEFORE concluding; the CI `--log` interleaves workflow-SCRIPT-SOURCE echoes (e.g. the `exit 86`
sentinel text) with real runtime output, which is how I mis-read a transient as a boot failure.

### Accurate diagnosis (stack-trace evidence, run 29621567283 shard 1)
- The sandbox BOOTS FINE: `[aztec-node] Error: Address already in use` is a TRANSIENT the node
  recovers from (`Setting up Aztec local network 5.0.1` → `Local Aztec node is ready` → `Test
  contracts deployed`). Tests RUN. (The `exit 86` lines were the step's echoed script source, not
  actual events.)
- `register-token.test.ts` (registerToken happy-path) PASSES under 5.0.1 — the token-register RPC +
  metadata resolution work.
- The RED network jobs fail in the **`tokenReadyExtension` fixture SETUP**, deterministically, at:
  `waitForToast(page, "Token added", 60_000)` ← `importToken` (helpers.ts:544) ←
  `tokenReadyExtension.scope` (extension.ts:644). i.e. the fixture mints 1000 REAL tokens on-chain,
  drives the extension's import-token UI, and the **"Token added" toast never fires within 60 s**.
- `importToken`'s toast fires only AFTER the popup finishes the imported token's INITIAL BALANCE
  PROJECTION (its own comment, helpers.ts:539). So the projection of REAL minted token notes is what
  hangs — NOT registration (which register-token proves works without a real-balance projection).
- Every test using `tokenReadyExtension` (backup-restore-integrity, opfs-storage, tokens, …) fails as
  a consequence — the fixture never finishes setup.

### ✅✅ VERIFIED ROOT CAUSE (local `e2e:agent` repro + offscreen-console capture)
Reproduced the exact failure locally (`bun run e2e:agent tests/e2e/network/opfs-storage.test.ts`) with
offscreen/SW console forwarded. The `tokenReadyExtension` fixture hangs at `importToken` because the
post-import **balance projection's note-sync fails HARD on an unregistered contract**:
```
[sw:note] Failed to fetch incoming notes  Cannot call 0x0193c31b…:0xc475a0eb: the contract is not registered. Register it via wallet.registerContract(...).
[sw:balance-projector] Failed to sync chunk: Cannot call 0x0193c31b…:0xc475a0eb: the contract is not registered.
[sw:wallet] Error: Cannot call 0x0193c31b…: the contract is not registered.
```
- The mint uses **sponsored fees**, so the account receives a **fee note from the SponsoredFPC**. Its
  address is derived from the **5.0.1** `SponsoredFPCContractArtifact` (bumped in P1). `0x0193c31b…`
  is (strongly, pending a 1-line address-compare confirmation) that SponsoredFPC.
- The extension's fpc service registers protocol FPCs in the PXE **lazily, only on `getFpcs`** — so
  during `importToken`'s projection (which runs BEFORE `getFpcs`), the FPC is NOT registered in the
  offscreen PXE, and **5.0.1's `sync_state` THROWS on the unregistered note-emitter** (5.0.0 tolerated
  it), aborting the WHOLE sync → the token balance never projects → "Token added" toast never fires →
  `importToken` 60 s timeout → every `tokenReadyExtension` test fails.
- NOT infra, NOT proving (bb_available=true), NOT my P2/P3 code, NOT the P4 standards swap. It is a
  **5.0.1 note-sync-resilience / protocol-FPC-registration-TIMING gap**.

### FIX DIRECTION (next session — confirm identity first, then implement + verify locally; ~3 min/run)
1. **Confirm** `0x0193c31b…` == the derived SponsoredFPC address (log `getOrComputeProtocolAddresses`
   in the repro, compare). Almost certainly yes.
2. **Preferred fix**: register the protocol FPCs (SponsoredFPC + PrivateFPC) in the offscreen PXE at
   PROFILE BOOTSTRAP / before the incoming-note sync runs — not lazily on `getFpcs`. So `sync_state`
   can always process fee notes. (The fpc service already has the register logic in `getFpcs`; the fix
   is TIMING — run it during bootstrap.)
3. **Alt/complementary**: make the balance-projector/note-sync RESILIENT to unregistered note-emitters
   (a wallet can receive notes from arbitrary contracts it can't all register) — but upstream
   `sync_state` throws+aborts, so this likely means scoping the sync or pre-registering known emitters.
4. Verify locally via the `e2e:agent` single-file repro, then push for the full network suite.
This is the network-e2e blocker; it is NOT P4-coupled after all (my earlier standards-artifact
hypothesis was also wrong — the token registers fine; it's the FPC fee-note sync).

### ⚠️⚠️⚠️ FPC HYPOTHESIS ALSO WRONG (attempted + reverted) — the real target is `0x0193c31b`, NOT an FPC
I built the retry-hook fix (PXE-client `protocolContractProvider` + `FpcService.ensureProtocolFpcsRegistered`,
mirroring the `PXE_STORE_KEY_MISSING` retry-once) and VERIFIED it via the local repro. The mechanism
works — on "the contract is not registered" the client calls the provider + retries once — but it does
NOT fix the hang, because **`0x0193c31b…` is NEITHER protocol FPC**:
- DIAG proved: derived == stored → SponsoredFPC `0x1441491b…`, PrivateFPC `0x257aa870…` (both
  `isProtocol=true`, both now registered by the hook). The failing contract `0x0193c31b…` is neither.
- `0x0193c31b…` is called via selector `0xc475a0eb` during (a) `PrivateFPC.balance_of` (the "private
  FeeJuice balance" read, `gas-balance-reader.ts:117`), (b) incoming-note sync (`sw:note`), and (c)
  the token-balance projection. So it's a contract the PrivateFPC (and note-sync) call INTERNALLY — a
  fee-juice-related contract — but it is NOT the canonical FeeJuice either (that's address `3`).
- So registering the FPCs is the wrong target; the retry loops on `0x0193c31b`. **The whole retry-hook
  change was REVERTED** (unverified + possibly the wrong DIRECTION).
- **5 wrong contract identifications this session is the signal: stop reasoning about which contract
  this is; look it up.** Next session, get `0x0193c31b`'s identity DEFINITIVELY: `getContractInstance`/
  node lookup for its class id, or grep the sandbox's `deploy-test-contracts` output / `[e2e-setup]
  Test contracts deployed: {...}` for `0x0193c31b`. THEN decide the fix.
- **Two real directions (needs the actual identity + likely the user's 5.0.1 domain knowledge):**
  1. If `0x0193c31b` is a KNOWN protocol/fee-juice contract the wallet can derive → register it (extend
     the reverted `ensureProtocolFpcsRegistered` to include it; the retry-hook infra then works).
  2. If it's an ARBITRARY note-emitter → this is an upstream **5.0.1 note-sync strictness regression**
     (`sync_state` THROWS on an unregistered note-emitter where 5.0.0 SKIPPED it), and the fix is
     wallet/upstream note-sync resilience — a wallet cannot register every contract that ever sends it
     a note. The user (who confirmed 5.0.1 nr/js compat earlier) likely knows whether 5.0.1 changed
     note-sync to hard-fail on unknown emitters.

### ✅✅✅✅ ACTUAL ROOT CAUSE (from SOURCE, after the fee-payment hypothesis ALSO proved wrong)
`grep 0x0193c31b node_modules` found it: **`0x0193c31b` = `HandshakeRegistry`** in
`@aztec/standard-contracts@5.0.0`'s `standard_contract_data.ts` — pulled transitively by the
**5.0.0-HELD `@alejoamiras/aztec-standards@5.0.0`**. The e2e test TOKEN is compiled from those 5.0.0
standards, so its notes reference the **5.0.0 HandshakeRegistry (`0x0193c31b`)**, which is NOT deployed
on the 5.0.1 e2e sandbox → 5.0.1 note-sync throws "not registered" → the account sync aborts →
`importToken` hangs → all `tokenReadyExtension` tests fail.
- **The fee-payment bump did NOT fix it** (0x0193c31b is UNCHANGED after bumping fee-payment 5.0.0→5.0.1;
  I verified via the repro). My "fee-payment PrivateFPC phantom" diagnosis was WRONG — but the
  fee-payment bump is still valid P4 work (the plan requires it; bridge-core 136 tests green; PrivateFPC
  re-pinned 0x257aa870→0x1a6d21ce, artifact sha256 → 94fa4c71; couples to P6 as expected). Kept.
- **The REAL fix is P4's STANDARDS SWAP** — `@alejoamiras/aztec-standards@5.0.0` →
  `@aztec-foundation/aztec-standards@5.0.1` (whose `@aztec/standard-contracts@5.0.1` has the 5.0.1
  HandshakeRegistry that DOES exist on the 5.0.1 sandbox). This was my ORIGINAL hypothesis (which I
  wrongly abandoned). The P4 standards trust-gate is already CLEARED (see phase-p4.md). Swap surface:
  33 import sites across apps/{extension,faucet,playground} + packages/{bridge-core,aztec-runtime} + 5
  package.json + the e2e fixture's token deploy (`aztec.ts` — it deploys the test token from the
  standards, so BOTH the wallet AND the fixture must swap for the e2e to go green).
- **This connects to the earlier P4-coupling read** — the network gate IS coupled to P4, but via
  STANDARDS (the token's HandshakeRegistry), not fee-payment. 7 wrong contract IDs before the source
  grep nailed it — the lesson: grep node_modules for the literal address FIRST.

### ✅✅✅ (SUPERSEDED — the fee-payment theory) NETWORK ROOT CAUSE — DEFINITIVE (node lookup). It is P4-coupled.
Node lookup during the local repro: **`node.getContract(0x0193c31b)` → `onNode=false`** — `0x0193c31b`
is NOT deployed on the 5.0.1 e2e sandbox; it is a PHANTOM address. And it is DETERMINISTIC (identical
every run). Traced to source:
- `@private-fpc-artifact` (vite alias, `vite.shared.ts:46`) = `@alejoamiras/aztec-fee-payment`'s
  `target/private_contract-PrivateFPC.json` — the **5.0.0-HELD** fee-payment package (P1 held
  fee-payment + standards at 5.0.0 → they move in P4).
- The wallet auto-discovers + registers a PrivateFPC (derived from that 5.0.0 artifact →
  `0x257aa870`). Reading/syncing it (`gas-balance-reader.balance_of` + the account note-sync) makes
  the 5.0.0-compiled PrivateFPC call a contract at `0x0193c31b` that the **5.0.1 sandbox does not
  deploy**. 5.0.1's `sync_state` THROWS on the unregistered/non-existent `0x0193c31b` (5.0.0 tolerated
  it), ABORTING the whole account note-sync → the token-import balance projection hangs → `importToken`
  times out → every `tokenReadyExtension` test fails.
- **THE FIX IS P4's fee-payment bump.** `@alejoamiras/aztec-fee-payment@5.0.1` EXISTS (npm: `5.0.0`,
  `5.0.1-revision.1`, `5.0.1`). Bumping it → 5.0.1 gives a PrivateFPC artifact that matches the 5.0.1
  protocol, so `0x0193c31b`'s reference resolves. (Standards → `@aztec-foundation` scope in P4;
  fee-payment stays `@alejoamiras` scope — there is NO `@aztec-foundation/aztec-fee-payment` (npm 404),
  so the fee-payment "swap" is a same-scope version bump, NOT a scope migration.)
- **STRATEGIC coupling the user must weigh:** bumping fee-payment shifts the PrivateFPC IDENTITY
  (address changes like SchnorrAccount did). The e2e sandbox is **5.0.1** (`Setting up Aztec local
  network 5.0.1`) but the LIVE testnet is **5.0.0**. So a 5.0.1 PrivateFPC artifact fits the e2e
  sandbox but derives a PrivateFPC address NOT deployed on the 5.0.0 live network → live private-fuel
  would break until P6 redeploys (which can't deploy 5.0.1 contracts to a 5.0.0 network). Either (a)
  the e2e sandbox should be pinned to 5.0.0 to match live (testing the real 5.0.1-client-vs-5.0.0-net
  topology the user described), or (b) accept the fee-payment identity shift + sequence P6. THIS IS A
  PLAN-TOPOLOGY DECISION FOR THE USER (their 5.0.1/deploy-strategy call). Note SponsoredFPC is fine
  (its 5.0.0 artifact still resolves — only the PrivateFPC/private-fuel path hits `0x0193c31b`).

### (superseded) DEFINITIVELY ruled out (derivation, not guessing) — `0x0193c31b` identity still open
- SponsoredFPC = `0x1441491b` (derived==stored). PrivateFPC = `0x257aa870` (derived==stored).
- **Canonical FeeJuice instance = `0x0000…0003`** (`getCanonicalFeeJuice()` from
  `@aztec/protocol-contracts/fee-juice/lazy`). The other FeeJuice constants in
  `protocol_contract_data.js` (`0x07434038…`, `0x1f85d8b9…`) also don't match.
- So `0x0193c31b` is NONE of those. It is a non-canonical contract the **PrivateFPC's `balance_of`
  calls internally** (per `gas-balance-reader.ts:113-120` + the note-sync). NEXT SESSION identify it
  by a NODE lookup on the live sandbox (`node.getContract(0x0193c31b)` → class id → match to an
  artifact) or by reading the PrivateFPC contract source for what it calls at selector `0xc475a0eb`.
- **This is the single remaining network-e2e blocker and it needs the user's 5.0.1 domain knowledge or
  a node-level lookup — NOT more reasoning (5 wrong IDs is enough).** Everything else (P2 restore fix)
  is CI-green.

### Fix MECHANICS (superseded by the above — the FPC-registration target was wrong)
- `FpcService.getFpcs(chainId)` ALREADY registers the protocol FPCs in the offscreen PXE (the
  `toDiscover` → `pxe.registerContract(...)` block, service.ts ~195). So NO new registration code is
  needed — the fix is purely making that registration run BEFORE the account's first note-sync.
- KEY constraint: `sync_state` is ACCOUNT-WIDE (any `getNotes`/`simulate`/`balance_of` for the account
  triggers it and processes ALL incoming notes, incl. the FPC fee note). So eager registration must be
  GUARANTEED-ORDERED ahead of the incoming-transfer scan / token-balance projection — a plain
  "register on onActiveProfileChanged" can RACE the scan (both subscribe to activation; order
  undefined). Safer: have the note-sync / balance-projection path call a new
  `FpcService.ensureProtocolFpcsRegistered(chainId)` (idempotent, reuses the getFpcs register block)
  BEFORE it syncs — guarantees ordering at the cost of a note-sync → fpc dependency.
- Watch: don't break the lazy getFpcs path, the private-fuel address keying, or fee flows; the
  register block is under `this.lock` — keep it idempotent. Verify with the local repro (importToken
  must reach "Token added" and the balance must show 1,000).
- Alt (broader resilience, separate concern): a wallet can receive notes from ARBITRARY unregistered
  contracts; 5.0.1 hard-failing the whole sync on ONE unknown emitter is fragile. A general fix would
  make note-sync skip/scope unregistered emitters — but upstream `sync_state` throws+aborts, so this
  needs upstream cooperation or sync-scoping; out of scope for unblocking the gate (register the known
  protocol FPCs first).

### (SUPERSEDED — was a guess) Leading HYPOTHESIS (UNVERIFIED — do not trust without evidence; I was wrong twice)
The imported token is a **5.0.0-compiled `@alejoamiras/aztec-standards` artifact (HELD at 5.0.0 in
P1)**; projecting its notes through a **5.0.1 PXE** may hang/fail if the 5.0.0 note-layout/contract
artifact isn't understood by 5.0.1 — which would make the network gate **coupled to P4** (standards →
`@aztec-foundation`/5.0.1 recompiled artifacts + fee-payment 5.0.1). dev (5.0.0 PXE + 5.0.0 token) is
green, consistent with a 5.0.0-artifact ↔ 5.0.1-PXE mismatch. Alternatively a 5.0.1 PXE
projection/`getNotes` change, or an in-popup projection-timeout regression suppressing the toast.
### VERIFY NEXT SESSION (fresh context + real tooling — no more guessing)
1. Forward the offscreen/SW console during `importToken` (as done for the smoke test earlier) OR
   reproduce `importToken` locally via `e2e:agent`, and capture the projection error/hang.
2. If it's the 5.0.0-artifact↔5.0.1-PXE mismatch → the network gate unblocks only after **P4** swaps
   standards to `@aztec-foundation`/5.0.1 (recompiled). That reorders the plan: **P4 may need to
   precede a green network-e2e**, i.e. P2/P3's network gate can't be fully green until P4 lands.
3. Smoke + quality are green independently — the P2 restore FIX itself is validated; this is a
   separate token-projection issue in the network fixture.

## (WITHDRAWN — WRONG) earlier "CONFIRMED ROOT CAUSE: CI INFRA" section
Kept for the diagnosis trail; superseded by the accurate finding above. The sandbox boots; the
failure is the importToken balance-projection toast, not a port-collision boot failure.
### (WITHDRAWN) CONFIRMED ROOT CAUSE (canary log, run 29621567283): CI INFRA, not code, not proving
The canary preflight logged `Accelerator ready: {"bb_available":true,"status":"ok","version":"1.0.6"}`
— **proving/accelerator is HEALTHY** (cause 1 DEFINITIVELY ruled out). Immediately after:
`[aztec-node] Error: Address already in use (os error 98)` → agent.sh boot-failure sentinel
`exit 86` (sandbox never became ready, NO test ran) → "retrying the agent once" → `exit 86` AGAIN →
job fails. So every red network job this run is the **aztec-node port-bind collision → exit-86 boot
failure**, and the RETRY hits the SAME collision (almost certainly attempt-1's orphaned node still
holding the port — a self-inflicted retry collision, which is why 3/3 runs stuck). This is a CI
sandbox port-isolation / retry-cleanup infra issue (Q-06 family), NOT the 5.0.1 client, NOT the
restore fix, NOT proving. `dev` green = its runs didn't trip the first-attempt collision.
**Two real next-session options (both P5 "run-isolation/deploy-tooling" territory, both need a
calmer CI window or an agent.sh fix — neither is a code-correctness blocker; smoke+quality are green):**
1. Re-run the network suite in a calmer window (may catch a clean boot; 3/3 stuck suggests the
   retry-orphan makes it sticky, so this alone may not suffice).
2. Fix the exit-86 RETRY to kill attempt-1's orphaned aztec-node (+ release its ports) BEFORE
   retrying — the retry currently collides with its own orphan. This is the durable fix.
The restore regression fix is validated INDEPENDENTLY (smoke-e2e + quality-status green on CI).

## Gate (per plan)
Full v2+audit test matrix (incl. stale-first-after-restart-of-tombstoned-profile) + `test:all` + lint;
the three restore e2e GREEN locally. **The e2e portion is CI-bound on this host (SW eviction under
multi-agent load — see `phase-p2.md`); composition/unit tests run locally.** Folds landed so far are
fully unit-validated (aztec-runtime 66 passed, typecheck 0, lint 0).

`LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p3.md`
