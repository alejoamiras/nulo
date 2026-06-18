# Hostile audit transcript — Q2 (deep)

**Substitution note:** Fable 5 was unavailable during this run, so the fable audit slot used a fresh Claude `Plan` subagent (no prior context) tasked with attacking the consolidated plan. Cross-family rigor is preserved via the two codex rounds (`audit-codex.md`).

**Verdict:** `conditional approve (conditions: (1) decide+pin popup-create's Enter-on-method-tab behavior delta; (2) address onboarding-create's <form @submit.prevent> interaction with the relocated onKeydown; (3) correct the passkey/service.ts:113 "util path baked in" rationale)`

Ranked findings:

1. **[HIGH] Unstated third behavior change — popup-create Enter-on-method-tab stops submitting.** `popup/pages/profile/new.vue` has no `<form>`; method tabs are `<button type="button">`. Today Enter on a focused tab submits via the global keydown; the canonical inclusion guard (`NewContactPopup.vue:188-191`, verified) suppresses it. → **Adopted:** ratified as A4/D9, pinned by a method-tab event-target test.
2. **[HIGH] Plan silent on onboarding-create's `<form @submit.prevent="handleSubmit">` (`create.vue:172`).** Its Enter-in-input already submits natively; sharing a guarded `onKeydown` makes the onboarding pin pass for the wrong reason and risks dropping `@submit.prevent`. → **Adopted:** D3 reversed (`onKeydown` page-local; onboarding untouched); constraint #12 added.
3. **[MED] Inaccurate PATH B rationale.** `passkey/service.ts:113` `getURL` references the popup-`index.html` hash-route `#/windows/passkey`, not the util's file path. Conclusion (window stays, util moves) right; reason wrong. → **Adopted:** constraint #11 corrected.
4. **[MED] Quirk-1 pin must also assert onboarding's injected `onComplete` still bootstraps once** (else extraction could drop the only remaining bootstrap → `waitForProfileActive` hangs 30s). → **Adopted:** constraint #3 strengthened.
5. **[LOW] e2e surface understated; Quirk-2 not smoke-covered.** Smoke runs all top-level e2e suites (bonus dialog-relocation coverage) but never drives Enter → Quirk-2/A4 are unit-pinned only. → **Adopted:** noted in Phase 4.
6. **[LOW] Dialog-test `vi.mock` retarget is the loud tripwire** of the relocation (already covered in Phase 1) → emphasized.

**Verified non-issues (no action):** biome `onboarding/**` rule permits the relocation (I3 holds); `src/components/passkey/` + `src/wallet/utils/` trip no layer rule; auto-import harmless; no double-`completeImport` injection (same ref reused); `bun run lint` uses the repo-root biome config.
