# QUALITY audit — cluster `extension/wallet-services-dapp`

Scope: `packages/extension/src/wallet/services/dapp-interaction/**` +
`packages/extension/src/wallet/services/dapp-session/**` (source only; tests excluded).
Lens: typing + dedup. The code WORKS; these are change-cost findings.

Files reviewed: `dapp-interaction/{service,materialize,spec,client}.ts`,
`dapp-session/{service,capability-meta,spec,client}.ts`, plus the wallet-bridge
type sources they re-export (`operation.ts`, `dapp-interaction-protocol.ts`,
`capabilities.ts`, `session-types.ts`) and the popup seam that consumes them
(`popup/windows/execute/{types,operation-validation,index.vue,OperationCard.vue}`).

---

### D1 Parallel "draft operation" models: loose `MaterializedOperation` duplicates the typed `DraftOperation`, forcing `as unknown as Operation` double-casts
- Smell: **Duplicate Code (parallel type hierarchy)** + analog **Schema/Type Drift** (two models of "an Operation whose user-supplied `feeSettings` isn't set yet"); the duplicated half is also **Primitive Obsession** (`& Record<string, unknown>`, `kind: string`).
- Lens: typing + dedup
- Maintenance impact: architectural (it sits on the dApp→execution trust boundary; the loose model is the one that feeds `executionService.executeOperations`)
- Blast radius: 3 files / 2 clusters (`dapp-interaction`, `popup/windows/execute`)
- Instances:
  - **Loose model** — `dapp-interaction/materialize.ts:44-50` (`MaterializedSendLike … & Record<string, unknown>`), `:54-58` (`MaterializedNonSend … kind: string … & Record<string, unknown>`), `:61` (`MaterializedOperation` union).
  - **Casts forced by it** — `materialize.ts:88,102` (`as MaterializedNonSend`), `:113,123` (`as MaterializedSendLike`), `:126` (`(request as { kind?: string }).kind`), `:140` (`(materialized as MaterializedSendLike)`), and the consumer double-cast `dapp-interaction/service.ts:294` (`materialized as unknown as Operation`).
  - **Typed counterpart (the duplicate)** — `popup/windows/execute/types.ts:33-58`: `DraftAztecSendTxOperation`/`DraftSendTransactionOperation = Omit<XOperation, "feeSettings"> & { feeSettings?: FeeSettings }` and `DraftOperation = Exclude<Operation, SendLike> | …` — a real discriminated union over the wallet-bridge `Operation` variants.
  - **Duplicate assertion** — `materialize.ts:137-147` `assertSilentExecutable(m): void` (checks send-like + `feeSettings === undefined → throw`, but returns `void`, narrows nothing) vs `popup/windows/execute/operation-validation.ts:80-84` `assertExecutableOperation(op): asserts op is Operation` (identical check, but narrows). Same logic, two copies; only the popup copy carries the type info.
  - **Blast-radius casts in the popup half** — `index.vue:135,314,330,341,353,398` (`as unknown as Operation` / `as unknown as DraftOperation`).
- Evidence: wallet-bridge already encodes the request↔operation relationship at the type level — `OperationRequest` variants are `Omit<XOperation, "networkId"|"accountAddress"|"feeSettings"> & { chain|account }` (`dapp-interaction-protocol.ts:34-110`). `materializeRequest` is the runtime inverse of that mapping but discards the relationship by returning a `Record<string, unknown>` blob instead of the (already-existing) `DraftOperation`. `MaterializedNonSend.kind` is `string`, so the union isn't even discriminated — the consumer can't narrow it and must `as unknown as Operation`.
- Why it harms future change: the "operation not yet fee-completed" concept is modeled twice — once tightly (popup) and once loosely (SW), with the loose copy on the more dangerous path. Add an `Operation` variant and the popup's `DraftOperation` flags every unhandled site at compile time; the SW materializer silently accepts it via `Record<string, unknown>` and ships it through `as unknown as Operation` with zero checking. The two assertion copies can drift (one already returns `void`), reintroducing exactly the undefined-`feeSettings` class of bug their docstrings say they were written to kill (the goswap `priorityLevel` crash).
- Refactoring: **Extract Class / Pull Up** — lift `DraftOperation` + `assertExecutableOperation` next to `Operation` (wallet-bridge, or the extension `execution/models` barrel), have `materializeRequest` return `DraftOperation`, and replace `service.ts:294` + `assertSilentExecutable` with the shared assertion. Removes `MaterializedOperation`/`MaterializedSendLike`/`MaterializedNonSend`, both `Record<string, unknown>` decls, the 4 internal `as` casts, the `as unknown as Operation` double-cast, and the duplicate assertion.
- Effort: days
- Confidence: high

---

### D2 Three independent switches over `OperationKind` in one service — already drifted
- Smell: **Switch Statements** (Fowler) + **Shotgun Surgery** (one new operation kind = edits to ≥3 switches, none compiler-linked)
- Lens: dedup + typing
- Maintenance impact: structural
- Blast radius: 2 files in-cluster + the popup render switches (4 sites total)
- Instances:
  - `dapp-interaction/service.ts:352-391` — `validateSession` switch (permission grouping).
  - `dapp-interaction/service.ts:475-516` — `getOperationAccessLevel` switch, a pure `OperationKind → AccessLevel` map driven from the loop at `:467-473`.
  - `dapp-interaction/materialize.ts:77-128` — `materializeRequest` switch (network/account resolution grouping).
  - Drift already present: `simulate_transaction` is grouped with the no-action account ops at `materialize.ts:91` but with the action-bearing `send_transaction` at `service.ts:382-389`. The same ~18 kinds are partitioned three different ways with no shared source of truth.
  - Blast radius (other cluster): `popup/windows/execute/OperationCard.vue` per-kind render switch + `index.vue:182`.
- Evidence: `AccessLevel` is a numeric enum (`session-types.ts:21-28`), so `getOperationAccessLevel` is a lookup table written as a 20-arm switch whose `default: return AccessLevel.None` (`service.ts:513-514`) silently assigns the LEAST-sensitive level to any kind it doesn't list — there's no exhaustiveness check tying it to the `Operation` union.
- Why it harms future change: adding an `Operation` kind to wallet-bridge compiles cleanly while leaving every switch here unupdated. The access-level switch is the sharp edge: an unlisted new kind falls through to `None` and skips the confirmation gate (`isConfirmationNeeded` compares `accessLevel >= confirmationLevel`). The maintainer must manually reconcile three differently-clustered switches; they're already inconsistent, so "copy the neighbor's grouping" is unsafe.
- Refactoring: replace `getOperationAccessLevel` with a `const OPERATION_ACCESS_LEVEL: Record<OperationKind, AccessLevel>` (the `Record<OperationKind, …>` key makes a missing entry a compile error). For the other two, drive permission/resolution grouping off a single per-kind descriptor table (`{ needsAccount, needsActions, accessLevel }`) keyed by `OperationKind`, so kind metadata lives in one exhaustiveness-checked place. Removes 2 of the 3 switches and kills the drift.
- Effort: days
- Confidence: high (the kind→AccessLevel table is trivially mechanical; the descriptor-table consolidation is the larger half)

---

### D3 `interaction(type: string, …)` returns the full result union, re-narrowed by three `as` casts at the call sites
- Smell: **Stringly-Typed** + cast-as-narrowing (analog: the `type` discriminator is a bare `string` not correlated with the return type, so the compiler can't pick the right result variant)
- Lens: typing
- Maintenance impact: local
- Blast radius: 1 file
- Instances:
  - Signature: `dapp-interaction/service.ts:213-218` — `interaction(type: string, payload: …): Promise<ExecutionResult | CapabilityResult | DiscoveryResult>`.
  - `type` used as a URL fragment + window `kind`: `service.ts:230-236` (`#/windows/${type}` and `kind: type`).
  - Casts at the 3 callers: `service.ts:198` (`as ExecutionResult`), `:205` (`as CapabilityResult`), `:210` (`as DiscoveryResult`).
- Evidence: `type` is only ever `"execute" | "capabilities" | "discover"` but typed `string`; each caller knows its own result type and casts the union back down. The payload↔result correlation already exists implicitly (execute↔Execution, capabilities↔Capability, discover↔Discovery) but isn't expressed in the type.
- Why it harms future change: the casts are unchecked — a wrong-result wiring (e.g. a discover popup that resolves with an `ExecutionResult`) compiles silently. A 4th interaction window means a 4th hand-cast with no compiler help. The stringly-typed `type` is also the literal injected into the popup URL, so a typo isn't caught until runtime.
- Refactoring: make `type` a literal-union discriminant and give `interaction` a generic/overloaded signature keyed on it (`interaction<K extends InteractionKind>(kind: K, …): Promise<ResultFor<K>>`), or split into three typed private methods. The three `as` casts disappear and the URL fragment becomes type-checked.
- Effort: hours
- Confidence: high

---

### D4 (secondary) `CAPABILITY_LABELS` keyed by bare `string`, not `Capability["type"]`
- Smell: **Schema/Type Drift** (a UI table that must track a discriminated union in another package, with no compiler link) + loose `Record` key
- Lens: typing
- Maintenance impact: local
- Blast radius: 1 file in-cluster (table consumed by 3 UI surfaces per its docstring)
- Instances: `dapp-session/capability-meta.ts:34` (`CAPABILITY_LABELS: Record<string, CapabilityInfo>`) against the `Capability` union `wallet-bridge/src/capabilities.ts:53-60` (discriminant `type: "accounts"|"contracts"|"contractClasses"|"simulation"|"transaction"|"data"`).
- Evidence: the docstring itself (`capability-meta.ts:28-33`) says "keep them in sync with the `Capability` union in `@nulo/wallet-bridge`" — i.e. a manual-sync contract, the textbook drift tell. Keying by `string` means adding a `Capability` variant compiles with no label entry.
- Why it harms future change: a new capability ships with a missing label and silently falls through to `getCapabilityInfo`'s `risk: "high"` fallback / `getSafeDisplay`'s "Unknown permission" — degraded UX with no build failure. `Record<Capability["type"], CapabilityInfo>` would force one entry per known type at compile time. (The wire-input lookups `getCapabilityInfo(type: string)` / `getSafeDisplay` correctly stay `string`-typed — untrusted input — and should NOT be narrowed; only the authored table should be exhaustiveness-bound.)
- Refactoring: type the table `Record<Capability["type"], CapabilityInfo>`; keep the lookup functions accepting `string`. Converts the manual-sync note into a compile error.
- Effort: hours
- Confidence: moderate (intentional graceful-degradation softens the harm, but the drift surface is real and the fix is free)

---

## Out-of-focus notes (NOT scored — correctness/security, for the relevant focus)
- `getOperationAccessLevel`'s `default: return AccessLevel.None` (`dapp-interaction/service.ts:513-514`): a future `Operation` kind not added here defaults to the lowest sensitivity and would bypass the `isConfirmationNeeded` gate. Flagged in D2 as the quality harm of the missing exhaustiveness; the security implication belongs to the bugs/security focus.

## Summary
4 findings (3 primary + 1 secondary). Highest-value: **D1** — the SW materializer re-implements the popup's typed `DraftOperation` as a loose `Record<string, unknown>` blob, duplicating both the type and its executable-narrowing assertion and forcing an `as unknown as Operation` double-cast on the dApp→execution path; collapse to one shared `DraftOperation` + `assertExecutableOperation`.
