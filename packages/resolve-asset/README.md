# @nulo/resolve-asset

Layout-agnostic location of another package's files — including files the package does **not** export (wasm binaries, contract artifacts, storage internals). One source of truth for what used to be six drifting copies of a `node_modules`-walking resolver.

## Why it exists

Under Bun's isolated linker a workspace's `node_modules` holds only what that workspace declares, so "walk up from the repo root until `node_modules/<pkg>` appears" is wrong twice over: the root copy may not exist, and if it does it may not be the copy the declaring workspace's pin resolved to. Every function here is anchored at the **caller** (`from: import.meta.url`) and scans Node's documented ordered package-search locations for that anchor (`require.resolve.paths`), validating `package.json#name` at each candidate. The result is correct under both the hoisted and the isolated layout, and it fails loudly at config-load time when the package is not a declared dependency of the anchor workspace.

## Surface

| Export | Contract |
|---|---|
| `resolvePackageRoot(pkg, { from })` | Absolute package root. Never consults exports maps, never ascends from a resolved file. Throws listing every searched location when `pkg` is not reachable from `from`. |
| `resolvePackageAsset(pkg, assetPath, { from })` | Absolute path of a file inside `pkg`, exported or not. Throws if the path escapes the package root (lexical containment) or does not exist. |
| `resolveExportedAsset(pkg, subpath, { from })` | Plain `require.resolve` of an exported subpath (condition-less asset exports such as `@aztec/sqlite3mc-wasm`'s `./vendor/jswasm/*`). Prefer it when the asset is in the exports map. |
| `assertPackageIdentity(pkg, { from, expectVersion?, mustContain?, lockstepVia? })` | Executable identity check: name, exact version, a required file containing a marker (patch pins), and a **lockstep** guard — re-resolves `pkg` anchored inside `lockstepVia`'s real directory and asserts both resolutions realpath to the same copy, so a pin/manifest skew that splits the copies fails a test instead of shipping the wrong bytes. Returns the evidence (`root`, `realRoot`, `version`, `lockstepRealRoot`). |
| `isUnderNodeModules(path)` | Whether a resolved path lies inside some `node_modules`. |

`from` accepts a `file:` URL, an absolute path, or a vite-node `http://…/@fs/<abs-path>` URL (what `import.meta.url` becomes under vitest's jsdom environment and the vite dev server); any other served URL throws.

## Usage

```ts
import { resolvePackageAsset, resolveExportedAsset, assertPackageIdentity } from "@nulo/resolve-asset"

const bbWasm = resolvePackageAsset("@aztec/bb.js", "dest/browser/barretenberg.wasm.gz", { from: import.meta.url })
const sqliteWasm = resolveExportedAsset("@aztec/sqlite3mc-wasm", "./vendor/jswasm/sqlite3.wasm", { from: import.meta.url })

assertPackageIdentity("@aztec/sqlite3mc-wasm", {
	from: import.meta.url,
	expectVersion: "5.0.1",
	lockstepVia: "@aztec/kv-store", // the copy kv-store consumes must be the copy we ship
})
```

Rules for consumers: the anchor workspace must **declare** `pkg` (a phantom dependency is exactly what the search refuses to paper over); pass `import.meta.url` of the calling module, never a repo-root path; keep identity assertions in a test (`apps/extension/scripts/layout-identity.test.ts` is the canonical set).

## Testing

```bash
bun run --cwd packages/resolve-asset test        # vitest, real installed packages — no mocks
bun run --cwd packages/resolve-asset typecheck
```

The suite resolves real workspace dependencies under whichever linker is installed, so it doubles as a layout canary.

## Dependencies

None at runtime — `node:fs`, `node:module`, `node:path`, `node:url` only. It sits below every other workspace in the layer hierarchy and must stay dependency-free.
