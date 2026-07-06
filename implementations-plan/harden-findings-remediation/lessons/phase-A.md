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

## Consult log
- (pending) Codex xhigh design consult — verdict + adjustments recorded here before coding.
