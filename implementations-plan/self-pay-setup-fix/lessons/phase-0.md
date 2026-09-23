# Phase 0 — dispatcher honours the dApp's `from` on `simulateTx` / `profileTx`

Owner's verdict on plan rev 6 not yet received when this phase started; proceeding under
"approve as written, A7 = yes, as described" (the reshape in A5 was the owner's own direction).
Anything the verdict changes is applied on top.

## Fix

`packages/wallet-bridge/src/dispatcher.ts` — `buildOperation` reads `opts.from` for
`aztec_simulateTx` / `aztec_profileTx` (via the shared `requestedFromOf`, the same rule
`handleSendTx` applies: omitted / `null` / `NO_FROM` → none) and passes it to
`resolveNetworkAndAccount`, which refuses an unauthorized account. `executeUtility` and
`createAuthWit` untouched. Commit `0d73c54b`.

## Unit pins — reversal on `898a3b99`'s dispatcher

`git show 898a3b99:packages/wallet-bridge/src/dispatcher.ts` swapped in, suite otherwise at HEAD:

```
× simulateTx: `from: B` runs as B (accountAddress and opts.from), not the first account
× simulateTx: a `from` outside the session is refused — never downgraded to the first account
× profileTx: `from: B` runs as B (accountAddress and opts.from), not the first account
× profileTx: a `from` outside the session is refused — never downgraded to the first account
AssertionError: expected { accountAddress: '0xaaa', …(1) } to deeply equal { accountAddress: '0xbbb', …(1) }
AssertionError: promise resolved "'0xr'" instead of rejecting
Tests  4 failed | 104 passed (108)
```

With the fix restored: `Tests 108 passed (108)`; `bun run --cwd packages/wallet-bridge typecheck` exit 0.

## Playground + cheap e2e

`apps/playground/src/sections/simulation.ts` gains `pg-input-from` (sets the transfer's owner
argument AND `opts.from`), `pg-toggle-skipValidation` (`skip` — today's behaviour — or `on`),
and reads the shared `pg-input-feePayer` into `exec.feePayer`. The simulate result is projected
through `apps/playground/src/lib/simulation-summary.ts` — the raw `TxSimulationResult`'s
`publicInputs.toJSON()` is a byte buffer, unreadable from the result feed — into `feePayer`,
the private frames (contract, selector, `argsHash`, `minRevertibleSideEffectCounter`), and the
public call requests split by phase (`setupCalls` = non-revertible, `appCalls` = revertible,
`teardownCall`), each with its selector resolved through the result's calldata table.

The plan's gate line asked for "resolved = accounts[1] in the wallet's log"; the SW log trail is
retained only with Developer Mode on, so the oracle is the kernel output instead: the fee payer
and the entrypoint frame in the summary ARE the account the wallet ran as.

### Green — fixed dispatcher (`0d73c54b`), validation ON

```
✓ tests/e2e/network/sim-from-selfpay.test.ts (1 test) 54132ms
✓ sim-from-selfpay — a self-paid simulate from the second granted account runs as that account, validation on  54131ms
Test Files  1 passed (1)   Tests  1 passed (1)
```

Asserted: `feePayer` = accounts[1]; accounts[1]'s frame in the execution tree; `setupCalls` empty;
`appCalls` = exactly the token, `msgSender` = accounts[1]. Zero `public-processor Failed to
process` lines from the node.

### Reversal — `898a3b99`'s dispatcher swapped in, suite otherwise at HEAD

```
× sim-from-selfpay — … 135927ms (retry x2)
Error: [self-paid simulateTx from the second account with validation on] expected ok:
  simulateTx seq=2 status=error;
  errorJson={"message":"\"The wallet could not process the request.\""}
Test Files  1 failed (1)   Tests  1 failed (1)
```

The dApp sees the scrubbed envelope; the node's public processor (the PXE's public simulation)
shows the mechanism, once per attempt (the harness truncates node lines at 200 chars):

```
WARN: simulator:public-processor Failed to process tx 0x00f53d…: C++ simulation failed:
  AVM simulation failed: [SETUP] UNRECOVER…
```

Read: the transfer owned by accounts[1] was built as accounts[0] (the dispatcher's first-account
resolution), classified `fpc` → `EXTERNAL` (feePayer ≠ resolved from), so no call ended setup and
the transfer's public enqueue was filed under **[SETUP]** — where it failed `authorize_once("from")`
as an unrecoverable setup error. Both halves of H5 in one line: the wrong account, and the phase
misfiling that on a non-reverting call becomes the node's `Setup function not on allow list`
(Phase 1's negative control reproduces that exact text).

## Gate

| line | result |
|---|---|
| `<wb>` (`bun run --cwd packages/wallet-bridge typecheck && … test`) | exit 0 — 108 tests, the 10 new pins included |
| `<ext-typecheck>` | exit 0 |
| `<ext-unit>` (`bun run --cwd apps/extension test`) | exit 0 — 435 files, 5441 tests passed |
| `<pg>` (`bun run --cwd apps/playground typecheck`) | exit 0 |
| `<lint>` | exit 0 (30 pre-existing warnings, 0 errors; complexity baseline OK) |
| `<network> sim-from-selfpay.test.ts` | green, validation ON (above) |
| reversal on `898a3b99`'s dispatcher | red with the `[SETUP]` failure (above) |
| neighbours `sim-methods`, `multi-account-from`, `tx-sendTx-selfPay`, `authwit-lifecycle` | 4 files, 6 tests passed |

`LESSONS_FILE=implementations-plan/self-pay-setup-fix/lessons/phase-0.md`
