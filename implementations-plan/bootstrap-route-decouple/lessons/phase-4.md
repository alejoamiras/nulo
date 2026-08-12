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
Smoke suite + targeted network pair: *(recorded below when runs complete)*
