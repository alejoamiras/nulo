# Codex audit transcript — Q2 (deep)

Three codex interactions (xhigh, read-only). The independent draft is in `draft-codex.md`. Below are the two audit rounds' verdicts + findings (final wording; ephemeral session transcripts not reproduced).

## Round 1 — contradiction-check + adversarial/security/assumption audit (session resume)
**Verdict:** `conditional approve (conditions: resolve the plan-text contradictions around "one coarse callback / never toasts" and the still-open-vs-already-decided D1/D3 asks, and lock the onUnknownImportError adapter shape before implementation)`

- Asks (A1/A2/A3) and the Decision ledger (D1/D2/D3) contradicted each other → reconcile (Asks reframed as resolved-with-defaults ratification items).
- "One coarse callback / never toasts" overstated vs Phase 2 injecting `showErrorLog`/`onUnknownImportError`/`notifyImportFailed`/`openToast` → reword to "`onComplete` + narrow error/reporting adapters."
- D3 (share `onKeydown`) rationale asymmetric: onboarding create has a `<form @submit.prevent>` path; `isCreating` is what absorbs the double-fire there → pin onboarding as "latch-protected," not "deduplicated by guard."
- D6 (use `managers.profile` global) is NOT a mistake; keep it for `useFullBackupImport` consistency. Condition: composables must not reach for router/stores/`managers.account`/bootstrap.
- D1 second-order: the per-shell unknown-error hook must accept raw `unknown` and preserve a possibly-non-string `title`; typed branches stay shared, only catch-all diverges.
- Independent shippability is sequential, not cherry-pick.
- Security coverage good (restore split, passkey cancel, PRF, allowedCredentials, latch-before-await); trap = don't centralize passkey notifications or move secret-zeroing into the composables.
- Relocation targets right; lint validates I3.

**Resolution:** all conditions folded into `plan.md` (architecture reword, ledger D3 reversal context, adapter shape locked in Phase 2, shippability reworded, scope-discipline added to D6).

## Round 2 — final fresh-context pass (new session)
**Verdict:** `conditional approve (conditions: move the page-local popup-create assertions out of useProfileCreateFlow.test.ts into a popup page/helper test, add popup-create setLastActiveProfileId(profile.id) to the preserved onComplete sequence, fix the Phase 1 grep path)`

1. Phase 3 tried to prove page-local behaviors (Quirk-2 `onKeydown`, popup `onComplete` ordering) through the composable unit test → move to `popup/pages/profile/new.test.ts`.
2. "Verbatim" popup sequence silently dropped `setLastActiveProfileId(profile.id)` (and the network-null check) → restored in constraint #2 + Phase 3.
3. Phase 1 grep path `packages/extension/src` wrong from the `packages/extension` cwd → `src`.
4. Assumptions solid; I1/I2 safe post-revision; I3 proven by lint/build.
5. (Non-blocking) popup full-backup Enter is page-local + smoke doesn't drive Enter → add a page-level pin / manual-smoke item (Phase 2).

**Resolution:** all conditions folded into `plan.md`. Net verdict after resolution: ready for the approval gate.
