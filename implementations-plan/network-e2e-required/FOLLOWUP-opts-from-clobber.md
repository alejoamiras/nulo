# RESOLVED finding: `sendTx` ignored `opts.from` for multi-account dApp sessions

**Status:** ✅ FIXED in-arc (`5d09ca3`) — user chose to fix the bug rather than defer it.
`resolveNetworkAndAccount` now honors a session-authorized `opts.from` and rejects anything
outside the session; 5 dispatcher unit tests pin it; F1's `authwit-lifecycle` e2e was
upgraded to a true revoke proof (consume from B is blocked after revoke). The original
filing is preserved below for the record.
**Severity:** correctness + mild trust-boundary/UX. Confined to **multi-account** dApp sessions.

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

## Resolution (fixed in-arc)

Initially filed for a separate PR (trust-boundary change to the dApp RPC surface). The user
elected to fix it in-arc instead. The guarded fix is safe under any security reading — it
only ever resolves to a session-authorized account and rejects anything else — so it could
not be the wrong call on the sensitive surface. Landed in `5d09ca3` with 5 dispatcher unit
tests; F1's e2e became a true revoke proof. The post-impl narrow `/harden security` + codex
audit (already in the plan) cover the change. See [lessons/phase-4.md](lessons/phase-4.md)
for the full classification trail.
