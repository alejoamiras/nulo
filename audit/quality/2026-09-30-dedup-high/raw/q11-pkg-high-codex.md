# q11-pkg-high — codex

Scope read:

- `CLAUDE.md`, cluster maps, production clone leads, and the August 14 and August 16 quality reports and remediation records.
- `packages/wallet-bridge/src/`: dispatcher, capability and scope enforcement, method descriptors, account resolution, operation validation, fee handling, discovery queue, service contracts, session types, and supporting helpers.
- `packages/aztec-runtime/src/`: PXE service/client/proxy, lifecycle coordination, chain runtime/storage, artifact resolution/catalog, note schemas, public events, account construction, fee helpers, fetch and chain identity.
- `packages/wallet-sdk-schema-patch/src/`, `packages/legal/src/`, `packages/resolve-asset/src/`, and `packages/third-party-notices/src/`; excluded vendored artifacts and licence texts.
- Extension handoffs: incoming-transfer public-event indexer, execution service, permission rows, transfer-intent classification, encoding helpers, and relevant dispatcher/artifact-registry tests.

History counts below are **total commits / commits since 2026-06-01**, using current file paths without `--follow`. They measure file churn, not changes to individual functions. Findings are source-verified; no files were modified.

## q11-pkg-high-X-1: Consent coverage and execution checks repeat scope-matching rules

**Title:** Share wildcard/address matching between capability negotiation and enforcement.

**Smell name:** **Duplicate Code**, with **Shotgun Surgery**: the same scope-membership rules are independently expressed in consent coverage and execution enforcement.

**Maintenance impact:** **Structural**, across two production modules governing the same grants. `dispatcher.ts`: **34 / 29** commits; `method-scope-checkers.ts`: **8 / 8**. Confidence: **high**.

**Concrete evidence:** The duplicated logic is: a granted wildcard matches any target; otherwise compare contract addresses by field value and function names exactly.

- `packages/wallet-bridge/src/dispatcher.ts:219-229` repeats contract/function pattern matching inside `scopeCovers`.
- `packages/wallet-bridge/src/method-scope-checkers.ts:38-43` implements that same predicate as `matchesPattern`.
- `packages/wallet-bridge/src/dispatcher.ts:204-213` embeds wildcard-or-address-membership checking in contract coverage.
- `packages/wallet-bridge/src/dispatcher.ts:263-272` embeds it again in private-event coverage.
- `packages/wallet-bridge/src/method-scope-checkers.ts:57-60` implements it as `inAddressList`.

`sameFieldAddress` is already shared; the remaining duplication is the policy assembled around it.

**Why it harms future change:** A change to accepted scope matching must reach both consent and execution. Updating only one can make the wallet request consent for something enforcement already permits, or report an existing grant as sufficient when execution rejects it.

**Smallest safe refactoring:** **Extract Function** into a dependency-light `packages/wallet-bridge/src/scope-matching.ts`, sharing address-membership and contract/function-pattern predicates. Preserve caller-specific rules: requested wildcards, union versus single-grant coverage, optional-field handling, and enforcement’s empty-function-name rejection at `method-scope-checkers.ts:45-54`. Do not merge the complete coverage and enforcement algorithms.

**What disappears:** One repeated contract/function predicate and two repeated wildcard/address-membership expressions. Higher-level grant iteration remains where its semantics differ.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:204`, `packages/wallet-bridge/src/dispatcher.ts:219`, `packages/wallet-bridge/src/dispatcher.ts:263`, `packages/wallet-bridge/src/method-scope-checkers.ts:38`, `packages/wallet-bridge/src/method-scope-checkers.ts:57`.

## q11-pkg-high-X-2: Artifact catalog membership is declared three times

**Title:** Derive artifact keys and enumeration from the accessor table.

**Smell name:** **Duplicate Code**, specifically duplicated registration data.

**Maintenance impact:** **Local**, concentrated in one catalog module. `artifact-catalog.ts`: **2 / 2** commits. Lower churn than the bridge findings, but every catalog addition requires coordinated edits. Confidence: **high**.

**Concrete evidence:** The same twelve artifact identifiers appear in three independently maintained representations:

- `packages/aztec-runtime/src/pxe/artifact-catalog.ts:35-47`: `CatalogKey` union.
- `packages/aztec-runtime/src/pxe/artifact-catalog.ts:58-71`: `rawArtifact` accessor table.
- `packages/aztec-runtime/src/pxe/artifact-catalog.ts:74-87`: `ALL_CATALOG_KEYS` enumeration.

`packages/aztec-runtime/src/pxe/known-artifacts.ts:24-30` uses the enumeration to load the catalog. The union checks the table’s completeness, but `readonly CatalogKey[]` does not require every key to appear exactly once in the enumeration.

**Why it harms future change:** Adding a bundled artifact means repeating its identifier in three places. Updating the union and accessor table while missing the enumeration still type-checks, leaving an artifact available by direct lookup but absent from the known-artifact loader.

**Smallest safe refactoring:** **Replace Derived Variable with Query / Consolidate Duplicate Data** in `artifact-catalog.ts`: make the existing lazy accessor table authoritative, derive `CatalogKey` with `keyof`, and derive the enumeration from its keys. Preserve the current insertion order and lazy accessor behavior.

**What disappears:** Two handwritten twelve-key inventories—24 repeated identifier entries, approximately 25 net lines.

**Instances:** `packages/aztec-runtime/src/pxe/artifact-catalog.ts:35`, `packages/aztec-runtime/src/pxe/artifact-catalog.ts:58`, `packages/aztec-runtime/src/pxe/artifact-catalog.ts:74`.

## q11-pkg-high-X-3: Public-event cursor ordering is duplicated across the package boundary

**Title:** Give public-event cursors one ordering function.

**Smell name:** **Duplicate Code**.

**Maintenance impact:** **Structural**, with a small footprint across two modules and the package export boundary. `public-events.ts`: **7 / 7** commits; extension `public-event-indexer.ts`: **3 / 3**. Confidence: **high**.

**Concrete evidence:** Both functions implement exactly the same lexicographic comparison: block number, then transaction index, then log index.

- `packages/aztec-runtime/src/pxe/public-events.ts:192-197`: `comparePositions`.
- `apps/extension/src/wallet/services/incoming-transfer/public-event-indexer.ts:50-55`: `comparePublicPositions`.

The runtime uses its copy to validate ordering within fetched data at `public-events.ts:352`; the extension uses its copy to reject non-advancing pages at `public-event-indexer.ts:106`. Both operate on the runtime’s `PublicEventCursor` type.

**Why it harms future change:** The two guards define the same cursor ordering contract. Changes to cursor representation or comparison must be applied twice, with disagreement affecting the interpretation of a valid continuation between the producer and consumer.

**Smallest safe refactoring:** **Extract Function / Move Function** into a lightweight `packages/aztec-runtime/src/pxe/public-event-cursor.ts` containing the cursor type and comparator, exposed through a narrow package subpath. Both consumers import it. Preserve the existing type export if needed. Avoid making the extension import the artifact-loading public-events module merely to obtain a comparator.

**What disappears:** One complete five-line comparator implementation and its duplicate documentation. Both validation guards remain.

**Instances:** `packages/aztec-runtime/src/pxe/public-events.ts:192`, `apps/extension/src/wallet/services/incoming-transfer/public-event-indexer.ts:50`.

## q11-pkg-high-X-4: Dispatcher still owns capability policy and execution orchestration

**Title:** Separate capability negotiation policy from RPC execution dispatch.

**Smell name:** **Divergent Change**, reinforced by **Large Class/module**: independently changing permission policy and operation orchestration share one module.

**Maintenance impact:** **Structural**, centered on the 1,794-line dispatcher and its service contracts. `dispatcher.ts`: **34 / 29** commits, the highest churn among the retained finding locations. Confidence: **high**.

**Concrete evidence:** **RECURRING (prior: 2026-08-16 Q-01).** The remediation record explicitly deferred the full dispatcher decomposition; its completed first extraction addressed the PXE lifecycle fence.

The current dispatcher still combines:

- `packages/wallet-bridge/src/dispatcher.ts:201-740`: capability coverage, input projection, delta planning, grant/rejection merging, and stored-answer construction.
- `packages/wallet-bridge/src/dispatcher.ts:809-967`: service dependencies, request guards, and RPC routing.
- `packages/wallet-bridge/src/dispatcher.ts:1105-1306`: transaction, authwit, token-registration, and public-authwit handlers.
- `packages/wallet-bridge/src/dispatcher.ts:1316-1538`: consent prompting, account widening, and grant enrichment.
- `packages/wallet-bridge/src/dispatcher.ts:1599-1789`: operation construction and network/account resolution.

The capability planning functions already form a substantial seam outside the class, yet remain in the same module as execution routing.

**Why it harms future change:** A permission-field change requires understanding projection, coverage, decision merging, and popup integration inside the file that also owns transaction/authwit execution. Conversely, changes to operation construction touch that same review and merge hotspot without needing the capability-planning machinery.

**Smallest safe refactoring:** **Extract Module / Move Function**: move synchronous capability projection, coverage, planning, and decision-merging functions and their internal types into `packages/wallet-bridge/src/capability-negotiation.ts`. Keep service calls, popup sequencing, and session mutation in the dispatcher initially. Reuse the matching helpers proposed in X-1. This stays within the bridge package and preserves the documented service architecture.

**What disappears:** Approximately 500 lines of capability-policy implementation from `dispatcher.ts`, relocated rather than deleted. This first step removes one independently changing concern from the dispatcher without redesigning execution.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:201`, `packages/wallet-bridge/src/dispatcher.ts:809`, `packages/wallet-bridge/src/dispatcher.ts:1105`, `packages/wallet-bridge/src/dispatcher.ts:1316`, `packages/wallet-bridge/src/dispatcher.ts:1599`.

## q11-pkg-high-X-5: Artifact resolution retains an unused configuration framework

**Title:** Remove unused artifact-source policy and network hooks.

**Smell name:** **Speculative Generality**: configurable source ordering, per-class pinning, and network context exist without a production consumer.

**Maintenance impact:** **Local**, with cleanup spanning three production files: registry, PXE caller, and export barrel. History: `artifact-registry.ts` **5 / 4**; `service.ts` **26 / 25**; `index.ts` **4 / 3**. The caller’s churn is not evidence that the unused policy itself changes frequently. Confidence: **high**.

**Concrete evidence:** **RECURRING (prior: 2026-08-16 Q-01)**, which explicitly identified this extensibility residue.

- `packages/aztec-runtime/src/pxe/artifact-registry.ts:14-35` declares an unused network context plus configurable order and pinning.
- `packages/aztec-runtime/src/pxe/artifact-registry.ts:63-104` stores policy, initializes defaults, and exposes setters/getters.
- `packages/aztec-runtime/src/pxe/artifact-registry.ts:159-195` interprets the policy through an ordered loop and source switch; `_network` is unread.
- `packages/aztec-runtime/src/pxe/service.ts:170` is the sole production construction site and uses the default policy.
- `packages/aztec-runtime/src/pxe/service.ts:368-372` passes network data that the registry ignores.
- `packages/aztec-runtime/src/pxe/index.ts:14` exports the configuration surface.

A search across `apps`, `packages`, and `scripts` found no production calls to `setPolicy` or `getPolicy`. The only setter calls are in `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts:104,123`. The production registry is privately held by `PxeService`; there is no policy DI, UI auto-import, route, or reflective registration making those setters live.

**Why it harms future change:** A maintainer changing artifact fallback or verification must reason about source reversal and pinned-source behavior that the shipped wallet never configures. The unused network parameter also advertises a policy dimension the resolver does not implement.

**Smallest safe refactoring:** **Collapse Hierarchy / Inline Function / Remove Dead Code**, applied narrowly to the unused configuration layer: express the actual PXE-first, known-artifact-fallback sequence directly in `ArtifactRegistry.resolve`. Remove policy types, accessors, exports, and the unused network argument. Preserve `pxeOnly`, class-ID verification, lazy loading, caching, and the actively used loader/verifier injection.

**What disappears:** Two policy methods, policy state/default construction, two configuration types, the unused network-context type/argument, and the configurable order/pin dispatch branches. The functioning registry remains.

**Instances:** `packages/aztec-runtime/src/pxe/artifact-registry.ts:14`, `packages/aztec-runtime/src/pxe/artifact-registry.ts:24`, `packages/aztec-runtime/src/pxe/artifact-registry.ts:63`, `packages/aztec-runtime/src/pxe/artifact-registry.ts:98`, `packages/aztec-runtime/src/pxe/artifact-registry.ts:159`, `packages/aztec-runtime/src/pxe/service.ts:170`, `packages/aztec-runtime/src/pxe/service.ts:371`, `packages/aztec-runtime/src/pxe/index.ts:14`.

## Non-findings considered

- **Prior August 14 Q-04, promise-cache duplication:** shared `memoizeAsync`/`memoizeAsyncBy` helpers are now adopted; not re-reported.
- **Prior August 14 Q-13, repeated token/authwit account resolution:** both handlers now use `resolveNetworkAndAccount`; fixed.
- **Prior August 16 Q-06, authwit/action type cycle:** the shared `call-shapes.ts` leaf breaks the cycle; fixed.
- **PXE purge-epoch duplication:** `PxeLifecycleCoordinator` centralizes the previously repeated fence; remaining read/write sequencing has distinct lifecycle requirements.
- **Transaction versus simulation scope checks:** their grant aggregation and sub-scope semantics differ; merging the complete algorithms would erase meaningful policy.
- **Bridge scope helpers versus permission UI:** the extension already imports shared `isAnyContractScope`/`coversAnyContract`; no separate UI reimplementation found.
- **PXE spec/client/service and descriptor-generated proxy:** deliberate architecture; explicit RPC allowlisting serves a separate boundary contract.
- **Legal-object validation versus generic record checks:** prototype/accessor handling gives legal parsing a stricter contract; similar predicates are not interchangeable.
- **Asset resolution versus notices package attribution:** locating an asset from a caller and attributing an already-resolved module have different inputs and traversal requirements.
- **Schema patch registration:** `installOrVerify` already centralizes installation behavior; separate schema validation and bridge TypeScript contracts serve different boundaries.
- **Accepted complexity and exported symbols:** no finding rests solely on function size, an accepted complexity directive, or absence of explicit imports.

## Incidental bugs noticed (for the bugs run)

- `packages/third-party-notices/src/plugin.ts:65-71,102-104` — In a watch rebuild, remove a stylesheet that previously inlined third-party CSS. Its collector entry remains because the removed module is no longer transformed, while `generateBundle` includes every stored stylesheet entry without checking current bundle membership. The emitted inventory therefore still includes removed CSS dependencies. **Confidence: high from source; not reproduced in a running watch build.**

## Cross-rebuttal (codex on claude)

**Confidence: high** in the source comparisons below; the proposed cross-chain journal bug remains unconfirmed.

### 1. Overconfident / wrong in Claude’s findings

- **q11-pkg-high-C-1 — Partially agree.** Matching predicates are duplicated, but `isAnyContractScope` classifies scope breadth and malformed input (`packages/wallet-bridge/src/method-scope-checkers.ts:405-418`); it is not another membership implementation. Preserve enforcement’s separate empty-name guard.

- **q11-pkg-high-C-2 — Partially agree.** Sender normalization duplicates. However, `sessionAccountsOf` deliberately retains raw and CAIP representations (`packages/wallet-bridge/src/dispatcher.ts:435-449`). The alleged journal bug needs a reachable mixed-chain session: its lookup already specifies the chain (`apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:128-130`).

- **q11-pkg-high-C-3 — Partially agree.** The execute/unwrap tail repeats, but the four scaffolds are not identical: sendTx forwards admission hooks (`packages/wallet-bridge/src/dispatcher.ts:1133-1145`), while createAuthWit conditionally executes silently under a fence (`:1171-1194`). Extract narrowly; a universal popup scaffold risks obscuring these differences.

- **q11-pkg-high-C-4 — Partially agree.** The duplicated keyval-emptiness rule is concrete. However, blocked policies have explicit reasons: boot cleanup skips rather than hangs (`packages/aztec-runtime/src/pxe/service.ts:290-292`), whereas profile erasure requires verified completion (`:861-866`). Preserve these contracts and the documented timing constraint at `:275-279`.

- **q11-pkg-high-C-5 — Agree on duplication.** The four formulas match, including `packages/aztec-runtime/src/utils/chain-identity.ts:59` and `apps/extension/src/wallet/services/network/service.ts:1010`. “Layering inversion” overstates it: the helper is misplaced, but no forbidden dependency currently exists.

- **q11-pkg-high-C-6 — Partially agree.** Fee composition repeats, but basis changes already propagate through `predictedWorstMinFees`. Priority-to-multiplier mapping and defaulting an already-resolved multiplier are distinct operations. Preserve custom/embedded-fee branches (`apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:273-290`); extract only the shared default composition.

- **q11-pkg-high-C-7 — Agree with correction.** Registry policy is unused in production. However, `onActiveProfileChanged` has a production reader—the subscription at `packages/aztec-runtime/src/pxe/service.ts:221`; its handler is a no-op at `:1022-1030`. Remove that pair together rather than claiming zero references.

- **q11-pkg-high-C-8 — Agree, structural impact.** Capability policy and execution routing warrant separation (`packages/wallet-bridge/src/dispatcher.ts:201-740,809-1794`). The claim that C-1 cannot be fixed cleanly beforehand is unsupported: a shared matching leaf can be extracted independently.

- **q11-pkg-high-C-9 — Partially agree.** The evidence lists seven identical predicates, not eight. Do not fold in the array-accepting `isObj` (`packages/wallet-bridge/src/dispatcher.ts:767`) or legal’s prototype-aware predicate: replacing either changes its validation contract.

- **q11-pkg-high-C-10 — Agree, low priority.** The same initialization-nullifier query appears twice (`packages/aztec-runtime/src/account/nulo-account.ts:172-174,192-195`). Reuse is appropriate, preserving the current truthiness versus `undefined` semantics.

### 2. What Claude missed that I found

- **q11-pkg-high-X-2:** Artifact membership is independently listed as a union, accessor table, and enumeration (`packages/aztec-runtime/src/pxe/artifact-catalog.ts:35-47,58-71,74-87`); the enumeration is not exhaustively checked.
- **q11-pkg-high-X-3:** Identical cursor-ordering functions govern producer and consumer validation (`packages/aztec-runtime/src/pxe/public-events.ts:192-197`; `apps/extension/src/wallet/services/incoming-transfer/public-event-indexer.ts:50-55`). Neither is addressed by Claude’s schema-pair non-finding.

### 3. What both audits missed

No additional finding established during this light pass.