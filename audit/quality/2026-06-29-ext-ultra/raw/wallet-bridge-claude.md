# `@nulo/wallet-bridge` — QUALITY audit (typing + dedup lens)

Scope: `packages/wallet-bridge/src/**` excl. `*.test.ts`. Branch `dev-quality`.
Lens: maintainability/change-cost only — TYPING + DEDUP weighted heavily. Bugs/correctness deferred to `## Out-of-focus notes`.
Line refs verified against current source at audit time.

8 findings. The package is well-layered (SSOT registry, derived tables, leaf scope-checkers) — the debt is concentrated in `dispatcher.ts`, where the typed model the rest of the package builds is repeatedly thrown away at the wire seam.

---

### WB-Q1 Untyped RPC boundary: `methodName: string` + `args: unknown[]`, hand-indexed and cast everywhere
- Smell: Primitive Obsession + Stringly-Typed + Missing Discriminated Union (the `Operation`/`OperationKind` union exists for the *output* side but there is no `RpcRequest` union for the *input* side).
- Lens: typing
- Maintenance impact: architectural
- Blast radius: 4 modules — `dispatcher.ts`, `method-scope-checkers.ts`, `scope-enforcement.ts`, and (by contract) `dapp-interaction-protocol.ts`.
- Instances:
  - Entry signature: `dispatcher.ts:275` `dispatch(methodName: string, args: unknown[], …)`.
  - Positional indexing + cast in the wire→Operation switches: `buildNetworkOperation` `dispatcher.ts:1083,1085,1090,1091,1097,1098,1106,1107,1108`; `buildAccountOperation` `dispatcher.ts:1134,1135,1142,1144,1146,1153,1154,1162`.
  - Handler-path casts: `:328` (`args[0] as CapabilityManifest`), `:349` (`args[0] as Array<{name;args}>`), `:509,534` (`args[1]/args[0] as Record<string, unknown>`), `:544,546` (`args[0] as AztecSendTxRequest["exec"]`), `:596,610` (`String(args[0])`/`String(args[1])`), `:643,653` (`String(args[0])`, `args[1] as {caller;contract;method;args}`).
  - Scope-checkers re-do the SAME positional decode independently: `method-scope-checkers.ts:59,72,84,98,110,120,132,146,156,169,190,256,277` (`args[0]`/`args[1]` `as` …).
  - F-005 account-scope re-decodes again: `scope-enforcement.ts:93,94,103` (`args[0]/args[1] as Record<string, unknown>`).
  - Cast census in `dispatcher.ts`: ~70 `as` type-assertions across 63 lines (plus 10 `as const`); 14 cast lines in `method-scope-checkers.ts`. Grep-confirmed.
- Evidence: every method's argument shape is known (it is exactly the patched `WalletSchema` signature) but is expressed nowhere in the type system. Each consumer — the builder switch, the scope checker, the F-005 wrapper — re-derives `args[0]`/`args[1]` and casts to the shape it happens to need. `method-scope-checkers.ts:11-12` even documents the coupling in prose ("must stay in sync with `buildNetworkOperation`/`buildAccountOperation`").
- Why it harms future change: a `WalletSchema` signature change (e.g. `createAuthWit` already takes `from` at `args[0]` and intent at `args[1]` — see the comment at `:1157`) must be mirrored by hand in three places with zero compiler help; a wrong index silently produces `undefined`-then-cast. No wallet-side schema validation means a malformed `args` array reaches a builder before failing somewhere downstream with a misleading error.
- Refactoring: introduce a per-method `RpcRequest` discriminated union (`{ method: "sendTx"; args: [ExecutionPayload, SendOptions] } | …`) keyed on `methodName`; have `dispatch` narrow once. `buildOperation` and the scope checkers then index a typed tuple, collapsing the casts and making the builder switches exhaustive (Replace Type Code with Class/union; Introduce Parameter Object per method).
- Effort: weeks (touches the whole dispatch + scope path; needs to track the upstream schema).
- Confidence: high

---

### WB-Q2 The `Capability` discriminated union is erased across the requestCapabilities/grant pipeline
- Smell: Primitive Obsession / Type Erasure (the union exists in `capabilities.ts` and is immediately discarded), surfacing as `as unknown as` double-casts and `Record<string, unknown>` stand-ins.
- Lens: typing
- Maintenance impact: structural (trending architectural — this is the package's authz core)
- Blast radius: 3 modules — `dispatcher.ts`, `dapp-interaction-protocol.ts`, `capabilities.ts`.
- Instances:
  - 7 `as unknown as` double-casts (all in `dispatcher.ts`): the delta cascade `:731,740,748,754,758` (`cap as unknown as XCapability`), the replacement fallback `:881` (`… as unknown as Capability`), and `:1146` (`… as unknown as AztecExecuteUtilityOperation["opts"]`). These are the worst smell — the real union is thrown away then re-asserted.
  - 12 `Record<string, unknown>` capability/payload stand-ins in `dispatcher.ts`: `:509,534,704,824,924,927,928,930,945,1135,1144,1154` (grep-confirmed; the repo map's "13" overcounts by one).
  - Loose protocol contracts in `dapp-interaction-protocol.ts`: `CapabilityParams.manifest: unknown` `:146`, `delta: unknown[]` `:147`, `existingGrants: unknown[]` `:148`; `CapabilityResult.granted: unknown[]` `:153`. The dispatcher-local `CapabilityManifest = { capabilities?: unknown[]; [k]: unknown }` `:240-243`.
  - Domain value typed as `unknown`: `AccountsCapability.accounts: { alias: string; item: unknown }[]` `capabilities.ts:20` — `item` is an account address (CAIP/`string`), not `unknown`.
- Evidence: `requestCapabilities` receives the manifest as `Record<string, unknown>[]` (`:704`), filters it with a per-type cascade that re-asserts each entry to a concrete `*Capability` via `as unknown as` (`:727-761`), then stores via `cap as Capability` (`:877`). The typed union round-trips through `unknown` at every hop instead of being parsed once at the boundary.
- Why it harms future change: adding a field to any `*Capability` (the `wallet-sdk-capability-field-diff` work referenced at `:726`/`:734` is exactly this) compiles clean even when a cascade branch forgets it, because the value is `Record<string, unknown>` until the `as unknown as`. The compiler cannot flag a missing field-diff branch — which is how the contractClasses gap (WB-Q4) survives.
- Refactoring: parse the manifest once into `Capability[]` at entry (a single validating narrow — the external `nulo-schema-patch` already owns Zod, so a shared `parseManifest(): Capability[]` is the natural home), then type `delta`/`existingGrants`/`granted`/`CapabilityResult.granted` as `Capability[]`. Every `as unknown as` and `Record<string, unknown>` in the cap pipeline disappears. Type `AccountsCapability.accounts[].item` as the address string.
- Effort: days
- Confidence: high

---

### WB-Q3 Coverage logic hand-mirrors enforcement logic — two implementations of "does a grant cover a target"
- Smell: Duplicate Code + Shotgun Surgery (parallel-maintained predicates; comments literally say "mirrors enforcement's shape").
- Lens: dedup
- Maintenance impact: architectural (it is the authz invariant — a drift between the two is a security-relevant correctness bug, not just churn)
- Blast radius: 2 modules, 6 coverage fns ↔ 8 enforcement fns/helpers.
- Instances (request-time coverage in `dispatcher.ts`):
  - `contractsRequestCovered` `:173-182` ↔ enforcement `checkRegisterContract` `method-scope-checkers.ts:58`, `checkGetContractMetadata` `:71`, `checkIsTokenRegistered` `:83` (both sides walk `canRegister`/`canGetMetadata` + address-list membership).
  - `scopeCovers` `:188-198` + `transactionRequestCovered` `:200-203` ↔ `checkTransactionCalls` `method-scope-checkers.ts:109` + `checkGrantPublicAuthwit` `:128` (both use the same contract/function pattern match — `matchesScope` `:42` / `matchesPattern` `:38`). The `:184-187` comment explicitly pins coverage to enforcement's "SINGLE cap covers every call" shape.
  - `simulationRequestCovered` `:207-221` ↔ `checkSimulationTransactions` `method-scope-checkers.ts:145` + `checkExecuteUtility` `:168`.
  - `dataRequestCovered` `:223-233` ↔ `checkGetPrivateEvents` `method-scope-checkers.ts:189` (both walk `privateEvents.contracts` membership).
  - `accountsCapsEqual` `:235-237` ↔ `checkGetAccounts` `method-scope-checkers.ts:322` / `checkCreateAuthWit` `:255` (`canGet`/`canCreateAuthWit`).
  - The address-membership primitive is duplicated outright: `String(x) === String(addr)` inline in `:178,230` vs `inAddressList` `method-scope-checkers.ts:47`.
- Evidence: every capability type has a request-time "is this already covered?" function in the dispatcher and a call-time "is this permitted?" checker in the leaf, computing the same predicate over the same fields, kept aligned by hand-written comments rather than shared code.
- Why it harms future change: tightening enforcement (e.g. making `transaction` scope match stricter) requires editing both the checker AND its coverage twin or the two diverge — coverage approves a request that enforcement then refuses on every call (the exact failure the `:184-187` comment warns about). This is a Shotgun-Surgery edit with a security blast radius.
- Refactoring: extract a per-capability-type `covers(grant, target)` primitive in `method-scope-checkers.ts` (the leaf both sides already depend on); express both the request-time coverage and the call-time checker in terms of it (Form Template Method / Extract Function). The two predicates become one.
- Effort: days
- Confidence: high

---

### WB-Q4 The 6 capability types are switched on in ≥4 sites with no shared per-type strategy
- Smell: Switch Statements + Shotgun Surgery.
- Lens: dedup
- Maintenance impact: structural
- Blast radius: `dispatcher.ts` (4 sites) + `method-scope-checkers.ts` (per-type checkers).
- Instances:
  - (a) Delta cascade: `dispatcher.ts:729,733,742,750,756` — explicit `if (cap.type === "accounts"|"contracts"|"transaction"|"simulation"|"data")`. **Asymmetry (grep-confirmed): `contractClasses` is absent — it silently falls through to the type-only `grantedTypes.has` branch at `:760`, so it has no field-level re-consent.** This is the Shotgun-Surgery smell already realized: the 6th type was missed.
  - (b) Coverage fns: WB-Q3 (one fn per type).
  - (c) `enrichGrantedCapabilities` `:932-967` — special-cases only `"accounts"` (`:935`), passes the other five through.
  - (d) Per-type scope checkers: `method-scope-checkers.ts` (one `check*` per capability).
  - Plus scattered `cap.type === "accounts"` literals at `:786,826,828`.
- Evidence: adding a 7th capability type, or a new behaviour for an existing one, means locating and editing 4+ unrelated switch sites; nothing forces them to stay complete (proven by the missing `contractClasses` delta branch).
- Why it harms future change: divergent, silent omission — exactly what happened to `contractClasses`. There is no exhaustiveness guarantee across the four sites (unlike `METHOD_REGISTRY`, which IS exhaustiveness-tested).
- Refactoring: a `Capability["type"]`-keyed strategy table `{ delta, covers, enrich, check }` per type (parallels the existing `METHOD_REGISTRY` pattern this package already standardizes on), with a build-time exhaustiveness assert mirroring `method-descriptors.test.ts`. Replace Conditional with Polymorphism / table-dispatch.
- Effort: days
- Confidence: high

---

### WB-Q5 Account-resolution duplicated ×3, opts-merge duplicated ×3
- Smell: Duplicate Code.
- Lens: dedup
- Maintenance impact: structural (account-resolution is an authz step) / local (opts-merge)
- Blast radius: `dispatcher.ts` only.
- Instances:
  - Resolve network → `getAccounts` → `getSessionAccountAddresses` → find session-authorized account → throw "…not authorized for this dApp session":
    - `handleRegisterToken` `:597-607`
    - `handleGrantPublicAuthwit` `:644-650`
    - `resolveNetworkAndAccount` `:1201-1226` (the `requestedFrom` branch `:1215-1220` is the same find-or-throw). The comment at `:1213` admits the duplication ("Mirrors the resolution in `handleGrantPublicAuthwit`").
  - `opts: { ...(args[1] as Record<string, unknown>) ?? {}, from: accountAddress }` in `buildAccountOperation`: `:1135` (simulateTx), `:1143-1145` (executeUtility), `:1154` (profileTx).
- Evidence: three handlers independently reimplement "validate the dApp-supplied account against the session set, else throw", and three operation branches independently spread `args[1]` and inject `from`.
- Why it harms future change: a change to how an account is validated against a session (e.g. case-normalisation, a new session field) must be applied in three handlers or they diverge — and these are the authz checks. The opts-merge triplet means a change to default-opts handling is a 3-edit change.
- Refactoring: extract `resolveSessionAuthorizedAccount(ctx, dappSession, requested)` returning `[network, account]` (Extract Function) and call it from all three handlers; extract `withFrom(args[1], accountAddress)` for the opts spread.
- Effort: hours
- Confidence: high

---

### WB-Q6 Handler routing is not data-driven despite the SSOT registry — `dispatch()` re-hardcodes 7 string branches
- Smell: Switch Statements / incomplete SSOT (Divergent Change: routing facts live in the registry, but handler dispatch is hardcoded).
- Lens: dedup (logic duplicated between registry and dispatch)
- Maintenance impact: structural
- Blast radius: `dispatcher.ts` ↔ `method-descriptors.ts`.
- Instances:
  - `MethodDescriptor.routing` carries `{ via: "handler" }` with NO handler reference (`method-descriptors.ts:72`). So after resolving the descriptor, `dispatch()` re-derives the handler by string equality: `dispatcher.ts:327,330,333,339,355,358,361` (requestCapabilities/getAccounts/isTokenRegistered/batch/sendTx/registerToken/grantPublicAuthwit).
  - The non-handler path IS data-driven (`METHOD_TO_KIND[methodName]` `:365`), making the asymmetry stark: network/account routing is centralized; handler routing is not.
- Evidence: the registry centralizes capability/scope/kind for every method but stops short of carrying the handler key, so the dispatcher repeats a 7-way `methodName ===` cascade the registry could have encoded.
- Why it harms future change: a new popup/reader method needs a registry row AND a hand-added `dispatch()` branch (README "Key invariants" admits this: "a new handler-routed method also needs its `dispatch()` branch"). The build-time exhaustiveness test covers metadata but not handler wiring, so a forgotten branch fails only at runtime.
- Refactoring: add a `handler` discriminant to the `"handler"` routing variant (e.g. `{ via: "handler"; handler: "requestCapabilities" }`) and a method→bound-handler table; `dispatch()` looks it up. Closes the Switch Statement and lets the exhaustiveness test assert every handler-routed method has a wired handler. (Note `registerContractClass` is `via:"handler"` but denied at scope-check `method-scope-checkers.ts:382`, so it never reaches the cascade — the table must encode that too.)
- Effort: hours–days
- Confidence: high

---

### WB-Q7 Large Class (`dispatcher.ts` 1236 LOC) + Long Method (`handleRequestCapabilities` ~222 LOC)
- Smell: Large Class + Long Method.
- Lens: other (size/cohesion)
- Maintenance impact: structural
- Blast radius: `dispatcher.ts`.
- Instances:
  - `WalletSdkDispatcher` `:254-1236` mixes: dispatch routing, 7 method handlers, the WB-Q3 coverage helpers (`:173-237`, module-level but only used here), the requestCapabilities merge/replacement engine, and the wire→Operation builders.
  - `handleRequestCapabilities` `:694-916` (~222 LOC) inlines: delta compute (`:727-763`), early return (`:766-778`), popup call + reject-persist (`:798-821`), accounts safety-net (`:823-833`), account merge (`:835-852`), grant replacement (`:854-888`), rejection tracking (`:892-899`), reload + enrich (`:901-915`).
  - `dispatch()` `:275-375` (~100 LOC) is itself a secondary Long Method.
  - Trivial Middle Man: `unwrapResult` `:1233-1235` is a one-line private wrapper of the exported `unwrapOperationResult`.
- Evidence: one class owns routing, authz, capability-negotiation state-machine, and operation construction — four distinct reasons to change.
- Why it harms future change: any of those four concerns changing forces a read of a 1.2k-LOC file; the 222-LOC method has eight sequential responsibilities that can't be unit-tested in isolation (violates the repo's own "if a unit can't be unit-tested in isolation, it's too big").
- Refactoring: Extract Class — a `CapabilityNegotiator` (delta/merge/replacement/enrich), an `OperationBuilder` (the two wire→Operation switches + coverage helpers), leaving `WalletSdkDispatcher` as the thin router. Extract the 8 inline phases of `handleRequestCapabilities` into named methods. Inline the `unwrapResult` middle man.
- Effort: weeks (the negotiator extraction is the bulk; method extraction is hours)
- Confidence: high

---

### WB-Q8 Cross-package triplication of `nulo-schema-patch.ts` (executable bodies byte-identical)
- Smell: Duplicate Code (cross-package). Flagged per the map's cross-cutting note — NOT refactored in place.
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 3 packages.
- Instances:
  - `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts` (119 LOC, canonical header)
  - `packages/faucet/src/lib/nulo-schema-patch.ts` (96 LOC)
  - `packages/playground/src/lib/nulo-schema-patch.ts` (95 LOC)
  - `diff`-confirmed: the three differ ONLY in the leading doc-comment header (self-path + import-site prose); the executable patch bodies are identical. Drift pinned by one reachability test (`packages/wallet-bridge/src/dispatcher.test.ts`, imports the extension copy).
- Evidence: adding a 4th Nulo-custom RPC = edit 3 byte-identical files + the pin test (CLAUDE.md states this explicitly). The signature-drift guard and Zod entry shape are replicated verbatim across all three.
- Why it harms future change: 3-way manual sync with a single test pinning only one copy's *reachability*, not the faucet/playground copies' correctness. A divergent edit to faucet/playground is invisible to CI.
- Refactoring: the shared-package option (`@nulo/wallet-bridge-client`) was deliberately rejected (README + CLAUDE.md) to avoid third-party consumers on `wallet-bridge`. A lighter dedup that respects that constraint: a tiny standalone publishable-internal module (no `wallet-core`/`extension-messaging` deps) OR a build-time codegen from one source. Weigh against the current "3 copies + pin test" — the owner asked to weigh it; the dedup is real but the rejection rationale is documented and sound.
- Effort: days (any real fix); confidence in the *finding* is high, confidence in the *fix being worth it* is moderate.
- Confidence: high (duplication) / moderate (whether to act)

---

## Out-of-focus notes (not scored — correctness/docs, other audit focuses)
- **README doc-drift**: `packages/wallet-bridge/README.md:284` says "Pin the `@aztec/wallet-sdk` version exactly (`4.2.0` today)"; actual is `5.0.0-rc.1` (`package.json:17`, schema-patch headers). Stale line — bug/doc focus.
- **`contractClasses` field-diff gap** (cited in WB-Q4): the delta cascade omits `contractClasses`, so a `contractClasses` re-request after a field change won't re-prompt (falls to type-only `grantedTypes.has`). May be intentional (contractClasses is read-only, `registerContractClass` is hard-denied) but is undocumented at the cascade — correctness focus should confirm.
- **`"NO_FROM"` sentinel mirrored cross-package**: `dispatcher.ts:160-162` inlines `isNoFromRequest` as a documented copy of `execution/utils/fee-detection.ts:18`. A stringly-typed sentinel duplicated across the package boundary; minor, deliberate per its comment.

## Summary
8 findings; highest-value is **WB-Q1** — the untyped `methodName: string`/`args: unknown[]` RPC boundary (no input-side discriminated union) is the root cause forcing ~70 casts in `dispatcher.ts` + 14 in the checkers and the hand-sync coupling between the builders and scope checkers.
