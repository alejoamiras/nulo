# Fable plan audit — round 1 (v1 plan)

Verdict: conditional approve (7 conditions — all adopted in plan v2).

Headline findings (full transcript summarized; HIGH items verbatim-paraphrased):
- F1 HIGH: AuthRegistry approvals are SINGLE-USE (consume burns them) — v1's lifecycle proved revoke vacuously; redesigned with fresh-grant-per-step + unconsumed-grant revoke + non-vacuity gate.
- F2 HIGH: "builder auto-injects grant" was false — `add_public_authwit` has zero users; playground's wallet-sdk surface can't emit it. Now plan v2 Phase 2.
- F3 HIGH: grant+consume bundled in one tx inverts the negative assertions — separate panel buttons mandated.
- F4 MED: token is aztec-standards `transfer_public_to_public`, not "canonical aztec-nr transfer_in_public".
- F5 MED: anvil-start soft-skip path (`global-setup.ts:288-296`) equally ungated — folded into Phase 1.
- F6 MED: e2e lockfile reuse would serve stale config — moot under Outline B.
- F7 MED: committed transpiled artifacts lack source↔artifact binding — moot under Outline B.
- F8 MED: follow-ups held hostage behind risky phases — front-loaded to Phase 1.
- F9 MED: bail-out trigger aimed at the wrong failure class — replaced with Phase-2 STOP-and-surface.
- F10-F13 LOW: locked-wallet cancel pin (adopted); residue bounded if fresh account (adopted); gate cwd nits (adopted); fact drift (corrected).
- Outline choice: B proves identical lifecycle properties; multi-account precedent exists (`fixtures/helpers.ts:226,244`, `multi-account-from.test.ts`).
