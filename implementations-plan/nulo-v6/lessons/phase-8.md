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
- dev's #750 landed its own version of that wait while the arc was open (`waitForSettledTokens`:
  the empty state, or rows none of which is loading, within 15 s). The rebase keeps its helper and
  its timeout diagnostics and adds the list's `data-settled`, ghost rows as loading, 150 s on the
  first wait, and the scroll; the `e2e-testing` skill's flake row 44 says so.

## Step 2 · The seeds' ongoing dRPC cost, for the owner

- The 192 requests above mix one-time seeding with ongoing sync, which every user pays on the
  shared key. Measured on 2026-10-01 before the owner's sign-off, with no code change: production
  Chrome builds of the arc's tip with four seeds, one (Test USDC) and none (the tip with the list
  emptied, which is what dev ships), a fresh profile each, unlocked by the e2e fixture. Six
  sessions ran in parallel under the e2e lock, so all saw the same chain, each with a NetLog
  counted by host only; JSON-RPC methods were read from the RPC host's HTTP/2 plaintext (capture
  mode Everything). Seeding settled 0.6 to 13 s after unlock. Window: minutes 3 to 10.

| Seeds | Popup | HTTP requests/min | JSON-RPC calls/min |
|---|---|---|---|
| 0 | open | 0 | 0 |
| 0 | closed | 0 | 0 |
| 1 | open | 16.7 | 18.7 |
| 1 | closed | 17.7 | 19.7 |
| 4 | open | 28.9 | 66.0 |
| 4 | closed | 28.9 | 66.0 |

- A wallet timer, not the chain. Every seeded session sent one burst every 30 s exactly (13 of 13
  gaps), 24 to 37 calls at four seeds whether or not a block had arrived, while blocks came every
  60 or 90 s (mean 72 s). With no tokens nothing polls after unlock: 19 requests in minute 0, then
  none. The timer is the incoming-transfer pollers' `DEFAULT_POLL_INTERVAL_MS` (30 s): a note scan
  of every watched token per account, and a public-event scan per token. They run in the service
  worker, which the runtime's 10 s storage heartbeat keeps alive, so the popup changes nothing.
  They stop at lock, since no active profile means an empty scheduler set (read in the code, not
  measured).
- Calls grow about linearly with tokens (about 19 a minute for the first, 15.5 for each more),
  requests more slowly, since the client batches what goes out together (1.1 calls per request at
  one seed, 2.3 at four). At four seeds, calls a minute: `aztec_getBlockNumber` 16.0,
  `aztec_getContract` 11.1, `aztec_getChainTips`, `aztec_getBlockData`,
  `aztec_getBlockHashMembershipWitness` and `aztec_getPublicLogsByTags` 8.0 each,
  `aztec_getPrivateLogsByTags` 5.1, `aztec_getBlock` 1.7.
- At four seeds that is about 1,700 requests (4,000 calls) per unlocked hour. The one-time part is
  small next to it: minute 0 has 113 requests against 19 with no seeds, the pollers' first two
  ticks included, and the steady rate holds from minute 1. Every response was a 200 across the
  six concurrent profiles. Puppeteer's attachment could also keep the worker alive, which the
  heartbeat does anyway in a real Chrome. The NetLogs were deleted after counting.
- The pollers are unchanged here: an imported token costs the same as a seed, and the two
  candidates are in `follow-ups.md` § Incoming transfers.

## Step 3 · The bridge link

- `curl -sI https://testnet.app.unleashed.systems`: HTTP/2 200 from Cloudflare, `text/html`, with
  COOP/COEP and a CSP whose `connect-src` names the dRPC Testnet origin. The page is
  "Unleashed · Aztec tools" with `<meta name="nulo-build" content="0.1.0+b7783b8f">`, unleashed
  main's head, and its `/testnet-bridge.json` is byte-identical to `main`'s. Not a parking page.
- The constant is network-independent (the fee card, the send review sheet's remedy, `send.vue`),
  as the owner chose on 2026-09-28. The wallet ships two networks, the V6 testnet and Local
  Network, and the testnet domain is wrong for neither; the gas-link follow-up keeps the mainnet
  case.

## Step 4 · The owner's hands-on run

- 2026-10-02, the owner: "#751, #752 both work fine!" Asked whether the run covered sending Test
  USDC and paying once with Private Fee Juice, in both browsers: "Yes, it worked perfectly." No tx
  hashes were recorded.
- Funds come from unleashed's faucet ("Get SIGNAL"), which needs no gas; the Firefox reviewer
  notes now say so.
- One bug: on the first open after onboarding, Home showed four token rows, then three. Home's
  three-row cap counted finished rows only, so the seed placeholders sat on top of it until the
  last one landed. The fix went to its own PR.

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

- The owner's answer, 2026-10-02: "Signed-off details." in chat, and on the sign-off page call 3,
  token prices: "b", and the tokens sign-off: approved, with no note. B is applied: Test USDT
  prices through `tether` and Test EURC through `euro-coin`, in Test USDC's 0.20 to 5 band, each
  labelled with its proxy ticker, and Test GBPC stays unpriced. The screenshot build carried the
  same price-map rows and tickers. The live CoinGecko check (`COINGECKO_REAL_TESTS=1`) resolves
  both new ids in band. All four seeds stay: the owner saw their ongoing cost and asked for none
  fewer.

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
- Round 4, after the rebase onto #750: "No material findings". The reconciled wait has no early
  pass with an empty list or four seeds, and can time out only where a snapshot never answers,
  which it should expose. The docs' poller mechanism checked out against the code; the 30 s is
  nominal, since a singleflight tick or a public scan's backoff can skip work.

## Validation gate

- `bun run test:all` (the extension: 631 files, 8,648 tests), `bun run typecheck:all`,
  `bun run test:ci-gating` (255 pass, 2 skip) and `bun run check:plans`: exit 0.
- Smoke, `--retry=0`, on builds of the codex-converged tree:
  - the recipe (armed build, empty seed list, migration fixture): Chrome 40 files passed, 3
    skipped, 166 tests; Firefox 41 passed, 2 skipped, 162 tests;
  - release-artifact mode: `rows.test.ts` on Chrome, 6 of 6 (the first run's failure, fixed),
    and the whole suite on Firefox, 40 files passed, 3 skipped, 156 tests.
- Network, `e2e:agent tests/e2e/network/default-token-seeding.test.ts` on Chrome: passed. The
  sandbox TST token seeds under the reader's new decimals pin (18).
- After the rebase onto #750 (2026-10-02): `bun run test:all` (the extension: 631 files, 8,648
  tests), `typecheck:all`, `lint`, `test:ci-gating` (255 pass, 2 skip) and `check:plans`: exit 0.
  `rows.test.ts`, `--retry=0`, 6 of 6 in each of four runs: release artifacts (four live seeds)
  and the recipe (armed build, empty list), each on Chrome and on Firefox.
