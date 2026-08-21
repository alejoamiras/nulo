# Arc 9 — TXE testing: what works, and every gotcha on the way

The TokenBridge now has a 16-test TXE suite (`token_bridge/src/test/`, runner:
`contracts/bridge/aztec/scripts/run-txe-tests.sh`) covering claim_public/claim_private happy
paths, the F-007 recipient-commitment redirect rejection, wrong-secret/salt, pause gates,
nullifier replay, zero-amount, proxy mint guards (incl. owner-has-no-mint-power), single-shot
`set_bridge`, and both exits with real authwits.

## The invocation that actually works

```bash
# terminal 1 (or let run-txe-tests.sh do it)
node node_modules/@aztec/txe/dest/bin/index.js        # TXE oracle server, port 8080
# terminal 2
aztec-nargo test --force --oracle-resolver http://127.0.0.1:8080 \
  env NARGO_FOREIGN_CALL_TIMEOUT=1200000
```

## Gotchas (each cost real time)

1. **aztec-nargo alone cannot run TXE tests**: its test runner returns
   `0 output values were provided as a foreign call result for N destination slots` for EVERY
   oracle. TXE is a separate HTTP server (`@aztec/txe`); nargo connects via `--oracle-resolver`.
   Upstream CI: `noir-projects/scripts/run_test.sh` sets exactly this flag.
2. **Run the server under NODE, never bun** — native lmdb bindings crash bun silently.
3. **`NARGO_FOREIGN_CALL_TIMEOUT` must be raised** (upstream CI uses 300000; we use 1200000 ms):
   heavy TXE calls exceed the default and surface as resolver "Out of memory".
4. **Dependency artifacts resolve from THIS package's target/** as
   `<dependency_package_name>-<ContractName>.json`. We stage:
   - `token_minter_proxy-TokenMinterProxy.json` ← sibling crate's committed artifact
   - `token_bridge_contract-TokenBridge.json` ← own committed artifact
   - `token_contract-Token.json` ← **transpiled** artifact shipped by the npm package
     `@aztec-foundation/aztec-standards` (already a dep of bridge-core). Note the package name
     is `token_contract` even though our Nargo.toml aliases it `token`.
5. **Artifacts must be AVM-transpiled**: plain `nargo compile` output is rejected with
   "Contract's public bytecode has not been transpiled". Only `aztec compile` (or the
   foundation artifacts package) produces deployable bytes.
6. **v5.0.1 standards Token ctor arity**: `constructor_with_minter(name: str<31>,
   symbol: str<31>, decimals: u8, minter, auth_contract)` — 5 args; strings are EXACTLY 31 chars.
7. **Authwit direction for exits**: the token sees msg_sender == PROXY, so public exits need
   `add_public_authwit_from_call(env, user, proxy, Token.burn_public(...))`; private exits use
   `add_private_authwit_from_call` likewise.
8. **nargo caches aggressively**: after editing test modules, ALWAYS run with `--force`, else a
   stale success silently reports 0/N tests.
9. `should_fail` tests pass VACUOUSLY if any earlier step reverts — when a suite goes green,
   re-check that positive-path tests exist for the same behavior (they do here).
10. Private-balance assertions need `create_contract_account()` recipients (full key set) +
    `env.execute_utility(Token::at(t).balance_of_private(addr))`.

## Fuzzing

nargo auto-fuzzes parameterized `#[test]` fns (randomized args per run) — the keystone crate
uses this for `derive_claim_secret` neighbor-injectivity. TXE fns can take fuzzed params the
same way once the harness runs.
