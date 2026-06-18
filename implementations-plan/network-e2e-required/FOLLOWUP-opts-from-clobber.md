# Follow-up finding: `sendTx` ignores `opts.from` for multi-account dApp sessions

**Status:** filed, NOT yet fixed. Surfaced while resolving F1 (authwit-lifecycle e2e).
**Severity:** correctness + mild trust-boundary/UX. Confined to **multi-account** dApp sessions.
**Owner of decision:** user chose to land the F1 e2e fix via on-chain-state assertions and
file this separately rather than bundle a trust-boundary change into the e2e arc.

## What

`handleSendTx` (`packages/wallet-bridge/src/dispatcher.ts:511-513`) overwrites a
caller-supplied `opts.from`:

```ts
const isNoFrom = isNoFromRequest(rawOpts.from)
const opts = isNoFrom ? rawOpts : { ...rawOpts, from: account.address }
```

`account` comes from `resolveNetworkAndAccount` (`:1180-1202`), which returns the
**first** session-authorized account (`allAccounts.find(acc => sessionAddresses.has(acc.address))`)
— it never consults `opts.from`. So when a dApp session has ≥2 authorized accounts and
the dApp sends `sendTx(..., { from: B })`, the tx is actually sent **from the first
account (A)**, silently ignoring the request.

Single-account sessions are unaffected (the only session account == `opts.from`).

## Evidence

- Matrix soak `[F1-MATRIX] revokeBlocks=false disableBlocks=false reenableOk=true` — the
  authwit consume succeeds regardless of the public registry state, because it became a
  self-send by A (`transfer_public_to_public(from=A,..)` with `msg_sender=A` needs no authwit).
- codex round 8 (session `019ed98f`) independently traced this; verified in code.
- The sibling `handleGrantPublicAuthwit` (`:627`) does it correctly:
  `allAccounts.find(acc => sessionAddresses.has(acc.address) && acc.address === requestedAccount)`.
  The asymmetry is the tell — the safe pattern already exists in the same file.

## Not an Aztec bug

`aztec.nr`'s `transfer_public_to_public` requiring no authwit for a self-send is correct
protocol behavior. The defect is entirely in our `from`-resolution.

## Proposed fix (guarded — safe under any security reading)

Make `handleSendTx` honor `opts.from` **iff** it is session-authorized; otherwise **reject**
(never silently fall back to the first account — that is both the bug and the only place a
real hole could hide). Mirror `handleGrantPublicAuthwit`'s resolution:

- add an optional `requestedFrom?: string` to `resolveNetworkAndAccount`;
- when set: return the session account whose `address === requestedFrom`, else `throw`;
- when unset (or `NO_FROM`): current behavior.

This cannot widen what a dApp may do — it is constrained to accounts the user already
authorized for the session, and the per-tx confirmation popup still shows the sender.

## Tests to add with the fix

- Unit (wallet-bridge dispatcher): `sendTx({from: B})` on a 2-account session resolves to B;
  `sendTx({from: <unauthorized>})` throws; single-account + NO_FROM unchanged.
- Then F1's `authwit-lifecycle` e2e can be upgraded to a TRUE end-to-end revoke proof
  (consume sent by B is blocked after revoke / while disabled), on top of the on-chain-state
  assertions it already makes.

## Why filed, not fixed here

Trust-boundary change to the dApp RPC surface → warrants its own focused PR + review
(blueprint), not bundling into the network-e2e-stabilization arc. See
[lessons/phase-4.md](lessons/phase-4.md) for the full classification trail.
