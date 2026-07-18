# Phase P7 — delivery (lessons)

## 2026-07-18 — P6-independent P7 work executed AFK (review + audit + fixes + docs + issue)

P6 (live redeploy) awaits the user per their standing decision ("I drive P6, you supervise"), so
P7's independent items ran first: `/code-review max --fix` (3 scoped hostile reviewers over the
arc delta) + the codex post-impl audit (gpt-5.6-sol, xhigh, session `019f7644-0b80-7540-8206-5a134d5eb47b`,
targeted checklist per the plan) + follow-up issue #284 (strict-mode/F-11 recovery bearer) +
UPDATE.md 5.0.1 couplings.

### Fix commits (each finding verified against the code before fixing)
- `a4669b6` — pre-fence profile rows: deleteProfile fails FAST (was: half-executed wedge — row
  deleted, tombstone unparseable by its own schema, unretryable).
- `59fd637` — deploy-gate batch: candidate feeJuice cross-pinned to the INTENT's corroborated L1
  set (internal readback consistency ≠ authentication); drip-canary 4→5-arg rebuild (was
  hard-red on every valid 5.0.1 manifest); promote requires + binds the RECORDED candidateSha256
  (no first-ever-verify promote, no read-gap substitution); FPC require-deployed RUNS inside
  promote; canonical-FPC digest re-checked at every verify; previous-arc L1 pin read from the
  COMMITTED blob (`git show HEAD:`); faucet candidate derivation proven BEFORE live writes;
  authContract format-validated (32-byte hex); reuse-token bound to live manifest l1.usdc;
  deploy.ts refuses direct live --output without --allow-live-output; promote tmp
  force-removed + exclusive-created.
- `ddbbdb9` — pxe/concurrency batch: rw-guard force-release is now PER-TOKEN age (serialized
  proves kept occupancy continuous past the ceiling; clear-all let a delete overlap a mid-flight
  prove) + wake-recheck loop (CV discipline); registry.dispose retains the reference on failed
  close (retry handle); per-chain purge epochs stop withPxeRead's rebind from resurrecting a
  just-purged chain's runtime + store dir; the client fails ops whose generation provider returns
  undefined (deleted/tombstoned) instead of sending them unfenced; sweepOrphanStores' keyval
  guard de-vacuoused.
- `f3df68d` — codex highs: the RUNTIME-imported dist/target FPC artifact is now bound core-equal
  (file_map-stripped recursive-canonical digest, negative-controlled) to the gated target
  artifact in BOTH the gate and the tripwire; the bridge L2 token deploy + candidate record
  gained the 5th auth_contract arg (was P6-blocking); --from-journal×--reuse-token consistency;
  promote crash-pair doc corrected (recovery = idempotent re-run; tree discipline does NOT see
  allowlisted live paths).

### War stories
- **Silent python-edit no-op nearly shipped a vacuous fix**: the rw-guard per-token handler
  replacement didn't match (whitespace drift) while sibling edits did — the "new" test failed
  against the OLD clear-all handler and the debug log's old format exposed it. Every scripted
  edit now gets an assert or a grep-back. Same class: my first core-digest used a JSON.stringify
  replacer ARRAY (filters keys at EVERY level → vacuous equality); caught by a negative control
  before commit. Verify a checker can FAIL before trusting that it passes.
- `bunx tsc -p tsconfig.json` missed script-only errors — packages typecheck their scripts via
  their OWN `typecheck` script (`tsconfig.scripts.json`). Use `bun run typecheck`.

### Accepted residuals (reviewed, deliberately not fixed now — with reasons)
- Import-page recovery robustness (codex #1: onboarding ignores the timeout arg; all errors
  funnel to "needs-unlock"): the P2 e2e + sw-restart e2e prove the recovery path lands; the UX
  refinement rides #284's bearer work or its own follow-up.
- Account-state restore durability post-finalize (codex #5): the sw-restart e2e proves balances
  re-sync via row-driven registration after SW death; a durable resume marker is real work with
  no current failure evidence.
- Descriptor full-ABI/layout validation (codex #7): the synthetic canonical ABI encodes against
  OUR shape; a token lying about its ABI harms only its own importer (self-harm threat model);
  `descriptors-real-artifact.test.ts` pins the legit artifact.
- `deleted(gen)` lifecycle entries live for the offscreen document's lifetime (bounded by
  deleted-profile count; the map IS the fence).
- rpcOptional's omitted-result-as-absence in predeploy (codex #3c): countered — the deploy
  derives addresses locally + re-asserts, and require-deployed still fails; no deposit path
  greens on a forged absence.
- l2RecordSchema's `constructorArgs: z.array(z.unknown())` stays loose (the deploy writes the
  args; the address re-derivation is the binding check).

## 2026-07-18 — codex GO/NO-GO resume → the one HIGH that was NOT addressed → fixed
Codex's post-fix resume returned **NO-GO** with a single remaining HIGH: `require-deployed` ran
only inside `promote()`, but `fuel-testnet.ts` (the PrivateFPC fund-mover) deposits Fee Juice +
pays fees through `PRIVATE_FPC_ADDRESS` BEFORE promotion — promotion-time enforcement is too late,
and the separate `--mode require-deployed` command was operator discipline.

**Fix (`6a78e25`)**: extracted the gate to an importable `runFpcGate(mode)` (throws on RED; CLI
wrapped behind an `isMain` guard, behavior unchanged — re-verified predeploy/require-deployed/
no-mode exit codes live) and call it INLINE at the top of `fuel-testnet.main()` before any
broadcast. Confirmed `fuel-testnet` is the ONLY script that funds through the PrivateFPC — the
fee-juice + drip canaries use the SponsoredFPC and recoverable FeeJuicePortal deposits;
deposit-testnet uses the bridge token portal (recoverable claim). promote keeps its shell-out gate
too (belt + suspenders).

**Updated P6 operator flow**: the `require-deployed` gate is now UNSKIPPABLE for the PrivateFPC
canary (inline in fuel-testnet). The operator still runs `check-fpc-version --mode predeploy`
before the FPC deploy, and `--mode require-deployed` is additionally enforced by both the canary
and promote.

## 2026-07-18 — four gpt-5.6-sol ULTRA audits commissioned (running)
At the user's request ("very solid thing"), four independent xhigh audits of the whole arc as
COMPOSED FLOWS (not per-file): (1) fund-moving deploy chain end-to-end (sequencing/resume/operator
error); (2) PXE/profile concurrency + MV3 crash-safety under adversarial SW/offscreen death
interleavings; (3) supply-chain + artifact byte-identity (what pins BYTES vs versions); (4)
backup/restore user-data integrity + P2-recovery durability. Findings triaged in the next entries.

## 2026-07-18 — four gpt-5.6-sol ULTRA audits: full triage (12 fixes across 5 commits + 2 follow-ups)

Each finding was VERIFIED against the code before acting; accepted residuals carry reasons.

### Audit 1 — fund-moving deploy chain (composed flow). `14377fc` + `6a78e25`
- HIGH require-deployed ran only in promote → **inline `runFpcGate("require-deployed")` at the top of
  fuel-testnet** (the only PrivateFPC fund-mover); gate extracted to importable (`isMain`-guarded CLI).
- HIGH verify not coupled to broadcast → **the L1 broadcast scripts assert deployer ==
  PLAN_PINNED_L1_SIGNER** before spending; a wrong key in the broadcast shell now hard-stops.
- HIGH intent mutable / source not re-checked → **verify diffs HEAD vs intent.source.commit** and
  STOPs on any deploy-relevant change since build.
- MED remaining 4-arg canaries (smoke-existing, smoke-swap, faucet dry-run) → 5-arg swept.
- Residuals (compensated by the SUPERVISED per-group-verify flow the user drives): the canary→pin→
  promote A/B digest binding (promote already re-derivation-proves the faucet + re-hashes the bridge
  vs recorded digest); deposit-canary crash-recoverability (testnet, capped ≤0.5 ETH); default-to-live
  --config omission; secrets-in-argv (LOW).

### Audit 2 — PXE/profile concurrency + MV3 crash-safety. `590049a`
- HIGH stale provision across offscreen restart → **provider re-reads generation AFTER HKDF**; a
  deletion during derivation (or offscreen reincarnation losing deleted(gen)) now rejects.
- HIGH deletion times out behind a 30-min proof → **clearChainState/clearProfileState get
  PROVE_TX_TIMEOUT_MS** so the delete drains rather than stranding the id reserved forever.
- HIGH reader force-release counted inner-guard queue time → **MAX_READER_DRAIN_MS 35→90 min**
  (queue-behind-one-proof + own-proof + margin); the long clear timeout means delete waits, not forces.
- MED withPxeWrite could resurrect a purged chain → **purge-epoch check on the write path too** (+test
  injecting a concurrent purge after the synchronous entry-read).

### Audit 3 — supply-chain + artifact byte-identity. `cdd767e`
- HIGH four residual 4-arg constructor sites (incl. faucet's connect-time bridge rebuild) → 5-arg.
- HIGH committed Noir artifacts unbound to source → **class-id + version tripwire** (proxy/bridge).
- HIGH FPC digest didn't cover the fee-payment SDK JS → **private-fuel.test pins each emitted call's
  (to, selector)**.
- MED standards artifacts unanchored → **Token/Dripper class-id tripwire** (defense beyond lockfile).
- Residuals: compat-map human-editable (by design; canary backstop); stale @alejoamiras/aztec-standards
  @5.0.0 in node_modules (nothing imports it; fresh install clears).

### Audit 4 — backup/restore user-data integrity. `ed7ad82` + issue #285
- MED malformed account-state → uncaught throw post-finalize (rollback suppressed) → **guarded to a
  per-item error** (+test).
- MED silent export omission (inactive networks, artifact-less contracts) → **WARN-logged with counts**.
- HIGH #1 (durable account-state resume) + HIGH #2 (forged-account address authentication) → **filed as
  #285** — pre-production, no cross-user fund theft (a forged account can't spend the victim's
  master-encrypted notes; caught at first-spend by getAccountContract), and both need a plan not an
  inline patch. The P2 sw-restart e2e is liveness-only — noted for a future integrity-asserting marker.

**Full gate after all four**: typecheck:all 0; bridge-core 156, wallet-core 161, aztec-runtime 86,
faucet 428, extension units 3165. Follow-ups: #284 (strict-mode bearer), #285 (restore auth+resume).

## CI flake hunt: backup-restore-sw-restart (3 consecutive network-e2e reds)

Three failures, two distinct root causes — the timeout bump surfaced the second one:

1. **Runs 1–2** (`TimeoutError: 60000ms exceeded`): the post-kill recovery wait
   (`/popup/general` after reopen+unlock) was 60s; recovery re-derives the master,
   re-provisions the store key, re-boots the chain runtime, and re-registers contracts —
   too slow under CI proving load. Fix: 60s→240s, balance sync 30s→120s, test budget
   600s→900s, mid-restore marker made non-fatal.
2. **Run 3** (`TimeoutError: 5000ms exceeded` at ~53s): with the marker no longer
   masking it, `stopServiceWorker`'s `waitForTarget` hard-failed because there was NO
   service-worker target to kill — under CI load Chrome's MV3 reaper takes the idle SW
   down mid-restore before the test does (heavy restore work lives in the offscreen doc,
   so the SW can go idle). That is *the exact event the test exercises*, so the fix is
   semantic: absent SW target ⇒ already-stopped ⇒ proceed to the recovery leg
   (warn-logged). The precedent helper in `sw-restart-network.test.ts` never hits this
   because it kills immediately after actively messaging the SW.

Lesson: in MV3 e2e, "kill the SW" helpers must tolerate the SW being already dead —
Chrome's reaper is a concurrent actor, and its kill is indistinguishable from (and as
valid as) ours for crash-recovery assertions.
