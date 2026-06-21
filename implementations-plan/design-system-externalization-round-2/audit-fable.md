# Hostile fresh-eyes audit transcript — design-system-externalization round 2

**Note:** Claude Fable 5 was unavailable this session; per the blueprint skill ("capability matters
more than the literal name"), this audit slot was run by a top-tier Claude `Plan` subagent (Opus)
with a HOSTILE fresh-eyes brief (cold read, no prior context, tasked to break the plan). Paths
rewritten repo-relative.

**Verdict: `conditional approve`** — conditions: fix the misstated `useToast` consumer model before
P3; specify the package Button base export name to prevent wrapper self-recursion; reconcile the
contradictory P4 faucet gate language ("visual restyle" vs "rename only"); bound the Storybook fix so
it can't block all 6 PRs; treat the faucet Spinner speed/color change as a known signed-off regression.

The plan is structurally sound (seam discipline, locked decisions, dependency ordering all verified
correct), but three load-bearing Facts were misstated and two Inferences were unsafe in the wrong
direction — because the planners were inside the "auto-import + zero-churn" framing they mis-modeled
the highest-consumer surface (toast) and undersold the faucet visual change.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | Critical | `useToast` is NOT "64 auto-imported." Reality: **55 explicit imports** (15 `.js`-suffixed) + 2 truly auto + 4 `vi.mock`; `auto-imports.d.ts` hardcodes `'../composables/toast.js'`. The named risk (`export *` surfacing) is near-moot; the real risk is the file suffix (C2). | **ADOPTED + VERIFIED** → D-F4 rewritten: shim stays `.js`, explicit named re-export, auto-import surfacing non-issue; P3 gate checks the real consumer set. |
| C2 | Critical | The `.js`→`.ts` shim swap breaks 15 explicit `"@/composables/toast.js"` imports + the dts if the shim becomes `toast.ts`. | **ADOPTED** → extension shim STAYS `toast.js`/`outside.js` (re-exports from package `.ts`); delete stale `toast.d.ts`; regen auto-imports.d.ts. |
| C3 | Critical | Package Button base export name unspecified → if the wrapper renders bare `<Button>`, the dir-scan resolves back to the wrapper = infinite recursion (F2/F7 avoid this via `…Base` names; F1 omitted it). | **ADOPTED** → D-F1: export base as `Button`, wrapper imports as `ButtonBase` and renders `<ButtonBase>`, never bare. |
| H1 | High | The faucet `AppButton→Button` flip is a full **visual restyle** (brutalist/uppercase) of 9/10 buttons, contradicting P4's "zero testid drift / rename only" gate text. | **ADOPTED** → P4 gate reworded to "intentional restyle + human sign-off, testids preserved"; added "Faucet visual consequences" section + Ask A3. |
| H2 | High | Loading-path divergence: AppButton disables-on-loading (blocks mouse+keyboard) + gates click; extension Button only `pointer-events:none` (blocks mouse, NOT keyboard), no click gate. Faucet `:loading` sites lacking `:disabled` become keyboard/double-submit-able. | **ADOPTED** → P4 per-site requirement: every faucet `:loading` site lacking `:disabled` adds `:disabled="loading"`; test on bridge-submit. |
| H3 | High | Spinner faucet regression (0.75s→4s speed AND `currentColor`→`--txt-inverse` color) rested on a human-only gate (repeats round-1's blind spot). Suggested defaulting the superset to `currentColor` (all but 1 extension site pass explicit color). Also: old test selects `.spinner`, extension uses `$style.wrapper`. | **ADOPTED + VERIFIED** → D-F6: superset default `currentColor` (faucet color stable; 1 extension `size="14"` site to check); speed change = explicit signed-off; test class-selector fixed. |
| H4 | High | Storybook fix is unbounded + gates all 6 PRs with no fallback; the glob needs the package path added (`../../design/src/**`). | **ADOPTED** → D-F8: fallback descope; gate P1+P6 only; ADD the package glob. |
| M1 | Medium | Input drops more auto-imports than listed (Tooltip/Icon/Text/Flex bare tags + onMounted/nextTick); mount-all only catches them if the case passes the required `placeholder`. | **ADOPTED** → P6 lists the full explicit-import set + mount-all supplies `placeholder`. |
| M2 | Medium | Tooltip's `--base-width` CSS-var dependency travels silently; package has no such token. | **ADOPTED** → D-F3 documents the `--base-width` host-token contract. |
| M3 | Medium | boundary v-html regex is partial theatre / oversold. | **ADOPTED** (same as codex C-4) → D-SEC reframe. |
| M4 | Medium | DripButton's `variant="outline"`/`:data-loading` have no extension-Button equivalent → round-3 debt. | **RECORDED** → ledger round-3 debt. |
| M5 | Medium | Faucet visual state mutates across PR2 (Spinner) AND PR4 (Button); human gate must sign off twice. | **ADOPTED** → PR strategy notes the two-PR faucet sign-off. |
| L1 | Low | Parity guard validates rule presence, not cascade effectiveness (source order). | **ADOPTED** → D-F9 import-order comment. |
| L2 | Low | Brief's "25 AppButton" is stale; actual 10. | Already corrected in plan. |
| L3 | Low | `export/full.vue` Spinner gets `aria-hidden` + now `role="status"` (contradictory, harmless). | **PINNED** → P2 bug-pin note. |
| L4 | Low | `teleportTo` defaults assume host roots; faucet declares none. | **ADOPTED** → README contract: missing root = broken teleport. |

**Confirmed genuinely solid:** D-SEAM (verified against `components.d.ts`), router purity +
no-polymorphic-`as` Button, F5 sanitizeString, F4 singleton reasoning (principle right even though the
consumer-count framing was wrong), F9 rule-presence parity, dependency ordering, the both-app
human-sign-off insistence.
