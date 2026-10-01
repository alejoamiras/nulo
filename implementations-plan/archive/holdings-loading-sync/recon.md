# Recon — holdings-loading-sync

Base: `origin/dev` @ `c543c18d`. Three read-only explorers mapped the seeding chain, the incoming-scan
state machine and the reuse surface; the driver closed the gaps the last explorer could not reach.
Scope is `apps/extension/**` + the wallet packages; `apps/tools/**` and `packages/bridge-core/**` are
out of bounds (two-products rule).

## Reuse map

| # | Capability needed | Existing code | Verdict | Justification for `build new` |
|---|---|---|---|---|
| 1 | Skeleton / shimmer block | No shared primitive. Five independent shimmer keyframes: `TokenCard.vue` `.balance_shimmer`, `modules/send/fee-shared.module.css` `.skeleton`, `components/composite/send/AmountCard.vue`, `pages/received/[id].vue` `.fee_shimmer`, `packages/design/src/core/Icon.vue` `skeleton`. `LoadingState` (`@nulo/design/ui`) is a label + spinner block, not a shimmer. | **build new** `Skeleton` in `@nulo/design/ui`, adopt at the sites this plan touches | A sixth private keyframe is the dedup failure; searched `packages/design/src/ui`, `apps/extension/src/components/**` by listing + `shimmer|skeleton` grep. |
| 2 | Loaded-vs-empty gating for a snapshot list | `BalanceView.vue:118-178` (`isLoaded` + `fetchDirty` + generation). `holdings.vue` has a local `isLoading`. No composable (`useEntityCrud`, `usePopupEntity` are unrelated). | **adapt in place** — add an `isLoaded` ref to `TokensView` beside its existing `scopeGen` | Two call sites with different race models; a shared composable is not yet the third copy. |
| 3 | Popup knowledge of the default-token list | `wallet/services/token/default-tokens.ts` (`DEFAULT_TOKEN_SEEDS`, `seedsForChain`). Biome does not block the import, but **e2e replaces `getSeeds()`** in the SW (`tests/e2e/README.md` § default-token seeding) — a static popup import would diverge from what the SW seeds. | **do not import statically**; read through the new RPC (row 4) | — |
| 4 | Seed progress surface | None. Marker blob `nulo:core:token-seeded@<profileId>` (`seeder.ts:29-38`, `SEED_ATTEMPT_CAP = 3`, version reset `:55-66`) is storage-only. Pattern to copy: `token/spec.ts` `Events`/`Methods` + `service.ts` `rpcMethods`. `packages/wallet-bridge` is not involved (internal SW RPC). | **build new** `getSeedStatus` / `retrySeed` / `onSeedStatusChanged` | Searched `token/spec.ts`, `token/client.ts`, `seeder.ts` for `seed` — only `seedDefaultTokens()` (off the RPC surface). |
| 5 | Journal `token_import` + `TokenImportRow` | Fully working; `origin: "seed"` records are created ~ms before the row (`token/service.ts:345-354`). Reaper: `pending` 2 min, `simulating` 10 min grace; failed rows linger 30 s in the UI. | **reuse as-is, unchanged** | Considered as the in-flight signal (competing outline) — rejected in the ledger. |
| 6 | One-shot metadata read | `execution/helpers/batched-view-simulation.ts` + `get-view-simulation-deps.ts`, already used by `BalanceProjector`. `TokenService` lacks a `contractResolver`. | **adapt** | — |
| 7 | Transient-vs-reorg classification, backoff | None generic. `balance-job-queue.ts` has a fixed `MAX_TRANSIENT_RETRIES = 2` / 5 s delay, private. The scan path throws exactly two plain `Error`s (`packages/aztec-runtime/src/pxe/public-events.ts:232`, `:328` "not an ancestor … (reorg)"); a node-side dropped `referenceBlock` surfaces as whatever `getPublicLogsByTags` throws. | **build new**, local to the incoming-transfer service | Searched `class .*Error|throw new` over `incoming-transfer/` + `public-events.ts`; `isTransient|withRetry|backoff` over `wallet/utils` + `packages/*`. |
| 8 | Contract deployment block | **Not available**: `AztecNode.getContract(address, referenceBlock?)` and `getPublicLogsByTags` only (`@aztec/stdlib` 5.2.0 `interfaces/aztec-node.d.ts:271,378`); `ContractInstanceWithAddress` carries no block. | **drop the requirement** | The scan pages by LOG COUNT (20/page), not by block range — logs before deployment do not exist, so a deployment-block anchor saves nothing. The real lever is not rewinding at all (row 9). |
| 9 | Account / phrase provenance | `AccountType.Nulo_v1` vs `Imported` only; `Profile` has no generated-vs-imported phrase flag, `Account` has no `createdAt`. | **build new** `Profile.phraseOrigin` | Searched `profile/spec.ts`, `account/spec.ts` for `origin|imported|source|createdAt`. |
| 10 | Delay-before-show / min-display helper | `composables/ticker.ts` `useTicker` only. | **no helper** — the stalled line's 10-minute rule is the delay; min-display is three lines in the consumer | — |
| 11 | Tests / docs the change touches | `TokenCard.test.ts` (dot + shimmer cases), `TokensView.test.ts` (threshold gate, hostile lag), `service.scenarios.test.ts` "§3 Catching up" describe (~3771-4045, incl. the `blocksBehind: 41` reconciliation pin), `seeder.test.ts`, `RecentActivityView.test.ts`, e2e `network/default-token-seeding.test.ts`, `network/tokens.test.ts:33` + `network/holdings.test.ts:58` (`token-balance-loading` — kept). **No e2e references `token-catching-up`**. Docs: `ARCHITECTURE.md:99` ("one metadata simulation" — it is three). | **extend, don't duplicate** | — |

## Findings that shape the plan

**Seeding dead window.** `onAccountAdded → void seeder.run()` (`token/service.ts:171-172`); the Token row and
its TokenBalance row are written only after `previewTokenMetadata` finishes: offscreen boot → cold
chain-runtime boot → `getContractInstance` → registration → three sequential `simulate()` calls
(`token/service.ts:713-722`). Alpha seeds two tokens. The network e2e budgets 120 s for it. Nothing the
popup listens to changes before T4. After a SW death mid-seed nothing re-triggers the pass until the next
profile / network / account event — opening the popup does not.

**False empty state.** `TokensView.vue:437` renders "NOTHING HERE YET" whenever `tokenBalances` is empty,
including during its own snapshot fetch and on every scope change. `BalanceView` renders `$0.00` once its
fetch resolves, even with zero rows or rows at `updatedAt === 0`.

**Catching-up over-trigger, ranked.** (1) during a reconciliation `coveredBlock = lowerBound − 1`, so
`blocksBehind` is the finality gap; (2) the `catch` in `scanPublicContract` (`service.ts:1446-1457`) treats any
throw as a reorg: emits `backfilling` and begins a reconciliation → feeds (1); no backoff; (3) fresh cursors
start at 0 and `onAccountAdded` resets every cursor on the chain to `startBlock ?? 0`
(`service.ts:344-359`), throughput ≈ 100 logs / 30 s; (4) `syncState` is keyed `(networkId, contract)`, not
by profile, and `commitSchedulers` does not clear it; (5) no hysteresis, clearing needs a second good pass.
Ruled out: SW restart (defaults to `caught-up`), `getTips` failure (emits nothing).

**What the dot means.** Balances come from `BalanceProjector` view simulations and never read the scan. The
dot only says the incoming public-transfer activity feed may be incomplete.

**e2e seed arming.** Source-mode smoke arms an EMPTY seed list; network e2e arms one `TST` seed; artifact-mode
smoke ships the real list but blocks `lb.drpc.live`, so its seeds fail — after this plan those profiles
show a failed-seed row. Smoke counts `tokens-card`; the new rows use different testids.

## Conventions to match

L0–L6 layering + biome `noRestrictedImports`; composables are C1 (receive a connected client, expose
`dispose()`); SFC ordering; testids only in e2e, never invented during moves; cognitive complexity ≤ 15 and
≤ 80 lines per production function, no new suppressions; logging policy (object properties named for what
they are, no template strings); pre-production ⇒ no storage migrations.
