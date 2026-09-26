# Plan v1: Harden the bb.js WASM pipeline (eliminate manual vendoring)

> Audited by codex xhigh. Both audit and my pre-investigation findings
> consolidated below.

## Why this matters

`packages/extension/libs/@aztec/bb.js/{barretenberg,barretenberg-threads}.wasm.gz`
are vendored manually. PR #46 bumped `@aztec/bb.js` npm 4.2.0 but did
NOT refresh these files. Codex byte-compared:

- The `libs/` files (Apr 11) are NOT byte-identical to bb.js@4.2.0's
  npm-shipped equivalents (Apr 21). **Drift has already happened.**
- It hasn't manifested as user-visible breakage yet only because the
  WASM ABI didn't change in a way that hits our specific code paths.

The pipeline as designed is brittle: a future contributor bumping the
npm dep would update the JS half but leave WASM stale, and silent
proving breakage waits.

## How the pipeline actually works (verified)

1. **SW init**: `wallet/runtime.ts:91` calls
   `BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH })`.
   Runs in the service-worker context.
2. **`process.env.BB_WASM_PATH`** is wired in `vite.config.ts:211` to
   `"/assets/barretenberg.wasm.gz"`.
3. **bb.js call chain**: `BarretenbergSync.initSingleton` →
   `bb_backends/browser/index.js:29` → `bb_backends/wasm.js:20` →
   `barretenberg_wasm/index.js:fetchModuleAndThreads` →
   `fetch_code/index.js:fetchCode`.
4. **Vite shim**: `vite.config.ts:84-92` hooks `resolveId` to redirect
   bb.js's `fetch_code/index.js` import to our
   `src/shims/bb-fetch-code.ts` shim. Reason: bb.js's stock
   `fetch_code` uses dynamic `import()` to lazy-load WASM-as-inlined-JS
   when `wasmPath` is missing — but Chrome MV3 service workers forbid
   runtime `import()`. Our shim replaces it with `fetch()`.
5. **Threads decision**: bb.js's
   `barretenberg_wasm/index.js:fetchModuleAndThreads` checks
   `getSharedMemoryAvailable()` =
   `SharedArrayBuffer !== undefined && globalScope.crossOriginIsolated`.
   **NOT tied to `desiredThreads`** (which only controls worker count).
   - If `shared === true` → fetches `/assets/barretenberg-threads.wasm.gz`
   - If `shared === false` → fetches `/assets/barretenberg.wasm.gz`
6. **Critical caveat (codex confirmed)**: COOP/COEP headers are set in
   both `vite.config.ts:34-36` and `manifest.config.ts:38`. But Chrome's
   own docs note that SW cross-origin isolation is not fully
   implemented. So `shared === false` IS reachable in production —
   meaning the singlethreaded fallback is NOT dead code.

## What npm 4.2.0 ships (verified)

| Variant | Form | Path |
|---|---|---|
| Threads | Standalone `.wasm.gz` | `dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz` (and `dest/node-cjs/...`). **Codex byte-compared: identical to the threaded data-URI payload in the browser inlined JS.** |
| Singlethread | Inlined JS (base64-gzip data URI inside a `.js` module, ~3.6 MB) | `dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js` |

**No standalone singlethreaded `.wasm.gz` exists in npm.** The only way
to get those bytes is to extract them from the inlined JS module.

## Recommendation: **Option B** (codex agreed)

Write a small vite plugin that, at build time:

1. **Threads variant**: copy `barretenberg-threads.wasm.gz` from
   `node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/` to
   `dist/<browser>/assets/`.
2. **Single variant**: read
   `node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js`,
   regex/parse the base64 data URI inside it, base64-decode → those
   bytes are already gzip-encoded (DON'T gunzip+regzip), write to
   `dist/<browser>/assets/barretenberg.wasm.gz`.
3. **Hash assertion**: byte-compare the threaded `.wasm.gz` against the
   threaded data-URI payload in the inlined JS. If they ever desync
   upstream, fail the build loud.
4. **Delete `libs/@aztec/bb.js/`** + the existing `viteStaticCopy`
   block.

After this PR: bumping `@aztec/bb.js` npm dep auto-updates both WASM
variants. Single source of truth.

### Why not Option A (threads-only)

Codex flagged: SW cross-origin isolation gaps in Chrome mean
`shared === false` is reachable in real browsers. Shipping only the
threaded variant would silently break proving for those users.

### Why not Option C (postinstall + hash assertion + keep `libs/`)

Doesn't address the singlethreaded WASM extraction. Would still need
a script to extract from the inlined JS. And `libs/` stays in the
tree as a footgun for contributors who do the wrong thing.

## Files touched

| # | Path | Change |
|---|---|---|
| A | `packages/extension/vite.config.ts` | Replace `viteStaticCopy({ src: "./libs/@aztec/bb.js/*.wasm.gz" })` with the new plugin (copies threads from `node_modules/.../node/...`, extracts single from `node_modules/.../browser/.../barretenberg.js`). Tighten the existing `bb-fetch-code-shim` `resolveId` predicate to only match the browser graph (codex SHOULD-FIX). |
| B | `packages/extension/scripts/extract-bb-wasm.ts` (new) | Helper module exporting the two source paths + extraction logic. Imported by the vite plugin. |
| C | `packages/extension/src/shims/bb-fetch-code.ts` | Two fixes: (1) add `res.ok` check (404 currently surfaces as a gzip/WASM compile error); (2) fix filename mangling — split on `shared` flag rather than string-suffix manipulation (codex GAP #3). |
| D | `packages/extension/libs/@aztec/bb.js/` | Delete. |
| E | `packages/extension/package.json` | Version bump 0.13.54 → 0.13.55. |

## Verification

- `bun install && bun run build` — the new plugin must produce
  `dist/<browser>/assets/barretenberg.wasm.gz` and
  `dist/<browser>/assets/barretenberg-threads.wasm.gz` matching the
  bytes that bb.js@4.2.0 expects.
- `bun run typecheck`, `bun run lint`, `bun run test` clean.
- `bun run test:e2e` smoke (no WASM execution but checks SW boot).
- **Manual QA on a fresh dev profile**: send a private tx (exercises the
  proving path → SharedArrayBuffer + threaded WASM in the offscreen).
  If COOP/COEP work in your browser environment, this hits the threads
  path. If not, the singlethread path; either way must work.
- **Hash regression gate**: a unit test that loads the inlined JS,
  extracts the threaded data URI bytes, and asserts they match
  `dest/node/.../barretenberg-threads.wasm.gz`. Catches the rare case
  upstream desyncs the two.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Upstream changes the inlined-JS format (e.g., switches from base64 data URI to plain `Uint8Array` literal) | Detect at build time via regex assertion; fail with a clear "upstream layout changed, update extract-bb-wasm.ts" error message |
| 2 | Threaded browser payload byte-diverges from node `.wasm.gz` in a future bb.js release | Hash-comparison gate (#3) in the plugin fails the build |
| 3 | `node_modules/.../dest/node/` path structure changes between bb.js versions | Use `resolvePackageFile()` (already in `vite.config.ts`) to centralize path resolution |
| 4 | Singlethread WASM ABI shifts vs threaded across bb.js versions | Out of our control; bb.js's responsibility to keep them compatible |

## Out of scope (filed as follow-ups)

- **Shim resolveId predicate broadness** (codex GAP #1): partial fix
  in this PR (tighten to browser-only). Full audit of the shim could
  be a separate hardening pass.
- **Investigating whether the SW even needs the shim post-bb.js@4.2.0**:
  if upstream finds a way to make `import()` work in MV3 SWs, we could
  drop the shim entirely. Not happening soon.

## Open questions for the user

### Q1. Plugin location

The vite plugin can either:
- **(a)** Live inline in `vite.config.ts` (small enough)
- **(b)** Extract to `packages/extension/scripts/extract-bb-wasm.ts` (testable in isolation)

My recommendation: **(b)** — the extraction logic deserves its own
unit test (the regex parsing the data URI is exactly the kind of
fragile thing that benefits from a focused gate).

### Q2. Hash regression gate — strict or warn?

The "threaded browser payload === threaded node `.wasm.gz`" invariant
is something codex byte-confirmed for 4.2.0 today. If upstream ever
desyncs them, the build either fails loud (strict) or warns + uses
the node variant anyway (warn).

My recommendation: **strict**. A divergence means upstream changed
its layout, which we want to catch immediately rather than ship
silent breakage.

### Q3. Apply the shim's two minor bugs in this PR or separately?

Codex flagged:
- Missing `res.ok` check (404 → unclear gzip/WASM error)
- Filename mangling bug: `BB_WASM_PATH = "barretenberg-threads.wasm.gz"`
  produces `"barretenberg-threads-threads.wasm.gz"`

Both are 2-3 line fixes. My recommendation: bundle into this PR.
Confirm or split.
