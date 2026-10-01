# Phase 4 · Chain identity and the network cutover

## Steps 1–3 · Chain ids, seeds and the Alpha branches (2026-10-01)

- **Live identity.** `node_getNodeInfo` on the seed endpoint reports `nodeVersion 6.0.0-rc.1`,
  `l1ChainId 11155111` and `rollupVersion 2914217885`, so `CHAIN_IDS.TESTNET` is `2904119610`.
  `MAINNET_ROLLUP_VERSION` and `CHAIN_IDS.MAINNET` are deleted. `MAINNET_L1_CHAIN_ID = 1` and the
  `mainnet` chain kind stay (D5): they are the trust root a stored `mainnet`-kind row is checked
  against, though no mainnet network is seeded.
- **Seeds.** `DEFAULT_SEEDS` is Testnet (the owner's dRPC endpoint, primary, label `dRPC`) and Local
  Network. The endpoint lives once, in `apps/extension/src/wallet/constants/network-endpoints.ts`,
  which the seed, both preflight scripts and `send-fee-privacy.test.ts` read. Its path carries the
  dRPC key, so scripts print the origin only.
- **The D6 flag** `VITE_NULO_E2E_DEFAULT_NET` is gone from `apps/extension/scripts/e2e/agent.sh`,
  `.github/workflows/_extension-smoke-e2e.yml`, `.github/workflows/pr-extension-smoke-e2e.yml`,
  `.claude/skills/e2e-testing/SKILL.md` and `apps/extension/tests/e2e/FIREFOX.md`. Smoke and
  production builds now seed the same network.
- **One fee policy.** `allowSponsored` had no caller besides the Alpha branch, so it is removed end
  to end (`FeeSettingsCard.vue`, `fee-helpers.ts`, `fee-privacy.ts` and their tests). A card with
  no saved pick that resolves defaults to the sponsor (`defaultSponsor`) on every network.
- **Default tokens.** `DEFAULT_TOKEN_SEEDS` is empty until P8. `default-tokens.test.ts` checks each
  seed against the bundled Token class, which is vacuous today, and still checks the runtime's
  `getBundledTokenClassId()` against the artifact. P8 restores the non-empty set equality.
- **The price map keeps one row**, `(CHAIN_IDS.TESTNET, 0x018d47f6…d800f6) → usd-coin`. Deleting
  every token row would drop `usd-coin` from `allCoingeckoIds()` and its band from
  `getSanityBand()`, and the e2e sandbox rule (`VITE_NULO_E2E_PRICE_MAP`) prices every sandbox
  token as USDC through that band. No V6 token sits at the address, so the row prices nothing
  real. The address is Alpha V5's cUSD (`implementations-plan/token-prices/plan.md`), not a V5
  testnet token; a first draft of the comment said otherwise and was corrected. P8 replaces the
  row with the V6 Test USDC.
- **Literal classification** (`rg -n '4248422646|1816023401|4248422647|1821665230|Alpha V5'`
  outside archives, audits and plans):
  - kept, because they only need some chain or some network name: the copy tests that use
    "Alpha V5" as a name (restore-warning, `ImportFullBackupForm`, the onboarding and popup
    `import.test.ts`, `useFullBackupImport`, `Header`); the chain-id fixtures in
    `full-backup-helpers`, `reconcile-pairs`, `chrome-storage-token-seeds`, `chain-switch` and the
    settings/networks `index.test.ts` and `[id].test.ts`; the XOR examples in `chain-identity.ts`
    and its test; the price map's comment naming Alpha V5's cUSD;
  - changed: the fee fixtures, the price-mapped ones (`usePrices`, `TransactionCard`,
    `BalanceView`, `TokenCard`, `TokensView`, `SelectTokenPopup`, holdings), `chain-mismatch`,
    `header-labels` and the incoming-transfer scenarios move to `CHAIN_IDS.TESTNET`; the dApp
    known-contracts list no longer expects the V5 Test USDC;
  - deferred to P5 step 5: `network/networks.test.ts` and
    `network/backup-import-stalled-network.test.ts`.
- **Gotcha: a blanket chain swap collides with the other chain a test already uses.** Moving every
  `MAINNET` fixture to `TESTNET` broke three tests (`holdings` twice, `BalanceView` once) that used
  `TESTNET` as the foreign chain. They moved to `CHAIN_IDS.SANDBOX`. Before a blanket swap, read
  `git show HEAD:<file>` for existing uses of the target id.
- **Specs that need a seeded token mock the seed module.** `token/service.composition.test.ts` and
  `known-contracts.test.ts` replace `./default-tokens` through `vi.hoisted` + `vi.mock` with a
  fixture seed, so they no longer depend on what the shipped list holds.

## Step 4 · The seed preflights

- Both scripts take the address as a required argument, default to the Testnet seed's endpoint,
  and exit 1 on a chain-id mismatch, a missing contract, a failed read or an error. Before, they
  printed each of these and exited 0.
- `seed-preflight.ts` takes an optional expected class id and fails when the live
  `currentContractClassId` differs (compared as `BigInt`).
- `seed-preflight-metadata.ts` fails on a field with no slot in the Standards layout or a value
  that does not decode. Its decoder used to drop non-printable bytes, so a wrong slot could still
  print a plausible name; it now strips zero padding only and rejects anything non-printable.
  Decimals above the seeder's bound of 18 fail.
- Live, 2026-10-01, from `apps/extension`: the SponsoredFPC with its expected class exits 0; a
  wrong class, the absent address `0x…1234`, no argument, and the metadata script on the
  SponsoredFPC (not a token, so `name` and `symbol` read zero) each exit 1.

## Step 5 · Smoke specs for two defaults

- `endpoints.test.ts` reads the Testnet row.
- `backup-roundtrip.test.ts` no longer skips release-artifact runs. The skip existed because
  artifact builds defaulted to Alpha, whose dRPC mainnet path CI runners could not reliably reach;
  PR smoke on `dev` already reached `lb.drpc.live/aztec-testnet`, and artifact builds now seed that
  network too. Whether CI reaches the V6 path is first shown by the PR's smoke run.

## Steps 6–8 · Copy drafts, the build and the live checks

- **U7 draft** (`apps/extension/src/onboarding/pages/fees.vue`, card 01): "Every Aztec transaction pays a fee in fee
  juice, the L2 gas asset. On this testnet, fee juice comes from a free test token on Sepolia,
  Ethereum's test network, bridged over to Aztec. Fee juice is not transferable." The facts behind
  it, read on Sepolia with `eth_call` only: the V6 FeeAssetHandler
  `0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9` mints 1000 of its `FEE_ASSET`
  `0x762C132040fdA6183066Fa3B14d985ee55aA3C18` to any caller, and rc.1's FeeJuice contract has no
  transfer function.
- **U6**: no change drafted. The About row keeps "Alpha Testing" unless the owner picks otherwise.
- **The build regenerates the auto-import typings, but only by appending.**
  `unplugin-auto-import` kept the stale `MAINNET_ROLLUP_VERSION` const in
  `apps/extension/src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` beside it, and
  `skipLibCheck` hid it from the typecheck. It was removed by hand, and a rebuild kept it out.
- **Live, read-only:**
  - `node_getNodeInfo`: `6.0.0-rc.1`, rollup `2914217885`;
  - `seed-preflight.ts` on the SponsoredFPC `0x06a9fa02…924b` with the class of the instance derived
    as `deriveSponsoredFpc` derives it (salt zero, no constructor arguments), `0x2f85ee9e…f433`:
    exit 0;
  - the explorer: tx `0x19ce1157a45be98d5ab413d53293ef6c8404eb0a6d9360fae96367c1d9e248ba` from a
    recent V6 block. `testnet.aztecscan.xyz/tx-effects/<hash>` is a client-rendered shell, so the
    check went to the API it calls: 404 for the hash, and its node-info reports rollup
    `1821665230` (the V5 testnet) at height 102326. **U5 applied**: `EXPLORER_BASE_URLS` maps no
    chain, and transaction rows fall back to copy-hash.
- **rc.1 node API:** `getBlock(n)` returns the header only (`header`, `archive`, `hash`,
  `checkpointNumber`, `indexWithinCheckpoint`, `number`). The body needs
  `{ includeTransactions: true }`, which `getBlocks(from, limit, opts)` takes too.

## Step 9 · Arc A captures

- Six PNGs kept in session scratch for the P5 decision page, never committed: the fresh-install
  Networks page, the header, Home, About, the onboarding fees page and the extension list.
- They came from a throwaway spec, deleted after use, run as two fresh launches: registering a
  profile in the same launch that had visited onboarding closed the target ("Target closed").

## Validation gate (2026-10-01)

Every command below was re-run on the final tree after the smoke fix.

- `bun run typecheck:all`: exit 0 across the 15 workspaces.
- `bun run lint`: exit 0.
- `bun run test:all`: exit 0; in the extension, 630 files passed and 3 were skipped, with 8,604
  tests passing.
- `bun run test:ci-gating`: exit 0, 244 pass and 2 skip. The plans gate
  reports three `path-token` findings, in `embedded-fpc-cap.ts:64`, `vitest.e2e.network.config.ts:40`
  and `prune-stale-branches.sh:6`. Each reference reads the same on `dev`, and the rule is
  report-only.
- Live checks: step 4 and step 8 above.
- **Smoke on Chrome at retry 0, first run: red.** 38 files passed, 3 were skipped and 2 failed, with
  four tests in `rows.test.ts` and `navigation.test.ts` each throwing
  `no default token seed for chain 2904119610`. `tests/e2e/helpers/activity-seeds.ts` took the
  active chain's first default token as its priced token, and this phase empties that list. The
  helper now takes the contract the price map prices on the Testnet and throws a named error if
  that row moves. Every test that does not call the helper passed.
- **Gotcha: emptying a shipped list breaks the e2e helpers that read it, and only a smoke run
  shows it.** Unit tests mock such lists or never reach them, and `typecheck:all` does not cover
  `tests/e2e`. Before emptying one, grep `tests/e2e` for its accessors.
- Smoke on Firefox at retry 0, on the fixed tree: green, 41 files passed and 2 skipped; 162 tests
  passed and 11 skipped.
- Smoke on Chrome at retry 0, re-run on the fixed tree: green, 40 files passed and 3 skipped; 166
  tests passed and 7 skipped.
