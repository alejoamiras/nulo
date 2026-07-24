# Phase 4 — UI: received detail view + dust filter

Log for Phase 4 (D5 detail page + D8 USD dust filter).

## What shipped
- **`/popup/received/:id` detail page** (`popup/pages/received/[id].vue`, D5-A): file-based route
  (vite-plugin-pages), modeled on `tx/[id].vue`. Reads the record via the NEW unfiltered
  `getIncomingTransferById(id)` RPC (`id` is the profile+network-scoped PK, so it only ever returns
  the caller's own record). Rows now route here instead of the token page
  (`TransactionsList.vue`, `RecentActivityView.vue`).
- **Receiver-honest display** (`utils/received-display.ts`, pure + tested): `resolveReceivedType` →
  THREE labels + "Minted" (D5-D); `resolveFromDisplay` → address (pub→pub) / "From private"
  (priv→pub, `from == MAGIC`) / redacted (both note kinds) / mint (`from == 0`) — never renders the
  MAGIC/zero sentinel raw (D5-B). `TransactionIncomingCard` gained the `receivedLabel` prop +
  `data-testid="tx-incoming-kind-chip"` (`tx-incoming-card` preserved).
- **Always-link explorer** (D5-C): the detail page links the tx hash via `getTransactionExplorerUrl`
  where an explorer URL exists, and copy-hashes on the sandbox (chainId 0 has no base URL → `null`).
- **D8 USD dust filter**: `incomingDustUsdThreshold` config (default 0 = off) + a numeric settings
  row in `settings/appearance.vue`. Read-time filter in **`getIncomingTransfers`** (visible → hidden
  → tokenId → **dust** → sort; a price failure can never bypass visible/hidden). Pure
  `isReceiptAboveDustThreshold` (cross-multiplication, no boundary rounding) + `usdThresholdToMicro`.
  Fails OPEN on no CoinGecko mapping OR stale quote (`getQuotes()` already returns FRESH-only, so a
  present quote ⇒ fresh). Does NOT gate the balance outbox. Re-evaluates on `onQuotesUpdated` +
  `incomingDustUsdThreshold` change (composable subscriptions). PriceService added as a service dep.

## Decisions / gotchas
- **Dust filter in `getIncomingTransfers` + a separate unfiltered `getIncomingTransferById`** — the
  most plan-faithful split: the list is dust-filtered (D8) while the detail page (reached from a
  visible row) can always view its specific record. Live add/update merge unfiltered; the composable
  re-fetches on quotes/threshold change to re-apply.
- **`@nulo/aztec-runtime/pxe/public-events` is jsdom-safe at module load** (the MAGIC constant + Token
  artifact load without bb.js — bb.js is lazy in `getTransferLogTag`/`getBundledTokenClassId`), so
  the UI `received-display` util + its test import it directly (drift-free MAGIC).
- **The dust integration test needs a MAPPED `(chainId, contract)`** — the price map only recognizes
  `CHAIN_IDS.MAINNET` (4248422646) + the cUSD proxy contract → USDC. The scenario harness gained
  `makePriceStub` (settable quotes) + `makeTokenBalanceStub`/`makeTaskStub` (Phase 3) so the service's
  new deps resolve.

## Validation gate
- `bun run audit:vue` → typecheck:all exit 0 · test exit 0 (290 files, 3501 tests) · lint exit 0 ·
  build exit 0.
- `bun run test:e2e` (smoke) → GREEN (23 files / 80 tests passed, 1 file / 6 tests skipped, exit 0,
  320s) once built + run with **CI's smoke env** (see the smoke-triage note below). The operative fix
  was the build environment, NOT this phase's code and NOT the #313 merge.
- 40+ named component/unit tests present + green: chip per resolved type (received-display + card
  chip); From card per type (address/private/redacted/mint); testid pins (tx-incoming-kind-chip);
  always-link vs sandbox copy-hash (explorer URL); getIncomingTransfers dust integration (raise
  hides more / lower re-reveals / fail-open on no-mapping AND stale / never bypass visible/hidden;
  getIncomingTransferById unfiltered); composable re-fetch on quotes + threshold.

## Smoke-triage: the red was a BUILD-ENV mismatch with CI, not this phase's code
The first `test:e2e` run failed on `backup-roundtrip` (`waitForActiveAccount` 240s hang). Ran the full
flake-vs-breakage protocol rather than assuming flake — and the trail had a decoy before the real
cause:
- **Not load flake:** re-ran isolated on a quiet machine (load 0.35, 15Gi free) → failed again (3
  retries, 797s).
- **Not this phase's code:** `git log dev..HEAD` shows I touched NEITHER the backup test NOR the
  backup service; my new storage roots are absent from the backup slice registry; the service boot
  path (`hydrateSchedulers`/`drainBalanceOutbox`) is fully `.catch()`-guarded and awaits no node RPC.
- **Decoy — the #313 lead.** My branch was 1 commit behind `origin/dev` (missing #313 `afecc82`,
  "import default network / active-network restore"). I merged it — legitimate for dev-currency and it
  IS the real fix for the *production Alpha-mainnet* import path — but a rebuild + re-run STILL failed
  (the hang just moved 149→132). So #313 was NOT the operative fix here. Merging it wasn't wrong; it
  was the wrong suspect.
- **Root cause — my local build/run omitted CI's smoke env.** A second failure surfaced the real
  signal: `backup-migration.test.ts`'s fixture-arming guard `AssertionError: NULO_E2E_MIGRATION_FIXTURE
  is unset … (see _smoke-e2e.yml)`. CI (`.github/workflows/_smoke-e2e.yml`) builds the smoke extension
  with **`VITE_NULO_E2E_DEFAULT_NET=testnet`** (+ `VITE_NULO_E2E_MIGRATION_FIXTURE=1`) and runs with
  `NULO_E2E_MIGRATION_FIXTURE=1`. That env pins the SEEDED-ACTIVE network to testnet
  (`network/service.ts:80` `E2E_DEFAULT_ACTIVE_TESTNET` → `isPrimaryActive`). My build used the
  production default (**Alpha mainnet**), so the fresh-import account setup synced against a real
  mainnet node and ate the node client's full timeout envelope on the "Finishing…" screen — exactly
  what the `_smoke-e2e.yml:72-74` comment warns about. Rebuilt with the CI env → **smoke green, 80
  passed, 320s** (vs 577s of timeouts).
- **Reproduce CI's smoke locally (both steps required):**
  `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet bun run --cwd apps/extension build:chrome`
  then `NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e`.
- **Lessons:** (1) `test:e2e` runs against `apps/extension/dist/chrome` and never builds it — after
  ANY source/merge change, rebuild before trusting the result. (2) The bare `bun run test:e2e` is NOT
  CI-equivalent: the smoke suite is calibrated for a testnet-default build; without
  `VITE_NULO_E2E_DEFAULT_NET=testnet`, chain-adjacent flows (backup import, account convergence) hit
  the live Alpha node and time out locally. (3) The network e2e (`agent.sh`) already sets this env, so
  Phase 5 is unaffected. (4) Beware a plausible decoy fix (#313) that changes symptoms without
  resolving the root cause — a moved failure line ≠ a fix.

## Codex consults
Round 1 (post-impl) launched at Phase-4 close as part of the multi-round codex pass — logged in
phase-5 lessons alongside the ship gate + subsequent rounds. The smoke triage itself was deterministic
(git/CI/env evidence, no judgment fork), so it needed no consult.
</content>
