merge-clean-with-followup

**Test interactions**
- The relevant network coverage is present and looks compatible with the fast path.
  - Token list / balance-projector path: [tokens.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/tokens.test.ts:21) waits only for the loading skeleton to disappear, not for any slow-path-specific sequencing. [send-amount-clamp.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/send-amount-clamp.test.ts:28) and [transfers.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/transfers.test.ts:124) also assert eventual balance visibility/value, not call ordering.
  - Gas-balance / `#computeGasBalances` path: [fee-methods.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/fee-methods.test.ts:180) is the real overlap. It waits for `[data-testid="gas-balance-public"]` and only asserts non-zero eventual text, so fast-routing the public-static arm should not break it.
- The timing-sensitive tests you called out do not overlap the new helper path.
  - [cancel-mid-prove.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/cancel-mid-prove.test.ts:52) is about sendTx proving/cancellation after a mint, not token-balance or gas-balance reads.
  - [concurrency-rapid-fire.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/concurrency-rapid-fire.test.ts:10) is only `getChainInfo` FIFO ordering.
  - [sim-methods.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/sim-methods.test.ts:10) covers dApp-facing `simulateTx/profileTx/executeUtility`, not the internal helper.

**Popup / CI**
- I do not see a merge regression in the popup overlap. `git diff origin/dev..HEAD -- packages/extension/src/popup/windows/execute/index.vue ...discover...` is empty, so your branch is not carrying a stale branch-only copy of those files. Current [execute/index.vue](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/popup/windows/execute/index.vue:71) still has dev’s `initComplete` gate and related guards.
- `discover/index.test.ts` is a self-contained component test for the `isReady` race fix ([index.test.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/src/popup/windows/discover/index.test.ts:2)); it does not intersect your fast-path work.
- The new network workflow is compatible, but it is a new gate your PR now triggers.
  - Path filter includes both `wallet/services/execution/**` and `wallet/services/token-balance/**` in [pr-network-e2e.yml](/Users/alejoamiras/Projects/nulo/nulo-4/.github/workflows/pr-network-e2e.yml:35).
  - Required workload is now 5 shards plus a dedicated heavy `fee-methods` job in [pr-network-e2e.yml](/Users/alejoamiras/Projects/nulo/nulo-4/.github/workflows/pr-network-e2e.yml:91) and [pr-network-e2e.yml](/Users/alejoamiras/Projects/nulo/nulo-4/.github/workflows/pr-network-e2e.yml:134). That heavy split is actually favorable for your gas-balance coverage.

**Probe / patches**
- `_probe-warmup-effect.test.ts` is diagnostic only. It is hard-gated by `NULO_E2E_PROBE=1` in [ _probe-warmup-effect.test.ts ](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/_probe-warmup-effect.test.ts:8) and [ _probe-warmup-effect.test.ts ](/Users/alejoamiras/Projects/nulo/nulo-4/packages/extension/tests/e2e/network/_probe-warmup-effect.test.ts:121), so it does not gate the suite and does not touch your balance/gas paths.
- The new `@aztec/noir-*` patches are package-export fixes only: they add `exports` choosing `node` vs `default` in [noir-acvm patch](/Users/alejoamiras/Projects/nulo/nulo-4/patches/@aztec%2Fnoir-acvm_js@4.2.0.patch:8) and [noirc_abi patch](/Users/alejoamiras/Projects/nulo/nulo-4/patches/@aztec%2Fnoir-noirc_abi@4.2.0.patch:8). `simulateViaNode` itself calls `node.simulatePublicCalls` in upstream wallet-sdk and does not directly import those packages. Indirectly they matter to simulator/prover tooling, but not to your fast-arm call surface.

Follow-up only: expect the PR to satisfy the new `Network e2e` matrix + heavy fee-methods job, since that is now the meaningful integration gate for the gas-balance overlap.