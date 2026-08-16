# Plan — dedup-ui-structure (Arc 6 of audit 2026-08-14-dedup-mid)

**Tier**: `/blueprint light` · **Branch**: `worktree-dedup-ui-structure` → PR into `dev`
**Scope**: Q-11 (dead popup CSS, 13 files), Q-09 (trimAddress adoption, 9 sites), Q-08 (IdentityStrip extraction, 3 implementations). All apps/extension UI structure; **zero visual delta is the hard constraint** (home-refresh surfaces are owner-locked; Q-09's 4-style separator inconsistency is REPORTED to the owner, not unified).
**Approval**: standing authorization via the owner's `/goal`. ELI5 omitted. Combined codex plan+diff session (same documented light-arc streamlining as arc 5 — all three changes carry complete instance lists from the consolidated findings; codex can reject the design and it gets redone).

## Facts (consolidated Q-08/Q-09/Q-11; instance lists re-derived by grep in this worktree before each phase)
1. Q-11: an md5-identical dead `.network`/`.icons`/`.item` style-module block sits in New/EditAccountPopup, New/EditNetworkPopup, NewSenderPopup (partial — `.shake` stays live); 8 more files carry isolated dead selectors (EditContactPopup `.shake`+keyframes, EditProfilePopup `.icon_btn`, AccountsPopup, RevokeAuthwitsPopup, SelectProfilePopup, SelectTokenPopup, BalanceView, SelectNetworksPopup). Deadness re-verified per selector by grepping the owning template for `$style` references before deletion.
2. Q-09: canonical `trimAddress(address, start=8, end=4)` uses `..`; the 9 hand-rolled sites use start=6/end=4 with `...` ×6, `…` ×2, and ReceivePopup's `•••` two-span layout. Preserving each site's CURRENT rendered output requires a separator parameter (and ReceivePopup keeps its layout, adopting trimAddress only if its slicing halves map cleanly — else it is scoped out with a note).
3. Q-08: `DappStatusStrip.vue` (discover + capabilities), `execute/SignerIdentityStrip.vue`, and `verify/index.vue`'s inline copy render the identical skeleton (status dot, account, separator, network, "NULO" brand) with class-for-class identical CSS. All `data-testid`s must survive verbatim (e2e selector rule).

## Changes
- **Q-11 (Remove Dead Code)**: delete the 5-file identical block + the 8 isolated dead selector groups. Purely subtractive; per-file grep-proof recorded in the commit body.
- **Q-09 (Replace Inline Code with Function Call)**: extend `trimAddress(address, start = 8, end = 4, separator = "..")`; migrate the 8 plain sites passing their exact current (start, end, separator); ReceivePopup assessed individually. `string.test.ts` gains separator + site-parity cases.
- **Q-08 (Extract Component)**: presentation-only `IdentityStrip.vue` in `src/components/composite/` taking `{ status?, accountLabel, networkLabel, warn? }` + slots where the three diverge; `DappStatusStrip`, `SignerIdentityStrip`, and the verify inline block become thin callers keeping their OWN testids and any behavior wiring. CSS moves once into the new component.

## Phases & gates
1. Q-11 deletions (serial subagent, no-git rules, explicit-path staging by me) → armed-smoke-relevant popups compile; `bun run test` extension components; commit.
2. Q-09 (me): helper param + tests, then the 8 mechanical sites; commit.
3. Q-08 (me): extraction + 3 thin callers; component test (≥10 cases per L3 composite minimum); commit.
4. Whole-arc: `bun run audit:vue` + armed smoke (`VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build` → `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`).
5. ONE codex xhigh plan+diff pass → fix → converged → PR → babysit → squash-merge.

## Security
Q-08 touches the anti-phishing identity anchor: the extraction must not alter what any window DISPLAYS (status semantics, warn coloring) — pinned by the component test + testid preservation + armed smoke over the dApp windows.
