# Phase 1 · The 46 strings, and the guard (E)

## The guard, red on the base

- `apps/extension/src/utils/copy-dash-ban.test.ts` as § E · The guard: TypeScript's parser for
  scripts, `@vue/compiler-sfc` for templates (text, static attributes, interpolations and bound
  expressions, each expression parsed again as TypeScript), hits on `/\S\s*—\s*\S/`, the log
  exemption by callee spelling, 40 reviewed `{ file, text, why }` entries matched by exact text and
  consumed one per hit, a stale-entry case, and 12 scanner cases in one `test.each`.
- `compiler-sfc` does not re-export compiler-core's `NodeTypes` or its AST types, and the app does
  not declare `@vue/compiler-core`, so the template walk reads a small structural type that
  `RootNode` satisfies, with `TEXT = 2` and `INTERPOLATION = 5` named once. A text node's line is
  its first word's, not the whitespace it opens with.
- A first run with an empty reviewed list listed 86 hits: the table's 46 plus the 40 leaves of
  § Leave that the pattern matches, each at the file and line the plan cites. `materialize.ts:105`
  (split across a concatenation), the four label joiners and the 24 glyphs do not match.
- A scratch probe mirroring the scanner counted what the position exemption skipped: **38**
  dash-bearing log-argument literals, every one matching the clause pattern: 37 in the three
  original roots (6 `console.*`, 31 named log calls) and exactly one `log.warn`, at
  `packages/aztec-runtime/src/pxe/opfs-store.ts:221`. 684 files read.
- **Red run** with the 40 entries, from `apps/extension`:
  `bun --bun vitest run src/utils/copy-dash-ban.test.ts` → exit 1; 1 failed, 13 passed (the
  stale-entry case and the 12 scanner cases). The failure lists exactly 46 strings, the table's E1
  to E46 and no other hit. Four sit a line or two above the table's cite because the scanner
  reports a text node's first word: E29 `AccountIntegrityBarrier.vue:74` (table `:76-77`), E37
  `full.vue:543` (`:544`), E39 `RevokeAuthwitsPopup.vue:155` (`:156`), E40 `:162` (`:164`).
- `dev` had not moved past the stack (the merge at P0 carried no change), so no hit needed
  classifying.

## The strings, one commit per group

- Each group's edits go through a scratch script that replaces exact text and refuses any edit
  whose match count differs from the expected one.
- **A pin the plan missed**: the snacks' first run failed
  `popup/components/popups/NewTokenPopup.test.ts:382`, which matches `/balance will appear/`
  case-sensitively (E10), the same class as E22's `journal-state.test.ts:627`. It became
  `/Balance will appear/`, and the plan's E10 row and change map now list it. A sweep then searched
  every test, e2e and playground file for the words after each of the 46 dashes, which the split
  capitalises: every other match is in the Pin column or a generic fixture the plan keeps, and the
  e2e helpers match only prefixes or comments.
- **Snacks, E1 to E13**: 13 strings plus the pins `errors.test.ts:89`, `pxe/client.test.ts:57`,
  `NewNetworkPopup.pins.test.ts:122` and `NewTokenPopup.test.ts:382`. From `apps/extension`:
  `bun --bun vitest run src/wallet/services/pxe/client.test.ts src/popup/components/popups/NewNetworkPopup.pins.test.ts src/popup/components/popups/NewTokenPopup.test.ts ../../packages/extension-messaging/src/errors.test.ts`
  → exit 0, 4 files, 49 passed. The guard lists 33.
