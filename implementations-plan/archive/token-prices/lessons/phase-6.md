# Phase 6 — E2E + docs + wrap-up: lessons

## Shipped

- `tests/e2e/fiat-display.test.ts` — smoke: no-fiat-artifacts (no fake `$0.00`
  anywhere on home when unpriced) + the `fiat-values-toggle` kill-switch exists,
  defaults ON, and toggles.
- `_build-extension.yml` — fail-fast release guard: the build errors if
  `VITE_COINGECKO_API_KEY` is set in the env (stronger than the artifact grep;
  the header NAME legitimately ships, so a bundle-grep for it would
  false-positive — documented decision).
- CoinGecko attribution on Settings → About (`coingecko-attribution`).
- Docs: ARCHITECTURE §4 (price feed + seeding entries) + §12 (live fee rate);
  SECURITY.md "External price feed (CoinGecko)" privacy/terms section;
  extension README service list; e2e-testing skill lesson (below).

## Smoke debugging saga (3 runs → root causes, none a wallet regression)

1. **Run 1 (naive `bun run test:e2e`): 8 fails.** My `audit:vue` had rebuilt
   `dist/chrome` UNARMED + mainnet-default, clobbering CI's build pins.
2. **Run 2 (fixture-armed only): backup-migration fixed**; backup-roundtrip +
   passkey-backup still timing out → the missing SECOND pin:
   `VITE_NULO_E2E_DEFAULT_NET=testnet`. Fresh-profile flows were bootstrapping
   against the live Alpha mainnet RPC and eating 60s-abort × retry envelopes.
3. **Run 3 (full CI parity): 22/23 files green — 79 passed incl. both new
   fiat tests.** The one failure, `passkey-backup > passkey full-backup
   export`, is `skipIf(CI)` (local-only) and **fails IDENTICALLY on a clean
   origin/dev baseline worktree** (built + run with the same pins) — a
   pre-existing locally-failing test, not this branch's regression. Baseline
   evidence: dev-baseline @ af9c8ba, same 15s status-card timeout, 1 failed /
   2 passed.

Routed the durable lesson (exact local smoke invocation) to the
`e2e-testing` skill per the repo's three-way routing rule.

## Also noted for wrap-up

- **Follow-up (accepted gap):** seed-deletion tombstones live in
  `nulo:core:token-seeded@<profileId>` which is NOT part of the full-backup
  service list — restoring a backup on a fresh install can resurrect a
  default token the user had deleted. Low severity (one extra delete);
  candidates: add marker state to TokenService.backup or accept.
- User hand-loadable clean build produced at `apps/extension/dist-user/chrome`
  (git-excluded; marker-checked clean).

## Gate result

- `bun run audit:vue` → exit 0 ✓
- Smoke e2e (CI-parity pins) → 79 passed; only the pre-existing
  CI-skipped local failure remains (proven baseline-identical) ✓
- Network e2e (`bun run e2e:agent`) → exit 0, 58 files / 76 tests passed, 1 skipped ✓

## Round-2 UI feedback (user-directed, post-gate)

User picks from the round-2/3/4 artifact iterations, all implemented:
- **T1**: fiat/token toggle is now a bordered ⇅ swap button LEFT of the send
  input (testid preserved); the text link is gone.
- **E1 + 1b bug fix**: the "Price unavailable" warning showed for PRICED
  tokens whenever the input was empty (condition keyed on no-conversion
  instead of no-price) — fixed; priced+empty now shows the unit rate
  (`1 cUSD ≈ $1.00`), warning reserved for genuinely unpriced tokens.
- **F1**: fee USD parenthesized inline (`~0.0035 FJ ($0.007)`).
- **D2+I1**: activity rows (outgoing via TransactionCard, incoming via
  parents' `incomingCardProps`) + the tx-detail hero carry `≈ $x.xx`
  (testids `activity-fiat`, `tx-detail-fiat`; "at today's price" labeling).
  `TransactionCardLayout` gained the `amountFiat` prop.
- **R5** (after 3 iterations): token rows put fiat LEFT under the symbol
  (replacing the static label on priced rows; label survives on unpriced
  rows) and the split line adopts the header's ●/○ dot vocabulary.
- **Deterministic price e2e**: `network/price-fixture.test.ts` seeds a valid
  quote into `nulo:core:token-prices` (read-time validation accepts it) and
  asserts the gas-card fiat line — Fee Juice's chain-independent mapping
  makes this work on the sandbox with NO live API. Test-stubbing decision:
  no paid key needed; free Demo key optional for the local real-data test.

## Round-3 UI feedback (user-directed)

- **1a** Available FJ truncated to 4 decimals (`formatGasBalance`).
- **1b** fee readout value dropped to its own line under the label.
- **1c** after rounds 5→8 (incl. a codex design consult, session 019f8682):
  final pick **G1b "unit grammar"** — the `cUSDC / USD` pair right of the
  input IS the toggle (active lit + underlined; NO arrows anywhere); ONE
  dot-segmented meta row `≈ $2.00 · ● PRIVATE 8 cUSDC · HALF MAX`; the old
  bottom balance row deleted; `via USDC` + today's-rate moved to a tooltip.
  Codex's accessibility note adopted: the dot always carries its word.
- **2/5a** dashboard matrix: empty wallet → truthful `$0.00` (no nudge);
  unpriced holdings → plain `—`; fiat OFF → aggregate options hidden and the
  header number slot collapses (space reclaimed); explicit token picks still
  render.
- **3** transfer hero: caption dropped, `at today's price` → tooltip.
- **4** network renamed "Alpha Mainnet" → **"Alpha V5"** (seed, chain-name
  util, preflight script, e2e expectation).
- **5b** unpriced tokens on Send render nothing (warning tooltip removed;
  pins updated).
- price-fixture network test gate fixed (`inject("aztecTestConfig")` — the
  env-var gate silently skipped it; the run's "skipped file" count was the
  tell).

## Post-impl reviews (blueprint protocol)

- `/code-review max --fix`: 4 findings fixed, committed separately (31a7597).
- Codex post-impl audit (fresh session 019f86af, xhigh): **reject** — C1
  locale-separator fiat seeds (de-DE `1.250,00` → 1000× corruption), C2 pin
  TOCTOU (pin-checked instance A, registered refetched instance B), H3 DCE'd
  e2e build stamp, H4 unimplemented snapshot expiry, M5/M6/M7/L8. All fixed
  (M5 accepted/documented) in b6fc9ff.
- Re-verdict: **conditional approve** (marker RMW atomicity → promise-chain
  lock; fiat identity → `chainId:contract` watch key; exact-TTL `>=`).
  Conditions closed in c615924, each pinned. Final codex verdict: **approve**. Full transcript: audit-codex.md.
- Lesson — a "refreshed read" is not atomicity: the M7 fix re-read the blob
  per write but two interleaved RMWs still both read pre-mutation state.
  Storage without compare-and-swap needs a WRITER lock, not fresher reads.
- Lesson — network e2e vs fixture reality: `tokenReadyExtension` mints
  PUBLIC balances; the send popup can default to private → zero balance →
  disabled input and a 30s selector timeout that LOOKS like a fiat bug.
  Select the funded side (`setActiveSendType(page, "send-from-type",
  "public")`) before driving the amount input.

## Ultra-audit round (user-requested, post-approval)

Two fresh bug-lens codex sessions (money path / lifecycle) over the full
branch diff. 12 findings (A1-A5, B1-B7); 11 fixed + pinned, B7 accepted
(pre-existing runtime.start semantics, self-heals ≤3 min). Full table +
three-round B re-verdict trail in audit-codex.md. Final: SHIP × 2.

- Lesson — "capture the generation at entry": a guard that samples its
  epoch/generation AFTER intermediate awaits (or before, but never again)
  passes precisely when the flip lands inside those awaits. Sample before
  the first await AND re-check after the last one.
- Lesson — a promise-chain mutex only serializes what runs INSIDE it. The
  tombstone check was locked but persist wasn't → check-then-act TOCTOU.
  Put the whole read-check-act sequence in one critical section, and never
  call another lock-taking method from inside (promise-chain locks
  self-deadlock).
- Lesson — purge cascades need a FENCE-FIRST rule: the party that can
  still WRITE (the seeder) must be fenced before sweeping the data it
  writes (rows, journals). Sweeping first leaves a resurrect window.
