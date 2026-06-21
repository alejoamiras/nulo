# Design-system externalization — ROUND 3 (close-out cleanups)

**Status:** APPROVED 2026-06-21 — `/blueprint light`; codex `conditional approve` (conditions folded);
both gate decisions resolved (`dark`→split: `tertiary` dots / `secondary` metadata; P4 keep-with-rigor).
Implementing.
**Tier:** `light`. Phase 0.5 rubric = 0/6 high for P1–P3; **P4 (round-1 shadow cleanup) is the elevated-
blast-radius phase** (Flex/Icon/Text everywhere) and — per codex — is a RECONCILIATION (Checkbox/Toggle
diverged), not pure TS-port adoption, so a visual gate alone won't catch semantic drift. P4 now carries
per-component classification + targeted unit tests + network e2e + visual sign-off; whether that's
enough under `light` or P4 should split out is a gate decision.
**Arc:** closes `implementations-plan/design-system-externalization/round-2-backlog.md` (the round-3
items). Continues round 1 (#102–#114) + round 2 (#123 P1–P6, #124 P7).
**Scope (user, full round-3 close):** (1) record the **toast keep-separate** decision; (2) drop the
`dark` color name; (3) retire `AppButton` + migrate `DripButton`; (4) delete the 9 round-1 local SFC
shadows so the resolver actually takes effect.

## The headline decision: toast stays SEPARATE (reverses the round-2 "unify later" backlog note)

Round 2 deferred "faucet toast-region unification" to round 3. **Round 3's verdict: do NOT unify —
keep the faucet and extension toasts separate, by design.** Grounded in the code:

- **Faucet `useToast`** (`packages/faucet/src/composables/useToast.ts`) is a **queue** (up to
  `MAX_QUEUE = 4`), each entry `{id, kind: ok|error|info, text, link?}`, `push()`/`dismiss(id)`,
  per-entry TTL. Built for a web app running multi-step async (bridge/mint/drip) that surfaces several
  results at once, each with an explorer `link`.
- **Package `useToast`** (`packages/design/src/composables/toast.ts`, what the extension uses) is a
  **single transient singleton** (`{label, icon, color}`), `openToast()` REPLACES, one timer. Built
  for a ~360px popup showing one quick confirmation ("copied").

These are different **models**, not different skins — and the difference is driven by the genuinely
different host contexts (constrained popup vs full viewport). Unifying would either bloat the
extension into a queue it doesn't need or regress the faucet's queue + links. **And the steelman for
unifying is already spent (codex):** the faucet ALREADY reuses `@nulo/design`'s presentational
`Toast.vue` card — so the only un-shared parts are the queue STATE model + the region layout, which
are exactly the context-driven differences worth keeping separate. **Action:** record this as a
settled non-goal across the backlog + round-2 wrap-up, and remove "toast unification" from future-work.

## Locked decisions (clarifying answers — do NOT re-litigate)

1. **Scope = full round-3 close** — all four items below.
2. **`dark` quirk = drop the color name** (not declare `--gray-15`). The 8 `color="dark"` call sites
   repoint to a real token; `.color--dark` is deleted.
3. **Validation = design + faucet + builds + network e2e.** Network e2e + human visual no-deltas gate
   the extension-runtime-visible phases (P4 especially).

## Phases (sequenced low → high risk)

### P1 — Toast: record the keep-separate decision (docs only) ✓ DONE

No code. Document the verdict + its grounded reasoning (the model/context table above) in:
- `implementations-plan/design-system-externalization/round-2-backlog.md` — flip the "Tooling /
  cleanup" + "Components held back" toast lines from "unify later" to "KEEP SEPARATE (round-3
  decision) — see round-3 plan", with a one-line why.
- `implementations-plan/design-system-externalization-round-2/WRAP-UP.md` + `plan.md` round-3 notes:
  strike "toast-region unification" from the deferred list; point at this decision.
- `implementations-plan/index.md`: add the round-3 entry.
- Grep the repo for any other "toast unification / AppToastRegion unify" future-work reference and
  reconcile it.

**Validation gate** — `bun run lint` (exit 0); `scripts/check-no-brand.sh` clean (pre-commit);
no broken intra-repo doc links (manual scan). Layers: lint + docs. (No app code touched.)

### P2 — Drop the `dark` color name ☐

`.color--dark` (`packages/design/src/utilities.css:152`) references the undeclared `--gray-15`, so
`color="dark"` silently INHERITS instead of rendering gray — a pre-existing bug. **8 live call sites**
(`TokenMetadataPopup.vue` ×7, `ReceivePopup.vue` ×1 — masked "•••" dots + boolean metadata labels).

**Important (codex):** `color="dark"` does NOT currently render gray — `--gray-15` is undeclared so the
8 sites **inherit full body text color**. So the real visible delta is **full-color → muted**, not
"fix a gray". This is an explicit approval-gate design decision (below), not a silent cleanup.

1. Repoint the 8 `<Text color="dark">` sites per the **approved SPLIT** (gate decision, see
   `dark-color-options.html`): the **2 masked-`•••` dots** (`TokenMetadataPopup.vue:79`,
   `ReceivePopup.vue:65`) → **`tertiary`**; the **6 mono metadata values** (`TokenMetadataPopup.vue`
   :125/138/151/168/181/194) → **`secondary`**. (Dots recede; metadata stays readable but muted under
   its labels.)
2. Delete `.color--dark` from `utilities.css:152`; remove `dark` from the Text color contract/type +
   `token-contract.ts`/`tokens.parity.test.ts` if enumerated.
3. **The SCSS side is STILL LIVE (codex — my "round-2 dropped `_text.scss`" claim was wrong):**
   `_text.scss:57` maps `"dark": "--gray-15"` and `_base.scss:2` `@use`s it, and `_base.scss` is
   imported live (`setup/index.ts`, `onboarding.scss`). Remove the `dark` entry from `_text.scss`'s
   color map (and confirm nothing else in `_base.scss`/`_text.scss` re-defines `dark`/`--gray-15`).
4. Update `packages/design/src/core/Text.test.ts` (drop any `dark` case).

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` · `bun run test`
(the 8 repointed sites compile + Text tests green) · `bun run lint` · `bun run build` ·
`bun run build:faucet`. Pass: all exit 0; **NO `color="dark"`, `.color--dark`, `.fill--dark`, the
`"dark":` SCSS map entry, or `--gray-15` reference remains** (`grep -rn` across `packages/*/src` →
empty, excluding this plan). **Visible change → covered by P4's visual sign-off (per-context
screenshots of the 8 sites).** Layers: typecheck · lint · unit · both builds.

### P3 — Retire `AppButton` + migrate `DripButton` ☐

`AppButton` (`packages/design/src/ui/AppButton.vue`) is consumed **only** by `DripButton`
(`packages/design/src/composite/DripButton.vue` — its last consumer; verified: no other importer).
`DripButton` is a 30-line wrapper rendering `<AppButton variant="outline">`.

1. Migrate `DripButton`: `<AppButton variant="outline">` → `<Button variant="primary_outline">` (the
   round-2 cutover mapping). Preserve `:aria-label`/`@click`/slot + the `:data-loading="loading"` test
   hook (it falls through `Button`'s single-root `$attrs` — assert it lands). **MANDATORY (codex HIGH,
   not optional):** `AppButton` disables-on-loading but `Button` does NOT native-disable or gate click
   (`Button.vue:96`), and DripButton's disable-on-loading is PINNED (`DripButton.test.ts:36`) + relied
   on live (`TokenCard.vue:196`). So set `:disabled="disabled || loading"` on the base — else a drip
   button re-fires mid-request. Keep/extend the `data-loading` + disabled-on-loading pins.
2. Delete `AppButton.vue` + `AppButton.test.ts` + its `index.ts` export (`index.ts:23`). (No stories.)
3. Update `DripButton.test.ts` (it mounts the real wrapper — re-point the AppButton assumption to
   `Button`; keep the loading→disabled + data-loading assertions). `mount-all.test.ts` if it lists
   `AppButton`. (NOTE: `boundary.test`/resolver-inventory do NOT name `AppButton` — don't touch them.)

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` (DripButton green;
no `AppButton` refs remain) · `bun run test:faucet` (TokenCard/DripButton render + interact) ·
`bun run lint` · `bun run build:faucet` · `bun run build`. Pass: all exit 0;
`! grep -rn AppButton packages/*/src` (except this plan). Layers: typecheck · lint · unit · both builds.

### P4 — Delete the 9 round-1 local SFC shadows (the risk-bearing phase) ☐

Round 1 externalized 9 primitives but **left the extension-local copies in place**, and `components.d.ts`
+ the dir-scan resolve the bare tags to those LOCALS — so the round-1 externalization is inert. The
locals have **drifted** from the package versions, and the drift is **MIXED, not uniformly benign**
(codex HIGH corrected my earlier "behavior-preserving" claim):
- **Pure TS ports (behavior-identical):** Flex, Text, MaterialIcon, Badge, SectionLabel, Icon
  (`lang="ts"` + casts + reformat; `BrutalistTitle` byte-identical; Icon's `icons.json` byte-identical
  → no glyph change). To be CONFIRMED per-component, not assumed.
- **Reconciliations (package DIVERGED with real behavior the local lacks):** **Checkbox** — package
  guards `!disabled && emit(...)` on click/Enter (`Checkbox.vue:11`); the local emits unconditionally
  (`Checkbox.vue:8`). **Toggle** — package adds a real `color` prop the local lacks (`Toggle.vue:4`).
  Adopting these is an improvement, but it IS a behavior change → needs targeted unit tests + semantic
  (not just visual) review.

The 9: `core/{Flex,Icon,Text,MaterialIcon}`, `ui/{Badge,BrutalistTitle,Checkbox,SectionLabel,Toggle}`.

1. **Per-component classification (BEFORE deleting) — codex condition:** diff each of the 9
   extension-local SFCs vs its package counterpart, tag it **port** (behavior-identical) or
   **reconciliation** (package behavior differs), and record the verdict + diff summary in
   `lessons/phase-4.md`. Do NOT assume the small-diff ones are pure — verify all 9. For every
   **reconciliation**, add a FOCUSED unit assertion pinning the adopted behavior BEFORE deleting the
   local (at minimum: Checkbox `disabled` click/Enter does NOT emit; Toggle `color` prop applies), and
   flag it as a SEMANTIC change for the sign-off (not just a pixel diff).
2. **Icon `icons.json` parity (verified identical at plan time):** re-assert
   `@nulo/design/internal/icons.json` == extension `assets/icons.json` immediately before deleting local
   Icon (`jq -S` diff → empty). Currently byte-identical (both 104 keys), so no reconciliation is
   expected — this is a guard against drift landing between plan and execution, not open work.
3. Delete the 9 local SFCs (+ any local `.test.ts`/`.stories.ts` whose subject moved — re-point
   coverage to the package's existing tests; do NOT drop a behavior assertion without a package equivalent).
4. Regenerate `components.d.ts` (build) → the 9 now resolve to `@nulo/design`. Update the
   resolver-inventory test: drop the round-2 "round-1 names are aspirational" caveat — they are now
   genuinely deleted-and-migrated. Tighten it to assert no local `src/components/**/<Name>.vue` shadow
   remains for any `NULO_DESIGN_COMPONENTS` entry.
5. Round-1 cleanup debt (codex MEDIUM 2 from round 2) is now closed.

**Validation gate** — `bun run typecheck:all` · `bun run --cwd packages/design test` · `bun run test`
(extension units; auto-import + components.d.ts resolve the bare tags to `@nulo/design`) ·
`bun run lint` · `bun run audit:vue` (build) · `bun run --cwd packages/extension build-storybook` ·
`bun run test:e2e` (smoke; no NEW failures vs base flake) · `bun run e2e:agent` (**network e2e**) ·
**both-app human visual "no-deltas" sign-off** (extension chrome+firefox, light+dark — focus icons,
Flex layouts, Text colors incl. the P2 `dark`→`tertiary` change, Checkbox/Toggle/Badge; faucet
unaffected). Pass: all exit 0; network green; no NEW smoke failures; human confirms no deltas.
**Do NOT mark ✓ without the visual sign-off.** Layers: full stack.

## Security & Adversarial Considerations

Presentational-primitive cleanup; no new trust boundary, network surface, secret, or auth path.

- **Threat surface:** unchanged. The package stays dependency-pure (no `@nulo/*`, `chrome.*`,
  `vue-router`) — `boundary.test.ts` (round-2, widened) still enforces it; deleting local shadows
  doesn't touch that floor.
- **XSS:** no new HTML-string prop or `v-html` sink (the `boundary.test` tripwire covers the package;
  `Text`/`Icon` render text/SVG-path data, not arbitrary HTML). `Icon` renders SVG `path` from a static
  bundled `icons.json` (not user input) — confirm the package `icons.json` is the same static asset class.
- **Supply chain:** no dependency changes. No `package.json`/lockfile edits expected; if any surface,
  the 7-day min-age + frozen-lockfile policy applies.
- **Least privilege / crypto / input validation:** N/A (no credentials, crypto, or trust-boundary input).
- **Adversarial what-ifs:** (a) a drifted local SFC hiding an extension-only security-relevant tweak →
  mitigated by the P4 per-component diff review. (b) `icons.json` divergence silently dropping a glyph
  used in a security-relevant UI (e.g. a warning icon) → mitigated by the superset HARD GATE + visual
  sign-off. (c) the `dark`→`tertiary` repoint changing a contrast ratio below a11y threshold → checked
  at the visual sign-off.

## Assumptions

**Facts (verified):**
- `AppButton` is consumed only by `DripButton` (`grep`: importers = `index.ts`, `DripButton.vue`,
  `DripButton.test.ts`). `DripButton.vue` renders `<AppButton variant="outline">`.
- All 9 round-1 local SFCs still exist under `packages/extension/src/components/{core,ui}/`.
- Local-vs-package drift is the round-1 JS→TS port (Flex/Icon diffs = `lang="ts"` + casts + format;
  `BrutalistTitle` identical; others 2–9 lines).
- `Icon` package copy imports `internal/icons.json`; extension-local imports `@/assets/icons.json` —
  and the two files are **BYTE-IDENTICAL** (both 104 keys, verified via `jq -S` diff). So the Icon
  migration changes no glyph; the icon-set-divergence risk is closed at plan time.
- `.color--dark` is defined once in `packages/design/src/utilities.css:152` (refs undeclared
  `--gray-15`); 8 `color="dark"` call sites (`TokenMetadataPopup.vue` ×7, `ReceivePopup.vue` ×1).
- Faucet `useToast` = 4-deep queue with links; package `useToast` = single-transient singleton.
- **CORRECTED (codex HIGH):** the round-1 drift is MIXED, not uniform ports — **Checkbox** + **Toggle**
  are RECONCILIATIONS (package added behavior the local lacks: Checkbox `!disabled && emit` guard,
  Toggle `color` prop). The rest are ports (verify per-component in P4).
- **CORRECTED (codex MEDIUM):** `_text.scss` STILL SHIPS — `_text.scss:57` maps `"dark": "--gray-15"`,
  `_base.scss:2` `@use`s it, and `_base.scss` is imported live (`setup/index.ts`). So `dark` is defined
  in TWO places (package `utilities.css` + extension SCSS); P2 must clean both.
- **CORRECTED (codex):** `color="dark"` renders INHERITED full text color today (not gray — `--gray-15`
  is undeclared). So repointing to `tertiary` MUTES the 8 sites — a real visible delta.

**Inferences (unverified — attack these):**
- The 7 "port" primitives (Flex/Text/MaterialIcon/Badge/SectionLabel/BrutalistTitle/Icon) are truly
  behavior-identical — P4 step 1 confirms each (do NOT assume the small diffs are pure).
- `tertiary` is the right replacement for `color="dark"` (muted de-emphasized text). Gate decision +
  per-context screenshots confirm.

**Asks — RESOLVED at the gate:**
- **`color="dark"` → token: SPLIT** (chosen) — `tertiary` for the 2 `•••` dots, `secondary` for the 6
  mono metadata values. (Mockup: `dark-color-options.html`.)
- **P4 tier: (A) keep with reconciliation rigor** (chosen) — P4 stays in this arc with per-component
  classification + targeted unit tests + semantic review + network-e2e + visual sign-off.

## Decision ledger

- **Toast: keep separate (NOT unify).** Rejected "unify the toast region" (the round-2 backlog item):
  the two are different state models driven by different host contexts; unifying degrades one side. The
  only shareable bit (a presentational card) also diverges (kind vs icon). Net negative — cut it.
- **`dark`: drop, not declare.** Rejected "declare `--gray-15`": that resurrects a color nobody
  deliberately uses + keeps a misleading name. Dropping + repointing 8 sites to `tertiary` is cleaner.
- **Round-1 cleanup: adopt the package TS ports, don't re-port locally.** The package versions ARE the
  round-1 ports; delete the JS shadows rather than re-converting. Reconcile only genuine drift.
- **P4 sequenced last + heaviest-gated** so the three low-risk wins land first and the blast-radius
  phase is isolated (own PR, own network-e2e + visual gate, independently revertible).

### Codex audit (`019ee946-…`) — verdict: **conditional approve**

Conditions + dispositions (transcript in `audit-codex.md`):
- **[HIGH] P4 not behavior-preserving** (Checkbox disabled-guard, Toggle `color` prop are reconciliations,
  not ports) → **ADOPTED:** P4 reclassified (ports vs reconciliations), per-component verification +
  targeted unit tests for the reconciled behaviors required before delete.
- **[HIGH] DripButton disable-on-loading is mandatory** (Button doesn't gate click; current semantics
  pinned + live) → **ADOPTED:** P3 now requires `:disabled="disabled || loading"`.
- **[HIGH] `light` optimistic for P4** → **SURFACED to the gate** as Ask (A) keep-with-rigor or (B) split.
- **[MED] `dark→tertiary` is a visible design choice** (current = inherited full color, not gray) →
  **ADOPTED:** explicit gate decision with per-context detail.
- **[MED] `_text.scss` still ships** (my "dropped" claim was wrong) → **ADOPTED:** P2 cleans the SCSS side.
- **[MED] Icon check should be deep-equality** → **ADOPTED** (already `jq -S` diff; verified identical).
- **[LOW] P3 over-listed touched tests; P2 gate too narrow** → **ADOPTED** (trimmed P3; P2 gate now also
  proves `.color--dark`/`.fill--dark`/`--gray-15`/`"dark":` gone).
- **Verified-correct by codex:** AppButton only consumed by DripButton; `icons.json` byte-identical;
  toast keep-separate is sound (faucet already shares the card).

## Seeds

**`/goal`** (recommended — completion is transcript-observable via plan.md ✓ + gates):
```
/goal All 4 phases marked ✓ in implementations-plan/design-system-externalization-round-3/plan.md (the per-phase headers in the file, not just chat), each ✓ backed by its phase's Validation gate (exact commands + pass criteria in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/design-system-externalization-round-3/lessons/phase-N.md`; the toast keep-separate decision is recorded across round-2-backlog.md + the round-2 wrap-up; no `color="dark"` and no `AppButton` references remain in packages/*/src; the 9 round-1 local SFC shadows are deleted and the resolver-inventory test asserts no shadow remains; `/code-review max --fix` complete with findings applied + committed separately; codex post-impl audit (`/codex xhigh`) complete with high/critical addressed; `bun run audit:vue` and `bun run lint` both exit 0 in the transcript. P4 sign-off recorded in lessons (extension "no-deltas" chrome+firefox incl. icons + the dark→tertiary repoint; faucet unaffected).
```

**`/loop`** (fallback — fixed interval):
```
/loop 15m Drive implementations-plan/design-system-externalization-round-3 forward. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative); `git status` + `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup` (no --watch). (2) Waiting on CI is fine — confirm progress; use the wait to review the diff / prep the next phase. (3) No task? Take the next pending step from plan.md; after each edit run `bun run lint` + the touched-package tests; commit → push. (4) Stuck/deciding? `/codex xhigh`, reach a defensible call, log it in lessons/phase-N.md. Never merge to main/release, never publish, never expand scope beyond plan.md. (5) Same step failed 5×? Stop, reassess with codex. (6) Phase green = its plan.md Validation gate passes; paste the result, mark ✓, file lessons, print `LESSONS_FILE=...`, advance. (7) All 4 ✓? `/code-review max --fix` → commit → codex post-impl audit → address high/critical → write the wrap-up and stop. P4 needs the human visual no-deltas sign-off before ✓ — surface and hold for it.
```
