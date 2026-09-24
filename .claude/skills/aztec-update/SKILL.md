---
name: aztec-update
description: Runbook for bumping the @aztec/* version line (rc bumps, protocol forks, testnet resets). Use when the user asks to update/bump Aztec, aztec.js, the @aztec packages, or to move to a new rc/release — or runs /aztec-update. Covers the full pin surface, drift detection, the execution canaries, and the wallet side of a testnet reset (the bridge's generation redeploy belongs to alejoamiras/unleashed).
---

# Aztec version update

Operational runbook distilled from the shipped bumps (4.2→5.0 hard fork: `implementations-plan/aztec-5.0-upgrade/`; rc.1→rc.2 + testnet redeploy: `implementations-plan/aztec-5.0-rc2/`; rc.2→5.0.0 stable + reset under intent tooling: `implementations-plan/aztec-5.0.0-stable/` — read those plans + their `lessons/` for complete worked examples). Non-trivial bumps still go through `/blueprint` — this skill is the domain checklist the plan draws from, not a substitute for planning.

The bridge's half of a bump — the generation runbook (formerly Branch B here), the Noir contract surface and the bridge drift detectors — moved with the bridge to [`alejoamiras/unleashed`](https://github.com/alejoamiras/unleashed). Until that repo is populated, read them in [this skill at the freeze commit](https://github.com/alejoamiras/nulo/blob/<FREEZE_SHA>/.claude/skills/aztec-update/SKILL.md).

> **This skill is the source of truth for the Aztec-bump process. Update it when the process changes** — a new pin surface, a new failure mode, a toolchain/proving shift. A durable lesson from a bump belongs HERE (not only in the plan's `lessons/`). CLAUDE.md's skill-routing table points here for that reason.

## Phase 0 — classify the bump (do this FIRST, it forks everything)

Two independent questions:

1. **Did the target network reset?** Probe the live node and compare against our pin:
   ```bash
   curl -s -X POST https://v5.testnet.rpc.aztec-labs.com -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"node_getNodeInfo","params":[]}' | jq '.result.rollupVersion'
   rg -n 'TESTNET_ROLLUP_VERSION' apps/extension/src/utils/chain-ids.ts
   ```
   Different rollupVersion ⇒ **NETWORK RESET** ⇒ Branch B below (the wallet's side of the reset) is mandatory. The bridge's new generation on that network belongs to `alejoamiras/unleashed`.
2. **What changed upstream?** `gh api repos/AztecProtocol/aztec-packages/compare/v<old>...v<new>` — scan `!:` commits, then grep OUR surface for the broken symbols before assuming they bite. Expect class-id shifts from ANY toolchain/bytecode change even when no API we call moved.

**Then gate on the user via the `AskUserQuestion` tool** — present what the probes FOUND (rollupVersions, `!:` commit count, our-surface hits), never ask blind. **No implementation starts while ANY clarifying question is open**: Q1 below is the mandatory minimum, and anything else the probes left ambiguous — the exact target version, validation depth (network-e2e on both browsers?), whether the extension release timing matters — gets batched into the same `AskUserQuestion` call(s) up front. Silent assumptions are how a bump strands funds (Fee Juice paid to a wrong PrivateFPC address is unrecoverable). The fixed question:

- **Q1 "Bump class"** (single-select) — options grounded in the probe result, e.g.:
  - `Version-only bump` — rollupVersion unchanged; pins + detectors + canaries, the wallet's chain identity untouched (Branch A).
  - `Network reset — wallet-side cascade` — rollupVersion moved; the bump carries the wallet's chain-identity cascade and client-side reset (Branch B). Recommend whichever the probe supports and mark it "(Recommended)".
  - Note the third state: **rollupVersion unchanged but the Phase-1 drift detector fires anyway** (an upstream toolchain/derivation change moved the wallet's derived PrivateFPC address without a reset). It cannot be classified up front; when the detector goes red on a "version-only" run, STOP and re-gate through `AskUserQuestion` (hold the bump vs a conscious re-pin, which owes a PrivateFPC deployed at the new address and a live re-canary). *(This second re-gate is load-bearing: Q1 is answered BEFORE the Phase-1 detectors run, so the Phase-0 gate is sufficient only in combination with it — do not remove it.)*

Do not start Phase 1 before the answer. Mid-run surprises that change the shape of what was authorized (a forced storage migration, an unexpected re-pin) go back through `AskUserQuestion` — authorization for one scope doesn't extend to the next.

## Phase 1 — the bump (always)

**The pin surface** — miss one and you get a mixed old/new set:
- `@aztec/*` exact pins across the workspace package.json files (`rg '"@aztec/' apps/*/package.json packages/*/package.json`). `@aztec/viem` is versioned independently — leave it.
- **`@alejoamiras/presto`** (extension + aztec-runtime) — it exact-depends on `@aztec` transitives; skipping it silently reintroduces the old line. Bump it WITH the `@aztec` line: the page-side client sends the workspace `@aztec/pxe` version and the offscreen prover sends the SDK's own pin, and a drift surfaces as the visible `version-mismatch` state.
- **`@aztec-foundation/aztec-standards` + `@alejoamiras/private-fee-juice`** (6 pins across `apps/extension`, `apps/playground`, `packages/aztec-runtime`) — HELD at 5.0.1 on a deliberate split line (`UPDATE.md`, `implementations-plan/aztec-5.2.0-js-line/`), enforced by `scripts/aztec-hold-residue-check.ts`. Moving them is its own decision: the PrivateFPC artifact the wallet derives from ships in `private-fee-juice`.
- **The third-party notices overrides** (`packages/third-party-notices/src/policy.ts`): the `@aztec/*` packages ship neither a licence field nor a licence file, so each override is bound to a `reviewedVersion` and the extension build REFUSES the new line until it is re-verified. Re-check, at the new tag, the root and `barretenberg/` LICENSE files, the noir submodule commit (`gh api 'repos/AztecProtocol/aztec-packages/contents/noir/noir-repo?ref=v<new>'`) and the sqlite3mc pin in `@aztec/sqlite3mc-wasm`'s README (the wasm must stay byte-identical to the upstream release zip it names); refresh `texts/` only from those tagged sources, then bump `reviewedVersion` and the URLs. Procedure: that package's README, § When a build is refused.
- The two noir patches: rename `patches/@aztec%2Fnoir-{acvm_js,noirc_abi}@<v>.patch` + the `patchedDependencies` keys in the root package.json.
- `bunfig.toml` `minimumReleaseAgeExcludes`: fresh publishes are min-age-blocked, and the gate bites TRANSITIVES too — enumerate every `@aztec/*` name from `bun.lock` (~30), plus `@alejoamiras/presto` (and the held pair above whenever it moves too). They are needed whenever `bun install` RESOLVES the new line: once `bun.lock` is final, delete them again in the same PR and prove it with `bun install --frozen-lockfile --force` (a frozen install never re-gates). For the following 7 days, any `package.json` edit in a workspace that reaches the new line (`apps/extension`, `packages/aztec-runtime`, …) re-gates it and fails the install — so land the bump's dependency changes in the bump PR, and for a stray later edit re-add the excludes locally without committing them. Keep a dated exclude across PRs only when a later PR of the same bump must re-resolve.

**The lockfile ritual** — `bun install` after editing the pins. Targeted re-resolution holds
transitives to the min-age gate (Bun ≥ 1.4), so a plain install is the default; `rm bun.lock` is
the last resort for unresolvable conflicts only (a full regen re-gates every already-locked
version and invites unrelated churn).
- ⚠️ `bunfig.toml` pins `linker = "isolated"` (since the 2026-08 isolated-linker arc) — do NOT
  change it. The old hoisting assumptions were made layout-agnostic via `@nulo/resolve-asset`;
  `apps/extension/scripts/layout-identity.test.ts` is the executable
  guarantee (and carries `expectVersion` literals that MUST move with the line).
- Diff the lock with `bun scripts/lockfile-exception-diff.ts <base-lock> bun.lock` and
  disposition every `exceptions/added/removed` entry (no blanket acceptance).
- **Residue is an ALLOWLIST check, not a zero check.** When any package is deliberately held,
  old-line entries legitimately remain. `bun scripts/aztec-hold-residue-check.ts` encodes it:
  graph-reachability from the held roots (bun.lock v2 shortens a single-dependent nested key to
  the bare position, so key-prefix matching gives false failures) plus `realpath` resolution
  from every consumer workspace. Anything else on the old line is a missed pin.
- Fresh publishes are min-age-blocked. Prefer waiting; when a first-party release must land
  immediately, add ONE `minimumReleaseAgeExcludes` entry, record the provenance you verified in the PR
  (registry signature + npm/SLSA attestation binding the tarball to a repo+commit), and delete
  the entry in the same PR once the lockfile is written.
- Provenance actually runs like this: build a scratch npm project from the exception-diff's
  resolved `name@version` set, `npm install --ignore-scripts`, THEN `npm audit signatures`.
  `--package-lock-only` makes audit a no-op ("found no dependencies to audit") — which is why
  earlier bumps never transcribed a passing run.

**API churn**: `bun run typecheck:all` is the fast-fail — **but typecheck is NOT sufficient on a fork-class bump.** Surfaces typecheck can't see (5.0-fork precedent): copied/adapted upstream logic (fee options, gas math) that must be re-diffed against the new upstream; the `@nulo/wallet-sdk-schema-patch` package (it extends `WalletSchema` at runtime and throws if the wallet-sdk schema shape moved; its `apply.test.ts` and `packages/wallet-bridge/src/dispatcher.test.ts` under `test:all` exercise it, typecheck doesn't); and native-proving required-mode (`VITE_NULO_PRESTO_REQUIRED`) surviving the proving-stack change. Port mechanically and behavior-preserving; wrap renamed upstream APIs inside our service layer so OUR RPC surfaces don't ripple (precedent: PXE senders → tagging-secret sources, wrapped in `PxeService`). Non-mechanical churn (a removed API we depend on) → stop, `/codex` triage, re-plan.

**The frozen account surface (never bumped with the line)**: the account artifact is VENDORED
(`packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`) and, with the instantiation
descriptor + regime record (`frozen-artifact.ts`, `instantiation-descriptor.ts`,
`address-freeze.ts`), fixes every derived account address. A bump must leave the KAT
(`derivation-vectors.test.ts`) and all freeze tests green with ZERO vector regeneration and zero
pin edits — if a bump reds any of them, upstream moved a protocol-level input; STOP, that is
new-extension-major territory, not a re-pin (mirror the PrivateFPC conscious-re-pin spirit; see
CLAUDE.md "Account-address freeze").

**The drift detector** (GREEN on every bump, reset or not — the address is network-independent):
`apps/extension/src/wallet/services/fpc/protocol-fpcs.test.ts` re-derives the PrivateFPC through
the wallet's own `derivePrivateFpc()` (`protocol-fpcs.ts`: the `private-fee-juice` artifact, salt
`0x…01`, deployer zero) and pins salt, deployer and address to the canonical deployment. Red means
the artifact, the salt or upstream's derivation moved, and the wallet would pay Fee Juice to an
address no PrivateFPC lives at — an UNRECOVERABLE loss. Default response: HOLD the bump. Re-pinning
the literals is a CONSCIOUS act, valid only once a PrivateFPC is deployed at the new address on
every network the wallet ships and a live re-canary is green; never silence the test. The other
tripwires: the account KAT and freeze tests (above), `scripts/aztec-hold-residue-check.ts` (the
lockfile ritual) and `descriptors-real-artifact.test.ts` (Gotchas).

**The two execution canaries (MANDATORY, every `@aztec/*` bump PR)**: run
`bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts tests/e2e/network/passkey-execution-canary.test.ts`
**prover-ON** before merge, **on Chrome and again under `NULO_E2E_BROWSER=firefox`** (geckodriver on
PATH; `apps/extension/tests/e2e/FIREFOX.md`). LOCALLY, `e2e:agent` has NO Presto enforcement — it silently falls back to in-browser WASM if
no prover is up, which would pass the canary WITHOUT proving anything about native proving. To
actually run it prover-ON locally: start `PRESTO_ALLOW_ALL=1 presto-server` on `127.0.0.1:59833` (the
SHA-pinned binary from `_extension-network-e2e.yml`; the variable is scoped to that one process and
auto-approves the wallet's origin), build the wallet with `VITE_NULO_PRESTO_REQUIRED=1`, and confirm at
least one `Proving succeeded` in the presto log during the run (`Received /prove request` is logged
before authorization, so a denied request prints it too). In CI this is
automatic: both canaries are named files in the prover-ON `network-e2e-canary` job of **both** network
lanes — `pr-extension-network-e2e.yml`, enforced by the required `extension-network-e2e-status` check, and
`pr-extension-network-e2e-firefox.yml`, advisory as a check — and each lane's `Assert canary results` step
reads the run's json report back against `scripts/ci-cd/canary-expectations.json`, so a canary that
skipped, vanished or never ran reds the job. That is the authoritative gate; the local run is a
pre-flight. The frozen canary proves the frozen 5.0.1 account bytecode still simulates, proves natively,
and is accepted by the bumped node/toolchain across the full arc (frozen-ctor multicall deploy →
init-nullifier flip → authwit consume → background-restart re-derive + tx); the passkey canary proves
the same for a PRF-derived account (in-page ceremony → frozen ctor → authwit consume →
background-restart ceremony re-unlock + tx). The address KAT cannot see execution breakage — these
canaries are the only gate that does. **A red canary on either browser BLOCKS the bump** (read the
Firefox lane's canary job on the bump PR by hand — advisory means it cannot block a merge, not that it
may be ignored): default response is HOLD the `@aztec` line; shipping a new extension major
(address-regime rotation) is the deliberate alternative — never a casual fix.

## Branch A — bump-only (no reset, detectors green)

Normal delivery: `test:all` + `lint` + the builds (`bun run build:chrome`, `bun run build:firefox`, `bun run --cwd apps/playground build`, `bun run --cwd apps/landing build`) + **both prover-ON execution canaries (above)** → PR labeled **`e2e:extension-network` + `e2e:extension-smoke`** (forces both suites — the dep diff warrants it) → all three required checks green → merge. Done.

## Branch B — network reset (the wallet side)

A reset moves the wallet's chain identity and wipes everything deployed on the old rollup. The bridge-side work it forces — a new bridge generation, the PrivateFPC redeploy on the new network, the live bridge canaries — belongs to `alejoamiras/unleashed` (the runbook as it stood is Branch B of [this skill at the freeze commit](https://github.com/alejoamiras/nulo/blob/<FREEZE_SHA>/.claude/skills/aztec-update/SKILL.md)). The wallet's share:

1. **ChainId cascade** — the wallet chainId is `walletChainId(l1ChainId, rollupVersion) = (l1 ^ rollupVersion) >>> 0` (`apps/extension/src/utils/chain-ids.ts`: bump `TESTNET_ROLLUP_VERSION`; `CHAIN_IDS`/`DEFAULT_SEEDS` derive from it) + `chain-ids.test.ts`. `rg` the old rollupVersion AND the old wallet chainId repo-wide — comments, test fixtures and `apps/extension/scripts/seed-preflight.ts` carry the literal — and classify every hit.
2. **Client-side reset**: the storage baseline is `BASELINE_VERSION` in `apps/extension/src/wallet/storage/migrations/index.ts` — pre-production, a fresh reinstall stamps it and runs nothing, and a shape change just redefines the baseline (no client migration UX). Chain-coupled rows (tokens, txs, balances, and other per-deployment state) are purged per-chain by `NetworkService.purgeChain` → each service's `clearChainState` (the `registerChainPurgeSubscriber` cascade + `PxeServiceClient.clearChainState`), fired when the stale network is removed. User-authored roots (contacts) are NOT chain-coupled and persist.
3. **Default-token seeds** — `apps/extension/src/wallet/services/token/default-tokens.ts` and `apps/extension/src/wallet/services/price/price-map.ts` key their testnet entries by `CHAIN_IDS.TESTNET`, so the cascade re-keys them onto the new chain while their contracts stayed on the old one. Their TOFU pins are live-captured: re-run the preflight (from `apps/extension`: `bun run scripts/seed-preflight.ts <address>`, + `seed-preflight-metadata.ts`) against the new node for every testnet seed. The bridged-USDC entries are the RETIRED single-token bridge's L2 tokens; nothing here mirrors unleashed's `tokens[].l2Token` today, so there is no parity to restore. This step is where a future mirror of a promoted generation's tokens (unleashed's testnet bridge manifest; until that repo is populated, [at the freeze commit](https://github.com/alejoamiras/nulo/blob/<FREEZE_SHA>/apps/tools/public/testnet-bridge.json)) would land. Dropping, re-pinning or replacing a seed changes what a fresh wallet shows — an owner UI decision (CLAUDE.md § UI changes need explicit owner sign-off), never a runbook default.
4. **PrivateFPC** — its canonical address is network-independent, so nothing here moves unless the drift detector fires. The reset did wipe its deployment, though: the wallet's PrivateFPC fee methods work on the new network only once unleashed redeploys it there. Before a release that targets the new network, run the same preflight on the canonical address (pinned in `protocol-fpcs.test.ts`); `NOT FOUND` on the testnet line means that deploy has not landed.

Then Branch A's delivery gates.

## Gotchas (hard-won)

- **Sweep version literals across the WHOLE workspace, not just the app.** Test fixtures pin the
  expected `@aztec` version in places a per-app grep misses — `apps/extension/scripts/
  layout-identity.test.ts` AND `packages/resolve-asset/src/index.test.ts` both hardcode it, and
  the second one only surfaced in CI. Run `rg -l '<old-version>' --glob '!node_modules'
  --glob '!bun.lock'` from the repo root and classify every hit.
- **`test:all` passes only when its EXIT CODE is 0.** Counting `Exited with code 0` lines is not
  a pass signal — failing packages hide behind passing ones. Check `rc=$?` and grep for
  `Exited with code [1-9]`/`FAIL ` explicitly.

- **One `@aztec` generation in the bundle, always.** Upstream's `getVKIndex`
  (`noir-protocol-circuits-types/artifacts/vks/tree.ts`) discriminates with `instanceof`, so two
  copies of that module make it treat the VK object as its own hash and abort with
  `VK index for [object Object] not found in VK tree` — thrown in-wallet BEFORE any `/prove`
  request, so the presto log is silent and it looks like a proving failure that never
  reached the prover. Any package that exact-pins its own `@aztec` deps (the Presto SDK)
  must move WITH the line; holding it is not an option. Packages that declare exact-version
  PEERS (private-fee-juice) or nothing at all (standards) re-bind to the workspace line and are
  safe to hold. Gate: `scripts/aztec-hold-residue-check.ts`.
- **Upstream recompiles `@aztec/accounts` artifacts on toolchain changes** (5.2.0 moved
  SchnorrAccount's class id, −3,892 bytes). Production is immune — addresses come from the
  vendored frozen artifact — but any E2E fixture that builds accounts through
  `EmbeddedWallet.createSchnorrAccount` will fund one address and deploy another. Fix at the
  wallet-construction seam: `EmbeddedWallet`'s constructor takes an `AccountContractsProvider`,
  so subclass it and serve the frozen artifact for schnorr (see `FrozenArtifactWallet` in
  `apps/extension/tests/e2e/fixtures/aztec.ts`). Symptom order if you patch it piecemeal:
  address-parity mismatch → `Public keys not registered for account` → `Account "0x…" does not
  exist on this wallet` — those are three different upstream steps you'd be re-implementing;
  don't, use the provider.
- **`tests/e2e` is outside the tsconfig graph** — fixture breakage never shows in
  `typecheck:all`. The network suite is the only detector.
- **Clear `<app>/node_modules/.vite` after a dependency-line swap**, before the first e2e run.
  Stale dep-optimizer caches make dev-served apps fail with `.vite/deps/*.js does not exist`,
  which surfaces as a page that never loads and a test that times out far from the cause.
- **Don't edit fixtures while a suite is running.** Vitest workers load them per-worker, so a
  mid-run edit yields a mix of old and new code and results you must throw away.
- **Match the local run to CI's topology.** CI runs the network pool proverless in shards and
  only a 3-file canary lane prover-ON. Running all ~70 files prover-ON locally is ~2.5h for no
  extra signal; run prover-ON for the canaries + fee/tx-send paths and proverless for the rest.
  Two files carry `@requires-proverless` and the runner hard-fails if they're in a prover-ON set.
  And SHARD the proverless pass locally — `agent.sh` allocates its own ports per run, so 3-4
  concurrent shards are safe (CI runs 5) and cut it from ~25min to under 10. Prover-ON is the
  exception: every shard would queue on the single presto-server at the hardcoded port 59833.
- **`BB_BINARY_PATH` is a footgun**: Presto's `find_bb` honours the seed before the versioned
  cache, so a version-mismatched seed proves everything with the wrong bb while the log shows a
  download of the right one. Run the server unseeded.

- rc.2+ `DeployMethod.send()` returns `Promise<DeployResultMined>` (no `.deployed()` chain), and codegen'd `Contract.deploy` needs the **EmbeddedWallet itself** as the `Wallet` (the account object lacks `getContractClassMetadata`) with the account as `from`.
- A CONFLICTING PR runs **zero CI silently** (GitHub can't build the merge ref) — check `mergeable` before wondering where the checks went.
- `FeeJuice.claim_and_end_setup` is ONLY valid as the fee payload (setup phase — where `FeeJuicePaymentMethodWithClaim` places it). An app-phase claim under a sponsored fee must use plain `claim`, or it asserts on EVERY attempt — which looks exactly like a slow L1→L2 message sync if the retry loop swallows errors. Print the caught error on the retry cadence, and when a claim "never syncs", independently check the message witness (`node_getL1ToL2MessageMembershipWitness` with the key from the portal's deposit event) before blaming the network.
- Blanket `biome check --write` on test trees converts `vi.fn(function () {…})` mocks to arrows and breaks `new`-constructed service-client mocks (~95 failures) — format only the files you touched.

- **CI's aztec toolchain install has NO min-age gate — un-pinned transitives walk in on publish
  day.** The repo's `bunfig.toml` 7-day gate covers OUR deps only; `.github/actions/setup-aztec`
  runs the upstream installer, whose npm resolve is live. 2026-08-12: `snappy@7.4.0` (broken Node
  entry chain — unconditionally reaches the never-installed-on-linux `@napi-rs/snappy-wasm32-wasi`
  fallback) killed every fresh CI sandbox boot the day it published, while local runs stayed green
  on pre-publish `~/.aztec` trees. The action now carries a load-check-gated pin step (replaces
  snappy with 7.3.3 by direct tarball extraction, no-op when the installed one loads, fail-loud
  re-check) — **remove that step when bumping to an @aztec line whose install resolves a fixed
  snappy** (check: fresh-install in a scratch HOME, then `node -e "require('snappy')"` against the
  version dir). Same class can recur through any un-pinned transitive: diagnose via publish-time
  correlation + bare local `npm install` repro before rerunning CI.

- **Standards/token package swaps: noir struct paths are NOT stable across dep graphs.** The same
  `AztecAddress` param can arrive as `aztec::protocol_types::…::AztecAddress` from one compile and
  `authorization_contract::aztec::protocol_types::…::AztecAddress` (crate-prefixed by the artifact's
  import chain) from another. Any exact-path ABI matching silently zeroes out — in the wallet this
  made every balance/transfer descriptor resolve no candidates, so token imports returned
  `isComplete: false` and the popup dead-ended with "Couldn't auto-detect this token's interface"
  (the whole network suite red via `importToken` timeouts, mislabeled a "hang"). Match struct paths
  suffix-tolerantly (`matchesStructPath` in
  `apps/extension/src/wallet/services/token/functions/descriptors.ts`) and, after ANY standards bump,
  run `descriptors-real-artifact.test.ts` — it pins all nine token-fn kinds against the REAL installed
  artifact and is the first thing that must go red if upstream reshapes the ABI. Also remember 5.x
  `loadContractArtifact` splits public fns into `artifact.nonDispatchPublicFunctions` — a raw-JSON
  diff is NOT what the wallet's matcher sees; probe through the package's own `Token.js` export.
