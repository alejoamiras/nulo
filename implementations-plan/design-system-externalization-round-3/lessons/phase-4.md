# Phase 4 — Delete the 9 round-1 local SFC shadows (the risk-bearing phase)

**Status:** machine-green; **network e2e (CI) + both-app human visual no-deltas sign-off PENDING** (the
locked gate — do NOT mark ✓ without it).

## Per-component classification (codex condition — before deleting)
Diffed each local shadow vs its `@nulo/design` counterpart:

- **Ports (7, behavior-identical):** `Flex`, `Text`, `MaterialIcon`, `Badge`, `SectionLabel` (lang="ts"
  + casts + format only); `BrutalistTitle` (byte-identical); **`Icon`** (a functions→computed refactor —
  `getIcon`/`isSplitted` → `iconData`/`singlePath`/`multiPath` — behavior-equivalent for string|array
  icon values; the `icons.json` is byte-identical (verified `jq -S`); the faucet already renders the
  package Icon live; covered by the package `core/Icon.test.ts` (single-path + array-path + role + fill +
  size)).
- **Reconciliations (2 — package added behavior the local lacked):**
  - **`Checkbox`** — package guards `!disabled && emit(...)` on click/Enter; the local emitted
    unconditionally. ALREADY pinned in the package test (`"disabled blocks click and Enter from
    emitting"`).
  - **`Toggle`** — package adds a real `color` prop (paints the ON-state background:
    `:style="{ background: modelValue ? props.color : '' }"`). The local lacked it. **Added a targeted
    pin** (`Toggle.test.ts`: color paints ON background, OFF leaves it unset).

So the round-1 cleanup is a KNOWING behavior adoption (the 2 reconciliations are improvements), not a
silent one.

## Deletions + what was kept
- Deleted the **9** local `.vue` shadows (`core/{Flex,Icon,Text,MaterialIcon}`,
  `ui/{Badge,BrutalistTitle,Checkbox,SectionLabel,Toggle}`) + the **5** local `.test.ts` that imported
  the local `./X.vue` (Badge/BrutalistTitle/Checkbox/SectionLabel/Toggle — the package tests are the
  canonical supersets; 0 local-only test-names, verified).
- **KEPT the 5 local `.stories.ts`** — they already import `@nulo/design` (round-1 repointed them), so
  they validly story the package component in storybook; deleting the local `.vue` doesn't touch them.
- No explicit importer of any of the 9 (all consumed via bare tags → the resolver), so deletion is safe.

## components.d.ts (gotchas)
- HEAD already mapped the 9 → `@nulo/design` (round-2 curated it aspirationally while the shadows still
  won the dir-scan). P4 makes that mapping REAL by deleting the shadows → the FILE is unchanged.
- `build-storybook` regenerates an INCOMPLETE components.d.ts (it scans a narrower set → dropped 7
  entries). Restored components.d.ts to HEAD (the full, build-consistent, typecheck-passing version).
- `Badge` is absent from components.d.ts even at HEAD — a pre-existing dev state (not a bare-tag
  typecheck-critical component; the resolver still maps it at build). Orthogonal to P4; left as-is.
- Orthogonal auto-imports/eslintrc regen churn (`toRestoreError`) restored to dev baseline each build.

## Resolver-inventory test
Dropped the round-2 "round-1 names are aspirational" caveat (they're now genuinely deleted-and-migrated)
+ added a **no-shadow guard**: globs `src/components/**/*.vue`, asserts no basename matches a
`NULO_DESIGN_COMPONENTS` entry. Re-introducing a local `Flex.vue` now fails CI (codex MEDIUM 2 closed).

## Validation gate
- `bun run typecheck:all` → 0 · `bun run --cwd packages/design test` → 244 (Toggle color pin) ·
  `bun run test` → 2380 (−5 local test files; +1 no-shadow guard; bare tags resolve to `@nulo/design`) ·
  `bun run lint` → 0 (auto-formatted the no-shadow test) · `bun run audit:vue`/`build` → 0 ·
  `bun run --cwd packages/extension build-storybook` → 0.
- `bun run test:e2e` (smoke): **70 passed, 0 failures** (clean — no `ctx.browser` flake this run).
- **REMAINING (gate the ✓):** `bun run e2e:agent` network suite (CI on the PR, forced via `e2e:network`
  label like round 2) + the **both-app human visual no-deltas sign-off** — extension chrome+firefox
  (icons, Flex layouts, Text colors incl. the P2 `dark`→tertiary/secondary, Checkbox/Toggle/Badge);
  faucet DripButton. Cannot be done autonomously; surfaced to the user.

## Closeout (blueprint step 8)
- **`/code-review max`:** NO findings. The diff was codex-pre-audited (all conditions folded) + carefully
  implemented; split + DripButton-test re-points verified correct (equivalent-or-better, not weakened).
- **Codex post-impl (`/codex xhigh`): ship-with-fixes, no high/critical.** Confirmed all pins (Checkbox
  guard, Toggle color), the DripButton disable, the full `dark` removal, icons.json byte-identical, no
  missed reconciliation among the 7 ports. **One MEDIUM (FIXED, `6ece24d`):** the no-shadow guard only
  globbed `src/components/**` but Vite auto-registers from `src/components` AND `src/onboarding/
  components` (`vite.config.ts:155`) — widened the guard's glob to mirror Vite's scope. LOW nits (left):
  the DripButton variant pin via `/primary_outline/` hashed-class is adequate; `Badge` absent from
  components.d.ts is benign (no bare `<Badge>` call sites).

LESSONS_FILE=implementations-plan/design-system-externalization-round-3/lessons/phase-4.md
