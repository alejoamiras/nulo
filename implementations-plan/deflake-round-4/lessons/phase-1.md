# Phase 1 lessons — rendezvous implementation + evidence runs

## Evidence run 1 (both scenarios first exercised end-to-end)

- **Scenario A** reached the state machine but terminated at `rollback-failed`, not
  `rolled-back` — the catch DISPATCHED the rollback and `deleteProfile` threw. The
  test lacked the plan's "name the delete error" branch, so the assertion diff
  (`expected 'rollback-failed' to be 'rolled-back'`) carried no evidence. Fix: an
  explicit `rollback-failed` branch that throws a `PRODUCT FINDING` error carrying
  console/page errors, a storage dump, and `sinceKill`.
- **Scenario B**'s crash contract fully held (marker absent pre-kill, no rollback
  stage after the kill, terminal state reached, no torn screen, ordinary unlock)
  and then failed in the CONVERGENCE helper: `switchToLocalNetwork` timed out at
  30s in the post-switch account-setup wait. Misdiagnosed as a cold-boot budget
  problem; "fixed" by parameterizing the timeout (30s → 120s for this caller).

## Evidence run 2 (diagnostics armed)

- **Scenario A, attributed.** The finding fired with evidence: outcome
  `rollback-failed` at `sinceKill=811ms`, storage still holding the orphan profile
  row + `restore-pending` marker, `pageErrors=[]`, and ~50 identical
  `Unchecked runtime.lastError: Could not establish connection. Receiving end does
  not exist.` console entries. Mechanism (from
  `packages/extension-messaging/src/background/client.ts`):
  - `onDisconnect` → `disconnect()` → `connect()`. `chrome.runtime.connect`
    returns a Port synchronously even with no live worker, so the client flips to
    `Connected` on a doomed port; the port dies, `onDisconnect` fires again → a
    tight reconnect churn with **no backoff** (the `sleep(1000)` only guards a
    *throwing* `connect`). Each churn iteration logs one unchecked
    `Receiving end does not exist` — the ~50 entries in <811ms.
  - A NEW call issued during the respawn gap (`deleteProfile` from the rollback
    catch) is posted into a doomed port and rejected milliseconds later by
    `rejectAllPending` with `Error("Client disconnected")`. Nothing queues or
    waits for the worker to actually come back.
  - The delete error was invisible in `consoleErrors` because the e2e fixture
    FILTERS "Client disconnected" as known-benign noise — its absence (while the
    stage proves the catch's `console.error` ran) is itself the confirmation that
    the rejection was the client-disconnect error, i.e. transport, not a service
    refusal.
- **Scenario B failed at the SAME wait with the 120s budget** — proof the run-1
  diagnosis was wrong and the timeout raise was never the fix (the hard rule
  exists for exactly this reason). Real mechanism: the restored active-network
  pointer is written during `restoring:networks` (before B's kill point), so the
  wallet REOPENS on Local Network; the "switch" is a repeat switch. But
  `switchToNetwork` snapshots the header chip's text BEFORE it has rendered on a
  fresh popup (`""` ≠ "Local Network" → misclassified as a real switch), and the
  real-switch wait demands `activeAccount` flip AWAY from the funded address —
  which the target chain re-derives. Unsatisfiable predicate; any budget fails.

## Fixes for run 3

- `switchToNetwork`: causal render wait (header chip exists with non-empty text)
  before the BEFORE snapshot; the `setupTimeoutMs` parameterization REVERTED
  (a budget raise justified by a wrong diagnosis must not survive).
- Scenario B: no switch at all — asserts the wallet REOPENED on Local Network
  (the restored active-network pointer surviving the crash is part of the retain
  contract) before the balance convergence.
- Scenario A's `rollback-failed` branch: before throwing the finding, clears the
  gate (the armed record lives in `chrome.storage.session`, which OUTLIVES the
  killed worker and would re-park a retry) and empirically measures the designed
  backstop — re-import must hit the duplicate branch, delete the orphan on a live
  worker, and converge. The finding message now carries `recovery-backstop=`.

## Evidence run 3 (helper fix + first recovery probe)

- **Scenario B GREEN in 20s** — the repeat-switch misdetection diagnosis was
  correct; the wallet reopens on Local Network with the funded account and the
  balance convergence completes. B's full crash contract is now proven end to end.
- **Scenario A** fired the finding as designed (`sinceKill=798ms`, orphan +
  marker surviving), but the recovery probe failed for a TEST reason:
  `gotoPopupImport` waits for `#/popup/register`, the FRESH-INSTALL route. With
  the orphan present the popup boots to **auth** — the probe was testing "is the
  store back to fresh-install shape" (it isn't; that IS the bug), not "can the
  user recover".
- `consoleErrors=[] (x0)` in the finding message: the fixture RESETS the capture
  array every time a helper attaches to a new page, so the recovery page's
  `openPopup` wiped the churn evidence. Attribution was already established in
  run 2; noted so nobody reads the empty array as "no churn".
- The REAL designed recovery path (all verified in source): popup boots to auth →
  unlock attempt throws `RestoreTornError` (`openSessionVerified`'s torn gate —
  same-generation markers always refuse; only stale-generation purges) → torn
  message copy says "delete it below and re-import" → footer `auth-reset` →
  forgot-password popup → `/popup/settings/security/reset` (`isAuthRequired:
  false`) → 3 checkboxes + profile-name confirm → `deleteProfile` on a live
  worker (clears the marker last, service.ts:934-938) → `/popup/register` →
  re-import. Run 4's probe drives exactly this, mirroring the existing
  `passkey-paths.test.ts` reset ritual.

## Evidence run 4 (real recovery path driven)

- **Scenario B green again (20s)** — two consecutive greens on the fixed contract.
- **Scenario A**: finding reproduced a third time (`sinceKill=784ms` — 811/798/784,
  metronomic). The recovery probe got THROUGH the designed path's front half:
  torn-unlock refusal shown, forgot-password → reset ritual completed,
  `deleteProfile` succeeded on the live worker, register reached with zero
  residue (no profile rows, no markers), import page reached. Then the
  **re-import itself stalled 300s** (`importFullBackup`'s success-hash wait) with
  ZERO console errors on the import page — a quiet hang, not the errors screen
  (whose path console.errors "Restore errors:").
- Discriminator for run 5 (probe catch now captures hash/stage/errors-screen):
  - `restoring:services` → gate-clear failure or service RPC (bounded suspects)
  - `restoring:account-state` → SW→offscreen/PXE link never healed after the
    respawn — a SECOND crash-recovery defect (stale offscreen from the killed
    worker's browser session serving nobody)
  - `finalizing`/`chain-sync` → the app's bounded recovery wait misbehaving
  - `finished` + import hash → routing/login-event breakage
  - `failed` + errorsScreen → helper contract gap (errors screen never
    auto-routes; helper only waits for the success hash)

## Evidence run 5 (stall attributed — helper contract, not a product hang)

- Diag from the probe's catch: `hash=#/popup/import, stage="finished",
  errorsScreen=true`. The recovery re-import COMPLETED its pipeline (stage hit
  `finished`) and parked on the skip-errors summary screen — which never
  auto-routes; Continue is a user step. `importFullBackup` only waits for the
  success hash, so it starved 300s against a completed import. Scenario B's
  terminal handling already models this dual shape; the probe now does too
  (accept the summary, CAPTURE its text, click Continue, then prove full
  convergence: funded active + fresh 1,000 TST balance row + token card).
- Same latent landmine noted for scenario A's DESIGNED-retry path (post-
  rolled-back, unreachable until the product fix lands): it deliberately keeps
  strict `importFullBackup` semantics — after a CLEAN rollback the retry should
  be a CLEAN import, and an errors screen there means residue. Revisit wording
  if the owner picks the re-spec option.
- Open sub-question run 6 answers: what the skip errors SAY on a
  post-delete re-import (candidates: PXE/offscreen residue from the crashed
  first import — the offscreen survived the kill; deleteProfile's PXE purge is
  generation-fenced).
- Scenario B: third consecutive green (20.4s).

## Evidence run 6 — PRODUCT BUG #2 (same-id re-import is PXE-fenced dead)

- Scenario B: fourth consecutive green (22s). Scenario A: finding reproduced a
  fourth time (`sinceKill=799ms`; 811/798/784/799 — metronomic).
- The recovery probe's FRONT half now fully works: torn-unlock refusal → guided
  delete ritual → clean store → re-import COMPLETES and routes to general with
  the funded account active. Then `waitForFreshBalanceRow` failed after 14
  refresh kicks with the smoking gun on the row itself:
  `syncFailure: "pxe op rejected: profile f82a69e8 is deleted (generation
  superseded) — the capture is stale"` — and f82a69e8 is the SAME id the delete
  ritual erased (full-backup restore recreates the profile under its original
  id). The restored balance row holds the right value but its `updatedAt` never
  advances: the recovered wallet is SYNC-DEAD.
- Mechanism (all verified in source):
  1. `deleteProfile` → offscreen lifecycle map (`packages/aztec-runtime/src/pxe/service.ts:161`)
     records `deleted(G1)` for the id. In-memory — lives until the offscreen
     document restarts (browser restart), not the SW.
  2. The re-import mints a FRESH generation G2 (profile service restore paths
     call `mintPxeGeneration()` — service.ts:1398/1486). SW-side state is clean.
  3. Every PXE op captures G2 and hits `assertGenerationCurrent`
     (pxe/service.ts:797): map says `deleted(G1)` → `kind !== "live"` → thrown
     as "the capture is stale", and the error DELIBERATELY omits the
     `PXE_STORE_KEY_MISSING` marker (comment: "re-provisioning cannot rescue a
     stale-generation op").
  4. The client's provisioning retry (pxe/client.ts:158) fires ONLY on that
     marker → `provisionChainStoreKey(G2)` never runs → the map never becomes
     `live(G2)` → step 3 repeats forever.
  The irony: `provisionChainStoreKey` itself HANDLES this exact case —
  "deleted(different gen): install (… a re-imported profile going live over a
  dead one)" (service.ts:742-743) — but no op can ever reach it. The op fence
  conflates "capture from the ERASED incarnation" (gen == G1, correctly dead
  forever) with "capture from a SUCCESSOR incarnation" (gen != G1, should be
  provisionable like `unseen`).
- Blast radius: NOT crash-specific. Any delete + full-backup re-import of the
  same profile in one browser session hits it — including the product's own
  forgot-password instruction ("Delete this profile, then re-import"). Seed/key
  re-imports mint a fresh profile id and are unaffected. Cross-browser-restart
  re-imports are unaffected (in-memory map).
- Consequence for the arc: even with bug #1 (transport) fixed, scenario A's
  designed contract (rolled-back → retry → converge) would still fail its
  freshness assert — the designed retry IS a delete + same-id re-import. The
  two bugs gate the same contract.

## Codex consult — two-finding review (session resumed, response-3)

Verdict: "both findings are real; Finding 2 is nearly airtight and HIGH.
Finding 1's transport diagnosis is compelling but needs one final discriminator
before calling it airtight. Prefer Option A, delivered in stages."

- F1 gap codex named (accepted): absence-from-filtered-console is not positive
  proof; ~800ms also doesn't exclude a fast-respawned worker rejecting with
  "deletion coordinator not ready" (service.ts:899). Remedy implemented: an
  UNFILTERED console tap on the import page + a diagnostics settle before the
  read; the finding now carries `deleteRejection=` (non-churn tail) +
  `reconnectChurn=` count. Run 7 discriminates.
- F2 asks (accepted): log both generations (readProfileGen in the control's
  failure message) and reproduce the ordinary no-crash delete → same-id
  re-import INDEPENDENTLY before asserting blast radius → new control scenario
  in the same file. Falsifiers codex named: an offscreen restart not curing it,
  or direct G2 provisioning not restoring sync, would break the lifecycle-map
  attribution (restart-cures leg deferred to fix verification).
- F2 fix refinement (adopted into the recommendation): don't just pass
  deleted(different-gen) captures — throw the provision-required marker so the
  SW's durable-row check supplies authority, AND require
  `provision.generation === captured` so an unrelated provisioning side effect
  can't rescue a G2 op under a current G3. Pin deleting-any, deleted-same,
  live-different, and the G2→G3 race.
- Severity correction (verified: TokenCard.vue:75/126): F2 is NOT fully silent —
  the card dims the amount and shows "Couldn't refresh"
  (`token-balance-failed`). Still HIGH: no guided remedy; nothing suggests the
  browser restart that actually cures it.
- F1 fix guidance (adopted): never generically replay disconnected RPCs
  (ambiguous, non-idempotent calls may have committed); queue only NEWLY issued
  calls behind a real worker handshake, or make the rollback durably
  deferred/idempotent.
- Owner options: A-staged (fix F2 first + regress independently, then F1, then
  land green); B is containment-only with explicit tracking; C is "unavailable
  today, not permanently dead" — my earlier "dead" phrasing over-claimed.

## Evidence run 7 — the control CONFIRMS F2; F1 closed by churn-timeline

- **Control scenario (no crash) RED with the full smoking gun**: same profile id
  `378c0397`, generation `6c9b3716…` before the delete, `7111bc15…` after the
  re-import — the restore DID mint fresh; the fence rejects the successor
  generation pre-provisioning. Ordinary delete + same-id re-import, zero kills
  anywhere, wallet sync-dead. The captured summary text also shows the fence
  bites DURING the re-import ("Profile import completed with some errors") —
  the account-state slice work is PXE ops under the fenced id.
- **Scenario B: fifth consecutive green.**
- **F1 discriminator resolved, but not the way planned.** The unfiltered tap
  captured 88 churn entries and ZERO other console output — the composable's
  `console.error` calls never reach the CDP console event stream at all (no
  build-level console stripping exists; parked as a fixture blind spot: the
  suite's consoleErrors capture sees browser-generated entries but apparently
  not app `console.*` from the popup page — worth an infra follow-up, since
  consoleErrors-based assertions are weaker than they look). The discriminator
  that DOES close F1: the churn count grows monotonically through and past the
  rejection moment (~50 at sinceKill=811ms in run 2; 88 at 1536ms in run 7).
  Every client's `chrome.runtime.connect` was failing "Receiving end does not
  exist" before, during, and after the deleteProfile rejection — no worker
  existed that could have refused the call (codex's "deletion coordinator not
  ready" alternative requires a worker serving the port). The rejection was
  client-local: transport. Codex's worker-side entry-sentinel remains available
  as belt-and-braces for the fix arc.

## Product-finding context (verified in source; codex-reviewed above)

- `deleteProfile` (`apps/extension/src/wallet/services/profile/service.ts:896`)
  has no unlock precondition visible at entry (ensureInitialized + deletion
  delegate) — the failure is transport-layer, not a locked-worker refusal.
- Backstops that bound the severity: `unlockProfile` throws `RestoreTornError`
  for a marker-bearing profile (auth page shows `auth-restore-torn`, session
  withheld), and `useFullBackupImport`'s duplicate branch deletes the orphan and
  retries on re-import.
