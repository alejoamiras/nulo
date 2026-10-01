# Phase 1 · The vocabulary row answers to the selector

- **Built.** `VOCABULARY_SELECTORS` and `vocabularySelector` in `token-transfer-vocabulary.ts` (the
  16 values of Fact 19); `corroborates` takes the wire call's own selector and requires it to equal
  the entry for the decoded name and arity (an absent entry fails too, so a table gap can never
  match an absent selector); the transfer and mint surfaces carry `fn`, and `callName` titles every
  surface that has one by it.
- **The node test.** `token-transfer-vocabulary.real.test.ts` (5 tests) hashes the descriptors'
  own shapes with the installed stdlib, pins which functions of each installed Token sit in the
  vocabulary, and checks the standard Token's burns and commitment transfers sit at no entry.
- **Mutation checks, reverted by hand.** With the selector comparison replaced by `true`, the new
  call-surface case reds (1 of 32 in the three files). With `callName` back on the dApp's label for
  transfer surfaces, the three title cases red (call-surface, fallback, createAuthwit). Neither
  passes vacuously.
- **Gate.** `bun run --cwd apps/extension test src/utils src/popup/windows/execute
  src/wallet/services/token/functions`: 80 files, 1096 tests passed. `bun run typecheck:all`: every
  workspace exit 0. `bun run lint`: exit 0 after `biome format --write` on the touched files (its
  28 warnings are pre-existing).
