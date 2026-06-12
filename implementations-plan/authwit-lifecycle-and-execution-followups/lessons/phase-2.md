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

## Smoke-gate debugging arc (5 failures → codex reassessment → root cause)

Five consecutive smoke failures, all "cap popup exposed only one account".
Instrumentation ladder: discriminating error (run 2) → storage dump in the
failure (runs 3-4: TWO default accounts, "Second" absent) → post-create
persistence assertion (run 5: appeared to pass). Hypotheses burned:
helper's flaky input-wait (real, fixed — headless-Chrome transition
stick), wrong-chain creation (disproved by dump), same-address overwrite
(disproved — provisioner is serialized ensureDefaultAccount), chain
purge + reseed (plausible, wrong).

**Actual root cause (codex consult caught it via a caveat)**: the very
first fixture edit anchored `createSecondAccount` on a phase block that
TWO fixtures share verbatim — `replace(..., 1)` patched
`dappConnectedExtensionPerTest`, not the `TwoAccountsCap` fixture the
test uses. Every run since: the test's fixture never created "Second";
the dumps faithfully reported reality; the "passing" persistence
assertion never executed (wrong fixture). The 5-failure stop + codex
reassessment worked exactly as designed.

Lessons:
- When patching a file with REPEATED block shapes (vitest fixtures share
  phase sequences verbatim), anchor on a UNIQUE string from the target
  scope (its error-tag literal), or assert the insertion landed within
  the right block span.
- "Assertion passed" is only evidence if the assertion RAN — phase logs
  should be positively confirmed, not inferred from absence of failure.
- Genuine side-finding kept: createAccount helper's input-disappearance
  wait replaced with row-wait (headless transition stick) — real fix.
