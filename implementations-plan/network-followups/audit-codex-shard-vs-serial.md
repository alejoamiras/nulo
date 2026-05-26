Verdict: **quarantine is right**

Your analysis is **mostly correct**.

1. `register-token` did not exist in the earlier green PR #55 runs. It was added later by [f3eb249](../../.git/COMMIT_EDITMSG) (`feat(faucet,extension): one-click "add to wallet" via registerToken RPC (#50)`).

2. `origin/dev` is effectively **serial + unsharded + retry: 0**:
   - [origin/dev:.github/workflows/pr-network-e2e.yml](../../.github/workflows/pr-network-e2e.yml) calls the reusable workflow once, with no matrix.
   - [origin/dev:.github/workflows/_network-e2e.yml](../../.github/workflows/_network-e2e.yml) runs plain `bun run e2e:agent` with no `--shard`.
   - [origin/dev:packages/extension/vitest.e2e.network.config.ts](../../packages/extension/vitest.e2e.network.config.ts) has no `retry` key.
   So yes: on `dev`, `register-token` runs later in one long warmed process.

3. This branch is what introduced the cold-start exposure:
   - [pr-network-e2e.yml](../../.github/workflows/pr-network-e2e.yml) creates a 5-shard matrix.
   - [_network-e2e.yml](../../.github/workflows/_network-e2e.yml) passes `bun run e2e:agent --shard=${{ inputs.shard }}`.
   - [vitest.e2e.network.config.ts](../../packages/extension/vitest.e2e.network.config.ts) adds `retry: 2`.
   So the failure is not “we broke a previously-green register-token”; it is “we added a new cold-path test, then changed execution topology so that cold-path is exposed.”

4. Two corrections:
   - `shard 5` is **not** “last” in CI time. All five jobs start in parallel. Renaming the file to land on `5/5` would only matter if that shard’s **internal file order** happens to put warmer tests before it.
   - Renaming to force a shard is a brittle hash hack. It may work today and break on the next file add/remove.

5. Non-quarantine fixes are not merge-path quality:
   - Fixture warm-up tap: possible, but to warm the right code you’d need to exercise the same slow capabilities/execute path, which mutates state and is not a safe 10-line tweak.
   - `pool: "threads"` is the wrong lever. The coldness is per shard’s sandbox/SW/PXE path, not a lack of JS worker sharing.

Single concrete next step:
- Quarantine `register-token.test.ts` under the deferred-slow guard now, open Issue #59 for either fixture pre-granting or splitting the test into “cap grant” and “register token execute,” and merge.
