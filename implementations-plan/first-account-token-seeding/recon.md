# recon — first-account default-token seeding

Read-only codebase recon (blueprint Phase 0.4), run against this worktree's base `origin/dev` @ `6de63585`.
Two batched `Explore` agents: a capability reuse sweep and an e2e-harness map.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Trigger a seed pass when an account appears | `AccountService.onAccountAdded`, emitted from `createAccountInternal` (`account/service.ts:256`) and `importAccount` (`:487`) only — **`restore()` emits nothing**; `TokenService.init()` already subscribes two analogous handlers (`token/service.ts:116-128`) | **reuse-as-is** (pattern) — a one-line subscription |
| Guard the handler against stale profile/chain | `TokenSeeder.doRun()` re-derives active profile + network and re-checks its purge epoch before every write (`token/seeder.ts:186-208`, `:199-207`) | **reuse-as-is** — no guard needed at the subscription site |
| Coalesce concurrent triggers | `TokenSeeder.run()` single-flight + `rerunRequested` (`token/seeder.ts:104-121`) | **reuse-as-is** |
| Shared single-flight / epoch primitive | None. `packages/wallet-core/src/utils` exports `lock`, `keyed-lock`, `queue`, `rw-guard`, `event-handler`, … — no single-flight or generation helper. Each of `TokenSeeder`, `TokenBalanceService` (`profileGeneration`), `IncomingTransferService` (`serviceEpoch`) rolls its own. Searched: `singleflight|single-flight|epoch\b|coalesc|generation\b` across `packages/wallet-core/src/` | **build new: NO** — extracting a shared helper is a separate refactor, out of scope (3 call sites, divergent semantics) |
| Seed-list override for tests | `TokenSeederDeps.seeds` (`token/seeder.ts:49-51`) — exists, unit-test-only, not reachable from a built bundle | **adapt** — this is the seam an e2e injection would drive |
| Test-only override plumbed from `TokenService` | `seederOverrides` ctor param (`token/service.ts:64,78,113-118`) — **dead code**: zero call sites pass it (`runtime.ts:400` constructs with 2 args) | **adapt** — first real consumer would be a new test |
| E2E-only build flag with dead-code elimination | `src/e2e/config.ts` — `E2E_PROVERLESS` (double opt-in, fail-closed), `E2E_MIGRATION_FIXTURE`; layered enforcement: fail-closed constant → `if (FLAG)` construction (DCE) → negative bundle-grep in `_build-extension.yml` | **reuse-as-is** (template) |
| Test-only entry spliced into a production registry | `migrations/index.ts:33` — `[...realMigrations, ...(E2E_MIGRATION_FIXTURE ? [migrationFixture] : [])]` | **reuse-as-is** (template) — direct analog for a seed-list entry |
| Runtime (not build-time) test data injection | `ProofGate` / `ChromeStorageProofGate` (`src/e2e/proof-gate.ts`, key `nulo:e2e:proof-gate`), `RestoreGate` / `ChromeStorageRestoreGate` (`src/e2e/restore-gate.ts`), `IncomingPollGate`. Shape: production interface + `NOOP_*` default, e2e impl constructed only inside `if (E2E_PROVERLESS)` | **reuse-as-is** (template) — solves the build-before-deploy ordering problem |
| Per-run non-determinism already solved elsewhere | `price-map.ts:52-70` — `VITE_NULO_E2E_PRICE_MAP=1` wildcard-matches any contract on chainId 0, with the comment "sandbox token addresses are minted per run, so a build-time address map can't cover them" | **reuse-as-is** (precedent for the problem shape) |
| Composition harness for `TokenService` | `composition-harness.ts` `svc()`; `token/service.composition.test.ts` `seedHarness()` (`:161-206`) with real `TokenService` + real `TokenSeeder` and stub collaborators; trigger-wiring precedent at `:344-358` (`vi.spyOn(TokenSeeder.prototype, "run")` + direct `EventHandler.invoke`) | **adapt** — add `onAccountAdded: new EventHandler()` to the stub `AccountService` and a third assertion block |
| Seeder unit tests | `token/seeder.test.ts` `makeSeeder()` (`:30-45`); `:111-121` is already the characterization of this bug's root cause ("zero accounts: skips WITHOUT consuming an attempt; seeds once an account exists" — calls `run()` twice by hand) | **adapt** |
| Assets-view component test | `popup/components/modules/general/TokensView.test.ts` (315 lines) — `vi.hoisted` `H` object with hand-rolled `makeEvent()` fake emitters per service event, `mount(..., { shallow: true })`, `createAppStoreHarness()` | **reuse-as-is** |
| Stable e2e selectors for the assets list | `TokenCard.vue:79` `tokens-card`, `:97` `token-symbol` + `:data-symbol="token.symbol"`; `TokensView.vue:385,390-417,445`. Existing use: `network/tokens.test.ts:16` asserts `[data-testid="token-symbol"][data-symbol="TST"]` | **reuse-as-is** — no new testids needed |
| Fresh-profile e2e drivers | `fixtures/extension.ts:206-243` `registerProfile(ctx)`; `:142-201` `openOnboarding(ctx)`; `fixtures/passkey.ts:47-70` `registerPasskeyProfile`. Composite fixtures `registeredExtension`, `localNetworkExtension` (`:639-652`), `tokenReadyExtension` | **reuse-as-is** |
| Post-first-account assertion precedent | `tests/e2e/registration.test.ts:14-78` counts `nulo:core:accounts@*` rows and asserts `accountCount === 1` — smoke only, no chain | **adapt** |
| Assets-view waiting helpers | `fixtures/helpers.ts:1026` `waitForToast`, `:1316-1347` `captureBalanceBaseline`/`waitForFreshBalanceRow` (storage-row gated), `:1490-1504` `waitForTokenCardAmount` | **reuse-as-is** |

## Absence claims + search trails

- **No shared single-flight/epoch utility.** Searched `singleflight|single-flight|epoch\b|coalesc|generation\b` under `packages/wallet-core/src/`; read the full export surface at `packages/wallet-core/src/utils/index.ts:1-13`. Only mutual-exclusion primitives exist (`Lock`, `KeyedLock`, `Queue`, `ReadWriteGuard`).
- **No e2e exercises the seeder.** `grep -rln "DEFAULT_TOKEN_SEEDS|seedDefaultTokens|TokenSeeder" apps/extension/tests/` → zero hits. `grep -rln` for each of the three seed contract addresses across `apps/extension/tests/` → zero hits.
- **`seederOverrides` has no production or test caller.** `grep -rn "seederOverrides" apps/extension/` → hits only inside `token/service.ts` itself.
- **`seedDefaultTokens()` has no call sites.** Not in `defineRpcMethods` (`token/service.ts:46-54`), so it is unreachable from the popup or a dApp; grep across `apps/` finds no caller.
- **No stable sandbox token address.** `fixtures/aztec.ts:143-160` `deployTestToken` passes no salt; `tests/e2e/README.md:79-88` records two concurrent runs landing on different addresses.

## E2E harness facts that constrain the design

- **Suite split.** Smoke = `vitest.e2e.config.ts` (`tests/e2e/*.test.ts`, excludes `network/**`, no sandbox). Network = `vitest.e2e.network.config.ts` (`tests/e2e/network/**`, real sandbox via `tests/e2e/global-setup.ts`). `bun run e2e:agent` wraps the network config.
- **Build happens before the chain exists.** `scripts/e2e/agent.sh:80-104` builds `dist/chrome` with `VITE_LOCAL_NETWORK_RPC_URL`, `VITE_NULO_E2E_DEFAULT_NET=testnet`, `VITE_NULO_E2E_PRICE_MAP=1`, `VITE_NULO_E2E_MIGRATION_FIXTURE=1` (+ the proverless pair). The sandbox and its token are only deployed later, inside `global-setup.ts:639-713`. **A just-deployed address cannot be baked into the bundle.**
- **The wallet boots on Testnet, then tests switch to Local Network.** `VITE_NULO_E2E_DEFAULT_NET=testnet` makes the Testnet seed `isPrimaryActive` (`network/service.ts:96,114`), because Alpha's RPC blackholes in CI. Chain flows then switch to "Local Network", `chainId: 0` (`network/service.ts:119`, `CHAIN_IDS.SANDBOX`), via `localNetworkExtension` (`fixtures/extension.ts:639-652`).
- **Both live seed chains are public dRPC endpoints** (`network/service.ts:100`, `:110`). Letting the seeder hit them from CI would make a required gate depend on external availability *and* on the token still being deployed after a network reset — the exact failure `default-tokens.ts:20-24` documents for cUSD.
- **`seedsForChain(0)` is empty by design.** `default-tokens.ts:38-70` has 2 MAINNET entries + 1 TESTNET entry, none for chainId 0. `implementations-plan/token-prices/plan.md:170,174` records Ask 1 resolved at the 2026-07-21 approval gate as *"unit + blocking live preflight accepted (no seeding network-e2e)"*.
- **Sandbox token metadata would fail the pins as-is.** `deployTestToken` deploys `@aztec-foundation/aztec-standards@5.0.1` `TokenContract` with symbol `"TST"` (`fixtures/aztec.ts:143-160`); `seeder.ts:316` rejects on `preview.symbol !== seed.expectedSymbol`, and no current seed pins `"TST"`. Class id is plausibly the same aztec-standards class the prod seeds pin (`default-tokens.ts:43,57,67`) but has never been live-captured against a sandbox deploy.
- **CI wiring is automatic.** `pr-network-e2e.yml:32-72` `extension-network` and `pr-smoke-e2e.yml:30-31` `smoke-surface` both include `apps/extension/**` wholesale, so a new file under `tests/e2e/network/` runs in CI with no workflow edit and joins the default 5-way SHA-1 shard pool (`pr-network-e2e.yml:135-172`).
- **Cost.** Network suite ~10-15 min sharded 5-way (~35-45 min unsharded); per-shard CI timeout 30 min. Single file: `bun run e2e:agent tests/e2e/network/<file>.test.ts`.

## Collision / dedup risks

- **Do not add a second coalescing layer.** `TokenSeeder.run()` already coalesces; a debounce or generation counter at the new subscription site would duplicate it.
- **Do not extract a shared single-flight helper** as part of this fix — three call sites with different epoch semantics; premature.
- **Do not add a `TokensView` → `onTokenAdded` subscription reflexively.** `TokenBalanceService.onTokenAdded` (`token-balance/service.ts:282-299`) already backfills balance rows for every account on the token's chain, which emits `onTokenBalanceAdded`, which `TokensView.vue:180` already pushes live. A second subscription risks double-inserting rows.
- **Do not touch `DEFAULT_TOKEN_SEEDS`' production entries or their TOFU pins.** They are a security surface with their own preflight provenance (`default-tokens.ts:5-19`); an e2e seed must never relax the pins. **Corrected after the codex audit:** the e2e seed list must *replace* the production list in armed builds, not augment it — augmenting would make every Testnet-booted e2e profile (network **and** source-built smoke) attempt a live seed against the public dRPC endpoint. See `plan.md` Ask 2.
- **Do not add `seedDefaultTokens` to the RPC surface** to make it e2e-drivable — that widens the popup↔SW method surface for a test.
