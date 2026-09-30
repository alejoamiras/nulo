# Phase 5 · Browser proof and the arc gate

## The driver method

`evaluateInBackground(owner, body)` on `BrowserDriver`. Chrome evaluates the body in the
service-worker target over CDP and detaches before it resolves, so no session parks the worker's
host through a later stop. Firefox's `evaluateInBackgroundPage` frame script evaluates it in a
`Components.utils.Sandbox` with the event page's principal and the page, unwrapped, as its
prototype.

Why the sandbox, from a probe spec run once on Firefox and deleted, never committed. What the
frame script sees of the event page:

- `typeof content.chrome` → `"undefined"` (the Xray hides it);
- `typeof content.wrappedJSObject.chrome` → `"object"`;
- `content.wrappedJSObject.eval("1 + 1")` → `EvalError: call to eval() blocked by CSP`;
- `new content.wrappedJSObject.Function("return 2")()` → `EvalError: call to Function() blocked
  by CSP`;
- `typeof Components` → `"object"`.

`tests/e2e/FIREFOX.md` gains the row. Inference 2 holds on both engines: an own `set` defined on
the background's `chrome.storage.local` intercepts the storage adapter's write (the error snack
shows), and it puts the real one back after one refusal (the second Continue lands).

## The loader step, dropped

- First Chrome run, `-t "S4|S11" --retry=0` → exit 1: S4 ✓; S11 × at the loader step,
  `TimeoutError: Waiting failed: 15000ms exceeded`. A mutation observer armed before
  `stopBackground` saw no `global-loader` inserted in 15 s. Everything before it had passed: the
  refusal, the snack, the four hit tests and the 12 px gap.
- Cause: `ServiceClient.onDisconnect` calls `disconnect()` and then `connect()` in one callback
  (`packages/extension-messaging/src/background/client.ts:94-97`), and `chrome.runtime.connect`
  returns at once. `isBackgroundConnected` goes false and true in one tick, and the loader's
  batched render draws nothing. The shell's own comment says the same (`popup/app.vue:423-427`).
- The step is dropped, not simulated. Only a `runtime.connect` that throws keeps the loader up,
  and forcing that tests a state the scenario never reaches. The loader's and the barriers' order
  over the raised host rests on their stacking values (Fact 14). The plan's P5, Outcome 2,
  Security and Fact 14 now say so.

## Red, before P3

The red build is the branch head with P3's product change reverted: `popup/app.vue` and
`components/LegalAcceptanceSheet.vue` from `73256f2c^`, keeping the `toast-root` testid. Both files
were copied to scratch first and copied back after, and `git status` was clean. The armed dists
were built and copied to `dist/red-chrome` and `dist/red-firefox`, then deleted after the runs.

- Chrome, `EXTENSION_PATH=<abs>/dist/red-chrome`, `-t S11 --retry=0` → exit 1, 1 failed, 13
  skipped: `expected { card: 'legal-sheet', … } to deeply equal { card: 'snackbar', … }`. Continue,
  "Not now" and the point beside the card matched: the card was drawn under the sheet.
- Firefox, the same on `dist/red-firefox` → exit 1, the same diff.

## Green

- Chrome, `-t "S4|S11" --retry=0` → exit 0, 2 passed, 12 skipped (S4 19.6 s, S11 10.7 s).
- Firefox, the same → exit 0, 2 passed, 12 skipped (S4 28.4 s, S11 14.6 s).

## Found in the build

- P3's inset case (`components/LegalAcceptanceSheet.test.ts:139`) failed `vue-tsc`: it assigned
  `route.meta` a literal with `showBottomNav`, which the hoisted route's inferred type lacks. P3's
  gate had run lint and vitest only. It is fixed in its own commit, with `Object.assign(route, …)`
  as the suite's `beforeEach` does.
- The e2e tree is outside every tsconfig. A probe config over the five touched e2e files (deleted)
  reported only the `…PerTest` fixture-typing errors that S1 to S3 and S7 already carry.
- The e2e reads of `#toast` select by a new `data-testid="toast-root"` (CLAUDE.md § testid).
