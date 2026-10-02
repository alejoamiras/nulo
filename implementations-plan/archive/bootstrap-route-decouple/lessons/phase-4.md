# Phase 4 lessons — restore-pending marker + torn-unlock refusal

## What landed

`RestorePendingRepository` (raw storage, tombstone fail-closed discipline: existing-but-
undecodable = `corrupt`, never absent, never auto-removed); marker written marker-BEFORE-row
in BOTH restore branches with row-write compensation; cleared at `finalizeRestore` ENTRY, on
`deleteProfile`, and in the crash-resume deletion cleanup; checked at the `openSessionVerified`
chokepoint (BEFORE the integrity delegate — precedence by ordering) throwing the new
`RestoreTornError` (registered in extension-messaging with a reconstruction-switch entry +
round-trip test), and on the silent rehydration path by returning `undefined` (silent close —
throwing there would abort service init, round-2 codex H2). Generation mismatch = stale
leftover → lazy purge. auth.vue catches the typed error and renders the explanation
(`auth-restore-torn`) beside the existing Delete-profile affordance; cleared on profile switch.
`backup-restore-sw-restart.test.ts`'s outcome-matrix comment consciously updated: the
close-racing-dispatch phantom that used to masquerade as RECOVERED now fails loudly at unlock
with the marker + torn message in the dump.

## Gotchas

- **jsdom + `<Transition>` leave hangs on rAF**: asserting an element DISAPPEARS inside a real
  `<Transition>` parks on `requestAnimationFrame` that vitest never fires — stub `Transition`
  (`global.stubs: { Transition: true }`) when testing leave paths.
- A component-ref `Input` stub needs a `focus()` method (options-API `methods`) or the page's
  `onMounted` focus call TypeErrors as an unhandled rejection.
- Error PRECEDENCE is contract: the contract loop's "Network not found" must win over the
  address-parse error (a reorder flipped a pinned message — restored network-first).

## Gate evidence (2026-08-12)

Units 4014 green (incl. 8 new profile-integration crash-boundary pins: marker-present-post-
restore, torn unlock refusal, finalize-throw recovery preserved, no-op finalize clean, corrupt
fail-closed, generation-mismatch purge, delete clears, rehydration-close without init failure);
repository 5/5; errors round-trip; auth component 2/2; lint + typecheck exit 0.
Smoke suite: 25 files / 82 tests green, zero retries — run as FOUR FOREGROUND CHUNKS after
three consecutive background-task SIGTERM kills ("Polite quit request" seconds after vitest
launch; an 8-min sleep probe survived, so the reaper targets long vitest runs specifically —
chunked foreground + setsid-detached runs are the workaround, logged for the ledger of tricks).
Targeted network pair (`backup-restore-integrity` + `backup-restore-sw-restart`) via a
setsid-detached `e2e:agent` run, NULO_E2E_RETRY=0, SOLO: **2 files / 4 tests green attempt-1**
(196s; stack booted from the ports registry, teardown clean). NOTE: the pair ran on the
pre-codex-fold tree; Phase 5's full pre-push gates re-validate the folded tree end-to-end.
