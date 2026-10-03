# Arc 8, execution-guards: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh) and an Opus pass both returned REVISE.** Both found the design sound: every guard, its order, its error bytes and its position before the effect are preserved. All findings were adopted (see the batch plan's Decisions). The two that changed the test plan:
  - **An absent name cannot reach S1's guard.** `FunctionCall.schema` requires `name`, so S1 pins today's schema refusal instead. S6's wire input falls back to `null`, so its required-name policy is pinned through a direct `bindOptimizableCalls` call.
  - **`toThrowError("text")` is a substring match in Vitest 4.** Every refusal row now captures the rejection and compares `message` with `toBe`, with the constructor asserted apart.
- **The registry cache lead is split between the legs** and recorded under Decisions with both arguments. It is not touched.

## Build

- **Phase 1** passed on the unchanged code. It has 10 test files: 8 edited and 2 new (`service.authwit-binding.test.ts` with real hashing in the node environment, and `service.class-id.test.ts`, bb-free and mocked at the module boundary).
- **The mocks had to go.** `dapp-send-executor.test.ts` and `view-executor.test.ts` mocked `assertLiveChainIdentity` at the module boundary, and their fixtures did not match (stored `chainId: 7`, no `l1ChainId`, live `(1, 2)`). A site calling `liveChainInfo` reaches the real check through a same-module reference, which the mock cannot intercept. Both harnesses now carry a matching pair: stored `l1ChainId: 1`, live `rollupVersion: 6`, composite 7.
- **A fixture was signed.** `batched-view-mixed-arm.pins.test.ts` built its drifted stored id as `STORED_CHAIN_ID ^ 1`, which is negative (`-156673112`); it is unsigned now (`>>> 0`). The refusal it tests is unchanged.
- **The NO_FROM success control needs number gas limits.** `GasSettings.fallback` divides limits by fees, and the shared fixture's bigint `txsLimits` throws a mixed BigInt/number `TypeError` there.
- **One path stays unpinned on its own.** The provided-artifact path of the two registrations is not pinned separately, because the real `ContractArtifactSchema` rejects any fixture artifact. The class-id check sits on the same line whichever source the artifact came from; both lookup paths are pinned.
- **Phase 2** touched no test file: the diff between the phase commits lists no `*.test.ts`.

## Mutation check

- **Method:** 31 mutants, each applied alone after the Phase 2 commit, against the 10 Phase 1 files. Each file was restored from memory, never with git. A kill required at least one test case that ran and failed; a file failing to load would have counted as a non-kill.
- **Result: 31 of 31 killed, none with a load error.** The mutants:
  - `liveChainInfo` swapped for `chainInfoFrom` at each of the 8 sites, one at a time;
  - the early return moved below the fetch at each of the three discovery sites;
  - the probe's `seen` check dropped, and separately its `used` gate;
  - the `!fn` branch removed;
  - each policy flipped;
  - the authwit label changed;
  - the name tested for truthiness;
  - a suffix added to the scope-violation message;
  - the binding call deleted at each of S1 to S6;
  - the class-id call deleted at C1, and separately at C2;
  - a recompute failure converted to a mismatch;
  - a prefix added to the class-id message;
  - `chainId` and `version` swapped in `chainInfoFrom`.

## Gates

- **Phase 1 head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` all exit 0.
- **Phase 2 head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue` and `build` all exit 0. The build left no change to the generated declaration files.

## Native TypeError names after the moves

A malformed input can make a property access throw a native `TypeError`, and Bun/JSC and Firefox name the variable in its message (V8 often does not). A moved access that malformed data can reach would change that message. Each helper was checked; none needed a change.

- **`liveChainInfo`:** every read of the node pair that can throw sits inside the unchanged `assertLiveChainIdentity`, under its own parameter names. The projection runs only after that check has proven both fields safe integers.
- **`assertSelectorBinding`:** every site dereferences the claim (its selector and target) before the call, so a malformed claim throws there, as before. `fn` is read only past the `!fn` refusal, and the message's template conversions name no variable.
- **`decodeAuthwitEffects`:** every effect access moved with its loop body sits inside the bare `catch` that swallowed it before. Dedupe reads `record.messageHash`, a string the helper built itself.
- **`assertArtifactClassId`:** `expected.toString()` would name `expected` where the site named `instance` only if `currentContractClassId` could be undefined. It cannot on any path:
  - C2 and C1's provided instance are parsed by `ContractInstanceWithAddressSchema`, which requires the field;
  - C1's PXE preimage passes `hydratePreimage`, which sets it from `originalContractClassId`;
  - a node instance passes `assertNotUpgraded`, which reads the field first;
  - a known-bundle instance comes from `getContractInstanceFromInstantiationParams`.

## Local network e2e

Chrome, `NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent`, on the Phase 2 head:

- **Passed (12 tests in 7 files):** `authwit-variants` (4), `authwit-consume-smoke`, `tx-sendTx-default`, `tx-sendTx-noFrom`, `contracts-register`, `sim-methods` (3) and `meta-getChainInfo`.
- **Skipped:** `tx-sendTx-delegated-authwit` skips itself (`skipIf(!hasConfig || !hasStandardContracts)`), because the local sandbox lacks its standard contracts.
- **Left out:** `authwit-lifecycle` carries `@requires-proverless`.
