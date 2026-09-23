## Findings

### 1. L1 chain and client bootstrap is copied across twelve operational scripts

**Smell:** **Duplicate Code**, producing **Shotgun Surgery**. The same `defineChain` descriptor and `createPublicClient`/`createWalletClient` wiring is owned independently by each conductor.

**Impact bucket:** **Structural** — 12 operational entrypoints. Change frequency ranges from 1–9 commits per file. The 5.0/5.0.1 dependency upgrades already changed 9 eligible scripts together, demonstrating the blast radius.

**Evidence:** Six scripts repeat the same Sepolia descriptor, four repeat the same Ethereum descriptor, and the remaining two repeat the same shape for sandbox or historical Sepolia access. All twelve then construct equivalent viem clients from the locally defined chain and RPC URL.

**Why it harms future change:** Introducing a shared transport policy—fallback RPCs, retries, timeouts, batching—or changing chain metadata requires finding and editing every conductor. Missing one leaves an operational command using a different environment policy; the dependency-upgrade history shows these coordinated edits are recurring rather than hypothetical.

**Smallest safe refactoring:** **Extract Function** into an operational helper such as `createL1Clients({ network, rpcUrl, account? })`. Keep network-specific account/key validation in each conductor. The repeated chain descriptors, viem construction, and associated `defineChain` imports disappear.

**Instances:**

Chain descriptors:

- [smoke-existing-mainnet.ts:69-74](packages/bridge-core/scripts/smoke-existing-mainnet.ts:69)
- [discover-mainnet-fuel.ts:42-47](packages/bridge-core/scripts/discover-mainnet-fuel.ts:42)
- [fpc-dust-canary-mainnet.ts:60-65](packages/bridge-core/scripts/fpc-dust-canary-mainnet.ts:60)
- [deploy-bridge-mainnet.ts:94-99](packages/bridge-core/scripts/deploy-bridge-mainnet.ts:94)
- [restore-swap.ts:45-50](packages/bridge-core/scripts/restore-swap.ts:45)
- [deposit-testnet.ts:52-57](packages/bridge-core/scripts/deposit-testnet.ts:52)
- [fee-juice-canary-testnet.ts:54-59](packages/bridge-core/scripts/fee-juice-canary-testnet.ts:54)
- [smoke-swap-existing-testnet.ts:59-64](packages/bridge-core/scripts/smoke-swap-existing-testnet.ts:59)
- [smoke-existing-testnet.ts:58-63](packages/bridge-core/scripts/smoke-existing-testnet.ts:58)
- [fuel-testnet.ts:63-68](packages/bridge-core/scripts/fuel-testnet.ts:63)
- [deploy-bridge-testnet.ts:87-92](packages/bridge-core/scripts/deploy-bridge-testnet.ts:87)
- [deploy-sandbox.ts:52-57](packages/bridge-core/scripts/deploy-sandbox.ts:52)

Public-client construction:

- [smoke-existing-mainnet.ts:90](packages/bridge-core/scripts/smoke-existing-mainnet.ts:90)
- [discover-mainnet-fuel.ts:48](packages/bridge-core/scripts/discover-mainnet-fuel.ts:48)
- [fpc-dust-canary-mainnet.ts:96](packages/bridge-core/scripts/fpc-dust-canary-mainnet.ts:96)
- [deploy-bridge-mainnet.ts:194](packages/bridge-core/scripts/deploy-bridge-mainnet.ts:194)
- [restore-swap.ts:51](packages/bridge-core/scripts/restore-swap.ts:51)
- [deposit-testnet.ts:87](packages/bridge-core/scripts/deposit-testnet.ts:87)
- [fee-juice-canary-testnet.ts:84](packages/bridge-core/scripts/fee-juice-canary-testnet.ts:84)
- [smoke-swap-existing-testnet.ts:82](packages/bridge-core/scripts/smoke-swap-existing-testnet.ts:82)
- [smoke-existing-testnet.ts:81](packages/bridge-core/scripts/smoke-existing-testnet.ts:81)
- [fuel-testnet.ts:98](packages/bridge-core/scripts/fuel-testnet.ts:98)
- [deploy-bridge-testnet.ts:175](packages/bridge-core/scripts/deploy-bridge-testnet.ts:175)
- [deploy-sandbox.ts:122](packages/bridge-core/scripts/deploy-sandbox.ts:122)

Wallet-client construction, where required:

- [smoke-existing-mainnet.ts:89](packages/bridge-core/scripts/smoke-existing-mainnet.ts:89)
- [fpc-dust-canary-mainnet.ts:95](packages/bridge-core/scripts/fpc-dust-canary-mainnet.ts:95)
- [deploy-bridge-mainnet.ts:193](packages/bridge-core/scripts/deploy-bridge-mainnet.ts:193)
- [deposit-testnet.ts:86](packages/bridge-core/scripts/deposit-testnet.ts:86)
- [fee-juice-canary-testnet.ts:83](packages/bridge-core/scripts/fee-juice-canary-testnet.ts:83)
- [smoke-swap-existing-testnet.ts:81](packages/bridge-core/scripts/smoke-swap-existing-testnet.ts:81)
- [smoke-existing-testnet.ts:80](packages/bridge-core/scripts/smoke-existing-testnet.ts:80)
- [fuel-testnet.ts:97](packages/bridge-core/scripts/fuel-testnet.ts:97)
- [deploy-bridge-testnet.ts:174](packages/bridge-core/scripts/deploy-bridge-testnet.ts:174)
- [deploy-sandbox.ts:121](packages/bridge-core/scripts/deploy-sandbox.ts:121)

---

### 2. The two PrivateFPC deployers duplicate the invariant-bearing deployment conductor

**Smell:** **Duplicate Code**. Network-specific account and fee preparation differ, but the elapsed timer, pinned-instance check, canonical deployment, address assertion, and completion handling are duplicated.

**Impact bucket:** **Structural** — 2 live deployment entrypoints and their shared deployment invariant. Change frequency: testnet file 3 commits; mainnet file 1 commit.

**Evidence:** Both scripts independently:

1. Start the same elapsed timer.
2. Create the node client and canonical pinned address.
3. Return early if the contract already exists.
4. Deploy `PrivateFPCContract` using `PRIVATE_FPC_SALT` and `universalDeploy: true`.
5. Assert the resulting address equals `PRIVATE_FPC_ADDRESS`.
6. Log completion.

Only the account and fee setup in the middle is substantively network-specific.

**Why it harms future change:** An artifact API change, canonical deployment-option change, or stronger post-deploy assertion must be applied identically to both live-network commands. These are precisely the invariants where silent divergence is expensive: one command could deploy or validate a different canonical instance.

**Smallest safe refactoring:** **Extract Function**—or Fowler’s **Form Template Method** pattern expressed with functions—into `deployCanonicalPrivateFpc({ node, prepareDeployment })`. The callback supplies `{ wallet, from, fee }`; the helper owns the idempotency check and canonical deploy/assert sequence. The duplicated invariant-bearing conductor disappears while fee setup remains separate.

**Instances:**

- Timer: [deploy-private-fpc-mainnet.ts:26-27](packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:26), [deploy-private-fpc-testnet.ts:25-26](packages/bridge-core/scripts/deploy-private-fpc-testnet.ts:25)
- Node, pin, and idempotency check: [deploy-private-fpc-mainnet.ts:28-34](packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:28), [deploy-private-fpc-testnet.ts:27-33](packages/bridge-core/scripts/deploy-private-fpc-testnet.ts:27)
- Canonical deployment and address assertion: [deploy-private-fpc-mainnet.ts:58-70](packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:58), [deploy-private-fpc-testnet.ts:61-73](packages/bridge-core/scripts/deploy-private-fpc-testnet.ts:61)
- Entrypoint invocation: [deploy-private-fpc-mainnet.ts:74](packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:74), [deploy-private-fpc-testnet.ts:76](packages/bridge-core/scripts/deploy-private-fpc-testnet.ts:76)

---

### 3. The pre-v2 record-sealing API remains as test-only production code

**Smell:** **Dead Code**, with residual **Duplicate Code**. `sealRecordSecret` and `openRecordSecret` are the superseded bare-secret API; `sealDepositRecord` and `openDepositRecord` now implement the production v2 envelope flow and repeat the key derivation/self-test structure.

**Impact bucket:** **Local** — one production module and its unit test, with two stale names still exposed through the package barrel. Change frequency: `recovery-crypto.ts` has 5 commits.

**Evidence:**

- Dead implementations: [recovery-crypto.ts:72-86](packages/bridge-core/src/recovery-crypto.ts:72), [recovery-crypto.ts:89-95](packages/bridge-core/src/recovery-crypto.ts:89)
- Current production replacements: [recovery-crypto.ts:171-189](packages/bridge-core/src/recovery-crypto.ts:171), [recovery-crypto.ts:193-200](packages/bridge-core/src/recovery-crypto.ts:193)
- The only call sites of the legacy functions are tests: [recovery-crypto.test.ts:89-99](packages/bridge-core/src/recovery-crypto.test.ts:89)
- Production consumers use `sealDepositRecord`: [useDeposit.ts:786](apps/faucet/src/composables/useDeposit.ts:786), [useFuel.ts:146](apps/faucet/src/composables/useFuel.ts:146)
- Repository-wide production reference search found no caller of either legacy symbol. `bridge-core` has no component/composable auto-registration; [index.ts:18](packages/bridge-core/src/index.ts:18) is only a static wildcard export and does not invoke or register them. The package is also marked private in [package.json](packages/bridge-core/package.json).

**Why it harms future change:** Changes to signature normalization, recovery messaging, or the deterministic-signature self-test invite edits to both the live v2 implementation and an obsolete parallel implementation. Its passing tests can falsely suggest that the bare-secret format remains supported, despite `openDepositEnvelope` explicitly rejecting non-v2 blobs.

**Smallest safe refactoring:** **Inline/Delete Dead Code**: remove `sealRecordSecret` and `openRecordSecret`, then delete their test-only cases and imports. `sealSecret`/`openSecret` remain because backup and v2 envelope code actively use them. The stale bare-secret API and duplicated self-test path disappear.

**Instances:**

- [recovery-crypto.ts:72](packages/bridge-core/src/recovery-crypto.ts:72) — `sealRecordSecret`
- [recovery-crypto.ts:89](packages/bridge-core/src/recovery-crypto.ts:89) — `openRecordSecret`

## Non-findings

- `wallet-bridge/src/fee.ts` versus `bridge-core/src/fee-juice.ts`: wire serialization types and Aztec domain computation are separate responsibilities, not duplicated logic.
- `claim-secret.ts` versus `private-fuel.ts`: the similar Poseidon wrappers deliberately preserve different protocol domain separators and toolchain pins; merging them would weaken those boundaries.
- `deploy-bridge-{testnet,mainnet}.ts` and `smoke-existing-{testnet,mainnet}.ts`: they share a broad lifecycle, but their current bodies contain substantial network-specific sequencing; a single conditional conductor would not yet be a clearly smaller safe design.
- Wallet RPC metadata tables: `method-descriptors.ts` already derives the capability, routing, scope, and operation maps from one registry, so the apparent parallel tables are generated views rather than duplicate ownership.
- `wallet-sdk-schema-patch`: its small side-effect entrypoint is required by import ordering and centralizes a former three-way duplication; it is neither a Lazy Class nor redundant boilerplate.