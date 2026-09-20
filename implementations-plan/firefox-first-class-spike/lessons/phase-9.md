# Phase 9 — every shipped file under the linter's parse limit

## What the spike got wrong

**The oversized module was misidentified.** The spike saw a 6.1 MB chunk starting `var e={file_map:JSON.parse(…` and attributed it to the aliased Wonderland Token. With the strip wired to the two aliased artifacts the chunk came back byte-identical (same content hash), which is what gave it away. The `"path"` strings inside it point at `noir-contracts/contracts/app/token_contract` — it is `@aztec/noir-contracts.js`'s `token_contract-Token.json`, 7.0 MB on disk, imported by `packages/aztec-runtime/src/pxe/artifact-catalog.ts`. Lesson: identify a chunk by a string from inside it, not by its first bytes.

**`file_map` alone is not enough for that artifact.** Key sizes, minified: `file_map` 1.42 MB, `functions` 4.65 MB — of which `bytecode` 3.11 MB, `debug_symbols` 1.06 MB, `abi` 0.37 MB. Without `file_map` it is 4,664,048 bytes: 54 KB under the guard, one dependency bump from red. Emptying `debug_symbols` too brings it to ~3.6 MB.

Stripping both is also the *cleaner* behaviour, not just the smaller one. With only `file_map: {}`, `getFunctionDebugMetadata` still returns debug info and `resolveOpcodeLocations` throws on the missing file; callers catch it. With `debug_symbols: ""` as well, `getFunctionDebugMetadata` returns nothing and `extractCallStack` takes its `!debug` branch — no exception in the path. `@aztec/stdlib` builds the same shape itself (`emptyFunctionArtifact`, `emptyContractArtifact`). The class id is unchanged for all three artifacts; the test asserts it per artifact, so an artifact bump that changed this would go red.

## The web-accessible surface moved, and the gate caught it

With `test: /node_modules/`, both browsers' `web_accessible_resources` went from `content.ts`, `crypto`, `handlers` to `content.ts` plus three `vendor~content.ts…` chunks (2.4 KB, 5.3 KB, 3.9 KB). Same modules regrouped, but one more file readable by every page, and names that change with the entry graph. The content script's only package import is `@aztec/wallet-sdk`, so the group's `test` excludes it: `/node_modules\/(?!.*@aztec[+/]wallet-sdk)/` (the `+` form is the isolated linker's `.bun/@aztec+wallet-sdk@…` directory). After that both lists equal the pre-change baseline exactly — zero additions to explain.

## Results

- `build:chrome`, `build:firefox`: exit 0 with the guard. Largest parsed file 4,138,965 bytes (`vendor~barretenberg`). Negative test before the fix: exit 1 naming `assets/offscreen-…js (20263920 bytes)`, then `vendor~offscreen~index.ts-….js (6085319 bytes)`.
- `web-ext lint`: **0 errors**, 19 warnings. Baseline was 1 error, 17 warnings. The two new warnings are `UNSUPPORTED_API` for `offscreen.createDocument` / `offscreen.closeDocument` in `assets/offscreen-*.js` — feature-gated calls that were always there, invisible while the file that holds them was too large to parse. That is the point of the phase: the linter now reads the whole bundle.
- File count in `dist/firefox/assets`: 571 (the plan estimated ~420). Longest file name 112 characters — rolldown names an entry-aware chunk after every entry that shares it. Under every filesystem and zip limit; ugly, not a defect.
- `bun run lint`, `typecheck:all`, `test` (6616 passed): exit 0.

## Dead ends

- Wiring the strip to `Object.values(artifactAliases)` only — see above.
- A `test` function that excludes "whatever the content script reaches" would need the module graph, which a group's `test` does not get. The package-name exclusion is exact for today's content script; the README invariant tells whoever changes the split to re-diff the list.
