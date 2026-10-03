# Arc 7, chain-id: lessons log

## Plan

- **The audit's home for the helper would have widened the popup graph.** `apps/extension/src/utils/chain-ids.ts` is shared with the popup and the Node e2e helpers. Re-exporting from `@nulo/aztec-runtime/utils` would have pulled `Fr`, `fetch.ts` and the wallet-crypto barrel, with `@aztec-labs/accounts`, into all of them. A dependency-free wallet-core leaf avoids that; both plan legs chose it.
- **Staging probe, in a scratch copy, then reverted.**
  - `scripts/publish/stage.ts` inlines workspace source into the published wallet-crypto bundle, so a new wallet-core `utils` export could in principle move npm bytes.
  - With the leaf and barrel line added, all three staged packages were byte-identical (`diff -r`), because Bun's bundler drops the unused module.
- **Plan audit:**
  - Codex: REVISE, with one should-fix (pin where exceptions surface, not only that decoding fails) and three nits.
  - Opus: APPROVE, with a trim.

  All findings were adopted; see the batch plan's Decisions.

## Build

- **Phase 1 passed on the unchanged code:** 144 extension tests and 20 aztec-runtime tests across the touched files.
  - The A1 probe needs its own test file, because a hoisted `vi.mock` of `createAztecNodeClient` would break the existing real-transport file.
  - Bun's `BigInt` parse error text differs from V8's, so the tests pin `SyntaxError` and a spy on `version.toBigInt` rather than messages.
- **Phase 2 changed no existing test file.** Between the two phase commits, `git diff -- '*.test.ts'` shows only the new wallet-core `chain-id.test.ts`.
- **Mutation checks**, in scratch with files restored from copies (never with git):

  | Mutation | Failing tests |
  |---|---|
  | `\| 0` in place of `>>> 0` in `walletChainId` | 11, covering all six sites plus wallet-core |
  | bigint-exact decode of E2's `Fr` version | 1 (the 2^64 row) |
  | `info.l1ChainId` passed twice at A1 and E1 | 2 at A1, 21 in the network service |
  | E2's two decode lines swapped | 1 (the order row) |
  | E2's decode wrapped in a catch that terminates | 1 (the boundary row) |
  | E3 handed a string chain id | 1 (the `getAccounts` row) |

- **Generated files and outputs unchanged.**
  - `auto-imports.d.ts`, `components.d.ts` and `.eslintrc-auto-import.json` are byte-identical after the build: unimport records the `export { walletChainId }` re-export under `chain-ids.ts`.
  - `THIRD-PARTY-NOTICES.txt` is byte-identical between builds at the Phase 1 and Phase 2 commits.
  - The staged npm packages are identical at the base and at the head.
  - From `apps/extension`, a plain `bun` import of `chain-ids.ts` resolves outside Vite and prints `2904119610`.
- **Local gates at the Phase 2 head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0.
- **`test:release` exits 1 on three environmental failures.** They are the `zip-reproducible` tests, and `zip` is not installed on this machine (`Executable not found in $PATH: "zip"`). The `scripts/publish/` subset passes (28 tests, 0 failures). CI's runner has `zip`.
