# Phase A — Dispatcher trust-boundary (F-01, F-02 authz, F-08) — DEEP design artifact

Branch: `fix/hf-a-dispatcher-authz` off `fix/harden-findings`. Status: **design (pre-code)**.

## Ground truth (read from source, not the audit)

- `checkCreateAuthWit` (`packages/wallet-bridge/src/method-scope-checkers.ts:255-308`):
  - accounts-scope check (canCreateAuthWit) at :258-271.
  - CallIntent → `callWithinTxOrSimulationScope(contract, **intent.call.name**, grants)` at :279-289 — **gated on `hasTxCaps`**: if the dApp has NO transaction/simulation grant, `hasTxCaps=false` and the call-scope check is SKIPPED (:283 `if (hasTxCaps && !permitted)`). So `accounts.canCreateAuthWit` **alone** authorizes an arbitrary CallIntent.
  - IntentInnerHash → same `hasTxCaps` gate, only `consumer` checked at wildcard fn (:291-304).
  - raw `Fr` → **no check at all** (:306-308).
  - Type guards `isCallIntent` (:239-247), `isIntentInnerHash` (:249-253) already exist. `isCallIntent` validates `call.name` is a string but **never** `call.selector`.
- createAuthWit execution sink (`apps/extension/src/wallet/services/execution/service.ts:641-688`):
  - CallIntent builds `new FunctionCall(call.name, call.to, call.selector, …)` from wire verbatim (:661-670), then `computeAuthWitMessageHash` commits the **selector** (:672). **No artifact is resolved here** — name↔selector unbound. Has `pxeService`, `account`, `node`, `network` available.
- sendTx standard sink (`tx-request-builder.ts:294-328`, `encoded_call`): resolves the artifact + `findFunctionBySelector(artifact, action.selector)` ONLY when `action.type`/`isStatic` are undefined (:295-310); executes `FunctionSelector.fromString(action.selector)` (:317); `fnName = action.name || action.selector` used for display/history only (:311). **Evasion: supply `type`+`isStatic` → the artifact lookup is skipped → `name` never validated.**
- sendTx NO_FROM sink (`tx-request-builder.ts:368-460`, `buildNoFrom`): parses `FunctionCall.schema` from wire (:407), builds `TxExecutionRequest(call.to, call.selector, …)` (:437-445); `call.name` used only for history (:450). Artifacts ARE resolved (:390-393) but no name↔selector check.
- Dispatcher: scope-enforcement runs on RAW `unknown[]` args before execution; execution DOES `FunctionCall.schema.parseAsync` (so shape is validated at execution, but AFTER authz). F-08 = the scope/authz layer sees unvalidated `unknown`.

## Invariants (what the fix must guarantee)

- **I1.** No signing/execution path consumes a dApp-supplied function `name` that has not been proven equal to the ABI-resolved name of the executed `selector`. (Closes F-02 at all 3 sinks.)
- **I2.** The name↔selector check is **unconditional** — it does not depend on any attacker-controlled field (`type`/`isStatic`) being absent.
- **I3.** Every dApp-originated authwit is EITHER a scope-checked structured `CallIntent` whose call is within a granted tx/sim scope, OR an explicitly user-confirmed request. No `Fr`/inner-hash is signed silently on the strength of `canCreateAuthWit` alone.
- **I4.** Scope/authorization runs on schema-validated args, not raw `unknown` (F-08).
- **I5.** No regression: the sound `accounts`-scope enforcement, the authwit **signature binding** (payloadHash commits every wrapper's args_hash — verified sound), and the FIFO/execution-mutex + async contract of the dispatcher are untouched. Scope-checkers stay synchronous; no PXE injected into the dispatcher.

## Proposed design (to confirm/adjust with Codex)

1. **F-02 binding (execution, unconditional) — I1/I2:**
   - `tx-request-builder` `encoded_call`: ALWAYS resolve the artifact + `findFunctionBySelector(artifact, action.selector)`, assert `fn.name === action.name` when `action.name` present; reject mismatch. (Refactor the current conditional lookup to run every time.)
   - `buildNoFrom`: after resolving artifacts (:390-393), look up `findFunctionBySelector(artifact_for(call.to), call.selector)`, assert `=== call.name`; reject mismatch.
   - `executeAztecCreateAuthWit` CallIntent: resolve the artifact for `call.to` (via `resolver.resolveInstances`/`resolveArtifacts` + `pxeService`), assert `findFunctionBySelector(artifact, call.selector).name === call.name` BEFORE `computeAuthWitMessageHash`.
2. **F-01 raw hash / inner hash — I3:**
   - Raw `Fr` from dApp origin: reject in `checkCreateAuthWit` (turn the no-op :306-308 branch into a throw for the dApp path — reuse `isCallIntent`/`isIntentInnerHash` guards, fail closed).
   - `IntentInnerHash`: route to an explicit per-request confirmation popup (attacker-chosen innerHash). Requires dispatcher popup-routing for createAuthWit-with-inner-hash.
   - `hasTxCaps` gap: a CallIntent with `canCreateAuthWit` but no tx/sim scope must NOT skip the call-scope check — either require the call within a granted tx/sim scope, or popup-confirm. (Policy — Codex.)
3. **F-08 server-side arg validation — I4:** parse args with the existing Zod schemas at the dispatcher boundary (before scope-enforcement), rather than trusting the client `WalletSchema`. Reuse `FunctionCall.schema` etc.

## Open questions for Codex (`/codex xhigh`)

- Q1. Raw-`Fr` reject + inner-hash confirm: reject in `checkCreateAuthWit` (sync) vs at the dispatcher routing layer? Where does the popup-gating list live (dispatcher.ts ~:352) and how is a method marked popup-gated?
- Q2. `hasTxCaps` gap policy: require a tx/sim scope to authorize a CallIntent authwit, or popup-confirm when uncovered? Which matches the capability model's intent (is `canCreateAuthWit` meant to be usable standalone)?
- Q3. Confirm the "attacker supplies type/isStatic to skip the artifact lookup" evasion in `encoded_call`, and that making the name-check unconditional is correct + acceptable (one extra `findFunctionBySelector`; artifact already resolved for registration in most paths).
- Q4. createAuthWit artifact resolution: acceptable to resolve the contract artifact inside `executeAztecCreateAuthWit` to check name↔selector? Any path where `call.to`'s artifact isn't resolvable (unregistered contract) → how to fail (reject vs skip-with-confirm)?
- Q5. F-08 placement: parse at the dispatcher pre-scope vs a shared validator; reuse existing schemas or a new per-method table? Minimize duplication with execution's existing `parseAsync`.
- Q6. Any regression risk to the sound accounts-scope / signature-binding / dispatcher async-mutex from the above?

## Negative tests (must pass — write inline with the fix)

- N1. sendTx `{name:"transfer", selector:approveSelector}` (with `type`+`isStatic` supplied to attempt the skip) → **rejected** at execution (name/selector mismatch), not executed.
- N2. NO_FROM `{name:"transfer", selector:approveSelector}` → rejected.
- N3. createAuthWit CallIntent `{call:{name:"transfer", selector:approveSelector}}` with `transfer@TOKEN` scope → rejected before signing.
- N4. createAuthWit raw `Fr` from dApp → rejected (not signed).
- N5. createAuthWit IntentInnerHash → routed to confirmation (not silently signed).
- N6. createAuthWit CallIntent with `canCreateAuthWit` but NO tx/sim scope, call outside any scope → rejected/confirmed (not silently signed).
- N7. Positive: a legit `{name:"transfer", selector:transferSelector}` within `transfer@TOKEN` scope → executes/signs unchanged (no regression).
- N8. F-08: malformed args (wrong types / extra fields where binding matters) → rejected at the dispatcher before authz.

## Routing surface (read from source — informs Q1)

- `createAuthWit` uses the **generic silent path**: `dispatch()` (`dispatcher.ts:365-374`) → `METHOD_TO_KIND` → `buildOperation("aztec_createAuthWit")` (`:1156-1162`) → `executionService.executeOperations` → NO popup. Confirmed F-01 silence.
- Popup-gating is **hardcoded in `dispatch()`**, NOT declarative: the `if (methodName === "sendTx")` / `registerToken` branches (`:355-360`) route through `DappInteractionService`. `method-descriptors.ts:107-110` gives createAuthWit only `routing: {via:"account-operation", kind:"aztec_createAuthWit"}` + `scopeCheck: checkCreateAuthWit` — no popup flag.
- **Implication:** raw-`Fr` reject → throw in `checkCreateAuthWit` (sync scope-check, runs before routing). Inner-hash / tx-scope-uncovered CallIntent confirmation → a NEW `dispatch()` branch routing createAuthWit through `DappInteractionService` (mirroring `handleSendTx`). Silent path stays only for a CallIntent whose call is within a granted tx/sim scope AND passes the execution-layer name↔selector bind.

## Consult log — Codex xhigh `b2tvhsv1w` (full text: `phase-A-consult-1.md`)

**Verdict:** directionally right but INCOMPLETE. Adopted, with these expansions:

- **4th F-02 sink (NEW):** `AuthwitDiscoverer.computeEncodedCallMessageHash()` (`apps/extension/src/wallet/services/execution/authwit-discoverer.ts:180`) has the same conditional-lookup bug → unconditional selector lookup + reject `content.name` mismatch before hashing. *(within F-02 root cause — in scope.)*
- **Adjacent createAuthWit signer bug (NEW):** scope check reads `args[0]` (requestedFrom) but signing uses the first session account (`dispatcher.ts:1059`). Fix: resolve `String(args[0])` as the signer for `aztec_createAuthWit`. **Decision:** fold into Unit A — it's required for createAuthWit authz to be *correct* (F-01's remit); flagged here for transparency (not in the original audit).
- **Q1 popup mechanism:** gating = `routing:{via:"handler"}` in `method-descriptors.ts` + a hardcoded `dispatch()` branch. So: change `createAuthWit` descriptor (`:107`) `account-operation`→`handler`; add `handleCreateAuthWit()`; route IntentInnerHash + uncovered-CallIntent through `DappInteractionService`; add an `aztec_createAuthWit` rule in `dapp-interaction/service.ts` `isConfirmationNeeded` (~:455). Minimal `consumer` display for inner-hash in `OperationCard.vue:450` ships WITH A's new popup (else opaque); broader label sanitization stays Unit B.
- **Q2 policy:** `canCreateAuthWit` alone ⇒ permission to ASK only. Silent CallIntent REQUIRES tx/sim scope coverage. Fix the `hasTxCaps` gap (`:282`). Uncovered CallIntent → popup-confirm (not blanket reject, for compat). Raw `Fr` → reject. IntentInnerHash → always popup-confirm.
- **Q3 (confirmed):** the `type`/`isStatic` skip-evasion is real. buildStandard `encoded_call` + buildNoFrom must ALWAYS resolve artifact + `findFunctionBySelector` + reject `name` mismatch + **build `FunctionCall` from ABI truth** (`fn.name/functionType/isStatic/returnTypes`) — don't trust dApp metadata. buildNoFrom also rejects non-PRIVATE via ABI (not `call.type`).
- **Q4 (confirmed):** resolve artifact in `executeAztecCreateAuthWit` (has `pxeService`/`resolver`); **fail closed** if unresolvable (dApp registers the contract first).
- **Q5 (confirmed):** F-08 parse at `dispatcher.ts:293` pre-scope via shared `WalletSchema[methodName].def.input.parseAsync`; use parsed args for capability/scope/routing/buildOperation/batch. Caveat: ensure the Nulo custom-schema patch loads before dispatcher validation (or move the 3 custom schema constants into wallet-bridge).
- **Q6 regressions:** don't make scope-checkers async (artifact resolution in execution only); popup-gated createAuthWit must NOT use sendTx FIFO hooks (background safety-net release at `background.ts:309`); signature binding unaffected if validation happens BEFORE `computeAuthWitMessageHash` and only attacker metadata is replaced with ABI-resolved metadata.

**Revised sink list (F-02): FOUR** — buildStandard, buildNoFrom, executeAztecCreateAuthWit, AuthwitDiscoverer.

**Implementation order (test after each):** (i) F-02 execution bindings — buildStandard → buildNoFrom → executeAztecCreateAuthWit → authwit-discoverer (+ N1/N2/N3/N7). (ii) createAuthWit handler refactor + hasTxCaps + raw-Fr reject + popup (+ N4/N5/N6) + signer fix + consumer display. (iii) F-08 dispatcher pre-scope validation (+ N8). Then the full gate.

### Progress
- ✅ (i) F-02 execution bindings — all 4 sinks bound (unconditional ABI resolve + name↔selector reject + build from ABI truth):
  - buildStandard `encoded_call` — `5014db1`
  - buildNoFrom (+ ABI private-type check) — `96e4d24`
  - authwit-discoverer `computeEncodedCallMessageHash` — `10ba462`
  - executeAztecCreateAuthWit CallIntent (resolve via pxeService, fail-closed) — `45d99cc`
  - All biome-clean. API usage mirrors `service.ts:487/494` + `contract-resolver` exports (type-safe by construction).
- ⏳ (ii) dispatcher: checkCreateAuthWit raw-Fr reject + hasTxCaps-gap fix (wallet-bridge) → createAuthWit handler refactor (descriptor→handler, signer from args[0], inner-hash/uncovered-CallIntent popup, no sendTx FIFO hooks) → DappInteractionService `isConfirmationNeeded` rule + OperationCard consumer display.
- ⏳ (iii) F-08 dispatcher pre-scope arg validation.
- ⏳ tests: wallet-bridge method-scope-checkers (raw-Fr reject, hasTxCaps covered/uncovered) + authwit-discoverer negative (mock findFunctionBySelector). Positive binding across sinks → network e2e.

**ENV NOTE (gate):** `vue-tsc` is not in local `.bin` (sparse sandbox install) — the Unit A gate must run `bun install --frozen-lockfile` before `typecheck`/`test`/`e2e:agent`. `bunx vitest` runs pure-logic suites (scope-enforcement ✓ 74/74) but can't resolve some `@nulo/*`/`@aztec/*` subpath exports (dispatcher.test.ts / method-descriptors.test.ts fail to COLLECT locally — pre-existing env, pass after `bun install`).

### Handler refactor design (part ii) — grounded in dapp-interaction/service.ts

- `DappInteractionService.execute(params)` → `validateSession` (already has an `aztec_createAuthWit` case, :375) → `isConfirmationNeeded(payload)` (:437): popups when profile-mismatch, `accessLevel ≥ session.confirmationLevel` (wallet-sdk sessions seed confirmationLevel = Transactions), fee-selection, or register_token; else silent.
- **Routing decision lives in the DISPATCHER** (it has the grants + the coverage helper), NOT in isConfirmationNeeded (avoids leaking scope logic into the extension):
  - raw `Fr` → already rejected by `checkCreateAuthWit` (scope enforcement, pre-routing). ✅ done.
  - CallIntent **covered** by tx/sim scope → `executionService.executeOperations` directly (silent — dApp already holds that authority).
  - CallIntent **uncovered** OR `IntentInnerHash` → `DappInteractionService.execute` (popups: set `aztec_createAuthWit` accessLevel = Transactions so the gate fires).
- **Signer fix:** build the op with `accountAddress = String(args[0])` (the scope-checked account), not the session's first account (`dispatcher.ts:1061`).
- Exports needed from `method-scope-checkers.ts`: `callWithinTxOrSimulationScope`, `isCallIntent`, `isIntentInnerHash` (dispatcher reuses them for the coverage decision).
- Must NOT pass sendTx FIFO hooks (send FIFO is sendTx-specific; codex Q6).

**Consult (in flight):** focused Codex xhigh on the exact handler wiring — signer-account resolution (how handleSendTx resolves its account + how to override to args[0]), routing-in-dispatcher vs isConfirmationNeeded, accessLevel, the exports.
