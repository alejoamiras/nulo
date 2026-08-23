BREAKS — fresh session over the full PR diff (crypto arc + the phase-2 navigation-race fixes), weighted at the least-reviewed nav commits.

- Critical (rejected in r8): re-opened the adjudicated derived-only residual — a password-envelope MAC mismatch should hard-fail unlock, arguing the anti-DoS rationale is weak since `guard`/`secret` corruption already bricks unlock.
- High (confirmed): `app.vue` lock branch put ALL lock cleanup (closeAll, `isLogined=false`, activity clear, route push) behind a fallible `getProfiles()` — one transport rejection at lock time left the popup rendered as authenticated over a closed session, with no later cleanup path.
- Medium (confirmed): the "navigate first" unlock fix was incomplete — the submit handler still exits its `isLogined` poll AFTER the watcher's push, and its own unconditional push could re-yank a user who navigated in the ≤100ms gap.
- Low (confirmed in-diff): `refreshBalances()` fire-and-forget rejection unhandled; also flagged the PRE-EXISTING `utils/core.ts` refresh-then-disconnect cancellation (out of scope here, reported separately).

Q-sweep: preimage grammar injective even for hostile/dotted restored ids (id is first, trailing fields dot-free); numeric key-identity canonicalization alias-free; export-preselect guard sound. Verified sound: v3 HKDF label + field order, requested-id at every verify site, passkey fingerprint checks, finalize snapshot, strict entity-key matching.
