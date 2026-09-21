# Phase 9 — every shipped file under the linter's parse limit

Five things the spike got wrong or missed. The first build that "passed" would have shipped a wallet that never starts.

## 1. The oversized module was misidentified

The spike saw a 6.1 MB chunk starting `var e={file_map:JSON.parse(…` and attributed it to the aliased Wonderland Token. With the strip wired to the two aliased artifacts the chunk came back byte-identical (same content hash), which gave it away. The `"path"` strings inside it point at `noir-contracts/contracts/app/token_contract` — it is `@aztec/noir-contracts.js`'s `token_contract-Token.json`, 7.0 MB on disk, imported by `packages/aztec-runtime/src/pxe/artifact-catalog.ts`. Lesson: identify a chunk by a string from inside it, not by its first bytes.

## 2. `file_map` alone is not enough for that artifact

Key sizes, minified: `file_map` 1.42 MB, `functions` 4.65 MB — of which `bytecode` 3.11 MB, `debug_symbols` 1.06 MB, `abi` 0.37 MB. Without `file_map` it is 4,664,048 bytes: 54 KB under the guard, one dependency bump from red. Emptying `debug_symbols` too brings it to 3.57 MB.

Stripping both is also the cleaner behaviour, not just the smaller one. With only `file_map: {}`, `getFunctionDebugMetadata` still returns debug info and `resolveOpcodeLocations` throws on the missing file; callers catch it. With `debug_symbols: ""` as well, `getFunctionDebugMetadata` returns nothing and `extractCallStack` takes its `!debug` branch — no exception in the path. `@aztec/stdlib` builds the same shape itself (`emptyFunctionArtifact`, `emptyContractArtifact`). The class id is unchanged for all three artifacts; the test asserts it per artifact, so an artifact bump that changed this goes red.

## 3. The web-accessible surface moved, and the gate caught it

With a plain `/node_modules/` group, both browsers' `web_accessible_resources` went from `content.ts`, `crypto`, `handlers` to `content.ts` plus three `vendor~content.ts…` chunks. Same modules regrouped, but one more file readable by every page, under names that change with the entry graph. The content script's only package import is `@aztec/wallet-sdk`, so it is never regrouped. After that both lists equal the pre-change baseline exactly — zero additions to explain.

## 4. A size cut builds a bundle that does not run

`maxSize` cuts a group into pieces with no regard for import cycles inside it. Three of the offscreen page's pieces imported each other; the first to run evaluated `pickConfigMappings(l1ContractsConfigMappings, ["aztecSlotDuration", …])` while `l1ContractsConfigMappings` — a `var` in a chunk that had not run yet — was still `undefined`. Firefox smoke: `TypeError: can't access property "aztecSlotDuration", e is undefined`, 27 times, the wallet never started, every test that needs it failed. **Build, `web-ext lint`, typecheck and 6,616 unit tests were all green on that bundle.** Only a browser saw it. The error string appears in none of the ~25 earlier smoke logs, which is how it was pinned on the split rather than on a flake.

Tried and rejected: `output.strictExecutionOrder: true`, rolldown's documented answer. It wraps every module in an init function, and @crxjs 2.7.1 decodes its manifest by parsing the manifest chunk and taking the **last string literal**; with wrapping, that literal is the import of rolldown's runtime (`Unexpected token '.', "./rolldown"... is not valid JSON`). Fixing that means patching @crxjs. `experimental.onDemandWrapping` might avoid it and is experimental. Neither is a foundation.

What shipped: cut along package boundaries (`scripts/vendor-chunks.ts`). One chunk per package in the proving/simulation/contract scopes, and — as a higher-priority group, because a group otherwise drags its modules' dependencies along, which is how the first attempt produced an 8.1 MB `noir-contracts.js` chunk — one chunk per JSON module of those packages. A JSON module imports nothing, and package boundaries cross far fewer cycles than a size cut. Everything else is left to the bundler, as before.

That is a likelihood, not a proof — packages can depend on each other, and a group carries its modules' dependencies along (codex, round 1; my first draft of this file claimed a DAG). So the thing that holds the line is a guard: `scripts/chunk-cycle-guard.ts` fails the build when chunks sit on a static import cycle, read from the bundler's own `chunk.imports` (exact; no regex over minified code). Checked both ways: the pre-change build has 0 cycles, the final build has 0, and the size-cut build fails with `chunks on a static import cycle:` naming its three `vendor~offscreen~index.ts-*` chunks.

## 5. Test files were shipping as routes

Rolldown names an entry-aware chunk after the entries that share it, and names like `vendor~…~_id_.test~…~scope-follow.test~…` showed up. `vite-plugin-pages` had no `extensions` restriction, so every `.ts` beside a page — 53 helper and test modules — was registered as a route and emitted as a lazy chunk: 37 `*.test-*.js` files (172 KB) in the build CI produced for #633, on both browsers, and on `dev` today. Never fetched at runtime, but shipped, and read by the linter and any store reviewer. `usePages({ extensions: ["vue"] })`; all 62 real pages are `.vue`. It also accounts for the warning count going *down* (below).

## Results

- `build:chrome`, `build:firefox`: exit 0 with both guards. Largest parsed file 4,138,965 bytes (`aztec-bb-js~barretenberg`, a single module with inlined WASM, unchanged from before the split). 508 asset files (was ~440), longest name 112 characters.
- `web-ext lint`: **0 errors**, 14 warnings (baseline: 1 error, 17 warnings). `DANGEROUS_EVAL` 6 → 3 and `UNSAFE_VAR_ASSIGNMENT` 5 → 3 — the rest lived in the shipped test chunks. `UNSUPPORTED_API` 2 → 4: `offscreen.createDocument` / `closeDocument` in `assets/offscreen-*.js`, feature-gated calls that were always there and invisible while the file holding them was too large to parse. That is the point of the phase: the linter now reads the whole bundle.
- `web_accessible_resources`: identical to the pre-change lists on both browsers.
- JS a page must load before it runs (static import closure): popup 6.60 → 4.32 MB, onboarding 1.67 → 1.64 MB, offscreen 48.9 → 42.7 MB.
- `bun run lint`, `typecheck:all`, `test` (6,625 passed): exit 0.
- Smoke e2e on smoke-flag builds of the package-boundary split: **Firefox exit 0, 113 passed / 16 skipped; Chrome exit 0, 123 passed / 6 skipped** — the same totals as the gate runs before the split. (Run on `3c9bf2bd`; the commit after it changed artifact chunk *names*, tests and comments only, and was re-checked statically: both builds, 0 cycles, `web-ext lint` 0 errors, web-accessible lists unchanged. CI smokes the final SHA.)

## Codex fix loop (GPT-6 Astra, `high`, one session resumed)

- **Round 1 — "no new material findings"**, conditional on the smokes and the WASM proofs, with four Lows, all taken: artifact chunk names could collide across directories (now the whole in-package path); the "package dependencies form a DAG" claim was false and is gone from code, plan and this file; the strip is a production-build guarantee only, not a dev-server one (the optimizer prebundle skips the hook); the fail-closed `buildEnd` had no test. It also confirmed against the installed `@aztec/*` 5.2.0 sources that hashing, class-id verification, registration and PXE serialization never need `debug_symbols`, and that the frozen SchnorrAccount artifact is outside the strip list and must stay there — its guarantee is byte identity, not class-id equivalence.
- **Round 2 — "no new material findings".** Converged.

## WASM-backend proof per browser

`tests/e2e/network/transfers.test.ts` through `e2e:agent`, on the final commit's code: **Firefox exit 0 (1 passed), Chrome exit 0 (1 passed)**. The backend is established by elimination, because the suite logs no backend name: neither bundle carries the proverless build stamp, neither carries the Presto-required stamp, and nothing listened on the Presto port (the run script refuses to start otherwise) — which leaves the wallet's silent fallback, bb.js WASM: its workers, its `barretenberg*.wasm.gz` assets and the `aztec-bb-js` chunks, exactly what this arc rechunked and what CI's Presto-required lanes never load.
