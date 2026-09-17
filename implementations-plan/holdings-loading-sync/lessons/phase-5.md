# Phase 5 — Arc 1 e2e + docs, and the Arc 1 codex fix loop

## What shipped
- `network/default-token-seeding.test.ts` traces, from inside the popup (a `MutationObserver` installed
  before the network switch), the ORDER Holdings showed things: the `token-seed-row[data-symbol="TST"]`
  placeholder before the `tokens-card`, and `tokens-empty-import-link` never in between. A test-side poll
  could miss a two-second placeholder and cannot prove an absence.
- `ARCHITECTURE.md` seeding paragraph: three metadata simulations (the truth as of this arc), seed status,
  `ensureSeeding`, `retrySeed`, the continuation and the alarm-wake resume.
- e2e README: the `displayName` pin of the armed seed source and the order trace.
- The regenerated auto-import stubs (`src/types/*`) for `useSeedStatus` and `Skeleton`.

## Attempts
1. **`audit:vue` exit 130.** A format error in the edited e2e spec failed the lint leg; `bun run --parallel`
   then SIGINTs the other legs, so the exit code names the casualty, not the cause. Read the first real
   failure in the log. After `biome format --write`: exit 0.
2. **Smoke e2e, first run: 2 failures.**
   - `backup-migration.test.ts` "fixture-arming contract" — environmental. `bun run test:e2e` does NOT
     build; it loads `dist/chrome`, which `audit:vue` had produced unarmed. CI builds with
     `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1
     VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1` and runs with `NULO_E2E_MIGRATION_FIXTURE=1`
     (`_extension-smoke-e2e.yml`). Local smoke must do the same two steps.
   - `fiat-display.test.ts` "truthful $0.00" — **real, caused by this arc**: it read `balance-amount` the
     moment it was visible, which is now an empty slot while the hero skeleton holds the figure. Fixed with
     a `waitForHomeTotal` fixture helper (waits for `balance-hero-loading` to leave), also used by
     `network/fiat-send.test.ts`, the only other e2e reader of the Home total.
3. **I4 (artifact-mode smoke shows placeholders, then `failed` rows after ~2 min).** Holds by
   construction: no smoke assertion counts anything but `tokens-card`, and the armed source build resolves
   an empty seed list. Not separately executed — artifact mode needs a release zip.

## Codex fix loop — Arc 1
Session `01a0b046-eac8-7561-bc38-5aeeae658315` (GPT-6 Astra, `high`). The host's sandbox cannot read the
repo, so each round pastes the diff and the key files inline.

### Round 1 — verdict `reject`, 10 findings
| # | Finding | Verdict | Action |
|---|---|---|---|
| 1 | Seed → balance handoff: the seeded marker can be announced before the balance row exists (pairs are created by `TokenBalanceService.onTokenAdded`, asynchronously), so both snapshots read "settled, empty" for a moment → empty state + `$0.00` flash | **Valid** (verified in `token-balance/service.ts`) | `useSeedStatus` holds a default that left the list while `pending/seeding` as `seeding` for `SEED_HANDOFF_MS` (5 s); `TokensView` already drops it by contract when the row lands; `BalanceView` now ignores a seed entry whose row has landed |
| 2 | Scope watchers ignore the profile id (one phrase imported twice = same address + network) | **Valid** | profile id added to both watchers. The balance event payload carries no profile id, and the balance service is active-profile-only, so the event filter is unchanged |
| 3 | `getSeedStatus` answers for the worker's scope; filtering by chain could certify an empty list for another scope | **Valid** | `getSeedStatus(chainId)` returns `{ scope, entries }`. **Self-caught while fixing:** the popup sets `store.network` BEFORE the worker's active network follows (`guarded-network-activation.ts`), so a plain "reject on scope mismatch" would have parked every network switch on skeletons for the 2 s retry — forever on a chain with no seeds, where no status event fires. The popup therefore names the chain; only a PROFILE mismatch is rejected (treated as a failed fetch, never `loaded`) |
| 4 | `TokensView` mount continuation fetches after unmount | **Valid** | generation check after the mount's awaits |
| 5 | A far-future `nextAttemptAt` was dropped, and the wake path only resumes entries that carry one | **Valid** | normalized to due-now (`0`) instead of dropped; test drives `resume()` alone |
| 6 | A pass that throws before recording an attempt re-arms every second | **Valid** | a thrown pass re-arms at the longest delay (60 s) |
| 7 | `seed pass threw` logged the raw error; `errorCategory` returned a writable `Error.name` | **Valid** | `{ category }` only; a name that does not look like a class name is `unknown` |
| 8 | The "fresh runtime" composition test never dispatches an alarm | **Partly** | the test name over-claimed → renamed. Alarm → SW boot is the platform's behavior; `armPostStartWork` ending in `seed:resume` is pinned by `runtime.post-start.pins.test.ts`. No new harness |
| 9 | "Clean USDC" vs the plan table's "Compliant USDC" | **Rejected** | the table's names are examples of "compiled-in name"; "Clean USDC" is the chain's own name, so the placeholder does not change text when the real row replaces it. Flagged in the PR body for the owner |
| 10 | Comments: workflow provenance, narration, stale "spinner" | **Valid** | fixed in `TokensView.vue` and `Skeleton.vue` |

### Round 2 (same session, resumed) — verdict `reject`, 5 findings; #9 withdrawn by codex
| # | Finding | Verdict | Action |
|---|---|---|---|
| 1 | The round-1 handoff fix inferred "seeded" from an entry DISAPPEARING and relied on a 5 s timer: a slower pair creation re-opens the flash, a popup mounted between the seeded marker and the pair never starts a hold, and a disappearance can also be a deletion | **Valid** — the inference was the flaw | the worker now says it: `SeedStatus` gains `seeded` (listed until the user deletes the default). Consumers wait for the balance row BY CONTRACT — `TokensView` keeps the placeholder, `BalanceView` holds the hero — so a mount mid-handoff is covered and a deletion is never mistaken for a seed. `useSeedStatus` lists a `seeded` entry for `SEED_HANDOFF_MS` from first sight in the scope; the cap only bounds a row that never comes (the live `onTokenBalanceAdded` event and the reconnect resnapshot are the reconciliation, not the timer). `holdDeparted` deleted |
| 2 | The mount path still called `fetchTokenImports()` after an unmount | **Valid** | `isUnmounted` checked after the task snapshot; the generation check stays before the balance fetch (a scope change there is served by the watcher). Test asserts no journal request |
| 3 | A profile mismatch could stay `unavailable` forever on a chain without defaults (no event, no reconnect) | **Valid as a robustness gap**; reachability is low — Home needs an unlocked profile, and the popup's profile is hydrated FROM the worker after unlock | a mismatch keeps polling every 2 s until the worker catches up; a rejected fetch stays one-shot |
| 4 | `useSeedStatus` over the 80-line budget | Moot after #1 | the window lives in `createHandoffWindow`; `bun run lint` exit 0 |
| 5 | A regex cannot make `Error.name` a category | **Valid** | allowlist of five names, everything else `unknown`; the test uses an alphabetic payload |
| 8 | The unpinned link is "runtime startup → `armPostStartWork` once profile/network are available" | **Answered** | `startRuntime` calls `armPostStartWork` unconditionally right after `services.start()` (`wallet/runtime.ts`). If that lands before the session restore, `resume()` arms nothing — and the activation trigger that follows runs a pass whose `finally` re-arms from the marker. New seeder test pins exactly that order |
