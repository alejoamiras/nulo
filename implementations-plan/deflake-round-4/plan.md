# deflake-round-4 — crash-truth for the mid-restore kill test (v2, post-audit)

**Tier**: `/blueprint light` (single codex audit → conditional approve; the four blocking
conditions are folded below and marked ⟨audit⟩). **Worktree** `deflake-round-4`; PR branch
`deflake-r4/crash-truth`.

## Why this arc exists

`backup-restore-sw-restart.test.ts` asks the repo's most user-critical e2e question — "does
a crash mid-backup-restore leave the wallet broken?" — and currently cannot answer it:

- Round 3 proved its kill primitive (`Runtime.terminateExecution`) never terminated the
  worker; the crash it describes never happened in CI (`deflake-round-3/lessons/phase-3.md`).
- The round-4 experiment (branch `deflake-r4/sw-restart-real-kill` in the round-3 worktree,
  commit `7780a216`) swapped in the real kill (`worker().close()` + `targetdestroyed`
  identity wait): 5/5 solo runs confirmed genuine cold boots, and the `rolled-back`/`torn`
  fork was NEVER observed — not in the original 45s window, not in a 240s measurement
  window (240 050 ms / 240 049 ms, both fully consumed). The re-import leg (whose 300s
  wait lapsed two certification campaigns) never entered. The test passed ~88s on the
  retain-then-reopen path every time.
- Codex review of the experiment (session `01a001ce…`): rollback IS the designed
  pre-finalize behaviour (`useFullBackupImport.ts:719` deletes the orphan when
  `createdProfileId !== undefined && !finalizeStarted`); the experiment never pinned WHICH
  side of the finalize boundary the kill landed on ("profile row exists" is a landmark,
  not a phase); and the fork predicate is blind to several real terminal states (failed
  delete without a tombstone, finalize entry clearing the marker, retained post-finalize
  failure). Prescribed shape: phase-aware kill + state-machine assertion; **a
  restore-pending marker surviving a confirmed PRE-finalize disconnect with the page
  alive is a product failure, not a designed retain leg**.

So the arc's deliverable is a test that (a) kills at a NAMED phase, (b) asserts the
per-phase contract the product actually defines, and (c) thereby answers the open product
question with evidence either way.

## Facts (verified against dev @ `1ad3ce84`)

1. `useFullBackupImport.ts:217` sets `restoreStatus = "progress"`, and the field stays
   flat until `finished`/`failed` — useless for phase detection (established in round 3's
   plan audit; re-verified).
2. Phase boundaries exist as plain code sequence: profile created (`createdProfileId`
   assigned, :386) → network restore (:398) → token restore (:562) → per-service restore
   loop → `finalizeStarted = true` (:656) → `finalizeRestore` (:658) → account-state
   restore → `runImportChainSync` → finished. The pre-finalize catch rolls back via
   `deleteProfile` (:719 comment block; guard `createdProfileId !== undefined &&
   !finalizeStarted`).
3. The composable is consumed ONLY via `useProfileImportFlow`
   (`useProfileImportFlow.ts:224,301`), whose consumers are `popup/pages/import.vue` and
   `onboarding/pages/import.vue`. It has a colocated unit test
   (`useFullBackupImport.test.ts`).
4. Port-based service clients reject pending calls and reconnect on disconnect
   (`packages/extension-messaging/src/background/client.ts:67`), so the page's catch
   should fire promptly after a real kill — the open question is what happens after it
   fires (does `deleteProfile` complete against a cold-booting worker?).
5. Round 3's plan v4 already audited a `restoreStage` observability design (sub-phase 3a,
   three codex rounds) — this arc implements that design, narrowed to this test's needs.

## Design

### Product: `restoreStage` (observability + one new POSITIVE signal)

- `restoreStage: Ref<RestoreStage>` in `useFullBackupImport` — `RestoreStage` an exported
  string-literal union, not a bare string ⟨audit⟩ — advancing at the real boundaries:
  `"" → picked → restoring:profile → restoring:networks → restoring:tokens →
  restoring:services → finalizing → restoring:account-state → chain-sync →
  finished | failed"`. Set strictly forward in the success path; the pre-finalize catch
  sets `rolling-back` on entry, then `rolled-back` after `deleteProfile` resolves or
  `rollback-failed` if it throws — synchronous ref assignments only, NO new awaits in the
  catch path ⟨audit⟩. **The rollback stages are the one genuinely new
  signal** — they give the test (and any future debugging) a direct causal marker for
  "the designed rollback dispatched/completed/failed", instead of inferring from
  tombstone side effects.
- Returned through `useProfileImportFlow`, bound as `data-restore-stage` on both import
  pages' root `Flex`, with a passthrough/binding pin so the wiring cannot silently drop
  ⟨audit⟩. No logic reads it; observability only.
- Pins: extend `useFullBackupImport.test.ts` — (a) happy path advances through the stages
  in order, never backward; (b) a pre-finalize service failure lands
  `rolling-back → rolled-back` and `deleteProfile` was called; (c) a post-finalize
  failure NEVER enters `rolling-back`; (d) `deleteProfile` rejection lands
  `rollback-failed`.

### Rendezvous: a restore gate, because stage OBSERVATION is not synchronization ⟨audit⟩

The audit's critical finding: on the synthetic backup the `restoring:services` phase can
be one sub-second `restore([])` (the backup's service slices are near-empty —
`import-drivers.ts:285`), chain-sync can return immediately
(`importChainSync.ts:53`), and Vue can coalesce transient stages before Puppeteer
samples. Passively watching `data-restore-stage` therefore RACES the anchor, and a missed
anchor must never be classifiable as a product failure. Stages remain what round 3's
audit approved them as — diagnostics — and the kill anchor becomes a real latch:

- **`ChromeStorageRestoreGate`**, a sibling of the existing `ChromeStorageProofGate`
  (`src/e2e/chrome-storage-proof-gate.ts` — presence-keyed `chrome.storage.session`,
  event-driven release, loud safety timeout, `remove()` on release). Key
  `nulo:e2e:restore-gate`; the stored value names the hold point:
  `{ at: "service-restore" }` (inside the CONTACT service's `restore` handler — late in
  the per-service loop, semantically inert for the empty slice, so a kill there exercises
  rollback of the earlier restored slices) or `{ at: "account-state" }` (inside
  `AccountStateService.restore`, SW-side, unambiguously post-finalize). **Armed ≠
  reached** ⟨audit r2⟩: the handler ACKNOWLEDGES entry by transitioning the record to
  `{ at, held: true }`, and the test kills only after observing `held: true` — writing
  the key merely arms the gate. The test removes the key in its `finally` — the gate's
  safety timer runs inside the worker being killed and cannot clean up after itself.
  Implementation is a dedicated `RestoreGate` class following the proof-gate pattern;
  `ChromeStorageProofGate`'s public API and tests stay untouched ⟨audit r2⟩.
- Armed exactly like the proof gate: constructed only under the statically-false-in-prod
  `E2E_PROVERLESS` constant (tree-shaken; no new build flag), the key literal added to
  `_build-extension.yml`'s negative bundle grep, and the test joins the proverless-armed
  STUB family (`cancel-mid-prove` precedent) — which matches CI reality, since the
  sharded network jobs run proverless.
- **Test-side disconnect probe** ⟨audit⟩ — no product change: before killing, the import
  page opens `chrome.runtime.connect({ name: "profile" })` — a name the SW's service
  collection actually claims, so the connection is owned and `onDisconnect` is meaningful
  ⟨audit r2⟩ — sends nothing on it, and records the timestamp `onDisconnect` fires. The
  test asserts the probe has NOT fired before the kill. `disconnect-observed` separates "Chrome
  delivered the port disconnect" from "the catch/delete failed" — without it, a stuck
  stage conflates primitive behaviour, catch dispatch, and deletion failure.

### Test rewrite: two deterministic scenarios replacing one nondeterministic test

**Scenario A — pre-finalize crash (the product question).** Assert the synthetic
backup's `contact` slice is an array (fixture precondition — a missing slice would make
"gate never reached" recurring mechanics noise ⟨audit r2⟩); arm the gate at
`service-restore`; drive the import; kill only after `held: true`, keep the page open. Then the state
machine, watching the stage attribute + storage + the disconnect probe:

- Terminal `rolled-back` reached (observing transient `rolling-back` is NOT required —
  DOM sampling may skip it ⟨audit⟩) + profile row gone + restore-pending marker gone →
  the designed retry (re-import) runs — the 300s-wait leg, now entered DETERMINISTICALLY
  on every A run instead of by race — and converges on the on-chain assertions.
- Stage stuck pre-finalize past the budget, page alive → classify by the probe:
  `disconnect-observed` + no rollback → **the product-bug diagnosis** (catch never
  dispatched, or `deleteProfile` never completed; dump stage/marker/rows/probe
  timestamps). No `disconnect-observed` → **inconclusive test mechanics** (the kill
  primitive or Port timing, not the wallet) — reported as such, never as a product
  verdict ⟨audit⟩.
- `rollback-failed` → FAIL, naming the delete error.

**Budget derivation ⟨audit⟩** — structural, not sampled: the catch's entry ceiling is the
active RPC's own 60s timeout (the reject-on-disconnect path should beat it by orders of
magnitude, but the timeout is the guarantee), and `deleteProfile` against a cold-booting
worker carries its own 60s ceiling → the state machine's outer budget is 60s + 60s +
margin, stated as that sum in the code. The instrumented runs still record actual
elapsed times (diagnostics + the ledger), but the budget does not derive from three fast
local observations.

**Scenario B — post-finalize crash (the retain contract).** Assert the backup carries
reachable account-state work (fixture precondition ⟨audit r2⟩); arm the gate at
`account-state` (post-finalize by construction); kill only after `held: true`. **Assert the
restore-pending marker is ALREADY ABSENT before the kill** — `finalizeRestore` clears it
at entry (`service.ts:1561`) — then: no rollback stage ever appears, and the reopen path
lands on RECOVERY (unlock → convergence) only. **A torn refusal here is a FAILURE, not an
accepted branch** ⟨audit⟩: at post-finalize the marker is gone, so a matching torn screen
would mean corruption or a stale marker, exactly what this scenario exists to catch.

Both scenarios end on the existing on-chain convergence assertions. The old
single-test "either way" framing and its 45s fork window are deleted; the classifier
becomes exact-stage-driven. Both scenarios run the real kill from the experiment
(destroyed-target identity wait), lifted verbatim.

**Timing discipline**: budgets derive from the protocol's own ceilings (above), not from
local samples; the instrumented 3× solo `NULO_E2E_RETRY=0` runs record actual elapsed
times for the ledger and to sanity-check the derivation. The re-import leg's existing
300s wait is left untouched this arc unless scenario-A evidence indicts it structurally —
any change to it is its own argued commit.

## The product question, and the delivery branch it forces ⟨audit⟩

Scenario A, run on the BRANCH first, terminates in exactly one of:

- **rollback completes** → the flake's history is fully explained (the old fast-rollback
  outcome was reachable only via the fake kill's live worker; the real path works,
  cold-boot-shaped) and the wallet is CLEAR of the suspected bug — ledger the evidence,
  deliver the PR normally.
- **rollback never dispatches/completes (with `disconnect-observed`)** → a real product
  bug, reproduced deterministically with stage-level evidence. **Delivery STOPS.** The
  finding goes to the owner with the choice codex framed: fix the product first and then
  land this test as a required gate that guards the fix, or hold scenario A unmerged
  until then. What is ruled out in advance: weakening A to a report-only green, and
  merging an always-red required gate while the fix is out of scope. (Codex's position,
  adopted: the eventual required test SHOULD red on this bug — but only once landing it
  red is a decision someone made, not a side effect.)
- **inconclusive (no `disconnect-observed`)** → the kill/Port mechanics need their own
  investigation before any product claim; deliver nothing beyond the diagnosis.

## Delivery

> **SUPERSEDED (2026-08-18) by [`fix-plan.md`](fix-plan.md).** The evidence
> campaign this plan produced (`lessons/phase-1.md`) confirmed two product bugs,
> so delivery became a 4-PR `gh stack` carrying both fixes — the single-PR shape
> below predates the findings and is kept for the record only.

One PR (`deflake-r4/crash-truth` → dev): composable + two bindings + pins +
`ChromeStorageRestoreGate` (+ its two SW-side hold points + the bundle-grep literal) +
test rewrite + ledger updates. The gate is a deliberate scope addition over v1, forced by
the rendezvous condition; it follows the proof-gate pattern verbatim and is the smallest
mechanism that makes the kill anchor deterministic. The extension paths-filter trips both suites on its own; labels added
anyway for explicitness. Codex iterate-until-approve + dual-lens review, fixes as separate
commits. **No Phase-6 certification campaign** — that was a round-3 goal requirement, not
a standing rule; normal required gates apply (owner may override).

Ledger changes on close: the "importFullBackup 300s — required work" entry is reshaped to
this arc's outcome (the staged-wait redesign was aimed at the wrong layer — the entry
condition was the fake kill); the "two network tests on the broken primitive" entry drops
this test; scenario-A's verdict recorded either way.

## Gates

| Step | Gate |
|---|---|
| Composable + pins | `bun run typecheck` + `bunx vitest run src/composables/useFullBackupImport.test.ts` (from `apps/extension`; `bun run test` is the whole extension suite — name the exact file) + `bun run audit:vue` |
| Test rewrite (instrumented) | 3× solo `NULO_E2E_RETRY=0` via `e2e:agent`, this file only |
| Budgets set from data | 3× solo retry=0 re-proof + full solo network sweep (proverless full, default as named import files) + armed smoke (the smoke import tests share the composable) |
| PR | normal required gates; codex iterate-until-approve |

## Security & Adversarial Considerations (compact, per light tier)

- The stage ref is write-only observability; no control flow reads it, so no new
  attacker-influenceable branch. The catch's stage writes sit inside the existing
  rollback branch. Backup blobs remain hostile inputs — unchanged parsing, no new fields
  read from them.
- The rollback-failed stage must not leak sensitive detail into the DOM attribute: stage
  values are a fixed enum, never interpolated from errors.
- Risk of the arc itself: mis-classifying a product bug as designed behaviour. Mitigated
  by the exit criterion being binary with stage-level evidence, and codex review of the
  verdict before the ledger records it.
