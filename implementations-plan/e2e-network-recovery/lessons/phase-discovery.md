# Phase: discovery — why the original "drop `module` field" patch wasn't enough

## What I tried first

Commit `418ece9` stripped the `module` field from `@aztec/noir-noirc_abi@4.2.0` and `@aztec/noir-acvm_js@4.2.0`. Opus B had verified this unblocked the test runner's `WASMSimulator.init` — `[e2e-setup] Test contracts deployed: { ... }` started showing up in the global-setup output, vitest went from `45 skipped / 61 skipped` to `41 failed / 4 skipped`.

That looked like a win. It wasn't, because every "running" test then hit a deterministic 30s timeout.

## What was actually happening after commit `418ece9`

Every fixture using `launchExtension` (i.e. registeredExtension, dappConnectedExtension, localNetworkExtension, tokenReadyExtension, feeJuiceImportedExtension) was hanging at `tests/e2e/fixtures/extension.ts:70-80`:

```ts
await blankPage.waitForFunction(
  async () => {
    try {
      const result = await chrome.storage.session.get("nulo:liveness")
      return !!result["nulo:liveness"]
    } catch { return false }
  },
  { timeout: 30_000, polling: 500 },
)
```

The fixture polls the SW's `nulo:liveness` signal (written by `wallet/runtime.ts:180-181` after `services.start()` + `initWalletSdkHandler`). If the SW never writes the signal, the wait times out at exactly 30s — which is what every failing test saw.

## Why the SW never wrote liveness

The naive `module` removal forced **every** consumer — including the **wallet's Vite browser build** — to pick the `main` field instead, which points to the Node CJS bundle:

- `nodejs/noirc_abi_wasm.js`: synchronous WASM load via `require('fs').readFileSync(__dirname + ...)` at module top level.

In a browser/SW context:
- `require` is undefined.
- `__dirname` is undefined.
- The module evaluation throws immediately.

The eager-imported chain `wallet/runtime.ts → ChainRuntime → WASMSimulator → noir-noirc_abi` meant the SW couldn't even reach `services.start()`. Result: no liveness write → all fixtures hang.

Verification: `grep -c '__dirname' packages/extension/dist/chrome/assets/noirc_abi_wasm-*.js` returned `1` against the post-`418ece9` bundle. Confirmed the wallet shipped Node-only code.

## Why smoke e2e didn't catch this

Smoke e2e uses `bun run test:e2e` (`vitest.e2e.config.ts`) without `globalSetup`. It uses `registeredExtension` etc. too, so the SAME `launchExtension` runs in smoke. Why smoke passed and network failed:

… is the open question. Hypothesis: smoke might have been running against a stale `dist/chrome` from a prior build that *didn't* have the patched packages applied. Or smoke's audit:vue rebuild step happens before `bun patch` re-applies. Either way, smoke isn't a reliable canary for this kind of dependency-resolution regression.

This is a project-level reliability concern beyond the scope of this recovery PR (smoke should fail on patch-induced regressions). Filing as a follow-up.

## The fix

Patches v2 (the change in this branch's working tree) replace the bare `module` removal with a proper `exports` map:

```json
"exports": {
  ".": {
    "node": "./nodejs/noirc_abi_wasm.js",
    "default": "./web/noirc_abi_wasm.js"
  }
}
```

- Vite browser build → matches `default` → web ESM bundle → fetch path → at browser context, `fetch(file://)` works → SW boots → liveness written → fixtures resolve.
- Vitest with `environment: "node"` → matches `node` → Node CJS bundle → `require('fs').readFileSync()` works → WASMSimulator init no-ops as designed → contract deploy succeeds.

This is what an honest cross-context resolution looks like. The earlier "remove module" was a half-fix that broke one half to fix the other.

## Lesson

When patching a dual-bundle package whose `package.json` predates the `exports` standard, always add a proper `exports` map. Never blindly remove the `module` field — it's the de-facto ESM entrypoint for everyone who needs it.
