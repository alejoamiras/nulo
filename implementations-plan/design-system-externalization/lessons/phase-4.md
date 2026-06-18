# Phase 4 — Pure L2 (Badge, BrutalistTitle, Checkbox, SectionLabel, Toggle)

Branch: `feat/design-system-p4-l2` (stacked on `feat/design-system-p3-core`). Machine-gated.

## What shipped
Same proven mechanic as Phase 3 — `git mv` the 5 components + their tests into
`packages/design/src/ui/`; the shared `unplugin-vue-components` resolver now maps their tag names too
(`NULO_DESIGN_COMPONENTS` += the 5); exported from `index.ts`; `components.d.ts` regenerated.

Per-component script changes (styles kept verbatim — global classes provided by base.css):
- `Badge` → `lang=ts` + `import Flex from "../core/Flex.vue"`.
- `Checkbox` → `lang=ts` + explicit `Flex` + `Icon` imports.
- `Toggle` → `lang=ts` + `import Icon` + **declared the read-but-undeclared `color` prop** (it read
  `props.color` with no prop def — undefined → no-op inline bg; declaring it optional keeps the
  behavior + satisfies TS). `data-testid="toggle-switch"` preserved verbatim.
- `SectionLabel` → `lang=ts` (no children).
- `BrutalistTitle` → already `lang=ts`, childless → moved verbatim.

The 5 existing component tests moved with them and pass unchanged in the package env (they don't
depend on extension setup; the explicit child imports make stubs unnecessary). Added all 5 to the
branch-aware `mount-all` gate.

## Gotcha — orphaned stories
`git mv` moved `.vue` + `.test.ts` but NOT `.stories.ts`, so the 5 `*.stories.ts` were left importing
the deleted `./X.vue`. Typecheck/build didn't catch it (stories are excluded from both; only the
pre-broken storybook would). Fix: repointed each story `import X from "./X.vue"` →
`import { X } from "@nulo/design"` (kept in extension src; the storybook resolver handles the template
tags). Round-2: move stories into the package + glob them once the storybook/rolldown tooling is fixed.

## Gate — green
- typecheck:all 0 · lint 0 (1101 files) · biome stories clean.
- design tests **136** (24 files: the 5 moved L2 tests + mount-all now covering 9 components + drift +
  parity + boundary) · extension tests 2398 · build chrome + firefox + faucet 0.
- smoke e2e 66/67 — only the pre-existing FPC-row flake (confirmed identical p1→p4); no regression.
- build-storybook still pre-broken (storybook+rolldown alias, not mine — see phase-3 lessons).

Round-1 component scope now fully migrated: L0 tokens + base/theme/font + L1 (4) + L2 (5).
Remaining: Phase 5 (cleanup, docs, full e2e, round-2 backlog) + the user's visual sign-offs (2 + 5).
