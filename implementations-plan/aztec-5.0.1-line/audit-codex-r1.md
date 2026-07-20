reject — fund-loss trust anchors and release gating remain insufficiently fail-closed.

## Critical

1. **The FPC map proves consistency, not authenticity.** A compromised `@alejoamiras/aztec-fee-payment@5.0.1` can supply malicious-but-self-consistent artifact bytes; updating the digest, address, descriptor, and deployed class makes every proposed check green. Nothing independently binds that artifact to reviewed source, and the plan does not require every fund-moving entry point to invoke the gate internally. Refs: [plan §B4](implementations-plan/aztec-5.0.1-line/plan.md:197), [check-fpc-version.ts](packages/bridge-core/scripts/check-fpc-version.ts:115).  
   Fix: Bind fee-payment bytes to independently reviewed source/reproducible build, pin that digest outside the package, and call `require-deployed` inside every FJ-deposit/funding script.

2. **Network identity is under-pinned.** `l1ChainId + rollupVersion` does not authenticate the rollup, registry, FeeJuicePortal, or handler addresses; current “L1 corroboration” only proves node-supplied addresses contain code. A malicious RPC can nominate attacker contracts and make both the FPC check and canaries observe a coherent false world. Refs: [plan §B4](implementations-plan/aztec-5.0.1-line/plan.md:201), [live-intent.ts](packages/bridge-core/scripts/live-intent.ts:122).  
   Fix: Pin exact L1 addresses and runtime code hashes, corroborate through two independent L1 RPCs, and require a second independent Aztec endpoint before funding.

3. **`promote` lacks an implementable anti-TOCTOU transaction.** “Reverify then atomically write both manifests” does not specify immutable input buffers, symlink rejection, source-tool digest checks, crash recovery, or cross-file atomicity; a clean committed change also evades the current dirty-tree check because HEAD is not compared with the intent. Refs: [plan §B4](implementations-plan/aztec-5.0.1-line/plan.md:208), [live-intent.ts](packages/bridge-core/scripts/live-intent.ts:230).  
   Fix: Pin executable/source digests, read candidates once into validated buffers, reject symlinks, journal+fsync temp writes, rename, then rehash both outputs and commit a promotion receipt.

4. **A red release can ship today.** `verify-live` is advisory and excluded from `status`; an absent faucet deploy hook exits successfully, while Cloudflare Git integration may deploy immediately on `main`. Release-please creates the tag/release before downstream publication gates. Refs: [plan §R](implementations-plan/aztec-5.0.1-line/plan.md:255), [release.yml](.github/workflows/release.yml:412).  
   Fix: Make faucet deployment and `verify-live` required, disable uncontrolled Git auto-deploy, and keep the GitHub release draft until all blocking gates pass.

## High

5. **The new-scope trust gate does not bind npm bytes to GitHub source.** Repository metadata is publisher-controlled; registry signatures prove registry integrity, while a peeled tag proves only that unrelated source exists. Refs: [plan §B0](implementations-plan/aztec-5.0.1-line/plan.md:141).  
   Fix: Verify npm provenance/OIDC attestation or reproducibly build the tarball artifacts from the peeled commit and compare byte digests.

6. **The restart fence still has no authoritative generation.** After offscreen restart, lifecycle is `unseen`; because `pxeGeneration` is excluded from `ProfileInfo`, offscreen can accept a delayed old-generation provision/request first and recreate deleted state after a completed purge. Refs: [plan §A2](implementations-plan/aztec-5.0.1-line/plan.md:86).  
   Fix: Hydrate current generations and tombstones before accepting requests, require Web-Crypto generation, and test stale-first delivery after purge plus offscreen restart.

7. **Least privilege is unspecified.** B0 checks deployer credentials before dependency installation, and B1 later enables lifecycle scripts; a compromised package must never inherit the raw signing key.  
   Fix: Require a secret-free install/build environment and expose the signer only to exact intent-verified broadcast commands, preferably through an isolated signer.

## Assumption attack

### Facts

8. **“PXE contains only re-derivable state” is false.** User-added senders and registered contracts live in PXE and are merely optionally copied into full backups; wipe-on-mismatch can lose unbacked local state. Refs: [plan §B2](implementations-plan/aztec-5.0.1-line/plan.md:169), [account-state service](apps/extension/src/wallet/services/account-state/service.ts:145).  
   Fix: Refuse-and-preserve, or migrate/export local registrations before any wipe.

### Inferences

9. The assumptions still claim a reuse path exists although B4 correctly says it must be built; accelerator compatibility also requires full proving e2e, not merely a startup preflight. Refs: [plan assumptions](implementations-plan/aztec-5.0.1-line/plan.md:309).  
   Fix: Rewrite both as unproven deliverables with explicit unit, fork-readback, and full-e2e gates.

### Asks

10. “None open” is unsafe: explicit authorization is needed if provenance attestation is absent, only one Aztec RPC is available, or destructive PXE wipe remains selected despite local-state loss. Refs: [plan assumptions](implementations-plan/aztec-5.0.1-line/plan.md:314).  
   Fix: Add these three fail-closed conditional asks.

## Implementability

11. A4/B5 use command fragments rather than executable commands; `fuel-testnet PRIVATE_RUNS=1` has invalid environment ordering, selectors/cwds are absent, and root `npm audit signatures` is not given a scratch npm lockfile.  
   Fix: Add a copy-paste command ledger with cwd, env-before-command, exact test files, candidate paths, expected outputs, and exit-code gates.