Verdict: **use option 4: a test-only Vite transform plugin in `packages/playground/vite.config.ts`; it is the cleanest, but note it will not give a fundamentally new signal versus iteration #9.**

1. Iteration #9 already effectively patched the playground side, not the extension side. The playground imports `@aztec/wallet-sdk/manager` at [wallet.ts:13](../../packages/playground/src/lib/wallet.ts:13). The extension imports only `@aztec/wallet-sdk/extension/handlers` at [background.ts:26](../../packages/extension/src/wallet/services/wallet-sdk/background.ts:26). Your patched constant lives in `extension/provider`, so the wallet extension runtime was almost certainly untouched already.

2. Best option ranking:
   1. Option 4: Vite transform plugin, scoped to playground only.
   2. Option 2: `sed` in `agent.sh`, works but dirties local `node_modules`.
   3. Option 1: build-time `define` only if you also patch upstream/wrap it.
   4. Option 3: alias/shim is awkward because `manager` imports `provider` by relative path inside the package.
   5. Option 5: CI-only `bun patch` is too coarse.

3. Concrete change:
   - In [packages/playground/vite.config.ts:21](../../packages/playground/vite.config.ts:21), add `const e2eKeyExchangeMs = process.env.NULO_E2E_KEY_EXCHANGE_MS`.
   - In [packages/playground/vite.config.ts:24](../../packages/playground/vite.config.ts:24), add a small plugin before `nodePolyfills()`:
     - only run when `e2eKeyExchangeMs` is set
     - `transform(code, id)` only if `id.includes("/@aztec/wallet-sdk/dest/extension/provider/extension_provider.js")`
     - replace `const KEY_EXCHANGE_TIMEOUT_MS = 2000;` with `const KEY_EXCHANGE_TIMEOUT_MS = ${e2eKeyExchangeMs}; // nulo-e2e-only`
     - `console.log("[playground:vite] patched wallet-sdk KEY_EXCHANGE_TIMEOUT_MS=", e2eKeyExchangeMs)` once
   - In [packages/extension/tests/e2e/global-setup.ts:366](../../packages/extension/tests/e2e/global-setup.ts:366), add `NULO_E2E_KEY_EXCHANGE_MS: "10000"` to the playground dev-server env block.

4. Verification:
   - Positive: CI logs should show `[playground:vite] patched wallet-sdk KEY_EXCHANGE_TIMEOUT_MS=10000`.
   - Negative: `dist/chrome` is built separately and cannot see this transform; `rg -n "nulo-e2e-only|patched wallet-sdk" dist/chrome` should stay clean.

5. Landmine: because iteration #9 already changed the same dApp-side module, this patch is mainly about hygiene and scope, not root-cause isolation. If pass rate does not improve, that weakens the “2s is the main cause” hypothesis rather than re-testing extension-vs-playground.
