# Arc 16, byte-primitives: lessons log

## Plan audit

- **Codex and Opus both returned REVISE, with no blocker.** All twelve items, the nits and the three asks were adopted; each call and its reason is in the batch plan's Decisions ("Plan audit"). The ones that changed the build:
  - **D4: the bundled `Buffer` shim and Bun's native `Buffer` disagree on non-ASCII base64.** `"QUīJD"` decodes to `414f89` natively and `414243` in the shim. The plan's tables carry a column per runtime, and every lenient caller row runs under both.
  - **Every encoder pin uses bytes whose encoding has `+`, `/` and `=`** (32×0xfb gives `+/v7…+/s=`). An ASCII-only fixture cannot tell base64 from base64url or padded from unpadded.
  - **The lenient decoder keeps the bare `Buffer` identifier and returns the `Buffer`.** That keeps each caller's acceptance set and type. The hex decoder was dropped because it has one runtime site.

## Build

- **Phase 1** (test only) was green on the unchanged code under both Buffers. `tests/helpers/shipped-buffer.ts` imports the polyfill's own `Buffer` (`vite-plugin-node-polyfills/shims/buffer`), and each caller row swaps it in with a scoped `vi.stubGlobal`, undone by `vi.unstubAllGlobals` in `afterEach`.
- **Phase 2** added `fromBase64Lenient` with a 17-row native/shipped/strict table and an encoder parity table against the shipped `Buffer` (an offset view included). No consumer was edited.
- **Phase 3** moved every listed site, across 11 files. `typecheck:all` passed, and so did every Phase 1 row, unchanged.
- **`vi.restoreAllMocks()` did not restore a `crypto.getRandomValues` spy here.** A 0xfb fill leaked into later tests. Each spy is now released in its own `try/finally` with `mockRestore()`.
- **A 31-byte entropy row could not kill the removed length guard.** `getMnemonic` refuses any length that is not a multiple of 4 with the same "Invalid entropy length" text. The row uses 28 bytes, which passes `getMnemonic` and reaches the guard.
- **Vitest quotes `$label` values in test names** (`'canonical': native '414243'`). A mutation runner that matches killers by name must use the quoted form, or a kill reads as a survivor.

## Mutation check

- **Method:** a scratch runner applied each mutant alone and ran the named files. It counted a kill only when a named test failed, with no load errors, and restored the source from memory and a scratch copy, never with git. Results were kept across reruns, and the tree was clean afterwards.
- **Base (unchanged code), 35 of 35 killed:**
  - **Lenient decodes made strict:** L1 (stored `dekSealed`), L2–L4 (restored master, entropy, DEK), L5 (account-export master), L6 (session MAC), L7 (`?? ""` dropped).
  - **Guards removed:** G1–G3 (restore lengths), G4 (PXE length), G5–G7 (the deleting, erased-generation and live-different-generation lifecycle guards).
  - **Wipe:** W1 (the wipe of the redundant or refused key).
  - **PXE strictness:** S1 (decode made lenient), S2 (comparison always equal), S2b (comparison skips the last byte), S3 (decode moved after the lifecycle checks).
  - **Encoders:** E1a–g (each base64 encoder made URL-safe), E2a–c (each hex encoder upper-cased), E3a–b (each random hex draws 32 bytes).
  - **Helper:** H1 (strict body), H2 (plain `Uint8Array`), H3 (trims first), H4 (a `Buffer`-free reimplementation).
- **Migrated (code head), 28 of 28 killed:**
  - M1–M6: each lenient site swapped for the strict decode.
  - M7: the PXE decode made lenient.
  - M8: `array_equals` as a 31-byte prefix compare.
  - M9–M10: the `Uint8Array` wrap removed from the two `ArrayBuffer` inputs.
  - M11–M15: an encoder made URL-safe or unpadded.
  - M16: hex upper-cased.
  - M17–M18: random hex of 64 characters.
  - The guard, wipe and ordering mutants rerun on the new code: G1–G7, L7, W1, S3.

## Gates

- **Code head `fa36e984`:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` (which includes `build`) all exit 0. The build left no change to the generated declaration files.
- **npm stage:** `scripts/publish/stage.ts wallet-crypto --version 0.1.0` was run at `1a08fa52` and at the code head. `diff -r` is empty, and all 10 files have the same sha256.

## Screenshots

- **The surfaces are the export full-backup page, `finished` and `encrypted`, in light and dark, on Chrome 152 and Firefox 153.**
- **Base `1a08fa52` vs code head `fa36e984`:** 8 of 8 identical.
- **`--stability` (base vs base), a separate run:** 8 of 8 identical.
