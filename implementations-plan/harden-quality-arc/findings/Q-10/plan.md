# Q-10 + Q-11 — typed design prop contracts + shared severity map · tier: **mid** (coupled pair; LARGE)

**Re-verify (STEP 1, vs `dev-quality`):** VALID. ~57 bare `type: String` props across 15 `@nulo/design` primitives (Flex 6, Button 9, Input 11, Text 5, Tooltip 5, Popover 4, Banner 3, SubPageHeaderBase 3, Icon 3, MaterialIcon 2, LoadingState 2, Badge/Checkbox/Toggle/SectionLabel 1); divergent severity vocab (`Badge` info|warning|error|purple · `Banner` info|done|warning|error · `Toast` ok|error|info · `ToastManagerBase` raw red|green|orange). Token unions exist (`tokens.ts` ColorToken/FontSize/FontWeight; `token-contract.ts` textAligns/flexGaps).

## Decision ledger (codex `bh7eyc1xk` + main investigation; opus Plan leg deprecated after its Q-16 glitch)
**SPLIT the pair (codex, adopted): land Q-11 (severity) FIRST as a small contract PR, then Q-10 (typed props).** Badge/Banner touch both, but severity can centralize without forcing the ~1700-call-site prop migration. So P10 → **P10a (Q-11)** then **P10b (Q-10)**, two PRs.

**Q-11 (severity) — design:**
- One BROAD `SeverityTone` union in the design contract, but **renderer-specific maps/subsets** — NOT one scalar tone→color map. codex verified the renderers are genuinely different surfaces: `Badge.info` = surface background (`Badge.vue:22`), `Banner.done` = green icon (`Banner.vue:87`), `Toast.ok` = mint border (`Toast.vue:44`), `ToastManagerBase` = raw red/green/orange borders (`:21`). A single color map WOULD change visuals.
- **Do NOT infer toast severity from `icon:"warning"`** — many calls pass a warning icon with no color today; adding orange/red = visual change. Only migrate **explicit `color:"red"` → `tone:"error"`** (~5 sites).
- Surface: ~16 Banner uses, Badge stories, ~5 explicit red toast colors. Behavior-preserving = each renderer's CURRENT rendered color unchanged.

**Q-10 (typed props) — design + PITFALLS (codex, all verified):**
1. **`withDefaults(defineProps<Props>(), defaults)`** for generic props (preserves current defaults + optionality the array/object form gives).
2. **Stringify numeric tokens:** static Vue attrs are strings — `size="13"` is `"13"`, not `13`. Type as `FontSize | \`${FontSize}\`` (and same for weights/gaps), else MASS false errors at call sites.
3. **`ColorToken` is WRONG for `color` props** — it's CSS-var names (`"--red"`, `tokens.ts:97`); components pass utility names (`"primary"`/`"secondary"`/`"red"`, `utilities.css:132`). Export **`TextColorName = keyof typeof textColors`** from the contract instead.
4. **Pre-existing OVER-CONTRACT sites** (call sites already exceed the current validated sets — must widen the union OR fix the site, behavior-preserving): `Flex align="baseline"` (`OperationCard.vue:296`, `AmountCard.vue:117`; Flex validates only center/between/around/evenly/start/end) → add `baseline` + utility CSS, or fix the 2 sites. `Flex gap="0"` (`create.vue:148`; flexGaps omits 0) → include `0 | "0"` or fix the 1 site.
5. **AST template inventory before each phase** — compare literal props in `.vue` to the proposed union (catches multiline/dynamic that `rg` misses) so vue-tsc doesn't flood. (Note: vue-tsc DOES check defineProps generic prop types at call sites — unlike the strict-null `.vue` gap from Q-16 — so ~1700 sites are compiler-enforced here.)
6. **Wrappers:** convert `apps/extension/src/components/ui/Button.vue` + `SubPageHeader.vue` to `<script setup lang="ts">`; export `ButtonBaseProps`/`SubPageHeaderBaseProps` from `@nulo/design`; wrapper props extend/omit host-only fields; `const baseProps = … satisfies Omit<ButtonBaseProps,"tag"|"href">`; keep `$attrs`-forwarding order so explicit base props win.

## Phasing (codex, by call-count — smallest/lowest-risk first)
- **P10a — Q-11** first: contract + Badge/Banner/Toast/ToastManagerBase/composable (~16 Banner + Badge stories + ~5 toast colors). Its own PR + gate.
- **P10b — Q-10**, then in size order:
  1. small primitives: Popover 1, Checkbox 3, ToastManager 3, LoadingState 8, Toggle 8, SectionLabel 22, SubPageHeader 29.
  2. medium: Tooltip 44, MaterialIcon 43, Input 55, Button 89.
  3. large LAST: Icon 188, Text 456, Flex 711.
  Each cluster: AST inventory → type → `bun run lint` + `typecheck` (vue-tsc) + design/extension component units → storybook build at the end.

## Security / adversarial
No trust boundary (presentational design system). Risk is purely behavior/visual regression: a typed union narrower than current usage = broken render or a compile flood; the severity reconciliation changing a color. Mitigation: AST inventory + behavior-preservation (unions accept all current values; severity preserves each renderer's color).

## Open question for impl
Given the size (~1700 sites, Flex 711 alone), P10b may itself need sub-PRs per cluster (each independently gated) rather than one giant PR — the per-PR full-network gate makes a single 1700-site PR risky to bisect. Decide at P10b kickoff (likely: Q-11 PR, then 2-3 Q-10 cluster PRs).

## Gate (every PR): design + extension component units + storybook build + smoke + FULL network. Per-arc tail: `/code-review max --fix` → codex post-impl.

## IMPLEMENTATION LEARNING (after c1/c2/c3) — core-primitive coupling
**Leaf primitives type cleanly; CORE primitives (Icon/Text/Flex) CASCADE.** c1 (MaterialIcon/Toggle/SubPageHeader color), c2 (Tooltip), c3 (Input/Banner) were leaves — `typecheck:all = 0`, no cascade. But typing **Icon.color → TextColorName** produced 9 errors: Button base (`leftIconColor`/`rightIconColor` at `Button.vue:117,125`) + ToastManagerBase (`:41`) pass loosely-typed `string` color INTO `<Icon :color>`. So Icon couples to its design-system CONSUMERS (Button, ToastManager — and Text/Flex will too, being even more widely consumed).
- **Consequence:** Icon/Text/Flex clusters are NOT isolated — each must type its consumers' forwarding props in the SAME PR (or the cascade red-floods). The Button wrapper (JS→TS) is in that web.
- **Plan:** treat the remaining work as ONE coupled "core-primitive + consumers" effort, NOT per-leaf clusters: map `Icon`/`Text`/`Flex` + every design component that forwards color/size/align to them (Button base+wrapper, ToastManagerBase, SubPageHeader already done, …) and type them together, `typecheck:all` flushing the cascade per step. Likely 1-2 larger PRs (Icon+Button+ToastManager; then Text+Flex+consumers), each AST/typecheck-inventoried. Reverted the standalone Icon attempt @ this point (3114c04) to avoid interim casts.
