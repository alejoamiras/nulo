# Independent implementation plan

The task should land as exactly two PRs:

- PR‑A: extend open PR #282 on `worktree-aztec-5.0.0-stable`; fix the restore regression and all issue #281 findings; merge to `dev`.
- PR‑B: create a fresh worktree from the resulting `dev`; bump to 5.0.1, migrate standards, update storage/FPC compatibility, deploy and promote new testnet candidates, then merge to `dev`.
- Release: promote `dev → main`, merge the release-please PR, let auto-unstick publish, validate the live faucet and extension, then merge-commit the back-sync.

One pre-broadcast ambiguity must fail closed: the protocol FeeJuice portal can stay, but the app’s `NuloTokenPortal` is init-once and stores the old L2 Bridge address. If “portal stays” means that app portal, it is incompatible with the locked requirement that the L2 Bridge address changes.

## Global concurrency design

The lock order is:

```text
Service worker:
ProfileService façade lock
  └─ commit session/tombstone/secret state
     └─ RELEASE
        ├─ emit typed events
        └─ send offscreen RPC

Offscreen:
profile barrier
  └─ chain guard
     └─ runtime registry / PXE stop-start
        └─ SQLite worker / OPFS SAH handle
```

Hard invariants:

- No event, leaf-service call, offscreen bootstrap, or offscreen RPC while `ProfileService.runExclusive` is held.
- No store-key provider callback from a lock-held emit path.
- No read-to-write lock upgrade: release chain read, acquire chain write, recheck.
- No chain guard may be acquired before its profile barrier.
- No leaf/offscreen lock may call back into `ProfileService`.
- Profile barriers and chain guards are retained for the offscreen process lifetime. Replacing or deleting them would let queued operations escape the purge generation.
- Every profile-scoped PXE request carries an immutable profile-incarnation generation checked after entering the offscreen profile barrier.

---

# PR‑A — Restore regression and issue #281

## Phase A0 — Freeze evidence and reproduce

Start on the existing PR branch and confirm no unexpected user changes:

```bash
git status --short
git rev-parse HEAD
git fetch origin dev
gh pr view 282 --json number,title,headRefName,headRefOid,baseRefName,state,statusCheckRollup
```

Record the issue matrix in `implementations-plan/aztec-5.0.0-stable/lessons/phase-6.md`:

- Restore boot: event emitted under profile façade lock.
- D3: endpoint rebind disposes under chain read lock.
- D4: unbarriered key provisioning and deleted-profile resurrection.
- D6: failed purge removes its barrier.
- D7: empty parent removal races sibling opens.
- D11: forced reader release overlaps 10–30 minute proofs.
- `ChainRuntime.dispose`: stop failures swallowed.
- `opfsRoot`: storage errors misclassified as absence.

Reproduce the three failures independently:

```bash
bun run --cwd apps/extension test:e2e tests/e2e/backup-roundtrip.test.ts

NULO_E2E_PROVERLESS=1 bun run e2e:agent \
  tests/e2e/network/backup-restore-integrity.test.ts \
  tests/e2e/network/backup-migration-roundtrip.test.ts
```

Validation gate:

- Import/finalize succeeds.
- The import-side logs never reach `Started PXE`.
- The waiter is localized to the store-key provider calling `getProfileSecret` while the restore call still owns the profile lock.
- No unrelated baseline regressions are introduced.

## Phase A1 — Make profile notifications post-lock by construction

Change:

- `apps/extension/src/wallet/services/profile/session-manager.ts`
- `apps/extension/src/wallet/services/profile/service.ts`
- `apps/extension/src/wallet/services/profile/session-manager.test.ts`
- `apps/extension/src/wallet/services/profile/service.integration.test.ts`
- `apps/extension/src/wallet/runtime.ts`

Implementation:

1. Remove SessionManager’s externally emitting `onChange` callback. `open`, `close`, refresh, and restore should return a typed transition result instead.
2. Add a typed staged-event result to ProfileService operations. The façade operation:
   - enters `runExclusive`;
   - commits the session/profile state;
   - captures an event record containing only public event data;
   - releases the lock;
   - synchronously calls `emit` before returning to the caller.
3. Apply this uniformly to unlock, lock, profile creation, deletion, passkey recovery, session restore, and `finalizeRestore`; do not patch only the full-backup path.
4. Keep silent restore silent.
5. Move `onProfileDeleted` outside the façade lock as well. Its profile row and session must already be gone before the event is published.
6. Audit all `this.emit(...)` calls in `profile/service.ts`; none may remain lexically inside a `runExclusive` callback.
7. Preserve event ordering: session state commits first, then lock release, then active-profile event, then the next queued façade waiter can make progress.

Tests:

- An active-profile listener that immediately calls `getProfileSecret` completes.
- `finalizeRestore` plus the same listener completes without a timeout.
- Rapid `open → close → open` transitions emit once each and in commit order.
- Silent restore emits nothing.
- Delete listeners observe no active session or profile row.
- Errors before commit emit nothing.

Phase gate:

```bash
bun run --cwd apps/extension test \
  src/wallet/services/profile/session-manager.test.ts \
  src/wallet/services/profile/service.integration.test.ts
```

## Phase A2 — Add a real deletion-generation fence

Change:

- `apps/extension/src/wallet/services/profile/spec.ts`
- `apps/extension/src/wallet/services/profile/service.ts`
- `apps/extension/src/wallet/services/profile/profile-deletion-state.ts`
- `apps/extension/src/wallet/services/profile/tombstone-repository.ts`
- `apps/extension/src/wallet/services/profile-deletion/types.ts`
- `apps/extension/src/wallet/services/profile-deletion/coordinator.ts`
- `apps/extension/src/wallet/runtime.ts`
- `apps/extension/src/wallet/services/pxe/client.ts`
- `packages/aztec-runtime/src/pxe/{client,spec,descriptors,chain-runtime,service}.ts`

### Profile incarnation

Add an internal `pxeGeneration` field to stored `Profile` rows, not to `ProfileInfo` or exported backup metadata.

- Use a cryptographically random 128-bit or stronger value.
- New profile/import/restore operations assign a fresh value.
- On startup, backfill legacy rows before restoring a session.
- Copy it into the durable deletion tombstone so a resumed purge sends the original generation.
- An old tombstone without the field is upgraded under the façade lock before purge resumes.
- A successor with the same profile ID always receives a different generation, even if it restores the same master secret.

Keep the existing numeric deletion epoch for SW-side leaf-write fencing. The incarnation generation is the cross-process/offscreen fence.

### Client request lease

Add a profile-lease provider with two operations:

- `captureGeneration(profileId)` — checks active, unlocked, non-reserved profile and returns its persisted `pxeGeneration` under the façade lock.
- `deriveStoreKey(profileId, expectedGeneration)` — under the same lock verifies the expected generation, copies the master material, releases, derives the key, and zeroizes temporary master bytes.

For each PXE network request:

1. Capture generation before sending.
2. Copy it into transient `NetworkInfo.profileGeneration`.
3. Reuse that exact generation on a missing-key retry; never recapture.
4. On `PXE_STORE_KEY_MISSING` or an allowed generation-rotation marker, derive a key for the expected generation, provision it, zero the caller-side key buffer, and retry once.
5. Do not invoke either provider for `provisionChainStoreKey` itself.

Change management methods to carry generations explicitly:

```ts
clearChainState(profileId, chainId, generation)
clearProfileState(profileId, generation)
provisionChainStoreKey(profileId, generation, keyBase64)
```

The deletion coordinator passes the tombstoned generation to `clearProfileState`. Profile-wide deletion should skip NetworkService’s redundant per-chain PXE deletes; the profile purge owns the single authoritative offscreen erase.

### Offscreen lifecycle state

In `packages/aztec-runtime/src/pxe/service.ts`, maintain:

```text
unseen
live(generation)
deleting(generation)
deleted(generation)
```

Rules:

- Ordinary operations enter the profile read barrier and then verify `live(requestGeneration)`.
- `unseen` may become `live(generation)` for the first request.
- `deleted(oldGeneration)` rejects queued old operations.
- A different successor generation can activate only through guarded key provisioning.
- `provisionChainStoreKey` runs under the profile write barrier, not lock-free:
  - reject while `deleting`;
  - drain and dispose old-generation runtimes before rotating;
  - zeroize the replaced key;
  - install `{generation,key}` atomically.
- `clearProfileState` marks `deleting(generation)` synchronously before awaiting the profile write barrier.
- Once the write barrier is acquired, zero and remove the key, dispose runtimes, purge OPFS and legacy IndexedDB, then mark `deleted(generation)`.
- If any stop/close/delete fails, retain `deleting(generation)` and retain the same barrier. Retry with the same generation resumes the purge.
- An already successful `clearProfileState(profileId, sameGeneration)` is idempotent.
- A late clear for an old generation may never erase a live successor.
- Never remove `profileBarriers` or `chainGuards` from their maps.

Required tests:

- Provision racing clear either completes before the purge and is erased, or is rejected after `deleting`.
- A queued old-generation operation cannot run after clear.
- Failed purge retains the barrier and rejects queued work.
- Same-generation retry completes.
- Same-ID successor with a fresh generation works.
- Late old clear cannot erase that successor.
- Offscreen restart with `unseen` lifecycle accepts the current stored generation.
- Replaced/deleted key byte arrays are zeroized.

## Phase A3 — Repair D3, D6, D7, D11, disposal, and OPFS error handling

### D3: endpoint rebind

Change `packages/aztec-runtime/src/pxe/{chain-runtime,service}.ts`.

Split registry access into lookup and mutation:

- `peek(network)` may run under chain read.
- Runtime creation, endpoint mismatch disposal, and rebinding require chain write.
- `withPxeRead`:
  1. enters profile read;
  2. enters chain read;
  3. if the runtime matches, runs the operation;
  4. otherwise releases chain read;
  5. enters chain write without upgrading;
  6. rechecks and initializes/rebinds;
  7. releases write and retries under chain read.
- `withPxeWrite` enters profile read then chain write and may initialize/rebind there.

Tests use deferred barriers rather than sleeps:

- Reader A holds the old endpoint.
- Endpoint B request arrives.
- B does not call `stop` until A releases.
- A later reader never observes a half-disposed runtime.
- Only one new B runtime is created.

### Disposal failures

In `packages/aztec-runtime/src/pxe/chain-runtime.ts`:

- Always attempt store close in a `finally` after `pxe.stop`.
- Propagate stop or close failure.
- If both fail, throw `AggregateError`.
- Track partial completion so retry does not serve a poisoned runtime.

In the registry:

- Do not delete the entry before disposal succeeds.
- Mark it unavailable/poisoned while disposal is incomplete.
- `disposeProfile` should use `Promise.allSettled`, remove successful entries, retain failed entries, and throw an aggregate failure.
- Never open a replacement while an old store handle may still own the SAH directory lock.

### D7 and OPFS failure classification

Change `packages/aztec-runtime/src/pxe/opfs-store.ts`.

- Remove the empty-profile-directory sweep from `removeChainStoreDir`. Empty parents are harmless; only profile-wide purge removes them.
- Treat only these as absence:
  - no browser OPFS API;
  - `NotFoundError` while opening the Nulo `pxe` child.
- Propagate errors from `navigator.storage.getDirectory()`, enumeration, permission failures, worker failures, and non-`NotFoundError` removal failures.
- After profile purge, positively confirm that the profile directory is absent.
- Do not use 5.0.1 `listStores`/`deleteStore` for Nulo’s custom `pxe/<profile>/<chain>` pool layout.

Tests cover `NotFoundError`, `NotAllowedError`, `UnknownError`, enumeration failure, and failed recursive removal.

### D11: no forced unlock

Change `packages/wallet-core/src/utils/rw-guard.ts`.

- The five-minute timer becomes diagnostic only.
- It may log active reader count, but must never set `readers = 0`, resolve a writer, or mutate ownership.
- A writer remains queued until every actual reader leaves.
- Writer preference remains, so later readers cannot starve the writer.
- Remove documentation claiming force-release is recovery.
- A truly stuck proof now leaves deletion pending instead of allowing concurrent purge. Recovery is extension/offscreen restart, not fabricated lock release.

Replace the current force-release test with:

- reader remains active past five minutes;
- warning is logged;
- writer has not run;
- reader releases after 30 simulated minutes;
- writer runs exactly once;
- repeated cycles never produce a negative reader count.

Target gate:

```bash
bun run --cwd packages/wallet-core test src/utils/rw-guard.test.ts

bun run --cwd packages/aztec-runtime test \
  src/pxe/service.test.ts \
  src/pxe/chain-runtime.test.ts \
  src/pxe/opfs-store.test.ts \
  src/pxe/descriptors.test.ts

bun run --cwd apps/extension test \
  src/wallet/services/pxe/chain-runtime.test.ts \
  src/wallet/services/profile/profile-deletion-state.test.ts \
  src/wallet/services/profile/tombstone-repository.test.ts \
  src/wallet/services/profile-deletion/coordinator.test.ts
```

## Phase A4 — PR‑A full validation and merge

Run the three previously failing tests first:

```bash
bun run --cwd apps/extension test:e2e tests/e2e/backup-roundtrip.test.ts

NULO_E2E_PROVERLESS=1 bun run e2e:agent \
  tests/e2e/network/backup-restore-integrity.test.ts \
  tests/e2e/network/backup-migration-roundtrip.test.ts
```

Then the full gates:

```bash
bun run typecheck:all
bun run test:all
bun run lint
bun run test:e2e
bun run e2e:agent
bun run build:chrome
bun run build:firefox
bun run build:faucet
bun run audit:vue
bun run audit:faucet
git diff --check
```

Commit conventionally, for example:

```text
fix(wallet): fence profile-scoped PXE lifecycle
```

Update PR #282’s body with `Closes #281`, the lock order, deletion-generation invariant, and validation evidence. Do not weaken labels or workflows.

```bash
gh pr edit 282 --add-label e2e:network --add-label e2e:smoke
gh pr checks 282 --watch --fail-fast
```

Merge only when the current head has all three aggregators green:

- `quality-status`
- `smoke-e2e-status`
- `network-e2e-status`

```bash
gh pr merge 282 --squash
git fetch origin dev
git merge-base --is-ancestor "$(gh pr view 282 --json mergeCommit -q .mergeCommit.oid)" origin/dev
```

---

# PR‑B — Aztec 5.0.1, standards migration, and redeploy

## Phase B0 — Fresh worktree and repeat volatile probes

Create a fresh worktree from post-PR‑A `dev`:

```bash
git fetch origin dev
worktrees_root=$(dirname "$(git rev-parse --show-toplevel)")
git worktree add "$worktrees_root/aztec-5.0.1" \
  -b worktree-aztec-5.0.1 origin/dev
cd "$worktrees_root/aztec-5.0.1"
```

Repeat the live identity probe. Do not rely solely on the July 17 result:

```bash
curl -fsS https://v5.testnet.rpc.aztec-labs.com \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"node_getNodeInfo","params":[]}' |
  jq '.result | {nodeVersion,l1ChainId,rollupVersion,l1ContractAddresses}'
```

Hard gate:

- `nodeVersion == 5.0.0`
- `rollupVersion == 1821665230`
- derived wallet chain ID remains `1816023401`
- canonical rollup and L1 protocol contracts match the prior intent
- otherwise stop and reclassify; do not apply the no-reset plan.

Create `implementations-plan/aztec-5.0.1/` with repo-relative evidence only.

## Phase B1 — Provenance, exact pins, and lockfile

### Trust decision

Before installing, record:

```bash
npm view '@aztec/aztec.js@5.0.1' \
  version time repository dist.integrity dist.signatures --json
npm view '@alejoamiras/aztec-accelerator@5.0.1' \
  version time repository dist.integrity dist.signatures --json
npm view '@alejoamiras/aztec-fee-payment@5.0.1' \
  version time repository dist.integrity dist.signatures --json
npm view '@aztec-foundation/aztec-standards@5.0.1' \
  version time repository dist.integrity dist.signatures --json

git ls-remote https://github.com/AztecProtocol/aztec-standards \
  'refs/tags/v5.0.1' 'refs/tags/v5.0.1^{}'

gh api \
  'repos/AztecProtocol/aztec-standards/contents/src/token_contract/Nargo.toml?ref=v5.0.1' \
  --jq '{sha,path}'
```

The new-scope gate requires:

- npm repository points to `AztecProtocol/aztec-standards`;
- package version is exactly 5.0.1;
- tag exists and its peeled commit is recorded;
- package layout contains the expected `artifacts/src/artifacts/*.js`;
- `src/token_contract/Nargo.toml` exists at the recorded tag;
- signature/attestation checks succeed.

### Pin updates

Update the eight live manifests:

- `apps/{extension,faucet,playground}/package.json`
- `packages/{aztec-runtime,bridge-core,wallet-sdk-schema-patch,wallet-bridge,wallet-crypto}/package.json`

Changes:

- all intended `@aztec/*` 5.0.0 pins → exact `5.0.1`;
- leave `@aztec/viem` independent;
- accelerator → exact 5.0.1;
- fee-payment → exact 5.0.1;
- replace old standards dependency with `@aztec-foundation/aztec-standards: "5.0.1"`.

Mechanically replace the standards import in the roughly 22 live TS/Vue/script consumers, including deploy and canary scripts. Update `renovate.json`. Do not rewrite the archived `implementations-plan/aztec-5.0.0-stable/reference/` package.

Rename and reapply:

- `patches/@aztec%2Fnoir-acvm_js@5.0.0.patch`
- `patches/@aztec%2Fnoir-noirc_abi@5.0.0.patch`
- root `patchedDependencies`

to 5.0.1 equivalents. Inspect every hunk; a patch that applies with suspicious offset or no effect is a stop.

Update `bunfig.toml`:

- replace the old standards scope with `@aztec-foundation/aztec-standards`;
- retain only the required fresh 5.0.1 transitive names;
- date publications and removal dates explicitly;
- target removal around July 22–23 UTC;
- create a follow-up issue/PR marker to remove the exceptions once all packages exceed seven days.

Fresh-lock ritual:

```bash
rm bun.lock
bun install --ignore-scripts
npm audit signatures
bun install
bun install --frozen-lockfile
git diff -- bun.lock
```

Sweeps:

```bash
rg -n '"@aztec/[^"]+": "5\.0\.0"' \
  apps/*/package.json packages/*/package.json

rg -n '@alejoamiras/aztec-standards' \
  apps packages contracts renovate.json \
  --glob '!**/*.md'

rg -n '"@alejoamiras/aztec-(accelerator|fee-payment)": "5\.0\.0"' \
  apps/*/package.json packages/*/package.json

rg -n '@aztec-foundation/aztec-standards' \
  apps packages contracts renovate.json
```

Gate: intended old references are zero; exact pins, patch names, and lock resolutions all agree.

## Phase B2 — Noir, OPFS 5.0.1 semantics, and backup compatibility

### Noir

Update all three `Nargo.toml` files to Aztec 5.0.1. In `token_minter_proxy/Nargo.toml`, move the token dependency to the official standards repository at the verified `src/token_contract` directory.

Use the ordered `v5.0.1` tag, record its peeled commit in provenance, and fail the precompile check if the tag moves.

Update `contracts/bridge/aztec/scripts/compile.sh` to 5.0.1:

```bash
aztec-up install 5.0.1
bash contracts/bridge/aztec/scripts/compile.sh
```

Validate all committed artifacts:

```bash
sha256sum \
  contracts/bridge/aztec/token_minter_proxy/target/*.json \
  contracts/bridge/aztec/token_bridge/target/*.json \
  contracts/bridge/aztec/keystone/target/*.json

rg -n '/home/|/Users/' contracts/bridge/aztec/*/target
git diff --check contracts/bridge/aztec
```

Record old/new artifact digest and class-ID tables for Proxy, Token, Bridge, Dripper, faucet Tokens, and PrivateFPC.

### OPFS semantics

Change `packages/aztec-runtime/src/pxe/opfs-store.ts` and its tests:

- Keep `PXE_DATA_SCHEMA_VERSION_PIN = 13`; the published 5.0.1 PXE retains 13.
- Replace `initStoreVersionStamp`’s wipe-on-mismatch behavior with the 5.0.1 fail-closed identity assertion:
  - absent stamp → initialize;
  - matching schema/rollup → open;
  - malformed or mismatched stamp → close and throw without modifying bytes.
- Preserve the current physical `pxe/<profile>/<walletChainId>` path for schema 13 so existing 5.0.0 data opens in place.
- Do not move existing data into upstream’s unencrypted default store.
- Add a future-schema test showing a mismatch is retained and refused, not wiped.
- Keep direct custom pool cleanup; upstream `listStores/deleteStore` enumerates its `.aztec-kv-*` convention, not Nulo’s custom nested directories.
- Test that `SqliteEncryptionError` and OPFS permission errors remain failures, never “no store.”

### Backup epoch decision

Keep `CURRENT_COMPAT_EPOCH = 3`.

Reason:

- 5.0.1 is client-compatible with the same network and account derivation.
- PXE schema stays 13.
- No account address, key derivation, or backup slice encoding is intentionally changing.
- Standards deployment addresses are application configuration, not an incompatible account-state serialization.

Add explicit tests:

- an epoch-3 backup carrying `"aztec-version": "5.0.0"` imports under 5.0.1;
- export under 5.0.1 still emits epoch 3;
- account-state/network IDs survive a 5.0.0 fixture → 5.0.1 import/export round trip;
- the three restore e2es remain green after the dependency bump.

If an actual 5.0.1 type/API change makes the stored account-state slice undecodable, this inference is false and the phase stops; do not silently bump the epoch to hide it.

### Wallet-SDK boundary

Preserve and test:

- schema patch registration remains the first import in extension, faucet, and playground wallet entrypoints;
- `packages/wallet-sdk-schema-patch/src/apply.test.ts` passes;
- `packages/wallet-bridge/src/dispatcher.test.ts` proves custom method reachability and scope;
- no upstream WalletSchema change shadows `registerToken`, `isTokenRegistered`, or `grantPublicAuthwit`.

Phase gate:

```bash
bun run --cwd packages/aztec-runtime test
bun run --cwd packages/wallet-sdk-schema-patch test
bun run --cwd packages/wallet-bridge test
bun run --cwd packages/bridge-core test
bun run typecheck:all
```

## Phase B3 — Redesign the FPC gate and harden deployment tooling

### FPC compatibility policy

Do not allow a generic semver patch rule.

Add `packages/bridge-core/src/private-fpc-network-compat.json`, keyed by the exact 5.0.1 artifact digest. Its sole compatibility tuple should bind:

- installed fee-payment version `5.0.1`;
- descriptor version `5.0.1`;
- complete artifact SHA-256;
- derived salt-1 address;
- live `nodeVersion = 5.0.0`;
- `l1ChainId = 11155111`;
- `rollupVersion = 1821665230`.

`check-fpc-version.ts` accepts only:

1. installed version equals descriptor version and live node version exactly; or
2. installed equals descriptor and the complete artifact/network tuple appears in the explicit compatibility map.

It must reject:

- a generic “same major/minor” match;
- 5.0.0-rc variants;
- node 5.0.2;
- another rollup with nodeVersion 5.0.0;
- another artifact at the same version;
- descriptor/address drift;
- original or current live class mismatch.

Add modes:

- `--mode predeploy`: absence is allowed; an existing contract must match.
- `--mode require-deployed`: absence is red and is mandatory before any funding, canary, or promotion.

Update:

- `private-fpc-canonical.json` with the complete 5.0.1 digest and newly derived address;
- `private-fuel.ts`;
- extension PrivateFPC identity tests;
- deployment and canary comments;
- construction sweeps in extension fixtures and FPC service.

Derive locally from installed bytes; never copy an address from a publisher:

```bash
sha256sum \
  node_modules/@alejoamiras/aztec-fee-payment/target/private_contract-PrivateFPC.json

bun run --cwd packages/bridge-core test src/private-fuel.test.ts
```

### Intent tooling

Harden `packages/bridge-core/scripts/live-intent.ts` before live use:

- Strict-zod parse the intent itself.
- Replace broad `implementations-plan/.../lessons/` allowlisting with exact operational files.
- Use `execFileSync` argument arrays for all git/cast calls.
- Require signer revalidation; never skip because `PRIVATE_KEY` is absent.
- Pin a deterministic digest of tracked source files excluding exact operational outputs, rather than trusting a mutable commit/allowlist combination.
- Recheck the PrivateFPC digest during every verify, not only build.
- Pin Dripper and standards Token artifact digests in addition to Noir targets.
- Pin expected L2 class IDs and rederive candidate addresses from artifacts, constructor args, deployer, and salts.
- Query live original/current class IDs before promotion.
- Record separate SHA-256 values for:
  - bridge candidate;
  - faucet deployment candidate.
- Add a `promote` command that re-verifies both digests, identity, signer, caps, source digest, and privileged readbacks before atomically writing live manifests.
- Record that this arc seeds zero WETH and deploys no fuel/router/pool contracts. An unexpected seed flag or fuel deployment is a hard failure.
- Update the operational allowlist to include the actual bridge journal path, not an unrelated path.

### Candidate-first faucet support

Extend:

- `apps/faucet/scripts/deploy.ts`
- `apps/faucet/scripts/verify-deployments.ts`
- `packages/bridge-core/scripts/drip-canary-testnet.ts`

with `--config`/`--output` support so faucet deployments can be written and canaried as:

```text
apps/faucet/src/contracts/deployments.candidate.json
```

before promotion. No pre-promotion canary may read the live `deployments.json` by accident.

### Token portal preflight

Teach the bridge plan/verifier to distinguish:

- protocol FeeJuicePortal: unchanged;
- AZLO L1 token, fuel router, swap, pools: unchanged;
- app `NuloTokenPortal`: currently init-once and bound to the old L2 Bridge.

Before broadcasting, rederive the new L2 Bridge address and read the live token portal’s `l2Bridge()`. If they differ, reusing that token portal is forbidden.

Default safe deployment:

- reuse L1 AZLO;
- reuse fuel/router/swap/pools;
- reuse protocol FeeJuicePortal;
- deploy a new app `NuloTokenPortal`;
- initialize it once with the new L2 Bridge;
- deploy the new L2 Proxy, Token, and Bridge.

Gate:

```bash
bun packages/bridge-core/scripts/check-fpc-version.ts --mode predeploy
bun run --cwd apps/faucet verify:deployments
```

At this point `verify:deployments` is expected red from class/address drift. That red is evidence for redeploy, not permission to merge.

## Phase B4 — Live candidate deployment and canaries

Load `packages/bridge-core/.env` without printing it. Use:

```text
implementations-plan/aztec-5.0.1/lessons/intent.json
```

Build and commit the intent before the first broadcast:

```bash
bun packages/bridge-core/scripts/live-intent.ts build \
  implementations-plan/aztec-5.0.1/lessons/intent.json
```

The intent must pin signer `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5`, source/artifact digests, zero seed plan, exact network identity, and spend caps.

### Broadcast order

Before every numbered broadcast group, run:

```bash
bun packages/bridge-core/scripts/live-intent.ts verify \
  implementations-plan/aztec-5.0.1/lessons/intent.json
```

1. Deploy and verify new PrivateFPC:

```bash
bun packages/bridge-core/scripts/check-fpc-version.ts --mode predeploy
bun packages/bridge-core/scripts/deploy-private-fpc-testnet.ts
bun packages/bridge-core/scripts/check-fpc-version.ts --mode require-deployed
```

The deploy script’s “already exists” path must also validate original/current class IDs.

2. Deploy the new bridge candidate using a committed deployment plan:
   - reuse AZLO and fuel infrastructure;
   - deploy the new app token portal if the preflight proves it necessary;
   - deploy Proxy, Token, Bridge;
   - wire proxy token/bridge;
   - perform L1 and L2 readbacks;
   - write only `apps/faucet/public/testnet-bridge.candidate.json`.

3. Deploy faucet Dripper/NULO/OLUN to:

```bash
bun apps/faucet/scripts/deploy.ts \
  --network testnet \
  --output apps/faucet/src/contracts/deployments.candidate.json
```

4. Record both candidate digests in the intent, commit the intent/candidates/journals, then rerun verify. After this point the intent must reject any uncommitted anchor edit.

5. Run semantic candidate checks:

```bash
bun packages/bridge-core/scripts/verify-l1.ts \
  --config apps/faucet/public/testnet-bridge.candidate.json

bun apps/faucet/scripts/verify-deployments.ts \
  --config apps/faucet/src/contracts/deployments.candidate.json
```

### Candidate canaries

Run intent verification immediately before each fund-moving command:

```bash
bun packages/bridge-core/scripts/smoke-existing-testnet.ts \
  --config apps/faucet/public/testnet-bridge.candidate.json

bun packages/bridge-core/scripts/smoke-swap-existing-testnet.ts \
  --config apps/faucet/public/testnet-bridge.candidate.json

PRIVATE_RUNS=1 bun packages/bridge-core/scripts/fuel-testnet.ts \
  --config apps/faucet/public/testnet-bridge.candidate.json

bun packages/bridge-core/scripts/fee-juice-canary-testnet.ts \
  --config apps/faucet/public/testnet-bridge.candidate.json

bun packages/bridge-core/scripts/drip-canary-testnet.ts \
  --config apps/faucet/src/contracts/deployments.candidate.json
```

These prove, respectively:

- ordinary deposit/claim;
- fueled bridge;
- private FPC settlement and spend;
- direct Fee Juice deposit/claim;
- candidate faucet Dripper/Token identity and public drip.

After each group:

- recheck signer and network identity;
- reconcile cumulative ETH spend;
- confirm zero unintended WETH/FJ/AZLO seeding;
- record L1/L2 transaction hashes;
- stop after repeated infrastructure failure rather than repeatedly spending.

### Promotion

Promote through the intent tool, not manual copying:

```bash
bun packages/bridge-core/scripts/live-intent.ts promote \
  implementations-plan/aztec-5.0.1/lessons/intent.json \
  --bridge-candidate apps/faucet/public/testnet-bridge.candidate.json \
  --faucet-candidate apps/faucet/src/contracts/deployments.candidate.json
```

Post-promotion gates:

```bash
bun run --cwd apps/faucet verify:deployments
bun packages/bridge-core/scripts/check-fpc-version.ts --mode require-deployed
bun packages/bridge-core/scripts/drip-canary-testnet.ts
bun packages/bridge-core/scripts/live-intent.ts verify \
  implementations-plan/aztec-5.0.1/lessons/intent.json \
  --bridge-candidate apps/faucet/public/testnet-bridge.candidate.json \
  --faucet-candidate apps/faucet/src/contracts/deployments.candidate.json
```

Commit the exact promoted manifests and operational evidence conventionally, for example:

```text
chore(testnet): promote Aztec 5.0.1 deployments
```

## Phase B5 — Full PR‑B validation and merge

Confirm no chain identity cascade and no backup epoch bump:

```bash
rg -n '1816023401|1821665230' \
  apps/extension apps/faucet scripts/release

git diff --exit-code origin/dev -- \
  apps/extension/src/wallet/services/backup/backup-migration-registry.ts
```

Dependency/API gates:

```bash
bun run typecheck:all
bun run test:all
bun run lint
bun run test:e2e
bun run e2e:agent
bun run build:chrome
bun run build:firefox
bun run build:faucet
bun run audit:vue
bun run audit:faucet

bun run --cwd apps/faucet verify:deployments
bash contracts/bridge/aztec/scripts/compile.sh
(cd contracts/bridge/evm && forge test)

git diff --check
```

Repeat the restore tests under 5.0.1:

```bash
bun run --cwd apps/extension test:e2e tests/e2e/backup-roundtrip.test.ts

NULO_E2E_PROVERLESS=1 bun run e2e:agent \
  tests/e2e/network/backup-restore-integrity.test.ts \
  tests/e2e/network/backup-migration-roundtrip.test.ts
```

Create PR‑B:

```bash
git push -u origin worktree-aztec-5.0.1

gh pr create \
  --base dev \
  --head worktree-aztec-5.0.1 \
  --title 'chore: bump Aztec to 5.0.1 and redeploy testnet'
```

The body should include provenance, full pin sweep, pin-13 decision, epoch-3 decision, explicit FPC compatibility tuple, old/new class/address table, candidate digests, canary hashes, spend reconciliation, and the portal distinction.

```bash
gh pr checks --watch --fail-fast
```

Merge via squash only when quality, smoke, and network aggregators are green on the current head.

---

# Release phase

## Phase R1 — Promote `dev → main`

Confirm PR‑B is in `origin/dev`, deployment manifests are the promoted bytes, and `verify:deployments` is green.

```bash
gh pr create \
  --base main \
  --head dev \
  --title 'release: promote dev → main (Aztec 5.0.1)'

gh pr checks --watch --fail-fast
gh pr merge --merge
```

Use a merge commit on `main`.

## Phase R2 — Release-please and stable extension release

Confirm auto-unstick is still enabled:

```bash
gh variable get AUTO_UNSTICK_ENABLED
```

Wait for the release PR:

```bash
gh pr list \
  --base main \
  --state open \
  --label 'autorelease: pending' \
  --json number,title,url,headRefOid
```

Review:

```bash
gh pr diff <release-pr-number>
gh pr checks <release-pr-number> --watch --fail-fast
gh pr merge <release-pr-number> --merge
```

Do not enable marketplace stubs. Auto-unstick should create the stable tag/release and continue through lint, tests, network e2e, Chrome/Firefox builds, smoke, asset attachment, landing refresh, and faucet publication.

Monitor:

```bash
gh run list --workflow release.yml --branch main --limit 5
gh run watch <run-id> --exit-status
```

If the variable unexpectedly reads off, use the documented manual unstick from `CLAUDE.md`; do not repoint an existing tag or bypass a wrong-SHA failure.

Validate release assets:

```bash
gh release view "v$VERSION" --json assets \
  -q '[.assets[].name]'
```

Require Chrome zip, Firefox zip, and `SHASUMS256.txt`.

## Phase R3 — Live acceptance

Run the repository’s fail-closed build check:

```bash
VERSION="$VERSION" SHA="$RELEASE_SHA" \
  bun scripts/release/verify-live-run.ts
```

Independently inspect the live build:

```bash
curl -fsS 'https://faucet.nulo.sh/build.json' | jq
curl -fsS 'https://faucet.nulo.sh/' | rg 'nulo-build'
```

Require:

- HTML build ID equals `/build.json` build ID;
- build SHA matches the release commit;
- served chain ID is `1816023401`;
- landing points to the new stable tag.

Then use the released Chrome artifact in a clean browser profile against the actual `https://faucet.nulo.sh`:

1. Connect a throwaway Nulo testnet profile.
2. Execute one public NULO drip through the public page.
3. Record the before/after public balance and L2 transaction hash.
4. Open the public Fuel tab using the designated Sepolia test signer.
5. Submit the minimum permitted public Fee Juice deposit.
6. Complete the wallet approval/claim from the public page.
7. Record L1 deposit hash, L2 claim hash, and positive Fee Juice delta.
8. Re-run `check-fpc-version --mode require-deployed` and intent spend reconciliation.

A headless canary is not a substitute for these two public-site flows.

If faucet deployment is stale, run the documented break-glass refresh and repeat acceptance:

```bash
gh workflow run refresh-landing.yml -f target=faucet
```

Do not declare the release complete while live acceptance is red, even though `verify-live` is currently advisory in the workflow.

## Phase R4 — Back-sync

Find the automated sync PR and merge it with a merge commit:

```bash
gh pr list --base dev --state open --search 'sync main dev'
gh pr checks <sync-pr-number> --watch --fail-fast
gh pr merge <sync-pr-number> --merge
```

Confirm `main`’s release commit is an ancestor of `dev` and `.release-please-prerelease-manifest.json` matches the stable version.

---

# Security & Adversarial Considerations

- **Wrong FPC means fund loss.** A generic patch-semver allowance is unacceptable. Compatibility is an exact allowlist keyed by artifact digest, derived address, node version, L1 chain ID, and rollup version. Both original and current live class IDs must match. Absence is red before funding.
- **A compromised RPC can steer deploys.** Revalidate identity before every broadcast, corroborate protocol L1 addresses through direct Sepolia reads, validate all RPC-derived addresses, and pass them to `cast` without a shell. A second Aztec endpoint remains preferable where available.
- **Candidate self-consistency is insufficient.** Recompute L2 addresses and class IDs from pinned artifact bytes and constructor data, then compare with live original/current class IDs. Candidate JSON digest alone does not authenticate deployed code.
- **Intent mutation is a likely bypass target.** Strict-schema the intent, commit it after candidate digest recording, pin a source-tree digest, narrow the operational allowlist, require the signer on every verify, and prevent manual promotion.
- **New npm scope is a supply-chain trust expansion.** Verify repository, tag, npm integrity/signatures, package layout, and artifact digests before admitting `@aztec-foundation`. Record the tag’s peeled commit and fail if it moves.
- **Min-age exclusions are an explicit temporary reduction in defense.** Keep them package-name-specific, dated, and removable. Do not exclude an entire scope or disable `minimumReleaseAge`.
- **Patch files can silently stop protecting the build.** Review the 5.0.1 patch applications and assert the patched behavior, not merely successful installation.
- **Generation checks must occur inside the barrier.** Checking in the service worker alone is a TOCTOU: an old message can queue behind purge and run later. The offscreen lifecycle check after barrier acquisition is the authoritative decision.
- **Barrier deletion is unsafe.** A failed purge retains `deleting(generation)` and the same barrier. Replacing it would orphan already queued operations.
- **Lock correctness outranks automatic recovery.** A hung proof may delay deletion, but forged reader release can overlap destructive storage operations with a real proof. Keep the durable tombstone and require restart/retry.
- **Key lifecycle matters.** Store only derived 32-byte keys offscreen, zero temporary master and replaced key buffers, never log them, and never include them in intent or deployment evidence.
- **OPFS failure must be loud.** Permission, worker, encryption, enumeration, and removal errors are not “empty store.” A false successful purge leaves encrypted bytes behind and violates deletion claims.
- **Portal reuse must be proven, not assumed.** The init-once token portal cannot target a changed L2 Bridge. Attempting to carry it forward could strand deposits or direct them to the obsolete bridge.
- **Least privilege.** Testnet signer keys stay only in the deploy environment; release CI keeps read-only default permissions; no marketplace publishing; no new L1 fuel seed or protocol deployment; caps remain enforced.
- **Public acceptance consumes real testnet resources.** Use minimum amounts and throwaway L2 accounts, record hashes, and keep total signer exposure inside the committed intent cap.

# Assumptions

## Facts

- Bun 1.3.14, Biome, Conventional Commits, and the full local command surface are mandatory (`CLAUDE.md:30-35`, `CLAUDE.md:346-358`).
- `dev` uses squash PRs; `main` promotions and back-syncs use merge commits; PR titles are limited to roughly 93 characters (`CLAUDE.md:39-51`).
- Dependency updates use exact Aztec pins, the minimum-age gate, and a fresh-lock ritual (`CLAUDE.md:57-60`).
- CI gates may not be weakened (`CLAUDE.md:364-369`).
- Release-please, auto-unstick, faucet publication, and back-sync behavior are documented at `CLAUDE.md:387-444`.
- The three restore failures and the missing import-side `Started PXE` observation are recorded in `implementations-plan/aztec-5.0.0-stable/lessons/phase-6.md:7-40`.
- `ProfileService.runExclusive` is explicitly non-reentrant; `getProfileSecret` and `finalizeRestore` both use it (`apps/extension/src/wallet/services/profile/service.ts:125-143`, `:1007-1014`, `:1284-1341`).
- SessionManager currently invokes the active-profile callback from `open` (`apps/extension/src/wallet/services/profile/session-manager.ts:202-232`).
- Runtime key provisioning calls `getProfileSecret` (`apps/extension/src/wallet/runtime.ts:198-206`).
- PXE profile clear currently deletes its barrier in `finally`, and key provisioning is unbarriered (`packages/aztec-runtime/src/pxe/service.ts:558-602`).
- Endpoint mismatch disposal can happen from `withPxeRead` (`packages/aztec-runtime/src/pxe/service.ts:628-646`).
- The reader guard force-sets its count to zero after five minutes, while prove RPC timeout is 30 minutes (`packages/wallet-core/src/utils/rw-guard.ts:132-146`; `packages/aztec-runtime/src/pxe/client.ts:60`).
- The current OPFS mirror clears on schema/rollup mismatch and suppresses all root-open errors (`packages/aztec-runtime/src/pxe/opfs-store.ts:89-139`).
- Backup compatibility epoch is 3, and account-state is an optional non-storage slice (`apps/extension/src/wallet/services/backup/backup-migration-registry.ts:69`, `:102`; `:166-167` test).
- The app token portal is init-once and stores `l2Bridge` (`contracts/bridge/evm/upstream/NuloTokenPortal.sol:49-56`; `contracts/bridge/evm/test/PortalReinit.t.sol:39-59`).
- The 2026-07-17 probe establishes live node 5.0.0, rollup version 1821665230, wallet chain ID 1816023401, no reset, available 5.0.1 packages, FPC artifact drift, and PXE schema pin 13.
- Inspection of the published 5.0.1 cache confirms `createPXE` still accepts `options.store`, upstream `openBrowserStore` partitions by L1/rollup/schema, and identity mismatch is fail-closed.

## Inferences

- The restore boot hang is caused by a profile-lock reentry triggered by an event emitted before `finalizeRestore` releases the façade lock.
- A persisted random profile incarnation plus a tombstoned generation is safer than a barrier-only fix and avoids deleted-profile resurrection.
- Keeping backup epoch 3 is correct because no key derivation or backup wire incompatibility is intended.
- Keeping PXE schema pin 13 and replacing wipe-on-mismatch with fail-closed assertion is the correct 5.0.1 mirror for Nulo’s injected encrypted store.
- An explicit artifact/network FPC compatibility map is materially safer than any generic patch-compatibility rule.
- “Portal stays” most plausibly refers to the protocol FeeJuice portal. The app token portal cannot safely stay if the L2 Bridge address moves.

## Asks

- No further release or testnet authorization is needed; standing authorization covers green-gate execution.
- Consolidation must confirm the meaning of “portal stays.” If it means `apps/faucet/public/testnet-bridge.json`’s `l1.portal`, the locked deployment requirements are mutually incompatible. The safe default is to keep the protocol FeeJuice portal but redeploy the app `NuloTokenPortal`.

# Weakest points in this plan

- The profile-generation redesign touches stored profile rows, tombstones, SW transport, and offscreen lifecycle state; deterministic tests cover named interleavings but cannot exhaust all schedules.
- Removing forced reader release trades corruption risk for liveness: a genuinely hung PXE read can leave deletion pending until restart.
- Live L2 class verification still depends on Aztec RPC honesty if no independent second endpoint exists.
- npm signatures and repository metadata do not prove reproducible correspondence between published standards artifacts and source.
- The token-portal interpretation must be settled before broadcast.
- Final public drip and Fuel acceptance remain browser/operator-driven rather than a fully automated live UI harness.