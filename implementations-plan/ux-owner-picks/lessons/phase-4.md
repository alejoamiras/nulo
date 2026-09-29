# Phase 4 · Default sponsor and wallet-send copy (D4, D5)

Built with the owner's picks: O4 (a), no automatic sponsor when Nulo's is missing, and O3 (a) in
the decision page's wording.

## Red first

Step 1's cases on the unfixed code (5 files, 185 tests): 7 red, 178 green.

- `fee-helpers.test.ts`: `TypeError: defaultSponsor is not a function`.
- `fee-privacy.test.ts`: `[hand, nulo]` walked to the hand-added sponsor on both origins
  (`expected [ 'fpc:spon2', 'fpc:spon2' ] to deeply equal [ 'fpc:spon', 'fpc:spon' ]`); `[hand]`
  alone picked it too, where `none` and `hold` were due.
- `FeeSettingsCard.test.ts`: `[s2 hand-added, s1 Nulo's]` emitted `fpcId: "s2"`; `[s2]` alone
  emitted a selection (`expected [ [ { paymentMethod: { …(2) } } ] ] to deeply equal []`).
- `OperationCard.fee.test.ts`, the wire-shaped `aztec_sendTx`: both cases emitted `fpcId: "s2"` for
  `"s1"`, the plain one and the one with a dApp named "Nulo Sponsored", a hand-added row named
  "Sponsored" and extra payload fields (`authWitnesses`, `capsules`, `extraHashedArgs`).

Green on today's code, as guards: a saved pick of a hand-added sponsor wins on both origins, and the
existing self-payment lock case.

D5 (`journal-state.test.ts`, the split): `transfer` red, `expected { label: 'Reported by app', …(1)
} to deeply equal { label: 'Send failed', …(1) }`; `dapp_execute` green.

## Existing tests that expected a sponsor with no `isProtocol` as the default

Each was about the network's own sponsor being picked, so its fixture got `isProtocol: true`:

- `FeeSettingsCard.test.ts`, 15 non-Send cases: no saved method with a sponsor; a stale saved
  record; the priority change; the account prop change; testnet's default; the account and network
  switch mid-init; the two `getGasBalances` bug pins (rejects, never settles); the silent retry;
  the hung raw RPC; the background retry; the last-good FPC list; the identity switch mid-refresh;
  the embedded return; the chainId swap.
- `FeeSettingsCard.test.ts`, the Send describe's `SPONSOR` constant (7 cases): the sponsor-only
  list, the rejected gas read, the origin flip during a recommit, and four FPC-event cases.
- `fee-cards.comount.test.ts`: the file's default fixture; its forced-success case needs the card's
  automatic commit.

Others were about a hand-added sponsor paying, which it now does only once picked:

- `FeeSettingsCard.test.ts`, "a hand-added sponsor, once picked, is reported unvouched": both
  accounts hold a saved private-origin pick of it.
- `OperationCard.fee.test.ts`, the hand-added case: asserts the card opens on "Select method", then
  picks the row by `send-fee-method-sponsored`.
- `send.integration.test.ts` (outside the phase's file list; the first `test:all` found it, 5 red):
  the sweep's hand-added funding now carries a saved pick for both origins, so its four cases keep
  their payer and visibility checks; the transition case where the protocol sponsor's row turns
  custom starts from a saved pick of it and keeps its HIDDEN-withdrawn checks.

Two cases pin O4 (a) on the Send page with the real card: no gas and only an unpicked hand-added
sponsor reads as no sponsor (the footer asks for gas), and the default sponsor's row turning custom
stops it paying unasked.

## The node's refusal of an unfunded payer

`Invalid tx: Insufficient fee payer balance (required=<fee limit>, available=<balance>)`, read from
the Aztec 5.2.0 toolchain (the node packages are not in this repo's install):
`@aztec/aztec-node` `dest/aztec-node/server.js:733` throws `Invalid tx: ${reason}`, the reason
coming from `@aztec/p2p` `dest/msg_validators/tx_validator/gas_validator.js:186`, whose constant is
`@aztec/stdlib` `dest/tx/validator/error_texts.js:3`. The executor pin feeds that text to a
rejecting `proveAndSend`: the journal goes `failed` with kind `transfer` and the rejection is a
`JournaledRejection` naming the record. The other two pins (no prove after an estimate failure; a
failed activity record after the send is a `transfer` failure) pass today, as planned.

## Gotchas

- `biome format` wants the settled-selection ternary on one line once its else arm is a call.

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 29 warnings, 3 infos, all pre-existing |
| `bun run typecheck:all` | 0 | |
| `bun --bun vitest run` the seven P4 files (from `apps/extension`) | 0 | 7 files, 283 passed |
| `bun run test:all`, first run | 1 | extension 5 failed (`send.integration.test.ts`, above), 7854 passed |
| `bun run test:all`, after those five were adapted | 0 | extension 7861 passed, 4 skipped, 8 todo; every workspace exit 0 |

Lint and `typecheck:all` were rerun after the adaptation: both exit 0.
