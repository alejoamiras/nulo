<!-- codex session 01a00a86-4455-7bf3-82b2-64292d694704 -->

### Finding: Transport-neutral request lifecycle depends on offscreen telemetry

1. **Smell name:** Inappropriate Intimacy, expressed as a layering inversion. The transport-neutral core knows a type owned by one specific transport’s observability layer.

2. **Maintenance impact:** Architectural. Blast radius: `core/base-client.ts`, `offscreen/telemetry.ts`, and any future transport implementing `BaseServiceClient`. Change frequency: `base-client.ts` changed three times since June, including the 2026-08-15 messaging refactor; telemetry has one recorded commit.

3. **Concrete evidence:** `packages/extension-messaging/src/core/base-client.ts:8` imports `RequestTerminalStatus` from `../offscreen/telemetry`. The core exposes that offscreen-owned type through `TerminalRecord.status` at `:46-53`, `rejectAllPending` at `:214-218`, and `settle` at `:231-245`. The supposedly owning module declares it at `packages/extension-messaging/src/offscreen/telemetry.ts:37-48` and consumes it at `:50-64` and `:154-155`.

4. **Why it harms future change:** Adding another transport or changing lifecycle states requires treating an offscreen telemetry file as part of the core request protocol. Moving or replacing offscreen telemetry can therefore break the background transport and the shared correlator even though neither should depend on that feature.

5. **Smallest safe refactoring:** Move Type—a named analog of Fowler’s Move Field. Move `RequestTerminalStatus` and, preferably, the core terminal-record shape into a small `core/terminal-status.ts` module; make offscreen telemetry depend on it.

6. **What disappears after the refactoring:** The `core → offscreen` dependency edge and the implication that offscreen telemetry owns the shared request state machine’s vocabulary.

7. **Instances:** `packages/extension-messaging/src/core/base-client.ts:8`, `:46-53`, `:214-218`, `:231-245`; `packages/extension-messaging/src/offscreen/telemetry.ts:37-64`, `:154-155`.

8. **Root cause:** A lifecycle concept shared by every transport was placed in the first transport-specific consumer rather than at the transport-neutral seam.

### Finding: Action and authwit models form a bidirectional type dependency

1. **Smell name:** Cyclic Dependencies, a close analog to Inappropriate Intimacy. Each model must know the other’s declarations, preventing either module from being an independent leaf.

2. **Maintenance impact:** Architectural. Blast radius: two directly cyclic modules plus the package barrel and `operation.ts` consumers. Both files have existed unchanged since the initial import, so change frequency is low, but the cycle sits in public exported types.

3. **Concrete evidence:** `packages/wallet-bridge/src/action.ts:1` imports `AuthwitContent`, which is used by both authwit actions at `:26-35`. In the reverse direction, `packages/wallet-bridge/src/authwit-content.ts:1` imports `CallAction` and `EncodedCallAction`, then derives authwit content from them at `:5-13`. Both files are publicly re-exported at `packages/wallet-bridge/src/index.ts:12-13`.

4. **Why it harms future change:** Extracting either model, changing its public export boundary, or generating schemas from one side requires loading and reasoning about the other. A future split between transaction actions and authwit protocol types cannot proceed incrementally because both modules currently depend on one another.

5. **Smallest safe refactoring:** Extract Class/Move Type. Move `CallAction` and `EncodedCallAction`—or their shared payload shapes—into a leaf `call-action.ts`; both `action.ts` and `authwit-content.ts` can import that leaf.

6. **What disappears after the refactoring:** The `action.ts ↔ authwit-content.ts` cycle; the resulting dependency direction becomes `action.ts → authwit-content.ts → call-action.ts` or two sibling dependencies on the leaf.

7. **Instances:** `packages/wallet-bridge/src/action.ts:1`, `:26-35`, `:37-55`; `packages/wallet-bridge/src/authwit-content.ts:1`, `:3-13`; public exposure at `packages/wallet-bridge/src/index.ts:12-13`.

8. **Root cause:** Reusable call payloads are owned by the broad `Action` union while authwit content also needs to derive from them.

### Finding: WalletSdkDispatcher is the bridge’s change funnel

1. **Smell name:** Large Class with Divergent Change. The class changes for unrelated reasons: authorization policy, session projection, popup routing, capability persistence, operation construction, batching, and account resolution.

2. **Maintenance impact:** Architectural. Blast radius: `dispatcher.ts`, its 14 imported bridge modules, seven injected service surfaces, and the 1,965-line dispatcher test suite. Change frequency is high: `dispatcher.ts` has 18 commits since the 2026-05-19 initial import, including protocol, security, activity, concurrency, authwit, token, and refactoring changes.

3. **Concrete evidence:** The file is 1,368 lines. It imports 14 sibling modules at `packages/wallet-bridge/src/dispatcher.ts:54-105` and injects seven dependencies at `:369-378`. Separate responsibilities include:

   - capability coverage policy at `:167-299`;
   - authorization-shape validation at `:316-367`;
   - dispatch orchestration at `:390-509`;
   - account response projection at `:527-591`;
   - recursive batching at `:603-626`;
   - four popup/execution routing paths at `:636-847`;
   - capability consent and persistence at `:857-1055`;
   - grant enforcement at `:1121-1175`;
   - operation construction at `:1186-1307`;
   - network/account resolution at `:1312-1363`.

4. **Why it harms future change:** A new capability field can require edits in coverage, enforcement, popup persistence, enrichment, and tests inside the same file. A new popup-routed method similarly mixes routing, account selection, protocol request construction, and result handling into an already central authorization module. Reviewers must re-establish invariants across the whole chokepoint for otherwise localized changes.

5. **Smallest safe refactoring:** Extract Class. First extract a `CapabilityConsentCoordinator` containing coverage, request-capability persistence, enrichment, and grant enforcement. Leave `dispatch()` as the façade and pass the existing narrowed service interfaces into the extracted class.

6. **What disappears after the refactoring:** Capability comparison and persistence helpers, their related imports, and several service dependencies disappear from `WalletSdkDispatcher`; the dispatcher becomes primarily routing and operation construction.

7. **Instances:** `packages/wallet-bridge/src/dispatcher.ts:54-105`, `:167-299`, `:316-367`, `:369-509`, `:527-626`, `:636-1055`, `:1121-1367`.

8. **Root cause:** Successive protocol and security features were added to the original central dispatcher instead of being assigned to cohesive policy/routing collaborators.

### Finding: Capability-consent handling is a 199-line transactional method

1. **Smell name:** Long Method.

2. **Maintenance impact:** Structural. Blast radius: `handleRequestCapabilities`, session storage services, popup request contracts, capability enrichment, and the dispatcher tests. It resides in the actively changed dispatcher, which has 18 commits in roughly three months.

3. **Concrete evidence:** `handleRequestCapabilities` spans `packages/wallet-bridge/src/dispatcher.ts:857-1056`. Within it:

   - request normalization, existing-state loading, and delta calculation occur at `:867-903`;
   - early response enrichment is at `:905-918`;
   - popup input preparation and account loading are at `:920-936`;
   - popup execution plus failure-time rejection persistence are at `:938-961`;
   - selected-account/session updates are at `:963-992`;
   - grant replacement and merging, including the nested `replacementFor` function, are at `:994-1030`;
   - rejection merging is at `:1032-1039`;
   - session reload, enrichment, and response construction are at `:1041-1055`.

4. **Why it harms future change:** Changing approval semantics, replacement rules, account selection, or rejection bookkeeping requires editing one interleaved transaction with several intermediate sets and arrays. It is difficult to test a single phase without constructing the full popup-and-storage workflow, and ordering constraints are implicit in the method body.

5. **Smallest safe refactoring:** Extract Function. Extract pure `computeCapabilityDelta` and `mergeCapabilityDecision` functions first, returning explicit result records; then extract the popup-input preparation without changing side-effect order.

6. **What disappears after the refactoring:** The nested `replacementFor` closure, most set/array bookkeeping, and the detailed merge branches disappear from the orchestration method. `handleRequestCapabilities` retains the visible sequence of load → decide → prompt → persist → enrich.

7. **Instances:** `packages/wallet-bridge/src/dispatcher.ts:857-1056`.

8. **Root cause:** Pure policy calculations and ordered I/O were implemented inline as one capability-request transaction.

### Finding: Scope checkers duplicate authorization mechanics per method

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** Structural. Blast radius: `method-scope-checkers.ts`, the method-descriptor registry that references each checker, and scope-enforcement tests. The file changed three times since its June extraction, including a July security-hardening pass.

3. **Concrete evidence:** Three duplication families repeat the same mechanics:

   - Address-list checks repeat argument conversion, typed grant filtering, empty-grant return, `caps.some(...)`, and a method-specific throw in `checkRegisterContract` (`packages/wallet-bridge/src/method-scope-checkers.ts:65-76`), `checkGetContractMetadata` (`:78-88`), `checkIsTokenRegistered` (`:90-102`), and `checkGetContractClassMetadata` (`:104-114`).
   - Transaction and simulation call-list checks repeat `exec.calls` validation, empty-list handling, typed grant filtering, all-calls-in-one-scope matching, diagnostic formatting, and rejection in `checkTransactionCalls` (`:116-133`) and `checkSimulationTransactions` (`:152-184`). The latter has accumulated an additional deep-shape guard at `:163-174`, illustrating how copies acquire different maintenance.
   - The same `DataCapability.addressBook` grant test is copied between `checkGetAddressBook` (`:369-375`) and `checkRegisterSender` (`:382-388`); only the error’s method name differs.

4. **Why it harms future change:** A policy change such as normalizing addresses differently, changing empty-grant behavior, or tightening wire-call validation must be applied to every sibling. The transaction/simulation pair already requires readers to determine whether its guard difference is intentional before modifying either path.

5. **Smallest safe refactoring:** Extract Function plus Parameterize Function. Introduce helpers for address-list authorization, boolean sub-grants, and call-list scope checking; parameterize capability selection, scope projection, and diagnostic method name.

6. **What disappears after the refactoring:** Repeated grant filtering, empty-grant exits, call-array traversal, address membership checks, and boolean-subgrant bodies. Exported method-specific wrappers and their stable error strings remain.

7. **Instances:** `packages/wallet-bridge/src/method-scope-checkers.ts:65-114`, `:116-133`, `:152-184`, `:369-388`.

8. **Root cause:** The registry requires method-specific function identities, and those wrappers were allowed to own complete policy implementations instead of delegating shared mechanics.

### Finding: Schema patch repeats the install-or-validate algorithm three times

1. **Smell name:** Duplicate Code.

2. **Maintenance impact:** Local. Blast radius: `wallet-sdk-schema-patch/src/apply.ts` and its production-wired registration entry. The file has two commits, one specifically for an upstream Aztec 5.0.1 upgrade, so signature-drift handling is already a real change axis.

3. **Concrete evidence:** All three method patches repeat this algorithm: check whether the key exists; fetch the existing schema; bypass validation on reference identity; introspect `def.input.def.items` and `def.output`; throw a signature-specific diagnostic on mismatch; otherwise install the local schema.

   - `registerToken`: `packages/wallet-sdk-schema-patch/src/apply.ts:55-74`
   - `isTokenRegistered`: `packages/wallet-sdk-schema-patch/src/apply.ts:76-90`
   - `grantPublicAuthwit`: `packages/wallet-sdk-schema-patch/src/apply.ts:92-111`

4. **Why it harms future change:** An upstream Zod representation change or a new policy for native-method collisions must be updated consistently in three control-flow copies. Adding a fourth Nulo method invites another copy and another location that can drift during SDK upgrades.

5. **Smallest safe refactoring:** Extract Function and Parameterize Function. Add an `installOrValidateSchemaMethod(target, name, localSchema, validateExisting, expectedSignature)` helper while retaining each method’s distinct validator.

6. **What disappears after the refactoring:** Three copies of the key-existence, identity, assignment, and throw scaffolding. Only the three schema declarations and their signature predicates remain method-specific.

7. **Instances:** `packages/wallet-sdk-schema-patch/src/apply.ts:55-74`, `:76-90`, `:92-111`.

8. **Root cause:** Each schema entry was implemented as a complete patch transaction instead of data plus a shared patching algorithm.

## Non-findings considered

- The capability-specific coverage functions at `dispatcher.ts:176-240` share a broad purpose but encode materially different union, wildcard, sub-scope, and equality semantics; treating them as one generic algorithm would be Speculative Generality.
- The popup handlers at `dispatcher.ts:636-847` retain superficially similar resolve/build/execute/unwrap stages, but their account selection, silent branch, hooks, backpressure metadata, and operation construction differ. The recent dedup remediation already centralized the concrete shared account-resolution behavior.
- The two draft-operation `Omit<..., "feeSettings">` declarations at `operation.ts:205-212` are a two-line type template over distinct public variants. The shared `DraftOperation` model was itself the prior quality remediation; another abstraction would have cosmetic value only.
- Background and offscreen messaging clients retain parallel lifecycle shapes, but their transport mechanics differ and the June/August refactors already extracted the common correlator and error shaping.
- The extensive dispatcher and telemetry comments preserve security, timing, and wire-contract constraints; they are not Comments-as-deodorant because they explain non-obvious externally constrained behavior rather than compensating for naming or formatting.