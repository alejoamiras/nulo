---
plan: harden-dedupe / execution-guards (arc 8 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/08-execution-guards, stacked on harden-dedupe
---

# execution-guards: one chain binding, one selector binding, one class-id check

Findings Q-01 (b) and Q-02 (a, b, c), from `audit/quality/2026-09-30-dedup-high/`. Three trust checks in the execution layer are hand-copied at each site:

- **Chain binding:** a `ChainInfo` must come from a live node pair that was first checked against the network the user selected.
- **Selector binding:** the function a dApp names must be the function its selector runs.
- **Class-id integrity:** an artifact must hash to the class id of the instance it is registered for.

This batch states each check once. Every site keeps the same checks, in the same order, refusing with the same error class and the same message bytes, before the same effects. Q-01 (a) is arc 7 (chain-id) and Q-01 (c) is arc 6 (dapp-grant-planning); neither is in this arc.

## Outcome & Quality Bar

- **For whom:** whoever adds the next signing, simulation or registration path. Today they copy a fetch, an assert and a two-`Fr` literal, a seven-line name/selector guard with site-specific text, or a recompute-and-compare, and nothing fails if they drop one.
- **Excellent:**
  - A `ChainInfo` from a live node cannot be built without the drift assert: one call does both.
  - The selector guard exists once, and each site's difference (message label, absent-name policy) is a named policy, not a copy.
  - The authwit effect decode loop exists once, shared by the three discovery paths, with the probe's dedupe still its own.
  - Phase 1 pins every site's refusals with the exact message, the effect that must not happen, and a positive control, using wire-shaped values. Phase 2 passes them with every Phase 1 test file byte-identical.
- **Good enough:** the sites that use the live pair for more than a `ChainInfo` keep their own `assertLiveChainIdentity` (listed below).

## Architecture & Implementation

Line numbers are read on `harden-dedupe` at `0faf26af`. Arc 7 edits none of the execution files, so they hold on arc 7's head too. Execution paths below are under `apps/extension/src/wallet/services/execution/` unless a package is named.

### A. Chain binding (Q-01 b)

**New, in `packages/aztec-runtime/src/utils/chain-identity.ts`:** `liveChainInfo(network, nodeInfo): ChainInfo`. Its body is `assertLiveChainIdentity(network, nodeInfo)` followed by `return chainInfoFrom(nodeInfo)`. It is synchronous and does not fetch; it is exported through `src/utils/index.ts`. The file's header comment gains one sentence naming it as the way to get a `ChainInfo` from a live pair.

- **Why sync, not the finding's `liveChainInfo(node, network)`:** an async wrapper around `getNodeInfo()` adds microtask hops between the fetch and the assert, and between the assert and the caller's next statement. A sync helper leaves every site's awaits exactly where they are, so there is no timing argument to make.
- **Composition with arc 7:** arc 7 changes the imports and line 59 of this file (the composite now comes from wallet-core's `walletChainId`) and leaves `assertLiveChainIdentity`'s signature, messages and order unchanged. This arc appends a function after `chainInfoFrom`, a separate hunk. Arc 7's plan names the helper with a `node` argument; the reason for dropping it is the one above.
- **Why the projection cannot throw after the assert:** the assert has proven both values are safe integers in `[0, 2^32 - 1]` (`chain-identity.ts:47-52`, `assertCanonicalL1ChainId` in `packages/wallet-crypto/src/derive-account-seed.ts:19-23`). `new Fr(n)` cannot throw for those values, and `chainInfoFrom` (`:73-75`) builds the same object as each literal: same keys, same key order, same constructor.

**The ten literals and the two clump-adjacent sites:**

| site | today (guard order) | after |
|---|---|---|
| `authwit-discoverer.ts:109-118` | collect effects; none → return `{[],[]}` with no fetch; `getNodeInfo()`; assert; literal | same order: `const nodeInfo = await node.getNodeInfo()` stays its own statement, then `liveChainInfo(network, nodeInfo)` replaces assert and literal, so `network` is still read after the await (every site below keeps the fetch as its own statement too) |
| `discovery-probe.ts:65-79` | `used` gate; collect effects; none → `[]` with no fetch; `getNodeInfo()`; assert; literal | same, via `liveChainInfo` |
| `dapp-send-executor.ts:1000-1005` | collect effects; none → `[]` with no fetch; `getNodeInfo()`; assert; literal | same, via `liveChainInfo` |
| `view-executor.ts:212-220` | `getNetwork`; `getNode`; `getNodeInfo()`; assert; return literal to the dApp | `return liveChainInfo(network, nodeInfo)` |
| `fast-path.ts:219-230` | `getNodeInfo()`; assert; `bindOptimizableCalls` (may throw a scope violation or return `null`); literal | `getNodeInfo()`; `liveChainInfo`; bind. The projection moves above the bind; it is pure and cannot throw (above), so the observable sequence is unchanged |
| `service.ts:1021-1029` | `getNode`; `getNodeInfo()`; assert; literal; then the intent branches (the raw-hash branch also passed the assert) | same, via `liveChainInfo` |
| `helpers/batched-view-simulation.ts:357-366` | anchor read (missing → demote, no fetch); `getNodeInfo()` (propagates); assert; literal; `completeFeeOptions` in its own try | same, via `liveChainInfo` |
| `helpers/batched-view-simulation.ts:202-206` | slow tuples with no fast-arm `chainInfo`: `getNodeInfo()`; assert; `chainInfoFrom` | same, via `liveChainInfo`. Not a literal, the same pair |
| `authwit-discoverer.ts:172-175, 221-224, 235-238` | literal from a `nodeInfo` already asserted by the build | `chainInfoFrom(nodeInfo)`, with no second assert. These methods never had a per-method assert, so the swap removes no protection. The only production caller is `TxRequestBuilder.resolveAuthwitMessageHash` (`tx-request-builder.ts:253-267`), fed by `resolveBuildContext`'s asserted `nodeInfo` (`:228-229`); `authwit-discoverer.real.test.ts:136,168` calls them directly. The class TSDoc states the precondition (a signing caller passes a `nodeInfo` already checked against the selected network), and `computeCallMessageHash`'s TSDoc loses its stale `service.ts:2060-2099` provenance |

**Unchanged, on purpose:** `tx-request-builder.ts:228-229` and `:399-400` (the live pair also feeds `txsLimits`, `TxContext` and `chainIdentity`; `:303` already calls `chainInfoFrom`) and `service.ts:297-301` (it returns the raw pair, not a `ChainInfo`).

**Comments this arc rewrites, because the change makes them wrong or the audit flagged them:**

- `authwit-discoverer.ts:115-116`, the false "noop for local" claim, owned here per arc 7's plan. It becomes one sentence: refuse to derive a hash from a drifted node.
- The method TSDoc at `:76-80`, which says the loop mirrors a `service.ts` range that no longer exists.
- The probe header (`discovery-probe.ts:3-10`). It loses the "measurement arc … single-sim-estimates B1" provenance, and its byte-mirror claim becomes the shared call.
- The probe's catch comment (`:98`).
- The crypto-seam comment (`:37-38`). It says hashing is "e2e-only", but `authwit-discoverer.real.test.ts` runs the real hashes in a node-environment unit test.
- `view-executor.ts:353-368`, shrunk to its invariants: authorization reads names, execution dispatches selectors; only `undefined` means absent; a malformed selector gets a controlled error.
- Finding tags (`F-012`, `A-01 V-01`) are dropped only from the comments this arc rewrites.

### B. The authwit effect decode loop (Q-02 a)

**New file `decode-authwit-effects.ts`** next to `discovered-authwit.ts`:

- `decodeAuthwitEffects(effects, chainInfo, crypto = REAL): Promise<{ record: DiscoveredAuthwit; messageHash: Fr }[]>`.
- For each effect, in order, inside one bare `try`: `crypto.fromFields(effect.data)`, then `crypto.computeMessageHash({ consumer: effect.contractAddress, innerHash }, chainInfo)`, then `toDiscoveredAuthwit(...)`, then push. On any throw it skips the effect, as all three loops do today.
- The crypto seam `AuthwitDecodeCrypto` moves here from `discovery-probe.ts:39-47`, with the real implementation (lazy references to `CallAuthorizationRequest.fromFields` and `computeAuthWitMessageHash`, so the module mock in `dapp-send-executor.test.ts:41-50` still intercepts). `discovery-probe.ts` re-exports it as `DiscoveryProbeCrypto`, the name `discovery-probe.test.ts:9` imports.

**Each site, after:**

- **Discoverer (`authwit-discoverer.ts:119-140`):** maps the pairs to `actions` (`messageHash: record.messageHash`) and `discovered` (`record`).
- **Send executor (`dapp-send-executor.ts:1006-1019`):** returns the pairs as they are.
- **Probe (`discovery-probe.ts:81-101`):** keeps its own dedupe over the pairs: skip when `seen` has `record.messageHash`, else add it and push the action and the record.

**Why this is equivalent:**

- The same crypto calls run, the same number of times, in the same order.
- The probe already hashed every effect before its dedupe check, so a duplicate still costs one decode and one hash.
- The only new work is that `toDiscoveredAuthwit` now also runs on duplicates. It is pure, and a duplicate it fails on was skipped anyway. A record that fails before its hash enters `seen` still leaves a later effect with the same hash free to be collected, as today.
- `record.messageHash` is `messageHash.toString()`, already computed inside the `try`. Using it means no `toString()` runs outside the catch.
- Nothing reads the probe's `collected` or `discovered` until `extractEffects` resolves (`discovery-aware-estimator.ts:119`; the fee strategies read its return value). The loop cannot throw past its catch, so filling them after the loop rather than during it is not observable.

### C. Selector binding (Q-02 b)

**New, in `contract-resolver.ts`, beside `findFunctionBySelector`:** a synchronous `assertSelectorBinding(fn, claim, policy): FunctionAbi`, where `claim` is `{ name?: string; to }`.

- It throws `new Error("Method not found")` when `fn` is undefined.
- It throws `` new Error(`Scope violation: ${policy.label} "${claim.name}" does not match selector's function "${fn.name}" on ${claim.to}`) `` when the name mismatches. A mismatch means `claim.name !== fn.name`, except that an `undefined` name passes when `policy.absentName === "allowed"`.
- Three exported policies:
  - `CALL_BINDING`: `{ label: "call name", absentName: "allowed" }`
  - `AUTHWIT_CALL_BINDING`: `{ label: "authwit call name", absentName: "allowed" }`
  - `NAMED_CALL_BINDING`: `{ label: "call name", absentName: "refused" }`
- These are string literals, not boolean flags, per the program's complexity rule.
- **Each site passes its own `to` value unchanged.** The template then formats it exactly as the site's own template does today; the one site that calls `.toString()` explicitly passes the string. An empty name `""` is a mismatch under every policy, as today (it is compared, never tested for truthiness).

| site | guards before | the binding today | after | guards after (unchanged) |
|---|---|---|---|---|
| S1 `tx-request-builder.ts:329-353` (NO_FROM) | exactly one call (`DefaultEntrypoint requires exactly 1 call, got N`); `FunctionCall.schema` parse; `requireArtifact` (`ContractNotRegisteredError` "Contract not found" / "Contract artifact not found"); `findFunctionBySelector` | `:341-348`, label "call name", `` `on ${call.to.toString()}` ``, absent allowed | `assertSelectorBinding(fn, { name: call.name, to: call.to.toString() }, CALL_BINDING)` | non-private → "DefaultEntrypoint only supports private functions"; returns the dApp's parsed `call` |
| S2 `tx-request-builder.ts:193-199, 587-600` (`encoded_call` action) | `requireArtifact`; `findFunctionBySelector` | `:591-596`, "call name", `on ${action.to}` (string), absent allowed | `validateEncodedCallFn` calls the helper with `action`, `CALL_BINDING` | overwrites `action.type` / `isStatic`; the call is built from the ABI |
| S3 `authwit-discoverer.ts:193-206` (encoded-call authwit) | `requireArtifact`; `findFunctionBySelector` | `:195-202`, "authwit call name", `on ${content.to}` (string), absent allowed | helper with `content`, `AUTHWIT_CALL_BINDING` | overwrites `name/type/isStatic/returnType`; hash |
| S4 `service.ts:1038-1057` (`aztec_createAuthWit` call intent) | chain binding (A); `getContractInstance` (`ContractNotRegisteredError` "Contract not found"); `getContractArtifact` ("Contract artifact not found"); `findFunctionBySelector(…, call.selector.toString())` | `:1050-1057`, "authwit call name", `on ${call.to}` (the wire value), absent allowed | helper with `call`, `AUTHWIT_CALL_BINDING` | schema parses of `caller`, `to`, `selector`, `args`; hash; fence assert and the `isFenceLive` check before `createAuthWit` (`:1013-1015`) |
| S5 `view-executor.ts:347-397` (`aztec_executeUtility`) | active profile ("Wallet locked"); `ensureRegistered`; `to`/`selector` presence ("Malformed executeUtility: …"); `resolveInstance`; `resolveArtifact`; `findFunctionBySelector` | `:375-380`, "call name", `on ${op.call.to}`, absent allowed | helper with `op.call`, `CALL_BINDING` | call rebuilt from the ABI, `hideMsgSender` forced false; zod parses; `pxe.executeUtility` |
| S6 `fast-path.ts:124-156` (simulate prefix) | per call: lookup inside `try`, any throw → `null` (standard path) | `:135-140`, outside the `try`: "Method not found", then "call name" with the name **required**, `on ${call.to}` | helper with `call`, `NAMED_CALL_BINDING`, still outside the `try` | not public-static → `null`; bound call from the ABI |

- **Not a seventh site:** `helpers/batched-view-simulation.ts:627-629` looks up by selector with no name check, but its callers are wallet-internal reads (`gas-balance-reader.ts:173,185`, `token-balance/balance-projector.ts:238`, `token/service.ts:764`) that build calls from wallet-chosen ABIs, so no dApp-claimed name exists there to bind. It stays untouched.
- **Where an absent name can arrive.** `FunctionCall.schema` requires `name: z.string()` (`@aztec-labs/stdlib` 6.0.0-rc.1, `dest/abi/function_call.js:42`).
  - S1 parses with it at `:338`, so an absent name is refused by the schema before the lookup. The helper's "allowed" branch is unreachable there, and is kept only to match today's code.
  - S6's wire input is parsed by `rehydrateOptimizablePrefix` (`fast-path.ts:109-114`): a missing name returns `null`, the standard-path fallback. Its required-name policy is reachable only through a direct `bindOptimizableCalls` call.
  - S2 and S3 read the bridge's `EncodedCallPayload`, whose `name` is optional, so absent-name acceptance is live there. For S4 and S5 the rows call the method directly with an absent name.
- **Comments:** the TSDoc on `validateEncodedCallFn` (`:581-586`) and the S4 why-comment (`:1033-1037`) stay. The S5 comment shrinks as listed in § A.

### D. Class-id integrity (Q-02 c)

**New, in `packages/aztec-runtime/src/pxe/artifact-class-id.ts`, beside `verifyArtifactClassId`:** `assertArtifactClassId(artifact, expected): Promise<void>`, exported from `src/pxe/index.ts`.

- Its body is today's two lines verbatim: `const contractClass = await getContractClassFromArtifact(artifact)`, then `if (contractClass.id.toString() !== expected.toString()) throw new Error("Contract artifact doesn't match instance's current class id")`.
- A recompute failure propagates as thrown; it is not converted.
- The `README.md` row for the file gains "plus the throwing check registration uses". The module header, which today describes only the return-`undefined` contract, names both exports and when each applies.

| site | guards before | today | guards after (unchanged) |
|---|---|---|---|
| C1 `service.ts:815-851` (`registerContract`, Nulo op) | protocol address 0–6 → return; `getNetwork`; instance parse or lookup (`ContractNotRegisteredError` "Contract instance not found"); artifact parse or lookup ("Contract artifact not found") | `:840-843` | address recompute ("Contract address doesn't match instance address"); `pxeService.registerContract` |
| C2 `service.ts:956-997` (`aztec_registerContract`) | instance parse; `getNetwork`; protocol address → return; artifact parse (a failure falls back to lookup); lookup (`ContractNotRegisteredError` "Contract artifact not found for class …") | `:987-990` | `registerContract`; optional `registerAccount` |

Both sites become `await assertArtifactClassId(artifact, instance.currentContractClassId)`.

**Why not reuse `verifyArtifactClassId`:** it differs on three counts:

1. It swallows a recompute failure into "mismatch", which would change the error a dApp sees.
2. It compares with `Fr.equals`, which `register-contract-void-conformance.test.ts:29` fakes with a `toString`-only id.
3. It logs.

Sharing more than the upstream call would need a flag per difference.

**The `ArtifactRegistry` cache is not touched.**

- `ArtifactRegistry.verifiedClassIds` (`packages/aztec-runtime/src/pxe/artifact-registry.ts:43, 141-153`) is keyed by class id alone. Arc 1 recorded this as an out-of-scope lead.
- This arc edits neither the registry, nor `verifyArtifactClassId`, nor `DefaultArtifactClassIdVerifier`.
- `assertArtifactClassId` is stateless and recomputes on every call. It must never be routed through the registry or a cache.
- Both service sites recompute even an artifact the registry returned (`packages/aztec-runtime/src/pxe/service.ts:367-370`).
- The lead stays a program follow-up, recorded under Decisions with both legs' arguments.

### What stays, and layering

- **Unchanged:** every error class and message, every guard's position relative to each effect, `findFunctionBySelector`'s lookup order, `requireArtifact`, `chainInfoFrom`, `assertLiveChainIdentity`, `verifyArtifactClassId`, the registry.
- **Imports:** the extension already imports `@nulo/aztec-runtime/utils` and `/pxe` from these files, and `pxe/client.ts:9` already loads the `pxe` barrel at runtime, so `service.ts` pulls in no new module.
- **API surface:** `@nulo/aztec-runtime` is private and not staged by `scripts/publish/packages.ts`; its two new exports widen no npm API.
- **Complexity:** no touched function is in the complexity manifest. The helpers score low (the binding guard is two flat `if`s), and every edited function shrinks.
- **Alternative not taken:** a single `bindAndHash` pipeline per discovery path (fetch, assert, decode, dedupe). It would fold the probe's `used` gate and dedupe into shared code that the other two paths must not run.

## Security & Adversarial Considerations

- **Who controls what.**
  - A connected dApp, through the wallet-sdk dispatcher, controls `createAuthWit` intents (`call.name`, `selector`, `to`, `args`), `sendTx` `encoded_call` actions, `executeUtility` calls, `simulateTx` calls (the fast path), and `registerContract` instances and artifacts.
  - A malicious or drifted RPC endpoint controls `getNodeInfo()`.
  - A compromised page reaches the same entry points as a dApp; nothing here is popup-only.
- **What each check stops.**
  - *Chain binding* stops an endpoint from making the user sign or prove against a chain they never selected. Without it, a signed authwit could be replayed across chains, and a dApp could be shown a fake chain id.
  - *Selector binding* stops a dApp scoped for a benign name from running or signing a different selector. Scope checks authorize by name, while execution dispatches by selector (`view-executor.ts:353-360`).
  - *Class-id integrity* refuses registration of an artifact whose hash is not the class the instance claims. Upstream's contract store already files each artifact under its own recomputed class id, first write wins (`@aztec-labs/pxe` 6.0.0-rc.1, `contract_store.js:85-95`), so a mismatched artifact would not be bound to the instance anyway. What the check buys is a clean refusal at the boundary and defence in depth if that keying ever changes.
- **Consolidation hazards, and the guard against each.**
  - *A looser policy reaching the fast path.* `NAMED_CALL_BINDING` is the only policy that refuses an absent name.
    - Phase 1 pins S6's `undefined` refusal through a direct `bindOptimizableCalls` call, and its wire fallback (`null`) separately.
    - It pins acceptance of an absent name at S2–S5, and S1's schema refusal of one, so a swapped policy fails either way.
  - *A truthiness test.* The helper compares with `!== undefined`, so `""` stays a mismatch; pinned at every site.
  - *A projection without the assert.* `liveChainInfo` is the only new way to a `ChainInfo` and has no skip parameter; drift rows at every clump site fail if the assert is dropped.
  - *A lost lazy fetch.* The `!effects.length` early return stays at each discovery site, above the fetch; the no-effects rows assert that `getNodeInfo` is never called.
  - *A guard moved after an effect.* Each site's characterization asserts the effect never ran on refusal: `pxe.executeUtility`, `account.createAuthWit`, `simulateViaNode`, `pxeService.registerContract` and `registerAccount`, and the address recompute in C1.
  - *Class-id swallow or cache.* The helper propagates recompute errors and holds no state; Phase 1 pins a recompute throw arriving as the same error object at both sites.
- **No new data in logs or on the wire.** The arc moves code, never adds a log line, and changes no message. A thrown error's stack trace now has one more frame (the helper), which no consumer reads as a contract.
- **Out of scope, unchanged:** the registry cache lead above. On `aztec_registerContract`, the claimed instance address is not recomputed by the wallet. Upstream PXE derives the address from the preimage and ignores the claimed one (`@aztec-labs/pxe` 6.0.0-rc.1, `pxe.js:544-557`), so this is noted, not a lead.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `0faf26af`):

1. The ten `ChainInfo` literals sit at the lines in § A; `git grep "new Fr(.*l1ChainId)"` finds no others outside `chain-identity.ts:74` and `wallet-crypto`.
2. The six selector guards and their texts are as in § C. Only `fast-path.ts:138` requires a name. Only `tx-request-builder.ts:346` calls `.toString()` on `to` in its template. `AztecAddress` defines `toString()` and no `Symbol.toPrimitive` (`@aztec-labs/stdlib` 6.0.0-rc.1, `dest/aztec-address/index.js:146`). `FunctionCall.schema` requires `name: z.string()` (`dest/abi/function_call.js:42`).
3. Both class-id sites use `getContractClassFromArtifact` and a `toString()` comparison, with no `try`. `verifyArtifactClassId` uses `.equals` inside a `try` (`artifact-class-id.ts:57-70`).
4. The extension's vitest config inlines `@nulo/*` (`apps/extension/vitest.config.ts:84`), so a module mock of `@aztec-labs/stdlib/contract` reaches `aztec-runtime` source.
5. Two test files mock `assertLiveChainIdentity` at the module boundary and assert calls on the mock: `dapp-send-executor.test.ts:52-56, 542-556` and `view-executor.test.ts:20-24, 228-237`. Their fixtures are not self-consistent (stored `chainId: 7`, no `l1ChainId`; live pair `(1, 2)`).
6. Exact-text pins today:
   - Only `fast-path.test.ts:297-312, 556-580` pins a binding message, and only partly.
   - `tx-request-builder.pins.test.ts:313` and `view-executor.test.ts:323-363` match `/Scope violation/`.
   - No test pins the class-id message.

**Inferences:**

- Nothing outside the listed files constructs a `ChainInfo` from a live pair, so the helper's adoption is complete.
- Because of Fact 5, sites that call `liveChainInfo` would bypass those two mocks. Phase 1 therefore replaces the mock-call assertions with behavioural ones on self-consistent fixtures, which also makes them catch a dropped assert.

**Asks:** none.

## Phases

### Phase 1: pin each site's guards (test only)

**How every refusal row asserts.** Vitest 4's `toThrowError("text")` matches a substring (Chai's `compatibleMessage`), so a refusal row:

- captures the rejection;
- asserts `error.message` with `toBe(expected)`;
- asserts the constructor separately (`error.constructor` `toBe` `Error`, or the typed class);
- asserts that the effect named in § Security never ran;
- sits beside a positive control (lessons: a refusal test needs a success-path twin).

A propagated error is asserted with `toBe(originalError)`.

**Values are wire-shaped:** addresses are `0x` plus 64 hex characters, selectors are derived from a real ABI entry, and the createAuthWit intent is JSON-shaped plain values. A row that calls an internal method with a value the wire schema cannot produce says so in its title. Expected values are written out or computed independently in the test, never read from a production helper.

- **Chain binding:**
  - **Discoverer:** in `authwit-discoverer.real.test.ts` (node environment, real crypto):
    - a non-local network row whose composite matches still yields the KAT;
    - a drifted `rollupVersion` rejects with the full message after the discovery simulation;
    - `computeCallMessageHash` and `computeEncodedCallMessageHash` equal `computeAuthWitMessageHash` over `{ chainId: Fr(l1ChainId), version: Fr(rollupVersion) }` with `l1ChainId ≠ rollupVersion`, so a swapped projection fails.
  - **Probe:** `discovery-probe.test.ts:119`'s drift row asserts the full message.
  - **Send executor and view executor:** in `dapp-send-executor.test.ts` and `view-executor.test.ts`, the module mock is deleted and each harness gets a self-consistent pair. The stored row gains `l1ChainId: 1` and the node reports `rollupVersion: 6`, so the composite is `7`. The V-01 tests become:
    - **send, drift:** with effects present, a drifted pair rejects with the full message and no authwit is created;
    - **send, laziness:** today's one-fetch (effects) and zero-fetch (no effects) assertions are kept;
    - **view:** `executeAztecGetChainInfo` returns an object whose keys are exactly `["chainId", "version"]`, both `Fr`, serialising to the 64-hex `0x…01` and `0x…06`, and a drifted pair rejects.
  - **Fast path:** a drift row rejects with the full message, with `resolver.resolveInstance` and `simulateViaNode` not called. The positive row pins the `chainInfo` handed to `simulateViaNode`.
  - **Batched view:** `batched-view-mixed-arm.pins.test.ts:144` asserts the full message, and a slow-only drift row is added.
  - **`aztec_createAuthWit`:** a new `service.authwit-binding.test.ts` (node environment, real hashing, prototype call with a minimal `this` as in `register-token.test.ts`):
    - a drifted pair rejects for both intent kinds and for a raw hash, before `getContractInstance` runs;
    - a matching pair yields `computeAuthWitMessageHash` over the expected `Fr` pair.
- **Selector binding, S1 to S6:**
  - **Files:** `tx-request-builder.pins.test.ts` (S1, S2), `authwit-discoverer.real.test.ts` (S3), `service.authwit-binding.test.ts` (S4), `view-executor.test.ts` (S5), `fast-path.test.ts` (S6).
  - **Every site:** an unknown selector refuses with `"Method not found"`; a mismatched name refuses with the site's full message, including its label and its exact `to` text; `""` refuses with the full message showing `""`. A matching name proceeds (the control).
  - **Absent name, S2–S5:** proceeds.
  - **Absent name, S1:** refused by `FunctionCall.schema` with today's error, before any lookup and with no effect. No parsing is mocked.
  - **Absent name, S6, two tests:**
    - the wire fallback: `rehydrateOptimizablePrefix` returns `null` for a call without a name;
    - the guard policy: a direct `bindOptimizableCalls` call refuses with `"undefined"` in the full message.
  - Each row asserts the site's effect did not run (or ran, for the controls).
- **Authwit decode:**
  - **Probe:** effect A fails in `toDiscoveredAuthwit`, and a later effect B with the same hash is still collected. This pins "enter `seen` only after the record".
  - **Send executor:** three effects with a malformed one in the middle yield two records, and `createAuthWit` runs in effect order.
- **Class id:** a new `service.class-id.test.ts`, bb-free, mocks `@aztec-labs/stdlib/contract` at the module boundary as `register-contract-void-conformance.test.ts` does, with a controllable recompute. For each of C1 and C2:
  - a match registers once;
  - a mismatch rejects with an `Error` whose constructor is `Error` (not `ContractNotRegisteredError`) and whose message is exactly the expected text; nothing is registered, and for C1 the address is not recomputed;
  - a recompute throw rejects with the same error object (`toBe`) and registers nothing;
  - a lookup-path artifact (none provided) is recomputed too;
  - two distinct id objects with equal `toString()` match.
- **Comments:** three test comments repeat the false "noop for local" claim (`authwit-discoverer.real.test.ts:80`, `fast-path.test.ts:278-279`, `helpers/batched-view-simulation.test.ts:245-246`). They are corrected in this phase.

The phase passes on the unchanged code and is committed alone, freezing every test file before Phase 2.

### Phase 2: the four helpers

Make § A to § D with no test file touched.

- **Order within the phase:** `liveChainInfo` and `assertArtifactClassId` in `aztec-runtime`, then `assertSelectorBinding`, then `decode-authwit-effects.ts`, then the site edits.
- **Docs:** the `aztec-runtime` README row, and the execution README's `contract-resolver.ts` row ("plus the selector binding guard").

**Mutation check.**

- **Procedure:** run after the Phase 2 commit, on a clean tree. Apply one mutant at a time, run the affected test files, and revert with `git restore`; nothing is committed. A kill counts only if a runtime assertion fails. A mutant that fails to compile, or a test file that fails to load, is fixed so it compiles and then rerun.
- **Results** are logged in the arc's lessons file.

The mutants:

- `liveChainInfo` replaced by `chainInfoFrom` (dropping the assert) at each of the 8 call sites, one at a time;
- the early return moved below the fetch, at each of the three discovery sites;
- the probe's `seen` check dropped;
- the probe's `used` gate dropped;
- only the `!fn` branch removed from `assertSelectorBinding`;
- `CALL_BINDING` refusing an absent name; `NAMED_CALL_BINDING` allowing one;
- one label changed;
- the name tested for truthiness;
- the helper call deleted at each of S1 to S6, one at a time;
- the class-id call deleted at C1, and separately at C2;
- `assertArtifactClassId` catching and converting the recompute error;
- `chainId` and `version` swapped in `chainInfoFrom`;
- a prefix or suffix added to the scope-violation message, and separately to the class-id message.

Each mutant must turn at least one Phase 1 row red.

**Validation gate (after each phase):**

- **Commands:** `bun run --cwd packages/aztec-runtime test`, `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`, `bun run build`.
- **Pass criteria:**
  - All exit 0.
  - After Phase 2, `git diff --stat <phase-1 commit>` lists no `*.test.ts` file.
  - Every mutant above is red.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Local network e2e (Chrome), after Phase 2:** the files covering authwit, view and send execution, run with `NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent <files>`.
- **Layers:** unit, composition and the real-crypto node-environment files locally; the smoke and network lanes (including both browsers' prover-on canaries, which sign authwits) run in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Point it at this plan's guard tables and ask it to diff every site's guard set and order before and after. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the stack, then add both e2e labels. When the program gates are green, with the shards that actually ran recorded, squash-merge.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/08-execution-guards`, stacked on arc 7 (chain-id), whose only overlap is `packages/aztec-runtime/src/utils/chain-identity.ts`, in separate hunks. No file overlaps arc 6 (dapp-grant-planning). Drafted on `harden-dedupe`; the restack onto arc 7's head replays this arc's commits only. Code review: off.

## UI impact

None. Messages reach dApps over RPC only and stay byte-identical; no popup surface changes.

## Drift left for the alignment arc

None. The per-site differences (two message labels, the fast path's required name, each site's `to` formatting, the probe's dedupe and `used` gate, `.equals` in `verifyArtifactClassId` against `toString()` at the service sites) are intentional and kept as named policies or left in place.

**Follow-ups for the program's final report, unchanged here:**

- **The registry cache lead** (`packages/aztec-runtime/src/pxe/artifact-registry.ts:143`). `ArtifactRegistry.verifiedClassIds` is keyed by class id alone; this was arc 1's lead. The legs split on its weight; see Decisions.
- **The `batched-view-simulation.ts:627-629` selector lookup has no name check.** That is correct for today's wallet-internal callers, which build calls and selectors from wallet-chosen ABIs (`buildViewCall`). A future caller that routes a dApp-supplied call there must add the binding first.
- **Backup restore registers contracts unchecked.** `apps/extension/src/wallet/services/account-state/service.ts:411` registers a backup-supplied instance and artifact with no class-id check. Backups are attacker-controlled; the impact is low because of upstream's store keying.

## Decisions (delegated)

### Plan audit, Codex round 1 (GPT-6 Astra, xhigh): REVISE

The design was found sound: every guard, its order, its error bytes and its position before the effect are preserved, and the fast-path reorder is safe. All four findings were adopted:

1. **Should-fix: an absent name cannot reach S1's guard.** `FunctionCall.schema` requires `name`, and S6's wire input falls back to `null`. Adopted: S1 pins the schema refusal; S6 splits into its wire fallback and a direct guard-policy test; nothing mocks parsing.
2. **Should-fix: `toThrowError("text")` is a substring match.** Adopted: messages are compared with `toBe`, the constructor is asserted separately, propagation uses `toBe(originalError)`, and a prefix/suffix mutant proves it.
3. **Nit: "only caller" means only production caller.** Adopted: the methods never had a per-method assert, so the precondition is documented, and the stale provenance in `computeCallMessageHash`'s TSDoc goes.
4. **Nit: retained comments.** Adopted: the S5 comment shrinks to its invariants, the probe header loses its provenance, the "e2e-only" claim is corrected, and the `artifact-class-id.ts` header names both exports.

Its mutant advice (one substitution per site, runtime failures only) was adopted with the Opus pass's list.

### Plan audit, Opus pass: REVISE

The Opus pass agreed the design preserves every guard and its order. Adopted:

- the S1 absent-name row, the same finding as Codex 1;
- the per-site mutants;
- splitting the send-executor drift row from its no-effects row, since a drift refusal needs effects to reach the fetch;
- keeping the `await` on its own statement, so `network` is read after it as today;
- softer class-id wording: upstream's store already keys artifacts by their recomputed id, so the check buys a clean refusal and defence in depth;
- the backup-restore follow-up.

### The registry cache lead: the legs split

- **Codex:** a real cache defect. Once a class id is cached, a later artifact claimed for it is returned unchecked. Exploitability is not established; C1 and C2's unconditional recompute protects registration.
- **Opus:** not reachable by a dApp. Upstream's contract store files every artifact under its own recomputed class id, first write wins (`@aztec-labs/pxe` 6.0.0-rc.1, `contract_store.js:85-95`), so the PXE-local lookup cannot return a different artifact for a cached id.
- **Call:** recorded as a lead for the final report with both arguments. The cache is not touched here; any change to it is a behaviour change.
