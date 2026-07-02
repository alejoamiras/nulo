# Fable (Opus 4.8) audit — aztec-5.0-rc2 (mid)

Round 1 plan-audit (agent `a721d6e…`, read-only, Fable unavailable → Opus 4.8).

**Verdict: `conditional approve`** (conditions: add the Noir `Nargo.toml` tag re-pins to Scope/Phase 2; add the 3 `nulo-schema-patch.ts` guards to the touched-surface list; fix the "7 package.json" count + pre-commit the accelerator-availability check).

### Findings (paths repo-relative) + disposition

- **CONFIRMED — the load-bearing pivot holds.** network-e2e fresh-deploys: `apps/extension/tests/e2e/fixtures/aztec.ts:108-121` (`deployTestToken` → `deployWithOpts().send()`, address from the instance; `SponsoredFPC` salt=0; `LOCAL_NODE_URL`). Zero hardcoded live addresses → a class-id shift can't brick the *network* gate. **The plan's "gate on e2e + redeploy out" is coherent *for the network path*.** (Round-1 codex then showed the LIVE path — `verify:deployments` — is where drift bites; both folded.)
- **HIGH — class-id assessment unsound without the Nargo tags.** `contracts/bridge/aztec/{token_bridge,keystone,token_minter_proxy}/Nargo.toml` pin `tag = "v5.0.0-rc.1"`; recompiling without bumping them re-derives against rc.1 → false "no shift." → **ADOPTED** (also a codex Critical).
- **HIGH — committed artifacts entangle assess/act.** `token_bridge`/`token_minter_proxy` have committed `target/*.json` (rc.1 paths); `keystone` has none (only 2 of 3 compiled). Recompiling rewrites them. → **ADOPTED:** Scope commits the re-derived artifacts (compiled output ≠ redeploy); keystone compiled too. Verified: `keystone/target` absent.
- **MED — 3 schema-patch runtime guards.** `apps/{extension,faucet,playground}/…/nulo-schema-patch.ts` throw at init on a moved `WalletSchema.registerToken` shape (zod-v4 internals); `typecheck` misses it, `test:all` catches it. → **ADOPTED** into Scope + Security.
- **MED — accelerator age.** rc.2 accelerator is ~1 day old; the fallback SHA-pins a <7-day binary (name-excluded, fine) — confirm the release exists. → **ADOPTED:** Phase 3.2 confirms existence first.
- **LOW — count.** 7 package.json carry pins (landing + wallet-core = 0). → **ADOPTED:** enumerated in Fact #1.
- **LOW — storage-migration twin.** `ARCHITECTURE.md:99` `CURRENT_VERSION=8` bumped for the rc.1 derivation hard-fork; a drift implies a v9 migration, not just a redeploy. → **ADOPTED:** folded into the drift → `deep` follow-up scope.

**Looks fine:** patches package.json-only; supply-chain stack (exact pins + frozen CI + extracted-binary SHA); `--filter '@nulo/*'` gates cover the apps; `@aztec/viem` excluded; Storybook design-token-only; cheap-first defensible.
