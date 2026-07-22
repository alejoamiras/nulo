# token-prices — live fiat prices + default token seeding

**Status:** ✅ **APPROVED** (user, 2026-07-21) — fable `conditional approve` (conditions adopted) · codex R1 `reject` → revised · R2 fresh-pass `reject` → amended · R3 **`conditional approve`** (conds 1–2 adopted; 3–5 resolved at the gate). All eight Asks resolved — see "Ask resolutions" below. Implementation may start.
**Tier:** `/blueprint mid` · **Created:** 2026-07-21 · **Worktree:** `token-prices` · branch `worktree-token-prices`

## Summary

Two coupled features:

1. **Live token prices.** A new background `PriceService` fetches USD prices from CoinGecko for a static set of mapped assets, caches them, and broadcasts updates. UI surfaces (home header, token rows, send flow, fees) render fiat values from the cache. Aztec-native tokens that aren't indexed anywhere are mapped to an Ethereum-side ticker: cUSD → USDC (`usd-coin`), Fee Juice → AZTEC (`aztec`). Both ids verified live against the CoinGecko API on 2026-07-21.
2. **Default token seeding.** The wallet starts with a per-network list of pre-added tokens: cUSD on Alpha Mainnet and Testnet, empty for Devnet/Local. Seeding is lazy and reuses the existing `parseTokenInterface` → `addToken` path (metadata + `FnImpl`s from chain), hardened with a pinned contract-class check so a hostile RPC can't forge a "default token".

## Locked decisions (user 2026-07-21; revised post-audit)

| Decision | Choice |
|---|---|
| Price provider | CoinGecko `/api/v3/simple/price` (+`include_last_updated_at=true`), free tier. Optional build-time key (`VITE_COINGECKO_API_KEY`) sent as `x-cg-demo-api-key` when present; never set in release builds (enforced by a release-bundle negative check). CMC rejected: free tier mandates a key + forbids browser-side use. |
| A · Home header | **A1** — token amount primary; `≈ $x.xx` secondary line; "Account Value" becomes a real fiat aggregate, labeled when partial ("priced assets only"). |
| B · Token rows | **B1** — holding fiat value between amount and private/public split; omitted (not $0.00) when unpriced. |
| C · Send amount | **C3** — fiat-denominated input toggle with debounce + skeleton, under the quote-consistency policy below. |
| D · Fees | **D2** — live AZTEC price replaces `FEE_JUICE_USD_RATE = 0.02`; fiat line on the home gas card; plus the previously-missed fake-USD surfaces (see Phase 4). |
| Seed set | cUSD `0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6`. **As implemented (post-preflight re-scope, see lessons/phase-2.md): MAINNET-ONLY** (chainId 4248422646 — the 5.0.1 identity; the plan-era ids were stale twice over, caught first by audits, then by the live preflight + dev rebase). Testnet (1816023401): cUSD NOT deployed post-reset — one-line follow-up in `default-tokens.ts` when redeployed; price map already carries the testnet mapping. Local: empty (devnet dropped upstream). Pins: classId equality (live-captured `0x0225da0f…`), symbol equality from product intent, decimals bounds+TOFU-recorded (simulation-free capture proved impossible — deviation documented). |
| Privacy | Batched single request covering the full mapping set + `showFiatValues` config toggle (default on) with a real settings UI. Refresh is **unlock-gated** (no fetches while locked/idle — see cadence policy). |
| No fake numbers | Unpriced/stale → fiat UI absent, never $0.00. ALL fake placeholders removed: `BalanceView`, `AmountCard`, `SelectBalanceTypePopup`, `FeeJuiceCard`. |

### C3 quote-consistency policy (adopted from both audits)

1. Fiat→token conversion uses a **frozen quote snapshot** taken when the fiat editing session starts (input focused / toggle flipped); background refreshes update only the secondary display line, never the derived send amount mid-edit.
2. **Submit sends exactly the displayed token units** — no re-conversion at submit time.
3. Submit is **disabled while a conversion is pending** (debounce in flight).
4. At submit, if the current quote deviates from the snapshot by **> 1%** (or the snapshot is stale per the 15-min rule), the send is blocked pending explicit re-confirmation with the re-derived amount shown.
5. The conversion line carries the proxy label — `≈ $124.94 via USDC` — making the cUSD→USDC proxy explicit where it matters most.
6. Inverse conversion `usdToTokenAmount` is **decimal-string fixed-point bigint** (no `Number` pivot), **round-DOWN** to token decimals; property-tested at extreme magnitudes (18-decimal max balances, dust amounts).
7. **The snapshot/pending/reconfirm state gates the actual submit path** — `send.vue` owns enablement and `handleSend` (`AmountCard` is a dumb composite); the guard state is lifted to the page and fails closed when no fresh quote exists in fiat mode.
8. **Fiat-mode Max/Half are bigint-exact:** they pass raw base units through (sent amount = exact balance-derived units; the fiat figure is display-derived). The pre-existing token-mode `Number` paths stay verbatim per repo convention — only the new fiat-mode paths carry the exactness requirement.
9. **Single-oracle limitation, stated honestly:** the >1% reconfirm compares CoinGecko against itself — it catches movement, not a persistently wrong/poisoned/depegged quote. The mitigations for that class are the `via USDC` label, the always-visible token-unit confirmation (what you see is what sends), and per-id sanity bands. Whether single-oracle proxy conversion is acceptable for C3 at all is **Ask 7** — an explicit user decision, not a silent assumption.

### Refresh cadence policy

- Alarm (3 min, via the `BrowserApi.alarms` port) runs **only while a profile session is unlocked**; cleared on lock. No always-on beacon.
- On popup connect with stale cache → immediate refresh.
- Executor-side (D2): **cache-or-nothing** — no executor-triggered fetches, ever. A fetch fired at transaction time would leak transaction timing to the network/provider (final codex pass, High). Stale cache at estimate time → USD simply omitted.
- A top-level `chrome.alarms.onAlarm` listener is registered synchronously at SW module scope (`wallet/index.ts`) and dispatches into the service — MV3 requires sync registration to wake the SW; alarm reconciled on every boot.
- 429/failure → exponential backoff with jitter; cache served meanwhile.

## Design

### Price core (Phase 1)

```
packages/extension/src/wallet/services/price/
├── spec.ts        # PriceQuote, RPC methods + events
├── service.ts     # fetch, cache, alarm dispatch, config gate
├── client.ts      # PriceServiceClient (popup)
├── price-map.ts   # STATIC map: (chainId, contract) → { coingeckoId, sanity: {min,max} }, + FEE_JUICE → "aztec"
└── service.test.ts
```

- **Single authoritative read path:** `getUsableQuote(id)` validates shape at **read time** (numeric, finite, > 0, inside the per-id sanity band from `price-map.ts`), enforces the staleness rule (15 min, using `min(fetchedAt, provider last_updated_at)`) and the config gate. Executors call this same service method SW-side (no independent `chrome.storage` parsing anywhere).
- **Write discipline:** refreshes serialized; a response never overwrites a newer one (monotonic timestamps); kill-switch flip aborts in-flight fetches (AbortController + generation counter) so a late response can't repopulate a cleared cache; cache cleared on disable.
- **No new host permission by default:** CoinGecko serves `Access-Control-Allow-Origin: *` (verified live 2026-07-21) so the SW fetch works without a manifest change — avoiding the Chrome permission-warning/disable-on-update cycle a new `host_permissions` origin can trigger. Phase 1 verifies from the SW context; the manifest entry is the documented fallback only if COEP/CORS blocks in practice.
- **Config gate:** `showFiatValues: boolean` (default `true`) on `Config`, **with a settings-page toggle** (copy: "Show fiat values" / "Prices are fetched from CoinGecko"). Off → alarm cleared, cache cleared, fetches aborted, every fiat surface hides.
- **Conversion helpers:** `tokenAmountToUsd` + `usdToTokenAmount`, both pure bigint fixed-point (mirroring `feeToUsd`'s scaled-rate approach); UI consumes via a `usePrices` composable (C1 convention: parent owns client lifecycle) which uses `useTicker` so staleness flips reactively, not only on events.
- **Not exposed to dApps:** PriceService is absent from the wallet-bridge dispatcher wiring; a reachability test pins that it stays that way.

### Default token seeding (Phase 2)

- `default-tokens.ts`: `{ chainId, contract, expectedClassId, expectedSymbol, expectedDecimals }[]`. Pins captured in the Phase 2 live preflight (TOFU from the canonical public RPCs, documented in lessons).
- **Trigger:** post-unlock, network-ready, **single-flight** per `(profileId, chainId)`. Uses the profile's first account on that chain; **zero accounts → skip silently** (not fail), retry next unlock.
- **Trust boundary — single-pass validated snapshot (no validate-then-refetch):** the seeder runs ONE locked pass per entry: parse the interface → check the pinned `currentContractClassId` against THAT parse result → simulate metadata once using THAT interface → bounds-check + match pinned symbol/decimals → persist/journal **that exact snapshot** via a seed-specific `TokenService` entry point that accepts pre-validated metadata (reusing `addToken`'s lock/journal/idempotency but skipping its internal re-fetch). This closes the TOCTOU the final codex pass flagged: `addToken`'s own `fetchTokenMetadata` re-simulation could otherwise consume different RPC answers than the ones validated. Mismatch at any step → hard skip + log; nothing persisted or journaled. Residual accepted risk: validation itself registers the (possibly hostile) artifact in the PXE DB — registration is inert (no execution outside sandboxed simulation) and the artifact is orphaned on skip.
- **Journal:** `OperationOriginSchema` extended with `{ origin: "seed" }` (typed union + zod + subtitle "Default token" plumbed through, + journal render/GC tests). Seeder validates BEFORE journaling so failed probes don't spam permanent failure rows.
- **Attempt cap with recovery:** marker `nulo:core:token-seeded@<profileId>` stores per-entry `{ attempts, cappedAtVersion, outcome }`; success → permanent skip; 3 failed attempts → skip until the next extension version (each release retries once — transient RPC failures don't permanently kill a default token, zero extra UI).
- **Deletion tombstone (distinct from the attempt marker):** user deletion of a seeded token writes a `deletedByUser` tombstone for that `(chainId, contract)`. **Tombstones survive `purgeChain`** — delete-token followed by network remove/re-add must NOT resurrect the default (codex final-pass condition 2). Attempt entries ARE cleared on `purgeChain` (fresh chain, fresh attempts); everything for the profile goes on profile deletion. Both behaviors pinned by tests.
- **Pre-registration validation (codex final-pass condition 1):** the pin check runs against the FETCHED instance (expected class id + recomputed address) **before** the artifact is registered in the PXE; if the runtime API turns out to force registration-first, the seeder wraps it in a rollback (unregister/remove artifact on mismatch) so a rejected seed cannot durably poison the PXE DB — which path applies is verified and documented in Phase 2 lessons. The seed-specific entry point takes the SAME non-reentrant TokenService lock `addToken` uses and persists the exact validated snapshot without refetching.
- **No storage version bump:** additive only.

### UI surfaces (Phases 3–5)

- **A1 + B1 (Phase 3):** `usePrices` feeding `BalanceView.vue` (fiat line; real Account Value aggregate with "priced assets only" affordance when partial) and `TokenCard.vue` (fiat line, omitted when unpriced). Fake `$0.00` in `BalanceView` and `SelectBalanceTypePopup` removed/replaced.
- **D2 + missed surfaces (Phase 4 — moved BEFORE C3 per codex risk-ordering):** executors + `buildFeeEstimate` consume `getUsableQuote` SW-side; `FEE_JUICE_USD_RATE` removed; `feeToUsd` takes explicit pricing (ripples to `popup/pages/tx/[id].vue:117-119` — historical fees priced at current spot, kept and noted in a tooltip); `GasBalanceCard.vue` + `FeeJuiceCard.vue` fiat lines; no-quote → USD omitted.
- **C3 (Phase 5 — last transaction-affecting phase):** `AmountCard.vue` fiat/token toggle per the quote-consistency policy above; debounced (~250 ms) skeleton on the secondary line; Max/Half stay token-domain and re-derive the fiat display; toggle only offered for priced tokens; testids on every new interactive element.

## Phases

### Phase 1 — Price core ✓

Deliverables: `price/` service + client + spec + `price-map.ts` (with sanity bands), conversion helpers, `showFiatValues` config field + settings toggle UI, top-level alarm dispatcher, dispatcher-absence reachability test.
Tests: unit (fake fetch: happy, malformed, 429+backoff, timeout, config-off abort/generation, staleness incl. provider `last_updated_at`, monotonic writes, sanity-band rejection, alarm reconcile); real-data `describe.skipIf(!process.env.COINGECKO_REAL_TESTS)` (diagnostic, local-only — not a CI gate).

**Validation gate**
- Commands: `bun run lint && bun run typecheck && bun run test` · locally once: `COINGECKO_REAL_TESTS=1 bun run test packages/extension/src/wallet/services/price` · SW-context CORS check documented in lessons (extension loaded, fetch succeeds without host_permissions).
- Pass: exit 0; new tests green; CORS check logged.
- Layers: lint/typecheck · unit · real-data integration (local).

### Phase 2 — Default token seeding ✓

Deliverables: `default-tokens.ts` (with pinned class ids from preflight), single-flight seeder wired to unlock/network-ready, marker storage + hygiene, `origin: "seed"` schema + subtitle plumbing.
Tests: unit (fresh profile seeds; already-present skips; no-account skips; failure retries then caps at 3; cap resets on version bump; deletion respected; chainId 0 no-op; class-id mismatch hard-skips; metadata-mismatch hard-skips; concurrent trigger single-flights; attempt entries cleared on purge/profile-delete while **deletion tombstones survive purgeChain** (delete + network re-add does NOT resurrect); **marker-write ordering + SW-death mid-seed leaves no duplicate journals** — restart-simulation via the fake browser API) + an integration test driving the REAL unlock/network-ready hook (not just the seeder function in isolation).

**Validation gate**
- Commands: `bun run lint && bun run typecheck && bun run test`
- Pass: exit 0. PLUS the **live seed preflight** (blocking): a documented probe (script or manual, logged in `lessons/phase-2.md`) proving `parseTokenInterface` resolves cUSD at the pinned address on CURRENT Testnet (4229590296) and Mainnet (2934756904), capturing class id + symbol + decimals into `default-tokens.ts`. Wrong/missing deployment → stop, surface to user (both audits: unit tests cannot catch a wrong address by construction).
- Layers: lint/typecheck · unit · live-chain preflight.

### Phase 3 — Header + token rows (A1 + B1) ✓

Deliverables: `usePrices` composable (ticker-reactive staleness); `BalanceView.vue` fiat line + real labeled aggregate; `TokenCard.vue` fiat line; `SelectBalanceTypePopup.vue` fake-$0.00 removal.
Tests: composable unit (≥10 — lifecycle, staleness flip via ticker, config-off, dispose); component tests (priced/unpriced/stale/partial-aggregate/no-fake-zero).

**Validation gate**
- Commands: `bun run lint && bun run typecheck && bun run test:components && bun run test`
- Pass: exit 0; new component tests green.
- Layers: lint/typecheck · unit · component.

### Phase 4 — Fees live rate (D2 + missed surfaces) ✓

Deliverables: executors + `buildFeeEstimate` via `getUsableQuote`; `FEE_JUICE_USD_RATE` removed; `tx/[id].vue` current-spot pricing + tooltip; `GasBalanceCard.vue` + `FeeJuiceCard.vue` fiat lines; no-quote fallback.
Tests: fee-estimation unit updated (injected pricing, no-quote); component tests for both cards.

**Validation gate**
- Commands: `bun run lint && bun run typecheck && bun run test && bun run test:components`
- Pass: exit 0.
- Layers: lint/typecheck · unit · component.

### Phase 5 — Send flow fiat input (C3) ✓

Deliverables: `AmountCard.vue` toggle + **`send.vue` submit gating** implementing the full quote-consistency policy (frozen versioned snapshot bound to (chainId, token, quote timestamp, raw input); pending-disable and >1% reconfirm enforced where `handleSend` lives, fail-closed without a fresh quote; proxy label; round-down bigint inverse; fiat-mode Max/Half passing raw base units), debounce + skeleton, testids.
Tests: ≥10 new cases across AmountCard + send-page harness (toggle both ways; round-down at 6/18 decimals; property tests at extreme magnitudes; fiat-mode Max/Half exactness; snapshot freeze under mid-edit refresh; >1% move reconfirm gates handleSend; stale/absent-quote fail-closed; unpriced hides toggle; pending-disable; skeleton).

**Validation gate**
- Commands: `bun run lint && bun run typecheck && bun run test:components && bun run test`
- Pass: exit 0; AmountCard suite green.
- Layers: lint/typecheck · unit · component.

### Phase 6 — E2E + docs + wrap-up ✓

Deliverables: smoke e2e (no fiat artifacts when prices unavailable; new testids); network e2e full suite (regression gate — sandbox chainId 0 seeds nothing by design, see Asks); release key guard, both layers: the release workflow **fails immediately if `VITE_COINGECKO_API_KEY` is set in the build env** AND greps the built bundle (mirrors the `E2E_PROVERLESS` discipline); **CoinGecko attribution** ("Prices by CoinGecko" in the settings row/about surface) + a docs note on the API-terms/privacy disclosure (see Ask 8); historical-fee tooltip copy made unambiguous ("at today's AZTEC price", not implied-historical); docs (`ARCHITECTURE.md`, extension README, `implementations-plan/index.md`); full pre-PR gate.

**Validation gate**
- Commands: `bun run audit:vue && bun run test:e2e && bun run e2e:agent`
- Pass: all exit 0.
- Layers: all — lint/typecheck · unit · component · smoke e2e · network e2e.

## Assumptions

### Facts (verified against the worktree)

1. Fee→USD plumbing exists with hardcoded rate: `packages/extension/src/utils/fee-estimation.ts` (`FEE_JUICE_USD_RATE = 0.02`, "hardcoded for privacy"), consumed at `transfer-executor.ts:318`, `dapp-send-executor.ts:169`, `popup/pages/tx/[id].vue:117-119`, rendered by `TxFeeRow.vue:48`.
2. Fake-USD placeholders: `BalanceView.vue:292` (`$0.00`), `AmountCard.vue:134` (`~ $0.00` + tooltip), `SelectBalanceTypePopup.vue:73,98,131,158`, `FeeJuiceCard.vue:38` (both confirmed 2026-07-21).
3. Tokens keyed by `(profileId, chainId)` (`token/service.ts:82-95`); chainIds **re-verified in worktree**: Mainnet 2934756904, **Testnet 4229590296 (V5)**, Devnet 896946031, Local 0 (`network/service.ts:67-96`). The draft's 4138294185 was pre-hard-fork (removed in the 5.0.0-rc.1 commit).
4. `addToken` idempotent via `findToken` (`token/service.ts:129-141`); metadata via PXE simulation; `parseTokenInterface(networkId, contract)` pulls instance+artifact from the RPC **and registers the contract in the PXE as a side effect** (`token/service.ts:385-401`) — i.e. the RPC is a trust boundary for seeding AND validation itself leaves a registration behind. `addToken` requires an account with a derivable contract + unlocked secret, and re-fetches metadata internally (why the seeder needs the snapshot entry point).
5. Manifest today: `host_permissions` only nulo.sh + 127.0.0.1; `alarms`/`offscreen`/`storage` permissions present (`manifest.config.ts`). *(External observation, dated 2026-07-21, re-verify at implementation:)* CoinGecko serves `Access-Control-Allow-Origin: *`.
6. `Config` is a flat typed POJO blob (`wallet/config/config.ts`); additive field OK.
7. Storage `CURRENT_VERSION = 8`; `nulo:core:tokens` absent from all wipe lists (`migrate.ts:49-80`) — tokens survive bumps; `EntityStorage` drops rows with **invalid JSON** only (no semantic schema validation) — additive fields fine, but read-time validation is our job.
8. Alarms-via-port pattern exists (`runtime.ts:147-160`, `chrome-browser-api.ts:185-195`); MV3 requires sync top-level event listener registration to reliably wake the SW.
9. Journal origins are a closed zod'd union `popup | dapp` with origin-dependent invariants (`operation-journal/spec.ts`) — adding `seed` is a schema + invariants + rendering change.
10. *(External observation, dated 2026-07-21, re-verify at implementation:)* CoinGecko ids `aztec` → $0.01466932 (rank 494), `usd-coin` → $0.999857. Real AZTEC price (~$0.015) ≠ the 0.02 stub — displayed fee USD will visibly change.
11. Project gates: `audit:vue`, `test:components`, `test:e2e`, `e2e:agent` (root `package.json` + CLAUDE.md).

### Inferences (unverified — attack these)

1. **`usd-coin` honestly proxies cUSD.** For display surfaces a depeg merely misprices a label. For C3 this is NOT display-only — the proxy quote derives the token amount the user sends (bounded by the token-unit confirmation + `via USDC` label + sanity bands; NOT caught by the >1% self-comparison if the error is persistent). Whether that's acceptable is Ask 7, a user decision.
2. **CoinGecko free tier tolerates 1 batched call / 3 min per IP** — published range 5–15/min; shared NATs make "per client" soft, hence backoff+jitter and serving cache on 429.
3. **cUSD exists at the pinned address on CURRENT Mainnet + Testnet** — user-supplied, plausible via deterministic deployment, but the V5 hard fork changed address derivation, so this is exactly the class of claim the fork invalidates. NOT assumed: Phase 2's blocking live preflight proves it before anything ships.
4. The unlock/network-ready path offers a clean seeding hook (`getOrInitNetworks` precedent, profile-change events exist). Wiring details in Phase 2.
5. SW-side executors can call PriceService directly (both in the wallet SW) — consistent with executors importing `fee-estimation` today.

### Ask resolutions (user, approval gate 2026-07-21)

All eight resolved: **1** unit + blocking live preflight accepted (no seeding network-e2e) · **2** USD only · **3** 1 FJ = 1 AZTEC · **4** default-on, unlock-gated + settings toggle · **5** testnet shows real prices · **6** TOFU pin accepted · **7** single-oracle C3 accepted (keep the fiat-input toggle with its full safety policy) · **8** keyless + attribution now; licensing revisit is a release-checklist item. This satisfies codex R3 conditions 3–5.

### Asks (as posed at the gate — kept for the record)

1. **Seeding has no network-e2e coverage** (sandbox chainId 0 = empty seed list by design). Mitigated by the Phase 2 blocking live preflight + unit suite; network e2e gates regression around it. Accept?
2. **USD only**, no currency picker. Accept?
3. **1 FJ = 1 AZTEC** for pricing (display + C3 reconfirm bounds; `~`/`≈` signaling throughout). Accept?
4. **Refresh cadence: unlock-gated, default-on** (alarm only while unlocked; popup-connect refresh; NO executor-time fetches). The traffic still tells CoinGecko "a Nulo user exists at this IP" while you use the wallet, and the FIRST fetch happens right after unlock — before a new user has seen the settings toggle. Accept default-on with the toggle, or require opt-in/onboarding consent before the first fetch?
5. **Testnet prices are real prices**: testnet cUSD/FJ show mainnet-market USD values. Note the Aztec docs are explicit that Testnet Fee Juice is NOT AZTEC — so testnet fiat is strictly a dev-convenience fiction. Accept, or hide fiat on non-mainnet network kinds?
6. **Seed trust = TOFU pin**: expected class id/symbol/decimals captured once from the canonical public RPCs during preflight and pinned in code. (There is no more-authoritative source available to us today; an Aztec-official deployment registry would supersede it.) Accept?
7. **C3 converts through a single proxy oracle** (CoinGecko's USDC/AZTEC quote). A persistently wrong quote (depeg, poisoning, basis error) passes the >1% self-check and mis-derives typed-fiat amounts — bounded by the always-shown token units the user confirms, the `via USDC` label, and sanity bands, but NOT independently cross-checked (no second oracle in scope). Accept single-oracle conversion for C3, or restrict proxies to display-only (which effectively drops C3 for cUSD/FJ)?
8. **CoinGecko terms**: keyless public access is positioned as low-volume/non-commercial; product use may require the free Demo plan (key + attribution) and a privacy-disclosure note. Phase 6 ships "Prices by CoinGecko" attribution + a docs note either way. **Codex final-pass condition 4: this is decided NOW, at the approval gate, not deferred to release.** Options: (a) keyless + attribution (wallet is pre-production, no users; revisit at first public release — documented as a release-checklist item), or (b) block Phase 1 on registering a CoinGecko Demo account and confirming its terms cover this use.

## Security & Adversarial Considerations

- **Threat model:** (a) CoinGecko compromise/MITM/poisoned prices → display-only everywhere except C3, which is bounded by: frozen snapshot, displayed-token-units-are-what-sends, pending-disable, >1% reconfirm, per-id sanity bands, read-time validation. **Known residual (surfaced as Ask 7): a persistent plausible poison passes the self-referential >1% check** — the defense is the token-unit confirmation + sanity bands, not oracle redundancy; there is no second oracle in scope. (b) Malicious dApp probing price state → PriceService not wired into the wallet-bridge dispatcher (pinned by test). (c) Profiling → unlock-gated batched fixed-set query; kill-switch. (d) **Malicious RPC endpoint forging a seeded token** → pinned class id + metadata bounds; mismatch = hard skip. (e) Cache poisoning via other extension contexts → single authoritative `getUsableQuote` with read-time validation; no raw storage parsing.
- **Input validation:** CoinGecko response validated per-id at write AND read (finite, > 0, sanity band, provider timestamp); seeding metadata bounds-checked (string lengths, decimals 0–18).
- **Least privilege:** no new manifest permissions by default (CORS-based fetch); host_permissions only as documented fallback. No new extension permissions.
- **Supply chain:** zero new npm deps. 7-day min-age untouched.
- **Secrets:** no shipped key; release-bundle negative check enforces it.
- **C3 correctness:** round-DOWN bigint fiat→token (no `Number` pivot), property-tested; submit path sends displayed units exactly.
- **Seeding:** list is code (signed commits) + TOFU class-id pin enforced in a **single-pass validated snapshot** (no validate-then-refetch window); journaled via the audited lock/journal machinery; zero-interaction risk explicitly mitigated (see d); residual PXE-registration-of-skipped-artifact accepted as inert.

## Post-implementation hardening

Not scheduled. Display-layer + one read-only external API; `/harden security` remains a pre-release repo-wide decision.

## Decision ledger

**Chosen: Outline A** (background PriceService + lazy chain-metadata seeding) — both auditors independently picked A.

**Rejected — Outline B** (popup-side fetch + static seed records): (1) D2 breaks exactly where it matters — executors run SW-side during dApp flows with the popup closed; B guarantees stale/empty fee quotes there. (2) Static `FnImpl` fixtures are empirically refuted by this repo's own history — the V5 hard fork changed address derivation/signature schemes; captured fixtures would have bricked. (3) Gratuitous storage-version bump + token wipe for an additive feature. **Stolen from B:** popup/unlock-gated traffic pattern (adopted as the cadence policy); keep-the-surface-small instinct (dispatcher-absence test).

**Adopted from audits:** stale Testnet chainId fix (fable C-1 / codex Critical — confirmed in worktree); C3 quote-consistency policy incl. frozen snapshot + >1% reconfirm + proxy label + round-down bigint inverse (fable H-2 / codex Critical ×2); seed class-id pin + bounds validation (fable H-3 / codex High); `origin:"seed"` is a schema+invariants change, pre-validate before journaling, attempt cap, single-flight (fable M-4 / codex High); top-level alarm listener + boot reconcile (codex High); single authoritative read path + read-time validation + monotonic writes + kill-switch abort/generation (fable M-7 / codex High); settings UI for the toggle (codex High); missed surfaces SelectBalanceTypePopup/FeeJuiceCard/tx-detail (codex Medium — verified); D2-before-C3 phase reorder (codex Medium); unlock-gated cadence (fable M-2 → Ask 4); no host_permissions by default (fable M-1 → verified CORS live); per-id sanity bands (fable M-8); ticker-reactive staleness (fable M-7b); partial-aggregate label (fable L-2 / codex); alarms port (fable L-1); release-bundle key check (fable L-3 / codex Low); `include_last_updated_at` (codex Medium); seed-marker purge/profile hygiene (fable M-6); no-account skip semantics (fable M-5); backoff+jitter (codex).

**Rejected/deferred from audits:** codex's "property tests in both directions at max balances" adopted for the new helpers but NOT extended to refactoring `AmountCard`'s pre-existing token-mode `Number` paths (pre-existing behavior preserved verbatim per repo convention). Codex's suggestion to gate CI on the real-API test rejected — it stays a local diagnostic (rate-limit flake in CI). Fable's "CI-adjacent liveness check" for seed addresses deferred to the aztec-update skill's runbook (network resets are handled there).

**Adopted from Round 2 (final fresh codex pass, reject → amendments):** single-pass validated seed snapshot via a seed-specific TokenService entry point — closes the validate-then-refetch TOCTOU (Critical 1); C3 single-oracle limitation stated honestly and elevated to Ask 7, Inference 1's "display-only" contradiction fixed (Critical 2); submit gating specified at `send.vue` where `handleSend` lives, fail-closed (High 1); fiat-mode Max/Half bigint-exact — the earlier blanket "preserve Number paths" narrowed to token-mode-only (High 2); CoinGecko licensing/attribution surfaced as Ask 8 + Phase 6 attribution deliverable (High 3); executor-time fetches dropped entirely (cache-or-nothing) + first-fetch consent folded into Ask 4 (High 4); attempt-cap recovery via per-version retry (Medium); SW-death/marker-ordering + real-hook integration tests added to Phase 2 (Medium); release build fails fast on key env, not just bundle grep (Medium); historical-fee tooltip copy (Low); Fact 4 registration side effect + external observations dated (Facts).

**Rejected from Round 2:** an independent second price oracle for C3 — out of scope/cost for a display-plus-one-input feature; the risk is bounded by token-unit confirmation and explicitly delegated to the user as Ask 7 rather than silently accepted.

**Disputed / open:** none between auditors after amendments — remaining open items are the eight user Asks above.

## Audit verdicts

- **Fable (Plan-agent, fresh context, 2026-07-21):** `conditional approve` — conditions: (1) fix Testnet chainId; (2) live seed preflight in a gate; (3) C3 quote freeze + displayed-units submit; (4) surface cadence + host_permissions as Asks. **All four adopted** (see ledger). Full transcript: `audit-fable.md`.
- **Codex (session 019f85a6, xhigh, 2026-07-21):** `reject` — blockers: stale Testnet identity; C3 quote-consistency invariant missing; unsafe seed trust/journal boundaries. **All blockers addressed in this revision** (see ledger). Full transcript: `audit-codex.md`.
- **Codex final fresh-context pass (session 019f85b0, xhigh, 2026-07-21):** Round 2 `reject` — new blockers: seed validate-then-refetch TOCTOU; C3 single-oracle/proxy contradiction; provider licensing + privacy prerequisites. All addressed or elevated to explicit Asks (see ledger "Adopted from Round 2"). **Round 3 re-verdict on the amended plan: `conditional approve`** — conditions: (1) pre-registration pin validation or guaranteed PXE rollback + single non-reentrant lock + snapshot persistence [adopted into the seeding design]; (2) deletion tombstone surviving `purgeChain` [adopted — the marker/tombstone split]; (3) resolve Ask 7 before Phase 5; (4) resolve Ask 8 before Phase 1 — licensing is decided at THIS approval gate, not at release; (5) all remaining Asks locked before their affected phases [the approval gate resolves all eight]. Full transcript: `audit-codex.md`.

## Seeds (CANONICAL — finalized post-approval 2026-07-21; approval matched the plan as written, no scope changes)

### `/goal` (recommended)

```
/goal All six phases marked ✓ in implementations-plan/token-prices/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript — including Phase 2's live seed preflight logged in lessons/phase-2.md; for each phase the agent has printed LESSONS_FILE=implementations-plan/token-prices/lessons/phase-N.md in the transcript; /code-review max --fix complete with findings applied and committed separately; codex post-impl audit complete with high/critical findings addressed; bun run audit:vue and bun run test:e2e and bun run e2e:agent all report exit 0 in the transcript.
```

### `/loop 15m` (alternative)

```
/loop 15m Drive implementations-plan/token-prices forward. Never idle waiting for my input. Each firing: (1) Reality check: read implementations-plan/token-prices/plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if a PR exists, gh pr view --json statusCheckRollup. (2) Waiting on CI is fine — use the wait to review the diff or prep the next phase. (3) No task in hand? Pick the next pending step from plan.md and start it; after each meaningful edit run bun run lint + bun run test for touched packages; commit → push. (4) Stuck or facing a decision? Call /codex xhigh, reach a defensible decision, act, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish, never expand scope beyond plan.md. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase green? Run the phase's full validation gate as written in plan.md (Phase 2 includes the live seed preflight), paste the result, mark ✓ in plan.md, print LESSONS_FILE=implementations-plan/token-prices/lessons/phase-N.md, advance. (7) All phases ✓? Run /code-review max --fix → commit fixes separately → codex post-impl audit (net diff + code-review commit summary + adversarial ask) → address high/critical findings → write the wrap-up report and stop.
```

---

## Appendix — Competing Outline B: popup-side prices, static seed records (REJECTED — see ledger)

1. **No background service.** A `usePrices` composable fetches CoinGecko directly from the popup (fetch on mount + 3-min `useTicker`, cache in `chrome.storage.local`). Executor-side fee USD reads the same storage key directly.
2. **Static seed records.** Complete `Token` rows (name/symbol/decimals + `FnImpl`s captured from a testnet fixture) written into `EntityStorage` on profile creation; storage-version bump wipes `nulo:core:tokens@`.
3. Same UI phases on top.

Trade-offs vs A: (+) no new service surface; popup-gated traffic (adopted into A). (−) executors read stale/empty cache exactly during dApp flows (D2 broken); static fixtures brick on protocol forks (proven by V5 history); pointless destructive migration; first-open always stale.
