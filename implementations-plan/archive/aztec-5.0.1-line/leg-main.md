# Main leg — aztec-5.0.1-line (draft, pre-consolidation)

## Shape
Two PRs + release, per locked decisions.
- **PR-A** (`worktree-aztec-5.0.0-stable`, extends #282): restore-boot regression root-cause + fix, full #281 implementation, e2e green, merge #282 → dev.
- **PR-B** (fresh worktree `aztec-5.0.1-line` off dev): 5.0.1 bump + accelerator + fee-payment 5.0.1 (FPC identity move) + standards swap → @aztec-foundation + Noir recompile + drift-triggered candidate-first redeploy + promotion.
- **Release** (standing authorization): dev→main promote, release-please auto-unstick, live acceptance incl. public-surface canaries.

## PR-A phases

### A1 — Root-cause the restore-boot hang (diagnosis-first; no speculative fix)
Evidence so far (lessons/phase-6.md): restore succeeds → `finalizeRestore` (holds ProfileService facade lock via runExclusive; the Lock is NON-REENTRANT with a documented self-deadlock class at service.ts:126-135) → `sessionManager.open()` fires `onActiveProfileChanged` — if listeners are executed inside the held lock, ANY listener-reachable path that re-enters a locked profile method deadlocks the profile service. The 5.0.0 arc ADDED such a path: PXE boot → `PXE_STORE_KEY_MISSING` → store-key provider → `profileService.getProfileSecret` → `runExclusive`. The last SW log line ("Profile unlocked, draining discovery queue") is an unlock listener — consistent.
Tasks: re-land the SW/offscreen console tap (behind `NULO_E2E_DUMP_CONSOLE`, permanent this time — it earned its keep twice); instrument lock enter/leave with holder tags in dev builds; reproduce the smoke hang; pin the exact wedge (which listener, which lock). Gate: a written root-cause note in lessons with the exact chain; the repro observed red BEFORE the fix (proof the fix fixes it).

### A2 — Lock-architecture fix (the regression) + lock-order doc
Design principles (final shape confirmed against A1's findings):
1. **Emit-after-release**: no `EventHandler.emit` while holding the facade lock. `sessionManager.open/close` queue their emits; `runExclusive` drains the queue after `lock.leave()`. (Smallest change that kills the whole re-entrancy class, incl. the documented `applyTtlChange` footgun.)
2. **`getProfileSecret` lock-free session read**: secrets live in the SessionManager's in-memory map; replace `runExclusive` with a synchronized read + deletion-fence check (see A3). Kills the provider→facade-lock edge even if a future emit slips through.
3. **Documented lock ORDER** (new `apps/extension/src/wallet/services/LOCKING.md` + enforced-by-convention): facade locks (short, no awaits into other services, never emit) → profile barrier (rw) → chain guard (rw) → store/SAH. Any cross-service call inside a held lock is a review-flag.
Gate: unit tests (emit-after-release semantics; provider-during-restore composition test), the three red e2e now GREEN locally (backup-roundtrip smoke; backup-restore-integrity + backup-migration-roundtrip network via e2e:agent), full `test:all` + lint.

### A3 — #281 in full (D3/D4/D6/D7/D11 + the two codex extras)
- **D4 (deletion fence)**: per-profile monotonic **deletion generation** (increment at beginDeletion, before any purge) + tombstone check. Store-key provider captures the generation before HKDF; `provisionChainStoreKey(profileId, key, generation)` rejects stale generations under the profile barrier read. `clearProfileState` bumps generation first. Reuses the D13 epoch-fence pattern from backup-restore-security-hardening (its audits are the design doc).
- **D3**: endpoint-switch rebind moves under the chain WRITE lock: `getOrInit` under read only returns-or-creates; on rpcUrl mismatch it returns a REBIND-REQUIRED signal and the caller re-enters under write, re-checks, disposes, re-inits. `initPromises` keyed by (chain, rpcUrl) so a stale-URL init can't be inherited.
- **D6**: `profileBarriers.delete` only on purge SUCCESS; barrier looked up inside the locked section; failed purges keep the barrier so the retry serializes with queued ops.
- **D7**: remove the empty-profile-dir sweep from `removeChainStoreDir`; profile-dir removal only in `removeProfileStoreDirs` (profile WRITE barrier).
- **D11**: `MAX_READER_DRAIN_MS` raised above `PROVE_TX_TIMEOUT_MS` (35 min) + reader-count clamped at 0 on release (never negative) + force-release logs loudly. (A lease/heartbeat redesign is over-scope; the clamp + ceiling removes both the overlap and the skew.)
- **Codex extras**: `ChainRuntime.dispose` propagates `pxe.stop()` failure (store close stays in finally); `opfsRoot()` treats ONLY unsupported-API + NotFoundError as absence, throws otherwise.
Gate: new unit tests per item (wallet-core rw-guard clamp tests; fence tests; barrier-retention test; opfs-store absence-vs-error test), `bun run test:all` + lint green.

### A4 — PR-A gate + merge #282
`bun run audit:vue`, `test:e2e` (smoke), `e2e:agent` (network) locally; push; all three required checks green on #282; `/code-review` on the delta; merge (squash) → dev. Post-merge: `agent-worktree done aztec-5.0.0-stable` prep (keep until PR-B branches).

## PR-B phases (fresh worktree `aztec-5.0.1-line` off dev)

### B1 — Pin sweep + lockfile
- `@aztec/*` → 5.0.1 everywhere (incl. transitives via lock re-resolve); `@alejoamiras/aztec-accelerator` → 5.0.1; `@alejoamiras/aztec-fee-payment` → 5.0.1; **`@alejoamiras/aztec-standards` REMOVED → `@aztec-foundation/aztec-standards@5.0.1`** (package.json entries + the ~22-file import sweep — layout is identical `artifacts/src/artifacts/*`, so it's a scoped-name replace; then grep-assert zero `@alejoamiras/aztec-standards` remain).
- Noir patches: regenerate/rename `patches/@aztec%2Fnoir-{acvm_js,noirc_abi}@5.0.1.patch` + `patchedDependencies` keys; verify `bun install` applies them.
- `bunfig.toml` min-age excludes: re-date for the 5.0.1 line (published 07-15/16), removal follow-up ~07-23 (supersedes #279).
- Lockfile ritual: `rm bun.lock && bun install` (hoisted linker pinned); allowlist-diff; `rg -c '5\.0\.0' bun.lock` scoped-assert.
Gate: `typecheck:all` (expect the 5.0.1 churn list — fix mechanically), `test:all`, lint.

### B2 — 5.0.1 store-semantics + churn absorption
- `opfs-store.ts` mirror: re-verify `PXE_DATA_SCHEMA_VERSION` in 5.0.1 (pin update if bumped); DECISION: keep our wipe-on-schema-change stamp; our per-(profile, chainId=(l1^rollupVersion)) scheme already identity-partitions, so upstream's partition redesign needs no structural change — document this equivalence in the module doc. Adopt `SqliteEncryptionError` for typed wrong-key detection; evaluate whether #24647 (handle-release fix) lets the 30s bounded-open comment soften (keep the bound).
- Confirm `createPXE options.store` injection unchanged (verified in tarball); re-run the derivation KATs (regime-B vectors are version-pinned to 5.0.0 tarballs — the KDF chain is spec-frozen; 5.0.1 must NOT change addresses. If any vector shifts → HARD STOP, that's a protocol-breaking patch and the plan is wrong).
- Fee-payer setup assert (#24479): our claim fix already complies; re-run fee e2e.
Gate: unit suites green incl. derivation vectors byte-identical; opfs e2e spike green vs sandbox.

### B3 — Noir surface
- `Nargo.toml` ×3: aztec-nr + token_portal_content_hash_lib → tag `v5.0.1`; token dep → `AztecProtocol/aztec-standards` tag `v5.0.1` (verify token-contract directory path in that repo; it replaces alejoamiras/ecosystem-tooling).
- `aztec-up install 5.0.1`; `compile.sh` → 5.0.1; recompile all three; commit targets.
- Portal-fork pins: L1 untouched this arc (no reset, no l1-contracts change claimed) — re-verify `FORKED_PORTAL_KECCAK`/`PORTAL_PIN` unchanged; if the 5.0.1 l1-contracts toolchain shifts hashes, regenerate consciously.
Gate: compile clean; keystone `nargo test`; drift detectors run — EXPECT verify:deployments RED + FPC tripwire RED (the standards+fee-payment artifacts changed) → this CONFIRMS the redeploy scope; anything ELSE red = stop.

### B4 — FPC 5.0.1 identity + gate policy rework
- New descriptor: fee-payment 5.0.1 artifact sha256 `94fa4c71…`, canonical salt (confirm 5.0.1 keeps `0x…01` — check the package's canonical-deployment notes; if upstream changed the canonical salt, follow upstream), re-derive `PRIVATE_FPC_ADDRESS`, conscious tripwire re-pin (both cross-checks).
- **Gate policy**: replace the exact-nodeVersion rule with protocol-anchored checks: exact `rollupVersion` match (from the intent probe) + artifact digest + address rederivation + live-class original==current; nodeVersion becomes a WARN on same-major.minor patch skew, RED otherwise. Rationale: nodeVersion is software, rollupVersion is protocol; a client-compat patch must not brick the gate, but a minor/major skew still stops. Update check-fpc-version.ts + its docs; adversarial review this specifically.
Gate: gate script green against the LIVE 5.0.0 node with the 5.0.1 artifact (WARN path exercised); private-fuel tests green at the new pins.

### B5 — Coupled redeploy (drift-triggered; intent tooling; NO chainId cascade — no reset)
- New arc `intent.json` (live-intent build: same signer, fresh caps ≤0.5 ETH / ≤0.25 WETH — seed pool for the NEW AZLO? NO: L1 AZLO + pools STAY (L1 unchanged). Only L2 + faucet redeploy ⇒ expected spend ≪ 0.1 ETH).
- Candidate-first: `deploy-bridge-testnet.ts` (new L2 proxy/token/bridge at 5.0.1 classes; L1 portal/fuel REUSED via config) → faucet `deploy:testnet` (new dripper/tokens) → FPC deploy at the new identity (`deploy-private-fpc-testnet.ts`).
- Candidate proofs (all): verify-l1 --config (config-consistency; L1 unchanged) · candidate smoke · fueled smoke · `fuel-testnet PRIVATE_RUNS=1` settle vs the NEW FPC · direct-FJ canary · then digest-pinned promotion → verify:deployments green · drip canary · balance/caps reconciliation.
- Old-set note: the 5.0.0-generation L2 set + old FPC stay live on-chain (testnet; no users) — no teardown.
Gate: per the intent tooling; five canaries + promotion + reconciliation green.

### B6 — PR-B delivery
Docs (UPDATE.md line + couplings; aztec-update skill: drift-triggered-redeploy worked example + gate-policy change; index.md), stale-5.0.0-ref sweep (live refs only), suggest `npm deprecate @alejoamiras/aztec-standards` to the user (their npm auth — never run it), PR to dev labels e2e:network+e2e:smoke, three checks green, `/code-review max --fix`, codex post-impl audit (targeted: lock redesign, fence, FPC gate policy, redeploy intent), merge.

## Release phase (standing authorization)
1. Promote `release: promote dev → main (5.0.1 line + restore-boot fix + standards migration)` (merge-commit).
2. Release PR merges; auto-unstick ON → tag + publish chain (run_network_e2e=true).
3. Live acceptance: nulo.sh serves the release; faucet.nulo.sh build-id == /build.json; chainId 1816023401 served; a drip through the PUBLIC site; a Fuel canary through the PUBLIC surface.
4. Merge-commit the sync PR (never squash). Backfill-signing reminder to user (AFK commits unsigned).

## Security & Adversarial
- **Fund-loss**: FPC identity move is the sharpest edge — the gate rework must not weaken the wrong-artifact-deposit stop; both old+new FPC live simultaneously (kill-switch: fuelClaim's fpc-address mismatch stop already refuses drifted claims). Deploy under intent tooling only.
- **Supply chain**: NEW trust decision — @aztec-foundation npm scope (verify repo provenance: AztecProtocol/aztec-standards, npm provenance attestation if present; record in plan). Min-age excludes re-open the window — enumerate exactly, date, follow-up removal.
- **Deadlock/resurrection**: the lock redesign is where prior epics died; every change lands with a test that FAILS on the old code; lock-order doc is normative.
- **Release**: auto-unstick + verify-live paths per runbook; no gate weakening ever.
## Assumptions
- Facts: probes above (node identity, npm versions/dates, tarball layouts, createPXE injection, digest change) — all verified 2026-07-17; regression localization lessons/phase-6.md; non-reentrant Lock service.ts:126-135.
- Inferences (attack these): the deadlock root-cause hypothesis (A1 verifies before fixing); "standards swap ⇒ only L2+faucet redeploy" (L1 stays — verified rollup/portal unchanged, but re-check DeployFuelLive bindings); 5.0.1 keeps canonical FPC salt 0x…01 (verify in B4); AztecProtocol/aztec-standards token-contract dir path (verify in B3); PXE_DATA_SCHEMA_VERSION unchanged (verify in B2).
- Asks: none open — all four Phase-0 decisions locked.

## Weakest points (self-critique)
1. A2's emit-after-release touches the TTL-close serialization invariant (the comment at service.ts:126 warns exactly here) — needs a dedicated test that TTL close still serializes.
2. The FPC gate rework trades exactness for availability; an attacker-controlled node could report a fake rollupVersion — mitigated by the intent tooling's L1 corroboration, but the STANDALONE gate loses some strength; consider requiring intent-verify to have run first.
3. B5 assumes the existing deploy scripts handle "L1 reused, L2 fresh" cleanly (they did in the 5.0.0 arc via config reuse — but re-verify deploy-bridge-testnet's portal reuse path).
4. Release-phase public Fuel canary spends real (testnet) funds through the production UI — script vs manual click-through is undecided detail.