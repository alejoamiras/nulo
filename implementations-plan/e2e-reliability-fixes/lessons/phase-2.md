# Phase 2 · C3 · the two unit tests

## What changed

- `content-message-relay.test.ts`: `beforeEach` is async and ends with the relay's import, on a
  30 s hook budget; `freshRelay()` is synchronous and keeps the registration and the one-listener
  assertion in the test. Every case became synchronous, since the import was its only await.
- `method-descriptors.test.ts`: `import "@nulo/wallet-sdk-schema-patch/register"` then
  `import { WalletSchema } from "@aztec/aztec.js/wallet"`, as the file's first two imports; the
  exhaustiveness test is synchronous and its comment is one sentence.
- The relay reads `Date.now()` at call time (`content-message-relay.ts:105`, `:121`), so the TTL
  case's `vi.useFakeTimers()`, now called after the module has loaded, still fakes its clock.
- Runner check (`@vitest/runner` 4.1.10 `chunk-artifact.js`): `beforeEach(fn, timeout)` wraps the
  hook in its own `withTimeout(…, timeout ?? hookTimeout)` (`:717-724`), and the test function gets
  `testTimeout` (`:1734-1787`). So the import is bounded by the hook's 30 s, and the test's 5 s
  covers only the callback.

## Where the time goes (instrumented, before and after)

An uncommitted generator (in the build's scratch directory) wrote a `*.probe.test.ts` copy of each
file next to it: a wrapper around `test` timed each callback, and each import was timed where it
sat. Each copy ran three times, each run in a fresh `bun --bun vitest run` process; the copies were
deleted after. The first attempt timed the TTL case at 5,231 ms, but that was the fake clock:
`vi.useFakeTimers()` replaces `performance.now`, and the case advances it by about 5 s. The
wrapper then used a reference to the real `performance.now` bound before any test ran.

| Test | Before: callback | Before: import | After: callback | After: import |
|---|---|---|---|---|
| relay, first case | 47–179 ms | 44–176 ms, in the body | 1.6–2.3 ms | 36–50 ms, in `beforeEach` |
| relay, later cases | 0–7 ms | 0–2 ms (module node kept) | 0.3–3.6 ms | 0–1 ms |
| exhaustiveness | 333–770 ms | 332–768 ms, in the body | 0.4–0.5 ms | collection 303–370 ms (was 40–335 ms) |

After the fix, every formerly cold callback runs in milliseconds, far under the 1 s criterion, and
the import's cost sits in the hook or in collection.

## Under load (the skill's method)

Each file ran 10 times unpinned, then 20 times with vitest and three busy loops pinned to one CPU
(`taskset -c <n>`; CPUs 99 and 19 before the fix, 158 and 129 after, each the idlest at the time).
The figures are vitest's reported durations, which include `beforeEach`:

| Batch | Runs | Non-zero exits | Cold test's reported duration |
|---|---|---|---|
| relay before, unpinned | 10 | 0 | 42–84 ms (median 64) |
| relay before, pinned | 20 | 0 | 197–928 ms (median 304) |
| exhaustiveness before, unpinned | 10 | 0 | 270–361 ms (median 321) |
| exhaustiveness before, pinned | 20 | 0 | 1,614–2,854 ms (median 2,110) |
| relay after, unpinned | 10 | 0 | 47–93 ms (median 60), hook included |
| relay after, pinned | 20 | 0 | 196–1,086 ms (median 279), hook included |
| exhaustiveness after, unpinned | 10 | 0 | 0–1 ms |
| exhaustiveness after, pinned | 20 | 0 | 1–16 ms (median 3) |

The unfixed files never timed out on this host: four-way contention on one CPU put the cold test
at 2.9 s at worst, under the 5 s budget. The record's two timeouts came from a `test:all` on a host
at load 130 to 220. So the instrumented timings above are the proof that each import left the timed
body. The relay's reported duration stays the same because vitest counts `beforeEach` in it, which
is why the plan does not use it as the criterion.

## Isolation

An uncommitted mutant copy of the fixed relay test with `vi.resetModules()` removed failed 6 of 7
cases on `expected [] to have a length of 1 but got +0` (the one-listener assertion in
`freshRelay`): the registration is per module instance, so a shared module is caught at once. The
fixed file keeps a fresh module per case.

## Gate

- `bun --bun vitest run src/wallet/services/wallet-sdk/content-message-relay.test.ts` (from
  `apps/extension`): 7 passed, exit 0.
- `bun --bun vitest run src/method-descriptors.test.ts` (from `packages/wallet-bridge`): 22 passed,
  exit 0; its summary reads `import 484ms, tests 14ms`.
- `bun run lint`: exit 0. `bun run typecheck:all`: exit 0.
- `bun run test:all`: exit 0. extension 7,785 passed, 4 skipped, 8 todo (596 files passed, 3
  skipped); wallet-bridge 423; aztec-runtime 250 passed, 2 skipped; design 401; wallet-core 247;
  extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40;
  resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped (`bun test`).
- The 20 pinned runs of each fixed file: 20 of 20 green, both files.
