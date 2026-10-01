# Lessons — profile delete→import e2e matrix (fix/reimport-pxe-fence)

Tracking the leg-A (same-id, tombstone-collision) construction attempts. Leg B (different plain
secret) has been green from the first run.

## Attempt 1 — plain re-import of the same master: WRONG VEHICLE
Assumption: profileId is derived from the master → re-import collides with the tombstone.
**Disproved empirically**: three runs, three fresh ids (`fc916b13→4c4cf921`, …). Plain imports mint
RANDOM ids (`repo.generateUniqueId`), so this flow can never hit the tombstone. The production
same-id flow is **full-backup restore**: `profile/service.ts` restore keeps the backup's id while
it's free (a just-deleted id is free) + mints a fresh pxeGeneration — the code comment names the
same-id re-import case explicitly.

## Attempt 2 — synthetic full-backup, no network switch: baseline gas timeout
`buildSyntheticBackup` carries only the synthetic "Local Network" row; assumed it becomes active
post-restore. Baseline `waitForGasBalanceRendered` (step 1, pre-delete) timed out at 240s. No
"capture is stale" anywhere — not the fence.

## Attempt 3 — + switchToLocalNetwork after each restore: SAME baseline timeout
Mirrored leg B's network pinning; still the step-1 gas timeout. So the failure is in the
synthetic-restore path itself, not network selection. NB the working precedent
(backup-restore-sw-restart) asserts TOKEN rows after synthetic restore — the GAS card has never
been exercised on a synthetic-restored profile before this test.

## Attempt 4 — instrumented: dump card state + recent console errors on timeout (running)
`waitForGasBalanceRendered` now throws with `{hash, gasText, skeleton}` + the last 12 collected
console errors, so the next red run explains itself.

## Process notes
- The e2e:agent runner's exit code is masked when piped (`| cat`) — grep the vitest summary in the
  task log, never trust the notification's exit 0.
- `[aztec-node] Error: Address already in use (os error 98)` appears in PASSING runs too — node
  bind-retry noise, not a failure signature on its own (recalibrates the PR #371 flake diagnosis:
  the message alone proves nothing; the timeouts were the real signal).

## Attempt 5 — ROOT CAUSE (codex consult): synthetic chainId 31337 vs canonical local 0
The instrumented probe (`gasText: "— FJ"`, no console errors) + a codex xhigh consult landed it:
`buildSyntheticBackup` hardcoded `chainId: 31337`, but Nulo's canonical LOCAL chain id is **0**
(`network/service.ts` DEFAULT_SEEDS). `batchedViewSimulation`'s `assertLiveChainIdentity` exempts
ONLY chain 0 — 31337 reads as a REAL chain identity, gets compared against
`l1ChainId XOR rollupVersion`, and throws on EVERY read → both fee-juice legs fail → perpetual
"— FJ". Classification: (c) harness error (pre-existing in the builder; invisible until this test
became the first to view-sim on a synthetic-restored profile). My sw-restart "counterexample" was
false — that test restores a REAL export, not a synthetic one.

Fix: builder rows → `chainId: 0`; `deriveNuloAccountAddress(master, 0)` in all three callers
(backup-migration, import-paths, profile-reimport-matrix). Codex explicitly warned AGAINST adding
account-state slices instead ("could merely warm PXE and obscure the invalid fixture").

Corrections to my earlier notes: H1 (account not registered in PXE) false — batchedViewSimulation
registers the account on demand; H2 (FeeJuice not registered) false — resolved from the compiled-in
artifact catalog + registered on demand; account-state restore replays senders + non-protocol
contracts, never account registrations, and skips protocol addresses 0–6.
