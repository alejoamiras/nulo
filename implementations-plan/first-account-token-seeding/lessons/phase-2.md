# Phase 2 — e2e seed seam + publication guards

## What landed

- `e2e/config.ts` — `E2E_TOKEN_SEEDS` double opt-in (fail-closed on exactly-one) +
  `E2E_TOKEN_SEEDS_BUILD_STAMP`.
- `e2e/chrome-storage-token-seeds.ts` — the reader. One entry, `chainId === 0`,
  canonical `0x`+64-lowercase-hex fields, `expectedSymbol` pinned to `"TST"`
  here rather than accepted from storage. Anything else → `[]`.
- `token/seeder.ts` — `TokenSeederDeps.seeds` → `getSeeds()`, awaited at the slot
  the static read occupied (after the network null-guard, before the chain
  filter).
- `token/service.ts` — production default `async () => DEFAULT_TOKEN_SEEDS`;
  `seederOverrides.getSeeds` threads the e2e reader in.
- `wallet/runtime.ts` — reader constructed inside `if (E2E_TOKEN_SEEDS)`, stamp
  pinned as live data on `globalThis`.
- `agent.sh`, `_smoke-e2e.yml` — arm both flags; both now carry a positive
  propagation grep. `_build-extension.yml` — fail-fast env rejection + both
  literals added to the negative marker list.

## Two things worth remembering

**The global `chrome.storage` stub in `tests/vitest.setup.ts:88` is `{}` — it has
no `session` area.** The first draft of `chrome-storage-token-seeds.test.ts` used
`@webext-core/fake-browser` and every assertion passed *for the wrong reason*:
the reader's `try/catch` swallowed a `TypeError` and returned `[]`, so all the
rejection cases were green while the one valid case failed. The fix is the
pattern `chrome-storage-proof-gate.test.ts` already uses — build a local
in-memory fake of just the slice under test and `vi.stubGlobal("chrome", …)`.
A fail-empty reader makes this failure mode invisible unless at least one test
asserts the *positive* path; that test is what caught it.

**`bun run build` is Chrome-only** (`package.json:13`), so a gate that greps
`dist/firefox` after it silently checks a stale or absent directory. Phase 2's
gate names `build:chrome` and `build:firefox` explicitly.

## Validation gate — PASS

```
bun run lint          → exit 0   (one format error on the edited line, fixed via biome --write)
bun run typecheck     → clean
bun run lint:actions  → exit 0
vitest run src/wallet/services/token/ src/e2e/
                      → Test Files 8 passed (8) · Tests 96 passed (96)
```

Bundle assertions — all six:

| build | marker | expected | result |
|---|---|---|---|
| clean chrome | `NULO_E2E_TOKEN_SEEDS_BUILD_STAMP` | absent | absent ✓ |
| clean chrome | `nulo:e2e:token-seeds` | absent | absent ✓ |
| clean firefox | `NULO_E2E_TOKEN_SEEDS_BUILD_STAMP` | absent | absent ✓ |
| clean firefox | `nulo:e2e:token-seeds` | absent | absent ✓ |
| armed chrome | `NULO_E2E_TOKEN_SEEDS_BUILD_STAMP` | present | `assets/config-*.js`, `assets/index.ts-*.js` ✓ |
| armed chrome | `nulo:e2e:token-seeds` | present | `assets/index.ts-*.js` ✓ |

The armed-side half is what proves the negative grep is a real guard: the stamp
appears in the bundle only because `runtime.ts` pins it as live data. As a bare
exported constant it would tree-shake away even when armed — the exact
false-negative that `price-map.ts:63-67` records having shipped once already.

`dist/` was rebuilt clean afterwards so no armed bundle is left on disk.
