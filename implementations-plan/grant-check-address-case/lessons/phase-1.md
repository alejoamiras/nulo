# P1 · Red first

Worktree: `.claude/worktrees/agent-abfcea833f6457f66` (harness-created), branch
`fix/grant-check-address-case` from `origin/dev` at `33bb1d34`. The only commit since the plan's
`624117cd` touches infra files, `bun.lock`, `CLAUDE.md` and one index line; none of the files this
plan reads.

`agent-worktree register` refuses this worktree: its directory and branch names are not the slug's,
so the manifest carries no row for it.

## Red results (unfixed code, the P1 tests uncommitted)

- `bun --bun vitest run src/scope-enforcement.test.ts src/dispatcher.test.ts` in
  `packages/wallet-bridge`: exit 1, 348 tests, 20 failed, 328 passed.
  - `a contract in another case`, 14 failed: the 12 method rows of "a listed contract passes a call
    to it in another case" each threw `Scope violation` (for example `getPrivateEvents targets
    contract 0x0a1b…, not permitted by granted data.privateEvents scope`); "a listed value that is
    not an address matches nothing, itself included" threw nothing for `0xtok` against `0xtok`;
    the call-intent coverage read `false` for `A` under an `A_UPPER` scope.
  - `the grant boundary › a held contract in another case`, 5 failed: the four coverage rows
    opened a window (`expected 1 to be +0`), and the mixed request's delta held the transaction
    beside `contracts`.
  - The consent suite's upper-case scope rejected with `Scope violation: createAuthWit authorizes
    transfer@0x0d0d…` instead of signing.
  - Passing: the 12 "refuses any other value or spelling" rows, the three `wildcard scopes` pins,
    and every test that existed before.
- `bun --bun vitest run src/popup/windows/capabilities/details-table.test.ts
  src/popup/windows/capabilities/build-items.test.ts` in `apps/extension`: exit 1, 52 tests,
  3 failed, 49 passed. The parity test failed on `0x0a0a… → 0x0A0A…: expected true to be false`
  (one row, check refuses); the malformed half failed on `scope 0xTok → 0xTok: expected true to be
  false` (identical malformed strings match today); `build-items` listed
  `['address-book', 'private-events']` as new where `['address-book']` is expected.
- `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run
  e2e:agent tests/e2e/network/authwit-variants.test.ts -t "in upper case"`: exit 1, 1 ran and
  failed, 3 skipped by the name filter. Connect passed (the switch started On, the answer was
  `ok`); the call intent answered `createAuthWit seq=2 status=error;
  errorJson={"message":"\"The wallet could not process the request.\""}`, the unclassified-error
  constant (Fact 19). The run's token was `0x2b29…be6a`, so its upper-case spelling differs.
- `bun run e2e:reap`: exit 0, nothing left to reap.

The aztec node printed `Error: Address already in use (os error 98)` during boot and then reported
ready; the run was unaffected.
