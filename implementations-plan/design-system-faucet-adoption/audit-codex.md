# Codex transcript — faucet `@nulo/design` adoption (deep)

Codex session `019eeed5-3ba7-7833-8ae6-ff16e94a6507` (artifacts in this session's CODEX_DIR). Effort `xhigh`, read-only sandbox.

---

## Round 0 — independent planning contribution

Codex's headline opinion: **order by interaction seam, not by screen.** Bridge and Fuel share the dangerous code in the form/journal/stepper stack; a view-by-view plan would duplicate churn and hide regressions.

**Proposed phasing:**
1. **Resolver Foundation** — make bare `<Flex>`/`<Text>` legal in every compile path before touching any SFC. Files: `packages/faucet/package.json`, `packages/faucet/scripts/design-resolver.ts`, `packages/faucet/scripts/design-resolver.test.ts`, `packages/faucet/vite.config.ts`, `packages/faucet/vitest.config.ts`, `packages/faucet/vitest.e2e.config.ts`, committed `packages/faucet/src/types/components.d.ts`; add a shared helper so Vite + both Vitest configs consume the same components-plugin setup. Gate: `vue-tsc --noEmit`; root `bun run lint`; `bun run test`; `bun run build`. Pass: faucet resolves the same names as the extension resolver, `Button`/`Card`/`Toast` remain explicit-import, the **no-shadow test** proves no local component collides with the resolver list, production build succeeds with the resolver path tests use.
2. **Shell + passive leaves** — `App.vue`, the 3 views, `Footer`, `BridgeFooter`, `AppToastRegion`, `MintTestUsdc`, `MintFuelAsset`, `BridgeAddToken`. Use resolver-backed `Flex`/`Text`/`Badge` where root semantics survive; keep raw anchors/local buttons where a primitive isn't a clean fit.
3. **Wallet + verification surfaces** — `WalletPanel`, `BridgeWalletPanel`, `L1WalletPanel`, `VerificationModal`, `TokenCard`. Keep `AddressDisplay`/`Button`/`Card`/`DripButton` explicit; move only layout/text chrome to bare tags.
4. **Journal/stepper/receipt cluster** — `BridgeJournal`, `BridgeJournalCard`, `BridgeStepper`, `BridgePhaseRail`, `BridgeReceipt`. Selective: `Flex`/`Text`/`Badge`/`SectionLabel`/`LoadingState` for headings/empty-states/passive labels; keep bespoke rail glyphs/confetti/tiny buttons local.
5. **Complex form cluster** — `FuelForm`, `BridgeForm`. Conservative: shell/layout/labels/preset chrome to primitives, keep raw number inputs + bespoke fuel toggle if `Input`/`Toggle` can't preserve light-theme visuals/DOM/`aria`/testids.
6. **Human visual sign-off.**

**Security:** no `v-html` while swapping to Text/Banner/Toast/footer links; resolver shadowing is a real risk (faucet needs its own no-shadow guard); pin `unplugin-vue-components` to the extension's version, review lockfile diff narrowly; light-theme regression is UX/availability, not "just styling" — `app.css.parity.test.ts` only guards rule presence.

**Assumptions — Asks:** commit generated `components.d.ts` vs hand-authored? · shared config helper acceptable? · who owns the visual sign-off (local vs deployed preview)?

**Inferences:** `Button`/`Card`/`Tag`/`Toast`/`AddressDisplay` likely stay explicit · the shared `Input` is probably a poor fit for the faucet's amount rows (underline-first, different DOM, emits numbers) · a faucet-local shared config helper is safer than copy-pasting plugin setup into 3 files.

**Adversarial self-review:** riskiest phase is the form cluster · pixel drift if active-vs-dim balances / selected modes / dashed warnings / low-contrast helper text stop communicating state · resolver shadowing could reappear if someone adds a local `Flex.vue`/`Spinner.vue` (keep the no-shadow test) · testid loss most likely when replacing a raw interactive element and moving the attr onto a wrapper · false-green if only `vite.config.ts` gets the resolver and the Vitest configs don't.

**Single biggest risk:** a **partial resolver cutover across the faucet's separate compile entrypoints** — if `vite.config.ts`, both Vitest configs, and the dts file don't move together, the team gets contradictory signals about whether bare tags exist at all.

**Consolidation outcome:** seam-clustering was **partially adopted** — its no-shadow test (D1), shared config helper (D5), and `Input` non-fit (D7) folded in; its seam-based phase grouping was **superseded** by the fable planner's change-type phasing (D2) because the import cutover is pixel-identical by construction and needs no risk-grouping, isolating all visual risk into one opt-in phase.

---

## Round 1 — contradiction-check + adversarial audit

**Verdict: `reject`** (blocking: the plan widens the faucet resolver beyond a primitives-only set and phases the work around a zero-value "import cutover"; Phase 1's inert gate can pass while the resolver is unproven).

**Critical — resolver set scope.** The plan's resolver includes `Button`/`Card`/`Toast`/`AddressDisplay`/`BalanceRow`/`DripButton`/`DisclaimerTag`/`EmojiGrid`; the extension's resolver is only the 15 primitives. Codex framed this as "violates the lock to mirror the extension list."
- **Main's disposition:** the "violates the lock" framing is **rejected** — the lock was the resolver *mechanism*, not a verbatim 15-name list; the faucet owns its own set (D3 stands). **BUT codex's underlying architecture is adopted on its merits:** cutting over already-imported components to bare tags is churn with zero reuse gain (template is identical; only the `<script>` import block changes), bloats the resolver, and diverges from the extension's primitives-only resolver philosophy (its `Button` is a local wrapper, never a resolver entry). → **Resolver = primitives only; `Button`/`Card`/`Toast`/composites stay explicit imports.** This deletes the import-cutover waves.

**High — seam-clustering revived.** Codex concedes its seam-clustering shouldn't have been dropped *in this form*: once the resolver is primitives-only, the "import-cutover wave" vanishes and risk returns to shared UI seams (`Wallet*`/`VerificationModal`; `BridgeJournal*`/`Stepper`/`Receipt`; `BridgeForm`/`FuelForm`/`TokenCard`). → **Adopted:** regroup the swap work by seam (contingent on the Critical fix, which holds).

**High — Phase 1 gate proves nothing.** With all explicit imports present and zero bare tags, T/L/U/B don't exercise runtime bare-tag resolution; `dirs:[]` + zero bare tags doesn't positively prove dts behavior. → **Adopted:** Phase 1 includes a minimal real bare-tag proof (first leaf swap, e.g. Footer wrapper → `<Flex>`) gated in build + both vitest pipelines. (Restores the "pilot" my pre-consolidation plan had, that fable's fully-inert Phase 1 dropped.)

**Medium/Low (all adopted):** (1) `audit:faucet` always runs `verify:deployments`, which is local/deterministic — keep the full `audit:faucet` as the final gate, drop the "skip if needed" hedge. (2) Move overstated Facts → Inferences (`no server.deps.inline change`, `dirs:[] generates the dts`, deterministic dts regen, "vitest resolver fully mitigates"); add a hand-authored-dts / explicit-gen-step fallback. (3) Surface the resolver-scope choice as an explicit decision (now resolved primitives-only above + flagged at the gate), not buried in D3. (4) Reword D6: "likely low ceiling; evaluate `Banner`/`LoadingState`/`SectionLabel` opportunistically per seam" — don't close the door on passive-state primitives.

**Codex confirms fine:** the no-shadow `design-resolver.test.ts`, the shared `components-plugin.ts` factory, `Input`/`Toggle` staying local, the mandatory human visual gate.

_Folding deferred until the fresh-fable hostile audit lands (it was asked to attack this same "pixel-identical cutover" claim) — one revision, not two._

---

## Round 2 — final fresh-context pass (session `019eeef4`)

**Verdict: `conditional approve`** — 3 conditions, all verified against the repo and folded into plan v4.

- **High — Phase 2 gate gap.** `BridgeWalletPanel`/`L1WalletPanel` have no unit test and are stubbed in `bridge-smoke.test.ts:108` (`stubs: { L1WalletPanel: true, BridgeWalletPanel: true }`) → the Phase-2 gate could pass while they're broken (`WalletPanel` is tested; `AppToastRegion` is smoke-covered). → **Folded:** Phase 2 Step 0 adds focused `BridgeWalletPanel.test.ts` + `L1WalletPanel.test.ts` before swapping them.
- **Medium — Phase 1 proof target.** `WalletPanel`'s wrappers are `inline-flex` (:129/135/172); `Flex` is `display:flex` → drift. → **Folded:** proof switched to `VerificationModal` `.actions` (clean `display:flex`, tested). Also folded codex's rubric clarification: **class-preserving swaps are allowed** (keep the class on the same node, delete only layout decls) — rewrote rubric criteria 1/3/5.
- **Medium — inventory still off.** (a) The `Text` "no font prop" claim is wrong — `.font-headline`/`.font-mono` utilities exist (`base.css:373/377`) and Text forwards classes; real limits = span-only/no `tag` prop + default `line-height:1` + off-scale tracking. (b) The inventory skipped the `Tag` primitive, which is closer than `Badge` to the PRIVATE/PUBLIC pill (Tag was extracted from the faucet). → **Folded:** corrected the Text fact + inventory; `Tag` is now the primary pill candidate, `Badge` opt-in.

**Confirmed fine:** D1 (dropping the cutover loses no real reuse — style-only churn removed); lockfile sequencing (normal install records the workspace edge before frozen); the `biome.json:6` exclude gap is real; no XSS/`_blank rel` regression on the plan surface; the human visual gate is the right availability defense for the light-theme regression class.

**Gate status:** all conditions from all three audit rounds folded; plan v4 ready for user approval.

---

## Round 2 — final fresh-context pass

_(pending)_
