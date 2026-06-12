# Phase 2 — Grant-emission surface + playground panel

## Proof-of-life spike verdict (logged BEFORE panel code, per plan)

**Design (a) — schema-patched `grantPublicAuthwit` RPC — WINS.**

Design (b) (Azguard-shape `send_transaction` action path from the page)
is DEAD on repo evidence: repo-wide grep shows NO production constructor
of `send_transaction` operations (only popup rendering/validation), and
`dispatcher.ts` routes zero Azguard-shape methods from page origins —
the wallet-sdk surface is the only dApp-callable path.

Design (a) mechanics, all links verified:
- `SendTransactionRequest = Omit<SendTransactionOperation, SendParams> &
  { account: CaipAccount }` exists in
  `wallet-bridge/src/dapp-interaction-protocol.ts:52` — the dispatcher
  can construct it and route through `dappInteractionService.execute`
  exactly like `handleRegisterToken` (`dispatcher.ts:523`).
- The execute popup already renders `send_transaction` drafts and runs
  fee selection when `feeSettings === undefined`
  (`operation-validation.ts:49`).
- `AddPublicAuthwitAction = { kind: "add_public_authwit", content:
  AuthwitContent }`; the `call` content kind carries
  `{ caller, contract, method, args }`
  (`wallet-bridge/src/authwit-content.ts:5-8`) — exactly the lifecycle's
  grant shape.
- `buildStandard` computes the message hash, calls `trackAuthwit` (so
  the settings revoke UI sees it), and injects `set_authorized`
  (`tx-request-builder.ts:197-265`).

Scope model: `grantPublicAuthwit` gets its OWN entry in
`METHOD_SCOPE_CHECKER` (`scope-enforcement.ts`) validating the target
contract against the session's transaction scope — the capability is
the control, not panel defaults.
