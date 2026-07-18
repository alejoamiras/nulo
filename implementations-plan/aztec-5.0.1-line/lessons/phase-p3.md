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
**Conclusion**: the network redness is dominated by a CI sandbox-instability window (port-collision
storm), not a code regression — smoke (no sandbox) green + the fixture-setup location of the timeouts
are the tells. Action: RED-policy re-run in a calmer window. IF `opfs-storage`/`backup-restore-
integrity` keep failing at the SAME fixture-setup step once the port storm clears, escalate to a
real on-chain/fixture investigation (reproduce `tokenReadyExtension` locally under `e2e:agent`). Do
NOT hand-wave a green — confirm on a clean run before P7 merge.

## Gate (per plan)
Full v2+audit test matrix (incl. stale-first-after-restart-of-tombstoned-profile) + `test:all` + lint;
the three restore e2e GREEN locally. **The e2e portion is CI-bound on this host (SW eviction under
multi-agent load — see `phase-p2.md`); composition/unit tests run locally.** Folds landed so far are
fully unit-validated (aztec-runtime 66 passed, typecheck 0, lint 0).

`LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p3.md`
