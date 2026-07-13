CLUSTER: bridge-dispatcher

Scope: `packages/wallet-bridge/src/**` (the dApp→wallet RPC dispatcher, capability map, scope enforcement, custom `registerToken`/`grantPublicAuthwit` schema patch). One handoff hop crossed into the SW dApp-connection layer (`apps/extension/src/wallet/services/wallet-sdk/background.ts`) and the execution sinks the dispatcher calls (`execution/service.ts`, `view-executor.ts`, `dapp-send-executor.ts`, `operation-planner.ts`), plus the upstream `@aztec/wallet-sdk` decrypt handler, to confirm source→sink.

## Findings

### [1] `createAuthWit` call-scope enforcement is defeated by a raw/opaque message hash (arbitrary auth-witness, no popup)

**Impact factors.** Property: Authorization + Integrity (and downstream Confidentiality/asset loss). A dApp obtains the user's account signature (an auth-witness) over an arbitrary call — any contract, any function, any `caller` — bypassing the granted transaction scope. An auth-witness is a pre-authorization: an attacker contract can later consume it to move the user's private/public assets. Blast radius: single connected user per exploit, but every user who granted `accounts.canCreateAuthWit` to any dApp. Data sensitivity: signing authority over funds. Exploitability: attack vector Network (message over the established encrypted channel); attack complexity Low (compute the message hash client-side with the public algorithm the wallet-sdk already exposes); privileges required Low (a session with `accounts` + `canCreateAuthWit`, which any DeFi dApp legitimately requests and the user approves once); user interaction Required once (initial capability approval) — **but none per authwit**, because `createAuthWit` opens no confirmation popup.

**Evidence confidence.** High (the bypass paths are pinned by the cluster's own tests; the silent-execution routing and raw-hash sink are confirmed in source).

**OWASP / CWE.** OWASP A01:2021 Broken Access Control. CWE-863 (Incorrect Authorization), CWE-862 (Missing Authorization for the raw-hash/opaque-hash forms), CWE-284.

**Trace.**
- Source: `background.ts:637` — `dispatcher.dispatch(message.type, message.args, ctx, hooks)` with fully attacker-controlled `message.args` (`unknown[]`; see Finding 2 — no server-side schema validation).
- Routing: `dispatcher.ts:365-374` — `createAuthWit` is NOT one of the popup-gated handlers (`sendTx`/`registerToken`/`grantPublicAuthwit`), so it falls through to `buildOperation` → `executionService.executeOperations([op], origin)`. **No `DappInteractionService`, therefore no confirmation-level popup** (contrast the popup-routed methods at `dispatcher.ts:355-363`).
- Op build: `dispatcher.ts:1156-1163` — `messageHashOrIntent: args[1] as …` forwarded verbatim, unvalidated.
- Gate (the only one): `enforceScopeWithSession` → `enforceScope` → `checkCreateAuthWit` (`scope-enforcement.ts:82-106`, `method-scope-checkers.ts:255-308`).
  - Accounts-level check requires `canCreateAuthWit` (`method-scope-checkers.ts:265-267`).
  - Call-level check delegates to `callWithinTxOrSimulationScope` (`method-scope-checkers.ts:217-234`): when the session has **no** `transaction` and no scoped `simulation` grant, it returns `{ hasTxCaps: false, permitted: false }`, and the caller only throws `if (hasTxCaps && !permitted)` (`method-scope-checkers.ts:283, 298`) → **no throw**.
  - Raw `Fr` message-hash form: `checkCreateAuthWit` matches neither `isCallIntent` nor `isIntentInnerHash` and falls through to the end with a comment "no semantic info to validate" (`method-scope-checkers.ts:306-308`) → **no call-scope check at all, for any grant state.**
  - `IntentInnerHash` form: only the `consumer` contract is checked (at wildcard function), and only when `hasTxCaps` is true; the `innerHash` (the actual function + args) is opaque and never validated (`method-scope-checkers.ts:291-304`).
- Sink (one hop out): `execution/service.ts:641-688` — `executeAztecCreateAuthWit`. The raw branch `messageHash = await Fr.schema.parseAsync(op.messageHashOrIntent)` (`service.ts:680-683`) then `account.createAuthWit(messageHash)` (`service.ts:685`) signs the attacker-supplied hash with the user's account key. No popup, no further scope check.

**Missing control.** There is no binding of the signed authwit to the dApp's granted scope on the two non-structured forms (raw `Fr`, `IntentInnerHash`), and no call-scope enforcement at all when the session lacks a `transaction`/`simulation` grant. The design intent is stated in the source ("a dApp must not be able to obtain an authwit for calls broader than its granted transaction or simulation scope", `method-scope-checkers.ts:262-266`) but is not enforced. Because the message hash is a pure function of the intent, an attacker computes the hash for any call off-chain and submits it via the raw form, so **the transaction-scope binding is bypassable even by dApps that DO hold a narrowly-scoped transaction grant.** There is also no per-call user confirmation.

**Exploit story.** A DEX-style dApp requests `requestCapabilities([{ type: "accounts", canGet: true, canCreateAuthWit: true }])` (optionally plus a `transaction` scope limited to its own contract). The user approves once. Later, over the live channel, the dApp sends `{ type: "createAuthWit", args: [userAddr, <rawFr>] }` where `<rawFr> = computeAuthWitMessageHash({ caller: attackerContract, call: { to: TokenContract, name: "transfer", args: [userAddr, attackerAddr, MAX] } }, chainMetadata)`. `checkCreateAuthWit` passes (`canCreateAuthWit` true; raw-hash branch skips call-scope). `executeAztecCreateAuthWit` signs it silently. The dApp/attacker contract then submits a transaction consuming the authwit, transferring the user's tokens. No popup ever appeared for the authwit.

**Preconditions.** The user granted `accounts` with `canCreateAuthWit: true` to the origin (a routine grant). An active session on the target chain. No per-authwit interaction required.

**Why mitigations fail.** (a) Capability enforcement (`enforceCapability`) only gates the `accounts` TYPE, not the authwit's target. (b) The scope checker is the intended bound but is inapplicable to raw hashes / opaque inner hashes and no-ops without tx/sim grants — pinned as intended behavior by `scope-enforcement.test.ts:458-463` ("accounts-only passes") and `:498-501` ("raw … accounts check still applies"). (c) The popup mitigation that guards `sendTx`/`grantPublicAuthwit` does not exist on this path (dispatcher routes createAuthWit straight to `executeOperations`). (d) `assertLiveChainIdentity` (`service.ts:650`) binds the hash to the chain but not to any scope.

**Instances.**
- `packages/wallet-bridge/src/method-scope-checkers.ts:255-308` (checkCreateAuthWit — incomplete gate)
- `packages/wallet-bridge/src/method-scope-checkers.ts:217-234` (callWithinTxOrSimulationScope — `hasTxCaps:false` ⇒ no throw)
- `packages/wallet-bridge/src/method-scope-checkers.ts:306-308` (raw-hash fall-through)
- `packages/wallet-bridge/src/dispatcher.ts:365-374` (no-popup routing) and `:1156-1163` (unvalidated `messageHashOrIntent` passthrough)
- Sink: `apps/extension/src/wallet/services/execution/service.ts:673-685`

---

### [2] Inbound RPC args are fully attacker-controlled `unknown[]` — no server-side schema validation; every field consumed via unchecked `as` casts

**Impact factors.** Property: Integrity / trust-boundary (the enabling condition for Finding 1 and a type-confusion/DoS surface). The `@aztec/wallet-sdk` `WalletSchema` (including the Nulo `nulo-schema-patch.ts` entries) is a **client-side encoder** used by the dApp-page `ExtensionWallet` Proxy — it is NOT re-validated on the service-worker side. Any dApp that speaks the raw channel protocol (the cluster itself acknowledges "a raw protocol client could bypass the SDK", `dispatcher.ts:471-475`) sends arbitrary `{ type, args }` after a legitimately-approved connection. Blast radius: all connected users. Exploitability: attack vector Network; complexity Low; privileges Low (an approved session); UI None per message.

**Evidence confidence.** High (confirmed the upstream decrypt handler performs no arg validation; the envelope validator explicitly treats the payload as `unknown`).

**OWASP / CWE.** OWASP A03:2021-adjacent / A08. CWE-20 (Improper Input Validation), CWE-501 (Trust Boundary Violation), CWE-843 (Type Confusion).

**Trace.**
- Upstream decrypt: `@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:200-207` — `handleEncryptedMessage` calls `onWalletMessage(session, message)` immediately after `decrypt(...)`, with **no `WalletSchema` parse of `message.args`**. `decrypt` proves only channel possession (the dApp holds the shared key), not payload shape.
- Envelope validator: `content-script-validator.ts:46-54` — validates only the outer envelope; `content: z.unknown().optional()` (the SECURE_MESSAGE payload — the actual method args — is deliberately unchecked). Header comment: "NOT a security boundary on its own".
- Sink: `background.ts:637` → `dispatcher.dispatch(message.type, message.args, ctx)`. The dispatcher then consumes fields via unchecked casts throughout: `dispatcher.ts:328` (`args[0] as CapabilityManifest`), `:349` (`args[0] as Array<{name,args}>`), `:509/533-544` (sendTx opts/exec/feePayer), `:596/610` (registerToken), `:643/653` (grantPublicAuthwit content), and the entire `buildNetworkOperation`/`buildAccountOperation` switches (`:1078-1167`) which cast `args[n] as <AztecType>` with no runtime check.

**Missing control.** No SW-side allow-list validation of `args` against the method's declared parameter schema before the dispatcher casts and forwards them. The dApp-side Zod schema is not a server-side control.

**Exploit story / violation scenario.** The concrete high-severity consequence is Finding 1 (raw-hash authwit). Lower-severity concrete instances: `batch` with `args[0]` a non-array iterates/throws (caught by `handleWalletMessage`'s try/catch → error envelope, so DoS is bounded); type-confused fields (e.g. a numeric `scope`) flow into scope checkers and either throw (fail-closed) or reach PXE parsers. The systemic risk is that every future field added to a handler inherits "trusted after cast" semantics.

**Preconditions.** An approved session (any granted dApp). Attacker sends crafted `{type, args}` frames on the channel (raw client, or a compromised dApp page).

**Why mitigations fail.** The three inline `nulo-schema-patch.ts` copies and upstream `WalletSchema` all live on the dApp side of the channel; the SW never runs them. `content-script-validator` intentionally scopes out the payload. `Object.hasOwn(METHOD_REGISTRY, methodName)` (`dispatcher.ts:293`) guards the METHOD NAME (good — blocks prototype-name smuggling) but not the ARG VALUES.

**Instances.** `apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:53`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:637`; `packages/wallet-bridge/src/dispatcher.ts:328,349,509,533-546,596,610,643-668,1078-1167`.

---

### [3] dApp-controlled `exec.feePayer` is forwarded to execution un-scoped and un-validated (fee-payer selection)

**Impact factors.** Property: Integrity / authorization of who funds the transaction. `handleSendTx` forwards the dApp's `exec` (including `feePayer`) verbatim; `feePayer` selects the fee-payment strategy (self-pay vs. a fee-paying contract). The dispatcher performs no scope check or session-binding on `feePayer` (scope enforcement covers `exec.calls` only). Blast radius: single user per tx. Exploitability: Network; Low complexity; Low privilege (a `transaction` grant). **Mitigating fact: `sendTx` IS popup-gated** (routes through `DappInteractionService.execute`, `dispatcher.ts:549-562`), so the user sees a fee-selection prompt — the residual risk is whether that popup faithfully binds/derives from the dApp's `feePayer` field.

**Evidence confidence.** Low-moderate (the dispatcher clearly forwards it unchecked; the exploitable impact depends on the popup/planner behavior in cluster 10, where the trace exits).

**OWASP / CWE.** OWASP A01:2021. CWE-863 (Incorrect Authorization).

**Trace.** Source `background.ts:637`. `handleSendTx` builds `sendOp.exec = args[0]` (`dispatcher.ts:544`) with the dApp's `feePayer` intact; only `opts.from` is normalized (`dispatcher.ts:533`). Scope check is `checkSendTx`→`checkTransactionCalls` (`method-scope-checkers.ts:109-126`), which reads `exec.calls` only — `feePayer` is never inspected. Trace exits cluster at `dappInteractionService.execute` (`dispatcher.ts:549`); downstream sinks: `execution/operation-planner.ts:225` and `dapp-send-executor.ts:494` (`detectEmbeddedFeePayment(exec.feePayer, opts.from)`, `execution/utils/fee-detection.ts:8-12`).

**Missing control.** No dispatcher-level validation that `feePayer` is the resolved session account or an FPC the user approved; reliance on the fee popup to surface it.

**Exploit story.** A dApp sets `exec.feePayer` to an FPC contract of its choosing so the fee-payment path differs from what the user expects; whether this is caught depends on the popup rendering the payer. Flagged for the cluster-10 (execution / dapp-interaction) auditor to confirm the popup binds `feePayer`.

**Preconditions.** `transaction` grant + active session.

**Why mitigations fail (or hold).** The `sendTx` popup is the real gate; this finding is a request to verify that gate covers `feePayer`. Recorded because "fee-payer swap" is an explicit threat and the dispatcher provides no defense-in-depth here.

**Instances.** `packages/wallet-bridge/src/dispatcher.ts:534,544` (forwarding); `packages/wallet-bridge/src/method-scope-checkers.ts:109-126` (scope check omits feePayer).

---

## Notes (checked; not raised as findings, or lower priority)

- **F-005 account-scope enforcement is comprehensive for the current sinks.** Every dApp-controlled scope array that reaches PXE — `simulateTx`/`profileTx` `opts.additionalScopes` (`view-executor.ts:325,355`), `executeUtility` `opts.scopes` (`:339`), NO_FROM `sendTx` `opts.additionalScopes` (`dapp-send-executor.ts:524`) — is validated against the session's approved accounts by `enforceScopeWithSession` (`scope-enforcement.ts:82-106`), which checks `exec.scopes`/`opts.scopes`/`opts.additionalScopes`/`eventFilter.scopes`. No cross-account private-state-leak gap found on these paths. The `validateAccountScopes` `String()` coercion fails closed on non-matching/odd shapes.

- **`enforceScope` (no account-scope) branch is effectively unreachable for methods needing enforcement:** the `else` branch at `dispatcher.ts:321-323` runs only when `dappSession` is falsy, but `enforceCapability` already throws `CapabilityNotGrantedError` (F-006 fail-closed, `dispatcher.ts:995-1014`) in that case for any non-exempt method. Good.

- **chainId / origin are session-bound, not per-message dApp-controlled.** `ctx.chainId` derives from `chainInfoToChainId(session)` (`background.ts:627,740-745`, bound at key-exchange) and `ctx.origin` from `session.origin`; account resolution filters by `formatCaipChain(chainId)` prefix (`dispatcher.ts:1172-1178`). So per-message chainId/account confusion is prevented at the session layer.

- **Prototype-pollution surface is guarded** at method-name lookups (`Object.hasOwn` at `dispatcher.ts:293`, `capability-map.ts:26`, `scope-enforcement.ts:62`). dApp-supplied capability objects are persisted verbatim into `capabilityGrants` (`dispatcher.ts:882-890`) but scope checkers read only known fields and fail closed on malformed shapes; JSON round-trip does not pollute `Object.prototype`.

- **`createAuthWit` signs with the first session account, not the validated `args[0]`.** `checkCreateAuthWit` validates `from = args[0]` but `buildAccountOperation` uses the resolved first session account (`dispatcher.ts:1058-1061,1156-1163`), ignoring `args[0]`. The signer is still a session-authorized account, so this is a correctness bug, not an escalation — noted for completeness.

- **`batch` has no leg-count or nesting-depth limit** (`dispatcher.ts:469-492`); it is capability-exempt at the top level, though each leg is individually enforced via recursive `dispatch`. A large/deeply-nested batch is a bounded resource-consumption vector (each leg is `await`ed; a connected dApp can already spam individual calls), so impact is marginal. Worth a defensive cap.

- **`grantPublicAuthwit` `content.caller` and `content.args` are unvalidated/unscoped** (`dispatcher.ts:653-668`); only `content.contract`/`content.method` are scope-checked (`method-scope-checkers.ts:128-143`). This path IS popup-gated (routes through `DappInteractionService`, `dispatcher.ts:671-681`), so severity hinges on the popup faithfully rendering the caller/args — a cluster-10/11 concern, flagged there.
