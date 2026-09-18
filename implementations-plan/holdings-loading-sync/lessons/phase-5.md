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
| — | *(superseded in round 3: the `SEED_HANDOFF_MS` window described in row 1 was removed)* | | |
| 8 | The unpinned link is "runtime startup → `armPostStartWork` once profile/network are available" | **Answered** | `startRuntime` calls `armPostStartWork` unconditionally right after `services.start()` (`wallet/runtime.ts`). If that lands before the session restore, `resume()` arms nothing — and the activation trigger that follows runs a pass whose `finally` re-arms from the marker. New seeder test pins exactly that order |

### Round 3 (same session) — "no new material findings"; verdict still `reject` on ONE held point
Codex confirmed the worker-side `seeded` change, the mount fence, the category allowlist, the mismatch
polling and the startup ordering, and held round 2's #1: the 5 s window still let the list settle as
empty (and the hero print `$0.00` before its own 12 s cap) when a seeded default's balance row was late
or never came — "a later event repairs the display; it does not make the intervening assertion correct".

**Accepted — and its fix was less code than my defence of the timer.** `createHandoffWindow` and
`SEED_HANDOFF_MS` are deleted: a `seeded` default is listed for good, and only the consumer holding the
balance rows decides that it has landed (by contract). The one visible cost is deliberate: if the balance
service never creates the row, Home keeps one skeleton row for that default instead of claiming "no
tokens"; the hero is bounded by its own 12 s cap. Pinned by a composed `TokensView` test that advances
ten minutes without a balance row and still finds no empty state.

**Lesson:** when a reviewer rejects a timer twice, check whether the timer is protecting a real case. It
was protecting a fault path (a row that never comes) at the price of lying on the common slow path.


### Confirming pass (same session) — converged
After the timer was deleted codex re-read the diff:

> approve — no new material findings … The held finding is resolved — high confidence … Arc 1's review
> has converged based on the supplied code and reported validation.

## Screenshots (`screenshots/`)
- `a1-home-seeding.png` — Home right after sign-up: cUSDC "Clean USDC" and USDC "USD Coin" as placeholder
  rows with skeleton amounts, no empty state. Captured by taking the worker offline over CDP so the
  seeding state holds still.
- `a4-seed-failed.png` — "Couldn't set up" + RETRY; `a4-seed-rejected.png` — "Couldn't verify", no button.
  Both by rewriting the seed marker. Gotchas: ValueStorage stores the marker as a JSON STRING (a raw
  object write is ignored), and vitest's default retries overwrite a screenshot — capture with `retry: 0`.

## Environment notes
- The playground "fails to start" on this host: vite's `host: "localhost"` binds `[::1]` only, the e2e
  setup's probe resolves IPv4 only. Env-only workaround, no repo change:
  `NODE_OPTIONS=--dns-result-order=ipv4first`.
- `e2e:agent` builds `dist/chrome` itself — nothing else may build in the worktree while it runs.
- The harness killed the first complete network run on a system-wide low-memory signal after 26 spec
  files (no kernel OOM, no orphans). The other 62 ran as a second segment on the same commit and build.

## Gate (as written in plan.md) — on `2f41831d`
- `bun run audit:vue` — exit 0 (504 files, 6178 tests, then build)
- `bun run test:e2e` (armed build) — exit 0 (32 files passed, 1 skipped; 123 tests)
- `bun run e2e:agent`, complete network suite, proverless — 86 spec files passed, 0 failed, 0 retried;
  2 skipped by their own env gates (`_probe-warmup-effect`, `tx-sendTx-delegated-authwit`). Segment 1:
  26 files passed before the kill; segment 2: `exit 0`, 60 passed | 2 skipped (62).
- Not run locally: the prover-ON canary (CI's `canary` shard owns it).
