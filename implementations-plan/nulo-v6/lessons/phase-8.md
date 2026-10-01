# Phase 8 · Arc C: unleashed's V6 tokens and the bridge link

Run on 2026-10-01 from the follow-ups entry, on `feat/v6-testnet-seeds` off `dev` at `18a38265`.
The owner's instruction, the same day: "We should also send to another opus5.5 agent the task of
adding: testnet.app.unleashed.systems (we've added a domain to the unleashed fee juice stuff) and
also, adding their deployed token's addresses to the testnet token list. as a follow-up I feel that
that token list should not go embedded into the build, it should be fetched so we dont need to
release everytime we add a token, but obviously that's a follow-up".

## Step 1 · unleashed's manifest and the PrivateFPC

- unleashed `main` at `b7783b8f` (its #25; the V6 manifest came in #23, merged as `955946d`),
  `apps/tools/public/testnet-bridge.json`, read as data: `schema 2`, `network testnet`,
  `l1ChainId 11155111`, `walletChainId 2904119610`, four `bridge.tokens`.
- `privateFpc.address` is `0x0b3bc795…3c08`, version `6.0.0-rc.1`: equal to
  `CANONICAL_PRIVATE_FPC.address` in `protocol-fpcs.test.ts`. Its `artifactDigest`,
  `68f0c043…3974`, is the sha256 of the raw `target/private_contract-PrivateFPC.json` the wallet
  derives from. The wallet's own pin, `7092f28d…67c6`, hashes a key-sorted copy without the debug
  file map, so the two digests differ by construction and still name the same bytes.

## Step 2 · The four seeds

- Live pins, from `apps/extension`, against the Testnet seed's endpoint (origin
  `https://lb.drpc.live`; the path carries the key and was never printed). Every run first matched
  the node to the pins: `nodeVersion 6.0.0-rc.1`, `l1ChainId 11155111`, `rollupVersion 2914217885`.
  - `seed-preflight.ts <address>` for each of the four: exit 0, `originalContractClassId` equal to
    `currentContractClassId` = `0x24c34002…1505`, deployer `0x1e0bdb47…f2fe`, the manifest's
    `bridge.l2.hub.address`. The manifest's `bridge.l2.tokenClassId` is the same class. Its
    `tokenArtifactSha256` is not the sha256 of the wallet's bundled `token_contract-Token.json`
    (another representation of the artifact); the class, which is what the seeder pins, agrees.
  - `seed-preflight-metadata.ts <address>`: exit 0; `Test USDC`/`USDC`, `Test USDT`/`USDT`,
    `Test EURC`/`EURC`, `Test GBPC`/`GBPC`, each with 6 decimals, at block 4202. Each equals the
    manifest's `displayName`, `displaySymbol` and `decimals`.
  - The bundled class, computed as `default-tokens.test.ts` does from
    `@aztec-foundation/aztec-standards` 6.0.0-rc.1's `token_contract-Token.json`: `0x24c34002…1505`.
    Equal, so no HOLD (I10).
  - A second pass with that class as the expected pin: `currentContractClassId … OK`, exit 0, for
    all four.
- The addresses live once, in `TESTNET_TOKENS` (`default-tokens.ts`); the seed list and the price
  map read them. `default-tokens.test.ts` is the non-empty set equality again.
- The price map's Testnet row moved from Alpha V5's cUSD address to Test USDC, priced as USDC. Nine
  unit specs used the cUSD literal as "a price-mapped Testnet contract"; they take
  `TESTNET_TOKENS.USDC` now. `tests/e2e/helpers/activity-seeds.ts` takes the chain's first
  price-mapped seed, in the same commit.

- Codex round 1 found the decimals only bounds-checked (0 to 18), so a node could seed a token
  with any decimals in range and rescale every amount it shows and sends.
  `seed-preflight-metadata.ts` reads them from public storage, which retires the old reason for
  not pinning them ("cannot be captured without a live simulation"). They are an equality pin now:
  `expectedDecimals: 6` on the four seeds, checked in `TokenSeeder.metadataValid`, and 18 in the
  e2e sandbox reader, the decimals `global-setup.ts` deploys TST with. The name stays an
  uncompared label (`displayName`), as before.

## Step 2 · Artifact smoke and dRPC: accepted

- Artifact-mode smoke (`NULO_E2E_ARTIFACT_RUN=1`) runs the production bundle with only the price
  host blackholed, so every profile it registers on the default Testnet seeds the four tokens
  through the dRPC endpoint. Counted with a Chrome NetLog per launch, by host only (a
  `PUPPETEER_EXECUTABLE_PATH` wrapper adds `--log-net-log`; no path was printed):
  - One fresh profile, its popup open for 183 s. 0.29.0 made 25 requests, all in its first 6 s.
    This branch made 192: 106 in the first 30 s while seeding (placeholders at 4.3 s, all four
    seeded by 9.6 s, the list settled at 10.6 s), then 10 to 24 per 30 s while the popup stayed
    open, from the four tokens' balance and transfer sync (`aztec_getBlockNumber` 71,
    `aztec_getContract` 49, `aztec_getChainTips` 35, `aztec_getBlockData` 31, the two
    `get…LogsByTags` 55).
  - A whole artifact smoke run on Chrome: 3,280 requests over 86 browser launches, 21 of them
    showing the seeding burst (87 to 212 requests each). Had those 21 made 0.29.0's 25, the run
    would have made about 1,300 (an estimate), so the seeds add about 2,000 requests per artifact
    run. The nightly and each release run one per browser.
- Decided: accept it, with no dRPC block in artifact mode.
  - It is the one run that seeds the shipped list end to end against the live chain before users
    get it. A block would leave the four placeholders failing after their retries, a state no
    user sees.
  - Artifact smoke already reaches the network: `backup-roundtrip.test.ts` has run against it
    since P4.
  - The key ships in every installed wallet and is not origin-locked (the plan's § Security &
    Adversarial Considerations, and the tools extraction's decision 21), so about 2,000 requests
    a run is load on the owner's quota, not exposure. dRPC's plan limits were not checked.
- What the specs needed. That run failed one spec, `rows.test.ts`: `coveredAt("activity-fiat")`
  answered `nav-settings`, because three token rows now sit above Home's first activity row and
  push it under the bottom nav. The spec now scrolls the row into view before hit-testing it, as
  `pointerClick` already does. Its wait for Home's list had assumed an empty list; it now waits
  for the list's own settledness (`data-settled` on `tokens-list`, new in `TokensView.vue`) with
  nothing in it loading, within 150 s (the seeder's 15 s and 60 s retries), after codex rounds 1
  and 2 found two ways the first version could pass early.

## Step 3 · The bridge link

- `curl -sI https://testnet.app.unleashed.systems`: HTTP/2 200 from Cloudflare, `text/html`, with
  COOP/COEP and a CSP whose `connect-src` names the dRPC Testnet origin. The page is
  "Unleashed · Aztec tools" with `<meta name="nulo-build" content="0.1.0+b7783b8f">`, unleashed
  main's head, and its `/testnet-bridge.json` is byte-identical to `main`'s. Not a parking page.
- The constant is network-independent (the fee card, the send review sheet's remedy, `send.vue`),
  as the owner chose on 2026-09-28. The wallet ships two networks, the V6 testnet and Local
  Network, and the testnet domain is wrong for neither; the gas-link follow-up keeps the mainnet
  case.

## Step 5 · The token rows and their prices, for the owner

- Screenshots for the sign-off page, not committed: a fresh V6 testnet profile, dark, 360×600 at
  device scale 2, every balance 0, quotes seeded. Home shows three rows, and empty rows sort by
  name, so it shows EURC, GBPC and USDC with USDT behind "View all"; Holdings folds all four under
  "4 EMPTY · SHOW". Three pricing options, each shot on Home, Holdings and the open fold: A as
  built (Test USDC as USDC); B, also Test USDT as `tether` and Test EURC as `euro-coin`; C, also
  Test GBPC as `tokenised-gbp`.
- Recommended B (confidence moderate). CoinGecko, read 2026-10-01: `tether` 0.9997 on a $184B
  cap, `euro-coin` 1.12 on $473M. No coin is canonical for GBPC (a search for "gbpc" is empty),
  and the nearest GBP stablecoin, `tokenised-gbp`, trades about $132k a day on $26.6M: a thin
  quote is the easiest to push, and a GBP figure on a test token buys the user little.

## Codex (high, adversarial, read-only)

- Round 1, on `2c58fa7e`: three medium findings, all accepted.
  1. Seeded decimals were only bounds-checked. Fixed with the `expectedDecimals` pin (step 2),
     with a unit test for an in-range value other than the pin.
  2. The wait could pass before Home's list had settled: `TokensView` hides its skeleton once any
     row shows, so a row shown before the seed status loaded looked final. Fixed: the list exposes
     its own `isSettled` as `data-settled`, pinned through both snapshot orders in
     `TokensView.test.ts`.
  3. The 60 s wait was shorter than the seeder's retries (15 s, then 60 s). Fixed: 150 s, added to
     the two tests' own timeouts.
- Round 2: two medium findings.
  1. `TokenService.updateToken` refetches symbol and decimals without the seed pins. Rejected:
     nothing calls it (`git grep "updateToken("` finds the definition and its unit tests), its
     port answers only the wallet's own pages, and no dApp route reaches it; the symbol pin has had
     the same exposure since seeding shipped. Round 3 confirmed the triage.
  2. A failed import row, retained for 30 s, hides its seed's placeholder and shows no spinner, so
     the wait could pass while the seed was still due back. Fixed: any `token-import-row` counts
     as loading.
- Round 3, verification: "No material findings". It also confirmed that scrolling the row into
  view before `coveredAt` keeps what the test proves.

## Validation gate

- `bun run test:all` (the extension: 631 files, 8,648 tests), `bun run typecheck:all`,
  `bun run test:ci-gating` (255 pass, 2 skip) and `bun run check:plans`: exit 0.
- Smoke, `--retry=0`, on builds of the codex-converged tree:
  - the recipe (armed build, empty seed list, migration fixture): Chrome 40 files passed, 3
    skipped, 166 tests; Firefox 41 passed, 2 skipped, 162 tests;
  - release-artifact mode: `rows.test.ts` on Chrome, 6 of 6 (the first run's failure, fixed),
    and the whole suite on Firefox, 40 files passed, 3 skipped, 156 tests.
