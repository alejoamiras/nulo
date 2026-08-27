# bridge-hardening

Hardening arc for the faucet→bridge contracts (`contracts/bridge/{evm,aztec}`): land the
blackhat PoC suite, fix its two actionable findings, then add fuzz/property coverage and a
time-boxed symbolic-formal pass.

## Provenance

Adversarial audit session against the pre-production bridge contracts. Method: full read of
every contract + deploy conductor, then exploit PoCs written as forge tests. Two findings were
actionable (H-1, M-1); the rest either proved defenses hold or are informational.

## Findings summary (full detail in [audit-blackhat.md](./audit-blackhat.md))

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| H-1 | High (conditional) | Portal first-initialization front-runnable → brick + drain if poisoned address published | Fix: constructor-init (Arc 2) |
| M-1 | Medium | `_validateRoute` accepts `{X/native},{native/FJ}` which Case-C settlement cannot pay | Fix: delta-driven settlement (Arc 3) |
| L-1..L-5 | Low/info | signable zero slippage, FoT DoS, migration sig invalidation, Permit2 allowance hardwire, zero-recipient mint | Documented; frontend/ops mitigations exist |

L-5 (`claim_public` accepts a zero recipient) stays accepted for this arc. An in-contract guard
changes TokenBridge bytecode, hence its class id and deployed address, which strands the faucet's
committed manifests until a redeploy — and the redeploy is out of scope here. It ships as its own
`fix(bridge)` PR sequenced with that redeploy. `claim_private` and both exit paths already carry
their own zero-recipient guards; only the public claim is exposed, and only to a caller who
supplies a valid L1 message naming the zero address as recipient.

Independently verified sound: content-hash keystone (re-derived from first principles:
`sha256(selector ++ args) >> 8`), witness binding + nonces, delta-based accounting vs
donations, reentrancy posture, sole-consumer invariant, recipient-committed claim secret.

## Arcs (each = one stacked PR via gh stack)

### Arc 1 — blackhat tests land (`test`)
- `contracts/bridge/evm/test/BlackhatAudit.t.sol` (8 unit PoCs) +
  `test/BlackhatV4Fork.t.sol` (4 tests vs real Sepolia V4 PoolManager).
- `foundry.toml`: `allow_paths` + `@aztec-blob-lib` remap so the [F-A] PoC compiles the REAL
  upstream portal in-project.
- Gate: hermetic `forge test` green (50+ pass); RPC-gated tests follow the `vm.skip` convention.

### Arc 2 — H-1 fix: deployer-only initializer guard (`fix`)
- DEVIATION from the approved constructor-init, discovered during implementation: a portal
  constructor would need the L2 bridge address, but that address is deterministically derived
  FROM the deployed portal address (bridge ctor args = [proxy, portal]) — circular. The
  equivalent fix: the constructor pins `msg.sender` as an immutable `initializer`, and
  `initialize` reverts `NotInitializer` for anyone else. The front-run dies; both conductors'
  two-phase flow survives unchanged.
- Bytecode changed → `FORKED_PORTAL_KECCAK` + `PORTAL_PIN` + `NuloTokenPortal.build.json`
  regenerated via `build-portal-artifact.ts`; conductors gained a same-key resume note.
- Regression proof: `ContentHash.t.sol` + Noir keystone stay green UNTOUCHED (message hashes are
  storage-independent); [F-A] PoC flipped to assert the attack now reverts.

### Arc 3 — M-1 fix: delta-driven settlement (`fix`)
- `UniswapFuelSwap._settle` Cases A/B/C → accumulate per-hop `(currency, int128)` deltas from
  PM's returned BalanceDeltas → take positives → unwrap WETH→ETH only if native owed → settle.
  Mid-native handoffs net to zero (no-op); mid-WETH shapes untouched; the hostile shape becomes
  correct-or-cleanly-reverted. Validation unchanged.
- Tests: existing route/settlement suites stay green; previously-hostile shape added as a
  behaving case; [F-G] kept as regression.

### Arc 4 — fuzz + property hardening (`test`)
- Router: Foundry invariant suite with handler (bridge/sweep/setSwapTarget/donate sequences):
  nothing at rest beyond donations; deposits == pulled − swapped.
- Swap: route-grammar fuzzer on `_validateRoute` (hermetic) + settlement fuzz behind the
  `SEPOLIA_RPC_URL` skip-gate.
- Portal: content-hash roundtrip fuzz (random inputs ↔ captured inbox hash ↔ withdraw
  reconstruction).
- Noir: nargo built-in fuzzing on pure libs (`claim_secret`, content-hash) via pinned
  `aztec-nargo`; contract-level behavior stays with keystone pins + sandbox smoke (scope limit).

### Arc 5 — formal, last, research-first (`test`, NIT)
- Phase A: survey EVM symbolic tools (Halmos / Certora / Kontrol) for solc 0.8.28 + via-ir fit;
  time-boxed half day; choice + rationale recorded in `lessons/`.
- Phase B: prove "router net balance change == 0 on any successful bridge*" and "no token
  movement without a valid witness". Cut and document if the tool fights past the box.

## Validation gates

Per arc: full `forge test` in `contracts/bridge/evm` (hermetic set must be green; fork-gated
tests need `SEPOLIA_RPC_URL`). Noir keystone via pinned toolchain:
`AZTEC_HOME=~/.aztec/versions/5.0.1 bin/aztec-nargo test` in `contracts/bridge/aztec/keystone`.
PR titles ≤93 chars budgeting the squash `(#NN)` suffix; conventional commits, lowercase subject.

## Environment notes

- v4-core MUST be installed at `@v4.0.0` (README pin); latest moves structs and breaks the build.
- `SwapBridgeRouterPermit2Fork` positive flows require maintained testnet state (live pools/
  balances); they fail against fresh public-RPC forks. Replay/tamper/deadline variants pass anywhere.
