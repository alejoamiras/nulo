# Codex audit — round-3 plan (`/blueprint light`)

Session `019ee946-5ff2-78d0-abba-85dc71371b90`, model_reasoning_effort=xhigh, read-only.
**Verdict: conditional approve** (retier or split P4; make DripButton disable-on-loading mandatory;
treat dark→tertiary as an explicit approval-gate design decision; strengthen the Icon check to deep
equality; verify whether `_text.scss` still ships).

Paths rewritten repo-relative per `implementations-plan/` rules.

## HIGH/CRITICAL
- **Inference wrong — P4 is not behavior-preserving.** `packages/design/src/ui/Checkbox.vue:11` adds a
  disabled click/Enter guard the local shadow lacks (`packages/extension/src/components/ui/Checkbox.vue:8`).
  `packages/design/src/ui/Toggle.vue:4` adds a real `color` prop missing from
  `packages/extension/src/components/ui/Toggle.vue:2`. Fix: stop calling P4 "behavior-preserving TS-port
  adoption"; either split/retier P4 to `mid`, or explicitly classify these as reconciliations with
  targeted tests/manual review. → **ADOPTED** (P4 reclassified; targeted unit tests required).
- **Plan bug — DripButton disable-on-loading is not optional.** `packages/design/src/ui/Button.vue:96`
  shows loading but does not native-disable or gate click; DripButton's current semantics are pinned at
  `packages/design/src/composite/DripButton.test.ts:36` and used live at
  `packages/faucet/src/components/TokenCard.vue:196`. Fix: require `:disabled="disabled || loading"` +
  keep the `data-loading` pin. → **ADOPTED** (P3 made mandatory).
- **Tier pushback — `light` too optimistic for P4 as framed.** Network e2e + human "no deltas" won't
  catch semantic drift (disabled Checkbox emission, loading-button keyboard behavior); sequencing
  last + own PR help rollback, not detection. Fix: split P4 or retier to `mid`; at minimum add targeted
  story/manual review for all 9 + focused unit assertions. → **SURFACED at the gate** (Ask: keep-with-
  rigor vs split).

## MEDIUM
- **Ask should be surfaced, not assumed — `dark→tertiary`.** `TokenMetadataPopup.vue:125` `dark`
  currently INHERITS full text color; `tertiary` will intentionally mute it. `ReceivePopup.vue:63`
  masked dots inherit `body`, not "dark gray." Fix: make it an approval-gate ask with per-context
  screenshots. → **ADOPTED** (explicit gate decision).
- **Fact misstated — `_text.scss` not dropped.** Still defines `dark` at
  `packages/extension/src/assets/styles/_text.scss:57`; `_base.scss:2` `@use`s it. Fix: verify whether
  `_base.scss` is live; remove `dark` there too. → **ADOPTED** (P2 cleans SCSS; `_base.scss` confirmed
  live via `setup/index.ts`).
- **Icon gate should be deep equality, not key superset** (files are byte-identical now; same-key/
  wrong-path drift would evade a superset check). → **ADOPTED** (`jq -S` deep-equality; verified empty).

## LOW/nits
- P3 over-listed touched tests: `boundary.test`/resolver inventory do NOT mention `AppButton`; real
  touch points are `packages/design/src/index.ts:23`, `DripButton.vue:2`, `DripButton.test.ts:53`,
  AppButton's own files. → **ADOPTED** (P3 trimmed).
- P2 gate should prove `.color--dark`/`.fill--dark`/`--gray-15` gone, not just `color="dark"` sites. →
  **ADOPTED** (P2 gate strengthened).

## Looks right
- AppButton is consumed only by DripButton. ✓
- The two `icons.json` match exactly (104 keys, 0 value diffs). ✓
- Toast keep-separate is reasonable: steelman is "share a queue-capable core or a common card," but the
  faucet already reuses `@nulo/design` `Toast.vue`; remaining divergence is state model + host layout. ✓
