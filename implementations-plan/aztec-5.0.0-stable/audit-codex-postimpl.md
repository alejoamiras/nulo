REJECT — the KDF and current PrivateFPC identity are coherent, but the deployment gates remain bypassable and include a critical shell-injection path.

### 1. Derivation helper

No merge-blocking finding.

I tried arbitrary `Fr` inputs, boundary/serialization divergence, helper/fixture circularity, stored-key recovery, and PXE registration mismatch:

- The implementation is the frozen straight-line chain with no input-dependent branches: `sha512ToGrumpkinScalar([seed, IVSK_M])`, then upstream `deriveSecretKeyFromSigningKey` in [account-derivation.ts:29](packages/wallet-crypto/src/account-derivation.ts:29). A typed `Fr` gives one canonical serialization for every accepted input.

- The vectors are non-tautological with respect to repository code. They are frozen JSON generated using published 5.0.0 primitives, and the address oracle uses upstream `getSchnorrAccountContractAddress`, while the test exercises `NuloAccount.new` independently in [derivation-vectors.test.ts:20](packages/aztec-runtime/src/account/derivation-vectors.test.ts:20). An implementation change to the domain separator, ordering, salt, constructor, public keys, or signing/secret inversion would fail.

- Persistent account rows contain only derivation coordinates and address—not seed, signing key, or secret key—in [spec.ts:15](apps/extension/src/wallet/services/account/spec.ts:15). The PXE seam sends only the privacy `secretKey`, expanding it to the upstream privacy-key structure in [service.ts:286](packages/aztec-runtime/src/pxe/service.ts:286). The signing key necessarily exists in memory inside the Schnorr signer/auth-witness provider, but does not cross the PXE seam.

- `ensureRegistered` fails closed when a newly registered PXE account returns a different address in [nulo-account.ts:78](packages/aztec-runtime/src/account/nulo-account.ts:78). Re-deriving an existing stored account also compares the derived address to storage before returning it.

### 2. OPFS store ownership

The normal close lifecycle is sound. Timeout-losing opens are eventually closed, stamp failures close, post-open factory failures close, and the runtime owns the success path in [opfs-store.ts:45](packages/aztec-runtime/src/pxe/opfs-store.ts:45) and [chain-runtime.ts:133](packages/aztec-runtime/src/pxe/chain-runtime.ts:133). `pxe.stop()` already closes the injected database, but the subsequent `store.close()` is harmless on the installed store because close is idempotent.

Findings:

- **Medium — FOLLOW-UP; D3 does not block this pre-production merge.** [chain-runtime.ts:280](packages/aztec-runtime/src/pxe/chain-runtime.ts:280) destroys an RPC-mismatched runtime while `withPxeRead` holds only the chain read lock. Reader A can still be using the old runtime; reader B deletes and awaits its disposal; reader C observes no runtime and starts opening the same SAH directory before B releases it. Because `initPromises` is keyed only by chain, B can then inherit C’s stale-URL initialization. Endpoint rebinding needs the chain write lock.

- **High — FOLLOW-UP for this merge; BLOCKS any user-bearing release. D4 is confirmed.** The key provider can capture the profile master immediately before deletion, finish HKDF after the tombstone/purge, and call unguarded [provisionChainStoreKey:596](packages/aztec-runtime/src/pxe/service.ts:596). The retry in [client.ts:88](packages/aztec-runtime/src/pxe/client.ts:88) can then recreate the deleted runtime and OPFS store. A barrier alone is insufficient unless it is paired with a deletion generation/tombstone fence.

- **Medium — FOLLOW-UP; D6 is confirmed.** [clearProfileState:558](packages/aztec-runtime/src/pxe/service.ts:558) always removes the barrier from the map, including after purge failure. Readers queued on the old barrier resume after `leaveWrite`, while retry/new work obtains a different barrier. Those operations are no longer mutually exclusive and can recreate state during a retry.

- **Medium — FOLLOW-UP; D7 is confirmed.** [removeChainStoreDir:163](packages/aztec-runtime/src/pxe/opfs-store.ts:163) checks whether the profile directory is empty and then recursively removes it. A sibling-chain open can create a directory between those operations, causing deletion of the new sibling or a lock-related purge failure. Remove the empty-directory sweep or coordinate it under a profile-level write lock.

- **High — FOLLOW-UP for this merge; BLOCKS production. D11 is confirmed.** After five minutes, [rw-guard.ts:132](packages/wallet-core/src/utils/rw-guard.ts:132) sets `readers = 0` during a legitimate long proof. When the proof finishes, its `finally` decrements the count to `-1`. Subsequent readers can run with a zero count, and writers can enter concurrently. This makes profile deletion overlap later PXE work and invalidates the protection around encrypted-store close/purge.

- **Medium — FOLLOW-UP.** [ChainRuntime.dispose:93](packages/aztec-runtime/src/pxe/chain-runtime.ts:93) swallows every `pxe.stop()` failure and then force-closes the store. If stop failed before draining the job queue or stopping synchronization, the worker is terminated with pending operations and endpoint rebinding proceeds as though teardown succeeded. Close should remain in `finally`, but the stop failure should be propagated.

- **Medium — FOLLOW-UP.** [opfsRoot:128](packages/aztec-runtime/src/pxe/opfs-store.ts:128) converts every OPFS exception into “no store exists.” A transient `UnknownError`, permission failure, or storage corruption therefore makes chain/profile purge report success while encrypted bytes remain. Only unsupported APIs and `NotFoundError` should be treated as absence.

Given the stated no-user/fresh-install conditions, none of D3/D4/D6/D7/D11 independently blocks this merge. D4 and D11 must be fixed before production.

### 3. Deployment-intent tooling

- **Critical — BLOCKS merge. Command injection is confirmed.** [live-intent.ts:58](packages/bridge-core/scripts/live-intent.ts:58) interpolates arguments into an `execSync` shell command. During build, node-returned `rollupAddress` and `feeJuicePortalAddress` are inserted without runtime validation at [live-intent.ts:107](packages/bridge-core/scripts/live-intent.ts:107), while `PRIVATE_KEY` is present in the inherited environment. A compromised RPC can return an address containing shell metacharacters and execute commands that exfiltrate the key. The schema-validated candidate addresses are regex-safe; node identity, raw intent values, RPC URLs, and the private key are not. Use `execFileSync`/`spawnSync` with an argument array and validate all RPC fields.

- **High — BLOCKS merge. The spend caps are not enforced.** `CAPS` is recorded at [live-intent.ts:32](packages/bridge-core/scripts/live-intent.ts:32), but verify only reads the current signer balance and prints the cap at [live-intent.ts:258](packages/bridge-core/scripts/live-intent.ts:258). There is no starting balance, spend delta, broadcast wrapper, or `WETH_SEED` comparison. `DeployFuelLive` accepts an unrestricted environment override at [DeployFuelLive.s.sol:113](contracts/bridge/evm/script/DeployFuelLive.s.sol:113). A 10 ETH seed or >0.5 ETH aggregate spend still produces “verify green.”

- **High — BLOCKS merge. The source, signer, and digest gate is mutable and bypassable.** Verify parses the intent with a TypeScript assertion, not a schema, at [live-intent.ts:188](packages/bridge-core/scripts/live-intent.ts:188). It never compares `git rev-parse HEAD` to `intent.source.commit`; the committed intent records `8dccc9a…` at [intent.json:42](implementations-plan/aztec-5.0.0-stable/lessons/intent.json:42), while audited HEAD is `06885be…`, yet the gate accepts a clean tree. The entire lessons directory—including the intent—is allowlisted at [live-intent.ts:89](packages/bridge-core/scripts/live-intent.ts:89), so expected digests and signer can be edited without tripping the dirty check. The signer re-check is also skipped when `PRIVATE_KEY` is absent at [live-intent.ts:212](packages/bridge-core/scripts/live-intent.ts:212), confirming the prior reviewer’s concern.

- **High — BLOCKS merge. Candidate verification is largely self-consistency, not authoritative identity.** `--candidate` is optional, and an absent digest is learned from the first candidate presented at [live-intent.ts:225](packages/bridge-core/scripts/live-intent.ts:225). Readbacks ask candidate-provided contracts for values and compare them to candidate-provided values; they do not bind portal/asset/handler/router addresses to fresh node identity or pinned deployment inputs. An internally consistent malicious contract set owned by the signer passes. L2 addresses/classes are not rederived, and the stored PrivateFPC digest is never rechecked during verify. [candidate-schema.ts:31](packages/bridge-core/src/candidate-schema.ts:31) provides good shape validation, but no semantic authentication.

The build-time signer check against the hard-coded plan signer is sound; the verify-stage re-check is not.

### 4. PrivateFPC descriptors

The current salt is coherent: bridge constants and descriptor use `1`, extension derivation and discovery share `PRIVATE_FPC_PARAMS`, and deploy/canary rebuilds use `PRIVATE_FPC_SALT`. Runtime private-fuel flows also reject recipients other than the pinned address.

However, the fund-loss gate is not fully closed:

- **High — BLOCKS merge. Upgraded contracts pass the gate.** [check-fpc-version.ts:102](packages/bridge-core/scripts/check-fpc-version.ts:102) compares only `originalContractClassId`. If the pinned instance is upgraded, its original class remains correct while `currentContractClassId` points to incompatible or malicious code; the gate prints green and deposits can be consumed or stranded by the current implementation. Require original and current class IDs to equal the expected class, or explicitly reject any upgrade.

- **Medium — BLOCKS merge as part of the fund-moving gate.** The RPC helper at [check-fpc-version.ts:45](packages/bridge-core/scripts/check-fpc-version.ts:45) does not require a `result` field. A malformed response with neither `result` nor `error` becomes `undefined`, and `node_getContract` is reported as clean absence at line 116. This contradicts the advertised “RPC failure is RED” property.

- **Medium — BLOCKS merge as operational hardening.** The gate compares the descriptor address to the exported address at [check-fpc-version.ts:80](packages/bridge-core/scripts/check-fpc-version.ts:80), but does not rederive that address from the installed artifact, salt, and zero deployer. If descriptor and constant are coherently changed to an arbitrary absent address, version and digest checks still pass. The independent test in [private-fuel.test.ts:84](packages/bridge-core/src/private-fuel.test.ts:84) would catch this in CI, but the claimed standalone pre-funds gate would not.

- **Low — FOLLOW-UP.** The extension has no known-address test tying its `new Fr(1n)` rebuild to the bridge pin. The two extension rebuild sites now share one constant in [fpc/service.ts:42](apps/extension/src/wallet/services/fpc/service.ts:42), so the current bug is fixed, but a cross-layer regression remains possible. Also, [deploy-private-fpc-testnet.ts:2](packages/bridge-core/scripts/deploy-private-fpc-testnet.ts:2) still documents salt zero, and its early-existence path does not validate the live class.

### Other

- **Low — FOLLOW-UP.** The test named “error names both got + expected wallet chainId” still uses stale values in its regex at [chain-guard.test.ts:55](scripts/release/chain-guard.test.ts:55). It can pass by matching only the supplied bad value even if the error omits the new expected `1816023401`. Other tests do correctly pin the new constants.

- **Low — FOLLOW-UP.** [contracts/bridge/aztec/README.md:8](contracts/bridge/aztec/README.md:8) still instructs operators to use the rc.2/4.2 toolchain, while the compile script requires 5.0.0. The script fails safely, but the documentation is operationally misleading.

### Looks correct

- KDF v1 composition, address construction, frozen vectors, and seed/signing-key isolation.
- Mandatory explicit encrypted store injection and normal SAH-lock close ownership.
- Strict candidate manifest syntax and unknown-field rejection.
- Current PrivateFPC salt/address/artifact coherence and exact recipient enforcement.
- FeeJuice setup-vs-app claim phase correction.
- New rollup, wallet chain, portal, and backup epoch pins.

`git diff --check origin/dev...HEAD` is clean. Focused Vitest suites were attempted but could not start because the read-only mount prevents Vitest from creating `.vite-temp` and temporary transform directories; no test assertions executed.
---

## Resolution (folded 2026-07-14, commits 63541a2 + earlier review pass 06885be)

Codex session `019f6234-bfc9-7923-8adb-8efecd8e26d1` (gpt-5.6-sol, xhigh). Verdict REJECT → all merge-blockers addressed:

- **Command injection (Critical)** → `cast()` switched to `execFileSync` argv (no shell) + node-address validation. Live-re-verified green.
- **Caps not enforced (High)** → `startingBalanceEth` baseline recorded at build; verify hard-stops on `baseline - now > cap`. Live: `spend 0.233366/0.5 ETH`.
- **Mutable gate anchor (High)** → verify requires `intent.json` committed once it carries a candidate digest.
- **FPC upgraded-contract hole (High)** → gate requires `original == current == expected` class. Live: green (`original == current`).
- **FPC RPC-result / rederivation (Medium×2)** → malformed response throws; address re-derived from artifact+salt and bound to the pin.
- **Chain-guard test regex + README/deploy-script docs (Low)** → fixed.

Deferred (codex-confirmed acceptable pre-production; D4/D11 before production) → tracked in issue #281:
D3/D4/D6/D7/D11 OPFS profile-delete + rw-guard concurrency, plus dispose stop-failure propagation and opfsRoot error-vs-absence. These touch barrier/lock-ordering with deadlock blast radius and warrant their own plan.

The KDF derivation helper and the current PrivateFPC salt/address/artifact coherence were audited CLEAN (no merge-blocking finding).
