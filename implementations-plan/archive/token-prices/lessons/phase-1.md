# Phase 1 — Price core: lessons

## Shipped

- `packages/extension/src/wallet/services/price/` — spec, price-map (sanity bands), convert (bigint helpers), service, client, 4 test files (40 unit + 2 real-data cases).
- `showFiatValues` config field + settings toggle (`appearance.vue`, testid `fiat-values-toggle`).
- PriceService registered in `runtime.ts`; module-scope alarm shim in `wallet/index.ts` (single dispatch path — the service deliberately does NOT subscribe to alarms itself).
- Dispatcher-absence pin: `not-dapp-exposed.test.ts` asserts the wallet-sdk background handler + wallet-bridge dispatcher have no price wiring (via `?raw` source imports).

## Decisions / gotchas

- **Alarm dispatch**: MV3 delivers a waking alarm only to listeners registered synchronously at module scope. The shim in `wallet/index.ts` calls `runtime.start()` (idempotent) then forwards into `PriceService.onAlarmTick()`. The service's `init()` reconciles the alarm against (unlocked && enabled) at every boot.
- **Kill-switch race**: flipping `showFiatValues` off bumps a generation counter and aborts in-flight fetches; `doRefresh` re-checks the generation after every await so a late response can't repopulate the cleared cache. Unit-tested with a hand-rolled deferred fetch.
- **Cross-package `?raw` import**: `@nulo/wallet-bridge` only exports `./src/index.ts`, so the exposure test imports `dispatcher.ts` by relative path.
- **Test race**: `vi.waitFor` on "alarm cleared" fired before the `onQuotesUpdated({})` emit (clear happens first in the handler); wait on the emit instead.

## CORS / host_permissions check (gate item)

- Server side verified LIVE two ways on 2026-07-21: ad-hoc curl during planning, and the committed real-data test (`real-data.test.ts`, run green with `COINGECKO_REAL_TESTS=1`) asserting `access-control-allow-origin: *` on the keyless endpoint. No CoinGecko `host_permissions` entry shipped, per plan.
- Client side (SW `fetch` under the extension's COEP headers) is platform-documented behavior; the in-extension confirmation rides on Phase 6's smoke run against the built artifact — noted there.

## Gate result

- `bun run lint` → 0 errors (warnings are repo baseline) ✓
- `bun run typecheck` → clean ✓
- `bun run test` → 205 files / 2560 tests passed ✓ (includes the 40 new price tests)
- `COINGECKO_REAL_TESTS=1` price real-data run → 2/2 passed (aztec $0.0147-ish, usd-coin ~$1, both in-band, `last_updated_at` present, `ACAO: *`) ✓
