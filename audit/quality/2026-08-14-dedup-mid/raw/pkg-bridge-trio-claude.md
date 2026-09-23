# pkg-bridge-trio — quality scan (duplication focus)

Scope audited: `packages/wallet-bridge/src`, `packages/wallet-sdk-schema-patch/src`, `packages/bridge-core/src`, `packages/bridge-core/scripts` (production-wired conductors). `*.test.ts` excluded from findings, read as evidence.

## Finding 1 — L1+L2 client-bootstrap block copy-pasted across 10 `bridge-core/scripts` conductors, no shared helper

**Smell**: Duplicate Code (Dispensables). Secondary: Shotgun Surgery (Change Preventers) — a change to bootstrap behavior (RPC defaults, prover toggle, retry/timeout policy, `--config` handling) must be hand-applied to every copy.

**Impact bucket**: architectural. Blast radius: 10 files, ~2,900 combined lines, all under `packages/bridge-core/scripts/`. Change frequency: HIGH — by 120-day git-log churn this is the most actively edited part of the cluster: `deploy-bridge-testnet.ts` (9 commits), `fuel-testnet.ts` (8), `smoke-existing-testnet.ts` (7), `deposit-testnet.ts` (7), `deploy-sandbox.ts` (7), `smoke-swap-existing-testnet.ts` (6), plus `fee-juice-canary-testnet.ts`, `fpc-dust-canary-mainnet.ts`, `deploy-bridge-mainnet.ts`, `smoke-existing-mainnet.ts`.

**Evidence** — the same four-part sequence (viem `defineChain` + `createPublicClient`/`createWalletClient`, `createAztecNodeClient`, `EmbeddedWallet.create`, and — in most — a `--config`-driven `readFileSync`+`JSON.parse` manifest load) recurs near-verbatim:

- `packages/bridge-core/scripts/deposit-testnet.ts:52` (`defineChain`), `:86-87` (`createWalletClient`/`createPublicClient`), `:104-105` (`createAztecNodeClient`/`EmbeddedWallet.create`)
- `packages/bridge-core/scripts/fuel-testnet.ts:50` (`--config` parse), `:55` (manifest load), `:63` (`defineChain`), `:97-98`, `:127-128`
- `packages/bridge-core/scripts/deploy-bridge-testnet.ts:87` (`defineChain`), `:174-175`, `:258-259`
- `packages/bridge-core/scripts/smoke-swap-existing-testnet.ts:47` (`--config` parse), `:49` (manifest load), `:59` (`defineChain`), `:81-82`, `:103-104`
- `packages/bridge-core/scripts/fpc-dust-canary-mainnet.ts:60` (`defineChain`), `:82`, `:95-96`, `:99`
- `packages/bridge-core/scripts/deploy-bridge-mainnet.ts:94` (`defineChain`), `:193-194`, `:278`, `:337`
- `packages/bridge-core/scripts/smoke-existing-testnet.ts:44` (`--config` parse), `:46` (manifest load), `:58` (`defineChain`), `:80-81`, `:97-98`
- `packages/bridge-core/scripts/deploy-sandbox.ts:52` (`defineChain`), `:121-122`, `:147-148`
- `packages/bridge-core/scripts/smoke-existing-mainnet.ts:43` (`--config` parse), `:49` (manifest load), `:69` (`defineChain`), `:89-90`, `:109-110`
- `packages/bridge-core/scripts/fee-juice-canary-testnet.ts:45` (`--config` parse), `:50` (manifest load via `parseCandidateManifest`), `:54` (`defineChain`), `:83-84`, `:129-130`

Also duplicated: the `t0`/`mins()` elapsed-timer helper (`const mins = () => \`${((Date.now() - t0) / 60000).toFixed(1)}m\``), present verbatim in all 12 files that have a `main()` (e.g. `deposit-testnet.ts:81`, `deploy-bridge-mainnet.ts:157`, `fuel-testnet.ts:83`, `smoke-existing-testnet.ts:75`, `fee-juice-canary-testnet.ts:81`, `smoke-existing-mainnet.ts:82`, `deploy-bridge-testnet.ts:141`, `smoke-swap-existing-testnet.ts:78`).

**Why it harms future change**: the copies have already silently drifted — `deploy-sandbox.ts:148` passes `pxeConfig: { proverEnabled: false }` while every other conductor passes `proverEnabled: true` at the identical call site, and nothing enforces that this is the intended delta vs. a stale copy. If the team needs a fleet-wide fix (e.g. adding request-timeout/retry to the Aztec node client after a flaky-RPC incident, or rotating a default RPC URL), it means editing the same 4-line block in 10 files by hand, with every miss reintroducing the bug in one script while looking fixed everywhere else. `deploy-manifest.ts`, `deployer-keys.ts`, and `live-intent.ts` already exist as shared-helper files in this exact directory, so there's a clear, precedented home for this extraction — it just was never done for the client bootstrap itself.

**Smallest safe refactoring**: Extract Function into a new sibling helper (e.g. `scripts/script-bootstrap.ts`, matching the existing `deploy-manifest.ts`/`deployer-keys.ts` convention): a `createBridgeScriptClients({ chain, rpcUrl, nodeUrl, proverEnabled })` returning `{ pub, wallet, node, ewallet }`, plus a `loadManifestFromConfigArg(argv)` for the `--config`/`readFileSync`/`JSON.parse` block and a `stopwatch()` for the `t0`/`mins()` pair. Each conductor keeps only its network-specific chain id/name/RPC env var; the 4-part bootstrap block disappears from all 10 call sites.

**Instances** (complete file:line list):
- `deposit-testnet.ts:52,86,87,104,105,81`
- `fuel-testnet.ts:50,55,63,97,98,127,128,83`
- `deploy-bridge-testnet.ts:87,174,175,258,259,141`
- `smoke-swap-existing-testnet.ts:47,49,59,81,82,103,104,78`
- `fpc-dust-canary-mainnet.ts:60,82,95,96,99`
- `deploy-bridge-mainnet.ts:94,193,194,278,337,157`
- `smoke-existing-testnet.ts:44,46,58,80,81,97,98,75`
- `deploy-sandbox.ts:52,121,122,147,148`
- `smoke-existing-mainnet.ts:43,49,69,89,90,109,110,82`
- `fee-juice-canary-testnet.ts:45,50,54,83,84,129,130,81`

---

## Finding 2 — `handleRegisterToken` / `handleGrantPublicAuthwit` reimplement the dispatcher's existing session-account-authorization helper instead of calling it

**Smell**: Duplicate Code, mapped as Divergent Change — `WalletSdkDispatcher` already centralizes "resolve a session-authorized account" in `resolveNetworkAndAccount` (delegating to `resolveAuthorizedSessionAccount` in `account-resolution.ts`), but two later-added handlers reimplement the same policy inline with their own `find()`, instead of extending the one method. Account-authorization semantics for this class now live in two places that can independently drift.

**Impact bucket**: structural. Blast radius: 1 file (`dispatcher.ts`, the RPC dispatch table — 1383 lines, 17 commits in the last 120 days), 2 methods today, but every future Nulo-custom RPC that needs a dApp-supplied `from` account is the natural next copy site (this is exactly how the second instance was created — `grantPublicAuthwit` copied `registerToken`'s pattern rather than the dispatcher's shared helper).

**Evidence** — the identical 6-line resolve-and-validate sequence, differing only in the error-message method name:

```
packages/wallet-bridge/src/dispatcher.ts:774-786  (handleRegisterToken)
    const requestedAccount = String(args[0])
    const network = await this.resolveNetwork(ctx)
    const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
    const sessionAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)
    const account = allAccounts.find((acc) => sessionAddresses.has(acc.address) && acc.address === requestedAccount)
    if (!account) throw new Error(`registerToken: account ${requestedAccount} is not authorized for this dApp session`)
    const caipAccount = formatCaipAccount(ctx.chainId, account.address)

packages/wallet-bridge/src/dispatcher.ts:821-829  (handleGrantPublicAuthwit)
    const requestedAccount = String(args[0])
    const network = await this.resolveNetwork(ctx)
    const allAccounts = await this.accountService.getAccounts(ctx.profileId, network.chainId)
    const sessionAddresses = this.getSessionAccountAddresses(dappSession, ctx.chainId)
    const account = allAccounts.find((acc) => sessionAddresses.has(acc.address) && acc.address === requestedAccount)
    if (!account) throw new Error(`grantPublicAuthwit: account ${requestedAccount} is not authorized for this dApp session`)
    const caipAccount = formatCaipAccount(ctx.chainId, account.address)
```

The pre-existing, already-shared helper this duplicates:

```
packages/wallet-bridge/src/dispatcher.ts:1350-1378  private async resolveNetworkAndAccount(ctx, dappSession, requestedFrom)
    // resolveNetwork(ctx) → accountService.getAccounts(...) → getSessionAccountAddresses(...) →
    // resolveAuthorizedSessionAccount({ walletAccounts, sessionAddresses, requestedFrom })
```
Used correctly by `handleSendTx` (`dispatcher.ts:650`) and `handleCreateAuthWit` (`dispatcher.ts:718`).

**Why it harms future change**: the two implementations have already diverged in behavior, not just text. `resolveNetworkAndAccount` explicitly checks `allAccounts.length === 0` and throws a distinct "No accounts found for profile…" error, and treats an empty/missing `dappSession.accounts` as its own "must call requestCapabilities first" case (`dispatcher.ts:1358-1377`). The two inline copies skip both distinctions — an empty-accounts or no-session-accounts case falls through `find()` returning `undefined` and surfaces only the generic "is not authorized" message. Anyone auditing or changing session-account-authorization policy (a security-relevant surface — this is the code deciding which account a dApp is allowed to act as) has to know to check three call sites instead of one, and a fix applied only to `resolveNetworkAndAccount` silently leaves the two copies with the old, weaker behavior.

**Smallest safe refactoring**: Extract Function on the duplicated block into a private helper (e.g. `resolveSessionAuthorizedAccount(methodName, requestedAccount, ctx, dappSession)`) reusing `resolveNetworkAndAccount`'s exact resolution path (or, more directly, calling `resolveNetworkAndAccount(ctx, dappSession, requestedAccount)` itself, since its `resolveAuthorizedSessionAccount` machinery already implements "must match `requestedFrom` exactly, must be session-authorized"). After the change, `handleRegisterToken` and `handleGrantPublicAuthwit` each shrink by 6 lines and the not-authorized/no-accounts error paths become singly-sourced.

**Instances**: `dispatcher.ts:774-786` (handleRegisterToken), `dispatcher.ts:821-829` (handleGrantPublicAuthwit); shared helper already at `dispatcher.ts:1350-1378`.

---

## Finding 3 — `deploy-private-fpc-mainnet.ts` / `deploy-private-fpc-testnet.ts`: near-identical PrivateFPC deploy conductor, no shared core

**Smell**: Duplicate Code.

**Impact bucket**: structural. Blast radius: 2 files, 74 + 76 = 150 lines total, ~92-line overlap (per repo-map diff). Change frequency: LOW but coupled — `deploy-private-fpc-testnet.ts` has 3 commits in the last 120 days (most recently tied to the 5.0.1 `@aztec/*` line rename, `c97e9cd7`), `deploy-private-fpc-mainnet.ts` has 1 commit total (`a444e361`, its introduction) — i.e. the mainnet variant was written once by copying the testnet variant and has not been independently touched since, which is exactly the failure mode Duplicate Code predicts: the two will silently diverge the next time only one gets updated for a protocol change.

**Evidence** — shared verbatim across both files:
- `t0`/`mins()` elapsed-timer helper: `deploy-private-fpc-mainnet.ts:26-27` ≡ `deploy-private-fpc-testnet.ts:26` (mainnet: `packages/bridge-core/scripts/deploy-private-fpc-mainnet.ts:26-27`; testnet: `packages/bridge-core/scripts/deploy-private-fpc-testnet.ts:26`, with `t0` one line earlier at `:25`).
- Idempotent early-return existence check via `node.getContract(pinned)`: `deploy-private-fpc-mainnet.ts:29-33` ≡ `deploy-private-fpc-testnet.ts:29-33`.
- Closing `PrivateFPCContract.deploy(...).send(...)` → pinned-address assertion → success log: `deploy-private-fpc-mainnet.ts:60-70` ≡ `deploy-private-fpc-testnet.ts:58-69` (identical `Fr.fromHexString(PRIVATE_FPC_SALT)`/`universalDeploy: true` deploy call, identical `if (got !== PRIVATE_FPC_ADDRESS) throw …` guard, identical `✅ PrivateFPC live at ${got}` log line).

Only the fee-payment/account-bootstrap middle section differs: mainnet resolves a funded deployer via `resolveDeployerKeys("mainnet")` + claimed public fee-juice (`deploy-private-fpc-mainnet.ts:36-56`), testnet creates a throwaway account paid by SponsoredFPC (`deploy-private-fpc-testnet.ts:35-52`).

**Why it harms future change**: the pinned-address assertion and deploy-args block is the actual protocol-correctness-critical part of this script (it's what proves the deployed contract lands at the address the faucet's manifest and the wallet hardcode). Duplicating it means an Aztec-version bump that changes the deploy-args shape (e.g. `PrivateFPCContract.deploy`'s parameter list, per the project's own `aztec-update` skill) has to be applied twice; the low, asymmetric commit history above shows this already didn't happen in lockstep once (testnet picked up the 5.0.1 rename in `c97e9cd7`, mainnet's only commit predates and doesn't reflect any later cleanup).

**Smallest safe refactoring**: Extract Function — a shared `runPrivateFpcDeploy(node, ewallet, from, feePaymentMethod)` core in a bridge-core/scripts helper, taking the already-resolved `node`/`ewallet`/`from`/fee-payment-method and doing the existence check + deploy + assertion + log; each network file keeps only its own account/fee-setup call and passes the result in. The deploy-args/assertion block disappears from one of the two files.

**Instances**: `deploy-private-fpc-mainnet.ts:26-27,29-33,60-70`; `deploy-private-fpc-testnet.ts:25-26,29-33,58-69`.

---

## Non-findings

- **`deploy-bridge-mainnet.ts`/`deploy-bridge-testnet.ts` and `smoke-existing-mainnet.ts`/`smoke-existing-testnet.ts` conductor-skeleton overlap (repo-map candidate (c))** — real (~250-300 lines/pair: journal resume, candidate-manifest emission, portal-artifact rebuild+verify, read-back assertions), but both mainnet variants carry explicit in-header rationale ("the testnet conductor stays untouched (battle-proven mid-arc)" — `deploy-bridge-mainnet.ts:1-3`; "the mainnet sibling of smoke-existing-testnet.ts" — `smoke-existing-mainnet.ts:1-3`) documenting this as a deliberate, reasoned safety decision (don't refactor code that gates real mainnet funds) rather than an accidental copy. Lower priority than Findings 1-3; a shared conductor-core is the correct eventual fix but isn't the cheapest next move given the team's own stated risk tradeoff.
- **`wallet-bridge/src/fee.ts` vs `bridge-core/src/fee-juice.ts` field-name overlap** (repo-map's own ruled-out check, re-verified) — `claimAmount`/`claimSecret`/`messageLeafIndex` appear in both, but one is a serializable wire-type (string/bigint-agnostic) and the other is aztec.js domain logic (bigint/`AztecAddress`-typed); no shared function bodies. Same protocol concept at two layers, not copy-paste.
- **`recovery-crypto.ts` seal/open self-test duplication** (`sealRecordSecret:77-85` vs `sealDepositRecord:177-189`) — both re-sign, seal, reopen, and throw the identical "Recovery self-test failed…" string on mismatch. Real but small (~5 overlapping lines) and the two callers have genuine behavioral deltas (`sealDepositRecord` has an opt-out `trusted` flag and additionally returns the derived key for reuse) that make a naive Extract Function require a new parameter anyway — not one of the top load-bearing instances in this cluster.
- **`journal.ts` `deriveDepositStage` vs `deriveWithdrawStage`** (`journal.ts:263-268` vs `journal.ts:270-274`) — structurally parallel (both a 4-branch stage state machine keyed off timestamp/hash presence) but operate on distinct record shapes (`DepositJournalRecord` vs `WithdrawJournalRecord`) with no shared field names or shared body — parallel domain state machines, not duplicate logic.
- **`wallet-sdk-schema-patch` package** — audited per scope; it is the *already-deduplicated* result of a prior refactor (its own header states it replaced a 3x inline copy across extension/faucet/playground) and at ~90 lines across 2 files has no internal duplication or dead code to flag.
- **`method-descriptors.ts` (395 lines) / `method-scope-checkers.ts` (419 lines) as a Divergent-Change pair** — considered whether adding a new Nulo-custom RPC method (touching the descriptor table, a scope checker, and a dispatcher handler) constitutes Shotgun Surgery. Rejected: this is the necessary shape of a capability-scoped RPC registry (descriptor = wire contract, scope-checker = authorization policy, dispatcher = execution) — the same triple-layer split the project's own conventions already document (`e9c51dd0` folded six prior metadata tables into the one `MethodDescriptor` registry specifically to reduce this kind of scatter), not boilerplate exceeding what the convention requires.
- **Cross-package coupling (`wallet-bridge` × `bridge-core` via `apps/extension`'s fee code)** — real (noted in the repo map §3: no package mediates the wire-type/domain-computation split), but it is an inter-package coupling/architecture concern, not a duplication instance inside this cluster's own files, and the two packages' fee modules don't share any function body — no Extract-anything target exists inside the audited scope.
