# Phase 1 · No refusal carries the request (G1)

## Red run on `85c4d20f`'s behaviour

The new tests were written first: the 21-row matrix in `method-scope-checkers.test.ts` (through
`enforceScopeWithSession`, a `SENTINEL-` in every request field; #717's three rows folded in), the
two dispatcher pins, `scope-violation.test.ts`, and the `errors.test.ts` round trip and sweep entry.

- On the literal base the matrix and the dispatcher pins fail on `instanceof` of a class that does
  not exist yet (`TypeError: Right hand side of instanceof is not an object`) and
  `scope-violation.test.ts` cannot resolve `./scope-violation`. That proves only that the class is
  missing, so the class, its payload member and its decode case went in next, with no throw site
  using it, and the tests ran again.
- Second run, every throw site still on its old text: wallet-bridge 22 failed, 276 passed;
  `errors.test.ts` 25 passed (the round trip and the sweep only need the class).
  - The seven checker refusals and the four `:42` rows are red on all three facts: not typed, the
    message differs, and the message carries the sentinel. For example
    `Scope violation: sendTx calls [SENTINEL-NAME@SENTINEL-TO], not permitted by granted transaction scope`
    and `Scope violation: getPrivateEvents.opts.scopes contains SENTINEL-EVENT-SCOPE, not in session's approved accounts`
    (the filter's scopes refuse under the `opts.scopes` label, as the plan's Fact 2 says).
  - #717's three rows and the three flag rows are red on the class only: their text is already
    fixed and value-free.
  - The raw-hash row (`:329`) is green: a plain `Error` with fixed text. It is the regression
    control and says so in its name.
  - The dispatcher pins are red on all three facts: the unauthorized sender reads
    `Requested account SENTINEL-FROM is not authorized for this dApp session`, and the call outside
    a listed scope reads `Scope violation: sendTx calls [transfer@SENTINEL-TO], ...`.

## A pin the inventory missed

- `dispatcher.test.ts`'s `grantPublicAuthwit routes through the same shared resolver` pinned the old
  interpolated text (`/Requested account 0xunauthorized is not authorized/`). The recon inventory
  listed only the other three pins of that message. It now pins the fixed text
  `Scope violation: requested account not authorized for this dApp session`, and the assertion still
  proves the shared resolver refused before anything ran.

## Type guard probe

- With the `@ts-expect-error` line removed from a copy of `scope-violation.test.ts`,
  `bunx tsc --noEmit -p packages/wallet-bridge` exits 2 with TS2345 (the interpolated
  `${string}` message is not assignable to `ScopeViolationMessage`). The file was then restored
  from the copy, byte-identical. So `typecheck:all` really does fail the day the type widens.

## Gate

- `bun --bun vitest run src/errors.test.ts` in `packages/extension-messaging`: exit 0, 25 passed.
- `bun --bun vitest run src/method-scope-checkers.test.ts src/scope-enforcement.test.ts
  src/scope-violation.test.ts src/dispatcher.test.ts` in `packages/wallet-bridge`: exit 0, 4 files,
  414 passed.
- `bun run lint`: exit 0 (pre-existing warnings only; complexity baseline unchanged).
- `bun run typecheck:all`: exit 0, every workspace.
