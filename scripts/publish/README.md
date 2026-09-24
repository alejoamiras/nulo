# scripts/publish

Stages three workspace packages as public npm packages and binds their first publication to rehearsed bytes. The workspaces themselves stay `private` and keep their `@nulo/*` names, a scope someone else owns on npm; only the staged copies, named `@alejoamiras/nulo-*`, reach a registry.

| Workspace | npm package | Published surface |
|---|---|---|
| `packages/wallet-crypto` | `@alejoamiras/nulo-wallet-crypto` | `.` → `src/public.ts`: `deriveNuloAccountKeys`, `deriveSigningKeyFromSeed`, `EncryptionKey`, `type Passhash` |
| `packages/resolve-asset` | `@alejoamiras/nulo-resolve-asset` | `.` → `src/index.ts` (Node/Bun only) |
| `packages/wallet-sdk-schema-patch` | `@alejoamiras/nulo-wallet-sdk-schema-patch` | `./apply`, `./register` (side effect) |

## Files

| Path | Purpose |
|---|---|
| `packages.ts` | The table above: names, entries, targets, side-effect entries. |
| `stage.ts` | `bun scripts/publish/stage.ts <dir>...\|--all --version X.Y.Z [--out <root>]` → `dist-publish/<dir>/`: a Bun ESM bundle per entry (`@aztec/*` and `zod` kept as bare imports; `wallet-core` code inlined), declarations from each package's `tsconfig.publish.json` with `.js` specifiers and unreferenced files pruned, a generated `package.json` (exact `@aztec/*` peers from the workspace pins, `zod` a dependency, provenance required), README, LICENSE and NOTICE. Must run from the repo root. |
| `readme/<dir>.md` | The README each npm package ships. |
| `check-digests.ts` | `bun scripts/publish/check-digests.ts <version> <tgz-dir>`: a version listed in `approved-digests.json` must pack exactly those tarballs; `0.1.0` must be listed. |
| `approved-digests.json` | `{ "<version>": { "<tarball>": "<sha256>" } }`, recorded by the rehearsal before the first publication. |
| `stage.test.ts` | The tarball contract (run by `test:release`). Details below. |

## What the tests prove

`stage.test.ts` stages and packs all three packages and checks each tarball:

- **File list:** it equals an allowlist.
- **Bundles:** each keeps exactly its pinned imports, as bare specifiers, under a size ceiling. No `node:` import appears outside `resolve-asset`.
- **No private names:** nothing names a private `@nulo/*` package.
- **Peers:** they equal the workspace pins.
- **Attribution:** the Azguard notice heads the bundle and declaration derived from `encryption-key.ts`.
- **Reproducible:** a second staging packs byte-identical tarballs.

It then unpacks the tarballs into a consumer outside the workspace, with the peers linked from the installed tree, and checks that the consumer:

- imports every export under Bun and under Node 24 ESM;
- reproduces the key-derivation vectors;
- type-checks under NodeNext and Bundler resolution.

Finally it checks that `EncryptionKey` ciphertexts are interchangeable between the bundle and the wallet's source, and that both reject a wrong AAD or a tampered byte.

Comment-only edits to a published source file leave the staged bytes unchanged: Bun drops comments and the declarations are emitted without them. Changes to code, to an Azguard header line or to a file's path do change them.

## Publishing

`.github/workflows/publish-packages.yml` runs on `workflow_dispatch` from `dev` or `main`, and is a dry run by default. It has two jobs:

1. **Build.** An unprivileged job runs `test:release`, stages, packs and checks the digests.
2. **Publish.** The only job with `id-token: write`. It runs in the `npm-publish` environment, which needs the owner's approval, and publishes each tarball with `npm publish --provenance` through npm trusted publishing. No npm token exists anywhere. `scripts/ci-cd/publish-packages.test.ts` pins that shape.

**Before the first publication** (owner and agent, from a workstation):

1. **Placeholders.** Publish a code-free `0.0.0-bootstrap.0` of each package under the `bootstrap` dist-tag.
2. **Trusted publisher.** Attach it to each package:
   ```sh
   npm trust github <pkg> --file publish-packages.yml --repo alejoamiras/nulo --env npm-publish --allow-publish
   ```
   Then confirm the record with `npm trust list`.
3. **Package settings.** Require 2FA and disallow tokens on each package, then deprecate the placeholders.
4. **Log out.** Run `npm logout`.
5. **Rehearsal.** Record the three `0.1.0` digests in `approved-digests.json`.
