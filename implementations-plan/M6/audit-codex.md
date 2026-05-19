# Codex xhigh A12 audit — key findings (verbatim refs)

## Wrong / missed (must fix in v2)

1. **"0 raw `<input>` outside primitives" is FALSE.** Native inputs at:
   - `popup/pages/auth.vue:179`
   - `popup/pages/send.vue:458`
   - `popup/components/modules/send/AmountCard.vue:79`
   - `popup/windows/capabilities/index.vue:452`

2. **Hard rule 1 wrong for `src/components/composite/**`.** Vite auto-import covers everything under `src/components/`, including a future `composite/` dir.

3. **Layer mapping wrong.** `popup/components/modules/**` is MIXED:
   - Pure (should be L3): `CapabilityDetailPanel.vue`, `TransactionAwaitingCard.vue`, `SendTypesCard.vue`
   - Service-bound (L4): `BalanceView.vue`, `FeeSettingsCard.vue`

4. **`SecretRevealCard` scope wrong.** `key.vue` + `seed.vue` are timed reveal/copy. `full.vue` is a backup/export pipeline — different. Drop full.vue from this composite.

5. **Button goal too narrow.** Bespoke button styles exist beyond `.cta`:
   - `popup/pages/auth.vue:144`
   - `components/ui/Popup/PopupHeader.vue:19`
   - `popup/components/modules/send/SelectTokenCard.vue:30`

6. **Phase 8 blanket ban too strict.** `send.vue:223`, `import.vue:319` legitimately own service lifecycles. Pages must keep that.

7. **`ConfirmDialog` promise-API rewrite is scope creep.** Defer.

## Should be re-ordered

- `5a FormPopup` immediately after primitives ✓
- `6d useFormState` + `6a useEntityCrud<T>` BEFORE `5b EntityForm<T>`
- `6b useFeeEstimation` BEFORE decomposing `send.vue` + `execute/index.vue`
- `6c useDappInteractionPayload` BEFORE decomposing `capabilities` + `execute`
- Split `5c`: `key.vue` + `seed.vue` share reveal; `full.vue` separate

## Should be added

- **H**: `@pinia/testing` in Phase 1 (store-heavy components: BalanceView:25, SelectTokenCard:2)
- **H**: Selector-contract gate BEFORE primitive migrations — e2e depends on exact locators (`tests/e2e/auth-flows.test.ts:15`, `tests/e2e/fixtures/helpers.ts:405-406`)
- **H**: Mandatory automated visual regression on stories — Lost Pixel against Histoire build
- **M**: Add `bun run build` to per-sub-PR gates
- **M**: `component-inventory.ts` emit JSON + classify by forbidden imports (not directory alone)
- **M**: STATUS.md richer — Branch / Base SHA / Last green gates / Blocking decisions / Next command. Pattern: `implementations-plan/typecheck-cleanup/autonomous-session-status.md`

## Should be removed

- Custom `playground.html` fallback → fallback should be **Storybook Vue3-Vite**, not a one-off page
- Blanket direct-service-import ban for pages/popups
- `full.vue` from `SecretRevealCard` scope
- `ConfirmDialog` promise-API rewrite (defer out of A12)

## Decisions

| Question | Codex answer |
|---|---|
| Test env | **jsdom** (not happy-dom) — repo standardizes on jsdom in `vitest.config.ts:42`, already installed |
| Pinia | Add `@pinia/testing` |
| Page line caps | Softer: target ≤500, **hard cap ≤600** |
| Window line caps | Hard ≤400 ✓ |
| Component line caps | Hard ≤400 ✓ |
| Histoire | Viable but pin to non-alpha (npm latest is alpha; GitHub stable lags); fallback = Storybook (NOT custom page) |
| Visual regression | Lost Pixel against built Histoire book |
| Stop rule | Halt IMMEDIATELY for: build / typecheck / network e2e / security e2e / selector-contract regression / primitive visual diff. Two-failure rule only for noisy gates. |

## Final assessment

**Minor edits.** Top 3 highest-leverage changes:
1. Re-sequence Phase 5/6 so composites build on hooks, not ahead of them
2. Fix layer model: mixed modules/**, wrong auto-import claim, no blanket service-import ban
3. Switch tooling to **jsdom + @vue/test-utils + @pinia/testing** + automated Lost Pixel visual regression

Phase split needed: `5c/7g` — key+seed share `SecretRevealCard`; `full.vue` decomposes separately. Defer `5e ConfirmDialog`.
