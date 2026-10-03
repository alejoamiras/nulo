---
plan: harden-dedupe / logsviewer-timer (arc 15b of the program, split from async-primitives)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/15b-logsviewer-timer, stacked on hd/15-async-primitives
---

# logsviewer-timer: clear the log viewer's fetch deadline

Finding Q-16 (a), from `audit/quality/2026-09-30-dedup-high/`. `apps/extension/src/components/JsonViewer/LogsViewer.vue` races each batch read against a 500 ms timer that rejects with `"Logs fetch timeout"`, and never clears it, so every read that wins leaves an armed timer behind. It was planned as async-primitives' Phase 3f. The program plan puts a route-2 fix in its own arc, so it ships here, on top of that arc.

## Change

- **The fix.** In `fetchLogs`, the timer id is kept and `await Promise.race([fetch, timeout])` is wrapped in a `try/finally` that clears it.
- **Hops.** The `finally` runs inside the race's resume job, so no promise hop is added. The caught reason is unchanged, and `return await fetch` stays.
- **Not shared.** No deadline helper is introduced: async-primitives deferred `raceDeadline` (see its Deferred), and this clear stays inline.

## Validation gate

- **New test:** `LogsViewer.test.ts`, which stubs the editor and both service clients.
  - A batch that arrives in time clears its deadline timer. This row fails against the file at async-primitives' head and passes after the fix.
  - A batch that misses the deadline is retried with a quarter of the count (1024, then 256). This row passes both before and after.
- **Mutants:** removing the clear, and changing the fallback divisor, are both killed.
- **Commands:** the program's gates (`lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`).

## UI impact

None. The template and styles do not change. The zero-diff gate covers the logger window (`popup/windows/logger/`):

- base: async-primitives' head; head: this arc's head;
- the same fixed log set and three states as async-primitives (loaded, Debug Mode on, empty);
- Chrome and Firefox, dark and light, plus a `--stability` run.

## Delivery

One arc, `hd/15b-logsviewer-timer`, stacked on `hd/15-async-primitives`. Code review: off. Codex reviews this diff in the same round as async-primitives'.

## Decisions (delegated)

### Route 2: the LogsViewer timer clear

The program plan's route-2 criteria, one by one:

- **Invisible:** no pixel, copy, dApp wire code or message, or persisted byte changes. The zero-diff logger shots prove the pixels.
- **Strictly safer:** it only adds a cleanup and relaxes nothing.
- **Red-then-green:** `LogsViewer.test.ts` fails against the previous file, because the 500 ms timer is never cleared, and passes now. Its fallback row passes on both.
- **Pre-cleared:** the program plan's Behaviour rule names this fix.

Split from async-primitives into its own arc, as the program plan's Behaviour rule requires of a route-2 fix. Arc 19's json/logger window guard was split the same way.

**PR body text:**

> ### Behaviour change (route 2): the log viewer's fetch deadline is cleared
>
> `LogsViewer.vue` raced each batch read against a 500 ms timer and never cleared it, so every read that won left an armed timer behind. The timer id is now kept and cleared in a `finally` around the race. That `finally` runs in the race's own resume job: no promise hop is added, the caught reason is unchanged, and `return await fetch` stays.
>
> - Invisible: no pixel, copy, wire or persisted byte changes. The logger window's zero-diff shots (three states, Chrome and Firefox, dark and light, plus a stability run) prove the pixels.
> - Strictly safer: it only adds a cleanup.
> - Red-then-green: `LogsViewer.test.ts` fails against the previous file (the deadline timer is never cleared) and passes now. A second row pins the timeout fallback to a quarter of the batch.
