# Recon — `apps/faucet` → `apps/tools` (+ Faucet tab → Drip)

Base: `dev` @ `eca082ca`. Two read-only sweeps (identity/CI/precedent; semantic vocabulary/couplings), findings re-verified by hand where load-bearing. Master inventory command, reused as the plan's completeness gate:

```
git grep -n -i faucet -- ':!implementations-plan' ':!audit' ':!.claude/worktrees' ':!CHANGELOG.md'
```

≈714 hits / ≈155 tracked files at base. They split into four buckets that need **separate, deliberately scoped passes** — a blanket `sed s/faucet/tools/` is wrong in every bucket but the first.

## Reuse map

| Need | Existing code / tooling | Verdict |
|---|---|---|
| Move the workspace dir + keep history | `git mv` (precedent: `implementations-plan/monorepo-restructure/`, PR #186 moved `packages/{extension,faucet,…}` → `apps/*`) | reuse-as-is |
| Lockfile after a workspace path change | one non-frozen `bun install`; precedent gate = `git diff bun.lock` is member-path-only, zero version hunks (`monorepo-restructure/lessons/phase-2.md`) | reuse-as-is |
| Complexity-baseline manifest paths (10 entries under `apps/faucet/`) | `bun run baseline:complexity` regenerates from live Biome diagnostics; `scripts/complexity-baseline/check.ts` + `scripts/ci-cd/complexity-baseline.test.ts` red until the manifest matches | reuse-as-is |
| CI filter ↔ dependency-graph guard | `scripts/ci-cd/behavior-gating.test.ts` (`APPS` set line 19, `quick["faucet"]` test lines 104-106) | adapt (rename the set member + test) |
| Build-target honesty | `apps/faucet/scripts/verify-build-target.ts` via `verify:build-target`, wired into `_build-faucet.yml:52` | reuse-as-is |
| Live-site verification | `scripts/release/verify-live{,-run}.ts` — default URL already `https://testnet.tools.nulo.sh` | adapt (identifier names only) |
| Completeness proof | the master grep above, run to an allow-listed zero (precedent: three codex rounds each found more path readers than the hand inventory) | reuse-as-is |
| Dedicated rename helper | none — searched `scripts/`, `package.json` scripts, `.claude/skills/` for `rename`/`mv`/`codemod` | build nothing; hand `git mv` + scoped edits per bucket |

## Bucket A — app identity (rename-with-app, ≈120 sites)

**Workspace + tooling.** Root `package.json` scripts `dev:faucet`/`build:faucet`/`test:faucet`/`audit:faucet` (12,16,18,38); `apps/faucet/package.json:2` `@nulo/faucet`; `bun.lock` member `apps/faucet` (102-103), resolution key 732, six `@nulo/faucet/viem/…` sub-keys; `tsconfig.json:7`; `biome.json:16,342`; root `.gitignore:56-57`; `apps/faucet/.gitignore:4` + `apps/faucet/scripts/deploy-config.ts:57` (`.faucet-deploy-${network}/` operator-local data dir); `apps/faucet/vite.config.ts:20-23,156-157` (`FAUCET_DEV_PORT`, default 5176). No hits in `vitest.base.ts`, `bunfig.toml`, `renovate.json`, `CODEOWNERS`, `check-no-brand.sh`; `.worktreeinclude` does not exist.

**CI (contract surfaces in bold).** `_build-faucet.yml` — `--cwd apps/faucet` ×4, **artifact `faucet-dist-${target}`**, path `apps/faucet/dist`. `pr-quick.yml` — **`changes` outputs `faucet` (56) and `needs-faucet-build` (62)** (the first is read by `behavior-gating.test.ts`), filter block 109-126 (`apps/faucet/**` + `_build-faucet.yml` + six dep-lib globs), env `FAUCET` (163), job id `build-faucet` (271) + `needs.build-faucet.result` in the `status` aggregator (292, 305). `release.yml` — job `deploy-faucet` (394), **secret ref `CLOUDFLARE_FAUCET_DEPLOY_HOOK` (410)**, `verify-live` needs (428-432, advisory), `status` needs/results (548-585). `refresh-landing.yml` — **`workflow_dispatch` input `target` enum `both|landing|faucet`**. `pr-quick.yml` has `workflow_dispatch` (line 4) — the only dispatchable caller of the build reusable. **Never edit the `status`/`quality-status` job `name:`** (required-check-mismatch trap, `implementations-plan/required-check-mismatch/`).

**Scripts.** `scripts/release/chain-guard.ts:15` imports `apps/faucet/src/lib/chain-constants.ts`; `verify-live.ts` (`FaucetBuildJson`, `faucetHtml`, `"faucet: …"` messages), `verify-live-run.ts` (`faucetUrl`, `FAUCET_URL` env) + their three tests. `scripts/ci-cd/behavior-gating.test.ts:19,104-106`. `packages/bridge-core/scripts/**` — ≈40 literal `"apps/faucet/public/…"` / `"apps/faucet/src/contracts/…"` path strings across 15 files (`live-intent.ts`, `deploy-manifest.ts`, `drip-canary-testnet.ts`, `fee-juice-canary-testnet.ts`, `deploy-bridge-{mainnet,testnet}.ts`, `smoke-existing-{testnet,mainnet}.ts`, `verify-l1.ts`, `relay-claim-testnet.ts`, `deploy-canonical-private-fpc.ts`, `deploy-sandbox.ts`, `restore-swap.ts`, `script-l2.ts`, `script-bootstrap.test.ts`). `live-intent.ts promote` is a **live deployment-promotion tool**: a stale path there reads/writes the wrong manifest silently.

**Extension e2e harness (one coherent rename, six files in lockstep).** `apps/extension/scripts/e2e/agent.sh:60,64,210-211` (`FAUCET_PORT`/`FAUCET_URL`/`FAUCET_DEV_PORT`), `scripts/e2e/resolve-ports.ts:158-211` (`PortPack.faucet`, `faucetUrl`), `tests/e2e/global-setup.ts` (`FAUCET_DIR` 23, env 96-101, spawn 578-622, `project.provide("faucetUrl")` ×6, lock `pids.faucet`/`ports.faucet`), `tests/e2e/lockfile.ts:54-64`, `tests/e2e/reap.ts:29`, plus `apps/faucet/vite.config.ts` on the app side. These are plain env-var strings across a process boundary — a half-rename yields an `undefined` port, not a compile error. `.e2e-state/ports.json` is per-run and ephemeral; nothing writes a `faucet` key into `~/.agents/ports.md` (grep `.agents` across the harness: zero).

**Docs / prose.** `CLAUDE.md` (12 lines), `CI.md` (5), `ARCHITECTURE.md:229,231`, `UPDATE.md:40,46`, `apps/faucet/README.md` (title, commands, paths), `apps/faucet/tests/e2e/README.md`, `packages/{bridge-core,design,wallet-bridge,wallet-sdk-schema-patch}/README.md`, `.claude/skills/aztec-update/SKILL.md` (10 lines), comment-only mentions in `apps/extension/src/**` (≈12 files), `packages/design/src/**` (≈9 files), `packages/wallet-bridge/src/dispatcher.test.ts:1741`, `packages/wallet-sdk-schema-patch/src/apply.ts:5,11`, `packages/extension-messaging/src/errors.ts:199`, `apps/faucet/src/app.css:1-4`. No hits in `README.md`, `SECURITY.md`, `.github/README.md`, `apps/extension/tests/e2e/README.md`, `apps/landing/**`, `apps/playground/**`, `packages/{aztec-runtime,wallet-core,wallet-crypto,resolve-asset}/**`.

**Domain.** Already migrated by PR #319: `network-targets.ts:49,62` pins `testnet.tools.nulo.sh` / `tools.nulo.sh` (hostname-integrity layer 5); landing links, `FEE_JUICE_BRIDGE_URL`, `verify-live-run.ts:92` default all say `tools`. `faucet.nulo.sh` **does not resolve** (checked 2026-09-01). Remaining `faucet.nulo.sh` hits are prose only: `refresh-landing.yml:5,10`, `release.yml:432`, `CI.md:87`, `CLAUDE.md:472,616,617`, `apps/faucet/src/lib/chain-info.test.ts:19` (inert fixture URL). `nulo-faucet.pages.dev` survives only in fixtures (`build-integrity.test.ts:83,93`, `preview-hosts.test.ts:7-25`) beside already-migrated `nulo-tools.pages.dev` fixtures in the same file. The live preview-host shape is `<hash>.<project>.pages.dev`, project = `nulo-tools-testnet` / `nulo-tools-mainnet`; `cfBranchAliasHost` derives the project domain from `CF_PAGES_URL`, so no code pins the slug. No CSP rule is domain-name based (`connect-src` lists RPC hosts only; no `public/_headers` source exists — the README/skill text claiming one is a pre-existing inaccuracy).

**External state the repo cannot change.** (1) Cloudflare Pages root directory on `nulo-tools-mainnet` and `nulo-tools-testnet` is `apps/faucet` (dashboard-only; the monorepo-restructure's one genuinely external gotcha, codex F5). A failed Pages build keeps the previous deployment live, so a mis-sequenced flip degrades to "no new deploys", not an outage. (2) `CLOUDFLARE_FAUCET_DEPLOY_HOOK` — `gh secret list` shows it **does not exist** (only `CLOUDFLARE_PAGES_DEPLOY_HOOK`, the landing's); the release job already skips when unset. Renaming the reference is code-only. `tools.nulo.sh` currently answers with a 302 to a Cloudflare Access login (observed from the homelab; owner to confirm intended).

## Bucket B — Faucet tab / drip feature (rename-with-feature → "Drip", ≈40 sites)

Owner decision 2026-09-01: tab → **Drip**. "drip" is already the protocol-level verb (`Dripper` contract, `drip_to_public/private`, `useFaucetDrip().drip()`, testids `btnDripPublic`), so this converges vocabulary rather than adding a third. "Mint" was rejected: it already names the Bridge tab's L1 test-USDC mint (`MintTestUsdc.vue`, testids `mintL1*`), the Fuel tab's asset mint, and the extension's `type === "mint"` tx class.

| Site | Today | Target |
|---|---|---|
| `App.vue:16,21-26,33,43-48,83,87` | `type Tab = "faucet" \| …`, button copy "Faucet" | `"drip"`, "Drip" |
| `views/FaucetView.vue` (+ test) — h1 already "DRIP TEST ASSETS"; copy "Internal faucet. No real value." | | `DripView.vue`; copy "Internal drip. No real value." (or keep sentence, owner's call at review) |
| `composables/useFaucetDrip.ts` (+ test), `__resetFaucetDripForTests` | | `useDrip.ts`, `__resetDripForTests` |
| `composables/useFaucetAddToken.ts` (+ test) | | `useAddDripToken.ts` |
| `constants/tokens.ts:11,18,23` `FAUCET_TOKENS`/`findFaucetToken`/`FaucetToken` | | `DRIP_TOKENS`/`findDripToken`/`DripToken` |
| `lib/testids.ts:80` `tabFaucet: "fa-tab-faucet"` | | `tabDrip: "<prefix>-tab-drip"` |
| `components/WalletPanel.vue:106` "This faucet works with any wallet…" | | "This drip works with…" → better: "Works with any wallet that speaks the Aztec Wallet SDK." |
| `lib/capabilities.ts:84,227` `metadata.name: "nulo-faucet"`, descriptions 85-86, 228-229 | | `"nulo-tools"` (app identity — shown in the wallet's approve popup); `nulo-bridge` (148) unchanged |
| `composables/useWalletConnection.ts:22` `APP_ID = "nulo-faucet"` | | `"nulo-tools"` + one-time legacy-key fallback (below) |
| `tests/e2e/faucet-smoke.test.ts:221` literal `nulo-faucet:preferred-wallet` | | new key + a legacy-key case |
| `packages/bridge-core/src/promotion.ts:6-30` `FaucetCandidateShape`/`assertFaucetCandidateShape` + error strings; `scripts/live-intent.ts:618,620` `mode: "bridge+faucet"`, summary key `faucet:` | validates the drip deployment (`tokens[]` + `dripper`) | `DripCandidateShape`/`assertDripCandidateShape`, `"bridge+drip"`, `drip:` — identifier/string only, **zero schema impact** (the JSON has no `faucet` key); no in-repo consumer of the summary key (grep `bridge+faucet`, `\.faucet\b` in scripts: only the emitter) |
| `packages/design/src/composite/DripButton.vue` | already "Drip" | unchanged |

`APP_ID` is also passed into `@aztec/wallet-sdk` (`getAvailableWallets({ appId })`, `establishSecureChannel(appId)`, `createAztecWalletSession.ts:390-394,490`). Wallet-side grants are keyed by `(origin, chainId, profileId)` (`packages/wallet-bridge/src/session-types.ts:47-59`), never by `appId`/`metadata.name`, so renaming does not invalidate grants; what the SDK does with `appId` beyond discovery labelling is not provable from this repo → connect/disconnect/reconnect against a real Nulo build is a gate. The `localStorage` keys `${appId}:preferred-wallet` / `${appId}:selected-accounts` (`createAztecWalletSession.ts:133,135`) are user state — a rename without a fallback forgets returning users' wallet/account choice.

**testid prefix.** `lib/testids.ts` header: "The `fa-` prefix mirrors the playground's `pg-` convention" — app identity, ≈95 constants. Consumers: only `apps/faucet/tests/e2e/faucet-smoke.test.ts` via `TESTIDS.*` (never literals; grep `fa-` across `apps/extension/tests/e2e/**`: zero). So a prefix flip is a one-file edit plus the template `data-testid` literals? No — components import the constants (file header) → verify with `git grep -n '"fa-' -- apps/faucet/src ':!lib/testids.ts'` during implementation; any literal found is a bug to fold into the constant.

## Bucket C — keep (semantic vocabulary a sweep must not touch)

- `Dripper`, `drip_to_public/private`, `DripperContractArtifact` — external `@aztec-foundation/aztec-standards`.
- `apps/faucet/src/contracts/deployments{,.candidate}.json` and `apps/faucet/public/{testnet,mainnet}-bridge{,.candidate}.json` — on-chain records; field names (`tokens`, `dripper`, `l1`, `l2`, `fuel`) contain no `faucet`; content must not pass through any substitution.
- `packages/bridge-core/src/candidate-schema.ts` — no `faucet` key exists (the test's `"faucet"` at `candidate-schema.test.ts:13` is a fixture string; check at implementation whether it is a network label or a filename).
- `contracts/bridge/evm/**/*.sol` NatSpec ("faucet token") — **editing even a comment changes the metadata hash and breaks Etherscan re-verification** (`implementations-plan/bridge-evm-verification/plan.md` item 9). Hard keep. `contracts/bridge/{aztec,evm}/README.md` prose may change.
- Icon key `"faucet"` in `packages/design/src/internal/icons.json:14` and `apps/extension/src/assets/icons.json:14` (byte-identical copies) + consumer `TransactionCard.vue:61` (`type === "mint"` → icon `"faucet"`) — a generic tap glyph in wallet vocabulary; keep. `useLogFilters.ts:13` `LOG_SOURCES` entry `"faucet"` — vestigial (no emitter); leave, not in scope.
- `apps/extension/src/utils/tx-enrichment.test.ts:188` `name: "Faucet"` — dApp-supplied fixture; cosmetic, optional.
- `nulo:theme` storage key, chain-identity constants in `chain-constants.ts` (values pinned by `scripts/release/chain-guard.ts`).
- `CHANGELOG.md` (release-please/git-cliff generated — `tools:` is already a live commit scope beside `faucet:`), every `implementations-plan/**` and `audit/**` file (frozen point-in-time records).

## Bucket D — precedent lessons that transfer (monorepo-restructure #186)

1. `git mv` commit first, content edits in separate commits; the lockfile regen is its own reviewable hunk.
2. Prove repathed lint globs still bind (introduce a known violation under the new path, see it caught, revert).
3. Repath `_lint-and-typecheck.yml`-style forbid-grep scopes together with the build reusables — a stale scope silently stops a security lint from scanning the moved code (blocking codex finding last time). Check every workflow `grep`/`rg` invocation for `apps/faucet`.
4. Files with `import.meta.url`-relative paths to sibling packages (`app.css.parity.test.ts`, `theme-vars.test.ts` → `packages/design`) survive a same-depth move; verify by running them, not by reading.
5. Live docs updated, archives frozen.
6. The final zero-hit grep gate is the only inventory that has ever been complete.
7. Cloudflare Pages root directory is dashboard state; the deploy hook returns 2xx against a stale root and `verify-live` is advisory — the flip must be an explicit, owner-executed checklist item with a verification step.

## Collision risks (naive `git mv` + `sed`)

1. Blanket `faucet→tools` renames the drip feature (Bucket B) into nonsense (`ToolsView`, `TOOLS_TOKENS`) and misses everything already spelled "drip" — two passes, two vocabularies.
2. `.sol` files — verification break (Bucket C).
3. `icons.json` key / `TransactionCard.vue` — wallet vocabulary, not the app.
4. `bridge-core/scripts` path literals must land in the same commit as the `git mv`; `live-intent.ts promote` is live tooling.
5. Env-var rename across the e2e harness must be atomic across six files.
6. `pr-quick.yml` output key ↔ `behavior-gating.test.ts` ↔ job id ↔ `status.needs` — one coordinated edit; `status`'s own `name:` untouchable.
7. `CLOUDFLARE_*_DEPLOY_HOOK` and the Pages root dir live outside the repo.
8. `bun.lock` regen is the one step where an unrelated version bump could ride in — gate on path-only diff.
9. `APP_ID` change without a storage fallback silently forgets user preferences.
10. `.faucet-deploy-*` local deployer data dir — operators with an existing dir must rename it or re-derive (testnet deploy tooling only; note in the app README).

## In-flight work touching `apps/faucet` (2026-09-01)

- `faucet-cluster` (complexity burn-down PR-a/PR-b inside `apps/faucet`, plan drafted, zero commits) — **owner decision: lands first**; this plan rebases onto post-merge `dev` before implementation. Its manifest entries (`createAztecWalletSession.ts`, `useFuel.ts`, `fuelClaim.ts`, `bridge-steps.ts`, `useL1FeeAsset.ts`, `useWithdraw.ts`) will already have shrunk; the baseline regen here is path-only over whatever remains.
- `aztec-5.2.0-js-line` (PR #471, 1 commit in `apps/faucet`) — rebases across the rename with `git mv` detection; conflicts are content-vs-rename, usually auto-resolved.
- `account-artifact-freeze` — already shipped, stale worktree.
