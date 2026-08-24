# Phase 4 — Lockfile events: excludes removal, then regeneration with a wallet-grade review

## Commit A — `minimumReleaseAgeExcludes` removed (0fc7a153)

34 entries (the @aztec 5.0.1 client set + @alejoamiras/aztec-accelerator, aged out ~2026-07-23 by bunfig's own dated TODO) deleted with their rationale block; the CVE-bypass procedure comment retained and made truthful. Gate: `bun install --frozen-lockfile` → "no changes", exit 0 — the pinned tree needs no exemption, so the 7-day gate is REAL for the regeneration.

## Regeneration review — performed on a DRY regen in scratch BEFORE touching the repo lock

Method: copy manifests/bunfig/patches to scratch, delete bun.lock, `bun install --lockfile-only` under the exemption-free 7d gate (resolves; 1,103 packages; `lockfileVersion: 2`, `configVersion: 1`), then a FULL-RECORD comparison (name@version, integrity, resolved, dep/peer/optional edges, bin, scripts) via a purpose-built extractor/comparator, not name@version alone.

| Class | Result |
|---|---|
| Records | 1,161 → 1,166 |
| **Frozen scopes** (`@aztec/*`, `@aztec-foundation/*`, `@alejoamiras/*`): version + integrity + resolved equality | **0 violations** — byte-identical |
| Version moves | 224, all in-range re-resolutions |
| Integrity/resolved-only drift on unchanged versions | 0 |
| Bin / install-script changes | 0 |
| Dep/peer edge changes | 73 (consequences of the moves) |
| Added / removed names | 23 / 18 — all dedup consolidations of nested copies (OTel `sdk-metrics`/`semantic-conventions`, `@scure/base`, `string_decoder`/`safe-buffer`, `unplugin`) + platform-binary churn (`@rolldown/binding-wasm32-wasi`, `@parcel/watcher-win32-ia32`) |
| @aztec SUBTREE moves | 2 patch bumps deep under `noir_codegen` (`glob → minimatch 10.2.5→10.2.6`, `brace-expansion 5.0.7→5.0.9`) |
| Noir duplicate-copy count (vite.config's documented hazard) | 1 each, pre AND post |
| Major-version crossings | 9 — every one consumed ONLY by third-party packages that bumped in lockstep (puppeteer→chromium-bidi 17; fast-xml-parser 5.11→is-unsafe 2 + @nodable/entities 3; unplugin-auto-import→unimport 6→strip-literal 4→js-tokens 10; cliui/yargs→string-width 8; storybook/vue-router/unplugin-* → unplugin 3). Our source calls none of the changed APIs (verified: no repo imports of any of them). `bun pm diff` read for the three riskiest: `@nodable/entities` (constructor now requires an explicit entity set — fast-xml-parser 5.11 was updated for it), `is-unsafe` (string contexts → imported pattern arrays; same consumer), `@scure/base 2.2.0→1.2.6` (NOT a downgrade of a live consumer: the 2.2.0 record existed only for `@scure/bip39@2.2.0`, demanded by `@aztec/foundation`'s range which equally admits the 1.6.0 line every other consumer uses; the regen consolidated to the `~1.2.5` all five remaining consumers require; no repo source imports `@scure/bip39`) |
| Bundle reachability (lock-graph walk from `apps/extension` prod `dependencies`, workspace deps inlined; rolldown strips paths from dist so the graph is the oracle) | 525-record prod closure; **68 of the 224 moves are bundle-reachable** (aws-sdk/smithy chain, axios, vue + compilers, codemirror, postcss, nanoid, fast-xml-parser chain, string_decoder, the two noir_codegen patch bumps, …) |
| Publish age + provenance (npm registry `time` + `dist.attestations`/`signatures`) | **youngest of ALL 224 moves: 7.4 days** (puppeteer 25.8.0 line, 2026-08-17) — the gate held with zero exemptions; 135 attested, remainder registry-signed, **0 without provenance, 0 lookup errors** |
| Advisory delta (`bun audit --audit-level=low`, scratch install of the dry lock) | **40 → 23** (22 → 10 high, 15 → 10 moderate, 3 → 3 low) — 17 advisories retired, none introduced |

Decision: the regeneration is APPROVED for execution against the repo — every wallet-grade class is populated and clean. Post-execution: double-install fixed point + frozen install + the explicit post-regen battery (audit:vue, test:all, identity, smoke, build:full, packaged-output + WASM-hash re-comparison against the Phase 3 record).
