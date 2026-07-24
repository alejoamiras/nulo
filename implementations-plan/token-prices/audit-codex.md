# Codex audits — token-prices plan

## Round 1 (dual audit) — session 019f85a6-6d59-7820-b3b1-1268e7741fed

**Model:** gpt-5.6-sol · effort xhigh · read-only · **Date:** 2026-07-21
**Input:** plan.md draft (incl. competing Outline B appendix)
**Verdict:** `reject (with blocking findings: stale Testnet identity, no C3 quote-consistency invariant, and unsafe seed trust/journal boundaries)` — all blockers addressed in the plan revision (see plan.md → Decision ledger).

### Response (verbatim)

reject (with blocking findings: stale Testnet identity, no C3 quote-consistency invariant, and unsafe seed trust/journal boundaries)

#### Critical

- **Wrong Testnet identity.** Plan §Locked decisions/Assumptions Fact 3 says `4138294185`, but `network/service.ts:78` currently seeds **`4229590296`**. Testnet seeding and price mapping would never match the active network. Re-verify the cUSD deployment against the current v5 network before approval.
- **C3 can silently change the transaction amount.** Plan §C3/§Security checks only quote age. A fresh quote can change between typing, debounce completion, fee estimation, and click; a delayed recomputation can overwrite the amount the user inspected. Require a versioned quote snapshot bound to `(chainId, token, providerUpdatedAt, rawAmount)`, disable submit while conversion is pending, and reject/reconfirm when the displayed snapshot differs or price movement exceeds an approved threshold. "Sane magnitude" validation does not stop a plausible 2× poison.
- **USDC is not a trustworthy transaction oracle for cUSD.** Plan §Price map/Inference 2 turns a proxy/depeg error into an actual token amount. Fiat input needs an explicit policy: proxy prices may remain display-only, or the user must accept/reconfirm the derived token amount with a prominent "USDC proxy" label.

#### High

- **Automatic seeding trusts an editable RPC as token authority.** `token/service.ts:372-453` accepts the RPC-supplied instance/artifact and registers it; `:486-518` simulates unbounded chain-supplied metadata. A malicious endpoint can make a wallet-endorsed "Default token" use hostile function selectors, strings, or decimals. Pin expected contract class/artifact and metadata per network; validate completeness, string lengths, and decimal bounds before storage or journaling.
- **The journal design does not exist yet.** `operation-journal/spec.ts:36,47,164-165` permits only `popup|dapp`, not `seed`. Concurrent seed triggers can each create a journal before `addToken`'s locked recheck; repeated metadata failures create permanent failure rows every unlock. Add a single-flight seeder, schema/rendering/GC changes, marker-write ordering, and tests for SW death, concurrent unlock/network events, profile deletion, and chain purge.
- **Alarm wiring can miss the wake event.** Chrome requires alarm listeners to register synchronously at module scope; `runtime.start()` only finishes after config, BB, migration, and service startup. Three minutes is legal, but alarms may be arbitrarily delayed, do not wake a sleeping device, and persistence is not universally reliable. Register a top-level dispatcher in `wallet/index.ts`, reconcile the alarm on every boot, and retain stale-on-connect refresh.
- **Raw shared-cache reads are a poisoning boundary.** Executors must not parse `chrome.storage.local` independently. One authoritative `PriceService.getUsableQuote()` must validate persisted data on every read, enforce config/staleness, serialize refreshes, prevent older responses overwriting newer ones, and invalidate in-flight fetches when the kill-switch turns off.
- **The kill-switch lacks UI and race semantics.** Merely adding `Config.showFiatValues` does not expose a setting. Specify its settings surface, alarm clear/recreate behavior, cache clearing, and guarantees that an already-running fetch cannot repopulate values after disablement.

#### Medium

- **Forgotten fake-USD surfaces:** `SelectBalanceTypePopup.vue:73,98,131,158`, `FeeJuiceCard.vue:38`, and `popup/pages/tx/[id].vue:117-119`. Phase 5 also misses historical transaction fee rendering. "Account Value" silently summing only priced assets is misleading unless labeled partial or hidden.
- **Precision plan is insufficient.** `AmountCard.vue:97-110` and `send.vue:108-109` already pivot through `Number`. Use decimal-string/fixed-point bigint parsing in both directions, explicit round-down behavior for fiat→token, bounded decimals, and property tests at maximum balances — not merely 6/18-decimal examples.
- **Phase ordering is backwards for risk.** Implement D2 before C3; make C3 the final isolated transaction-affecting phase. Add a real current-network seed preflight and an integration test through the actual unlock/account/network hook. The opt-in CoinGecko test is a diagnostic, not a stable gate. Request `include_last_updated_at=true`; local `fetchedAt` alone cannot detect provider-stale data.

#### Low

- `VITE_COINGECKO_API_KEY` is embedded when present. Add a release-bundle negative check; "CI can inject it" otherwise risks publishing the demo key.

#### Facts

- **Misstated:** current Testnet chain ID; `EntityStorage` only drops invalid JSON — it does not provide semantic schema tolerance; `addToken` prevents duplicate tokens but not duplicate concurrent journal records.
- **Confirmed:** AZTEC currently has CoinGecko API ID `aztec`.

#### Inferences

- One call/three minutes is below the published 5–15/min public range, but shared NATs and synchronized retries invalidate "per client" safety; persist exponential backoff plus jitter.
- cUSD's address, class, metadata, and cross-network equality remain unverified. Alarm wake/persistence and direct cache reads are unsafe as stated.

#### Asks

- Approve a quote-change/reconfirmation threshold and proxy-price eligibility for C3.
- Provide authoritative current cUSD deployment/class metadata.
- Decide whether partial account aggregates are hidden or labeled "priced assets only," and whether Testnet Fee Juice should show real-market AZTEC USD.

#### Outline A vs B

Pick **Outline A**, conditionally after the blockers above. Centralized validation and SW-side fee availability are necessary; Outline B duplicates trust logic, produces stale dApp-flow fees, and its static `FnImpl` records plus destructive token wipe are materially worse.

---

## Round 2 (final fresh-context pass) — session 019f85b0-db30-7fb1-a2d1-3c4e35d7562d

**Model:** gpt-5.6-sol · effort xhigh · read-only · fresh context (revised plan + ledger + Round-1 transcripts) · **Date:** 2026-07-21
**Verdict:** `reject (with blocking findings: seed validation is non-atomic, C3 remains vulnerable to persistent oracle/proxy error, and provider/privacy prerequisites are unresolved)` — all findings adopted or elevated to explicit user Asks in the plan amendment (see plan.md → Decision ledger "Adopted from Round 2"). Re-verdict after amendments: Round 3 below.

### Response (verbatim, paths rewritten repo-relative)

reject (with blocking findings: seed validation is non-atomic, C3 remains vulnerable to persistent oracle/proxy error, and provider/privacy prerequisites are unresolved).

#### Critical

- **Seed trust bypass/TOCTOU.** Plan §Default token seeding says validation precedes persistence, but `parseTokenInterface` (`packages/extension/src/wallet/services/token/service.ts:385`) registers the RPC-supplied contract before the seeder can check its pin. Pre-validating metadata and then calling `addToken` (`token/service.ts:169`) also fetches metadata again. A hostile RPC can pass validation, then change the consumed result. Require one seed-specific, locked path that validates address derivation, class/artifact, and metadata, then registers/journals/persists that exact snapshot.
- **C3's oracle defense does not stop persistent poisoning.** Plan §C3's 1% check compares CoinGecko against itself; a stable plausible poison or cUSD/USDC basis error passes indefinitely. Worse, Assumption Inference 1 calls the proxy "display-only," although C3 uses it to determine transferred units. Either proxies remain display-only, or proxy eligibility must return as an explicit Ask with an independent oracle/strong transaction warning.

#### High

- **Submit invariant is not architecturally enforceable as planned.** Phase 5 names `AmountCard.vue`, but `send.vue` (`packages/extension/src/popup/pages/send.vue:190`) owns enablement and submission. Require a versioned snapshot bound to chain, token, quote timestamp, and raw input; pending/reconfirmation state must gate `handleSend`, including fail-closed behavior when no fresh current quote exists.
- **The precision exception contradicts C3.** `send.vue:105` and `AmountCard.vue:97-110` still derive Max/Half through `Number`. That cannot satisfy exact displayed units or extreme-magnitude property tests. Pass raw base-unit strings/bigints through these paths.
- **Provider compliance was missed entirely.** CoinGecko describes keyless access as low-volume, non-commercial/educational, while its terms require product/privacy disclosures and potentially prominent attribution. Phase 6 includes none. Resolve production licensing, attribution, privacy-policy changes, and fallback before implementation.
- **Privacy Ask understates leakage.** Executor-time refresh reveals transaction timing, not merely "wallet use." Default-on fetching also discloses the user before they can reach the toggle.

#### Medium

- Three transient/RPC-induced failures permanently suppress seeding without user-visible recovery.
- Round-1's SW-death/marker-ordering and real unlock/network-hook integration tests are absent from Phase 2.
- A bundle grep is weaker than making release builds fail immediately when the key environment variable is set.

#### Low

- Historical fees valued at current spot are not historical USD costs; tooltip wording must be unambiguous.

#### Facts

- Chain IDs are correct.
- Fact 4 omits `parseTokenInterface`'s registration side effect.
- Facts 5, 8, and 10 mix volatile external observations with worktree facts.

#### Inferences

- cUSD≈USDC remains an unsafe transaction oracle.
- `1 FJ = 1 AZTEC` is not established universally; Aztec explicitly says Testnet Fee Juice is not AZTEC.
- CORS, rate tolerance, and lifecycle wiring require runtime verification.

#### Asks

Missing: proxy eligibility for C3; production CoinGecko licensing; consent before first fetch; transaction-timing leakage; authoritative seed-pin source; recovery from permanent seed skips.

#### Ledger check

The ledger correctly adopts the chain-ID, alarm, cache, and surface fixes, but overclaims closure: proxy eligibility was watered down, exact precision was expressly rejected despite contradicting Phase 5, SW-death/integration coverage was silently dropped, and host-permission fallback is not actually surfaced as an approval-gated Ask.

---

## Round 3 (resume of Round-2 session: re-verdict on the amended plan)

**Date:** 2026-07-21 · same session, `response-1.md`
**Verdict (verbatim):**

conditional approve (with conditions: (1) before Phase 2, validate expected class and recomputed address before PXE registration, or guarantee rollback—a rejected seed must not durably poison PXE; the seed-specific method must own one non-reentrant TokenService lock and persist the exact validated snapshot without refetching; (2) reconcile "user deletion → never re-seed" with clearing markers on `purgeChain` by retaining a deletion tombstone across network removal/re-add, or explicitly change and test that policy; (3) resolve Ask 7 before Phase 5 and encode the chosen proxy-C3 branch in deliverables/tests; (4) resolve Ask 8 before Phase 1, not at release—if keyless product use is not licensed, re-plan the provider/backend and never ship a Demo key; (5) resolve and lock all remaining Asks before their affected phases.)

**Disposition:** conditions 1–2 adopted into the seeding design (pre-registration pin validation or PXE rollback; marker/tombstone split with purge-surviving tombstones, both test-pinned); conditions 3–5 are resolved at the approval gate (all eight Asks answered before implementation starts).

---

## Post-implementation audit — session 019f86af-dcd1-78d0-b9ca-0145e8241bbc

**Model:** gpt-5.6-sol · xhigh · fresh session · **Date:** 2026-07-21
**Input:** full branch diff (11 impl commits + the separately-committed `/code-review` fixes), plan + ledger + lessons.
**Verdict:** `reject (with blocking findings: C3 locale-dependent amount divergence; seeder pin TOCTOU; ineffective e2e-flag release guard)`

Findings + dispositions (all fixed in the remediation commit unless noted):

- **C1 (Critical)** `formatUsdMicro` emits LOCALE separators; AmountCard's fiat-seed strip (`$ , <`) corrupts a de-DE `$1.250,00` into `1.25` → displayed fiat diverges from the sent amount. **Fixed**: new `usdMicroToPlainString` machine formatter feeds ALL input seeds; display formatter banned from inputs (documented on the helper). Pinned by test.
- **C2 (Critical)** the implemented seeder pin-checked instance A then `previewTokenMetadata` REFETCHED instance B and registered B — a hostile RPC could alternate answers (breaks the adopted single-pass condition). **Fixed**: the TOFU pin moved INSIDE `parseTokenInterface` (optional `expectedClassId`), enforced on the one fetched instance BEFORE artifact fetch/registration; `PinMismatchError` typed; seeder's separate pre-check removed. Composition tests pin: mismatch → throws with ZERO register calls.
- **H3 (High)** the e2e price-map build stamp was an unused export → tree-shaken even in armed builds → the release grep could never fire. **Fixed**: stamp is now LIVE DATA inside the kept branch; plus the workflow fails fast if `VITE_NULO_E2E_PRICE_MAP` is set at all.
- **H4 (High)** the plan's 15-min frozen-snapshot expiry was unimplemented (`frozenAt` never read). **Fixed**: `evaluateFiatGate` gains `now` + `SNAPSHOT_MAX_AGE_MS` hard expiry (reason `stale-snapshot`), ticker-backed in send.vue for reactive flipping. Pinned.
- **M5 (Medium)** fetch watermark/backoff are SW-memory-only. **Accepted/documented**: SW restarts are natural refresh points; per-lifetime storm prevention is the goal. No fix.
- **M6 (Medium)** quote loss mid-fiat-session left fiat mode stuck (toggle hidden, requote no-op). **Fixed**: watching `canUseFiatInput` exits fiat mode. Pinned.
- **M7 (Medium)** the seed pass's whole-state snapshot writes could clobber a tombstone written mid-pass. **Fixed**: per-entry read-modify-write (`updateMarker`) that never downgrades a `deleted` outcome. Race pinned by test.
- **L8 (Low)** `Math.round` on the inverse rate could derive marginally more tokens than typed. **Fixed**: `rateToMicroUsdCeil` used exclusively by `usdMicroToTokenAmount`. Pinned.

### Re-verdict (same session, after the remediation commit)

> `conditional approve (with conditions: make seed-marker RMW atomic; bind fiat sessions to full token identity; expire snapshots at the exact TTL)`
> Critical/High: none. "The C3 amount path remains string/BigInt; locale formatting and Number-domain amount leakage are eliminated. Pinning and production-build guards are sound."

All three conditions addressed (follow-up commit):

- **Marker RMW atomicity (Medium)** — a re-read alone isn't atomic: a deletion racing a purge/seed write could both read the pre-delete blob and the later write drops the tombstone. All marker mutations (`updateMarker`, `onChainPurged`, `purgeForProfile`) now serialize behind a per-seeder promise-chain lock. Pinned by a slow-storage interleaving test (deletion ∥ purge → tombstone survives).
- **Fiat session identity (Medium)** — the exit watch keyed on `contract` alone; the same address on another chain is a different token (and price-map entry). Watch key is now `chainId:contract`. Pinned.
- **Exact-TTL expiry (Low)** — `>` → `>=`: a session expires AT 15 minutes, not one tick past. Equality pinned.

Final standing after the condition-closing commit — codex confirmation (same session):

> `approve`
> "Confirmed all three conditions are closed: marker mutations share an error-resilient promise-chain lock; fiat identity correctly includes chainId and contract; snapshot expiry uses >= with equality coverage. The implementations and regression tests match the required production invariants."

**Post-impl audit: APPROVED.**

---

## Ultra-audit round (user-requested, dual fresh sessions, gpt-5.6-sol xhigh)

Two fresh bug-focused sessions over the full branch diff, different lenses.
Both returned `do not ship`; all findings verified, fixed (one accepted) in
the follow-up commit, pinned by tests, and re-submitted for re-verdict.

### Session A — money path (019f86e4-4a45-7b81-ad10-35a297796d45)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| A1 | High | Quote loss mid-fiat-session exits to token mode leaving the stale fiat-derived amount SENDABLE (fail-open) | Fixed: watch-driven exits clear the amount (`exitFiatMode({ clearAmount: true })`); user toggle keeps it (G1b design). Pinned. |
| A2 | Med | Fee USD frozen at estimate time — stale after refreshes, visible after quote lapse | Fixed: `FeeSettingsCard` derives USD live from raw `maxFee` × current quote via `usePrices`; `maxFeeUsd` removed from the DTO, both executors, and the ExecutionService↔PriceService wiring. |
| A3 | Med | Aggregates count zero-balance rows: fresh wallet with an unpriced empty row shows `—` instead of `$0.00`; partial label misfires | Fixed: aggregates count nonzero HOLDINGS (BalanceView + SelectBalanceTypePopup). Pinned both ways. |
| A4 | Low | 30s ticker granularity lets an exactly-expired snapshot submit up to one tick late | Fixed: `handleSend` re-evaluates the gate at `Date.now()`. |
| A5 | Low | `.5` fiat input parses to null → conversion silently clears | Fixed: leading-dot normalizes to `0.5` (mirrors token mode). Pinned. |

### Session B — lifecycle/concurrency/trust (019f86e4-4d13-7010-baf3-b29b0d20a31f)

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| B1 | High | Kill-switch flip between a refresh entry and its fetch passes the generation check → provider contacted + quotes broadcast while disabled | Fixed: generation captured at ENTRY of every path, threaded into `refresh(gen)`; `doRefresh` re-checks before the fetch. Pinned (zero fetch calls). |
| B2 | High | Future-dated cache rows are fresh forever and win every monotonic merge — unrepairable planted price | Fixed: `MAX_CLOCK_SKEW_MS` (2 min); future `fetchedAt` is INVALID at read/write/merge and stale in `isQuoteFresh`. Pinned incl. repair-refresh. |
| B3 | High | A seed pass resuming after profile deletion/switch or chain purge recreates rows + the purged marker blob; coalesced triggers leave the new profile unseeded | Fixed: seeder `epoch` (bumped by both purges) + `guardsHold()` (epoch + active profile + chainId) before every write; `rerunRequested` re-runs once for coalesced contexts. Pinned ×3. |
| B4 | Med | A user tombstone written mid-pass blocks only the marker write — the token row still re-persists | Fixed: persist moved into the pass behind a fresh tombstone re-check. Pinned. |
| B5 | Med | Marker blob trusted without shape validation: `[]` silently eats tombstone writes; corrupt primitives throw and BLOCK deletion | Fixed: `readMarkerState()` sanitizes every read. Pinned across corrupt shapes. |
| B6 | Med | `usePrices` keeps quotes across client reconnect — a disable while detached leaves fiat usable until TTL | Fixed: resnapshot on `onConnected` (result replaces state; `{}` when disabled). Pinned. |
| B7 | Low | A price alarm firing during in-flight runtime startup is dropped (`started` flag returns early, service not yet registered) | **Accepted**: root cause is pre-existing `runtime.start()` semantics (out of this PR's scope); self-heals on the next 3-min alarm; failure mode is a delayed refresh only. |

### Re-verdicts

- **Session A (money path)**: `ship` — "all five fixes hold across their production paths… No concrete reachable money-path regressions found." (It ran 128 focused tests itself.)
- **Session B (lifecycle)**: three rounds.
  1. `do not ship` — reproduced two residual seeder races: the lifecycle guard sampled the epoch only BEFORE its awaited context reads, and the tombstone re-check wasn't atomic with persist. Fixed: post-await epoch re-check + the whole commit (tombstone check → persist → seeded marker) inside ONE marker-lock critical section; `clearChainState` fences the seeder BEFORE purging rows. Both interleavings pinned.
  2. `do not ship` — one last ordering hole: the deletion coordinator purges journals BEFORE the token purge fences the seeder, so a seed commit in that window left an orphan `token_import` journal row. Fixed: `TokenService.purgeForProfile` re-runs the idempotent journal purge right after the fence. Pinned.
  3. **`ship`** — "The seeder fence now drains all possible late commits before the idempotent journal re-purge… This closes the journal-orphan window without reopening the marker/token races." (54 focused tests verified by codex.)

**Ultra-audit round: SHIP (both sessions).** B7 (alarm tick during in-flight runtime startup) remains the one accepted finding — pre-existing runtime semantics, self-heals in ≤3 min.
