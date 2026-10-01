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

**What it means:** web-ext cannot parse the file, so it cannot scan it — an AMO blocker on its own. Shipping a source package plus build instructions is a *separate* AMO requirement and does not clear it; the chunk has to shrink. It blocks nothing in arcs 3–6: no Firefox test lane runs `web-ext lint`.

**`--metadata` is not a narrower gate — it is a weaker one.** Tested against a deliberately broken manifest (bogus permission, invalid `data_collection_permissions` category, malformed `strict_min_version`): `--metadata` catches both invalid gecko keys as errors and exits non-zero, but reports **zero warnings of any kind**. `MANIFEST_PERMISSIONS` is a *warning*, so the `sidePanel` defect this very phase found would have passed `--metadata` silently. Rejected.

**Proposed EXCEPTION (awaiting owner authorization — Phase 2 is NOT marked done against it).** An earlier draft of this section called the amendment "stricter than zero errors". That was wrong, and the arc's review said so: a rule admitting one error accepts a result the original rejects. It is narrower than "ignore manifest-unrelated errors" and weaker than zero errors, and it needs the owner's explicit exception rather than a claim of compliance. **The full lint result stands as FAILED.**

What is actually being asked for, scoped as tightly as it can be:

- keep the full `--self-hosted` lint — `--metadata` is out for the reason above;
- permit **zero or exactly one** error record, and only this one, identified by name *and* content so a rebuild cannot inherit the exception silently: `assets/offscreen-BvYQZHn4.js`, 20,263,920 bytes, sha256 `e2ff2f441afe2e2bfda2e3bbc714b503580b456afa4f76a2ef939e1cd867c609`. A different chunk, a second oversized file, or any other code re-opens the decision. (Zero is permitted too — shrinking the bundle must not fail an exact-set check.)
- **warnings are reviewed, not counted.** An errors-only rule passes a newly introduced permission warning, which is exactly the class of defect this phase caught.

**What the exception costs, stated plainly:** `FILE_TOO_LARGE` means the linter never scans that chunk at all. Syntax errors and security findings inside 20.3 MB of Aztec/barretenberg bundle stay invisible behind it. This accepts a known blind spot; it does not shrink one.

**Status:** zero errors and zero **new** warnings are attributable to this diff — it removed one (`sidePanel`), 18 → 17. The four `ICON_SIZE_INVALID` warnings below are manifest-attributable but pre-existing and shared with the Chrome build. The literal "0 errors" text does not pass. Recorded here rather than quietly rewritten.

## Also surfaced, not fixed

`ICON_SIZE_INVALID` ×4 — the manifest declares 16/24/32/128 px icons that all point at `src/assets/logo.png`, which is 512 px. Shared with the Chrome build, cosmetic on AMO, out of this phase.
`DANGEROUS_EVAL` ×6 and `UNSAFE_VAR_ASSIGNMENT` ×5 in vendored Aztec/ABI chunks, `UNSUPPORTED_API` ×2 — all pre-existing, all AMO-review concerns for the store-launch plan, none of them manifest defects.

## Gate

`bun run lint` → 0 · `bun run typecheck` → 0 · `vitest run src/manifest.test.ts` → 11 passed (3 new) · `bun run --cwd apps/extension build:firefox` → 0 · `web-ext@10.6.0 lint` → 0 manifest errors, 1 pre-existing `FILE_TOO_LARGE` (see DEVIATION).

`web-ext@10.6.0` published 2026-08-04, comfortably past the 7-day supply-chain gate; pinned exactly on the command line, never added as a dependency.

## Arc 2 boundary — codex fix loop (GPT-6 Astra, `high`) — converged

Round 2 was a conditional approve whose one remaining issue was how the lint deviation was described. `49afcf03` recast it as an explicit exception (above); the same session, resumed with that delta, returned **"approve — no new material findings"**, adding that the recorded filename, byte size and SHA-256 match the artifact and that "the full lint remains failed, and Phase 2 remains incomplete pending explicit owner authorization of the exception". That is the state this file records: the loop is closed, the phase header is not ticked.
