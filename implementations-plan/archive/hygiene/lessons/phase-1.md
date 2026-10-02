# Phase 1 · C2 · `presto/client.test.ts` and `content-message-relay.test.ts`

## What changed

- `presto/client.test.ts`: an async `beforeEach` resets modules and imports `./client` twice into
  `first` and `second`, on vitest's 10 s hook default; both tests are synchronous. Test 1 reads
  `first.getPrestoClient()` twice (a `PrestoClient`, the same object), test 2 asserts
  `second.getPrestoClient()` is not `first.getPrestoClient()`. Every identity assertion stays.
- `content-message-relay.test.ts`: the `30_000` #719 passed to its `beforeEach` is gone, and the
  comment above the hook keeps only its lasting reason, the same sentence as `presto/client`'s. The
  default budget sufficed on every run below, so no cause needed fixing.
- `lessons.md`'s timing-budget line names both files as importing in `beforeEach` on the hook's
  default budget; `e2e/config` stays listed.

## Where the time goes (instrumented, before and after)

#719's method, with its generator adapted (`mk-probes.ts` in the build's scratch directory): an
uncommitted `*.probe.test.ts` copy of each file, next to it, times each test callback through a
wrapper around `test` (on a `performance.now` bound before any test fakes timers) and each import
where it sits; the relay's copy also times its whole hook. Each copy ran three times, each run in a
fresh `bun --bun vitest run` process, and the copies were deleted after (`git status` clean).

| Measure | Before | After |
|---|---|---|
| `presto/client` test 1, callback | 19.7–69.5 ms | 1.2–1.3 ms |
| `presto/client` test 1, cold import | 17.5–67.8 ms, in the body | 15.0–16.7 ms, in `beforeEach` |
| `presto/client` test 2, callback | 2.2–3.0 ms (two imports of 0.5–0.8 ms) | 0.9 ms |
| relay, first hook (cold import) | 38.5–54.0 ms, on the raised 30 s budget | 39.2–46.9 ms, on the 10 s default |
| relay, later hooks | 0.5–1.1 ms | 0.6–1.3 ms |
| relay, callbacks | 0.3–2.7 ms | 0.3–2.6 ms |

Every callback now runs in milliseconds, far under the 1 s criterion, and each file's imports sit
in its hook, which uses under 1 % of the default budget.

## Under load

Each file ran 10 times unpinned, then 20 times with vitest and three busy loops pinned to one CPU
(`taskset -c <n>`; CPUs 178 and 179 before the fix, 181 and 66 after, each the idlest at the time
and still only 46 to 47 % idle). The host's load average read 144 as the before batches began and
117 as the after batches began, near the 130 to 220 of the record's `test:all` timeouts. The
figures are vitest's reported durations, which include `beforeEach`:

| Batch | Runs | Non-zero exits | Cold test's reported duration |
|---|---|---|---|
| `presto/client` before, unpinned | 10 | 0 | 29–81 ms (median 40) |
| `presto/client` before, pinned | 20 | 0 | 72–662 ms (median 152) |
| `presto/client` after, unpinned | 10 | 0 | 23–55 ms (median 43), hook included |
| `presto/client` after, pinned | 20 | 0 | 125–895 ms (median 302), hook included |
| relay before, unpinned | 10 | 0 | 71–130 ms (median 99), hook included |
| relay before, pinned | 20 | 0 | 189–1,166 ms (median 443), hook included |
| relay after, unpinned | 10 | 0 | 62–149 ms (median 84), hook included |
| relay after, pinned | 20 | 0 | 345–1,358 ms (median 834), hook included |

The unfixed `presto/client` never timed out here, as #719 found for its two files: the cold import
costs well under a second even pinned. The instrumented timings above are the proof that the import
left the timed body. For the relay, the pinned worst case (1.4 s, hook included) leaves the 10 s
default more than seven times its need, so the raised budget bought nothing.

## Isolation

Uncommitted mutant copies, deleted after:

- `presto/client` without the second `vi.resetModules()` in the hook: test 2 fails,
  `expected PrestoClient{} not to be PrestoClient{} // Object.is equality`; test 1 passes. Exit 1.
- The relay without its `vi.resetModules()`: 6 of 7 cases fail, each
  `expected [] to have a length of 1 but got +0` (the one-listener assertion in `freshRelay`).
  Exit 1.

## Gate

- `bun --bun vitest run src/presto/client.test.ts` (from `apps/extension`): 2 passed, exit 0.
- `bun --bun vitest run src/wallet/services/wallet-sdk/content-message-relay.test.ts`: 7 passed,
  exit 0.
- The load batches above: 20 of 20 pinned runs green for each fixed file. The mutants: exit 1 each.
- `bun run lint`: exit 0 (29 warnings and 3 infos, none in files this branch touches).
  `bun run typecheck:all`: exit 0.
- Neither file passes a budget to a hook or a test, and the diff sets no `timeout` or `hookTimeout`
  (a grep of both files finds only the TTL case's assertion and its fake clock).
