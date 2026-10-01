# Phase 0 — Characterize the transports inside the owning package

**Status:** ✓ complete. Gate green, zero production code touched.

## What shipped

Relocated the two transport contract suites out of the extension and into the
package that owns the code, and added the service-side + leak-guard coverage
that never existed:

- `src/testing/transport-harness.ts` — local hand-rolled `chrome` stub. The
  package's `setup.ts` uses `@webext-core/fake-browser`, which **cannot** do the
  two things the contract suites require: a `chrome.runtime.connect` Port whose
  `postMessage` is a `vi.fn` (so a test can make it throw) and a
  `chrome.runtime.sendMessage` a test can make reject. So the harness is a
  faithful port of the extension's `tests/vitest.setup.ts` broker, plus a new
  `connectServiceClient()` that fires `onConnect` for service-side tests. It
  installs its own `beforeEach`/`afterEach` (`vi.stubGlobal("chrome", …)`), so
  only files that import it get the custom stub — `errors.test.ts` keeps
  fake-browser.
- `src/background/client.test.ts` — relocated verbatim (imports rewired to
  package-relative; `LoggerStore`→`silentLogger`).
- `src/offscreen/client.test.ts` — relocated verbatim + a new
  `timer-cleanup tripwires` describe block (the leak guards Phase 2/D7 needs:
  every terminal path leaves `requests` AND `requestTimers` empty).
- `src/background/service.test.ts` + `src/offscreen/service.test.ts` — NEW.

## Findings pinned (the divergences this whole plan exists to fix)

1. **Error-contract divergence pinned.** `background/service.test.ts` asserts a
   thrown `WalletError` serializes `errorPayload`; `offscreen/service.test.ts`
   asserts the offscreen service emits the flat `error` string ONLY — no
   `errorPayload` even for a `WalletError`. Pinned verbatim; P3 makes offscreen
   additive, P4 flips the client.
2. **A6 fallback divergence pinned.** Background = 3-tier (clone-fail →
   jsonStringify → error-response → log-drop). Offscreen = 2-tier then SWALLOW
   (no error-response tier). Both pinned.
3. **Offscreen string-reject contract pinned verbatim** (remote error,
   timeout, send_failed, disconnect all reject with raw strings) — these are the
   exact assertions P4 flips to `toBeInstanceOf`.

## Bugs found but NOT pinned (deferred to their fix phase, per "fix-don't-pin")

- `unwrapParams(null)` throws (`Object.keys(null)`), and both services'
  `typeof wrappedParams !== "object"` guard lets `null` through → unhandled
  rejection → no response → client times out. **Did not add a passing test for
  the hang** (that would pin the bug). Fixed in Phase 1 (c).
- Offscreen A6 swallow-on-stringify-failure is a hang; not pinned. Fixed P1 (a).
- Callable-any-method (`method in this.requests` resolves inherited/prototype
  methods like `toString`): NOT pinned as desired behavior. The envelope tests
  assert only that a truly-unknown method name (`"nonexistent"`, not on the
  instance) is rejected. The inherited-method hole is closed in P3 (D10).

## Gate (standard, no network)

- `bun run --cwd packages/extension-messaging test` → **71 passed** (5 files).
- `bun run --cwd packages/extension-messaging typecheck` → clean.
- `bun run --cwd packages/extension typecheck` (vue-tsc) → clean.
- `bun run --cwd packages/extension test` → **2498 passed | 1 skipped | 7 todo**
  (relocation removed nothing the extension still needed).
- `bun run lint` → **exit 0** (52 warnings are pre-existing baseline; biome does
  not fail on warnings).

No codex consult needed — mechanical relocation + additive coverage.
