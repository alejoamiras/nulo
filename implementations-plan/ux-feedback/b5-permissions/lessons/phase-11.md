# Phase 11 · The owner's stack sign-off ✓

The owner answered the stack's sign-off page on 2026-09-28
(<https://claude.ai/artifact/WD1NGANFrHcE7fsrJKXPMp>, its `answers` store): "Only the permission
window at 400px", as built. The note on "Everything else" asked that the permission window say
first that the wallet always asks before a transaction, then what the app can do if allowed, then
the permissions; the rest was signed off as built.

## The change

- `GROUP_ORDER` (`popup/windows/capabilities/permission-rows.ts`) runs "Always asks you first",
  "If you allow, it can", "Without asking, it can", below "Account to share", which stays first.
  The "Already allowed" fold reads the same list. Settings → Connected apps is unchanged.
- The component test's group and row lists, `cap-window`'s S2 rows and `cap-request-rerequest`'s
  rows follow the order, and the spec's S1 list carries it (`design/spec.md`).
- A throwaway network spec, never committed, opened the window on Chrome at `49a42355` and read
  its groups in DOM order.
  - First connect: `transaction`; `authorizations`; `account-address`, `simulation`,
    `contracts`.
  - Asking for more: the new `address-book` row, then the open fold's `transaction`;
    `authorizations`; `account-address`, `simulation`, `contracts`.
  - Its captures are on the sign-off page.

## Review

The codex session at high (`01a0e7ab-…`) read the three changes.

- Round 1: "No material findings; three comment/documentation nits", none on this arc. It found
  the grouping presentation-only ("grant construction uses keys and capability types, not
  rendered positions"), and "Applying the order to the fold is a reasonable interpretation".
- Round 2: "No material findings or further nits."
- Rounds 3 and 4, on arc 4's pin, re-verified the restack of this arc onto it.

## The gate

The stack-top gate on `df1849a2` is in
[batch 3's P5 log](../../b3-tooltips-glossary/lessons/phase-5.md) and the program's
[final pass](../../lessons/final-pass.md).
`cap-window` and `cap-request-rerequest` passed in both browsers' network suites. Firefox's
one red network file, the known `send-picker` flake, and its three passing reruns are in the
batch 3 log.
