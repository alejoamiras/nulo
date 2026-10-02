# Draft plan (Claude `Plan` subagent) — Q2 — provenance summary

Second of three independent plans (substituted for the fable planner, which was unavailable). Its full content is folded into `plan.md` + the decision ledger. Distinct contributions it originated:

- **Confirmed inference I1** (inject per-shell `complete*`) independently via `popup/app.vue:130-132` `onActiveProfileChanged` → `bootstrapActiveProfile`; onboarding only `hydrateKnownProfile` at mount.
- **Caught the secret-zeroing flaw** in the main draft: composable must NOT own `onUnmounted` (CLAUDE.md) and must not add zeroing to popup → page-owned, asymmetry preserved (ledger D4).
- **Flagged the `fillError`/casing changes as a 3rd/4th behavior change** needing ratification (ledger D1; codex later hardened this to "preserve verbatim").
- **PATH B path-locked** by `passkey/service.ts:113` `getURL` (constraint #11).
- **`test:components` coverage gap** — doesn't cover `src/composables/`; use full `bun run test` as the gate (ledger D7).
- Proposed a **Phase 0 baseline capture** (adopted).
- Proposed util→`src/utils/` (rejected in favor of `src/wallet/utils/` after reading the file's wallet-coupled imports — ledger D2).
- Quirk-1 "dissolves by construction" framing (adopted, ledger D5); Quirk-2 must inherit to both shells (ledger D3).
