# C6 — Round 1 cross-rebuttal (Claude side vs Codex)

## (b) Overconfident / wrong

**codex-2 F4 (active-profile handoff temporal coupling) — WRONG, core mischaracterization.** The two helpers do not encode "one logical state change." `setSentinel()` takes no profileId and writes the build-defined `__SENTINEL__` constant (`packages/extension/src/utils/core.ts:141-149`, `vite.config.ts:312` — `packageJson.sentinel`); its only reader is `composables/notification.js:60-65`, which shows an "aztecReset" delete-your-profile notification when the stored stamp mismatches the build. It is a network-reset epoch marker, not activation state. `lastActiveProfile.ts:1-5` documents its own contract explicitly ("written whenever a profile becomes active (create / unlock / switch / import)"). The "partial pairing" codex cites as the smell (`auth.vue:101`, `SelectProfilePopup.vue:30` writing only the id) is correct by design — unlock/switch must not re-stamp a reset epoch. The proposed `markProfileActivated()` owning both writes would couple a reset marker to activation, making the code wronger. At most a 4-site creation-flow helper survives; the architectural bucket and "temporal coupling" mapping do not. Both Claude instances rejected this as a non-finding.

**codex-1 non-finding on `src/setup/` — wrong dismissal.** "Explicitly wired into vite.config.ts:295-300, so it is not dead" confuses build input with reachability. Repo-wide grep: zero manifest entries, zero `tabs.create`/`getURL`/router references; the only mentions are the vite input itself (`vite.config.ts:298`), a pages-plugin dir that doesn't exist on disk (`:135`), and `onboarding/index.ts:3`'s docstring warning it's a placeholder. A whole Vue entry ships in every zip, unreachable. codex-2's "could not prove dead from within this cluster" is the same miss — configs + manifest are in this cluster's scope.

**codex-1 F7 (EntityStorage cleanup duplication) — right evidence, wrong remedy.** The 47-59 vs 65-77 duplication is real, but `getVersion`/`setVersion` have zero callers (grep-verified; live versioning is `wallet/storage/migrate.ts`). Smallest safe refactoring is Remove Dead Code, which deletes the duplication for free; Extract Method preserves dead API.

**codex-1 non-finding on `general.js` — dismissal misses the mechanism.** "No actual cross-file drift" ignores that the smell is the unchecked channel: TypeScript never verifies `general.js` against hand-written `general.d.ts`, so any signature change type-checks against a stale contract. Drift-so-far is not the bar.

## (a) Missed by Codex (both instances)

1. `utils/amount.ts` dual float/bigint vocabularies; thousands-regex ×3 (`:35,:38,:273`); float `comma()` live in the send flow (`AmountCard.vue`) — in-scope `src/utils/**`, structural.
2. `utils/journal-state.ts` four parallel switches over stringly `JobError.kind` (`:105-121,:164-193,:217-255,:258-273`) — Repeated Switches.
3. `"TestPassword123!"` literal ×11 across the harness (`fixtures/helpers.ts:20` defines but doesn't export).
4. `fixtures/extension.ts ↔ helpers.ts` import cycle + six DOM primitives living in the 1,249-line launcher.
5. Dead dependency `@aztec/stdlib` (`wallet-crypto/package.json:15`, zero imports).
6. Dead `setup/` build entry (above — actively mis-dismissed).
7. `vitest.config.ts:57-60` comment claims "no per-package vitest config" while three exist (wallet-core/-crypto/extension-messaging run the same tests under a different harness).
8. Drift already shipped in the surface codex-1 F3 flags: `vitest.e2e.all.config.ts` lacks the noir nodejs aliases and `retry: 2` that `vitest.e2e.network.config.ts:17-20,39-48` documents as load-bearing — the strongest evidence for codex's own finding.
9. `mnemonic.ts` (49% of wallet-core) is a crypto-boundary misplacement, not just a size outlier — both codex dismissed on size-only grounds; wallet-crypto README/key-vector lock regime never sees it.

## (c) Confirmed

- Entry console-hijack ×4 (codex-1 F1 / codex-2 F2) — matches Claude F1; codex-2 correctly adds `vitest.setup.ts`.
- vite/vitest config duplication + "Keep in sync" comment (codex-1 F2 / codex-2 F3).
- e2e config sprawl (codex-1 F3) — claude-2 F4 corroborates with the drift evidence above.
- Browser wrappers mutating the imported base config (codex-1 F4) — confirmed; "Temporal Coupling" label is strained (the hazard is shared-module aliasing — Mutable Data), substance right.
- **codex-1 F5 (cap-grant fixture choreography ×3 + setup ladder ×4) — confirmed and a Claude-side miss.** Verified: phase wrapper + ladder at `extension.ts:383-399,407-421,468-482,524-538`; the file's own comment (`:282-296`) sets a "three or more fixtures" refactor threshold, now met.
- Three wallet-core serializers (codex-1 F6 / codex-2 F1) — matches Claude; bigint `"123"` vs `"123n"` divergence is the sharper evidence (claude-side) codex-1 understates.
- Dead public API surface (codex-2 F5) — grep-confirmed.

## (d) Contradictions

- codex-1 F5 vs codex-2 non-finding ("no crisp harness-duplication root cause") — codex-1 is right; intra-Codex split.
- codex-1 F7 (flag) vs codex-2 non-finding (same lines) — moot once getVersion's deadness is applied.
- codex-1 F3 (e2e configs) vs claude-1 non-finding — the shipped e2e.all drift decides for codex/claude-2.
