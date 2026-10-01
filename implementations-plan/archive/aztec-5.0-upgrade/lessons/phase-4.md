# Phase 4 — faucet + playground ✓ (code) — bfcd72b4, 919e67eb, 9c25d797, 6ef2b54d

- Schema-patch 3rd copy (faucet/playground) fixed via the zod-v4 migration (P3 commit 633aa1ca).
- `getProvenBlockNumber` → `getBlockNumber("proven")` (useWithdraw); `ProtocolContractAddress.AuthRegistry` (demoted) → `STANDARD_AUTH_REGISTRY_ADDRESS` (capabilities.ts).
- DeployMethod construction-time: `Contract.deploy(w, artifact, args, ctorName, { salt, universalDeploy })` (5th-arg instantiation options); `salt`/`universalDeploy` removed from `.send()`; `wait: { waitForStatus }` still valid. (deploy.ts:217)
- L1 withdraw decode (useWithdraw verifyConsumeIdentity): the 5.0 portal `withdraw` is `(recipient, amount, withCaller, epoch, numCheckpointsInEpoch, leafIndex, path)` — `leafIndex` moved to position 5; the old decode read `numCheckpointsInEpoch` AS leafIndex. Fixed the destructure + cast.
- `EmbeddedWallet.create({ pxeConfig })` — UNCHANGED in 5.0 (typechecks fine; no rename needed).
- `deployments.json` re-pinned to the 5.0 deterministic Dripper/NULO/OLUN addresses (recompiled standards → new class-ids → new addresses). Regenerated offline via `deploy:testnet:dry`; `verify:deployments` green.
- The 5 faucet `Bridge*.test.ts` files were blocked on the stale 4.2.0 `TokenMinterProxy` artifact → unblocked by the P5 Noir recompile.
- Gate: faucet typecheck 0 + 336 tests + lint + verify:deployments all green.
