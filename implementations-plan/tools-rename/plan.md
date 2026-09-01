# tools-rename — `apps/faucet` → `apps/tools`, Faucet tab → Drip

**Tier:** `light` · **Worktree:** `tools-rename` (branch `worktree-tools-rename`) · **Base:** `dev` @ `eca082ca` (re-based onto post-`faucet-cluster` `dev` before Phase 1) · **Recon:** [recon.md](recon.md) · **Audit:** [audit-codex.md](audit-codex.md) (round 1 `reject` → v2 folded every finding → round 2 `conditional approve`, conditions folded → v3, this file) · **eli5_mode:** Artifact · **Budget:** recon 2 agents (done), `/code-review low` per arc, codex loop ≤3 rounds.

## Goal

Close two-cycle-old naming debt. The product has been "tools" since PR #319 (domain `tools.nulo.sh`, Cloudflare Pages projects `nulo-tools-{mainnet,testnet}`, `tools:` commit scope) but the repo still says `faucet` in every identity position: the workspace dir and package, root scripts, the build reusable, CI job/output names, the release deploy job, the e2e harness, release scripts, the build-target types, the wallet-sdk app id, docs. Separately, the in-app "Faucet" tab (testnet-only token drips) becomes **Drip**, converging on the verb the contract (`Dripper.drip_to_*`), the composable, the testids and the copy already use.

**Done means:** the master grep (below) returns only the reviewed allow-list; both Pages projects serve a build whose `build.json` `sha` is the post-merge head; every gate in §Phases is green; returning users of `tools.nulo.sh` keep their remembered wallet and account choice and can still forget them.

Master grep (identity residue; the allow-list is reviewed per phase, never auto-derived):

```
git grep -n -i faucet -- ':!implementations-plan' ':!audit' ':!.claude/worktrees' ':!CHANGELOG.md'
```

## Owner decisions (2026-09-01)

1. Scope = app identity + purge stale `faucet.nulo.sh` prose + CF-side checklist + rename the in-app tab.
2. Tab name → **Drip** ("Mint" rejected: already names the Bridge tab's L1 test-USDC mint and the extension's `mint` tx class).
3. `faucet-cluster` (complexity burn-down inside `apps/faucet`, two commits so far, refactoring `createAztecWalletSession` into controllers) **lands first**; this plan is drafted now, implemented after.
4. Rename lands before every other branch; the owner rebases live branches (`aztec-5.2.0-js-line` #471 has one `apps/faucet` commit).
5. Validation layers: `audit:tools` + `lint:actions` on every phase; both network builds + `verify:build-target`; extension smoke e2e; a `workflow_dispatch` of `pr-quick.yml` on the branch before the PR opens.
6. Tier `light`.

## Scope

**Arc 1 — app identity (recon Bucket A, plus the identity items codex moved out of Bucket B):** dir, package, root scripts, `tsconfig`/`biome`/`.gitignore`, lockfile, baseline manifest, the six-file e2e harness + `vite.config.ts` port var, `bridge-core/scripts` path literals (incl. the split `join(…, "apps", "faucet", …)` forms in `candidate-schema.test.ts:7-16` and `fuel-testnet.ts:54`), CI (`_build-faucet.yml` → `_build-tools.yml`, `pr-quick.yml` outputs/filter/job/`status.needs`, `release.yml` `deploy-tools` + secret ref, `refresh-landing.yml` enum), release scripts, build-target identity (`FaucetTarget`/`FaucetTargetKey`/`resolveFaucetTarget`/`makeFaucetConfig`/`TARGETS` typing → `ToolsTarget`…; `VITE_FAUCET_TARGET` → `VITE_TOOLS_TARGET` in `vite.config.ts:166`, `env.d.ts:8`, `network.test.ts:26`; `FAUCET_TARGET` env → `TOOLS_TARGET` in `verify-build-target.ts:18`), `deploy.ts:55` logger namespace `tools:deploy`, `.faucet-deploy-*` data dir, testid prefix `fa-` → `tl-`, `APP_ID`/`metadata.name` `nulo-faucet` → `nulo-tools` with a two-key storage migration, fixture hosts, `.env.example:29`, `theme-boot.js:3`, docs.

**Arc 2 — Drip vocabulary (Bucket B minus identity):** tab id `"faucet"` → `"drip"`, `FaucetView.vue` → `DripView.vue`, `useFaucetDrip` → `useDrip`, `useFaucetAddToken` → `useAddDripToken`, `FAUCET_TOKENS`/`findFaucetToken`/`FaucetToken` → `DRIP_*`/`DripToken`, `deploy-config.ts` `FaucetTokenConfig`/`FAUCET_TOKEN_CONFIGS` → `DripTokenConfig`/`DRIP_TOKEN_CONFIGS`, `capabilities.ts` `FaucetManifestInput`/`buildFaucetManifest` → `DripManifestInput`/`buildDripManifest` + descriptions ("Drip + Bridge on Aztec - Nulo"), testid suffix `tabFaucet: "tl-tab-faucet"` → `tabDrip: "tl-tab-drip"`, `promotion.ts` `assertFaucetCandidateShape` → `assertDripCandidateShape` (+ error strings), `live-intent.ts:618,620` `"bridge+drip"` / `drip:`, UI copy (tab label "Drip"; `WalletPanel.vue:106` "Works with any wallet that speaks the Aztec Wallet SDK."; `FaucetView` "Internal drip. No real value."), `index.html` title/description if not already done in arc 1 (it is app identity → arc 1: `<title>Aztec Tools · Nulo</title>`).

**Keep list (grep allow-list):** `contracts/bridge/evm/**/*.sol` (conservative — metadata hash → Etherscan verification; codex notes scripts/tests may not be verification inputs, keeping all is still the safe default), `icons.json` key `faucet` ×2 + `TransactionCard.vue:61`, `useLogFilters.ts:13`, `Dripper`/`drip_to_*` (external), every deployment/manifest JSON's content, `CHANGELOG.md`, `implementations-plan/**`, `audit/**`, `tx-enrichment.test.ts:188` fixture, `nulo-bridge` manifest name, generic prose describing the concept ("faucet-style mint", `useL1Usdc.ts:52`; "Internal faucet" style sentences are copy → arc 2 decides per line).

**Not touched by design:** `network-targets.ts` host VALUES, CSP, chain constants, `status`/`quality-status` job names, required-check config (`quality-status`, `network-e2e-status`, `smoke-e2e-status` — none renamed), `bunfig.toml`, `renovate.json`, release-please/git-cliff config (scoped to `apps/extension`, verified by codex).

## Architecture & Implementation (compact — light tier)

**Shape.** No new components. Arc 1 is ONE coherent implementation phase (every path/name consumer moves together so no intermediate state contradicts a gate), then a proof phase (CI + builds), then docs. Arc 2 is the Drip vocabulary. Phase 5 is the owner's dashboard cut-over.

**Mechanics.**

- *Lockfile gate (structural transform-and-compare, not keyword grep, not line sort).* Bun's text lockfile records are `["pkg@version", registry, {deps}, "sha512-…"]` with no `version`/`integrity` keys (field grep is porous) and the file is nested JSONC (a line-multiset compare loses object ownership). Gate: apply exactly the two substitutions to the pre-rename lockfile, parse both the way `scripts/lockfile-exception-diff.ts:15-18` already does (strip trailing commas → `JSON.parse`), recursively sort object keys, keep array order, deep-compare:
  ```
  git show <pre-rename-sha>:bun.lock | sed -e 's#apps/faucet#apps/tools#g' -e 's#@nulo/faucet#@nulo/tools#g' > "$TMPDIR/lock.expected"
  bun -e 'const s=t=>JSON.parse(t.replace(/,(\s*[}\]])/g,"$1"));const k=v=>Array.isArray(v)?v.map(k):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(x=>[x,k(v[x])])):v;const [a,b]=await Promise.all([Bun.file(process.env.TMPDIR+"/lock.expected").text(),Bun.file("bun.lock").text()]);const ok=JSON.stringify(k(s(a)))===JSON.stringify(k(s(b)));console.log(ok?"LOCK OK":"LOCK DIFF");process.exit(ok?0:1)'
  bun scripts/lockfile-exception-diff.ts "$TMPDIR/lock.expected" bun.lock   # exceptions/added/removed all []
  bun install --frozen-lockfile                                             # exit 0
  ```
- *Baseline manifest gate.* `scan.ts:118-129` classifies a renamed path as growth (`apps/tools/... 0 → N`), so plain regeneration refuses (`generate.ts:107-115`). Run `bun run baseline:complexity -- --adopt`, then prove the adopt did nothing but re-key: (a) the ONLY file changed by the command is the manifest — `git status --porcelain` after the run lists `scripts/complexity-baseline/manifest.json` and nothing else (`--adopt` may insert directives into source before it writes the manifest, `generate.ts:71`); (b) the manifest equals the pre-rename manifest with the path swapped, ignoring the always-rewritten `generated` date (`generate.ts:118`):
  ```
  git show <pre-rename-sha>:scripts/complexity-baseline/manifest.json | sed 's#apps/faucet/#apps/tools/#g' > "$TMPDIR/manifest.expected"
  diff <(jq -S 'del(.generated)' "$TMPDIR/manifest.expected") <(jq -S 'del(.generated)' scripts/complexity-baseline/manifest.json)   # empty
  ```
- *CI contract.* One coordinated edit: `pr-quick.yml` outputs `faucet`→`tools`, `needs-faucet-build`→`needs-tools-build`, filter key + globs (`apps/tools/**`, `_build-tools.yml`), env `FAUCET`→`TOOLS`, job id `build-faucet`→`build-tools` (+ name), `status.needs` + its result loop; `_build-tools.yml` (`--cwd apps/tools` ×4, artifact `tools-dist-${target}`, path `apps/tools/dist`); `behavior-gating.test.ts` `APPS` member, `quick["tools"]` coverage test, PLUS three durable pins codex asked for: `changes` outputs contain `tools` and `needs-tools-build`, `jobs["build-tools"].if` references `needs-tools-build`, `jobs.status.needs` includes `build-tools`. `release.yml`: `deploy-faucet`→`deploy-tools`, `secrets.CLOUDFLARE_FAUCET_DEPLOY_HOOK`→`CLOUDFLARE_TOOLS_DEPLOY_HOOK` (stays unwired; the notice text updated), `verify-live` + `status` needs/results. `refresh-landing.yml` input enum `both|landing|tools`, its explicit-target fail-loud branch kept as is. Every workflow shell step grepped for `apps/faucet`/`faucet` (precedent B1 hole). `status`/`quality-status` `name:` untouched.
- *e2e harness.* Atomic rename across `agent.sh`, `resolve-ports.ts` (+ its test), `global-setup.ts`, `lockfile.ts`, `reap.ts`, `apps/tools/vite.config.ts`, plus the comment at `apps/extension/tests/e2e/network/register-token.test.ts:23-25` (names `FAUCET_DEV_PORT` + `faucetUrl`): `FAUCET_DEV_PORT`→`TOOLS_DEV_PORT`, `FAUCET_PORT`/`FAUCET_URL`→`TOOLS_*`, `PortPack.faucet`/`faucetUrl`→`tools`/`toolsUrl`, `project.provide("toolsUrl")` + `ProvidedContext`, lock `ports.tools`/`pids.tools`, `FAUCET_DIR`→`TOOLS_DIR`. Proof = `git grep -n -i faucet -- <those eight files>` → 0, plus run `bun apps/extension/scripts/e2e/resolve-ports.ts` (stdout is a summary) and then `jq -e '.tools and .toolsUrl and (has("faucet")|not) and (has("faucetUrl")|not)' apps/extension/.e2e-state/ports.json`. The smoke suite uses `global-setup-smoke.ts`, not this harness; the network suite is the runtime consumer and is not re-run for a rename — the grep + the written-file check are the proof.
- *Build-target identity + host pin.* Rename the types/functions/env var (define-injected, not a Pages env var — safe). Add a direct pin in `network-targets.test.ts` (or `build-integrity.test.ts`): `TESTNET_TARGET.host === "testnet.tools.nulo.sh"`, `MAINNET_TARGET.host === "tools.nulo.sh"` — today the tests duplicate the hosts and `verify-build-target` checks target/chainId/digest only, so an edit to the real pins is invisible to every gate.
- *bridge-core scripts.* All path literals (≈40 `"apps/faucet/…"` strings + the two `join(…,"apps","faucet",…)` forms) in the SAME commit as the `git mv` (`live-intent.ts promote` is live tooling).
- *Wallet-sdk app id + storage migration (arc 1).* `APP_ID` `"nulo-faucet"` → `"nulo-tools"` (`useWalletConnection.ts`), `metadata.name` in `buildFaucetManifest` and `buildCombinedManifest` → `"nulo-tools"` (`nulo-bridge` unchanged). The SDK carries `appId` in discovery, on the session and in every wallet call; Nulo keys grants by `(profile, origin, chain)` and displays `discovery.appName ?? discovery.appId` (`apps/extension/src/wallet/services/wallet-sdk/background.ts:656`) — so today Nulo can show users the literal `nulo-faucet`. Third-party wallets may treat the renamed id as a new dApp (one re-approval, no funds or state at risk) — Ask A5. Storage: `createAztecWalletSession(config)` gains `legacyAppId?: string`; `readPreferred()` and `readRememberedMap()` read the new key first, then the legacy key; a successful remembered connection that was restored from the legacy key writes the new key (one-time migration; today the remembered path deliberately never re-writes); `clearPreferred()` removes BOTH keys (a bad legacy preference must not survive "forget wallet" or a failed remembered connect); map writes land on the new key only. `useWalletConnection.ts` passes `legacyAppId: "nulo-faucet"`. Parsing is the existing guarded parse. `faucet-cluster` is splitting this factory into controllers — implement against the post-rebase shape; the behaviour list above is the contract, not the line numbers. Tests (unit, in the factory's test file): legacy-only preferred → restored; both → new wins; remembered success from legacy → new key written; clear → both keys removed; malformed legacy → null; legacy-only map → used, write lands on new key. `tools-smoke.test.ts:221` seeds the new key and gains one legacy-key case.
- *Testids.* `lib/testids.ts` prefix `fa-`→`tl-` (one file). Guard: `git grep -n '"fa-' -- apps/tools` → 0 (any template literal is folded into the constant first). The only consumer is `apps/tools/tests/e2e/tools-smoke.test.ts`, via the constants.
- *Drip rename (arc 2).* Files via `git mv`, then symbols, tab literal (8 sites in `App.vue`), copy, `tabDrip`, manifest builder names + descriptions, `deploy-config.ts` token config names, `promotion.ts` + `live-intent.ts` strings.

**File-level change map.** recon Buckets A + B with the arc split above; deleted: `_build-faucet.yml` (renamed). Added: `legacyAppId` option + its tests, the host pin, the three CI pins.

**Alternatives not taken.** (a) One PR — codex prefers it (arc 1 is not independently revertible once the Pages root moves, and the intermediate allow-list is fuzzy). Kept two because arc 2 IS independently revertible and a reviewer sees a `git mv`-clean identity PR; the identity/vocabulary split is now exact (Ask A3). (b) Keyword-grep lockfile gate — rejected after audit (porous). (c) Plain baseline regen — impossible (growth refusal); `--adopt` + transform-diff instead. (d) One-key storage fallback — rejected after audit (second namespace, no re-write, `clearPreferred` asymmetry). (e) Keep `nulo-faucet` on the wire — rejected: it is the user-visible label in Nulo's own approve flow; the cost of renaming is at most one re-approval in a third-party wallet. (f) Rename the icon key / `TransactionCard` vocabulary — out of scope (wallet vocabulary).

## Phases

### Phase 0 — Precondition + rebase ✓ (2026-09-01, pre-rename sha `01d06692`)

Wait for `faucet-cluster` PR-a and PR-b to merge to `dev`. `git fetch origin dev && git rebase origin/dev`, `bun install --frozen-lockfile`, re-run the master grep and record the fresh counts + the pre-rename sha (`git rev-parse HEAD`) in `lessons/phase-0.md` — every transform-diff gate below reads from that sha.

**Validation gate.** `git merge-base --is-ancestor <faucet-cluster PR-b squash sha> HEAD` exit 0 · `bun install --frozen-lockfile` exit 0 · `bun run lint` exit 0. Layers: lint.

### Arc 1 — App identity

#### Phase 1 — The identity rename (one coherent change set) ✓ (2026-09-01, commits `ef67ec23`…`d7144349`, gate in lessons/phase-1.md)

Commits, in order, each leaving the tree lint-clean where possible:
1. `git mv apps/faucet apps/tools`, `git mv .github/workflows/_build-faucet.yml .github/workflows/_build-tools.yml`, `git mv apps/tools/tests/e2e/faucet-smoke.test.ts apps/tools/tests/e2e/tools-smoke.test.ts` + EVERY literal path consumer (root scripts `--cwd`, `tsconfig.json`, `biome.json:16,342`, root `.gitignore`, `bridge-core/scripts` literals + split forms, `chain-guard.ts` import, `_build-tools.yml` `--cwd`/artifact path, `pr-quick.yml` globs + `_build-tools.yml` reference, `behavior-gating.test.ts` filename assertion).
2. Names: `@nulo/tools`; scripts `dev:tools`/`build:tools`/`test:tools`/`audit:tools`; CI outputs/job ids/env/`status.needs`; `release.yml` job + secret ref; `refresh-landing.yml` enum; harness env/field names; `vite.config.ts` port var; build-target types/functions/`VITE_TOOLS_TARGET`/`TOOLS_TARGET`; `deploy.ts` logger ns; `.tools-deploy-*` (+ `apps/tools/.gitignore`); release-script identifiers (`ToolsBuildJson`, `toolsHtml`, `toolsUrl`, env `TOOLS_URL`); `behavior-gating.test.ts` `APPS` member + the three CI pins; fixture hosts `nulo-faucet.pages.dev` → `nulo-tools-testnet.pages.dev` (`build-integrity.test.ts:83,93`, `preview-hosts.test.ts:7-25`) and `chain-info.test.ts:19`; `index.html` title/description; `.env.example:29`, `theme-boot.js:3`, `app.css:1-4` prose.
3. `bun install` (non-frozen) → lockfile transform-diff gate.
4. `bun run baseline:complexity -- --adopt` → manifest transform-diff gate.
5. Host pin test (red before the pin exists only if hosts were wrong — it is a regression pin, commit it green).
6. `APP_ID`/`metadata.name` → `nulo-tools` + `legacyAppId` migration + tests (tests first).
7. testid prefix `fa-` → `tl-`.
Lint-glob probe: add a `viem/chains` import under `apps/tools/src/` (the `biome.json:342` override), see `bun run lint` red, revert.

**Validation gate.** lockfile gate empty diff + `bun install --frozen-lockfile` exit 0 · manifest gate empty diff · `bun run typecheck:all` · `bun run lint` · `bun run test:tools` · `bun run --cwd apps/tools test:e2e` (jsdom smoke incl. the legacy-key case) · `bun run --cwd packages/bridge-core test` · `bun run --cwd apps/extension test` · `bun run test:ci-gating` · `bun run lint:actions` · `bun run --cwd apps/tools verify:deployments` · resolve-ports written-file `jq -e` check exits 0 · residue greps, all 0 lines: `git grep -n 'apps/faucet' -- ':!implementations-plan' ':!audit' ':!.claude/worktrees' ':!CHANGELOG.md'`; `git grep -n -E 'FAUCET_(DEV_PORT|PORT|URL|DIR|TARGET)|VITE_FAUCET|faucetUrl|pids\.faucet|ports\.faucet|FaucetTarget|resolveFaucetTarget|makeFaucetConfig|@nulo/faucet|"fa-' -- ':!implementations-plan' ':!audit' ':!.claude/worktrees' ':!CHANGELOG.md'`; `git grep -n -i faucet -- .github scripts apps/extension/scripts/e2e apps/extension/tests/e2e/global-setup.ts apps/extension/tests/e2e/lockfile.ts apps/extension/tests/e2e/reap.ts apps/extension/tests/e2e/network/register-token.test.ts apps/tools/vite.config.ts` · exact allow-list for the permanent legacy literal: `git grep -c 'nulo-faucet' -- apps/tools` lists ONLY `apps/tools/src/composables/useWalletConnection.ts` (1 — the `legacyAppId` value), the session factory's unit-test file, and `apps/tools/tests/e2e/tools-smoke.test.ts`; any other file is a miss. Layers: typecheck/lint, unit, jsdom e2e, ci-gating.

#### Phase 2 — Proof in real builds and real CI

Local: `bun run --cwd apps/tools build:testnet && bun run --cwd apps/tools verify:build-target testnet`, same for `mainnet`; `bun run test:e2e` (extension smoke — proves the extension build/e2e path is unaffected; it does not exercise the network harness). Push the branch; `gh workflow run pr-quick.yml --ref worktree-tools-rename` (dispatch forces every filter true, `pr-quick.yml:152-166`, so the `build-tools` matrix runs); `gh run watch <id>`.

**Validation gate.** both builds + `verify:build-target` exit 0 · `bun run test:e2e` green · `gh run view <id> --json conclusion -q .conclusion` = `success` and `--json jobs` lists `Build Tools (testnet)` and `Build Tools (mainnet)` with conclusion `success` · `quality-status` job `success`. Layers: build, smoke e2e, real CI.

#### Phase 3 — Docs + arc-1 allow-list

`CLAUDE.md` (Pages env-var note, release runbook table, troubleshooting rows, `apps/tools/src/lib/chain-constants.ts`, `refresh-landing.yml -f target=tools`), `CI.md`, `ARCHITECTURE.md:229,231`, `UPDATE.md:40,46`, `apps/tools/README.md` (title, commands, paths, the `.tools-deploy-*` operator note), `apps/tools/tests/e2e/README.md`, `packages/{bridge-core,design,wallet-bridge,wallet-sdk-schema-patch}/README.md`, `.claude/skills/aztec-update/SKILL.md`, `.claude/skills/e2e-testing/SKILL.md` (if it names harness vars), comment-only prose in `apps/extension/src/**`, `packages/design/src/**`, `packages/wallet-bridge`, `packages/wallet-sdk-schema-patch/src/apply.ts`, `packages/extension-messaging/src/errors.ts`, `contracts/bridge/{aztec,evm}/README.md` (NOT `.sol`). Update `implementations-plan/index.md` status.

**Validation gate.** `bun run audit:tools` exit 0 · `bun run lint:actions` exit 0 · `scripts/check-no-brand.sh` exit 0 · `git grep -n -E 'faucet\.nulo\.sh|nulo-faucet\.pages' -- ':!implementations-plan' ':!audit' ':!.claude/worktrees' ':!CHANGELOG.md'` → 0 · master grep output reviewed line by line and recorded as the arc-1 allow-list in `lessons/phase-3.md` (expected residue: Bucket B vocabulary + the keep list; anything else is a miss to fix). Layers: typecheck/lint, unit, build.

**Arc-1 boundary:** run the quality loop (§Post-implementation) before `gh stack add`.

### Arc 2 — Drip

#### Phase 4 — Feature vocabulary

Per §Scope arc 2. Review the `faucet-drip` comments at `apps/extension/tests/e2e/network/incoming-transfers.test.ts:12,69` (prose about the drip concept — reword to "drip" where it reads as the app). Manual/real check (records the extension build id in `lessons/phase-4.md`): load the built testnet target with the Nulo extension, connect → disconnect → reconnect; the approve popup shows `nulo-tools`; with a pre-seeded `nulo-faucet:preferred-wallet` key the wallet is preselected, and "forget wallet" leaves neither key behind (DevTools → Application → Local Storage).

**Validation gate.** `bun run audit:tools` exit 0 · `bun run --cwd apps/tools test:e2e` green · `bun run --cwd packages/bridge-core test` green · `git grep -n '"fa-' -- apps/tools` → 0 · master grep output equals the FINAL allow-list as an exact file → count table (keep list + generic prose + the three `nulo-faucet` legacy-literal files), recorded in `lessons/phase-4.md` · manual check recorded. Layers: typecheck/lint, unit, jsdom e2e, manual real-wallet.

### Phase 5 — Post-merge cut-over (owner-executed, dashboard)

**Branch-gated, one project at a time.** A Pages project's root directory is flipped only once the rename has reached the branch that project tracks (A6 confirms the mapping). Expected: `nulo-tools-testnet` tracks `dev` → flip right after arc 1 merges to `dev`; `nulo-tools-mainnet` tracks `main` → flip right after the next `release: promote dev → main` lands. Flipping early points a project at a directory that does not exist on its branch — every build fails until the promote. Failed Pages builds keep the previous deployment live, so a mistake degrades to "no new deploys", never an outage. Per project: Build → Root directory `apps/faucet` → `apps/tools`, retry the latest deployment. `refresh-landing.yml -f target=tools` is NOT a proof: the tools hook is unwired and an explicit target fails loud by design.

**Validation gate (per project, after its flip).** The served build is the tracked head: `curl -fsS https://<host>/build.json | jq -r .buildId | awk -F+ '{print $NF}'` equals `git rev-parse --short=8 <tracked branch head>` (`buildId` is `${version}+${sha8}`, `vite.config.ts:59`; mainnet's host sits behind Cloudflare Access — read `/build.json` from an authenticated browser), AND the deployment's build log shows `apps/tools`. Optional belt for testnet: `VERSION=<apps/tools package version> SHA=<head> bun scripts/release/verify-live-run.ts` (freshness is enforced only when both env vars are set). Layers: live deploy.

## Security & Adversarial Considerations

- **Threat model.** No new trust boundary or credential; the only runtime behaviour change is the storage read fallback and the wire `appId`. The surfaces are the places a rename can silently weaken an existing control.
- **Lockfile regen** — the one step where an unrelated dependency change could ride in. Gate = exact transform-and-diff (a keyword grep was shown porous). `minimumReleaseAge` and frozen-lockfile CI are untouched.
- **Baseline `--adopt`** — the one command that can grandfather new complexity; gate = transform-and-diff against the pre-rename manifest.
- **CI gates.** Renaming outputs/jobs can detach `build-tools` from `quality-status`; three durable pins in `behavior-gating.test.ts` + one real dispatch prove the graph. Required-check names untouched. Workflow token permissions unchanged.
- **Forbid-grep scopes** in workflow shell steps repathed (precedent B1).
- **Hostname-integrity layer** — host values not edited; a NEW direct pin on `TESTNET_TARGET.host`/`MAINNET_TARGET.host` closes the gap where every existing gate would miss an edit to the real pins. Both network builds + `verify:build-target` prove target/chainId/digest.
- **Storage migration** reads same-origin keys the app itself wrote, through the existing guarded parse; `clearPreferred` removes both so a poisoned legacy value cannot outlive "forget". Nothing is written on read except the deliberate one-time promotion after a successful connect.
- **`appId` on the wire** — a third-party wallet may see a new dApp; worst case is one re-approval. No grant, key or fund is keyed by it in Nulo.
- **Solidity untouched** — preserves Etherscan verifiability.
- **External state** (Pages root dir) is owner-executed and verified by the served `build.json` sha, not by a hook's 2xx.
- **Supply chain / crypto / input validation / logging** — no change; no new dependency; renamed env vars carry ports and URLs only.

## Assumptions

**Facts (verified at `dev` @ `eca082ca`, 2026-09-01; F10 refreshed after audit)**
- F1 `network-targets.ts:49,62` pins `testnet.tools.nulo.sh` / `tools.nulo.sh` (repo fact). Externally observed from the homelab: `faucet.nulo.sh` does not resolve; `tools.nulo.sh` answers 302 → Cloudflare Access.
- F2 `release.yml:410-416` skips the deploy step when the secret is unset; `refresh-landing.yml:57-68` fails loud on an explicit target with no hook. Externally observed: `gh secret list` has no `CLOUDFLARE_FAUCET_DEPLOY_HOOK`.
- F3 `bun.lock` keys the workspace by path; records are `["pkg@ver", "", {…}, "sha512-…"]` (e.g. lines 2362, 2594) — no keyword fields.
- F4 `manifest.json` holds 10 `apps/faucet` entries (34-39, 60-63); `generate.ts:107-115` refuses growth without `--adopt`; `scan.ts:118-129` counts a renamed key as growth.
- F5 `pr-quick.yml:4` `workflow_dispatch`; lines 152-166 force all filters true on dispatch, so the `build-faucet` matrix (271-283) runs.
- F6 Nulo keys executable grants by profile/origin/chain (`apps/extension/src/wallet/services/dapp-session/service.ts:127-133`); `session-types.ts:47-59` documents it. Not an SDK-wide statement.
- F7 `createAztecWalletSession.ts:133,135` derives both storage keys from `config.appId`; `readPreferred` (206-214) and `clearPreferred` (231-237) touch the new key only; the remembered path never re-writes (715-720); the map is read at 248, written at 278.
- F8 `faucet-smoke.test.ts` selects only via `TESTIDS.*`; no `fa-` literal in `apps/extension/tests/e2e/**`; the smoke config uses `global-setup-smoke.ts` (`vitest.e2e.config.ts:15`), not the network harness.
- F9 `.sol` source edits change the metadata hash (`bridge-evm-verification/plan.md` item 9) — keeping all Solidity untouched is conservative, not strictly necessary for scripts/tests.
- F10 `worktree-faucet-cluster` has two `apps/faucet` commits (`bada951a`, `e8220390`), `aztec-5.2.0-js-line` one.
- F11 `gh stack` v0.1.0 installed. No `.github/labeler`; CODEOWNERS wildcard-only; release-please `extra-files` + git-cliff `--include-path` scoped to `apps/extension`.
- F12 `wallet-sdk` sends `appId` in discovery, stores it on the session and includes it in every wallet call (codex trace of `node_modules/@aztec/wallet-sdk/src/extension/…`); Nulo displays `discovery.appName ?? discovery.appId` (`background.ts:656`).

**Inferences (attackable)**
- I1 Both Pages projects use Git-integration with Root directory `apps/faucet` (the app builds today from that dir). Branch mapping unknown; Phase 5 is written to be correct under either.
- I3 No i18n layer (`format.ts:22` is numeric formatting only) — confirmed by codex.
- I4 Testnet Pages project slug `nulo-tools-testnet` (from the `CLAUDE.md` Pages env-var note). Fixture-only impact.
- I5 `contracts/bridge/evm/README.md` is not a verification input — confirmed by codex.
- (I2 withdrawn after audit — `appId` is more than a label; handled as A5 + the migration.)

**Asks — all resolved by the owner at approval (2026-09-01, verdict `approve`)**
- A1 testid prefix `tl-` — **confirmed**.
- A2 `FaucetView` copy → "Internal drip. No real value." — **confirmed**.
- A3 Two stacked PRs (identity / Drip) — **confirmed** (codex withdrew its one-PR objection in round 2).
- A4 `tools.nulo.sh` behind Cloudflare Access — observed only; no action.
- A5 Rename the wire `appId` `nulo-faucet` → `nulo-tools` — **confirmed**.
- A6 Owner confirms Pages project names, root directory, build commands and tracked branch for both projects at cut-over time — **confirmed as the Phase 5 entry step**.
- A7 `CLOUDFLARE_TOOLS_DEPLOY_HOOK` stays unwired — default stands.

## Delivery

| Arc | Phases | Branch | Stacks on | `/code-review` |
|---|---|---|---|---|
| 1 `refactor(tools): rename apps/faucet → apps/tools` | 0, 1, 2, 3 | `worktree-tools-rename` (adopted as layer 1 via `gh stack init --adopt worktree-tools-rename --base dev`) | `dev` | `low` |
| 2 `feat(tools): rename the faucet tab to drip` | 4 | `refactor/tools-drip-tab` (`gh stack add`) | arc 1 | `low` |

Phase 5 is post-merge and has no PR. PR titles ≤ 93 chars, Conventional Commit scope `tools`. PRs are opened ONLY in the Delivery step below, after both arc loops and the cross-arc pass converge: `gh stack sync` (if `dev` moved) → `gh stack submit --auto` → `gh pr edit` bodies (plan summary, keep list, the Phase-5 owner checklist verbatim) → `gh pr checks --watch`. `gh stack merge` is the owner's call. Squash-merge per `dev`'s convention; after arc 1 merges, `gh stack sync` re-bases arc 2. If A3 resolves to one PR: arc 2's phase runs on the same branch after arc 1's loop, and Delivery is a plain `gh pr create`.

## Post-implementation (self-contained — the implementing session runs this from here)

Per arc, at the arc boundary (after the arc's phases are ✓ and BEFORE `gh stack add` for the next arc); then once more across arcs:

1. **`/code-review low --fix`** on the arc's diff (arc 1: `git diff origin/dev...HEAD`; arc 2: `git diff <arc-1-tip>...HEAD`). Skim the applied fixes for unintended changes. Commit them separately from implementation commits (`chore(tools): apply code-review fixes (arc N)`).
2. **Codex audit** (`/codex xhigh`, fresh session): send the arc diff, a summary of the code-review commits, this plan.md + recon.md, the arc map ("arc 1 of 2; arc 2 renames the Drip vocabulary on top — `useFaucetDrip`/`FaucetView`/`buildFaucetManifest` still exist after arc 1 by design"), the adversarial/security ask (What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where did the rename weaken a gate — lockfile, baseline adopt, CI filter/outputs, forbid-grep scope, hostname pin, storage migration?), and these two rules verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Iterative fix loop.** Verify each codex claim against the repo before acting. Apply accepted fixes, commit, log the round (consult + verdict) in `lessons/phase-N.md`, then RESUME the same codex session with the fix diff for re-review. Repeat until a round yields no new material findings (rejected nitpicks are not churn). Still material after 3 rounds → stop and surface to the owner (scope smell).
4. **Final cross-arc pass** (after both arcs looped): a FRESH codex session over `git diff origin/dev...<arc-2-tip>` + both code-review commit summaries + the cross-arc ask (seams between arcs, duplication across arcs, drift from this plan, anything arc 2 should have folded into arc 1) + the two rules above. Same loop-until-clean.
5. **Delivery** per §Delivery — the first time any PR is opened. Then update `implementations-plan/index.md` (status → delivered, PR numbers) and `agent-worktree status tools-rename "done: PRs #a #b"`.

Failure policy: human-driven → stop and reassess after 3 failures on one step; `/loop` autonomous → after 5.

## Audit log

### Codex round 1 (xhigh, fresh) — `reject`

Blocking: (1) keyword-grep lockfile gate porous; (2) Phase 1 zero-`apps/faucet` gate contradicted `_build-tools.yml` internals deferred to Phase 2, and "bridge paths in the same commit as `git mv`" contradicted the commit plan; (3) legacy-storage fallback incomplete (second namespace, no re-write on remembered success, `clearPreferred` asymmetry); (4) `appId` compatibility asserted from Nulo's own keying only. Highs/mediums: Phase 5 proof invalid (`verify-live-run.ts` freshness off without `SHA`/`VERSION`, testnet-only; explicit `refresh-landing` target fails loud when the hook is unset); `verify-build-target` never checks the host pins and the tests duplicate them; `behavior-gating.test.ts` pins filter + filename only; baseline regen refuses a renamed path without `--adopt`; F10 stale; identity-position misses (`FaucetTarget` family, `VITE_FAUCET_TARGET`, `FAUCET_TARGET`, `candidate-schema.test.ts:7-16`, `fuel-testnet.ts:54`, `deploy-config.ts`, `deploy.ts:55`, `capabilities.ts:36,79`, `.env.example:29`, `theme-boot.js:3`); Phase-4 zero-hit gate would delete allowed generic prose.

**Adopted (all of the above):** transform-and-diff lockfile gate; single coherent Phase 1 with the `git mv` commit carrying every literal path consumer; `--adopt` + transform-diff manifest gate; two-key migration with one-time promotion + symmetric clear + six tests; `APP_ID`/`metadata.name`/`tl-` moved to arc 1; A5 surfaced with a recommendation; Phase 5 proof = served `build.json` sha per project, refresh-landing dispatch dropped; direct host-pin test; three CI pins; e2e-harness proof = scoped grep + standalone `resolve-ports.ts` run (smoke suite acknowledged as not exercising the harness); all completeness misses mapped; Phase-4 gate = reviewed allow-list; F10 refreshed; F9 marked conservative; I2 withdrawn.

**Rejected / held:** one PR instead of two — kept as Ask A3 with codex's argument recorded (arc 2 is the independently revertible half; the split is now exact). No other pushback.

### Codex round 2 (resumed, v2 plan) — `conditional approve`

Conditions, all folded into this version: (1) Phase-5 proof read `.sha`, but `build.json` carries `buildId = version+sha8` (`vite.config.ts:59`) → gate now extracts the sha component exactly as `verify-live.ts:61-68` does; (2) mainnet flip right after the `dev` merge would point the project at a non-existent directory if it tracks `main` → cut-over is branch-gated per project; (3) line-sorted lockfile compare loses object ownership in nested JSONC → structural deep-compare using the repo's own JSONC parse + `lockfile-exception-diff.ts` run; (4) `generate.ts:118` rewrites `generated` daily and `--adopt` may insert directives (`generate.ts:71`) → gate ignores the date and asserts the manifest is the only file the command changed; (5) `resolve-ports.ts` stdout is a summary → gate reads the written `.e2e-state/ports.json`; (6) the `nulo-faucet:` zero-hit regex contradicted the tests that must contain it → exact three-file allow-list; (7) `register-token.test.ts:23-25` (harness names, arc 1) and `incoming-transfers.test.ts:12,69` (`faucet-drip` prose, arc 2) mapped; (8) stale `candidate-schema.test.ts:13` instruction removed (it is the split app path, arc 1). Codex confirmed the storage promotion trigger (on full remembered-connect success, never on read — read-time promotion would bless stale or attacker-controlled same-origin state) and withdrew the one-PR objection.

**Rejected:** nothing.

## ELI5 companion

Artifact: https://claude.ai/code/artifact/79178d58-9e52-4542-8e48-a5c6f44c92e2 (the first publish, `…/bdc1cc30-…`, was deleted before approval sync) · source `implementations-plan/tools-rename/eli5.html` (republish the same path to update the same URL).

## Approval

**`approve`** — owner, 2026-09-01. Scope, tier, validation layers, two-PR delivery, `tl-`, the Drip copy line, and the `nulo-tools` app id all confirmed as written. Implementation starts once Phase 0's precondition (`faucet-cluster` PR-a + PR-b merged to `dev`) holds.

## Seeds (FINAL — canonical, synced with the approved scope)

```
/goal All phases 0–4 marked ✓ in implementations-plan/tools-rename/plan.md (the per-phase headers in the file — not the chat), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript (incl. the empty lockfile and manifest transform-diffs, the pr-quick.yml dispatch run id with both Build Tools jobs successful, the extension smoke e2e, the resolve-ports.ts key check, and the Phase-4 manual reconnect + forget check); for each phase `LESSONS_FILE=implementations-plan/tools-rename/lessons/phase-N.md` printed in the transcript; `/code-review low --fix` complete per arc with fixes committed separately; the codex fix loop converged for arc 1, arc 2 AND the final cross-arc pass, each evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; the PR topology from plan.md §Delivery exists on GitHub, created only after all loops converged (`gh stack view` or `gh pr view` output in the transcript); `bun run audit:tools` and `bun run lint:actions` both exit 0 in the transcript. Phase 5 (Pages root-dir flip) is owner-executed and NOT part of this goal.
```

```
/loop 15m Drive implementations-plan/tools-rename forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/tools-rename/plan.md + lessons/ (authoritative — not the chat); task list empty? rebuild it from plan.md's phase headers; `git status`, `git log --oneline -5`. Phase 0 not ✓? check `gh pr list --search "faucet-cluster"` — if PR-a/PR-b aren't merged, do NOT start Phase 1; prep instead (dry-run the git mv on a scratch branch, draft doc edits) and log it. PR exists? `gh stack view` (no --watch). Otherwise `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. Waiting on CI is fine — `gh run watch <id>` up to 10 min; stuck past that → inspect logs, log as blocked. Use the wait to prep the next phase.
3. No task in hand? Take the next pending step from plan.md. After each meaningful edit run `bun run lint` + the touched package's test (`bun run test:tools`, `bun run --cwd packages/bridge-core test`, `bun run test:ci-gating`). Commit small (scope `tools`, subject ≤ 100 chars, signed) → `gh stack push`.
4. Stuck or facing a decision you'd bring to me? Call `/codex xhigh` with full context, converge, act, log consult + verdict in lessons/phase-N.md. Hard limits: never merge, never publish/deploy, never touch `.sol` files, never edit the `status`/`quality-status` job names, never accept a lockfile or manifest transform-diff that is not empty, never expand scope beyond plan.md — surface and hold instead.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue on the agreed path.
6. Phase green = THE PHASE'S VALIDATION GATE in plan.md passes verbatim. Paste the result, mark ✓ in plan.md, write lessons, print `LESSONS_FILE=implementations-plan/tools-rename/lessons/phase-N.md`, `agent-worktree status tools-rename "phase N green: <next>"`. Arc-1 boundary (Phase 3 ✓)? Run the arc loop FIRST — `/code-review low --fix` → commit separately → codex loop with the arc map + the plan's no-over-engineering + comment-quality rules until clean — THEN `gh stack add refactor/tools-drip-tab`.
7. Phase 4 ✓? Run arc 2's loop the same way, then the final cross-arc codex pass over `git diff origin/dev...HEAD`. Then Delivery per plan.md — the FIRST time any PR opens: `gh stack sync` → `gh stack submit --auto` → `gh pr edit` bodies (include the Phase-5 owner checklist) → `gh pr checks --watch`. Write the wrap-up (what shipped, every contentious codex decision with ELI5 context, the Phase-5 checklist for me) and stop.
Keep the native task list current; plan.md stays the source of truth.
```
