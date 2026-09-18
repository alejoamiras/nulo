# Phase 2 — Firefox manifest items

## What shipped

`browser_specific_settings.gecko` gains `data_collection_permissions: { required: ["none"] }` and `strict_min_version: "153.0"`; the id stays `wallet@nulo.sh`. All three are pinned in `src/manifest.test.ts`, and the built `dist/firefox/manifest.json` carries them verbatim.

Mozilla's validator accepted both new keys with **no schema warning** — worth stating, because the risk was that `web-ext` 10.6.0 predated `data_collection_permissions` and would have flagged it as an unknown property.

## Unplanned but in scope — `sidePanel` was an invalid permission

The gate's own `web-ext lint` run surfaced `MANIFEST_PERMISSIONS: /permissions: Invalid permissions "sidePanel" at 2`. `FIREFOX_INCOMPATIBLE_PERMISSIONS` filtered `background` and `offscreen` but not `sidePanel`, which is Chrome-only — Firefox's equivalent is `sidebar_action`. Every call site was already feature-gated (`chrome.sidePanel?.` in `popup/app.vue:73`, `...(chrome.sidePanel ? … )` in `settings/appearance.vue:42`), so dropping the permission costs nothing at runtime. Added to the filter set with a test. Warning count 18 → 17.

Kept minimal: the `side_panel` manifest **key** is also meaningless in Firefox, but the validator does not flag it and Firefox ignores unknown keys, so it stays.

## DEVIATION — the gate's "0 errors" is not met, and cannot be met here

`bunx web-ext@10.6.0 lint --source-dir dist/firefox --self-hosted` reports **1 error**:

```
FILE_TOO_LARGE  File is too large to parse.  assets/offscreen-BvYQZHn4.js
```

That chunk is **20.3 MB** (`barretenberg-*.js` 4.1 MB and `public-events-*.js` 4.4 MB are the next largest). It is a pre-existing property of the Firefox bundle — three manifest JSON keys cannot affect a JS chunk's size — and it is unrelated to anything this phase touched.

**What it means:** web-ext cannot parse the file, so it cannot scan it. For an AMO submission that is a blocker, and it is part of the same problem the owner already scoped out (AMO needs a source package plus build instructions precisely because reviewers cannot process bundles like this). It blocks nothing in arcs 3–6: no Firefox test lane runs `web-ext lint`.

**Status:** the manifest half of the gate passes with zero manifest-attributable errors or warnings. The literal "0 errors" text does not pass. Recorded here rather than quietly rewritten — the owner rules on whether to restate the gate as "zero errors attributable to the manifest" or to treat the bundle as in scope.

## Also surfaced, not fixed

`ICON_SIZE_INVALID` ×4 — the manifest declares 16/24/32/128 px icons that all point at `src/assets/logo.png`, which is 512 px. Shared with the Chrome build, cosmetic on AMO, out of this phase.
`DANGEROUS_EVAL` ×6 and `UNSAFE_VAR_ASSIGNMENT` ×5 in vendored Aztec/ABI chunks, `UNSUPPORTED_API` ×2 — all pre-existing, all AMO-review concerns for the store-launch plan, none of them manifest defects.

## Gate

`bun run lint` → 0 · `bun run typecheck` → 0 · `vitest run src/manifest.test.ts` → 11 passed (3 new) · `bun run --cwd apps/extension build:firefox` → 0 · `web-ext@10.6.0 lint` → 0 manifest errors, 1 pre-existing `FILE_TOO_LARGE` (see DEVIATION).

`web-ext@10.6.0` published 2026-08-04, comfortably past the 7-day supply-chain gate; pinned exactly on the command line, never added as a dependency.
