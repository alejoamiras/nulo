# C3 — wallet-bridge protocol layer — Claude instance 2

Scope audited: `packages/wallet-bridge/src/**`, `packages/extension/src/wallet/utils/caip.ts`, `packages/extension/src/wallet/services/dapp-session/{spec.ts,capability-meta.ts}`, `packages/extension/src/wallet/services/dapp-interaction/spec.ts`, `packages/extension/src/wallet/services/execution/models/index.ts`. All claims verified against source + git history (3-month window: dispatcher.ts 8 commits, scope-enforcement.ts 4, capability-map.ts 3, both caip.ts files dormant since the initial import).

## F1: Method registration is scattered across eight coordinated structures in three files

1. **Title**: Adding or changing one wallet-sdk method requires synchronized edits to eight hand-maintained structures across three files, with no compile-time or test-level parity enforcement.

2. **Smell name**: **Shotgun Surgery** (Fowler). Secondary: *config sprawl* analog — the per-method routing/enforcement metadata is one logical record duplicated as N parallel tables that must agree by convention.

3. **Maintenance impact**: **structural** (with an architectural edge — the split spans `dispatcher.ts`, `capability-map.ts`, `scope-enforcement.ts`). Blast radius: 3 wallet-bridge source files + 2 test files per method change, plus extension-side executor and (for custom RPCs) 3 schema-patch copies. Change frequency: **high** — dispatcher.ts is the hottest file in the package (8 commits / 3 months); the registerToken PR (`f3eb249`) empirically touched `capability-map.ts`, `dapp-interaction-protocol.ts`, `dispatcher.ts`, `operation.ts`, `scope-enforcement.ts` + both tests to add a single method; the audit PR (`336ea6f`) touched the same five-file set again.

4. **Concrete evidence** — the eight structures that must stay in agreement for any one method:
   - `packages/wallet-bridge/src/dispatcher.ts:163-178` — `METHOD_TO_KIND` (11 methods).
   - `packages/wallet-bridge/src/dispatcher.ts:184-192` — `NETWORK_ONLY_KINDS` (7 kinds).
   - `packages/wallet-bridge/src/dispatcher.ts:198` — `ACCOUNT_KINDS` (4 kinds).
   - `packages/wallet-bridge/src/dispatcher.ts:253-280` — the special-method if-chain (`requestCapabilities`, `getAccounts`, `batch`, `sendTx`, `registerToken`).
   - `packages/wallet-bridge/src/dispatcher.ts:867-902` — `buildNetworkOperation` switch (7 cases, must mirror `NETWORK_ONLY_KINDS` membership or throw "Unknown network operation" at runtime).
   - `packages/wallet-bridge/src/dispatcher.ts:916-956` — `buildAccountOperation` switch (4 cases, mirrors `ACCOUNT_KINDS`).
   - `packages/wallet-bridge/src/capability-map.ts:18` + `21-46` — `EXEMPT_METHODS` (3) + `METHOD_CAPABILITY_MAP` (13). 13+3 = 16 = exactly the dispatcher's 11+5 surface — agreement is currently perfect but purely manual.
   - `packages/wallet-bridge/src/scope-enforcement.ts:348-362` — `METHOD_SCOPE_CHECKER` (12 methods). Note `registerToken` is absent here: its account-scope check lives inline in a *fourth* location, `dispatcher.ts:493-504`, unlike every other method.
   All four tables are module-private (none export their key sets), so a parity test cannot even be written today without changing the files. The only existing cross-check is a single spot assertion (`dispatcher.test.ts:828-831`, `getRequiredCapability("registerToken")`).

5. **Why it harms future change**: the next protocol method (or retirement — see the `simulate_views` retirement note at `dispatcher.ts:200-205`, which had to chase the same table set) requires a contributor to *know* all eight sites exist. There is no compiler error and no test failure for a missed site: a method present in `METHOD_TO_KIND` but forgotten in `METHOD_CAPABILITY_MAP` makes `getRequiredCapability` return `null`, `enforceCapability` returns `[]` ("Unknown method — let dispatch() handle it", `dispatcher.ts:782`), and the scope check is skipped because `grants.length === 0` — the omission is silent at every layer. Review burden scales with table count; this package is touched by "essentially every change" per the repo map.

6. **Smallest safe refactoring**: **Replace parallel tables with a single table-driven method registry** (Code Complete "Table-Driven Methods"; in Fowler terms a *Combine Functions into Class* / *Move Field* consolidation). One `Record<methodName, MethodDescriptor>` where `MethodDescriptor = { kind, resolution: "network" | "account" | "special", requiredCapability: CapabilityType | "exempt", scopeChecker?, buildOperation(args, refs) }`. The dispatch entry collapses to one lookup; `NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS` and both switches become fields of the descriptor; exporting the registry makes an exhaustiveness test one line.

7. **What disappears**: the eight-way sync convention; the silent-omission failure mode; the inline-vs-table inconsistency for `registerToken`'s scope check; five-file diffs for one-method changes (drops to registry entry + operation/request types).

8. **Instances**: `packages/wallet-bridge/src/dispatcher.ts:163-178`, `184-192`, `198`, `253-280`, `493-504`, `867-902`, `916-956`; `packages/wallet-bridge/src/capability-map.ts:18`, `21-46`; `packages/wallet-bridge/src/scope-enforcement.ts:348-362`.

## F2: Cross-package fork of CAIP helpers (and the NO_FROM detector) with contradictory source-of-truth headers

1. **Title**: `wallet-bridge/src/caip.ts` and `extension/src/wallet/utils/caip.ts` carry line-for-line identical implementations of four functions, and each file's header claims a different source of truth; the dependency direction already allows consolidation.

2. **Smell name**: **Duplicate Code** (Fowler), cross-package variant; the headers add a *sync-by-comment* analog (the invariant "keep these identical" lives only in prose).

3. **Maintenance impact**: **structural**. Blast radius: 2 files directly; 9 extension files consume the extension copy (`execute`/`verify`/`capabilities` windows, `connected-apps/[id].vue`, `fpc/service.ts`, `dapp-interaction/service.ts`, `queued-journal.ts`, …) while the dispatcher + scope-enforcement consume the bridge copy — a divergence would split behavior along that consumer line. Change frequency: **dormant** (both files: 1 commit, the initial import) — low urgency, but the code sits on the CAIP parse/format path where silent divergence is exactly the failure the extension header warns about.

4. **Concrete evidence**:
   - `formatCaipChain`: `packages/wallet-bridge/src/caip.ts:24-26` ≡ `packages/extension/src/wallet/utils/caip.ts:22-24`.
   - `formatCaipAccount`: bridge `29-31` ≡ extension `27-29`.
   - `parseCaipAccount`: bridge `34-51` ≡ extension `49-66` (identical bodies including the `Number("")` guard and error strings).
   - `resolveNetworkByChainId` + the `NetworksQuery<TNetwork>` structural interface: bridge `54-70` ≡ extension `71-87`.
   - Contradictory headers: extension `caip.ts:4-9` — "This module is the single source of truth for parsing and formatting CAIP identifiers anywhere on the extension side … Do NOT hand-roll the regex"; bridge `caip.ts:6-9` — "The full-featured `caip.ts` in `@nulo/extension` remains the source of truth for the wallet-side code; this file mirrors only the subset the bridge requires."
   - Same root cause, second instance: `isNoFromRequest` + the `"NO_FROM"` sentinel at `packages/wallet-bridge/src/dispatcher.ts:132-138` mirrors `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:17-20`, pinned only by the comment "Mirrors `execution/utils/fee-detection.ts:18`".
   - The consolidation path is open: the extension already imports `@nulo/wallet-bridge` in 15 files; the layer order (`wallet-bridge → extension`) permits the extension to depend downward. Only `parseCaipChain` and the `AZTEC_NAMESPACE` export are extension-only additions.

5. **Why it harms future change**: any hardening of CAIP parsing (address normalization, namespace widening, stricter chainId bounds) must be applied twice; applying it once splits the wallet into two validation regimes whose boundary (dispatcher vs UI/services) is invisible at the call site. The two headers actively misdirect: a contributor following the extension header will edit the extension copy believing it authoritative, while dApp-facing enforcement reads the bridge copy.

6. **Smallest safe refactoring**: **Move Function** (Fowler) — make `wallet-bridge/src/caip.ts` the single implementation (add `parseCaipChain` + export `AZTEC_NAMESPACE` there), and reduce `extension/src/wallet/utils/caip.ts` to a re-export. Same move for `isNoFromRequest`: hoist into wallet-bridge, import from `fee-detection.ts`.

7. **What disappears**: the dual-maintenance contract and both lying headers; the fork becomes one definition with one test surface; the `"NO_FROM"` magic string gets a single owner.

8. **Instances**: `packages/wallet-bridge/src/caip.ts:24-70` ×2 with `packages/extension/src/wallet/utils/caip.ts:22-87`; `packages/wallet-bridge/src/dispatcher.ts:132-138` ×2 with `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:17-20`.

## F3: Session-account resolution and projection duplicated inside the dispatcher, under a comment claiming the duplication was extracted away

1. **Title**: The `resolveNetwork → getAccounts → getSessionAccountAddresses` pipeline appears four times in `dispatcher.ts`, and the `{ alias, item }` account projection appears twice — while `formatSessionAccounts`' doc comment asserts both call sites share it.

2. **Smell name**: **Duplicate Code** (Fowler), plus **Comments** (Fowler — comment as deodorant/stale): the extraction comment documents a consolidation the code doesn't have.

3. **Maintenance impact**: **local** (single file), but in the hottest file of the package (8 commits / 3 months). Blast radius: 1 file, 6 sites.

4. **Concrete evidence**:
   - Resolution triple ×4: `dispatcher.ts:348-350` (`formatSessionAccounts`), `494-496` (`handleRegisterToken`), `721-723` (`enrichGrantedCapabilities`), `989-996` (`resolveNetworkAndAccount`). Each runs `await this.resolveNetwork(ctx)` → `await this.accountService.getAccounts(ctx.profileId, network.chainId)` → `this.getSessionAccountAddresses(dappSession, ctx.chainId)` then filters.
   - Projection ×2: `dispatcher.ts:352-358` and `741-747` — identical `.map(acc => ({ alias: dappSession.accountAliases?.[caip] ?? acc.name ?? "", item: acc.address }))` bodies.
   - Stale comment: `dispatcher.ts:341-346` — "Extracted so the fast path in `handleGetAccounts` and the granted-accounts emission in `enrichGrantedCapabilities` use the same projection". `enrichGrantedCapabilities` does **not** call `formatSessionAccounts`; it re-implements the projection inline, and parity is held by unit tests (`dispatcher.test.ts:411`) instead of code sharing — exactly the arrangement the comment says was eliminated.

5. **Why it harms future change**: a change to alias-resolution precedence (e.g. preferring contact-book names, or trimming) must be found and applied in two projections and the session-filter rule in four resolutions; the misleading comment tells the maintainer the second copy doesn't exist, so the test-pin is the only thing standing between an edit and silent wire-format divergence between `getAccounts` and the `requestCapabilities` grant response.

6. **Smallest safe refactoring**: **Extract Method** (Fowler) — `private async resolveSessionAccounts(ctx, dappSession): Promise<IAccountRef[]>` (resolution + session filter), consumed by all four sites; have `enrichGrantedCapabilities` call `formatSessionAccounts` for its `canGet` branch (the comment then becomes true). Delete the test pin or keep it as a cheap regression guard.

7. **What disappears**: 4→1 resolution pipelines, 2→1 projections, one lying comment; the parity invariant moves from test-enforced to definitionally true.

8. **Instances**: `packages/wallet-bridge/src/dispatcher.ts:341-346`, `348-358`, `494-497`, `721-724`, `741-747`, `989-996`.

## F4: `handleRequestCapabilities` is a 170-line, ten-phase method with the rejection-merge logic duplicated on its two exit paths

1. **Title**: The capability-grant flow is one monolithic method whose rejection-persistence logic is copy-pasted between the popup-reject catch block and the post-approval path.

2. **Smell name**: **Long Method** (Fowler) + **Duplicate Code** (the rejection merge).

3. **Maintenance impact**: **local** (one method), but it is the largest behavioral unit in the package's hottest file and was rewritten in the audit-fix PR (`336ea6f`). Blast radius: 1 file; the popup contract on the extension side mirrors its phases.

4. **Concrete evidence**: `dispatcher.ts:531-701` (170 lines). Sequential phases: session guard → empty-manifest early return (542-548) → grant/rejection set construction (551-554) → delta computation with the accounts-shape special case (564-573) → early-return + enrich (576-588) → popup-input prep (591-606) → popup call with catch-persist (608-631) → accounts-cap safety net (633-643) → account merge + alias write (646-662) → grant merge (665-675) → rejection merge (678-684) → session reload + enrich + response (687-700). The duplicated fragment: catch path `622-629` (`rejectedAt = Date.now()` → `newRejections` map → `deltaTypes` set → `mergedRejections` filter+concat → `setCapabilityRejections`) vs success path `666-684` (same five steps with an `approvedTypes` filter added).
5. **Why it harms future change**: any change to rejection bookkeeping (e.g. adding a rejection `reason`, TTL, or per-capability shape diff per the filed `wallet-sdk-capability-field-diff` follow-up) must be made twice, and the two copies are 50 lines apart with different surrounding state — a classic drift site. Unit-testing any single phase (delta computation, merge semantics) requires standing up a full six-stub dispatcher (`dispatcher.test.ts:36-92`), so each new grant rule costs a disproportionate test harness.

6. **Smallest safe refactoring**: **Extract Method** (Fowler) — `mergeRejections(existing, delta, approvedTypes, at)` shared by both exits; then `computeCapabilityDelta(requested, existingGrants, existingRejections)` and `persistGrantOutcome(...)`. (A later *Extract Class* — a `CapabilityGrantFlow` — becomes mechanical once these exist, but is not required for the win.)

7. **What disappears**: the two-site rejection-merge duplication; the 170-line read; pure-function testability for delta and merge logic without dispatcher stubs.

8. **Instances**: `packages/wallet-bridge/src/dispatcher.ts:531-701`; duplicated fragment at `622-629` and `666-684`.

## F5: Scope-checker family is six near-identical bodies, two of them byte-identical

1. **Title**: The per-method scope checkers in `scope-enforcement.ts` repeat one four-step skeleton six times; `checkGetAddressBook` and `checkRegisterSender` differ only in their error strings.

2. **Smell name**: **Duplicate Code** (Fowler); fix is **Parameterize Function** (Fowler, 2nd ed.).

3. **Maintenance impact**: **local** (one file, 421 lines). Change frequency: medium — 4 commits / 3 months, and the file is the designated landing zone for every new F-00x sub-grant check (three checkers were added in the last audit round alone).

4. **Concrete evidence**:
   - Byte-identical pair (modulo error text): `checkGetAddressBook` (`scope-enforcement.ts:300-306`) vs `checkRegisterSender` (`313-319`) — same `grantsOfType<DataCapability>(grants, "data")` → empty-pass → `caps.some(c => c.addressBook === true)` → throw. `checkGetAccounts` (`286-292`) is the same skeleton with `accounts`/`canGet`.
   - Flag+list trio: `checkRegisterContract` (`53-64`), `checkGetContractMetadata` (`66-76`), `checkGetContractClassMetadata` (`78-88`) — identical 4-step shape `extract address → grantsOfType → empty-pass → some(flag && inAddressList) → throw`, varying only in capability type, flag name, and message.
   - Calls-scope pair: `checkTransactionCalls` (`90-107`) vs `checkSimulationTransactions` (`109-130`) — identical except capability type (`transaction` vs `simulation`) and scope accessor (`c.scope` vs `c.transactions?.scope`).
   - The empty-grants pass-through guard `if (!caps.length) return` is repeated 9× (`58`, `70`, `83`, `99`, `118`, `141`, `158`, `288`, `302`, `315` area).

5. **Why it harms future change**: each new sub-grant check (the established growth pattern: F-003, F-004, F-005 all added checkers here) is written by copying the nearest sibling, propagating the skeleton and any latent defect in it; a change to the shared convention (e.g. how the empty-grants pass-through interacts with type-level enforcement) must be applied in up to 9 places.

6. **Smallest safe refactoring**: **Parameterize Function** — `makeFlagChecker(capType, flag, errorLabel)` (collapses 3 checkers), `makeAddressListChecker(capType, flag, listField, label)` (collapses 3), `makeCallsScopeChecker(capType, scopeSelector, label)` (collapses 2). `METHOD_SCOPE_CHECKER` entries become one-line factory calls.

7. **What disappears**: six bodies → three factories; the next F-00x sub-grant becomes a table entry instead of a copy-paste; the empty-grants convention has one owner.

8. **Instances**: `packages/wallet-bridge/src/scope-enforcement.ts:53-88`, `90-130`, `286-292`, `300-306`, `313-319`.

## F6: Capability discriminator set is hand-redeclared in two places and label coverage is enforced only by comment

1. **Title**: `CapabilityType` re-spells the `Capability["type"]` union character-for-character, and `CAPABILITY_LABELS`' key set is kept aligned with the union by a "keep them in sync" comment rather than by the compiler.

2. **Smell name**: **Duplicate Code** at the type level, with a *sync-by-comment / config sprawl* analog mapping: the same six-discriminator "config" is maintained independently in three files (union, manual type alias, label record) and must agree.

3. **Maintenance impact**: **structural** (crosses wallet-bridge ↔ extension). Blast radius: `capabilities.ts`, `capability-map.ts`, `capability-meta.ts`, plus the capabilities popup and connected-apps settings that render the labels. Change frequency: medium (capability-map.ts 3 commits / 3 months; new capability types are the protocol's stated growth axis).

4. **Concrete evidence**:
   - `packages/wallet-bridge/src/capability-map.ts:11`: `export type CapabilityType = "accounts" | "contracts" | "contractClasses" | "simulation" | "transaction" | "data"` — exactly the discriminators of the `Capability` union at `packages/wallet-bridge/src/capabilities.ts:53-59`; `capability-map.ts` does not import `capabilities.ts`.
   - `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:34-74`: `CAPABILITY_LABELS: Record<string, CapabilityInfo>` with the same six keys, guarded only by the comment at `30-33` ("keep them in sync with the `Capability` union in `@nulo/wallet-bridge`").
   - Drift consequence is silent by design: `getCapabilityInfo`/`getSafeDisplay` (`capability-meta.ts:83-92`, `179-200`) fall back to "Unknown permission" for any unlisted type, so a 7th `Capability` variant added to the union compiles everywhere and renders to users as an unknown high-risk grant until someone remembers the label table.

5. **Why it harms future change**: adding the next capability type is already a multi-file operation (union, method map, checkers, popup); these two unenforced re-declarations add two more sites where the omission produces no error — one of them user-visible (the grant popup mislabeling a first-party capability as "Unknown permission" biased to reject).

6. **Smallest safe refactoring**: *Replace hand-maintained duplicate with derived type* (an **Inline/Replace Temp-with-Query analog at the type level**): `export type CapabilityType = Capability["type"]` in `capability-map.ts` (one import, one line); in `capability-meta.ts`, declare the table `satisfies Record<Capability["type"], CapabilityInfo>` (keeping the wide `Record<string, …>` read accessor for wire-input lookups). Both are behavior-preserving.

7. **What disappears**: two manual re-declarations of the discriminator set; the compiler now forces a label entry and a `CapabilityType` update on the day a new `Capability` variant lands; the sync comment can be deleted.

8. **Instances**: `packages/wallet-bridge/src/capability-map.ts:11`; `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:30-74` (against `packages/wallet-bridge/src/capabilities.ts:53-59`).

## F7: `DispatchHooks` re-declares two-thirds of `IExecutionHooks` instead of deriving from it — a shape that has already drifted once in production

1. **Title**: The dispatcher's caller-facing hooks bag duplicates the field declarations of the execution-side hooks contract; the repo's own comments record a past field-name drift that silently disabled the FIFO release.

2. **Smell name**: **Alternative Classes with Different Interfaces** (Fowler) / **Duplicate Code** — two independently-declared structural types for the same hooks payload, related only by convention and one incidental construction site.

3. **Maintenance impact**: **structural** (the pair spans `dispatcher.ts` ↔ `services-contract.ts`, with the extension aliasing one side). Blast radius: 3 files (`dispatcher.ts`, `services-contract.ts`, `extension/.../dapp-interaction/spec.ts`) + the wiring in `wallet-sdk/background.ts`. Change frequency: medium — the hooks surface gained `queuedJournalId` and `originKey` in separate recent arcs.

4. **Concrete evidence**:
   - `packages/wallet-bridge/src/dispatcher.ts:90-107`: `DispatchHooks { onExecutionEnqueued?; queuedJournalId? }`.
   - `packages/wallet-bridge/src/services-contract.ts:56-60`: `IExecutionHooks { onExecutionEnqueued?; queuedJournalId?; originKey? }` — `DispatchHooks` is exactly `Omit<IExecutionHooks, "originKey">`, but is written out by hand.
   - The extension side learned this lesson for *its* alias: `packages/extension/src/wallet/services/dapp-interaction/spec.ts:62` — `export type ExecutionHooks = IExecutionHooks`, with the rationale "a one-sided rename on either side is a build error, not a silent runtime no-op". The same treatment was not applied to `DispatchHooks`.
   - Documented incident: `packages/extension/src/wallet/services/wallet-sdk/background.ts:285-289` — "a past field-name drift here is exactly what left this release dead before". Today the only thing coupling the two declarations is that `handleSendTx`'s object literal (`dispatcher.ts:458`) happens to read from one and construct the other; because every field is optional, that protection is incidental, not designed.

5. **Why it harms future change**: the next hook field added to `IExecutionHooks` that should flow from the caller (the pattern both `queuedJournalId` and `originKey` followed) must be manually mirrored into `DispatchHooks` and plumbed at `dispatcher.ts:458`; forgetting the mirror produces no error anywhere — the field is simply never forwarded, reproducing the documented dead-release failure mode.

6. **Smallest safe refactoring**: **Extract Superclass** analog for structural types — `export type DispatchHooks = Omit<IExecutionHooks, "originKey">` (keeping the caller-facing TSDoc on the alias). One line; behavior-preserving.

7. **What disappears**: the hand-maintained field mirror; renames and additions become single-sided edits checked by the compiler across all three declarations.

8. **Instances**: `packages/wallet-bridge/src/dispatcher.ts:90-107` vs `packages/wallet-bridge/src/services-contract.ts:56-60`; forwarding literal at `dispatcher.ts:458`; contrast pattern at `packages/extension/src/wallet/services/dapp-interaction/spec.ts:62`.

## F8: Bridge types reach consumers through up to five re-export hops, and live code uses every path

1. **Title**: Wallet-bridge types are re-exported through extension-side shim barrels "for backward compatibility" while newer code imports `@nulo/wallet-bridge` directly — the codebase now has two (and for `AccessLevel`, five) live import conventions for the same symbols.

2. **Smell name**: **Middle Man** (Fowler) — modules whose role for these symbols is pure forwarding — compounded by a *two-conventions* duplication: the canonical path is undecided, so both spread.

3. **Maintenance impact**: **structural** bordering architectural (module-boundary legibility). Blast radius: ~22 files import through the `execution/spec|client` chain; 15 extension files import `@nulo/wallet-bridge` directly; any type move must consider all hops. Change frequency: medium (the shims were created in the recent bridge extraction; every new consumer makes the split wider).

4. **Concrete evidence**:
   - Shim barrels: `packages/extension/src/wallet/services/dapp-session/spec.ts:11-25` (re-exports `AccessLevel` + 12 types, comment: "Re-exported here for backward compatibility"); `packages/extension/src/wallet/services/execution/models/index.ts:4-62` (re-exports ~38 types + `PRIORITY_MULTIPLIERS`); `packages/extension/src/wallet/services/dapp-interaction/spec.ts:11-37` (re-exports all 18 `*Request` types + CAIP types).
   - Hop chain for one enum: `AccessLevel` is defined at `packages/wallet-bridge/src/session-types.ts:21` → wallet-bridge barrel → `dapp-session/spec.ts:11` → `dapp-session/service.ts:20` and `client.ts:17` (`export * from "./spec"`) → `packages/extension/src/utils/confirmation-policies.ts:3` re-exports it a fifth time. Live importers use four different paths: `confirmation-policies.ts:1` (from client), `wallet-sdk/background.ts:42` (from service), `dapp-session/spec.ts:1` (from bridge), plus consumers of the confirmation-policies re-export.
   - Mixed conventions in the same feature: `popup/windows/capabilities/build-items.ts:11-12` imports `Capability` from `@nulo/wallet-bridge` and `getCapabilityInfo` from the dapp-session path in adjacent lines; `Operation`-family types are imported from `@nulo/wallet-bridge` in 5 files, from `@/wallet/services/execution/spec` in 3, and from relative `./spec`/`./models` paths elsewhere (grep counts above).

5. **Why it harms future change**: "who consumes this type?" is no longer answerable with one grep — a rename or move of a bridge type requires chasing each hop and updating shims that exist only to forward; new contributors cannot infer the canonical path (both patterns appear in recently-written code), so the split deepens with every PR; the dispatcher.test drift-pin and layering docs reference exact paths that the hops obscure.

6. **Smallest safe refactoring**: **Remove Middle Man** (Fowler), incrementally — pick the canonical rule (direct `@nulo/wallet-bridge` for bridge-owned types is the natural one given 15 files already do it), codemod the remaining importers, then shrink the shim barrels to only the extension-owned types they actually define (`DappSession`, `Methods`, `Events`, `ExecutionHooks` alias, `MaterializedRegisterTokenOperation`). No runtime change — all hops are `export type`/enum forwarding.

7. **What disappears**: up to four forwarding layers per symbol; the dual convention; shim files shrink to their genuine local contracts, making the wallet-bridge ownership boundary readable from imports alone.

8. **Instances**: `packages/extension/src/wallet/services/dapp-session/spec.ts:11-25`; `packages/extension/src/wallet/services/execution/models/index.ts:4-62`; `packages/extension/src/wallet/services/dapp-interaction/spec.ts:11-37`; `packages/extension/src/utils/confirmation-policies.ts:1-3`; mixed-path examples at `packages/extension/src/popup/windows/capabilities/build-items.ts:11-12`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:42-45`.

## F9: `DiscoveryQueue` is the only ambient-global consumer in an otherwise fully injected package

1. **Title**: `DiscoveryQueue` hard-codes `chrome.action` badge rendering inside queue semantics, the sole `chrome.*` touch in wallet-bridge, whose every other dependency is constructor-injected.

2. **Smell name**: **Global Data** (Fowler, 2nd ed.) — ambient `chrome` global consumed directly; secondarily a small **Divergent Change** (queue policy and badge presentation are two reasons to edit one 78-line class).

3. **Maintenance impact**: **local**. Blast radius: 1 file + its single consumer (`wallet-sdk/background.ts:309`) + any test wanting to cover drain/requeue logic. Change frequency: low (dormant since import).

4. **Concrete evidence**: `packages/wallet-bridge/src/discovery-queue.ts:71-77` (`chrome.action.setBadgeText` / `setBadgeBackgroundColor`, hard-coded `#FF6B00`). Grep confirms these are the only `chrome.` references in `packages/wallet-bridge/src` outside tests. Contrast: the same class takes `handler` and `logger` via constructor (`discovery-queue.ts:10-13`), and the package's flagship class (`WalletSdkDispatcher`) is built entirely on injected structural interfaces (`services-contract.ts`).

5. **Why it harms future change**: unit-testing the non-trivial drain/requeue/stale policy requires stubbing a global `chrome` rather than passing a fake; badge presentation changes (color tokens, count formatting, Firefox `browser.*` parity) force edits inside queue logic; the package's "structurally injected, host-agnostic" property — which is what allowed the bridge extraction in the first place — has one undocumented exception.

6. **Smallest safe refactoring**: **Move Function** / inject a callback — constructor gains `onCountChanged: (count: number) => void`; `background.ts` supplies the badge writer. Three call sites change; behavior identical.

7. **What disappears**: the package's only ambient-global dependency; queue logic becomes testable with plain fakes; badge presentation moves to the layer that owns `chrome.*`.

8. **Instances**: `packages/wallet-bridge/src/discovery-queue.ts:71-77` (call sites at `22`, `37`, `62`).

## F10: Package barrel header documents the opposite of what the barrel exports

1. **Title**: `index.ts`'s module header says the dispatcher "stays in `@nulo/extension`" nine lines above `export * from "./dispatcher"`.

2. **Smell name**: **Comments** (Fowler — stale comment / comment as misdirection).

3. **Maintenance impact**: **cosmetic**. Blast radius: 1 file, but it is the package's front door — the first prose a new contributor reads. Change frequency: file dormant; the lie persists until touched.

4. **Concrete evidence**: `packages/wallet-bridge/src/index.ts:5-8` — "The dispatcher itself + `initWalletSdkHandler` wiring stay in `@nulo/extension` because they reference concrete service classes that live there" — vs `index.ts:18` (`export * from "./dispatcher"`) and `dispatcher.ts` living in this package, importing only structural interfaces (`services-contract.ts`) precisely so it could move here. The header describes the pre-extraction world.

5. **Why it harms future change**: a reader scoping a dispatcher change starts in the wrong package; the header also misstates the package's central design fact (the dispatcher is its largest module and the reason `services-contract.ts` exists).

6. **Smallest safe refactoring**: *Update/delete the stale comment* (Fowler's remedy for the Comments smell) — two sentences: dispatcher lives here on structural interfaces; only `initWalletSdkHandler` wiring remains in the extension.

7. **What disappears**: the misdirection at the package entry point.

8. **Instances**: `packages/wallet-bridge/src/index.ts:5-8` (contradicted by `index.ts:18`).

## Non-findings

- **spec/service/client triple + `export * from "./spec"`** in dapp-session — house convention per prompt; only the bridge-type forwarding cost is counted (F8), not the triple itself.
- **`dispatcher.test.ts` hand-rolled fakes** (11 `new WalletSdkDispatcher` sites, 5 full `IDappSessionWriter` stubs) — test-harness duplication is not flagged in C3's scope; bounded and readable; rejected.
- **`dispatcher.test.ts:682` cross-package relative import of `nulo-schema-patch`** — deliberate drift pin documented in CLAUDE.md; sanctioned.
- **Positional `args[n]` casts in `buildNetworkOperation`/`buildAccountOperation`** — the protocol boundary has to coerce somewhere; coercion is already centralized in exactly two builder functions with the WalletSchema signatures documented above each; no duplication beyond F1's table issue.
- **`enforceScopeWithSession`'s `getPrivateEvents` positional special case** (`scope-enforcement.ts:417-420`) — single instance; generalizing arg-shape metadata now would be Speculative Generality (subsumable into F1's registry if that lands).
- **`action.ts` ↔ `authwit-content.ts` type-level import cycle** — real cycle, but type-only, intra-package, fully erased at compile; no build, runtime, or extraction cost today; rejected as boundary erosion.
- **`unwrapResult` one-line private wrapper** (`dispatcher.ts:1008-1010`) — trivial Middle Man, but it is the deliberate seam keeping `unwrapOperationResult` unit-testable per its TSDoc; cost ≈ 0.
- **`export *` barrel exposing dispatcher-internal helpers** (`enforceScope`, capability-map fns) — package has a single consumer (the extension); no external API-surface cost; house barrel style.
- **18 `*Request` mirror types in `dapp-interaction-protocol.ts`** — not duplication: they are *derived* via `Omit<Operation, …> & { chain | account }`, so the operation shape has one owner; this is the well-factored version of the pattern.
- **Heavy F-00x audit commentary inflating dispatcher.ts LOC** — sanctioned by CLAUDE.md (AUDIT markers pair with tests); not deodorant.
- **`CapabilityParams`/`CapabilityResult` `unknown[]` fields** (Primitive Obsession candidate) — considered; the popup boundary intentionally treats wire capabilities as untyped until validated, and typing them is behavior-adjacent (validation changes), not a safe structural refactor; rejected.

## Out-of-scope observations

- A method present in `METHOD_TO_KIND` but absent from `METHOD_CAPABILITY_MAP` silently executes with zero capability+scope enforcement (`dispatcher.ts:782` returns `[]`) — the maintainability fix is F1, but the fail-open default is a trust-boundary concern for the security track.
- `handleRequestCapabilities`'s multi-write sequence (update session → aliases → grants → rejections, `dispatcher.ts:653-684`) has no transactional boundary; a crash mid-sequence leaves partial grant state — correctness, not quality.
- `makeSession` in `dispatcher.test.ts:36-48` smuggles an `origin` field through an `as IDappSessionRef` cast even though the interface has no such field — test-only typing wrinkle.
- `discovery-queue.ts:75` hard-codes brand color `#FF6B00` rather than a design token — flagged for the UI/token cluster, not C3.
