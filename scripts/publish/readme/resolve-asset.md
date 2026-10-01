# @alejoamiras/nulo-resolve-asset

Locates files inside installed packages, including files a package does **not** export (wasm binaries, contract artifacts). It is anchored at the caller, so the result is correct under both hoisted and isolated (`bun install --linker isolated`) `node_modules` layouts. From the [Nulo wallet](https://github.com/alejoamiras/nulo) monorepo.

## Exports

| Export | Contract |
|---|---|
| `resolvePackageRoot(pkg, { from })` | Absolute package root, found by scanning Node's ordered search locations for `from` and validating `package.json#name`. Never consults exports maps. Throws, listing every location searched, when `pkg` is not reachable. |
| `resolvePackageAsset(pkg, assetPath, { from })` | Absolute path of a file inside `pkg`, exported or not. Throws if the path escapes the package root or does not exist. |
| `resolveExportedAsset(pkg, subpath, { from })` | `require.resolve` of an exported subpath. |
| `assertPackageIdentity(pkg, { from, expectVersion?, mustContain?, lockstepVia? })` | Checks name, exact version, a required file containing a marker, and (`lockstepVia`) that `pkg` resolves to the same real directory from inside another package. Returns the evidence. |
| `isUnderNodeModules(path)` | Whether a path lies inside some `node_modules`. |

`from` is the caller's `import.meta.url` (a `file:` URL), an absolute path, or a vite-node `http://…/@fs/<path>` URL.

## Requirements

ESM only. Node or Bun: it imports `node:fs`, `node:module`, `node:path` and `node:url`, so it runs in build tooling and tests, not in a browser. No dependencies.

## Provenance

Built from `packages/resolve-asset` in [alejoamiras/nulo](https://github.com/alejoamiras/nulo) by `.github/workflows/publish-packages.yml` and published with npm provenance. `npm audit signatures` verifies the attestation.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
